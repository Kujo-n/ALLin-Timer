import type { MetadataRoute } from "next";

/**
 * Phase A: PWA manifest.
 *
 * Next.js 15 の公式パターンで `MetadataRoute.Manifest` を返すと、
 * `/manifest.webmanifest` が build 時に自動生成されて serve される。
 * `<link rel="manifest" href="/manifest.webmanifest">` は `app/layout.tsx`
 * の `metadata.manifest` 経由で auto-inject される。
 *
 * - theme_color は `#0a0a0f`（status bar 背景。主たるブランドカラーは dark 寄り）
 * - background_color は `#0E1422`（splash 背景。dark palette と整合）
 *     - 注: manifest は build 時 static のため light/dark 切替には反応しない。
 *       light モード時のブラウザ chrome 色は HTML meta の `<meta name="theme-color" media="...">`
 *       経路で `#fafafa` を別途供給する（src/app/layout.tsx の `viewport.themeColor`）。
 * - 192/512 (any) と 512 (maskable) を両方提供（Android adaptive icon 用）
 * - orientation: "any" のまま（Phase C で screen.orientation.lock を使う）
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ALLin-PokerTimer",
    short_name: "ALLin",
    description: "NLH サークル向けトーナメント進行支援",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#0E1422",
    theme_color: "#0a0a0f",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    lang: "ja",
    categories: ["productivity", "utilities"],
  };
}
