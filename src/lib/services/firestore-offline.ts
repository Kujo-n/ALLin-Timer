/**
 * Firestore SDK が **一時通信障害（オフライン）由来**で throw する FirebaseError.code 一覧。
 *
 * runTransaction はオフラインで即時 reject されるが、catch 側で「オフライン由来か / それ以外（rule
 * 違反 / not-found / tx 内部 throw）か」を区別しないと updateDoc fallback で rule 違反を queue に
 * 隠してしまう。本配列は **fallback 対象**を明示的に列挙する allowlist。
 *
 * - `unavailable` — 通常のネットワーク到達不能（最頻）
 * - `cancelled` — タブ閉じ / ページ遷移時の中断
 * - `deadline-exceeded` — RTT タイムアウト（弱回線で観測される）
 * - `internal` — 一過性の SDK 内部エラー（オフライン直前に観測しうる）
 *
 * `permission-denied` / `not-found` / `failed-precondition` / `invalid-argument` /
 * `already-exists` / `aborted` は **オフライン由来ではない**ため含まない。これらは rule 違反 /
 * data mismatch / SDK 内部 retry を尽くした後の tx contention で、fallback すると不正書込 / 二重
 * advance を queue に隠す。`aborted` は SDK が runTransaction 内部で 5 回 retry 済みの surface
 * （= local cached view が古い可能性が高い）なので、stale な currentLevel を信じた fallback は
 * 行わない。
 */
export const OFFLINE_FIRESTORE_ERROR_CODES: readonly string[] = [
  "unavailable",
  "cancelled",
  "deadline-exceeded",
  "internal",
];

/**
 * `getErrorCode(e)` で取り出した文字列が、オフライン由来 fallback の対象か判定する。
 *
 * Firestore SDK の FirebaseError は `code: "firestore/unavailable"` ではなく
 * `code: "unavailable"` の素の形（`firestore` ドメイン prefix なし）で throw される。
 * 一方プロジェクト内 `AppError` は `firestore/...` prefix を付ける。本判定は **両形式を許容** する:
 *   - `unavailable`           → true（FirebaseError 直接）
 *   - `firestore/unavailable` → true（仮にどこかで AppError に wrap されていた場合の防御）
 *   - `firestore/permission-denied` → false
 *   - `unknown`               → false
 */
export function isOfflineFirestoreErrorCode(code: string): boolean {
  if (OFFLINE_FIRESTORE_ERROR_CODES.includes(code)) return true;
  const stripped = code.startsWith("firestore/") ? code.slice("firestore/".length) : null;
  return stripped !== null && OFFLINE_FIRESTORE_ERROR_CODES.includes(stripped);
}
