import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import {
  applyOgImageResponseHeaders,
  OG_IMAGE_CACHE_CONTROL,
  respondWithOgRenderError,
} from "./og-response";

describe("applyOgImageResponseHeaders", () => {
  it("filenameStem を付与した content-disposition と固定 cache-control を set する", () => {
    const response = new Response();
    applyOgImageResponseHeaders(response, { filenameStem: "winner-Tournament-2026-05-12" });
    expect(response.headers.get("cache-control")).toBe(OG_IMAGE_CACHE_CONTROL);
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="winner-Tournament-2026-05-12.png"`,
    );
  });

  it("OG_IMAGE_CACHE_CONTROL は public + max-age + s-maxage + stale-while-revalidate を含む", () => {
    expect(OG_IMAGE_CACHE_CONTROL).toContain("public");
    expect(OG_IMAGE_CACHE_CONTROL).toContain("max-age=300");
    expect(OG_IMAGE_CACHE_CONTROL).toContain("s-maxage=86400");
    expect(OG_IMAGE_CACHE_CONTROL).toContain("stale-while-revalidate=604800");
  });
});

describe("respondWithOgRenderError", () => {
  it("生 Error を og/render-failed AppError に wrap して status 500 JSON を返す", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = respondWithOgRenderError(new Error("boom"), {
      logTag: "og winner render failed",
      ctx: { tid: "t1" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("og/render-failed");
    expect(body.message).toBe("結果カードの生成に失敗しました");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const [tag, meta] = warnSpy.mock.calls[0] ?? [];
    expect(tag).toBe("og winner render failed");
    expect(meta).toMatchObject({ tid: "t1", code: "og/render-failed" });
    warnSpy.mockRestore();
  });

  it("既存 AppError は AppError.from idempotency で code を保持する", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const orig = new AppError("background fetch died", "og/bg-fetch-failed");
    const res = respondWithOgRenderError(orig, {
      logTag: "og season render failed",
      ctx: { gid: "g1" },
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { code: string; message: string };
    // AppError.from の idempotency により内側 AppError の code が透過される
    expect(body.code).toBe("og/bg-fetch-failed");
    expect(body.message).toBe("background fetch died");
    expect(warnSpy).toHaveBeenCalledWith(
      "og season render failed",
      expect.objectContaining({
        gid: "g1",
        code: "og/bg-fetch-failed",
        origCode: "og/bg-fetch-failed",
      }),
    );
    warnSpy.mockRestore();
  });

  it("ctx 省略時も問題なく動作する", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const res = respondWithOgRenderError(new Error("x"), { logTag: "tag" });
    expect(res.status).toBe(500);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});
