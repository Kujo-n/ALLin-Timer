// Phase A: PWA icon generator.
//
// source: public/icons/icon_pwa.png（運営者提供のロゴ — 赤円 + 白三角 + "ALL IN" 文字）
// 192x192 / 512x512 / 512x512-maskable / 180x180 の 4 つの PNG を public/icons/ に出力する。
//
// 配置:
// - icon-192 / icon-512 (purpose: any): trim 後の design を fit 配置、透明背景
//   （design 自体が円形なので背景透過のままでブラウザが自然に配置する）
// - icon-512-maskable: trim 後の design を size の 80% (safe area) に縮小し、白い square BG に置く
//   （Android adaptive icon は最大 20% の周囲を切るため、design が中央 80% に収まる必要がある。
//    赤円との境界がはっきり見えるよう BG は白固定）
// - apple-icon-180: trim 後の design を full サイズで白い square BG に置く
//   （iOS は透過 PNG を扱えないため必ず単色背景。iOS が自動で角丸化）
//
// 実行: node scripts/generate-pwa-icons.mjs

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import sharp from "sharp";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ICON_DIR = path.resolve(__dirname, "..", "public", "icons");
const SOURCE = path.join(ICON_DIR, "icon_pwa.png");

// maskable / apple-touch-icon の単色背景。赤円ロゴと境界がはっきり見えるよう白固定。
// manifest の `background_color: "#ffffff"` とも整合させる。
const BG_WHITE = { r: 255, g: 255, b: 255, alpha: 1 };
const TRANSPARENT = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * source 画像を trim して circle 部分の bounding box を抽出し、
 * 円形マスクで四隅の白を透明化した design buffer を返す。
 *
 * source は白背景（不透明）に赤円ロゴが配置された PNG なので、単純な
 * trim だけでは bounding box の四隅に白い領域が残ってしまう。
 * SVG circle を `dest-in` blend mode で掛け合わせて、円外のピクセルを
 * 透明化する。
 */
async function loadTrimmedDesign() {
  const trimmed = await sharp(SOURCE)
    .trim({ background: "white", threshold: 30 })
    .toBuffer();
  const meta = await sharp(trimmed).metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  const r = Math.min(w, h) / 2;
  const cx = w / 2;
  const cy = h / 2;
  const maskSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/>
  </svg>`;
  return await sharp(trimmed)
    .ensureAlpha()
    .composite([{ input: Buffer.from(maskSvg), blend: "dest-in" }])
    .png()
    .toBuffer();
}

/**
 * trimmed design を innerRatio に縮小して、size×size の background square に center 配置した PNG を出力する。
 *
 * @param {object} args
 * @param {number} args.size       — 出力 PNG の 1 辺
 * @param {number} args.innerRatio — design を size に対して占める比率 (0..1)
 * @param {object} args.background — sharp の create.background 形式
 * @param {string} args.filename   — 出力ファイル名
 */
async function renderIcon({ size, innerRatio, background, filename }) {
  const designBuf = await loadTrimmedDesign();
  const inner = Math.round(size * innerRatio);

  const designResized = await sharp(designBuf)
    .resize(inner, inner, {
      fit: "contain",
      background: TRANSPARENT,
    })
    .png()
    .toBuffer();

  const out = path.join(ICON_DIR, filename);
  await sharp({
    create: { width: size, height: size, channels: 4, background },
  })
    .composite([{ input: designResized, gravity: "center" }])
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toFile(out);
  console.log(`wrote ${out} (${size}x${size}, inner ${Math.round(innerRatio * 100)}%)`);
}

async function main() {
  await mkdir(ICON_DIR, { recursive: true });

  // any (192/512): design を full サイズで透明背景に配置
  await renderIcon({
    size: 192,
    innerRatio: 1.0,
    background: TRANSPARENT,
    filename: "icon-192.png",
  });
  await renderIcon({
    size: 512,
    innerRatio: 1.0,
    background: TRANSPARENT,
    filename: "icon-512.png",
  });

  // maskable: 中央 80% に design を収め、周囲 10% は赤い safe area
  await renderIcon({
    size: 512,
    innerRatio: 0.8,
    background: BG_WHITE,
    filename: "icon-512-maskable.png",
  });

  // apple-touch-icon: 透過不可なため赤背景。design は full サイズ（円が square に内接）
  await renderIcon({
    size: 180,
    innerRatio: 1.0,
    background: BG_WHITE,
    filename: "apple-icon-180.png",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
