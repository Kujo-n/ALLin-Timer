# Plan: Phase 3 — Timer & Realtime & Viewer

## Summary

トーナメント進行のコア体験である「サーバ時刻基準のタイマー」と「全端末リアルタイム同期」を実装する。具体的には (1) `tournaments/{tid}` にタイマー駆動用フィールド（`levelStartedAt` / `pausedAt` / `pausedAccumMs` / `finishedAt`）を追加、(2) `state` 遷移を操作する repository 関数（pause / resume / advance / revert / finish）、(3) `onSnapshot` ベースの tournament 購読 hook（接続状態も expose）、(4) 現在レベル／残り時間をサーバ時刻から **derive** するロジック、(5) 運営者ダッシュボードに開始／一時停止／再開／次レベル／前レベル／終了コントロール、(6) 参加者向け大型タイマー表示の `/tournaments/[tid]/live` ページ、(7) 接続切断時 UI（最終同期時刻＋「接続切れ」バッジ）、(8) Firestore オフライン永続化の有効化、(9) `PlayerList` の onSnapshot 化 を作る。

## User Story

As a ポーカーサークルの運営者・参加者全員,
I want トーナメント中の「現在レベル・SB/BB/Ante・残り時間・次レベル予告」を、自分の端末（PC／スマホ）で常にリアルタイム表示し、運営者 3 人の誰からでも開始／一時停止／レベル送り戻しを操作できるようにしたい,
So that プレイングディーラーがハンド中でも誰も PC を覗き込まずにレベルを把握でき、ネット瞬断があっても「接続切れ」と直前状態が明示されるため誤情報で混乱しない。

## Problem → Solution

**現状（Phase 2.5 完了時点）**: `tournaments/{tid}` は `state` / `startedAt` / `currentLevel` / `lateEntryDeadlineLevel` しか持たず、`startTournament` は `state=running` と `currentLevel=1` を書くだけ。タイマーも表示画面も無い。`dashboard-client.tsx` の「開始」ダイアログにも「タイマーやレベル自動繰り上げは未実装（Phase 3 で追加予定）」と明記されている。`PlayerList` も手動リロードのまま。

**目標状態**:

- `startedAt` と `levelStartedAt`（その level が開始したサーバ時刻）を真実源にして、クライアントは `Date.now() - levelStartedAt.toMillis() - pausedAccumMs` で残り時間を計算する。DB への毎秒書き込みは行わない。
- pause / resume / advance / revert は運営者（= group メンバー）が書込トリガ。`state` を `running` / `paused` / `finished` に遷移させる。
- auto-advance は「最初に elapsed が duration を超えたクライアント」が Firestore transaction で `currentLevel += 1` + `levelStartedAt = serverTimestamp` を atomic に書き、複数運営者端末の race を guard（`currentLevel == expected` チェック）で解決する。
- `onSnapshot(..., { includeMetadataChanges: true })` で購読し、`snap.metadata.fromCache` を監視。切断時は `接続切れ・最終同期 hh:mm:ss` を画面上部に表示しつつ、ローカルキャッシュの state でタイマーを継続表示する。
- `/tournaments/[tid]/live` は大型文字・モバイル縦長表示に最適化した read-only ビュー。運営者 / 参加者どちらも同じ画面。
- `PlayerList` も `onSnapshot` で常時最新化する（手動リロードボタンは残すが通常不要）。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 3 — Timer & Realtime & Viewer
- **Dependencies**: Phase 2.5（complete）
- **Parallelizable with**: Phase 4 — Seating Automation（スキーマの共存は想定。同時編集する場合は互いの field を踏まないこと）
- **Blocks**: Phase 5 — Field Test & Polish
- **Estimated Files**: 20〜25（schema / repository / service / hook / page / component / rules / test）

---

## UX Design

### Before

```
┌──────────────────────────────────────────────────┐
│ /tournaments/[tid]   （運営者ダッシュボード）   │
│   [開始] ダイアログ → state=running、以上。     │
│   タイマー表示なし、残り時間の概念なし。        │
│   参加者は /join/[tid] で受付完了画面で停止。   │
│   レベル送り／戻しなし、「一時停止」なし。      │
│   PlayerList は手動「リロード」ボタン操作のみ。 │
└──────────────────────────────────────────────────┘
```

### After

```
┌────────────────────────────────────────────────────────────────────┐
│ /tournaments/[tid]   （運営者ダッシュボード）                      │
│  ┌─ 接続状態バー ─────────────────────────────────┐               │
│  │ ● 同期中 hh:mm:ss       /  ⛔ 接続切れ hh:mm   │               │
│  └─────────────────────────────────────────────────┘               │
│                                                                    │
│  [  Lv 3  ]   SB 100 / BB 200 / Ante 25                            │
│  ┌──────────────────────┐                                          │
│  │     12:34            │ ← 大型タイマー（残り分秒）              │
│  └──────────────────────┘                                          │
│  次レベル: Lv 4 (200 / 400)                                        │
│                                                                    │
│  [開始] [一時停止/再開] [◀ 前レベル] [次レベル ▶] [終了]            │
│                                                                    │
│  PlayerList（onSnapshot 自動更新）                                 │
│                                                                    │
│  [タイマーを全画面表示] → /tournaments/[tid]/live                 │
└────────────────────────────────────────────────────────────────────┘

┌────────────────────────────────────────────────────────────────────┐
│ /tournaments/[tid]/live  （read-only / モバイル最適化）            │
│  接続状態バッジ                                                    │
│                                                                    │
│  Lv 3 (残り 12:34)                                                 │
│   SB 100 / BB 200 / Ante 25                                        │
│   次: Lv 4 (200/400)                                               │
│                                                                    │
│  （Phase 4 で追加: あなたの席番号、移動指示）                      │
└────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint                 | Before                         | After                                                              | Notes                                                                 |
| -------------------------- | ------------------------------ | ------------------------------------------------------------------ | --------------------------------------------------------------------- |
| 運営者ダッシュボード       | 状態バッジ＋静的スナップショット | 大型タイマー＋レベル情報＋操作ボタン（一時停止／前後レベル／終了） | 1 秒刻みで derive。DB 書込は遷移時のみ                               |
| 参加者画面                 | 受付完了画面で停止             | `/tournaments/[tid]/live` にリダイレクト or リンクで誘導           | 既存の join-client 成功画面に「タイマー画面へ」ボタンを追加する       |
| リロード                   | PlayerList に手動リロード必要  | onSnapshot で自動更新（手動ボタンは残置）                          | 反映 ≦ 1 秒                                                           |
| ネット切断                 | 無表示                         | 画面上部に「⛔ 接続切れ hh:mm:ss」、タイマーはキャッシュ値継続表示 | `snap.metadata.fromCache` 監視、再接続後に自動再同期                  |
| 全画面タイマー             | なし                           | `/tournaments/[tid]/live` 読み取り専用                             | プロジェクター／参加者共有用                                          |
| pause / resume             | なし                           | 運営者が押すと `state=paused` / `running`、残り時間は止まる         | `pausedAccumMs` に累積。`levelStartedAt` は resume 時にシフト補正     |
| 手動レベル変更             | なし                           | 「前レベル」「次レベル」ボタンで即時遷移                           | `levelStartedAt = serverTimestamp()` で再起                          |
| 自動レベル繰り上げ         | なし                           | 残りが 0 に達したクライアントが transaction で次レベルへ           | `currentLevel == expected` guard で race 解決                         |

---

## Mandatory Reading

実装着手前に必ず読むファイル。記憶に頼らず毎回 Read で現物確認する。

| Priority | File                                                                                                              | Lines | Why                                                                                                                           |
| -------- | ----------------------------------------------------------------------------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------- |
| P0       | [CLAUDE.md](../../../CLAUDE.md)                                                                                   | 全体  | プロジェクト全体規約・日本語応答・ルール参照義務                                                                              |
| P0       | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md)                                            | 全体  | singleton／`useAuthUser`／`zodConverter`／repositories 層／deny-by-default／`get()` による read quota 消費への注意             |
| P0       | [.claude/rules/error-logging.md](../../rules/error-logging.md)                                                    | 全体  | `AppError` ラップ・ドメインコード命名・`logger` 経由・握りつぶし禁止                                                          |
| P0       | [.claude/rules/group-membership.md](../../rules/group-membership.md)                                              | 全体  | group 権限モデル・write は `isGroupMember(resource.data.groupId)`                                                             |
| P0       | [.claude/rules/security.md](../../rules/security.md)                                                              | 全体  | `.env.local` 管理、サークル固有情報の Firestore 限定保存                                                                      |
| P0       | [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)                                                | 199-296 | Implementation Phases / Phase 3 scope / Parallelism Notes                                                                   |
| P0       | [src/lib/firebase/client.ts](../../../src/lib/firebase/client.ts)                                                 | 1-52  | `firestore` / `firebaseAuth` singleton。オフライン永続化は `initializeFirestore` に置き換え（SSR ガード必須）                 |
| P0       | [src/lib/firebase/AuthProvider.tsx](../../../src/lib/firebase/AuthProvider.tsx)                                   | 1-37  | Context Provider パターン（`useTournamentTimer` は hook として踏襲）                                                         |
| P0       | [src/lib/firebase/converters.ts](../../../src/lib/firebase/converters.ts)                                         | 1-40  | `zodConverter(schema, collectionName)` で withConverter 適用                                                                  |
| P0       | [src/lib/errors.ts](../../../src/lib/errors.ts)                                                                   | 1-17  | `AppError` 構造 / `AppError.from()` の pass-through                                                                           |
| P0       | [src/lib/logger.ts](../../../src/lib/logger.ts)                                                                   | 1-45  | `logger.info / warn / error`。`console` 直呼び禁止                                                                            |
| P0       | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts)                          | 1-50  | 現行 `tournamentBodySchema`（`levelStartedAt` / `pausedAt` / `pausedAccumMs` / `finishedAt` を追加する対象）                    |
| P0       | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts)             | 1-152 | 現行 CRUD＋`startTournament`（`levelStartedAt` 書込を追加・pause 等の新関数はこれを踏襲）                                     |
| P0       | [src/lib/firebase/repositories/players.ts](../../../src/lib/firebase/repositories/players.ts)                      | 1-94  | players repository に `subscribePlayers(tid, cb)` を追加するための既存パターン                                                 |
| P0       | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx)         | 1-233 | 既存ダッシュボード UI。purely snapshot な `getTournament` + `setData` を onSnapshot に置換                                    |
| P0       | [src/components/tournament/PlayerList.tsx](../../../src/components/tournament/PlayerList.tsx)                     | 1-153 | `listPlayers` 呼出を `subscribePlayers` に置換                                                                                |
| P0       | [firestore.rules](../../../firestore.rules)                                                                       | 全体  | `tournaments` update は group メンバー。state 遷移での特別扱いは不要（group メンバーは state を自由に変更可）                 |
| P1       | [src/app/tournaments/[tid]/page.tsx](../../../src/app/tournaments/[tid]/page.tsx)                                 | 1-12  | `RequireAuth` で囲むパターン。`/live` ページもこれを踏襲                                                                      |
| P1       | [src/app/join/[tid]/join-client.tsx](../../../src/app/join/[tid]/join-client.tsx)                                 | 180-237 | 受付成功画面。「タイマー画面へ」ボタンを追加して `/tournaments/[tid]/live` に誘導                                             |
| P1       | [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts)                         | 1-230 | schema テストの配置と命名（`tournamentBodySchema` に新フィールドの test を追加）                                              |
| P1       | [src/lib/services/receipt.test.ts](../../../src/lib/services/receipt.test.ts)                                     | 1-80  | `vi.hoisted` + `vi.mock` のサービステストパターン（`timer.ts` / `timer.test.ts` を書く際のテンプレ）                          |
| P1       | [src/lib/services/group.ts](../../../src/lib/services/group.ts)                                                   | 85-112 | `runTransaction(firestore, async (tx) => { ... })` の具体例（auto-advance にほぼそのまま流用）                                |
| P1       | [src/components/ui/button.tsx](../../../src/components/ui/button.tsx) / [card.tsx](../../../src/components/ui/card.tsx) / [dialog.tsx](../../../src/components/ui/dialog.tsx) | 全体 | 既存 shadcn 部品。タイマー UI もこの上に組む                                                                                 |
| P2       | [src/lib/services/current-group.tsx](../../../src/lib/services/current-group.tsx)                                 | 全体  | Context + hook 構成の参考（`TimerProvider` は作らず hook として暫定実装だが、将来共有化時の参考）                             |
| P2       | [.claude/PRPs/plans/completed/phase-2.5-group-management.plan.md](completed/phase-2.5-group-management.plan.md)   | 全体  | 直前フェーズの設計意図・rule の書き換えパターン                                                                               |
| P2       | [package.json](../../../package.json)                                                                             | 1-55  | `firebase ^11.1.0` / `zod ^4.3.6` / `vitest ^2.1.8` 依存確認。新規追加は不要                                                  |
| P2       | [firestore.indexes.json](../../../firestore.indexes.json)                                                         | 全体  | 複合インデックス未使用。Phase 3 でも追加しない（`tournaments/{tid}` の direct read / subscribe のみ）                          |

## External Documentation

| Topic                                          | Source                                                                                                          | Key Takeaway                                                                                                                                                                          |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore — `onSnapshot`（Web v9）              | https://firebase.google.com/docs/firestore/query-data/listen                                                    | `onSnapshot(ref, options, onNext, onError)` で購読。`return unsubscribe()` を useEffect cleanup で呼ぶ。`includeMetadataChanges: true` で metadata-only 変更も流す                      |
| Firestore — `SnapshotMetadata.fromCache`       | https://firebase.google.com/docs/reference/js/firestore_.snapshotmetadata#snapshotmetadatafromcache             | `snap.metadata.fromCache === true` は server から最新取得できていない（= キャッシュ or 切断中）。接続状態 UI の判定に使う                                                              |
| Firestore — オフライン永続化（Web v9 persistentLocalCache）| https://firebase.google.com/docs/firestore/manage-data/enable-offline                                            | `initializeFirestore(app, { localCache: persistentLocalCache() })`。**getFirestore の前に 1 回だけ呼ぶ**。タブ間共有は `persistentMultipleTabManager`                                  |
| Firestore — Transactions（client）              | https://firebase.google.com/docs/firestore/manage-data/transactions#web-version-9                               | `runTransaction(firestore, async tx => { const s = await tx.get(ref); tx.update(ref, { ... }) })`。条件分岐で auto-advance の guard に使う                                            |
| Firestore — Server Timestamps                  | https://firebase.google.com/docs/firestore/manage-data/add-data#server_timestamp                                | `serverTimestamp()` は `FieldValue` として書込。**read 後に `Timestamp` オブジェクトとして戻る**。ローカル書込直後は pending-write 中の cached snapshot に `null` が現れ得る          |
| Next.js App Router — ダイナミックルート         | https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes                                    | `app/tournaments/[tid]/live/page.tsx` の `params: Promise<{ tid: string }>`                                                                                                          |
| Next.js — Viewport（モバイル最適化）            | https://nextjs.org/docs/app/api-reference/functions/generate-viewport                                           | `/live` は `export const viewport: Viewport = { themeColor, width: "device-width" }` で DPR 最適化                                                                                     |
| `window.visibilityState` / `requestAnimationFrame` | https://developer.mozilla.org/en-US/docs/Web/API/Document/visibilityState                                       | バックグラウンドタブで `setInterval` が throttled になるため、タブ復帰時に残り時間を `Date.now()` から再計算すれば補正できる                                                           |

**Research Findings**

```
KEY_INSIGHT: Firestore の onSnapshot は `includeMetadataChanges: true` を付けないと metadata-only の変更（fromCache → hasPendingWrites → fromCache=false）を通知しない。接続状態の UI を出すなら必須。
APPLIES_TO: subscribeTournament, subscribePlayers
GOTCHA: metadata 変更だけでも onNext が呼ばれるため、コンポーネント側で doc data の shallow compare 不要でも過剰 re-render しないよう注意。hook 内で `setTournament` は旧値と等価な場合の guard を入れる。

KEY_INSIGHT: serverTimestamp() は書込直後、ローカル cache 上で `null` として見える時間窓がある（pending-writes）。Timer 計算で `levelStartedAt === null` 分岐が必要。
APPLIES_TO: useTournamentTimer
GOTCHA: `null` のときは「直前の local 書込時刻」（= `Date.now()` at 書込）を optimistic に使うか、UI 上「同期中…」を出す。本 Plan は後者で進める。

KEY_INSIGHT: 複数運営者端末が同時に auto-advance するリスクがある。transaction で `currentLevel == expected` を guard すると、2 番目以降の書込は失敗 → logger.warn で観測可。
APPLIES_TO: advanceLevel (auto path)
GOTCHA: transaction 中の get/update は Firestore rules 評価で `get()` が rule 内で走るため read quota を 1-2 件消費する。20 人 × 月 1-2 回規模では無視可（group-membership.md の記述と一致）。

KEY_INSIGHT: Firestore `persistentLocalCache()` は 1 回 initializeFirestore を呼ばないと無効化される。既存 `getFirestore(firebaseApp)` を置き換える必要あり。SSR 上での呼び出しを避けるため `typeof window !== "undefined"` ガードは維持する。
APPLIES_TO: src/lib/firebase/client.ts
GOTCHA: `getFirestore` を既に呼んでいるコードが在ると `initializeFirestore` で FirebaseError が出る。client.ts 内で 1 本化されているので置換は容易。
```

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/firebase/schemas/tournament.ts:6-33
// body schema は「id を含まない」、UI 用 Doc = Body & { id: string }
export const tournamentStateSchema = z.enum(["setup", "seating", "running", "paused", "finished"]);
export const tournamentBodySchema = z.object({
  groupId: z.string().min(1),
  createdByUid: z.string().min(1),
  name: z.string().min(1),
  structureSnapshot: structureSnapshotSchema,
  state: tournamentStateSchema,
  startedAt: z.instanceof(Timestamp).nullable(),
  currentLevel: z.number().int().nonnegative(),
  lateEntryDeadlineLevel: z.number().int().positive(),
  createdAt: z.instanceof(Timestamp),
  updatedAt: z.instanceof(Timestamp),
});
export type TournamentDoc = TournamentBody & { id: string };
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:104-128
// 権限プリチェックを userGroupIds で早期失敗、最終担保は Firestore rules。
// 失敗は必ず AppError.from(e, "firestore/...", 日本語メッセージ) でラップ。
export async function startTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await getTournament(tid);
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError("このトーナメントは既に開始されています", "tournament/already-started");
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "running",
      startedAt: serverTimestamp(),
      currentLevel: 1,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament start ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント開始に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:43, 90, 123
logger.info("tournament create ok", { tid: ref.id, gid: input.groupId });
logger.info("tournament update ok", { tid });
logger.info("tournament start ok", { tid, uid });
// 失敗は warn、fatal なら error。payload は Record<string, unknown>。
logger.warn(wrapped.message, { code: wrapped.code, tid });
```

### REPOSITORY_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:25-27 + 52-64
const tournamentsRef = collection(firestore, "tournaments").withConverter(
  zodConverter(tournamentBodySchema, "tournaments"),
);

export async function getTournament(tid: string): Promise<TournamentDoc> {
  try {
    const snap = await getDoc(doc(tournamentsRef, tid));
    if (!snap.exists()) {
      throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
    }
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "トーナメント取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}
```

### SUBSCRIBE_PATTERN（新規・Phase 3 で追加）

```ts
// 新規に書くコード。スタイルは既存 CRUD の try/catch ラップを踏襲しつつ、
// onSnapshot は cleanup 関数（unsubscribe）を返すため async ではない。
//
// - onNext: 正常 snapshot（metadata 含む）
// - onError: FirebaseError / zod 変換失敗（AppError("firestore/invalid-data")）
// - useEffect からの呼出で unsubscribe を cleanup で呼ぶ
//
// 返り値は unsubscribe 関数（呼び出し側で cleanup）。
import { onSnapshot } from "firebase/firestore";

export function subscribeTournament(
  tid: string,
  onNext: (snap: { doc: TournamentDoc | null; fromCache: boolean; hasPendingWrites: boolean }) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    doc(tournamentsRef, tid),
    { includeMetadataChanges: true },
    (snap) => {
      try {
        if (!snap.exists()) {
          onNext({ doc: null, fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites });
          return;
        }
        onNext({
          doc: { id: snap.id, ...snap.data() },
          fromCache: snap.metadata.fromCache,
          hasPendingWrites: snap.metadata.hasPendingWrites,
        });
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "トーナメントデータが不正です"));
      }
    },
    (err) => {
      onError(AppError.from(err, "firestore/subscribe_failed", "購読エラー"));
    },
  );
}
```

### SERVICE_PATTERN

```ts
// SOURCE: src/lib/services/group.ts:85-107
// runTransaction の使い方。auto-advance の guard もこの形を踏襲。
await runTransaction(firestore, async (tx) => {
  const codeSnap = await tx.get(codeRef);
  if (!codeSnap.exists()) {
    throw new AppError("無効な招待コードです", "group/invalid-code");
  }
  const fresh = { id: codeSnap.id, ...codeSnap.data() };
  if (!isJoinCodeUsable(fresh)) {
    throw new AppError("期限切れ", "group/invalid-code");
  }
  tx.update(codeRef, { usesCount: increment(1) });
  tx.update(groupRef, { memberUids: arrayUnion(uid) });
});
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/receipt.test.ts:1-43
// vi.hoisted で mutable な mock state を先行宣言、vi.mock で差し替え、
// 名前付き import で対象の service を呼ぶ。
const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));
vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: mockAuthState,
  firestore: {},
}));
vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  getTournament: vi.fn(),
}));
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { joinAsGuest } from "./receipt";
```

### SCHEMA_TEST_STRUCTURE

```ts
// SOURCE: src/lib/firebase/schemas/index.test.ts:11-97
const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const baseTournament = { /* 全フィールド */ };
describe("tournamentBodySchema", () => {
  it("parses a valid tournament", () => {
    expect(tournamentBodySchema.parse(baseTournament).name).toBe("Monthly");
  });
  it("rejects an unknown state", () => { /* ... */ });
});
```

---

## Files to Change

| File                                                                                                     | Action   | Justification                                                                                                                    |
| -------------------------------------------------------------------------------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `src/lib/firebase/schemas/tournament.ts`                                                                 | UPDATE   | `levelStartedAt` / `pausedAt` / `pausedAccumMs` / `finishedAt` を追加                                                              |
| `src/lib/firebase/schemas/index.test.ts`                                                                 | UPDATE   | 新フィールドの parse / reject ケース追加                                                                                         |
| `src/lib/firebase/repositories/tournaments.ts`                                                           | UPDATE   | `startTournament` の書込フィールド拡張、`pauseTournament` / `resumeTournament` / `advanceLevel` / `revertLevel` / `finishTournament` / `subscribeTournament` を新設 |
| `src/lib/firebase/repositories/players.ts`                                                               | UPDATE   | `subscribePlayers(tid, cb)` を新設（onSnapshot ベース）                                                                           |
| `src/lib/services/timer.ts`                                                                              | CREATE   | サーバ時刻基準の derive ロジック（純粋関数）：`computeRemainingMs(tournament, nowMs)` / `computeCurrentLevelInfo(...)` / `shouldAutoAdvance(...)` |
| `src/lib/services/timer.test.ts`                                                                         | CREATE   | 純粋関数の網羅的ユニットテスト（Timestamp を固定）                                                                                |
| `src/lib/hooks/useTournamentTimer.ts`                                                                    | CREATE   | `subscribeTournament` + `setInterval(1000)` + `visibilitychange` で `{ tournament, remainingMs, connection, lastSyncAt }` を返す hook |
| `src/lib/hooks/useSubscribedPlayers.ts`                                                                  | CREATE   | `subscribePlayers` のフロントエンド薄い wrapper（`PlayerList` から呼ぶ）                                                          |
| `src/components/tournament/ConnectionBadge.tsx`                                                          | CREATE   | 「● 同期中 hh:mm:ss」/「⛔ 接続切れ hh:mm」表示の共通部品                                                                        |
| `src/components/tournament/TimerDisplay.tsx`                                                             | CREATE   | 大型タイマー描画＋SB/BB/Ante/次レベル表示（props: `{ tournament, remainingMs }`）                                                 |
| `src/components/tournament/TimerControls.tsx`                                                            | CREATE   | 開始／一時停止／再開／前後レベル／終了の operator ボタン群                                                                        |
| `src/components/tournament/PlayerList.tsx`                                                               | UPDATE   | `listPlayers` → `subscribePlayers` に差し替え、手動リロードボタンは残置（disabled ではなく、強制再同期用途）                      |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                                                         | UPDATE   | `useTournamentTimer` で state 購読、`ConnectionBadge` / `TimerDisplay` / `TimerControls` を配置、既存の開始ダイアログの「Phase 3 で追加予定」文言を除去 |
| `src/app/tournaments/[tid]/live/page.tsx`                                                                | CREATE   | `RequireAuth` ラッパ + `LiveClient`                                                                                              |
| `src/app/tournaments/[tid]/live/live-client.tsx`                                                         | CREATE   | `/live` 全画面 read-only タイマー（モバイル最適化 CSS）                                                                           |
| `src/app/join/[tid]/join-client.tsx`                                                                     | UPDATE   | 受付完了画面に `/tournaments/[tid]/live` への導線 Link を追加                                                                     |
| `src/lib/firebase/client.ts`                                                                             | UPDATE   | `getFirestore` → `initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) })` に置換（SSR ガード維持） |
| `firestore.rules`                                                                                        | UPDATE   | 参加者（group 非メンバー）が `state === "running" | "paused"` の tournament を read できるルールは現行どおり（既に `allow read: if isSignedIn()`）。新フィールド追加に伴う特別な restriction は入れない。**新規追加ルールはなしで足りる想定** — 差分なしで済むか最終確認 |

## NOT Building

- **自動席決め／テーブルバランシング** — Phase 4 スコープ
- **バストボタン** — Phase 4 スコープ（ただし `PlayerList` 側の `isBusted` 表示は既存のまま残す）
- **Cloud Functions** — Phase 3 では使わない。auto-advance は client-transaction で成立させる（`maxUses` UI 追加時の Cloud Functions 移行は別 Phase）
- **賞金計算／分配** — Should 扱い、Phase 5 の余力で検討
- **push 通知／音声アラート** — Won't v1（UI に視覚的変化のみで告知）
- **時刻の非決定論的補正（NTP など）** — `serverTimestamp` と端末時計の差分計算のみ。Firestore SDK が接続中に行う clock offset 補正に依存する
- **複数テーブル視点の切替 UI** — 席概念は Phase 4 で入る
- **late entry 締切通知バナー** — 既存の表示のみに留める（Phase 4 で自動席決めと合わせて拡張）

---

## Step-by-Step Tasks

### Task 1: tournament schema を拡張する

- **ACTION**: `src/lib/firebase/schemas/tournament.ts` の `tournamentBodySchema` に以下を追加。
  - `levelStartedAt: z.instanceof(Timestamp).nullable()` — 現在 level が開始した server 時刻。`setup` 中は `null`。
  - `pausedAt: z.instanceof(Timestamp).nullable()` — 一時停止中のみ非 null。`state === "paused"` と一致することを想定（不変条件）。
  - `pausedAccumMs: z.number().int().nonnegative()` — 開始以降の累積 pause 時間 ms。default 0。
  - `finishedAt: z.instanceof(Timestamp).nullable()` — 終了時の server 時刻。
- **IMPLEMENT**:
  ```ts
  export const tournamentBodySchema = z.object({
    groupId: z.string().min(1),
    createdByUid: z.string().min(1),
    name: z.string().min(1),
    structureSnapshot: structureSnapshotSchema,
    state: tournamentStateSchema,
    startedAt: z.instanceof(Timestamp).nullable(),
    levelStartedAt: z.instanceof(Timestamp).nullable(),
    pausedAt: z.instanceof(Timestamp).nullable(),
    pausedAccumMs: z.number().int().nonnegative(),
    finishedAt: z.instanceof(Timestamp).nullable(),
    currentLevel: z.number().int().nonnegative(),
    lateEntryDeadlineLevel: z.number().int().positive(),
    createdAt: z.instanceof(Timestamp),
    updatedAt: z.instanceof(Timestamp),
  });
  ```
- **MIRROR**: `Patterns to Mirror > NAMING_CONVENTION`
- **IMPORTS**: 既存の `Timestamp` / `z` / `levelSchema` を再利用
- **GOTCHA**: 既存ドキュメントは新フィールドを持たないため、この schema での fromFirestore が `firestore/invalid-data` を throw する。Phase 2.5 と同様「既存データは破壊的移行」方針のため、**Firestore console で既存 tournaments を全削除**する手順をタスク 13 のドキュメントに明記する。
- **VALIDATE**: `npm run typecheck` が緑。`npm run test -- schemas/index.test.ts` で新フィールド test が通る（task 2 後）。

### Task 2: schema テストに新フィールドケースを追加

- **ACTION**: `src/lib/firebase/schemas/index.test.ts` の `tournamentBodySchema` describe に以下 cases を追加。
  - `parses a valid tournament with timer fields populated` — `levelStartedAt: now`, `pausedAt: null`, `pausedAccumMs: 0`, `finishedAt: null` で success
  - `requires pausedAccumMs` — omit すると fail
  - `rejects negative pausedAccumMs` — -1 で fail
  - `rejects invalid state transition fields`（pausedAt は Timestamp | null のみ）
- **IMPLEMENT**: 既存 `baseTournament` に 4 フィールドを追加。
  ```ts
  const baseTournament = {
    groupId: "g1",
    createdByUid: "u1",
    name: "Monthly",
    structureSnapshot: { /* ... */ },
    state: "setup" as const,
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    createdAt: now,
    updatedAt: now,
  };
  ```
- **MIRROR**: `Patterns to Mirror > SCHEMA_TEST_STRUCTURE`
- **IMPORTS**: `Timestamp`, `describe`, `it`, `expect`, `tournamentBodySchema`
- **GOTCHA**: 既存 `it("parses a valid tournament", ...)` が壊れる。`baseTournament` を更新するだけで通る。
- **VALIDATE**: `npm run test -- index.test.ts` 緑。

### Task 3: timer 純粋関数を `src/lib/services/timer.ts` に実装

- **ACTION**: state から残り時間 / 現在 level 情報を算出する pure functions を書く。
- **IMPLEMENT**: 以下のシグネチャで関数を定義：
  ```ts
  import type { TournamentDoc, Level } from "@/lib/firebase/schemas/...";

  export interface LevelInfo {
    current: Level;
    next: Level | null;
    levelIndex: number; // 0-based
  }

  export function getLevelInfo(tournament: TournamentDoc): LevelInfo | null {
    // currentLevel は 1-based。setup 中(0) は null を返す。
    const idx = tournament.currentLevel - 1;
    if (idx < 0 || idx >= tournament.structureSnapshot.levels.length) return null;
    return {
      current: tournament.structureSnapshot.levels[idx],
      next: tournament.structureSnapshot.levels[idx + 1] ?? null,
      levelIndex: idx,
    };
  }

  /**
   * 現在 level の残り時間 ms。
   *  - state === "setup" / "finished": duration 全量 or 0（UI 側で分岐しやすいよう duration を返す）
   *  - state === "paused": pausedAt 固定点の残り時間
   *  - state === "running": nowMs - levelStartedAt を elapsed とし、duration - elapsed
   *  - levelStartedAt が null（pending-write）の場合は null
   */
  export function getRemainingMs(tournament: TournamentDoc, nowMs: number): number | null { ... }

  /** auto-advance のトリガ判定（クライアントが transaction を試みる条件） */
  export function shouldAutoAdvance(tournament: TournamentDoc, nowMs: number): boolean {
    return (
      tournament.state === "running" &&
      tournament.levelStartedAt !== null &&
      getRemainingMs(tournament, nowMs) !== null &&
      getRemainingMs(tournament, nowMs)! <= 0 &&
      tournament.currentLevel < tournament.structureSnapshot.levels.length
    );
  }
  ```
- **MIRROR**: 既存 service 層の pure-function スタイル（`receipt.ts` の `requireDisplayName` / `assertAcceptingEntries` のシンプルな引数→値返し）
- **IMPORTS**: `TournamentDoc`, `Level` from schemas
- **GOTCHA**: 
  - `pausedAccumMs` は state="paused" の間も凍結（pause 中の `remainingMs` は pause 時点の値で固定）。`state==="paused"` のときは `getRemainingMs = duration - ((pausedAt - levelStartedAt) - pausedAccumMs)` で計算する。
  - state="running" かつ `pausedAt === null` のとき：`elapsed = nowMs - levelStartedAt.toMillis() - pausedAccumMs`
  - 最終 level を超えた場合（`currentLevel > levels.length`）: `getLevelInfo` は null、`shouldAutoAdvance` も false（レベルは増やさず state="finished" 運営者判断）
  - 1ms 未満で負になる境界で 0 を返す（`Math.max(0, ...)`）
- **VALIDATE**: Task 4 のテストが緑。

### Task 4: timer 関数のユニットテストを追加

- **ACTION**: `src/lib/services/timer.test.ts` を作成。
- **IMPLEMENT**: `Timestamp.fromDate` で固定時刻を作って分岐網羅：
  - setup: currentLevel=0 → null
  - running: elapsed 5 秒、duration 600 秒 → remaining 595000ms
  - running + pausedAccumMs=30000: remaining = duration - (elapsed - 30000)
  - paused: pausedAt 固定 → remaining が時間経過で変わらない
  - finished: getLevelInfo null、shouldAutoAdvance false
  - shouldAutoAdvance: 残り 0 で true、残り >0 で false、最終 level で false
- **MIRROR**: `Patterns to Mirror > SCHEMA_TEST_STRUCTURE` + `receipt.test.ts` の `makeTournament` factory
- **IMPORTS**: `Timestamp`, `describe`, `it`, `expect`, timer 関数、`TournamentDoc`
- **GOTCHA**: `Date.now()` は使わず明示的な `nowMs` 引数で決定論的にテスト。
- **VALIDATE**: `npm run test -- timer.test.ts` 緑。

### Task 5: tournament repository に state 遷移関数を追加

- **ACTION**: `src/lib/firebase/repositories/tournaments.ts` に以下を追加。
- **IMPLEMENT**:
  ```ts
  // 共通: group メンバーシップの early-fail ヘルパ（既存 startTournament と同じ判定）
  async function assertCanManage(tid: string, userGroupIds: string[]): Promise<TournamentDoc> {
    const t = await getTournament(tid);
    if (!t.groupId || !userGroupIds.includes(t.groupId)) {
      throw new AppError("not allowed", "firestore/permission-denied");
    }
    return t;
  }

  export async function pauseTournament(tid, uid, userGroupIds): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.state !== "running") throw new AppError("running 状態でない", "tournament/invalid-state");
    await updateDoc(doc(tournamentsRef, tid), {
      state: "paused",
      pausedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament pause ok", { tid, uid });
  }

  export async function resumeTournament(tid, uid, userGroupIds): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.state !== "paused") throw new AppError("paused 状態でない", "tournament/invalid-state");
    if (!t.pausedAt) throw new AppError("pausedAt 未設定", "tournament/invalid-state");
    const pausedFor = Date.now() - t.pausedAt.toMillis(); // 端末時計ベース。最終的な精度は次回 level 変更時に reset。
    await updateDoc(doc(tournamentsRef, tid), {
      state: "running",
      pausedAt: null,
      pausedAccumMs: (t.pausedAccumMs ?? 0) + Math.max(0, pausedFor),
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament resume ok", { tid, uid, pausedFor });
  }

  export async function advanceLevel(
    tid, uid, userGroupIds,
    opts: { expectedLevel?: number } = {},
  ): Promise<void> {
    // expectedLevel が指定された場合は transaction で guard（auto-advance 用）。
    // 指定がない場合は単純 update（手動「次レベル」ボタン用）。
    if (opts.expectedLevel !== undefined) {
      try {
        await runTransaction(firestore, async (tx) => {
          const snap = await tx.get(doc(tournamentsRef, tid));
          if (!snap.exists()) throw new AppError("not found", "firestore/not-found");
          const t = { id: snap.id, ...snap.data() };
          if (!t.groupId || !userGroupIds.includes(t.groupId))
            throw new AppError("not allowed", "firestore/permission-denied");
          if (t.currentLevel !== opts.expectedLevel) {
            // 他クライアントが先に進めた。no-op で exit。
            logger.info("advance level skipped (race)", { tid, expected: opts.expectedLevel, actual: t.currentLevel });
            return;
          }
          if (t.currentLevel >= t.structureSnapshot.levels.length) return;
          tx.update(doc(tournamentsRef, tid), {
            currentLevel: t.currentLevel + 1,
            levelStartedAt: serverTimestamp(),
            pausedAccumMs: 0, // level をまたいで pause 累積を reset（level 内で閉じた累積として扱う）
            updatedAt: serverTimestamp(),
          });
        });
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/write_failed", "レベル進行に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code, tid });
        throw wrapped;
      }
      logger.info("advance level ok (auto)", { tid, expected: opts.expectedLevel });
      return;
    }
    // 手動
    const t = await assertCanManage(tid, userGroupIds);
    if (t.currentLevel >= t.structureSnapshot.levels.length) {
      throw new AppError("最終レベルです", "tournament/invalid-state");
    }
    await updateDoc(doc(tournamentsRef, tid), {
      currentLevel: t.currentLevel + 1,
      levelStartedAt: serverTimestamp(),
      pausedAccumMs: 0,
      updatedAt: serverTimestamp(),
    });
    logger.info("advance level ok (manual)", { tid, uid });
  }

  export async function revertLevel(tid, uid, userGroupIds): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.currentLevel <= 1) throw new AppError("最初のレベルです", "tournament/invalid-state");
    await updateDoc(doc(tournamentsRef, tid), {
      currentLevel: t.currentLevel - 1,
      levelStartedAt: serverTimestamp(),
      pausedAccumMs: 0,
      updatedAt: serverTimestamp(),
    });
    logger.info("revert level ok", { tid, uid });
  }

  export async function finishTournament(tid, uid, userGroupIds): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.state === "finished") return;
    await updateDoc(doc(tournamentsRef, tid), {
      state: "finished",
      finishedAt: serverTimestamp(),
      pausedAt: null,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament finish ok", { tid, uid });
  }

  export function subscribeTournament(
    tid: string,
    onNext: (arg: { doc: TournamentDoc | null; fromCache: boolean; hasPendingWrites: boolean }) => void,
    onError: (err: AppError) => void,
  ): () => void {
    return onSnapshot(
      doc(tournamentsRef, tid),
      { includeMetadataChanges: true },
      (snap) => {
        if (!snap.exists()) {
          onNext({ doc: null, fromCache: snap.metadata.fromCache, hasPendingWrites: snap.metadata.hasPendingWrites });
          return;
        }
        try {
          onNext({
            doc: { id: snap.id, ...snap.data() },
            fromCache: snap.metadata.fromCache,
            hasPendingWrites: snap.metadata.hasPendingWrites,
          });
        } catch (e) {
          onError(AppError.from(e, "firestore/invalid-data", "トーナメントデータが不正です"));
        }
      },
      (err) => onError(AppError.from(err, "firestore/subscribe_failed", "購読エラー")),
    );
  }
  ```
  また `startTournament` の書込に `levelStartedAt: serverTimestamp()` / `pausedAt: null` / `pausedAccumMs: 0` / `finishedAt: null` を追加（新フィールドを必ず初期化する）。`createTournament` 側も同様に 4 フィールドを初期化。
- **MIRROR**: `Patterns to Mirror > ERROR_HANDLING` + `REPOSITORY_PATTERN` + `SERVICE_PATTERN`（runTransaction）
- **IMPORTS**: `onSnapshot`, `runTransaction` を `firebase/firestore` から追加
- **GOTCHA**:
  - **`assertCanManage` は rule の最終担保を前提とした early-fail** のみ。rule が deny しても throw されるため UI エラーが二重に出ないよう AppError 経由で統一。
  - resume の `pausedFor` 計算は**端末時計**を使うため精度は 1 秒程度の誤差が乗る。サークル規模では無視可（PRD の "Technical Risks" 参照）。
  - level 繰り上げ時に `pausedAccumMs` を 0 に戻すのは「level 内で閉じた pause 累積」として単純化するため。次 level の pause 累積は新たに 0 から積む。
- **VALIDATE**: `npm run typecheck` 緑。`npm run test -- repositories`（既存を壊していないか）が緑。

### Task 6: players repository に `subscribePlayers` を追加

- **ACTION**: `src/lib/firebase/repositories/players.ts` に追加。
- **IMPLEMENT**:
  ```ts
  export function subscribePlayers(
    tid: string,
    onNext: (players: PlayerDoc[]) => void,
    onError: (err: AppError) => void,
  ): () => void {
    return onSnapshot(
      query(playersRef(tid), orderBy("entryAt", "asc")),
      (snap) => {
        onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => onError(AppError.from(err, "firestore/subscribe_failed", "参加者購読エラー")),
    );
  }
  ```
- **MIRROR**: 既存 `listPlayers`（`src/lib/firebase/repositories/players.ts:37-47`）
- **IMPORTS**: `onSnapshot` を追加
- **GOTCHA**: `PlayerList` はまだ participant（非 group メンバー）も購読する可能性があり、rule が `tournaments/{tid}/players` に `allow read: if isSignedIn()` を許可しているため購読可能（既存 rule のまま）。
- **VALIDATE**: `npm run typecheck` 緑。

### Task 7: `useTournamentTimer` hook を作成

- **ACTION**: `src/lib/hooks/useTournamentTimer.ts` を作成。
- **IMPLEMENT**:
  ```ts
  "use client";
  import { useEffect, useRef, useState } from "react";
  import { subscribeTournament, advanceLevel } from "@/lib/firebase/repositories/tournaments";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  import { getRemainingMs, shouldAutoAdvance } from "@/lib/services/timer";
  import { logger } from "@/lib/logger";
  import { AppError } from "@/lib/errors";

  export interface TimerState {
    tournament: TournamentDoc | null;
    remainingMs: number | null;
    fromCache: boolean;
    hasPendingWrites: boolean;
    lastSyncAt: number | null; // Date.now() at last non-cache snapshot
    error: AppError | null;
  }

  export function useTournamentTimer(
    tid: string,
    options: { autoAdvance?: { uid: string; userGroupIds: string[] } } = {},
  ): TimerState {
    const [tournament, setTournament] = useState<TournamentDoc | null>(null);
    const [fromCache, setFromCache] = useState(true);
    const [hasPendingWrites, setHasPendingWrites] = useState(false);
    const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
    const [error, setError] = useState<AppError | null>(null);
    const [tick, setTick] = useState(0); // 1 秒毎に再描画トリガ
    const advanceInflightRef = useRef(false);

    // 購読
    useEffect(() => {
      const unsub = subscribeTournament(
        tid,
        ({ doc, fromCache: fc, hasPendingWrites: hpw }) => {
          setTournament(doc);
          setFromCache(fc);
          setHasPendingWrites(hpw);
          if (!fc) setLastSyncAt(Date.now());
        },
        (err) => {
          logger.warn("timer subscribe error", { code: err.code, tid });
          setError(err);
        },
      );
      return unsub;
    }, [tid]);

    // 1 秒刻みで tick（re-render）、タブ非表示時は停止し復帰時に即 tick
    useEffect(() => {
      let id: ReturnType<typeof setInterval> | null = null;
      const start = () => {
        if (id !== null) return;
        id = setInterval(() => setTick((n) => n + 1), 1000);
      };
      const stop = () => {
        if (id !== null) { clearInterval(id); id = null; }
      };
      const onVis = () => {
        if (document.visibilityState === "visible") {
          setTick((n) => n + 1);
          start();
        } else {
          stop();
        }
      };
      start();
      document.addEventListener("visibilitychange", onVis);
      return () => {
        stop();
        document.removeEventListener("visibilitychange", onVis);
      };
    }, []);

    // auto-advance（running かつ残り 0 以下）: group メンバーの誰かが書く
    useEffect(() => {
      if (!options.autoAdvance) return;
      if (!tournament) return;
      const now = Date.now();
      if (!shouldAutoAdvance(tournament, now)) return;
      if (advanceInflightRef.current) return;
      advanceInflightRef.current = true;
      advanceLevel(tid, options.autoAdvance.uid, options.autoAdvance.userGroupIds, {
        expectedLevel: tournament.currentLevel,
      })
        .catch((e) => {
          const wrapped = AppError.from(e, "firestore/write_failed", "レベル進行に失敗しました");
          logger.warn(wrapped.message, { code: wrapped.code, tid });
        })
        .finally(() => {
          advanceInflightRef.current = false;
        });
      void tick; // eslint に依存配列の意図を示す
    }, [tournament, tid, tick, options.autoAdvance?.uid]);

    const remainingMs = tournament ? getRemainingMs(tournament, Date.now()) : null;

    return { tournament, remainingMs, fromCache, hasPendingWrites, lastSyncAt, error };
  }
  ```
- **MIRROR**: `AuthProvider.tsx` の `useEffect + unsubscribe` パターン、`current-group.tsx` の `useRef` 再帰ガード
- **IMPORTS**: react hooks / subscribe / timer helpers / logger / AppError
- **GOTCHA**:
  - `tick` は state として更新すると依存配列が回る。`setTick((n) => n + 1)` で関数形 update を使う。
  - auto-advance を「ダッシュボード/運営者」の場合のみ有効にする（`options.autoAdvance` を渡す）。`/live` ページでは **autoAdvance を渡さない**（参加者端末が書き換えようとすると rule で permission-denied になるため）。
  - `advanceInflightRef` を使っても、transaction の guard で `currentLevel == expected` が成立しないと no-op で終わる。二重書き込みはしない。
- **VALIDATE**: `npm run typecheck` 緑。

### Task 8: `ConnectionBadge` / `TimerDisplay` / `TimerControls` コンポーネント

- **ACTION**: `src/components/tournament/{ConnectionBadge,TimerDisplay,TimerControls}.tsx` を作成。
- **IMPLEMENT**:
  - **ConnectionBadge**: props `{ fromCache: boolean; lastSyncAt: number | null }`。
    - `fromCache=false` なら `● 同期中 hh:mm:ss`（緑）
    - `fromCache=true` なら `⛔ 接続切れ 最終 hh:mm:ss`（赤）
    - `lastSyncAt` から `hh:mm:ss` を `new Date(lastSyncAt).toLocaleTimeString("ja-JP")` で format
  - **TimerDisplay**: props `{ tournament: TournamentDoc; remainingMs: number | null; levelInfo: LevelInfo | null }`。
    - 大型文字: `font-mono text-7xl md:text-8xl tabular-nums`
    - 残り時間を `mm:ss` 表示（remainingMs null の時は `--:--` + 下に `同期中…`）
    - SB / BB / Ante / 次 Level を小さく表示
    - state="paused" なら「一時停止中」バッジ
    - state="finished" なら「終了」バッジ
  - **TimerControls**: props `{ tid, uid, userGroupIds, tournament }`。
    - setup → `[開始]`（既存 startTournament 呼出）
    - running → `[一時停止]` `[◀前レベル]` `[次レベル▶]` `[終了]`
    - paused → `[再開]` `[◀前レベル]` `[次レベル▶]` `[終了]`
    - finished → `[終了済み]`（disabled）
    - 各ボタン click で対応する repository 関数を呼び、エラーは AppError.from + setError
- **MIRROR**: `src/app/tournaments/[tid]/dashboard-client.tsx` の Dialog ＋エラー表示（`setError`→`role="alert"` pattern）
- **IMPORTS**: shadcn Button / Card、logger、AppError、repositories / 関数
- **GOTCHA**: 
  - ボタン連打防止のため `submitting` state を個別に持つ（既存 dashboard の `starting` 変数と同じパターン）。
  - TimerDisplay は **pure presentational**（Firestore を直接触らない）。テストしやすい。
- **VALIDATE**: 手動で開発サーバを起動し、タイマーが 1 秒刻みで減る／pause で止まる／resume で再開することを確認。

### Task 9: dashboard-client.tsx を timer hook ベースに書き換え

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` の `useEffect + getTournament + setData` を `useTournamentTimer` に差し替える。
- **IMPLEMENT**:
  - `data` / `setData` を削除、代わりに `const { tournament, remainingMs, fromCache, lastSyncAt, error: timerError } = useTournamentTimer(tid, { autoAdvance: canManage ? { uid, userGroupIds: groupIds } : undefined });`
  - `ConnectionBadge` を header に配置
  - `TimerDisplay` を配置（running / paused / finished 時）
  - `TimerControls` を配置（既存の `開始` ボタン／Dialog は TimerControls の `setup → [開始]` に統合、Dialog は残す）
  - 「Phase 3 で追加予定」の Dialog 説明文を削除
  - `onStart` / `onDelete` はそのまま（start 成功後に `useTournamentTimer` が自動再描画するため `setData` 呼出は不要）
- **MIRROR**: 既存 dashboard 構造、`tournaments-client.tsx` の `useCurrentGroup` の使い方
- **IMPORTS**: `useTournamentTimer`, `ConnectionBadge`, `TimerDisplay`, `TimerControls`
- **GOTCHA**: `canManage` は `groupIds.includes(tournament.groupId)` のままで OK。tournament が null の間は「読込中…」を出す（fromCache=true かつ lastSyncAt=null と区別はしない）。
- **VALIDATE**: 手動でブラウザから `/tournaments/[tid]` を開き、Firestore console で state を直接書き換え → 1 秒以内に UI が反応することを確認。

### Task 10: PlayerList を `subscribePlayers` ベースに

- **ACTION**: `src/components/tournament/PlayerList.tsx` の `listPlayers` 呼出を `subscribePlayers` に置換。
- **IMPLEMENT**:
  ```ts
  useEffect(() => {
    const unsub = subscribePlayers(
      tid,
      (list) => setPlayers(list),
      (err) => {
        logger.warn(err.message, { code: err.code });
        setError(`${err.code}: ${err.message}`);
      },
    );
    return unsub;
  }, [tid]);
  ```
  `reload` 関数と「リロード」ボタンは**残置**する（手動再同期は debug 用途で便利）。Phase 3 の `CardDescription` の「Phase 2 は手動リロード。Phase 3 でリアルタイム同期。」を「リアルタイム同期中。」に書き換え。
- **MIRROR**: `useTournamentTimer` の subscribe 構造
- **IMPORTS**: `subscribePlayers`
- **GOTCHA**: `cancelPlayerEntry` 後の `reload` 呼出は**不要**（subscribePlayers が自動反映）。ただし既存コードを壊さないため `reload` 関数は残す。
- **VALIDATE**: 手動で 2 端末を開き、片方で受付 → もう片方で自動反映を確認。

### Task 11: `/tournaments/[tid]/live` ページを作成

- **ACTION**:
  - `src/app/tournaments/[tid]/live/page.tsx`：`RequireAuth` でラップ、`LiveClient` に `tid` を渡す
  - `src/app/tournaments/[tid]/live/live-client.tsx`：read-only で ConnectionBadge + TimerDisplay のみ
- **IMPLEMENT**:
  ```tsx
  // page.tsx
  import { RequireAuth } from "@/components/auth/RequireAuth";
  import { LiveClient } from "./live-client";
  export default async function LivePage({ params }: { params: Promise<{ tid: string }> }) {
    const { tid } = await params;
    return (
      <RequireAuth allowAnonymous>
        <LiveClient tid={tid} />
      </RequireAuth>
    );
  }
  ```
  ```tsx
  // live-client.tsx
  "use client";
  import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
  import { getLevelInfo } from "@/lib/services/timer";
  import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
  import { TimerDisplay } from "@/components/tournament/TimerDisplay";

  export function LiveClient({ tid }: { tid: string }) {
    const { tournament, remainingMs, fromCache, lastSyncAt, error } = useTournamentTimer(tid);
    if (error) return <main role="alert">{`${error.code}: ${error.message}`}</main>;
    if (!tournament) return <main>読込中…</main>;
    const levelInfo = getLevelInfo(tournament);
    return (
      <main className="flex min-h-screen flex-col items-center justify-center p-4">
        <div className="mb-4 self-end">
          <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
        </div>
        <h1 className="mb-2 text-2xl font-semibold">{tournament.name}</h1>
        <TimerDisplay tournament={tournament} remainingMs={remainingMs} levelInfo={levelInfo} />
      </main>
    );
  }
  ```
  - **RequireAuth は `allowAnonymous`** にして、参加者（ゲスト anon 認証）も見られるようにする。
  - auto-advance は渡さない（参加者が書き込めるとセキュリティ違反）。
- **MIRROR**: `src/app/tournaments/[tid]/page.tsx` の `RequireAuth` ラップパターン、`join/[tid]/page.tsx` の params 受け取り
- **IMPORTS**: 上記参照
- **GOTCHA**: `tournaments/{tid}` の `allow read: if isSignedIn()` が既にあるため、匿名ユーザでも読める。rule 側の追加変更は不要。
- **VALIDATE**: 3 端末（PC + スマホ 2 台）で同時に `/live` を開き、タイマーが ±1 秒以内で揃うことを確認。

### Task 12: join 成功画面に `/live` 導線を追加

- **ACTION**: `src/app/join/[tid]/join-client.tsx` の `status.kind === "joined"` 分岐内、受付完了画面の CardContent に「タイマー画面へ」ボタンを追加。
- **IMPLEMENT**:
  ```tsx
  import Link from "next/link";
  // ...
  {status.kind === "joined" ? (
    <>
      <Link href={`/tournaments/${tid}/live`}>
        <Button size="sm" className="w-full">タイマー画面へ</Button>
      </Link>
      <Button variant="outline" size="sm" /* 既存の取消ボタン */ />
    </>
  ) : null}
  ```
- **MIRROR**: `join-client.tsx:209-220` の既存ボタン配置
- **IMPORTS**: `Link` from "next/link"
- **GOTCHA**: `already-joined` の場合も同じ導線を提示（リピーター／戻ってきたユーザー）。
- **VALIDATE**: ゲスト参加 → 受付完了 → 「タイマー画面へ」→ 残り時間が表示される導線を手動確認。

### Task 13: Firestore オフライン永続化を有効化

- **ACTION**: `src/lib/firebase/client.ts` の `getFirestore(firebaseApp)` を `initializeFirestore` に置換。
- **IMPLEMENT**:
  ```ts
  import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager, getFirestore } from "firebase/firestore";
  // ...
  function createFirestore() {
    if (typeof window === "undefined") {
      // SSR では従来通り getFirestore（永続化は browser のみ）
      return getFirestore(firebaseApp);
    }
    try {
      return initializeFirestore(firebaseApp, {
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      });
    } catch (e) {
      // HMR で 2 回目以降は初期化済み。getFirestore にフォールバック。
      return getFirestore(firebaseApp);
    }
  }
  export const firestore = createFirestore();
  ```
- **MIRROR**: `src/lib/firebase/client.ts:46-51` の singleton イディオム
- **IMPORTS**: `initializeFirestore`, `persistentLocalCache`, `persistentMultipleTabManager`
- **GOTCHA**: 
  - HMR（dev server 再読込）で `initializeFirestore` が「既に呼ばれた」エラーを投げるので try/catch でフォールバックする。production build では一度しか通らない。
  - SSR 側で `persistentLocalCache` を渡すと `window is not defined` で落ちる。`typeof window !== "undefined"` ガードは必須。
  - console.error 直呼びは禁止。`logger.warn` で記録する（ただし catch 後は throw せず fallback）。
- **VALIDATE**: 
  - `npm run build` が通る（SSR コードで落ちない）
  - DevTools Network → Offline にして `/tournaments/[tid]` を開きっぱなしにする → `ConnectionBadge` が「接続切れ」、タイマー表示は継続、オンラインに戻すと「同期中」に戻ることを確認

### Task 14: rules の最終確認と微調整（差分なしを確認）

- **ACTION**: `firestore.rules` を変更せずとも Phase 3 の書込がすべて通ることをコード上で確認する。
  - `tournaments/{tid}` の update は group メンバーに許可済み（rules:111）
  - 新フィールド `levelStartedAt` / `pausedAt` / `pausedAccumMs` / `finishedAt` に対する field-level restriction は PRD の「Phase 3 まで owner 書込可」方針と矛盾しない → **差分なし**
  - `/live` ページの read は `allow read: if isSignedIn()` で既に許可（rules:107）
- **IMPLEMENT**: rule 変更なし。ただし Phase 3 完了後に `emulator + test` を追加する余裕があれば、update で field shape が正しいことの test を追加（本 Plan では rule のテスト自動化はスコープ外）。
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: rule に差分を入れた場合は必ず `firebase deploy --only firestore:rules` までのフローを確認する旨、`firebase-patterns.md` に記載。今回は差分なしで済む前提でフェーズを閉じる。
- **VALIDATE**: 実端末で pause / resume / advance / revert / finish を 1 セット実行し、permission-denied が出ないことを確認。出た場合は field shape と rule を突合して原因を特定。

### Task 15: 既存 tournament ドキュメントの破壊的移行

- **ACTION**: Phase 2.5 と同様、**Firestore Console で既存 `tournaments/*` を全削除** してから Phase 3 の開発／テストを進める。
- **IMPLEMENT**: コード変更なし。プロジェクトの Phase 3 完了報告に「破壊的変更のため既存 tournaments は削除した」と明記。
- **MIRROR**: `phase-2.5-group-management.plan.md` の "既存データは手動削除／マイグレーション前提" セクション
- **IMPORTS**: N/A
- **GOTCHA**: players サブコレクションは `tournaments/{tid}` 削除だけでは**残存**する。Firebase Console の「Delete subcollections」もしくは手動で `tournaments/{tid}/players/*` を削除する。CLI なら `firebase firestore:delete --recursive tournaments/{tid}`。
- **VALIDATE**: Console で `tournaments` コレクションが空、`structures` / `groups` は残っていることを確認。

### Task 16: 最終テスト & 手動検証

- **ACTION**: 静的チェック＋手動 E2E。
- **IMPLEMENT**: 
  - `npm run typecheck` / `npm run lint` / `npm run test` を通す
  - 3 台（PC、スマホ 2 台）で以下シナリオをなぞる：
    1. 運営者 PC：サンプルトーナメント作成 → 開始 → タイマー稼働
    2. スマホ 1（ゲスト参加）：QR → 受付 → `/live` → タイマーが PC と同期
    3. スマホ 2（別運営者）：`/tournaments/[tid]` を開く → 一時停止 → PC 側もほぼ即時停止
    4. 最短 duration の level（`durationSec: 5` 等でテスト用 structure）で auto-advance が 1 端末のみ成功しレベルが +1 されることを確認
    5. スマホを機内モードに → `⛔ 接続切れ` が表示され、タイマーは継続 → 機内モード解除 → `● 同期中` に戻る
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: durationSec を小さくして auto-advance を検証するため、テスト用 structure を作る（後で削除）。
- **VALIDATE**: すべて成功。レポートに結果を記載（reports/phase-3-timer-realtime-viewer-report.md）。

---

## Testing Strategy

### Unit Tests

| Test                                                                  | Input                                                                      | Expected Output                            | Edge Case? |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------ | ---------- |
| `getRemainingMs` running / elapsed 5s / duration 600s                  | tournament with levelStartedAt=t0, nowMs=t0+5000                           | 595000                                     | No         |
| `getRemainingMs` running + pausedAccumMs                                | pausedAccumMs=30000, elapsed=5s                                            | 595000 + 30000 = ... (actual: 625000)      | No         |
| `getRemainingMs` paused                                                 | pausedAt=t0+10s, levelStartedAt=t0, duration 600s                          | 590000（経過時間によらず固定）              | Yes        |
| `getRemainingMs` setup                                                  | state="setup", currentLevel=0                                              | null                                       | Yes        |
| `getRemainingMs` levelStartedAt=null                                    | running だが levelStartedAt 未設定                                         | null                                       | Yes（pending-write） |
| `getLevelInfo` currentLevel 最終＋1                                     | currentLevel = levels.length + 1                                           | null                                       | Yes        |
| `shouldAutoAdvance` 残り 0、最終 level                                  | currentLevel = levels.length, remaining 0                                  | false                                      | Yes        |
| `shouldAutoAdvance` 残り 0、中間 level                                  | currentLevel < levels.length, remaining 0                                  | true                                       | No         |
| `shouldAutoAdvance` paused 中                                          | state="paused", remaining 0                                                | false                                      | Yes        |
| `tournamentBodySchema` 全フィールド妥当                                 | 全フィールド埋めた doc                                                      | parse success                              | No         |
| `tournamentBodySchema` pausedAccumMs 負                                 | pausedAccumMs=-1                                                           | parse fail                                 | Yes        |
| `tournamentBodySchema` pausedAt Timestamp 以外                          | pausedAt="invalid"                                                         | parse fail                                 | Yes        |

### Edge Cases Checklist

- [ ] `levelStartedAt === null`（pending-write 中）でタイマー表示が壊れない（`--:--` フォールバック）
- [ ] `currentLevel` が最終レベル超過（強制操作）で crash せず、operator が手動 finish できる
- [ ] Paused 中に タブ非表示 → 復帰 → remaining 値が変わらない
- [ ] 接続切断中に pause ボタン → local キャッシュに pending-write → 再接続時に flush されることを観察（壊さない）
- [ ] 2 端末が同時に auto-advance → transaction 2 回目は `currentLevel` が expected と不一致で no-op
- [ ] `/live` ページで auto-advance が**実行されない**（オプション渡さない確認）
- [ ] `/live` ページの匿名（ゲスト）ユーザがタイマーを読める（rule `allow read: if isSignedIn()`）
- [ ] `subscribePlayers` で参加者追加が ≦ 1 秒で反映
- [ ] ネットワーク切断 → ConnectionBadge が `接続切れ` → 再接続 → `同期中` に戻る

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
npm run lint
```

EXPECT: エラーなし

### Unit Tests

```bash
npm run test -- schemas/index.test.ts
npm run test -- services/timer.test.ts
```

EXPECT: 全 test 緑

### Full Test Suite

```bash
npm run test
```

EXPECT: 回帰なし

### Build Verification

```bash
npm run build
```

EXPECT: SSR 下でも `initializeFirestore` が落ちない、Next.js build 成功

### Browser Validation

```bash
npm run dev
# ブラウザで http://localhost:3000/tournaments/{tid} を開く
# DevTools Network → "Offline" で切断テスト
```

EXPECT:
- ConnectionBadge が `接続切れ` に切り替わる（3-10 秒以内）
- タイマーは継続表示
- 再接続で `同期中` に戻る

### Manual Validation

- [ ] 3 台以上の端末でタイマーが ≦ 1 秒以内のズレで同期
- [ ] Firestore Console から state / currentLevel を直接書き換えても UI が追従
- [ ] 短い durationSec（5 秒）で auto-advance が 1 端末のみ成功することを複数端末で確認（logger.warn が他端末で "advance level skipped (race)" を出す）
- [ ] 機内モード切替で接続状態 UI が適切に遷移
- [ ] ゲスト参加 → `/live` 画面でタイマー閲覧
- [ ] `/live` に `autoAdvance` オプションを渡していない（ソース grep で確認）
- [ ] `PlayerList` が onSnapshot で自動更新

---

## Acceptance Criteria

- [ ] すべての Task（1〜16）が完了
- [ ] `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build` すべて緑
- [ ] 3 端末以上で 1 秒以内のズレでタイマーが同期
- [ ] pause / resume / advance（手動）/ revert / finish / 自動 advance がすべて動作
- [ ] 接続切断 UI が機能
- [ ] `/live` ページが匿名ユーザで閲覧可能
- [ ] PlayerList が `onSnapshot` で自動更新される
- [ ] 既存 tournament docs は Phase 2.5 方式で削除済み（破壊的移行）

## Completion Checklist

- [ ] Code follows discovered patterns（`@/lib/logger`, `AppError`, `zodConverter`, repositories 経由）
- [ ] Error handling matches codebase style（`AppError.from(e, "firestore/...", 日本語メッセージ)`）
- [ ] Logging follows codebase conventions（`logger.info`/`warn`、`console` 直呼びなし）
- [ ] Tests follow test patterns（`schemas/index.test.ts` / `receipt.test.ts` の書き方）
- [ ] No hardcoded values（duration / level count は snapshot から取る）
- [ ] Documentation updated（`CLAUDE.md` の実装規約・PRD フェーズ表・完了後 report）
- [ ] No unnecessary scope additions（Seating は Phase 4 に残す、Phase 5 の Should 機能には手を出さない）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk                                                                 | Likelihood | Impact | Mitigation                                                                                                                             |
| -------------------------------------------------------------------- | ---------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 複数クライアント同時 auto-advance で `currentLevel` が二重繰り上げ    | L          | H      | Firestore transaction + `currentLevel == expected` guard。失敗時は no-op + logger.warn                                                  |
| 端末時計ズレで pause/resume の `pausedFor` に誤差                     | M          | L      | 1 秒程度の累積誤差は許容（level 遷移時に `pausedAccumMs=0` リセット）。正確性要件は PRD で明示されていない                              |
| `persistentLocalCache` が HMR で再初期化エラー                        | M          | L      | try/catch で `getFirestore` にフォールバック。本番 build では 1 度しか実行されない                                                     |
| `serverTimestamp` の pending-write で `levelStartedAt = null`          | L          | L      | `getRemainingMs` が null を返し UI は `--:--` + `同期中…` 表示。ms 単位で発生するためユーザ視認不可能に近い                             |
| 既存 tournament doc の schema validation 失敗でダッシュボードが崩れる | M          | M      | Phase 2.5 と同じ破壊的移行。Task 15 で Console から削除手順を明記。移行し忘れはダッシュボードに `firestore/invalid-data` で出るので検知可能 |
| 複数タブで `persistentMultipleTabManager` が未対応ブラウザ            | L          | L      | Firefox/Safari の古いバージョンで fallback。try/catch で単一タブ化                                                                      |
| 参加者（非 group メンバー）が state 書込を試みて rule でエラー        | L          | M      | `/live` は `useTournamentTimer` に `autoAdvance` を渡さない。`TimerControls` も canManage で非表示にする                                 |

## Notes

- Phase 3 完了後は `/prp-pr` で PR を作り、マージ後に PRD の Phase 3 ステータスを `complete`、Phase 5 の `Depends` を変えず、実装レポートを `.claude/PRPs/reports/phase-3-timer-realtime-viewer-report.md` に書く（Phase 1 / 2 / 2.5 と同じ運用）。
- auto-advance は Phase 3 の最大のリスク。early 段階で `durationSec: 5` の構造を使って 3 端末で実証する。
- Firestore の reads / writes は 20 人 × 月 1-2 回規模では無料枠内。onSnapshot の接続数は端末数に比例する（〜20 接続）。同時接続数無料枠は 10 万 / project なので余裕。
- Phase 4（席管理）と本 Phase は parallel 可能（PRD の Parallelism Notes 参照）。同時作業する場合は `tournaments/{tid}` の schema 変更が **衝突しないよう互いに新 field を追加するのみ**・既存 field の意味を変えない前提で進める。
