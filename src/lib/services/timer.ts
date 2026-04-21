import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { Level } from "@/lib/firebase/schemas/structure";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

export interface LevelInfo {
  current: Level;
  next: Level | null;
  /** 0-based index into structureSnapshot.levels */
  levelIndex: number;
}

/**
 * 現在 level の info（current / next / index）。
 * - currentLevel は 1-based。setup（0）や最終 level 超過は null。
 */
export function getLevelInfo(tournament: TournamentDoc): LevelInfo | null {
  const idx = tournament.currentLevel - 1;
  const levels = tournament.structureSnapshot.levels;
  if (idx < 0 || idx >= levels.length) return null;
  return {
    current: levels[idx],
    next: levels[idx + 1] ?? null,
    levelIndex: idx,
  };
}

/**
 * 現在 level の残り時間（ms）。
 *  - state === "setup" / "seating": null（タイマー対象外）
 *  - state === "finished": 0
 *  - state === "paused": pausedAt 固定点での残り
 *  - state === "running":
 *      remaining = duration - (nowMs - levelStartedAt - pausedAccumMs)
 *  - levelStartedAt が null（pending-write）の場合は null
 *  - level info が取れない場合は null
 *
 * 戻り値は Math.max(0, ...) で 0 以上にクランプ。
 */
export function getRemainingMs(tournament: TournamentDoc, nowMs: number): number | null {
  const info = getLevelInfo(tournament);
  if (!info) return null;
  const durationMs = info.current.durationSec * 1000;

  if (tournament.state === "setup" || tournament.state === "seating") return null;
  if (tournament.state === "finished") return 0;

  if (tournament.levelStartedAt === null) return null;
  const startMs = tournament.levelStartedAt.toMillis();
  const accum = tournament.pausedAccumMs ?? 0;

  if (tournament.state === "paused") {
    if (tournament.pausedAt === null) return null;
    const pausedAtMs = tournament.pausedAt.toMillis();
    const elapsed = pausedAtMs - startMs - accum;
    return Math.max(0, durationMs - elapsed);
  }

  // running
  const elapsed = nowMs - startMs - accum;
  return Math.max(0, durationMs - elapsed);
}

/**
 * 残り 1 人（= 優勝確定）を判定する。
 *   - running / paused / finished のいずれかで、未バストが 1 人のみかつ総参加者 2 人以上
 *   - 上記条件を満たす場合、残った未バストプレイヤーを返す
 *   - 該当しない場合は null
 *
 * Phase 4.5: Winner バナー表示と auto-finish のトリガ条件に利用する。
 */
export function resolveWinner(
  tournament: TournamentDoc,
  players: readonly PlayerDoc[],
): PlayerDoc | null {
  const isRunningOrPaused = tournament.state === "running" || tournament.state === "paused";
  const isFinished = tournament.state === "finished";
  if (!isRunningOrPaused && !isFinished) return null;
  if (players.length < 2) return null;
  const active = players.filter((p) => !p.isBusted);
  if (active.length !== 1) return null;
  return active[0];
}

/**
 * auto-advance のトリガ判定（最初に残り 0 を観測したクライアントが
 * runTransaction で `currentLevel == expected` guard と共に書込を試みる）。
 */
export function shouldAutoAdvance(tournament: TournamentDoc, nowMs: number): boolean {
  if (tournament.state !== "running") return false;
  if (tournament.levelStartedAt === null) return false;
  const remaining = getRemainingMs(tournament, nowMs);
  if (remaining === null) return false;
  if (remaining > 0) return false;
  return tournament.currentLevel < tournament.structureSnapshot.levels.length;
}
