import { OG_COLORS } from "./og-card-styles";

/**
 * Phase A.3 polish: OG カードと設定プレビューで共有する readability layer の helper。
 *
 *   - `resolveCardTheme` — bgImage の有無 + textTheme + variant から foreground / textShadow を解決
 *   - `<ScrimLayer>` — 背景画像時のみ「薄い」上下グラデーション scrim を 2 枚重ねる
 *
 * Phase A.3 初版で導入した rgba box overlay は画像の塗りつぶし範囲が大きく
 * デザインを損なうという feedback を受け廃止。代わりに text-shadow で文字側を
 * 縁取り、scrim も画像中央が見えるよう大きく弱めた。box 関連の helper は削除。
 *
 * Satori と React DOM の両方で動くよう inline style のみ使用する。
 */

export type CardVariant = "winner" | "season";

/**
 * 純関数: textTheme + 背景画像の有無 + variant から foreground / textShadow / footerBox を解決する。
 *
 *   - `hasBackground=false` → グラデ既存挙動。textShadow / footerBox は null
 *   - `hasBackground=true` + textTheme="dark" → 明 foreground + 黒い outer glow + 紺系 footer box
 *   - `hasBackground=true` + textTheme="light" / undefined → 暗 foreground + 白い outer glow + 白系 footer box
 *
 * `undefined` は zod default 経由で "light" として扱う（hydrate 前の旧 doc 互換）。
 *
 * `footerBox` は winner OG の最下部「サークル名 / 開催日 / 参加人数 / アプリ名」
 * ボックスの背景色。背景画像時に owner からの明示要望で許容している局所塗りつぶし。
 */
export function resolveCardTheme(
  hasBackground: boolean,
  textTheme: "light" | "dark" | undefined,
  variant: CardVariant,
): {
  fg: string;
  textShadow: string | null;
  footerBox: string | null;
} {
  if (!hasBackground) {
    return {
      fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
      textShadow: null,
      footerBox: null,
    };
  }
  if (textTheme === "dark") {
    return {
      fg:
        variant === "winner"
          ? OG_COLORS.winnerFgDark
          : OG_COLORS.seasonFgDark,
      textShadow: OG_COLORS.bgTextShadowDark,
      footerBox: OG_COLORS.bgFooterBoxDark,
    };
  }
  return {
    fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
    textShadow: OG_COLORS.bgTextShadowLight,
    footerBox: OG_COLORS.bgFooterBoxLight,
  };
}

/**
 * 背景画像時に上下グラデーション scrim を 2 枚重ねる Satori-safe component。
 *
 * `active=false`（=画像なし）のときは null を返し、グラデ既存挙動を完全維持する。
 * scrim 自体は Phase A.3 polish で大幅に弱化済み（上 15% / 下 12% / 透明度 0.3 前後）。
 */
export function ScrimLayer({ active }: { active: boolean }) {
  if (!active) return null;
  return (
    <>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: OG_COLORS.bgScrimTopGradient,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: OG_COLORS.bgScrimBottomGradient,
        }}
      />
    </>
  );
}
