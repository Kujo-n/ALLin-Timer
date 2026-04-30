/**
 * TimerControls 内部の sub-components で共有する型。
 * Phase 4 architect-refactor (P5-3) で TimerControls.tsx を 4 子 component に
 * 分割した際に切り出した。
 */

/** TimerControls の `run()` ヘルパーが識別する操作種別。 */
export type TimerOp =
  | "commit-seating"
  | "confirm-seating"
  | "self-join"
  | "pause"
  | "resume"
  | "advance"
  | "revert"
  | "finish";

/**
 * TimerControls の `run()` ヘルパー実体。busy state の管理 + AppError ラップを
 * 1 か所に集約する。各 sub-component は `op` / 実処理 / エラーメッセージを渡す。
 */
export type RunOp = (
  op: TimerOp,
  fn: () => Promise<void>,
  errMsg: string,
) => Promise<void>;
