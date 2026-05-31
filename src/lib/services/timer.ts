import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { Level } from "@/lib/firebase/schemas/structure";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import {
  isBeforeStart,
  isFinished,
  isInProgress,
  isPaused,
  isRunning,
} from "@/lib/services/tournament-state";

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
 *  - state === "finished": finishedAt 時点で固定（終了直前の残り時間で表示を止める）
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

  if (isBeforeStart(tournament)) return null;

  if (tournament.levelStartedAt === null) {
    return isFinished(tournament) ? 0 : null;
  }
  const startMs = tournament.levelStartedAt.toMillis();
  const accum = tournament.pausedAccumMs ?? 0;

  if (isFinished(tournament)) {
    if (tournament.finishedAt === null) return 0;
    const finishedAtMs = tournament.finishedAt.toMillis();
    const elapsed = finishedAtMs - startMs - accum;
    return Math.max(0, durationMs - elapsed);
  }

  if (isPaused(tournament)) {
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
  if (!isInProgress(tournament) && !isFinished(tournament)) return null;
  if (players.length < 2) return null;
  const active = players.filter((p) => !p.isBusted);
  if (active.length !== 1) return null;
  return active[0];
}

/**
 * Phase A: 全 player から最終順位を導出する純関数。
 *
 * 順位ルール:
 *   1. 未バスト（active）プレイヤーが先頭。`finishTournament` は通常 active が 1 人で
 *      呼ばれるが、防衛的に複数 active のときは `entryAt asc` で安定化する。
 *   2. バスト済みは `bustedAt` 降順（後にバストした人ほど上位）。
 *   3. 同 ms タイは `entryAt asc` → `id (= pid)` asc を tiebreak とする（決定論的）。
 *
 * 戻り値は 1-based rank の配列。`finishTournament` の seasonStats 増分や
 * 結果カードのランキング表示で再利用する。
 */
export function resolveRanking(
  players: readonly PlayerDoc[],
): Array<{
  pid: string;
  rank: number;
  uid: string | null;
  displayName: string;
}> {
  const sorted = [...players].sort((a, b) => {
    if (a.isBusted !== b.isBusted) return a.isBusted ? 1 : -1;
    if (!a.isBusted && !b.isBusted) {
      const ae = a.entryAt.toMillis();
      const be = b.entryAt.toMillis();
      if (ae !== be) return ae - be;
      return a.id.localeCompare(b.id);
    }
    const aBust = a.bustedAt?.toMillis() ?? 0;
    const bBust = b.bustedAt?.toMillis() ?? 0;
    if (aBust !== bBust) return bBust - aBust;
    const aEntry = a.entryAt.toMillis();
    const bEntry = b.entryAt.toMillis();
    if (aEntry !== bEntry) return aEntry - bEntry;
    return a.id.localeCompare(b.id);
  });
  return sorted.map((p, i) => ({
    pid: p.id,
    rank: i + 1,
    uid: p.uid,
    displayName: p.displayName,
  }));
}

/**
 * 次の break レベルまでの情報。
 *  - 現在 level が break のときは「現在 break 中」を意図して
 *    `levelsAhead === 0` / `etaMs === 残り時間` を返す。
 *  - 残り全 level に break が無ければ null。
 *  - setup / seating / finished では null（タイマー対象外）。
 *
 * 計算: 現在 level の残り時間 + 現在 level の次〜break 直前 level の durationSec の総和。
 */
interface NextBreakInfo {
  /** break レベル本体。 */
  level: Level;
  /** 現在 level（含まず）からの level 数。break level 自身が currentLevel のときは 0。 */
  levelsAhead: number;
  /** 現在からブレイク開始までの推定 ms。 */
  etaMs: number;
}

export function getNextBreakInfo(
  tournament: TournamentDoc,
  remainingMs: number | null,
): NextBreakInfo | null {
  if (isBeforeStart(tournament) || isFinished(tournament)) {
    return null;
  }
  const info = getLevelInfo(tournament);
  if (!info) return null;
  if (info.current.isBreak) {
    return {
      level: info.current,
      levelsAhead: 0,
      etaMs: Math.max(0, remainingMs ?? 0),
    };
  }
  const levels = tournament.structureSnapshot.levels;
  let acc = remainingMs ?? info.current.durationSec * 1000;
  for (let i = info.levelIndex + 1; i < levels.length; i += 1) {
    const lvl = levels[i];
    if (lvl.isBreak) {
      return {
        level: lvl,
        levelsAhead: i - info.levelIndex,
        etaMs: Math.max(0, acc),
      };
    }
    acc += lvl.durationSec * 1000;
  }
  return null;
}

/**
 * auto-advance のトリガ判定（最初に残り 0 を観測したクライアントが
 * runTransaction で `currentLevel == expected` guard と共に書込を試みる）。
 */
export function shouldAutoAdvance(tournament: TournamentDoc, nowMs: number): boolean {
  if (!isRunning(tournament)) return false;
  if (tournament.levelStartedAt === null) return false;
  const remaining = getRemainingMs(tournament, nowMs);
  if (remaining === null) return false;
  if (remaining > 0) return false;
  return tournament.currentLevel < tournament.structureSnapshot.levels.length;
}

/**
 * ブラインドアップ音をローカルで鳴らすべきか（要望④）。
 * 条件は shouldAutoAdvance と同一: running + levelStartedAt 確定 + 残り <= 0 + 次レベルあり。
 * 「auto-advance が妥当な瞬間 = レベル終了の瞬間」と意味的に一致させる。
 * 最終レベルの終了（次がない）は「ブラインドアップ」ではないため鳴らさない。
 *
 * shouldAutoAdvance と条件が同型だが、入力が異なる（nowMs vs remainingMs）。
 * hook 側は既に useTournamentTimer から remainingMs を持つため、ここでは remainingMs を引数に取る。
 */
export function shouldPlayLevelEndSound(
  tournament: TournamentDoc,
  remainingMs: number | null,
): boolean {
  if (!isRunning(tournament)) return false;
  if (tournament.levelStartedAt === null) return false;
  if (remainingMs === null) return false;
  if (remainingMs > 0) return false;
  return tournament.currentLevel < tournament.structureSnapshot.levels.length;
}

/**
 * auto-advance 時、新レベルの決定論的な開始時刻 ms（要望⑤・2秒飛び緩和）。
 * = 現レベルの理想終了時刻 = levelStartedAt + 現レベル durationMs + pausedAccumMs。
 * commit 時刻（serverTimestamp）で stamp すると往復遅延ぶん新レベルが飛ぶため、
 * 構造定義に固定したこの値を Timestamp.fromMillis で書く。
 */
export function computeAutoAdvanceLevelStartMs(tournament: TournamentDoc): number {
  const info = getLevelInfo(tournament);
  const durationMs = (info?.current.durationSec ?? 0) * 1000;
  const startMs = tournament.levelStartedAt?.toMillis() ?? 0;
  const accum = tournament.pausedAccumMs ?? 0;
  return startMs + durationMs + accum;
}
