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
