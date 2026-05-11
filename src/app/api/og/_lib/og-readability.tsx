import type { CSSProperties, ReactNode } from "react";

import { OG_COLORS } from "./og-card-styles";

/**
 * Phase A.3: OG カードと設定プレビューで共有する readability layer の helper。
 *
 *   - `resolveCardTheme` — bgImage の有無 + textTheme + variant から foreground / box 色を解決
 *   - `<ScrimLayer>` — 背景画像時のみ上下グラデーション scrim を 2 枚重ねる
 *   - `<TextBox>` — テキストグループに rgba box overlay を巻く（box 色 null で素通し）
 *
 * Satori と React DOM の両方で動くよう inline style のみ使用する。
 */

export type CardVariant = "winner" | "season";

/**
 * 純関数: textTheme + 背景画像の有無 + variant から foreground / box 色を解決する。
 *
 *   - `hasBackground=false` → グラデ既存挙動。box 色は null（box overlay 不要）
 *   - `hasBackground=true` + textTheme="dark" → 明 foreground + 暗 rgba box
 *   - `hasBackground=true` + textTheme="light" / undefined → 暗 foreground + 明 rgba box
 *
 * `undefined` は zod default 経由で "light" として扱う（hydrate 前の旧 doc 互換）。
 */
export function resolveCardTheme(
  hasBackground: boolean,
  textTheme: "light" | "dark" | undefined,
  variant: CardVariant,
): { fg: string; boxBg: string | null } {
  if (!hasBackground) {
    return {
      fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
      boxBg: null,
    };
  }
  if (textTheme === "dark") {
    return {
      fg:
        variant === "winner"
          ? OG_COLORS.winnerFgDark
          : OG_COLORS.seasonFgDark,
      boxBg: OG_COLORS.bgBoxDark,
    };
  }
  return {
    fg: variant === "winner" ? OG_COLORS.winnerFg : OG_COLORS.seasonFg,
    boxBg: OG_COLORS.bgBoxLight,
  };
}

/**
 * 背景画像時に上下グラデーション scrim を 2 枚重ねる Satori-safe component。
 *
 * `active=false`（=画像なし）のときは null を返し、グラデ既存挙動を完全維持する。
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

/**
 * テキストグループを rgba 半透明 box で囲む helper。
 *
 *   - `boxBg=null` のとき box 装飾なしで素通し（フラットレイアウトを維持）
 *   - Satori はデフォルト全要素 flex のため、root に display:flex / flexDirection:column を明示
 *   - `extraStyle` で flex 配置（alignItems / alignSelf 等）を呼出側から上書き可
 */
export function TextBox({
  boxBg,
  children,
  extraStyle,
}: {
  boxBg: string | null;
  children: ReactNode;
  extraStyle?: CSSProperties;
}) {
  const boxStyle: CSSProperties = boxBg
    ? {
        backgroundColor: boxBg,
        borderRadius: OG_COLORS.bgBoxRadius,
        padding: `${OG_COLORS.bgBoxPaddingY}px ${OG_COLORS.bgBoxPaddingX}px`,
      }
    : {};
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        ...boxStyle,
        ...extraStyle,
      }}
    >
      {children}
    </div>
  );
}
