# Implementation Report: 新規登録の表示名必須化＆Google ボタン位置の再設計

## Summary

`/login` の新規登録フローで、サインアップ方法（Email+PW / Google）に依らず displayName を upfront で必須入力する UX に再設計した。Google ボタンを Card 末尾に移動し、tab を最上位に置くことでフォーム全体に displayName が「サインアップ方法に依らない共通入力」として可視化される。さらに login モードの Google で新規 Google アカウント（`isNewUser=true`）を検出した場合は `user.delete()` で rollback し、「新規登録タブから登録してください」を error 表示する。

実装は service 層に 2 ヘルパー（`signUpWithGoogle` / `loginWithGoogle`）を追加し、UI 側は `LoginClient` のレイアウト再構成と Google handler の mode 別分岐で完結。Phase 4.7「既存 displayName 上書き禁止」の規約は維持。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Small            | Small（想定通り） |
| Confidence    | 高い             | 高い（typecheck/lint/vitest 全件 pass） |
| Files Changed | 4 + 1 新規テスト    | 5（実装 2 / テスト 1 / E2E 1 / POM 1 / fixtures 1） |

## Tasks Completed

| #   | Task                                                        | Status      | Notes                          |
| --- | ----------------------------------------------------------- | ----------- | ------------------------------ |
| 1   | `signUpWithGoogle` / `loginWithGoogle` ヘルパー追加              | Complete    | `getErrorCode` import 追加     |
| 2   | unit test 追加（signUpWithGoogle 5 件 + loginWithGoogle 4 件） | Complete    | 既存 45 件 + 新規 9 件で全 54 件緑 |
| 3   | LoginClient のレイアウト再構成 + Google handler 分岐             | Complete    | `notice` state 追加で既存ユーザー検出時の info 表示を分離 |
| 4   | E2E `email-link-removed.spec.ts` に新レイアウト assertion 追加     | Complete    | mode 連動ラベル / displayName 空 Google → error の 2 件 |
| 5   | POM / fixtures.ts の exact match 化（deviation）            | Complete    | plan の前提（exact match）が実際には substring match のため修正 |

## Deviations from Plan

### POM / `flows.ts` の exact match 化（追加変更）

**WHAT**: `tests/e2e/pages/LoginPage.ts` と `tests/e2e/fixtures/flows.ts` で
`getByRole("button", { name: "新規登録" })` / `name: "ログイン"` を `exact: true`
オプション付きに変更した。`submitButton` ロケータも `/^(ログイン|新規登録)$/` で
anchor を付けて exact match に揃えた。

**WHY**: plan は「Playwright の string 引数は trim+normalize 後の完全一致」と
していたが、実際には Playwright の `getByRole` の `name: string` は **default で
case-insensitive substring match**（[Playwright docs](https://playwright.dev/docs/api/class-locator#locator-get-by-role) 参照）。
新ラベル「Google で新規登録」「Google でログイン」は「新規登録」「ログイン」の
substring として match するため、

- `register()` フロー: `name: "新規登録"` が form submit + Google 両方を掴んで strict mode error
- `login()` フロー: `name: "ログイン"` 2 件で `.last()` が Google ボタンを掴んで誤クリック

となる。`exact: true` で form submit のみに絞った。

plan の Risks セクションでも「E2E POM のラベル exact match が新ラベルと衝突」が
低確率リスクとして列挙されており、この deviation はそのリスクが顕在化した
ケースの実装対応にあたる。

### Google + login で新規ユーザーを「登録誘導 CTA」付き UI で出す案は採用せず

plan の Risks セクション末尾で「error と並べて『新規登録』タブへの 1-click CTA を
配置する」案がオプションとして言及されていたが、実装では文言だけで誘導している
（CTA ボタンは追加せず）。理由は「文言で十分意図が伝わる」「タブの存在を文言で
明示すれば 1-click 切替も既に視野に入っている」と判断したため。将来 UX フィードバックで
追加検討する。

## Validation Results

| Level           | Status     | Notes                                         |
| --------------- | ---------- | --------------------------------------------- |
| Static Analysis | Pass       | `npm run typecheck` 0 errors                  |
| Lint            | Pass       | `npm run lint` 0 errors / 0 warnings          |
| Unit Tests      | Pass       | vitest 全 1089 件緑（auth-actions.test.ts は 54 件、新規 9 件）|
| Build           | Pass       | `npm run build` 全ページ生成成功                  |
| E2E             | Pass       | `tests/e2e/email-link-removed.spec.ts` 全 6 件緑（既存 4 + 新規 2）。POM 後方互換も `localStorage has no email-link residue keys after login` と `/join/[tid]` テストで `loginPage.register()` 経由で確認済み。実機ブラウザでの手動 UX 確認は plan 記載の項目に従って Auto モード外で別途推奨 |

## Files Changed

| File                                                | Action  | 注記                                                             |
| --------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `src/lib/services/auth-actions.ts`                  | UPDATED | `signUpWithGoogle` / `loginWithGoogle` の 2 関数追加、`getErrorCode` import 追加 |
| `src/lib/services/auth-actions.test.ts`             | UPDATED | `signUpWithGoogle` / `loginWithGoogle` の describe ブロック 2 つ追加（計 9 ケース） |
| `src/app/login/login-client.tsx`                    | UPDATED | tab を Card 最上位、Google ボタンを Card 末尾、displayName を tab 直下、`notice` state 追加、Google handler を mode 別分岐 |
| `tests/e2e/email-link-removed.spec.ts`              | UPDATED | 新規 test 2 件（mode 連動ラベル / displayName 空 Google → error）   |
| `tests/e2e/pages/LoginPage.ts`                      | UPDATED | `submitButton` を exact match に、`register()` / `login()` の click 先 button selector に `exact: true` 追加 |
| `tests/e2e/fixtures/flows.ts`                       | UPDATED | `registerOrganizer` の click button name に `exact: true` 追加      |

## Issues Encountered

### `loginPage.page` が protected

E2E spec で `loginPage.page.getByRole(...)` と書いたところ、`BasePage.page` が
`protected` のため typecheck で 4 件 error。`{ page, loginPage }` で page fixture
を直接渡す形に修正。既存の同 spec の他 test と同じパターンに統一。

### Next.js の `__next-route-announcer__` が `role="alert"` を持つ

新規 E2E test で `page.getByRole("alert").toContainText("表示名")` と書いたら
strict mode 違反で fail。Next.js は internal で `<div role="alert"
id="__next-route-announcer__">` を挿入しているため。`.filter({ hasText:
"表示名" })` で当該 error 要素のみ取得する形に修正。

## Tests Written

| Test File                                  | Tests                                                                                              |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `src/lib/services/auth-actions.test.ts`    | 新規 9 件（signUpWithGoogle 5 件 + loginWithGoogle 4 件）                                            |
| `tests/e2e/email-link-removed.spec.ts`     | 新規 2 件（mode 連動 Google ラベル / displayName 空 Google → error）                                  |

## Next Steps

- [x] 実機での手動 UX 確認（plan の Browser Validation 項目）— Auto モードで未実施。ユーザー側で `npm run dev` を起動して確認推奨
- [ ] PR 作成（`/prp-pr`）
- [ ] code review（`/code-review`）

## Notes / 規約準拠

- **schema / rules 不変**: 本変更は zod schema / Firestore rules に手を入れていない。
  `users/{uid}` の `displayName` 必須化は元々 service 層の `validateDisplayName` で
  enforce されており、UI で必須化を可視化しただけ。
- **MEMORY 規約**: ユーザー向け文言（`notice` / error message）に「Firebase」「Auth」
  等の技術スタック名を出していない。`AppError.code` のみ技術用語のまま（既存規約通り）。
- **後方互換性**: `signInWithGoogle()` の既存契約は完全保持。`/join/[tid]` の
  `joinViaGoogle` 経路は無変更で動作する。
- **PRD 帰属**: post-Phase 5.5 polish。`01-allin-timer` の Phase 4.7 onboarding
  delivery の延長として `01-allin-timer/plans/` 配下に配置。
