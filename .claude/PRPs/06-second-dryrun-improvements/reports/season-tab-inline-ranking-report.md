# Implementation Report: シーズンタブ順位インライン表示（要望②）

## Summary

サークル詳細画面の「シーズン」タブを開くだけで今シーズンの順位表が見えるようにした。3 箇所（現シーズンランキング画面 / 過去シーズン詳細 / 本機能のインライン）で重複していた順位表 `<table>` を共有 presentational コンポーネント `SeasonRankingTable` に集約し、`subscribeSeasonStats` で realtime 購読する自己完結 panel `SeasonRankingPanel` をシーズンタブにインライン埋め込みした。既存 `/groups/[gid]/season` ページは share / 過去シーズン履歴の導線として据え置き。

schema / repository / firestore.rules の変更はなし（`subscribeSeasonStats` と read 権限は既存で充足）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Small〜Medium    | Small〜Medium（計画通り） |
| Confidence    | （高・既存パターン流用） | 期待通り。deviation なし |
| Files Changed | 8（CREATE 4 / UPDATE 4）+ 任意 1 | 9（CREATE 4 / UPDATE 5） |

## Tasks Completed

| #   | Task        | Status      | Notes               |
| --- | ----------- | ----------- | ------------------- |
| 1   | SeasonRankingTable 作成 | [done] Complete | TABLE_MARKUP をそのまま移植 |
| 2   | SeasonRankingTable.test | [done] Complete | 4 tests（ヘッダ / 採番 / 列値 / toFixed） |
| 3   | season-ranking-client 切替 | [done] Complete | inline table → `<SeasonRankingTable rows={stats} />` |
| 4   | season-history-detail-client 切替 | [done] Complete | entries の `uid→id` map で代入 |
| 5   | SeasonRankingPanel 作成 | [done] Complete | subscribe + loading/empty/error/rows |
| 6   | SeasonRankingPanel.test | [done] Complete | 5 tests（loading / empty / rows / error / cleanup） |
| 7   | group-detail-client にパネル追加 | [done] Complete | SeasonCard 直後・PointsRuleCard 前に配置 |
| 8   | E2E assert 追加 | [done] Complete | 空状態 + 実データ（首位 Bob）の 2 経路 |

## Validation Results

| Level           | Status      | Notes                          |
| --------------- | ----------- | ------------------------------ |
| Static Analysis | [done] Pass | `tsc --noEmit` エラー 0 / `next lint` warning 0 |
| Unit Tests      | [done] Pass | 全 1447 tests pass（新規 9 tests 含む） |
| Build           | [done] Pass | `next build` 成功                |
| Integration / E2E | [done] Pass | group-detail-tabs + phase-d-share-and-history 全 10 tests pass |
| Edge Cases      | [done] Pass | 空入力 / エラー / toFixed 端数 を unit で網羅 |

## Files Changed

| File           | Action  | Lines   |
| -------------- | ------- | ------- |
| `src/components/group/SeasonRankingTable.tsx` | CREATED | +49 |
| `src/components/group/SeasonRankingTable.test.tsx` | CREATED | +94 |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.tsx` | CREATED | +68 |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.test.tsx` | CREATED | +114 |
| `src/app/groups/[gid]/season/season-ranking-client.tsx` | UPDATED | +2 / -26 |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` | UPDATED | +9 / -25 |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATED | +2 |
| `tests/e2e/group-detail-tabs.spec.ts` | UPDATED | +5 |
| `tests/e2e/phase-d-share-and-history.spec.ts` | UPDATED | +10 |
| `tests/e2e/pages/GroupsPage.ts` | UPDATED | +6 |

## Deviations from Plan

なし — 計画通りに実装。Files to Change で「任意」とされていた `GroupsPage.ts` の `seasonRankingInline` locator helper も追加した（空状態 E2E で `toHaveCount(0)` に使用）ため、UPDATE 件数が 4 → 5 になった。

## Issues Encountered

なし。共有コンポーネント化に伴う `/season` / 履歴詳細の markup は 1 文字も変えず移植したため、既存 E2E（phase-d の `main table` assert）は無改修で緑のまま。

## Tests Written

| Test File      | Tests   | Coverage       |
| -------------- | ------- | -------------- |
| `src/components/group/SeasonRankingTable.test.tsx` | 4 tests | ヘッダ列 / 順位採番 / 列値 / toFixed(2) 端数・0 |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.test.tsx` | 5 tests | loading / empty / rows / error(role=alert) / unmount unsubscribe |
| `tests/e2e/group-detail-tabs.spec.ts` | +assert | 戦績 0 件 → インライン非表示 + 案内文 |
| `tests/e2e/phase-d-share-and-history.spec.ts` | +assert | finish 後 `?tab=season` で首位 Bob がインライン table に見える |

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
