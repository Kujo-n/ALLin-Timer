import { AppError } from "@/lib/errors";

/**
 * Phase A.2 (05-post-launch-polish Track A): 公開 URL の画像を base64 data URI に変換する純関数。
 *
 * Satori は `<img src="...">` で**外部 URL を fetch しない**仕様のため、OG route 側で
 * 事前に fetch + base64 化して `data:image/...;base64,...` 形式で渡す必要がある。
 *
 * SSRF 防御:
 *   - 受け取れるのは `https://` の Firebase Storage download URL のみ。
 *   - スキーマ（`og-payload.ts`）でも同じ host allowlist を強制し二重防御とする。
 *   - 内部メタデータエンドポイント / 任意ホストへの fetch 経路を成立させない。
 *
 * リソース防御:
 *   - `AbortSignal.timeout(FETCH_TIMEOUT_MS)` でハングを防ぐ。
 *   - `Content-Length` と読込後 `byteLength` の両方で `MAX_BYTES` を強制（chunked / 偽装対応）。
 *   - Content-Type は jpeg/png/webp のみ許容（octet-stream / text 混入を拒否）。
 *
 * 失敗時は `AppError("og/bg-fetch-failed")` を throw する。OG route 側は本関数を `try/catch` で
 * 包み、失敗時はグラデ fallback で 200 を返す責務とする（PNG 生成自体は止めない）。
 */

/**
 * 背景画像 URL のホスト allowlist。
 * Firebase Storage の download URL は `firebasestorage.googleapis.com` 形式が現行（v0 API）、
 * `storage.googleapis.com` 形式が新形式（GCS 直）。同一バケットに対する両形式を受容する。
 */
const BG_IMAGE_URL_HOST_ALLOWLIST: ReadonlySet<string> = new Set([
  "firebasestorage.googleapis.com",
  "storage.googleapis.com",
]);

const ALLOWED_CONTENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

/** fetch のタイムアウト。Vercel サーバーレス関数の最大実行時間（60s）を大きく下回る値。 */
const FETCH_TIMEOUT_MS = 8_000;
/** 取得可能なボディサイズ上限。Storage rules の 1MB に対し 2× の安全幅。 */
const MAX_BYTES = 2 * 1024 * 1024;

/**
 * URL がスキーマと host allowlist の両方をパスするか検証する純関数。
 * `og-payload.ts` の zod refine と同一ロジックを共有するため export する。
 */
export function isAllowedBgImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  return BG_IMAGE_URL_HOST_ALLOWLIST.has(parsed.hostname);
}

export async function fetchAsDataUri(
  url: string,
  signal?: AbortSignal,
): Promise<string> {
  // 二重防御: zod schema 側でも reject されるが、helper 単体テスト・将来の callsite 増加に
  // 備えて helper でも host allowlist を強制する。
  if (!isAllowedBgImageUrl(url)) {
    throw new AppError(
      "背景画像 URL のホストが許可されていません",
      "og/bg-fetch-failed",
    );
  }

  const timeoutSignal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  const mergedSignal: AbortSignal = signal
    ? AbortSignal.any([signal, timeoutSignal])
    : timeoutSignal;

  let res: Response;
  try {
    res = await fetch(url, { signal: mergedSignal });
  } catch (e) {
    // network down / DNS failure / timeout 等は AppError で正規化する
    // （[error-logging.md](../../../../.claude/rules/error-logging.md) の AppError ラップ規約）。
    throw AppError.from(e, "og/bg-fetch-failed", "背景画像の取得に失敗しました");
  }
  if (!res.ok) {
    throw new AppError(
      `背景画像の取得に失敗しました (status=${res.status})`,
      "og/bg-fetch-failed",
    );
  }

  // Content-Length ヘッダによる early reject（ボディを全 read する前に弾く）。
  const contentLength = Number(res.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_BYTES) {
    throw new AppError(
      "背景画像のサイズが上限を超えています",
      "og/bg-fetch-failed",
    );
  }

  // Content-Type ホワイトリスト検証（octet-stream / text 等を拒否）。
  const rawContentType = res.headers.get("content-type") ?? "";
  const contentType = rawContentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
    throw new AppError(
      "背景画像のコンテンツタイプが許可されていません",
      "og/bg-fetch-failed",
    );
  }

  let buf: ArrayBuffer;
  try {
    buf = await res.arrayBuffer();
  } catch (e) {
    throw AppError.from(e, "og/bg-fetch-failed", "背景画像の取得に失敗しました");
  }
  if (buf.byteLength > MAX_BYTES) {
    throw new AppError(
      "背景画像のサイズが上限を超えています",
      "og/bg-fetch-failed",
    );
  }

  const base64 = Buffer.from(buf).toString("base64");
  return `data:${contentType};base64,${base64}`;
}

/**
 * Phase A architect-refactor (T4): OG route 双方の bgImage 取得 boilerplate を集約する純関数。
 *
 * `url` が null/undefined のときは即 `null` を返し、非 null のときは `fetchAsDataUri` を呼んで
 * 失敗時には `onError(e)` を呼んだ上で `null` を返す（200 を返す OG route の契約を維持するため
 * grad fallback に倒す）。`onError` 内で logger.warn を呼ぶことを想定する。
 *
 * 観測可能な動作は `bgDataUri = url ? await fetchAsDataUri(url).catch((e) => { onError(e); return null; }) : null`
 * と同値。
 */
export async function prepareBgDataUri(opts: {
  url: string | null | undefined;
  onError: (e: unknown) => void;
}): Promise<string | null> {
  if (opts.url == null) return null;
  try {
    return await fetchAsDataUri(opts.url);
  } catch (e) {
    opts.onError(e);
    return null;
  }
}
