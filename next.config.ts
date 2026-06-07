import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // E2E は baseURL を 127.0.0.1（playwright.config.ts）にしているため、dev server は
  // `/_next/*` へのアクセスを cross-origin と判定して将来の Next.js メジャーでブロックする。
  // 開発・E2E 用に 127.0.0.1 / localhost からのアクセスを明示許可する（dev 専用設定・機密なし）。
  allowedDevOrigins: ["127.0.0.1", "localhost"],
  // Phase D follow-up: Vercel serverless function は build 時静的解析でしか node_modules
  // を bundle に含められない。OG image route は `path.join(process.cwd(), "node_modules", ...)`
  // で動的に WOFF を読むため、明示的に trace include しないと本番で
  // ENOENT → og/render-failed の 500 になる（Phase D の手動検証で観測）。
  outputFileTracingIncludes: {
    "/api/og/winner/[tid]": [
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff",
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
    ],
    "/api/og/season/[gid]": [
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff",
      "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
    ],
  },
  // Phase A: Service Worker スクリプト自身は HTTP cache に乗らないよう
  // 都度サーバから取得させる。register 側の updateViaCache: "none" と二重で
  // 「古い SW が pin されたまま update 検知できない」事故を防ぐ。
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
