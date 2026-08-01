import { describe, expect, it } from "vitest";

import { AppError } from "@/lib/errors";
import {
  MAX_SEATS_PER_TABLE,
  MAX_TABLES,
  MIN_SEATS_PER_TABLE,
  SEASON_POINTS_BASE_MAX_LENGTH,
  TABLE_LABEL_MAX_LENGTH,
} from "@/lib/limits";

import {
  assertDefaultSeats,
  assertDefaultTableSettings,
  assertFinishedCount,
  assertSeasonPointsRule,
  parseDefaultTableSettings,
  parseSeasonPointsRule,
} from "./group-settings";

/**
 * architect-refactor 20260801 (finding-4) で service 層 / repository 層から抽出した
 * 共有 pure validator の直接テスト。
 *
 * 抽出前は同じ検証が両層にベタ書きされており、境界値の網羅は
 * `services/group.test.ts` と repository 側の間接テストに散っていた。
 * ここで境界値と AppError code を一箇所に固定する。
 */

/** AppError の code を取り出す小さな helper（throw されなければ失敗させる）。 */
function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    return (e as AppError).code;
  }
  throw new Error("expected to throw but did not");
}

describe("assertFinishedCount", () => {
  it("0 以上の整数を許可", () => {
    expect(() => assertFinishedCount(0)).not.toThrow();
    expect(() => assertFinishedCount(1)).not.toThrow();
    expect(() => assertFinishedCount(9999)).not.toThrow();
  });

  it("負値 / 小数 / NaN は validation/finished-count-invalid", () => {
    expect(codeOf(() => assertFinishedCount(-1))).toBe(
      "validation/finished-count-invalid",
    );
    expect(codeOf(() => assertFinishedCount(1.5))).toBe(
      "validation/finished-count-invalid",
    );
    expect(codeOf(() => assertFinishedCount(Number.NaN))).toBe(
      "validation/finished-count-invalid",
    );
  });
});

describe("assertDefaultSeats", () => {
  it("MIN..MAX の整数を許可（境界含む）", () => {
    expect(() => assertDefaultSeats(MIN_SEATS_PER_TABLE)).not.toThrow();
    expect(() => assertDefaultSeats(MAX_SEATS_PER_TABLE)).not.toThrow();
  });

  it("範囲外 / 小数は validation/default-seats-invalid", () => {
    expect(codeOf(() => assertDefaultSeats(MIN_SEATS_PER_TABLE - 1))).toBe(
      "validation/default-seats-invalid",
    );
    expect(codeOf(() => assertDefaultSeats(MAX_SEATS_PER_TABLE + 1))).toBe(
      "validation/default-seats-invalid",
    );
    expect(codeOf(() => assertDefaultSeats(8.5))).toBe(
      "validation/default-seats-invalid",
    );
  });
});

describe("parseDefaultTableSettings", () => {
  it("label を trim し、空文字 color を null に畳んで返す", () => {
    const result = parseDefaultTableSettings(
      ["  Main  ", "Side"],
      ["  #AABBCC  ", "   "],
    );
    expect(result).toEqual({
      labels: ["Main", "Side"],
      colors: ["#AABBCC", null],
    });
  });

  it("空配列を許可する（デフォルト未設定状態）", () => {
    expect(parseDefaultTableSettings([], [])).toEqual({ labels: [], colors: [] });
  });

  it("null color はそのまま null", () => {
    expect(parseDefaultTableSettings(["A"], [null]).colors).toEqual([null]);
  });

  it("MAX_TABLES 件までは許可、超過は validation/default-table-labels-invalid", () => {
    const ok = Array.from({ length: MAX_TABLES }, (_, i) => `T${i}`);
    expect(() => parseDefaultTableSettings(ok, ok.map(() => null))).not.toThrow();

    const over = [...ok, "over"];
    expect(codeOf(() => parseDefaultTableSettings(over, over.map(() => null)))).toBe(
      "validation/default-table-labels-invalid",
    );
  });

  it("trim 後に空になる label は validation/default-table-labels-invalid", () => {
    expect(codeOf(() => parseDefaultTableSettings(["   "], [null]))).toBe(
      "validation/default-table-labels-invalid",
    );
  });

  it("TABLE_LABEL_MAX_LENGTH 超過の label は拒否（境界は許可）", () => {
    const atLimit = "x".repeat(TABLE_LABEL_MAX_LENGTH);
    expect(() => parseDefaultTableSettings([atLimit], [null])).not.toThrow();

    const over = "x".repeat(TABLE_LABEL_MAX_LENGTH + 1);
    expect(codeOf(() => parseDefaultTableSettings([over], [null]))).toBe(
      "validation/default-table-labels-invalid",
    );
  });

  it("colors の要素数が labels と違えば validation/default-table-colors-invalid", () => {
    expect(codeOf(() => parseDefaultTableSettings(["A", "B"], [null]))).toBe(
      "validation/default-table-colors-invalid",
    );
  });

  it("#RRGGBB 以外の color は validation/default-table-colors-invalid", () => {
    expect(codeOf(() => parseDefaultTableSettings(["A"], ["red"]))).toBe(
      "validation/default-table-colors-invalid",
    );
    expect(codeOf(() => parseDefaultTableSettings(["A"], ["#ABC"]))).toBe(
      "validation/default-table-colors-invalid",
    );
    expect(codeOf(() => parseDefaultTableSettings(["A"], ["#GGHHII"]))).toBe(
      "validation/default-table-colors-invalid",
    );
  });
});

describe("assertDefaultTableSettings", () => {
  it("正規化済みの値を許可", () => {
    expect(() =>
      assertDefaultTableSettings(["Main", "Side"], ["#AABBCC", null]),
    ).not.toThrow();
  });

  it("parse と同じ code で拒否する（層をまたいだ code の一致）", () => {
    expect(codeOf(() => assertDefaultTableSettings(["   "], [null]))).toBe(
      "validation/default-table-labels-invalid",
    );
    expect(codeOf(() => assertDefaultTableSettings(["A"], ["red"]))).toBe(
      "validation/default-table-colors-invalid",
    );
    expect(codeOf(() => assertDefaultTableSettings(["A", "B"], [null]))).toBe(
      "validation/default-table-colors-invalid",
    );
  });

  it("assert は trim しない — 空文字 color は #RRGGBB でないため拒否", () => {
    // parse は空文字を null に畳むが、assert は正規化済み前提のため拒否する。
    // この非対称が service → repository のデータフロー（parse 済みを渡す）を表す。
    expect(codeOf(() => assertDefaultTableSettings(["A"], [""]))).toBe(
      "validation/default-table-colors-invalid",
    );
  });
});

describe("parseSeasonPointsRule", () => {
  it("null はそのまま null（既定値リセット経路）", () => {
    expect(parseSeasonPointsRule(null)).toBeNull();
  });

  it("base を 2 桁に丸めて返す（浮動小数点誤差の defensive 正規化）", () => {
    const result = parseSeasonPointsRule({ base: [8.659999999, 7], baseline: 8 });
    expect(result).toEqual({ base: [8.66, 7], baseline: 8 });
  });

  it("base 配列長の境界（1 / SEASON_POINTS_BASE_MAX_LENGTH）を許可", () => {
    expect(() => parseSeasonPointsRule({ base: [1], baseline: 8 })).not.toThrow();
    const atLimit = Array.from({ length: SEASON_POINTS_BASE_MAX_LENGTH }, () => 1);
    expect(() => parseSeasonPointsRule({ base: atLimit, baseline: 8 })).not.toThrow();
  });

  it("base 配列長 0 / 超過は validation/season-points-rule-invalid", () => {
    expect(codeOf(() => parseSeasonPointsRule({ base: [], baseline: 8 }))).toBe(
      "validation/season-points-rule-invalid",
    );
    const over = Array.from({ length: SEASON_POINTS_BASE_MAX_LENGTH + 1 }, () => 1);
    expect(codeOf(() => parseSeasonPointsRule({ base: over, baseline: 8 }))).toBe(
      "validation/season-points-rule-invalid",
    );
  });

  it("base 要素が負値 / 非有限は拒否（0 は許可）", () => {
    expect(() => parseSeasonPointsRule({ base: [0], baseline: 8 })).not.toThrow();
    expect(codeOf(() => parseSeasonPointsRule({ base: [-1], baseline: 8 }))).toBe(
      "validation/season-points-rule-invalid",
    );
    expect(
      codeOf(() => parseSeasonPointsRule({ base: [Number.NaN], baseline: 8 })),
    ).toBe("validation/season-points-rule-invalid");
    expect(
      codeOf(() => parseSeasonPointsRule({ base: [Number.POSITIVE_INFINITY], baseline: 8 })),
    ).toBe("validation/season-points-rule-invalid");
  });

  it("baseline は MIN..MAX_SEATS_PER_TABLE の整数（境界含む）", () => {
    expect(() =>
      parseSeasonPointsRule({ base: [1], baseline: MIN_SEATS_PER_TABLE }),
    ).not.toThrow();
    expect(() =>
      parseSeasonPointsRule({ base: [1], baseline: MAX_SEATS_PER_TABLE }),
    ).not.toThrow();
    expect(
      codeOf(() =>
        parseSeasonPointsRule({ base: [1], baseline: MIN_SEATS_PER_TABLE - 1 }),
      ),
    ).toBe("validation/season-points-rule-invalid");
    expect(
      codeOf(() =>
        parseSeasonPointsRule({ base: [1], baseline: MAX_SEATS_PER_TABLE + 1 }),
      ),
    ).toBe("validation/season-points-rule-invalid");
    expect(codeOf(() => parseSeasonPointsRule({ base: [1], baseline: 8.5 }))).toBe(
      "validation/season-points-rule-invalid",
    );
  });
});

describe("assertSeasonPointsRule", () => {
  it("null は no-op", () => {
    expect(() => assertSeasonPointsRule(null)).not.toThrow();
  });

  it("正規化済みの値を許可", () => {
    expect(() =>
      assertSeasonPointsRule({ base: [10, 7, 5], baseline: 8 }),
    ).not.toThrow();
  });

  it("parse と同じ code で拒否する（層をまたいだ code の一致）", () => {
    expect(codeOf(() => assertSeasonPointsRule({ base: [], baseline: 8 }))).toBe(
      "validation/season-points-rule-invalid",
    );
    expect(codeOf(() => assertSeasonPointsRule({ base: [-1], baseline: 8 }))).toBe(
      "validation/season-points-rule-invalid",
    );
    expect(codeOf(() => assertSeasonPointsRule({ base: [1], baseline: 99 }))).toBe(
      "validation/season-points-rule-invalid",
    );
  });

  it("assert は丸めない — 2 桁を超える値もそのまま通す（正規化済み前提）", () => {
    expect(() =>
      assertSeasonPointsRule({ base: [8.659999999], baseline: 8 }),
    ).not.toThrow();
  });
});
