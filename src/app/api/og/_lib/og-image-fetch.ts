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
 *
 * ⚠ host 単独では不十分: 両ホストとも **GCS 全体で共有されるマルチテナントホスト**であり、
 *   `https://storage.googleapis.com/<任意の公開バケット>/<obj>` が同じ host に解決する。
 *   host だけを検査すると、未認証の OG route が「世界中の公開 GCS オブジェクトを
 *   取得して PNG に埋め込む汎用画像プロキシ」として第三者に利用できてしまう
 *   （内部ネットワークへの SSRF ではないが、最小権限の原則からの逸脱 + Vercel 帯域の流用）。
 *   そのため `isAllowedBgImageUrl` は host に加えて **バケット一致**も検査する。
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
 * 期待するバケット名（= このプロジェクトの Firebase Storage バケット）。
 *
 * `NEXT_PUBLIC_*` は build 時にインライン化されるため、client / server の双方から参照できる。
 * **未設定なら `null` を返し、呼出側は host-only 判定にフォールバックする**
 * （emulator / CI / 単体テストなど bucket を持たない環境の非回帰のため）。
 */
function expectedStorageBucket(): string | null {
  const trimmed = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET?.trim();
  return trimmed ? trimmed : null;
}

/**
 * allowlist 済み host の URL から bucket セグメントを取り出す純関数。合致しなければ `null`。
 *
 *   - `firebasestorage.googleapis.com` → `/v0/b/<bucket>/o/<path>`（Firebase download URL）
 *   - `storage.googleapis.com`         → `/<bucket>/<path>`（GCS path-style）
 *
 * 上記以外の path 形（GCS JSON API の `/download/storage/v1/b/<bucket>/o/` 等）は
 * アプリが生成しないため **意図的に非対応**とし、`null`（= deny 側）に倒す。
 * virtual-hosted style（`https://<bucket>.storage.googleapis.com/...`）は hostname が
 * allowlist と一致しないため、本関数に到達する前に弾かれる。
 */
function extractBucket(parsed: URL): string | null {
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (parsed.hostname === "firebasestorage.googleapis.com") {
    // ["v0", "b", "<bucket>", "o", ...]
    if (segments.length >= 3 && segments[0] === "v0" && segments[1] === "b") {
      return decodeURIComponent(segments[2]);
    }
    return null;
  }
  // storage.googleapis.com（path-style）: 先頭セグメントが bucket。
  return segments.length >= 1 ? decodeURIComponent(segments[0]) : null;
}

/**
 * URL がスキーマ・host allowlist・バケット一致のすべてをパスするか検証する純関数。
 * `og-payload.ts` の zod refine と同一ロジックを共有するため export する。
 *
 * バケット検査は `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET` が設定されている環境でのみ有効。
 * 未設定時は従来どおり host のみで判定する（フォールバック）。
 */
export function isAllowedBgImageUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "https:") return false;
  if (!BG_IMAGE_URL_HOST_ALLOWLIST.has(parsed.hostname)) return false;
  const expected = expectedStorageBucket();
  if (expected === null) return true;
  return extractBucket(parsed) === expected;
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
