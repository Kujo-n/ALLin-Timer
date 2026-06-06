import { AppError } from "@/lib/errors";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { isFinished, isInProgress } from "@/lib/services/tournament-state";

/**
 * 受付フロー（通常受付 `receipt.ts` / 運営者代理 `proxy-receipt.ts` の両方）で共有する
 * 入力ガード。
 *
 * 以前は receipt.ts と proxy-receipt.ts が同一ロジックを各々 private に複製していたため、
 * late-entry 締切判定や displayName 検証の semantics が片方だけ変わると静かに drift する
 * 危険があった。両経路の真実源をここに集約する。`tournament-state.ts` は「state のみを
 * 扱う（late entry deadline は service 側）」方針のため、deadline を絡める本ガードは
 * そちらではなく本モジュールに置く。
 */

/**
 * 受付を受け付けられる state か検証する。
 *   - finished なら `tournament/late-entry-closed`。
 *   - 開催中（running/paused）で late entry 締切超過なら `tournament/late-entry-closed`
 *     （締切超過 player は自動配席されず /live で「締切超過」表示になるため事前に防ぐ）。
 *
 * Phase 4: late entry 締切超過は rules では弾かず client / service 側で警告する方針。
 */
export function assertAcceptingEntries(t: TournamentDoc): void {
  if (isFinished(t)) {
    throw new AppError("このトーナメントは終了しています", "tournament/late-entry-closed");
  }
  if (isInProgress(t) && t.currentLevel > t.lateEntryDeadlineLevel) {
    throw new AppError(
      `レイトエントリー締切（Lv ${t.lateEntryDeadlineLevel}）を超過しています`,
      "tournament/late-entry-closed",
    );
  }
}

/**
 * displayName を trim + min(1)（+ 任意の maxLength）で検証する。
 *   - 空 / whitespace-only → `validation/display-name-required`
 *   - `opts.maxLength` 指定時、超過 → `validation/display-name-too-long`
 *
 * rule では player displayName の size を強制していない（self/clone も未強制）ため、
 * 上限を強制したい経路（運営者代理）は `maxLength` を渡すこと。通常受付は form 層の
 * `joinInputSchema` が上限を担保するため省略する。
 */
export function parseDisplayName(
  name: string | null | undefined,
  opts: { maxLength?: number } = {},
): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
  if (opts.maxLength !== undefined && trimmed.length > opts.maxLength) {
    throw new AppError(
      `表示名は ${opts.maxLength} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  return trimmed;
}
