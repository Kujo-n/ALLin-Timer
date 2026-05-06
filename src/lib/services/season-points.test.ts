import { describe, expect, it } from "vitest";

import { calcSeasonPoints, isFinalTable } from "./season-points";

describe("calcSeasonPoints", () => {
  it("returns 10.00 for rank=1 at baseline (8 participants)", () => {
    expect(calcSeasonPoints(1, 8)).toBe(10);
  });

  it("returns 8.66 for rank=1 at 6 participants (10 * sqrt(6/8))", () => {
    // sqrt(6/8) = sqrt(0.75) ≈ 0.8660254 → 10 * 0.8660... ≈ 8.66
    expect(calcSeasonPoints(1, 6)).toBe(8.66);
  });

  it("returns 17.32 for rank=1 at 24 participants (10 * sqrt(24/8))", () => {
    // sqrt(3) ≈ 1.7320508 → 10 * 1.7320... ≈ 17.32
    expect(calcSeasonPoints(1, 24)).toBe(17.32);
  });

  it("returns 7.00 for rank=2 at 8 participants", () => {
    expect(calcSeasonPoints(2, 8)).toBe(7);
  });

  it("returns 5.00 for rank=3 at 8 participants", () => {
    expect(calcSeasonPoints(3, 8)).toBe(5);
  });

  it("returns 1.00 for rank=5..9 at 8 participants (tail of base[])", () => {
    expect(calcSeasonPoints(5, 8)).toBe(1);
    expect(calcSeasonPoints(9, 8)).toBe(1);
  });

  it("returns 0 for rank=10 (out of base[] range)", () => {
    expect(calcSeasonPoints(10, 8)).toBe(0);
  });

  it("returns 0 for rank=0 (defensive)", () => {
    expect(calcSeasonPoints(0, 8)).toBe(0);
  });

  it("returns 0 for negative rank", () => {
    expect(calcSeasonPoints(-1, 8)).toBe(0);
  });

  it("returns 0 for non-integer rank", () => {
    expect(calcSeasonPoints(1.5, 8)).toBe(0);
  });

  it("returns 0 for participants=0", () => {
    expect(calcSeasonPoints(1, 0)).toBe(0);
  });

  it("returns 0 for negative participants", () => {
    expect(calcSeasonPoints(1, -1)).toBe(0);
  });

  it("scales correctly for 16 participants (sqrt(2))", () => {
    // sqrt(16/8) = sqrt(2) ≈ 1.4142136 → 10 * 1.4142... ≈ 14.14
    expect(calcSeasonPoints(1, 16)).toBe(14.14);
  });

  it("scales correctly for 20 participants (sqrt(2.5))", () => {
    // sqrt(20/8) = sqrt(2.5) ≈ 1.5811388 → 10 * 1.5811... ≈ 15.81
    expect(calcSeasonPoints(1, 20)).toBe(15.81);
  });

  it("does not accumulate floating-point error over 1000 additions", () => {
    // 8.66 を 1000 回加算しても 2 桁丸めで 8660.00 になることを確認
    const base = calcSeasonPoints(1, 6); // 8.66
    let sum = 0;
    for (let i = 0; i < 1000; i += 1) {
      sum = Math.round((sum + base) * 100) / 100;
    }
    expect(sum).toBe(8660);
  });

  /**
   * L-3 (rounding boundary characterization): `Math.round(x * 100) / 100` の半丸め挙動を
   * 周辺サンプルで lock する。将来 base[] / baseline / 丸めアルゴリズムを変えた際に
   * 「2 桁丸めの正確な期待値」が変わったらこのテストが落ちて気付ける。
   *
   * 注意: JS の `Math.round` は half-toward-positive-infinity（負値では half-away-from-zero）
   * かつ、IEEE 754 の二進浮動小数点では「数学的に X.X05」相当の値が表現できないため、
   * 厳密な 0.005 ぴったり境界を `calcSeasonPoints` で踏むのは不可能に近い。
   * 代わりに 3 桁目が `4` / `5` / `6` になる近傍ケースを characterize する。
   */
  it.each([
    // [rank, participants, expected, comment]
    [1, 7, 9.35, "10*sqrt(7/8)=9.354... → 3 桁目 4 切り捨て → 9.35"],
    [1, 9, 10.61, "10*sqrt(9/8)=10.6066... → 3 桁目 6 切り上げ → 10.61"],
    [1, 11, 11.73, "10*sqrt(11/8)=11.7260... → 3 桁目 6 切り上げ → 11.73"],
    [1, 13, 12.75, "10*sqrt(13/8)=12.7475... → 3 桁目 7 切り上げ → 12.75"],
    [1, 18, 15, "10*sqrt(18/8)=15.0 ぴったり → 15"],
    [2, 5, 5.53, "7*sqrt(5/8)=5.534... → 3 桁目 3 切り捨て → 5.53"],
    [9, 32, 2, "1*sqrt(32/8)=2.0 ぴったり → 2"],
  ])(
    "rank=%i participants=%i → %f (%s)",
    (rank, participants, expected) => {
      expect(calcSeasonPoints(rank, participants)).toBe(expected);
    },
  );
});

describe("isFinalTable", () => {
  it("returns true for rank=1 (FT 入賞)", () => {
    expect(isFinalTable(1)).toBe(true);
  });

  it("returns true for rank=9 (boundary, NLH 9 人卓)", () => {
    expect(isFinalTable(9)).toBe(true);
  });

  it("returns false for rank=10 (boundary)", () => {
    expect(isFinalTable(10)).toBe(false);
  });

  it("returns false for rank=0 (defensive)", () => {
    expect(isFinalTable(0)).toBe(false);
  });

  it("returns false for negative rank", () => {
    expect(isFinalTable(-1)).toBe(false);
  });

  it("returns false for non-integer rank", () => {
    expect(isFinalTable(2.5)).toBe(false);
  });
});
