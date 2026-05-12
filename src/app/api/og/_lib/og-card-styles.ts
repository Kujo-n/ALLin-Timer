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
  /**
   * Phase A.3 polish: 上端の薄い黒グラデ scrim（高さ 15% / 透明度 0.35）。
   * box overlay を廃した代わりにタイトル行のコントラストを軽く底上げする。
   * Satori は `linear-gradient` を `background` プロパティに受ける。
   */
  bgScrimTopGradient:
    "linear-gradient(180deg, rgba(0,0,0,0.35) 0%, rgba(0,0,0,0) 15%)",
  /**
   * Phase A.3 polish: 下端の薄い黒グラデ scrim（高さ 12% / 透明度 0.3）。
   * footer 行のコントラスト確保。
   */
  bgScrimBottomGradient:
    "linear-gradient(0deg, rgba(0,0,0,0.3) 0%, rgba(0,0,0,0) 12%)",
  /**
   * Phase A.3 polish: 背景画像時に文字へ被せる text-shadow（light / dark テーマ別）。
   * box overlay を全廃した代わりに、文字の縁取りで画像の上に直接置く読みやすさを担保する。
   * Satori は `textShadow` を受ける（vercel/satori#css）。
   *
   *   - light = 暗 foreground × 白系画像が多い → 白い outer glow
   *   - dark  = 明 foreground × 暗系画像が多い → 黒い outer glow
   */
  bgTextShadowLight:
    "0 0 6px rgba(255,255,255,0.95), 0 2px 6px rgba(255,255,255,0.7)",
  bgTextShadowDark:
    "0 0 6px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.7)",
  /**
   * Phase A.4 footer-box: 優勝カード最下部の情報ボックス背景。
   * 4 要素（サークル名 / 開催日 / 参加人数 / アプリ名）を読みやすくするため、
   * textTheme に対応する半透明 box でラップする。背景画像の一部が隠れることは
   * 仕様として許容する（owner からの明示要望）。
   *   - light（暗 foreground 用）= 白系 box
   *   - dark （明 foreground 用）= 紺系 box
   */
  bgFooterBoxLight: "rgba(255,255,255,0.78)",
  bgFooterBoxDark: "rgba(15,23,42,0.72)",
  /** footer box の border-radius / padding（px）。 */
  bgFooterBoxRadius: 12,
  bgFooterBoxPaddingX: 24,
  bgFooterBoxPaddingY: 10,
} as const;

export const OG_FONT_FAMILY = "Noto Sans JP";
export const OG_PADDING = 12;
