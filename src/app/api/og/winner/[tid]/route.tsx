import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";

import { loadNotoSansJPCached } from "@/app/api/og/_lib/load-font";
import {
  OG_COLORS,
  OG_FONT_FAMILY,
  OG_HEIGHT,
  OG_PADDING,
  OG_WIDTH,
} from "@/app/api/og/_lib/og-card-styles";
import {
  sanitizeFilename,
  WINNER_CARD_QUERY_SCHEMA,
} from "@/app/api/og/_lib/og-payload";
import { AppError, getErrorCode } from "@/lib/errors";
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

/** 同一 query への再リクエストは決定的に同じ PNG を返すため CDN edge cache を効かせる。 */
const CACHE_CONTROL =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";

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
    const safeFilename = `${q.filename ? sanitizeFilename(q.filename) : "card"}.png`;

    const response = new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            background: OG_COLORS.winnerBg,
            color: OG_COLORS.winnerFg,
            fontFamily: OG_FONT_FAMILY,
            padding: OG_PADDING,
            border: `8px solid ${OG_COLORS.winnerBorder}`,
            boxSizing: "border-box",
          }}
        >
          <div
            style={{
              display: "flex",
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: 2,
            }}
          >
            TOURNAMENT CHAMPION
          </div>
          <div style={{ display: "flex", marginTop: 24, fontSize: 36, fontWeight: 700 }}>
            {q.tournamentName}
          </div>
          <div
            style={{
              display: "flex",
              marginTop: 8,
              fontSize: 24,
              opacity: 0.75,
            }}
          >
            {q.finishedAtLabel}
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              flex: 1,
            }}
          >
            <div style={{ display: "flex", fontSize: 28, opacity: 0.6 }}>WINNER</div>
            <div
              style={{
                display: "flex",
                marginTop: 12,
                fontSize: 120,
                fontWeight: 700,
                lineHeight: 1.1,
              }}
            >
              {q.winnerName}
            </div>
            <div style={{ display: "flex", marginTop: 16, fontSize: 28 }}>
              {q.participants} 人参加
            </div>
          </div>
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              fontSize: 22,
              opacity: 0.65,
            }}
          >
            ALLin-PokerTimer
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

    response.headers.set("cache-control", CACHE_CONTROL);
    response.headers.set(
      "content-disposition",
      `attachment; filename="${safeFilename}"`,
    );

    logger.info("og winner generated", { tid, ms: Date.now() - t0 });
    return response;
  } catch (e) {
    const wrapped = AppError.from(e, "og/render-failed", "結果カードの生成に失敗しました");
    logger.warn("og winner render failed", {
      tid,
      code: wrapped.code,
      origCode: getErrorCode(e),
    });
    return NextResponse.json(
      { code: wrapped.code, message: wrapped.message },
      { status: 500 },
    );
  }
}
