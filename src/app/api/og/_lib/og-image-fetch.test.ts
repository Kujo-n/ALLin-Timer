import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

import { fetchAsDataUri, isAllowedBgImageUrl } from "./og-image-fetch";

const ORIG_FETCH = globalThis.fetch;
const ALLOWED_URL = "https://firebasestorage.googleapis.com/v0/b/x/o/img.jpg";

describe("isAllowedBgImageUrl", () => {
  it("Firebase Storage HTTPS URL は許可", () => {
    expect(isAllowedBgImageUrl(ALLOWED_URL)).toBe(true);
    expect(
      isAllowedBgImageUrl("https://storage.googleapis.com/bucket/obj.png"),
    ).toBe(true);
  });

  it("HTTP（非 HTTPS）は拒否", () => {
    expect(
      isAllowedBgImageUrl("http://firebasestorage.googleapis.com/x"),
    ).toBe(false);
  });

  it("非 allowlist ホストは拒否（SSRF 防御）", () => {
    expect(isAllowedBgImageUrl("https://attacker.example.com/a.jpg")).toBe(false);
    expect(isAllowedBgImageUrl("https://169.254.169.254/meta")).toBe(false);
    expect(isAllowedBgImageUrl("http://localhost:6379/")).toBe(false);
    expect(isAllowedBgImageUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedBgImageUrl("ftp://firebasestorage.googleapis.com/x")).toBe(
      false,
    );
  });

  it("URL でない文字列は拒否", () => {
    expect(isAllowedBgImageUrl("")).toBe(false);
    expect(isAllowedBgImageUrl("not-a-url")).toBe(false);
  });
});

describe("fetchAsDataUri", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it("200 OK + 許可 host + image/png → data URI を返す", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    const response = new Response(bytes, {
      status: 200,
      headers: { "content-type": "image/png" },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);

    const result = await fetchAsDataUri(ALLOWED_URL);
    expect(result).toBe(
      `data:image/png;base64,${Buffer.from(bytes).toString("base64")}`,
    );
  });

  it("非 allowlist ホストは fetch せず AppError(og/bg-fetch-failed)", async () => {
    await expect(
      fetchAsDataUri("https://attacker.example.com/a.jpg"),
    ).rejects.toMatchObject({
      code: "og/bg-fetch-failed",
    });
    // SSRF 防御の本丸: そもそも fetch を発行しない
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("HTTP (非 HTTPS) は fetch せず AppError", async () => {
    await expect(
      fetchAsDataUri("http://firebasestorage.googleapis.com/x"),
    ).rejects.toMatchObject({
      code: "og/bg-fetch-failed",
    });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("status 404 → AppError(og/bg-fetch-failed)", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response("nope", { status: 404 }),
    );
    await expect(fetchAsDataUri(ALLOWED_URL)).rejects.toMatchObject({
      code: "og/bg-fetch-failed",
    });
  });

  it("Content-Length が上限を超えると AppError（ボディ read せず early reject）", async () => {
    const response = new Response(new Uint8Array([1]), {
      status: 200,
      headers: {
        "content-type": "image/jpeg",
        "content-length": String(10 * 1024 * 1024), // 10MB
      },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);
    await expect(fetchAsDataUri(ALLOWED_URL)).rejects.toMatchObject({
      code: "og/bg-fetch-failed",
    });
  });

  it("Content-Type が image/* 以外なら AppError（octet-stream / text 等を拒否）", async () => {
    const response = new Response(new Uint8Array([1, 2, 3]), {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);
    await expect(fetchAsDataUri(ALLOWED_URL)).rejects.toMatchObject({
      code: "og/bg-fetch-failed",
    });
  });

  it("Content-Type の charset 等のパラメータは無視して mime 判定", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const response = new Response(bytes, {
      status: 200,
      headers: { "content-type": "image/jpeg; charset=binary" },
    });
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(response);
    const result = await fetchAsDataUri(ALLOWED_URL);
    expect(result.startsWith("data:image/jpeg;base64,")).toBe(true);
  });

  it("fetch が reject すれば AppError でラップして throw（規約準拠）", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down"),
    );
    const promise = fetchAsDataUri(ALLOWED_URL);
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({
      code: "og/bg-fetch-failed",
    });
  });
});
