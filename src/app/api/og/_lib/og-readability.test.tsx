import { describe, expect, it } from "vitest";

import { OG_COLORS } from "./og-card-styles";
import { resolveCardTheme } from "./og-readability";

describe("resolveCardTheme", () => {
  describe("hasBackground=false (グラデ既存挙動)", () => {
    it("winner / textTheme=undefined → winnerFg + textShadow / footerBox null", () => {
      expect(resolveCardTheme(false, undefined, "winner")).toEqual({
        fg: OG_COLORS.winnerFg,
        textShadow: null,
        footerBox: null,
      });
    });

    it("season / textTheme=undefined → seasonFg + textShadow / footerBox null", () => {
      expect(resolveCardTheme(false, undefined, "season")).toEqual({
        fg: OG_COLORS.seasonFg,
        textShadow: null,
        footerBox: null,
      });
    });

    it("hasBackground=false なら textTheme=light/dark 指定でも textShadow / footerBox は null", () => {
      expect(resolveCardTheme(false, "light", "winner").textShadow).toBeNull();
      expect(resolveCardTheme(false, "light", "winner").footerBox).toBeNull();
      expect(resolveCardTheme(false, "dark", "season").textShadow).toBeNull();
      expect(resolveCardTheme(false, "dark", "season").footerBox).toBeNull();
    });
  });

  describe("hasBackground=true (背景画像あり)", () => {
    it("winner / light → winnerFg + bgTextShadowLight + bgFooterBoxLight", () => {
      expect(resolveCardTheme(true, "light", "winner")).toEqual({
        fg: OG_COLORS.winnerFg,
        textShadow: OG_COLORS.bgTextShadowLight,
        footerBox: OG_COLORS.bgFooterBoxLight,
      });
    });

    it("season / light → seasonFg + bgTextShadowLight + bgFooterBoxLight", () => {
      expect(resolveCardTheme(true, "light", "season")).toEqual({
        fg: OG_COLORS.seasonFg,
        textShadow: OG_COLORS.bgTextShadowLight,
        footerBox: OG_COLORS.bgFooterBoxLight,
      });
    });

    it("winner / dark → winnerFgDark + bgTextShadowDark + bgFooterBoxDark", () => {
      expect(resolveCardTheme(true, "dark", "winner")).toEqual({
        fg: OG_COLORS.winnerFgDark,
        textShadow: OG_COLORS.bgTextShadowDark,
        footerBox: OG_COLORS.bgFooterBoxDark,
      });
    });

    it("season / dark → seasonFgDark + bgTextShadowDark + bgFooterBoxDark", () => {
      expect(resolveCardTheme(true, "dark", "season")).toEqual({
        fg: OG_COLORS.seasonFgDark,
        textShadow: OG_COLORS.bgTextShadowDark,
        footerBox: OG_COLORS.bgFooterBoxDark,
      });
    });

    it("textTheme=undefined は light として扱う（winner）", () => {
      expect(resolveCardTheme(true, undefined, "winner")).toEqual({
        fg: OG_COLORS.winnerFg,
        textShadow: OG_COLORS.bgTextShadowLight,
        footerBox: OG_COLORS.bgFooterBoxLight,
      });
    });

    it("textTheme=undefined は light として扱う（season）", () => {
      expect(resolveCardTheme(true, undefined, "season")).toEqual({
        fg: OG_COLORS.seasonFg,
        textShadow: OG_COLORS.bgTextShadowLight,
        footerBox: OG_COLORS.bgFooterBoxLight,
      });
    });
  });
});
