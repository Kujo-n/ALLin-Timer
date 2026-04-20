# Local Code Review #3 — Phase 4 Seating Automation (independent re-read)

**Reviewed**: 2026-04-20
**Mode**: Local (uncommitted changes)
**Decision**: APPROVE with comments — CRITICAL/HIGH なし、validation 全通過、新規 MEDIUM 1 + LOW 4
**Previous reviews**:
- [local-phase-4-review.md](local-phase-4-review.md) (4 HIGH + 5 MEDIUM, fix 済み)
- [local-phase-4-review-2.md](local-phase-4-review-2.md) (APPROVE with comments)

## Summary

Phase 4（席決め自動化）の 3 回目の独立レビュー。Review #2 の N1 (canManage 命名) は **既に解消**（`canManage` 変数は廃止され `isMember` に統一）。新規発見は MEDIUM 1 件（`commitInitialSeating` の tx と upsertTables の原子性ギャップ）と LOW 4 件（new-player seat-race / orphan tables doc / no-seat silent failure / 未使用 repo 関数）。validation 全通過、テスト 246 / 246 pass。マージ可。

## Prior Findings — Status Verification

| ID | Review # | Status | 検証 |
|---|---|---|---|
| **H1** applyTableBreak 原子性 | #1 | ✅ FIXED | [orchestrator.ts:494-504](../../src/lib/services/seating/orchestrator.ts#L494-L504) の `tx.update(tablesRef, { isBroken: true })` が同一 tx 内。テスト TG2 が assert 済 |
| **H2** late-entry seat-race | #1 | ✅ FIXED | [orchestrator.ts:239-250](../../src/lib/services/seating/orchestrator.ts#L239-L250) `autoSeatLateEntry` が tx 内で `targetTableExistingIds` を再 read して seat-taken 判定（ただし後述 **L2** の「新 player 漏れ race」は残る） |
| **H3** hook 依存配列の参照不安定 | #1 | ✅ FIXED | fingerprint 化（`groupIdsKey` / `playersKey` / `tablesKey` / `tournamentKey`）。tournamentKey 追加で L1 も解消 |
| **H4** engine の生 Error | #1 | ✅ FIXED | `TooManyTablesError` / `InvalidSeatsPerTableError` を instanceof 判別 |
| **M1** rules 型/範囲ガード | #1 | ✅ FIXED | [firestore.rules:152-168](../../firestore.rules#L152-L168) int 型・1〜6 / 1〜10 範囲・null 整合性チェック |
| **M2** schema 制約不一致 | #1 | ✅ FIXED | body / create / update 全て `min(2).max(10)` |
| **M3** PlayerList derived state | #1 | ✅ FIXED | `error = subscribeError ?? localError` を render 時算出 |
| **M4** tx 外 let mutation | #1 | ✅ FIXED | `runTransaction<number[]>` の戻り値で受ける |
| **M5** unmount 後 setState | #1 | ✅ FIXED | BustButton / BalancingInstructionCard に `mounted` ref |
| **N1** canManage 命名不整合 | #2 | ✅ RESOLVED | `canManage` 変数自体が廃止され `isMember` に統一（[dashboard-client.tsx:124,230](../../src/app/tournaments/%5Btid%5D/dashboard-client.tsx#L124)）。review-2 の finding はすでに解消済み |
| **L1** tournament raw ref 依存 | #2 | ✅ FIXED | [useSeatingAutoOrchestrator.ts:54-60](../../src/lib/hooks/useSeatingAutoOrchestrator.ts#L54-L60) `tournamentKey` で 5 フィールドのみ fingerprint。専用テストあり |
| **L2** applyTableBreak survivors 再検証 | #2 | ✅ FIXED | [orchestrator.ts:471-491](../../src/lib/services/seating/orchestrator.ts#L471-L491) survivorExistingIds を tx 内再 read し seat-taken 検出 |
| **L3** MAX_TABLES / MAX_SEATS drift | #2 | ⚠ ACCEPTED | 3 箇所ハードコードの drift 警告コメントを engine / rules / schema 全てに追加。Phase 5+ で Cloud Functions 集約の計画ありのため現状維持 |

## New Findings

### CRITICAL
**None.**

### HIGH
**None.**

### MEDIUM

**M-3.1 — `commitInitialSeating` の tx と `upsertTables` が原子的でない**

**File**: [src/lib/services/seating/orchestrator.ts:82-134](../../src/lib/services/seating/orchestrator.ts#L82-L134)

```ts
const plannedTableNums = await runTransaction<number[]>(firestore, async (tx) => {
  // ... players の tableNum/seatNum を update、tournament.state を "seating" に遷移
  return plan.tableNums;
});

// tables subcollection は別バッチで upsert（transaction 内のクエリ scan を避ける）。
if (plannedTableNums.length > 0) {
  await upsertTables(tid, plannedTableNums);
}
```

**問題**: tx が commit されてから `upsertTables`（別 batch）が走るまでに例外（network 断 / 権限 / unmount）が起きると、以下の中間状態が残る:

- players に tableNum/seatNum 付与済
- tournament.state は `"seating"`
- `tables/{n}` サブコレクションは **空**
- UI: SeatingBoard が「テーブルがまだありません」を表示、席は決まっているのに見えない

「席を再決定」ボタンで recovery 可能だが、その場合 `seed = Date.now()` なので **全プレイヤーが別の席に再 shuffle される**。運営者が「途中でエラーが出たから同じ席で再試行しただけ」と期待している状況では、参加者に席変更が発生して混乱を招く。

**コメントの根拠も弱い**: `// transaction 内のクエリ scan を避ける` とあるが、`upsertTables` の中身は `batch.set(ref, { tableNum, isBroken: false, createdAt: serverTimestamp() })` のみで、query scan は行っていない。`tx.set` で tx 内に統合できる。

**Fix（推奨）**:
```ts
// tx 内に tables の set を統合
for (const n of plan.tableNums) {
  tx.set(doc(tablesRef(tid), String(n)), {
    tableNum: n,
    isBroken: false,
    createdAt: serverTimestamp(),
  });
}
```

これにより tx の失敗は全体をロールバックし、中間状態を排除。副次効果として `upsertTables` export 自体も本パスでは不要になる（別用途の足場として残すなら別 import）。

**Severity 根拠**: 本番 failure は multi-step operation のうち後半が部分失敗した時のみ発生。頻度は低いが、発生時 UX が「席決めたように見えて見えない」という混乱を招く。CRITICAL ではないが HIGH か MEDIUM の境界。運営者による手動 recovery が可能なので MEDIUM に寄せる。

### LOW

**L-3.1 — `autoSeatLateEntry` / `applySingleMove` が NEW player による seat-taken race を検出できない**

**File**: [src/lib/services/seating/orchestrator.ts:197-250](../../src/lib/services/seating/orchestrator.ts#L197-L250), [325-378](../../src/lib/services/seating/orchestrator.ts#L325-L378)

```ts
const targetTableExistingIds = seatedPlayers
  .filter((p) => p.tableNum === seat.tableNum && p.id !== playerId)
  .map((p) => p.id);
// tx 内で各 id を再 read し seat-taken を判定
```

`targetTableExistingIds` は **subscribe snapshot 時点**の「対象卓に居るプレイヤー ID」。スナップショット〜tx 発火の間に別プレイヤー X が同じ卓/席に入ると、X は `targetTableExistingIds` に含まれず再 read もされず、seat-taken チェックをすり抜ける。結果：同 tableNum + seatNum に 2 人が配席される race が残る。

**緩和**:
- 単一運営端末のみが `useSeatingAutoOrchestrator` を fire する想定（複数運営の同時操作は UX 的に想定外）
- 20 人 × 月 1〜2 回開催では window が小さく実害稀
- 発生時も SeatingBoard で重複席が視認できる

**根本解決**: 席占有を seats collection の **独立ロックドキュメント**として表現、または bookkeeping を Cloud Functions 化。MVP のスケールでは過剰。Phase 5+ で検討。

---

**L-3.2 — 再席決め時の orphan `tables/{n}` document**

**File**: [src/lib/firebase/repositories/tables.ts:61-75](../../src/lib/firebase/repositories/tables.ts#L61-L75)

初回席決めが 3 卓構成で行われた後、バストが進んで「席を再決定」で 2 卓に縮小した場合、`tables/3` は削除されず残る。SeatingBoard が「卓 3（0 人）」の空カードを表示。

また `upsertTables` は呼ばれる度に `createdAt: serverTimestamp()` と `isBroken: false` を上書きするため、再席決め時に「過去の broken フラグ」が復活する可能性がある（現状は seating → running で `applyTableBreak` が使われるため逆流はしないが、将来の state transition 設計で地雷）。

**Fix（推奨）**: upsertTables の前に「今回計画に含まれない tableNum」を列挙して delete するか、planInitialSeating が常に既存 tables を上回る tableNums を返すように invariants を明記。

**Severity 根拠**: 機能的 impact は軽微。空カードが混乱を招くだけで、運営者が見落とすと参加者情報が漏れる等のリスクはない。

---

**L-3.3 — `planLateEntrySeat` が null を返すと player が席なしのまま放置される**

**File**: [src/lib/services/seating/engine.ts:122-152](../../src/lib/services/seating/engine.ts#L122-L152), [orchestrator.ts:188-192](../../src/lib/services/seating/orchestrator.ts#L188-L192)

全卓満席（`activePlayers >= liveTables * seatsPerTable`）の late entry は `planLateEntrySeat === null` → orchestrator は `{ applied: false, reason: "no-seat" }` を返すだけで操作者への**エラー通知経路がない**。player は `/live` で「席決め待ち中…」を表示し続ける。

**運営側で視認すべき UI**: dashboard の PlayerList には「エントリー中」と表示され tableNum が null のため、注意深い運営者は気付けるが、明示的な警告はない。

**Fix（推奨）**: `useSeatingAutoOrchestrator` が `{ applied: false, reason: "no-seat" }` を受け取ったら logger.warn + onError で UI バナーを上げる。あるいは「卓追加？」ダイアログを出す（MAX_TABLES 未達なら）。

---

**L-3.4 — 未使用 repository helpers の残置**

**Files**:
- [src/lib/firebase/repositories/players.ts:169-206](../../src/lib/firebase/repositories/players.ts#L169-L206) — `assignSeat` / `clearSeat`
- [src/lib/firebase/repositories/tables.ts:77-105](../../src/lib/firebase/repositories/tables.ts#L77-L105) — `markTableBroken` / `upsertTable`

いずれも production コードから呼ばれていない（テストのみ）。コメントは「将来の足場」と説明するが、CLAUDE.md の原則「Don't design for hypothetical future requirements. Don't add features ... beyond what the task requires.」に反する。

**Fix（推奨）**: 未使用の 4 関数と対応テストを削除。実際に必要になった時に再追加する方が diff が明確。

## Security Review

- ✅ Firestore rules は player self-update と organizer-update を OR で分岐、型・範囲・null 整合性を全て検証
- ✅ `pid == request.auth.uid` の自己 delete と organizer-delete が正しく分岐
- ✅ `exists()` ガード付きで `get()` を呼び rule cache を活用
- ✅ `orchestrator.ts` は全 write path で tx 内 `userGroupIds.includes(t.groupId)` を明示チェック（client 側早期失敗）。最終防衛は rules
- ⚠ `players` の `allow read: if isSignedIn()` は Phase 2 からの仕様。`displayName` / `uid` / `tableNum` / `seatNum` が全認証ユーザーに開示される。Phase 4 の regression ではないが、将来的に group メンバー限定に絞る選択肢はある（既存所見として記録）
- ✅ `bustPlayer` / `unbustPlayer` は player update path に乗るため rules で最終防衛される。orchestrator 側の簡易ラッパで問題なし

## Test Robustness

**テスト総数**: 246 passed（review #2 時点 244 → +2）。internal breakdown は計測せず。

- engine の pure function 群は table-driven テストで境界/tie-break を広くカバー
- orchestrator は tx 挙動のモックベースで happy / race / seat-taken / permission-denied を網羅
- useSeatingAutoOrchestrator の fingerprint stability テストは effect 再 fire 抑制まで踏み込んでいる（L1 fix 含む）

## Validation Results

| Check | Result | Notes |
|---|---|---|
| Type Check | ✅ Pass | `tsc --noEmit` exit 0 |
| Lint | ✅ Pass | ESLint zero warning |
| Unit Tests | ✅ Pass | **246 / 246** pass（14 test files） |
| Build | ✅ Pass | `next build` 完走、全ルートビルド成功 |

## Files Reviewed (Phase 4 scope)

**Core seating domain** (new):
- `src/lib/services/seating/engine.ts`
- `src/lib/services/seating/orchestrator.ts`
- `src/lib/services/seating/prng.ts`
- `src/lib/hooks/useSeatingAutoOrchestrator.ts`

**Repositories / schemas** (modified):
- `src/lib/firebase/repositories/players.ts` — bust/unbust/assign/clear seat + seat field init
- `src/lib/firebase/repositories/tables.ts` — new
- `src/lib/firebase/schemas/player.ts` — tableNum/seatNum/lastMovedAt 追加
- `src/lib/firebase/schemas/table.ts` — new
- `src/lib/firebase/schemas/tournament.ts` — seatsPerTable 追加
- `src/lib/firebase/repositories/tournaments.ts` — beginSeating / confirmSeating 追加

**UI** (new/modified):
- `src/components/tournament/BustButton.tsx` (new)
- `src/components/tournament/SeatingBoard.tsx` (new)
- `src/components/tournament/BalancingInstructionCard.tsx` (new)
- `src/components/tournament/PlayerList.tsx` — bust ボタン統合
- `src/components/tournament/TimerControls.tsx` — begin/confirm seating 分離
- `src/components/tournament/TournamentForm.tsx` — seatsPerTable 入力
- `src/app/tournaments/[tid]/dashboard-client.tsx` — SeatingBoard / BalancingInstructionCard 埋め込み、players/tables subscribe
- `src/app/tournaments/[tid]/live/live-client.tsx` — 自分の席表示 + 「席が移動しました」バナー

**Security / rules**:
- `firestore.rules` — players update の organizer 分岐 + 型/範囲ガード

**Tests** (all new):
- `src/lib/services/seating/engine.test.ts`
- `src/lib/services/seating/orchestrator.test.ts`
- `src/lib/hooks/useSeatingAutoOrchestrator.test.ts`
- `src/lib/firebase/repositories/players.test.ts`
- `src/lib/firebase/repositories/tables.test.ts`

## Recommended Action

1. **M-3.1 を fix してからコミット推奨**: `upsertTables` を `commitInitialSeating` tx 内に統合する 10 行程度の変更。原子性保証で UX 安定性が大きく上がる
2. **L-3.4 の未使用関数削除は次 PR で OK**: dead code 掃除は refactor-cleaner agent に任せても良い
3. **L-3.1 〜 L-3.3 は Phase 5 で検討**: いずれも MVP スケール（20 人 × 月 1〜2 回）では実害軽微
4. **本番 deploy 前に `firestore.rules` の Playground / Emulator テスト**:
   - player self-update で tableNum/seatNum 変更が deny される
   - organizer-update で tableNum=7 や seatNum=11 が deny される
   - tableNum=1 / seatNum=null の整合性違反が deny される

## Decision: APPROVE

CRITICAL=0, HIGH=0, MEDIUM=1（`commitInitialSeating` 原子性）, LOW=4（seat race / orphan tables / silent no-seat / dead code）、validation 全通過。M-3.1 を fix してから commit するのが理想だが、現状のままマージしても破壊的影響はない（運営者による手動 recovery が可能なため）。
