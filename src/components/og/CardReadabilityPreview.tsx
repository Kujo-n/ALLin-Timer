"use client";

import type { CSSProperties, ReactNode } from "react";

import {
  OG_COLORS,
  OG_HEIGHT,
  OG_PADDING,
  OG_WIDTH,
} from "@/app/api/og/_lib/og-card-styles";
import {
  resolveCardTheme,
  type CardVariant,
} from "@/app/api/og/_lib/og-readability";
import type { CardTextTheme } from "@/lib/firebase/schemas/group";

/**
 * Phase A.3: サークル詳細編集画面のプレビュー領域で、OG SSR route と
 * 同型の readability layer（scrim + box overlay + theme 切替）を再現する component。
 *
 *   - 内側を **OG 実寸 (1200×630) で固定描画** し、外側で container 幅に合わせて
 *     `transform: scale()` する。これにより親幅がどれだけ縮んでも実画像と同じ比率を保ち、
 *     構造的に文字 overflow を発生させない
 *   - 色値は `OG_COLORS` から完全共有し、`resolveCardTheme` で foreground / box 色を解決
 *   - レイアウト数値（fontSize / padding）は OG route の値を直接 import する（drift 回避）
 *   - スケールは `container query units (cqw)` を使用。親の `container-type: inline-size`
 *     基準で `100cqw = 親幅`、`scale(calc(100cqw / 1200px))` で実画像比率に丸まる
 */
export interface CardReadabilityPreviewProps {
  /** 画像 URL（previewUrl ?? current?.imageUrl）。null = 未設定。 */
  imageUrl: string | null;
  /** 現在編集中の textTheme（radio の選択値）。 */
  textTheme: CardTextTheme;
  /** winner / season で foreground / box 色が異なる。 */
  variant: CardVariant;
  /** 画像未設定時の placeholder（呼出側で OG グラデと揃える）。 */
  placeholderBg: string;
  /** プレビュー内に被せる demo テキスト（実 OG の値は別。汎用語で「読める/読めない」を伝える）。 */
  demo: { title: string; main: string; sub: string };
  /** プレビュー外側の aria-label（テスト用）。 */
  ariaLabel?: string;
  /** プレビュー外側の data-testid（テスト用）。 */
  testId?: string;
}

/** 内側固定描画レイヤーで使用するフォントサイズ（OG 実寸 px）。OG route のキー値と整合させる。 */
const PREVIEW_FONT_SIZE = {
  title: 56,
  emphasis: 96,
  sub: 22,
} as const;

export function CardReadabilityPreview({
  imageUrl,
  textTheme,
  variant,
  placeholderBg,
  demo,
  ariaLabel,
  testId,
}: CardReadabilityPreviewProps) {
  const hasImage = imageUrl != null;
  const { fg, boxBg } = resolveCardTheme(hasImage, textTheme, variant);

  return (
    <div
      className="relative w-full overflow-hidden rounded border"
      style={{
        aspectRatio: `${OG_WIDTH} / ${OG_HEIGHT}`,
        containerType: "inline-size",
      }}
      aria-label={ariaLabel}
      data-testid={testId}
    >
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: OG_WIDTH,
          height: OG_HEIGHT,
          transform: `scale(calc(100cqw / ${OG_WIDTH}px))`,
          transformOrigin: "top left",
          background: hasImage ? "transparent" : placeholderBg,
        }}
      >
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={imageUrl}
            alt=""
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: OG_WIDTH,
              height: OG_HEIGHT,
              objectFit: "cover",
            }}
          />
        ) : (
          <div
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              width: OG_WIDTH,
              height: OG_HEIGHT,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "rgba(255,255,255,0.7)",
              fontSize: 48,
              fontWeight: 600,
            }}
          >
            背景未設定
          </div>
        )}
        {hasImage ? (
          <>
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: OG_WIDTH,
                height: OG_HEIGHT,
                background: OG_COLORS.bgScrimTopGradient,
              }}
            />
            <div
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: OG_WIDTH,
                height: OG_HEIGHT,
                background: OG_COLORS.bgScrimBottomGradient,
              }}
            />
          </>
        ) : null}
        <div
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            width: OG_WIDTH,
            height: OG_HEIGHT,
            padding: OG_PADDING,
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            boxSizing: "border-box",
          }}
        >
          <PreviewTextBox boxBg={boxBg} fg={fg} align="start" size="title">
            {demo.title}
          </PreviewTextBox>
          <PreviewTextBox boxBg={boxBg} fg={fg} align="center" size="emphasis">
            {demo.main}
          </PreviewTextBox>
          <PreviewTextBox boxBg={boxBg} fg={fg} align="end" size="sub">
            {demo.sub}
          </PreviewTextBox>
        </div>
      </div>
    </div>
  );
}

function PreviewTextBox({
  boxBg,
  fg,
  align,
  size,
  children,
}: {
  boxBg: string | null;
  fg: string;
  align: "start" | "center" | "end";
  size: keyof typeof PREVIEW_FONT_SIZE;
  children: ReactNode;
}) {
  const alignSelf =
    align === "center"
      ? "center"
      : align === "end"
        ? "flex-end"
        : "flex-start";
  const style: CSSProperties = {
    backgroundColor: boxBg ?? "transparent",
    color: fg,
    borderRadius: boxBg ? OG_COLORS.bgBoxRadius : 0,
    padding: boxBg
      ? `${OG_COLORS.bgBoxPaddingY}px ${OG_COLORS.bgBoxPaddingX}px`
      : 0,
    alignSelf,
    fontSize: PREVIEW_FONT_SIZE[size],
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
  return <div style={style}>{children}</div>;
}
