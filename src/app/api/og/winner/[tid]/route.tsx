import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";

import { loadNotoSansJPCached } from "@/app/api/og/_lib/load-font";
import { prepareBgDataUri } from "@/app/api/og/_lib/og-image-fetch";
import {
  OG_COLORS,
  OG_FONT_FAMILY,
  OG_HEIGHT,
  OG_PADDING,
  OG_WIDTH,
} from "@/app/api/og/_lib/og-card-styles";
import {
  resolveCardTheme,
  ScrimLayer,
} from "@/app/api/og/_lib/og-readability";
import {
  sanitizeFilename,
  WINNER_CARD_QUERY_SCHEMA,
} from "@/app/api/og/_lib/og-payload";
import {
  applyOgImageResponseHeaders,
  respondWithOgRenderError,
} from "@/app/api/og/_lib/og-response";
import { getErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Phase B: 優勝カード PNG 生成 route。Node.js runtime で `node:fs` 経由フォント読込を使う。
 *
 *   - GET /api/og/winner/[tid]?winnerName=...&tournamentName=...&participants=...&finishedAtLabel=...&filename=...
 *   - 成功時: 200, image/png（1200×630, ~100-300KB）+ Cache-Control + Content-Disposition
 *   - 不正クエリ: 400, JSON `{ code: "og/invalid-params", message: "..." }`
 *   - 例外: 500, JSON `{ code: "og/render-failed", message: "..." }`
 *
 * `runtime = "nodejs"` を必ず明示する（Edge runtime では `node:fs` を使えない）。
 * 日付ラベルは client が端末 TZ で format した文字列を `finishedAtLabel` で受信し、
 * route 側ではそのまま描画する（サーバ runtime TZ に依存しないため）。
 */
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ tid: string }> },
) {
  const t0 = Date.now();
  const { tid } = await ctx.params;
  try {
    const parsed = WINNER_CARD_QUERY_SCHEMA.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success) {
      logger.warn("og winner invalid params", {
        tid,
        code: "og/invalid-params",
        issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
      });
      return NextResponse.json(
        { code: "og/invalid-params", message: "クエリ文字列が不正です" },
        { status: 400 },
      );
    }
    const { regular, bold } = await loadNotoSansJPCached();
    const q = parsed.data;
    const filenameStem = q.filename ? sanitizeFilename(q.filename) : "card";

    // Phase A.2: 背景画像が指定されたら fetch + base64 化（Satori は外部 URL を fetch しない）。
    // 失敗時は warn ログを残しグラデ fallback に倒す（200 を返す契約は崩さない）。
    const bgDataUri = await prepareBgDataUri({
      url: q.bgImageUrl,
      onError: (e) =>
        logger.warn("og winner bg fetch failed", {
          tid,
          code: getErrorCode(e),
        }),
    });
    const { fg, textShadow, footerBox } = resolveCardTheme(
      !!bgDataUri,
      q.bgTextTheme,
      "winner",
    );
    // Satori は `textShadow: undefined` を内部で `.toString()` するためクラッシュする
    // （`failed to pipe response` / `Cannot read properties of undefined`）。
    // textShadow / footer 内 shadow をそれぞれ条件 spread 用 object に変換しておく:
    //   - shadowStyle: 背景画像時の文字 outer glow（footer 外側のテキストブロック用）
    //   - innerShadowStyle: footer 内のテキスト用。footerBox があるときは shadow を出さない
    const shadowStyle: { textShadow?: string } = textShadow
      ? { textShadow }
      : {};
    const innerShadowStyle: { textShadow?: string } = footerBox
      ? {}
      : shadowStyle;

    const response = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            position: "relative",
          }}
        >
          {bgDataUri ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={bgDataUri}
              alt=""
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
              }}
            />
          ) : null}
          <ScrimLayer active={!!bgDataUri} />
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "column",
              background: bgDataUri ? "transparent" : OG_COLORS.winnerBg,
              color: fg,
              fontFamily: OG_FONT_FAMILY,
              padding: OG_PADDING,
              border: bgDataUri
                ? "none"
                : `8px solid ${OG_COLORS.winnerBorder}`,
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            {/* 最上部・中央揃え: トーナメント名 */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                fontSize: 36,
                fontWeight: 700,
                ...shadowStyle,
              }}
            >
              {q.tournamentName}
            </div>

            {/*
              上下左右の中央: 優勝者名 (winnerName) そのものをコンテナ中心に置き、
              WINNER ラベルは winnerName の真上に absolute で乗せる。
              WINNER の高さを縦中央計算に含めないため、winnerName 単体が画面中央になる。
                - WINNER 実高さ ≈ fontSize 28 × lineHeight 1.2 ≒ 34px
                - WINNER と winnerName の間隔 = 6px（直前指示で半分に）
                - 合計 40px だけ winnerName 上端より上にオフセット
            */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flex: 1,
                width: "100%",
              }}
            >
              <div style={{ position: "relative", display: "flex" }}>
                <div
                  style={{
                    position: "absolute",
                    top: -40,
                    left: 0,
                    right: 0,
                    display: "flex",
                    justifyContent: "center",
                    fontSize: 36,
                    opacity: 0.6,
                    ...shadowStyle,
                  }}
                >
                  WINNER!!
                </div>
                <div
                  style={{
                    display: "flex",
                    fontSize: 120,
                    fontWeight: 700,
                    lineHeight: 1.1,
                    ...shadowStyle,
                  }}
                >
                  {q.winnerName}
                </div>
              </div>
            </div>

            {/*
              最下部・中央寄せボックス: サークル名 / 開催日 / 参加人数 / アプリ名 を横並び。
              背景画像時は半透明 box（textTheme で色切替）。グラデ背景時は box 無しでフラット。
              owner 要望により box で背景画像が部分的に隠れることは許容。
            */}
            <div
              style={{
                display: "flex",
                justifyContent: "center",
                width: "100%",
              }}
            >
              {(() => {
                // 4 要素間の区切り縦線。foreground 色を弱透明で使うことで box 内の
                // light / dark 両テーマに自動追従する（box 背景の上に 1px 縦線）。
                // 同一 JSX を複数箇所に置くと duplicate key 警告になるため毎回生成。
                const sep = () => (
                  <div
                    style={{
                      display: "flex",
                      width: 1,
                      height: 28,
                      backgroundColor: fg,
                      opacity: 0.35,
                    }}
                  />
                );
                return (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 20,
                      backgroundColor: footerBox ?? "transparent",
                      borderRadius: footerBox ? OG_COLORS.bgFooterBoxRadius : 0,
                      padding: footerBox
                        ? `${OG_COLORS.bgFooterBoxPaddingY}px ${OG_COLORS.bgFooterBoxPaddingX}px`
                        : 0,
                    }}
                  >
                    {q.groupName ? (
                      <>
                        <div
                          style={{
                            display: "flex",
                            fontSize: 28,
                            opacity: 0.85,
                            ...innerShadowStyle,
                          }}
                        >
                          {q.groupName}
                        </div>
                        {sep()}
                      </>
                    ) : null}
                    <div
                      style={{
                        display: "flex",
                        fontSize: 28,
                        opacity: 0.85,
                        ...innerShadowStyle,
                      }}
                    >
                      {q.finishedAtLabel}
                    </div>
                    {sep()}
                    <div
                      style={{
                        display: "flex",
                        fontSize: 28,
                        opacity: 0.85,
                        ...innerShadowStyle,
                      }}
                    >
                      {q.participants} 人参加
                    </div>
                    {sep()}
                    <div
                      style={{
                        display: "flex",
                        fontSize: 16,
                        opacity: 0.7,
                        ...innerShadowStyle,
                      }}
                    >
                      ALLin-PokerTimer
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      ),
      {
        width: OG_WIDTH,
        height: OG_HEIGHT,
        fonts: [
          { name: OG_FONT_FAMILY, data: regular, weight: 400, style: "normal" },
          { name: OG_FONT_FAMILY, data: bold, weight: 700, style: "normal" },
        ],
      },
    );

    applyOgImageResponseHeaders(response, { filenameStem });

    logger.info("og winner generated", { tid, ms: Date.now() - t0 });
    return response;
  } catch (e) {
    return respondWithOgRenderError(e, {
      logTag: "og winner render failed",
      ctx: { tid },
    });
  }
}
