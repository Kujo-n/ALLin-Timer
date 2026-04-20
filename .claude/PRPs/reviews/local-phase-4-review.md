# Local Code Review — Phase 4 Seating Automation

**Reviewed**: 2026-04-20
**Mode**: Local (uncommitted changes)
**Scope**: 24 files (12 created / 12 modified) — Phase 4 implementation
**Decision**: **REQUEST CHANGES** — 4 HIGH を fix 後マージ可。CRITICAL なし。

## Summary

Phase 4 の実装は計画通り進み、validation（typecheck / lint / 220 tests / build）はすべて通過。
ただし **データ整合性**（H1: `applyTableBreak` の 2 ステップ write）と **競合制御**（H2: late entry の席被り race）に直す必要がある HIGH 問題が 2 件、コード規約違反（H4）と React hook の安定性（H3）が各 1 件あり、いずれも実装範囲内で局所修正可能。

セキュリティは外部攻撃面では問題なし。`firestore.rules` の organizer-update branch は内部不正シナリオで型・範囲制約欠如（MEDIUM）あり、運用後 Phase 5 で `request.resource.data.tableNum is int` 等の型ガードを追加する判断。

テストカバレッジは engine pure function は良好だが、orchestrator の `applySingleMove` / `applyTableBreak` が未到達、`useSeatingAutoOrchestrator` hook の早期 return / inflight guard が未検証。本番投入前に要追加。

---

## Findings

### CRITICAL

**None.**

### HIGH

#### H1 — `applyTableBreak` の 2 ステップ write でデータ整合性破綻リスク

**File**: `src/lib/services/seating/orchestrator.ts:418-436`

`runTransaction` でプレイヤーの席移動を commit した**後**、別の `updateDoc` で `markTableBroken(tid, brokenTableNum)` を呼ぶ。tx 後の単独 write はネットワーク障害・crash で失敗する可能性があり、**プレイヤーは閉鎖卓から移動済みなのに `tables/{n}.isBroken=false` のまま残る**。コードコメントは「次の評価で broken でない卓として扱われる」と認めているが、現実には:

- 空席ができた閉鎖卓に late entry が誤って配席される（人数差発動 → 即移動と巡回するが UX 不安定）
- balancing 計算で「閉鎖したはずの卓」を含む不整合な状態が一瞬出現

**Fix**: トランザクション内で `tablesRef(tid)` の `isBroken=true` も同じ tx に含める。Firestore tx は最大 500 ops なので 6 卓 × N プレイヤー規模では問題ない。

---

#### H2 — `planLateEntrySeat` 後にトランザクション内で席占有を再検証していない

**File**: `src/lib/services/seating/orchestrator.ts:181-237` (`autoSeatLateEntry`)

`planLateEntrySeat` は subscribe スナップショットでシートを決定するが、tx 内では「対象プレイヤー本人の状態」のみ `tx.get` で再確認する。**2 端末が同時に late entry 自動配席を試みた場合、まったく同じ `{tableNum, seatNum}` に 2 人が配席される競合が起きうる**。

コード内コメントは「稀な race は許容」と明記しているが、ポーカーで「1 席 2 人」は実害が大きい（運営者が手動で気付かないと配席カードと現実が乖離）。

**Fix**: tx 内で割当先 `{tableNum, seatNum}` の現在占有者を確認するクエリを入れるか、各座席に `seats/{tableNum}-{seatNum}` ドキュメントを作って tx 内で `tx.get` できるようにする。最小修正案: 計画した `tableNum` の全プレイヤーを `tx.get` で再 read（最大 9 件、tx 制約内）し、`seatNum` が空であることを確認する。

---

#### H3 — `useSeatingAutoOrchestrator` の useEffect 依存に `userGroupIds`（配列参照）を含めると無限ループの恐れ

**File**: `src/lib/hooks/useSeatingAutoOrchestrator.ts:73`

`useCurrentGroup` が毎レンダリングで新しい配列参照を返すと、useEffect が常に発火し続け、inflight Set のクリア前に再実行される可能性。`useCurrentGroup` の現状実装は安定参照を返している（state が変わらない限り）が、**親フックの実装に依存した脆弱な設計**。

**Fix**: `userGroupIds.join(",")` を `useMemo` で安定化、または `useRef` で前値比較するパターンに変更。最小修正は、`opts` 全体ではなく `userGroupIds.join(",")` を依存に含めること。

---

#### H4 — `engine.ts` が `throw new Error(...)` を使用し、プロジェクト規約（`AppError`）に違反

**File**: `src/lib/services/seating/engine.ts:56,62`

`planInitialSeating` 内 2 箇所で `throw new Error("tables exceed max: ...")` / `throw new Error("seatsPerTable must be >= 1: ...")` を呼び出している。orchestrator 側 (`src/lib/services/seating/orchestrator.ts:148-158`) で `e.message.startsWith("tables exceed max")` という**文字列マッチ**で `seating/too-many-tables` に変換しているが、メッセージ変更で簡単に壊れる。

**Fix**: engine 側で `class TooManyTablesError extends Error` を export して `instanceof` 判定にするか、専用エラーコードを engine 内で定義して throw する。最低限、orchestrator 側の文字列マッチに依存する形は残さない。

---

### MEDIUM

#### M1 — `firestore.rules` の organizer-update branch にフィールド型・範囲制約なし

**File**: `firestore.rules:139-144`

organizer は `isBusted` / `bustedAt` / `tableNum` / `seatNum` / `lastMovedAt` を任意値で書ける（intentional）。ただし型ガード（`is int`）や範囲チェック（`tableNum >= 1`）がないため、**内部不正者が `tableNum: -1` 等を直接 SDK 経由で書き込める**。zod converter の read 時に invalid-data として skip されるが、UI で不自然な表示を招く可能性。

外部攻撃者は到達不可。20 人 × 月 1-2 回スケールでは現実的脅威ではないため Phase 5 で対応判断。

**Fix（Phase 5）**:
```
&& (request.resource.data.tableNum == null || (request.resource.data.tableNum is int && request.resource.data.tableNum > 0))
&& (request.resource.data.seatNum == null || (request.resource.data.seatNum is int && request.resource.data.seatNum > 0))
&& ((request.resource.data.tableNum == null) == (request.resource.data.seatNum == null))
```

---

#### M2 — `seatsPerTable` の zod 制約が body schema と input schema で不一致

**File**: `src/lib/firebase/schemas/tournament.ts:39` (body) vs `:53` (input)

- `tournamentBodySchema.seatsPerTable`: `.positive()` のみ（1 以上を許容）
- `createTournamentInputSchema.seatsPerTable`: `.min(2)` （2 以上）

DB に直接 `seatsPerTable: 1` が書かれた場合、`planInitialSeating` 内ガード (`seatsPerTable < 1`) は通過し、全員 1 人卓に配置される（テーブル数が爆発し MAX_TABLES 超過 throw）。

**Fix**: `tournamentBodySchema.seatsPerTable` も `.min(2)` に統一する。

---

#### M3 — `PlayerList` で `subscribeError` prop を `useEffect` 経由で `error` state にコピー（derived-state アンチパターン）

**File**: `src/components/tournament/PlayerList.tsx:46-48`

prop → state コピーは render 1 フレーム遅延を生む。`const error = subscribeError ?? localError` を render 時に計算すべき。

---

#### M4 — `commitInitialSeating` が tx スコープ外で `let plannedTableNums` を変更している

**File**: `src/lib/services/seating/orchestrator.ts:82,132`

Firestore transaction は最大 5 回リトライ。リトライ毎に `plannedTableNums` が書き換えられるため最終値は正しいが、可読性とリトライ安全性の観点で `runTransaction` の戻り値で受ける形に変更したい。

**Fix**: `const tableNums = await runTransaction<number[]>(firestore, async (tx) => { ... return plan.tableNums; })`

---

#### M5 — `BustButton` / `BalancingInstructionCard` が unmount 後に setState する可能性

**File**: `src/components/tournament/BustButton.tsx:39-41`, `src/components/tournament/BalancingInstructionCard.tsx:79-89`

非同期処理 `finally` で `setBusy(false)` を呼ぶが、その間にコンポーネントがアンマウントされると React の warning が出る。実害は軽微だが、`useRef<boolean>` で mounted 判定を入れるのが堅実。

---

### LOW

- **L1** — `tables.ts` の `upsertTable` / `upsertTables` と orchestrator 内のインライン batch upsert が重複。orchestrator 側を `upsertTables(tid, tableNums)` に置換すれば責務集約。
- **L2** — engine.ts の Error メッセージが英語（`"tables exceed max: ..."`）。プロジェクト規約は日本語ユーザーメッセージ。orchestrator 側で日本語ラップするのでユーザーには英語が見えないが、ログ可読性のため英語のままで OK と判断（情報量重視）。
- **L3** — `live-client.tsx` の 1 秒 interval は recentlyMoved=true の期間のみ起動するよう最適化可能（mobile battery 配慮）。
- **L4** — `subscribeTables` の error callback が dashboard で `// 致命ではない` として swallow されている（`src/app/tournaments/[tid]/dashboard-client.tsx:88`）。warn ログのみで UI に出さない設計だが、`error-logging.md` の「握りつぶし禁止」に低レベルで抵触する可能性。logger.warn は呼ばれているので形式上は OK。

---

### TEST GAPS（追加推奨テスト）

#### TG1 — `applySingleMove` の race guard が完全未テスト

**Impact**: HIGH。バランシング 1 件の通常パス + race（`moved` / `race` skip）が exercised されていない。これが最も頻繁に発動するバランシング transaction なので、ここのバグは席の二重割当・移動漏れに直結する。

**Add**: 差 2 の players + tables を渡して `applyBalancingOnce` 経由で `applySingleMove` が呼ばれること、tx 内で `p.tableNum !== move.from.tableNum` 時に `applied: false` になることを assert。

#### TG2 — `applyTableBreak` が完全未テスト

**Impact**: HIGH（H1 と関連）。複数プレイヤー一括移動 + `markTableBroken` の後処理という最も複雑なパスがカバーされていない。

**Add**: `applyBalancingOnce` 経由で table-break が成立する fixture（10 名 × 2 卓 + seatsPerTable=9）を渡し、tx.update が 8 件呼ばれること、その後 `markTableBroken` が呼ばれることを assert。

#### TG3 — `useSeatingAutoOrchestrator` hook の lateEntryDeadlineLevel 早期 return が未テスト

**Impact**: MEDIUM-HIGH。締切超過後に誤って自動配席が走らないことを保証する唯一の防御線（receipt の client check は別系統）が未検証。

**Add**: `renderHook` + mock orchestrator で、`tournament.currentLevel > tournament.lateEntryDeadlineLevel` の場合 `autoSeatLateEntry` が呼ばれないことを assert。

#### TG4 — `BalancingInstructionCard` の `useMemo` ロジック

**Impact**: MEDIUM。コンポーネントに engine 呼び出しが埋め込まれているため、表示の正しさ（break 優先 / move フォールバック / null 非表示）が保証されない。

**Add**: React Testing Library でレンダリングし、各 plan 状態で表示テキストが期待通りであることを assert。

#### TG5 — `live-client.tsx` の `recentlyMoved` 境界値（30 秒）

**Impact**: LOW-MEDIUM。タイマーロジックは現状 component 内に直書きされており抽出されていないため、29.9s / 30.0s / 30.1s の境界が検証されない。

**Add**: `lastMovedAt` を関数引数に取る pure helper を抽出してテスト。

---

## Validation Results

| Check       | Result      | Notes                              |
| ----------- | ----------- | ---------------------------------- |
| Type Check  | ✅ Pass     | `tsc --noEmit` ゼロエラー          |
| Lint        | ✅ Pass     | ESLint warning ゼロ                |
| Unit Tests  | ✅ Pass     | 220 tests pass                     |
| Build       | ✅ Pass     | `next build` 完走                  |
| Integration | N/A         | 外部 service 連携なし              |

---

## Files Reviewed

**Created (12)**:
- `src/lib/services/seating/{prng,engine,engine.test,orchestrator,orchestrator.test}.ts`
- `src/lib/firebase/repositories/{tables,tables.test,players.test}.ts`
- `src/lib/firebase/schemas/table.ts`
- `src/lib/hooks/useSeatingAutoOrchestrator.ts`
- `src/components/tournament/{BustButton,BalancingInstructionCard,SeatingBoard}.tsx`

**Modified (12)**:
- `src/lib/firebase/schemas/{player,tournament}.ts` `+` `index.test.ts`
- `src/lib/firebase/repositories/{players,tournaments,tournaments.test}.ts`
- `src/components/tournament/{PlayerList,TimerControls,TournamentForm}.tsx`
- `src/app/tournaments/[tid]/{dashboard-client,live/live-client,edit/tournament-edit-client}.tsx`
- `src/app/tournaments/new/tournament-new-client.tsx`
- `src/lib/services/{receipt,receipt.test,timer.test}.ts`
- `firestore.rules`

---

## Recommended Action

1. **Fix H1 / H2 immediately**（データ整合性 + 1 席 2 人 race）— `orchestrator.ts` 内の transaction 範囲を拡張
2. **Fix H3 / H4** — hook 依存安定化 + engine error type 化（小修正）
3. **Add TG1 / TG2 tests**（applySingleMove / applyTableBreak）— 既存 `mockTransaction` ヘルパで容易
4. M1（rules 型ガード）/ TG3（hook テスト）は Phase 5 で OK
5. その他 MEDIUM / LOW は次回 cleanup PR で対応
