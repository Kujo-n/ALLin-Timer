# Plan: Phase 3 — 卓を空けて閉じる

## Summary

運営者（organizer / owner）が SeatingBoard 上で**任意の卓を選んで閉じ**、その卓のプレイヤーを残卓へ自動再配置できるようにする。残卓は `seatsPerTable` を一時的に超えて `MAX_SEATS_PER_TABLE`(10) まで定員を引き上げて収容し、収まらない場合は**実行前にブロック＋警告**する。再配置後は既存の D&D 微調整（`applyManualSeatChange`）で席を調整できる。脱落者リングゲーム用に卓を 1 つ物理的に空ける現場運用をアプリ内で完結させる。

## User Story

As a 小規模 NLH サークルの運営者,
I want 任意の卓を選んで閉じ、そのプレイヤーを残りの卓へ自動でまとめ（残卓が 10 名まで膨らんでよい）、収まらないときは警告で止めてもらいたい,
So that 脱落者のリングゲーム用にテーブルを 1 つ空ける現場判断を、アプリの席指示と現実を一致させたまま実行できる。

## Problem → Solution

**Current**: 卓閉鎖は engine の `planTableBreak` による**自動判定のみ**で、(1) 閉じる卓は「最少人数の卓」に固定（運営者が選べない）、(2) 残卓定員は `seatsPerTable` 固定で `active.length > (生存卓数-1) × seatsPerTable` を満たすときだけ成立（[engine.ts:337](../../../../src/lib/services/seating/engine.ts#L337)）。「6名×3卓 → 8名×2卓」のような **seatsPerTable を一時的に超える集約**ができず、運営者の任意卓選択もできない。発火点は `BalancingInstructionCard` の TDA バランシング指示のみ（[BalancingInstructionCard.tsx:64](../../../../src/components/tournament/BalancingInstructionCard.tsx#L64)）。
→
**Desired**: 運営者が SeatingBoard の卓ヘッダで「この卓を閉じる」を押すと、
- 閉じる卓は**運営者が指定**でき、
- 残卓は `MAX_SEATS_PER_TABLE`(10) まで一時的に定員を引き上げて収容し、
- 残卓に収まらない場合は**確認ダイアログで警告し confirm を無効化**（tx を発行しない）、
- 収まる場合は閉鎖卓 `isBroken=true` + 全員の再配置を**同一 tx**で commit し、
- 移動したプレイヤーは PD フラグを落とし（既存 `applyTableBreak` の挙動）、
- 再配置後は既存 D&D（`applyManualSeatChange`）で微調整できる、
を engine の純関数追加 + orchestrator の薄いラッパ + SeatingBoard の閉鎖 UI で実現する。**`firestore.rules` は変更不要**（後述）。

## Metadata

- **Complexity**: Medium（engine pure 関数 1 / orchestrator ラッパ 1 / hook 1 / dialog 1 / SeatingBoard 改修 / dashboard 配線 + 各 test）
- **Source PRD**: `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md`
- **PRD Phase**: Phase 3 — 卓を空けて閉じる
- **Estimated Files**: 13（engine 1 / engine.test 1 / orchestrator 1 / orchestrator.test 1 / hook 1 / hook.test 1 / dialog 1 / dialog.test 1 / SeatingBoard 1 + 新規 SeatingBoard.test 1 / dashboard-client 1 / E2E spec 1 / docs 1）

---

## UX Design

### Before

```
┌─ Table List ──────────────────────────────────────────────┐
│ ┌ Table 1 (6人) ✎ ┐ ┌ Table 2 (6人) ✎ ┐ ┌ Table 3 (4人) ✎ ┐│
│ │ 1: Alice        │ │ 1: Frank        │ │ 1: Mike         ││
│ │ 2: Bob          │ │ 2: Grace        │ │ 2: Nina         ││
│ │ ... (seatsPerTable=6 行固定で表示)                       ││
│ └─────────────────┘ └─────────────────┘ └─────────────────┘│
│  ※ 卓を閉じる手段は「⚠ 次のアクション」カードの自動指示のみ。 │
│    運営者が「卓3を空けたい」と思っても任意選択できない。     │
└────────────────────────────────────────────────────────────┘
```

### After

```
┌─ Table List ──────────────────────────────────────────────┐
│ ┌ Table 1 (6人) ✎ [閉じる] ┐ ┌ Table 2 (6人) ✎ [閉じる] ┐ ...│
│ │ 1: Alice                │                                  │
│ │ ... 7,8 行も表示される   │  ← 閉鎖後 8名になった卓は       │
│ │   （seatsPerTable=6 でも │     max(6, 最大席番号) 行で描画 │
│ │    7,8 席を描画）        │                                  │
│ └─────────────────────────┘                                  │
└────────────────────────────────────────────────────────────┘

[閉じる] クリック →
┌─ 確認ダイアログ ───────────────────────────────────┐
│ Table 3 を閉じます                                  │
│ このテーブルの 4 名を残りの卓へまとめます。         │
│ （残卓は一時的に最大 10 名まで増えます）            │
│                                                     │
│  ── 収まらない場合 ──                               │
│ ⚠ 残卓に収まりません（最大 10 名/卓 × 2 卓 = 20 名、│
│    現在 22 名）。先に脱落者をバストさせてください。  │
│    [閉じる] ボタンは disabled                        │
│                                  [キャンセル][閉じる]│
└─────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| 卓カードヘッダ（organizer） | ✎（label/color edit）のみ | ✎ + 「閉じる」ボタン | `canManage && !isBroken && 生存卓 ≥ 2` のときのみ表示 |
| 卓を閉じる | 自動指示（最少人数卓固定）のみ | 任意卓を選んで confirm → 自動再配置 | 自動バランシング（`planTableBreak`）は据え置き・併存 |
| 残卓の席表示 | `seatsPerTable` 行固定 | `max(seatsPerTable, 最大席番号)` 行 | 一時定員引き上げ（>seatsPerTable）でも全員可視化 |
| 収容不能時 | 該当機能なし | ダイアログで警告 + confirm 無効 | tx を発行しない（rule deny でトーナメント停止を回避） |
| 再配置後の調整 | 既存 D&D | 既存 D&D（変更なし） | `applyManualSeatChange` を流用 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [src/lib/services/seating/engine.ts](../../../../src/lib/services/seating/engine.ts) | 320-379, 82-104 | `planTableBreak`（再配置アルゴリズムの原型）と `TableBreakPlan` / `BalancingMove` 型。`planManualTableClose` はこの後半（survivor 詰め込み）を**定員 = maxSeatsPerTable で再利用**する |
| P0 (critical) | [src/lib/services/seating/orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts) | 845-959, 349-359 | private `applyTableBreak`（moves + `isBroken=true` を同一 tx で commit、PD reset、seat-taken race guard）。`applyManualTableClose` は**これをそのまま再利用**する。`ApplyBalancingResult` 型 |
| P0 (critical) | [src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) | 175-260, 234-254 | 卓カード描画と**席行のループ（`seatsPerTable` 行固定の修正対象）**。卓ヘッダ右 span（✎ / 閉鎖バッジ）に「閉じる」ボタンを足す |
| P0 (critical) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 233-265, 463-516, 561-585 | `useManualSeatChange` 配線（hook 集約の先例）/ SeatingBoard 配線 / 削除確認 `<Dialog>` の inline 形 |
| P1 (important) | [src/lib/hooks/useManualSeatChange.ts](../../../../src/lib/hooks/useManualSeatChange.ts) | all | 「orchestrator 呼出 + busy + AppError ラップ + onError」を集約する hook の規範。`useTableClose` はこれを下敷きにする |
| P1 (important) | [src/components/tournament/AddParticipantDialog.tsx](../../../../src/components/tournament/AddParticipantDialog.tsx) | 1-140, 214-239 | Dialog + onError + submitting 表示 + `unwrapOrFrom` の component 規範（07 Phase 2 の先例） |
| P1 (important) | [src/components/tournament/BalancingInstructionCard.tsx](../../../../src/components/tournament/BalancingInstructionCard.tsx) | 12-19, 62-97, 129-153 | **component が engine 純関数を import して preview を計算する**先例（`planTableBreak` を直接呼ぶ）。`mounted` ref / `formatTableLabel` 使用も参照 |
| P1 (important) | [src/lib/services/seating/orchestrator.test.ts](../../../../src/lib/services/seating/orchestrator.test.ts) | 1-149, 552-609 | orchestrator unit test の mock 基盤（`mockTransaction` / `player` / `makeTournament` factory）と `applyTableBreak`（TG2）の tx assert パターン |
| P1 (important) | [src/lib/services/seating/engine.test.ts](../../../../src/lib/services/seating/engine.test.ts) | 448-524 | `planTableBreak` の characterization test。`planManualTableClose` のテストはこの形式（人数構成コメント + plan assert）を踏襲 |
| P2 (reference) | [firestore.rules](../../../../firestore.rules) | 592-644, 680-724 | players organizer-update（`tableNum 1-6 / seatNum 1-10 / isPlayingDealer bool` 許可）/ tables update 経路 A（`isBroken` 単独書換許可）。**両者で Phase 3 の書込が既にカバーされ rule 変更不要**であることの根拠 |
| P2 (reference) | [src/lib/limits.ts](../../../../src/lib/limits.ts) | 17-24 | `MAX_SEATS_PER_TABLE`(10) / `MIN_SEATS_PER_TABLE` / `MAX_TABLES`。定員引き上げ上限の単一真実源 |
| P2 (reference) | [src/lib/hooks/useSeatingAutoOrchestrator.ts](../../../../src/lib/hooks/useSeatingAutoOrchestrator.ts) | 63-110 | 自動配席 hook。閉鎖後に未配席 player が出ない（tx で全員配席）ため衝突しないことの確認 |
| P2 (reference) | [src/lib/services/format-table-label.ts](../../../../src/lib/services/format-table-label.ts) | all | `formatTableLabel(table)` — 卓名表示の単一経路（ダイアログ文言で使う） |
| P2 (reference) | [tests/e2e/playing-dealer.spec.ts](../../../../tests/e2e/playing-dealer.spec.ts) | 1-90 | seating 系 E2E の雛形（`seedOrganizerTournament` / `joinAsGuest` / `tournamentDashboardPage` / commit seating） |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | 「tournaments/{tid} 配下 subcollection の rule 設計原則」「players/{pid} の create rule 経路」 | wildcard 厳禁・rule 変更時の drift 規約（本 Phase は rule 不変だが、変更しないことの裏取りに参照） |

## External Documentation

No external research needed — feature uses established internal patterns（engine pure function / orchestrator tx / @dnd-kit / shadcn Dialog / vitest / Playwright Page Object はすべて既存先例あり）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/seating/engine.ts:327-331
// engine の pure plan 関数: plan<名詞>(seatedPlayers, brokenTableNums, ...args): <Plan>Type | null
export function planTableBreak(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): TableBreakPlan | null {
```

```ts
// SOURCE: src/lib/services/seating/engine.ts:25-33
// engine 固有のエラー / 結果は型/クラスで表現し、orchestrator が AppError へ変換する
export class TooManyTablesError extends Error { /* ... */ }
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:197-228
// orchestrator: engine 由来の判別可能な結果を instanceof / discriminant で見て AppError("seating/...") にラップ + logger.warn
if (e instanceof TooManyTablesError) {
  const wrapped = new AppError(`テーブル数の上限（${e.max} Tables）を超えました。...`, "seating/too-many-tables", e);
  logger.warn(wrapped.message, { code: wrapped.code, tid });
  throw wrapped;
}
```

```ts
// SOURCE: src/lib/hooks/useManualSeatChange.ts:132-147
// hook: orchestrator を呼び、失敗は AppError.from でラップ → logger.warn → onError(formatErrorForDisplay)
} catch (e) {
  const wrapped = AppError.from(e, "firestore/write_failed", "席の変更に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code, tid, pid: player.id });
  onError(formatErrorForDisplay(wrapped));
} finally {
  setBusy(false);
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:956-957
// 成功時 logger.info は wrap の外。tid / uid / brokenTableNum など最小限の context
logger.info("table break ok", { tid, uid, brokenTableNum: plan.brokenTableNum });
```

### REPOSITORY_PATTERN（本 Phase は repository 追加なし — orchestrator が tx を直接持つ）

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:869-950
// wrapFirestoreWrite("firestore/write_failed", 日本語, async () => { runTransaction(...) }, { tid })
// → loadTournamentInTx で group 突合 + state guard → 各 player を tx.get で再 read race guard → tx.update
await wrapFirestoreWrite("firestore/write_failed", "テーブル閉鎖に失敗しました", async () => {
  await runTransaction(firestore, async (tx) => {
    await loadTournamentInTx(tx, tid, userGroupIds);
    /* ... race guard + moves + tx.update(tablesRef, { isBroken: true }) ... */
  });
}, { tid });
```

### SERVICE_PATTERN（orchestrator の薄いラッパ — engine plan → 既存 commit helper 再利用）

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:367-387
// applyBalancingOnce: brokenTableNums を tables から導出 → engine plan → 成立すれば commit helper へ委譲
export async function applyBalancingOnce(tid, uid, userGroupIds, players, tables, seatsPerTable) {
  const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
  const breakPlan = planTableBreak(players, brokenTableNums, seatsPerTable);
  if (breakPlan) return await applyTableBreak(tid, uid, userGroupIds, breakPlan, players);
  /* ... */
}
```

### COMPONENT_PATTERN（engine 純関数を component で呼んで preview / 警告を出す）

```tsx
// SOURCE: src/components/tournament/BalancingInstructionCard.tsx:62-72
// useMemo で engine 純関数を呼び、結果が null なら非表示 / non-null なら指示カード
const { breakPlan, diag } = useMemo(() => {
  const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
  const bp = planTableBreak(players, brokenTableNums, seatsPerTable);
  /* ... */
}, [players, tables, seatsPerTable]);
if (!breakPlan && !diag) return null;
```

### HOOK_PATTERN

```ts
// SOURCE: src/lib/hooks/useManualSeatChange.ts:72-90
// "use client" hook: { busy, ...state, handler } を返す。unmount cleanup を useEffect で
export function useManualSeatChange({ tid, uid, groupIds, players, onError }: UseManualSeatChangeArgs): UseManualSeatChangeResult {
  const [busy, setBusy] = useState(false);
  /* ... */
}
```

### DIALOG_PATTERN

```tsx
// SOURCE: src/components/tournament/AddParticipantDialog.tsx:123-131, 214-235
// shadcn Dialog + DialogHeader/Title/Description + error <p role="alert"> + DialogFooter(キャンセル / 実行ボタン submitting)
<Dialog open={open} onOpenChange={onOpenChange}>
  <DialogContent>
    <DialogHeader><DialogTitle>…</DialogTitle><DialogDescription>…</DialogDescription></DialogHeader>
    {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
    <DialogFooter>
      <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>キャンセル</Button>
      <Button type="submit" disabled={submitting}>…</Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/seating/engine.test.ts:448-468
// engine: 人数構成をコメントで明示 → plan を assert（null / brokenTableNum / moves.length / 移動先）
it("条件成立で 1 卓閉鎖（最少人数→tableNum 最大）", () => {
  const seated = [ p({ id: "a1", tableNum: 1, seatNum: 1 }), /* ... */ ];
  const plan = planTableBreak(seated, [], 9);
  expect(plan?.brokenTableNum).toBe(3);
  expect(plan?.moves).toHaveLength(2);
});
```

```ts
// SOURCE: src/lib/services/seating/orchestrator.test.ts:120-142, 580-609
// orchestrator: mockTransaction([txReads...], onUpdate) で tx.get 順を制御し、captured patch を assert
mockTransaction([
  () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),     // 1) tournament
  () => ({ exists: () => true, id: "b1", data: () => stripId(player({ id: "b1", tableNum: 2, seatNum: 1 })) }),
  () => ({ exists: () => true, id: "a1", data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 1 })) }),
], (_ref, patch) => captured.push(patch as Record<string, unknown>));
const result = await applyManualTableClose("t1", "u1", ["g1"], 2, seated, tables, 9);
expect(captured[captured.length - 1].isBroken).toBe(true);
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/services/seating/engine.ts` | UPDATE | `planManualTableClose()` 純関数 + `ManualTableClosePlan` 判別 union を追加（任意卓選択 + 定員 ≤10 引き上げ + 収容不能判定） |
| `src/lib/services/seating/engine.test.ts` | UPDATE | `planManualTableClose` の characterization test（成立 / overflow / last-table / not-found / 空卓 / 定員引き上げで seat>seatsPerTable） |
| `src/lib/services/seating/orchestrator.ts` | UPDATE | `applyManualTableClose()` を追加（engine plan → 既存 private `applyTableBreak` 再利用、overflow/last-table を AppError に変換） |
| `src/lib/services/seating/orchestrator.test.ts` | UPDATE | `applyManualTableClose` の tx assert（commit / isBroken / overflow throw / 非 member deny / race skip） |
| `src/lib/hooks/useTableClose.ts` | CREATE | 閉鎖対象 state + busy + confirm/cancel + `applyManualTableClose` 呼出 + AppError ラップを集約（`useManualSeatChange` 規範） |
| `src/lib/hooks/useTableClose.test.tsx` | CREATE | hook の振る舞い test（request→confirm→busy→成功 / overflow エラー表示 / cancel） |
| `src/components/tournament/CloseTableConfirmDialog.tsx` | CREATE | 確認ダイアログ。engine `planManualTableClose` で preview/警告を算出、overflow なら confirm 無効 |
| `src/components/tournament/CloseTableConfirmDialog.test.tsx` | CREATE | 成立時の文言 / overflow 警告 + confirm disabled / confirm・cancel handler 発火 |
| `src/components/tournament/SeatingBoard.tsx` | UPDATE | (1) 卓ヘッダに「閉じる」ボタン（`canCloseTable` + 非閉鎖 + 生存卓≥2）、(2) **席行ループを `max(seatsPerTable, 最大席番号)` 行へ**（定員引き上げ可視化） |
| `src/components/tournament/SeatingBoard.test.tsx` | CREATE | 新規。「閉じる」ボタンの表示条件 + effective seat count 描画（seatNum>seatsPerTable の player が見える）を検証 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `useTableClose` 配線 + `CloseTableConfirmDialog` 描画 + SeatingBoard に `canCloseTable` / `onCloseTable` を渡す |
| `tests/e2e/manual-table-close.spec.ts` | CREATE | 「3 卓 → 1 卓閉鎖 → 残卓に集約（seatsPerTable 超）」が user-observable に成立する E2E |
| `.claude/rules/error-logging.md` | UPDATE | `seating/*` の例に `seating/table-close-overflow` / `seating/table-close-last` を追記 |

## NOT Building

- **卓を増やす／閉じた卓を再開**（reopen / 追加）— Phase 4 の責務。本 Phase は「閉じる」一方向のみ。
- **`autoSeatLateEntry` の定員引き上げ追従** — late entry 自動配席は引き続き `seatsPerTable` 定員で動く（>seatsPerTable の卓には新規自動配席しない）。閉鎖後に人数が更に増えた場合は Phase 4（卓追加）で対応。本 Phase ではこの挙動を**意図的に維持**し、plan の Notes に明記する。
- **自動バランシング（`planTableBreak` / `BalancingInstructionCard`）の変更** — 既存の TDA 自動指示は据え置き。手動閉鎖は additive な別経路。
- **`firestore.rules` の変更** — 閉鎖（`isBroken=true`）も再配置（`tableNum/seatNum/isPlayingDealer` 更新）も既存 rule でカバー済み（Risks / Task 3 GOTCHA 参照）。新規 emulator validator は不要。
- **リングゲーム管理** — PRD で明示的に Won't。
- **Cloud Functions 化** — 将来課題。

---

## Step-by-Step Tasks

### Task 1: engine に `planManualTableClose` 純関数を追加

- **ACTION**: `src/lib/services/seating/engine.ts` に判別 union 型 `ManualTableClosePlan` と `planManualTableClose()` を追加。`planTableBreak` の直後に置く。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 3 (07-third-dryrun-improvements): 運営者が**指定した卓**を閉じる手動閉鎖の計画。
   *
   * planTableBreak（自動・最少人数卓固定・定員 seatsPerTable）と異なり:
   *   - 閉じる卓 `targetTableNum` を運営者が指定する
   *   - 残卓は seatsPerTable を一時的に超えて `maxSeatsPerTable`(=MAX_SEATS_PER_TABLE) まで収容する
   *   - 収まらなければ ok:false（overflow）を返し、呼出側で警告して tx を発行しない
   *
   * 詰め込みアルゴリズムは planTableBreak と同じ「占有最少の生存卓へ・同数なら tableNum 昇順・
   * 空席は seat 1 から探索」を踏襲し、定員のみ maxSeatsPerTable に差し替える。
   * occupancy < maxSeatsPerTable のとき 1..maxSeatsPerTable に必ず空席があるため seatNum は
   * 常に <= maxSeatsPerTable(=10) に収まる（rule の seatNum<=10 と整合）。
   */
  export type ManualTableClosePlan =
    | { ok: true; plan: TableBreakPlan }
    | {
        ok: false;
        reason: "not-found" | "only-one-table" | "overflow";
        /** overflow 時: 残卓の最大収容人数 (= 生存卓数 × maxSeatsPerTable)。 */
        capacity?: number;
        /** overflow 時: 残卓へ配置する必要のある総人数。 */
        needed?: number;
      };

  export function planManualTableClose(
    seatedPlayers: PlayerDoc[],
    brokenTableNums: number[],
    targetTableNum: number,
    maxSeatsPerTable: number = MAX_SEATS_PER_TABLE,
  ): ManualTableClosePlan {
    const active = seatedPlayers.filter((p) => !p.isBusted && p.tableNum !== null);
    const liveTableNums = Array.from(new Set(active.map((p) => p.tableNum as number)))
      .filter((n) => !brokenTableNums.includes(n))
      .sort((a, b) => a - b);
    // 対象卓が生存卓に存在しない（既に閉鎖 / 不正値 / 空卓で active 0 だが…下記注記）
    if (!liveTableNums.includes(targetTableNum)) {
      // 空卓（active 0）でも閉じられるよう、brokenTableNums に無く targetが正の整数なら通す。
      // ただし liveTableNums は active 由来のため、空卓は含まれない。空卓の扱いは GOTCHA 参照。
      if (
        brokenTableNums.includes(targetTableNum) ||
        liveTableNums.length === 0
      ) {
        return { ok: false, reason: "not-found" };
      }
      // 空卓閉鎖: 移動 0 件で閉じる（survivors は変化なし）。
      return { ok: true, plan: { brokenTableNum: targetTableNum, moves: [] } };
    }
    if (liveTableNums.length <= 1) {
      return { ok: false, reason: "only-one-table" };
    }

    const survivingTables = liveTableNums.filter((n) => n !== targetTableNum);
    const brokenPlayers = active
      .filter((p) => p.tableNum === targetTableNum)
      .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0));
    const survivorActive = active.filter((p) => p.tableNum !== targetTableNum).length;

    // 収容可能性の必要十分条件: (生存卓の現人数 + 移動人数) <= 生存卓数 × maxSeatsPerTable。
    // greedy（占有最少へ詰める）は容量が足りる限り必ず成功する（pigeonhole）。
    const capacity = survivingTables.length * maxSeatsPerTable;
    const needed = survivorActive + brokenPlayers.length;
    if (needed > capacity) {
      return { ok: false, reason: "overflow", capacity, needed };
    }

    const occupiedBySurvivor = new Map<number, Set<number>>();
    for (const t of survivingTables) occupiedBySurvivor.set(t, new Set());
    for (const p of active) {
      if (p.tableNum !== targetTableNum && p.seatNum !== null) {
        occupiedBySurvivor.get(p.tableNum as number)?.add(p.seatNum);
      }
    }
    const moves: BalancingMove[] = [];
    for (const p of brokenPlayers) {
      const candidates = survivingTables
        .map((t) => ({ t, count: occupiedBySurvivor.get(t)?.size ?? 0 }))
        .filter((c) => c.count < maxSeatsPerTable)
        .sort((a, b) => (a.count !== b.count ? a.count - b.count : a.t - b.t));
      // capacity チェック済みのため candidates が空になることはないが防御的に。
      if (candidates.length === 0) {
        return { ok: false, reason: "overflow", capacity, needed };
      }
      const target = candidates[0];
      let seat = 1;
      while (occupiedBySurvivor.get(target.t)?.has(seat)) seat++;
      moves.push({
        playerId: p.id,
        from: { tableNum: targetTableNum, seatNum: p.seatNum as number },
        to: { tableNum: target.t, seatNum: seat },
      });
      occupiedBySurvivor.get(target.t)?.add(seat);
    }
    return { ok: true, plan: { brokenTableNum: targetTableNum, moves } };
  }
  ```
- **MIRROR**: `planTableBreak`（engine.ts:327-379）の後半（survivor 詰め込み）。差分は「閉じる卓を引数で指定」「定員 = `maxSeatsPerTable`」「判別 union 戻り値」。
- **IMPORTS**: 既存（`MAX_TABLES` は import 済み）。**`MAX_SEATS_PER_TABLE` を `@/lib/limits` の import に追加**（engine.ts:8 の import 行に `MAX_SEATS_PER_TABLE` を足す）。`BalancingMove` / `TableBreakPlan` は同ファイル内型。
- **GOTCHA**:
  - **空卓（active 0 の卓）の扱い**: `liveTableNums` は active player の `tableNum` から導出するため、全員 bust / 既移動で 0 人になった卓は含まれない。空卓を閉じたい現場もある（脱落で誰もいなくなった卓）が、本 Phase の閉鎖トリガは UI（SeatingBoard 卓ヘッダ）であり、SeatingBoard は `tables` collection を真実源に卓カードを出すため `targetTableNum` は実在卓を指す。空卓閉鎖は「moves 0 件 + isBroken=true」で成立する分岐を上記に含めた（`brokenTableNums` に無い限り `not-found` にしない）。ただし `liveTableNums.length <= 1` の last-table 判定は **active 由来**なので、空卓が混じると判定がズレる可能性がある → **Task 7 の UI 側で「生存卓（tables.isBroken=false）が 2 つ以上」をボタン表示条件にする**ことで二重防御し、engine は active ベースのまま単純化する。テストで空卓ケースを固定する（Task 2）。
  - **seatNum 上限**: `maxSeatsPerTable` の既定値は `MAX_SEATS_PER_TABLE`(10)。これ以外を渡さない（rule の `seatNum <= 10` と drift させない）。
  - **PD の扱いは engine では未考慮**: 移動した player の PD reset は orchestrator（`applyTableBreak`）が `isPlayingDealer: false` を書くため engine plan には含めない（`planTableBreak` と同じ責務分担）。
- **VALIDATE**: Task 2 の unit test green（`npm run test -- engine`）。

### Task 2: engine の characterization test を追加

- **ACTION**: `src/lib/services/seating/engine.test.ts` の `describe("planTableBreak")` の直後に `describe("planManualTableClose")` を追加。`planManualTableClose` を import に追記。
- **IMPLEMENT** — 最低限のケース（`p({ ... })` factory は既存。`MAX_SEATS_PER_TABLE` の代わりに明示値 10 を渡すか既定値を使う）:
  1. **指定卓を閉じて残卓へ集約（定員内）**: 卓1:3, 卓2:3, 卓3:3（seatsPerTable=9）、`targetTableNum=3` → `ok:true`、`plan.brokenTableNum=3`、`moves.length=3`、移動先は卓1/2 のいずれか。
  2. **定員引き上げ（seatsPerTable 超）**: 卓1:6, 卓2:6, 卓3:4（**seatsPerTable=6**, maxSeatsPerTable=10）、`targetTableNum=3` → `ok:true`。卓1/2 が 8 名まで膨らむ → 少なくとも 1 つの move の `to.seatNum` が 6 超（7 or 8）であることを assert（一時定員引き上げの user-visible 根拠）。
  3. **overflow でブロック**: 卓1:10, 卓2:10, 卓3:2（maxSeatsPerTable=10）、`targetTableNum=3` → `ok:false`、`reason:"overflow"`、`capacity=20`、`needed=22`。
  4. **最後の 1 卓は閉じられない**: 卓1:3（他なし）、`targetTableNum=1` → `ok:false`、`reason:"only-one-table"`。
  5. **存在しない / 既閉鎖卓**: 卓1:3, 卓2:3、`brokenTableNums=[2]`、`targetTableNum=2` → `ok:false`、`reason:"not-found"`。
  6. **空卓（active 0）の閉鎖**: 卓1:3, 卓2:3 の active のみ（卓3 は tables には在るが active 0 = seated に含まれない）、`targetTableNum=3` → `ok:true`、`moves.length=0`、`brokenTableNum=3`。
  7. **詰め込みは占有最少卓・同数なら tableNum 昇順**: 卓1:1, 卓2:4, 卓3:2、`targetTableNum=3`（2 名）→ 2 名とも卓1（最少）へ、seat は空き昇順。
- **MIRROR**: `describe("planTableBreak")`（engine.test.ts:448-524）の人数構成コメント + assert スタイル。
- **IMPORTS**: 既存 import に `planManualTableClose` を追加。`MAX_SEATS_PER_TABLE` を使うなら `@/lib/limits` から import（既存 test が import 済みか確認、無ければ追加）。
- **GOTCHA**: ケース 2 は **seatsPerTable=6 を渡しつつ maxSeatsPerTable=10**（既定値）で呼ぶことで「一時引き上げ」を検証する。`planManualTableClose(seated, [], 3)` のように第4引数を省略すると既定 10。seatsPerTable は engine 関数の引数には無い（plan は maxSeatsPerTable のみ使う）点に注意 — seatsPerTable 概念は UI/orchestrator 側にしかない。
- **VALIDATE**: `npm run test -- engine` green。

### Task 3: orchestrator に `applyManualTableClose` を追加

- **ACTION**: `src/lib/services/seating/orchestrator.ts` に `applyManualTableClose()` を export 追加。private `applyTableBreak` の手前（`applyBalancingOnce` 付近）に置く。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 3 (07): 運営者が指定卓を手動で閉じる。
   *
   * engine.planManualTableClose で「指定卓を閉じ、残卓へ定員 ≤MAX_SEATS_PER_TABLE で再配置」する
   * plan を算出し、成立すれば既存 private applyTableBreak（moves + isBroken=true を同一 tx で commit、
   * 移動 player の PD reset、seat-taken race guard）を**そのまま再利用**する。
   *
   * 収容不能（overflow）/ 最後の 1 卓（only-one-table）は AppError を throw して UI に警告させる
   * （tx を発行しない = rule deny でトーナメントを止めない）。not-found は applied=false で静かに返す。
   */
  export async function applyManualTableClose(
    tid: string,
    uid: string,
    userGroupIds: string[],
    targetTableNum: number,
    players: PlayerDoc[],
    tables: TableDoc[],
    seatsPerTable: number,
  ): Promise<ApplyBalancingResult> {
    const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
    const result = planManualTableClose(
      players,
      brokenTableNums,
      targetTableNum,
      MAX_SEATS_PER_TABLE,
    );
    if (!result.ok) {
      if (result.reason === "overflow") {
        const wrapped = new AppError(
          `残卓に収まりません（最大 ${MAX_SEATS_PER_TABLE} 名/卓 × ${
            (result.capacity ?? 0) / MAX_SEATS_PER_TABLE
          } 卓 = ${result.capacity} 名、配置必要 ${result.needed} 名）。先に脱落者をバストさせてから閉じてください。`,
          "seating/table-close-overflow",
        );
        logger.warn(wrapped.message, { code: wrapped.code, tid, targetTableNum });
        throw wrapped;
      }
      if (result.reason === "only-one-table") {
        const wrapped = new AppError(
          "最後の 1 卓は閉鎖できません",
          "seating/table-close-last",
        );
        logger.warn(wrapped.message, { code: wrapped.code, tid, targetTableNum });
        throw wrapped;
      }
      // not-found（既閉鎖 / 不正値）: 静かに no-op。次の subscribe で UI 整合。
      logger.info("manual table close skipped (not found)", { tid, targetTableNum });
      return { applied: false, description: null };
    }
    return await applyTableBreak(tid, uid, userGroupIds, result.plan, players);
  }
  ```
  - `seatsPerTable` 引数は現状 plan には未使用だが、呼出側 API の一貫性（他 apply 系と同シグネチャ）と将来の per-table 定員拡張余地のため受け取る。**eslint の unused 警告**を避けるため、使わないなら引数から外すか、`void seatsPerTable` で明示。→ **本 plan では引数から外す**（YAGNI。後述 GOTCHA）。
- **MIRROR**: `applyBalancingOnce`（orchestrator.ts:367-387）の「brokenTableNums 導出 → engine plan → applyTableBreak 委譲」。AppError 変換は `commitInitialSeating` の catch（197-224）の `instanceof` 分岐スタイルを discriminant 版に。
- **IMPORTS**: `planManualTableClose` を engine import（orchestrator.ts:23-34 のブロック）に追加。`MAX_SEATS_PER_TABLE` を `@/lib/limits` から import 追加（現状 orchestrator は limits を import していない可能性 → 追加）。`AppError` / `logger` / `TableDoc` / `applyTableBreak` は既存。
- **GOTCHA**:
  - `applyTableBreak` は **private（非 export）**。同一モジュール内なので直接呼べる。export 化は不要。
  - **`seatsPerTable` 引数を実際に外す**: plan が使わないなら混乱を生むため、最終シグネチャは `applyManualTableClose(tid, uid, userGroupIds, targetTableNum, players, tables)` とし、`MAX_SEATS_PER_TABLE` を内部固定で使う。Task 5/6/7 の呼出も合わせる（本 plan 以降の記述はこの 6 引数版を正とする）。
  - overflow メッセージの `capacity / MAX_SEATS_PER_TABLE` は割り切れる（capacity は生存卓数×10）。整数表示でよい。
  - moves 0 件（空卓閉鎖）でも `applyTableBreak` は `tx.update(tablesRef, { isBroken: true })` だけ実行し applied=true を返す（orchestrator.ts:923-946 で空 moves を安全に処理）。
- **VALIDATE**: Task 4 の orchestrator unit test green。

### Task 4: orchestrator unit test を追加

- **ACTION**: `src/lib/services/seating/orchestrator.test.ts` に `describe("applyManualTableClose")` を追加。`applyManualTableClose` を import（51-60 のブロック）に追記。
- **IMPLEMENT** — `mockTransaction` / `player` / `makeTournament` / `stripId` を流用:
  1. **成立 commit**: 卓1:1, 卓2:1, 卓3:2、`targetTableNum=2`（running）→ tx.get 順 [tournament, b1(move対象), survivors(卓1 の a1)]。`applied=true`、`break=true`、最後の captured patch が `isBroken:true`、player patch が卓1 へ移動 + `isPlayingDealer:false`。`description` に「Table 2 を閉鎖」を含む（`applyTableBreak` の desc）。
  2. **overflow で throw**: 卓1:10, 卓2:10, 卓3:2、`targetTableNum=3` → `await expect(applyManualTableClose(...)).rejects.toMatchObject({ code: "seating/table-close-overflow" })`。`runTransaction` が**呼ばれない**ことを assert（`expect(runTransaction).not.toHaveBeenCalled()`）。
  3. **only-one-table で throw**: 卓1:3 のみ、`targetTableNum=1` → `code: "seating/table-close-last"`、tx 未発行。
  4. **not-found で applied=false**: `brokenTableNums=[3]`（tables の卓3 が isBroken）、`targetTableNum=3` → `applied=false`、tx 未発行。
  5. **非 member で deny**: `applyManualTableClose("t1","u1",["g-other"],2,seated,tables)` → `loadTournamentInTx` の group 突合で reject（既存 `applyTableBreak` 系テスト 547/673 と同形。tx 内 throw → wrap で `firestore/...`）。
  6. **（任意）race skip**: move 対象 player が tx 内で別席に居る → `applied=false`（`applyTableBreak` の moved race guard 経由）。
- **MIRROR**: `describe("applyBalancingOnce → applyTableBreak (TG2)")`（orchestrator.test.ts:554-609）の tx.get 順コメント + captured patch assert。overflow/last の「tx 未発行」は engine が早期 return する Phase 3 の新規観点。
- **IMPORTS**: 既存 + `applyManualTableClose`。`runTransaction` は既に import 済み（44 行）。
- **GOTCHA**:
  - overflow/last ケースは engine が plan 前に弾くため **`runTransaction` を mock しない**（呼ばれないことの assert が要点）。`beforeEach` の `mockReset` 済みなので `.not.toHaveBeenCalled()` が有効。
  - `tables` fixture は `{ id, tableNum, isBroken, createdAt, label, color }` 形（既存 TG2 fixture：565-568 行）。
  - ケース 1 の tx.get 順序は閉じる卓の人数 + survivors の既存 player 数に依存。fixture をシンプル（移動 1 件 / survivor 1 件）にして読みやすく。
- **VALIDATE**: `npm run test -- orchestrator` green。

### Task 5: `useTableClose` hook を新設

- **ACTION**: `src/lib/hooks/useTableClose.ts` を作成。
- **IMPLEMENT**:
  ```ts
  "use client";
  import { useCallback, useState } from "react";
  import { AppError, formatErrorForDisplay } from "@/lib/errors";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TableDoc } from "@/lib/firebase/schemas/table";
  import { logger } from "@/lib/logger";
  import { applyManualTableClose } from "@/lib/services/seating/orchestrator";

  interface Args {
    tid: string;
    uid: string | null;
    groupIds: string[];
    players: PlayerDoc[];
    tables: TableDoc[];
    onError: (message: string) => void;
  }
  interface Result {
    /** 確認ダイアログ表示対象の卓番号（null = 非表示）。 */
    pendingTableNum: number | null;
    busy: boolean;
    /** SeatingBoard の「閉じる」ボタンから呼ぶ。確認ダイアログを開く。 */
    requestClose: (tableNum: number) => void;
    /** ダイアログのキャンセル。 */
    cancelClose: () => void;
    /** ダイアログの確定。orchestrator を呼び、成功で閉じる。 */
    confirmClose: () => Promise<void>;
  }

  export function useTableClose({ tid, uid, groupIds, players, tables, onError }: Args): Result {
    const [pendingTableNum, setPendingTableNum] = useState<number | null>(null);
    const [busy, setBusy] = useState(false);

    const requestClose = useCallback((tableNum: number) => {
      setPendingTableNum(tableNum);
    }, []);
    const cancelClose = useCallback(() => {
      setPendingTableNum(null);
    }, []);

    const confirmClose = useCallback(async () => {
      if (!uid || pendingTableNum === null || busy) return;
      setBusy(true);
      try {
        const result = await applyManualTableClose(
          tid, uid, groupIds, pendingTableNum, players, tables,
        );
        if (!result.applied) {
          onError("卓を閉じられませんでした（状態が変わった可能性）。再度ご確認ください。");
          return;
        }
        setPendingTableNum(null);
      } catch (e) {
        // applyManualTableClose は内部で warn 済み。UI 表示のみ。
        const wrapped = AppError.from(e, "firestore/write_failed", "卓の閉鎖に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code, tid, tableNum: pendingTableNum });
        onError(formatErrorForDisplay(wrapped));
      } finally {
        setBusy(false);
      }
    }, [uid, pendingTableNum, busy, tid, groupIds, players, tables, onError]);

    return { pendingTableNum, busy, requestClose, cancelClose, confirmClose };
  }
  ```
- **MIRROR**: `useManualSeatChange`（useManualSeatChange.ts:72-185）の busy / onError / AppError ラップ / `useCallback` 依存配列。ダイアログ state（pendingTableNum）は本 hook 固有。
- **IMPORTS**: 上記の通り。`unwrapOrFrom` ではなく `AppError.from` を使う（orchestrator が既に warn 済みのため二重 warn 回避には `unwrapOrFrom` が望ましい → **`unwrapOrFrom` を使う**: `const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の閉鎖に失敗しました");`。error-logging.md の二重 warn 禁止に従い、`logger.warn` は省くか `unwrapOrFrom` で既存 code を尊重する。`useManualSeatChange` は `AppError.from` + logger.warn の形だが、orchestrator が既に warn 済みなので `unwrapOrFrom` + 追加 warn なしが規約準拠。本 plan は `unwrapOrFrom` を採用し追加 `logger.warn` を行わない）。
- **GOTCHA**:
  - **二重 warn 回避**: `applyManualTableClose` → `applyTableBreak` 内 / overflow throw 時に既に `logger.warn` 済み。hook 側で再度 `AppError.from` + `logger.warn` すると二重ログ（error-logging.md 禁止）。`unwrapOrFrom(e, ...)` で既存 AppError を素通しし、UI 表示のみ行う。
  - timer / unmount cleanup は本 hook には不要（`useManualSeatChange` の 30 秒 undo timer のような副作用は持たない）。
- **VALIDATE**: Task 6 の hook test green。

### Task 6: `useTableClose` hook の test を新設

- **ACTION**: `src/lib/hooks/useTableClose.test.tsx` を作成（`renderHook` + `act`）。
- **IMPLEMENT** — orchestrator を mock 境界で割る:
  - `vi.mock("@/lib/services/seating/orchestrator", () => ({ applyManualTableClose: vi.fn() }))`
  - test 1: `requestClose(3)` → `pendingTableNum === 3`。
  - test 2: `cancelClose()` → `pendingTableNum === null`。
  - test 3: 成功（`applyManualTableClose` resolve `{applied:true,...}`）→ `confirmClose()` で `applyManualTableClose` が `(tid, uid, groupIds, 3, players, tables)` で呼ばれ、`pendingTableNum` が null に戻る。busy が確定後 false。
  - test 4: overflow（`applyManualTableClose` reject `new AppError("...","seating/table-close-overflow")`）→ `onError` が呼ばれ、`pendingTableNum` は維持（ダイアログ開いたまま再操作可能）。
  - test 5: `applied:false` → `onError` が「再度ご確認ください」系で呼ばれる。
- **MIRROR**: `useManualSeatChange.test.tsx`（mock 境界 = orchestrator、`renderHook`/`act`）。
- **IMPORTS**: `renderHook`, `act` from `@testing-library/react`、vitest。
- **GOTCHA**: helper 境界（orchestrator）で mock し、内部の engine / Firestore は触らない（testing.md mock 境界規約）。`uid` null 時に no-op になることも 1 ケース入れると堅い。
- **VALIDATE**: `npm run test -- useTableClose` green。

### Task 7: `CloseTableConfirmDialog` component を新設

- **ACTION**: `src/components/tournament/CloseTableConfirmDialog.tsx` を作成。preview は engine `planManualTableClose` で算出。
- **IMPLEMENT**:
  ```tsx
  "use client";
  import { useMemo } from "react";
  import { Button } from "@/components/ui/button";
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TableDoc } from "@/lib/firebase/schemas/table";
  import { MAX_SEATS_PER_TABLE } from "@/lib/limits";
  import { formatTableLabel } from "@/lib/services/format-table-label";
  import { planManualTableClose } from "@/lib/services/seating/engine";

  interface Props {
    /** 対象卓番号。null でダイアログ非表示。 */
    tableNum: number | null;
    players: PlayerDoc[];
    tables: TableDoc[];
    busy: boolean;
    onConfirm: () => void;
    onCancel: () => void;
  }

  export function CloseTableConfirmDialog({ tableNum, players, tables, busy, onConfirm, onCancel }: Props) {
    const open = tableNum !== null;
    const preview = useMemo(() => {
      if (tableNum === null) return null;
      const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
      return planManualTableClose(players, brokenTableNums, tableNum, MAX_SEATS_PER_TABLE);
    }, [tableNum, players, tables]);

    const table = tables.find((t) => t.tableNum === tableNum) ?? null;
    const label = table ? formatTableLabel(table) : `Table ${tableNum}`;
    const overflow = preview?.ok === false && preview.reason === "overflow";
    const lastTable = preview?.ok === false && preview.reason === "only-one-table";
    const moveCount = preview?.ok ? preview.plan.moves.length : 0;

    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) onCancel(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{label} を閉じる</DialogTitle>
            <DialogDescription>
              {overflow
                ? `残卓に収まりません（最大 ${MAX_SEATS_PER_TABLE} 名/卓 × ${
                    ((preview as { capacity?: number }).capacity ?? 0) / MAX_SEATS_PER_TABLE
                  } 卓 = ${(preview as { capacity?: number }).capacity} 名、配置必要 ${
                    (preview as { needed?: number }).needed
                  } 名）。先に脱落者をバストさせてから閉じてください。`
                : lastTable
                  ? "最後の 1 卓は閉鎖できません。"
                  : `このテーブルの ${moveCount} 名を残りの卓へまとめます。残卓は一時的に最大 ${MAX_SEATS_PER_TABLE} 名まで増えます。`}
            </DialogDescription>
          </DialogHeader>
          {overflow ? (
            <p className="text-sm text-destructive" role="alert">
              収まらないため閉鎖できません。
            </p>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={onCancel} disabled={busy}>キャンセル</Button>
            <Button
              variant="destructive"
              onClick={onConfirm}
              disabled={busy || overflow || lastTable}
              aria-label="close-table-confirm"
            >
              {busy ? "閉鎖中…" : "閉じる"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  ```
- **MIRROR**: `AddParticipantDialog`（Dialog 構造 / DialogFooter / submitting 表示 / role="alert"）、`BalancingInstructionCard`（`useMemo` で engine 呼出 + `formatTableLabel`）、dashboard の削除確認 Dialog（destructive ボタン）。
- **IMPORTS**: 上記。
- **GOTCHA**:
  - **preview は presentational 計算**: 実際の整合性（race）は orchestrator tx が担保。ダイアログ open 中に subscribe で players/tables が更新されれば `useMemo` が再計算され overflow 表示も追従する。
  - overflow / lastTable で confirm を **disabled** にし、誤実行を UI で防ぐ。最終防衛は orchestrator の throw（Task 3）。
  - `preview` の判別 union を JSX で読むときの型ナローイング: `preview?.ok === false && preview.reason === "overflow"` で narrowing 済み。capacity/needed アクセスは `preview.reason==="overflow"` ブランチ内に閉じる形に整理してもよい（上記は簡略のため cast を使用。実装時は判別 union を素直に分岐して cast を避けるのが望ましい）。
- **VALIDATE**: Task 8 の component test green。

### Task 8: `CloseTableConfirmDialog` の test を新設

- **ACTION**: `src/components/tournament/CloseTableConfirmDialog.test.tsx` を作成（RTL）。
- **IMPLEMENT**:
  - fixture factory `fakePlayer` / `fakeTable`（testing.md fixture factory）。
  - test 1: 通常（卓3 を閉じて 2 名移動可能）→ 「2 名を残りの卓へまとめます」文言、confirm ボタン enabled。
  - test 2: overflow（残卓満杯）→ 「残卓に収まりません」文言 + `role="alert"` + confirm `disabled`。
  - test 3: confirm click → `onConfirm` 発火。cancel click → `onCancel` 発火。
  - test 4: `tableNum=null` → ダイアログ非表示（`queryByRole("dialog")` null）。
- **MIRROR**: `AddParticipantDialog.test.tsx`（Dialog の RTL 検証）。
- **IMPORTS**: RTL + vitest。engine は mock せず**本物**を使う（pure で副作用なし、preview の実挙動を検証するため）。
- **GOTCHA**: shadcn Dialog は Radix。jsdom で open 時の portal 描画は `AddParticipantDialog.test.tsx` で実績あり（同設定を踏襲）。`role="alert"` で overflow メッセージを取得。
- **VALIDATE**: `npm run test -- CloseTableConfirmDialog` green。

### Task 9: SeatingBoard に「閉じる」ボタン + 可変席数描画を追加

- **ACTION**: `src/components/tournament/SeatingBoard.tsx` を 2 点改修。
- **IMPLEMENT**:
  1. **Props 追加**（`Props` interface に）:
     ```ts
     /** Phase 3: 卓を閉じる権限（organizer + canManage + 進行系 state）。onCloseTable と組で渡す。 */
     canCloseTable?: boolean;
     /** Phase 3: 「閉じる」ボタン handler。dashboard の useTableClose.requestClose を渡す。 */
     onCloseTable?: (tableNum: number) => void;
     ```
     関数引数の分割代入にも `canCloseTable = false, onCloseTable` を追加。
  2. **生存卓数を算出**（`sortedTables` の近く）:
     ```ts
     const liveTableCount = useMemo(
       () => tables.filter((t) => !t.isBroken).length,
       [tables],
     );
     ```
  3. **卓ヘッダ右 span に「閉じる」ボタン**（SeatingBoard.tsx:216-231 の `<span className="flex items-center gap-2">` 内、✎ Popover の隣）:
     ```tsx
     {canCloseTable && onCloseTable && !table.isBroken && liveTableCount > 1 ? (
       <button
         type="button"
         className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
         onClick={() => onCloseTable(table.tableNum)}
         aria-label={`close-table-${table.tableNum}`}
       >
         閉じる
       </button>
     ) : null}
     ```
  4. **席行ループを可変化**（SeatingBoard.tsx:234-254）: 各卓の最大席番号を求め、`max(seatsPerTable, 最大席番号)` 行を描画する:
     ```tsx
     // Phase 3: 手動卓閉鎖で残卓が seatsPerTable を一時的に超える（最大 MAX_SEATS_PER_TABLE）。
     // 描画行数を「seatsPerTable と実在最大席番号の大きい方」に広げ、定員引き上げ後も全員を可視化する。
     const maxOccupiedSeat = tableSeated.reduce(
       (max, p) => (p.seatNum !== null && p.seatNum > max ? p.seatNum : max),
       0,
     );
     const renderSeatCount = Math.max(seatsPerTable, maxOccupiedSeat);
     // ... <ul> 内:
     {Array.from({ length: renderSeatCount }, (_, i) => i + 1).map((seatNum) => ( <SeatRow ... /> ))}
     ```
     `renderSeatCount` は `seatMap` 構築の後・`<ul>` の map で使う。`seatsPerTable` を直接使っている箇所（236 行）を `renderSeatCount` に差し替える。
- **MIRROR**: 既存の卓ヘッダ右 span（✎ / 閉鎖バッジ）構造、`TableLabelEditPopover` の条件付き描画。席ループは既存 `Array.from({ length: seatsPerTable }, ...)`。
- **IMPORTS**: `useMemo` は import 済み。新規 import なし（`MAX_SEATS_PER_TABLE` は描画には不要 — 実 seatNum を見れば十分）。
- **GOTCHA**:
  - **閉鎖済み卓（isBroken=true）** は閉鎖後 active 0 名 → `maxOccupiedSeat=0` → `renderSeatCount=seatsPerTable`、空席行のみ（既存挙動維持、opacity-60 + 閉鎖バッジ）。「閉じる」ボタンは `!table.isBroken` で非表示。
  - **drag/drop**: `renderSeatCount` を増やすと bumped 席も SeatRow として描画され、D&D の drop target / drag source になる（既存 `enableDnd` ロジックはそのまま機能）。`applyManualSeatChange` は seatNum 上限を rule(≤10) に委ねるため問題なし。
  - **生存卓 1 つの保護**: `liveTableCount > 1` でボタン非表示にし、engine の `only-one-table` と二重防御。
  - PD checkbox / ★ / formatTableLabel など既存描画は不変。
- **VALIDATE**: Task 10 の component test green + 手動で「8 名卓が 8 行表示される」確認。

### Task 10: SeatingBoard.test.tsx を新規作成（最小限）

- **ACTION**: `src/components/tournament/SeatingBoard.test.tsx` を作成（現状テスト無し）。Phase 3 の新挙動に絞る。
- **IMPLEMENT**:
  - fixture factory `fakePlayer` / `fakeTable`。
  - test 1: `canCloseTable=true` + onCloseTable + 生存卓 2 → 各非閉鎖卓に `close-table-{n}` ボタンが描画され、click で `onCloseTable(n)` が呼ばれる。
  - test 2: 生存卓 1 つ → 「閉じる」ボタン非表示。
  - test 3: `canCloseTable=false` → ボタン非表示。
  - test 4: **可変席数描画**: `seatsPerTable=6` で seatNum=8 の player を含む卓 → その player の displayName が描画される（8 行描画の user-visible 根拠）。
  - test 5: 閉鎖卓（isBroken=true）→ 「閉じる」ボタン非表示 + 「閉鎖」バッジ表示。
- **MIRROR**: `PlayerList.test.tsx` / `AddParticipantDialog.test.tsx` の RTL + fixture。
- **IMPORTS**: RTL + vitest。D&D（@dnd-kit）は `canManage`/`onMoveSeat` を渡さなければ `enableDnd=false` で plain 描画になり jsdom で安全（SeatingBoard.tsx:262 の早期 return）。close ボタン test は `onMoveSeat` を渡さず `canCloseTable`/`onCloseTable` のみで検証。
- **GOTCHA**: `canManage` の扱い — 「閉じる」ボタンは `canCloseTable` で制御する独立 prop にする（PD/D&D の `canManage` とは別軸。dashboard 側で `canCloseTable={isMember}` を渡す）。test では `canCloseTable` を直接制御。
- **VALIDATE**: `npm run test -- SeatingBoard` green。

### Task 11: dashboard-client に配線

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` に `useTableClose` + `CloseTableConfirmDialog` を配線し、SeatingBoard に props を渡す。
- **IMPLEMENT**:
  1. import 追加: `import { useTableClose } from "@/lib/hooks/useTableClose";` / `import { CloseTableConfirmDialog } from "@/components/tournament/CloseTableConfirmDialog";`
  2. `useManualSeatChange` の近く（236-247 行付近）で hook を呼ぶ:
     ```ts
     const {
       pendingTableNum: closeTableNum,
       busy: closeTableBusy,
       requestClose,
       cancelClose,
       confirmClose,
     } = useTableClose({
       tid,
       uid: user?.uid ?? null,
       groupIds,
       players,
       tables,
       onError: setError,
     });
     ```
  3. SeatingBoard へ props 追加（497-513 行の `<SeatingBoard ... />`）:
     ```tsx
     canCloseTable={isMember}
     onCloseTable={requestClose}
     ```
  4. `<SeatingBoard>` を含む `<Card>` の後（516 行付近）か削除 Dialog の近くで `CloseTableConfirmDialog` を描画:
     ```tsx
     <CloseTableConfirmDialog
       tableNum={closeTableNum}
       players={players}
       tables={tables}
       busy={closeTableBusy}
       onConfirm={() => void confirmClose()}
       onCancel={cancelClose}
     />
     ```
- **MIRROR**: `useManualSeatChange` の配線（dashboard-client.tsx:236-247）と SeatingBoard props 渡し、削除確認 Dialog の配置。
- **IMPORTS**: 上記 2 つ。
- **GOTCHA**:
  - **表示 state**: SeatingBoard は `showSeatingBoard`（seating/running/paused）で描画される（491 行）。「閉じる」は配席後のみ意味を持つため、`canCloseTable={isMember}` で十分（SeatingBoard が出ている時点で seating 以降）。finished では SeatingBoard 自体が非表示（`showSeatingBoard` が false）。
  - `isMember` は既に上流 guard で organizer 確定（283 行）。`canCloseTable={isMember}` は他の `canManage={isMember}` と整合。
  - hook の `players` / `tables` は subscribe state を渡す（リアルタイム反映で preview/overflow が追従）。
- **VALIDATE**: `npx tsc --noEmit` + `npm run lint` + 手動 dev server で閉鎖フロー確認。

### Task 12: E2E spec を新設

- **ACTION**: `tests/e2e/manual-table-close.spec.ts` を作成。
- **IMPLEMENT** — user-observable な集約を 1 シナリオで:
  1. `seedOrganizerTournament(page, { organizer, seatsPerTable: 6 })`。
  2. organizer 自己参加 + ゲストを複数追加して 3 卓構成にする（例: 計 13〜16 名 → seatsPerTable=6 で 3 卓）。`joinAsGuest` を複数 / もしくは Phase 2 の代理受付 UI（`AddParticipantDialog`）で名前のみ参加者を投入して人数を作る（既存 `proxy-receipt.spec.ts` の手順流用が速い）。
  3. commit seating（席決め確定）→ SeatingBoard に 3 卓表示。
  4. 最少人数の卓ヘッダの「閉じる」ボタン（`close-table-{n}`）click → 確認ダイアログ → `close-table-confirm` click。
  5. 期待: 卓が「閉鎖」バッジになり、残卓に集約され、**閉じた卓のプレイヤー名が残卓に出現**（再配置の観測）。残卓が seatsPerTable(6) を超える人数でも全員表示される。
  6. （任意・別 test）overflow シナリオ: 2 卓を満杯(各10)にして 3 卓目を閉じようとすると確認ダイアログの confirm が disabled で「収まりません」が出る。
- **MIRROR**: `tests/e2e/playing-dealer.spec.ts`（seed + selfJoin + guest + commit seating）/ `tests/e2e/proxy-receipt.spec.ts`（人数投入）/ `tests/e2e/table-label-and-color.spec.ts`（SeatingBoard 操作 / Page Object）。
- **IMPORTS**: `./fixtures/test-context` / `./fixtures/flows`。必要なら `pages/TournamentsPage` 等の Page Object に `closeTableButton(n)` セレクタを足す。
- **GOTCHA**:
  - emulator + commit seating は重い → `test.describe.configure({ timeout: 90_000 })`（playing-dealer.spec の先例）。
  - 人数を 3 卓に乗せる確実な方法は **Phase 2 の代理受付（名前のみ）**で organizer 1 端末から一気に投入する形が安定（複数 guest context より速い）。
  - **rule 変更なしのため emulator validator（test-rules-*.mjs）は新設しない**。E2E が user-observable 検証の主役。
- **VALIDATE**: `npm run test:e2e -- manual-table-close`（emulator 起動が前提。CI/ローカルの Playwright 設定に従う）。

### Task 13: ドキュメント更新（error-logging.md）

- **ACTION**: `.claude/rules/error-logging.md` の `seating/*` 行の例に新 code を追記。
- **IMPLEMENT**: 「`seating/*` — 席決め起因」の例示に `seating/table-close-overflow`（残卓収容不能でブロック）/ `seating/table-close-last`（最後の 1 卓は閉鎖不可）を追加。prefix 自体は既存のため一覧表の構造変更は不要。
- **MIRROR**: 既存 `seating/*` の記述形式。
- **IMPORTS**: N/A。
- **GOTCHA**: `firebase-patterns.md` / `group-membership.md` の rule 経路ドキュメントは **本 Phase で rule 変更が無いため更新不要**。Phase 3 は engine/orchestrator/UI のみ。
- **VALIDATE**: 目視（rule 系ドキュメントに誤って Phase 3 の rule 追記をしていないこと）。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `planManualTableClose` 成立 | 3 卓均等 / target=3 | `ok:true` / brokenTableNum=3 / moves=3 | No |
| `planManualTableClose` 定員引き上げ | 卓6/6/4, seatsPerTable=6, target=3 | `ok:true` / 少なくとも 1 move の to.seatNum>6 | Yes（一時定員） |
| `planManualTableClose` overflow | 卓10/10/2, target=3 | `ok:false` / reason=overflow / capacity=20 / needed=22 | Yes |
| `planManualTableClose` last-table | 1 卓のみ / target=1 | `ok:false` / reason=only-one-table | Yes |
| `planManualTableClose` not-found | broken=[2], target=2 | `ok:false` / reason=not-found | Yes |
| `planManualTableClose` 空卓 | target が active 0 卓 | `ok:true` / moves=0 | Yes |
| `applyManualTableClose` commit | running / target=2 | applied=true / isBroken=true / player 移動 + PD reset | No |
| `applyManualTableClose` overflow | 満杯残卓 | `seating/table-close-overflow` throw / tx 未発行 | Yes |
| `applyManualTableClose` last | 1 卓 | `seating/table-close-last` throw / tx 未発行 | Yes |
| `applyManualTableClose` 非 member | g-other | reject（group 突合） | Yes（permission） |
| `useTableClose` request/confirm | requestClose(3)→confirm | orchestrator 呼出 / pending→null | No |
| `useTableClose` overflow | orchestrator reject | onError 呼出 / pending 維持 | Yes |
| `CloseTableConfirmDialog` overflow | 満杯残卓 | 警告文言 + confirm disabled | Yes |
| `SeatingBoard` close button | canCloseTable + 生存卓2 | `close-table-{n}` 描画 / click で handler | No |
| `SeatingBoard` 可変席 | seatsPerTable=6, seat=8 player | 当該 player が描画される | Yes |

### Edge Cases Checklist

- [x] Empty input（空卓閉鎖 → moves 0 件で成立）
- [x] Maximum size input（残卓 10 名定員 + overflow ブロック）
- [x] Invalid types（not-found = 既閉鎖/不正卓番号）
- [x] Concurrent access（`applyTableBreak` の moved / seat-taken race guard を継承。閉鎖中に他端末で bust/late entry が走っても tx で検出 → skip）
- [ ] Network failure（`wrapFirestoreWrite` が `firestore/write_failed` にラップ。既存契約のため新規テスト不要）
- [x] Permission denied（非 member の `loadTournamentInTx` group 突合 reject。rule の players/tables organizer 限定が最終防衛）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```

EXPECT: Zero type errors

> ※ `tsc` は settings で allow 済み。

### Lint

```bash
npm run lint
```

EXPECT: No lint errors（console.* 残置 / 手書き型ガード / unused 引数なし）

### Unit Tests

```bash
npm run test -- engine orchestrator useTableClose CloseTableConfirmDialog SeatingBoard
```

EXPECT: All affected unit tests pass

### Full Test Suite

```bash
npm run test
```

EXPECT: No regressions（既存 `planTableBreak` / `applyBalancingOnce` / BalancingInstructionCard 系は不変）

### E2E（feature 実装直後 + マージ前）

```bash
npm run test:e2e -- manual-table-close
```

EXPECT: 3 卓 → 1 卓閉鎖 → 残卓集約が user-observable に成立（seatsPerTable 超の人数でも全員表示）

> rule 変更が無いため `test:rules-*` の新規 validator は不要。既存 rules emulator test は非回帰確認として全件は走らせなくてよい（変更していないため）。

### Browser Validation

```bash
npm run dev
```

EXPECT: 運営者で開催中ダッシュボード → SeatingBoard 卓ヘッダ「閉じる」→ 確認 → 残卓に集約。8 名卓が 8 行表示される。残卓満杯時は警告で confirm 無効。

### Manual Validation

- [ ] 3 卓構成（seatsPerTable=6, 例 6/6/4）で 4 名卓を閉じ → 残 2 卓が 8 名ずつ表示
- [ ] 残卓が満杯（各 10 名）のとき 3 卓目を閉じようとすると confirm が disabled + 警告
- [ ] 閉鎖後の卓に「閉鎖」バッジ + opacity、「閉じる」ボタンが消える
- [ ] 移動したプレイヤーの PD（◎）が外れている
- [ ] 再配置後に D&D で席を微調整できる（既存挙動非回帰）
- [ ] `firestore.rules` を変更していないこと（diff 空）

---

## Acceptance Criteria

- [ ] 運営者が SeatingBoard で任意の非閉鎖卓を選んで閉じられる（生存卓 ≥2 のとき）
- [ ] 閉鎖卓のプレイヤーが残卓へ自動再配置され、残卓は最大 10 名まで一時的に定員引き上げされる
- [ ] 残卓に収まらない場合は確認ダイアログで警告し confirm 無効・tx を発行しない
- [ ] 閉鎖（isBroken=true）+ 再配置 + PD reset が同一 tx で commit される
- [ ] 定員引き上げで seatsPerTable を超えた席も SeatingBoard に全員表示される
- [ ] 再配置後に既存 D&D（`applyManualSeatChange`）で微調整できる（非回帰）
- [ ] 既存自動バランシング（`planTableBreak` / BalancingInstructionCard）が非回帰
- [ ] 全 unit test + E2E green、type / lint エラーなし、`firestore.rules` 不変

## Completion Checklist

- [ ] Code follows discovered patterns（engine pure plan / orchestrator が既存 applyTableBreak 再利用 / hook 集約 / Dialog）
- [ ] Error handling matches codebase style（`seating/table-close-*` AppError、二重 warn 回避 = hook は `unwrapOrFrom`）
- [ ] Logging follows conventions（orchestrator の logger.info/warn、console.* なし）
- [ ] Tests follow test patterns（engine characterization / orchestrator mockTransaction / hook・component RTL / fixture factory / mock 境界）
- [ ] No hardcoded values（`MAX_SEATS_PER_TABLE` を limits から参照、卓名は `formatTableLabel`）
- [ ] No unnecessary scope additions（reopen / 卓追加は Phase 4、rule 変更なし）
- [ ] `firestore.rules` を変更していない（閉鎖/再配置は既存 rule でカバー）
- [ ] error-logging.md に新 seating code を追記
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 定員引き上げで seat>seatsPerTable の player が SeatingBoard に描画されず「消える」 | H（修正しなければ確実） | H | Task 9 で席行を `max(seatsPerTable, 最大席番号)` 行に拡張。Task 10 test 4 で固定 |
| 残卓 10 名超の集約を実行 → rule(`seatNum<=10`) deny で tx 失敗・進行停止 | M | H | engine `planManualTableClose` が overflow を事前判定し orchestrator が throw（tx 未発行）。Task 4 で「tx 未発行」を assert |
| 既存 `applyTableBreak` の再利用で予期せぬ副作用（自動バランシングと衝突） | L | M | applyTableBreak は plan を受けるだけの汎用 commit helper。自動経路（planTableBreak）と入力 plan が違うのみ。既存 TG2 test 非回帰で担保 |
| 手動閉鎖と `autoSeatLateEntry` / 自動 break の競合 | L | M | 閉鎖 tx で全員配席されるため未配席 player 0 → autoSeat 不発火。auto break は seatsPerTable 定員の別判定で併存。Notes 参照 |
| 空卓閉鎖時の last-table 判定ズレ（engine が active ベース） | L | L | UI で `liveTableCount(tables ベース) > 1` を二重防御。engine は active ベースのまま単純化、Task 2 で空卓ケース固定 |
| E2E で 3 卓構成を作るのが不安定（複数 guest context） | M | L | Phase 2 代理受付（名前のみ）で organizer 1 端末から人数投入。timeout 90s |

## Notes

- **rule 変更が不要な根拠**: (1) 卓閉鎖は `tables/{n}.isBroken=true` の単独書換で、tables update 経路 A（`!affectedKeys().hasAny(['label','color'])`、organizer 限定）が許可済み（[firestore.rules:692-720](../../../../firestore.rules#L692-L720)）。(2) 再配置は `players/{pid}` の `tableNum(1-6)/seatNum(1-10)/isPlayingDealer(bool)` 更新で、organizer-update branch が許可済み（[firestore.rules:600-644](../../../../firestore.rules#L600-L644)）。定員引き上げ上限 10 は rule の `seatNum<=10` と一致するため drift 無し。**新規 emulator validator も不要**。
- **`applyTableBreak` 再利用の判断**: private `applyTableBreak` は「`TableBreakPlan`（brokenTableNum + moves）を受けて moves + isBroken=true を 1 tx で commit、移動 player の PD を false に倒す、survivor の seat-taken race を guard」する汎用 commit helper。自動経路（`applyBalancingOnce`→`planTableBreak`）と手動経路（`applyManualTableClose`→`planManualTableClose`）は**plan の作り方が違うだけ**で commit は共通化できる。export 不要（同一モジュール内呼出）。
- **late entry 自動配席の定員は据え置き**: `planLateEntrySeat` は `seatsPerTable` 定員で空席を探す（[engine.ts:202-238](../../../../src/lib/services/seating/engine.ts#L202)）。手動閉鎖で 8 名（>seatsPerTable=6）になった卓には新規 late entry が自動配席されない（満席扱い）。これは意図的維持。閉鎖後に更に人数が増える場合は Phase 4（卓追加）で対応する。本 Phase で `planLateEntrySeat` は変更しない。
- **PD reset の仕様**: 閉鎖卓のプレイヤーは移動先で PD 衝突を避けるため `isPlayingDealer=false` に倒される（既存 `applyTableBreak` の Phase 5.1 挙動を継承）。運営者は移動先で再度 PD 指定できる。
- **`applyManualTableClose` のシグネチャ確定**: `(tid, uid, userGroupIds, targetTableNum, players, tables)` の 6 引数。`seatsPerTable` は engine plan が使わない（plan は `MAX_SEATS_PER_TABLE` 内部固定）ため引数に含めない（YAGNI / unused 警告回避）。
- **Phase 4 への引き継ぎ**: 本 Phase の「閉じる」と対になる「再開／卓追加」は Phase 4。Phase 4 は `isBroken=false` 復帰 + 新規卓追加 + `autoSeatLateEntry` の自動配席対象から除外（手動配置正規化）+ 配置ガイドを実装する。SeatingBoard / dashboard の本 Phase 改修（可変席数描画・useTableClose 配線）は Phase 4 の reopen UI が乗る足場になる。
