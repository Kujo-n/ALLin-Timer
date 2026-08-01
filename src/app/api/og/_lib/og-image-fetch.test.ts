import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

import {
  fetchAsDataUri,
  isAllowedBgImageUrl,
  prepareBgDataUri,
} from "./og-image-fetch";

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

/**
 * architect-refactor 20260801 (finding-2): host allowlist だけでは
 * `storage.googleapis.com` / `firebasestorage.googleapis.com` が GCS 全体で共有される
 * マルチテナントホストのため、任意の公開バケットが通ってしまう。
 * `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` 設定時はバケット一致まで検査する。
 */
describe("isAllowedBgImageUrl — バケット限定（NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET 設定時）", () => {
  const BUCKET = "allin-pokertimer.appspot.com";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", BUCKET);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("自バケットの Firebase download URL 形式は許可", () => {
    expect(
      isAllowedBgImageUrl(
        `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/groups%2Fg1%2FbgImages%2Fa.jpg?alt=media&token=xyz`,
      ),
    ).toBe(true);
  });

  it("自バケットの GCS path-style URL は許可", () => {
    expect(
      isAllowedBgImageUrl(`https://storage.googleapis.com/${BUCKET}/groups/g1/a.png`),
    ).toBe(true);
  });

  it("他バケットは両形式とも拒否（画像プロキシ化の防止）", () => {
    expect(
      isAllowedBgImageUrl(
        "https://firebasestorage.googleapis.com/v0/b/someone-else.appspot.com/o/x.jpg",
      ),
    ).toBe(false);
    expect(
      isAllowedBgImageUrl("https://storage.googleapis.com/someone-else-bucket/x.png"),
    ).toBe(false);
  });

  it("bucket セグメントを取り出せない path 形は拒否（GCS JSON API 形式など）", () => {
    expect(
      isAllowedBgImageUrl(
        `https://storage.googleapis.com/download/storage/v1/b/${BUCKET}/o/x?alt=media`,
      ),
    ).toBe(false);
    expect(isAllowedBgImageUrl("https://firebasestorage.googleapis.com/")).toBe(false);
    expect(isAllowedBgImageUrl("https://storage.googleapis.com/")).toBe(false);
  });

  it("host allowlist 外は bucket 名が一致していても拒否（host 検査が先）", () => {
    expect(isAllowedBgImageUrl(`https://attacker.example.com/${BUCKET}/x.jpg`)).toBe(
      false,
    );
  });
});

describe("isAllowedBgImageUrl — env 未設定時は host-only 判定にフォールバック", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET", "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("bucket が異なっても allowlist host なら許可（emulator / CI の非回帰）", () => {
    expect(isAllowedBgImageUrl("https://storage.googleapis.com/any-bucket/x.png")).toBe(
      true,
    );
    expect(
      isAllowedBgImageUrl("https://firebasestorage.googleapis.com/v0/b/any/o/x.jpg"),
    ).toBe(true);
  });

  it("host allowlist 外は引き続き拒否", () => {
    expect(isAllowedBgImageUrl("https://attacker.example.com/a.jpg")).toBe(false);
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

describe("prepareBgDataUri", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = ORIG_FETCH;
  });

  it("url が null のとき onError を呼ばず即 null を返す（fetch も発行しない）", async () => {
    const onError = vi.fn();
    const result = await prepareBgDataUri({ url: null, onError });
    expect(result).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("url が undefined のとき onError を呼ばず即 null を返す", async () => {
    const onError = vi.fn();
    const result = await prepareBgDataUri({ url: undefined, onError });
    expect(result).toBeNull();
    expect(onError).not.toHaveBeenCalled();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("有効 URL + 成功時 data URI を返し、onError は呼ばれない", async () => {
    const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue(
      new Response(bytes, {
        status: 200,
        headers: { "content-type": "image/png" },
      }),
    );
    const onError = vi.fn();
    const result = await prepareBgDataUri({ url: ALLOWED_URL, onError });
    expect(result).toMatch(/^data:image\/png;base64,/);
    expect(onError).not.toHaveBeenCalled();
  });

  it("fetch 失敗時は onError を 1 度呼び、null を返す（throw しない）", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("network down"),
    );
    const onError = vi.fn();
    const result = await prepareBgDataUri({ url: ALLOWED_URL, onError });
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    const passed = onError.mock.calls[0]?.[0];
    expect(passed).toBeInstanceOf(AppError);
    expect((passed as AppError).code).toBe("og/bg-fetch-failed");
  });

  it("非 allowlist host のときも onError を呼んで null（SSRF 防御の grad fallback）", async () => {
    const onError = vi.fn();
    const result = await prepareBgDataUri({
      url: "https://attacker.example.com/a.jpg",
      onError,
    });
    expect(result).toBeNull();
    expect(onError).toHaveBeenCalledTimes(1);
    // fetch は発行しない（SSRF 防御）
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
