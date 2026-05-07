# Plan: Phase B — Result Card Generation

## Summary

優勝（トーナメント終了）/ シーズン首位（ランキング画面）の 2 種を **PNG 画像として SSR 生成し、ダウンロードボタン経由で保存** できるようにする。`@vercel/og`（Next.js 15 同梱の `next/og`）の `ImageResponse` を Node.js runtime の Route Handler から返し、`@fontsource/noto-sans-jp` で日本語フォントを埋込む。データは「すでに Firestore を読込済みのクライアント」がクエリ文字列に詰めて渡す client-pass-data 方式に倒し、Phase B では server 側で Firebase Admin SDK / ID Token 検証を導入しない（理由は後述、Phase D 以降の課題として明示）。

## User Story

As a サークル参加メンバー（owner / organizer / member、認証済），
I want トーナメント終了直後の Winner 画面とシーズンランキング画面に「画像保存」ボタンが出る,
So that 手動スクリーンショットなしで LINE / X に貼れる見栄えの良い PNG を 1 タップで取得できる。

## Problem → Solution

**Current state**:

- Winner 画面・シーズンランキング画面は HTML で表示されるのみ。SNS 共有はスマホのスクショ手動撮影で対応している。
- `@vercel/og` / `next/og` 系の依存はまだ無く、画像生成 route は 1 本も存在しない（[`Glob src/app/**/route.ts` で 0 件](#mandatory-reading)）。
- Phase A で `seasonStats` 集計基盤と `seasonStartDate` 表示は揃ったが、SNS 共有導線が未完。

**Desired state**:

- `app/api/og/winner/[tid]/route.tsx` と `app/api/og/season/[gid]/route.tsx` の 2 route が PNG を返す。
- WinnerBanner / SeasonRankingClient に `<a download>` ボタンを追加し、クライアント側で query 文字列を組み立てて画像を取得 → ブラウザの保存ダイアログを起動する。
- 日本語フォントは `@fontsource/noto-sans-jp` の Bold/Regular TTF を `ImageResponse` の `fonts` に渡す（Satori 制約: WOFF2 不可、TTF/OTF/WOFF のみ）。
- 観戦モードが未実装な現状、データの「真の検閲」はせず UI 起点の認証済みフローで担保（後述の Risk セクションで tradeoff 明示）。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md)
- **PRD Phase**: Phase B — Result Card Generation
- **Stage scope**: 依存追加 2 件 / フォント asset 配置 / route 2 件新設 / 純関数 1 件（query 組み立て） / UI 2 箇所 (WinnerBanner / SeasonRankingClient) / UT 4 ファイル / docs 軽微
- **Estimated Files**: 約 12 files

---

## UX Design

### Before（Phase A 完了時点）

```
/tournaments/[tid] (state="finished")
┌────────────────────────────────────────────┐
│ 🏆  Alice                                  │   ← WinnerBanner
└────────────────────────────────────────────┘

/groups/[gid]/season
┌────────────────────────────────────────────┐
│ シーズンランキング — サタデーサークル      │
│ 1. Alice  47.83 pt                         │
│ 2. Bob    28.12 pt                         │
│ ...                                        │
└────────────────────────────────────────────┘

→ SNS 共有はスクショ手動。ボタンなし。
```

### After

```
/tournaments/[tid] (state="finished")
┌────────────────────────────────────────────┐
│ 🏆  Alice                                  │
│                  [画像を保存] ← 新規ボタン │
└────────────────────────────────────────────┘
        ↓ クリック
┌─ 1200×630 PNG ────────────────────────────┐
│  🏆 OPTIMAL CHAMPION                       │
│                                            │
│  サタデートーナメント #12                  │
│  2026-05-06                                │
│                                            │
│         Alice                              │
│         （8 人参加）                       │
│                                            │
│              ALLin-PokerTimer              │
└────────────────────────────────────────────┘

/groups/[gid]/season
┌────────────────────────────────────────────┐
│ シーズンランキング — サタデーサークル      │
│         [シーズン首位カードを保存] ← 新規  │
│ 1. Alice  47.83 pt                         │
│ ...                                        │
└────────────────────────────────────────────┘
        ↓ クリック
┌─ 1200×630 PNG ────────────────────────────┐
│  シーズン首位                              │
│  サタデーサークル                          │
│  シーズン開始: 2026-04-01                  │
│                                            │
│  🥇 Alice    47.83 pt                      │
│  🥈 Bob      28.12 pt                      │
│  🥉 Carol    19.66 pt                      │
│                                            │
│              ALLin-PokerTimer              │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| Winner 画面 | バナーのみ | バナー + 「画像を保存」ボタン | `winner === null` 時はボタン非表示。ボタンは認証済みのみ表示（`useAuthUser` 経由） |
| シーズンランキング画面 | 順位表のみ | 順位表 + 「シーズン首位カードを保存」ボタン | `stats.length === 0` 時はボタン非表示。group メンバーのみ表示（`useGroupRole` で判定） |
| URL `/api/og/winner/[tid]` | 不在 | GET 200 image/png | query: `winnerName` / `tournamentName` / `participants` / `finishedAt` |
| URL `/api/og/season/[gid]` | 不在 | GET 200 image/png | query: `groupName` / `seasonStartDate` / `top1Name` / `top1Points` / `top2Name?` / `top2Points?` / `top3Name?` / `top3Points?` |
| 観戦モード | 未実装（変更なし） | 未実装のまま | Phase B では未対応。Risk セクション参照 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | all | Firestore SDK は repository 経由のみ → 本 phase の route handler は server で直接 Firestore を触らないことが規約と整合する判断材料 |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | route handler でも `AppError` ラップと `logger.warn`/`info` 経由ログ。新規 prefix `og/*`（`og/invalid-params` / `og/render-failed`）を導入 |
| P0 (critical) | [.claude/rules/security-base.md](../../../rules/security-base.md) | all | サークル固有データのコミット禁止 — フォント TTF はパッケージから供給する（リポジトリへ大きいバイナリを直 push しない選択を再確認） |
| P0 (critical) | [.claude/rules/security-env.md](../../../rules/security-env.md) | all | `NEXT_PUBLIC_*` の取扱い。本 phase では Firebase Admin SDK / Service Account を導入**しない**判断の根拠 |
| P0 (critical) | [.claude/rules/testing.md](../../../rules/testing.md) | all | mock 境界（route handler を「helper 境界」で split）、UT 責務分担、`fakeTournament` factory pattern |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md) | 197-207 | Phase B Goal / Scope / Success signal の真実源 |
| P0 (critical) | [.claude/PRPs/02-season-stats-and-share/plans/completed/phase-a-season-stats-foundation.plan.md](completed/phase-a-season-stats-foundation.plan.md) | all | 直前 phase の成果物：`SeasonStatsDoc` / `seasonStartDate` / `resolveRanking` / `WinnerBanner` の参照点 |
| P0 (critical) | [src/components/tournament/WinnerBanner.tsx](../../../../src/components/tournament/WinnerBanner.tsx) | all | 現行 WinnerBanner（presentational）。本 phase では「ボタンを **隣接 component に配置**」する形で改修（既存 prop 契約は壊さない） |
| P0 (critical) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/%5Btid%5D/dashboard-client.tsx) | 53, 134-135, 353 | `resolveWinner(data, players)` で winner を導出 → `WinnerBanner` に渡す既存呼出。本 phase で **ボタン配置先**となる |
| P0 (critical) | [src/app/tournaments/[tid]/live/live-client.tsx](../../../../src/app/tournaments/%5Btid%5D/live/live-client.tsx) | 27, 133, 176 | live 画面の WinnerBanner 表示。本 phase ではこちらにも同等のボタンを置くか判断（後述 Decision） |
| P0 (critical) | [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/%5Bgid%5D/season/season-ranking-client.tsx) | all | シーズンランキング画面（Phase A 新設）。`stats[]` を `totalPoints desc` で表示済 → 本 phase でボタン配置 |
| P0 (critical) | [src/lib/firebase/schemas/seasonStats.ts](../../../../src/lib/firebase/schemas/seasonStats.ts) | all | `SeasonStatsDoc.totalPoints` は number（小数 2 桁）。クライアントが query 文字列に詰める際の format 規約 |
| P0 (critical) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 92-97 | `seasonStartDate: Timestamp \| null`。query 文字列には `Timestamp.toDate().toISOString()` で渡す |
| P0 (critical) | [src/lib/firebase/schemas/tournament.ts](../../../../src/lib/firebase/schemas/tournament.ts) | 25-55 | `TournamentDoc.name` / `finishedAt` のフォーマット規約 |
| P0 (critical) | [src/lib/firebase/schemas/player.ts](../../../../src/lib/firebase/schemas/player.ts) | all | `PlayerDoc.displayName` の上限。query 文字列の文字数 cap で同じ規約に揃える |
| P0 (critical) | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | 79-90, 104-134 | `resolveWinner` / `resolveRanking` 純関数（既存）。クライアント側でこれを使ってボタン用の payload を組み立てる |
| P0 (critical) | [src/lib/errors.ts](../../../../src/lib/errors.ts) | all | `AppError` / `unwrapOrFrom` / `getErrorCode`。route handler でも同じパターンで wrap |
| P0 (critical) | [src/lib/logger.ts](../../../../src/lib/logger.ts) | all | route handler 内のログも logger 経由（`console.*` 禁止規約） |
| P0 (critical) | [next.config.ts](../../../../next.config.ts) | all | 既存 config は最小構成。route handler 追加で変更不要なことを確認する真実源 |
| P0 (critical) | [package.json](../../../../package.json) | all | `next 15.1.6` / `react 19` / `zod 4`。`@fontsource/noto-sans-jp` 追加先 |
| P0 (critical) | [.claude/commands/prp-commit.md](../../../commands/prp-commit.md) | all | コミットメッセージ規約（type prefix のみ英語） |
| P1 (important) | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | all | `useGroupRole` / `useAuthUser` の typical 呼び出し例 — ボタン visibility 判定の mirror |
| P1 (important) | [src/lib/hooks/useGroupRole.ts](../../../../src/lib/hooks/useGroupRole.ts) | all | 任意 gid の role 導出（`useGroupRole(gid)` → `{ role }`）。ボタン visibility に使う |
| P1 (important) | [src/lib/firebase/AuthProvider.tsx](../../../../src/lib/firebase/AuthProvider.tsx) | all | `useAuthUser()` の loading/user 形 — ボタン disabled 判定 |
| P1 (important) | [src/components/ui/button.tsx](../../../../src/components/ui/button.tsx) | all | shadcn Button の variant / size。ダウンロードボタンは `<Button asChild>` + `<a download>` 構成 |
| P1 (important) | [.claude/PRPs/02-season-stats-and-share/reports/phase-a-season-stats-foundation-report.md](../../reports/02-season-stats-and-share/phase-a-season-stats-foundation-report.md) | all | Phase A の確定 deviation（client-clock Timestamp 等）— Phase B の input format 期待値の真実源 |
| P2 (reference) | [src/lib/firebase/repositories/seasonStats.ts](../../../../src/lib/firebase/repositories/seasonStats.ts) | all | `subscribeSeasonStats` の戻り値構造（`stats[]` の sort 済み前提）— ボタン側で top 3 を slice する根拠 |
| P2 (reference) | [src/components/tournament/WinnerBanner.tsx](../../../../src/components/tournament/WinnerBanner.tsx) | all | 既存の `WinnerBanner` を bordered 装飾の参考にする（PNG render 内のスタイル mirror）|

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Next.js 15 `ImageResponse` | https://nextjs.org/docs/app/api-reference/functions/image-response | Route Handler から `ImageResponse(jsx, { width, height, fonts })` を `Response` として直接返せる。Edge / Node.js 両 runtime 対応 |
| `@vercel/og` | https://www.npmjs.com/package/@vercel/og | Next.js 13.3+ は `next/og` から再エクスポートされ、`@vercel/og` を直接 install しなくても利用可。本 phase では `next/og` のみで完結 |
| Vercel OG Image API | https://vercel.com/docs/functions/og-image-generation/og-image-api | フォントは Latin 以外を渡す場合 `fonts` で明示。WOFF2 は不可（Satori が brotli を解けない） |
| Noto Sans JP（Google Fonts） | https://fonts.google.com/noto/specimen/Noto+Sans+JP | Regular / Bold の 2 weight があれば本 phase の用途は十分 |
| `@fontsource/noto-sans-jp` | https://www.npmjs.com/package/@fontsource/noto-sans-jp | npm 経由で TTF を `node_modules/@fontsource/noto-sans-jp/files/*.ttf` として供給。`fs.readFileSync` または `fetch(new URL(...))` で読込み |

```
KEY_INSIGHT: ImageResponse は Edge / Node.js 両 runtime で動く。Phase B では Node.js runtime (`export const runtime = "nodejs"`) を採用する。理由: (1) `fs.readFileSync` でフォントを同期読込みできテストが楽 (2) Edge bundle サイズ制限 (1MB) を意識せずに済む (3) Vercel Hobby の Node.js function は invocation/duration 上限内で十分 (本アプリの月 1〜2 開催 × 数回押下では限界に達さない)
APPLIES_TO: Task 4 / Task 5 (route handler 実装)
GOTCHA: Edge runtime と違い Node.js runtime は cold start が遅い (~200-500ms)。SNS 投稿前の準備という UX 上、初回押下が遅延する点は容認 (ボタン側で「生成中…」表示)
```

```
KEY_INSIGHT: ImageResponse の jsx は **flexbox 必須**（`display: flex` でない要素を子に並べると render error）。Tailwind class は使えず、すべて inline style で書く。Satori の制約。
APPLIES_TO: Task 4 / Task 5 の jsx 部分
GOTCHA: 改行は `<div style={{ display: "flex", flexDirection: "column" }}>` 等、明示的な flex で組む
```

```
KEY_INSIGHT: route handler に渡す query 文字列は信頼できない。本 phase は `zod.parse()` で必ず入口検証する（文字数 cap / 数値範囲 / ISO date format）。検証失敗時は 400 を返し、payload を logger.warn に残す。
APPLIES_TO: Task 3 (query schema 純関数), Task 4 / Task 5 (route handler 入口)
GOTCHA: zod 4 系の `.coerce.number()` は string→number 変換するが、`coerce` 経由は範囲外 / NaN を弾けないため `.refine` または明示的な `Number(x)` + `.refine(Number.isFinite)` を組み合わせる
```

```
KEY_INSIGHT: 本 phase の route handler は Firestore を読まない。データは認証済みクライアントが query 文字列で渡す。これは「観戦モード未実装で group メンバー限定で十分」という PRD 判断（[02-season-stats-and-share.prd.md#L206](../../prds/02-season-stats-and-share.prd.md)）と整合する。
APPLIES_TO: Architecture 全般 (Approach セクション参照)
GOTCHA: query 文字列を改竄すれば任意の文字列で画像を作れる。データ流出ではないが「偽の優勝者カード」を作れる点は Risks に明示し、Phase D 以降で Firebase Admin SDK + ID Token verify を検討する
```

```
KEY_INSIGHT: `<a href="/api/og/winner/[tid]?..." download="winner.png">` で多くのブラウザは保存ダイアログを開く。iOS Safari は新規タブ表示になるが、長押しで保存可能（Phase D で Web Share API fallback を追加する想定）。
APPLIES_TO: Task 6 / Task 7 (UI ボタン)
GOTCHA: `download` 属性が同一 origin / 同一 site 経由でしか効かないブラウザもあるため、route は **Next.js のサブパス上** に置く（外部 CDN ではない）
```

---

## Patterns to Mirror

### NAMING_CONVENTION（route handler のディレクトリ）

```
// SOURCE: 既存 route なし。新規パターンとして導入
src/app/api/og/winner/[tid]/route.tsx     // GET 1 種類のみ
src/app/api/og/season/[gid]/route.tsx     // GET 1 種類のみ
src/app/api/og/_assets/                   // ローカル font asset (使う場合)
src/app/api/og/_lib/og-payload.ts         // クライアント / サーバ共通の zod schema + URL 組み立て純関数
src/app/api/og/_lib/og-payload.test.ts
src/app/api/og/_lib/og-card-styles.ts     // ImageResponse 内で再利用する style 定数
src/app/api/og/_lib/load-font.ts          // フォント読込み helper（runtime: nodejs）
```

`_assets/` / `_lib/` は Next.js の "private folders" 規約（先頭 `_`）でルーティング対象外。テストファイルは route 同居 OK。

### ERROR_HANDLING（route handler）

```typescript
// SOURCE: 既存 route なし。error-logging.md 規約に従い AppError + logger 経由で書く
import { NextResponse, type NextRequest } from "next/server";
import { AppError, getErrorCode } from "@/lib/errors";
import { logger } from "@/lib/logger";

export async function GET(req: NextRequest, ctx: { params: Promise<{ tid: string }> }) {
  try {
    const { tid } = await ctx.params;
    const parsed = winnerCardQuerySchema.safeParse(
      Object.fromEntries(req.nextUrl.searchParams),
    );
    if (!parsed.success) {
      logger.warn("og winner invalid params", {
        tid,
        issues: parsed.error.issues.map((i) => i.message),
      });
      return NextResponse.json(
        { code: "og/invalid-params", message: "クエリ文字列が不正です" },
        { status: 400 },
      );
    }
    return await renderWinnerCard(tid, parsed.data);
  } catch (e) {
    const wrapped = AppError.from(e, "og/render-failed", "結果カードの生成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    return NextResponse.json(
      { code: wrapped.code, message: wrapped.message },
      { status: 500 },
    );
  }
}
```

### LOGGING_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:68 等の既存 logger.info usage
logger.info("og winner generated", { tid, ms: Date.now() - t0 });
logger.warn("og winner invalid params", { tid, code: "og/invalid-params" });
```

### TYPE_DEFINITIONS（zod schema を server / client で共有）

```typescript
// SOURCE: src/lib/firebase/schemas/seasonStats.ts:14-32 の z.object → Doc 型 export パターン

// src/app/api/og/_lib/og-payload.ts
import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";

export const WINNER_CARD_QUERY_SCHEMA = z.object({
  winnerName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  tournamentName: z.string().min(1).max(60),  // tournament.name の zod max
  participants: z.coerce.number().int().min(1).max(60),
  finishedAt: z.string().datetime(),  // ISO 8601 (toISOString())
});
export type WinnerCardQuery = z.infer<typeof WINNER_CARD_QUERY_SCHEMA>;

export function buildWinnerCardUrl(tid: string, q: WinnerCardQuery): string {
  const sp = new URLSearchParams({
    winnerName: q.winnerName,
    tournamentName: q.tournamentName,
    participants: String(q.participants),
    finishedAt: q.finishedAt,
  });
  return `/api/og/winner/${encodeURIComponent(tid)}?${sp.toString()}`;
}
```

シーズン側も同パターン（top1〜top3 + groupName + seasonStartDate）。

### IMAGE_RESPONSE_PATTERN（route handler 本体）

```typescript
// SOURCE: 新規パターン。Next.js docs https://nextjs.org/docs/app/api-reference/functions/image-response から派生

import { ImageResponse } from "next/og";

export const runtime = "nodejs";  // KEY_INSIGHT 参照

const WIDTH = 1200;
const HEIGHT = 630;

export async function GET(req, ctx) {
  /* ... validate query ... */
  const [bold, regular] = await Promise.all([
    loadNotoSansJP("Bold"),
    loadNotoSansJP("Regular"),
  ]);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
          color: "#451a03",
          fontFamily: "Noto Sans JP",
          padding: 64,
        }}
      >
        <div style={{ display: "flex", fontSize: 48, fontWeight: 700 }}>🏆 OPTIMAL CHAMPION</div>
        <div style={{ display: "flex", marginTop: 24, fontSize: 32 }}>{q.tournamentName}</div>
        <div style={{ display: "flex", marginTop: 12, fontSize: 24, opacity: 0.8 }}>
          {new Date(q.finishedAt).toLocaleDateString("ja-JP")}
        </div>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            flex: 1,
            fontSize: 96,
            fontWeight: 700,
          }}
        >
          {q.winnerName}
        </div>
        <div style={{ display: "flex", fontSize: 20, opacity: 0.6 }}>
          {q.participants} 人参加 · ALLin-PokerTimer
        </div>
      </div>
    ),
    {
      width: WIDTH,
      height: HEIGHT,
      fonts: [
        { name: "Noto Sans JP", data: regular, weight: 400, style: "normal" },
        { name: "Noto Sans JP", data: bold, weight: 700, style: "normal" },
      ],
    },
  );
}
```

### LOAD_FONT_PATTERN

```typescript
// SOURCE: 新規パターン。@fontsource/noto-sans-jp の TTF を node_modules から読む
// src/app/api/og/_lib/load-font.ts
import { readFile } from "node:fs/promises";
import path from "node:path";

const FONT_FILES: Record<"Regular" | "Bold", string> = {
  // @fontsource/noto-sans-jp 5.x のディレクトリレイアウト
  Regular: "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.ttf",
  Bold: "@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.ttf",
};

export async function loadNotoSansJP(weight: "Regular" | "Bold"): Promise<ArrayBuffer> {
  const rel = FONT_FILES[weight];
  const abs = path.join(process.cwd(), "node_modules", rel);
  const buf = await readFile(abs);
  // Buffer.buffer は SharedArrayBuffer 互換のため slice で copy する
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
}
```

GOTCHA: Vercel の Node.js function は `node_modules/@fontsource/...` を bundle に含める必要がある。Next.js の serverComponentsExternalPackages はデフォルトで `node_modules` を bundle するので追加設定不要。確認するために Task 4 で `npm run build` の Route handler size を観察する。

### DOWNLOAD_BUTTON_PATTERN（クライアント UI）

```typescript
// SOURCE: 新規パターン。shadcn Button + <a download>。既存 InviteCodeCard 等は <Link> + <Button asChild>
import { Button } from "@/components/ui/button";

interface Props {
  tid: string;
  winnerName: string;
  tournamentName: string;
  participants: number;
  finishedAt: Date;
}

export function WinnerCardDownloadButton({
  tid, winnerName, tournamentName, participants, finishedAt,
}: Props) {
  const url = buildWinnerCardUrl(tid, {
    winnerName,
    tournamentName,
    participants,
    finishedAt: finishedAt.toISOString(),
  });
  // <a download> は同一 origin で動作。filename は tournament 名 + 日付ベース
  const filename = `winner-${tournamentName}-${finishedAt.toISOString().slice(0, 10)}.png`;
  return (
    <Button asChild size="sm" variant="default">
      <a href={url} download={filename}>画像を保存</a>
    </Button>
  );
}
```

### TEST_STRUCTURE（純関数 + route handler）

```typescript
// SOURCE: src/lib/services/season-points.test.ts:1-50 の z.object→pure function テスト構造
import { describe, expect, it } from "vitest";

import { WINNER_CARD_QUERY_SCHEMA, buildWinnerCardUrl } from "./og-payload";

describe("WINNER_CARD_QUERY_SCHEMA", () => {
  it("通常入力を pass する", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "Alice",
      tournamentName: "サタデー",
      participants: "8",
      finishedAt: "2026-05-06T12:00:00.000Z",
    });
    expect(r.success).toBe(true);
  });

  it("displayName 16 文字超過は reject", () => {
    const r = WINNER_CARD_QUERY_SCHEMA.safeParse({
      winnerName: "あいうえおかきくけこさしすせそたちつてとなにぬねの",  // > 15
      tournamentName: "サタデー",
      participants: "8",
      finishedAt: "2026-05-06T12:00:00.000Z",
    });
    expect(r.success).toBe(false);
  });
});
```

route handler の UT は薄く（200/400 status と content-type のみ assert）。実際の PNG bytes 検証は E2E 任意。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `package.json` | UPDATE | `@fontsource/noto-sans-jp` 追加（`next/og` は next 同梱なので追加不要を確認）|
| `src/app/api/og/_lib/og-payload.ts` | CREATE | クライアント/サーバ共有の zod schema + URL 組立純関数 |
| `src/app/api/og/_lib/og-payload.test.ts` | CREATE | 純関数 UT |
| `src/app/api/og/_lib/og-card-styles.ts` | CREATE | 色 / フォントサイズ / padding の constants（マジック値を 1 箇所に集約） |
| `src/app/api/og/_lib/load-font.ts` | CREATE | Noto Sans JP TTF を node_modules から読む helper |
| `src/app/api/og/winner/[tid]/route.tsx` | CREATE | 優勝カード生成 route |
| `src/app/api/og/winner/[tid]/route.test.ts` | CREATE | route 200/400/500 のステータステスト |
| `src/app/api/og/season/[gid]/route.tsx` | CREATE | シーズン首位カード生成 route |
| `src/app/api/og/season/[gid]/route.test.ts` | CREATE | 同 |
| `src/components/tournament/WinnerCardDownloadButton.tsx` | CREATE | 「画像を保存」ボタン（再利用可能） |
| `src/components/tournament/WinnerCardDownloadButton.test.tsx` | CREATE | URL が正しく組まれて `<a download>` に入るかの UT |
| `src/components/group/SeasonTopCardDownloadButton.tsx` | CREATE | シーズン首位カードボタン |
| `src/components/group/SeasonTopCardDownloadButton.test.tsx` | CREATE | 同 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | WinnerBanner の隣にダウンロードボタンを差込（[L353](../../../../src/app/tournaments/%5Btid%5D/dashboard-client.tsx) 周辺） |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 同等のボタンを追加（live 画面でも optimal champion を共有したいケース） |
| `src/app/groups/[gid]/season/season-ranking-client.tsx` | UPDATE | ランキング画面冒頭にボタンを追加（`stats.length > 0` のとき） |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` | UPDATE | Phase B 進捗を `pending` → `in-progress` に変え、本 plan へリンク |
| `README.md` | UPDATE | scripts 表に変更なし。`@vercel/og` / `@fontsource/noto-sans-jp` 追加を必要なら新規依存セクションに追記 |

## NOT Building

- **Web Share API 経由の OS シェアシート起動** — Phase D 担当（[PRD Implementation Phases](../../prds/02-season-stats-and-share.prd.md#L177)）。Phase B は単純な `<a download>` のみ。
- **html2canvas 経由のクライアント側画像生成** — `@vercel/og` SSR に統一する PRD Decision に従う（[PRD What We're NOT Building](../../prds/02-season-stats-and-share.prd.md#L41)）。
- **Firebase Admin SDK / Service Account による server 側 ID Token 検証** — 大きな infra 追加になるため Phase B では導入しない。Risk セクションに tradeoff 明示。
- **OGP メタタグ / X Card 専用最適化** — PRD で明示的に Won't（[PRD#L39](../../prds/02-season-stats-and-share.prd.md)）。
- **観戦モード（spectator URL）/ 非ログイン経由のカード DL** — PRD で観戦モード未実装。本 phase でも導入しない。
- **シーズン履歴の任意月カード生成** — Phase B は「現在シーズンの首位」のみ。past season UI は Phase D で polish 想定。
- **SSR 経路での Firestore 読込み** — repository 層は client-only 規約（[firebase-patterns.md](../../../rules/firebase-patterns.md)）。route handler は Firestore に触らない。
- **Rate limiting / spam 対策** — Phase B では入れず、観測ベース。abuse コストは「偽画像生成」のみで実害が小さい。

---

## Step-by-Step Tasks

### Task 1: 依存追加（@fontsource/noto-sans-jp）

- **ACTION**: `package.json` に `@fontsource/noto-sans-jp` を追加し install。`@vercel/og` は next 同梱（`next/og`）なので**追加不要**を ranking する
- **IMPLEMENT**:
  - `npm i @fontsource/noto-sans-jp` を実行（settings.local.json の ask 規約に従って permission prompt 経由で承認）
  - 念のため `next/og` が next 15.1 で利用可能か確認（`node -p "require('next/og')"` で smoke check）
- **MIRROR**: 過去 phase の依存追加（`@radix-ui/react-dialog` 等）。`security-base.md` の依存追加 ask モードに従う
- **IMPORTS**: なし（package.json のみ）
- **GOTCHA**: `@fontsource/noto-sans-jp` は subset 単位でファイルが分かれている。`japanese-400-normal.ttf` / `japanese-700-normal.ttf` の 2 weight だけを使う（それ以外の latin / vietnamese は読込まない）。bundle には含まれるが route 内では読まない選択
- **VALIDATE**:
  - `npm run typecheck` PASS
  - `node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.ttf` が存在
  - `node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.ttf` が存在

### Task 2: og-card-styles 定数

- **ACTION**: `src/app/api/og/_lib/og-card-styles.ts` を作成し、両カード共通の色 / 寸法 / フォントサイズを export
- **IMPLEMENT**:
  ```typescript
  export const OG_WIDTH = 1200;
  export const OG_HEIGHT = 630;

  export const COLORS = {
    winnerBg: "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)",
    winnerFg: "#451a03",
    seasonBg: "linear-gradient(135deg, #1e3a8a 0%, #312e81 100%)",
    seasonFg: "#fef3c7",
    seasonAccent: "#fde68a",
  } as const;

  export const FONT_FAMILY = "Noto Sans JP";
  export const PADDING = 64;
  ```
- **MIRROR**: `src/lib/limits.ts` の単一真実源パターン
- **IMPORTS**: なし
- **GOTCHA**: ImageResponse は **Tailwind 不可**。すべて inline style → 値を constants に集約しないと drift する
- **VALIDATE**: `npm run typecheck` PASS

### Task 3: og-payload zod schema + URL builder + テスト

- **ACTION**: 両カードの query schema、URL 組立純関数、最大文字数 cap を 1 箇所に集約
- **IMPLEMENT**:
  ```typescript
  // src/app/api/og/_lib/og-payload.ts
  import { z } from "zod";
  import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";

  const TOURNAMENT_NAME_MAX = 60;          // tournament.name の zod max
  const SEASON_GROUP_NAME_MAX = 60;        // group.name の zod max

  export const WINNER_CARD_QUERY_SCHEMA = z.object({
    winnerName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    tournamentName: z.string().min(1).max(TOURNAMENT_NAME_MAX),
    participants: z.coerce.number().int().min(1).max(60),
    finishedAt: z.string().datetime(),
  });

  export const SEASON_CARD_QUERY_SCHEMA = z.object({
    groupName: z.string().min(1).max(SEASON_GROUP_NAME_MAX),
    seasonStartDate: z.string().datetime().nullable(),  // null=未設定
    top1Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    top1Points: z.coerce.number().min(0).max(99999),
    top2Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
    top2Points: z.coerce.number().min(0).max(99999).optional(),
    top3Name: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH).optional(),
    top3Points: z.coerce.number().min(0).max(99999).optional(),
  });

  export function buildWinnerCardUrl(tid: string, q: WinnerCardQuery) { ... }
  export function buildSeasonCardUrl(gid: string, q: SeasonCardQuery) { ... }
  ```
  + 対応する `og-payload.test.ts` で各 schema の通常 / 境界 / reject ケースを 6〜10 件程度
- **MIRROR**: [season-points.test.ts](../../../../src/lib/services/season-points.test.ts) の純関数テスト構造
- **IMPORTS**: `zod`, `@/lib/firebase/schemas/group` (DISPLAY_NAME_MAX_LENGTH)
- **GOTCHA**:
  - `seasonStartDate` は `null` を許容（Phase A の group.seasonStartDate `null` セマンティクスに合わせる）。schema の `.datetime().nullable()` で表現
  - URL builder は `null` のとき `seasonStartDate=null` という string を出さず、key ごと省く。受信側は `searchParams.get("seasonStartDate") ?? null` で復元
- **VALIDATE**: `npm test src/app/api/og/_lib` 全 PASS

### Task 4: load-font helper

- **ACTION**: `src/app/api/og/_lib/load-font.ts` で Noto Sans JP の TTF を ArrayBuffer として読む
- **IMPLEMENT**: 上述「LOAD_FONT_PATTERN」を実装。Bold / Regular の 2 weight を分離。Module 内で `Promise.all` でキャッシュ可能（route handler が複数回呼ばれても同一プロセス内で再 read 不要）
  ```typescript
  let cache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;
  export async function loadNotoSansJPCached() {
    if (cache) return cache;
    const [regular, bold] = await Promise.all([
      loadNotoSansJP("Regular"),
      loadNotoSansJP("Bold"),
    ]);
    cache = { regular, bold };
    return cache;
  }
  ```
- **MIRROR**: 既存パターン無し。新規だが KISS / read-only / プロセス内 cache。`AppError` で wrap して上位に渡す
- **IMPORTS**: `node:fs/promises`, `node:path`
- **GOTCHA**:
  - Edge runtime では `node:fs` 不可。**`runtime = "nodejs"` を route 側で必ず指定する**こと
  - Vercel の serverless function bundle では `process.cwd()` がプロジェクトルート。`node_modules` 直下の TTF は bundle に含める必要あり → Next.js のデフォルト動作で OK。`outputFileTracingRoot` 等の設定は不要
- **VALIDATE**:
  - `tsc` PASS
  - 開発 server 起動して route を 1 回叩き、TTF が読めて image が返るかを目視（Task 4 とは別 commit、Task 5 で route と一緒に確認）

### Task 5: winner card route

- **ACTION**: `src/app/api/og/winner/[tid]/route.tsx` を実装
- **IMPLEMENT**: 上記「ERROR_HANDLING」+ 「IMAGE_RESPONSE_PATTERN」 を組み合わせ。`runtime = "nodejs"` を export。jsx は `WinnerBanner` の amber 系ビジュアルを mirror（gradient amber + 大きく winner name + tournament name + 参加人数 + 日付）
- **MIRROR**:
  - エラー処理 → [.claude/rules/error-logging.md](../../../rules/error-logging.md)（`AppError.from` + `og/render-failed` prefix）
  - 視覚デザイン → [src/components/tournament/WinnerBanner.tsx](../../../../src/components/tournament/WinnerBanner.tsx) の色味（amber-100 → yellow-200）
- **IMPORTS**: `next/og` (ImageResponse), `next/server` (NextRequest, NextResponse), `@/lib/errors`, `@/lib/logger`, `@/app/api/og/_lib/og-payload`, `@/app/api/og/_lib/load-font`, `@/app/api/og/_lib/og-card-styles`
- **GOTCHA**:
  - 子要素は **すべて `display: flex`** にする（Satori 制約）
  - emoji（🏆）は OS フォントが無いため、SVG 代替を使うか `emoji` プロパティで `twemoji` 等を指定。Phase B では `🏆` を文字として描画して FAIL したら U+1F3C6 の SVG 埋込にフォールバック
  - 1200×630 PNG は 100〜300 KB 前後。Vercel Hobby の Edge limit 4.5MB / Node.js 50MB 共に余裕
- **VALIDATE**:
  - `npm test src/app/api/og/winner` で 200/400/500 status の薄いテスト PASS
  - `npm run dev` で `http://localhost:3000/api/og/winner/test?winnerName=Alice&tournamentName=サタデー&participants=8&finishedAt=2026-05-06T12:00:00.000Z` が画像を返すこと（手動）
  - 不正な query で 400 が返ること（手動 + UT）

### Task 6: season card route

- **ACTION**: `src/app/api/og/season/[gid]/route.tsx` を実装
- **IMPLEMENT**: Task 5 と同パターン、ジオメトリは「上 1/3 にタイトル + groupName + 開始日、中央 2/3 に top1〜top3」。デザインは PRD UX デザインの ASCII 図を再現
- **MIRROR**: Task 5
- **IMPORTS**: 同上 + season schema
- **GOTCHA**:
  - `top2` / `top3` が undefined のとき行ごと省く。flex layout で空行を作らない
  - `seasonStartDate` が null のとき「未設定」と表示
- **VALIDATE**: 同パターン

### Task 7: WinnerCardDownloadButton + テスト

- **ACTION**: `src/components/tournament/WinnerCardDownloadButton.tsx` を作成
- **IMPLEMENT**: 上記「DOWNLOAD_BUTTON_PATTERN」をそのまま実装。`Button asChild` + `<a download>`。filename は安全文字に sanitize（`/` や `?` を `_` に置換）
- **MIRROR**: [src/components/group/InviteCodeCard.tsx](../../../../src/components/group/InviteCodeCard.tsx) の Button asChild + Link パターン
- **IMPORTS**: `@/components/ui/button`, `@/app/api/og/_lib/og-payload` の URL builder
- **GOTCHA**:
  - 認証済み・winner 確定のときのみ表示。呼出側（dashboard-client.tsx）で gate する
  - filename に日本語が含まれる場合、Safari は ASCII fallback する。Phase B では sanitize して半角英数 + ハイフンのみに固定（`tournamentName.replace(/[^A-Za-z0-9-_]/g, "_").slice(0, 40)`）
- **VALIDATE**: `WinnerCardDownloadButton.test.tsx` で props → URL の組立を 3 件程度 assert

### Task 8: SeasonTopCardDownloadButton + テスト

- **ACTION**: 同 pattern で season 用ボタン
- **IMPLEMENT**: stats[] から top1〜top3 を slice、`SeasonStatsDoc.totalPoints` の小数 2 桁を query 文字列に渡す
- **MIRROR**: Task 7
- **IMPORTS**: `@/lib/firebase/schemas/seasonStats`, `@/lib/firebase/schemas/group`
- **GOTCHA**: stats[] が空のとき呼出側でボタンごと非表示。本 component 内では `stats.length === 0` を assertion で弾く
- **VALIDATE**: 同パターン

### Task 9: dashboard-client / live-client にボタン挿入

- **ACTION**:
  - [dashboard-client.tsx#L353](../../../../src/app/tournaments/%5Btid%5D/dashboard-client.tsx) `<WinnerBanner>` の直下に `<WinnerCardDownloadButton>` を追加
  - [live-client.tsx#L176](../../../../src/app/tournaments/%5Btid%5D/live/live-client.tsx) でも同様
- **IMPLEMENT**:
  ```tsx
  {winner ? (
    <>
      <WinnerBanner winner={winner} />
      <div className="flex justify-center">
        <WinnerCardDownloadButton
          tid={tid}
          winnerName={winner.displayName}
          tournamentName={data.name}
          participants={players.length}
          finishedAt={data.finishedAt?.toDate() ?? new Date()}
        />
      </div>
    </>
  ) : null}
  ```
- **MIRROR**: 同 file 内の `canClone` ガードと同じ `winner ? ... : null` パターン
- **IMPORTS**: `@/components/tournament/WinnerCardDownloadButton`
- **GOTCHA**:
  - `data.finishedAt` は `state==="finished"` 以前は null。`winner` が確定している ≒ resolveWinner 仕様より state≥running、finished 以外は client-clock fallback でも UX 上影響なし
  - participants は **総参加者**（busted 含む）。`players.length` で OK（Phase A の resolveRanking と整合）
- **VALIDATE**: dev server で「state=finished の tournament 画面 → ボタン表示 → クリック → ダウンロードダイアログ」を手動確認

### Task 10: season-ranking-client にボタン挿入

- **ACTION**: [season-ranking-client.tsx#L96-L100](../../../../src/app/groups/%5Bgid%5D/season/season-ranking-client.tsx#L96-L100) の table 直前にボタン追加
- **IMPLEMENT**:
  ```tsx
  {stats.length > 0 ? (
    <div className="flex justify-end">
      <SeasonTopCardDownloadButton gid={gid} group={group} stats={stats} />
    </div>
  ) : null}
  ```
- **MIRROR**: Task 9
- **IMPORTS**: `@/components/group/SeasonTopCardDownloadButton`
- **GOTCHA**: `stats` は `totalPoints desc` で sort 済み（[seasonStats.ts subscribe](../../../../src/lib/firebase/repositories/seasonStats.ts#L102)）。`slice(0, 3)` でそのまま top3 が取れる
- **VALIDATE**: dev server で `/groups/[gid]/season` 表示 → ボタンクリック → 画像ダウンロード

### Task 11: PRD 更新（in-progress + plan link）

- **ACTION**: [02-season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md) Implementation Phases 表の Phase B 行を更新
- **IMPLEMENT**:
  - Status: `pending` → `in-progress`
  - PRP Plan 列にリンク: `[phase-b-result-card-generation.plan.md](../plans/02-season-stats-and-share/phase-b-result-card-generation.plan.md)`
- **MIRROR**: Phase A 行（既に completed + report リンク）
- **IMPORTS**: なし
- **GOTCHA**: Phase B Open Question 2 件（`@vercel/og` 日本語フォント / Web Share API fallback）の解決を本 plan 内で確定（フォント = `@fontsource/noto-sans-jp`、Web Share API = Phase D 担当）。PRD 本体の Open Questions 更新は不要（plan で確定 = PRD は そのまま）が、Phase B report 提出時に解決済みフラグを立てる
- **VALIDATE**: PRD diff 目視確認

### Task 12: README 軽微更新（任意）

- **ACTION**: [README.md](../../../../README.md) の「依存」or「機能」節に `@vercel/og` ベースの結果カード機能を 1 行追加
- **IMPLEMENT**: scripts 表は無変更。Phase 進捗メモがあれば Phase B/C を update
- **MIRROR**: Phase 5.1 / 5.4 / A の README 更新先例
- **GOTCHA**: README はユーザー向け公開ドキュメント。SNS 共有 UX を簡潔に
- **VALIDATE**: link checker は手動

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| WINNER_CARD_QUERY_SCHEMA happy | 全フィールド有効 | success=true | - |
| WINNER_CARD_QUERY_SCHEMA short name | winnerName="" | success=false (zod min) | ✓ 空 |
| WINNER_CARD_QUERY_SCHEMA long name | winnerName=16 文字 | success=false (zod max) | ✓ 上限 |
| WINNER_CARD_QUERY_SCHEMA invalid date | finishedAt="2026-05-06" (not ISO) | success=false | ✓ format |
| WINNER_CARD_QUERY_SCHEMA participants 0 | participants="0" | success=false | ✓ 下限 |
| WINNER_CARD_QUERY_SCHEMA participants 61 | participants="61" | success=false | ✓ 上限 |
| SEASON_CARD_QUERY_SCHEMA top2/top3 省略 | top2/top3 を渡さない | success=true | ✓ optional |
| SEASON_CARD_QUERY_SCHEMA seasonStartDate=null | nullable | success=true | ✓ null |
| SEASON_CARD_QUERY_SCHEMA top1Points 小数 | "47.83" | success=true (z.coerce.number) | - |
| buildWinnerCardUrl encoding | tid="t/1?" | "/api/og/winner/t%2F1%3F?..." | ✓ 特殊文字 |
| buildSeasonCardUrl null seasonStartDate | seasonStartDate=null | URL に seasonStartDate キーが**ない** | ✓ null 省略 |
| route GET 200 | 有効 query | status=200, content-type=image/png | - |
| route GET 400 | 不正 query | status=400, body code="og/invalid-params" | ✓ |
| route GET 500 | font load 失敗を mock | status=500, body code="og/render-failed" | ✓ 例外 |
| WinnerCardDownloadButton render | props=valid | `<a download="...">` の href が builder と一致 | - |
| SeasonTopCardDownloadButton render | stats.length=1 | top1 のみで URL 組立 | ✓ 1 人 |
| SeasonTopCardDownloadButton render | stats.length=5 | top3 まで slice | ✓ 上限 |

### Edge Cases Checklist

- [x] 空 query / 不正 ISO date → 400
- [x] 文字数超過 / 範囲外 → 400
- [x] フォント読込失敗（mock） → 500 + logger.warn
- [x] stats.length=0 → ボタン非表示（component に到達しない）
- [x] stats.length=1〜2 → top2/top3 を省略する URL
- [x] tournamentName に `/` `?` `#` 等が含まれる → encodeURIComponent で escape
- [x] 認証されていない user が直接 URL 叩く → 200 だが「偽データ」（access control 不在の現状）。Risk セクション参照
- [x] `winner === null`（参加者 0〜1 名）→ ボタン非表示

### Manual Validation（dev server）

- [ ] `npm run dev` 起動
- [ ] tournament 終了 → ダッシュボードに「画像を保存」ボタン表示
- [ ] ボタンクリック → ブラウザのダウンロードが起動 / 新規タブで PNG 表示
- [ ] PNG を画像ビューワーで開いて Japanese 文字（サークル名）が描画されている
- [ ] `/groups/[gid]/season` 画面に「シーズン首位カードを保存」ボタン表示
- [ ] stats 0 件のとき非表示
- [ ] live 画面（`/tournaments/[tid]/live`）でも同等のボタンが出る
- [ ] 不正 query を直叩き → 400 JSON エラー

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: Zero warnings

### Unit Tests

```bash
npm test src/app/api/og src/components/tournament/WinnerCardDownloadButton src/components/group/SeasonTopCardDownloadButton
```

EXPECT: 全 PASS（推定 25〜30 ケース）

### Full Test Suite

```bash
npm test
```

EXPECT: Phase A 完了時の 879 件 + 本 phase 追加分（25〜30）が PASS。回帰なし

### Build Verification

```bash
npm run build
```

EXPECT:
- Build PASS
- Route summary に `/api/og/winner/[tid]` と `/api/og/season/[gid]` が **Dynamic** として登録（Static でない）
- function bundle サイズが Vercel Hobby の Node.js 上限（圧縮 50MB）以内（実測すると数 MB に収まる想定）

### Browser Validation

```bash
npm run dev
```

EXPECT: 上記 Manual Validation チェックリスト全 PASS

### Firestore Rules（変更なし）

```bash
npm run test:rules-limits
```

EXPECT: 6/6 PASS（Phase B では rules 触らない）

---

## Acceptance Criteria

- [ ] `@fontsource/noto-sans-jp` 追加・install 完了（`npm run typecheck` PASS）
- [ ] `src/app/api/og/winner/[tid]/route.tsx` が 200/400/500 を返す
- [ ] `src/app/api/og/season/[gid]/route.tsx` が 200/400/500 を返す
- [ ] WinnerBanner の隣に「画像を保存」ボタンが表示される（dashboard / live 両方）
- [ ] シーズンランキング画面に「シーズン首位カードを保存」ボタンが表示される（stats が 1 件以上のとき）
- [ ] 生成 PNG に日本語が崩れず描画される（手動確認）
- [ ] 不正 query で 400 + `og/invalid-params` 返却
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 全 PASS
- [ ] PRD Phase B 行が `in-progress` + 本 plan へリンク済み

## Completion Checklist

- [ ] Code follows discovered patterns（`AppError.from` / `logger` / `wrapFirestoreWrite` 規約）
- [ ] Error handling は `og/*` prefix で統一
- [ ] route handler 内で `console.*` を使っていない（lint で検出）
- [ ] Tests follow test patterns（純関数 UT + 薄い route status UT、E2E は Phase D）
- [ ] inline style の色 / サイズは `og-card-styles.ts` の constants に集約
- [ ] フォント TTF は `node_modules/@fontsource/...` から読込（リポジトリへ binary 直 push しない）
- [ ] PRD Phase B 進捗が更新済み
- [ ] No unnecessary scope additions（Web Share API / Admin SDK / OGP メタは Phase B では入れない）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| route handler に access control が無く、悪意ある URL で「偽の優勝者カード」が生成できる | M | L | データ流出ではなく「偽画像生成のみ」。実害は小さい。Phase D 以降で Firebase Admin SDK + ID Token verify を検討。本 plan の NOT Building / Decision Log で明示済 |
| Noto Sans JP の Bold 700 weight TTF が大きく、function bundle が肥大化する | L | M | `@fontsource/noto-sans-jp` の `japanese` subset のみ load（CJK 全字含み 1.2MB 程度）。Node.js function bundle 圧縮で問題なし。`build` 時に function size を観察し、上限 (50MB) 接近を兆候として検知 |
| Edge runtime と勘違いして `node:fs` を使い、Vercel deploy で fail する | M | M | `runtime = "nodejs"` を route ファイル先頭に必ず export。lint 規約は無いので、route file template 内の comment + plan の VALIDATE で防御 |
| Satori が emoji（🏆）を render できず空白になる | M | L | Phase B 着手時に手動テスト → 失敗するなら U+1F3C6 の SVG path に置換。元の `WinnerBanner` も emoji を使っているので同様に妥協可能 |
| iOS Safari で `<a download>` が直 download にならず新規タブ表示 | H | L | 仕様。新規タブ → 長押し保存で UX として許容。Phase D で Web Share API を導入してこの摩擦を解消 |
| `@fontsource/noto-sans-jp` のバージョン更新で TTF パスが変わる | L | M | `load-font.ts` の path 定数を 1 箇所に集約。version pin は `^5.x` で固定 |
| route 内で query を log に残し、displayName が PII として残る | M | L | logger.info / warn には `code` と `tid`/`gid` のみ含め、query 値は出さない。`security-base.md` 準拠 |
| participants の上限を 60 に切ったが 60 人超のサークルで漏れる | L | L | 既存 `MAX_TABLES (6) × MAX_SEATS_PER_TABLE (10) = 60` が運用上限。zod max を 60 に揃え、超過時は 400 でユーザに気付かせる |

## Notes

- **Auth tradeoff の明示**: 本 plan では server 側 access control を**意図的に省略**している。理由は (1) 観戦モード未実装で UI gate のみで十分という PRD 判断、(2) Firebase Admin SDK 導入は重い infra 追加、(3) abuse コストが「偽画像生成」のみで実害が小さい、の 3 点。Phase D 以降で Web Share API / 観戦モードを入れる際に再評価する。
- **Web Share API は Phase D**: 本 plan のスコープからは外す。Phase D で同 button component を再利用し、対応ブラウザは `navigator.share()`、非対応は本 phase の `<a download>` フォールバックという 2 階層に進化させる想定。
- **emoji の運用**: 🏆 / 🥇 / 🥈 / 🥉 は `WinnerBanner` でも使っており、Satori で render できるかは 2026 年時点の実装依存。Task 5 / 6 の VALIDATE で手動確認し、render できなければ SVG path に切替（plan 内 commit 単位で別 commit）。
- **PRD Open Question への回答**:
  - 「`@vercel/og` での日本語フォント埋込方式」 → `@fontsource/noto-sans-jp` の `japanese-{400,700}-normal.ttf` を `fs.readFileSync` で load、`runtime = "nodejs"` で動かす（本 plan の Decision）
  - 「Web Share API のフォールバック挙動」 → Phase B では Web Share API を実装せず、すべて `<a download>` で統一（Phase D で対応）
- **Phase A 産物との整合**: `seasonStats.totalPoints` は小数 2 桁、`group.seasonStartDate` は `Timestamp | null`、`tournament.finishedAt` は `Timestamp | null`。本 plan の query schema もこの精度に揃える。
- **future polish**: クライアントが query を組み立てる前提のため、URL が長くなる傾向（top3 + 名前 + 日付）。実測で 200 文字程度に収まる見込み。RFC 3986 の URI 長は実装定義だが Chrome は 32KB / Safari は 80KB が実用上限なので問題なし。
