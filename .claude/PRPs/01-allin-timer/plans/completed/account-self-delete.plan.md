# Plan: アカウント自己削除（sole-owner ガード付き）

## Summary

通常アカウント（Google / Email+Password）ユーザーが `/settings` 画面から自分のアカウントを完全削除できる機能を追加する。Phase 4.5 で実装済の匿名アカウント自己削除（`attemptAnonymousSelfDelete`）を雛形に、削除前の **「自分のみがオーナーのサークル」検出と block** / **所属サークルからの自動脱退** / **`auth/requires-recent-login` への再認証フロー** の 3 点で通常アカウント向けに拡張する。schema 変更ゼロ、Firestore Rules はカスケード削除を許可する 1 行追記のみ。

## User Story

As a 通常アカウント（Google / Email+Password）でログインしたユーザー,
I want `/settings` 画面から自分のアカウントを 1 操作で削除できる、ただし**自分が唯一のオーナーのサークルが残っている場合は事前にブロックされる**,
So that 退会したいときに孤児サークル（オーナー不在）を作らずにアカウント整理ができる、かつ運営継続中サークルでも他メンバーを昇格させてから安全に抜けられる。

## Problem → Solution

**Current state**

- `/settings` 画面（[settings-client.tsx](../../../../src/app/settings/settings-client.tsx)）は **表示名の変更のみ**で、アカウント削除導線が存在しない
- 匿名（ゲスト）アカウントは Phase 4.5 の `attemptAnonymousSelfDelete` 経路で 3 通り（`logout` / `cancelOwnEntry` / live-client `finished` 検知）に best-effort 削除される
- 通常アカウントの削除手段は **Firebase Console に運営者が直接アクセスする**しかなく、ユーザー自身では退会できない
- 仮にユーザーが `users/{uid}` を直接消したとしても、所属 `groups/{gid}` の `memberUids` / `organizerUids` / `ownerUids` / `memberDisplayNames` から自分が消えず孤児化する。最後の owner が抜けると `groups/{gid}.ownerUids.length == 0` の不正状態が rule で検出されるべきだが、現状 `removeMemberSelf` は self-leave 経路で「自分が ownerUids に含まれない」前提
- 結果: 退会フロー無し → ユーザーが運営から離れたときに「データだけが残る」状態が常態化する

**Desired state**

- `/settings` 配下に「アカウントを削除」セクションを additive に追加。ボタン → 確認 dialog → 実行
- 削除実行前に `users/{uid}.groupIds` を辿り、各 `groups/{gid}.ownerUids` を read。**自分が唯一の owner（`ownerUids.length === 1 && ownerUids[0] === uid`）のサークルが 1 つでもあれば**、サークル名一覧を提示して block。「他のメンバーをオーナーに昇格するかサークルを削除してください」と誘導
- block を通過したら、所属する全サークルから順次 `leaveGroup` で脱退（owner 降格 + memberUids 除外 + memberDisplayNames 削除）
- `users/{uid}` を削除後、`firebaseUser.delete()` でアカウント情報を完全削除（user-facing 文言ではこの実装詳細を露出させず「アカウント情報が削除されます」と表現する）
- `auth/requires-recent-login` が返ったら **再認証 dialog** を表示し、Google popup または password 入力で `reauthenticateWithCredential` / `reauthenticateWithPopup` を実行 → `user.delete()` を再試行
- 過去トーナメントの `players/{pid}` ドキュメントと `seasonStats/{uid}` は **残す**（参加履歴・シーズン累計の継続性のため）。orphan stat（脱退済みメンバーの displayName と pt が残る）になるが、既存 schema が rule 上「member ↔ stat doc」の存在依存を持たないため整合性は崩れない

## Metadata

- **Complexity**: Medium
- **Source PRD**: なし（free-form ad-hoc improvement、PRD 01 の Phase 4.5 系列を延長）
- **Triggering work-stream**: 02-season-stats-and-share Phase D 完了直後の運用整理として user から要望（最新 commit context、ただし機能は 01 の認証系延長のため `01-allin-timer/plans/` に配置）
- **PRD Phase**: 該当なし — additive な polish。01 PRD 表に Phase 5.x 行を追加するか、Phase 5 の polish 細目として吸収するかは実装後に判断
- **Estimated Files**: 約 12 files（CREATE 6 / UPDATE 6）

---

## UX Design

### Before（現状）

```
/settings
┌────────────────────────────────────────┐
│ アカウント設定                         │
│   メール: alice@example.com            │
│   方式: 通常アカウント                 │
│   表示名: [Alice          ] [保存]    │
│   [戻る]                                │
└────────────────────────────────────────┘
   ※ 削除導線なし。退会は Firebase Console 経由
```

### After（実装後）

```
/settings
┌────────────────────────────────────────┐
│ アカウント設定                         │
│   メール: alice@example.com            │
│   方式: 通常アカウント                 │
│   表示名: [Alice          ] [保存]    │
│ ─────────────────────────────────── │
│ ⚠ アカウントを削除                     │
│   削除するとアカウント情報が完全に消去 │
│   されます。所属サークルから自動脱退  │
│   します。過去のトーナメント参加記録と │
│   シーズン戦績は残ります。             │
│   [アカウントを削除する] (赤ボタン)   │
└────────────────────────────────────────┘

[アカウントを削除する] クリック後の分岐:

(A) sole-owner サークルあり:
┌────────────────────────────────────────┐
│ 削除できません                         │
│ 以下のサークルはあなたが唯一のオーナー │
│ です。先に他のメンバーをオーナーに昇格 │
│ するか、サークルを削除してください:    │
│   • サタデーサークル                   │
│   • 木曜トーナメント                   │
│ [閉じる]                                │
└────────────────────────────────────────┘

(B) sole-owner なし:
┌────────────────────────────────────────┐
│ アカウントを削除しますか？             │
│ 取り消せません。所属する 3 つのサークル │
│ から脱退し、アカウント情報が完全に削除 │
│ されます。                             │
│ [キャンセル] [削除する]                │
└────────────────────────────────────────┘

(C) 削除実行 → requires-recent-login:
┌────────────────────────────────────────┐
│ 再認証が必要です                       │
│ セキュリティのため、もう一度ログインし │
│ てください。                           │
│ [Google で再認証]                       │
│ または                                  │
│ パスワード: [          ] [再認証]     │
└────────────────────────────────────────┘
   → 成功後 user.delete() 自動再試行 → / にリダイレクト
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| /settings | 表示名のみ | + 「アカウントを削除」セクション | 匿名（`user.isAnonymous`）の場合は同セクション非表示（既存 logout 経路で完結） |
| sole-owner サークル検出 | なし | block dialog（サークル名一覧 + 誘導文言） | `groups/{gid}.ownerUids.length === 1 && ownerUids[0] === uid` を全所属 group で評価 |
| 自動脱退 | なし | `leaveGroup` を順次実行（owner 降格 → removeMemberSelf） | `Promise.allSettled` で per-gid の失敗を warn、全件成功でも一部失敗でも次工程へ進む（best-effort） |
| Firebase Auth 削除 | 匿名のみ self-delete | 通常アカウントも自己削除可能 | `user.delete()` 失敗時は `auth/requires-recent-login` を捕捉して再認証 |
| 再認証 | なし | provider に応じた dialog（Google popup / password） | `user.providerData[0].providerId` で分岐 |
| 削除完了後 | — | / にリダイレクト + 「削除しました」 toast | onAuthStateChanged で user === null になり既存 RequireAuth が機能 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [src/lib/services/auth-actions.ts](../../../../src/lib/services/auth-actions.ts) | 322-385 | `attemptAnonymousSelfDelete` / `logout` の delete + signOut パターン。新 `deleteAccount` の雛形 |
| P0 (critical) | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 205-245 | `assertOwner` / `leaveGroup`（owner 降格 → removeMemberSelf）パターン。アカウント削除フローはこれを全 group で順次実行 |
| P0 (critical) | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 158-180 | `removeMemberSelf` の `arrayRemove` + `deleteField` 同時更新。self-leave rule との整合 |
| P0 (critical) | [src/lib/firebase/repositories/users.ts](../../../../src/lib/firebase/repositories/users.ts) | 88-98 | `deleteUserProfile` — 既存 helper をそのまま流用 |
| P1 (important) | [firestore.rules](../../../../firestore.rules) | 65-67, 85-160 | `users/{uid}` self-delete rule / `groups/{gid}` self-leave rule の前提。schema は不変、rule は追加なし（self-leave / users/{uid} delete は既に許可済） |
| P1 (important) | [src/app/settings/settings-client.tsx](../../../../src/app/settings/settings-client.tsx) | 1-138 | UI 拡張先。表示名フォーム下に削除セクションを additive 追加 |
| P1 (important) | [src/components/auth/AuthBadge.tsx](../../../../src/components/auth/AuthBadge.tsx) | 1-80 | logout の呼び出しパターン参考（`AppError.from` + logger.warn）|
| P2 (reference) | [src/lib/services/auth-actions.test.ts](../../../../src/lib/services/auth-actions.test.ts) | 440-497 | logout の test fixture（mockAuthState / makeUser / vi.mock("@/lib/firebase/repositories/users")）。新 test の雛形 |
| P2 (reference) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | 全文 | AppError 規約。新ドメインコード `auth/account-delete-*` を導入 |
| P2 (reference) | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | 「権限マトリクス」「ロール遷移」 | sole-owner check の rule との整合確認 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| `User.delete()` and `requires-recent-login` | [firebase.google.com/docs/reference/js/auth.user#userdelete](https://firebase.google.com/docs/reference/js/auth.user#userdelete) | 直近のサインインから時間が経過していると `auth/requires-recent-login` が返る。`reauthenticateWithCredential` / `reauthenticateWithPopup` で再認証してから `delete()` を retry する |
| `reauthenticateWithCredential` (Email+Password) | [firebase.google.com/docs/auth/web/manage-users#re-authenticate_a_user](https://firebase.google.com/docs/auth/web/manage-users) | `EmailAuthProvider.credential(email, password)` でクレデンシャルを組み立てて `reauthenticateWithCredential(user, cred)` を呼ぶ |
| `reauthenticateWithPopup` (Google) | 同上 | `new GoogleAuthProvider()` を渡して `reauthenticateWithPopup(user, provider)` を呼ぶ。signInWithPopup と同じ popup フロー |
| `User.providerData` | [firebase.google.com/docs/reference/js/auth.user#userproviderdata](https://firebase.google.com/docs/reference/js/auth.user) | `providerData[0].providerId` が `"google.com"` / `"password"` / `"anonymous"` の文字列。再認証ダイアログの分岐に使う |

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/auth-actions.ts:340-363
export async function attemptAnonymousSelfDelete(
  user: User,
  contextLabel: "logout" | "cancel" | "finish",
): Promise<AnonymousSelfDeleteResult> {
  if (!user.isAnonymous) return { deleted: false };
  try {
    await deleteUserProfile(user.uid);
    await user.delete();
    logger.info("anonymous self-delete ok", { uid: user.uid, context: contextLabel });
    return { deleted: true };
  } catch (e) {
    const wrapped = AppError.from(e, "auth/anon-delete-failed", "匿名アカウントの削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, uid: user.uid, context: contextLabel });
    return { deleted: false };
  }
}
```

新 `deleteAccount` も「動詞 + 名詞」形 / `Promise<{...}>` 戻り値 / `AppError.from` + `logger.warn` の rule に従う。

### ERROR_HANDLING

```ts
// SOURCE: src/lib/services/group.ts:218-228 (leaveGroup)
export async function leaveGroup({ gid, uid }: { gid: string; uid: string }): Promise<void> {
  const group = await getGroup(gid);
  if (group.ownerUids.includes(uid) && group.ownerUids.length <= 1) {
    throw new AppError(
      "最後のオーナーは脱退できません。先に別のメンバーをオーナーに昇格するか group を削除してください。",
      "group/last-owner-cannot-leave",
    );
  }
  // ...
}
```

新 `deleteAccount` も pre-check 段階で sole-owner を検出したら **同型の AppError**（`auth/account-delete-blocked-sole-owner`）を throw、UI が `code === "auth/account-delete-blocked-sole-owner"` を判定して block dialog に分岐する。

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/group.ts:179-203 (propagateDisplayNameToGroups)
const results = await Promise.allSettled(
  groupIds.map((gid) => setMemberDisplayName(gid, uid, trimmed)),
);
let failed = 0;
results.forEach((r, i) => {
  if (r.status !== "rejected") return;
  failed += 1;
  const gid = groupIds[i];
  logger.warn("propagate displayName per-group fail", {
    code: "group/propagate-per-group-fail",
    gid,
    uid,
    reasonCode: getErrorCode(r.reason),
  });
});
```

新 `deleteAccount` の **全 group 一括脱退**も `Promise.allSettled` + per-gid warn ログで best-effort、最終 summary を warn で残す。

### REPOSITORY_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/users.ts:88-98 (deleteUserProfile)
export async function deleteUserProfile(uid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "プロフィール削除に失敗しました",
    async () => {
      await deleteDoc(doc(usersRef, uid));
    },
    { uid },
  );
  logger.info("user profile delete ok", { uid });
}
```

既存の `deleteUserProfile` をそのまま流用。新 repository 関数は追加しない。

### SERVICE_PATTERN

```ts
// SOURCE: src/lib/services/auth-actions.ts:369-385 (logout)
export async function logout(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (user?.isAnonymous) {
    const result = await attemptAnonymousSelfDelete(user, "logout");
    if (result.deleted) return;
  }
  try {
    await signOut(firebaseAuth);
    logger.info("logout ok");
  } catch (e) {
    const wrapped = AppError.from(e, "auth/logout-failed", "ログアウトに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
```

新 `deleteAccount` も `firebaseAuth.currentUser` を起点に同型のフロー制御。

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/auth-actions.test.ts:1-110
const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));

vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: mockAuthState,
  firestore: {},
}));

vi.mock("firebase/auth", async () => {
  const actual = await vi.importActual<typeof import("firebase/auth")>("firebase/auth");
  return {
    ...actual,
    signOut: vi.fn(),
    reauthenticateWithCredential: vi.fn(),
    reauthenticateWithPopup: vi.fn(),
    EmailAuthProvider: { credential: vi.fn() },
    GoogleAuthProvider: vi.fn().mockImplementation(() => ({})),
  };
});
```

新 `deleteAccount` の test も同じ mock セットアップを **拡張**（`auth-actions.test.ts` に追記）し、`reauthenticateWithCredential` / `reauthenticateWithPopup` を mock 対象に追加する。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/services/account-delete.ts` | CREATE | 新 service。`deleteAccount({ user })` orchestrator。pre-check / 全 group 脱退 / `users/{uid}` 削除 / `user.delete()` を順次実行。再認証は別 helper |
| `src/lib/services/account-delete.test.ts` | CREATE | 新 service の characterization test（pre-check の sole-owner 検出 / 全 group 脱退 / requires-recent-login 後の retry など 8〜10 ケース） |
| `src/lib/services/auth-actions.ts` | UPDATE | `reauthenticateAccount({ user, password? })` helper を追加（password / google で provider 分岐し再認証）。`AppError` ドメインコード `auth/reauth-*` を新設 |
| `src/lib/services/auth-actions.test.ts` | UPDATE | `reauthenticateAccount` のテストを 4〜5 ケース追加（password 成功 / password 失敗 / google popup 成功 / popup-closed） |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | （**任意 / 推奨**）`isSoleOwnerOf(group, uid): boolean` pure helper を追加。schema 側に置くより repository 隣接が group.ts ピア helper と一貫 |
| `src/lib/firebase/schemas/group.ts` | UPDATE | （**推奨**）`isSoleOwner(group, uid): boolean` を `deriveRole` の隣に追加。pure 関数なので schema 隣のほうが import が浅い |
| `src/app/settings/settings-client.tsx` | UPDATE | 「アカウントを削除」セクションを additive 追加。3 種類の dialog（confirm / sole-owner-block / reauth）を Conditional render |
| `src/components/auth/AccountDeleteSection.tsx` | CREATE | settings-client から切り出した削除セクション + dialog コンポーネント。confirm / sole-owner-block / reauth dialog の state machine |
| `src/components/auth/AccountDeleteSection.test.tsx` | CREATE | UI 単体 test（confirm dialog 表示 / sole-owner block 表示 / reauth dialog 表示）|
| `tests/e2e/account-self-delete.spec.ts` | CREATE | E2E スペック。3 シナリオ（sole-owner で block / 通常削除成功 / requires-recent-login 後 password 再認証で削除）|
| `firestore.rules` | NO CHANGE | 既存の `match /users/{uid} { allow write: if isSignedIn() && request.auth.uid == uid; }` で self-delete 既に許可。`groups/{gid}` self-leave も Phase 4.6.1 / 4.16 で確立済 |
| `firestore.indexes.json` | NO CHANGE | クエリ追加なし（既存 `listMyGroups` を流用） |

## NOT Building

- **Cloud Functions 化** — クライアントサイドで完結。orphan な `players/{pid}` / `seasonStats/{uid}` を server で cascade 削除しない
- **過去トーナメント参加記録の削除** — `tournaments/{tid}/players/{uid}` は履歴として残す。運営者の参加履歴 / シーズン首位記録 / `seasonHistory/{seasonId}.entries` の displayName 整合性のため
- **`seasonStats/{uid}` の削除** — orphan stat（脱退済みメンバーの累計 pt が残る）になるが、UI 側は問題なく表示できる。完全クリーンアップは Phase 5+ で運営者向け「メンバー整理」UI として別途設計
- **進行中トーナメント参加中の削除** — sole-owner 以外で進行中があっても削除を block しない。退会後の `players/{pid}` は orphan player として残り、organizer が bust すれば table から除外される
- **`memberDisplayNames[uid]` の他 group へのバルク削除** — `removeMemberSelf` 経由で `deleteField()` されるため対応済（追加実装不要）
- **匿名アカウントへの本機能適用** — 匿名は既存の `attemptAnonymousSelfDelete` で完結。settings 画面では本セクションを非表示（`user.isAnonymous` で gate）
- **Firestore Rules の変更** — self-delete は既に許可済、self-leave も既存。新ブランチを追加しない
- **削除取り消し機能（undo）** — 取り消し不可（Firebase Auth `delete()` の特性）。確認 dialog で十分

---

## Step-by-Step Tasks

### Task 1: `isSoleOwner` pure helper

- **ACTION**: `src/lib/firebase/schemas/group.ts` に `isSoleOwner(group, uid): boolean` を追加
- **IMPLEMENT**:
  ```ts
  /**
   * group において uid が「唯一のオーナー」かを判定する pure helper。
   * `ownerUids.length === 1 && ownerUids[0] === uid` を簡潔に表現する。
   * アカウント削除時の sole-owner block 判定に使用。
   */
  export function isSoleOwner(group: GroupBody, uid: string): boolean {
    return group.ownerUids.length === 1 && group.ownerUids[0] === uid;
  }
  ```
- **MIRROR**: `deriveRole` / `isOrganizerRole` / `isOwnerRole` の隣（[group.ts:153-176](../../../../src/lib/firebase/schemas/group.ts#L153)）
- **IMPORTS**: 既存 `GroupBody` 型のみ
- **GOTCHA**: `ownerUids.length >= 1` は zod schema が保証するため `[0]` アクセスは安全。とはいえ防御的に length チェックを先に置く
- **VALIDATE**: unit test 4 ケース（sole owner true / co-owner false / member only false / non-member false）

### Task 2: `reauthenticateAccount` helper

- **ACTION**: `src/lib/services/auth-actions.ts` に `reauthenticateAccount({ user, password? })` を追加
- **IMPLEMENT**:
  ```ts
  import {
    EmailAuthProvider,
    GoogleAuthProvider,
    reauthenticateWithCredential,
    reauthenticateWithPopup,
  } from "firebase/auth";

  /**
   * `User.delete()` などで `auth/requires-recent-login` を返した直後に呼ぶ再認証ヘルパー。
   *
   * provider に応じて分岐:
   *   - "password": password 引数で `EmailAuthProvider.credential` を組立て `reauthenticateWithCredential`
   *   - "google.com": `GoogleAuthProvider` で `reauthenticateWithPopup`
   *   - その他（"anonymous" 等）: 何もせず throw（本ヘルパーは通常アカウント専用）
   *
   * 失敗は AppError に正規化（既存 `wrapAuthError` を再利用）。
   */
  export async function reauthenticateAccount(args: {
    user: User;
    password?: string;
  }): Promise<void> {
    const { user, password } = args;
    const providerId = user.providerData[0]?.providerId ?? null;
    try {
      if (providerId === "password") {
        if (!password) {
          throw new AppError("パスワードを入力してください", "auth/reauth-password-required");
        }
        if (!user.email) {
          throw new AppError("メールアドレスが取得できません", "auth/reauth-email-missing");
        }
        const cred = EmailAuthProvider.credential(user.email, password);
        await reauthenticateWithCredential(user, cred);
      } else if (providerId === "google.com") {
        const provider = new GoogleAuthProvider();
        await reauthenticateWithPopup(user, provider);
      } else {
        throw new AppError(
          "対応していない認証方式です",
          "auth/reauth-provider-unsupported",
        );
      }
      logger.info("reauthenticate ok", { uid: user.uid, providerId });
    } catch (e) {
      const wrapped = wrapAuthError(e, "auth/reauth-failed", "再認証に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid: user.uid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: `loginWithEmail` / `signInWithGoogle` の `wrapAuthError` 利用パターン
- **IMPORTS**: `firebase/auth` から `EmailAuthProvider` / `GoogleAuthProvider` / `reauthenticateWithCredential` / `reauthenticateWithPopup` を追加
- **GOTCHA**:
  - `wrapAuthError` は既に `auth/popup-closed-by-user` を `auth/popup-closed` に正規化するため、Google popup の閉じ操作も同コードで届く
  - `user.providerData[0]?.providerId` は配列が空の可能性（旧データ）を考慮し optional chain
- **VALIDATE**: 4 unit tests（password OK / password missing throw / google ok / unsupported provider throw）

### Task 3: `deleteAccount` orchestrator service

- **ACTION**: `src/lib/services/account-delete.ts` を新規作成
- **IMPLEMENT**:
  ```ts
  import type { User } from "firebase/auth";

  import { AppError, getErrorCode } from "@/lib/errors";
  import { firebaseAuth } from "@/lib/firebase/client";
  import { listMyGroups } from "@/lib/firebase/repositories/groups";
  import {
    deleteUserProfile,
    getUserProfile,
  } from "@/lib/firebase/repositories/users";
  import {
    isSoleOwner,
    type GroupDoc,
  } from "@/lib/firebase/schemas/group";
  import { logger } from "@/lib/logger";
  import { leaveGroup } from "@/lib/services/group";

  export interface SoleOwnerBlockedError extends AppError {
    readonly code: "auth/account-delete-blocked-sole-owner";
    readonly soleOwnerGroups: ReadonlyArray<{ id: string; name: string }>;
  }

  export class AccountDeleteSoleOwnerBlocked
    extends AppError
    implements SoleOwnerBlockedError
  {
    readonly code = "auth/account-delete-blocked-sole-owner" as const;
    constructor(public readonly soleOwnerGroups: ReadonlyArray<{ id: string; name: string }>) {
      super(
        `あなたが唯一のオーナーのサークルが ${soleOwnerGroups.length} 件あります`,
        "auth/account-delete-blocked-sole-owner",
      );
    }
  }

  export interface DeleteAccountResult {
    deleted: boolean;
    leftGroupIds: string[];
    failedGroupIds: string[];
    /** `user.delete()` で auth/requires-recent-login が出たことを示す。 */
    needsReauth: boolean;
  }

  /**
   * 通常アカウントの自己削除フロー。
   *
   * 段階:
   *   (1) Pre-check: users/{uid}.groupIds + listMyGroups で sole-owner サークルを検出。
   *       1 つでもあれば `AccountDeleteSoleOwnerBlocked` を throw（UI が dialog 分岐）。
   *   (2) 全所属サークルから順次 `leaveGroup` で脱退（Promise.allSettled で best-effort、
   *       per-gid 失敗は warn ログ）。
   *   (3) `deleteUserProfile(uid)` で users/{uid} を削除。
   *   (4) `user.delete()` を試行。`auth/requires-recent-login` のときは `needsReauth: true`
   *       で resolve（throw せず呼出側に再認証フローを誘導）。それ以外の失敗は throw。
   *
   * 注:
   *   - 匿名ユーザーは本フロー対象外（既存 `attemptAnonymousSelfDelete` 経路を使うこと）。
   *     `user.isAnonymous === true` の場合は `AppError("auth/account-delete-anon-not-supported")` を throw。
   *   - 過去 tournament の players / seasonStats は意図的に残す（NOT Building 参照）。
   */
  export async function deleteAccount({
    user,
  }: { user: User }): Promise<DeleteAccountResult> {
    if (user.isAnonymous) {
      throw new AppError(
        "匿名アカウントは本機能の対象外です。ログアウト操作で削除されます。",
        "auth/account-delete-anon-not-supported",
      );
    }

    // (1) Pre-check sole-owner
    const profile = await getUserProfile(user.uid);
    const groupIds = profile?.groupIds ?? [];
    const { groups } = await listMyGroups(groupIds);
    const soleOwnerGroups = groups
      .filter((g) => isSoleOwner(g, user.uid))
      .map((g): { id: string; name: string } => ({ id: g.id, name: g.name }));
    if (soleOwnerGroups.length > 0) {
      throw new AccountDeleteSoleOwnerBlocked(soleOwnerGroups);
    }

    // (2) Leave all groups (best-effort)
    const leaveResults = await Promise.allSettled(
      groups.map((g): Promise<{ gid: string }> =>
        leaveGroup({ gid: g.id, uid: user.uid }).then(() => ({ gid: g.id })),
      ),
    );
    const leftGroupIds: string[] = [];
    const failedGroupIds: string[] = [];
    leaveResults.forEach((r, i) => {
      const gid = groups[i].id;
      if (r.status === "fulfilled") {
        leftGroupIds.push(gid);
      } else {
        failedGroupIds.push(gid);
        logger.warn("delete-account: per-group leave failed", {
          code: "auth/account-delete-leave-failed",
          gid,
          uid: user.uid,
          reasonCode: getErrorCode(r.reason),
        });
      }
    });

    // (3) Delete users/{uid} doc (best-effort: failure does not block auth delete)
    try {
      await deleteUserProfile(user.uid);
    } catch (e) {
      logger.warn("delete-account: deleteUserProfile failed", {
        code: getErrorCode(e),
        uid: user.uid,
      });
    }

    // (4) Firebase Auth delete (may need reauth)
    try {
      await user.delete();
      logger.info("account self-delete ok", {
        uid: user.uid,
        leftCount: leftGroupIds.length,
        failedCount: failedGroupIds.length,
      });
      return { deleted: true, leftGroupIds, failedGroupIds, needsReauth: false };
    } catch (e) {
      const code = getErrorCode(e);
      if (code === "auth/requires-recent-login") {
        logger.info("account self-delete needs reauth", { uid: user.uid });
        return { deleted: false, leftGroupIds, failedGroupIds, needsReauth: true };
      }
      const wrapped = AppError.from(
        e,
        "auth/account-delete-failed",
        "アカウント削除に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code, uid: user.uid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**:
  - `attemptAnonymousSelfDelete` ([auth-actions.ts:340-363](../../../../src/lib/services/auth-actions.ts#L340)) — try / wrap / log の構造
  - `propagateDisplayNameToGroups` ([group.ts:173-203](../../../../src/lib/services/group.ts#L173)) — `Promise.allSettled` + per-gid warn
- **IMPORTS**:
  - 上記コード参照
  - 重要: `firebaseAuth` を参照しないこと。`user` を引数で受ける（test 容易性）
- **GOTCHA**:
  - sole-owner check の前に `getUserProfile` が rejected する可能性（自己 read 権限はあるが偶発的なネットワークエラー等）→ AppError として throw してよい（UI が retry 誘導）
  - `leaveGroup` は内部で「他にも owner がいる owner サークルでは ownerUids から自分を外してから removeMemberSelf」を実行する既存ロジックを流用するため、追加実装不要
  - `deleteUserProfile` 失敗を best-effort にしているのは「rule 上 self-delete は通るはずだが、tx 競合などで失敗しても auth 削除に進む」設計判断
  - `user.delete()` 成功後は onAuthStateChanged で user === null になるため、`firebaseAuth.signOut` を別途呼ぶ必要はない
- **VALIDATE**: 8〜10 unit tests（後述 Testing Strategy 参照）

### Task 4: settings-client から削除セクションを切り出した `<AccountDeleteSection>`

- **ACTION**: `src/components/auth/AccountDeleteSection.tsx` を新規作成
- **IMPLEMENT**: 状態機械を 5 状態で表現:
  ```ts
  type DialogState =
    | { kind: "closed" }
    | { kind: "confirm" }                                      // 削除確認 dialog
    | { kind: "blocked-sole-owner"; groups: { id: string; name: string }[] }
    | { kind: "reauth"; pendingDelete: true }                  // 再認証必要
    | { kind: "deleting" }                                     // 実行中
  ```

  概要:
  ```tsx
  "use client";
  import { useState } from "react";
  import type { User } from "firebase/auth";

  import { Button } from "@/components/ui/button";
  import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { AppError, getErrorCode } from "@/lib/errors";
  import { logger } from "@/lib/logger";
  import {
    AccountDeleteSoleOwnerBlocked,
    deleteAccount,
  } from "@/lib/services/account-delete";
  import { reauthenticateAccount } from "@/lib/services/auth-actions";

  export function AccountDeleteSection({ user }: { user: User }) {
    if (user.isAnonymous) return null;  // ゲストはここに来ない

    const [state, setState] = useState<DialogState>({ kind: "closed" });
    const [password, setPassword] = useState("");
    const [error, setError] = useState<string | null>(null);

    async function runDelete() {
      setState({ kind: "deleting" });
      setError(null);
      try {
        const result = await deleteAccount({ user });
        if (result.needsReauth) {
          setState({ kind: "reauth", pendingDelete: true });
          return;
        }
        // 成功 → onAuthStateChanged が user=null にし、RequireAuth が / に redirect
        // 必要なら router.push("/") を明示
      } catch (e) {
        if (e instanceof AccountDeleteSoleOwnerBlocked) {
          setState({ kind: "blocked-sole-owner", groups: [...e.soleOwnerGroups] });
          return;
        }
        const wrapped = AppError.from(e, "auth/account-delete-failed", "削除に失敗しました");
        setError(`${wrapped.code}: ${wrapped.message}`);
        setState({ kind: "closed" });
      }
    }

    async function runReauthThenDelete() {
      setState({ kind: "deleting" });
      setError(null);
      try {
        const providerId = user.providerData[0]?.providerId ?? null;
        if (providerId === "password") {
          await reauthenticateAccount({ user, password });
        } else {
          await reauthenticateAccount({ user });
        }
        // 再認証成功 → 削除を再実行
        await runDelete();
      } catch (e) {
        const wrapped = AppError.from(e, "auth/reauth-failed", "再認証に失敗しました");
        setError(`${wrapped.code}: ${wrapped.message}`);
        setState({ kind: "reauth", pendingDelete: true });
      }
    }

    // ... JSX with 3 dialogs (confirm / blocked / reauth) + section card
  }
  ```
- **MIRROR**:
  - settings-client.tsx の Card / form 構造
  - `LinkAccountDialog.tsx`（[src/components/auth/LinkAccountDialog.tsx](../../../../src/components/auth/LinkAccountDialog.tsx)）の dialog 利用パターン
- **IMPORTS**: 上記コード参照
- **GOTCHA**:
  - blocked-sole-owner dialog は **読み取り専用** で操作なし、ボタンは「閉じる」のみ
  - reauth dialog の input は `type="password"`、`autocomplete="current-password"`
  - delete 成功後は明示的に `router.push("/")` または `firebaseAuth.signOut()` を呼ばなくてよい（`user.delete()` が onAuthStateChanged を発火 → AuthProvider が user=null → RequireAuth が redirect）
  - エラー toast は既存の `<p className="text-sm text-destructive" role="alert">` パターンに揃える
- **VALIDATE**: コンポーネント単体 test（後述）+ E2E

### Task 5: settings-client への組込

- **ACTION**: `src/app/settings/settings-client.tsx` の form 下に `<AccountDeleteSection user={user} />` を additive に追加
- **IMPLEMENT**: form 末尾の `</form>` 直後、Card の閉じタグ直前に `<hr />` で区切ってからセクションを追加
- **MIRROR**: 既存 Card → CardContent → form の構造
- **IMPORTS**: `import { AccountDeleteSection } from "@/components/auth/AccountDeleteSection";`
- **GOTCHA**: 既存の表示名保存 form と state を共有しない（独立コンポーネント）
- **VALIDATE**: 表示名フォームと同居して disable の干渉が無いことを確認（dev server で目視）

### Task 6: AuthBadge / Logout の影響評価

- **ACTION**: `AuthBadge.tsx` / `PrimaryNav.tsx` の `logout` 呼び出しは **変更不要**。アカウント削除と logout は別 UI として共存
- **IMPLEMENT**: なし
- **GOTCHA**: 「ログアウト」と「アカウントを削除」は別操作と明示すること（label に紛れがないか settings-client で確認）
- **VALIDATE**: 目視 + E2E

### Task 7: Firestore Rules emulator 検証 (no-op 確認)

- **ACTION**: Firestore Rules は変更しない。既存ルールで以下が許可されることを emulator で再検証する
  - `users/{uid}` self-delete（既存 `match /users/{uid} { allow read, write: if isSignedIn() && request.auth.uid == uid; }`）
  - `groups/{gid}` self-leave（owner が他にいる前提で、self-leave 経路 + ownerUids 降格を `updateGroupRoles` 経由で先行実行する流れ）
- **IMPLEMENT**: 既存の `scripts/test-rules-finished-count.mjs` のような validator を追加せず、E2E で実機検証する（後述）
- **GOTCHA**: rule は触らないため drift 検出スクリプトは不要。CLAUDE.md `firestore-rules` 規約の「rules 変更時は必ず emulator green + `firebase deploy --only firestore:rules` 案内」は本 plan では発火しない（変更ゼロ）
- **VALIDATE**: E2E spec 全 pass

### Task 8: E2E spec

- **ACTION**: `tests/e2e/account-self-delete.spec.ts` を新規作成
- **IMPLEMENT**: 3 シナリオ:
  1. **sole-owner block**: 1 つのサークル（自分 = 唯一の owner）を持つユーザーが /settings → 「アカウントを削除する」 → blocked dialog にサークル名が表示される
  2. **正常削除**: 0 サークル所属のユーザー（または他に owner がいるサークルのみ所属）が削除実行 → 確認 dialog → 削除 → / リダイレクト → Auth Emulator から uid が消えている
  3. **requires-recent-login**: 直近サインインから 1 ヶ月以上経過した状態をシミュレート（Firebase Auth Emulator は実時間に依存しないため、`reauthenticateWithCredential` を mock する形で代替するか、E2E で再現できなければ unit test 側に責務を寄せる。emulator で再現困難な場合は E2E では (1) (2) のみ実装し、(3) は `account-delete.test.ts` の unit test で担保）
- **MIRROR**: [tests/e2e/anonymous-self-delete.spec.ts](../../../../tests/e2e/anonymous-self-delete.spec.ts) — emulator REST API（`listUsers`）で uid 消失を assert する手法
- **IMPORTS**: 既存 fixtures/test-context / fixtures/flows / fixtures/emulator
- **GOTCHA**:
  - `auth/requires-recent-login` のシナリオは Auth Emulator では再現困難（時間進行を fake できない）。unit test 側で `user.delete()` を mock して `requires-recent-login` を throw させる戦略に倒す
  - sole-owner block の検出はクライアントから直 `groups/{gid}` を read するため、E2E でテストアカウントを seed する fixture が必要（`seedOrganizerTournament` の owner として作成済の uid を流用可能）
- **VALIDATE**: `npm run test:e2e -- account-self-delete`

### Task 9: docs 更新

- **ACTION**: 以下を additive に更新
  - `.claude/rules/group-membership.md` の「権限マトリクス」に「アカウント削除（自己）: ○（sole-owner サークルがある場合は block）」を追加
  - `README.md` に「アカウント削除フロー」のミニ節を追加
  - `docs/specification/` 配下に該当する spec があれば反映（運用者・参加者向け）
- **IMPLEMENT**: 既存セクションへの数行追記のみ。新セクション作成は不要
- **MIRROR**: Phase 4.5 / 4.6 の rules / README 更新パターン
- **IMPORTS**: なし
- **GOTCHA**: ドキュメント更新は実装後の最終 commit にまとめる
- **VALIDATE**: rendered Markdown を目視確認

---

## Testing Strategy

### Unit Tests — `account-delete.test.ts`

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `deleteAccount` rejects anonymous user | `user.isAnonymous = true` | throws `auth/account-delete-anon-not-supported` | yes |
| sole-owner detection (1 group, sole owner) | groups = `[{ ownerUids: [uid] }]` | throws `AccountDeleteSoleOwnerBlocked` with `soleOwnerGroups.length === 1` | yes |
| sole-owner detection (multiple sole-owner groups) | groups = `[{ owners: [uid] }, { owners: [uid] }]` | throws with `soleOwnerGroups.length === 2` | yes |
| no sole-owner: 0 groups | `groupIds = []` | proceeds to user.delete, returns `deleted: true` | no |
| no sole-owner: co-owner group | groups = `[{ ownerUids: [uid, "u2"] }]` | leaveGroup called, user.delete called, `deleted: true` | no |
| `requires-recent-login` returns `needsReauth: true` | `user.delete` rejects with code `auth/requires-recent-login` | resolves with `{ deleted: false, needsReauth: true, leftGroupIds: [...] }` | yes |
| `user.delete` other failure | `user.delete` rejects with `auth/network-request-failed` | throws `auth/account-delete-failed` | yes |
| per-group leave failure (best-effort) | 1 of 3 leaveGroup rejects | proceeds, `failedGroupIds.length === 1`, `user.delete` still called | yes |
| `deleteUserProfile` failure (best-effort) | deleteUserProfile rejects | proceeds to user.delete, returns `deleted: true` | yes |
| `getUserProfile` returns null | `getUserProfile` resolves null | empty `groupIds`, proceeds to user.delete | no |

### Unit Tests — `auth-actions.test.ts` (additions for `reauthenticateAccount`)

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| password OK | `providerId: "password", password: "pw"` | calls `reauthenticateWithCredential` | no |
| password missing | `providerId: "password"`, no password | throws `auth/reauth-password-required` | yes |
| password wrong | reauth rejects with `auth/wrong-password` | throws normalized `auth/invalid-credentials` | yes |
| google popup OK | `providerId: "google.com"` | calls `reauthenticateWithPopup` | no |
| google popup closed | popup throws `auth/popup-closed-by-user` | throws normalized `auth/popup-closed` | yes |
| unsupported provider | `providerId: "anonymous"` | throws `auth/reauth-provider-unsupported` | yes |

### Unit Tests — `group.ts` schema (additions for `isSoleOwner`)

| Test | Input | Expected | Edge Case |
| ---- | ----- | -------- | --------- |
| sole owner | `ownerUids: ["u1"]`, uid = u1 | true | no |
| co-owner | `ownerUids: ["u1", "u2"]`, uid = u1 | false | yes |
| not owner | `ownerUids: ["u2"]`, uid = u1 | false | no |
| empty owners (defensive) | `ownerUids: []`, uid = u1 | false | yes (zod schema enforces min(1) but defensive) |

### Component Tests — `AccountDeleteSection.test.tsx`

| Test | Action | Expected |
| ---- | ------ | -------- |
| renders nothing for anonymous user | `user.isAnonymous = true` | returns null |
| shows confirm dialog on click | click "アカウントを削除する" | confirm dialog visible |
| shows blocked-sole-owner dialog when service throws | mock `deleteAccount` to throw `AccountDeleteSoleOwnerBlocked` | dialog with group names |
| shows reauth dialog when `needsReauth: true` | mock `deleteAccount` to return `{ needsReauth: true }` | reauth dialog with password input (for password user) or "Google で再認証" button (for google user) |
| reauth password mode requires password input | submit without password | shows error message, button stays |

### E2E Tests — `account-self-delete.spec.ts`

- **Scenario 1**: sole-owner ユーザーが削除 → blocked dialog 表示確認
- **Scenario 2**: 0 サークル / co-owner 所属ユーザーが削除 → Auth Emulator から uid 消失 + Firestore `users/{uid}` 消失 + groups の memberUids から uid 消失
- **Scenario 3**: (deferred to unit test) `requires-recent-login` フローは emulator で時間進行できないため unit test に委譲

### Edge Cases Checklist

- [x] 0 サークル所属 → 即削除に進む
- [x] sole-owner サークル 1 件 → block
- [x] sole-owner サークル 複数件 → block（一覧表示）
- [x] co-owner サークルのみ → leave 実行 → 削除
- [x] 一部 leave が失敗 → best-effort 続行 → 削除
- [x] `deleteUserProfile` 失敗 → best-effort 続行 → 削除
- [x] `user.delete()` requires-recent-login → 再認証 dialog
- [x] 再認証パスワード誤り → エラー表示 + dialog 維持
- [x] 再認証 google popup 閉じ → エラー表示 + dialog 維持
- [x] 匿名ユーザーが /settings に到達した場合 → セクション非表示
- [x] 削除成功後 → onAuthStateChanged で user=null → RequireAuth が / にリダイレクト
- [x] 進行中トーナメントに参加中の owner（co-owner あり）の削除 → 削除可能（player は orphan として残る）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: Zero new lint errors（既存 warning は不問）

### Unit Tests

```bash
npm run test -- account-delete
npm run test -- auth-actions
npm run test -- group.test
```

EXPECT: All tests pass、新 test も all green

### Full Unit Test Suite

```bash
npm run test
```

EXPECT: No regressions

### Build

```bash
npm run build
```

EXPECT: Build green、Next.js 15 App Router で型エラーなし

### E2E

```bash
npm run test:e2e -- account-self-delete
```

EXPECT: 2 シナリオ（sole-owner block / 正常削除）が green。requires-recent-login シナリオは unit test で担保

```bash
npm run test:e2e
```

EXPECT: 既存 E2E（`anonymous-self-delete.spec.ts` 含む）に regression なし

### Manual Validation

- [ ] dev server を起動し（`npm run dev`）、Google 新規アカウントを作成 → /settings → 「アカウントを削除する」 → 確認 dialog → 削除 → / にリダイレクト → ログアウトされていることを確認
- [ ] Firebase Auth Console で削除した uid が消えていることを確認
- [ ] Firestore Console で `users/{uid}` が消えていることを確認
- [ ] sole-owner サークルを作成 → /settings → 削除を試行 → blocked dialog でサークル名が出ることを確認
- [ ] sole-owner サークルを削除 → /settings → 再度削除を試行 → 通常削除フローに進むことを確認
- [ ] パスワード認証ユーザーで削除を試行（一定時間後） → reauth dialog → 正しいパスワードで完了

---

## Acceptance Criteria

- [ ] /settings に「アカウントを削除」セクションが表示される（通常アカウントのみ）
- [ ] 自分が唯一の owner のサークルがあれば削除を block し、サークル名一覧を提示する
- [ ] block 通過時、所属する全サークルから自動脱退する（best-effort）
- [ ] `users/{uid}` ドキュメントと認証情報の両方が削除される
- [ ] `auth/requires-recent-login` 時は再認証 dialog → 再認証成功後に削除が完了する
- [ ] 過去の `players/{pid}` と `seasonStats/{uid}` は残る（履歴の継続性）
- [ ] 全 unit / E2E / typecheck / lint / build が green
- [ ] 既存 E2E（`anonymous-self-delete.spec.ts` 等）に regression なし
- [ ] CLAUDE.md / `.claude/rules/group-membership.md` の権限マトリクスを更新

## Completion Checklist

- [ ] `isSoleOwner` 純関数 + 4 unit tests
- [ ] `reauthenticateAccount` helper + 6 unit tests
- [ ] `deleteAccount` orchestrator + 10 unit tests
- [ ] `AccountDeleteSection` コンポーネント + 5 component tests
- [ ] settings-client への組込
- [ ] E2E spec 2 シナリオ（block + 正常削除）
- [ ] AppError ドメインコード追加: `auth/account-delete-blocked-sole-owner` / `auth/account-delete-failed` / `auth/account-delete-anon-not-supported` / `auth/reauth-failed` / `auth/reauth-password-required` / `auth/reauth-email-missing` / `auth/reauth-provider-unsupported` / `auth/account-delete-leave-failed`
- [ ] [.claude/rules/group-membership.md](../../../rules/group-membership.md) の権限マトリクスに「アカウント削除」行を追加
- [ ] README に簡単な機能説明（オプション）
- [ ] PRD 01 の Implementation Phases 表に Phase 5.x として行追加（または phase-5 polish 細目として説明）

---

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| sole-owner check と並行して別端末で owner 降格があり race window が成立 | L | M | sole-owner check は client side の listMyGroups を使うため stale read の可能性。発見後 `leaveGroup` 内の `removeMemberSelf` が rule 側 `last owner cannot leave` invariant で deny される（フェールセーフ）。最悪でも user.delete() は失敗、user 側で再試行 |
| `leaveGroup` 中に他 owner が同時に脱退し、ownerUids が空になる | L | H | service 層の `leaveGroup` は `getGroup` 後に owner 降格 → removeMemberSelf を順次実行する。owner が同時に消える場合は rule 側で deny されて throw、自分の削除は continue（best-effort）。data-integrity 違反は rule 側で阻止 |
| Auth Emulator で `requires-recent-login` を再現できず E2E カバレッジが落ちる | M | M | unit test で `user.delete` を mock し reauth フローを担保する。E2E は block + 正常削除の 2 系統に絞る |
| 過去 player records の orphan 化で UI 表示崩れ | L | L | 既存の SeatingBoard / WinnerBanner は `displayName` をそのまま表示し、参照側でも `users/{uid}` が無くて問題ない（既に Phase 4.5 の匿名削除でも同パターン）。新規 cleanup 不要 |
| 再認証 popup ブロックでフロー停止 | L | M | wrapAuthError が `auth/popup-blocked` を normalize 済み。UI でエラー表示 + 再試行ボタン |
| 新ドメインコードの重複・既存コードと衝突 | L | L | 既存 grep で `auth/reauth-*` / `auth/account-delete-*` が無いことを確認済（grep 結果 hit ゼロ）。命名は既存の `auth/anon-delete-failed` / `auth/login-failed` / `auth/google-failed` パターンに揃える |
| settings 画面に削除セクションが出ることで誤操作リスク増 | L | M | (1) 確認 dialog で明示的な「削除する」入力を必須化、(2) 削除ボタンは destructive variant（赤）で他のボタンと色を分ける、(3) 仕様書 / README で「取り消せない」を明記 |

## Notes

- **PRD 帰属の判断**: 本 plan は free-form プロンプト由来であり、最新コミット context は `02-season-stats-and-share` Phase D だが、機能本体は **PRD 01 の Phase 4.5「匿名アカウント自己削除」の通常アカウント版拡張** であるため `01-allin-timer/plans/` 配下に配置した（CLAUDE.md の triggering PRD 規定の解釈: 「コードがどこにあるか」ではなく、「機能ファミリの起点 PRD」を優先）。実装後は PRD 01 Implementation Phases 表に Phase 5.x として行を追加する判断を実装担当に委ねる
- **Phase 4.5 との関係**: 既存 `attemptAnonymousSelfDelete` は本機能で **置換しない**。匿名向けは `logout` / `cancelOwnEntry` / `live-client.finish` の 3 経路に残し、本 plan の `deleteAccount` は通常アカウント専用パスとして並列に存在する
- **Cloud Functions 化の余地**: 完全な orphan 排除（`players/{pid}` / `seasonStats/{uid}` の cascade 削除）は Cloud Functions 化が現実解。Phase 5+ の運営者向け「メンバー整理」UI（運営者が脱退者の orphan stat を一括削除する）と合わせて検討する
- **rule 変更ゼロの意義**: 既存の `users/{uid}` self-delete / `groups/{gid}` self-leave / `groupJoinCodes` 関連 rule は本機能で十分。rule デプロイ案内は不要（CLAUDE.md memory 「Firestore rules 変更時は deploy 案内必須」の発火条件外）
- **「自分のみオーナー」の文言**: ユーザー requirement を「自分のみがオーナーのサークルがあるかチェック」と受けたが、実装は「`ownerUids.length === 1 && ownerUids[0] === uid`」で表現する。「他に運営はいるが owner ではない」サークル（自分が唯一の owner で、organizer / member は他にいる）も block 対象。block dialog の文言で「サークルを削除するか他メンバーを **オーナーに昇格** してください」を強調する
