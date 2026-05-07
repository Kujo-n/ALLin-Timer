# Implementation Report: Phase C — Table Label & Color

## Summary

Phase C「テーブル呼称カスタム」を実装。トーナメント単位の `tables/{n}.label` /
`.color` を additive 追加し、サークル単位の `groups/{gid}.defaultTableLabels[]` から
`commitInitialSeating` 時に index 順で auto-fill する経路を確立した。SeatingBoard /
BalancingInstructionCard / live-client の「Table N」表示は label が設定されていれば
カスタム呼称を優先し、未設定時は従来どおり数値 fallback。inline edit は
**サークル詳細画面の `defaultTableLabels` カード**と **dashboard 卓ヘッダの `✎`
ポップオーバー**の 2 か所で organizer 以上に開放。Firestore Rules は
`groups/{gid}` の 8 ブランチ目に `defaultTableLabels` 専用分岐を追加し、`tables/{n}` の
旧 `allow write` を `create / update / delete` に分割して `affectedKeys.hasOnly(['label','color'])`
+ size / regex 制約で他フィールド汚染を deny。drift 検査と新規 emulator validator も同梱。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Large            | Large          |
| Confidence    | High（既存パターン踏襲） | High |
| Files Changed | 約 18             | 22（テスト fixture 4 件追加） |

## Tasks Completed

| #   | Task                                                            | Status          | Notes                                                                                       |
| --- | --------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------------------------- |
| 1   | `TABLE_LABEL_MAX_LENGTH` を `src/lib/limits.ts` に追加          | [done] Complete |                                                                                             |
| 2   | table schema に `label` / `color` を additive 追加              | [done] Complete | `nullable().default(null)` で旧 doc 互換                                                    |
| 3   | group schema に `defaultTableLabels[]` を additive 追加         | [done] Complete | `array().max(MAX_TABLES).default([])` で旧 doc 互換                                         |
| 4   | groups repo + service の `defaultTableLabels` 経路を新設        | [done] Complete | `updateDefaultTableLabels` / `setDefaultTableLabels`、`createGroup` も初期化                |
| 5   | `commitInitialSeating` の auto-fill + 既存 label 維持           | [done] Complete | tx 内 read（group + 既存 tables）→ create / 部分 update 分岐へ書込経路を変更                |
| 6   | `firestore.rules` の groups update / tables update を拡張       | [done] Complete | groups: 8 ブランチ目に `defaultTableLabels`。tables: write を create/update/delete に分割   |
| 7   | emulator validator `test-rules-table-labels.mjs` を新規作成     | [done] Complete | 14 ケース（allow 7 / deny 7）。`npm run test:rules-table-labels` で `ALL GREEN` 確認        |
| 8   | drift 検査に `TABLE_LABEL_MAX_LENGTH` / `defaultTableLabels` 追加 | [done] Complete | `npm run test:rules-limits` で 11/11 PASS                                                    |
| 9   | `formatTableLabel` 純関数 + 3 view 層（SeatingBoard / BalancingInstructionCard / live-client） | [done] Complete | aria-label `table-{n}` は維持（テスト互換）                                       |
| 10  | dashboard 卓ヘッダから開く `TableLabelEditPopover` を追加      | [done] Complete | shadcn Dialog を再利用。color は `<input type="color">` + 「色なし」ボタン                  |
| 11  | サークル詳細画面に `GroupDefaultTableLabelsCard` を追加         | [done] Complete | 行 6 件まで追加 / 削除のみ（並び替えは Phase D）                                            |
| 12  | PRD と firebase-patterns.md / group-membership.md の更新       | [done] Complete | groups update 表に 1 行 / 権限マトリクスに 4 行追加                                         |

## Validation Results

| Level                | Status      | Notes                                                                          |
| -------------------- | ----------- | ------------------------------------------------------------------------------ |
| Static Analysis      | [done] Pass | `npm run typecheck` zero errors / `npm run lint` zero warnings                  |
| Unit Tests           | [done] Pass | 1003/1003 tests（既存 991 + Phase C 新規 12: format-table-label 6 + commitInitialSeating 4 + table fixture 修正に伴う既存 spec 補完 2） |
| Build                | [done] Pass | `npm run build` 成功                                                            |
| Drift Check          | [done] Pass | `npm run test:rules-limits` 11/11                                               |
| Emulator (Phase C)   | [done] Pass | `npm run test:rules-table-labels` 14/14                                         |
| Emulator (regression)| [done] Pass | `test:rules-clone-players` 7/7 / `test:rules-season` 12/12（subcollection rule 再分割で degrade なし） |

## Files Changed

| File                                                                          | Action  | 概要                                                                  |
| ----------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------- |
| `src/lib/limits.ts`                                                           | UPDATE  | `TABLE_LABEL_MAX_LENGTH = 10` 追加                                    |
| `src/lib/firebase/schemas/table.ts`                                           | UPDATE  | `label` / `color` を additive 追加                                    |
| `src/lib/firebase/schemas/group.ts`                                           | UPDATE  | `defaultTableLabels` を additive 追加                                 |
| `src/lib/firebase/repositories/groups.ts`                                     | UPDATE  | `createGroup` 初期値 + `updateDefaultTableLabels`                     |
| `src/lib/firebase/repositories/tables.ts`                                     | UPDATE  | `updateTableLabel` + `upsertTables` の null 初期化                    |
| `src/lib/services/group.ts`                                                   | UPDATE  | `setDefaultTableLabels`                                               |
| `src/lib/services/seating/orchestrator.ts`                                    | UPDATE  | `commitInitialSeating` の tx を group/table read + 部分 update 分岐へ |
| `src/lib/services/format-table-label.ts`                                      | CREATE  | 純関数 `formatTableLabel`                                             |
| `src/lib/services/format-table-label.test.ts`                                 | CREATE  | 6 ケース                                                              |
| `firestore.rules`                                                             | UPDATE  | groups branch +1 / tables write を create/update/delete に分割         |
| `src/components/tournament/SeatingBoard.tsx`                                  | UPDATE  | `formatTableLabel` 表示 + `color` 帯 + edit popover 配置              |
| `src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx`       | CREATE  | label / color の inline edit Dialog                                    |
| `src/components/tournament/BalancingInstructionCard.tsx`                      | UPDATE  | `formatTableLabel` で 3 か所のテーブル文言を置換                      |
| `src/app/tournaments/[tid]/live/live-client.tsx`                              | UPDATE  | tables subscribe 追加 + Table 表示を label fallback に                |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                              | UPDATE  | `canEditTableLabel` / `onSaveTableLabel` を SeatingBoard へ伝搬       |
| `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx`            | CREATE  | サークル詳細画面の inline edit カード                                 |
| `src/app/groups/[gid]/group-detail-client.tsx`                                | UPDATE  | カードを SeasonCard の前に積む                                         |
| `scripts/test-rules-table-labels.mjs`                                         | CREATE  | emulator validator（14 ケース）                                       |
| `scripts/test-rules-limits.mjs`                                               | UPDATE  | drift 検査に 2 行追加                                                  |
| `package.json`                                                                | UPDATE  | `test:rules-table-labels` script 追加                                  |
| `.claude/rules/firebase-patterns.md`                                          | UPDATE  | groups update 表 +1 / tables 行に Phase C 注記                        |
| `.claude/rules/group-membership.md`                                           | UPDATE  | 権限マトリクスに 4 行追加                                             |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md`| UPDATE  | Phase C 行を `pending` → `in-progress` + plan link                     |
| `src/lib/services/seating/orchestrator.test.ts`                               | UPDATE  | tx mock の reads を 5 件追加 + 既存 fixture に label/color 補完 + 新規 4 ケース |
| `src/lib/hooks/useSeatingAutoOrchestrator.test.ts`                            | UPDATE  | table fixture に label/color 補完                                     |
| `src/lib/services/group.test.ts`                                              | UPDATE  | group fixture に `defaultTableLabels: []` 補完                        |
| `src/lib/hooks/useAudioPlayer.test.tsx`                                       | UPDATE  | group fixture に `defaultTableLabels: []` 補完                        |
| `src/lib/firebase/schemas/index.test.ts`                                      | UPDATE  | group fixture に `defaultTableLabels: []` 補完                        |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`                         | UPDATE  | `subscribeTables` の軽量 mock を追加                                  |

## Deviations from Plan

- **`commitInitialSeating` の rule 整合性確保**: plan は「tx.set で丸ごと上書き + 既存 label を merge」と記述していたが、`allow update` rule の `affectedKeys` 強制で `createdAt` 含む丸ごと set が deny される。設計を「**存在しない卓は `tx.set`（create branch）/ 存在する卓は `tx.update` で `label` のみ部分 patch（label-only branch）/ 既に label 設定済みなら no-op**」へ変更。Risks セクションで言及されていた mitigation の通り、emulator validator で create / update 経路を別々に検証（ケース 6・14・12 が該当）。
- **live-client の Table 表示**: plan は「formatTableLabel で常に置換」を想定したが、aria/test 互換のため `me.tableNum` を返す default を維持し、label が設定されている場合のみカスタム呼称に置換する条件分岐に変更。
- **Test fixture の追加更新**: plan が想定していなかった既存 group / table 直書き fixture が typecheck で検出された（5 ファイル）。schema の `default(null)` / `default([])` は parse 時 hydrate 専用で、TypeScript 型上は required になるため fixture の object literal にもフィールド明記が必要。fixture 4 件に `defaultTableLabels: []` / `label: null, color: null` を追加。

## Issues Encountered

- **live-client.test.tsx が新規 import で破綻**: `subscribeTables` を追加したことで Firebase config 必須エラーが発生。軽量 mock を 1 つ追加して解消（commit 単位で隔離）。

## Tests Written

| Test File                                            | Tests   | Coverage                                                                  |
| ---------------------------------------------------- | ------- | ------------------------------------------------------------------------- |
| `src/lib/services/format-table-label.test.ts`        | 6       | label 通常 / null / 空文字 / undefined / 旧 doc / 前後空白 trim           |
| `src/lib/services/seating/orchestrator.test.ts`      | +4      | auto-fill index / 既存 label 維持 / null backfill + 既存 fixture 修正     |
| `scripts/test-rules-table-labels.mjs`                | 14      | groups.defaultTableLabels 5 + tables.label/color 9（allow 7 / deny 7）    |

## Next Steps

- [x] `firebase deploy --only firestore:rules` を本番に適用（**Phase C のリリース時に必ず実施**。emulator green でも本番 rule が古いと `permission-denied` で書込が全部失敗する）
- [ ] 開発者がサークル参加時に「Table 1 / 2 / 3」呼称が消え、カスタム呼称（赤卓 / 青卓 / 緑卓）で口頭伝達が完結したことを目視確認（PRD Success Metrics）
- [ ] Code review via `/code-review`
- [ ] Phase D（color picker / Web Share API / 並び替え）へ
