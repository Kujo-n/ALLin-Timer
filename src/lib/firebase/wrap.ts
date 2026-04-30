import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Firestore mutation / read 操作を一律にラップして、エラーを `AppError` に正規化し
 * `logger.warn` に warn 行を 1 本記録するための helper。
 *
 * Phase 4 architect-refactor (P3-1) で導入し、`repositories/*.ts` に 30+ 箇所
 * 反復していた以下のボイラープレートを集約する:
 *
 * ```
 * try {
 *   await updateDoc(...);
 *   logger.info("...", {...});      // ← 成功ログは wrap の外に置く
 * } catch (e) {
 *   const wrapped = AppError.from(e, "firestore/write_failed", "...");
 *   logger.warn(wrapped.message, { code: wrapped.code, ...meta });
 *   throw wrapped;
 * }
 * ```
 *
 * 移行後の使い方:
 *
 * ```
 * await wrapFirestoreWrite("firestore/write_failed", "...", async () => {
 *   await updateDoc(...);
 * }, { gid });
 * logger.info("...ok", {...});
 * ```
 *
 * `wrapFirestoreWrite` / `wrapFirestoreRead` は意味的に区別された別名で同一実装。
 * 呼出側で「これは write か read か」を読み手に明示する目的で 2 つ用意している。
 */
async function wrap<T>(
  code: string,
  message: string,
  op: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  try {
    return await op();
  } catch (e) {
    const wrapped = AppError.from(e, code, message);
    logger.warn(wrapped.message, { code: wrapped.code, ...meta });
    throw wrapped;
  }
}

/** Firestore write 操作（addDoc / setDoc / updateDoc / deleteDoc / runTransaction）用。 */
export function wrapFirestoreWrite<T>(
  code: string,
  message: string,
  op: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  return wrap(code, message, op, meta);
}

/** Firestore read 操作（getDoc / getDocs / 同期 fetch）用。 */
export function wrapFirestoreRead<T>(
  code: string,
  message: string,
  op: () => Promise<T>,
  meta?: Record<string, unknown>,
): Promise<T> {
  return wrap(code, message, op, meta);
}
