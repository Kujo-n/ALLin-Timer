# Implementation Report: Phase 3 — 卓を空けて閉じる

## Summary

運営者（organizer / owner）が SeatingBoard 上で**任意の卓を選んで閉じ**、その卓のプレイヤーを残卓へ自動再配置できる機能を実装した。残卓は `seatsPerTable` を一時的に超えて `MAX_SEATS_PER_TABLE`(10) まで定員を引き上げて収容し、収まらない場合は確認ダイアログで警告して confirm を無効化（tx 未発行）する。閉鎖（`isBroken=true`）+ 再配置 + PD reset は既存 private `applyTableBreak` を再利用して同一 tx で commit する。`firestore.rules` は変更なし。

- engine: `planManualTableClose()` 純関数 + `ManualTableClosePlan` 判別 union を追加
- orchestrator: `applyManualTableClose()`（engine plan → `applyTableBreak` 再利用、overflow/last を AppError 変換）
- hook: `useTableClose`（閉鎖対象 state + busy + orchestrator 呼出を集約）
- component: `CloseTableConfirmDialog`（engine で preview/警告算出、overflow なら confirm 無効）
- SeatingBoard: 卓ヘッダ「閉じる」ボタン + 席行ループの可変化（`max(seatsPerTable, 最大席番号)`）
- dashboard-client: hook 配線 + dialog 描画

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                                            |
| ------------- | ---------------- | ------------------------------------------------- |
| Complexity    | Medium           | Medium（plan 通り。逸脱なし）                      |
| Confidence    | High（self-contained） | High（実装中の設計判断は不要、plan に従って完遂） |
| Files Changed | 13               | 14（PRD 1 / 計画記載の 13 + PRD 進捗更新）         |

## Tasks Completed

| #   | Task                                              | Status      | Notes                                         |
| --- | ------------------------------------------------- | ----------- | --------------------------------------------- |
| 1   | engine `planManualTableClose` 純関数              | ✅ Complete | `MAX_SEATS_PER_TABLE` を engine import に追加  |
| 2   | engine characterization test                      | ✅ Complete | 7 ケース（集約 / 定員引上げ / overflow / last / not-found / 空卓 / 詰込順） |
| 3   | orchestrator `applyManualTableClose`              | ✅ Complete | 6 引数版（`seatsPerTable` 不採用、plan 確定通り） |
| 4   | orchestrator unit test                            | ✅ Complete | 5 ケース（commit / overflow / last / not-found / 非member） |
| 5   | `useTableClose` hook                              | ✅ Complete | `unwrapOrFrom` で二重 warn 回避               |
| 6   | `useTableClose` test                              | ✅ Complete | 6 ケース                                      |
| 7   | `CloseTableConfirmDialog` component               | ✅ Complete | 判別 union を素直に分岐（cast 不使用）         |
| 8   | `CloseTableConfirmDialog` test                    | ✅ Complete | 4 ケース                                      |
| 9   | SeatingBoard「閉じる」ボタン + 可変席数描画        | ✅ Complete | `canCloseTable` 独立 prop + `renderSeatCount` |
| 10  | SeatingBoard.test.tsx 新規                         | ✅ Complete | 5 ケース                                      |
| 11  | dashboard-client 配線                             | ✅ Complete | `canCloseTable={isMember}` / dialog 描画      |
| 12  | E2E spec 新設                                     | ✅ Complete | 作成済み（emulator 実行は別ゲート、下記参照）  |
| 13  | error-logging.md 更新                             | ✅ Complete | `seating/table-close-overflow` / `-last` 追記 |

## Validation Results

| Level           | Status      | Notes                                                          |
| --------------- | ----------- | -------------------------------------------------------------- |
| Static Analysis | ✅ Pass     | `tsc --noEmit` 0 errors / `next lint` 0 warnings               |
| Unit Tests      | ✅ Pass     | 全 1544 tests green（98 files）。新規 27 tests（engine 7 / orchestrator 5 / hook 6 / dialog 4 / SeatingBoard 5） |
| Build           | ✅ Pass     | `next build` 成功                                              |
| Integration/E2E | ⏸ Authored | `tests/e2e/manual-table-close.spec.ts` 作成・typecheck 済み。emulator + dev server 起動を要するため未実行（マージ前ゲートで走行） |
| Edge Cases      | ✅ Pass     | 空卓 / overflow / last-table / not-found / 非member を unit で固定 |

## Files Changed

| File                                                          | Action  | Lines（概算） |
| ------------------------------------------------------------- | ------- | ------------- |
| `src/lib/services/seating/engine.ts`                          | UPDATED | +84           |
| `src/lib/services/seating/engine.test.ts`                     | UPDATED | +130          |
| `src/lib/services/seating/orchestrator.ts`                    | UPDATED | +58           |
| `src/lib/services/seating/orchestrator.test.ts`               | UPDATED | +120          |
| `src/lib/hooks/useTableClose.ts`                              | CREATED | +100          |
| `src/lib/hooks/useTableClose.test.tsx`                        | CREATED | +150          |
| `src/components/tournament/CloseTableConfirmDialog.tsx`       | CREATED | +110          |
| `src/components/tournament/CloseTableConfirmDialog.test.tsx`  | CREATED | +135          |
| `src/components/tournament/SeatingBoard.tsx`                  | UPDATED | +45 / -2      |
| `src/components/tournament/SeatingBoard.test.tsx`             | CREATED | +145          |
| `src/app/tournaments/[tid]/dashboard-client.tsx`             | UPDATED | +35           |
| `tests/e2e/manual-table-close.spec.ts`                        | CREATED | +75           |
| `.claude/rules/error-logging.md`                              | UPDATED | +2 / -1       |
| `.claude/PRPs/07-third-dryrun-improvements/prds/...prd.md`    | UPDATED | Phase 3 → complete |

## Deviations from Plan

- **`applyManualTableClose` のシグネチャ**: plan の GOTCHA 通り `seatsPerTable` 引数を外し 6 引数版 `(tid, uid, userGroupIds, targetTableNum, players, tables)` で確定。`MAX_SEATS_PER_TABLE` を内部固定。
- **`useTableClose` の error wrap**: plan の IMPLEMENT は `AppError.from` + `logger.warn` だが、GOTCHA の指示通り `unwrapOrFrom` のみ採用し追加 `logger.warn` は行わない（orchestrator が既に warn 済み → 二重 warn 回避、error-logging.md 準拠）。`logger` import も不要のため除外。
- **import 順**: engine の `MAX_SEATS_PER_TABLE` は既存 `MAX_TABLES` と同じ import 行に集約。orchestrator の `@/lib/limits` は `@/lib/firebase/wrap` と `@/lib/logger` の間に配置（ESLint import 順整合）。
- **テスト fixture factory**: `id` の二重指定（explicit + spread）による TS2783 を避け、`...overrides` で `id` を供給する形に統一（`useManualSeatChange.test.tsx` 規範）。

## Issues Encountered

- **TS2783（id duplicate）**: 新規テストの fixture factory で `id: overrides.id` を明示しつつ `...overrides` を spread して重複。explicit `id:` 行を除去して解消（3 ファイル）。typecheck で検出 → 即修正。
- それ以外の実装上の問題なし。plan が self-contained で、設計判断の追加照会は不要だった。

## Tests Written

| Test File                                                    | Tests   | Coverage                                          |
| ------------------------------------------------------------ | ------- | ------------------------------------------------- |
| `src/lib/services/seating/engine.test.ts`（追記）            | 7 tests | `planManualTableClose` の plan / overflow / 空卓 等 |
| `src/lib/services/seating/orchestrator.test.ts`（追記）      | 5 tests | `applyManualTableClose` の commit / throw / 非member |
| `src/lib/hooks/useTableClose.test.tsx`                       | 6 tests | request/confirm/cancel / overflow / applied=false |
| `src/components/tournament/CloseTableConfirmDialog.test.tsx` | 4 tests | 文言 / overflow disabled / handler 発火            |
| `src/components/tournament/SeatingBoard.test.tsx`            | 5 tests | close ボタン表示条件 / 可変席数描画                |
| `tests/e2e/manual-table-close.spec.ts`                       | 1 spec  | 3 卓 → 1 卓閉鎖 → 残卓集約（seatsPerTable 超）の user-observable |

## Next Steps

- [ ] emulator 起動で E2E（`npm run test:e2e -- manual-table-close`）を走行（マージ前ゲート）
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 4（卓を増やす／再開）— 本 Phase の可変席数描画 / useTableClose 配線が足場になる
