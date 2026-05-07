import { readFile } from "node:fs/promises";
import path from "node:path";

import { AppError } from "@/lib/errors";

/**
 * Phase B: Noto Sans JP（japanese subset, weight 400 / 700）の WOFF を ArrayBuffer として読込む。
 *
 * - `@fontsource/noto-sans-jp` 5.x は `.woff` / `.woff2` のみを node_modules に配置する。
 *   Satori（next/og の実体）は WOFF2 を解けないため WOFF を選択する（plan 内で .ttf を仮定して
 *   いた箇所からの deviation：パッケージレイアウトに合わせて WOFF を採用）。
 * - Edge runtime では `node:fs` を使えないため、route 側で `runtime = "nodejs"` の export を必須とする。
 * - module-level cache でプロセス間 cold start のみ I/O を発生させる。
 */

type Weight = "Regular" | "Bold";

const FONT_FILES: Record<Weight, string> = {
  // Phase B deviation: plan は .ttf を期待していたが、@fontsource/noto-sans-jp 5.x は
  // .woff / .woff2 しか出力しない。Satori が解ける WOFF を採用。
  Regular: "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff",
  Bold: "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
};

let cache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function readFontFile(weight: Weight): Promise<ArrayBuffer> {
  const rel = FONT_FILES[weight];
  const abs = path.join(process.cwd(), "node_modules", ...rel.split("/"));
  try {
    const buf = await readFile(abs);
    // Buffer は SharedArrayBuffer 互換ではないため slice で safe ArrayBuffer に copy。
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  } catch (e) {
    // 本番（Vercel serverless）で再発した場合に、どの絶対 path で ENOENT したか
    // ログから即特定できるよう、message に絶対 path / cwd を含める。
    throw AppError.from(
      e,
      "og/font-load-failed",
      `フォント読込失敗 weight=${weight} cwd=${process.cwd()} abs=${abs}`,
    );
  }
}

export async function loadNotoSansJPCached(): Promise<{
  regular: ArrayBuffer;
  bold: ArrayBuffer;
}> {
  if (cache) return cache;
  const [regular, bold] = await Promise.all([
    readFontFile("Regular"),
    readFontFile("Bold"),
  ]);
  cache = { regular, bold };
  return cache;
}

/** テスト用: cache を破棄してフォント読込を強制再実行させる。 */
export function __resetFontCacheForTest(): void {
  cache = null;
}
