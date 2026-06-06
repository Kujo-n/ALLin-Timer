# Plan: Phase 1 — 受付代理 データ層

## Summary

運営者（organizer / owner）が参加者を代理 create できる Firestore 基盤を作る。サークルメンバーは uid 指定（`pid=uid`）、メンバー外・本人不在は表示名のみ（`pid=合成id, uid=null` の運営者管理専用 player）で登録できるよう、`firestore.rules` の `players/{pid}` `allow create` に **organizer-proxy create 経路** を整備し、service / repository ラッパと専用 emulator validator を追加する。UI は Phase 2 で別途。

## User Story

As a 小規模 NLH サークルの運営者,
I want 充電切れ等で本人が受付できない参加者を、自分の手元操作だけで（メンバーは uid 紐づけ／非メンバーは名前だけで）登録できる基盤,
So that 受付を本人スマホ依存にせず、アプリの自動席指示と現実を一致させたまま回せる。

## Problem → Solution

**Current**: `players/{pid}` の `allow create` は (1) self-create（`pid == uid == auth.uid`）と (2) organizer-clone（`pid == uid`・**`state == "setup"` 限定**）の 2 ブランチのみ。運営者が「本人に成り代わって」or「名前だけで」参加者を登録する経路が無い。開催中（seating / running / paused）の代理受付も clone ブランチの setup 限定で塞がれている。
→
**Desired**: organizer が受付可能 state（setup / seating / running / paused）で
- メンバー（`pid=uid`, `uid` string）を代理 create でき、
- 名前のみ（`uid=null`, 合成 pid）の運営者管理専用 player を代理 create でき、
- 既存 self-create / clone の strict invariants（`isBusted=false` / no seat / `isPlayingDealer=false`）は維持・非回帰、
を rule + service + emulator validator で保証する。

## Metadata

- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md`
- **PRD Phase**: Phase 1 — 受付代理 データ層
- **Estimated Files**: 7（rules 1 / repository 1 / service 1 / schema 0〜1 / 新規 emulator validator 1 / 既存 validator 更新 1 / unit test 2〜3 / package.json 1）

---

## UX Design

### Before / After

Internal change（データ層）— Phase 1 単体ではユーザー向け UX 変化なし。UI は Phase 2 で実装する。本 Phase の成果物は「Phase 2 UI が呼ぶ service API」と「rule で守られた create 経路」。

### Interaction Changes

Internal change — no user-facing UX transformation（Phase 2 で「参加者を追加」ダイアログを実装する際に本 service を消費する）。

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [firestore.rules](../../../../firestore.rules) | 517-630 | `players/{pid}` の create / update / delete 既存 2 ブランチ。ここに organizer-proxy 経路を additive する |
| P0 (critical) | [src/lib/firebase/repositories/players.ts](../../../../src/lib/firebase/repositories/players.ts) | 84-121, 251-314 | `upsertPlayer`（member proxy で再利用）と `clonePlayersFromTournament`（uid=null skip 先例・合成 id 書込パターン） |
| P0 (critical) | [scripts/test-rules-clone-players.mjs](../../../../scripts/test-rules-clone-players.mjs) | all | 新 emulator validator の雛形。**case 3（seating で deny）は本 Phase で挙動が変わるため更新必須** |
| P1 (important) | [src/lib/services/tournament.ts](../../../../src/lib/services/tournament.ts) | 1-52 | tournament-scoped organizer 操作の service 雛形（`getTournament → getGroup → assertOrganizer`） |
| P1 (important) | [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) | 20-82 | `assertAcceptingEntries` / `ensurePlayerCreated`。受付 state 判定と displayName 解決の先例 |
| P1 (important) | [src/lib/firebase/schemas/player.ts](../../../../src/lib/firebase/schemas/player.ts) | 1-39 | `playerBodySchema`（`uid` は既に `z.string().nullable()`・schema 変更不要）/ `joinInputSchema`（displayName ≤15 validation 先例） |
| P1 (important) | [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | 42-148 | state 述語の単一真実源。受付可能 state の pure 述語をここに追加する |
| P2 (reference) | [src/lib/firebase/repositories/players.test.ts](../../../../src/lib/firebase/repositories/players.test.ts) | 1-120 | repository unit test の mock 境界（`firebase/firestore` を vi.mock し setDoc payload を assert） |
| P2 (reference) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 241-299 | `assertOrganizer` / `deriveRole`（pure・Firebase 非依存） |
| P2 (reference) | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | 109-139 | `resolveRanking` が `uid` を null のまま carry する（uid=null player の下流耐性確認） |
| P2 (reference) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 813-857 | `finishTournament` が `if (r.uid === null) continue` で season 集計から skip 済み（下流耐性） |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | 「`tournaments/{tid}` 配下 subcollection の rule 設計原則」「`players/{pid}` の create rule 経路」節 | wildcard 厳禁・explicit ブランチ積み上げ・両ブランチ invariant 同期の規約 |

## External Documentation

No external research needed — feature uses established internal patterns（Firestore Security Rules / zod / vitest mock / firebase emulators:exec はすべて既存先例あり）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/tournament.ts:24-51
// tournament-scoped organizer 操作: object 引数 + assertNonEmptyString + getTournament → getGroup → assertOrganizer
export async function setSpectateEnabled({ tid, uid, value }: { tid: string; uid: string; value: boolean }): Promise<void> {
  assertNonEmptyString(tid, "tid");
  assertNonEmptyString(uid, "uid");
  const tournament = await getTournament(tid);
  const group = await getGroup(tournament.groupId);
  assertOrganizer(group, uid);
  await updateSpectateEnabled(tid, value);
  logger.info("setSpectateEnabled ok", { tid, uid, value, gid: tournament.groupId });
}
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:91-121
// repository: wrapFirestoreWrite("firestore/...", 日本語メッセージ, async () => { ... }, ctx) + 成功時 logger.info は wrap の外
export async function upsertPlayer(tid: string, uid: string, input: { displayName: string }): Promise<void> {
  await wrapFirestoreWrite("firestore/write_failed", "参加者登録に失敗しました", async () => {
    // ... setDoc ...
  }, { tid, uid });
  // logger.info は wrap 内（既存スタイル）。新規関数は wrap 外 logger.info を推奨（firebase-patterns.md）
}
```

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:270-275
// service/repository が business invariant を弾く: AppError(message, "tournament/...")
if (selectedPlayerIds.length > MAX_CLONE_PLAYERS) {
  throw new AppError(`clone 対象は ${MAX_CLONE_PLAYERS} 件までです`, "tournament/clone-too-many");
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:117, 312
logger.info("player create ok", { tid, uid });
logger.info("players clone ok", { srcTid, destTid, copied: count });
```

### REPOSITORY_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:24-28, 106-117
// withConverter 経由の collection ref + 明示 id setDoc。合成 id は呼出側で発行（card-background / seasonHistory 先例）
function playersRef(tid: string) {
  return collection(firestore, "tournaments", tid, "players").withConverter(
    zodConverter(playerBodySchema, `tournaments/${tid}/players`),
  );
}
await setDoc(doc(playersRef(tid), uid), {
  displayName, uid, entryAt: serverTimestamp(),
  isBusted: false, bustedAt: null, tableNum: null, seatNum: null,
  lastMovedAt: null, isPlayingDealer: false,
});
```

```ts
// SOURCE: src/lib/services/group.ts:672 / card-background.ts:100
// 合成 doc id は crypto.randomUUID()（Web 標準・Node 18+）。startNewSeason / cardBackground の先例
const pid = crypto.randomUUID();
```

### SERVICE_PATTERN

```ts
// SOURCE: src/lib/services/receipt.ts:20-32
// 受付 state 判定（finished で拒否・late entry deadline 超過で拒否）
function assertAcceptingEntries(t: TournamentDoc): void {
  if (isFinished(t)) throw new AppError("このトーナメントは終了しています", "tournament/late-entry-closed");
  if (isInProgress(t) && t.currentLevel > t.lateEntryDeadlineLevel) {
    throw new AppError(`レイトエントリー締切（Lv ${t.lateEntryDeadlineLevel}）を超過しています`, "tournament/late-entry-closed");
  }
}
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/firebase/repositories/players.test.ts:9-32, 69-80
// firebase/firestore を vi.mock し、doc(_ref, id) を { __ref:"doc", id } で返す。setDoc payload を assert
vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return { ...actual, doc: vi.fn((_ref, id?: string) => ({ __ref: "doc", id: id ?? "auto" })),
    setDoc: vi.fn(), serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })) /* ... */ };
});
it("creates new player with seat fields initialized to null", async () => {
  vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false } as never);
  await upsertPlayer("t1", "u1", { displayName: "alice" });
  const payload = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
  expect(payload.tableNum).toBeNull();
});
```

```js
// SOURCE: scripts/test-rules-clone-players.mjs:102-142, 244-314
// emulator validator: REST で Firestore/Auth エミュレータを叩く。expectAllow / expectDeny / basePlayer / createDoc
await expectAllow("(1) ...", () => createDoc(org.idToken, `tournaments/${tid}/players`, member.uid, basePlayer(member.uid, "Member")));
await expectDeny("(2) ...", () => createDoc(member.idToken, `tournaments/${tid}/players`, org.uid, basePlayer(org.uid, "Org")));
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `firestore.rules` | UPDATE | `players/{pid}` `allow create`: 既存 organizer-clone ブランチの state を受付可能 4 state へ拡張＋ name-only（uid=null）ブランチを additive |
| `src/lib/services/tournament-state.ts` | UPDATE | 受付可能 state の pure 述語 `isAcceptingProxyEntry(t)` を追加（rule の state 集合と単一真実源化） |
| `src/lib/firebase/repositories/players.ts` | UPDATE | 名前のみ player を合成 id で create する `createNamedOnlyPlayer(tid, displayName)` を追加 |
| `src/lib/services/proxy-receipt.ts` | CREATE | organizer 代理受付の orchestrator（member 経路 = upsertPlayer 再利用 / name-only 経路 = createNamedOnlyPlayer）。assertOrganizer + state guard + displayName validation |
| `scripts/test-rules-proxy-create.mjs` | CREATE | 新 emulator validator（organizer-proxy member / name-only の allow、member/一般ユーザー不正値の deny、self-create 非回帰） |
| `scripts/test-rules-clone-players.mjs` | UPDATE | **case 3 を deny→allow に更新**（organizer の seating-state create は本 Phase で許可される。clone 用途は setup のまま不変だが rule ブランチは共有のため挙動変化） |
| `package.json` | UPDATE | `test:rules-proxy-create` script を追加 |
| `src/lib/firebase/repositories/players.test.ts` | UPDATE | `createNamedOnlyPlayer` の unit test（uid=null・合成 id・invariants）を追加 |
| `src/lib/services/proxy-receipt.test.ts` | CREATE | service の unit test（assertOrganizer / state guard / displayName validation / 両経路の repository 呼出形） |
| `src/lib/services/tournament-state.test.ts` | UPDATE | `isAcceptingProxyEntry` の characterization test を追加 |

## NOT Building

- **受付代理 UI**（「参加者を追加」ダイアログ・メンバー一覧・名前入力・視覚バッジ）— Phase 2 の責務。
- **名前のみ player の表示名修正 UI** — Phase 2（既存 organizer-update 経路で実現）。
- **名前のみ player の本人アカウント移行** — PRD で明示的に Won't。
- **卓の手動コントロール（閉じる／増やす）** — Phase 3 / 4 の責務。
- **Cloud Functions 化** — 将来課題。クライアント直書き + Security Rules 防御を踏襲。
- **late entry deadline 超過時の代理 block 仕様変更** — 既存 `assertAcceptingEntries` の semantics を踏襲（organizer 代理も deadline 超過は警告/拒否。詳細は Task 4 GOTCHA）。

---

## Step-by-Step Tasks

### Task 1: 受付可能 state の pure 述語を追加

- **ACTION**: `src/lib/services/tournament-state.ts` に `isAcceptingProxyEntry(t: TournamentDoc): boolean` を追加。
- **IMPLEMENT**: `return isSetup(t) || isSeating(t) || isInProgress(t);`（= `!isFinished(t)`。但し可読性のため 4 述語の OR で明示）。docコメントで「rule の organizer-proxy create が許可する state 集合（setup/seating/running/paused）と単一真実源」と明記。
- **MIRROR**: `isAcceptingLateSeats`（tournament-state.ts:146-148）の述語スタイル。
- **IMPORTS**: 既存（`isSetup` / `isSeating` / `isInProgress` は同ファイル内）。
- **GOTCHA**: rule 側はリテラル文字列 `in ["setup","seating","running","paused"]` でハードコードになる（Cloud Rules に const 機構なし）。この述語と rule の 4 state を**手動同期**する旨をコメントに残す。
- **VALIDATE**: `npm run test -- tournament-state` で characterization test green。

### Task 2: 名前のみ player の repository 関数を追加

- **ACTION**: `src/lib/firebase/repositories/players.ts` に `createNamedOnlyPlayer(tid: string, displayName: string): Promise<string>` を追加（戻り値 = 発行した合成 pid）。
- **IMPLEMENT**:
  ```ts
  export async function createNamedOnlyPlayer(tid: string, displayName: string): Promise<string> {
    const pid = crypto.randomUUID();
    await wrapFirestoreWrite("firestore/write_failed", "名前のみ参加者の登録に失敗しました", async () => {
      await setDoc(doc(playersRef(tid), pid), {
        displayName,
        uid: null,
        entryAt: serverTimestamp(),
        isBusted: false,
        bustedAt: null,
        tableNum: null,
        seatNum: null,
        lastMovedAt: null,
        isPlayingDealer: false,
      });
    }, { tid, pid });
    logger.info("named-only player create ok", { tid, pid });
    return pid;
  }
  ```
- **MIRROR**: `upsertPlayer` の create 分岐（players.ts:106-117）。`uid: null` と 合成 pid（`crypto.randomUUID()`）が差分。成功 `logger.info` は wrap の外（firebase-patterns.md 推奨形）。
- **IMPORTS**: 既存（`setDoc` / `doc` / `serverTimestamp` / `wrapFirestoreWrite` / `logger` は import 済み）。`crypto.randomUUID()` は global（Web/Node18+、startNewSeason 先例）。
- **GOTCHA**: `setDoc`（merge なし）で create 専用にする。同 pid 衝突は randomUUID で実質ゼロ。displayName の trim / ≤15 文字検証は **service 層（Task 4）の責務**にし、repository は受け取った値をそのまま書く（upsertPlayer も同様に未検証で書く既存契約に揃える）。
- **VALIDATE**: Task 8 の unit test で setDoc payload（`uid: null` / seat null / `isPlayingDealer: false`）と戻り値 pid を確認。

### Task 3: firestore.rules に organizer-proxy create を整備

- **ACTION**: `firestore.rules` の `match /players/{pid}` `allow create`（543-565 行）を更新。
- **IMPLEMENT**:
  1. **既存 organizer-clone ブランチ（554-564 行）の state 条件を拡張**: `get(...).data.state == "setup"` → `get(...).data.state in ["setup", "seating", "running", "paused"]`。これにより organizer は受付可能 4 state で member（`pid == uid`, `uid is string`）を代理 create 可能になる（clone 用途は引き続き setup で動く＝サブセット）。
  2. **name-only ブランチを additive で OR 追加**（self / organizer-member の後ろ）:
     ```
     ||
     (
       exists(/databases/$(database)/documents/tournaments/$(tid))
       && isOrganizer(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
       && get(/databases/$(database)/documents/tournaments/$(tid)).data.state in ["setup", "seating", "running", "paused"]
       && request.resource.data.uid == null
       && request.resource.data.isBusted == false
       && request.resource.data.tableNum == null
       && request.resource.data.seatNum == null
       && request.resource.data.get('isPlayingDealer', false) == false
     )
     ```
  3. コメントで「Phase 1 (07-third-dryrun-improvements): organizer-proxy create。member 経路は旧 clone ブランチを受付可能 state へ拡張、name-only は uid==null 専用ブランチ。両者とも isBusted=false / no seat / isPlayingDealer=false invariant を self/clone と同期」と明記。DRIFT WARNING も追記。
- **MIRROR**: 既存 organizer-clone ブランチ（554-564 行）の `exists() + isOrganizer(get(...).data.groupId)` 構造と invariant 列挙。
- **IMPORTS**: N/A（rules）。
- **GOTCHA**:
  - `match /{...=**}` 等の wildcard は**絶対に追加しない**（firebase-patterns.md の subcollection 設計原則。Phase 5.4 で pre-existing wildcard バグを除去済み）。
  - name-only ブランチは `pid == uid` を**要求しない**（uid は null、pid は合成 id）。discriminator は `uid == null`。
  - member ブランチは `pid == request.resource.data.uid` を維持（pid==uid invariant。`assignSeat` 等の self-key 比較の前提）。
  - state 拡張で **既存 clone 用途は壊れない**（clone は常に新規 setup tournament 対象）が、`test-rules-clone-players.mjs` case 3 の期待値が変わる（Task 6）。
- **VALIDATE**: Task 5 の新 validator + Task 6 の更新後 clone validator が両方 green。

### Task 4: 代理受付 service（orchestrator）を新設

- **ACTION**: `src/lib/services/proxy-receipt.ts` を新規作成。2 関数を export。
- **IMPLEMENT**:
  ```ts
  // メンバー代理（uid 指定）— 既存 upsertPlayer を再利用（pid==uid create / merge）
  export async function addMemberPlayerByOrganizer({ tid, organizerUid, memberUid, displayName }: {...}): Promise<void> {
    assertNonEmptyString(tid, "tid");
    assertNonEmptyString(organizerUid, "organizerUid");
    assertNonEmptyString(memberUid, "memberUid");
    const name = parseProxyDisplayName(displayName);
    const t = await getTournament(tid);
    const group = await getGroup(t.groupId);
    assertOrganizer(group, organizerUid);
    assertAcceptingProxyEntry(t);           // isAcceptingProxyEntry ベース（下記）
    await upsertPlayer(tid, memberUid, { displayName: name });
    logger.info("proxy add member ok", { tid, organizerUid, memberUid, gid: t.groupId });
  }

  // 名前のみ代理（uid=null）— createNamedOnlyPlayer
  export async function addNamedOnlyPlayerByOrganizer({ tid, organizerUid, displayName }: {...}): Promise<string> {
    assertNonEmptyString(tid, "tid");
    assertNonEmptyString(organizerUid, "organizerUid");
    const name = parseProxyDisplayName(displayName);
    const t = await getTournament(tid);
    const group = await getGroup(t.groupId);
    assertOrganizer(group, organizerUid);
    assertAcceptingProxyEntry(t);
    const pid = await createNamedOnlyPlayer(tid, name);
    logger.info("proxy add named-only ok", { tid, organizerUid, pid, gid: t.groupId });
    return pid;
  }
  ```
  - `parseProxyDisplayName`: trim + `min(1)` + `max(DISPLAY_NAME_MAX_LENGTH)` を zod で検証（`joinInputSchema` と同制約）。失敗時 `AppError(..., "validation/display-name-required" or "validation/display-name-too-long")`。`joinInputSchema` の displayName 部分を再利用しても良い（`z.object({ displayName: ... })` から `.shape.displayName.parse(name)`）。zod の `ZodError` は `AppError.from(e, "validation/...", ...)` でラップ。
  - `assertAcceptingProxyEntry(t)`: `isFinished` なら `AppError("このトーナメントは終了しています", "tournament/late-entry-closed")`。late entry deadline 超過の扱いは GOTCHA 参照。
- **MIRROR**: `setSpectateEnabled`（tournament.ts:24-51）の `getTournament → getGroup → assertOrganizer` フロー。`receipt.ts` の `assertAcceptingEntries` / `requireDisplayName`。
- **IMPORTS**:
  ```ts
  import { AppError, assertNonEmptyString } from "@/lib/errors";
  import { getGroup } from "@/lib/firebase/repositories/groups";
  import { createNamedOnlyPlayer, upsertPlayer } from "@/lib/firebase/repositories/players";
  import { getTournament } from "@/lib/firebase/repositories/tournaments";
  import { assertOrganizer } from "@/lib/firebase/schemas/group";
  import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
  import { joinInputSchema } from "@/lib/firebase/schemas/player"; // displayName 制約再利用する場合
  import { isFinished, isInProgress } from "@/lib/services/tournament-state";
  import { logger } from "@/lib/logger";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  ```
- **GOTCHA**:
  - **late entry deadline の扱い**: 既存 `receipt.assertAcceptingEntries` は `isInProgress(t) && currentLevel > lateEntryDeadlineLevel` で拒否する。代理受付でも同 semantics を踏襲する（deadline 超過 player は自動配席されないため事前拒否）。`receipt.ts` の private 関数を再実装するか、共通化する。本 Phase では proxy-receipt.ts 内に同等の `assertAcceptingProxyEntry` を置く（receipt の private 関数を export 変更すると receipt.test に影響するため、複製＋コメントで「receipt.assertAcceptingEntries と同 semantics」明記が安全）。
  - **client 側 role チェックは最終防衛ではない**: rule が真の防御。service の `assertOrganizer` は UX 早期失敗用（rule deny だと firestore/write_failed になり原因が不明瞭）。
  - displayName ≤15: rule では player displayName の size を強制していない（self/clone も未強制）。よって service / schema が唯一の防御。必ず service で検証する。
- **VALIDATE**: Task 9 の unit test で「organizer 以外で `group/not-organizer`」「finished で `tournament/late-entry-closed`」「両経路で正しい repository 関数が正しい引数で呼ばれる」を確認。

### Task 5: 新 emulator validator `test-rules-proxy-create.mjs`

- **ACTION**: `scripts/test-rules-proxy-create.mjs` を新規作成（`test-rules-clone-players.mjs` を雛形にコピーして改変）。
- **IMPLEMENT** — 最低限のケース:
  1. organizer が **setup** tournament に member.uid で create（`basePlayer(member.uid, ...)`）→ **allow**
  2. organizer が **running** tournament に member.uid で create → **allow**（state 拡張の検証）
  3. organizer が **setup** tournament に **name-only**（`uid:null`, pid=合成）で create → **allow**
  4. organizer が **running** tournament に name-only で create → **allow**
  5. 一般 member（non-organizer）が name-only で create → **deny**
  6. 一般 member が member.uid で create → **deny**
  7. organizer が name-only で `isBusted:true` を埋めて create → **deny**（invariant）
  8. organizer が name-only で `tableNum:1, seatNum:1` を埋めて create → **deny**（no seat invariant）
  9. organizer が name-only で `isPlayingDealer:true` を埋めて create → **deny**（PD invariant）
  10. organizer が **finished** tournament に name-only で create → **deny**（state 外）
  11. self-create 非回帰: stranger が自分の uid で setup tournament に create → **allow**
- **MIRROR**: `test-rules-clone-players.mjs` の `signUpOrIn` / `tv` / `fields` / `createDoc` / `expectAllow` / `expectDeny` / `basePlayer` / `tournamentSeed` / group seed 一式をそのまま流用。name-only は `basePlayer(null, "Charge-Dead Guest")` + 合成 docId（`createDoc(org.idToken, ..., "named-" + Date.now(), {...uid:null})`）。
- **IMPORTS**: N/A（standalone Node script、REST 直叩き）。
- **GOTCHA**:
  - `basePlayer` は第1引数 uid をそのまま `uid` フィールドに入れる。`basePlayer(null, name)` で `uid: null` になる（`tv(null)` → `{ nullValue: null }`）。
  - name-only の docId は uid と無関係の合成 id を渡す（pid==uid を要求しないブランチの検証）。
  - tournament seed は複数 state 分（setup / running / finished）作る。`tournamentSeed("running", gid, owner.uid)` を流用（既存 helper が state 引数を取る）。running seed には `currentLevel` / `startedAt` 等を持つが、rule は state のみ参照するため既存 helper のままで可。
  - finished state の seed: `tournamentSeed("finished", ...)`。
- **VALIDATE**: `npm run test:rules-proxy-create`（Task 7 で script 登録後）が ALL GREEN。

### Task 6: 既存 `test-rules-clone-players.mjs` の case 3 を更新

- **ACTION**: `scripts/test-rules-clone-players.mjs` の case 3（268-278 行）を `expectDeny` → `expectAllow` に変更。
- **IMPLEMENT**: ラベルとコメントを「(3) organizer create on seating-state tournament — Phase 1 (07) で受付代理が seating を許可するため allow に変更（旧: setup 限定 deny）」に更新。`expectAllow("(3) organizer creates member on seating-state tournament (allow — proxy receipt widened in Phase 07)", () => createDoc(org.idToken, \`tournaments/${tidSeating}/players\`, member.uid, basePlayer(member.uid, "Member")))`。
- **MIRROR**: case 1（既存 allow）の形。
- **IMPORTS**: N/A。
- **GOTCHA**: これは testing.md の「テスト skip/disable 禁止」に違反しない — **挙動が意図的に変わった**ことを反映する更新（commit message に「rule 拡張に伴う期待値更新」と明記）。case 3 の seating tournament は既に `member.uid` を case 1 で setup に入れているが、`tidSeating` は別 tournament なので衝突しない（既存コードの構造を確認済み）。
- **VALIDATE**: `npm run test:rules-clone-players` が ALL GREEN（case 3 が allow で pass、他ケース非回帰）。

### Task 7: package.json に test script を追加

- **ACTION**: `package.json` の `scripts` に `test:rules-proxy-create` を追加。
- **IMPLEMENT**: `"test:rules-proxy-create": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-proxy-create.mjs\""`
- **MIRROR**: 既存 `test:rules-clone-players` script（package.json）。
- **IMPORTS**: N/A。
- **GOTCHA**: 行末カンマ / JSON 構文。`test:rules-clone-players` の直後に並べると差分が読みやすい。
- **VALIDATE**: `npm run test:rules-proxy-create` が起動する（firebase CLI 必要）。

### Task 8: repository unit test を追加

- **ACTION**: `src/lib/firebase/repositories/players.test.ts` に `createNamedOnlyPlayer` の describe ブロックを追加。
- **IMPLEMENT**:
  - `import` に `createNamedOnlyPlayer` を追加（38-55 行の import から）。
  - `globalThis.crypto.randomUUID` を stub（`vi.stubGlobal("crypto", { randomUUID: () => "synthetic-pid-1" })` または `vi.spyOn`）。
  - test 1: `createNamedOnlyPlayer("t1", "Guest")` → setDoc payload が `uid: null` / `isBusted: false` / `tableNum: null` / `seatNum: null` / `lastMovedAt: null` / `isPlayingDealer: false` / `displayName: "Guest"`。戻り値 `=== "synthetic-pid-1"`。
  - test 2: `doc` mock の id 引数が合成 pid（`vi.mocked(doc).mock.calls` で id を確認）。
- **MIRROR**: 既存 `upsertPlayer` describe（players.test.ts:69-101）の setDoc payload assert。
- **IMPORTS**: 既存 + `createNamedOnlyPlayer`。
- **GOTCHA**: `crypto.randomUUID` は Node test 環境では存在する場合が多いが、決定論のため stub する。`afterEach` で `vi.unstubAllGlobals()`。
- **VALIDATE**: `npm run test -- players` green。

### Task 9: service unit test を新設

- **ACTION**: `src/lib/services/proxy-receipt.test.ts` を新規作成。
- **IMPLEMENT** — mock 境界は service が呼ぶ repository / schema helper:
  - `vi.mock("@/lib/firebase/repositories/tournaments", () => ({ getTournament: vi.fn() }))`
  - `vi.mock("@/lib/firebase/repositories/groups", () => ({ getGroup: vi.fn() }))`
  - `vi.mock("@/lib/firebase/repositories/players", () => ({ upsertPlayer: vi.fn(), createNamedOnlyPlayer: vi.fn().mockResolvedValue("pid-x") }))`
  - `assertOrganizer` は pure（schemas/group.ts）なので mock せず本物を使い、fake group の `organizerUids` で制御。
  - fixture factory `fakeTournament` / `fakeGroup`（testing.md の fixture factory 規約）。
  - test ケース:
    1. member 経路: organizer + setup → `upsertPlayer(tid, memberUid, { displayName })` が呼ばれる。
    2. name-only 経路: organizer + running → `createNamedOnlyPlayer(tid, name)` が呼ばれ pid を返す。
    3. 非 organizer（group.organizerUids に含まれない uid）→ `group/not-organizer` throw、repository 未呼出。
    4. finished tournament → `tournament/late-entry-closed` throw、repository 未呼出。
    5. displayName 空 / 16 文字 → validation エラー throw、repository 未呼出。
    6. （任意）late entry deadline 超過（running + currentLevel > deadline）→ `tournament/late-entry-closed`。
- **MIRROR**: `receipt.test.ts` の mock 境界（helper/repository 境界で割る、testing.md）。`tournament-clone.test.ts` の service mock 構成。
- **IMPORTS**: vitest + mocked repository。
- **GOTCHA**: helper 境界で mock（repository を mock し、内部の Firestore SDK は触らない）。`logger` は `vi.spyOn(logger, "info")` で確認不要なら mock 不要。
- **VALIDATE**: `npm run test -- proxy-receipt` green。

### Task 10: tournament-state characterization test を追加

- **ACTION**: `src/lib/services/tournament-state.test.ts` に `isAcceptingProxyEntry` の test を追加。
- **IMPLEMENT**: setup / seating / running / paused で `true`、finished で `false`。既存 `tournament(overrides)` fixture factory を使用。
- **MIRROR**: 同ファイルの `isAcceptingLateSeats` / `isInProgress` test。
- **IMPORTS**: 既存 + `isAcceptingProxyEntry`。
- **GOTCHA**: rule の 4 state リテラルと本述語が一致していることをコメントで残す（drift の人手チェックポイント）。
- **VALIDATE**: `npm run test -- tournament-state` green。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `createNamedOnlyPlayer` payload | `("t1", "Guest")` | setDoc に `uid:null` / seat null / `isPlayingDealer:false`、戻り値 = 合成 pid | No |
| `createNamedOnlyPlayer` docId | 同上 | `doc(ref, <synthetic pid>)` で呼ばれる | No |
| proxy member 経路 | organizer + setup | `upsertPlayer(tid, memberUid, {displayName})` 呼出 | No |
| proxy name-only 経路 | organizer + running | `createNamedOnlyPlayer(tid, name)` 呼出 → pid 返却 | No |
| 非 organizer | member uid | `group/not-organizer` throw / repo 未呼出 | Yes (permission) |
| finished tournament | organizer + finished | `tournament/late-entry-closed` throw | Yes (state) |
| displayName 空 | `""` | validation throw / repo 未呼出 | Yes (empty) |
| displayName 16 文字 | 長文字列 | validation throw | Yes (max) |
| `isAcceptingProxyEntry` | 各 state | setup/seating/running/paused=true, finished=false | Yes |

### Edge Cases Checklist

- [x] Empty input（displayName 空 → validation throw）
- [x] Maximum size input（displayName 16 文字 → validation throw）
- [x] Invalid types（rule: isBusted=true / 座席埋め / isPlayingDealer=true で deny）
- [x] Concurrent access（合成 pid は randomUUID で衝突実質ゼロ。member proxy は upsertPlayer の merge で冪等）
- [x] Permission denied（一般 member / 非 organizer の create を rule + service で deny）
- [ ] Network failure（wrap が `firestore/write_failed` にラップ。既存契約のため本 Phase で新規テスト不要）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```

EXPECT: Zero type errors

> ※ `tsc` は settings で allow 済み（npx 経由でも本コマンドは型チェック用途で承認）。lint は次項。

### Lint

```bash
npm run lint
```

EXPECT: No lint errors（console.* 残置 / 手書き型ガードの混入なし）

### Unit Tests

```bash
npm run test -- players proxy-receipt tournament-state
```

EXPECT: All affected unit tests pass

### Full Test Suite

```bash
npm run test
```

EXPECT: No regressions

### Rules Emulator Validation

```bash
npm run test:rules-proxy-create
npm run test:rules-clone-players
```

EXPECT: 両方 ALL GREEN（新 validator で proxy allow/deny、更新 clone validator で case 3 allow + 他非回帰）

> ⚠ Firestore rules を変更したため、**emulator green ≠ 本番反映**。Phase 完了報告には本番 deploy を必ず含める:
> ```bash
> firebase deploy --only firestore:rules
> ```

### Manual Validation

- [ ] `firestore.rules` に `match /{...=**}` wildcard が混入していないこと（diff 目視）
- [ ] organizer-clone（member）ブランチと name-only ブランチの invariant（isBusted/seat/PD）が self-create と一致していること
- [ ] `isAcceptingProxyEntry` の 4 state と rule の `in [...]` リテラルが一致していること

---

## Acceptance Criteria

- [ ] organizer が受付可能 state（setup/seating/running/paused）で member（pid=uid）と name-only（uid=null）の player を rule 適合で create できる（emulator allow）
- [ ] member / 一般ユーザーが不正値（pid!=uid, isBusted=true, 座席埋め, isPlayingDealer=true）で create すると deny（emulator deny）
- [ ] 既存 self-create / clone の deny ケースが非回帰（clone validator green、case 3 のみ意図的更新）
- [ ] service が assertOrganizer / state guard / displayName validation を備える（unit green）
- [ ] 全 unit test + 両 rules validator が green、type / lint エラーなし

## Completion Checklist

- [ ] Code follows discovered patterns（service: getTournament→getGroup→assertOrganizer / repository: wrapFirestoreWrite + logger.info）
- [ ] Error handling matches codebase style（AppError ラップ・適切な code prefix）
- [ ] Logging follows conventions（logger.info、console.* なし）
- [ ] Tests follow test patterns（mock 境界 = repository/helper、fixture factory）
- [ ] No hardcoded values（DISPLAY_NAME_MAX_LENGTH / state 述語を参照）
- [ ] firebase-patterns.md / group-membership.md の DRIFT WARNING 表に「organizer-proxy create」経路を追記（rule 経路ドキュメント更新）
- [ ] No unnecessary scope additions（UI / 卓操作は Phase 2-4）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| state 拡張で clone validator case 3 が壊れる | H（確実に発生） | L | Task 6 で意図的に deny→allow へ更新。commit message に理由明記 |
| `pid==uid` invariant 依存の既存コードが uid=null で破綻 | L | H | 実装前 audit 済み（全 callsite が `player.id` をキーに使用、uid=null は finishTournament/clone で skip 済み。本 plan の Mandatory Reading P2 参照）。characterization は tournament-state + 既存 engine/orchestrator test が網羅 |
| name-only ブランチが既存 strict invariant を bypass する穴を作る | M | H | wildcard 厳禁・explicit ブランチ・invariant を self/clone と同期。Task 5 の deny ケース（isBusted/seat/PD）で機械検証 |
| rule の 4 state リテラルと `isAcceptingProxyEntry` の drift | M | M | 両者にコメントで相互参照。Task 10 characterization + manual validation checklist |
| emulator 未起動環境で rules test が落ちる | M | L | `firebase emulators:exec` が CLI を内包起動。CI/ローカルで firebase CLI 必須を Phase 報告に明記 |

## Notes

- **pid 採番方式の決定（Open Question 解決）**: name-only player の pid は **`crypto.randomUUID()`（クライアント生成・合成 id）** を採用。理由: (1) startNewSeason / cardBackground で既に同 API を使用、(2) Firestore auto-id（`doc(collectionRef)` 無 id）だと create 後に id を read-back する必要があり戻り値設計が煩雑、(3) audit により `pid` を uid として扱う callsite は皆無で合成 id が安全と確認済み。
- **member proxy は新 repository 不要**: 既存 `upsertPlayer(tid, memberUid, {displayName})` が `pid=uid` / `uid=memberUid` の create（or merge）を行うため再利用。service ラッパで organizer 権限と state を gate するだけで成立する。
- **rule ブランチの統合判断**: 旧 organizer-clone ブランチを「organizer-proxy（member）」として state 拡張し共用する。別ブランチに分けると setup state で 2 ブランチが重複（OR で無害だが冗長）するため、1 ブランチに集約。clone（Phase 5.4）の用途は setup 固定で変わらず、拡張後ブランチのサブセットとして動作継続。
- **late entry deadline**: 代理受付でも `receipt.assertAcceptingEntries` と同 semantics（deadline 超過は拒否）を踏襲。将来「organizer は deadline を越えて代理追加できる」要件が出たら別途検討（本 Phase スコープ外）。
- **Phase 2 への引き継ぎ**: 本 Phase の `addMemberPlayerByOrganizer` / `addNamedOnlyPlayerByOrganizer` を Phase 2 UI（「参加者を追加」ダイアログ）が消費する。名前のみ player の視覚バッジ・表示名修正 UI は Phase 2。
