import { NextResponse } from "next/server";

import { AppError, getErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Phase A architect-refactor (T4): OG image route の response header / error response の集約 helper。
 *
 * winner / season route で対称な以下のボイラープレートを集約する:
 *   - cache-control / content-disposition の header 設定
 *   - try/catch 末尾の `og/render-failed` wrap + logger.warn + 500 JSON return
 *
 * 観測可能な動作は元の inline 実装と同値（同じ header 文字列 / 同じ status code / 同じ
 * AppError code）。
 */

/**
 * 同一 query への再リクエストは決定的に同じ PNG を返すため CDN edge cache を効かせる。
 *
 * - max-age=300: ブラウザ cache 5 分
 * - s-maxage=86400: Vercel CDN edge cache 24 時間
 * - stale-while-revalidate=604800: 7 日間 background revalidate を許容
 */
export const OG_IMAGE_CACHE_CONTROL =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";

/**
 * `ImageResponse` の `headers` に cache-control と content-disposition を set する純粋副作用 helper。
 *
 * `filenameStem` は拡張子なし。`.png` を内部で付与し `attachment; filename="<stem>.png"` 形式にする。
 */
export function applyOgImageResponseHeaders(
  response: Response,
  opts: { filenameStem: string },
): void {
  response.headers.set("cache-control", OG_IMAGE_CACHE_CONTROL);
  response.headers.set(
    "content-disposition",
    `attachment; filename="${opts.filenameStem}.png"`,
  );
}

/**
 * OG render 中の例外を `og/render-failed` AppError でラップし、logger.warn + 500 JSON で
 * 一律に返す helper。
 *
 *   - 既に `AppError` の場合は `AppError.from` の idempotency で同一参照が保たれる
 *   - `logTag` は logger 出力の自由文（例: `"og winner render failed"`）
 *   - `ctx` は logger に追加で merge される識別子（tid / gid 等）
 */
export function respondWithOgRenderError(
  e: unknown,
  opts: {
    logTag: string;
    ctx?: Record<string, unknown>;
  },
): NextResponse {
  const wrapped = AppError.from(e, "og/render-failed", "結果カードの生成に失敗しました");
  logger.warn(opts.logTag, {
    ...(opts.ctx ?? {}),
    code: wrapped.code,
    origCode: getErrorCode(e),
  });
  return NextResponse.json(
    { code: wrapped.code, message: wrapped.message },
    { status: 500 },
  );
}
