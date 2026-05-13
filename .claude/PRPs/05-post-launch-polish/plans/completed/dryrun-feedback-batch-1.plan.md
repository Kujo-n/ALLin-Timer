# Plan: Dryrun Feedback Batch 1（トーナメント名・参加済み表示・ゴミデータ整理・観戦自動オフ）

## Summary

ドライラン参加サークルから挙がった 4 件の改善要望を 1 つの polish batch として実装する:

1. トーナメントのデフォルト名を `[サークル名]トーナメント-X` → `Tournament-No.X` に変更（UX simplify）
2. トーナメント一覧で**既に参加済み**のカードのボタンを「参加する」→「参加済み」に切り替え、二重登録の不安を解消（冪等性は upsertPlayer で既に担保されているが、認知改善）
3. ゴミデータの自動整理（Firestore / Authentication）
   - 3a. 招待コード発行時に同サークルの旧コードを best-effort delete
   - 3b. 作成から 7 日以上経過した匿名 Auth ユーザーを admin script で一括削除
4. **観戦 URL の自動オフ** — `finishTournament` tx 内で `tournaments/{tid}.spectateEnabled` を `false` に倒し、終了済みトーナメントの公開放置を防ぐ

## User Story

As a サークル参加者 / 運営者 / プロジェクト所有者,

- (1) I want トーナメント名のデフォルトがサークル名に依存せず簡潔である, so that 表示崩れや「サークル名が長すぎて読みにくい」事態を避けられる
- (2) I want 一覧画面で自分が既に参加済みのトーナメントが明示的に分かる, so that 「もう一度押すと二重登録になるのでは」と不安に思わず安心して受付確認に戻れる
- (3a) I want 招待コードを再発行したら古い QR が自動で無効化される, so that QR の使い回し事故とゴミデータの蓄積を防げる
- (3b) I want ドライラン会場で増え続ける匿名 Auth ユーザーが定期的に削除される, so that Firebase Authentication の総アカウント数が肥大化せず管理しやすい
- (4) I want トーナメントが終了したら観戦 URL が自動でオフになる, so that 終了済みトーナメントが unauthenticated にいつまでも露出する事故（運営者の toggle 忘れ）を防げる

## Problem → Solution

| # | 現状 | 変更後 |
| - | ---- | ------ |
| 1 | 新規作成画面: name 初期値 = `[サークル名]トーナメント-{finishedTournamentCount + 1}`（[`src/app/tournaments/new/tournament-new-client.tsx:32`](../../../../src/app/tournaments/new/tournament-new-client.tsx#L32)） | name 初期値 = `Tournament-No.{finishedTournamentCount + 1}`（サークル名非依存・簡潔・国際標準的） |
| 2 | 一覧の「タイマー」/「参加する」ボタン（[`src/app/tournaments/tournaments-client.tsx:184`](../../../../src/app/tournaments/tournaments-client.tsx#L184)）は `isOrganizer` でのみ分岐し、member には常に「参加する」表示 | member 視点で **自分が既に参加済み**（`tournaments/{tid}/players/{auth.uid}` が存在）の row は「参加済み」ラベル + `variant="outline"` で disabled 風表示。link 自体は維持し `/live` で受付確認に到達できる UX を保つ |
| 3a | `createJoinCode`（[`repositories/groupJoinCodes.ts:57-83`](../../../../src/lib/firebase/repositories/groupJoinCodes.ts#L57-L83)）は古いコードを残したまま新規発行する。サークル所有者が定期再発行するたび `groupJoinCodes` collection に旧コードが蓄積する | `groups/{gid}.latestJoinCodeId: string \| null` を additive 追加。`generateJoinCode` service が「読み取り → 新規 create → groups doc を新 code に更新 → 旧 code を best-effort delete」の 4 ステップを実行。Firestore rules の `groupJoinCodes` delete を `isOwner` から `isOrganizer` に **拡大**（発行と削除の権限を一致させる） |
| 3b | 受付フローの guest tab で `signInAnonymously` 発火（[`auth-actions.ts:351-363`](../../../../src/lib/services/auth-actions.ts#L351-L363)）。tournament 終了時の `attemptAnonymousSelfDelete` で best-effort 削除されるが、トーナメント未完了で離脱したケースやエラーで落ちた匿名 Auth ユーザーが残留する。`attemptAnonymousSelfDelete` は意図的に `users/{uid}` と Auth user しか消さない（[live-client.tsx:122 のコメント](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L122) より「**player ドキュメントは履歴として残す**」設計） | 新規 admin script `scripts/cleanup-old-anonymous-users.ts` を追加。`cleanup-orphan-firestore.ts` と `cleanup-test-auth-users.ts` の pattern を踏襲。`admin.auth().listUsers()` で全 user を走査し、`providerData.length === 0` かつ `metadata.creationTime` が `now - 7 日` より古い uid を以下 2 ステップで削除: ①`users/{uid}` doc を `deleteDoc` ②`admin.auth().deleteUsers([...uids])` で Auth を 1000 件 chunk batch 削除。**`tournaments/{tid}/players/{uid}` / `seasonStats/{uid}` / `seasonHistory` は意図的に保持**（過去トーナメント参照時に participant 一覧 / WinnerBanner / 結果カード / シーズンランキングが `displayName` snapshot で表示維持される必要があるため）。orphan player doc は将来的に `cleanup-orphan-firestore.ts` Step 3 が「親 tournament が削除された」場合のみ拾う（active な tournament 配下では参照価値あり）。dry-run / `--execute` / `--days=N` mode は既存 script と同型 |
| 4 | `finishTournament`（[`repositories/tournaments.ts:727-843`](../../../../src/lib/firebase/repositories/tournaments.ts#L727-L843)）の tx は `state="finished"` / `finishedAt` / `pausedAt: null` / `updatedAt` のみ更新し、`spectateEnabled` は触らない。観戦 ON のまま終了すると `/spectate/[tid]` が anon に開かれたまま放置される | tx 内の `tx.update(ref, {...})` 部分に `spectateEnabled: false` を追加（無条件）。冪等で副作用なし。rule は既存の broad `allow update: if isOrganizer(...)` で許可済みのため rule 変更不要。`SpectateModeCard` 側の表示は `tournament.spectateEnabled` を読んでいるため自動的に「無効」状態に同期する |

## Metadata

- **Complexity**: Medium
- **Source PRD**: [`.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`](../prds/05-post-launch-polish.prd.md)
- **PRD Phase**: 新規 Track C: Dryrun Feedback Bundle / Phase C.1（本 plan で初回追加）
- **Estimated Files**: 約 14 ファイル（実装 7 + テスト 5 + emulator validator 1 + script 1）

---

## UX Design

### Before

```
┌─────────────────────────────────────────────────────────┐
│ トーナメントを新規作成                                   │
│ 名前: [トーナメントAサークル]トーナメント-3              │ ← サークル名が長いと冗長
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ トーナメント一覧（member 視点）                          │
│ ┌───────────────────────────────────────────────────┐   │
│ │ TournamentAサークル トーナメント-2                │   │
│ │ [進行中] 20 レベル / 初期 20000                   │   │
│ │ 現在 Lv3 / 締切 Lv5            [ 参加する ] ←既に登録済みでも"参加する"
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

招待コードカード:
[招待コードを発行] → 旧コードはそのまま残留 → 古い QR が永続的に有効
```

### After

```
┌─────────────────────────────────────────────────────────┐
│ トーナメントを新規作成                                   │
│ 名前: Tournament-No.3                                    │ ← サークル名非依存・短い
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│ トーナメント一覧（member 視点）                          │
│ ┌───────────────────────────────────────────────────┐   │
│ │ Tournament-No.2                                   │   │
│ │ [進行中] 20 レベル / 初期 20000                   │   │
│ │ 現在 Lv3 / 締切 Lv5         [ 参加済み (outline) ] ← 自分が参加済みなら明示
│ └───────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘

招待コードカード:
[招待コードを発行] → 旧コードは即時 delete（best-effort）→ 古い QR は失効
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/tournaments/new` の name input | `[g.name]トーナメント-{X}` をプリフィル | `Tournament-No.{X}` をプリフィル | X = `finishedTournamentCount + 1` は不変 |
| `/tournaments` 一覧 row のボタン（member） | 常に "参加する"（filled） | 参加済みなら "参加済み"（outline, link は維持） | aria-label も "参加済み（受付確認に戻る）" に差替 |
| 招待コード発行ボタン | 旧コードと共存 | 旧コードを best-effort 削除 → 新コードのみ active | 失敗時 warn のみ、新コード発行自体は成功扱い |
| 匿名 Auth ユーザーの寿命 | tournament finish 時にのみ self-delete | 上記 + 週次 admin script で 7 日以上の匿名を bulk delete | script は手動 or GitHub Actions / Vercel cron で運用（本 plan の範囲外） |
| トーナメント終了ボタン | `state="finished"` のみ更新（`spectateEnabled` はそのまま） | `state="finished"` 同時に `spectateEnabled=false` も書込 | dashboard の SpectateModeCard が自動で「無効」状態に同期。終了済みは観戦 toggle を再 ON にできない設計を維持（運営判断で OFF/ON 制御を残しつつデフォルト OFF 化） |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [`src/app/tournaments/new/tournament-new-client.tsx`](../../../../src/app/tournaments/new/tournament-new-client.tsx) | 24-33 | 改善 1 の defaultName 組立箇所。リテラル変更だけで完結する範囲を把握 |
| P0 | [`src/app/tournaments/tournaments-client.tsx`](../../../../src/app/tournaments/tournaments-client.tsx) | 65-195 | 改善 2 の対象 component。`useEffect` で list fetch している箇所と Button render 箇所 |
| P0 | [`src/lib/firebase/repositories/players.ts`](../../../../src/lib/firebase/repositories/players.ts) | 49-60 | `getPlayer(tid, uid)` の API 形（改善 2 で参加済み判定に使う） |
| P0 | [`src/lib/firebase/repositories/groupJoinCodes.ts`](../../../../src/lib/firebase/repositories/groupJoinCodes.ts) | 21-83 | 改善 3a の `createJoinCode` 実装と `joinCodeDocRef` helper |
| P0 | [`src/lib/services/group.ts`](../../../../src/lib/services/group.ts) | 244-265 | 改善 3a の `generateJoinCode` service を拡張する対象 |
| P0 | [`firestore.rules`](../../../../firestore.rules) | 380-406 | `groupJoinCodes` の rule。delete を organizer に開放する変更が必要 |
| P0 | [`firestore.rules`](../../../../firestore.rules) | 195-220, 275-337 | `groups/{gid}` update branches のパターン。`latestJoinCodeId` 単独書換ブランチを additive 追加するための雛形 |
| P0 | [`src/lib/firebase/schemas/group.ts`](../../../../src/lib/firebase/schemas/group.ts) | 全体 | additive フィールド `latestJoinCodeId` の zod 定義位置を把握 |
| P0 | [`scripts/cleanup-orphan-firestore.ts`](../../../../scripts/cleanup-orphan-firestore.ts) | 全体 | 改善 3b の新規 script が踏襲するパターン（dry-run / --execute / Admin SDK / `listAllAuthUids` / `--only` フィルタ・分類別 ok/fail カウント） |
| P0 | [`scripts/cleanup-test-auth-users.ts`](../../../../scripts/cleanup-test-auth-users.ts) | 全体 | Auth user の bulk delete（`admin.auth().deleteUsers([...])`）パターンの先行事例 |
| P0 | [`src/lib/firebase/repositories/tournaments.ts`](../../../../src/lib/firebase/repositories/tournaments.ts) | 727-843 | 改善 4 の対象 `finishTournament` tx。`tx.update(ref, {...})` の中に `spectateEnabled: false` を追加する地点（line 804-809） |
| P0 | [`src/lib/services/tournament.ts`](../../../../src/lib/services/tournament.ts) | `setSpectateEnabled` 周辺 | 観戦モード書込 service の現行 API。改善 4 では touch しないが、SpectateModeCard と finishTournament が同フィールドを書き換える点を理解しておく |
| P1 | [`src/app/tournaments/[tid]/live/live-client.tsx`](../../../../src/app/tournaments/[tid]/live/live-client.tsx) | 97 | `players.find((p) => p.uid === user.uid)` パターン（改善 2 の判定ロジックを揃える） |
| P1 | [`.claude/rules/firebase-patterns.md`](../../../../.claude/rules/firebase-patterns.md) | 「`groups/{gid}` update の allowed-keys 一覧」 | 改善 3a の rule 拡張で新規 branch を追加するときの表 |
| P1 | [`.claude/rules/group-membership.md`](../../../../.claude/rules/group-membership.md) | 「招待コード設計原則」 | 改善 3a で「コードを delete する」設計判断の根拠を確認 |
| P1 | [`.claude/rules/error-logging.md`](../../../../.claude/rules/error-logging.md) | 全体 | 新規 service / repository / script のエラー & ログ規約。AppError 採用と prefix（`firestore/*` / `group/*`） |
| P2 | [`src/lib/firebase/wrap.ts`](../../../../src/lib/firebase/wrap.ts) | 全体 | `wrapFirestoreRead` / `wrapFirestoreWrite` の引数形 |
| P2 | [`tests/e2e/`](../../../../tests/e2e/) | spec 命名規則 | 改善 2 の e2e があれば一覧 spec、改善 1 のデフォルト名 e2e の有無 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firebase Admin SDK `auth().listUsers` | https://firebase.google.com/docs/auth/admin/manage-users#list_all_users | `listUsers(maxResults?, pageToken?)` の paging API。1 page = 最大 1000 件 |
| Firebase Admin SDK `auth().deleteUsers` | https://firebase.google.com/docs/auth/admin/manage-users#delete_a_user | `deleteUsers(uids[])` で最大 1000 uid を一括削除。partial 失敗は result.errors で返る |
| `UserRecord.providerData` の匿名判定 | https://firebase.google.com/docs/reference/admin/node/firebase-admin.auth.userrecord | 匿名ユーザーは `providerData.length === 0`（provider 連携無し）/ `metadata.creationTime` は ISO8601 文字列 |

---

## Patterns to Mirror

### NAMING_CONVENTION（既存サークル詳細の inline edit）

```ts
// SOURCE: src/lib/services/group.ts:310-329（setFinishedTournamentCount）
export async function setFinishedTournamentCount({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  // validation → assertOrganizer → repository call → logger.info
}
```

→ 改善 3a の `generateJoinCode` 拡張も同じ pattern: 引数 `{ gid, uid, ... }` → assert → repository → logger.info。

### ERROR_HANDLING（repository の wrap）

```ts
// SOURCE: src/lib/firebase/repositories/groupJoinCodes.ts:57-83
export async function createJoinCode(input: CreateGroupJoinCodeInput): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = generateCodeString();
    const result = await wrapFirestoreWrite<string | null>(
      "firestore/write_failed",
      "招待コード作成に失敗しました",
      async () => { /* ... */ },
      { gid: input.gid },
    );
    if (result) return result;
  }
  throw new AppError("招待コードの生成に失敗しました（衝突が連続）", "firestore/write_failed");
}
```

→ 改善 3a の `deleteJoinCode` 新規 repository 関数も同じ pattern: `wrapFirestoreWrite("firestore/write_failed", ..., async () => deleteDoc(...))`。

### LOGGING_PATTERN（service の info/warn）

```ts
// SOURCE: src/lib/services/group.ts:140-165
try {
  await runTransaction(firestore, async (tx) => { /* ... */ });
} catch (e) {
  const wrapped = AppError.from(e, "group/join-failed", "サークル加入に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code, joinCode: code, uid });
  throw wrapped;
}
await addGroupIdToUser(uid, codeDoc.gid);
logger.info("consume join code ok", { code, uid, gid: codeDoc.gid });
```

→ 改善 3a で旧コード delete が失敗しても **warn のみで throw しない**: 新コード発行は成功した状態で UX を阻害しない。

### REPOSITORY_PATTERN（zod converter + withConverter）

```ts
// SOURCE: src/lib/firebase/repositories/groupJoinCodes.ts:21-27
const groupJoinCodesRef = collection(firestore, "groupJoinCodes").withConverter(
  zodConverter(groupJoinCodeBodySchema, "groupJoinCodes"),
);
export function joinCodeDocRef(code: string) {
  return doc(groupJoinCodesRef, code);
}
```

→ 新規 `deleteJoinCode(code: string)` は既存 `joinCodeDocRef(code)` 経由で `deleteDoc` を呼ぶ。新コレクション参照は不要。

### SERVICE_PATTERN（assertOrganizer ロールゲート）

```ts
// SOURCE: src/lib/services/group.ts:325-329（setFinishedTournamentCount 末尾）
const group = await getGroup(gid);
assertOrganizer(group, uid);
await updateFinishedTournamentCount(gid, value);
logger.info("setFinishedTournamentCount ok", { gid, uid, value });
```

→ 改善 3a の `generateJoinCode` 拡張も `assertOrganizer` ゲートを通す（既に repository 側で rule enforce されるが、service 層でも二重防御）。

### CLEANUP_SCRIPT_PATTERN（admin SDK + dry-run + --only）

```ts
// SOURCE: scripts/cleanup-orphan-firestore.ts:84-93, 123-135
async function listAllAuthUids(): Promise<Set<string>> {
  const uids = new Set<string>();
  let pageToken: string | undefined;
  do {
    const result = await admin.auth().listUsers(1000, pageToken);
    for (const u of result.users) uids.add(u.uid);
    pageToken = result.pageToken;
  } while (pageToken);
  return uids;
}

async function main(): Promise<void> {
  const execute = process.argv.includes("--execute");
  const mode = execute ? "EXECUTE" : "DRY-RUN";
  // ... GOOGLE_APPLICATION_CREDENTIALS チェック
  admin.initializeApp({ credential: admin.credential.applicationDefault() });
  // ... 走査 → summary 出力 → !execute なら return → execute で実削除
}
```

→ 改善 3b の `cleanup-old-anonymous-users.ts` は同型: `listUsers` で paging しながら `UserRecord` を取り出し、`providerData.length === 0 && Date.parse(metadata.creationTime) < now - 7 days` でフィルタ。`admin.auth().deleteUsers([...uids])` を 1000 件 chunk で発行。

### TEST_STRUCTURE（vitest, repository / service）

```ts
// SOURCE: src/lib/firebase/repositories/groupJoinCodes.test.ts 等の vitest pattern
vi.mock("firebase/firestore", () => ({ /* mock SDK */ }));
vi.mock("@/lib/firebase/client", () => ({ firestore: {} }));

describe("createJoinCode", () => {
  it("retries on collision", async () => { /* ... */ });
});
```

→ 新規 `deleteJoinCode` / 改善された `generateJoinCode` も同じ pattern。Promise の reject 系（best-effort delete fail）も assert する。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/app/tournaments/new/tournament-new-client.tsx` | UPDATE | 改善 1: `defaultName` リテラル変更（1 行） |
| `src/app/tournaments/tournaments-client.tsx` | UPDATE | 改善 2: 自分の参加済み判定追加 + ボタンの label / variant 切替 |
| `src/lib/firebase/schemas/group.ts` | UPDATE | 改善 3a: `latestJoinCodeId: z.string().nullable().default(null)` を additive 追加 |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | 改善 3a: `updateLatestJoinCodeId(gid, code)` を新規追加（`wrapFirestoreWrite` 経由） |
| `src/lib/firebase/repositories/groupJoinCodes.ts` | UPDATE | 改善 3a: `deleteJoinCode(code: string)` を新規追加 |
| `src/lib/services/group.ts` | UPDATE | 改善 3a: `generateJoinCode` を拡張して prev コード delete + latestJoinCodeId 更新 |
| `firestore.rules` | UPDATE | 改善 3a: `groupJoinCodes` delete を `isOrganizer` に拡大 + `groups/{gid}` update に `latestJoinCodeId` 単独書換ブランチを additive 追加 |
| `scripts/cleanup-old-anonymous-users.ts` | CREATE | 改善 3b: 新規 admin script。`cleanup-orphan-firestore.ts` / `cleanup-test-auth-users.ts` を mirror |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | 改善 4: `finishTournament` tx の `tx.update(ref, {...})` に `spectateEnabled: false` を追加（1 フィールド） |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATE | 改善 4: `finishTournament` が `spectateEnabled: false` を tx 内で書込むこと（mock の `tx.update` 呼出 args）を assert |
| `package.json` | UPDATE | `cleanup:old-anonymous-users` npm script を追記 |
| `scripts/test-rules-latest-join-code.mjs` | CREATE | 改善 3a: emulator validator（`firebase emulators:exec` 経由） |
| `package.json` | UPDATE | `test:rules-latest-join-code` npm script を追記 |
| `src/lib/firebase/repositories/groupJoinCodes.test.ts` | UPDATE / CREATE | `deleteJoinCode` unit test を追加 |
| `src/lib/services/group.test.ts`（または専用 file） | UPDATE / CREATE | `generateJoinCode` で「旧コード delete が呼ばれる」「delete fail でも throw しない」を assert |
| `src/app/tournaments/tournaments-client.test.tsx`（任意・新規可） | CREATE | 改善 2 の「参加済み」表示分岐の vitest（getPlayer mock） |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | UPDATE | Implementation Phases に Track C / Phase C.1 を追記、Decisions Log に本 batch の意思決定を追加 |
| `.claude/rules/firebase-patterns.md` | UPDATE | 「`groups/{gid}` update の allowed-keys 一覧」に `latestJoinCodeId` 行を追加 |
| `.claude/rules/group-membership.md` | UPDATE | データモデル節に `latestJoinCodeId` を追記、招待コード設計原則に「再発行時 best-effort delete」を補足 |

## NOT Building

- **Cloud Functions / Cloud Scheduler を新規導入する**こと — プロジェクトに既存事例ゼロ。改善 3b は **既存 admin script パターンを踏襲**し、定期実行（GitHub Actions cron / 手動）は本 plan の範囲外（運用ドキュメント追記のみ）
- **匿名ユーザーの cleanup を即時化**すること — 1 週間 cutoff を維持し、ドライラン中のセッション継続を阻害しない。`attemptAnonymousSelfDelete` の即時 self-delete 経路はそのまま
- **改善 3b で `tournaments/{tid}/players/{uid}` を削除する**こと — 削除すると過去トーナメント参照時に以下が破壊される:
  - **参加者一覧**（`subscribePlayers(tid)` → players collection）: 該当 participant が消える
  - **WinnerBanner** ([dashboard-client.tsx:152](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L152)): `resolveWinner` が null を返し優勝者表示が消失
  - **結果シェアカード / OG image**: `winner.displayName` をクエリに乗せるため shareButton と DL ボタンが消える
  - **PlayersCard / AverageStackCard**: 参加者数カウントが減って嘘の数字に
  - **`seasonStats/{uid}`** は別 doc に snapshot 済みだが、player doc が消えると上記 4 経路の一次表示が全部壊れる。`attemptAnonymousSelfDelete` の即時経路で player を残す既存設計はこの理由で正しく、bulk cleanup もそれに揃える
- **改善 3b で `seasonStats/{uid}` / `seasonHistory` を削除する**こと — シーズンランキングの基礎データ。`displayName` は doc 内 snapshot 済みで Auth user 削除後も orphan stats として表示維持される
- **`attemptAnonymousSelfDelete`（即時 self-delete）の挙動を変更**すること — 既存設計（`users/{uid}` と Auth user のみ削除、player は履歴として残す）が正解。bulk cleanup も**同じデータセットを 7 日後の cutoff で削除する**だけの非対称（即時 vs 遅延）に留める
- **招待コード UI に「履歴」「複数 active」概念を導入**すること — `latestJoinCodeId` で「現在の active 1 件のみを追跡」する最小 model に留める
- **改善 2 で「観戦」「結果」等の別動線ボタンを追加**すること — 単に label / variant の切替に留め、`/live` への link 自体は維持する（受付確認 UX を `/live` に集約済みの設計を維持）
- **改善 1 で `[サークル名]トーナメント-X` 形式を運営者が選択的に復元できる UI**を追加すること — 単純な default 文字列変更に留め、設定可能化は YAGNI
- **改善 3a で organizer 以外（一般 member）にも招待コード delete を開放**すること — 既存の権限マトリクスを尊重し、issue 経路（organizer）に delete 経路を揃える
- **`cleanup-orphan-firestore.ts` に "old-anonymous" カテゴリを統合**すること — 責務分離（orphan 検知 vs. 古い匿名検知）と単独実行可能性を保つため別 script で分離
- **改善 4 で観戦モードの toggle 自体を終了済み tournament で禁止**すること — 終了後に運営者が確認用に再 ON したいケース（カード DL までの間など）の自由度を残し、デフォルト OFF 化に留める
- **改善 4 で `state=finished` 化された旧 tournament を遡及的に `spectateEnabled=false` に backfill** すること — migration なしの additive 変更で十分（既存運営者が手動で OFF できる UI が既にある）。データ衛生は週次 `cleanup-orphan-firestore.ts` で別途扱う

---

## Step-by-Step Tasks

### Task 1: 改善 1 — トーナメント名のデフォルトを `Tournament-No.X` に変更

- **ACTION**: `src/app/tournaments/new/tournament-new-client.tsx` の `defaultName` リテラルを変更
- **IMPLEMENT**:
  ```ts
  // before (line 32)
  return `[${g.name}]トーナメント-${g.finishedTournamentCount + 1}`;
  // after
  return `Tournament-No.${g.finishedTournamentCount + 1}`;
  ```
  併せてコメント（lines 24-27）を更新: 「`[サークル名]トーナメント-X`」→「`Tournament-No.X`」、Phase 4.16 由来文も「Phase 4.16 / dryrun-polish-batch」と追記
- **MIRROR**: 既存の `defaultSeatsPerTable` ロジック（lines 39-43）と同じ useMemo 構造を維持
- **IMPORTS**: 変更なし
- **GOTCHA**:
  - `g` が `undefined`（race / 切替直後）のときは `""` を返す既存のフォールバックを維持する
  - 既存サークルの `finishedTournamentCount` 値は変わらないため、ナンバリングは現状の連番を引き継ぐ
- **VALIDATE**:
  - `npm run typecheck` で type error なし
  - `npm run lint` で warn なし
  - 既存サークルで `/tournaments/new` を開くと name 欄に `Tournament-No.X` がプリフィルされる

### Task 2: 改善 1 — 既存 e2e / unit test で旧文字列を assert しているか確認・更新

- **ACTION**: `grep -rn "トーナメント-" tests/ src/` で旧リテラルの assert を洗い出す
- **IMPLEMENT**: assert があれば新リテラルに更新。なければスキップ
- **MIRROR**: -
- **IMPORTS**: -
- **GOTCHA**: e2e で `expect(input).toHaveValue("...")` 形式は要更新、ただの `getByLabel("名前")` 等は影響なし
- **VALIDATE**: `npm run test:watch -- --run` / `npx playwright test --grep "tournament|名前"` でグリーン

### Task 3: 改善 2 — 一覧 component に「参加済み」判定を追加

- **ACTION**: `src/app/tournaments/tournaments-client.tsx` で list fetch 完了後に、member（非 organizer）でかつ user がいるとき各 row の `players/{uid}` を Promise.all で取得し、`joinedTids: Set<string>` を state で持つ
- **IMPLEMENT**:
  ```ts
  // 追加 import
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { getPlayer } from "@/lib/firebase/repositories/players";

  // state
  const { user } = useAuthUser();
  const [joinedTids, setJoinedTids] = useState<Set<string>>(new Set());

  // 既存の listTournamentsByGroup 直後に追加
  if (!isOrganizer && user && list.length > 0) {
    const results = await Promise.allSettled(
      list.map((t) => getPlayer(t.id, user.uid).then((p) => (p ? t.id : null))),
    );
    if (!cancelled) {
      const next = new Set<string>();
      for (const r of results) {
        if (r.status === "fulfilled" && r.value) next.add(r.value);
      }
      setJoinedTids(next);
    }
  }

  // ボタンレンダリング箇所（line 184）の差替
  <Link href={`/tournaments/${t.id}/live`}>
    {isOrganizer ? (
      <Button size="sm">タイマー</Button>
    ) : joinedTids.has(t.id) ? (
      <Button
        size="sm"
        variant="outline"
        aria-label={`${t.name} の受付確認に戻る（参加済み）`}
      >
        参加済み
      </Button>
    ) : (
      <Button size="sm">参加する</Button>
    )}
  </Link>
  ```
- **MIRROR**: `/live` の `players.find((p) => p.uid === user.uid)` パターン（[live-client.tsx:97](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L97)）と同じ判定方針
- **IMPORTS**: `useAuthUser`, `getPlayer`
- **GOTCHA**:
  - `Promise.allSettled` を使い、個別 row の failure（権限・ネットワーク）で全 fetch が止まらないようにする
  - rejected は warn のみで握りつぶす — `logger.warn("joined check failed", { tid, code: getErrorCode(r.reason) })`
  - cancelled flag を確認してから setState（既存 useEffect の cleanup を踏襲）
  - 観戦モード（spectateEnabled）の anon 視聴では `user` が null になるため `joinedTids` は常に empty。新ボタン分岐は走らず既存 UX 維持
- **VALIDATE**:
  - `npm run typecheck` でグリーン
  - 手動: 自分が参加した tournament の row で「参加済み」表示、未参加の row で「参加する」表示
  - 手動: organizer 視点では従来通り「タイマー」表示

### Task 4: 改善 2 — vitest で「参加済み」表示の分岐を unit test

- **ACTION**: `src/app/tournaments/tournaments-client.test.tsx`（新規）で `getPlayer` / `listTournamentsByGroup` を mock し、render 結果に「参加済み」が出ることを assert
- **IMPLEMENT**:
  ```ts
  vi.mock("@/lib/firebase/repositories/players", () => ({
    getPlayer: vi.fn(),
  }));
  // tournaments mock も同様
  // member + getPlayer が non-null を返す row で "参加済み" がレンダリングされること
  ```
- **MIRROR**: 既存 component test（`src/app/tournaments/*.test.tsx` 等）の `vi.mock` 境界
- **IMPORTS**: `@testing-library/react` の `render` / `screen`
- **GOTCHA**: `useCurrentGroup` / `useAuthUser` も mock 必要（既存 component test の前例参照）
- **VALIDATE**: `npm run test:watch -- tournaments-client` でグリーン

### Task 5: 改善 3a — `groups/{gid}.latestJoinCodeId` を schema に additive 追加

- **ACTION**: `src/lib/firebase/schemas/group.ts` に `latestJoinCodeId: z.string().nullable().default(null)` を追加
- **IMPLEMENT**: 既存 `joinCodeId` フィールドの直下に追記（フィールド意味の対応関係を視覚的に明示）
- **MIRROR**: 既存 `joinCodeId` / `seasonStartDate` の zod 定義スタイル（nullable + default）
- **IMPORTS**: 変更なし
- **GOTCHA**:
  - 既存 doc は zod default で `null` として hydrate されるため migration 不要
  - `joinCodeId`（self-add consumption proof）と意味が異なる: `joinCodeId` は「最後に消費されたコード（rule 検証用）」、`latestJoinCodeId` は「最新発行コード（ライフサイクル管理用）」
- **VALIDATE**: `npm run typecheck` でグリーン、`group.test.ts` の schema 系テストでグリーン

### Task 6: 改善 3a — repository に `updateLatestJoinCodeId` と `deleteJoinCode` を追加

- **ACTION**:
  - `src/lib/firebase/repositories/groups.ts` に `updateLatestJoinCodeId(gid: string, code: string | null)` を追加（`wrapFirestoreWrite` 経由）
  - `src/lib/firebase/repositories/groupJoinCodes.ts` に `deleteJoinCode(code: string)` を追加（`wrapFirestoreWrite` 経由）
- **IMPLEMENT**:
  ```ts
  // groups.ts
  export async function updateLatestJoinCodeId(
    gid: string,
    code: string | null,
  ): Promise<void> {
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "招待コードポインタの更新に失敗しました",
      async () => {
        await updateDoc(groupDocRef(gid), { latestJoinCodeId: code });
      },
      { gid },
    );
    logger.info("update latestJoinCodeId ok", { gid, code });
  }

  // groupJoinCodes.ts
  export async function deleteJoinCode(code: string): Promise<void> {
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "招待コード削除に失敗しました",
      async () => {
        await deleteDoc(joinCodeDocRef(code));
      },
      { code },
    );
    logger.info("delete join code ok", { code });
  }
  ```
- **MIRROR**: 既存 `updateFinishedTournamentCount` / `updateDefaultSeatsPerTable`（groups.ts）と既存 `createJoinCode`（groupJoinCodes.ts）のシグネチャ
- **IMPORTS**: `deleteDoc` を firebase/firestore から追加
- **GOTCHA**: 単純な `wrapFirestoreWrite` ラッパー。rule 違反のときは `firestore/permission-denied` の `AppError` が伝播する
- **VALIDATE**: `npm run typecheck`、unit test（次タスク）

### Task 7: 改善 3a — service `generateJoinCode` を拡張して旧コードを best-effort delete

- **ACTION**: `src/lib/services/group.ts` の `generateJoinCode` を 4 ステップ化
- **IMPLEMENT**:
  ```ts
  export async function generateJoinCode({
    gid,
    createdByUid,
    expiresInDays = 7,
    maxUses = null,
  }: { /* 既存と同じ */ }): Promise<string> {
    if (!Number.isInteger(expiresInDays) || expiresInDays <= 0) {
      throw new AppError("expiresInDays must be a positive integer", "validation/invalid-input");
    }
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000));

    // 1. 既存 group を read（assertOrganizer + prev コード把握）
    const group = await getGroup(gid);
    assertOrganizer(group, createdByUid);
    const prev = group.latestJoinCodeId;

    // 2. 新規コード create
    const code = await createJoinCode({ gid, createdByUid, expiresAt, maxUses });

    // 3. groups doc の latestJoinCodeId を新コードに更新
    await updateLatestJoinCodeId(gid, code);

    // 4. 旧コードを best-effort delete（失敗しても新コード発行は成功扱い）
    if (prev && prev !== code) {
      try {
        await deleteJoinCode(prev);
      } catch (e) {
        logger.warn("previous join code delete failed", {
          code: getErrorCode(e),
          gid,
          prev,
        });
      }
    }
    return code;
  }
  ```
  併せて defaultExpiresAt の void 参照（`void defaultExpiresAt;`）は元のまま残す（既存の dead-import 抑制）。
- **MIRROR**: `consumeJoinCode` の「validation → assertion → tx → 後続書込」パターン（[group.ts:99-170](../../../../src/lib/services/group.ts#L99-L170)）。後続書込が失敗しても主処理は成功させる方針も同じ
- **IMPORTS**: `getGroup`, `assertOrganizer`, `updateLatestJoinCodeId`, `deleteJoinCode`, `getErrorCode`
- **GOTCHA**:
  - `assertOrganizer` を service 層で再 enforce することで、rule deploy 前の dev 環境でも安全
  - `prev === code` の同値チェックは「衝突 retry で同コードが偶然採用される」前提のない防御
  - logger.warn の `code` フィールドは AppError の `code`（`firestore/permission-denied` 等）を表す。`prev` プロパティ名と被るので順序注意
- **VALIDATE**: unit test（次タスク）+ 手動 e2e（招待コード発行 → 旧 QR がアクセス不能になることを確認）

### Task 8: 改善 3a — Firestore rules を更新（delete を organizer に拡大 + latestJoinCodeId 単独書換ブランチを追加）

- **ACTION**: `firestore.rules` を 2 箇所更新
- **IMPLEMENT**:
  ```
  // 1. groupJoinCodes delete を isOrganizer に拡大（既存は isOwner）
  match /groupJoinCodes/{code} {
    // ... 既存の allow get / list / create / update
    allow delete: if isSignedIn()
                  && isOrganizer(resource.data.gid);  // ← isOwner から変更
  }

  // 2. groups/{gid} update に latestJoinCodeId 単独書換ブランチを additive 追加（Phase E の seasonPointsRule branch の直下）
  ) || (
    // Phase C.1 (05-post-launch-polish Track C): organizer による latestJoinCodeId の単独書換。
    //   `generateJoinCode` service が新規コード発行直後に呼び出す。
    //   affectedKeys は 'latestJoinCodeId' のみに限定。他フィールドは触らせない。
    //   string か null のみ許可。
    isOrganizer(gid)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['latestJoinCodeId'])
    && (
      request.resource.data.latestJoinCodeId == null
      || request.resource.data.latestJoinCodeId is string
    )
  )
  ```
- **MIRROR**:
  - delete 拡大: `Phase 4.6` で role を 3 階層化したときと同じ pattern（[firebase-patterns.md](../../../../.claude/rules/firebase-patterns.md) の権限マトリクスに整合させる）
  - update branch additive: Phase 4.16 の `finishedTournamentCount` / Phase 4.17 の `defaultSeatsPerTable` / Phase A の `seasonStartDate` / Phase E の `seasonPointsRule` と同じ pattern
- **IMPORTS**: -
- **GOTCHA**:
  - delete を `isOrganizer` に widen することで「organizer が他人発行のコードも消せる」変更だが、`generateJoinCode` 経路で `assertOrganizer` 必須なので **issue 経路と delete 経路の権限が揃う**整合性向上として扱う
  - 既存の owner-only delete UI は無いため UX への影響なし
  - `latestJoinCodeId` を `joinCodeId`（self-add consumption proof）と取り違えないこと: 別フィールド・別ブランチで管理
- **VALIDATE**:
  - 次タスクの emulator validator で deny / allow ケースを網羅
  - `firebase deploy --only firestore:rules` を本番 deploy（**完了報告時に必須**）

### Task 9: 改善 3a — emulator validator を作成（`scripts/test-rules-latest-join-code.mjs`）

- **ACTION**: `firebase emulators:exec` 経由で起動する validator script を新規作成
- **IMPLEMENT**:
  ```js
  // scripts/test-rules-latest-join-code.mjs
  // 1. organizer (= owner) で groups/{gid} に latestJoinCodeId='abc' を update → allow
  // 2. organizer で latestJoinCodeId と name を同時 update → deny (affectedKeys hasOnly 違反)
  // 3. member（非 organizer）で latestJoinCodeId='abc' を update → deny
  // 4. organizer で latestJoinCodeId=123（int）を update → deny (型違反)
  // 5. organizer で groupJoinCodes/{code} を delete → allow（旧 owner-only から拡大）
  // 6. member で groupJoinCodes/{code} を delete → deny
  ```
  既存 `scripts/test-rules-*.mjs`（特に `test-rules-finished-count.mjs` / `test-rules-default-seats.mjs`）を直接 mirror。
- **MIRROR**: `scripts/test-rules-default-seats.mjs` の構造（emulator initialize → seed → assert allow/deny）
- **IMPORTS**: `@firebase/rules-unit-testing` + `firebase-admin`（既存 validator と同じ）
- **GOTCHA**:
  - emulator は project id `allin-pokertimer-e2e` で起動（既存 npm script の慣例）
  - `package.json` に `"test:rules-latest-join-code": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-latest-join-code.mjs\""` を追加
- **VALIDATE**: `npm run test:rules-latest-join-code` でグリーン

### Task 10: 改善 3a — `generateJoinCode` の unit test を追加

- **ACTION**: `src/lib/services/group.test.ts`（または専用 file）に `generateJoinCode` のテストを追加
- **IMPLEMENT**:
  ```ts
  describe("generateJoinCode", () => {
    it("creates new code and updates latestJoinCodeId", async () => {
      // getGroup mock: latestJoinCodeId: "old123" を返す
      // createJoinCode mock: "new456" を返す
      // updateLatestJoinCodeId mock: assert called with (gid, "new456")
      // deleteJoinCode mock: assert called with "old123"
    });
    it("does not call deleteJoinCode if prev is null", async () => { /* ... */ });
    it("succeeds even if deleteJoinCode rejects", async () => {
      // deleteJoinCode を rejects に → 全体は resolved with new code
      // logger.warn が呼ばれたこと assert
    });
    it("does not delete when prev === new (collision retry edge)", async () => { /* ... */ });
    it("rejects with validation error when expiresInDays <= 0", async () => { /* ... */ });
  });
  ```
- **MIRROR**: 既存 `group.test.ts` の `consumeJoinCode` / `setFinishedTournamentCount` テスト構造
- **IMPORTS**: `vi.mock` で `getGroup` / `createJoinCode` / `updateLatestJoinCodeId` / `deleteJoinCode` をモック
- **GOTCHA**: `logger.warn` の assert は `vi.spyOn(logger, "warn")` 経由（console.* 直 assert 禁止）
- **VALIDATE**: `npm run test:watch -- group` でグリーン

### Task 11: 改善 3a — `deleteJoinCode` の unit test を追加

- **ACTION**: `src/lib/firebase/repositories/groupJoinCodes.test.ts`（既存 / 新規）に `deleteJoinCode` のテストを追加
- **IMPLEMENT**:
  ```ts
  describe("deleteJoinCode", () => {
    it("calls deleteDoc with the correct ref", async () => { /* ... */ });
    it("wraps errors as firestore/write_failed", async () => { /* ... */ });
  });
  ```
- **MIRROR**: 既存 `createJoinCode` テストの mock 境界（firebase/firestore を vi.mock）
- **IMPORTS**: -
- **GOTCHA**: -
- **VALIDATE**: `npm run test:watch -- groupJoinCodes` でグリーン

### Task 12: 改善 3b — `scripts/cleanup-old-anonymous-users.ts` を新規作成

- **ACTION**: 既存 `cleanup-orphan-firestore.ts` と `cleanup-test-auth-users.ts` を mirror して新規 script を作成
- **IMPLEMENT**:
  ```ts
  #!/usr/bin/env tsx
  /**
   * Cleanup script: 作成から N 日 (default 7) 以上経過した匿名 Auth ユーザーと
   * 連動する `users/{uid}` doc を削除する。
   *
   * 削除対象:
   *   1. `users/{uid}` doc — 該当 user の Firestore プロフィール
   *   2. Firebase Auth user — `admin.auth().deleteUsers([...])` で 1000 件 chunk batch 削除
   *
   * 意図的に保持するデータ（過去トーナメント参照時に displayName snapshot で表示が維持される必要があるため）:
   *   - `tournaments/{tid}/players/{uid}` — 過去トーナメントの参加者一覧 / WinnerBanner /
   *     結果シェアカード / OG image / PlayersCard / AverageStackCard が依存
   *     （`attemptAnonymousSelfDelete` の即時経路と同じ「履歴を残す」設計を 7 日後 cutoff にも適用）
   *   - `groups/{gid}/seasonStats/{uid}` — シーズンランキングの基礎。displayName は doc 内 snapshot 済み
   *   - `groups/{gid}/seasonHistory/{seasonId}.entries[]` — append-only / 改竄禁止 rule
   *
   * そもそも対象外（匿名ユーザーが触らない）:
   *   - `groups/{gid}.memberUids` / `memberDisplayNames` — 招待コード加入経路を通らない
   *
   * 完全に親 tournament が消えた orphan player は将来的に `cleanup-orphan-firestore.ts` Step 3 が拾う
   * （責務分離: 本 script は Auth lifecycle、orphan-firestore は親子整合）。
   *
   * Usage:
   *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
   *     npm run cleanup:old-anonymous-users
   *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
   *     npm run cleanup:old-anonymous-users -- --execute
   *   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
   *     npm run cleanup:old-anonymous-users -- --days=14 --execute
   */
  import admin from "firebase-admin";

  const DEFAULT_AGE_DAYS = 7;

  function parseDays(argv: string[]): number {
    const arg = argv.find((a) => a.startsWith("--days="));
    if (!arg) return DEFAULT_AGE_DAYS;
    const n = Number.parseInt(arg.slice("--days=".length), 10);
    if (!Number.isFinite(n) || n <= 0) {
      console.error(`invalid --days value: ${arg}`);
      process.exit(1);
    }
    return n;
  }

  async function main() {
    const execute = process.argv.includes("--execute");
    const ageDays = parseDays(process.argv);
    const cutoff = Date.now() - ageDays * 24 * 60 * 60 * 1000;
    const mode = execute ? "EXECUTE" : "DRY-RUN";

    if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
      console.error("ERROR: GOOGLE_APPLICATION_CREDENTIALS is not set.");
      process.exit(1);
    }
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
    const db = admin.firestore();
    const projectId = admin.app().options.projectId || "(unknown)";

    console.log(`[cleanup-old-anonymous-users] mode=${mode} project=${projectId} ageDays=${ageDays}`);

    // 1. 全 Auth user を paging で取得し、匿名 + N 日超を抽出
    const targets: { uid: string; createdAt: string }[] = [];
    let pageToken: string | undefined;
    let totalScanned = 0;
    do {
      const res = await admin.auth().listUsers(1000, pageToken);
      for (const u of res.users) {
        totalScanned++;
        if (u.providerData.length > 0) continue; // 匿名判定: provider 連携無し
        const createdAtMs = Date.parse(u.metadata.creationTime);
        if (!Number.isFinite(createdAtMs)) continue;
        if (createdAtMs >= cutoff) continue;
        targets.push({ uid: u.uid, createdAt: u.metadata.creationTime });
      }
      pageToken = res.pageToken;
    } while (pageToken);

    console.log(`  scanned auth users: ${totalScanned}`);
    console.log(`  matched (anonymous, older than ${ageDays} days): ${targets.length}`);
    for (const t of targets) {
      console.log(`    ${t.uid}  createdAt=${t.createdAt}`);
    }

    if (!execute) {
      console.log("\n[dry-run] no deletion performed. re-run with --execute to delete.");
      console.log("  preserved: tournaments/{tid}/players/{uid} / seasonStats / seasonHistory");
      return;
    }

    // 2. EXECUTE: users → Auth の順で削除
    let okUsers = 0, failUsers = 0;
    for (const t of targets) {
      try {
        await db.collection("users").doc(t.uid).delete();
        okUsers++;
      } catch (e) {
        failUsers++;
        console.error(`  users doc delete failed: uid=${t.uid} reason=${(e as Error).message}`);
      }
    }

    let okAuth = 0, failAuth = 0;
    const CHUNK = 1000;
    for (let i = 0; i < targets.length; i += CHUNK) {
      const chunk = targets.slice(i, i + CHUNK).map((t) => t.uid);
      const res = await admin.auth().deleteUsers(chunk);
      okAuth += res.successCount;
      failAuth += res.failureCount;
      for (const err of res.errors) {
        console.error(`  auth delete failed: uid=${chunk[err.index]} reason=${err.error.message}`);
      }
    }

    console.log("\n========== done ==========");
    console.log(`  users doc deleted: ${okUsers} ok / ${failUsers} failed`);
    console.log(`  auth deleted: ${okAuth} ok / ${failAuth} failed`);
    console.log("  preserved (intentional): tournaments/{tid}/players/{uid} / seasonStats / seasonHistory");
    console.log("  note: 親 tournament が削除された orphan player は cleanup-orphan-firestore.ts で別途整理されます");
  }

  main().catch((e) => {
    console.error("[cleanup-old-anonymous-users] fatal:", e);
    process.exit(1);
  });
  ```
- **MIRROR**: `scripts/cleanup-orphan-firestore.ts` の dry-run / --execute、`scripts/cleanup-test-auth-users.ts` の `deleteUsers` 経路
- **IMPORTS**: `firebase-admin`（既存 dev dep）
- **GOTCHA**:
  - `metadata.creationTime` は ISO8601 文字列 — `Date.parse` でパース
  - `providerData.length === 0` が匿名判定の正攻法（Google ログインの user は length >= 1）
  - **player doc は意図的に削除しない**: 過去トーナメントの参加者一覧 / WinnerBanner / 結果シェアカードがすべて `players` collection と `displayName` snapshot に依存しているため。削除すると **`/tournaments/{tid}` 参照時に参加者が消え、優勝者表示が消え、結果カード DL ボタンが消える**
  - 削除順序の根拠: `users` → `Auth` の順。Auth 先行だと「Auth uid → Firestore docs の運用ログ追跡」が一貫しなくなる
  - `groups/{gid}` の dangling refs は匿名ユーザーには発生しない（招待コード加入経路を通らない）。通常アカウントの orphan は引き続き `cleanup-orphan-firestore.ts` に委譲
- **VALIDATE**: 開発環境で `cleanup:old-anonymous-users` を dry-run で実行 → 想定数の匿名ユーザーが target として列挙される。`--execute` 後に過去トーナメントを開いて参加者一覧 / WinnerBanner / 結果カードが**そのまま表示維持される**ことを手動確認

### Task 13: 改善 3b — `package.json` に npm script を追加

- **ACTION**: `cleanup:old-anonymous-users` を `cleanup:orphan-firestore` の直下に追記
- **IMPLEMENT**:
  ```json
  "cleanup:old-anonymous-users": "tsx scripts/cleanup-old-anonymous-users.ts",
  ```
- **MIRROR**: 既存 `cleanup:orphan-firestore` / `cleanup:test-auth-users` と同型
- **IMPORTS**: -
- **GOTCHA**: -
- **VALIDATE**: `npm run cleanup:old-anonymous-users` がエラー無しで dry-run 開始

### Task 14: 改善 4 — `finishTournament` tx で `spectateEnabled: false` を additive 書込

- **ACTION**: `src/lib/firebase/repositories/tournaments.ts` の `finishTournament` 内、tx の `tx.update(ref, {...})` 部分（lines 804-809）に `spectateEnabled: false` を additive 追加
- **IMPLEMENT**:
  ```ts
  tx.update(ref, {
    state: "finished",
    finishedAt: serverTimestamp(),
    pausedAt: null,
    // Phase C.1: 終了と同時に観戦 URL を自動 OFF。toggle 忘れによる
    // 終了済み tournament の anon 公開放置を防ぐ。冪等（既に false でも no-op 相当）。
    // 運営者は終了後に SpectateModeCard で再 ON にできる UX を維持。
    spectateEnabled: false,
    updatedAt: serverTimestamp(),
  });
  ```
- **MIRROR**: 同 tx 内の `finishedTournamentCount: increment(1)` のような「terminal 状態への additive 書込」スタイル
- **IMPORTS**: 変更なし
- **GOTCHA**:
  - rule は既存の broad `allow update: if isOrganizer(resource.data.groupId)` で許可済み（`firestore.rules:492`）。新ブランチは不要
  - tournament schema（`tournaments.spectateEnabled`）は `.default(false)` で旧 doc も hydrate 済みのため、追加フィールドではなく既存フィールドへの上書き
  - `setSpectateEnabled` service（`src/lib/services/tournament.ts:24`）は別経路で残す。dashboard の手動 toggle は既存通り動作
  - 04-spectate-mode PRD の rule 設計（[firebase-patterns.md](../../../../.claude/rules/firebase-patterns.md) の「`tournaments/{tid}` 単独書換ブランチ」）と整合: 手動 toggle は narrow ブランチ B、自動 OFF は broad ブランチ A 経由
- **VALIDATE**:
  - `npm run typecheck` グリーン
  - 新規 unit test（次タスク）で tx 書込内容を assert
  - 手動: 観戦 ON 状態のトーナメントを終了 → dashboard の SpectateModeCard が「無効」表示に切り替わる / `/spectate/[tid]` を anon ブラウザで開くと permission-denied で表示できない

### Task 15: 改善 4 — `finishTournament` の unit test を更新

- **ACTION**: `src/lib/firebase/repositories/tournaments.test.ts` の `finishTournament` 関連テストに「tx.update が `spectateEnabled: false` を含めて呼ばれる」assert を追加
- **IMPLEMENT**:
  ```ts
  it("auto-disables spectateEnabled on finish", async () => {
    // ... 既存の setup（tournament fixture / tx mock）
    await finishTournament("t1", "uOrg", ["g1"]);
    expect(txUpdateMock).toHaveBeenCalledWith(
      expect.anything(), // ref
      expect.objectContaining({
        state: "finished",
        spectateEnabled: false,
      }),
    );
  });
  ```
  既存の「state finished で no-op return」「二重 finish race」「seasonStats 増分」テストはそのまま動くこと（spectateEnabled は additive のため既存 assert を壊さない）
- **MIRROR**: 既存 `tournaments.test.ts` の `finishTournament` describe ブロック
- **IMPORTS**: 既存 mock を流用
- **GOTCHA**: tx の `update` は mock 化されているため、固定の mock 関数経由で arg を assert する
- **VALIDATE**: `npm run test:watch -- tournaments` グリーン

### Task 16: PRD 05 を更新（Implementation Phases / Decisions Log）

- **ACTION**: `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` を更新
- **IMPLEMENT**:
  - **Track C: Dryrun Feedback Bundle** を Track A / B の隣に追記。Description として「ドライラン投入直後に挙がった改善要望の集約 Track。各 Phase は複数の小規模改善を 1 PR に bundle して扱う」
  - **Phase C.1** を Implementation Phases 表に追加（status: pending、PRP Plan は本 plan ファイル）
  - **Phase Details** に C.1 の Goal / Scope / Success signal を追記
  - **Decisions Log** に以下を追加:
    - 「Track C を独立 Track として追加した理由」
    - 「招待コード再発行時の旧 code 自動 delete を `latestJoinCodeId` 追跡で実現した理由」
    - 「匿名 Auth クリーンアップを Cloud Functions ではなく admin script で実装する理由」
    - 「join code delete rule を owner から organizer に widening する理由」
- **MIRROR**: Track A / B の記述構造
- **IMPORTS**: -
- **GOTCHA**: PRD 末尾の Status 行を「Track A complete / Track B Phase B.1 complete / Track C Phase C.1 in-progress」に更新
- **VALIDATE**: Markdown lint なし。PRD 内の internal link がすべて解決する

### Task 17: rule ファイル（`.claude/rules/`）を更新

- **ACTION**: 2 ファイル更新
- **IMPLEMENT**:
  - [`firebase-patterns.md`](../../../../.claude/rules/firebase-patterns.md) の「`groups/{gid}` update の allowed-keys 一覧」表に **latestJoinCodeId update**（Phase C.1）行を追加。条件は「organizer + `affectedKeys.hasOnly(['latestJoinCodeId'])` + `string | null`」
  - [`group-membership.md`](../../../../.claude/rules/group-membership.md) のデータモデル節（`groups/{gid}` フィールド一覧）に `latestJoinCodeId` を追記。意味は「最新発行招待コードへのポインタ（再発行時の旧 code best-effort delete に使う、`joinCodeId` とは別フィールド）」
  - 同 file の「招待コード設計原則」末尾に「**再発行時の旧コード処理**: `generateJoinCode` は service 層で `latestJoinCodeId` を経由して旧コードを best-effort delete する。delete 失敗時は `cleanup-orphan-firestore.ts --only=joinCodes` で最終的に整理される」を追記
- **MIRROR**: 既存表の行スタイル（`finishedTournamentCount update` / `defaultSeatsPerTable update`）
- **IMPORTS**: -
- **GOTCHA**: rule ファイルは「真実源」のため、コード実装と必ず**同 commit で更新**する（実装と説明の drift を防ぐ）
- **VALIDATE**: 該当箇所が更新済み

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `defaultName` 組立（改善 1） | `g.name="A", finishedTournamentCount=2` | `"Tournament-No.3"`（サークル名非依存） | No |
| 一覧 "参加済み" 表示（改善 2） | member + tournaments[0] に自分が登録済み | Button text = "参加済み"、variant = "outline" | Yes |
| 一覧 "参加する" 表示（改善 2） | member + tournaments[0] に自分は未登録 | Button text = "参加する" | No |
| 一覧 "タイマー" 表示（改善 2） | organizer | Button text = "タイマー"（getPlayer は呼ばない） | Yes |
| `generateJoinCode` 旧コード delete | prev=`"old"`, new=`"new"` | `deleteJoinCode("old")` が呼ばれる | No |
| `generateJoinCode` prev=null | prev=null | `deleteJoinCode` は呼ばれない | Yes |
| `generateJoinCode` delete 失敗 | `deleteJoinCode` reject | 全体は new code で resolve、warn ログが出る | Yes |
| `generateJoinCode` 同値 collision | prev === new | `deleteJoinCode` は呼ばれない | Yes |
| `deleteJoinCode` 呼出形 | `code="abc"` | `deleteDoc(joinCodeDocRef("abc"))` 1 回 | No |
| `deleteJoinCode` rule deny | mock で reject | `AppError("firestore/write_failed", ...)` を throw | Yes |
| `cleanup-old-anonymous-users` (dry-run 単体テスト省略可) | listUsers mock で混合データ | 匿名かつ 7 日超のみが target に入る | Yes |
| `finishTournament` で spectateEnabled OFF（改善 4） | tournament: state="running", spectateEnabled=true | tx.update args に `state: "finished"` + `spectateEnabled: false` が含まれる | No |
| `finishTournament` で既に OFF（改善 4） | tournament: spectateEnabled=false | tx.update args の `spectateEnabled: false` は無条件で書込（冪等） | Yes |
| `finishTournament` race（改善 4） | 別端末が先に finished | tx 内 isFinished で早期 return、spectateEnabled 書込なし | Yes |

### Edge Cases Checklist

- [ ] 改善 1: `g.name === ""`（空 group 名）でも `Tournament-No.X` が綺麗に出る
- [ ] 改善 1: `finishedTournamentCount === 0`（初回作成）で `Tournament-No.1` になる
- [ ] 改善 2: 観戦モード anon 視聴では `user === null` で「参加済み」分岐に入らない（既存 UX 維持）
- [ ] 改善 2: `getPlayer` が permission-denied で reject しても他 row の表示は壊れない
- [ ] 改善 2: tournament が 0 件のときの空 list 表示は変わらない
- [ ] 改善 3a: 招待コード初回発行（prev=null）でも正常に発行できる
- [ ] 改善 3a: 旧コード delete が permission-denied / network error で失敗しても新コードは有効
- [ ] 改善 3a: rule deploy 前のクライアントが update 試行 → `firestore/permission-denied` で警告（dev 環境のみ想定）
- [ ] 改善 3b: 匿名と認証済みが混在する Auth で、認証済みは絶対に削除されない
- [ ] 改善 3b: `metadata.creationTime` がパース失敗する user は skip（不正データで script が止まらない）
- [ ] 改善 3b: `--days=14` 指定で 14 日 cutoff が効く
- [ ] 改善 3b: 匿名ユーザーの `tournaments/{tid}/players/{uid}` は意図的に残る（過去トーナメント参照時に参加者一覧 / WinnerBanner / 結果カードが displayName で表示維持）
- [ ] 改善 3b: 匿名ユーザーの `seasonStats/{uid}` も意図的に残る（シーズンランキングに displayName 付きで残存）
- [ ] 改善 3b: 通常アカウント（Google / Email）の users doc は誤って削除されない
- [ ] 改善 3b: 参加履歴のない匿名ユーザー（受付前に sign in だけして離脱）も Auth + users doc が削除される
- [ ] 改善 4: 観戦 ON → 終了 → SpectateModeCard が「無効」に切り替わる
- [ ] 改善 4: 観戦 OFF のまま終了しても tx エラーや warn が出ない（冪等）
- [ ] 改善 4: 終了後に運営者が SpectateModeCard で再 ON にできる（手動 toggle の自由度は維持）
- [ ] 改善 4: 終了済み既存 tournament の `spectateEnabled` 値はそのまま（遡及 backfill しない方針が UX を阻害しない）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors（とくに改善 3a で `latestJoinCodeId` が `string | null` として全箇所で使われていること）

```bash
npm run lint
```

EXPECT: Zero warnings

### Unit Tests

```bash
npm run test:watch -- --run
```

EXPECT: 既存 全 green + 新規追加分（generateJoinCode / deleteJoinCode / tournaments-client / defaultName）全 green

### Firestore Rules emulator

```bash
npm run test:rules-latest-join-code
npm run test:rules-limits
```

EXPECT: 双方 green。新規 latest-join-code validator が 6 ケース全 allow/deny を網羅

### Build

```bash
npm run build
```

EXPECT: Next.js build 成功

### E2E

```bash
npx playwright test
```

EXPECT: 全 spec green。改善 1 の name デフォルトに依存する spec があれば更新済み

### Cleanup Script Dry-run

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json \
  npm run cleanup:old-anonymous-users
```

EXPECT: dry-run output に「scanned: N / matched: M」が表示される。`--execute` 無しでは何も削除されない

### Manual Validation

- [ ] 新規トーナメント作成画面で name input が `Tournament-No.X` でプリフィルされる
- [ ] member 視点の一覧画面で、参加済み tournament が「参加済み」（outline）表示
- [ ] organizer 視点では従来通り「タイマー」表示
- [ ] サークル詳細画面で招待コードを再発行 → 旧 QR の URL を踏むと「招待コードが無効です」と表示される
- [ ] dry-run で `cleanup-old-anonymous-users` が想定数の匿名 user を列挙する
- [ ] 観戦 ON 状態のトーナメントを「終了」操作 → dashboard の SpectateModeCard が「無効」表示に切り替わり、anon ブラウザで `/spectate/[tid]` が permission-denied になる

### Firestore Rules Deploy

```bash
firebase deploy --only firestore:rules
```

EXPECT: deploy 成功。**完了報告に必須**（emulator green でも本番 deploy 忘れで permission-denied する罠）

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` グリーン
- [ ] vitest 全 green
- [ ] `npm run test:rules-latest-join-code` グリーン
- [ ] Playwright e2e 全 green（改善 1 の文字列依存 spec は更新済み）
- [ ] `firebase deploy --only firestore:rules` 実行完了
- [ ] 手動: トーナメント新規作成画面 / 一覧画面 / 招待コード再発行が UX 設計通り動作
- [ ] `cleanup:old-anonymous-users` の dry-run が想定通り動作
- [ ] PRD 05 が更新済み（Track C / Phase C.1 / Decisions Log）
- [ ] `.claude/rules/firebase-patterns.md` / `.claude/rules/group-membership.md` が更新済み

## Completion Checklist

- [ ] コードは既存パターンに従っている（`wrapFirestoreWrite` / `AppError.from` / `logger.info|warn` 経由）
- [ ] error handling は AppError ベース、`console.*` 直呼出なし
- [ ] logging は `logger.*` 経由、適切な level
- [ ] 新規 test は characterization test ファースト方針に沿っている
- [ ] hardcoded value なし（`Tournament-No.` は意図的 literal で OK）
- [ ] 不要な scope 追加なし（NOT Building セクションに記載通り）
- [ ] 実装と test が同 commit にペアでマージされる（[testing.md](../../../../.claude/rules/testing.md) 規約）
- [ ] PR description に「ドライランフィードバック batch 1」「rule 拡張あり」「admin script 追加」を明記
- [ ] PRD 05 と rule ファイルが同 PR で更新済み

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 改善 1: e2e で旧文字列を assert している spec が落ちる | M | L | Task 2 で grep で先回り検出・修正 |
| 改善 2: 一覧 row 数が多いとき `Promise.allSettled(getPlayer × N)` で fetch 量が増える | L | L | サークル規模が 6 卓・月 1〜2 回スケールなので無視可能。Firestore は client cache が効く |
| 改善 2: rule の `players` read が member 全員に開かれている前提が間違っている | L | M | `firestore.rules:498-507` で確認済み（signed-in は全 player read 可） |
| 改善 3a: rule deploy 前にクライアント先行 deploy で `latestJoinCodeId` update が permission-denied | M | M | rule deploy を**先**に実施し、その後 Vercel deploy。完了チェック項目に明記 |
| 改善 3a: 旧コード delete が rule で deny されると generateJoinCode 全体が止まる | L | H | 必ず try-catch で warn のみに倒し、generateJoinCode 自体は成功させる設計（Task 7 明記） |
| 改善 3a: `joinCodeId`（既存）と `latestJoinCodeId`（新規）の混同 | M | M | コメントで意味の違いを明示、group-membership.md / firebase-patterns.md にも追記 |
| 改善 3b: admin script の手動実行を忘れて Auth が肥大化し続ける | M | L | README に「週 1 回手動実行を推奨」を追記、ドライラン後に GitHub Actions cron 化を検討（本 plan 範囲外） |
| 改善 3b: 匿名 self-delete を期待する既存ロジック（`attemptAnonymousSelfDelete`）と二重削除が発生 | L | L | 既に削除済みの uid を `deleteUsers` に渡しても `auth/user-not-found` で個別エラー化されるだけ（全体は成功） |
| 改善 3b: `players` / `seasonStats` を残すことで「シーズンランキングや過去トーナメントに knowonly 名前」が残る UX 違和感 | L | L | 匿名 displayName はゲスト名（運営者が事前承認した名前）であり、orphan 化しても元々の表示と同じ。気になる場合は運営者が「シーズンを開始する」で seasonStats reset、`/tournaments/{tid}` 削除で players 削除（cascade）が可能 |
| 改善 3b: `cleanup-orphan-firestore.ts` Step 6（orphan users 検知）と重複削除 | M | L | 既存 script は「Auth に存在しない uid を持つ users doc」を消すため、本 script で先に users を消すと orphan-firestore で「もう存在しない」状態になり no-op になる。冪等で問題なし |
| 改善 4: 終了済み tournament の観戦 anon read を期待していたユーザー（結果カード共有導線等）が混乱 | L | L | 結果カード共有は `/share/winner/...` 経路で独立しており観戦 toggle に依存しない。運営者が手動で再 ON にできる UX を維持 |
| 改善 4: 既存 tournament finish の e2e で `tx.update` の args 一致を厳密 assert しているテストが壊れる | M | L | additive フィールド追加なので `objectContaining` 形式の assert なら壊れない。`toEqual` 厳密一致を使っているテストがあれば Task 15 で同時更新 |
| 改善 4: tournament schema の `spectateEnabled` field が存在しない旧 doc で tx.update が失敗 | L | L | schema は `.default(false)` で hydrate 済み + tournaments collection の write は organizer 全フィールド許可のため、`update` で field を**作る**書込も許容される |

## Notes

- 改善 1 / 2 / 4 は実質「label 文字列の変更」「条件分岐 1 つの追加」「tx update に 1 フィールド追加」で軽量。3a / 3b は schema / rule / service / script に波及する。**実装順序は 1 → 2 → 4 → 3b → 3a を推奨**: 改善 3a は rule deploy が必要で本番反映が一番遅く、改善 3b は admin script のため本番影響ゼロで先に commit できる。改善 4 は rule 変更なし（broad organizer update で許可済み）のため軽い変更として先回りできる
- 改善 3a の代替案として「`latestJoinCodeId` トラッキングを諦め、`cleanup-orphan-firestore.ts --only=joinCodes` の定期実行で expired を清掃する」案もあった。ユーザー要望が **「作成時に削除する」** 明示なので採用しなかった
- 改善 3b の代替案として「Cloud Functions / Cloud Scheduler で daily 自動実行」案もあった。プロジェクトに既存事例ゼロ + Blaze プラン依存（Storage で既に移行済みなのでコスト追加は限定的だが）+ 監視の追加コストで現時点では admin script + 手動運用が現実的と判断
- **改善 3b で削除するデータの境界線**: Firebase Authentication と Firestore のうち、**参照価値が無くなった orphan のみ**を消す。
  - **削除する**: `users/{uid}`（プロフィール doc。Auth user が消えれば誰も参照しない orphan）/ Firebase Auth user 本体
  - **削除しない（参照価値あり）**:
    - `tournaments/{tid}/players/{uid}` — 過去トーナメント参照時に参加者一覧 / WinnerBanner / 結果シェアカード / OG image / PlayersCard / AverageStackCard が `displayName` snapshot で表示維持される
    - `groups/{gid}/seasonStats/{uid}` — シーズンランキングの基礎データ、displayName は doc 内 snapshot 済み
    - `groups/{gid}/seasonHistory/{seasonId}.entries[]` — append-only / 改竄禁止 rule
  - **そもそも該当しない**: `groups/{gid}.memberUids` / `memberDisplayNames`（匿名ユーザーは招待コード経路を通らないため最初から無関係）
- `attemptAnonymousSelfDelete`（即時 self-delete）の既存設計（`users/{uid}` + Auth user のみ削除、player は履歴として残す）は**そのまま維持**し、bulk cleanup も**同じデータセット**を 7 日後 cutoff で削除するだけの「タイミング非対称」に留める。両経路の削除対象を一致させることで「即時には残るのに 1 週間経つと消える」UX の不一致を回避
- メモリ規約により、Firestore Rules 変更を含む本 plan の **完了報告には `firebase deploy --only firestore:rules` の実行をチェック項目として必ず含める**
- ユーザー向けメッセージに「Firebase Auth」「Firestore」等の技術スタック名を露出させない方針（memory）。AppError の message は内部実装に閉じ込め、UI に出すときは `formatErrorForDisplay` 経由で日本語化済みであることを確認する
