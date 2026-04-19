/**
 * URL クエリ経由で受け取った redirect パスが安全かを検証する。
 * `/` で始まる同一オリジン内パスのみ許可し、オープンリダイレクトを防ぐ:
 *  - `//` / `/\` / `http(s):` など外部遷移になるプレフィックスを拒否
 *  - `%2F%2F` のようなパーセントエンコード経由の外部遷移も弾く
 *  - decodeURIComponent に失敗する入力は fallback
 */
export function sanitizeRedirect(
  raw: string | null | undefined,
  fallback = "/tournaments",
): string {
  if (!raw) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith("/")) return fallback;
  if (decoded.startsWith("//")) return fallback;
  if (decoded.startsWith("/\\")) return fallback;
  return decoded;
}
