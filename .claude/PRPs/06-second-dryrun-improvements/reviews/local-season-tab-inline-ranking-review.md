# Local Review: シーズンタブ順位インライン表示（要望②）

**Reviewed**: 2026-05-31
**Author**: Kujo-n
**Branch**: develop（uncommitted changes）
**Decision**: APPROVE with comments

## Summary

順位表 `<table>` を共有 `SeasonRankingTable` に集約し、`subscribeSeasonStats` 購読の `SeasonRankingPanel` をシーズンタブにインライン埋め込みする変更。既存パターン（subscribe / loading-state / error-handling / fixture factory）に忠実で、schema / repository / rules の変更を伴わない。CRITICAL / HIGH の指摘なし。markup は 3 callsite から 1 文字も変えず移植されており、回帰リスクは低い。

## Findings

### CRITICAL

None — 秘密情報・injection・認可バイパスなし。`subscribeSeasonStats` の read 権限（group メンバー全員）は既存 rule で充足し、本変更で書込経路・rule は一切触っていない。

### HIGH

None — ロジックエラー・null 未処理・race・型安全性の問題なし。`SeasonStatsDoc[]` → `SeasonRankingRow[]` の構造的代入は余剰 field 込みで型検査済み（`tsc --noEmit` green）。`useEffect` の `return unsub` で unsubscribe され、user の defined→null 遷移時も React の cleanup が先行実行されるためリークなし（panel test の unmount ケースで担保）。

### MEDIUM

None.

### LOW

1. **テーブルヘッダの a11y セマンティクス（`src/components/group/SeasonRankingTable.tsx:24-31`）**
   `<th>` に `scope="col"` が無く、`<table>` に caption / aria-label も無い。これは抽出元 3 callsite の既存 markup を忠実移植した結果で本変更が劣化させたものではない。ただし共有コンポーネント化により**今や 1 箇所修正で 3 画面すべてに `scope="col"` を効かせられる**ため、a11y 改善の好機。E2E は role ベースで scope 追加に影響されないため安全に追加可能。任意・後続対応で可。

2. **見出しと section の関連付けの不統一（`SeasonRankingPanel.tsx:64-67`）**
   `<section data-testid="season-ranking-inline">` 内の `<h2>` が `aria-labelledby` で関連付けられていない。先例 `SeasonHistoryList.tsx` は `aria-labelledby="season-history-heading"` で section に名前を付けている。スクリーンリーダーの landmark ナビゲーション一貫性のため `aria-labelledby` 付与を検討（任意）。

3. **非アクティブタブでの購読継続（`group-detail-client.tsx` season panel / `SeasonRankingPanel.tsx`）**
   `GroupDetailTabs` が非アクティブ panel を `hidden` で DOM 維持するため、別タブ表示中も `subscribeSeasonStats` の onSnapshot listener が張られ続ける。plan で 20 人規模では許容と明示済み（firebase-patterns.md の rule read コスト方針に整合）。実害なし。将来 active-tab 限定購読に最適化する余地のみ記録。

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass（`tsc --noEmit` エラー 0） |
| Lint       | Pass（`next lint` warning 0、`console.*` 直呼び・swallow なし） |
| Tests      | Pass（全 1447 unit tests / 新規 9 tests + E2E 10 tests） |
| Build      | Pass（`next build` 成功） |

## Files Reviewed

| File | Change |
| --- | --- |
| `src/components/group/SeasonRankingTable.tsx` | Added |
| `src/components/group/SeasonRankingTable.test.tsx` | Added |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.tsx` | Added |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.test.tsx` | Added |
| `src/app/groups/[gid]/group-detail-client.tsx` | Modified（import + panel 1 行追加） |
| `src/app/groups/[gid]/season/season-ranking-client.tsx` | Modified（inline table → 共有コンポーネント） |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` | Modified（inline table → 共有コンポーネント、uid→id map） |
| `tests/e2e/group-detail-tabs.spec.ts` | Modified（空状態 assert） |
| `tests/e2e/phase-d-share-and-history.spec.ts` | Modified（実データ assert） |
| `tests/e2e/pages/GroupsPage.ts` | Modified（locator helper） |
| `.claude/PRPs/06-second-dryrun-improvements/prds/...prd.md` | Modified（Phase 2 → complete） |

## Recommendation

LOW 指摘 3 件はいずれも任意・既存挙動の踏襲または明示済みトレードオフのため、merge ブロッカーではない。**APPROVE**。LOW-1（`scope="col"`）は共有化のメリットを活かせる小改善なので、気が向いたタイミングで別コミットでの対応を推奨。
