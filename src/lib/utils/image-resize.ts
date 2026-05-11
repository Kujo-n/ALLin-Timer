import { OG_HEIGHT, OG_WIDTH } from "@/app/api/og/_lib/og-card-styles";
import { AppError } from "@/lib/errors";

/**
 * Phase A.2 (05-post-launch-polish Track A): canvas API を用いた結果カード背景画像の
 * リサイズ / 圧縮 helper。
 *
 * - ライブラリ追加なし（HTMLCanvasElement と Image だけで完結）
 * - 1200×630 (OG_WIDTH×OG_HEIGHT) の **cover フィット**（centered crop）
 * - default は jpeg quality 0.8（圧縮後 ~150〜250KB を想定。Storage rule 上限 1MB に余裕）
 * - EXIF orientation は drawImage が自動補正する仕様に依存（Chromium / WebKit / Gecko 共通）
 *
 * AppError code:
 *   - `image/load-failed`        — Image.onerror（壊れた画像 / mime 不一致）
 *   - `image/canvas-unavailable` — `getContext("2d")` が null（古いブラウザ）
 *   - `image/encode-failed`      — toBlob が null を返した（mime 非対応など）
 */
export interface ResizeOptions {
  /** 出力幅。default `OG_WIDTH` (1200) */
  width?: number;
  /** 出力高さ。default `OG_HEIGHT` (630) */
  height?: number;
  /** jpeg / webp 品質 (0..1)。default 0.8 */
  quality?: number;
  /** 出力 mime。default `"image/jpeg"`。Storage rule の `image/(jpeg|png|webp)` regex と整合 */
  mimeType?: "image/jpeg" | "image/png" | "image/webp";
}

export async function resizeImageToCardSize(
  file: File,
  opts: ResizeOptions = {},
): Promise<Blob> {
  const width = opts.width ?? OG_WIDTH;
  const height = opts.height ?? OG_HEIGHT;
  const quality = opts.quality ?? 0.8;
  const mimeType = opts.mimeType ?? "image/jpeg";

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new AppError(
        "画像の描画コンテキストを取得できませんでした",
        "image/canvas-unavailable",
      );
    }
    const scale = Math.max(width / img.width, height / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const dx = (width - drawW) / 2;
    const dy = (height - drawH) / 2;
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, mimeType, quality),
    );
    if (!blob) {
      throw new AppError("画像の圧縮に失敗しました", "image/encode-failed");
    }
    return blob;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () =>
      reject(new AppError("画像を読込めませんでした", "image/load-failed"));
    img.src = src;
  });
}
