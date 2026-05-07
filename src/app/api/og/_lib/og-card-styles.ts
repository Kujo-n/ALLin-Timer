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
  winnerFg: "#451a03",
  winnerBorder: "#f59e0b",
  /** シーズン首位カード: 深いネイビー × 金 アクセント。 */
  seasonBg: "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)",
  seasonFg: "#fef3c7",
  seasonAccent: "#fde68a",
  seasonMuted: "#cbd5e1",
} as const;

export const OG_FONT_FAMILY = "Noto Sans JP";
export const OG_PADDING = 64;
