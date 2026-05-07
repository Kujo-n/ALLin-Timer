# Implementation Report: Phase D Improvement — Past Season Detail View

## Summary

Phase D の `SeasonHistoryList` の制約（accordion 展開で top3 までしか見えない）を解消する improvement。
`/groups/[gid]/season/history/[seasonId]` を additive に新設し、過去シーズンの全員分ランキングを
現在シーズンと同じ列構成で表示する詳細ページを実装した。`SeasonHistoryList` の各行は accordion を
廃止し「詳細を見る」 Link button に置換。schema / rule / `finishTournament` / `startNewSeason` には
一切触らず、read 経路のみ追加。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                     |
| ------------- | ---------------- | -------------------------- |
| Complexity    | Medium           | Medium（予測通り）          |
| Confidence    | High             | High                       |
| Files Changed | 約 9             | 9（CREATE 5 / UPDATE 4）   |

## Tasks Completed

| #   | Task                                                              | Status      | Notes |
| --- | ----------------------------------------------------------------- | ----------- | ----- |
| 1   | `getSeasonHistory(gid, seasonId)` を repository に追加            | done        |       |
| 2   | `getSeasonHistory` unit test 3 ケース追加                         | done        | `getDoc` を mock factory に追加 |
| 3   | 詳細ページの Server Component を作成                              | done        |       |
| 4   | `SeasonHistoryDetailClient` 本体を作成                            | done        |       |
| 5   | `SeasonHistoryDetailClient` の test を 4 ケース追加               | done        |       |
| 6   | `SeasonHistoryList` を Link 化                                    | done        | `expanded: Set<string>` state を完全削除 |
| 7   | `SeasonHistoryList` test を再構成                                 | done        | 旧 accordion toggle 系 assert を Link href assert に置換。test 件数は 5 → 5 |
| 8   | README + 業務仕様書を更新                                         | done        | spec の `targetPhase` / 2.2.6 / 3.5.1 / 3.5.5 を改訂 |
| 9   | PRD Phase D 行に improvement plan + report リンクを追記           | done        |       |
| 10  | typecheck / lint / test / build / rules emulator 全件 PASS        | done        |       |

## Validation Results

| Level                                | Status  | Notes                                                   |
| ------------------------------------ | ------- | ------------------------------------------------------- |
| `npm run typecheck`                  | PASS    | tsc --noEmit エラー 0 件                                |
| `npm run lint`                       | PASS    | ESLint warnings/errors 0 件                             |
| `npm test`（全件）                    | PASS    | 59 ファイル / 1046 テスト green（baseline 1039 → 1046）  |
| `npm run build`                      | PASS    | route 追加 `/groups/[gid]/season/history/[seasonId]` Dynamic 1.86 kB |
| `npm run test:rules-season`          | PASS    | 12/12（rule 変更なしの drift 検出のみ）                  |

## Files Changed

| File                                                                                                | Action  | 概要                                                    |
| --------------------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------- |
| `src/lib/firebase/repositories/seasonHistory.ts`                                                    | UPDATE  | `getSeasonHistory(gid, seasonId)` を additive に追加     |
| `src/lib/firebase/repositories/seasonHistory.test.ts`                                               | UPDATE  | `getDoc` を mock factory に追加 + 3 ケース追加          |
| `src/app/groups/[gid]/season/history/[seasonId]/page.tsx`                                           | CREATE  | Server Component（`{ gid, seasonId }` を `await params`）|
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx`                   | CREATE  | 詳細 client 本体（getGroup + getSeasonHistory 並列 fetch）|
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx`              | CREATE  | 4 ケース（成功 / entries=[] / not-found / fetch fail）   |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx`                                     | UPDATE  | accordion 廃止 + Link 化                                |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx`                                | UPDATE  | accordion toggle 系 → Link href assert へ置換           |
| `README.md`                                                                                         | UPDATE  | ディレクトリツリーに `season/history/[seasonId]/` を 1 行追記 |
| `docs/specification/08-season-stats.spec.md`                                                        | UPDATE  | 2.2.6 / 3.5.1 / 3.5.5 / `targetPhase` に詳細ページ言及追加 |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md`                      | UPDATE  | Phase D 行の `PRP Plan` セルに improvement plan + report リンク追記 |

## Deviations from Plan

- **`SeasonHistoryList.test.tsx` の Link 取得方法**: plan では `linkContainer.querySelector("a")`
  パターンを想定していたが、`Button asChild` の Slot は `data-testid` を子の `<a>` に転送するため、
  `screen.getByTestId(...)` で取得した時点で `<a>` 要素が直接返る。テストを
  `expect(link.tagName.toLowerCase()).toBe("a")` + `toHaveAttribute("href", ...)` に変更した。
- **detail-client test の `audioSettings` fixture**: plan の例示では `{ enabled, volume, soundId }` の
  shape を想定していたが、実際の schema は `levelUpSoundId` / `winnerSoundId` の 2 系統に分かれる
  ため fixture を schema 適合形に修正した（typecheck 検出）。

## Issues Encountered

なし — 上記 2 件の deviation は schema / Slot の実体を反映した軽微な調整で、設計方針の変更は不要だった。

## Tests Written

| Test File                                                                                              | Tests   | Coverage                                                  |
| ------------------------------------------------------------------------------------------------------ | ------- | --------------------------------------------------------- |
| `src/lib/firebase/repositories/seasonHistory.test.ts`                                                  | +3      | `getSeasonHistory` の success / not-found / read failure   |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx`                 | +4      | 正常系 / entries=[] / not-found / fetch fail               |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx`                                   | 0 net   | 既存 5 件のうち 1 件を Link href assert に置換              |

合計新規 +7 件。1039 → 1046 で baseline 通り増分（plan 想定 ~7 件と一致）。

## Acceptance Criteria

- [x] `getSeasonHistory(gid, seasonId)` repository 関数が追加され、success / not-found / failure の 3 経路がテストされている
- [x] `/groups/[gid]/season/history/[seasonId]` ページが新設され、group メンバーは閲覧可能、非メンバーは「見つかりません」UI に倒れる
- [x] 詳細ページの ranking table が 6 列（順位 / 表示名 / 参加 / 優勝 / FT / 累計ポイント）で `totalPoints desc` に sort されている
- [x] 詳細ページに「シーズン首位カードを保存」+ Web Share 対応端末では「過去シーズン首位をシェア」が並列配置されている
- [x] `SeasonHistoryList` の各 entry 右側に「詳細を見る」 Link が出る。accordion / `expanded` state / top3 の `<ol>` 描画は完全に削除されている
- [x] PRD Phase D 行の `PRP Plan` セルに本 improvement plan + report へのリンクが追記されている
- [x] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run test:rules-season` が全 PASS
- [x] `firestore.rules` / `firestore.indexes.json` / schemas / `finishTournament` / `startNewSeason` には一切変更がない（diff で確認済）

## Next Steps

- [ ] Manual validation — 開発サーバで詳細ページの目視確認（Web Share 端末は iOS Safari / Android Chrome 必要）
- [ ] `/code-review` で local diff レビュー
- [ ] `/prp-commit` で commit、`/prp-pr` で PR 作成
- [ ] Codex によるレビュー（CLAUDE.md 注意事項）
