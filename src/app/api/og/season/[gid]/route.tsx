import { ImageResponse } from "next/og";
import { NextResponse, type NextRequest } from "next/server";

import { loadNotoSansJPCached } from "@/app/api/og/_lib/load-font";
import { fetchAsDataUri } from "@/app/api/og/_lib/og-image-fetch";
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
  readSeasonCardQuery,
  sanitizeFilename,
  SEASON_CARD_QUERY_SCHEMA,
} from "@/app/api/og/_lib/og-payload";
import { AppError, getErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Phase B: シーズン首位カード PNG 生成 route。Node.js runtime で `node:fs` 経由フォント読込。
 *
 *   - GET /api/og/season/[gid]?groupName=...&seasonStartDateLabel=...&top1Name=...&top1Points=...
 *     &top2Name=...&top2Points=...&top3Name=...&top3Points=...&filename=...
 *   - top2 / top3 は optional（stats が 1〜2 件のときは省略）
 *   - seasonStartDateLabel は key 不在で null 扱い（未開始シーズン）
 *   - 日付は client が端末 TZ で format 済み文字列を渡す（サーバ runtime TZ 非依存）
 */
export const runtime = "nodejs";

/** 同一 query への再リクエストは決定的に同じ PNG を返すため CDN edge cache を効かせる。 */
const CACHE_CONTROL =
  "public, max-age=300, s-maxage=86400, stale-while-revalidate=604800";

const MEDAL_LABEL = ["1ST", "2ND", "3RD"] as const;

function PodiumRow({
  rank,
  name,
  points,
  shadowStyle,
}: {
  rank: 0 | 1 | 2;
  name: string;
  points: number;
  /**
   * 背景画像時の text-shadow を spread するための object。
   * `{ textShadow?: string }`。undefined を直接 style に入れると Satori が
   * `.toString()` でクラッシュするため、必ず spread で渡す。
   */
  shadowStyle: { textShadow?: string };
}) {
  const fontSize = rank === 0 ? 64 : rank === 1 ? 52 : 44;
  const opacity = rank === 0 ? 1 : rank === 1 ? 0.92 : 0.82;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginTop: rank === 0 ? 0 : 16,
        opacity,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
        <div
          style={{
            display: "flex",
            width: 84,
            fontSize: 28,
            fontWeight: 700,
            color: OG_COLORS.seasonAccent,
            letterSpacing: 2,
            ...shadowStyle,
          }}
        >
          {MEDAL_LABEL[rank]}
        </div>
        <div
          style={{
            display: "flex",
            fontSize,
            fontWeight: 700,
            ...shadowStyle,
          }}
        >
          {name}
        </div>
      </div>
      <div
        style={{
          display: "flex",
          fontSize: rank === 0 ? 48 : 36,
          fontWeight: 700,
          color: OG_COLORS.seasonAccent,
          ...shadowStyle,
        }}
      >
        {points.toFixed(2)} pt
      </div>
    </div>
  );
}

export async function GET(
  req: NextRequest,
  ctx: { params: Promise<{ gid: string }> },
) {
  const t0 = Date.now();
  const { gid } = await ctx.params;
  try {
    const parsed = SEASON_CARD_QUERY_SCHEMA.safeParse(
      readSeasonCardQuery(req.nextUrl.searchParams),
    );
    if (!parsed.success) {
      logger.warn("og season invalid params", {
        gid,
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
    const startDateLabel = q.seasonStartDateLabel ?? "未設定";
    const safeFilename = `${q.filename ? sanitizeFilename(q.filename) : "card"}.png`;

    // Phase A.2: 背景画像が指定されたら fetch + base64 化。失敗時はグラデ fallback。
    const bgDataUri = q.bgImageUrl
      ? await fetchAsDataUri(q.bgImageUrl).catch((e) => {
          logger.warn("og season bg fetch failed", {
            gid,
            code: getErrorCode(e),
          });
          return null;
        })
      : null;
    const { fg, textShadow } = resolveCardTheme(
      !!bgDataUri,
      q.bgTextTheme,
      "season",
    );
    // Satori は `textShadow: undefined` を内部で `.toString()` するためクラッシュする
    // （winner route と同じ対策。条件 spread で key 自体を出し入れする）。
    const shadowStyle: { textShadow?: string } = textShadow
      ? { textShadow }
      : {};

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
              background: bgDataUri ? "transparent" : OG_COLORS.seasonBg,
              color: fg,
              fontFamily: OG_FONT_FAMILY,
              padding: OG_PADDING,
              boxSizing: "border-box",
              position: "relative",
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignSelf: "flex-start",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 36,
                  fontWeight: 700,
                  color: OG_COLORS.seasonAccent,
                  letterSpacing: 4,
                  ...shadowStyle,
                }}
              >
                SEASON LEADERBOARD
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 16,
                  fontSize: 48,
                  fontWeight: 700,
                  ...shadowStyle,
                }}
              >
                {q.groupName}
              </div>
              <div
                style={{
                  display: "flex",
                  marginTop: 8,
                  fontSize: 22,
                  color: OG_COLORS.seasonMuted,
                  ...shadowStyle,
                }}
              >
                シーズン開始: {startDateLabel}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
                justifyContent: "center",
              }}
            >
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignSelf: "stretch",
                }}
              >
                <PodiumRow
                  rank={0}
                  name={q.top1Name}
                  points={q.top1Points}
                  shadowStyle={shadowStyle}
                />
                {q.top2Name !== undefined && q.top2Points !== undefined ? (
                  <PodiumRow
                    rank={1}
                    name={q.top2Name}
                    points={q.top2Points}
                    shadowStyle={shadowStyle}
                  />
                ) : null}
                {q.top3Name !== undefined && q.top3Points !== undefined ? (
                  <PodiumRow
                    rank={2}
                    name={q.top3Name}
                    points={q.top3Points}
                    shadowStyle={shadowStyle}
                  />
                ) : null}
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignSelf: "flex-end",
              }}
            >
              <div
                style={{
                  display: "flex",
                  fontSize: 22,
                  color: OG_COLORS.seasonMuted,
                  ...shadowStyle,
                }}
              >
                ALLin-PokerTimer
              </div>
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

    response.headers.set("cache-control", CACHE_CONTROL);
    response.headers.set(
      "content-disposition",
      `attachment; filename="${safeFilename}"`,
    );

    logger.info("og season generated", { gid, ms: Date.now() - t0 });
    return response;
  } catch (e) {
    const wrapped = AppError.from(e, "og/render-failed", "結果カードの生成に失敗しました");
    logger.warn("og season render failed", {
      gid,
      code: wrapped.code,
      origCode: getErrorCode(e),
    });
    return NextResponse.json(
      { code: wrapped.code, message: wrapped.message },
      { status: 500 },
    );
  }
}
