/**
 * Phase A.2 (05-post-launch-polish Track A): 指数 backoff 付きの単純な retry helper。
 *
 * 旧 asset の確実削除（`card-background` service）専用に導入する。
 * 「最終失敗を握りつぶす（throw しない）」モードで、最終失敗時には
 * `onFinalFailure` callback でログを残すだけに留め、メイン flow（pointer 更新）を
 * 止めない設計とする。
 *
 * YAGNI: ここでは generic 化せず、`() => Promise<void>` のみを受け取る。
 */
export interface RetryOptions {
  /** 試行回数（1 回目を含む）。1 以上。 */
  attempts: number;
  /**
   * 各「試行と次の試行の間」に挟む sleep ms。長さは `attempts - 1` を想定するが、
   * 不足要素は `?? 0` で補完するため、`backoffMs[i] ?? 0` で安全に参照できる。
   */
  backoffMs: readonly number[];
  /**
   * `attempts` 回すべて失敗したときの callback。throw せず warn ログを残す等の
   * post-failure 処理を呼び出し側で記述する用途。
   */
  onFinalFailure?: (error: unknown) => void;
  /** AbortSignal でキャンセル可能（試行前にチェック）。 */
  signal?: AbortSignal;
}

/**
 * `fn` を最大 `attempts` 回試行する。各試行間に `backoffMs[i]` ms の sleep。
 * 成功すれば即 return。`attempts` 回すべて失敗したら `onFinalFailure` を呼び return（throw しない）。
 *
 * 呼出側が「失敗してもメイン flow を続けたい」ケース専用。エラーを呼出側で受けたいなら
 * 標準の try/catch を使うこと。
 */
export async function deleteWithRetry(
  fn: () => Promise<void>,
  opts: RetryOptions,
): Promise<void> {
  let lastError: unknown = null;
  for (let i = 0; i < opts.attempts; i++) {
    if (opts.signal?.aborted) return;
    try {
      await fn();
      return;
    } catch (e) {
      lastError = e;
      if (i < opts.attempts - 1) {
        const delay = opts.backoffMs[i] ?? 0;
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  opts.onFinalFailure?.(lastError);
}
