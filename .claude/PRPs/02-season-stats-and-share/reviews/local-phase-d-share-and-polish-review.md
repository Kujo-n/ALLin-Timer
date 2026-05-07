# Local Review: Phase D — Web Share API & Season History Polish

**Reviewed**: 2026-05-07
**Author**: Kujo-n（Yuki1_Ogi@toshibatec.co.jp）
**Branch**: develop（uncommitted）
**Decision**: APPROVE with comments

## Summary

Phase D（Web Share API でのカード共有 + シーズン履歴 accordion）の実装を確認。
追加コンポーネント `ShareCardButton` / `useCanShareImage` / `formatXxxShareText` /
`SeasonHistoryList` はいずれも **AppError ラップ・logger 経由・null-safe gating・
fixture factory ベースのテスト** という既存規約に整合しており、CRITICAL / HIGH の
不具合は無い。typecheck / lint / 1030 件の vitest / Next.js build がすべて green。
MEDIUM 以下は意図的な「最小差分優先」選択で、本 Phase でブロックする性質のもの
ではない。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

- **M1. `data-testid="winner-card-share"` が dashboard と live の両 client で重複**
  ([dashboard-client.tsx:393](src/app/tournaments/[tid]/dashboard-client.tsx#L393) /
  [live-client.tsx:233](src/app/tournaments/[tid]/live/live-client.tsx#L233))
  - 現行 routing では同一 page に両者が同時 mount されないため衝突しないが、E2E
    spec ([phase-d-share-and-history.spec.ts:66](tests/e2e/phase-d-share-and-history.spec.ts#L66))
    が暗黙的に「dashboard 画面でのみ可視 / Chromium で 0 件」を前提にしている。
  - 後続改修で同時 hydrate する経路（例: `/tournaments/[tid]` から `/live` への
    soft transition）が生まれた場合に test selector が壊れやすい。`-dashboard` /
    `-live` のような scope 接尾辞を付ける案は将来 refactor 候補として記録。
  - 影響度: 実害なし（現状）

- **M2. ShareCardButton 用の URL / filename / shareText 派生ロジックが 3 箇所で
  完全重複**
  ([dashboard-client.tsx:366-385](src/app/tournaments/[tid]/dashboard-client.tsx#L366-L385) /
  [live-client.tsx:207-225](src/app/tournaments/[tid]/live/live-client.tsx#L207-L225) /
  [season-ranking-client.tsx:118-151](src/app/groups/[gid]/season/season-ranking-client.tsx#L118-L151))
  - `WinnerCardDownloadButton` / `SeasonTopCardDownloadButton` が内部で同形の
    `formatDateForFilename` / `sanitizeFilename` / `buildXxxCardUrl` を呼んで
    おり、各 client component とで合計 2 回ずつ計算している。コメントで
    「最小差分優先で許容」と明記済み（Phase D plan の意図的選択）。
  - 将来 `participants: players.length` 等の算法が片方だけ変わると download /
    share でファイル名や URL が drift するリスクがある。`useShareCardData(kind, …)`
    の hook で集約 + テスト固定化が次の architect-refactor の自然な対象。
  - 影響度: 現時点では bug 無し / 将来の保守 cost

- **M3. download / share ボタン click ごとの `logger.info` を `logger.debug` に
  降格（fix 済み）**
  ([SeasonTopCardDownloadButton.tsx:71-76](src/components/group/SeasonTopCardDownloadButton.tsx#L71-L76) /
  [WinnerCardDownloadButton.tsx:58-63](src/components/tournament/WinnerCardDownloadButton.tsx#L58-L63) /
  [ShareCardButton.tsx:103-104](src/components/share/_share-button/ShareCardButton.tsx#L103-L104))
  - 本番 Vercel default level=`info` で suppress されるため、production telemetry
    コストはゼロ化。ローカル開発（`NEXT_PUBLIC_LOG_LEVEL=debug`）では引き続き
    観測可能。
  - 同期的に [ShareCardButton.test.tsx](src/components/share/_share-button/ShareCardButton.test.tsx)
    のアサーションも `infoSpy` → `debugSpy` に追従更新済み（success path /
    AbortError silent 両ケース）。

- **M4. ShareCardButton の連打抑止なし**
  ([ShareCardButton.tsx:54-57](src/components/share/_share-button/ShareCardButton.tsx#L54-L57))
  - 連打すると `fetch` + `navigator.share` が 2 回走り、2 回目は実機で
    `InvalidStateError` を投げる端末がある（AbortError ではないので
    `share/failed` で warn 出力）。データ整合性には影響しないが、`useState` の
    `pending` フラグで disable する余地あり。
  - 影響度: UX レベル

### LOW

- **L1. `formatWinnerShareText` / `formatSeasonShareText` のフォールバック `"—"`
  （em-dash）が SNS preview で視認性低い**
  ([share-text.ts:20-22](src/components/share/_share-button/share-text.ts#L20-L22) /
  [share-text.ts:32-34](src/components/share/_share-button/share-text.ts#L32-L34)) — 好みのレベル

- **L2. `SeasonHistoryList.formatRange` が `toLocaleDateString("ja-JP")` のみで
  zero-pad しない**
  ([SeasonHistoryList.tsx:153-158](src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx#L153-L158))
  → `2026/5/7` のような表示で行ごとに桁が揃わない。仕様内。

- **L3. `data.finishedAt?.toDate()` が dashboard / live で IIFE と
  `<WinnerCardDownloadButton>` prop の両方で計算され、計 2 つの Date instance を
  生成**
  ([dashboard-client.tsx:369,402](src/app/tournaments/[tid]/dashboard-client.tsx#L369) /
  [live-client.tsx:209,242](src/app/tournaments/[tid]/live/live-client.tsx#L209))
  → 同一 ms なので bug ではないが、M2 集約と同時に解消できる。

- **L4. `SeasonHistoryList` で fetch エラー時に `unwrapOrFrom` を使い `logger.debug`
  に降格させる設計**
  ([SeasonHistoryList.tsx:38-47](src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx#L38-L47))
  → repository 側で `wrapFirestoreRead` が `logger.warn` を出している前提に
  依存。`listSeasonHistory` が常に `AppError` を投げる規約は確認済み。

## Validation Results

| Check       | Result | Notes                                                |
| ----------- | ------ | ---------------------------------------------------- |
| Type check  | Pass   | `npm run typecheck`                                  |
| Lint        | Pass   | `npm run lint`（next lint deprecation warning のみ） |
| Unit tests  | Pass   | 58 files / 1030 tests                                |
| Build       | Pass   | `npm run build` — 全 15 ページ静的化 OK              |
| E2E         | Skip   | Phase D の手元検証は本レビューでは未走行             |
| Rules tests | Skip   | rule 変更なし（emulator script は不要）              |

## Files Reviewed

**Added (untracked)**

- `src/components/share/_share-button/ShareCardButton.tsx`
- `src/components/share/_share-button/ShareCardButton.test.tsx`
- `src/components/share/_share-button/share-text.ts`
- `src/components/share/_share-button/share-text.test.ts`
- `src/components/share/_share-button/use-can-share-image.ts`
- `src/components/share/_share-button/use-can-share-image.test.ts`
- `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx`
- `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx`
- `tests/e2e/phase-d-share-and-history.spec.ts`
- `.claude/PRPs/02-season-stats-and-share/plans/completed/phase-d-web-share-and-polish.plan.md`
- `.claude/PRPs/02-season-stats-and-share/reports/phase-d-web-share-and-polish-report.md`

**Modified**

- `src/app/groups/[gid]/season/season-ranking-client.tsx` — ShareCardButton + SeasonHistoryList wiring
- `src/app/tournaments/[tid]/dashboard-client.tsx` — ShareCardButton wiring
- `src/app/tournaments/[tid]/live/live-client.tsx` — ShareCardButton wiring
- `src/components/group/SeasonTopCardDownloadButton.tsx` — telemetry onClick
- `src/components/tournament/WinnerCardDownloadButton.tsx` — telemetry onClick
- `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` — Phase D 進捗更新（doc）
- `docs/specification/08-season-stats.spec.md` — 履歴 accordion 仕様（doc）
- `README.md` — Phase D 概要（doc）

## Recommendation

- 本変更は **APPROVE with comments** で commit 可。
- M3 は本レビュー内で `logger.info` → `logger.debug` に降格対応済み（テスト追従含む）。
- M1 / M2 / M4 は **次の architect-refactor の対象**（Phase D 完了後）として記録。
  特に M2（3 箇所重複）は `useShareCardData` への集約で `participants` 算法 drift
  を防ぎたい。
- 実機検証（iOS Safari / Android Chrome）は Manual Validation 区画として `phase-d-web-share-and-polish-report.md` の Manual Validation セクションで結果を確定させること。
