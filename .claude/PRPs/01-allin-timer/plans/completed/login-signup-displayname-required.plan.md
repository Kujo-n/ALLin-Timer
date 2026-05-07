# Plan: 新規登録の表示名必須化＆Google ボタン位置の再設計（/login）

## Summary

`/login` の「新規登録」モードで、Google アカウント連携でも メールアドレス＋PW でも **表示名（displayName）を upfront で必須入力** にする。Google ボタンは現状 Card 最上段に固定配置されているが、視覚上「Google を選ぶと表示名は不要」に見えるためレイアウトを再設計する。タブを最上位に置き、フォーム → 区切り → Google ボタン の順に並べ、register モードでは displayName 入力を tab 直下に置いて Email+PW / Google の双方で参照される共通フィールドにする。

## User Story

As a **新規ユーザー**,
I want **「新規登録」を選んだ時点で、Google 連携か メールアドレス+PW かに関わらず表示名を入力する場所がはっきり分かること**,
So that **Google ボタンを押した後にダイアログでいきなり表示名を要求される驚きを避けられ、サインアップ前に自分が席表でどう表示されるか理解できる**.

## Problem → Solution

**現状（問題）**:
- `/login` Card は **Google ボタンが最上段**、続いて divider「または」、続いて Mode タブ（ログイン / 新規登録）、最後にフォーム（register モード時のみ表示名入力あり）の順で並ぶ。Google ボタンは mode に依存せず常に「Google でログイン」表記
- メールアドレス+PW の register では表示名入力欄がフォーム内に出るが、**Google ボタンは表示名フィールドが視界に入らない位置にあり、表示名なしでサインアップできるように見える**
- 実際は `signInWithGoogle()` 後に `needsDisplayNameSetup === true` のとき `<DisplayNameDialog>` が popup で開き表示名を必須入力させているため "後追い" で表示名は要求される。が、UX 上の不整合として「最初に表示されているフォームに表示名がない＝ Google なら不要」と読めてしまう

**解決方針**:
- Tab を Card の最上位に置き、「ログイン / 新規登録」を最初のフォーカス対象にする
- register モードでは tab 直下に **共通の displayName 入力フィールド**を配置し、Email+PW でも Google でも同じ値を使う
- Google ボタンを Card 末尾（form と divider の下）に移動。ラベルを mode 連動で「Google で新規登録」/「Google でログイン」に変える
- register モードで Google ボタンを押下した瞬間に displayName を **service 層でも validate** し、空文字なら popup 起動せず field-level error を出す
- `signInWithGoogle()` 後に `needsDisplayNameSetup === true` なら、popup ダイアログを出さずに **upfront で入力済の displayName を `updateDisplayName()` でそのまま保存**する（ダイアログを skip）。`needsDisplayNameSetup === false` なら既存ユーザー扱いで通常 redirect（入力された displayName は破棄、サークル用ニックネームを保護する Phase 4.7 規約を維持）
- **login モード + Google で `isNewUser === true` のときは弾く** — `signInWithPopup` 直後に `user.delete()` で Auth ユーザーを破棄し、`auth/not-registered-yet` AppError を throw して field-level error「このアカウントはまだ登録されていません。「新規登録」タブから登録してください。」を表示する。Auth ユーザーをそのまま残すと `users/{uid}` が無い状態で再ログインしても同じ判定になり詰むため、必ず rollback する
- DisplayNameDialog コンポーネント自体は **login モードで `isNewUser === false` だが `users/{uid}` の displayName が空 / 不在の legacy ユーザー救済**用に残す（Phase 5.1 で追加された fallback。新規 Google アカウントは `isNewUser=true` で弾かれるため、ここに到達するのは Phase 4.7 以前に作成され `users/{uid}` を持たない既存ユーザーのみ）

## Metadata

- **Complexity**: Small
- **Source PRD**: `.claude/PRPs/01-allin-timer/prds/01-allin-timer.prd.md`（明示 Phase 帰属なし、Phase 4.7「Onboarding Polish」と同系統の post-5.5 polish 作業）
- **PRD Phase**: N/A — free-form polish。01-allin-timer の onboarding work-stream に紐づける
- **Estimated Files**: 4 + 1 新規テスト（実装 2 / E2E POM 0〜1 / unit test 1〜2）

---

## UX Design

### Before — register モード

```
┌─────────────────────────────────────────┐
│ 新規登録                                 │
│ 運営者として…の認証画面です              │
├─────────────────────────────────────────┤
│ [G  Google でログイン        ]          │ ← mode に依存しないラベル
│                                         │
│ ────────── または ──────────             │
│                                         │
│ [ログイン | 新規登録(active)]            │ ← tab がここでようやく見える
│                                         │
│ 表示名: [________________]              │ ← register 時のみ。
│         「トーナメント参加時に席表に     │   Google ボタンから視覚的に遠い
│          表示される名前です（15文字）」 │
│ メールアドレス: [______________]        │
│ パスワード: [_______________]           │
│ [新規登録                  ]            │
└─────────────────────────────────────────┘
```

### After — register モード

```
┌─────────────────────────────────────────┐
│ 新規登録                                 │
│ 運営者として…の認証画面です              │
├─────────────────────────────────────────┤
│ [ログイン | 新規登録(active)]            │ ← まずモード選択
│                                         │
│ 表示名 *                                 │ ← register 時のみ tab 直下
│ [________________]                      │   サインアップ方法に依らず必須
│ 「トーナメント参加時に席表・参加者一覧   │   と分かる位置
│  に表示される名前です（15文字以内）」    │
│                                         │
│ メールアドレス: [______________]        │
│ パスワード: [_______________]           │
│ [新規登録                  ]            │ ← Email+PW での新規登録
│                                         │
│ ────────── または ──────────             │
│                                         │
│ [G  Google で新規登録      ]            │ ← mode 連動ラベル、フォーム末尾
└─────────────────────────────────────────┘
```

### After — login モード

```
┌─────────────────────────────────────────┐
│ ログイン                                 │
├─────────────────────────────────────────┤
│ [ログイン(active) | 新規登録]            │
│                                         │
│ メールアドレス: [______________]        │ ← login は表示名フィールドなし
│ パスワード: [_______________]           │
│ [ログイン                  ]            │
│                                         │
│ ────────── または ──────────             │
│                                         │
│ [G  Google でログイン      ]            │ ← mode 連動ラベル
└─────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| Tab 配置 | Google ボタン下、divider の更に下 | Card 最上位（CardContent 先頭） | mode を最初に選ばせる |
| Google ボタン位置 | Card 最上段 | フォーム末尾の divider 下 | Email+PW form と並列の選択肢として可視化 |
| Google ボタンラベル | "Google でログイン"（固定） | "Google でログイン" / "Google で新規登録"（mode 連動） | 押した結果が直感的になる |
| 表示名 field 配置 | register form 中（password の上） | register form 先頭、tab 直下 | サインアップ方法に依らない共通入力と分かる |
| Google + register 経路 | popup → DisplayNameDialog で表示名要求 | upfront 入力済の displayName を popup 直後に直接保存（dialog 不在） | "後追い dialog" を排除 |
| Google + register で displayName 空 | popup を開いてから dialog で要求 | popup を開かず field-level error を出す | 余分な popup を出さない |
| Google + register で既存ユーザー検出 | ダイアログを開かず即 redirect | toast「既にアカウントがあります。ログインしました。」を info として表示し redirect。入力した displayName は破棄（`users/{uid}` の既存値を保護） | Phase 4.7 規約「既存 displayName を上書きしない」を維持 |
| Google + login で新規 Google アカウント | popup → DisplayNameDialog で表示名入力後ログイン完了 | popup → `isNewUser=true` 検出 → `user.delete()` で Auth ユーザー破棄 → 「このアカウントはまだ登録されていません。「新規登録」タブから登録してください。」を field-level error で表示 | login タブからの新規作成を明示的に拒否 |
| Google + login で既存ユーザー（プロフィール完備）| popup → 即 redirect | 同左（変更なし） | 通常ログイン経路 |
| Google + login で legacy ユーザー（`isNewUser=false` ＆ `users/{uid}` の displayName 空 / 不在）| popup → DisplayNameDialog で表示名入力 | 同左（変更なし） | Phase 4.7 以前に作成された Auth-only ユーザー救済として DisplayNameDialog を維持 |

---

## Mandatory Reading

| Priority       | File                                                                  | Lines  | Why                                                                                  |
| -------------- | --------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------ |
| P0 (critical)  | [src/app/login/login-client.tsx](../../../../src/app/login/login-client.tsx) | 1-239  | リファクタ対象本体。state / submit / Google handler / DisplayNameDialog 配線         |
| P0 (critical)  | [src/lib/services/auth-actions.ts](../../../../src/lib/services/auth-actions.ts) | 90-205 | `validateDisplayName` / `registerWithEmail` / `signInWithGoogle` / `updateDisplayName` の現契約 |
| P0 (critical)  | [src/components/auth/DisplayNameDialog.tsx](../../../../src/components/auth/DisplayNameDialog.tsx) | 全件   | 残す前提の fallback dialog。新規実装で同パターンを mirror             |
| P1 (important) | [src/lib/services/auth-actions.test.ts](../../../../src/lib/services/auth-actions.test.ts) | 165-328 | `registerWithEmail` / `signInWithGoogle` の既存仕様（regression 防止）             |
| P1 (important) | [tests/e2e/pages/LoginPage.ts](../../../../tests/e2e/pages/LoginPage.ts) | 1-52   | E2E POM。`displayNameInput` / `submitButton` / `register()` フローの後方互換確認  |
| P1 (important) | [tests/e2e/fixtures/flows.ts](../../../../tests/e2e/fixtures/flows.ts) | 32-43  | `registerOrganizer` flow。E2E 全体が依存                                        |
| P2 (reference) | [tests/e2e/email-link-removed.spec.ts](../../../../tests/e2e/email-link-removed.spec.ts) | 全件  | tab assertion (`expectTabs(["ログイン", "新規登録"], ["メールリンク"])`) を維持 |
| P2 (reference) | [.claude/rules/error-logging.md](../../../rules/error-logging.md)     | 全件   | AppError ラップ・logger.warn / info 規約                                            |
| P2 (reference) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | `DISPLAY_NAME_MAX_LENGTH` の export | 共通定数の参照元                                                  |

## External Documentation

外部研究は不要。既存 Firebase Auth SDK と shadcn/ui パターンのみで完結する。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/auth-actions.ts:102-125
export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const trimmed = validateDisplayName(displayName);
  // ...
}
```

新ヘルパー名は **`signUpWithGoogle(displayName: string)`** で揃える（registerWithEmail に対応する Google 版という意味付け）。

### ERROR_HANDLING

```ts
// SOURCE: src/lib/services/auth-actions.ts:107, 274-275
const trimmed = validateDisplayName(displayName);
// validation/display-name-required または validation/display-name-too-long を投げる
```

```ts
// SOURCE: src/app/login/login-client.tsx:69-73
const wrapped = AppError.from(e, "auth/unknown", "認証に失敗しました");
logger.warn(wrapped.message, { code: wrapped.code });
setError(`${wrapped.code}: ${wrapped.message}`);
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/auth-actions.ts:200-204
logger.info("google sign-in ok", {
  uid: cred.user.uid,
  isNewUser,
  needsDisplayNameSetup,
});
```

新ヘルパーでも `signUpWithGoogle ok` / `signUpWithGoogle existing-user` のように context を残す。

### SERVICE_LAYER_HELPER（既存ユーザー検出時の no-op）

```ts
// SOURCE: src/lib/services/auth-actions.ts:177-181 (コメント)
// Phase 4.7 から既存ユーザーの users/{uid} 上書きはしない（サークル用ニックネーム設定を保護するため）。
```

新ヘルパーで `mode === "already-existing"` のときは `updateDisplayName` を呼ばず、入力された name を破棄する。

### FORM_PATTERN

```tsx
// SOURCE: src/app/login/login-client.tsx:163-178
<div className="space-y-2">
  <Label htmlFor="reg-name">表示名</Label>
  <Input
    id="reg-name"
    required
    maxLength={DISPLAY_NAME_MAX_LENGTH}
    value={displayName}
    onChange={(e) => setDisplayName(e.target.value)}
  />
  <p className="text-xs text-muted-foreground">
    トーナメント参加時に席表・参加者一覧に表示される名前です（
    {DISPLAY_NAME_MAX_LENGTH} 文字以内）。
  </p>
</div>
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/auth-actions.test.ts:164-212
describe("registerWithEmail", () => {
  it("rejects blank displayName before calling Firebase", async () => {
    await expect(registerWithEmail("a@b.com", "pw", "  ")).rejects.toMatchObject({
      code: "validation/display-name-required",
    });
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });
  // ...
});
```

新ヘルパー `signUpWithGoogle` のテストも同型で書く（blank → reject before popup, success → updateDisplayName 呼出, existing-user → updateDisplayName skip 等）。

---

## Files to Change

| File                                                   | Action | Justification                                                                                                                  |
| ------------------------------------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `src/lib/services/auth-actions.ts`                     | UPDATE | 新ヘルパー 2 件を追加: (1) `signUpWithGoogle(displayName)` — register モード用、(2) `loginWithGoogle()` — login モード用、`isNewUser=true` で `user.delete()` rollback + `auth/not-registered-yet` throw。`signInWithGoogle()` 自体は不変（`/join` の `joinViaGoogle` 互換性維持） |
| `src/lib/services/auth-actions.test.ts`                | UPDATE | 新ヘルパー 2 件の unit test を追加。`signUpWithGoogle` 4 件 + `loginWithGoogle` 4 件                                              |
| `src/app/login/login-client.tsx`                       | UPDATE | レイアウト再構成。Google ボタンを末尾移動、tab を最上位、register モードで displayName を tab 直下に表示。register モードの Google handler は `signUpWithGoogle`、login モードは `loginWithGoogle` 経由 |
| `tests/e2e/email-link-removed.spec.ts`                 | UPDATE | tab assertion 自体は不変。**追加**で「register モードで Google ボタンが visible / ラベルが mode 連動 / displayName 入力欄が tab 直下にある」「register で displayName 空のまま Google を押すと error が出る」の 2 件を足す（Google popup は実走させない） |

(POM `tests/e2e/pages/LoginPage.ts` は **更新不要** — `getByLabel("表示名")` / `getByRole("button", { name: "新規登録" })` / `getByRole("tab", ...)` が新レイアウトでも一致する。後述「No Prior Knowledge Test」で根拠を示す)

(関連: `tests/e2e/fixtures/flows.ts.registerOrganizer` も **更新不要** — POM と同様に label / role 名で取得しているため新レイアウトでそのまま動く)

## NOT Building

- **`/join/[tid]` の受付画面の Google ボタン位置変更** — 受付画面は「ゲスト」「ログイン」タブ構成で「新規登録」タブが無く、Google サインアップではなく `joinViaGoogle()`（既存ユーザー想定の参加）に倒している。今回の trigger（"「新規登録」時"）と異なる文脈のため out of scope
- **`signInWithGoogle()` 自体のシグネチャ変更** — `joinViaGoogle()` が `{ user, isNewUser, needsDisplayNameSetup }` の形に依存している。互換性を壊さないため新ヘルパーとして追加する
- **DisplayNameDialog コンポーネントの削除** — login モードでの edge case 救済（既存 Auth ユーザーに `users/{uid}` が無い・displayName が空 etc.）に引き続き必要
- **Firestore schema / rules / repository の変更** — 新フィールド・新 collection なし。既存の `users/{uid}` upsert（`upsertUserProfile`）と `firebase.auth.User.updateProfile` の組合せで完結する
- **i18n** — 既存実装も日本語固定。本 plan も同方針
- **既存ユーザーが register モードで Google を押したときの表示名 "上書き提案" UI** — Phase 4.7 規約（サークル用ニックネーム保護）に反するため実装しない。toast 表示のみで終わらせる

---

## Step-by-Step Tasks

### Task 1: `signUpWithGoogle` / `loginWithGoogle` ヘルパーを auth-actions.ts に追加

- **ACTION**: 新規エクスポート関数を `src/lib/services/auth-actions.ts` に追加
- **IMPLEMENT**:
  ```ts
  /**
   * 新規登録モードでの Google サインアップ。
   * 表示名を upfront で必須入力させ、新規ユーザーなら入力された名前で
   * `users/{uid}` を初期化する。既存ユーザーが検出されたときは
   * Phase 4.7 規約に従い `users/{uid}` を上書きせず、`mode: "already-existing"`
   * を返して UI 側で toast 表示等に使ってもらう。
   *
   * `joinViaGoogle` (`receipt.ts`) は引き続き `signInWithGoogle` を直接使う前提のため
   * 互換性を維持する別経路として追加する。
   */
  interface SignUpWithGoogleResult {
    user: User;
    /**
     * - "created": 新規ユーザー or 表示名未設定の既存 Auth ユーザーで、入力された displayName を保存した
     * - "already-existing": 既存ユーザーで `users/{uid}` に有効な displayName があったため上書きを skip した
     */
    mode: "created" | "already-existing";
  }
  export async function signUpWithGoogle(
    displayName: string,
  ): Promise<SignUpWithGoogleResult> {
    const trimmed = validateDisplayName(displayName);
    const result = await signInWithGoogle();
    if (result.needsDisplayNameSetup) {
      // updateDisplayName は内部で Auth.updateProfile + users/{uid} upsert + group propagate を担う
      await updateDisplayName(trimmed);
      logger.info("signUpWithGoogle ok created", { uid: result.user.uid });
      return { user: result.user, mode: "created" };
    }
    logger.info("signUpWithGoogle ok existing", { uid: result.user.uid });
    return { user: result.user, mode: "already-existing" };
  }

  /**
   * ログインモードでの Google サインイン。
   * `isNewUser === true` を検出した場合は **未登録ユーザーとして弾き**、
   * Auth ユーザーを `user.delete()` で破棄してから `auth/not-registered-yet`
   * を throw する。`isNewUser === false` の既存ユーザーは通常通り通過させる
   * （`needsDisplayNameSetup === true` の legacy 救済は呼出側で DisplayNameDialog
   * に倒す = signInWithGoogle の戻り値をそのまま返す）。
   *
   * 設計理由: Auth ユーザーをそのまま残すと再ログインしても同じ判定になり詰む。
   * `signInWithPopup` 直後の freshly-authenticated 状態で `user.delete()` を
   * 呼べるため `auth/requires-recent-login` には原則ならない。
   * 失敗時は signOut にフォールバックして best-effort で片付ける。
   */
  export async function loginWithGoogle(): Promise<GoogleSignInResult> {
    const result = await signInWithGoogle();
    if (result.isNewUser) {
      try {
        await result.user.delete();
        logger.info("loginWithGoogle rolled back new user", { uid: result.user.uid });
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "auth/rollback-failed",
          "サインインの取り消しに失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code, uid: result.user.uid });
        try {
          await signOut(firebaseAuth);
        } catch (signOutErr) {
          logger.warn("loginWithGoogle signOut fallback failed", {
            code: getErrorCode(signOutErr),
          });
        }
      }
      throw new AppError(
        "このアカウントはまだ登録されていません。「新規登録」タブから登録してください。",
        "auth/not-registered-yet",
      );
    }
    return result;
  }
  ```
- **MIRROR**:
  - `signUpWithGoogle`: `registerWithEmail` の構造（`validateDisplayName` を最初に呼ぶ）
  - `loginWithGoogle`: `attemptAnonymousSelfDelete`（`auth-actions.ts:343-366`）の best-effort 削除パターン（`user.delete()` 失敗時に signOut フォールバック）
- **IMPORTS**: 同 file 内の `User` / `validateDisplayName` / `signInWithGoogle` / `updateDisplayName` / `signOut` / `firebaseAuth` / `logger` をそのまま使用。`getErrorCode` は `@/lib/errors` から追加 import が必要（`error-logging.md` 規約）
- **GOTCHA**:
  - `signUpWithGoogle`: `validateDisplayName` を popup より前に呼ぶこと。`signInWithGoogle` が `AccountLinkRequired` を throw する可能性があるため、その場合は呼出側（LoginClient）で既存と同じ分岐に倒す。本ヘルパーは catch しない
  - `loginWithGoogle`: `result.user.delete()` 後に `auth.currentUser` は null になる（reauth 不要）。signOut フォールバックは "delete に失敗したが Auth user が残存している" 場合に最低限のセッション切断のために実行
  - `loginWithGoogle` で `isNewUser=false` & `needsDisplayNameSetup=true`（legacy ユーザー）のときはそのまま通過させ、呼出側の DisplayNameDialog 経路に乗せる。判定基準は `isNewUser` であり `needsDisplayNameSetup` ではない（後者には「`users/{uid}` 不在の Phase 4.7 以前 legacy」が含まれるため）
- **VALIDATE**: `npm run typecheck`. unit テストで signUpWithGoogle 4 件 + loginWithGoogle 4 件が緑

### Task 2: `signUpWithGoogle` / `loginWithGoogle` の unit test を追加

- **ACTION**: `src/lib/services/auth-actions.test.ts` の末尾に 2 つの describe ブロックを追加
- **IMPLEMENT**:
  - **`describe("signUpWithGoogle")`**:
    - **blank reject**: `await expect(signUpWithGoogle("  ")).rejects.toMatchObject({ code: "validation/display-name-required" })`. `signInWithPopup` が呼ばれていないことを assert
    - **too-long reject**: 16 文字で同様
    - **created path**: `getAdditionalUserInfo` を `{ isNewUser: true }` で mock、`signInWithPopup` で user 返却、`getUserProfile` を null。expect: 戻り値 `{ mode: "created" }`、`updateProfile` が trim 済み name で呼ばれる、`upsertUserProfile` が呼ばれる
    - **already-existing path**: `getAdditionalUserInfo` を `{ isNewUser: false }`、`getUserProfile` を `{ displayName: "Existing", ... }` で mock。expect: 戻り値 `{ mode: "already-existing" }`、`updateProfile` が呼ばれない、`upsertUserProfile` が呼ばれない（`updateDisplayName` 自体が呼ばれない）
    - **AccountLinkRequired は通過**: `signInWithPopup` を `auth/account-exists-with-different-credential` で reject。expect: ヘルパーは `AccountLinkRequired` をそのまま再 throw する
  - **`describe("loginWithGoogle")`**:
    - **既存ユーザーは通過**: `getAdditionalUserInfo` を `{ isNewUser: false }`、`signInWithPopup` で user 返却、`getUserProfile` で profile あり。expect: 戻り値 `{ user, isNewUser: false, needsDisplayNameSetup: false }`、`user.delete` が呼ばれない
    - **新規ユーザーは弾く（rollback 成功）**: `getAdditionalUserInfo` を `{ isNewUser: true }`、`signInWithPopup` で user 返却（`user.delete` は resolved）。expect: reject `auth/not-registered-yet`、`user.delete` が呼ばれる、`signOut` は呼ばれない
    - **新規ユーザー rollback 失敗時 signOut フォールバック**: 同上だが `user.delete` を `auth/requires-recent-login` で reject。expect: reject `auth/not-registered-yet`、`user.delete` 呼出、`signOut` 呼出
    - **legacy ユーザー（isNewUser=false & profile.displayName 空）は通過**: `getAdditionalUserInfo` を `{ isNewUser: false }`、`getUserProfile` を `{ displayName: "" }`。expect: 戻り値 `{ needsDisplayNameSetup: true }`、`user.delete` 呼ばれず、エラー throw されず（呼出側 LoginClient が DisplayNameDialog に倒す）
- **MIRROR**: `auth-actions.test.ts:164-212` (`describe("registerWithEmail")`) と `:242-328` (`describe("signInWithGoogle")`) と `:476-512` (`describe("logout")` の anonymous self-delete テスト = `user.delete` 成功 / 失敗パターン)
- **IMPORTS**: 既存 import に `signUpWithGoogle` / `loginWithGoogle` を追加
- **GOTCHA**:
  - `vi.mocked(getUserProfile)` は `signInWithGoogle` 内で 1 回 + `updateDisplayName` 内で 1 回（group propagate 用 best-effort）呼ばれる。`mockResolvedValueOnce` ではなく default `mockResolvedValue` で 2 度目呼出にも備える
  - `mockAuthState.currentUser` を `signUpWithGoogle` 成功シナリオでは Google サインインした user に差し替える必要がある（`updateDisplayName` 内部で `firebaseAuth.currentUser` を読む）
  - `loginWithGoogle` 新規ユーザーケースでは `mockAuthState.currentUser = null` で問題なし（updateDisplayName を呼ばないため）
  - `makeUser` factory で `delete: vi.fn().mockResolvedValue(undefined)` がデフォルトに含まれているのでそのまま使える（`auth-actions.test.ts:97` の既存実装）
- **VALIDATE**: `npx vitest run src/lib/services/auth-actions.test.ts`. 既存テストの regression なし、新規 8 件すべて緑

### Task 3: `LoginClient` のレイアウト再構成と Google handler 分岐

- **ACTION**: `src/app/login/login-client.tsx` を以下の順で書き換え
- **IMPLEMENT**:
  1. JSX の構造を `<CardContent>` 内で **tab → form → divider → Google ボタン** の順に変更
  2. register モードでは form 先頭に displayName 入力（既存パーツをそのまま移動、`required` / `maxLength={DISPLAY_NAME_MAX_LENGTH}` 維持）
  3. Google ボタンのラベルを `mode === "register" ? "Google で新規登録" : "Google でログイン"` に
  4. `onGoogleSignIn` を 2 経路に分割
     - register モード: 新ヘルパー `signUpWithGoogle(displayName)` を呼ぶ。`mode === "created"` なら `refreshUser()` → `router.replace(redirect)`、`mode === "already-existing"` なら toast 相当の info 文字列を専用 `notice` state に出してから `router.replace(redirect)`
     - login モード: 新ヘルパー `loginWithGoogle()` を呼ぶ。`auth/not-registered-yet` AppError を catch したら `setError(wrapped.message)` のみ表示（redirect しない）。それ以外で `needsDisplayNameSetup === true`（legacy ユーザー救済）なら従来通り `setDisplayNameDialogOpen(true)` で DisplayNameDialog 経路に倒す
  5. `validateDisplayName` の早期 throw を catch して field-level error として表示する分岐を追加（popup を開かないため `setSubmitting(false)` を確実に呼ぶ）
  6. `<Card>` の `CardTitle` / `CardDescription` は mode 連動で動的化済 (`title` 変数) を維持
- **MIRROR**:
  - 既存 `onSubmitPassword` の try/catch/finally 形 (`login-client.tsx:56-76`)
  - `displayName` field の既存実装 (`:163-178`)
  - DisplayNameDialog 表示判定の既存ロジック (`:228-236`)
- **IMPORTS**: `signUpWithGoogle` を `@/lib/services/auth-actions` から追加 import
- **GOTCHA**:
  - 「既にアカウントがあります」を伝えるとき、`error` state を流用すると `text-destructive` で表示されてしまう。**新たに `notice` state を足し、success トーン（既存 `text-muted-foreground` か新規 `text-sky-600` 等）でレンダリング**するのが望ましい。MEMORY: ユーザー向け文言にスタック名を出さない（"Firebase" / "Firestore" / "Google アカウント" は OK だが、"Auth" / "Firebase Auth" / "users/{uid}" は出さない）
  - `register` モードの Google ボタンを **`disabled={submitting || !displayName.trim()}`** にすると、displayName が空でもクリック試行→ field-level error の挙動を取れない。**disabled は使わず、ボタンクリック時に `validateDisplayName` を呼んで AppError を catch → error 表示**にすると、視覚的には "押せる" まま「表示名を入力してください」を表示できる。a11y 観点でも focus が input に飛ぶようにすると親切（`document.getElementById("reg-name")?.focus()` で対応）
  - `displayNameDialogOpen` を Google + register 経路では使わない（直接 updateDisplayName で済むため）。state 自体は login モード救済のため残す
  - `useEffect` の自動 redirect ガード（`!loading && user && !user.isAnonymous && !submitting && !displayNameDialogOpen`）は新パスでも崩れないかチェック。`signUpWithGoogle` は内部で `updateDisplayName` まで完了してから return するため、その間 `submitting=true` を維持していれば重複 redirect は起きない
- **VALIDATE**:
  - `npm run typecheck`
  - `npm run dev` → ブラウザで `/login` を開き、register / login モード切替・Google ラベル変動・displayName 空での Google クリック時のエラー表示・通常 register / login の往復 を手動確認
  - `npm run test` で `auth-actions.test.ts` 緑

### Task 4: E2E `email-link-removed.spec.ts` に新レイアウトの軽い assertion を追加

- **ACTION**: 既存 `test("/login has only login + register tabs ...")` を残しつつ、追加 test を 1 件足す
- **IMPLEMENT**:
  ```ts
  test("/login の Google ボタンは mode 連動でラベルが切り替わる", async ({ loginPage }) => {
    await loginPage.goto();
    // 初期は login モード
    await expect(loginPage.page.getByRole("button", { name: "Google でログイン" })).toBeVisible();
    // register モードに切替
    await loginPage.registerTab.click();
    await expect(loginPage.page.getByRole("button", { name: "Google で新規登録" })).toBeVisible();
    // register モードでは表示名 input が tab 直下に存在する
    await expect(loginPage.displayNameInput).toBeVisible();
  });

  test("/login の register モードで displayName 未入力のまま Google を押すとエラー表示される", async ({
    loginPage,
  }) => {
    await loginPage.goto();
    await loginPage.registerTab.click();
    await loginPage.page.getByRole("button", { name: "Google で新規登録" }).click();
    // popup は開かれず、field-level error が出る
    await expect(loginPage.page.getByRole("alert")).toContainText("表示名");
  });
  ```
- **MIRROR**: `email-link-removed.spec.ts:18-21` の tab assertion 形
- **IMPORTS**: 既存 import で十分
- **GOTCHA**:
  - Google popup の実走テストは E2E 不可（OAuth provider 未 mock）。**displayName 空での "popup を開かない" ことだけ**を間接検証する（`signInWithPopup` が呼ばれないことは unit でカバー、E2E は error 文言のみ確認）
  - error 表示の selector は実装側で `role="alert"` を維持すること（既存実装 `:202-206` 通り）
- **VALIDATE**: `npm run test:e2e -- --grep "Email Link"` 緑（既存 4 件 + 新規 2 件 = 6 件）

### Task 5: 後方互換性確認（POM 変更不要の根拠を実機 / typecheck で確認）

- **ACTION**: 以下を実走して E2E 全件が通ることを確認する
- **IMPLEMENT**:
  - `tests/e2e/pages/LoginPage.ts` の `register()` flow が新レイアウトで動くか目視 + 1 つだけ実走（`email-link-removed.spec.ts:49-66` の `localStorage` test）
  - `tests/e2e/fixtures/flows.ts:registerOrganizer` を使う任意の spec を 1 件実走（例: `audio-settings.spec.ts` か `displayname-propagation.spec.ts`）
- **MIRROR**: N/A（既存実装の動作確認のみ）
- **IMPORTS**: N/A
- **GOTCHA**:
  - **`getByRole("button", { name: "新規登録" })` は exact accessible-name match**（Playwright の string 引数は trim+normalize 後の完全一致）。新ラベル "Google で新規登録" は別文字列なので一致しない。よって POM の `register()` 内 `page.getByRole("button", { name: "新規登録" }).click()` は新レイアウトでも form 送信ボタンのみを掴む
  - **`displayNameInput: this.page.getByLabel("表示名")`** はラベルテキストのみで取得するため、フォーム上のどこに置かれても動く
  - **`expectTabs(["ログイン", "新規登録"], ["メールリンク"])`** は role=tab で名前一致なのでレイアウト変更の影響を受けない
- **VALIDATE**: `npm run test:e2e` 全件緑（少なくとも `email-link-removed` `displayname-propagation` `audio-settings` の 3 spec は必須）

---

## Testing Strategy

### Unit Tests (auth-actions.test.ts に追加)

| Test                                                         | Input                                              | Expected Output                                                                       | Edge Case? |
| ------------------------------------------------------------ | -------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------- |
| `signUpWithGoogle blank rejects before popup`                | `signUpWithGoogle("  ")`                           | reject `validation/display-name-required` / `signInWithPopup` 未呼出                  | ✓          |
| `signUpWithGoogle too-long rejects before popup`             | 16 文字                                            | reject `validation/display-name-too-long` / `signInWithPopup` 未呼出                  | ✓          |
| `signUpWithGoogle created updates displayName`               | 新規ユーザー (`isNewUser: true`)                   | `{ mode: "created" }` / `updateProfile` が trim 済み name で呼ばれる / `upsertUserProfile` が呼ばれる | -          |
| `signUpWithGoogle existing skips updateDisplayName`          | 既存ユーザー (`isNewUser: false`, profile あり)    | `{ mode: "already-existing" }` / `updateProfile` 未呼出 / `upsertUserProfile` 未呼出 | -          |
| `signUpWithGoogle propagates AccountLinkRequired`            | `auth/account-exists-with-different-credential`    | reject `AccountLinkRequired` (UI 側でリンク dialog に渡す)                            | ✓          |
| `signUpWithGoogle treats empty profile.displayName as new`   | `isNewUser: false`, profile.displayName = ""       | `{ mode: "created" }`（`needsDisplayNameSetup` が true 経路）                         | ✓          |
| `loginWithGoogle existing user passes through`               | `isNewUser: false`, profile 完備                   | `{ user, isNewUser: false, needsDisplayNameSetup: false }` / `user.delete` 未呼出     | -          |
| `loginWithGoogle new user is rolled back`                    | `isNewUser: true`, `user.delete` resolved           | reject `auth/not-registered-yet` / `user.delete` 呼出 / `signOut` 未呼出              | ✓          |
| `loginWithGoogle new user rollback failure falls back to signOut` | `isNewUser: true`, `user.delete` rejected      | reject `auth/not-registered-yet` / `user.delete` 呼出 / `signOut` 呼出                | ✓          |
| `loginWithGoogle legacy user (no profile) passes through`    | `isNewUser: false`, `getUserProfile` null           | `{ needsDisplayNameSetup: true }` / `user.delete` 未呼出 / throw されない             | ✓          |

### Edge Cases Checklist

- [x] register + Google で displayName 空 → popup を開かず field error
- [x] register + Google で displayName 16 文字 → popup を開かず field error
- [x] register + Google で `isNewUser=true` → 入力名で users/{uid} 作成
- [x] register + Google で `isNewUser=false` & 既存 profile → 入力名を破棄して toast / notice、redirect
- [x] register + Google で AccountLinkRequired → 既存 LinkAccountDialog 経路へ
- [x] register + Email+PW で displayName 空 → 既存挙動（`required` で送信ブロック）
- [x] login + Google で `isNewUser=true` → `user.delete()` で rollback + 「このアカウントはまだ登録されていません。「新規登録」タブから登録してください。」を error 表示、redirect せず
- [x] login + Google で `isNewUser=true` & rollback 失敗 → signOut フォールバック + 同 error 表示
- [x] login + Google で legacy ユーザー（`isNewUser=false` & `users/{uid}` displayName 空 / 不在）→ DisplayNameDialog fallback（変更なし）
- [x] login + Google で既存ユーザー（profile 完備）→ 即 redirect
- [x] login + Email+PW → 既存挙動
- [x] mode 切替時に `error` / `notice` が clear されること（既存の `setError(null)` を maintain）
- [x] register + Google で popup blocked → 既存の `auth/popup-blocked` 経路に倒す（呼出側 catch）
- [x] register + Google で popup closed → 同上 (`auth/popup-closed`)

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: 0 errors

```bash
npm run lint
```

EXPECT: 0 errors / 0 warnings

### Unit Tests

```bash
npx vitest run src/lib/services/auth-actions.test.ts
```

EXPECT: 既存全件 + 新規 6 件すべて緑

### Full Vitest Suite

```bash
npm run test
```

EXPECT: 既存 vitest スイートで regression 0

### E2E（影響範囲限定）

```bash
npx playwright test tests/e2e/email-link-removed.spec.ts tests/e2e/displayname-propagation.spec.ts tests/e2e/audio-settings.spec.ts
```

EXPECT: 既存 + 新規 assertion すべて緑（POM の後方互換確認）

### Browser Validation（手動）

```bash
npm run dev
```

確認項目:

- [ ] `/login` 初期表示で tab が最上位、login モードでは displayName 入力欄なし、Card 末尾に「Google でログイン」
- [ ] register タブに切替えると displayName 入力欄が tab 直下に出現、Card 末尾の Google ボタンが「Google で新規登録」になる
- [ ] register モードで displayName 未入力のまま Google ボタンを押すと、popup が開かず error 表示が出る（input に focus が飛ぶことが望ましい）
- [ ] register モードで displayName を入れて Email+PW で新規登録 → ヘッダ右上に displayName 即反映
- [ ] login モードで Email+PW でログイン → 通常遷移
- [ ] login モードで Google でログイン（既存ユーザー）→ 通常遷移、DisplayNameDialog 出ない
- [ ] login モードで displayName 不在の既存 Auth ユーザー → DisplayNameDialog が popup される（fallback 動作）

### 全 E2E

```bash
npm run test:e2e
```

EXPECT: 全 spec 緑

---

## Acceptance Criteria

- [ ] `signUpWithGoogle` / `loginWithGoogle` ヘルパーが追加され unit test で計 10 件緑
- [ ] `LoginClient` のレイアウトが新 UX 設計通り（tab 最上位 / displayName tab 直下 / Google ボタン末尾 / mode 連動ラベル）
- [ ] register モードで displayName 空のまま Google を押すと popup を開かず error が出る
- [ ] register モード + Google + 新規ユーザー で入力された displayName が `users/{uid}` に保存される（DisplayNameDialog を経由しない）
- [ ] register モード + Google + 既存ユーザー検出時に既存 displayName を上書きしない
- [ ] **login モード + Google + 新規 Google アカウントで `user.delete()` rollback + 「新規登録タブから登録してください」error 表示**
- [ ] **login モード + Google + 既存ユーザー（profile 完備）で通常 redirect**
- [ ] **login モード + Google + legacy ユーザー（profile 不在）で DisplayNameDialog fallback が引き続き動く**
- [ ] E2E POM `LoginPage.register()` が無修正で通る
- [ ] `email-link-removed.spec.ts` の既存 assertion が通る
- [ ] 新規 E2E 2 件（mode 連動ラベル / register Google 空入力 error）が通る
- [ ] typecheck / lint / vitest / e2e すべて緑

## Completion Checklist

- [ ] Code follows discovered patterns (validateDisplayName / AppError.from / logger.warn / shadcn Form)
- [ ] Error handling matches codebase style (validation/* + auth/* domain codes)
- [ ] Logging follows codebase conventions (`logger.info` で context 添付、`logger.warn` で wrapped.code)
- [ ] Tests follow test patterns (factory + vi.mocked + 既存 file 内に並べる)
- [ ] No hardcoded values（`DISPLAY_NAME_MAX_LENGTH` 経由）
- [ ] Documentation updated — 本変更は schema / rules / .claude/rules を触らないため CLAUDE.md / rules ファイルの更新は **不要**。Phase 4.7 規約「既存 displayName 上書き禁止」の運用拡大なので report に追記
- [ ] No unnecessary scope additions（`/join` / DisplayNameDialog 削除 etc. に手を出さない）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk                                                            | Likelihood | Impact | Mitigation                                                                                                          |
| --------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| E2E POM のラベル exact match が新ラベルと衝突                    | 低         | 中     | "Google で新規登録" は "新規登録" の **completion 形** だが Playwright の string match は完全一致なのでぶつからない。Task 5 で実走確認 |
| register + Google で既存ユーザー検出時、ユーザーが「自分は新規のつもりだったのに何故ログインしている？」と混乱 | 中         | 低     | 入力された displayName を破棄したことを `notice` で明示する文言「既にアカウントがあるためログインしました。表示名は変更していません。」で説明 |
| `updateDisplayName` 内の `propagateDisplayNameToGroups` が新規ユーザーで no-op だが将来 group 自動加入を入れたら矛盾する | 低         | 低     | 現状 group 加入は別フロー (`/groups/[gid]/join`)。実装上 best-effort & try/catch なので壊れない。将来追加時に再評価 |
| 既存ユーザーの Auth.displayName が空・`users/{uid}` に displayName ありの組合わせで `needsDisplayNameSetup=true` 判定 → 上書き発生 | 低         | 中     | 現行の `signInWithGoogle` ロジック (`auth-actions.ts:194-199`) を踏襲しているため、Phase 4.7 と同じ挙動（既存と同じ範囲では regression なし） |
| `notice` state 追加で既存 error 表示と干渉                       | 低         | 低     | 既存 `error` state はそのまま、`notice` は別 selector / 別色で render。mode 切替 / submit 開始時に両方 clear         |
| login + Google で `user.delete()` が `auth/requires-recent-login` を返す | 低         | 中     | `signInWithPopup` 直後の freshly-authenticated 状態のため通常発生しない。発生時は signOut フォールバックで Auth セッションは切る。Auth ユーザー本体は残るが `users/{uid}` も書かれていないため次回試行時も同じ pass で弾かれる（無限ループにはならず error メッセージで誘導される） |
| login + Google rollback の途中失敗で zombie Auth user が残存       | 中         | 低     | `users/{uid}` を作っていないため害は最小（次回 Google login を試行すると `isNewUser=false` になるが、`getUserProfile` は null を返すので `loginWithGoogle` は再度新規ユーザー扱いで…と思いきや `isNewUser=false` のため通過してしまう。**追加緩和**: rollback 失敗パスでは `signOut` 後に `getUserProfile` 不在 + `auth.displayName` 空のときも `auth/not-registered-yet` で弾く判定を入れる。実装上は `loginWithGoogle` の判定を `isNewUser \|\| (\!profileDisplayName \&\& \!authDisplayName)` に拡張するが、Phase 4.7 以前の legacy は `auth.displayName` 持ちなので救済される） |
| 新ユーザーが意図せず login タブで Google を押し、エラー文言を読まずに諦める | 中         | 低     | エラー文言にタブ名を明示「**「新規登録」タブ**から登録してください」。CTA として `<Button onClick={() => setMode("register")}>` を error と並べて配置することで 1 クリックで切替可能にする（実装オプション、Task 3 GOTCHA に追記） |

## Notes

- **PRD 帰属判断**: 本作業は明示 PRD に紐づかない post-Phase 5.5 polish。`02-season-stats-and-share` は本変更に無関係（auth/onboarding 領域）、`01-allin-timer` の Phase 4.7（Onboarding Polish）の延長と性質が一致するため `01-allin-timer/plans/` 配下に配置した
- **schema / rules 不変**: `users/{uid}` の `displayName` 必須化は元々 `validateDisplayName` で service 層 enforce されており、rules 側でも `userProfileBodySchema.displayName.min(1)` 既存。本変更で必須範囲が拡大するわけではなく、**UI 上で必須化を可視化する**だけなので rule 変更不要
- **MEMORY 規約遵守**: ユーザー向け文言に "Firebase" / "Firestore" / "Auth" 等の技術スタック名を出さない。`notice` 文言は「既にアカウントがあります」「表示名は変更していません」の自然文を使う
- **後方互換性の本質**: `signInWithGoogle()` の既存契約（`{ user, isNewUser, needsDisplayNameSetup }` 戻り値・`AccountLinkRequired` throw）を一切変更しないため、`/join/[tid]` の `joinViaGoogle` 経路は無変更で動作し続ける
- **login + Google で新規ユーザーを弾く設計判断（2026-05-08 ユーザー確認済み）**: `signInWithPopup` 直後の `user.delete()` で Auth ユーザーを破棄し、`auth/not-registered-yet` で error 表示。「新規登録」タブへ誘導する文言で UX を整える。`isNewUser=true` をトリガにする（`needsDisplayNameSetup=true` ではなく）ため、Phase 4.7 以前の legacy ユーザー（Auth-only で `users/{uid}` 不在）は引き続き DisplayNameDialog で救済される。
- **Confidence**: 高い。レイアウト変更 + helper 2 件追加 + テスト追加で完結し、schema / rules / 他経路（receipt / settings / dashboard）に波及しない。
