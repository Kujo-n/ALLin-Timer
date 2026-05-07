---
phase: 02-season-stats-and-share / Phase B
mode: local (uncommitted)
date: 2026-05-07
reviewer: Claude (code-review skill)
decision: APPROVE
---

# ローカルレビュー: Phase B — 結果カード生成（uncommitted）

**対象**: 未コミット変更（`src/app/api/og/**` 新設 / Winner & Season カード DL ボタン追加 / 3 client への組込）
**ベース**: develop @ 9105636
**判定**: **APPROVE**（初回 REQUEST CHANGES 後、HIGH 1 件 / MEDIUM 3 件 / LOW 1 件すべて修正対応済み）

## サマリ

PRD Phase B のスコープ通り 2 系統の `next/og` route と DL ボタンが実装されており、
zod schema・URL builder・mock 境界 UT の責務分担も `testing.md` の規約と整合している。
全 994 件 UT・typecheck・lint いずれも green（初回 978 件 → 修正 fix で +16 件追加）。

初回レビューで指摘した HIGH（サーバ TZ 依存日付）/ MEDIUM 3 件 / LOW 1 件はすべて修正
対応済み。設計判断（no auth / no rate-limit）は plan の Risk セクションで明示されている
ため accept。

## Findings

### CRITICAL
None

### HIGH

#### H-1. ✅ 修正済: 日付ラベルを端末 TZ で format
- **修正方針**: サーバ側 `toLocaleDateString` 廃止 → client 側で format した文字列を query で渡す
- **実装**:
  - `og-payload.ts`: `WINNER_CARD_QUERY_SCHEMA.finishedAt` (ISO) → `finishedAtLabel` (string max 30) に rename
  - `og-payload.ts`: `SEASON_CARD_QUERY_SCHEMA.seasonStartDate` (ISO nullable) → `seasonStartDateLabel` (string max 30 nullable) に rename
  - `og-payload.ts`: `formatDateForLabel(d)` ヘルパー追加（`d.toLocaleDateString("ja-JP")`、端末 TZ）
  - [route.tsx:91](../../../../src/app/api/og/winner/%5Btid%5D/route.tsx#L91) / [route.tsx:104](../../../../src/app/api/og/season/%5Bgid%5D/route.tsx#L104): `q.finishedAtLabel` / `q.seasonStartDateLabel ?? "未設定"` をそのまま描画
  - `WinnerCardDownloadButton.tsx` / `SeasonTopCardDownloadButton.tsx`: 受信した `Date` を `formatDateForLabel` で format して query に詰める
- **検証**: `WinnerCardDownloadButton.test.tsx` の「finishedAtLabel は端末 TZ で format される」 test で `Date.toLocaleDateString("ja-JP")` の結果と query が一致することを assert。SeasonTopCardDownloadButton 側も同テスト追加

### MEDIUM

#### M-1. ✅ 修正済: Content-Disposition: attachment 付与
- **修正方針**: route 側で `Content-Disposition: attachment; filename="<stem>.png"` を付与し、iOS Safari でも download として認識される設計に変更
- **実装**:
  - `og-payload.ts`: `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` に `filename: z.string().min(1).max(60).optional()` を追加
  - [route.tsx:60-65](../../../../src/app/api/og/winner/%5Btid%5D/route.tsx#L60-L65): client 受信した `filename` を `sanitizeFilename` で**サーバ側でも再適用**（信頼境界）して `Content-Disposition` に乗せる。`q.filename` 未指定時は `card.png` fallback
  - `WinnerCardDownloadButton.tsx` / `SeasonTopCardDownloadButton.tsx`: `<a download>` の filename と query の filename stem を一致させる（Chrome / Firefox は `<a download>` を、iOS Safari は Content-Disposition を採用、両方一致するように設計）
- **セキュリティ**: `../../etc/passwd` のような path traversal 試行も route 側 `sanitizeFilename` で `etc_passwd` に正規化される旨を test で明示

#### M-2. ✅ 修正済: Cache-Control 付与
- **修正方針**: 同 query = 同 PNG（決定的）なので長め cache が安全
- **実装**: route 2 本に `cache-control: public, max-age=300, s-maxage=86400, stale-while-revalidate=604800` を付与
  - `max-age=300` (5 min): ブラウザ
  - `s-maxage=86400` (1 日): Vercel CDN edge cache
  - `stale-while-revalidate=604800` (1 週間): 期限切れ後の background revalidate
- **効果**: SNS 投稿が拡散しても 2 回目以降は edge cache hit。Satori の CPU 消費が大幅に低減

#### M-3. ✅ 修正済: season-ranking-client のインデント揃え
- **修正**: [season-ranking-client.tsx:106-131](../../../../src/app/groups/%5Bgid%5D/season/season-ranking-client.tsx#L106-L131) の `<table>` 配下を 2 space ずらしてネスト深さを統一

### LOW

#### L-1. `Object.fromEntries(searchParams)` の重複 key 挙動
- **アクション**: 修正不要（client builder は重複 key を出さないため実害なし）

#### L-2. ✅ 修正済: client filename も端末 TZ で format
- **修正**: `formatDateForFilename(d)` ヘルパー追加（`d.toLocaleDateString("sv-SE")` で ASCII safe な `YYYY-MM-DD`）。WinnerCardDownloadButton / SeasonTopCardDownloadButton 両方で `toISOString().slice(0,10)` から置換
- **効果**: H-1 と整合し、PNG ラベルと filename の日付が常に同じ TZ ベースになる

## Validation Results

| Check                                    | Result   | Notes                                                       |
| ---------------------------------------- | -------- | ----------------------------------------------------------- |
| `npm run typecheck`                      | **Pass** | エラー 0                                                    |
| `npm run lint`                           | **Pass** | warning / error 0                                           |
| `npm test --run` (full)                  | **Pass** | 53 files / **994 tests** / 0 fail（初回 978 → +16）         |
| Phase B 新 spec のみ                     | **Pass** | 5 files / **58 tests**（初回 42 → +16）                     |
| `npm run build`                          | Skipped  | typecheck pass + 既存 build 成功実績で代替（要 deploy 前手元実行） |
| `npm run test:rules-*`                   | Skipped  | rules 変更なし（API route は Firestore に触らない設計）     |

## 追加された test カバレッジ

| 領域 | 内容 |
| --- | --- |
| `og-payload.test.ts` | `finishedAtLabel` / `seasonStartDateLabel` rename 反映、`filename` optional、`formatDateForFilename` / `formatDateForLabel` ヘルパー |
| `route.test.ts` (winner / season) | Cache-Control / Content-Disposition の存在 assert、filename query → Content-Disposition 反映、route 側 sanitize 再適用 (`../../etc/passwd` を escape) |
| `WinnerCardDownloadButton.test.tsx` | 端末 TZ format の query 一致、filename と query stem の整合 |
| `SeasonTopCardDownloadButton.test.tsx` | 同上 + `seasonStartDate=null` 時の filename `open` fallback |

## Files Reviewed

### Added (untracked)

- `src/app/api/og/_lib/load-font.ts` — フォント読込 + ArrayBuffer cache
- `src/app/api/og/_lib/og-card-styles.ts` — 色 / 寸法定数
- `src/app/api/og/_lib/og-payload.ts` — zod schema + URL builder + sanitizeFilename + 端末 TZ format ヘルパー
- `src/app/api/og/_lib/og-payload.test.ts`
- `src/app/api/og/season/[gid]/route.tsx`
- `src/app/api/og/season/[gid]/route.test.ts`
- `src/app/api/og/winner/[tid]/route.tsx`
- `src/app/api/og/winner/[tid]/route.test.ts`
- `src/components/tournament/WinnerCardDownloadButton.tsx`
- `src/components/tournament/WinnerCardDownloadButton.test.tsx`
- `src/components/group/SeasonTopCardDownloadButton.tsx`
- `src/components/group/SeasonTopCardDownloadButton.test.tsx`
- `.claude/PRPs/02-season-stats-and-share/plans/completed/phase-b-result-card-generation.plan.md`
- `.claude/PRPs/02-season-stats-and-share/reports/phase-b-result-card-generation-report.md`

### Modified

- `package.json` / `package-lock.json` — `@fontsource/noto-sans-jp ^5.2.9` 追加
- `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` — Phase B 進捗更新（plan link / status）
- `src/app/groups/[gid]/season/season-ranking-client.tsx` — DL ボタン挿入 + インデント揃え (M-3)
- `src/app/tournaments/[tid]/dashboard-client.tsx` — DL ボタン挿入
- `src/app/tournaments/[tid]/live/live-client.tsx` — DL ボタン挿入

## Phase B 設計判断の確認

plan の Risk セクションに明記されており、本 review でも accept する設計判断:

- **No auth on `/api/og/**`** — 認証なしで誰でも任意 query で PNG を生成可能。データ流出ではなく
  「偽優勝者カード生成」のみで実害は小さい。Phase D 以降で Firebase Admin SDK + ID Token 検証を
  検討する旨が plan に明示されている。
- **No rate-limit** — 同上。実利用規模（月 1〜2 開催 × 数回 push）では問題化しない。Cache-Control 付与で
  反復リクエストの実コストはさらに低減した。
- **Satori emoji** — Phase B 実装では emoji（🏆 / 🥇 等）を使わず文字（"TOURNAMENT CHAMPION" /
  "1ST" / "2ND" / "3RD"）で代替しており、emoji render 不整合のリスクは回避済み。

## 補足: Firestore Rules

本 phase は rules 変更なし（API route が Firestore に触らない設計）。
[firestore.rules](../../../../firestore.rules) の deploy 案内チェックは不要。

---

> **次のアクション**: commit 可能。コミットメッセージは plan / report の文脈に沿って `feat:` prefix で
> 「結果カード PNG 生成 (Phase B): クライアント TZ ベースで日付描画 + Cache-Control / Content-Disposition」
> 程度を推奨。`@fontsource/noto-sans-jp` 追加と route 2 本 + DL ボタン 2 種が一括でセットになる。
