import { describe, expect, it } from "vitest";

import { OG_COLORS } from "./og-card-styles";
import { resolveCardTheme } from "./og-readability";

describe("resolveCardTheme", () => {
  describe("hasBackground=false (グラデ既存挙動)", () => {
    it("winner / textTheme=undefined → winnerFg + box null", () => {
      expect(resolveCardTheme(false, undefined, "winner")).toEqual({
        fg: OG_COLORS.winnerFg,
        boxBg: null,
      });
    });

    it("season / textTheme=undefined → seasonFg + box null", () => {
      expect(resolveCardTheme(false, undefined, "season")).toEqual({
        fg: OG_COLORS.seasonFg,
        boxBg: null,
      });
    });

    it("hasBackground=false なら textTheme=light/dark 指定でも box は null", () => {
      expect(resolveCardTheme(false, "light", "winner").boxBg).toBeNull();
      expect(resolveCardTheme(false, "dark", "season").boxBg).toBeNull();
    });
  });

  describe("hasBackground=true (背景画像あり)", () => {
    it("winner / light → winnerFg + bgBoxLight", () => {
      expect(resolveCardTheme(true, "light", "winner")).toEqual({
        fg: OG_COLORS.winnerFg,
        boxBg: OG_COLORS.bgBoxLight,
      });
    });

    it("season / light → seasonFg + bgBoxLight", () => {
      expect(resolveCardTheme(true, "light", "season")).toEqual({
        fg: OG_COLORS.seasonFg,
        boxBg: OG_COLORS.bgBoxLight,
      });
    });

    it("winner / dark → winnerFgDark + bgBoxDark", () => {
      expect(resolveCardTheme(true, "dark", "winner")).toEqual({
        fg: OG_COLORS.winnerFgDark,
        boxBg: OG_COLORS.bgBoxDark,
      });
    });

    it("season / dark → seasonFgDark + bgBoxDark", () => {
      expect(resolveCardTheme(true, "dark", "season")).toEqual({
        fg: OG_COLORS.seasonFgDark,
        boxBg: OG_COLORS.bgBoxDark,
      });
    });

    it("textTheme=undefined は light として扱う（winner）", () => {
      expect(resolveCardTheme(true, undefined, "winner")).toEqual({
        fg: OG_COLORS.winnerFg,
        boxBg: OG_COLORS.bgBoxLight,
      });
    });

    it("textTheme=undefined は light として扱う（season）", () => {
      expect(resolveCardTheme(true, undefined, "season")).toEqual({
        fg: OG_COLORS.seasonFg,
        boxBg: OG_COLORS.bgBoxLight,
      });
    });
  });
});
