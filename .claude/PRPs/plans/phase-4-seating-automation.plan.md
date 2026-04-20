# Plan: Phase 4 — Seating Automation

## Summary

運営者トリガーによる初回席決め、バストボタン、TDA 2015 準拠のテーブルバランシング（6 テーブル以下前提）、進行中レイトエントリーの自動配席を実装する。席情報はプレイヤードキュメントに `tableNum` / `seatNum` を持たせ、テーブルの閉鎖状態は `tournaments/{tid}/tables/{tableNum}` サブコレクションで管理する。バランシングはプレイヤー本人ではなく **group メンバー運営者** の端末が権威として実行する。

## User Story

As a サークル運営者（兼任プレイヤー）,
I want ハンド中にバストが発生してもアプリが「誰を、どの卓のどの席へ移動するか」を自動指示してくれる状態,
So that 自分のプレイを中断せず、TDA ルール通りにテーブルバランスを維持できる。

## Problem → Solution

**Current state (Phase 3 完了時点)**: タイマーとプレイヤー受付は realtime 同期で動くが、席情報は一切持たず、バスト発生時はログ上は `isBusted` フラグが立つだけで運営者は手作業・口頭で席移動を伝えている。PRD の Case 1（バランシング中）と「熟練者不在でも回る」という核心価値が未充足。

**Desired state (Phase 4 完了時点)**: 運営者ダッシュボードで 1 回「席を決定」ボタンを押せば全員ランダム配席。`running` 中にバストボタンを押すと、TDA ルールに基づきバランシング要否が評価され、必要なら「◯番さんを△卓△席へ」が PC・スマホの両方で即時表示される。進行中の新規参加者もレイトエントリー締切レベル内なら自動で空席に配席される。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 4 — Seating Automation
- **Estimated Files**: 約 18 files（新規 11・編集 7）

---

## UX Design

### Before（Phase 3 完了時点）

```
┌─ Organizer Dashboard ──────────────────────────────┐
│ [Monthly]  [running]  残り 08:42                  │
│                                                   │
│  Lv3  SB 100 / BB 200                             │
│                                                   │
│ [開始] [一時停止] [次レベル] [終了]                │
│                                                   │
│  参加者 (18)                                      │
│   ・山田  エントリー中 [取消]                       │
│   ・佐藤  エントリー中 [取消]                       │
│   ・鈴木  脱落                                    │
│   ...                                             │
└────────────────────────────────────────────────────┘
※ 席情報なし。バスト時は口頭で「鈴木さんバスト、山田さん 2 卓へ」
```

### After（Phase 4 完了時点）

```
┌─ Organizer Dashboard ──────────────────────────────┐
│ [Monthly]  [running]  残り 08:42                  │
│                                                   │
│  Lv3  SB 100 / BB 200                             │
│                                                   │
│ [一時停止] [次レベル] [終了]                       │
│                                                   │
│ ┌─ 次のアクション ─────────────────────────────┐ │
│ │ ⚠ 山田（1卓-2席）を 3卓-5席へ移動             │ │
│ │                                 [指示完了]   │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│  卓 1（5人）    卓 2（5人）    卓 3（4人）         │
│   1: 山田 ★     1: —           1: 田中             │
│   2: 佐藤       2: 渡辺         2: —               │
│   3: —          3: 小林         3: 中村            │
│   4: 松本       4: —           4: 吉田             │
│   5: 岡田       5: 橋本         5: （移動先）       │
│                                                   │
│  脱落 (3)                                         │
│   ・鈴木（Lv2）                                    │
│   ・伊藤（Lv3）                                    │
└────────────────────────────────────────────────────┘

┌─ Participant Live (/live/[tid]) ───────────────────┐
│ Monthly                              [同期中]      │
│                                                   │
│   Lv3  SB 100 / BB 200   残り 08:42                │
│                                                   │
│ ┌─ あなたの席 ─────────────────────────────────┐ │
│ │  卓 3  席 5                                  │ │
│ │                                              │ │
│ │  📣 席が移動しました（さっき）                │ │
│ └───────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint                | Before                              | After                                                   | Notes                                                                 |
| ------------------------- | ----------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------- |
| 運営者: 開始ボタン        | `setup → running`（即開始）         | `setup → seating` → 「席を決定」 → `seating → running` | 初回配席は運営者トリガー。参加者揃い待ちの間を明示的な `seating` で表現 |
| 運営者: 参加者行          | `[取消]` のみ                         | `[バスト]` `[取消]`（running 以降）                      | バストは運営者が押す（プレイングディーラー兼任を考慮）                   |
| 運営者: 席表示            | 席情報なし                          | 卓ごとの席カード＋★で自分                              | 運営者自身もプレイヤー時の自席確認に使える                                |
| 運営者: バランス指示      | 口頭                                | Dashboard 上部に 1 件ずつカード表示                       | バランス対象が 0 になるまでカード表示。運営者が「指示完了」で承認        |
| 参加者: 自席              | 見られない                          | `/live/[tid]` に「卓 X 席 Y」表示                       | 移動直後は一定時間 `📣 席が移動しました` バナー                           |
| 参加者: 受付後            | `tableNum/seatNum = null` のまま    | running 中受付なら自動配席、setup 中なら seating 待ち     | setup 中に受付した場合は `tableNum: null` のまま待機                  |

---

## Mandatory Reading

Files that MUST be read before implementing（`/prp-implement` 実行時は冒頭で全件 Read すること）:

| Priority         | File                                                                                       | Lines | Why                                                                                       |
| ---------------- | ------------------------------------------------------------------------------------------ | ----- | ----------------------------------------------------------------------------------------- |
| P0（必須）       | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md)                     | all   | zodConverter / repositories / rules の 3 点同時更新ルール                                 |
| P0（必須）       | [.claude/rules/error-logging.md](../../rules/error-logging.md)                             | all   | `AppError.from(e, "firestore/...", 日本語)` と `logger` 経由出力の強制                    |
| P0（必須）       | [.claude/rules/group-membership.md](../../rules/group-membership.md)                       | all   | `get(/groups/{gid})` による rule 評価コストと `useCurrentGroup()` の使い方               |
| P0（必須）       | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | all   | state transition / assertCanManage / runTransaction+expectedLevel パターンを完全踏襲する |
| P0（必須）       | [src/lib/firebase/repositories/players.ts](../../../src/lib/firebase/repositories/players.ts) | all   | subscribePlayers / upsertPlayer / deletePlayer のパターンをそのまま流用                  |
| P0（必須）       | [src/lib/firebase/converters.ts](../../../src/lib/firebase/converters.ts)                  | all   | `zodConverter` の `serverTimestamps: "estimate"` 仕様と invalid-data throw 契約         |
| P0（必須）       | [firestore.rules](../../../firestore.rules)                                                | all   | 現行 rule を保ったまま player update を整理する必要あり（organizer の bust/move を許可）  |
| P1（重要）       | [src/lib/hooks/useTournamentTimer.ts](../../../src/lib/hooks/useTournamentTimer.ts)        | all   | onSnapshot + setInterval + race-guarded transaction の整備パターン                        |
| P1（重要）       | [src/lib/services/timer.ts](../../../src/lib/services/timer.ts)                            | all   | pure function + TournamentDoc で derive する pattern。席エンジンも同様の pure 関数化する   |
| P1（重要）       | [src/components/tournament/TimerControls.tsx](../../../src/components/tournament/TimerControls.tsx) | all   | `run(op, fn, errMsg)` パターン（busy 状態管理 + AppError wrap + onError 通知）            |
| P1（重要）       | [src/app/tournaments/\[tid\]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | all   | ダッシュボード組成パターン。席決め導線・バランス指示カードはここに挿入                       |
| P1（重要）       | [src/app/tournaments/\[tid\]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | all   | 参加者ビューの組成と `useTournamentTimer` 使用例。自席表示はここに追記                       |
| P1（重要）       | [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) | all   | repository テストの vitest モック流儀（`vi.mock("firebase/firestore")`）                  |
| P1（重要）       | [src/lib/services/receipt.ts](../../../src/lib/services/receipt.ts)                        | all   | 参加者 join / cancel のサービス層。late entry hook もここか seat service に寄せる         |
| P1（重要）       | [src/components/tournament/PlayerList.tsx](../../../src/components/tournament/PlayerList.tsx) | all   | 参加者一覧の subscribe/cancel Dialog パターン。バストボタン UI はここに同居させる             |
| P2（参照）       | [.claude/PRPs/reports/phase-3-timer-realtime-viewer-report.md](../reports/phase-3-timer-realtime-viewer-report.md) | all   | Phase 3 の Post-Implementation Fixes（`serverTimestamps: "estimate"` と doc-skip ガード） |
| P2（参照）       | [src/lib/firebase/schemas/player.ts](../../../src/lib/firebase/schemas/player.ts)          | all   | 現行 player schema を踏襲して拡張                                                          |
| P2（参照）       | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts)  | all   | state enum に `seating` が既に含まれている                                                |

## External Documentation

| Topic                                         | Source                                                                                                                   | Key Takeaway                                                                                                                                                                                                                                    |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TDA 2015 Rules v1.0 — Table Balancing（Rule 26 系） | [PokerTDA PDF](https://www.pokertda.com/wp-content/uploads/2011/01/Poker-TDA-Rules-2015-Version-1.0-handout-size-redlines-PDF-4.pdf) | NLH トーナメントで **2〜6 テーブル** では「人数差 ≤ 1」が目標。人数差が 2 以上に開いた時点で「多い卓の BB 次プレイヤー」を「少ない卓の最悪ポジション（= BB を最も早く払う席）」へ移す。ブロークンテーブルは最小卓から閉じる |
| BB 優先同着                                   | PRD Decisions Log                                                                                                        | 「BB 次」の判定は**席番号昇順**で tie-break（本アプリはボタン位置を追跡しないため、事実上「席番号最小」が選ばれる）                                                                                                                                   |
| Firestore runTransaction race guard           | Phase 3 `advanceLevel` 実装                                                                                              | 複数端末が同時書き込みを試みる場合、`expectedLevel` 相当の optimistic guard を transaction 内で check → 不一致なら no-op。Phase 4 のバランシング・late entry でも同構造を使う                                                                             |
| Seedable PRNG                                 | mulberry32 / xmur3 など 1 ファイル実装で十分                                                                              | テストで「同じ seed なら同じ配席」を保証するため、`Math.random` ではなくシード可能な PRNG を `src/lib/services/seating/prng.ts` に 1 関数だけ用意する                                                                                                   |

**KEY_INSIGHT**: 現行コードベースではシード可能な PRNG は未使用だが、席決め関数を unit test するために必須。外部 dep を追加せず自前実装（~10 行）で十分。

**KEY_INSIGHT**: TDA の「BB 次」はボタン位置ベースだが、本アプリはボタン位置を追跡しない。PRD 合意通り「席番号最小」で代替する。これを **MVP の明示的な近似** としてコメントに残す。

**GOTCHA**: Phase 3 の `zodConverter` は `serverTimestamps: "estimate"` を既定で指定済み。`lastMovedAt` など Phase 4 で追加する `Timestamp` nullable フィールドも同じ挙動で問題なし。

**GOTCHA**: Firestore Security Rules の `get(/tournaments/{tid})` は rule 評価ごとに 1 read を消費する。players/{pid} の update rule で tournament の groupId を参照すると、全バスト操作が rule read を 1 件余計に消費する。20 人 × 月 1〜2 回規模では無視可能（`group-membership.md` 参照）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```typescript
// SOURCE: src/lib/firebase/schemas/tournament.ts:6-7
export const tournamentStateSchema = z.enum(["setup", "seating", "running", "paused", "finished"]);
export type TournamentState = z.infer<typeof tournamentStateSchema>;

// SOURCE: src/lib/firebase/schemas/player.ts:4-14
export const playerBodySchema = z.object({
  displayName: z.string().min(1),
  uid: z.string().nullable(),
  entryAt: z.instanceof(Timestamp),
  isBusted: z.boolean(),
  bustedAt: z.instanceof(Timestamp).nullable(),
});
export type PlayerBody = z.infer<typeof playerBodySchema>;
export type PlayerDoc = PlayerBody & { id: string };
```

**Rule**: schema は `*BodySchema` で body 定義 → `*Body` 型を infer → `*Doc = *Body & { id: string }` を export。Phase 4 の `table.ts` / `seatingAssignment` 等も同パターンを踏襲。

### ERROR_HANDLING

```typescript
// SOURCE: src/lib/firebase/repositories/players.ts:76-101
export async function upsertPlayer(
  tid: string,
  uid: string,
  input: { displayName: string },
): Promise<void> {
  try {
    // ... Firestore 呼び出し
    await setDoc(doc(playersRef(tid), uid), { ... });
    logger.info("player create ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "参加者登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, uid });
    throw wrapped;
  }
}

// SOURCE: src/lib/firebase/repositories/tournaments.ts:125-131
async function assertCanManage(tid: string, userGroupIds: string[]): Promise<TournamentDoc> {
  const t = await getTournament(tid);
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  return t;
}
```

**Rule**: 全 public repository 関数は `try/catch` で囲い、catch 節で必ず `AppError.from(e, "firestore/...", 日本語メッセージ)` にラップして `logger.warn` → `throw`。既にラップ済みの `AppError` はそのまま透過（`AppError.from` 実装で担保済み）。

### LOGGING_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:239-245, 256
logger.info("advance level skipped (race)", {
  tid,
  expected,
  actual: t.currentLevel,
});
// ...
logger.info("advance level ok (auto)", { tid, uid, expected });
```

**Rule**: info は「意図通りの成功パス」、warn は「失敗だがユーザー操作でリトライ可能」、debug は開発時のみ。AppError ラップ後は必ず `logger.warn(wrapped.message, { code: wrapped.code, ...context })`。第二引数は context object（文字列補間で message 内に混ぜない）。

### REPOSITORY_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/players.ts:20-24
function playersRef(tid: string) {
  return collection(firestore, "tournaments", tid, "players").withConverter(
    zodConverter(playerBodySchema, `tournaments/${tid}/players`),
  );
}

// SOURCE: src/lib/firebase/repositories/players.ts:54-70
export function subscribePlayers(
  tid: string,
  onNext: (players: PlayerDoc[]) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    query(playersRef(tid), orderBy("entryAt", "asc")),
    (snap) => {
      try {
        onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "参加者データが不正です"));
      }
    },
    (err) => onError(AppError.from(err, "firestore/subscribe_failed", "参加者購読エラー")),
  );
}
```

**Rule**: subcollection 参照は常にヘルパ関数化（`xxxRef(tid)`）。subscribe 系は `(onNext, onError) => unsubscribe` を返す。`includeMetadataChanges: true` は tournament doc 購読のみで、players/tables/seats では不要（fromCache は timer subscription に含まれているため別購読で重複判定しない）。

### TRANSACTION_PATTERN（race guard）

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:227-256
await runTransaction(firestore, async (tx) => {
  const ref = doc(tournamentsRef, tid);
  const snap = await tx.get(ref);
  if (!snap.exists()) {
    throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
  }
  const t: TournamentDoc = { id: snap.id, ...snap.data() };
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.currentLevel !== expected) {
    // 別端末が先に進めた。no-op で抜ける。
    logger.info("advance level skipped (race)", { tid, expected, actual: t.currentLevel });
    return;
  }
  // ...
  tx.update(ref, { ... });
});
```

**Rule**: 複数運営者端末が同時書き込みする可能性がある操作（late entry 自動配席・バランス処理）は **必ず** `runTransaction` + optimistic guard で包む。guard 不一致時は `logger.info("... skipped (race)", ...)` で no-op 終了。

### CLIENT_SIDE_OP_BUTTON_PATTERN

```typescript
// SOURCE: src/components/tournament/TimerControls.tsx:40-52
async function run(op: Op, fn: () => Promise<void>, errMsg: string) {
  if (busy !== null) return;
  setBusy(op);
  try {
    await fn();
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", errMsg);
    logger.warn(wrapped.message, { code: wrapped.code, tid, op });
    onError?.(`${wrapped.code}: ${wrapped.message}`);
  } finally {
    setBusy(null);
  }
}
```

**Rule**: 書き込み系ボタンは `busy: Op | null` state で多重押下防止。エラーは親 component に `onError(message)` コールバックで通知（ダッシュボード上部の destructive 領域に表示）。

### TEST_STRUCTURE

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:6-65
vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    collection: vi.fn(() => ({
      __ref: "collection",
      withConverter: vi.fn(function (this: unknown) { return this; }),
    })),
    doc: vi.fn((_ref, id?: string) => ({ __ref: "doc", id: id ?? "auto" })),
    query: vi.fn((...args) => ({ __ref: "query", args })),
    where: vi.fn((...args) => ({ __ref: "where", args })),
    addDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));
```

**Rule**: repository テストは firebase/firestore を `vi.mock` で mocking。Timestamp は `actual` から取得して実物を使う。`zodConverter` も noop mock。テストファイルは被テストファイルと同じディレクトリで `*.test.ts`。

### ZOD_CONVERTER_PATTERN

```typescript
// SOURCE: src/lib/firebase/converters.ts:25-57
export function zodConverter<T extends DocumentData>(
  schema: ZodType<T>,
  collectionName: string,
): FirestoreDataConverter<T> {
  return {
    toFirestore(modelObject): DocumentData {
      return modelObject as DocumentData;
    },
    fromFirestore(snap, options?) {
      const data = snap.data({ serverTimestamps: "estimate", ...options });
      const parsed = schema.safeParse(data);
      if (!parsed.success) {
        logger.warn("zodConverter validate failed", { ... });
        throw new AppError(..., "firestore/invalid-data", parsed.error);
      }
      return parsed.data;
    },
  };
}
```

**Rule**: 新規 collection / subcollection は必ず `zodConverter(schema, "path/like/string")` を通す。invalid-data は listing 関数側で try/catch で skip（`listTournamentsByGroup` を参照）。

---

## Files to Change

| File                                                                 | Action | Justification                                                                                                    |
| -------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------- |
| `src/lib/firebase/schemas/player.ts`                                 | UPDATE | `tableNum` / `seatNum` / `lastMovedAt` フィールド追加                                                            |
| `src/lib/firebase/schemas/tournament.ts`                             | UPDATE | `seatsPerTable` フィールド追加、`CreateTournamentInput` にも反映                                                  |
| `src/lib/firebase/schemas/table.ts`                                  | CREATE | 新規: `tableBodySchema`（`tableNum` / `isBroken` / `createdAt`）                                                 |
| `src/lib/firebase/repositories/tables.ts`                            | CREATE | 新規: tables subcollection の CRUD + subscribe                                                                   |
| `src/lib/firebase/repositories/tables.test.ts`                       | CREATE | tables repository 単体テスト                                                                                     |
| `src/lib/firebase/repositories/players.ts`                           | UPDATE | `bustPlayer` / `unbustPlayer` / `assignSeat` / `clearSeat` の 4 関数を追加                                        |
| `src/lib/firebase/repositories/players.test.ts`                      | CREATE | players repository 単体テスト（bust / assignSeat の state guard 等）                                              |
| `src/lib/firebase/repositories/tournaments.ts`                       | UPDATE | `beginSeating(setup→seating)` と `confirmSeating(seating→running)` を追加、`createTournament` に seatsPerTable 反映 |
| `src/lib/services/seating/prng.ts`                                   | CREATE | seed 可能な PRNG（mulberry32 風・外部 dep なし）                                                                  |
| `src/lib/services/seating/engine.ts`                                 | CREATE | pure 関数群: `planInitialSeating` / `planLateEntrySeat` / `planBalancingMove` / `planTableBreak`                 |
| `src/lib/services/seating/engine.test.ts`                            | CREATE | TDA ルール網羅の unit test（同数配分・2 差以上・テーブル閉鎖・同着席番号）                                          |
| `src/lib/services/seating/orchestrator.ts`                           | CREATE | engine の結果を Firestore に反映する副作用層（runTransaction + race guard）                                      |
| `src/lib/services/seating/orchestrator.test.ts`                      | CREATE | orchestrator の transaction mock テスト                                                                          |
| `src/lib/hooks/useSeatingAutoOrchestrator.ts`                        | CREATE | 運営者ダッシュボード専用 hook。未配席 late entry の検出 + 自動 orchestrator 呼出し（race guard 付き）              |
| `src/components/tournament/SeatingBoard.tsx`                         | CREATE | 卓ごとの席カード。`★` で自分、空席を `—` で表示                                                                  |
| `src/components/tournament/BalancingInstructionCard.tsx`             | CREATE | バランス指示カード。「◯◯を X卓Y席へ」＋「指示完了」ボタン                                                          |
| `src/components/tournament/BustButton.tsx`                           | CREATE | 1 プレイヤーに対応するバストボタン（PlayerList から呼ばれる）                                                      |
| `src/components/tournament/PlayerList.tsx`                           | UPDATE | バストボタン差し込み、canManage かつ running/paused 時のみ表示                                                     |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                     | UPDATE | seating モードでの「席を決定」ボタン、SeatingBoard / BalancingInstructionCard 差し込み、`useSeatingAutoOrchestrator` 装着 |
| `src/app/tournaments/[tid]/live/live-client.tsx`                     | UPDATE | 自分の `tableNum` / `seatNum` 表示、`lastMovedAt` から 30 秒以内なら「席が移動しました」バナー                      |
| `src/lib/services/receipt.ts`                                        | UPDATE | join 後の late entry hook: tournament state が running なら orchestrator を呼べる状態にする（実際の seat 付与は運営者端末） |
| `firestore.rules`                                                    | UPDATE | players/{pid} の update rule を「self: displayName のみ」と「group メンバー: bust/seat 変更可」に分岐、tables/{tableNum} は `/{sub=**}` catch-all で OK |
| `src/components/tournament/TimerControls.tsx`                        | UPDATE | `seating` 状態で「トーナメント開始」ボタンを `confirmSeating` へ差し替え                                          |

### NOT Building

- **リバイ／アドオン管理** — PRD 明示の v1 対象外（MoSCoW の Won't）。
- **ハンド・フォー・ハンド** — 50 人超 Non-User のため。
- **7 テーブル以上の対応** — TDA のバランシング許容差が変わる（1→2）ため別ロジック。今回は「6 テーブル以下前提」を assertion 化し、超過入力時はエラーで弾く。
- **ボタン（ディーラーボタン）位置の追跡** — BB 次の判定は「席番号最小」で近似（PRD 合意）。ボタン位置 UI はここでは追加しない。
- **席移動を参加者スマホに push 通知**（Web Push / Cloud Messaging）— v1 は onSnapshot + 画面上のバナーで代替。
- **賞金計算（単純分配）** — Phase 5 に余力があれば追加する Should スコープ。
- **ブラインド中のチップ再カウント／再スタック** — PRD 対象外。
- **events コレクション（監査ログ）** — PRD の「events」は将来拡張用、v1 はプレイヤー doc の状態フィールドで代替。v1 では作らない（不要な writes を避ける）。
- **運営者による late entry の手動座席変更 UI** — 自動配席だけを提供。明示変更は Phase 5 以降のフィードバックを見て判断。
- **seatsPerTable の運用中変更** — 一度 `seating` に入ったら固定。変更したい場合は `setup` に戻す（v1 は戻し機能自体も作らない。setup で設定時に決定）。

---

## Step-by-Step Tasks

### Task 1: Player schema に座席フィールド追加

- **ACTION**: `src/lib/firebase/schemas/player.ts` を更新
- **IMPLEMENT**:
  ```typescript
  export const playerBodySchema = z.object({
    displayName: z.string().min(1),
    uid: z.string().nullable(),
    entryAt: z.instanceof(Timestamp),
    isBusted: z.boolean(),
    bustedAt: z.instanceof(Timestamp).nullable(),
    // Phase 4: 席割当（未配席は null）。初回席決め前 / late entry 登録直後 / バスト後は null。
    tableNum: z.number().int().positive().nullable(),
    seatNum: z.number().int().positive().nullable(),
    // Phase 4: 直近の席移動時刻。30 秒以内なら /live で「席が移動しました」バナー表示。
    lastMovedAt: z.instanceof(Timestamp).nullable(),
  });
  ```
- **MIRROR**: NAMING_CONVENTION（`*BodySchema` → `*Body` → `*Doc`）
- **IMPORTS**: 既存の `Timestamp` / `z` のみ
- **GOTCHA**: 既存データ（`tableNum` フィールドを持たないドキュメント）は zod validate 失敗で `listPlayers` の該当行が skip される。既存ドキュメントに `tableNum: null` などの default 値を持たせる移行が必要 → ただし Phase 2.5 で破壊的移行を受け入れ済みの前提で、既存トーナメントを運用前に全削除する手順を実装レポートに残す。運用中 tournament が存在する場合のみ mini-migration スクリプト（`scripts/migrate-phase-4.ts` など）を検討する。
- **VALIDATE**: `npm run typecheck` でエラーなし。既存 player subscribe が動く（既存データを使わないなら）。

### Task 2: Tournament schema に seatsPerTable 追加

- **ACTION**: `src/lib/firebase/schemas/tournament.ts` を更新
- **IMPLEMENT**:
  ```typescript
  export const tournamentBodySchema = z.object({
    // ... 既存フィールド ...
    // Phase 4: 1 テーブルあたりの最大席数。default 9（NLH 標準）。setup 中のみ変更可。
    seatsPerTable: z.number().int().positive().max(10),
    createdAt: z.instanceof(Timestamp),
    updatedAt: z.instanceof(Timestamp),
  });

  export const createTournamentInputSchema = z.object({
    groupId: z.string().min(1),
    createdByUid: z.string().min(1),
    name: z.string().min(1, "名前を入力してください"),
    structureSnapshot: structureSnapshotSchema,
    // Phase 4: default 9 を UI 側で指定。値は 2〜10。
    seatsPerTable: z.number().int().positive().max(10),
  });
  ```
- **MIRROR**: NAMING_CONVENTION
- **IMPORTS**: 既存のみ
- **GOTCHA**: `max(10)` で 11 以上を拒否。既存 tournament doc は `seatsPerTable` を持たないため再度マイグレーションが必要。Task 1 と同じ扱いで、運用中データは手動削除前提。
- **VALIDATE**: `npm run typecheck` でエラーなし。

### Task 3: Table schema + repository 新設

- **ACTION**: `src/lib/firebase/schemas/table.ts` と `src/lib/firebase/repositories/tables.ts` を新規作成
- **IMPLEMENT**:

  ```typescript
  // schemas/table.ts
  import { Timestamp } from "firebase/firestore";
  import { z } from "zod";

  export const tableBodySchema = z.object({
    tableNum: z.number().int().positive(),
    isBroken: z.boolean(),
    createdAt: z.instanceof(Timestamp),
  });
  export type TableBody = z.infer<typeof tableBodySchema>;
  export type TableDoc = TableBody & { id: string };
  ```

  ```typescript
  // repositories/tables.ts
  import {
    collection, doc, getDocs, onSnapshot, orderBy, query,
    serverTimestamp, setDoc, updateDoc, writeBatch,
  } from "firebase/firestore";
  import { AppError } from "@/lib/errors";
  import { firestore } from "@/lib/firebase/client";
  import { zodConverter } from "@/lib/firebase/converters";
  import { tableBodySchema, type TableDoc } from "@/lib/firebase/schemas/table";
  import { logger } from "@/lib/logger";

  function tablesRef(tid: string) {
    return collection(firestore, "tournaments", tid, "tables").withConverter(
      zodConverter(tableBodySchema, `tournaments/${tid}/tables`),
    );
  }

  export async function listTables(tid: string): Promise<TableDoc[]> {
    try {
      const q = query(tablesRef(tid), orderBy("tableNum", "asc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "テーブル一覧取得に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
  }

  export function subscribeTables(
    tid: string,
    onNext: (tables: TableDoc[]) => void,
    onError: (err: AppError) => void,
  ): () => void {
    return onSnapshot(
      query(tablesRef(tid), orderBy("tableNum", "asc")),
      (snap) => {
        try {
          onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        } catch (e) {
          onError(AppError.from(e, "firestore/invalid-data", "テーブルデータが不正です"));
        }
      },
      (err) => onError(AppError.from(err, "firestore/subscribe_failed", "テーブル購読エラー")),
    );
  }

  export async function upsertTables(
    tid: string,
    tableNums: number[],
  ): Promise<void> {
    try {
      const batch = writeBatch(firestore);
      for (const n of tableNums) {
        const ref = doc(tablesRef(tid), String(n));
        batch.set(ref, { tableNum: n, isBroken: false, createdAt: serverTimestamp() });
      }
      await batch.commit();
      logger.info("tables upsert ok", { tid, count: tableNums.length });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "テーブル登録に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
  }

  export async function markTableBroken(tid: string, tableNum: number): Promise<void> {
    try {
      await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: true });
      logger.info("table broken ok", { tid, tableNum });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "テーブル閉鎖に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, tableNum });
      throw wrapped;
    }
  }
  ```

- **MIRROR**: REPOSITORY_PATTERN / ERROR_HANDLING
- **IMPORTS**: `writeBatch` は firebase/firestore から。既存 repositories には未使用なので新規追加。
- **GOTCHA**: doc id は `String(tableNum)` で文字列化。`"1"` `"2"` …。`orderBy("tableNum", "asc")` で doc id 依存にしないこと（id 文字列ソートだと `"10" < "2"` になる）。
- **VALIDATE**: `tables.test.ts` で upsert / list / subscribe の happy path + invalid-data throw のテスト通過。

### Task 4: Players repository に bust / seat 操作を追加

- **ACTION**: `src/lib/firebase/repositories/players.ts` に 4 関数追加
- **IMPLEMENT**:
  ```typescript
  export async function bustPlayer(
    tid: string,
    pid: string,
    userGroupIds: string[],
  ): Promise<void> {
    // assertCanManage は tournaments 側のヘルパ。ここでは同等の外部 check をする想定。
    // 呼出し側（orchestrator / component）から canManage 済み前提で渡す簡易設計でも可。
    try {
      await updateDoc(doc(playersRef(tid), pid), {
        isBusted: true,
        bustedAt: serverTimestamp(),
        tableNum: null,
        seatNum: null,
        lastMovedAt: serverTimestamp(),
      });
      logger.info("player bust ok", { tid, pid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "バスト処理に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
      throw wrapped;
    }
  }

  export async function unbustPlayer(tid: string, pid: string): Promise<void> {
    // 誤操作のリカバリ専用。席は再配席されないため、運営者の手動再開時に seating→running をやり直す運用。
    try {
      await updateDoc(doc(playersRef(tid), pid), {
        isBusted: false,
        bustedAt: null,
        lastMovedAt: serverTimestamp(),
      });
      logger.info("player unbust ok", { tid, pid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "バスト取消に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
      throw wrapped;
    }
  }

  export async function assignSeat(
    tid: string,
    pid: string,
    tableNum: number,
    seatNum: number,
  ): Promise<void> {
    try {
      await updateDoc(doc(playersRef(tid), pid), {
        tableNum,
        seatNum,
        lastMovedAt: serverTimestamp(),
      });
      logger.info("player seat assign ok", { tid, pid, tableNum, seatNum });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "席割当に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
      throw wrapped;
    }
  }

  export async function clearSeat(tid: string, pid: string): Promise<void> {
    try {
      await updateDoc(doc(playersRef(tid), pid), {
        tableNum: null,
        seatNum: null,
        lastMovedAt: serverTimestamp(),
      });
      logger.info("player seat clear ok", { tid, pid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "席クリアに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: ERROR_HANDLING / LOGGING_PATTERN
- **IMPORTS**: 既存 `updateDoc, doc, serverTimestamp`
- **GOTCHA**: permission は Firestore rules で最終防衛（group メンバーのみ bust/seat 可）。client 側で `userGroupIds` check を重複して行う場合は orchestrator 層で実施する。repository はシンプルな write ラッパに留める。
- **VALIDATE**: `players.test.ts` で update の payload に期待フィールドが含まれることを assert。

### Task 5: Seating engine（純粋関数）

- **ACTION**: `src/lib/services/seating/engine.ts` を新規作成
- **IMPLEMENT**:
  ```typescript
  // Phase 4: TDA 2015 ルール（6 テーブル以下）に準拠した席決定ロジックの pure function 群。
  // Firestore への副作用は持たず、入力 → 計画 (plan) の変換だけを行う。
  // 呼び出し側（orchestrator）が plan を受け取って Firestore に反映する。

  import type { PlayerDoc } from "@/lib/firebase/schemas/player";

  const MAX_TABLES = 6;

  export interface Seat {
    tableNum: number;
    seatNum: number;
  }

  export interface SeatAssignment {
    playerId: string;
    tableNum: number;
    seatNum: number;
  }

  export interface InitialSeatingPlan {
    assignments: SeatAssignment[];
    tableNums: number[]; // upsertTables に渡す
  }

  export interface BalancingMove {
    playerId: string;
    from: Seat;
    to: Seat;
  }

  export interface TableBreakPlan {
    brokenTableNum: number;
    moves: BalancingMove[]; // 解散したテーブルから各席への配置指示
  }

  /**
   * 初回席決め: 未バストのプレイヤーを seatsPerTable で均等割り。
   * seed を渡すとテストで再現可能。渡さない場合は Math.random の seed を内部生成。
   */
  export function planInitialSeating(
    players: PlayerDoc[],
    seatsPerTable: number,
    seed: number,
  ): InitialSeatingPlan {
    const active = players.filter((p) => !p.isBusted);
    if (active.length === 0) return { assignments: [], tableNums: [] };
    const numTables = Math.max(1, Math.ceil(active.length / seatsPerTable));
    if (numTables > MAX_TABLES) {
      throw new Error(`tables exceed max: ${numTables} > ${MAX_TABLES}`);
    }
    const shuffled = shuffle(active, seed);
    const buckets: PlayerDoc[][] = Array.from({ length: numTables }, () => []);
    for (let i = 0; i < shuffled.length; i++) {
      buckets[i % numTables].push(shuffled[i]);
    }
    const assignments: SeatAssignment[] = [];
    for (let t = 0; t < numTables; t++) {
      for (let s = 0; s < buckets[t].length; s++) {
        assignments.push({
          playerId: buckets[t][s].id,
          tableNum: t + 1,
          seatNum: s + 1,
        });
      }
    }
    const tableNums = Array.from({ length: numTables }, (_, i) => i + 1);
    return { assignments, tableNums };
  }

  /**
   * 進行中レイトエントリーの自動配席。
   * ルール: 活動プレイヤー数が最小の卓（同数なら tableNum 昇順）の、空席最小 seatNum に配席。
   * 満席時は null を返す（呼出し側で「締切超過」エラーに変換）。
   */
  export function planLateEntrySeat(
    seatedPlayers: PlayerDoc[],
    brokenTableNums: number[],
    seatsPerTable: number,
  ): Seat | null {
    const tableCount: Map<number, number> = new Map();
    const occupied: Set<string> = new Set();
    for (const p of seatedPlayers) {
      if (p.isBusted) continue;
      if (p.tableNum === null || p.seatNum === null) continue;
      tableCount.set(p.tableNum, (tableCount.get(p.tableNum) ?? 0) + 1);
      occupied.add(`${p.tableNum}-${p.seatNum}`);
    }
    // broken でない tableNum の中で count 昇順・同数なら tableNum 昇順
    const liveTables = Array.from(tableCount.keys()).filter(
      (n) => !brokenTableNums.includes(n),
    );
    if (liveTables.length === 0) return null;
    liveTables.sort((a, b) => {
      const ca = tableCount.get(a) ?? 0;
      const cb = tableCount.get(b) ?? 0;
      if (ca !== cb) return ca - cb;
      return a - b;
    });
    for (const t of liveTables) {
      if ((tableCount.get(t) ?? 0) >= seatsPerTable) continue;
      for (let s = 1; s <= seatsPerTable; s++) {
        if (!occupied.has(`${t}-${s}`)) return { tableNum: t, seatNum: s };
      }
    }
    return null;
  }

  /**
   * 差分 ≥ 2 の場合のバランシング 1 件（複数件の場合は呼出し側で反復）。
   * 過剰卓から「席番号最小」の 1 人を、不足卓の「最小空席」へ移す。
   * 差分が 2 未満なら null（不要）。
   */
  export function planBalancingMove(
    seatedPlayers: PlayerDoc[],
    brokenTableNums: number[],
    seatsPerTable: number,
  ): BalancingMove | null {
    const { maxTable, minTable, diff } = computeTableCounts(
      seatedPlayers, brokenTableNums,
    );
    if (maxTable === null || minTable === null) return null;
    if (diff < 2) return null;
    // maxTable の最小席番号プレイヤー（未バスト）
    const movedPlayer = seatedPlayers
      .filter((p) => !p.isBusted && p.tableNum === maxTable && p.seatNum !== null)
      .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0))[0];
    if (!movedPlayer || movedPlayer.seatNum === null) return null;
    // minTable の最小空席
    const occupied = new Set(
      seatedPlayers
        .filter((p) => !p.isBusted && p.tableNum === minTable)
        .map((p) => p.seatNum),
    );
    let targetSeat: number | null = null;
    for (let s = 1; s <= seatsPerTable; s++) {
      if (!occupied.has(s)) { targetSeat = s; break; }
    }
    if (targetSeat === null) return null;
    return {
      playerId: movedPlayer.id,
      from: { tableNum: maxTable, seatNum: movedPlayer.seatNum },
      to: { tableNum: minTable, seatNum: targetSeat },
    };
  }

  /**
   * テーブル閉鎖判定: 残プレイヤー ≤ (生存卓数 - 1) × seatsPerTable のとき最小の生存卓を閉じる。
   * 閉じた卓のプレイヤーを、残りの生存卓の最小空席から順に詰める。
   * 複数同数が最小なら tableNum 最大を閉じる（卓番号が若い方を保つ）。
   */
  export function planTableBreak(
    seatedPlayers: PlayerDoc[],
    brokenTableNums: number[],
    seatsPerTable: number,
  ): TableBreakPlan | null {
    const active = seatedPlayers.filter(
      (p) => !p.isBusted && p.tableNum !== null,
    );
    const liveTableNums = Array.from(new Set(active.map((p) => p.tableNum!)))
      .filter((n) => !brokenTableNums.includes(n))
      .sort((a, b) => a - b);
    if (liveTableNums.length <= 1) return null;
    if (active.length > (liveTableNums.length - 1) * seatsPerTable) return null;

    // 閉じる卓: 最少人数の卓、同数なら tableNum 最大
    const counts = new Map<number, number>();
    for (const t of liveTableNums) counts.set(t, 0);
    for (const p of active) counts.set(p.tableNum!, (counts.get(p.tableNum!) ?? 0) + 1);
    const toBreak = [...counts.entries()].sort((a, b) => {
      if (a[1] !== b[1]) return a[1] - b[1];
      return b[0] - a[0]; // tableNum 最大を優先
    })[0][0];

    const survivingTables = liveTableNums.filter((n) => n !== toBreak);
    const brokenPlayers = active
      .filter((p) => p.tableNum === toBreak)
      .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0));
    // 各生存卓の空席マップ
    const occupiedBySurvivor: Map<number, Set<number>> = new Map();
    for (const t of survivingTables) occupiedBySurvivor.set(t, new Set());
    for (const p of active) {
      if (p.tableNum !== toBreak) {
        occupiedBySurvivor.get(p.tableNum!)?.add(p.seatNum!);
      }
    }
    const moves: BalancingMove[] = [];
    for (const p of brokenPlayers) {
      // 次の配置先: 生存卓のうち人数最小（同数なら tableNum 昇順）で空席最小
      const candidates = survivingTables
        .map((t) => ({
          t,
          count: (occupiedBySurvivor.get(t)?.size ?? 0),
        }))
        .filter((c) => c.count < seatsPerTable)
        .sort((a, b) => (a.count !== b.count ? a.count - b.count : a.t - b.t));
      if (candidates.length === 0) return null; // 想定外（事前条件チェック済み）
      const target = candidates[0];
      let seat = 1;
      while (occupiedBySurvivor.get(target.t)?.has(seat)) seat++;
      moves.push({
        playerId: p.id,
        from: { tableNum: toBreak, seatNum: p.seatNum! },
        to: { tableNum: target.t, seatNum: seat },
      });
      occupiedBySurvivor.get(target.t)?.add(seat);
    }
    return { brokenTableNum: toBreak, moves };
  }

  function computeTableCounts(
    players: PlayerDoc[],
    brokenTableNums: number[],
  ): { maxTable: number | null; minTable: number | null; diff: number } {
    const count = new Map<number, number>();
    for (const p of players) {
      if (p.isBusted) continue;
      if (p.tableNum === null) continue;
      if (brokenTableNums.includes(p.tableNum)) continue;
      count.set(p.tableNum, (count.get(p.tableNum) ?? 0) + 1);
    }
    if (count.size < 2) return { maxTable: null, minTable: null, diff: 0 };
    const entries = [...count.entries()];
    entries.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    const [minTable, minC] = entries[0];
    const [maxTable, maxC] = entries[entries.length - 1];
    return { maxTable, minTable, diff: maxC - minC };
  }

  function shuffle<T>(xs: readonly T[], seed: number): T[] {
    const rng = mulberry32(seed);
    const arr = xs.slice();
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function mulberry32(seed: number): () => number {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  ```
- **MIRROR**: pure function 志向（timer.ts と同じ）
- **IMPORTS**: `PlayerDoc` 型のみ。Firestore SDK は **絶対に import しない**（副作用を engine に持ち込まない）
- **GOTCHA**:
  - `MAX_TABLES = 6` を超えた場合は `throw new Error(...)` で弾く。orchestrator 側で `AppError` にラップ。
  - `planBalancingMove` は毎回 1 件のみを返す。差が 4 以上の場合でも 1 件ずつ UI に表示し、運営者が「指示完了」を押す度に再評価する（UI 負荷削減・視認性）。
  - `planTableBreak` は「閉鎖可能な限りの最大限閉鎖」ではなく「1 卓閉鎖 + 移動全件」を返す。複数閉鎖可能な場合は呼出し側が 1 回ずつ反復する。
- **VALIDATE**: engine.test.ts で以下のケース全網羅:
  1. 初回配席（9 seats × 18 players → 2 卓 9 人ずつ）
  2. 初回配席（9 seats × 20 players → 3 卓 7/7/6 人）
  3. 同 seed で 2 回呼ぶと同じ結果
  4. late entry: 空席のある最小卓の最小席番号
  5. late entry: 満席のみなら null
  6. balancing move: 7 vs 5 → 1 移動
  7. balancing move: 6 vs 5 → null（差 1 は発動しない）
  8. balancing move: BB 同着（4 vs 2）は最小席番号
  9. table break: 2 卓 × 9 席 + 5 人 ⇒ 1 卓閉鎖可（最少人数卓）
  10. table break: 席数上限に達する場合は null

### Task 6: Seating orchestrator（Firestore 副作用層）

- **ACTION**: `src/lib/services/seating/orchestrator.ts` を新規作成
- **IMPLEMENT**:
  ```typescript
  import { runTransaction, serverTimestamp, doc } from "firebase/firestore";
  import { AppError } from "@/lib/errors";
  import { firestore } from "@/lib/firebase/client";
  // repositories / schemas からの import（略）

  /**
   * 初回席決め: setup → seating → running 遷移の中間で呼ばれる。
   * 1 回の transaction で:
   *  - 全 active player に tableNum/seatNum/lastMovedAt を書く
   *  - tables subcollection に tableNum ドキュメントを upsert
   *  - tournament の state を "seating" にする
   * 呼出しは group メンバー運営者のみ（assertCanManage 相当を orchestrator 先頭で実施）。
   */
  export async function commitInitialSeating(
    tid: string,
    uid: string,
    userGroupIds: string[],
    seed: number,
  ): Promise<void> {
    try {
      await runTransaction(firestore, async (tx) => {
        // 1. tournament を lock して state guard
        const tRef = doc(tournamentsRef, tid);
        const tSnap = await tx.get(tRef);
        if (!tSnap.exists()) {
          throw new AppError("not found", "firestore/not-found");
        }
        const t = { id: tSnap.id, ...tSnap.data() };
        if (!userGroupIds.includes(t.groupId)) {
          throw new AppError("not allowed", "firestore/permission-denied");
        }
        if (t.state !== "setup" && t.state !== "seating") {
          throw new AppError("初回席決めは setup / seating 中のみ", "tournament/invalid-state");
        }
        // 2. 現時点の全 player を取得
        // Firestore transaction 内で getDocs ができないため、事前に非 transaction で read した
        // snapshot を使う。orchestrator の呼出し側から players リストを受け取る設計にする。
        // →→→ 実装では commitInitialSeating(tid, uid, groupIds, seed, players) に拡張
        // ...（Task 7 の UI で subscribe 済みの player 配列を渡す）
        // 3. engine.planInitialSeating で計画
        // 4. tx.update で全 player + tournament を一括書き込み、tables は batch（後処理）
        // ...
      });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "初回席決めに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
  }

  /**
   * late entry の自動配席: 未配席（tableNum == null）かつ !isBusted のプレイヤーに席を割当。
   * `expectedUpdatedAtMs` を player doc から取り、transaction 内で変化していないことを guard。
   * 他端末が先に配席していれば no-op。
   */
  export async function autoSeatLateEntry(
    tid: string,
    uid: string,
    userGroupIds: string[],
    playerId: string,
    expectedLastMovedAtMs: number | null, // 直前に観測した値。null も許容（未配席）
  ): Promise<void> { /* 実装同様 runTransaction + guard */ }

  /**
   * バスト後のバランシング評価: engine の planTableBreak / planBalancingMove を順に呼ぶ。
   * 1 件でも結果があれば moves の順に assignSeat。tables を閉じる場合は markTableBroken。
   * 冪等性のため、毎呼出しで re-subscribe 済みの最新 players snapshot を受け取る設計。
   */
  export async function applyBalancingOnce(
    tid: string,
    uid: string,
    userGroupIds: string[],
    players: PlayerDoc[],
    tables: TableDoc[],
    seatsPerTable: number,
  ): Promise<{ applied: boolean; description: string | null }> { /* ... */ }
  ```
- **MIRROR**: TRANSACTION_PATTERN（race guard）
- **IMPORTS**: Firestore SDK の `runTransaction`, `doc`, `serverTimestamp` + repositories + engine
- **GOTCHA**:
  - Firestore transaction 内では `getDocs` を使った collection scan は不可。初回席決め時は「subscribe 済みの player snapshot を呼出し側から渡す」API にする。transaction 内では各 player doc を個別に `tx.get` → 変化していないか確認 → `tx.update`。
  - late entry は「最初に発見した運営者端末が配席を試みる」レースになる。optimistic guard: transaction 内で `player.tableNum === null && player.lastMovedAt 相当 === expected` を確認。不一致なら no-op。
  - バランシングは複数卓で同時に差 ≥ 2 になった場合、同じ 1 件 move だけが確定する（別端末の別 move は次の subscribe 発火時に評価される）。
- **VALIDATE**: orchestrator.test.ts で `runTransaction` を mock し、期待された `tx.update` 呼び出しが行われることを assert。race guard 条件で no-op することも assert。

### Task 7: `useSeatingAutoOrchestrator` hook（運営者専用）

- **ACTION**: `src/lib/hooks/useSeatingAutoOrchestrator.ts` を新規作成
- **IMPLEMENT**:
  ```typescript
  "use client";
  import { useEffect, useRef } from "react";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TableDoc } from "@/lib/firebase/schemas/table";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  import { autoSeatLateEntry } from "@/lib/services/seating/orchestrator";
  import { logger } from "@/lib/logger";

  interface Options {
    tid: string;
    uid: string | null;
    userGroupIds: string[];
    tournament: TournamentDoc | null;
    players: PlayerDoc[];
    tables: TableDoc[];
  }

  /**
   * 運営者ダッシュボード専用。未配席 late entry を検出すると auto_seat_late_entry を試みる。
   * バランシング側は「運営者の明示承認」UI を経由するため、ここでは自動適用しない
   * （= 画面に候補が出てから「指示完了」を押した瞬間に applyBalancingOnce が走る）。
   *
   * /live（参加者ビュー）からは絶対に呼ばない。rule 側で弾かれる & 無駄 transaction 発生。
   */
  export function useSeatingAutoOrchestrator(opts: Options): void {
    const inflight = useRef<Set<string>>(new Set());
    useEffect(() => {
      const { tid, uid, userGroupIds, tournament, players } = opts;
      if (!uid || !tournament) return;
      if (tournament.state !== "running" && tournament.state !== "paused") return;
      if (!userGroupIds.includes(tournament.groupId)) return;
      // 締切超過ならスキップ
      if (tournament.currentLevel > tournament.lateEntryDeadlineLevel) return;

      for (const p of players) {
        if (p.isBusted) continue;
        if (p.tableNum !== null && p.seatNum !== null) continue;
        if (inflight.current.has(p.id)) continue;
        inflight.current.add(p.id);
        const expected = p.lastMovedAt ? p.lastMovedAt.toMillis() : null;
        void autoSeatLateEntry(tid, uid, userGroupIds, p.id, expected)
          .catch((e) => logger.warn("auto seat late entry failed", { code: e?.code, tid, pid: p.id }))
          .finally(() => inflight.current.delete(p.id));
      }
    }, [opts.tid, opts.uid, opts.userGroupIds, opts.tournament, opts.players, opts.tables]);
  }
  ```
- **MIRROR**: useTournamentTimer の autoAdvance ロジック（inflight ref で多重発火を避ける）
- **IMPORTS**: 既存 schemas + orchestrator
- **GOTCHA**:
  - 複数運営者端末で同時に発火した場合は orchestrator 側の transaction guard が処理する。hook 側の ref は **単一端末内** の多重発火を防ぐだけ。
  - `opts.players` の識別子変更（配列参照の同一性）に依存するため、親 component は subscribePlayers の callback で毎回新しい配列を渡す前提。
- **VALIDATE**: hook は現時点では直接テストしない（component を跨いだ integration は Phase 5 で検証）。

### Task 8: Tournament repository に seating 遷移関数を追加

- **ACTION**: `src/lib/firebase/repositories/tournaments.ts` に関数追加
- **IMPLEMENT**:
  ```typescript
  export async function beginSeating(
    tid: string, uid: string, userGroupIds: string[],
  ): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.state !== "setup") {
      throw new AppError("setup 状態ではありません", "tournament/invalid-state");
    }
    try {
      await updateDoc(doc(tournamentsRef, tid), {
        state: "seating",
        updatedAt: serverTimestamp(),
      });
      logger.info("tournament seating begin ok", { tid, uid });
    } catch (e) { /* AppError.from + throw */ }
  }

  export async function confirmSeating(
    tid: string, uid: string, userGroupIds: string[],
  ): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.state !== "seating") {
      throw new AppError("seating 状態ではありません", "tournament/invalid-state");
    }
    try {
      await updateDoc(doc(tournamentsRef, tid), {
        state: "running",
        startedAt: serverTimestamp(),
        levelStartedAt: serverTimestamp(),
        pausedAt: null,
        pausedAccumMs: 0,
        finishedAt: null,
        currentLevel: 1,
        updatedAt: serverTimestamp(),
      });
      logger.info("tournament seating confirm ok", { tid, uid });
    } catch (e) { /* AppError.from + throw */ }
  }

  // startTournament は Phase 4 で非推奨化し、beginSeating → commitInitialSeating → confirmSeating のパイプラインに置換。
  // 既存 test では startTournament の呼出しを削除して置き換える。削除は後方互換を断つ破壊的変更として明示。
  ```
  `createTournament` 内に `seatsPerTable: input.seatsPerTable,` を追加。
- **MIRROR**: 既存 `startTournament` / `pauseTournament` と同じ形
- **IMPORTS**: 変更なし
- **GOTCHA**: `startTournament` を削除することで TimerControls のレガシーボタンが壊れる。Task 14 で差し替える。
- **VALIDATE**: `tournaments.test.ts` を更新。`beginSeating` / `confirmSeating` の state guard を追加テスト。

### Task 9: Firestore rules の player update 分岐

- **ACTION**: `firestore.rules` の `match /players/{pid}` を書き換え
- **IMPLEMENT**:
  ```
  match /players/{pid} {
    allow read: if isSignedIn();
    allow create: if isSignedIn()
                  && pid == request.auth.uid
                  && request.resource.data.uid == request.auth.uid
                  && request.resource.data.isBusted == false
                  && request.resource.data.tableNum == null
                  && request.resource.data.seatNum == null;
    // self-update: displayName のみ変更可。残りフィールドは immutable。
    // organizer-update: group メンバーなら isBusted / bustedAt / tableNum / seatNum / lastMovedAt を変更可。uid と entryAt は immutable。
    allow update: if isSignedIn()
                  && (
                    (
                      pid == request.auth.uid
                      && resource.data.uid == request.auth.uid
                      && request.resource.data.uid == resource.data.uid
                      && request.resource.data.isBusted == resource.data.isBusted
                      && request.resource.data.entryAt == resource.data.entryAt
                      && request.resource.data.bustedAt == resource.data.bustedAt
                      && request.resource.data.tableNum == resource.data.tableNum
                      && request.resource.data.seatNum == resource.data.seatNum
                      && request.resource.data.lastMovedAt == resource.data.lastMovedAt
                    )
                    ||
                    (
                      exists(/databases/$(database)/documents/tournaments/$(tid))
                      && isGroupMember(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
                      && request.resource.data.uid == resource.data.uid
                      && request.resource.data.entryAt == resource.data.entryAt
                    )
                  );
    allow delete: if isSignedIn()
                  && (
                    pid == request.auth.uid
                    || (
                      exists(/databases/$(database)/documents/tournaments/$(tid))
                      && isGroupMember(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
                    )
                  );
  }
  ```
- **MIRROR**: 既存 rules の二択 OR パターン（`isGroupOwner` 等の分岐例）
- **IMPORTS**: N/A
- **GOTCHA**:
  - `get(/tournaments/{tid})` は rule 評価ごとに read 1 消費。organizer の bust / seat 変更で毎回 1 read。20 人 × 月 1-2 回規模では問題なし（group-membership.md 参照）。
  - tables subcollection への write は既存の `/{sub=**}` catch-all で group メンバーのみ許可済み。追加 rule 不要。
  - **必ず Firebase Emulator でルールテストを実施**してから deploy。
- **VALIDATE**: Firebase Emulator Suite で rules テスト実行（セルフ update は displayName 変更のみ成功、isBusted 変更は拒否されること）。`firebase deploy --only firestore:rules` で本番反映。

### Task 10: Tournament 作成 UI に seatsPerTable を追加

- **ACTION**: `src/components/tournament/TournamentForm.tsx` に入力欄追加
- **IMPLEMENT**: default `9`、range `2〜10`。`zod` で validate、UI は `<input type="number" min={2} max={10}>`。
- **MIRROR**: TournamentForm の既存 structure 選択 UI と同じフォームパターン。
- **IMPORTS**: 既存 schema types
- **GOTCHA**: 10 人未満しか想定しない運用なら 9 で固定運用可能だが、UI は明示的に表示して設定不可能性を防ぐ。
- **VALIDATE**: `/tournaments/new` で seatsPerTable が保存されることを確認。

### Task 11: TimerControls / Dashboard に seating フェーズを実装

- **ACTION**: `src/components/tournament/TimerControls.tsx` と `src/app/tournaments/[tid]/dashboard-client.tsx` を更新
- **IMPLEMENT**:
  - `state === "setup"` のボタンを「席を決定」に変更 → `commitInitialSeating(tid, uid, groupIds, seed, players)` を呼ぶ（seed は `Date.now()` で都度生成）
  - `state === "seating"` のボタンは「トーナメント開始」→ `confirmSeating(...)`
  - Dashboard に `SeatingBoard` と `BalancingInstructionCard` を差し込み、`useSeatingAutoOrchestrator` を呼ぶ
  - `useTournamentTimer` の `autoAdvance` は従来通り（`running` のみ対象）
- **MIRROR**: CLIENT_SIDE_OP_BUTTON_PATTERN
- **IMPORTS**: 新 repo 関数 + orchestrator
- **GOTCHA**: `commitInitialSeating` は subscribe 済みの players 配列を受け取る API。Dashboard は既に PlayerList で subscribe 済みなので、PlayerList から親コールバックで持ち上げる or dashboard で直接 subscribe して両者に配る方針（後者が素直）。
- **VALIDATE**: 手動テスト: 3 人参加させて `setup → seating → 席を決定 → running` の一連のフロー。

### Task 12: Bust ボタン + PlayerList 連携

- **ACTION**: `src/components/tournament/BustButton.tsx` を新規作成、`PlayerList.tsx` から呼び出す
- **IMPLEMENT**:
  ```tsx
  interface Props { tid: string; pid: string; canManage: boolean; busy: boolean; onBusted: () => void; }
  // 単一ボタン UI。busted=true なら「脱落取消」（unbust）
  ```
  PlayerList は `canManage && state !== "setup" && state !== "seating"` のときだけ bust ボタンを表示。
- **MIRROR**: CLIENT_SIDE_OP_BUTTON_PATTERN
- **IMPORTS**: `bustPlayer` / `unbustPlayer`
- **GOTCHA**: バスト後は orchestrator の `applyBalancingOnce` が必要。Dashboard で subscribe の変化を観測して「指示が必要」なら BalancingInstructionCard を出す（Task 13）。
- **VALIDATE**: bust 押下で player doc の `isBusted: true`, `tableNum: null` が反映されることを目視確認。

### Task 13: BalancingInstructionCard + 指示適用ボタン

- **ACTION**: `src/components/tournament/BalancingInstructionCard.tsx` を新規作成
- **IMPLEMENT**:
  - props: `{ tid, uid, userGroupIds, players, tables, seatsPerTable }`
  - 内部で `engine.planTableBreak` → なければ `engine.planBalancingMove` を呼ぶ（純粋関数・毎 render）
  - 結果を「◯◯（A卓B席）を C卓D席へ移動」カードとして表示
  - 「指示完了」ボタンで `applyBalancingOnce(...)` を呼ぶ
  - plan が null なら card 自体を非表示
- **MIRROR**: CLIENT_SIDE_OP_BUTTON_PATTERN
- **IMPORTS**: engine + orchestrator
- **GOTCHA**:
  - 「指示完了」は Firestore への write を伴う。複数運営者が同時押下した場合は orchestrator 側 transaction で 1 件だけ反映される。
  - 「指示完了」を押すと再度 subscribe が発火 → plan を再計算 → 次の move が表示、という連鎖。空になったらカードが消える。
  - **運営者が指示カードを出したまま放置して次の bust が起きると plan の前提が変わる**。毎 render で再計算しているので、自動更新される。
- **VALIDATE**: 架空の 3 卓 × 5/5/2 人でバランスされるまで複数カードが順次出ることを手動テスト。

### Task 14: SeatingBoard 描画

- **ACTION**: `src/components/tournament/SeatingBoard.tsx` を新規作成
- **IMPLEMENT**:
  - props: `{ players, tables, seatsPerTable, currentUid }`
  - 各卓を Card で縦並び（モバイルでも見やすく）
  - 席は `1: 名前` or `1: —` 形式。`currentUid === player.uid` なら `★` 付き
  - `isBroken` が true の卓は薄く表示 + 「閉鎖」バッジ
- **MIRROR**: shadcn Card + Tailwind クラスの既存パターン
- **IMPORTS**: `PlayerDoc` / `TableDoc`
- **GOTCHA**: 参加者側でも同じコンポーネントを使いたいが、`/live` は自席のみにフォーカスするため専用 UI にする（Task 15）。
- **VALIDATE**: 手動確認のみ。

### Task 15: /live に自席 + 移動バナー

- **ACTION**: `src/app/tournaments/[tid]/live/live-client.tsx` を更新
- **IMPLEMENT**:
  - `subscribePlayers(tid, ...)` を追加 → 自分（`useAuthUser().user.uid`）の PlayerDoc を取り出す
  - 自席がある場合: 「卓 N 席 M」を大きく表示
  - `lastMovedAt` から 30 秒以内なら「席が移動しました」バナー（30 秒後に非表示）
  - 自席がない場合: 「席決め待ち中...」/「(レイトエントリー締切超過)」などのメッセージ
- **MIRROR**: /live の既存 ConnectionBadge + TimerDisplay レイアウト
- **IMPORTS**: 既存 + `subscribePlayers`
- **GOTCHA**: **autoAdvance / auto-seat orchestrator を live で呼ばないこと**。参加者はメンバーではないので permission-denied で無駄 write になる。
- **VALIDATE**: 運営者が席を決定 → 参加者スマホに「卓 1 席 3」が即時表示されること。バスト発生 → バランス → 指示完了で移動した参加者に「席が移動しました」バナーが出ること。

### Task 16: Receipt service の late entry hook

- **ACTION**: `src/lib/services/receipt.ts` を軽く更新
- **IMPLEMENT**: late entry の判定（`currentLevel > lateEntryDeadlineLevel`）はクライアントで事前チェックし、締切超過ならエラーを表示（join 自体は許可してしまうと永久未配席になる）。実際の配席は運営者端末の `useSeatingAutoOrchestrator` が担当するため、receipt service 内では何もしない。
- **MIRROR**: 既存 receipt flow
- **IMPORTS**: 変更なし
- **GOTCHA**: 締切判定は **クライアント** で行うと bypass 可能。Phase 5 のフィードバック次第で rule 側の `currentLevel` 参照を検討する（ただし rule 側 read quota が膨らむため現段階では client 警告のみで可）。
- **VALIDATE**: 締切超過後の join は警告メッセージが出ることを手動確認。

### Task 17: 既存テストの修正 + 新規テスト

- **ACTION**: 以下のテストファイルを追加 / 更新
  - `engine.test.ts`（新規・網羅テスト）
  - `orchestrator.test.ts`（新規・transaction mock）
  - `tables.test.ts`（新規・簡易 CRUD）
  - `players.test.ts`（新規・bust / seat assign）
  - `tournaments.test.ts`（更新・`beginSeating` / `confirmSeating` 追加、`startTournament` 関連テスト削除）
- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: vitest / firebase/firestore mock
- **GOTCHA**: engine テストは Firestore を一切 mock せず pure data に対する test を書く（`PlayerDoc` の fixture を最小限に作る）。
- **VALIDATE**: `npm test` で全テストが pass。既存 Phase 3 テストも regression なく pass。

### Task 18: Firebase Emulator での rule テスト

- **ACTION**: 既存テストが Emulator を使っていない場合は新規セットアップは不要。必要なら手動で Firebase Emulator Suite を起動し、`@firebase/rules-unit-testing` で rule テストを書いて playerUpdate の二分岐を確認する。
- **IMPLEMENT**:
  ```typescript
  // rules-test/players.rules.test.ts（新規、ただし Phase 4 のスコープで無理なら実装レポートで Phase 5 送り）
  ```
- **MIRROR**: N/A（新規パターン）
- **IMPORTS**: `@firebase/rules-unit-testing`
- **GOTCHA**: Phase 2.5 以前でも rule 変更は手動確認のみの歴史がある。**Phase 4 は rule の複雑度が上がる（OR 分岐）ため、最低限以下の手動シナリオを実施してから deploy する**:
  1. 非 group メンバーが他人の player doc を update → 拒否
  2. 本人が isBusted を変更 → 拒否
  3. 本人が displayName のみ変更 → 許可
  4. group メンバーが他人の isBusted を変更 → 許可
  5. group メンバーが他人の uid を変更しようとする → 拒否
- **VALIDATE**: Emulator テスト通過 or 手動テスト記録を実装レポートに追記。

---

## Testing Strategy

### Unit Tests

| Test ケース                                                     | Input                                                                                              | Expected Output                                                            | Edge Case?            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | --------------------- |
| `planInitialSeating` - 18 人 × 9 席 = 2 卓                     | 18 active players, seatsPerTable=9                                                                 | 各卓 9 人、tableNums = [1,2]                                                | No                    |
| `planInitialSeating` - 20 人 × 9 席                           | 20 active players                                                                                  | 3 卓、7+7+6 分配                                                           | No                    |
| `planInitialSeating` - 同 seed で 2 回 → 同結果                | seed=42                                                                                            | 配列が identical                                                           | Yes（再現性）         |
| `planInitialSeating` - 0 人                                  | []                                                                                                 | { assignments: [], tableNums: [] }                                          | Yes（空）              |
| `planInitialSeating` - 55 人 × 9 席                           | 55 active players                                                                                  | `throw Error("tables exceed max: 7 > 6")`                                   | Yes（MAX 超過）        |
| `planLateEntrySeat` - 最小卓に席                              | 卓 1: 3 人 / 卓 2: 5 人                                                                            | `{ tableNum: 1, seatNum: ?最小空席? }`                                     | No                    |
| `planLateEntrySeat` - 同数の場合は tableNum 昇順              | 卓 1: 5 人 / 卓 2: 5 人（空席あり）                                                                | `{ tableNum: 1, seatNum: ?最小空席? }`                                     | Yes                   |
| `planLateEntrySeat` - 全席埋め                               | 全卓 seatsPerTable 人                                                                              | null                                                                       | Yes                   |
| `planLateEntrySeat` - broken 卓は skip                        | 卓 1(broken, 0 人) / 卓 2(空席あり)                                                                | 卓 2                                                                      | Yes                   |
| `planBalancingMove` - 差 2                                  | 卓 1: 7 人 / 卓 2: 5 人                                                                            | 卓 1 の最小席番号プレイヤーを卓 2 最小空席へ                                | No                    |
| `planBalancingMove` - 差 1                                  | 卓 1: 6 / 卓 2: 5                                                                                  | null                                                                       | Yes（発動しない）       |
| `planBalancingMove` - 差 4                                  | 卓 1: 9 / 卓 2: 5                                                                                  | 1 件のみ（次回再評価で追加）                                                 | Yes（段階適用）        |
| `planTableBreak` - 可能                                     | 卓 1: 3 / 卓 2: 5 / 卓 3: 2 (seatsPerTable=9)                                                     | `brokenTableNum: 3`（最少・同数なら tableNum 最大）、移動指示 2 件          | No                    |
| `planTableBreak` - 不可                                     | 卓 1: 9 / 卓 2: 9                                                                                  | null                                                                       | Yes                   |
| `planTableBreak` - 1 卓のみ                                 | 卓 1: 3 人                                                                                          | null（閉じる対象なし）                                                      | Yes                   |
| `commitInitialSeating` - state != setup/seating             | state=running                                                                                       | AppError("tournament/invalid-state")                                       | Yes                   |
| `commitInitialSeating` - 非 group メンバー                   | userGroupIds = ["other"]                                                                           | AppError("firestore/permission-denied")                                    | Yes                   |
| `autoSeatLateEntry` - race（既に他端末が配席済み）              | expected=null, actual=`{tableNum: 1}`                                                              | no-op                                                                      | Yes                   |
| `bustPlayer` - 正常                                           | valid pid                                                                                          | update payload に isBusted=true, tableNum=null, seatNum=null                | No                    |
| `beginSeating` - state != setup                                | state=running                                                                                      | AppError("tournament/invalid-state")                                       | Yes                   |
| `confirmSeating` - state != seating                            | state=setup                                                                                        | AppError("tournament/invalid-state")                                       | Yes                   |

### Edge Cases Checklist

- [ ] 0 人で初回席決め（何も起きない）
- [ ] 7 人以上 × 1 卓の設定（seatsPerTable=6 で 7 人 → 2 卓）
- [ ] MAX_TABLES=6 超過（人数 × seatsPerTable 超え）
- [ ] 2 人同時バストでバランス重複計算（毎 subscribe で再評価、最終状態は整合）
- [ ] 2 運営者端末の同時「指示完了」（transaction guard で 1 回のみ反映）
- [ ] 2 運営者端末の同時 late entry auto-seat（transaction guard で重複配席しない）
- [ ] 締切 lv 超過の join（手動確認）
- [ ] seating フェーズで新規 join（tableNum: null のまま、confirmSeating までは初回席決めに取り込まれない）— **設計判断: seating 中の新規 join は次回の「席を決定」まで待機させる**
- [ ] 全員バストで 1 人のみ残る（1 卓 1 席、trivial）
- [ ] setup で削除可能（既存挙動 `deleteTournamentIfSetup` は不変）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors。新規 schema フィールド（tableNum, seatNum, seatsPerTable, lastMovedAt）が全消費点で正しく扱われていること。

```bash
npm run lint
```

EXPECT: Zero warnings。`console.*` の残置・AppError 未ラップなどが lint ルールで検出される前提（`.claude/rules/error-logging.md` 参照）。

### Unit Tests

```bash
npm test
```

EXPECT: 以下のテストスイートが全 pass
- `engine.test.ts`（新規・TDA ルール網羅）
- `orchestrator.test.ts`（新規・transaction mock）
- `tables.test.ts`（新規）
- `players.test.ts`（新規）
- `tournaments.test.ts`（更新・`beginSeating` / `confirmSeating` カバレッジ）
- 既存 Phase 3 テストに regression なし

### Full Test Suite

```bash
npm test && npm run typecheck && npm run lint
```

EXPECT: 全通過。

### Rules Validation

```bash
# Firebase Emulator（任意）
firebase emulators:start --only firestore

# 本番反映（手動テストで問題ないことを確認してから）
firebase deploy --only firestore:rules
```

EXPECT: rule deploy に失敗しない。本番に反映後、Firestore Rules Playground で以下を手動確認:
1. 非 group メンバーが他人の player.isBusted を変更 → 拒否
2. 本人が自分の player.isBusted を true に変更 → 拒否
3. 本人が自分の player.displayName を変更 → 許可
4. group メンバーが他人の player.tableNum を変更 → 許可
5. group メンバーが他人の player.uid を変更しようとする → 拒否

### Browser Validation

```bash
npm run dev
```

EXPECT: 以下のシナリオを手動で実行:

- [ ] **シナリオ A: 初回席決め**
  1. 運営者がトーナメント作成（seatsPerTable=9）
  2. 参加者 3 人が QR から join
  3. ダッシュボードで「席を決定」→ `seating` フェーズに遷移、SeatingBoard で 1 卓 × 3 席に着座
  4. 「開始」→ `running`、タイマー開始
- [ ] **シナリオ B: レイトエントリー自動配席**
  1. A の続き、Lv2 で参加者 4 人目が join
  2. 運営者ダッシュボードで自動的に卓 1 の空席に配席される
  3. 参加者スマホに「卓 1 席 X」が表示される
- [ ] **シナリオ C: バスト + バランシング**
  1. 20 人 × 3 卓（各 7/7/6）で開始
  2. 卓 1 で 1 人バスト（6/7/6）→ バランシング不要
  3. 卓 2 で 2 人連続バスト（6/5/6）→ バランシング不要
  4. 卓 1 で 1 人バスト（5/5/6）→ バランシング発動、卓 3 の最小席番号を卓 1 or 2 の空席へ
  5. 「指示完了」押下で移動反映、参加者スマホに「席が移動しました」バナー
- [ ] **シナリオ D: テーブル閉鎖**
  1. 18 人 × 2 卓で開始
  2. 10 人バスト（8 人 = 1 卓分）→ 2 卓のうち 1 卓が閉鎖、残存者が全員 1 卓に集約
  3. 指示カードが 1 件ずつ順次表示され、運営者が全指示完了

### Manual Validation

- [ ] `/tournaments/new` で seatsPerTable 入力欄が default 9
- [ ] setup → seating 遷移で UI が切り替わる
- [ ] seating → running 遷移でタイマー起動
- [ ] バストボタンは running / paused でのみ表示
- [ ] バスト取消ボタンで isBusted を false に戻せる（席は復旧しない仕様で OK）
- [ ] /live で自席表示 + 移動バナー（30 秒以内）
- [ ] 運営者が 2 ブラウザで同時に「指示完了」→ 一方が race guard で no-op されログに `skipped (race)` が出る
- [ ] 締切超過の join で適切なエラーメッセージ
- [ ] 画面を全画面表示（`/live`）にしても自席情報が読める
- [ ] モバイル（幅 320px）で SeatingBoard が見切れない

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation commands 通過
- [ ] engine の unit test がすべての Edge Case をカバー
- [ ] type error 0 / lint warning 0
- [ ] シナリオ A〜D が実端末で手動成功
- [ ] Phase 3 の既存機能（タイマー・接続切断 UI・/live）に regression なし
- [ ] PRD の Phase 4 Success signal（「架空の 20 人・3 テーブルトーナメントで、バスト発生 → バランス指示が TDA ルール通りに算出され、進行中の新規参加も自動配席」）を満たす

## Completion Checklist

- [ ] 全コードが発見済みパターン（NAMING / ERROR_HANDLING / LOGGING / REPOSITORY / TRANSACTION / CLIENT_OP / TEST / ZOD_CONVERTER）に従っている
- [ ] `try/catch` で Firestore 例外を必ず `AppError.from(e, "firestore/...", 日本語)` にラップ
- [ ] `console.*` 直接呼び出し 0（`logger` 経由のみ）
- [ ] 新規 schema は `*BodySchema` + `*Body` + `*Doc` の三段定義
- [ ] 新規 collection は `zodConverter` を通して withConverter 適用
- [ ] 新規 subscribe 系 repo 関数は `(onNext, onError) => unsubscribe` を返す
- [ ] 運営者端末専用の write hook（`useSeatingAutoOrchestrator`）は参加者 /live から呼ばれない
- [ ] runTransaction + optimistic guard を全 race 箇所で実装
- [ ] TDA 2015 ルールとの差分（BB 次 → 席番号最小で近似）がコード内コメントで明示されている
- [ ] firestore.rules の変更は Firebase Emulator or Playground で手動検証済み
- [ ] 実装レポート（`.claude/PRPs/reports/phase-4-seating-automation-report.md`）を書く

## Risks

| Risk                                                                                   | Likelihood | Impact | Mitigation                                                                                                                                                                     |
| -------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 複数運営者端末の race による座席の重複 / 衝突                                           | M          | H      | orchestrator 内で `runTransaction` + `player.lastMovedAt`/`tournament.state` の guard を全書込で実装。no-op 時は info ログ                                                         |
| engine の TDA ルール解釈ミス（特に table break 判定）                                     | M          | M      | engine を pure function 化し、10+ ケースの unit test で網羅。PRD の Success signal（20 人・3 卓シナリオ）を手動で再現                                                             |
| Firestore rule の organizer update パスが過剰権限（uid / entryAt 書換えなど）           | M          | H      | rule で `request.resource.data.uid == resource.data.uid` / `entryAt` 不変を明示。Firebase Emulator で最低 5 シナリオ手動確認                                                      |
| 既存データ（tableNum を持たない player doc）が zod validate 失敗で一覧欠落              | H          | M      | Phase 2.5 と同じ破壊的移行方針。運用中データは実装レポートに手動削除手順を記載。listPlayers は Phase 3 で導入した doc-skip ガードで保険 → Phase 4 で同じガードを subscribe にも入れる |
| 参加者スマホで `lastMovedAt` 直後に subscribe が遅れて「移動しました」バナーが表示されない | L          | L      | Firestore の reactive な onSnapshot で通常は 1 秒以内に届く。遅延時は次 tick で復旧するので致命ではない                                                                             |
| 「指示完了」ボタンの多重押下で複数 move が走る                                         | L          | M      | CLIENT_SIDE_OP_BUTTON_PATTERN の busy state + orchestrator 側の transaction guard の 2 段防衛                                                                                  |
| MAX_TABLES=6 超過を実運用で踏む（20 人 × 3 席の設定等）                                  | L          | M      | engine から Error throw、UI でわかりやすく日本語エラー表示。create 時も seatsPerTable の下限を 4 にするかは UX 判断（ここでは下限 2）                                              |
| `get(/tournaments/{tid})` の rule read が増えて quota を圧迫                              | L          | L      | 20 人 × 月 1-2 回なら 1 日あたり数百 read 程度で 50K 上限に遠い。Cloud Functions 化は v2+                                                                                          |
| BB 次の近似（席番号最小）が運用で不公平感を招く                                           | L          | L      | PRD 合意済みの近似。Phase 5 のフィードバック次第でボタン位置トラッキングを検討                                                                                                     |

## Notes

- **seating フェーズ中の新規 join の扱い**: PRD は明示していないが、本計画では「seating 中は新規 join を許容するが、次回の『席を決定』まで配席されない」仕様にする。運営者は参加者の揃いを待って「席を決定」を押す流れ。これは PRD のクリティカルパス「4. 参加者の登録が揃ったら運営者が『席を決定』操作」と合致する。
- **Phase 3 の `startTournament` は削除する**: `setup → running` の直接遷移は無くなる。`beginSeating → commitInitialSeating → confirmSeating` の 3 ステップパイプラインに置換する（現実には UI 上は「席を決定」→「開始」の 2 ボタン）。
- **バスト取消（unbust）の席復旧は Phase 4 では作らない**: 運営者の誤操作リカバリとして `isBusted: false` 戻しは提供するが、自動再配席はしない。再配席したい場合は次の late entry 扱いで手動 re-join を推奨。この挙動は日本語 UX で「バスト取消（席は自動復旧しません）」と明記する。
- **`events` サブコレクションは v1 では作らない**: PRD の初期データモデルに含まれていたが、Phase 4 では不要（プレイヤー doc の状態フィールドで十分）。Phase 5 以降で監査ログが必要になった時点で導入する。
- **TDA 2015 v1.0 の入手困難**: 公式 PDF の URL は PRD に記載済み。内容はオンラインで広く引用されているため、主要ルール（Rule 40 系：テーブルバランシング、Rule 42 系：テーブル閉鎖）は十分公知。PDF 参照不可なら PokerStars / WSOP の公開ルールで代替可（本質は同じ）。
- **seed を `Date.now()` にする根拠**: v1 は「再現性のあるテスト用 seed」と「本番では予測不能な seed」の両方を求める。engine は seed を引数で受け取る pure 関数なので、本番では `Date.now()` をそのまま渡せば十分。将来 crypto.getRandomValues に切替える場合も engine 側を変えない。
- **Phase 3 の `listTournamentsByGroup` の doc-skip ガード**: `subscribePlayers` / `subscribeTables` でも同ガードを入れるかは設計判断。Phase 4 では入れずに、zodConverter の throw をそのまま error callback に流す（Phase 3 と同等の挙動）。実運用で問題が出れば Phase 5 でガード追加を検討。
- **Firestore index**: 現在の query は `orderBy("tableNum", "asc")` など単純なので複合インデックス不要。将来 `where("isBusted","==",false) + orderBy("tableNum")` のような複合 query を入れる場合は別途 `firestore.indexes.json` 更新が必要（Phase 5 以降の判断）。
