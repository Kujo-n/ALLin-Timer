# Plan: Phase 2 — 受付フロー統合（トーナメント受付によるサークル自動所属）

## Summary

Phase 1 で用意した `joinGroupViaTournament`（rule ブランチ + service）を、実際の受付フロー
[receipt.ts](../../../../src/lib/services/receipt.ts) の 3 経路（Google / 既存ログイン / ログイン済み継続）に接続する。
`joinAsGuest`（匿名）には**接続しない**。自動所属は best-effort で、失敗しても受付は成功として返す。
受付完了画面に「◯◯ のメンバーになりました」フィードバックを出し、`GroupProvider` を即時 refresh して
サイドバー / サークル一覧に反映する。

## User Story

As a **小規模サークルのトーナメント参加者**,
I want **受付 QR を 1 枚読むだけで、参加登録とサークル所属が両方完了する**,
so that **案内を聞き逃してもシーズン戦績に自分が正しく載る**。

## Problem → Solution

**現状**: `/join/[tid]` で受付しても `players/{uid}` が作られるだけ。サークル加入には別の QR
（`/groups/join/[code]`）が必要で、実地では読み忘れが多発 → シーズン戦績が欠落する。

**あるべき姿**: 受付操作（通常アカウント）を行うと、そのトーナメントの開催サークルへ `member` として
自動所属し、完了画面に所属結果が表示され、サークル一覧 / サイドバーに即座に現れる。
匿名ゲストは対象外。加入に失敗しても受付は成立し、次回の受付操作で自動リトライされる。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md)
- **PRD Phase**: Phase 2 — 受付フロー統合（Depends: Phase 1 `complete`）
- **Estimated Files**: 9（新規 3 / 更新 6）

---

## UX Design

### Before

```
┌──────────────────────────────────────────┐
│ /join/[tid]                              │
│  [このアカウントで受付]                  │
│        ↓ タップ                          │
│ ┌────────────────────────────────────┐   │
│ │ 受付完了                           │   │
│ │ 運営者が席決めするまでお待ちください │   │
│ │ トーナメント: Monthly              │   │
│ │ [タイマー画面へ] [参加を取り消す]  │   │
│ └────────────────────────────────────┘   │
│                                          │
│  → サークルには入っていない              │
│  → /groups は「まだサークルがありません」│
│  → シーズンランキングに載らない          │
└──────────────────────────────────────────┘
```

### After

```
┌──────────────────────────────────────────┐
│ /join/[tid]                              │
│  [このアカウントで受付]                  │
│        ↓ タップ（1 操作のまま）          │
│ ┌────────────────────────────────────┐   │
│ │ 受付完了                           │   │
│ │ 運営者が席決めするまでお待ちください │   │
│ │ トーナメント: Monthly              │   │
│ │ ┌──────────────────────────────┐   │   │
│ │ │ ✓ 土曜サークル のメンバーに   │   │   │
│ │ │   なりました。               │   │   │
│ │ └──────────────────────────────┘   │   │
│ │ [タイマー画面へ] [参加を取り消す]  │   │
│ └────────────────────────────────────┘   │
│                                          │
│  → サイドバー / /groups に即反映          │
│  → シーズンランキングが見える            │
└──────────────────────────────────────────┘

失敗時（best-effort）:
│ │ 受付完了 …（受付は成功のまま）      │
│ │ サークルへの登録は完了していません。 │
│ │ 次回の受付時に自動で再試行されます。 │  ← 控えめな注記（text-xs muted）
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| 「このアカウントで受付」 | player 作成のみ | player 作成 → 自動所属 → group コンテキスト refresh | 追加タップなし（完全自動・同意 UI なし） |
| 「Google で参加」 | 同上 | 同上 | 新規 Google ユーザーもその場でメンバー化 |
| 「ログインして受付」 | 同上 | 同上 | 未サインイン端末からの受付経路 |
| 「ゲストで受付」 | player 作成のみ | **変更なし**（自動所属を呼ばない） | 匿名除外。完了画面にも所属メッセージは出ない |
| 受付完了画面 | タイトル / 説明 / トーナメント名 | ＋ 所属結果（joined のみ表示 / failed は控えめ注記） | `already-member` / `skipped-anonymous` は無表示 |
| サイドバー・`/groups` | 加入前は空 | 受付直後に当該サークルが出現 | `setCurrentGroupId` + `refreshGroups` |
| 「参加を取り消す」 | player 削除 | **変更なし**（サークルからは抜けない） | 自動脱退は作らない（NOT Building） |

### Edge Cases for UX

- **既に受付済み（`already-joined`）で未所属** — 受付ボタンを押すたびに自動所属を試みる（PRD Q1(b)）。
  完了画面のタイトルは「既に参加済みです」だが、所属メッセージは新規加入時のみ出る
- **既メンバーが再受付** — 所属メッセージは出さない（無変化の報告はノイズ）
- **サークル名が取れない**（`users/{uid}.groupIds` 補修失敗など）— 「サークルのメンバーになりました。」に fallback
- **匿名ゲスト** — メッセージなし。既存 UX と完全に同一

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) | 1-148 | 改修の本体。4 経路と `ensurePlayerCreated` の構造 |
| P0 | [src/lib/services/auto-group-join.ts](../../../../src/lib/services/auto-group-join.ts) | 14-36, 102-178 | Phase 1 の契約（戻り値 / throw / 呼出順序） |
| P0 | [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) | 30-160, 160-226 | state / handler と受付完了画面 |
| P0 | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | best-effort 握りつぶし時の warn 義務 / `getErrorCode` 必須 |
| P1 | [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) | 74-178 | `refreshGroups` / `loadFor` の inflight ガード |
| P1 | [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts) | 1-60, 88-136 | mock 構成と fixture factory |
| P1 | [.claude/rules/testing.md](../../../rules/testing.md) | all | mock 境界（helper 境界で割る）／実装と test を同一 commit |
| P2 | [src/app/tournaments/[tid]/live/live-client.test.tsx](../../../../src/app/tournaments/%5Btid%5D/live/live-client.test.tsx) | 1-56 | client component の unit test mock パターン |
| P2 | [tests/e2e/member-role-split.spec.ts](../../../../tests/e2e/member-role-split.spec.ts) | 1-72 | 2 ブラウザ context での owner / member 検証パターン |
| P2 | [tests/e2e/fixtures/flows.ts](../../../../tests/e2e/fixtures/flows.ts) | 18-64, 106-170 | `randomOrganizer` / `createGroup` / `createTournament` / `joinAsGuest` |
| P2 | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | 「トーナメント受付による self-add」節 | Phase 1 で確立した rule 契約（4 state / 匿名除外） |

## External Documentation

外部調査は不要。**No external research needed — feature uses established internal patterns.**
（Firebase Auth / Firestore の利用は Phase 1 までで確立済み。新規ライブラリなし）

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/receipt.ts:17
export type ReceiptResult = "created" | "already-joined";

// SOURCE: src/lib/services/auto-group-join.ts:31-36
export type AutoJoinOutcome = "joined" | "already-member" | "skipped-anonymous";

export type AutoJoinResult = {
  gid: string;
  outcome: AutoJoinOutcome;
};
```

→ service の公開型は `<Domain><Noun>` の PascalCase、値は kebab-case の string union。
関数は `join*` / `ensure*` / `resolve*` の動詞始まり camelCase。

### ERROR_HANDLING（best-effort で握る側）

```ts
// SOURCE: src/lib/services/group.ts:291-301（generateJoinCode の旧コード delete）
if (prev && prev !== code) {
  try {
    await deleteJoinCode(prev);
  } catch (e) {
    logger.warn("previous join code delete failed", {
      errorCode: getErrorCode(e),
      gid,
      prev,
    });
  }
}
```

→ **`AppError.from` で再ラップしない**（内側で warn 済み → 二重 warn になる）。
`getErrorCode(e)` で code だけ拾って 1 本 warn を出し、処理は続行する。

### ERROR_HANDLING（UI 側）

```ts
// SOURCE: src/app/join/[tid]/join-client.tsx:69-73
function wrapError(e: unknown) {
  const wrapped = AppError.from(e, "receipt/unknown", "受付に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code, tid });
  setError(formatErrorForDisplay(wrapped));
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/receipt.ts:74
logger.info("join as existing user ok", { tid, uid: user.uid, result });

// SOURCE: src/lib/services/auto-group-join.ts:167-173
logger.warn("auto-join: groupIds backfill failed", {
  code: "group/auto-join-groupids-failed",
  tid,
  gid,
  uid,
  errorCode: getErrorCode(e),
});
```

→ メッセージは英語の短文、meta は object。best-effort 失敗は `code` + `errorCode` の 2 段。

### SERVICE_PATTERN（受付フロー）

```ts
// SOURCE: src/lib/services/receipt.ts:41-59
async function ensurePlayerCreated(
  tid: string,
  user: User,
  displayNameHint?: string | null,
): Promise<ReceiptResult> {
  // この時点で user は認証済み。rules が auth!=null を要求するため、
  // tournament 読取は認証の「後」に行う。
  const t = await getTournament(tid);
  assertAcceptingEntries(t);
  const displayName = await resolveDisplayName(user, displayNameHint);
  const existing = await getPlayer(tid, user.uid);
  await upsertUserProfile({
    uid: user.uid,
    displayName,
    email: user.email ?? null,
  });
  await upsertPlayer(tid, user.uid, { displayName });
  return existing ? "already-joined" : "created";
}
```

### UI_PATTERN（group コンテキスト反映）

```ts
// SOURCE: src/app/groups/join/[code]/join-group-client.tsx:22, 33-40
const { setCurrentGroupId, refreshGroups } = useCurrentGroup();
...
const { gid, alreadyMember } = await consumeJoinCode({ code, uid: user.uid });
setCurrentGroupId(gid);
await refreshGroups();
setStatus({ kind: "success", gid, alreadyMember });
```

→ 招待コード加入の先例。**自動所属も同じ 2 手（`setCurrentGroupId` → `refreshGroups`）**で反映する。

### TEST_STRUCTURE（service unit）

```ts
// SOURCE: src/lib/services/receipt.test.ts:9-35
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
...
vi.mock("@/lib/services/auth-actions", () => ({
  attemptAnonymousSelfDelete: vi.fn(),
  signInAsGuest: vi.fn(),
  loginWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
```

### TEST_STRUCTURE（client component unit）

```ts
// SOURCE: src/app/tournaments/[tid]/live/live-client.test.tsx:19-54
vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: vi.fn(),
}));
vi.mock("@/lib/services/receipt", () => ({
  joinAsCurrentUser: vi.fn().mockResolvedValue("created"),
}));
// current-group は firebase client を import するため軽量 mock する（Phase 4.9）。
vi.mock("@/lib/services/current-group", () => ({
  useCurrentGroup: vi.fn(() => ({
    groups: [],
    groupIds: [],
    loading: false,
    currentGroupId: null,
    currentGroupRole: null,
    isOrganizer: false,
    isOwner: false,
    setCurrentGroupId: vi.fn(),
    refreshGroups: vi.fn(),
  })),
}));
```

### E2E_STRUCTURE（2 context）

```ts
// SOURCE: tests/e2e/member-role-split.spec.ts:27-42
const owner = randomOrganizer("owner");
await registerOrganizer(page, owner);
const gid = await createGroup(page, "Role Split Group");
await createDefaultStructure(page, "Role Split Default");
const tid = await createTournament(page, "Role Split Tournament");

const browser = page.context().browser();
if (!browser) throw new Error("browser unavailable");
const memberCtx = await browser.newContext();
try {
  const memberPage = await memberCtx.newPage();
  const member = randomOrganizer("member");
  await registerOrganizer(memberPage, member);
  ...
} finally {
  await memberCtx.close();
}
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) | UPDATE | 3 経路に自動所属を接続。戻り値を `ReceiptOutcome` に拡張 |
| [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts) | UPDATE | 既存 assertion の戻り値追従 ＋ 自動所属 9 ケース追加 |
| [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) | UPDATE | 完了画面フィードバック ＋ group コンテキスト反映 |
| `src/app/join/[tid]/join-client.test.tsx` | CREATE | 完了画面の分岐（joined / failed / guest / already-member）を固定 |
| [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) | UPDATE | `refreshGroups` の uid フォールバック ＋ load の順序ガード |
| `src/lib/services/current-group.test.tsx` | CREATE | 上記 2 点の characterization test |
| [src/app/tournaments/[tid]/live/live-client.test.tsx](../../../../src/app/tournaments/%5Btid%5D/live/live-client.test.tsx) | UPDATE | `joinAsCurrentUser` mock の戻り値を新シェイプに追従（drift 防止） |
| `tests/e2e/auto-group-join.spec.ts` | CREATE | 受付 → メンバー化 / 匿名は増えない を E2E で固定 |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | UPDATE | 自動所属の唯一の callsite（receipt 3 経路）と匿名除外を規約に明記 |
| [PRD](../prds/08-auto-group-join-on-entry.prd.md) | UPDATE | Phase 2 を `in-progress` に ＋ plan link |

## NOT Building

- **`/join/[tid]` の新規メール登録タブ** — Phase 3 の担当。本 Phase では既存 3 タブ構成のまま
- **メンバー除名 UI** — Phase 4 の担当（並行実装中）
- **`/live` の「参加する」/ setup 画面の「自分も参加する」からの group コンテキスト即時反映** —
  service 層の自動所属は効く（`receipt.ts` に入れるため）が、`refreshGroups` の呼出は追加しない。
  これらは既にメンバーである運営者 / メンバーの経路で、`already-member` に倒れるのが常態。
  仮に非メンバーが `/live` 直リンクから参加した場合も、次回ナビゲーションでサイドバーに反映される
- **受付取消（`cancelOwnEntry`）時の自動脱退** — PRD 非スコープ。「入ったら残る、消すのはオーナー」
- **匿名 → アカウント連携時の遡及加入** — PRD の Won't（Q2）。
  ただし Google の `AccountLinkRequired` → `LinkAccountDialog` → `joinAsCurrentUser` の経路は
  「通常アカウントでの受付」なので**通常どおり自動所属する**（遡及ではなく新規受付操作のため）
- **運営者向け「未所属の受付者」可視化** — PRD の Could。本 Phase では扱わない
- **受付完了画面からサークル詳細へのリンク追加** — フィードバック文言のみに留める（動線追加は別途判断）
- **`firestore.rules` の変更** — Phase 1 で完了済み。本 Phase は rule に一切触れない

---

## Step-by-Step Tasks

### Task 1: `receipt.ts` に自動所属を接続する

- **ACTION**: [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) を更新。
  戻り値型を `ReceiptOutcome` に拡張し、3 経路の共通ヘルパーから `joinGroupViaTournament` を呼ぶ。
- **IMPLEMENT**:

  1. import を追加（既存 import ブロックの alphabetical 順を保つ）:

  ```ts
  import { AppError, getErrorCode } from "@/lib/errors";
  ...
  import {
    joinGroupViaTournament,
    type AutoJoinOutcome,
  } from "@/lib/services/auto-group-join";
  ```

  2. 公開型を追加（`ReceiptResult` の直後）:

  ```ts
  export type ReceiptResult = "created" | "already-joined";

  /**
   * 自動所属（08-auto-group-join-on-entry）の結果。
   * `failed` は best-effort の失敗 — **受付そのものは成功している**。
   */
  export type AutoJoinStatus = AutoJoinOutcome | "failed";

  export type AutoJoinFeedback = {
    gid: string;
    status: AutoJoinStatus;
  };

  /**
   * 受付の結果一式。`autoJoin` が `null` なのは匿名ゲスト経路（`joinAsGuest`）のみ。
   */
  export type ReceiptOutcome = {
    result: ReceiptResult;
    autoJoin: AutoJoinFeedback | null;
  };
  ```

  3. `ensurePlayerCreated` の戻り値を拡張（`groupId` と解決済み `displayName` を返す）:

  ```ts
  async function ensurePlayerCreated(
    tid: string,
    user: User,
    displayNameHint?: string | null,
  ): Promise<{ result: ReceiptResult; groupId: string; displayName: string }> {
    // この時点で user は認証済み。rules が auth!=null を要求するため、
    // tournament 読取は認証の「後」に行う。
    const t = await getTournament(tid);
    assertAcceptingEntries(t);
    const displayName = await resolveDisplayName(user, displayNameHint);
    const existing = await getPlayer(tid, user.uid);
    await upsertUserProfile({
      uid: user.uid,
      displayName,
      email: user.email ?? null,
    });
    await upsertPlayer(tid, user.uid, { displayName });
    return {
      result: existing ? "already-joined" : "created",
      groupId: t.groupId,
      displayName,
    };
  }
  ```

  4. 共通ヘルパーを新設（`ensurePlayerCreated` の直後）:

  ```ts
  /**
   * 受付（player doc 作成）→ サークル自動所属 を **この順序で** 実行する共通経路。
   * 08-auto-group-join-on-entry Phase 2。
   *
   * - **順序厳守**: rule の `hasTournamentEntryProof` が `players/{uid}` の存在を
   *   前提にするため、逆順・並列だと必ず deny される
   * - **best-effort**: 受付は当日オペレーションのクリティカルパス。自動所属の失敗で
   *   受付を止めない。失敗は warn に落として `status: "failed"` を返し、次回の
   *   受付操作でリトライされる（`joinGroupViaTournament` は既メンバーなら no-op）
   * - **`already-joined` でも実行する**（PRD Q1(b)）— 既受付者の取りこぼし回収を兼ねる
   * - 匿名ゲストは呼出側（`joinAsGuest`）が本ヘルパーを使わないことで除外する
   *   （`joinGroupViaTournament` 側にも匿名ガードがあり二重防御）
   */
  async function receiveEntry(
    tid: string,
    user: User,
    displayNameHint?: string | null,
  ): Promise<ReceiptOutcome> {
    const { result, groupId, displayName } = await ensurePlayerCreated(
      tid,
      user,
      displayNameHint,
    );
    let autoJoin: AutoJoinFeedback;
    try {
      const joined = await joinGroupViaTournament({
        tid,
        gid: groupId,
        uid: user.uid,
        // 受付で解決した表示名をそのまま渡し、players と memberDisplayNames を揃える。
        // 15 字への切り詰めは joinGroupViaTournament 側の責務。
        displayName,
      });
      autoJoin = { gid: joined.gid, status: joined.outcome };
    } catch (e) {
      // 内側（repository の wrapFirestoreWrite）で warn 済みのため AppError では
      // 再ラップせず、握りつぶす事実だけを callsite として 1 本記録する。
      logger.warn("auto group join after receipt failed", {
        code: "group/auto-join-failed",
        tid,
        gid: groupId,
        uid: user.uid,
        errorCode: getErrorCode(e),
      });
      autoJoin = { gid: groupId, status: "failed" };
    }
    return { result, autoJoin };
  }
  ```

  5. 4 つの公開関数を書き換える:

  ```ts
  export async function joinAsExistingUser({
    tid,
    email,
    password,
  }: {
    tid: string;
    email: string;
    password: string;
  }): Promise<ReceiptOutcome> {
    const user = await loginWithEmail(email, password);
    // displayName は既存プロフィール／Firebase Auth から解決。
    // 未設定なら ensurePlayerCreated が validation/display-name-required を投げる。
    const outcome = await receiveEntry(tid, user);
    logger.info("join as existing user ok", {
      tid,
      uid: user.uid,
      result: outcome.result,
      autoJoin: outcome.autoJoin?.status,
    });
    return outcome;
  }

  export async function joinViaGoogle({ tid }: { tid: string }): Promise<ReceiptOutcome> {
    // Phase 4.7: signInWithGoogle は { user, isNewUser } を返すが、受付フローでは
    // displayName ダイアログを挟まず Google プロフィール名のまま参加できる方針のため isNewUser は無視。
    const { user } = await signInWithGoogle();
    const outcome = await receiveEntry(tid, user);
    logger.info("join via google ok", {
      tid,
      uid: user.uid,
      result: outcome.result,
      autoJoin: outcome.autoJoin?.status,
    });
    return outcome;
  }

  export async function joinAsGuest({
    tid,
    displayName,
  }: {
    tid: string;
    displayName: string;
  }): Promise<ReceiptOutcome> {
    const name = parseDisplayName(displayName);
    const user = await signInAsGuest(name);
    // 匿名ゲストはサークル自動所属の対象外（PRD の Won't / rule の isSignedInNotAnon）。
    // receiveEntry を通さないことが「二重防御」の UI 側の 1 枚目にあたる。
    const { result } = await ensurePlayerCreated(tid, user, name);
    logger.info("join as guest ok", { tid, uid: user.uid, result });
    return { result, autoJoin: null };
  }

  export async function joinAsCurrentUser({
    tid,
    displayName,
  }: {
    tid: string;
    displayName?: string;
  }): Promise<ReceiptOutcome> {
    const user = firebaseAuth.currentUser;
    if (!user) {
      throw new AppError("ログインしてください", "auth/not-authenticated");
    }
    const outcome = await receiveEntry(tid, user, displayName);
    logger.info("join as current user ok", {
      tid,
      uid: user.uid,
      result: outcome.result,
      autoJoin: outcome.autoJoin?.status,
    });
    return outcome;
  }
  ```

- **MIRROR**: SERVICE_PATTERN（受付フロー）／ ERROR_HANDLING（best-effort で握る側）／ LOGGING_PATTERN
- **IMPORTS**: `getErrorCode`（`@/lib/errors` の既存 import に追加）、
  `joinGroupViaTournament` / `AutoJoinOutcome`（`@/lib/services/auto-group-join`）
- **GOTCHA**:
  - **`joinAsCurrentUser` は匿名ユーザーからも呼ばれ得る**（`/live` の「参加する」を匿名ゲストが押す）。
    `receiveEntry` はそのまま通してよい — `joinGroupViaTournament` が
    `firebaseAuth.currentUser?.isAnonymous` で `skipped-anonymous` に倒す
  - **循環 import なし**: `auto-group-join.ts` は `receipt.ts` を import していない（確認済み）
  - `logger.info` の meta に `autoJoin: outcome.autoJoin?.status` を足すだけで、
    `joinGroupViaTournament` 側の `"auto-join via tournament done"` と重複しても問題ない
    （粒度が違う：受付ログ vs 加入ログ）
  - **`AppError.from` を使わない**。二重 warn 禁止（[error-logging.md](../../../rules/error-logging.md)）
- **VALIDATE**: `npm run typecheck` → `receipt.ts` 自体は 0 error。
  呼出側（join-client / live-client / TimerControlsSetup）は戻り値を無視 or Task 2 で追従するため
  この時点では join-client のみ型エラーが出る想定（Task 2 で解消）

### Task 2: `join-client.tsx` に所属フィードバックと group コンテキスト反映を追加

- **ACTION**: [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) を更新。
- **IMPLEMENT**:

  1. import 追加:

  ```ts
  import { useCurrentGroup } from "@/lib/services/current-group";
  import {
    cancelOwnEntry,
    joinAsCurrentUser,
    joinAsExistingUser,
    joinAsGuest,
    joinViaGoogle,
    type AutoJoinFeedback,
    type ReceiptOutcome,
    type ReceiptResult,
  } from "@/lib/services/receipt";
  ```

  2. `Status` 型を拡張:

  ```ts
  type Status =
    | { kind: "joined"; result: ReceiptResult; autoJoin: AutoJoinFeedback | null }
    | { kind: "cancelled" };
  ```

  3. hook 追加（`useAuthUser` の直後）:

  ```ts
  const { groups, setCurrentGroupId, refreshGroups } = useCurrentGroup();
  ```

  4. 共通ハンドラを追加（`wrapError` の直後）:

  ```ts
  /**
   * 受付結果を画面に反映し、自動所属が起きていれば group コンテキストを更新する。
   * 4 経路（Google / ログイン / 継続 / 連携後）で同じ後処理を共有するための helper。
   *
   * - 新規加入時のみ `setCurrentGroupId`（既メンバーの選択中サークルを勝手に切り替えない）
   * - `already-member` でも `refreshGroups` する（前回失敗した `groupIds` の補修が
   *   走っているケースを一覧に反映するため）
   */
  async function applyReceiptOutcome(outcome: ReceiptOutcome) {
    setStatus({
      kind: "joined",
      result: outcome.result,
      autoJoin: outcome.autoJoin,
    });
    const autoJoin = outcome.autoJoin;
    if (!autoJoin) return;
    if (autoJoin.status === "joined") {
      setCurrentGroupId(autoJoin.gid);
    }
    if (autoJoin.status === "joined" || autoJoin.status === "already-member") {
      await refreshGroups();
    }
  }
  ```

  5. 4 つの handler の `setStatus({ kind: "joined", result })` を
     `await applyReceiptOutcome(result)` に置換する（`onLoginSubmit` / `onGuestSubmit` /
     `onGoogleJoin` / `onContinueAsSignedIn` / `LinkAccountDialog` の `onLinked`）。
     例:

  ```ts
  async function onContinueAsSignedIn() {
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await joinAsCurrentUser({
        tid,
        displayName: user?.displayName ?? user?.email ?? undefined,
      });
      await applyReceiptOutcome(outcome);
    } catch (e) {
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }
  ```

  `onGuestSubmit` は `refreshUser()` の呼出位置を維持したまま同様に置換する:

  ```ts
  const outcome = await joinAsGuest({ tid, displayName: parsed.data.displayName });
  // Phase 4.7: updateProfile 直後に onAuthStateChanged は発火しないため、
  // AuthBadge 等のヘッダ表示を即更新するために refreshUser を呼ぶ。
  refreshUser();
  await applyReceiptOutcome(outcome);
  ```

  6. 完了画面（`if (status) { ... }` ブロック）に所属フィードバックを追加:

  ```tsx
  const autoJoin = status.kind === "joined" ? status.autoJoin : null;
  // refreshGroups 後の context から名前を引く。補修失敗などで引けない場合は
  // 汎用文言に fallback する（サークル名は必須情報ではない）。
  const joinedGroupName =
    autoJoin !== null
      ? (groups.find((g) => g.id === autoJoin.gid)?.name ?? null)
      : null;
  ```

  `<CardContent>` 内、`{tournament ? <p>...</p> : null}` の直後に挿入:

  ```tsx
  {autoJoin?.status === "joined" ? (
    <p
      role="status"
      className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-800"
    >
      {joinedGroupName
        ? `${joinedGroupName} のメンバーになりました。`
        : "サークルのメンバーになりました。"}
    </p>
  ) : null}
  {autoJoin?.status === "failed" ? (
    <p className="text-xs text-muted-foreground">
      サークルへの登録は完了していません。次回の受付時に自動で再試行されます。
    </p>
  ) : null}
  ```

- **MIRROR**: UI_PATTERN（group コンテキスト反映）／ ERROR_HANDLING（UI 側）
- **IMPORTS**: `useCurrentGroup`（`@/lib/services/current-group`）、
  `AutoJoinFeedback` / `ReceiptOutcome` 型（`@/lib/services/receipt`）
- **GOTCHA**:
  - `already-member` / `skipped-anonymous` では**何も表示しない**。
    「変化がなかった」ことの報告はノイズになり、匿名ゲストには意味を持たない
  - **ユーザー向け文言に技術スタック名を出さない**（Firestore / Firebase 等）。
    `wrapError` 経由の `code: message` 表示は既存踏襲でよい
  - `applyReceiptOutcome` は `async`。呼出は `await` する（`submitting` の `finally` は
    その後に走るので、refresh 完了までボタンが disabled のまま = 二重送信防止になる）
  - `groups` はレンダー時に読むので、`refreshGroups()` 完了後の再レンダーで名前が現れる。
    初回レンダーで `null` fallback が一瞬見えることは許容（表示は 1 文のみ・差し替えは自然）
- **VALIDATE**: `npm run typecheck` / `npm run lint` が 0 error。
  `npm run build` が通る（client component の hook 追加でビルドが壊れないこと）

### Task 3: `current-group.tsx` の `refreshGroups` を堅牢化

- **ACTION**: [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) を更新。
- **IMPLEMENT**:

  1. import 追加:

  ```ts
  import { firebaseAuth } from "@/lib/firebase/client";
  ```

  2. `inflightUidRef` を単調増加カウンタに置換する（uid 一致では
     「同一 uid の 2 本の load が逆順に着地する」を防げないため）:

  ```ts
  // 最新の load 要求だけが state を書けるようにする単調増加カウンタ。
  //   - React strict mode の二重実行
  //   - サインアウト（uid なし）への切替
  //   - 受付直後の refreshGroups と provider effect の並走
  //     （08-auto-group-join-on-entry Phase 2: 加入前に始まった load が
  //      加入後の load より遅れて着地すると、新しいサークルが一覧から消える）
  // を 1 つのガードで扱う。
  const reqIdRef = useRef(0);

  const loadFor = useCallback(async (uid: string) => {
    const reqId = (reqIdRef.current += 1);
    setLoading(true);
    try {
      const profile = await getUserProfile(uid);
      const ids = profile?.groupIds ?? [];
      const { groups: loadedGroups, failedGids } = await listMyGroups(ids);
      // drift 修復：profile に載っているが getGroup できなかった gid を逆引きから外す
      for (const gid of failedGids) {
        await removeGroupIdFromUser(uid, gid).catch((e) => {
          logger.warn("removeGroupIdFromUser failed", { uid, gid, e });
        });
      }
      const liveIds = loadedGroups.map((g) => g.id);
      if (reqIdRef.current !== reqId) return;
      setGroupIds(liveIds);
      setGroups(loadedGroups);

      const stored = readStoredCurrentGroupId();
      if (stored && liveIds.includes(stored)) {
        setCurrentGroupIdState(stored);
      } else if (liveIds.length > 0) {
        setCurrentGroupIdState(liveIds[0]);
        writeStoredCurrentGroupId(liveIds[0]);
      } else {
        setCurrentGroupIdState(null);
        writeStoredCurrentGroupId(null);
      }
    } catch (e) {
      const wrapped = AppError.from(e, "group/load-failed", "サークル情報の取得に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid });
      if (reqIdRef.current !== reqId) return;
      setGroupIds([]);
      setGroups([]);
      setCurrentGroupIdState(null);
    } finally {
      if (reqIdRef.current === reqId) {
        setLoading(false);
      }
    }
  }, []);
  ```

  3. `refreshGroups` に SDK フォールバックを追加:

  ```ts
  const refreshGroups = useCallback(async () => {
    // 受付直後（Google popup / メールログイン直後）は onAuthStateChanged の反映が
    // 1 tick 遅れて context の user がまだ null のことがある。そのまま return すると
    // 自動所属したサークルがサイドバー / 一覧に出ないため、SDK の currentUser に倒す。
    const uid = user?.uid ?? firebaseAuth.currentUser?.uid ?? null;
    if (!uid) return;
    await loadFor(uid);
  }, [user, loadFor]);
  ```

  4. サインアウト時の effect で in-flight を無効化する（`inflightUidRef.current = null` を置換）:

  ```ts
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // in-flight な load が後から着地して groups を復活させないよう無効化する。
      reqIdRef.current += 1;
      setGroupIds([]);
      setGroups([]);
      setCurrentGroupIdState(null);
      writeStoredCurrentGroupId(null);
      setLoading(false);
      return;
    }
    void loadFor(user.uid);
  }, [user, authLoading, loadFor]);
  ```

  5. 旧 `inflightUidRef` の宣言（`const inflightUidRef = useRef<string | null>(null);`）を削除する。

- **MIRROR**: 既存 `loadFor` の構造をそのまま保ち、ガード条件だけ差し替える（最小差分）
- **IMPORTS**: `firebaseAuth`（`@/lib/firebase/client`）
- **GOTCHA**:
  - `firebaseAuth.currentUser` の**直接参照は購読ではない**ため
    [firebase-patterns.md](../../../rules/firebase-patterns.md) の
    「`onAuthStateChanged` を直接呼ばない」規約に抵触しない
    （`services/group.ts` にも `firebaseAuth.currentUser` の先例あり）
  - `reqIdRef.current += 1` は `useRef` なので再レンダーを起こさない
  - `loadFor` の deps は `[]` のまま（ref のみ参照）
- **VALIDATE**: Task 6 の `current-group.test.tsx` が green。既存の全 unit test が非回帰

### Task 4: `receipt.test.ts` を更新（戻り値追従 ＋ 自動所属ケース追加）

- **ACTION**: [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts) を更新。
- **IMPLEMENT**:

  1. mock を 1 つ追加（**helper 境界で割る** — `auto-group-join` の内部 repository は mock しない）:

  ```ts
  vi.mock("@/lib/services/auto-group-join", () => ({
    joinGroupViaTournament: vi.fn(),
  }));
  ...
  import { joinGroupViaTournament } from "@/lib/services/auto-group-join";
  ```

  2. 既存 `beforeEach` 群に既定値を追加（各 describe の `beforeEach` に 1 行ずつ）:

  ```ts
  vi.mocked(joinGroupViaTournament)
    .mockReset()
    .mockResolvedValue({ gid: "g1", outcome: "joined" });
  ```

  3. 既存 assertion を新シェイプに追従（**skip / 削除は禁止**、`result` の取り出しに変更）:

  | 既存 | 変更後 |
  | --- | --- |
  | `expect(result).toBe("created")` | `expect(result.result).toBe("created")` |
  | `expect(result).toBe("already-joined")` | `expect(result.result).toBe("already-joined")` |
  | `.resolves.toBe("created")`（`assertAcceptingEntries` describe） | `.resolves.toMatchObject({ result: "created" })` |

  4. 新規 describe `"auto group join (08 Phase 2)"` を追加（9 ケース）:

  ```ts
  describe("auto group join (08 Phase 2)", () => {
    beforeEach(() => {
      vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
      vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
      vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
      vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
      vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
      vi.mocked(joinGroupViaTournament)
        .mockReset()
        .mockResolvedValue({ gid: "g1", outcome: "joined" });
      mockAuthState.currentUser = null;
    });

    it("joinAsCurrentUser: player 作成後に tournament の groupId で自動所属を呼ぶ", async () => {
      mockAuthState.currentUser = { uid: "u1", email: "a@example.com", displayName: "Alice" };

      const outcome = await joinAsCurrentUser({ tid: "t1" });

      expect(outcome).toEqual({
        result: "created",
        autoJoin: { gid: "g1", status: "joined" },
      });
      expect(joinGroupViaTournament).toHaveBeenCalledWith({
        tid: "t1",
        gid: "g1",
        uid: "u1",
        displayName: "Alice",
      });
      // 順序: player 作成 → 自動所属（rule の hasTournamentEntryProof の前提）
      expect(vi.mocked(upsertPlayer).mock.invocationCallOrder[0]).toBeLessThan(
        vi.mocked(joinGroupViaTournament).mock.invocationCallOrder[0],
      );
    });

    it("joinViaGoogle: 自動所属を呼ぶ", async () => { /* signInWithGoogle mock + 同上 */ });

    it("joinAsExistingUser: 自動所属を呼ぶ", async () => { /* loginWithEmail mock + 同上 */ });

    it("joinAsGuest: 自動所属を呼ばず autoJoin=null を返す（匿名除外）", async () => {
      vi.mocked(signInAsGuest).mockResolvedValue({
        uid: "guest-1", email: null, displayName: "Guest",
      } as unknown as Awaited<ReturnType<typeof signInAsGuest>>);

      const outcome = await joinAsGuest({ tid: "t1", displayName: "Guest" });

      expect(outcome).toEqual({ result: "created", autoJoin: null });
      expect(joinGroupViaTournament).not.toHaveBeenCalled();
    });

    it("already-joined でも自動所属を呼ぶ（取りこぼし回収）", async () => {
      vi.mocked(getPlayer).mockResolvedValue({ /* 既存 player fixture */ } as never);
      mockAuthState.currentUser = { uid: "u1", email: null, displayName: "Alice" };

      const outcome = await joinAsCurrentUser({ tid: "t1" });

      expect(outcome.result).toBe("already-joined");
      expect(joinGroupViaTournament).toHaveBeenCalledTimes(1);
    });

    it("自動所属が失敗しても受付は成功のまま（status=failed + warn 1 本）", async () => {
      mockAuthState.currentUser = { uid: "u1", email: null, displayName: "Alice" };
      vi.mocked(joinGroupViaTournament).mockRejectedValue(
        new AppError("サークルへの自動加入に失敗しました", "group/auto-join-failed"),
      );
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

      const outcome = await joinAsCurrentUser({ tid: "t1" });

      expect(outcome).toEqual({
        result: "created",
        autoJoin: { gid: "g1", status: "failed" },
      });
      expect(warnSpy).toHaveBeenCalledTimes(1);
      warnSpy.mockRestore();
    });

    it("skipped-anonymous はそのまま status に載る", async () => { /* outcome: "skipped-anonymous" */ });

    it("already-member はそのまま status に載る", async () => { /* outcome: "already-member" */ });

    it("受付で解決した displayName（プロフィール由来）を自動所属へ渡す", async () => {
      mockAuthState.currentUser = { uid: "u1", email: "a@example.com", displayName: null };
      vi.mocked(getUserProfile).mockResolvedValue({
        uid: "u1", displayName: "ProfileName", email: "a@example.com",
        groupIds: [], createdAt: now,
      });

      await joinAsCurrentUser({ tid: "t1" });

      expect(joinGroupViaTournament).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: "ProfileName" }),
      );
    });
  });
  ```

- **MIRROR**: TEST_STRUCTURE（service unit）／ [testing.md](../../../rules/testing.md) の mock 境界規約
- **IMPORTS**: `logger`（`@/lib/logger`）を spy 用に追加 import
- **GOTCHA**:
  - **`vi.mock("@/lib/services/auto-group-join")` は必須**。素通しすると
    `@/lib/firebase/repositories/groups` が実体 import され、firestore singleton を触って落ちる
  - 順序 assertion は `mock.invocationCallOrder`（vitest 標準）。`toHaveBeenCalledBefore` は
    jest-extended 依存なので使わない
  - `makeTournament()` の `groupId` は `"g1"`（既存 fixture のまま）。gid を assertion に直書きしてよい
  - 既存の `describe("joinAsGuest")` / `describe("joinViaGoogle")` 等の assertion 修正を
    忘れると `toBe("created")` が object 比較で落ちる
- **VALIDATE**: `npm run test -- src/lib/services/receipt.test.ts` が全 green

### Task 5: `join-client.test.tsx` を新規作成

- **ACTION**: `src/app/join/[tid]/join-client.test.tsx` を作成し、完了画面の分岐を固定する。
- **IMPLEMENT**:

  ```ts
  import { fireEvent, render, screen, waitFor } from "@testing-library/react";
  import { Timestamp } from "firebase/firestore";
  import { beforeEach, describe, expect, it, vi } from "vitest";

  import type { GroupDoc } from "@/lib/firebase/schemas/group";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

  vi.mock("@/lib/firebase/AuthProvider", () => ({
    useAuthUser: vi.fn(),
  }));
  vi.mock("@/lib/firebase/repositories/tournaments", () => ({
    getTournament: vi.fn(),
  }));
  vi.mock("@/lib/services/receipt", () => ({
    joinAsCurrentUser: vi.fn(),
    joinAsExistingUser: vi.fn(),
    joinAsGuest: vi.fn(),
    joinViaGoogle: vi.fn(),
    cancelOwnEntry: vi.fn(),
  }));
  vi.mock("@/lib/services/current-group", () => ({
    useCurrentGroup: vi.fn(),
  }));
  // LinkAccountDialog は firebase auth を import するため軽量 stub にする。
  vi.mock("@/components/auth/LinkAccountDialog", () => ({
    LinkAccountDialog: () => null,
  }));

  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { getTournament } from "@/lib/firebase/repositories/tournaments";
  import { useCurrentGroup } from "@/lib/services/current-group";
  import { joinAsCurrentUser } from "@/lib/services/receipt";

  import { JoinClient } from "./join-client";
  ```

  fixture factory は `makeTournament(overrides)` / `makeGroup(overrides)` を
  [receipt.test.ts](../../../../src/lib/services/receipt.test.ts) と
  [auto-group-join.test.ts](../../../../src/lib/services/auto-group-join.test.ts) から流用する。

  `useCurrentGroup` の既定 mock:

  ```ts
  const setCurrentGroupId = vi.fn();
  const refreshGroups = vi.fn().mockResolvedValue(undefined);

  vi.mocked(useCurrentGroup).mockReturnValue({
    loading: false,
    groupIds: ["g1"],
    groups: [makeGroup({ id: "g1", name: "土曜サークル" })],
    currentGroupId: "g1",
    setCurrentGroupId,
    refreshGroups,
    currentGroupRole: "member",
    isOrganizer: false,
    isOwner: false,
  });
  ```

  テストケース（5 件）:

  | # | シナリオ | 検証 |
  | --- | --- | --- |
  | 1 | `joinAsCurrentUser` が `{result:"created", autoJoin:{gid:"g1",status:"joined"}}` | 「土曜サークル のメンバーになりました。」が見える／`setCurrentGroupId("g1")` と `refreshGroups()` が呼ばれる |
  | 2 | 同上だが `groups` に該当 gid なし | 「サークルのメンバーになりました。」に fallback |
  | 3 | `autoJoin.status === "failed"` | 「受付完了」は出る／「次回の受付時に自動で再試行されます」が見える／`setCurrentGroupId` は呼ばれない |
  | 4 | `autoJoin.status === "already-member"` | 所属メッセージは出ない（`queryByText(/メンバーになりました/)` が null）／`refreshGroups` は呼ばれる |
  | 5 | `autoJoin === null`（ゲスト相当） | 所属メッセージも失敗注記も出ない／`refreshGroups` は呼ばれない |

  各ケースは「`user` が非匿名でサインイン済み」→「このアカウントで受付」ボタンを
  `fireEvent.click` して完了画面へ遷移させる形で駆動する
  （先例: [AddParticipantDialog.test.tsx:70](../../../../src/components/tournament/AddParticipantDialog.test.tsx)）。

- **MIRROR**: TEST_STRUCTURE（client component unit）
- **IMPORTS**: 上記のとおり。**`@testing-library/user-event` は未導入**なので使わない
  （`fireEvent` で足りる。新規依存の追加は行わない — [security-base.md](../../../rules/security-base.md)）
- **GOTCHA**:
  - `getTournament` は `useEffect` 内で呼ばれるので `mockResolvedValue(makeTournament())` を必ず設定する
    （未設定だと unhandled rejection でノイズになる）
  - shadcn の `CardTitle` は `<div>` で `role="heading"` を持たない → `getByText` で拾う
  - 「受付完了」への遷移は非同期。`await screen.findByText("受付完了")` で待つ
  - E2E との重複を避けるため、本テストは**文言分岐の render 判定のみ**を担当する
    （実際にメンバーになったかの検証は E2E の責務）
- **VALIDATE**: `npm run test -- src/app/join` が green

### Task 6: `current-group.test.tsx` を新規作成

- **ACTION**: `src/lib/services/current-group.test.tsx` を作成。
- **IMPLEMENT**:

  ```ts
  vi.mock("@/lib/firebase/AuthProvider", () => ({ useAuthUser: vi.fn() }));
  vi.mock("@/lib/firebase/repositories/groups", () => ({ listMyGroups: vi.fn() }));
  vi.mock("@/lib/firebase/repositories/users", () => ({
    getUserProfile: vi.fn(),
    removeGroupIdFromUser: vi.fn().mockResolvedValue(undefined),
  }));
  vi.mock("@/lib/firebase/client", () => ({
    firebaseAuth: { currentUser: null },
    firestore: {},
  }));
  ```

  `GroupProvider` でラップした probe コンポーネント（`useCurrentGroup()` の値を
  `data-testid` 付きで出力し、ボタンで `refreshGroups()` を呼ぶ）を使って検証する。

  | # | シナリオ | 検証 |
  | --- | --- | --- |
  | 1 | `useAuthUser` が user を返す通常ロード | `groups` が描画され `currentGroupId` が先頭 gid になる |
  | 2 | context user が `null` だが `firebaseAuth.currentUser` が居る状態で `refreshGroups()` | `getUserProfile` が SDK 側の uid で呼ばれる（フォールバックの検証） |
  | 3 | 同一 uid で 2 本の load が逆順に着地 | **後から開始した load の結果が残る**（deferred promise 2 本で制御） |

  ケース 3 の骨子:

  ```ts
  const first = deferred<UserProfileDoc | null>();
  const second = deferred<UserProfileDoc | null>();
  vi.mocked(getUserProfile)
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  // 1 本目（provider effect）→ 2 本目（refreshGroups）の順に開始させ、
  // resolve は 2 本目 → 1 本目 の順で行う。
  ```

  `deferred` は同ファイル内の小さな helper として定義する:

  ```ts
  function deferred<T>() {
    let resolve!: (v: T) => void;
    const promise = new Promise<T>((r) => { resolve = r; });
    return { promise, resolve };
  }
  ```

- **MIRROR**: [src/lib/services/theme.test.tsx](../../../../src/lib/services/theme.test.tsx) の Provider テスト構成
- **GOTCHA**:
  - `localStorage` を触るため `beforeEach` で `window.localStorage.clear()` する
  - `firebaseAuth` の差し替えは
    [auto-group-join.test.ts](../../../../src/lib/services/auto-group-join.test.ts) の
    `setCurrentUser`（`Object.defineProperty` でモジュール名前空間を再定義）と同形にする
  - ケース 3 で `act()` 警告が出る場合は `await act(async () => { ... })` で resolve を包む
- **VALIDATE**: `npm run test -- src/lib/services/current-group.test.tsx` が green

### Task 7: `live-client.test.tsx` の receipt mock を新シェイプに追従

- **ACTION**: [src/app/tournaments/[tid]/live/live-client.test.tsx](../../../../src/app/tournaments/%5Btid%5D/live/live-client.test.tsx) の 32-34 行目を更新。
- **IMPLEMENT**:

  ```ts
  vi.mock("@/lib/services/receipt", () => ({
    // 08-auto-group-join-on-entry Phase 2: 戻り値は ReceiptOutcome。
    // live-client は戻り値を使わないが、mock を実体の契約に合わせて drift を防ぐ。
    joinAsCurrentUser: vi
      .fn()
      .mockResolvedValue({ result: "created", autoJoin: null }),
  }));
  ```

- **MIRROR**: 既存 mock ブロックのコメント様式
- **GOTCHA**: live-client は戻り値を使わないため挙動は不変。**このタスクを飛ばしても test は通る**が、
  次に `joinAsCurrentUser` の契約が変わったとき mock が実体と乖離していることに気づけなくなる
- **VALIDATE**: `npm run test -- src/app/tournaments` が green

### Task 8: E2E spec `auto-group-join.spec.ts` を新規作成

- **ACTION**: `tests/e2e/auto-group-join.spec.ts` を作成（3 テスト）。
- **IMPLEMENT**:

  ```ts
  import { test, expect } from "./fixtures/test-context";
  import {
    createDefaultStructure,
    createGroup,
    createTournament,
    joinAsGuest,
    randomOrganizer,
    registerOrganizer,
  } from "./fixtures/flows";

  /**
   * 08-auto-group-join-on-entry Phase 2: トーナメント受付によるサークル自動所属。
   *
   * **招待コードを 1 回も使わずに**、受付操作だけでサークルメンバーになることを固定する。
   */
  test.describe("受付によるサークル自動所属", () => { ... });
  ```

  | # | テスト名 | 手順 | 検証 |
  | --- | --- | --- | --- |
  | 1 | 「このアカウントで受付」でサークルメンバーになる | A: owner 登録 → group「自動所属サークル」→ structure → tournament。<br>B(新 context): 別アカウント登録 → `/join/[tid]` → 「このアカウントで受付」 | B: 「受付完了」＋「自動所属サークル のメンバーになりました。」。`/groups` にサークル名が見える。`/groups/[gid]` が開けて「シーズン」タブが描画される。<br>A: メンバータブに B の displayName の listitem が出る（招待コード未使用） |
  | 2 | 「ログインして受付」でもメンバーになる | A: 同上。B: アカウント登録のみ（group なし）。C(新 context・未サインイン): `/join/[tid]` → ログインタブ → B の email/password → 「ログインして受付」 | C: 「受付完了」＋所属メッセージ。`/groups` にサークルが出る |
  | 3 | 匿名ゲスト受付ではメンバーが増えない | A: 同上。G(新 context): `joinAsGuest(page, tid, "ゲストA")` | G: 「受付完了」は出るが `/メンバーになりました/` は **0 件**。<br>A: `/groups/[gid]` メンバータブに「ゲストA」の listitem が **0 件**、`/groups` のカードが「メンバー 1 人」のまま |

  実装上の要点:

  ```ts
  // B context の受付操作
  await memberPage.goto(`/join/${tid}`);
  const receiveButton = memberPage.getByRole("button", { name: "このアカウントで受付" });
  await expect(receiveButton).toBeVisible({ timeout: 15_000 });
  await receiveButton.click();
  // Cold emulator では auth + 複数 Firestore write が走るため 30s 許容（flows.joinAsGuest と同方針）
  await expect(memberPage.getByText("受付完了")).toBeVisible({ timeout: 30_000 });
  await expect(
    memberPage.getByText("自動所属サークル のメンバーになりました。"),
  ).toBeVisible({ timeout: 15_000 });

  // サークル一覧に出る
  await memberPage.goto("/groups");
  await expect(memberPage.getByText("自動所属サークル")).toBeVisible({ timeout: 15_000 });
  ```

  owner 側のメンバー確認（POM 利用）:

  ```ts
  const detail = groupDetailPage(gid);
  await detail.goto();
  await detail.expectLoaded();
  await detail.selectTab("members");
  await expect(
    page.getByRole("listitem").filter({ hasText: member.displayName }),
  ).toBeVisible({ timeout: 15_000 });
  ```

- **MIRROR**: E2E_STRUCTURE（2 context）／ [tests/e2e/member-role-split.spec.ts](../../../../tests/e2e/member-role-split.spec.ts)
- **IMPORTS**: 上記 ＋ 必要に応じて `groupDetailPage` fixture（`test` の引数分割代入で受け取る）
- **GOTCHA**:
  - **`issueInviteUrl` / `consumeInviteUrl` は使わない**。本 Phase の価値は
    「招待コードなしで加入できる」ことなので、招待コードを使うと検証が無意味になる
  - `registerOrganizer` は `/login` の新規登録タブを使う汎用 helper。
    B / C のユーザーは group を作らないため、実際には一般ユーザーとして振る舞う
  - 新規登録直後は `/groups?empty=1` 等へリダイレクトされる。`/join/[tid]` へは明示 `goto` する
  - `getByText("自動所属サークル")` は `/groups` のカードタイトルと現在選択中バッジの
    両方に一致しない（バッジは別テキスト）ことを確認済み。strict mode 違反が出た場合は
    `.first()` ではなく `getByRole("link", { name: ... })` などスコープを絞る
  - context C（未サインイン）で `/join/[tid]` を開くと `getTournament` は走らず
    タイトルは「トーナメント受付」のまま。ログインタブのフォームは常に描画される
  - `test.describe` 単位で emulator が毎テスト reset される（`autoResetEmulator` fixture）ため、
    各テストは自前で seed する
- **VALIDATE**: `npm run test:e2e -- tests/e2e/auto-group-join.spec.ts` が 3/3 pass

### Task 9: ドキュメント更新

- **ACTION**: 規約ファイルと PRD を更新する。
- **IMPLEMENT**:

  (a) [.claude/rules/group-membership.md](../../../rules/group-membership.md) の
  「トーナメント受付による self-add の rule 側検証（08-auto-group-join-on-entry Phase 1）」節の末尾に追記:

  ```markdown
  **アプリ側の呼出経路（Phase 2）**: `joinGroupViaTournament`（services/auto-group-join.ts）を
  呼ぶのは [receipt.ts](../../src/lib/services/receipt.ts) の内部 helper `receiveEntry` **のみ**。
  `joinAsExistingUser` / `joinViaGoogle` / `joinAsCurrentUser` の 3 経路がこれを通り、
  **`joinAsGuest`（匿名）だけが通らない**（rule の `isSignedInNotAnon()` と併せた二重防御）。

  - **順序**: `ensurePlayerCreated`（player doc 作成）→ `joinGroupViaTournament`。
    rule の `hasTournamentEntryProof` が player doc の存在を前提にするため逆順は必ず deny
  - **best-effort**: 失敗は `logger.warn`（`code: "group/auto-join-failed"`）に落とし、
    受付結果は `ReceiptOutcome.autoJoin.status = "failed"` として返す。受付自体は成功扱い
  - **`already-joined` でも実行**する。既受付者の取りこぼし回収と失敗時の自動リトライを兼ねる
  - UI（`/join/[tid]`）は `status === "joined"` のときだけ所属メッセージを出し、
    `setCurrentGroupId` + `refreshGroups` で group コンテキストへ即反映する

  ⚠ DRIFT WARNING: 受付経路を追加する場合（Phase 3 の新規メール登録タブなど）は、
  **`receiveEntry` を経由させる**こと。`ensurePlayerCreated` を直接呼ぶと自動所属が抜ける。
  ```

  (b) 権限マトリクスの「トーナメント受付経由のサークル自動加入（通常アカウント）」行は
  Phase 1 で追加済み。**変更不要**。

  (c) [error-logging.md](../../../rules/error-logging.md) は**変更不要**
  （新規エラーコードなし。`group/auto-join-failed` は Phase 1 で登録済み）。

  (d) PRD の Implementation Phases 表で Phase 2 を `pending` → `in-progress` にし、
  PRP Plan 列に `[phase-2-receipt-flow-integration.plan.md](../plans/phase-2-receipt-flow-integration.plan.md)` を入れる。

- **VALIDATE**: リンク先パスが実在すること（相対パスを手動確認）

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `joinAsCurrentUser` が自動所属を呼ぶ | signed-in user, tournament(groupId=g1) | `joinGroupViaTournament({tid,gid:"g1",uid,displayName})` 1 回 | - |
| 呼出順序 | 同上 | `upsertPlayer` の invocationOrder < `joinGroupViaTournament` | ✓（rule 前提） |
| `joinViaGoogle` が自動所属を呼ぶ | Google sign-in mock | 同上 | - |
| `joinAsExistingUser` が自動所属を呼ぶ | email/password mock | 同上 | - |
| `joinAsGuest` は呼ばない | guest sign-in mock | `joinGroupViaTournament` 未呼出 / `autoJoin: null` | ✓（匿名除外） |
| `already-joined` でも呼ぶ | 既存 player あり | `result:"already-joined"` かつ自動所属 1 回 | ✓（取りこぼし回収） |
| 自動所属失敗 → 受付は成功 | `joinGroupViaTournament` reject | `{result:"created", autoJoin:{status:"failed"}}` ＋ warn 1 本 | ✓（best-effort） |
| `skipped-anonymous` 透過 | outcome=`skipped-anonymous` | `autoJoin.status==="skipped-anonymous"` | ✓ |
| `already-member` 透過 | outcome=`already-member` | `autoJoin.status==="already-member"` | ✓ |
| displayName の受け渡し | profile 名のみ設定 | `displayName: "ProfileName"` で呼ばれる | ✓（15 字切り詰めは Phase 1 側） |
| 完了画面: joined + 名前解決 | `autoJoin.status="joined"`, groups に g1 | 「土曜サークル のメンバーになりました。」 | - |
| 完了画面: joined + 名前不明 | groups に g1 なし | 「サークルのメンバーになりました。」 | ✓（fallback） |
| 完了画面: failed | `status="failed"` | 「次回の受付時に自動で再試行されます」／`setCurrentGroupId` 未呼出 | ✓ |
| 完了画面: already-member | `status="already-member"` | 所属メッセージなし／`refreshGroups` 呼出 | ✓ |
| 完了画面: guest | `autoJoin=null` | 所属メッセージ・失敗注記ともになし／`refreshGroups` 未呼出 | ✓ |
| `refreshGroups` の SDK フォールバック | context user=null, SDK currentUser あり | `getUserProfile(sdkUid)` が呼ばれる | ✓（Google 直後の race） |
| load の順序ガード | 同一 uid の 2 本を逆順 resolve | 後発 load の結果が残る | ✓（並走） |

### E2E Tests

| Test | 検証 |
| --- | --- |
| 「このアカウントで受付」→ メンバー化 | 完了画面の所属メッセージ／`/groups` 出現／`/groups/[gid]` 到達／owner 側メンバー一覧に出現 |
| 「ログインして受付」→ メンバー化 | 未サインイン端末からの受付でも同様 |
| 匿名ゲスト受付 | 所属メッセージなし／owner 側メンバー数が増えない |

### Edge Cases Checklist

- [ ] 空入力（displayName 空でのゲスト受付）— 既存 `validation/display-name-required` が非回帰
- [ ] 15 字超の displayName — Phase 1 の service で切り詰め済み（本 Phase では受け渡しのみ検証）
- [ ] 既メンバーの再受付 — no-op で所属メッセージを出さない
- [ ] `already-joined` の再受付 — 自動所属は実行される
- [ ] 匿名ゲスト — 自動所属を一切呼ばない（service 未呼出を assert）
- [ ] 自動所属失敗（permission-denied / network）— 受付は成功のまま
- [ ] 同時実行 / 多端末 — Phase 1 の再 probe で `already-member` に倒れる（本 Phase では不変）
- [ ] group 名が取得できない — 汎用文言に fallback
- [ ] サインアウト直後の in-flight load — groups を復活させない（Task 3 のガード）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
npm run lint
```

EXPECT: 0 errors / 0 warnings

### Unit Tests（対象領域）

```bash
npm run test -- src/lib/services/receipt.test.ts
npm run test -- src/lib/services/current-group.test.tsx
npm run test -- src/app/join
```

EXPECT: すべて pass

### Full Test Suite

```bash
npm run test
```

EXPECT: Phase 1 完了時点の **1595 passed / 101 files** から新規分だけ増加し、失敗ゼロ

### Build

```bash
npm run build
```

EXPECT: 成功

### Rules 非回帰（rule 変更なしの確認）

```bash
npm run test:rules-limits
npm run test:rules-tournament-join
npm run test:rules-list-scope
```

EXPECT: すべて ALL GREEN（`firestore.rules` に触れていないので変化しないことの確認）

### E2E

```bash
npm run test:e2e -- tests/e2e/auto-group-join.spec.ts
npm run test:e2e
```

EXPECT: 新規 spec 3/3 pass ＋ 既存 spec 非回帰（特に
`anonymous-flow-completion` / `organizer-self-join` / `member-role-split` / `proxy-receipt`）

### Manual Validation

- [ ] `/join/[tid]` を未所属の通常アカウントで開き「このアカウントで受付」→ 所属メッセージが出る
- [ ] 同じ画面でサイドバーを開き、当該サークルが現れている
- [ ] `/groups` に当該サークルが出て、詳細画面が開ける
- [ ] ゲスト受付では所属メッセージが出ない
- [ ] 受付済みユーザーがもう一度受付しても壊れない（「既に参加済みです」＋所属メッセージなし）
- [ ] `git diff` に `.env` / `apiKey` / `token` / `secret` の混入がない

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation コマンドが pass
- [ ] テストが実装と**同一 commit** に入っている（[testing.md](../../../rules/testing.md)）
- [ ] 型エラー / lint エラーなし
- [ ] UX デザイン（Before/After）どおりの表示になっている
- [ ] `joinAsGuest` から `joinGroupViaTournament` が呼ばれないことが unit test で固定されている
- [ ] `firestore.rules` に一切変更がない（`git diff --stat firestore.rules` が空）

## Completion Checklist

- [ ] 発見したパターンに従っている（service / UI / test の 3 層とも）
- [ ] エラー処理が規約どおり（best-effort は `getErrorCode` + warn、`AppError.from` の二重ラップなし）
- [ ] ログが規約どおり（`logger` 経由のみ、`console.*` なし）
- [ ] テストが test 規約どおり（helper 境界 mock / fixture factory / skip 禁止）
- [ ] ハードコード値なし（gid / tid はすべて引数・fixture 経由）
- [ ] ドキュメント更新済み（group-membership.md / PRD 進捗表）
- [ ] 不要なスコープ追加なし（NOT Building を守っている）
- [ ] 自己完結 — 実装中にコードベース検索が要らない

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **本番 rules 未 deploy のまま Phase 2 をリリースし `permission-denied` が多発** | **H** | **H** | Phase 1 レポートの Next Steps が未消化。**リリース前に `firebase deploy --only firestore:rules` をユーザー承認のうえ実行**する。⚠ 今回の deploy は `tournaments` の list 挙動も変える（絞り込みなしクエリは deny）ので、deploy 後に主要画面の一覧表示を目視確認する |
| 戻り値型変更で既存呼出側が壊れる | M | M | 呼出側は 3 箇所のみ（join-client / live-client / TimerControlsSetup）で、後 2 者は戻り値を無視。`npm run typecheck` で機械検出できる |
| Google 受付直後に context user が未反映で `refreshGroups` が no-op | M | L | Task 3 の SDK フォールバックで解消。unit test で固定 |
| provider effect と `refreshGroups` の並走で新サークルが一覧から消える | L | M | Task 3 の単調増加カウンタで後発 load を優先。unit test（逆順 resolve）で固定 |
| E2E の cold emulator タイムアウトで flaky | M | L | 受付完了待ちは 30s、以降の表示待ちは 15s（既存 spec と同方針） |
| 受付完了画面の文言が増えて視認性が落ちる | L | L | joined のみ強調表示、failed は `text-xs text-muted-foreground` の控えめ表示。`already-member` / `skipped` は無表示 |
| Phase 4（除名 UI）との同時作業でコンフリクト | L | L | 触るファイルが完全に分離（Phase 4: `group.ts` / `groups/[gid]` 配下。本 Phase: `receipt.ts` / `join/[tid]` / `current-group.tsx`）。`group-membership.md` のみ両者が編集するので、追記位置を別セクションにする |

## Notes

### 設計判断: 自動所属をどこに差し込むか

PRD の Technical Approach どおり **service 層（`receipt.ts`）**に差し込む。UI 層（`join-client.tsx`）で
`joinGroupViaTournament` を直接呼ぶ案も検討したが、以下の理由で service 層を採った:

- `/live` の「参加する」・setup 画面の「自分も参加する」も `joinAsCurrentUser` を通るため、
  service 層に置けば**受付経路が増えても自動的にカバーされる**（Phase 3 の新規登録タブも同様）
- 「player 作成 → 自動所属」の順序制約は rule 由来の**ドメイン制約**であり、
  UI の都合ではない。制約を UI に散らすと Phase 3 で再び順序を間違える余地が残る
- UI 層は「結果を表示する」責務に集中できる

### 設計判断: 戻り値を object に拡張する

`ReceiptResult`（string union）のままだと完了画面が所属結果を知れない。
`ReceiptOutcome { result, autoJoin }` に拡張することで、既存の `result` セマンティクスを保ったまま
additive に情報を足せる。`AutoJoinStatus = AutoJoinOutcome | "failed"` として Phase 1 の型を
そのまま再利用し、`skipped-anonymous` → `skipped` のような**変換テーブルを作らない**
（変換は将来の drift 源になる）。

### `already-member` でも `refreshGroups` する理由

`joinGroupViaTournament` は outcome によらず `users/{uid}.groupIds` を `arrayUnion` で補修する
（Phase 1 の設計）。前回の受付で groupIds 更新だけ失敗していた場合、`already-member` の受付が
その補修契機になる。ここで refresh しないと「補修されたのに一覧に出ない」状態が
次回ロードまで続く。

### Phase 3 への申し送り

- 新規メール登録タブは **`receiveEntry` を通る経路**（＝ `joinAsCurrentUser` か、
  それに準じる新関数）で実装すること。`ensurePlayerCreated` の直接呼出は自動所属を素通しする
- `JoinPage` POM には既に `emailTab: getByRole("tab", { name: "メール登録" })` が定義済み
  （[tests/e2e/pages/JoinPage.ts:15](../../../../tests/e2e/pages/JoinPage.ts)）。
  タブ名はこれに合わせるか、POM 側を実装に合わせて更新する
- 本 Phase で追加した `applyReceiptOutcome` に合流させれば、フィードバックと
  group コンテキスト反映は自動的に効く
