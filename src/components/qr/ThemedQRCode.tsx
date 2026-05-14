"use client";

import { QRCodeSVG } from "qrcode.react";

import { useTheme } from "@/lib/services/theme";

interface ThemedQRCodeProps {
  value: string;
  size?: number;
  "aria-label"?: string;
}

/**
 * Track D Phase D.2: テーマに追従する QR 描画コンポーネント。
 *
 *   - light: canonical な黒 QR / 白背景でスキャナ読取性を最優先
 *   - dark: globals.css の `--card` / `--foreground` トークンに揃え、暗い UI 上に
 *     純白の塊が浮かないようにする。スマホ前提なら反転 QR は iOS 11+ /
 *     最新 Android Camera / LINE / 決済アプリで問題なく読み取れる
 *   - `marginSize={4}` で QR 仕様準拠の 4 モジュール quiet zone を SVG 内部に確保
 *     （外側 wrapper の `bg-card p-4` と二重防御）
 *
 * ⚠ DRIFT WARNING: dark の bgColor / fgColor は [globals.css](../../app/globals.css)
 * の `.dark` ブロック `--card` / `--foreground` と連動。テーマ palette を変更した場合は
 * 本ファイルも同期させる（drift 検出スクリプトは未整備）。
 */
export function ThemedQRCode({
  value,
  size = 224,
  "aria-label": ariaLabel,
}: ThemedQRCodeProps) {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  const bgColor = isDark ? "hsl(222, 28%, 11%)" : "#FFFFFF";
  const fgColor = isDark ? "hsl(35, 25%, 92%)" : "#000000";

  return (
    <QRCodeSVG
      value={value}
      size={size}
      bgColor={bgColor}
      fgColor={fgColor}
      marginSize={4}
      aria-label={ariaLabel}
    />
  );
}
