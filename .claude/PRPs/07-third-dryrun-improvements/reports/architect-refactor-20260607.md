# Architect Refactor Report — 20260607

## Scope

- PRD: `07-third-dryrun-improvements` / ブランチ: `feature/phase3-4`
- 対象: **Phase 3 手動卓閉鎖・Phase 4 卓追加／再開** の seating ドメイン（engine / orchestrator /
  CloseTableConfirmDialog / SeatingBoard）。受付代理 Phase 1〜2 は
  [architect-refactor-20260606](../reviews/architect-refactor-20260606.md) で対応済みのため回帰確認のみ
- 観測可能な動作変更: **0**（純粋な内部リファクタ）

## Findings 概要

- critical: 0 件 / high: 0 件 / medium: 1 件 / low: 4 件
- 詳細監査結果: [reviews/architect-refactor-20260607.md](../reviews/architect-refactor-20260607.md)
- 実行範囲（ユーザー承認）: finding-1 + finding-2

## 実施した変更

- `ea25e36` — **refactor(seating-engine): 卓閉鎖の greedy 詰め込みを packIntoSurvivingTables に集約**
  （finding-1 / medium）— `engine.ts` のみ。`planTableBreak`（自動・定員 seatsPerTable）と
  `planManualTableClose`（手動・定員 maxSeatsPerTable）が逐語複製していた「閉鎖卓 player を
  seatNum 昇順で生存卓の占有最少へ詰める」greedy を internal pure helper に集約。差分は定員のみ
  param 化。TDA 詰め込み規則の単一真実源化で自動／手動閉鎖の席割り drift を防止。
- `3bd590c` — **refactor(seating): 生存卓導出を liveTableNums selector に単一真実源化**
  （finding-2 / low）— `engine.ts`（selector + test）/ `orchestrator.ts` / `CloseTableConfirmDialog.tsx` /
  `SeatingBoard.tsx`。`tables.filter((t) => !t.isBroken)` の 3 重複を pure selector
  `liveTableNums(tables)` に集約。overflow preview（dialog）と閉鎖 commit（orchestrator）が同一
  生存卓集合を共有する不変条件を明示化し preview/commit drift を防止。

## 見送った提案（理由付き）

- **finding-3（canCloseTable → canManageTable リネーム / low）** — author が「churn 最小化」で
  意図的に prop 名を据え置いた判断のため、ユーザー承認時に「finding-1+2 のみ」を選択。次に
  SeatingBoard を触る Phase でまとめてリネーム候補。
- **finding-4（SeatingBoard 629 行 / TableCard 抽出 / low）** — 肥大の大半は Phase 5.x の
  D&D / PD / cascade ロジックで pre-existing。Phase 3〜4 の増分は close/reopen ボタン約 30 行のみ。
  抽出は draggable/droppable 状態（`activeDragId` / `draggedPlayer`）と密結合でリスク対効果が
  低いため defer。useState は閾値（5）未満。
- **finding-5（dashboard `isMember` を organizer 限定操作の gate に流用 / low）** — `isOrganizer`
  早期 return guard で organizer 確定後に到達するため**動作は正しい**（命名 readability のみ）。
  Phase 3〜4 由来ではなく pre-existing（既存 PD / D&D gate の流用）で、触ると Phase 3〜4 無関係の
  回帰面が広がるため defer。

## 追加したテスト

- `src/lib/services/seating/engine.test.ts` — `describe("liveTableNums")` 3 ケース追加
  （未閉鎖のみ入力順返却 / 全閉鎖で空 / 空入力で空）。`tbl()` TableDoc fixture factory も追加。
- finding-1 の `packIntoSurvivingTables` は internal helper のため、既存 `planTableBreak`（5）/
  `planManualTableClose`（8）の characterization で公開 API 経由透過検証（新規テスト不要）。

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass（No ESLint warnings or errors） | pass |
| unit test | 1569 pass / 0 fail（100 files） | 1572 pass / 0 fail（100 files） |
| e2e test（影響 spec） | 10 pass / 0 fail | 10 pass / 0 fail |
| build | pass | pass |

影響 E2E spec: manual-table-close / table-add-reopen / playing-dealer / proxy-receipt。
unit は liveTableNums の 3 ケース追加で +3。

## 観測可能な動作変更が無い根拠

- finding-1: `packIntoSurvivingTables` は両関数の詰め込みループを逐語移植し定員のみ param 化。
  `from.tableNum` は brokenTableNum 固定（brokenPlayers は当該卓 filter 済みで `p.tableNum` と等価）。
  `planTableBreak`(5) / `planManualTableClose`(8) の入出力 characterization が全 green。
- finding-2: `liveTableNums` selector は現行 3 式（filter 条件・map / length）と完全同義。
- E2E（手動卓閉鎖の成立／overflow ブロック・卓追加／再開・未配席ガイド・PD・受付代理）が
  baseline と同一の 10 pass。観測点（DOM / バッジ / ボタン活性 / Firestore 反映）に差分なし。

## 残課題 / Next Step

- finding-3 / 4 / 5 を次に seating UI / dashboard 権限導出を触る Phase でまとめて再評価。
- finding-4 を実施する際は D&D の hooks rules（空席でも useDraggable 呼出）と activeDragId 状態の
  取り回しに注意（本サイクルで defer した理由）。
