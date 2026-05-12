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
 * Phase A.3 polish: サークル詳細編集画面のプレビュー領域で、OG SSR route と
 * 同型の readability layer（薄い上下 scrim + text-shadow + theme 切替）を再現する component。
 *
 *   - 内側を **OG 実寸 (1200×630) で固定描画** し、外側で container 幅に合わせて
 *     `transform: scale()` する。これにより親幅がどれだけ縮んでも実画像と同じ比率を保ち、
 *     構造的に文字 overflow を発生させない
 *   - 色値は `OG_COLORS` から完全共有し、`resolveCardTheme` で foreground / textShadow を解決
 *   - レイアウト数値（fontSize / padding）は OG route の値を直接 import する（drift 回避）
 *   - スケールは `container query units (cqw)` を使用。親の `container-type: inline-size`
 *     基準で `100cqw = 親幅`、`scale(calc(100cqw / 1200px))` で実画像比率に丸まる
 *   - Phase A.3 初版の rgba box overlay は塗りつぶし範囲が大きすぎたため廃止。
 *     現在は scrim + text-shadow のみで可読性を確保する
 */
export interface CardReadabilityPreviewProps {
  /** 画像 URL（previewUrl ?? current?.imageUrl）。null = 未設定。 */
  imageUrl: string | null;
  /** 現在編集中の textTheme（radio の選択値）。 */
  textTheme: CardTextTheme;
  /** winner / season で foreground / textShadow 色が異なる。 */
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
  const { fg, textShadow, footerBox } = resolveCardTheme(
    hasImage,
    textTheme,
    variant,
  );

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
          {variant === "winner" ? (
            <>
              {/* 最上部・中央揃え */}
              <PreviewText
                fg={fg}
                textShadow={textShadow}
                align="center"
                size="title"
              >
                {demo.title}
              </PreviewText>
              {/* 上下左右の中央: 優勝者名のスタンドイン */}
              <PreviewText
                fg={fg}
                textShadow={textShadow}
                align="center"
                size="emphasis"
              >
                {demo.main}
              </PreviewText>
              {/*
                最下部・中央寄せボックス: サークル名 / 開催日 / 参加人数 / アプリ名 を横並び。
                4 要素間は fg 色の 1px 縦線で区切る。
                背景画像時は textTheme 連動の半透明 box。グラデ背景時はフラット。
                フォントサイズ・色は OG route ([tid]/route.tsx) と同値（drift 回避）。
              */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "center",
                  width: "100%",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 20,
                    color: fg,
                    lineHeight: 1.2,
                    whiteSpace: "nowrap",
                    backgroundColor: footerBox ?? "transparent",
                    borderRadius: footerBox ? OG_COLORS.bgFooterBoxRadius : 0,
                    padding: footerBox
                      ? `${OG_COLORS.bgFooterBoxPaddingY}px ${OG_COLORS.bgFooterBoxPaddingX}px`
                      : 0,
                    // CSS では undefined を渡しても React が無視するので winner route と
                    // 違って spread 化までは不要だが、視覚的に揃えるため同じガードを置く。
                    textShadow:
                      footerBox || !textShadow ? undefined : textShadow,
                  }}
                >
                  <span style={{ fontSize: 28, opacity: 0.85 }}>サークル名</span>
                  <span
                    aria-hidden
                    style={{
                      width: 1,
                      height: 28,
                      backgroundColor: fg,
                      opacity: 0.35,
                    }}
                  />
                  <span style={{ fontSize: 28, opacity: 0.85 }}>2026/5/12</span>
                  <span
                    aria-hidden
                    style={{
                      width: 1,
                      height: 28,
                      backgroundColor: fg,
                      opacity: 0.35,
                    }}
                  />
                  <span style={{ fontSize: 28, opacity: 0.85 }}>8 人参加</span>
                  <span
                    aria-hidden
                    style={{
                      width: 1,
                      height: 28,
                      backgroundColor: fg,
                      opacity: 0.35,
                    }}
                  />
                  <span style={{ fontSize: 16, opacity: 0.7 }}>{demo.sub}</span>
                </div>
              </div>
            </>
          ) : (
            <>
              <PreviewText fg={fg} textShadow={textShadow} align="start" size="title">
                {demo.title}
              </PreviewText>
              <PreviewText fg={fg} textShadow={textShadow} align="center" size="emphasis">
                {demo.main}
              </PreviewText>
              <PreviewText fg={fg} textShadow={textShadow} align="end" size="sub">
                {demo.sub}
              </PreviewText>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function PreviewText({
  fg,
  textShadow,
  align,
  size,
  children,
}: {
  fg: string;
  textShadow: string | null;
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
    color: fg,
    textShadow: textShadow ?? undefined,
    alignSelf,
    fontSize: PREVIEW_FONT_SIZE[size],
    fontWeight: 700,
    lineHeight: 1.2,
    whiteSpace: "nowrap",
  };
  return <div style={style}>{children}</div>;
}
