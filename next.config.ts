import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
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
};

export default nextConfig;
