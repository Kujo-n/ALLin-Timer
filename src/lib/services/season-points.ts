import {
  SEASON_FINAL_TABLE_THRESHOLD,
  SEASON_POINTS_BASE,
  SEASON_POINTS_BASELINE_PARTICIPANTS,
} from "@/lib/limits";

/**
 * Phase A: 順位と参加人数からシーズンポイントを算出する純関数。
 *
 * 式: `base[rank-1] × sqrt(totalParticipants / SEASON_POINTS_BASELINE_PARTICIPANTS)`
 *
 *  - `rank` は 1-based。`SEASON_POINTS_BASE.length` を超える順位は 0pt。
 *  - 不正値（非整数 / 1 未満 / 参加 0 人）は防衛的に 0 を返す。
 *  - 戻り値は小数 2 桁で四捨五入。毎回 2 桁に正規化することで累積加算時の浮動小数点
 *    誤差を抑制する（`8.66 + 8.66 + ...` を 1000 回繰り返しても `8660.00` 安定）。
 */
export function calcSeasonPoints(rank: number, totalParticipants: number): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  if (!Number.isInteger(totalParticipants) || totalParticipants < 1) return 0;
  if (rank > SEASON_POINTS_BASE.length) return 0;
  const base = SEASON_POINTS_BASE[rank - 1];
  const factor = Math.sqrt(totalParticipants / SEASON_POINTS_BASELINE_PARTICIPANTS);
  return Math.round(base * factor * 100) / 100;
}

/**
 * Phase A: 順位がファイナルテーブル（FT）内かを判定する pure helper。
 * FT 閾値は `SEASON_FINAL_TABLE_THRESHOLD`（NLH 9 人卓基準）。
 */
export function isFinalTable(rank: number): boolean {
  return (
    Number.isInteger(rank) && rank >= 1 && rank <= SEASON_FINAL_TABLE_THRESHOLD
  );
}
