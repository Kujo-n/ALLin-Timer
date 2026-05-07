# Code Review: 新規登録の表示名必須化＆Google ボタン位置の再設計（local mode）

**Reviewed**: 2026-05-08
**Scope**: uncommitted local changes for `login-signup-displayname-required` plan
**Decision**: APPROVE with comments（中位の UX バグ 1 件あり、blocking ではないが修正推奨）

## Summary

PRD の意図（「register モードで displayName を upfront で必須にする」）と service / UI / E2E の整合は取れており、typecheck / lint / vitest（1089 件） / build / E2E（6 件）全件緑。**CRITICAL / HIGH なし。** ただし 1 件、plan が想定していた挙動と実装の差分による MEDIUM の UX バグ（既存ユーザー検出時の `notice` が表示前にナビゲーションで unmount される）がある。それ以外は LOW の可読性 nit のみ。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### M-1. `signUpWithGoogle` の `mode === "already-existing"` notice が事実上表示されない

**File**: [src/app/login/login-client.tsx:91-100](src/app/login/login-client.tsx#L91-L100)

```ts
if (mode === "register") {
  const result = await signUpWithGoogle(displayName);
  refreshUser();
  if (result.mode === "already-existing") {
    setNotice("既にアカウントがあるためログインしました。表示名は変更していません。");
  }
  router.replace(redirect);
  return;
}
```

**問題**: `setNotice` で state を立てた直後に `router.replace(redirect)` でナビゲーションを開始するため、Next.js が `LoginClient` を unmount する前に notice を読める時間がほぼない（実機で 50–200ms の flash 程度）。plan の「toast 相当の info 文字列を専用 `notice` state に出してから `router.replace(redirect)`」という意図は満たせていない。

**Why it matters**: 既存ユーザーが register タブで Google を押した場合、サインアップしたつもりがログインしただけ、という UX 不整合を**説明するため**の notice なので、表示されないと plan の Risk セクション
> register + Google で既存ユーザー検出時、ユーザーが「自分は新規のつもりだったのに何故ログインしている？」と混乱

が再びそのまま顕在化する。

**Suggested fix**: 以下のいずれか
1. `sessionStorage` に notice メッセージを stash → 次画面で読み出して toast 表示（最小変更）
2. URL query（`?notice=existing-account`）で持ち回り、redirect 先で表示
3. 即時 redirect を止め、ユーザーに `Continue` ボタンを押させる（UX は重いが確実）

最も安価なのは 1。`sessionStorage.setItem("loginNotice", "...")` を redirect 前に置き、redirect 先のレイアウト or shell コンポーネントで一度だけ読んで toast 表示する。

なお plan の Acceptance Criteria は「既存 displayName を上書きしない」のみを必須にしており、notice 表示は文言ベースで明文化されていないため**機能的には合格**しているが、plan author の意図とは乖離している。

#### M-2. `loginWithGoogle` で `delete()` + `signOut()` が両方失敗したときに zombie Auth user で redirect される

**File**: [src/lib/services/auth-actions.ts:281-313](src/lib/services/auth-actions.ts#L281-L313)

```ts
export async function loginWithGoogle(): Promise<GoogleSignInResult> {
  const result = await signInWithGoogle();
  if (result.isNewUser) {
    try {
      await result.user.delete();
    } catch (e) {
      // ... wrap, warn
      try { await signOut(firebaseAuth); } catch { /* warn */ }
    }
    throw new AppError("...", "auth/not-registered-yet");
  }
  return result;
}
```

**問題**: `delete()` と `signOut()` の両方が失敗した場合、Auth user は authenticated のまま残る。`auth/not-registered-yet` を throw してから UI 側 `setError` で文言を出すが、その後 `LoginClient` の `useEffect`（[src/app/login/login-client.tsx:50-57](src/app/login/login-client.tsx#L50-L57)）が `user && !user.isAnonymous && !submitting` を見て `router.replace(redirect)` を発火する → エラー文言が見えないままダッシュボードに遷移する。

**Likelihood**: 低（`signInWithPopup` 直後の freshly-authenticated 状態 + `signOut` フォールバック）。plan の Risks でも明示的に「zombie Auth user が残存」として認識されている既知リスク。

**Why MEDIUM not LOW**: ユーザーが「弾かれたつもり」が「ログインしている」状態に着地し、`users/{uid}` が無いまま下流のフローを走らせると downstream で表示名取得失敗等が連鎖する可能性がある。

**Suggested fix**: plan の Risks セクションが提案している通り、追加の防御として
- `loginWithGoogle` の判定を `isNewUser || (!profileDisplayName && !authDisplayName)` に拡張（次回 login 試行で再度弾く）
- もしくは UI 側 `useEffect` の自動 redirect ガードに「最後の onGoogleSignIn が `auth/not-registered-yet` を返したか」のフラグを足し、その間 redirect を抑止する

ただし発生確率の低さと既知リスクであることから、**今回のマージは保留しない**。フォロー up issue で扱う形を推奨。

### LOW

#### L-1. catch 節で同一構造の AppError 分岐が連続している

**File**: [src/app/login/login-client.tsx:114-130](src/app/login/login-client.tsx#L114-L130)

```ts
if (e instanceof AppError && e.code === "validation/display-name-required") {
  setError(e.message);
  document.getElementById("reg-name")?.focus();
  return;
}
if (e instanceof AppError && e.code === "validation/display-name-too-long") {
  setError(e.message);
  document.getElementById("reg-name")?.focus();
  return;
}
if (e instanceof AppError && e.code === "auth/not-registered-yet") {
  setError(e.message);
  return;
}
```

**Suggestion**: validation 系 2 件は同じハンドラなので 1 つにまとめると可読性が上がる。

```ts
if (e instanceof AppError) {
  if (
    e.code === "validation/display-name-required" ||
    e.code === "validation/display-name-too-long"
  ) {
    setError(e.message);
    document.getElementById("reg-name")?.focus();
    return;
  }
  if (e.code === "auth/not-registered-yet") {
    setError(e.message);
    return;
  }
}
```

#### L-2. fallthrough catch で既に wrap 済み AppError を二重に warn する pre-existing pattern

**File**: [src/app/login/login-client.tsx:131-134](src/app/login/login-client.tsx#L131-L134)

```ts
const wrapped = AppError.from(e, "auth/google-failed", "Google ログインに失敗しました");
logger.warn(wrapped.message, { code: wrapped.code });
setError(`${wrapped.code}: ${wrapped.message}`);
```

[.claude/rules/error-logging.md](.claude/rules/error-logging.md) では「既に AppError ラップ済みのエラーをさらに `AppError.from` で wrap し直す（二重 warn を引き起こす）— `unwrapOrFrom` を使う」と明記されている。`signInWithGoogle` 内の `wrapAuthError` で既に warn しているため、ここで `unwrapOrFrom` に置換すれば二重 warn が消える。

**Why LOW not MEDIUM**: 本変更で導入された pattern ではなく、既存コードを引き継いだだけ（diff 的には move のみ）。ただし変更のついでに揃えると規約準拠が一段上がる。

#### L-3. `signUpWithGoogle` の "popup-closed" / "popup-blocked" path に unit test がない

**File**: [src/lib/services/auth-actions.test.ts](src/lib/services/auth-actions.test.ts)

`signInWithGoogle` 自体には popup-closed の test がある（既存）が、`signUpWithGoogle` 経由でその error が透過することを確認する test は無い。`validateDisplayName` を popup より前に通過した後で popup-closed が起きた場合の path 確認として 1 件あると安心だが、`signUpWithGoogle` は `signInWithGoogle` の薄いラッパーなので transitive に検証されている扱いでも妥当。

#### L-4. `loginWithGoogle` の "delete + signOut の両方が失敗" path に unit test がない

**File**: [src/lib/services/auth-actions.test.ts:529-547](src/lib/services/auth-actions.test.ts)

「signOut 失敗時に warn ログのみ出して throw 自体は止めない」契約の retain test が無い。M-2 のリスクの境界条件をピン留めする目的で追加すると良い。但し plan の Testing Strategy には記載されておらず、現状の 4 ケースで論理は十分カバーしている。

#### L-5. `mode` 切替時の自動 focus

register モードで displayName 空のまま Google を押した場合は `document.getByElementId("reg-name")?.focus()` で input に focus が飛ぶが、register タブをクリックして切替えた直後は **focus が tab に残る**。a11y 的には displayName input が必須項目として最初に強調されると良いが、本変更のスコープ外。

## Validation Results

| Check                    | Result | Notes |
| ------------------------ | ------ | ----- |
| `npm run typecheck`      | Pass   | 0 errors |
| `npm run lint`           | Pass   | 0 errors / 0 warnings |
| `npm run test` (vitest)  | Pass   | 1089 件全件緑（auth-actions.test.ts 54 件、新規 9 件含む） |
| `npm run build`          | Pass   | 全ページ生成成功 |
| Playwright (`email-link-removed.spec.ts`) | Pass | 全 6 件緑（既存 4 + 新規 2） |

## Files Reviewed

| File                                                | Type     |
| --------------------------------------------------- | -------- |
| `src/lib/services/auth-actions.ts`                  | Modified — `signUpWithGoogle` / `loginWithGoogle` 追加（+77 / -1） |
| `src/lib/services/auth-actions.test.ts`             | Modified — 新規 9 ケース追加（+149 / -0） |
| `src/app/login/login-client.tsx`                    | Modified — レイアウト再構成 + handler 分岐（+72 / -30） |
| `tests/e2e/email-link-removed.spec.ts`              | Modified — 新規 2 ケース追加（+27 / -0） |
| `tests/e2e/pages/LoginPage.ts`                      | Modified — exact match 化（+8 / -3） |
| `tests/e2e/fixtures/flows.ts`                       | Modified — exact match 化（+2 / -1） |

## Decision Rationale

CRITICAL / HIGH なし。M-1 は plan author の意図とのズレで UX 上の劣化があるが、機能的には正しく redirect される（ユーザーは正常にログイン状態になる）ため block しない。M-2 は plan で既知リスクとして明示されており、確率の低さからフォローアップで扱う前提で承認可。L-1〜L-4 は readability / coverage の improvement 余地で、コミット前 or follow-up で順次。

**承認推奨**。M-1（notice 表示問題）は別 commit で sessionStorage 経由に修正することを推奨。
