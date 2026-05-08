import {
  SEASON_FINAL_TABLE_THRESHOLD,
  SEASON_POINTS_BASE,
  SEASON_POINTS_BASELINE_PARTICIPANTS,
} from "@/lib/limits";

/**
 * Phase E: シーズンポイント計算ルール。`base[rank-1]` の素点と「係数 1.0 になる参加人数」の
 * 2 パラメータで構成する。式の構造（順位 × 平方根スケール）は Phase A と同一で、運営者は
 * パラメータ単位でカスタマイズできる。
 */
export interface SeasonPointsRule {
  /** 1 位から N 位までの素点。長さ 1〜SEASON_POINTS_BASE_MAX_LENGTH (= 9)。 */
  base: number[];
  /** 係数 1.0 になる参加人数。値域 MIN_SEATS_PER_TABLE..MAX_SEATS_PER_TABLE (= 2..10)。 */
  baseline: number;
}

/**
 * Phase E: カスタム rule 不在時の既定値。Phase A 互換挙動。
 *
 * `base` は spread コピーで `readonly number[]` を可変 `number[]` に変換。
 * `DEFAULT_SEASON_POINTS_RULE.base` をそのまま `SEASON_POINTS_BASE` 参照にすると、
 * 消費側で `readonly` が漏れて型不整合になる。
 */
export const DEFAULT_SEASON_POINTS_RULE: SeasonPointsRule = {
  base: [...SEASON_POINTS_BASE],
  baseline: SEASON_POINTS_BASELINE_PARTICIPANTS,
};

/**
 * Phase A: 順位と参加人数からシーズンポイントを算出する純関数。
 *
 * 式: `base[rank-1] × sqrt(totalParticipants / baseline)`
 *
 *  - `rank` は 1-based。`rule.base.length` を超える順位は 0pt。
 *  - 不正値（非整数 / 1 未満 / 参加 0 人）は防衛的に 0 を返す。
 *  - 戻り値は小数 2 桁で四捨五入。毎回 2 桁に正規化することで累積加算時の浮動小数点
 *    誤差を抑制する（`8.66 + 8.66 + ...` を 1000 回繰り返しても `8660.00` 安定）。
 *
 * Phase E: 第 3 引数 `rule` を追加し、運営者カスタムルールを受け付ける。引数省略時は
 *   `DEFAULT_SEASON_POINTS_RULE`（Phase A 互換）が使われ、既存の callsite はそのまま動く。
 */
export function calcSeasonPoints(
  rank: number,
  totalParticipants: number,
  rule: SeasonPointsRule = DEFAULT_SEASON_POINTS_RULE,
): number {
  if (!Number.isInteger(rank) || rank < 1) return 0;
  if (!Number.isInteger(totalParticipants) || totalParticipants < 1) return 0;
  if (rank > rule.base.length) return 0;
  const base = rule.base[rank - 1];
  const factor = Math.sqrt(totalParticipants / rule.baseline);
  return Math.round(base * factor * 100) / 100;
}

/**
 * Phase A: 順位がファイナルテーブル（FT）内かを判定する pure helper。
 * FT 閾値は `SEASON_FINAL_TABLE_THRESHOLD`（NLH 9 人卓基準）。
 *
 * Phase E: `seasonPointsRule.base.length` がカスタムで 9 未満になっても、FT 判定の閾値は
 *   据え置きのまま（FT は「上位 9 人入賞」の概念で、ポイント計算 base の長さと独立）。
 */
export function isFinalTable(rank: number): boolean {
  return (
    Number.isInteger(rank) && rank >= 1 && rank <= SEASON_FINAL_TABLE_THRESHOLD
  );
}
