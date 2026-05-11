/**
 * Phase B: OG image (1200×630 PNG) で利用する色 / 寸法 / フォントサイズの単一真実源。
 *
 * Tailwind は ImageResponse の Satori 制約により利用不可（すべて inline style 必須）。
 * 値の drift を避けるため両 route handler から同じ constants を参照する。
 */

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export const OG_COLORS = {
  /** 優勝カード: amber グラデ（WinnerBanner と同系統）。 */
  winnerBg: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
  /** 優勝カード light theme（明るい背景画像向け / グラデ既存挙動）。 */
  winnerFg: "#451a03",
  /** Phase A.2: 優勝カード dark theme（暗い背景画像向け foreground）。 */
  winnerFgDark: "#fef3c7",
  winnerBorder: "#f59e0b",
  /** シーズン首位カード: 深いネイビー × 金 アクセント。 */
  seasonBg: "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)",
  /** シーズン first light theme（既存：暗 navy グラデ向けの薄黄色）。 */
  seasonFg: "#fef3c7",
  /** Phase A.2: シーズン dark theme（明るい背景画像向けの暗色 foreground）。 */
  seasonFgDark: "#451a03",
  seasonAccent: "#fde68a",
  seasonMuted: "#cbd5e1",
  /** Phase A.2: 背景画像オーバーレイ用の半透明 black scrim（最低限の読みやすさ確保）。 */
  bgScrim: "rgba(0,0,0,0.3)",
} as const;

export const OG_FONT_FAMILY = "Noto Sans JP";
export const OG_PADDING = 64;
