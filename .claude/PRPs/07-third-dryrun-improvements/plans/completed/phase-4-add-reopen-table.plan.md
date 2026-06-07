# Plan: Phase 4 — 卓を増やす／再開

## Summary

運営者（organizer / owner）が、レイトレジスト等で人数が増えたときに **新規卓を追加**し、また **閉鎖済みの卓を再開**（`isBroken=false`）できるようにする。追加／再開した卓は **`autoSeatLateEntry` の自動配席対象から除外**（= 既存挙動の固定化）し、運営者が **手動 D&D で配置**することを正規とする。未配席の参加者がいるときは「卓を増やす／再開して配置を」と促す軽量ガイドバナーを出す。`MAX_TABLES`(6) 超過は service + UI で deny する。

## User Story

As a 小規模 NLH サークルの運営者,
I want レイトレジストで人数が増えたとき、卓を増やす／閉じた卓を再開して、増えた参加者を手動で配置できるようにしたい,
So that 自動卓数算出では捌けない「席が足りなくなった」現場を、アプリの席指示と現実を一致させたまま回せる。

## Problem → Solution

**Current**:
- 卓は初回席決め (`commitInitialSeating`) で `ceil(参加者数 / seatsPerTable)` 自動算出され、その後 **増やす経路が無い**。`tables/{n}` の有効/無効は `isBroken` フラグだが、`isBroken=false` に戻す（reopen）経路も無い（`markTableBroken` は Phase 3 で orchestrator tx 経由・`reopenTable` 不在、単発 add 用 `upsertTable` は scaffold のまま未使用）。
- レイトレジストで全卓が満席になると `autoSeatLateEntry` → `planLateEntrySeat` が `null`（no-seat）を返し、参加者は **未配席（`tableNum=null`）のまま**。運営者がアプリ内で卓を増やす手段が無く、アプリ外で帳尻を合わせる回避運用になっていた（要望②-B）。

→

**Desired**:
- 運営者が SeatingBoard の **Table List ヘッダ「卓を追加」**で新規卓を作成（次の空き `tableNum`、上限 `MAX_TABLES`(6)）。
- 閉鎖済み卓の **カードヘッダ「再開」**で `isBroken=false` に戻す。
- 追加／再開した卓は **空席のまま自動配席されない**（`planLateEntrySeat` が着席プレイヤー由来の生存卓のみ候補にする既存挙動で自然に成立 → characterization test で固定）。運営者が **既存 D&D**（`applyManualSeatChange`）で未配席者を配置する。
- 未配席者がいる間は **軽量ガイドバナー**で「卓を増やす／再開して D&D 配置を」促す。
- `MAX_TABLES` 到達時は「卓を追加」ボタンを **disabled**（service 側も `seating/too-many-tables` で throw する二重防御）。

実装は **engine の純関数 1（次卓番号算出）+ repository の reopen 関数 1 + hook 1（add/reopen 集約）+ ガイド component 1 + SeatingBoard に「再開」ボタン + dashboard 配線**で行う。**`firestore.rules` は変更不要**（reopen は tables update 経路 A、add は既存 create rule でカバー済み。後述 Risks / Task GOTCHA）。

## Metadata

- **Complexity**: Medium（engine pure 1 / repository 1 / hook 1 / component 1 / SeatingBoard 改修 / dashboard 配線 + 各 test + E2E + docs）
- **Source PRD**: `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md`
- **PRD Phase**: Phase 4 — 卓を増やす／再開
- **Estimated Files**: 15（engine 1 / engine.test 1 / tables repo 1 / tables.test 1 / hook 1 / hook.test 1 / guide 1 / guide.test 1 / SeatingBoard 1 / SeatingBoard.test 1 / dashboard-client 1 / E2E 1 / group-membership.md 1 / firebase-patterns.md 1 / PRD 1）

### 確定済みの設計判断（本 plan 着手前にユーザー確認済み）

- **MAX_TABLES 超過の deny レイヤ**: **service + UI のみ**（`firestore.rules` 不変・Firestore deploy 不要）。既存 players rule の `tableNum <= 6` が「7 卓目には誰も座れない」を保証し、empty な 7 卓目 doc 自体は organizer（信頼ロール）が直接 SDK を叩いた場合のみ作れるが無害（席に誰も置けない）。Phase 3 と同じく rule 不変方針。
- **配置ガイド**: **軽量バナー**（未配席 active 人数 + 名前 + 「卓を増やす／再開して D&D で配置」案内）。未配席者ごとの推奨配置先提示（充実版）はスコープ外。

---

## UX Design

### Before

```
┌─ Table List ───────────────────────────────────────────────┐
│ ┌ Table 1 (9人/満) ✎ [閉じる] ┐ ┌ Table 2 (9人/満) ✎ [閉じる]┐│
│ │ 1: Alice ... 9: Ivan        │ │ 1: ... 9: ...             ││
│ └─────────────────────────────┘ └───────────────────────────┘│
│  ※ 全卓満席。レイトレジストの Zara が join しても自動配席先が │
│    無く tableNum=null のまま放置。卓を増やす UI が無い。      │
└──────────────────────────────────────────────────────────────┘
```

### After

```
┌─ Table List ───────────────────────────── [卓を追加] ───────┐
│ ⚠ 未配席の参加者が 1 名います（Zara）。卓を増やす／閉じた卓を │
│   再開し、D&D で配置してください。                            │
│                                                              │
│ ┌ Table 1 (9人/満) ✎ ┐ ┌ Table 2 (9人/満) ✎ ┐ ┌ Table 3 ───┐│
│ │ ...                │ │ ...                │ │ 1: —（空） ││ ← [卓を追加] or [再開] で
│ └────────────────────┘ └────────────────────┘ │ 2: —      ││    現れた空卓。自動配席されず、
│                                                 └───────────┘│    Zara を D&D でここへ。
└──────────────────────────────────────────────────────────────┘

閉鎖済み卓のヘッダ:
┌ Table 3（0 人）  [閉鎖] [再開] ┐   ← 「再開」で isBroken=false に戻る
│ 1: —  2: —                     │
└────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| Table List カードヘッダ | タイトルのみ | タイトル + 「卓を追加」ボタン（organizer） | `nextTableNum===null`（= 6 卓存在）で disabled |
| 閉鎖済み卓のカードヘッダ | 「閉鎖」バッジ + ✎ | 「閉鎖」バッジ + ✎ + 「再開」ボタン | `canCloseTable`（organizer 管理権限）+ `isBroken` のときのみ |
| 追加／再開した空卓 | （存在しない） | 空席で表示。自動配席されない | `planLateEntrySeat` が着席由来生存卓のみ候補 = 既存挙動の固定化 |
| 未配席者の扱い | 無表示（放置） | 軽量ガイドバナー + D&D で手動配置 | バナーは未配席 active が 1 名以上で表示 |
| 自動配席（既存卓に空席あり時） | 変更なし | 変更なし | 空席のある **既存（着席済み）卓**には従来どおり自動配席が働く |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [src/lib/services/seating/engine.ts](../../../../src/lib/services/seating/engine.ts) | 1-18, 25-33, 202-238, 415-477 | `MAX_TABLES`/`TooManyTablesError` re-export と import 行（`planAddTable` 追加先）。`planLateEntrySeat`（**着席プレイヤー由来の `liveTables` のみ候補にする = 空卓を自動配席しない既存挙動**の根拠）。`planManualTableClose`（直前に `planAddTable` を置く位置・命名規範） |
| P0 (critical) | [src/lib/firebase/repositories/tables.ts](../../../../src/lib/firebase/repositories/tables.ts) | 90-122 | `markTableBroken`（`reopenTable` の対称規範：`updateDoc(isBroken)`+`wrapFirestoreWrite`+`logger.info`）と **既存 `upsertTable`（add で再利用、現状未使用 scaffold）** |
| P0 (critical) | [src/lib/hooks/useTableClose.ts](../../../../src/lib/hooks/useTableClose.ts) | all | hook の規範（busy + `unwrapOrFrom`（二重 warn 回避）+ `onError` + `useCallback`）。`useTableLifecycle` はこれを下敷きにする |
| P0 (critical) | [src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) | 104-130, 240-270 | 卓ヘッダ右 span（「閉鎖」バッジ / ✎ / 「閉じる」ボタン）。**「再開」ボタンを追加する箇所**と `canCloseTable`/`liveTableCount` の表示条件パターン |
| P0 (critical) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 143-150, 251-267, 511-548 | `useSeatingAutoOrchestrator` 配線 / `useTableClose` 配線 / **Table List Card + SeatingBoard + CloseTableConfirmDialog の render 箇所**（add ボタン・guide・reopen handler を足す） |
| P1 (important) | [src/lib/services/seating/orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts) | 201-209, 246-265 | `seating/too-many-tables` の AppError 変換規範（add 上限超過で再利用）。`autoSeatLateEntry`/`planLateEntrySeat` の no-seat 経路（未配席が残る = guide が出る条件） |
| P1 (important) | [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | 127-148 | `showSeatingBoard`（seating/running/paused）/ `isAcceptingLateSeats`。add/reopen UI の表示 state |
| P1 (important) | [src/lib/firebase/repositories/tables.test.ts](../../../../src/lib/firebase/repositories/tables.test.ts) | 53-130 | repository test の mock 基盤（`updateDoc`/`setDoc` mock）。`reopenTable` test は `markTableBroken` test（117-130）を踏襲 |
| P1 (important) | [src/lib/services/seating/engine.test.ts](../../../../src/lib/services/seating/engine.test.ts) | 168-238 | `planLateEntrySeat` の test 群（**空卓除外の characterization test を追記する箇所**）と `p({...})` factory |
| P2 (reference) | [src/components/tournament/SeatingBoard.test.tsx](../../../../src/components/tournament/SeatingBoard.test.tsx) | all | 「閉じる」ボタン表示条件・席描画の RTL 検証（「再開」ボタンと「再開卓の席が droppable」を追記） |
| P2 (reference) | [tests/e2e/manual-table-close.spec.ts](../../../../tests/e2e/manual-table-close.spec.ts) | all | E2E 雛形（`seedOrganizerTournament`/`commitSeatingOnly`/`tournamentDashboardPage`/`addNamedGuest`/`getByTestId`）。reopen/add の round-trip spec はこれを踏襲 |
| P2 (reference) | [src/lib/limits.ts](../../../../src/lib/limits.ts) | 17-24 | `MAX_TABLES`(6) の単一真実源 |
| P2 (reference) | [firestore.rules](../../../../firestore.rules) | 680-724 | tables `allow create`（organizer のみ・tableNum 値域制約なし）/ `allow update` 経路 A（**label/color に触れない update = `isBroken` 単独書換を許可** → reopen がカバー済み）。**rule 変更不要**の根拠 |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | 「tournaments/{tid} 配下 subcollection の rule 設計原則」 | wildcard 厳禁・rule 変更時の drift 規約（本 Phase は rule 不変。変更しないことの裏取り） |

## External Documentation

No external research needed — feature uses established internal patterns（engine pure function / repository `wrapFirestoreWrite` / hook / shadcn Button / @dnd-kit / vitest / Playwright Page Object はすべて既存先例あり）。

---

## Patterns to Mirror

### NAMING_CONVENTION（engine pure plan 関数）

```ts
// SOURCE: src/lib/services/seating/engine.ts:415-420
// engine の plan 関数: plan<動詞/名詞>(...args): <Plan>Type | null。MAX_TABLES は import 済み。
export function planManualTableClose(
  seatedPlayers: PlayerDoc[],
  liveTableNums: number[],
  targetTableNum: number,
  maxSeatsPerTable: number = MAX_SEATS_PER_TABLE,
): ManualTableClosePlan {
```

### REPOSITORY_PATTERN（単一フィールド書換）

```ts
// SOURCE: src/lib/firebase/repositories/tables.ts:90-100
export async function markTableBroken(tid: string, tableNum: number): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル閉鎖に失敗しました",
    async () => {
      await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: true });
    },
    { tid, tableNum },
  );
  logger.info("table broken ok", { tid, tableNum });
}
```

### HOOK_PATTERN（busy + unwrapOrFrom 二重 warn 回避 + onError）

```ts
// SOURCE: src/lib/hooks/useTableClose.ts:66-92
const confirmClose = useCallback(async () => {
  if (!uid || pendingTableNum === null || busy) return;
  setBusy(true);
  try {
    const result = await applyManualTableClose(tid, uid, groupIds, pendingTableNum, players, tables);
    if (!result.applied) { onError("..."); return; }
    setPendingTableNum(null);
  } catch (e) {
    // 下層で warn 済み → unwrapOrFrom で素通し。UI 表示のみ。
    const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の閉鎖に失敗しました");
    onError(formatErrorForDisplay(wrapped));
  } finally {
    setBusy(false);
  }
}, [uid, pendingTableNum, busy, tid, groupIds, players, tables, onError]);
```

### ERROR_HANDLING（上限超過の AppError 変換 — 既存 code 再利用）

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:201-209
if (e instanceof TooManyTablesError) {
  const wrapped = new AppError(
    `テーブル数の上限（${e.max} Tables）を超えました。...`,
    "seating/too-many-tables",
    e,
  );
  logger.warn(wrapped.message, { code: wrapped.code, tid });
  throw wrapped;
}
```

### COMPONENT_PATTERN（卓ヘッダのボタン表示条件）

```tsx
// SOURCE: src/components/tournament/SeatingBoard.tsx:255-269
{canCloseTable && onCloseTable && !table.isBroken && liveTableCount > 1 ? (
  <button
    type="button"
    className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
    onClick={() => onCloseTable(table.tableNum)}
    data-testid={`close-table-${table.tableNum}`}
    aria-label={`${formatTableLabel(table)} を閉じる`}
  >
    閉じる
  </button>
) : null}
```

### TEST_STRUCTURE（repository / engine / component）

```ts
// SOURCE: src/lib/firebase/repositories/tables.test.ts:117-129（reopenTable はこの対称）
describe("markTableBroken", () => {
  it("updates with isBroken: true", async () => {
    await markTableBroken("t1", 2);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.isBroken).toBe(true);
  });
  it("wraps errors", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(markTableBroken("t1", 2)).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});
```

```ts
// SOURCE: src/lib/services/seating/engine.test.ts:230-237（broken 卓除外 → 空卓除外もこの形）
it("broken 卓は対象外", () => {
  const seated = [ p({ id: "a", tableNum: 1, seatNum: 1 }), p({ id: "b", tableNum: 2, seatNum: 1 }) ];
  const seat = planLateEntrySeat(seated, [1], 9, 0);
  expect(seat?.tableNum).toBe(2);
});
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/services/seating/engine.ts` | UPDATE | `planAddTable(existingTableNums, maxTables=MAX_TABLES): number \| null` 純関数を追加（次の空き卓番号 / 上限到達で null） |
| `src/lib/services/seating/engine.test.ts` | UPDATE | `planAddTable` の test + `planLateEntrySeat` に「空卓（着席0）は自動配席対象にならない」characterization test を追記 |
| `src/lib/firebase/repositories/tables.ts` | UPDATE | `reopenTable(tid, tableNum)`（`isBroken=false` 単独書換）を追加（`markTableBroken` の対称）。add は既存 `upsertTable` を再利用 |
| `src/lib/firebase/repositories/tables.test.ts` | UPDATE | `reopenTable` の test（`markTableBroken` を踏襲） |
| `src/lib/hooks/useTableLifecycle.ts` | CREATE | add / reopen の busy + AppError ラップ + `nextTableNum` 導出を集約（`useTableClose` 規範） |
| `src/lib/hooks/useTableLifecycle.test.tsx` | CREATE | add 成功 / 上限で no-op + onError / reopen 成功 / 失敗時 onError の振る舞い test |
| `src/components/tournament/UnseatedPlayersGuide.tsx` | CREATE | 未配席 active 参加者がいるとき「卓を増やす／再開して D&D 配置を」を促す軽量バナー |
| `src/components/tournament/UnseatedPlayersGuide.test.tsx` | CREATE | 表示/非表示（未配席 0 / 1 名以上 / busted 除外 / 名前列挙） |
| `src/components/tournament/SeatingBoard.tsx` | UPDATE | 閉鎖済み卓ヘッダに「再開」ボタン（`onReopenTable` prop 追加、`canCloseTable && isBroken` で表示） |
| `src/components/tournament/SeatingBoard.test.tsx` | UPDATE | 「再開」ボタンの表示条件 + 「再開後（非閉鎖）卓の空席が droppable になる」を検証 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `useTableLifecycle` 配線 / Table List ヘッダに「卓を追加」ボタン / SeatingBoard に `onReopenTable` / `UnseatedPlayersGuide` 描画 |
| `tests/e2e/table-add-reopen.spec.ts` | CREATE | 「閉じる→再開で復活」「卓を追加で新カード出現」「6 卓で追加ボタン disabled」の user-observable round-trip |
| `.claude/rules/group-membership.md` | UPDATE | 権限マトリクスに「卓の追加 / 再開（organizer ○ / member ×）」行を追加 |
| `.claude/rules/firebase-patterns.md` | UPDATE | tables update 経路 A が reopen（`isBroken=false`）も許可する旨 / add は既存 create rule で成立する旨を追記（rule 変更なしの裏取り） |
| `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md` | UPDATE | Phase 4 を `pending` → `in-progress`、PRP Plan リンク追記（完了時 `complete`） |

## NOT Building

- **MAX_TABLES の rule-level deny**（tables create に `tableNum is int && 1..6` 追加）— ユーザー確定で **service + UI のみ**。`firestore.rules` 変更・新規 emulator validator・`test-rules-limits.mjs` 更新・Firestore deploy は **行わない**（既存 players rule の `tableNum<=6` が seating を防御済み、organizer は信頼ロール）。
- **追加／再開卓への自動配席**（`autoSeatLateEntry` で空卓へ自動で座らせる）— PRD で「手動配置を正規」と確定。本 Phase は **既存挙動（空卓は自動配席対象外）を test で固定するのみ**で engine ロジックは変更しない。
- **配置ガイドの充実版**（未配席者ごとの推奨配置先提示）— Should の最小版（軽量バナー）に留める。
- **D&D ロジック自体の新規実装** — 既存 `applyManualSeatChange` / SeatingBoard の D&D をそのまま使う。再開卓は `isBroken=false` になれば既存 drop target 条件（`!table.isBroken`）で自動的に droppable になる。
- **`planTableBreak`（自動バランシング）/ `planManualTableClose`（Phase 3 手動閉鎖）の変更** — 据え置き。
- **卓の物理削除（doc 削除）** — 卓は `isBroken` で論理無効化のみ。delete 経路は追加しない。
- **Cloud Functions 化 / リングゲーム管理** — PRD で将来課題 / 対象外。

---

## Step-by-Step Tasks

### Task 1: engine に `planAddTable` 純関数を追加

- **ACTION**: `src/lib/services/seating/engine.ts` に `planAddTable()` を追加。`planManualTableClose` の直後（`formatTableCloseOverflow` 付近）に置く。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 4 (07-third-dryrun-improvements): 「卓を増やす」で作成する次の tableNum を算出する純関数。
   *
   * 既存 table doc（broken 含む）が占有していない最小の正整数を 1..maxTables で探す。
   * 全て埋まっている（= maxTables 卓が既に存在）場合は null を返し、呼出側で追加を deny する。
   *
   * broken 卓は doc が残るため existingTableNums に含まれ、add では再利用しない
   * （broken 卓を戻すのは reopenTable 経路）。gap fill 方式にしているのは将来 doc 削除を
   * 導入しても破綻しない防御で、通常運用（tables は 1..N 連番）では max+1 と等価。
   */
  export function planAddTable(
    existingTableNums: number[],
    maxTables: number = MAX_TABLES,
  ): number | null {
    const used = new Set(existingTableNums);
    for (let n = 1; n <= maxTables; n += 1) {
      if (!used.has(n)) return n;
    }
    return null;
  }
  ```
- **MIRROR**: `planManualTableClose` の関数シグネチャ/コメント体裁（engine.ts:382-420）。
- **IMPORTS**: 追加なし（`MAX_TABLES` は engine.ts:8 で import 済み）。
- **GOTCHA**:
  - `existingTableNums` には **broken 卓も含める**（doc が残るため）。呼出側は `tables.map((t) => t.tableNum)` を渡す（`!t.isBroken` で filter しない）。filter すると broken 卓と同じ番号を再 create して `setDoc` が上書きしてしまう。
  - 返り値は plan ではなく素の `number | null`（席移動を伴わない単純 add のため判別 union は不要）。
- **VALIDATE**: Task 2 の unit test green（`npm run test -- engine`）。

### Task 2: engine の test を追加（planAddTable + 空卓除外の characterization）

- **ACTION**: `src/lib/services/seating/engine.test.ts` に (a) `describe("planAddTable")` を `planManualTableClose` の describe 直後に追加し、(b) 既存 `describe("planLateEntrySeat")`（168-238）に空卓除外ケースを 1 件追記。import に `planAddTable` を追加。
- **IMPLEMENT**:
  - **planAddTable**:
    1. 連番 `[1,2]` → `3` を返す。
    2. broken 込みの `[1,2,3]`（連番）→ `4`。
    3. gap あり `[1,3]` → `2`（最小空き）。
    4. 上限 `[1,2,3,4,5,6]` → `null`。
    5. 空 `[]` → `1`。
    6. `maxTables=2` を明示し `[1,2]` → `null`（引数で上限を渡せること）。
  - **planLateEntrySeat 空卓除外（characterization / 既存挙動の固定）**:
    7. 卓1 が満席（seatsPerTable=2 で 2 名）+ 卓2 は **着席プレイヤー 0**（= seated に卓2 の player が居ない）→ `planLateEntrySeat(seated卓1のみ, [], 2, seed)` は **`null`**（空卓2 は候補にならない）。
       ```ts
       it("着席プレイヤーのいない空卓は自動配席対象にならない（Phase 4: 追加/再開卓は手動配置）", () => {
         const seated = [
           p({ id: "a", tableNum: 1, seatNum: 1 }),
           p({ id: "b", tableNum: 1, seatNum: 2 }),
         ]; // 卓2 は tables には在るが seated に player 0 → liveTables に出ない
         const seat = planLateEntrySeat(seated, [], 2, 0);
         expect(seat).toBeNull();
       });
       ```
- **MIRROR**: `describe("planLateEntrySeat")` の「broken 卓は対象外」（engine.test.ts:230-237）と `p({...})` factory。
- **IMPORTS**: 既存 import に `planAddTable` を追加。
- **GOTCHA**: テスト 7 が **Phase 4 の核心要件（追加/再開卓を自動配席しない）を固定する回帰防壁**。`planLateEntrySeat` は `seatedPlayers` の `tableNum` 集合からしか生存卓を導出しないため、空卓は構造的に除外される（engine 変更不要）。コメントで「engine 改修ではなく既存挙動の lock-in」と明記する。
- **VALIDATE**: `npm run test -- engine` green。

### Task 3: repository に `reopenTable` を追加

- **ACTION**: `src/lib/firebase/repositories/tables.ts` に `reopenTable()` を `markTableBroken` の直後に追加。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 4 (07): 閉鎖済み卓を再開する（`isBroken=false` 単独書換）。`markTableBroken` の対称。
   * プレイヤー移動は伴わない（再開卓へは運営者が手動 D&D で配置する）。
   * rule: tables update 経路 A（label/color に触れない update）でカバー済み（rule 変更不要）。
   */
  export async function reopenTable(tid: string, tableNum: number): Promise<void> {
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "テーブル再開に失敗しました",
      async () => {
        await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: false });
      },
      { tid, tableNum },
    );
    logger.info("table reopen ok", { tid, tableNum });
  }
  ```
- **MIRROR**: `markTableBroken`（tables.ts:90-100）。
- **IMPORTS**: 追加なし（`updateDoc` / `doc` / `wrapFirestoreWrite` / `logger` は import 済み）。
- **GOTCHA**: add は既存 `upsertTable(tid, tableNum)`（tables.ts:106-122、`setDoc` で `isBroken:false / label:null / color:null` 初期化）を **そのまま再利用**する。新規 add 関数は作らない（scaffold の活用）。
- **VALIDATE**: Task 4 の repository test green。

### Task 4: `reopenTable` の repository test を追加

- **ACTION**: `src/lib/firebase/repositories/tables.test.ts` の `describe("markTableBroken")` 直後に `describe("reopenTable")` を追加。import に `reopenTable` を追記。
- **IMPLEMENT**:
  - test 1: `await reopenTable("t1", 3)` → `updateDoc` payload が `{ isBroken: false }`。
  - test 2: `updateDoc` reject → `firestore/write_failed` で throw。
- **MIRROR**: `describe("markTableBroken")`（tables.test.ts:117-130）。
- **IMPORTS**: `./tables` の import 文（42-49）に `reopenTable` を追加。
- **GOTCHA**: `beforeEach` で `updateDoc` は `mockReset().mockResolvedValue(undefined)` 済み（既存）。
- **VALIDATE**: `npm run test -- tables` green。

### Task 5: `useTableLifecycle` hook を新設

- **ACTION**: `src/lib/hooks/useTableLifecycle.ts` を作成。
- **IMPLEMENT**:
  ```ts
  "use client";
  import { useCallback, useMemo, useState } from "react";

  import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
  import { reopenTable as reopenTableWrite, upsertTable } from "@/lib/firebase/repositories/tables";
  import type { TableDoc } from "@/lib/firebase/schemas/table";
  import { MAX_TABLES } from "@/lib/limits";
  import { planAddTable } from "@/lib/services/seating/engine";

  interface UseTableLifecycleArgs {
    tid: string;
    uid: string | null;
    tables: TableDoc[];
    onError: (message: string) => void;
  }
  interface UseTableLifecycleResult {
    /** 次に追加する卓番号。null = MAX_TABLES 到達で追加不可（UI でボタン disabled）。 */
    nextTableNum: number | null;
    addBusy: boolean;
    reopenBusy: boolean;
    /** Table List ヘッダ「卓を追加」から呼ぶ。 */
    addTable: () => Promise<void>;
    /** SeatingBoard 閉鎖卓ヘッダ「再開」から呼ぶ。 */
    reopenTable: (tableNum: number) => Promise<void>;
  }

  /**
   * Phase 4 (07): 運営者による「卓を増やす / 再開」の state / busy / repository 呼出を集約する hook
   * （`useTableClose` 規範）。permission の最終防衛は Firestore rules（tables create/update は organizer）。
   *
   * 二重 warn 回避: `upsertTable` / `reopenTable` は `wrapFirestoreWrite` で既に warn 済みのため、
   * 本 hook は `unwrapOrFrom` で素通しし UI 表示のみ行う（error-logging.md 準拠）。
   */
  export function useTableLifecycle({
    tid,
    uid,
    tables,
    onError,
  }: UseTableLifecycleArgs): UseTableLifecycleResult {
    const [addBusy, setAddBusy] = useState(false);
    const [reopenBusy, setReopenBusy] = useState(false);

    const nextTableNum = useMemo(
      () => planAddTable(tables.map((t) => t.tableNum), MAX_TABLES),
      [tables],
    );

    const addTable = useCallback(async () => {
      if (!uid || addBusy) return;
      if (nextTableNum === null) {
        onError(`テーブル数の上限（${MAX_TABLES} Tables）に達しています`);
        return;
      }
      setAddBusy(true);
      try {
        await upsertTable(tid, nextTableNum);
      } catch (e) {
        const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の追加に失敗しました");
        onError(formatErrorForDisplay(wrapped));
      } finally {
        setAddBusy(false);
      }
    }, [uid, addBusy, nextTableNum, tid, onError]);

    const reopenTable = useCallback(
      async (tableNum: number) => {
        if (!uid || reopenBusy) return;
        setReopenBusy(true);
        try {
          await reopenTableWrite(tid, tableNum);
        } catch (e) {
          const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の再開に失敗しました");
          onError(formatErrorForDisplay(wrapped));
        } finally {
          setReopenBusy(false);
        }
      },
      [uid, reopenBusy, tid, onError],
    );

    return { nextTableNum, addBusy, reopenBusy, addTable, reopenTable };
  }
  ```
- **MIRROR**: `useTableClose`（busy / `unwrapOrFrom` / `onError` / `useCallback` 依存配列）。
- **IMPORTS**: 上記の通り。
- **GOTCHA**:
  - add の MAX_TABLES 超過は **UI の disabled が一次防御**、`nextTableNum===null` での early `onError` が二次。`upsertTable` は client 直書きで、organizer 権限は rule が最終防衛。
  - `upsertTable` は `setDoc`（上書き）。`planAddTable` が空き番号を返すため通常は既存 doc を踏まないが、複数端末同時 add の稀な race で同番号 setDoc は同内容上書き（席なし空卓）で実害なし（20 人 / 月 1〜2 回スケールで許容、コメントで明記）。
  - `seating/too-many-tables` の throw 経路（service）は `upsertTable` には無いため、ここでは null チェック + 固定メッセージで代替する（rule deny ではなく UI 防御方針）。
- **VALIDATE**: Task 6 の hook test green。

### Task 6: `useTableLifecycle` の test を新設

- **ACTION**: `src/lib/hooks/useTableLifecycle.test.tsx` を作成（`renderHook` + `act`）。repository を mock 境界で割る。
- **IMPLEMENT**:
  - `vi.mock("@/lib/firebase/repositories/tables", () => ({ upsertTable: vi.fn(), reopenTable: vi.fn() }))`
  - fixture: `fakeTable(overrides)` factory（`{ id, tableNum, isBroken:false, createdAt, label:null, color:null }`）。
  - test 1: `tables=[1,2]` → `nextTableNum===3`。`addTable()` → `upsertTable(tid, 3)` が呼ばれ addBusy が確定後 false。
  - test 2: `tables=[1..6]` → `nextTableNum===null`。`addTable()` → `upsertTable` が **呼ばれず** `onError` が上限メッセージで呼ばれる。
  - test 3: `reopenTable(3)` 成功 → `reopenTable`(repo) が `(tid, 3)` で呼ばれる。
  - test 4: add 失敗（`upsertTable` reject AppError）→ `onError` が呼ばれ addBusy が false に戻る。
  - test 5: `uid=null` → `addTable()` / `reopenTable()` が no-op（repo 未呼出）。
- **MIRROR**: `useTableClose.test.tsx`（mock 境界 = repository、`renderHook`/`act`）。
- **IMPORTS**: `renderHook`, `act` from `@testing-library/react`、vitest。
- **GOTCHA**: helper 境界（repository）で mock し、内部の Firestore / engine は触らない（testing.md mock 境界規約）。`planAddTable` は engine の本物を通す（pure・`nextTableNum` の実挙動を検証）。
- **VALIDATE**: `npm run test -- useTableLifecycle` green。

### Task 7: `UnseatedPlayersGuide` component を新設

- **ACTION**: `src/components/tournament/UnseatedPlayersGuide.tsx` を作成。
- **IMPLEMENT**:
  ```tsx
  "use client";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";

  interface Props {
    players: PlayerDoc[];
  }

  /**
   * Phase 4 (07): 未配席（tableNum=null・非 busted）の参加者がいるとき、運営者へ
   * 「卓を増やす／閉じた卓を再開して D&D で配置」を促す軽量ガイドバナー。
   *
   * 自動配席は満席だと no-seat で止まり、追加/再開した空卓は自動配席対象外
   * （planLateEntrySeat が空卓を候補にしない）。そのため未配席者は手動配置が必要で、
   * その導線をここで明示する。未配席 0 名なら null（非表示）。
   */
  export function UnseatedPlayersGuide({ players }: Props) {
    const unseated = players.filter((p) => !p.isBusted && p.tableNum === null);
    if (unseated.length === 0) return null;
    return (
      <div
        role="status"
        data-testid="unseated-guide"
        className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
      >
        <p className="font-medium">
          未配席の参加者が {unseated.length} 名います（
          {unseated.map((p) => p.displayName).join("、")}）。
        </p>
        <p>卓を増やす／閉じた卓を再開し、D&amp;D で配置してください。</p>
      </div>
    );
  }
  ```
- **MIRROR**: 既存の banner / alert 表示（dashboard の undo banner / `role` 付与）。文言はユーザー向けに技術スタック名を含めない（[[feedback_no_tech_stack_in_user_messages]]）。
- **IMPORTS**: 上記。
- **GOTCHA**:
  - `role="status"`（polite live region）で SR にも未配席発生を通知。`role="alert"` ではなく `status` にする（緊急ではなく案内のため）。
  - 表示テキストは可視（`data-testid` は test hook、aria は visible text を上書きしない）— L-3（Label in Name）回避。
- **VALIDATE**: Task 8 の component test green。

### Task 8: `UnseatedPlayersGuide` の test を新設

- **ACTION**: `src/components/tournament/UnseatedPlayersGuide.test.tsx` を作成（RTL）。
- **IMPLEMENT**:
  - `fakePlayer(overrides)` factory（player schema 全フィールド default）。
  - test 1: 未配席 0（全員 seated）→ 何も描画しない（`queryByTestId("unseated-guide")` null）。
  - test 2: 未配席 active 1 名（`tableNum:null, isBusted:false`）→ バナー表示 + 「1 名」 + その displayName。
  - test 3: 未配席だが busted の player は数えない（busted 1 + active-unseated 1 → 「1 名」、busted の名前は出ない）。
  - test 4: 複数未配席 → 名前が「、」で列挙。
- **MIRROR**: `CloseTableConfirmDialog.test.tsx` 等の RTL 検証 + fixture factory（testing.md）。
- **IMPORTS**: RTL + vitest。
- **GOTCHA**: fixture factory で `id` 二重指定（explicit + spread）の TS2783 を避け `...overrides` で供給（Phase 3 report の教訓）。
- **VALIDATE**: `npm run test -- UnseatedPlayersGuide` green。

### Task 9: SeatingBoard に「再開」ボタンを追加

- **ACTION**: `src/components/tournament/SeatingBoard.tsx` の Props に `onReopenTable?: (tableNum: number) => void;` を追加し、卓ヘッダ右 span（240-270 の「閉鎖」バッジ付近）に閉鎖卓向け「再開」ボタンを足す。
- **IMPLEMENT**:
  - Props 追記（`onCloseTable` の直後）:
    ```ts
    /** Phase 4: 閉鎖済み卓を再開する handler。`canCloseTable`（= 卓管理権限）と組で渡す。 */
    onReopenTable?: (tableNum: number) => void;
    ```
  - 関数引数 destructure に `onReopenTable` を追加。
  - 卓ヘッダの「閉鎖」バッジ表示分岐（241-245）の直後、もしくは close ボタン分岐の隣に追加:
    ```tsx
    {/* Phase 4: 閉鎖卓を再開。canCloseTable（卓管理権限）+ isBroken のときのみ表示。 */}
    {canCloseTable && onReopenTable && table.isBroken ? (
      <button
        type="button"
        className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
        onClick={() => onReopenTable(table.tableNum)}
        data-testid={`reopen-table-${table.tableNum}`}
        aria-label={`${formatTableLabel(table)} を再開`}
      >
        再開
      </button>
    ) : null}
    ```
- **MIRROR**: 「閉じる」ボタン（SeatingBoard.tsx:255-269）。`canCloseTable` を **卓管理権限の共通軸として再利用**（close は live 卓、reopen は broken 卓で排他のため prop 増殖を避ける）。
- **IMPORTS**: 追加なし（`formatTableLabel` は import 済み）。
- **GOTCHA**:
  - close ボタンは `!table.isBroken && liveTableCount > 1`、reopen ボタンは `table.isBroken` で **排他**。同じ卓に両方は出ない。
  - reopen 後 `isBroken=false` になると、その卓の空席は既存 D&D drop target 条件（`!table.isBroken && (!isOccupied || isSameTableDrag)`、SeatRow 357-362）で **自動的に droppable** になる（D&D ロジックの追加実装は不要）。
  - `canCloseTable` の意味は「卓管理（close/reopen）権限」へ実質拡張される。prop 名は据え置き（churn 最小化）だが、コメントで「close/reopen 共通の卓管理権限」と明示する。
- **VALIDATE**: Task 10 の SeatingBoard test green。

### Task 10: SeatingBoard.test.tsx に「再開」検証を追加

- **ACTION**: `src/components/tournament/SeatingBoard.test.tsx` に reopen 系の test を追加。
- **IMPLEMENT**:
  - test 1: `canCloseTable=true` + 卓 `isBroken=true` + `onReopenTable` 渡す → `reopen-table-{n}` ボタンが表示される。同卓に「閉じる」ボタンは出ない（排他）。
  - test 2: `isBroken=false` の卓には reopen ボタンが出ない。
  - test 3: `canCloseTable=false` のとき reopen ボタンが出ない。
  - test 4: reopen ボタン click → `onReopenTable(tableNum)` が呼ばれる。
  - test 5（D&D droppability の lock-in）: 再開後（`isBroken=false`）の空席が `aria-label="droppable-{n}-{s}"` を持つ（`canManage=true` + `onMoveSeat` 渡し）。broken のままなら droppable でないことと対比。
- **MIRROR**: 既存「閉じる」ボタンの表示条件 test（SeatingBoard.test.tsx）。
- **IMPORTS**: 既存 + 必要なら fixture factory に `isBroken` override。
- **GOTCHA**: test 5 は「再開卓へ D&D 配置できる」の component-level 担保（E2E の @dnd-kit ドラッグは flaky なため droppability を unit で固定し、round-trip は E2E の reopen 観測で担保する役割分担）。
- **VALIDATE**: `npm run test -- SeatingBoard` green。

### Task 11: dashboard-client に配線

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` に `useTableLifecycle` を配線し、Table List ヘッダの「卓を追加」ボタン / SeatingBoard の `onReopenTable` / `UnseatedPlayersGuide` を追加。
- **IMPLEMENT**:
  - import 追加: `useTableLifecycle`（hooks）/ `UnseatedPlayersGuide`（components/tournament）/ `Button`（既存 import 済みのはず）。
  - `useTableClose` 配線（251-267）の直後に:
    ```ts
    // Phase 4 (07): 卓の追加 / 再開。
    const {
      nextTableNum,
      addBusy: addTableBusy,
      reopenBusy: reopenTableBusy,
      addTable,
      reopenTable: reopenTableHandler,
    } = useTableLifecycle({
      tid,
      uid: user?.uid ?? null,
      tables,
      onError: setError,
    });
    ```
  - Table List Card（511-538）の `<CardHeader>` を「タイトル + 追加ボタン」の横並びに:
    ```tsx
    <CardHeader className="flex flex-row items-center justify-between space-y-0">
      <CardTitle>Table List</CardTitle>
      {isMember ? (
        <Button
          size="sm"
          variant="outline"
          onClick={() => void addTable()}
          disabled={addTableBusy || nextTableNum === null}
          data-testid="add-table"
        >
          卓を追加
        </Button>
      ) : null}
    </CardHeader>
    ```
  - `<CardContent>` 内、`<SeatingBoard>` の直前に guide を描画:
    ```tsx
    <UnseatedPlayersGuide players={players} />
    ```
  - `<SeatingBoard>` の props に追加:
    ```tsx
    onReopenTable={reopenTableHandler}
    ```
    （`canCloseTable={isMember}` は既存。reopen も同じ `canCloseTable` 軸で表示される）
- **MIRROR**: `useTableClose` 配線（254-267）/ SeatingBoard render（517-536）/ Card ヘッダの flex 横並びは他カードヘッダ（例: TimerControls 周辺）に倣う。
- **IMPORTS**: 上記。`reopenTableBusy` は SeatingBoard に渡さない（reopen は即時・確認ダイアログ無し）なら未使用 → eslint unused 回避のため **分割代入から外す**か、将来用に残すなら使う。本 plan は `reopenBusy` を **使わない場合は分割代入で受け取らない**（`{ nextTableNum, addBusy, addTable, reopenTable }` のみ）。
- **GOTCHA**:
  - `addTable`/`reopenTable` は hook 内で onError を呼ぶため dashboard 側 try/catch 不要（`void addTable()` で発火）。
  - reopen ボタンは SeatingBoard 内（閉鎖卓ヘッダ）に出るため dashboard は handler を渡すだけ。
  - guide は `showSeatingBoard` の Card 内（SeatingBoard の上）に置く。setup（卓未生成）では Card 自体が出ないため未配席判定も無害。
- **VALIDATE**: `tsc --noEmit` 0 errors / `next lint` 0 warnings / `next build` 成功。

### Task 12: E2E spec を新設

- **ACTION**: `tests/e2e/table-add-reopen.spec.ts` を作成（`manual-table-close.spec.ts` の fixture / helper を踏襲）。
- **IMPLEMENT** — observable な round-trip を固定:
  - **spec 1（閉じる → 再開で復活）**: `seatsPerTable=2` で 5 名代理受付 → commit seating（3 卓 2/2/1）→ 卓3 を閉じる（Phase 3 経路、`close-table-3` → `close-table-confirm`）→ 卓3 が「閉鎖」バッジ → **`reopen-table-3` をクリック** → 「閉鎖」バッジが消え、卓3 に「閉じる」ボタン（`close-table-3`）が再表示される。
  - **spec 2（卓を追加）**: `seatsPerTable=2` で 4 名 → commit seating（2 卓）→ `add-table` クリック → **卓3 のカード（`dash.tableCard(3)`）が出現**（0 人・空席）。
  - **spec 3（MAX_TABLES で追加 disabled）**: `seatsPerTable=2` で 12 名 → commit seating（6 卓）→ `add-table` ボタンが **disabled**。
  - **spec 4（未配席ガイド・任意）**: `seatsPerTable=2` で 4 名 → commit（2 卓満席）→ さらに 1 名代理受付（late entry 相当・自動配席先なし）→ `unseated-guide` バナーが表示される（`getByTestId("unseated-guide")`）。
    - 注: state が `seating`（commit 後）では `isAcceptingLateSeats=true` のため、満席なら autoSeat は no-seat で未配席が残る。バナー表示の観測で十分。D&D 実配置は SeatingBoard.test（droppability）で担保。
- **MIRROR**: `manual-table-close.spec.ts`（`randomOrganizer` / `seedOrganizerTournament` / `tournamentDashboardPage` / `addNamedGuest` / `commitSeatingOnly` / `tableCard` / `tableHeaderTitle` / `getByTestId`）。
- **IMPORTS**: `./fixtures/test-context` / `./fixtures/flows`。`addNamedGuest` helper は manual-table-close.spec からコピー（共通化はしない — E2E spec 間の独立性優先）。
- **GOTCHA**:
  - @dnd-kit の実ドラッグ（pointer move）は Playwright で flaky なため、**E2E では D&D 実操作を主アサーションにしない**。reopen/add の lifecycle 観測（バッジ・カード出現・ボタン disabled）と guide 表示を固定し、D&D droppability は Task 10（component）で担保する（testing.md の E2E/unit 分担）。
  - `test.describe.configure({ timeout: 120_000 })` を踏襲（冷えた emulator + 代理受付 + commit の所要時間）。
  - emulator + dev server 起動が必要なため、本 spec は **マージ前ゲートで走行**（中間 commit は unit + typecheck + lint + build で代替、testing.md「E2E 走行のタイミング」）。
- **VALIDATE**: `npm run test:e2e -- table-add-reopen`（emulator 起動環境で）green。

### Task 13: ルールドキュメントの更新

- **ACTION**: `.claude/rules/group-membership.md` の権限マトリクスと `.claude/rules/firebase-patterns.md` の tables rule 記述を更新。
- **IMPLEMENT**:
  - **group-membership.md** 権限マトリクスに行追加（owner ○ / organizer ○ / member ×）:
    - `卓の追加（tables/{n} create）`
    - `卓の再開（tables/{n}.isBroken=false）`
  - **firebase-patterns.md** の「`tournaments/{tid}` 配下 subcollection の rule 設計原則」内 tables 行に追記:
    - tables `allow update` 経路 A（label/color に触れない update）は **`isBroken` 単独書換（Phase 3 閉鎖 / Phase 4 再開の両方）** を許可する。reopen は rule 変更なしで成立。
    - tables `allow create`（organizer のみ）で Phase 4 の「卓を追加」が成立。**MAX_TABLES 超過は rule では弾かず service + UI で deny**（既存 players rule の `tableNum<=6` が seating を防御）。組織者は信頼ロールのため empty な上限超過卓 doc の直接作成は無害（席に誰も置けない）。Cloud Functions 化時に create rule への `tableNum<=6` 追加を再検討する旨を「既知のセキュリティリスク」に準じて 1 行付記。
- **MIRROR**: 既存 Phase（5.1 PD / Phase C label）の rule 経路記述スタイル。
- **IMPORTS**: なし（doc）。
- **GOTCHA**: rule / indexes の変更は無いため `firebase deploy --only firestore:rules` は **不要**（[[feedback_firestore_rules_deploy]] の deploy 案内チェックは「変更あり」の場合のみ — 本 Phase は不要であることを report に明記）。
- **VALIDATE**: 目視 + `npm run test:rules-limits` が引き続き green（rule リテラル不変の確認）。

### Task 14: PRD 進捗表の更新

- **ACTION**: `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md` の Implementation Phases 表で Phase 4 を更新。
- **IMPLEMENT**: Phase 4 行の Status を `pending` → `in-progress`、PRP Plan 列に `[plans/phase-4-add-reopen-table.plan.md](../plans/phase-4-add-reopen-table.plan.md)` を追記（実装完了・report 作成時に `complete` + report リンク）。
- **MIRROR**: Phase 1〜3 行の記法。
- **VALIDATE**: 目視。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `planAddTable` 連番 | `[1,2]` | `3` | — |
| `planAddTable` gap | `[1,3]` | `2`（最小空き） | ✓ |
| `planAddTable` 上限 | `[1..6]` | `null` | ✓ |
| `planAddTable` 空 | `[]` | `1` | ✓ |
| `planAddTable` maxTables 引数 | `[1,2], 2` | `null` | ✓ |
| `planLateEntrySeat` 空卓除外 | 卓1 満席のみ seated・卓2 空 | `null`（空卓に座らせない） | ✓（Phase 4 核心の lock-in） |
| `reopenTable` 書込形 | `("t1", 3)` | `updateDoc` payload `{isBroken:false}` | — |
| `reopenTable` 失敗 | `updateDoc` reject | `firestore/write_failed` throw | ✓ |
| `useTableLifecycle.addTable` | `tables=[1,2]` | `upsertTable(tid,3)` 呼出 / busy 遷移 | — |
| `useTableLifecycle` 上限 | `tables=[1..6]` | `upsertTable` 未呼出 + onError | ✓ |
| `useTableLifecycle.reopenTable` | `(3)` | `reopenTable(tid,3)` 呼出 | — |
| `useTableLifecycle` uid=null | — | no-op（repo 未呼出） | ✓ |
| `UnseatedPlayersGuide` 0 名 | 全員 seated | null（非表示） | ✓ |
| `UnseatedPlayersGuide` 1 名 | unseated active 1 | バナー + 名前 | — |
| `UnseatedPlayersGuide` busted 除外 | busted unseated 1 + active unseated 1 | 「1 名」 | ✓ |
| `SeatingBoard` reopen 表示 | `canCloseTable` + `isBroken` | `reopen-table-{n}` 表示 / close 非表示 | ✓（排他） |
| `SeatingBoard` reopen 後 droppable | `isBroken=false` 空席 | `droppable-{n}-{s}` 存在 | ✓ |

### Edge Cases Checklist

- [x] 空入力（`planAddTable([])` → 1 / 未配席 0 → guide 非表示）
- [x] 最大サイズ入力（`planAddTable([1..6])` → null / 6 卓で add disabled）
- [x] 無効/境界（gap fill / maxTables 引数 / busted 除外）
- [x] 同時アクセス（複数端末 add の同番号 setDoc race → 同内容上書きで許容・コメント明記）
- [ ] ネットワーク障害（`upsertTable`/`reopenTable` reject → onError 表示で担保）
- [x] 権限拒否（client 防御 + rule organizer 最終防衛。member は UI にボタン非表示）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```

EXPECT: Zero type errors

### Lint

```bash
npm run lint
```

EXPECT: 0 warnings（特に `useTableLifecycle` の未使用戻り値 / 依存配列）

### Unit Tests（affected）

```bash
npm run test -- engine tables useTableLifecycle UnseatedPlayersGuide SeatingBoard
```

EXPECT: 全 green（新規 ~20 tests）

### Full Test Suite

```bash
npm run test
```

EXPECT: 既存 1545+ tests 非回帰 + 新規 green

### Rule Drift（rule 不変の確認）

```bash
npm run test:rules-limits
```

EXPECT: ALL GREEN（`firestore.rules` のリテラル不変 = 本 Phase で rule を触っていないことの裏取り）

### Build

```bash
npm run build
```

EXPECT: `next build` 成功

### Browser / E2E（マージ前ゲート）

```bash
npm run test:e2e -- table-add-reopen
```

EXPECT: reopen 復活 / 卓追加カード出現 / 6 卓で追加 disabled / 未配席ガイド表示 が green

### Manual Validation

- [ ] 運営者で seating 中の dashboard を開く
- [ ] 卓を 1 つ閉じる → 「再開」ボタンが出る → 再開 → 「閉鎖」バッジが消え「閉じる」が復活
- [ ] 「卓を追加」→ 空卓カードが増える。late entrant（未配席）を D&D でその卓へ配置できる
- [ ] 6 卓に達すると「卓を追加」が disabled
- [ ] 未配席者がいる間、ガイドバナーが出て、配置後に消える
- [ ] 追加/再開した空卓に **late entry が自動配席されない**（手動配置のみ）

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation コマンド pass
- [ ] テスト記述・green（unit + E2E authored）
- [ ] 型エラー 0 / lint 警告 0
- [ ] UX デザイン（追加ボタン / 再開ボタン / ガイドバナー）に一致
- [ ] PRD Success signal:「閉じた卓を再開／新規卓追加 → 自動配席されず → 運営者が手動 D&D で late entrant を配置できる」「MAX_TABLES 超過は deny」を満たす

## Completion Checklist

- [ ] 発見したパターン（engine plan / repository wrap / hook / 卓ヘッダボタン）に準拠
- [ ] エラー処理がコードベース流（`unwrapOrFrom` で二重 warn 回避 / `seating/too-many-tables` 既存 code 再利用）
- [ ] ログが規約準拠（`logger.info` 成功 / wrap が warn）
- [ ] テストが test 規約準拠（mock 境界 = repository / fixture factory / E2E と unit の分担）
- [ ] ハードコード値なし（`MAX_TABLES` を `@/lib/limits` から参照）
- [ ] ドキュメント更新（group-membership 権限マトリクス / firebase-patterns / PRD 進捗）
- [ ] 不要なスコープ追加なし（rule 変更・自動配席・D&D 新規実装をしていない）
- [ ] self-contained — 実装中に追加調査不要

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 追加/再開卓に late entry が自動配席されてしまう | L | M | `planLateEntrySeat` は着席プレイヤー由来の生存卓のみ候補 → 空卓は構造的に除外。Task 2 の characterization test で固定。**engine 変更しない** |
| 再開卓へ D&D で配置できない（drop target にならない） | L | M | `isBroken=false` になれば既存 SeatRow の drop 条件（`!table.isBroken`）で自動 droppable。Task 10 test 5 で lock-in |
| `upsertTable` の setDoc 上書きで既存卓を破壊 | L | M | `planAddTable` が空き番号を返すため既存 doc を踏まない。複数端末同時 add の同番号 race は同内容上書きで実害なし（コメント明記） |
| MAX_TABLES 超過卓が直接 SDK で作られる | L | L | organizer は信頼ロール。empty 7 卓目 doc は players rule（tableNum<=6）で誰も座れず無害。UI disabled + service null チェックで通常経路は防御 |
| @dnd-kit の E2E ドラッグが flaky | M | L | E2E は lifecycle 観測（バッジ/カード/disabled/guide）に限定。D&D droppability は component test で担保（testing.md 分担） |
| `canCloseTable` prop が close/reopen 両用で意味が曖昧化 | L | L | コメントで「卓管理権限の共通軸」と明示。prop 名据え置きで churn 最小化 |

## Notes

- **rule 変更なしの根拠**: reopen（`isBroken=false`）は tables `allow update` 経路 A（label/color に触れない update）でカバー、add（create）は tables `allow create`（organizer のみ）でカバー。両者とも Phase 3 と同様に既存 rule 内で成立し、`firestore.rules` / `firestore.indexes.json` の変更が無いため **`firebase deploy --only firestore:rules` は不要**（report に「rule 変更なし」を明記する）。
- **`seating/too-many-tables` の再利用**: add 上限超過のエラーコードは既存（`commitInitialSeating` で使用）を再利用するため `error-logging.md` への新規 code 追記は不要。本 Phase では UI disabled が一次防御で、hook の固定メッセージ onError が補助（rule deny ではない）。
- **自動配席の責務分担**: PRD Open Question で「増やした/再開した卓へは `autoSeatLateEntry` で自動配席せず手動 D&D を正規とする」が確定済み。本 Phase はこの既存挙動を **test で固定**するのみ（engine 改修なし）。空席のある **既存（着席済み）卓**へは従来どおり自動配席が働く点に注意（空卓のみ除外）。
- **Phase 4 は Phase 3 の足場の上に乗る**: `useTableClose` / SeatingBoard の卓ヘッダボタン / 可変席数描画（`renderSeatCount`）は Phase 3 で導入済み。本 Phase は対称の reopen ボタン + add ボタン + guide を additive に足す。
- **並行系列の統合**: PRD の Parallelism Notes 通り、要望①（Phase 1→2 受付代理）と要望②（Phase 3→4 卓操作）は独立。両系列とも SeatingBoard / dashboard-client / orchestrator を触るため、最終統合時にマージ整合を確認する（本 Phase 着手時点で Phase 1〜3 は complete）。
