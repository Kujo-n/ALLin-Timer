# Architect Refactor 実装計画 — 20260607

## 所属 / スコープ

- PRD: `07-third-dryrun-improvements`
- ブランチ: `feature/phase3-4`
- 監査: [reviews/architect-refactor-20260607.md](../reviews/architect-refactor-20260607.md)
- 実行範囲（ユーザー承認済み）: **finding-1 + finding-2**
  - finding-3（canCloseTable リネーム）/ finding-4（SeatingBoard 抽出）/ finding-5（isMember 整理）は本サイクル defer

## 不変条件

- 観測可能な動作変更 **0**（純粋な内部リファクタ）
- 既存テスト（unit / E2E）を常に green に戻す。中間 commit でも red のまま進めない
- 1 タスク = 1 commit の atomic 性。日本語コミットメッセージ（type prefix のみ英語）
- `.claude/rules/*` を最優先（engine は純関数・Firestore 副作用なしを維持 / error wrap 不変）

## 検証順序（各タスク共通）

1. `npm run typecheck`
2. `npm run lint`
3. `npm test`（vitest）
4. `npm run build`（dev server 停止済みであること。Playwright 常駐に注意）
5. green を確認して `git add -p` → commit

E2E（影響 spec: manual-table-close / table-add-reopen / playing-dealer / proxy-receipt）は
**Phase 5 最終検証で 1 回**走らせる（中間は unit + typecheck + lint + build で代替＝testing.md 準拠）。

---

## Task 1（finding-1 / medium）: engine の greedy 詰め込みを単一 helper へ集約

**対象**: `src/lib/services/seating/engine.ts` のみ

**変更内容**:

- internal pure helper を追加（export しない。公開 API 経由で透過検証）:

  ```ts
  function packIntoSurvivingTables(
    active: PlayerDoc[],
    brokenTableNum: number,
    survivingTables: number[],
    capacity: number,
  ): BalancingMove[] | null
  ```

  - `brokenPlayers = active.filter(tableNum === brokenTableNum).sort(seatNum 昇順)`
  - `occupiedBySurvivor`（生存卓ごとの占有 seat 集合）を `active` から構築
  - 各 brokenPlayer を「占有最少（同数なら tableNum 昇順）の生存卓・seat 1 から最初の空席」へ
    詰める greedy。`count >= capacity` の卓は候補外。候補 0 で `null`（防御）
  - `from.tableNum` は `brokenTableNum` 固定（brokenPlayers は当該卓 filter 済みのため現行と等価）

- `planTableBreak`: 詰め込み部（現 `:354-378`）を `packIntoSurvivingTables(active, toBreak, survivingTables, seatsPerTable)` 呼出に置換。
  「どの卓を閉じるか」決定（最少人数・tie-break tableNum 最大）は**helper の外に残す**。
  `moves === null` のとき現行同様 `return null`。

- `planManualTableClose`: 詰め込み部（現 `:449-476`）を
  `packIntoSurvivingTables(active, targetTableNum, survivingTables, maxSeatsPerTable)` 呼出に置換。
  not-found / only-one-table / overflow の早期 return は helper の**前に残す**。
  helper が `null`（capacity チェック済みなので通常起きないが防御）のときは overflow を返す。

**観測同値の根拠**: 両関数の詰め込みアルゴリズムは定員以外完全一致（監査 finding-1 参照）。
helper は両者のループを逐語移植し、定員のみ param 化する。

**テスト保護**: `engine.test.ts` の `describe("planTableBreak")`（5 ケース）/
`describe("planManualTableClose")`（8 ケース）。helper は internal のため新規テスト不要。

**コミット例**: `refactor(seating-engine): 卓閉鎖の greedy 詰め込みを packIntoSurvivingTables に集約`

---

## Task 2（finding-2 / low）: liveTableNums selector の単一真実源化

**対象**: `src/lib/services/seating/engine.ts`（selector 追加）/ `engine.test.ts`（test 追加）/
`orchestrator.ts` / `CloseTableConfirmDialog.tsx` / `SeatingBoard.tsx`（消費側統一）

**変更内容**:

- engine.ts に pure selector を export:

  ```ts
  import type { TableDoc } from "@/lib/firebase/schemas/table";

  /** 未閉鎖（生存）卓の tableNum を昇順で返す。preview(dialog) と commit(orchestrator) で
   *  同一導出を共有し drift を防ぐ。 */
  export function liveTableNums(tables: TableDoc[]): number[] {
    return tables.filter((t) => !t.isBroken).map((t) => t.tableNum);
  }
  ```

  ※ engine は seating ドメインの純関数ハブ。`TableDoc` は type-only import で副作用なし。
  planManualTableClose が `number[]` を受ける契約（TableDoc 非依存）は維持し、selector は
  consumer 側で TableDoc → number[] 変換を担う層として engine に同居させる。

- `orchestrator.ts:415`: `tables.filter((t) => !t.isBroken).map((t) => t.tableNum)` →
  `liveTableNums(tables)`（`./engine` import に追加）
- `CloseTableConfirmDialog.tsx:57`: 同上（既に `./engine` から import 済みのため追加のみ）
- `SeatingBoard.tsx:140-143`: `liveTableCount` の `tables.filter((t) => !t.isBroken).length` →
  `liveTableNums(tables).length`（engine import 追加）
- `engine.test.ts`: `describe("liveTableNums")` を追加（broken 混在で未閉鎖のみ昇順返却 / 全閉鎖で空 /
  空配列で空 の 2〜3 assert）

**観測同値の根拠**: selector は現行 3 式と同義（filter 条件・map / length とも不変）。

**テスト保護**: 新規 `liveTableNums` unit ＋ 既存 `CloseTableConfirmDialog.test.tsx` /
`SeatingBoard.test.tsx` ＋ E2E manual-table-close。

**コミット例**: `refactor(seating): 生存卓導出を liveTableNums selector に単一真実源化`

---

## Phase 5 最終検証

1. `npm run typecheck` / `npm run lint` / `npm test`
2. `npm run build`（dev server 停止確認後）
3. `npm run test:e2e -- manual-table-close table-add-reopen playing-dealer proxy-receipt`
4. `git log --oneline main..HEAD` で 2 commit が atomic に並ぶことを確認
5. レポートを `reports/architect-refactor-20260607.md` に出力
6. 本 plan を `plans/completed/` へ移動
