# Implementation Report: Phase 4 — 卓を増やす／再開

## Summary

運営者（organizer / owner）が、レイトレジストで人数が増えたときに **新規卓を追加**し、**閉鎖済みの卓を再開**（`isBroken=false`）できるようにした。追加／再開した卓は `autoSeatLateEntry` の自動配席対象から除外（既存挙動を test で lock-in）し、運営者が手動 D&D で配置する。未配席の active 参加者がいる間は軽量ガイドバナーで案内する。`MAX_TABLES`(6) 超過は service（hook の null チェック）+ UI（ボタン disabled）の二重防御で deny する。

実装は **engine 純関数 1（`planAddTable`）+ repository 関数 1（`reopenTable`）+ hook 1（`useTableLifecycle`）+ ガイド component 1（`UnseatedPlayersGuide`）+ SeatingBoard「再開」ボタン + dashboard 配線**で行い、計画どおり **`firestore.rules` は変更なし**（reopen は tables update 経路 A、add は既存 create rule でカバー済み）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium（計画どおり） |
| Confidence    | （明示なし）High      | High（deviation 0） |
| Files Changed | 15               | 15（計画一致）  |

## Tasks Completed

| #   | Task                                            | Status      | Notes |
| --- | ----------------------------------------------- | ----------- | ----- |
| 1   | engine に `planAddTable` 純関数を追加           | ✅ Complete |       |
| 2   | engine.test に `planAddTable` + 空卓除外 characterization | ✅ Complete | planLateEntrySeat の lock-in test 1 件 + planAddTable 6 件 |
| 3   | repository に `reopenTable` を追加              | ✅ Complete | `upsertTable` は既存 scaffold を add 用に再利用（コメント更新） |
| 4   | tables.test に `reopenTable` test               | ✅ Complete |       |
| 5   | `useTableLifecycle` hook を新設                 | ✅ Complete |       |
| 6   | `useTableLifecycle.test` を新設                 | ✅ Complete |       |
| 7   | `UnseatedPlayersGuide` component を新設         | ✅ Complete |       |
| 8   | `UnseatedPlayersGuide.test` を新設             | ✅ Complete |       |
| 9   | SeatingBoard に「再開」ボタンを追加            | ✅ Complete | close と排他（`!isBroken` vs `isBroken`） |
| 10  | SeatingBoard.test に「再開」検証               | ✅ Complete | droppability lock-in 含む 5 件 |
| 11  | dashboard-client に配線                         | ✅ Complete | CardContent を `space-y-3` でガイドと board を分離 |
| 12  | E2E spec を新設                                 | ✅ Complete | 4 spec（reopen / add / max disabled / guide） |
| 13  | ルールドキュメント更新                          | ✅ Complete | group-membership 権限マトリクス + firebase-patterns tables 行 |
| 14  | PRD 進捗表を complete に                         | ✅ Complete |       |

## Validation Results

| Level           | Status      | Notes |
| --------------- | ----------- | ----- |
| Static Analysis | ✅ Pass     | `tsc --noEmit` 0 errors / `next lint` 0 warnings |
| Unit Tests      | ✅ Pass     | 全 1568 tests green（新規 ~20 件）。affected: engine 59 / tables 26 / useTableLifecycle 5 / UnseatedPlayersGuide 4 / SeatingBoard 10 |
| Build           | ✅ Pass     | `next build` Compiled successfully |
| Rule Drift      | ✅ Pass     | `npm run test:rules-limits` 14/14 GREEN（rule 不変の裏取り） |
| E2E (merge-gate)| ✅ Pass     | `table-add-reopen` 4/4 green。回帰確認で `manual-table-close` 2/2 も green |
| Edge Cases      | ✅ Pass     | 空配列 / MAX_TABLES / gap fill / busted 除外 / uid=null no-op |

## Files Changed

| File | Action | Lines |
| ---- | ------ | ----- |
| `src/lib/services/seating/engine.ts` | UPDATED | +21 |
| `src/lib/services/seating/engine.test.ts` | UPDATED | +47 |
| `src/lib/firebase/repositories/tables.ts` | UPDATED | +18 / -3 |
| `src/lib/firebase/repositories/tables.test.ts` | UPDATED | +18 |
| `src/lib/hooks/useTableLifecycle.ts` | CREATED | +96 |
| `src/lib/hooks/useTableLifecycle.test.tsx` | CREATED | +130 |
| `src/components/tournament/UnseatedPlayersGuide.tsx` | CREATED | +34 |
| `src/components/tournament/UnseatedPlayersGuide.test.tsx` | CREATED | +97 |
| `src/components/tournament/SeatingBoard.tsx` | UPDATED | +24 |
| `src/components/tournament/SeatingBoard.test.tsx` | UPDATED | +97 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATED | +30 / -3 |
| `tests/e2e/table-add-reopen.spec.ts` | CREATED | +175 |
| `.claude/rules/group-membership.md` | UPDATED | +2 |
| `.claude/rules/firebase-patterns.md` | UPDATED | +1 / -1 |
| `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md` | UPDATED | +1 / -1 |

## Deviations from Plan

None — implemented exactly as planned. 1 点だけ計画に明記されていなかった微調整として、ガイドバナーと SeatingBoard の間に縦余白を入れるため Table List の `<CardContent>` に `className="space-y-3"` を付与した（視覚的整列のみ・振る舞い不変）。

## Issues Encountered

None。各 Task ごとに即時 unit validation を回し、broken state を持ち越さずに進行できた。

## Tests Written

| Test File | Tests | Coverage |
| --------- | ----- | -------- |
| `engine.test.ts`（追記） | 7 | `planAddTable`（連番 / broken 込み / gap / 上限 / 空 / maxTables 引数）+ 空卓除外 characterization |
| `tables.test.ts`（追記） | 2 | `reopenTable`（`isBroken:false` 書込形 / 失敗 wrap） |
| `useTableLifecycle.test.tsx` | 5 | add 成功 / 上限 no-op + onError / reopen 成功 / add 失敗 onError / uid=null no-op |
| `UnseatedPlayersGuide.test.tsx` | 4 | 0 名非表示 / 1 名表示 / busted 除外 / 複数名「、」列挙 |
| `SeatingBoard.test.tsx`（追記） | 5 | reopen 表示（close と排他）/ live 非表示 / 権限なし非表示 / click 発火 / 再開後 droppable lock-in |
| `tests/e2e/table-add-reopen.spec.ts` | 4 | 閉じる→再開で復活 / 卓追加でカード出現 / 6 卓で追加 disabled / 満席 late entry で未配席ガイド |

## Notes

- **rule 変更なし**: reopen（`isBroken=false`）は tables `allow update` 経路 A、add（create）は tables `allow create`（organizer のみ）でカバー。`firestore.rules` / `firestore.indexes.json` 不変のため **`firebase deploy --only firestore:rules` は不要**（rule drift check も 14/14 green で裏取り済み）。
- **自動配席の責務分担**: 追加/再開した空卓は `planLateEntrySeat` が「着席プレイヤー由来の生存卓のみ候補」とする既存挙動で自然に除外される。engine ロジックは変更せず、characterization test（engine.test の「着席プレイヤーのいない空卓は自動配席対象にならない」）で固定した。
- **`seating/too-many-tables` の再利用方針**: add 上限超過は UI disabled（一次）+ hook の `nextTableNum===null` early onError（二次）で deny。`upsertTable` には throw 経路が無いため固定メッセージで代替（rule deny ではなく UI 防御方針、`error-logging.md` への新規 code 追記なし）。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
