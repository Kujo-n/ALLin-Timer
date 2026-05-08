import type { MetadataRoute } from "next";

/**
 * Phase A: PWA manifest.
 *
 * Next.js 15 の公式パターンで `MetadataRoute.Manifest` を返すと、
 * `/manifest.webmanifest` が build 時に自動生成されて serve される。
 * `<link rel="manifest" href="/manifest.webmanifest">` は `app/layout.tsx`
 * の `metadata.manifest` 経由で auto-inject される。
 *
 * - theme_color は CSS の `--foreground` ≒ `#0a0a0f`（status bar 背景）
 * - background_color は `--background` = `#ffffff`（splash 背景）
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
    background_color: "#ffffff",
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
