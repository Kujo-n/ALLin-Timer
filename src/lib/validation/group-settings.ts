import { AppError } from "@/lib/errors";
import {
  MAX_SEATS_PER_TABLE,
  MAX_TABLES,
  MIN_SEATS_PER_TABLE,
  SEASON_POINTS_BASE_MAX_LENGTH,
  TABLE_LABEL_MAX_LENGTH,
} from "@/lib/limits";
import type { SeasonPointsRule } from "@/lib/services/season-points";

/**
 * `groups/{gid}` の設定フィールドに対する値域バリデーションの単一真実源。
 *
 * architect-refactor 20260801 (finding-4) で導入。それ以前は
 * `services/group.ts`（service 層）と `repositories/groups.ts`（repository 層）が
 * **同一の条件式・同一の AppError code・同一の日本語メッセージ**を各々ベタ書きしており、
 * 4 組・約 120 行が逐語的に重複していた。
 *
 * ## なぜ「二重防御をやめる」のではなく「同じ関数を 2 回呼ぶ」のか
 *
 * service 層と repository 層で 2 回検証する設計自体は意図的な多層防御であり維持する
 * （repository は service を経由しない将来の callsite からも守られる必要がある）。
 * ただし **同一の検証コードを 2 回「書く」ことは多層防御の要件ではない**。
 * 共有の純関数を両層から呼べば、防御の層数はそのままに drift リスクだけが消える。
 *
 * ## `parse*` と `assert*` の使い分け
 *
 * | helper | 呼出層 | 役割 |
 * | --- | --- | --- |
 * | `parse*` | service | 正規化（trim / 丸め）を伴う検証。**正規化済みの値を返す** |
 * | `assert*` | repository | 検証のみ。既に正規化済みの値が渡る前提で `void` を返す |
 *
 * service が `parse*` で正規化した値を repository に渡し、repository が `assert*` で
 * 再検証する——という現行のデータフロー（非対称）をそのまま保つための分離。
 * 正規化が不要なフィールド（数値単体）は `assert*` のみを提供する。
 *
 * AppError の code / message は移設元の文字列を 1 文字も変えずに引き継ぐ
 * （UI が `formatErrorForDisplay` で `code: message` を表示するため観測可能）。
 */

/* -------------------------------------------------------------------------- */
/* finishedTournamentCount                                                     */
/* -------------------------------------------------------------------------- */

/** 開催数（`finishedTournamentCount`）: 0 以上の整数。 */
export function assertFinishedCount(value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      "開催数は 0 以上の整数で指定してください",
      "validation/finished-count-invalid",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* defaultSeatsPerTable                                                        */
/* -------------------------------------------------------------------------- */

/** デフォルト席数（`defaultSeatsPerTable`）: MIN..MAX_SEATS_PER_TABLE の整数。 */
export function assertDefaultSeats(value: number): void {
  if (
    !Number.isInteger(value) ||
    value < MIN_SEATS_PER_TABLE ||
    value > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/default-seats-invalid",
    );
  }
}

/* -------------------------------------------------------------------------- */
/* defaultTableLabels / defaultTableColors                                     */
/* -------------------------------------------------------------------------- */

/** `#RRGGBB` 形式の hex カラー。rule 側の `color.matches('^#[0-9a-fA-F]{6}$')` と同形。 */
const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;

/**
 * labels / colors 配列の「構造」を検査する共通部分。
 * 各要素の値域検査は呼出側（`parse*` は trim 後 / `assert*` は素の値）で行う。
 */
function assertTableSettingsShape(labels: unknown, colors: unknown): void {
  if (!Array.isArray(labels)) {
    throw new AppError(
      "Table 名デフォルトは配列で指定してください",
      "validation/default-table-labels-invalid",
    );
  }
  if (labels.length > MAX_TABLES) {
    throw new AppError(
      `Table 名デフォルトは最大 ${MAX_TABLES} 件までです`,
      "validation/default-table-labels-invalid",
    );
  }
  if (!Array.isArray(colors) || colors.length !== labels.length) {
    throw new AppError(
      "Table 色デフォルトは Table 名デフォルトと同じ要素数で指定してください",
      "validation/default-table-colors-invalid",
    );
  }
}

/**
 * service 層向け: Table 名 / 色デフォルトを検証しつつ **正規化済みの値を返す**。
 *
 *   - labels: 各要素を `trim()` し、1〜TABLE_LABEL_MAX_LENGTH 文字であることを検査
 *   - colors: `null` / `undefined` / 空文字は `null` に畳み、それ以外は `#RRGGBB` を検査
 *
 * 重複検査は行わない（同名運用を許容する運用判断）。
 */
export function parseDefaultTableSettings(
  labels: string[],
  colors: (string | null)[],
): { labels: string[]; colors: (string | null)[] } {
  assertTableSettingsShape(labels, colors);
  const normalizedLabels: string[] = [];
  for (const label of labels) {
    if (typeof label !== "string") {
      throw new AppError(
        "Table 名デフォルトは文字列の配列で指定してください",
        "validation/default-table-labels-invalid",
      );
    }
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > TABLE_LABEL_MAX_LENGTH) {
      throw new AppError(
        `Table 名は 1 文字以上 ${TABLE_LABEL_MAX_LENGTH} 文字以下で指定してください`,
        "validation/default-table-labels-invalid",
      );
    }
    normalizedLabels.push(trimmed);
  }
  const normalizedColors: (string | null)[] = colors.map((c) => {
    if (c === null || c === undefined) return null;
    if (typeof c !== "string") {
      throw new AppError(
        "Table 色は文字列または null で指定してください",
        "validation/default-table-colors-invalid",
      );
    }
    const trimmed = c.trim();
    if (trimmed.length === 0) return null;
    if (!HEX_COLOR_RE.test(trimmed)) {
      throw new AppError(
        "Table 色は #RRGGBB 形式で指定してください",
        "validation/default-table-colors-invalid",
      );
    }
    return trimmed;
  });
  return { labels: normalizedLabels, colors: normalizedColors };
}

/**
 * repository 層向け: 既に正規化済みの Table 名 / 色デフォルトを再検証する。
 *
 * `parse*` と違い **trim しない**（正規化済みの値が渡る前提）。空文字を `null` に
 * 畳む処理も行わないため、色は `null` か `#RRGGBB` のいずれかでなければならない。
 */
export function assertDefaultTableSettings(
  labels: string[],
  colors: (string | null)[],
): void {
  assertTableSettingsShape(labels, colors);
  for (const label of labels) {
    if (typeof label !== "string") {
      throw new AppError(
        "Table 名デフォルトは文字列の配列で指定してください",
        "validation/default-table-labels-invalid",
      );
    }
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > TABLE_LABEL_MAX_LENGTH) {
      throw new AppError(
        `Table 名は 1 文字以上 ${TABLE_LABEL_MAX_LENGTH} 文字以下で指定してください`,
        "validation/default-table-labels-invalid",
      );
    }
  }
  for (const color of colors) {
    if (color !== null && (typeof color !== "string" || !HEX_COLOR_RE.test(color))) {
      throw new AppError(
        "Table 色は #RRGGBB 形式で指定してください",
        "validation/default-table-colors-invalid",
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* seasonPointsRule                                                            */
/* -------------------------------------------------------------------------- */

/** `base` 配列長の検査（`null` チェックは呼出側で済ませる）。 */
function assertSeasonPointsBaseLength(base: unknown): asserts base is number[] {
  if (
    !Array.isArray(base) ||
    base.length < 1 ||
    base.length > SEASON_POINTS_BASE_MAX_LENGTH
  ) {
    throw new AppError(
      `base 配列は 1 件以上 ${SEASON_POINTS_BASE_MAX_LENGTH} 件以下で指定してください`,
      "validation/season-points-rule-invalid",
    );
  }
}

function assertSeasonPointsBaseElement(v: unknown): asserts v is number {
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
    throw new AppError(
      "base 配列の各要素は 0 以上の数値で指定してください",
      "validation/season-points-rule-invalid",
    );
  }
}

function assertSeasonPointsBaseline(baseline: unknown): void {
  if (
    !Number.isInteger(baseline) ||
    (baseline as number) < MIN_SEATS_PER_TABLE ||
    (baseline as number) > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `baseline は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/season-points-rule-invalid",
    );
  }
}

/**
 * service 層向け: シーズンポイント計算ルールを検証しつつ **正規化済みの値を返す**。
 *
 * `base[i]` は `Math.round(v * 100) / 100` で 2 桁に丸める（UI から `8.659999…` の
 * ような浮動小数点誤差が混入したときの defensive な正規化。`calcSeasonPoints` の
 * 出力丸めと同方針）。`value === null`（既定値リセット）はそのまま `null` を返す。
 */
export function parseSeasonPointsRule(
  value: SeasonPointsRule | null,
): SeasonPointsRule | null {
  if (value === null) return null;
  assertSeasonPointsBaseLength(value.base);
  const safeBase: number[] = value.base.map((v) => {
    assertSeasonPointsBaseElement(v);
    return Math.round(v * 100) / 100;
  });
  assertSeasonPointsBaseline(value.baseline);
  return { base: safeBase, baseline: value.baseline };
}

/**
 * repository 層向け: 既に正規化済みのシーズンポイント計算ルールを再検証する。
 * `parse*` と違い丸めを行わない（正規化済みの値が渡る前提）。
 */
export function assertSeasonPointsRule(value: SeasonPointsRule | null): void {
  if (value === null) return;
  assertSeasonPointsBaseLength(value.base);
  for (const v of value.base) {
    assertSeasonPointsBaseElement(v);
  }
  assertSeasonPointsBaseline(value.baseline);
}
