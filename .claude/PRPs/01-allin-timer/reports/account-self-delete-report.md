# Implementation Report: アカウント自己削除（sole-owner ガード付き）

## Summary

通常アカウント（Google / Email+Password）ユーザーが `/settings` 画面から自身のアカウントを完全削除できる機能を追加した。Phase 4.5 の `attemptAnonymousSelfDelete`（匿名自己削除）を雛形に、3 つの拡張で通常アカウントにも対応:

1. **sole-owner block**: 削除実行前に `users/{uid}.groupIds` を辿り、各 `groups/{gid}` を read。`isSoleOwner(group, uid)` が true の group が 1 件でもあれば `AccountDeleteSoleOwnerBlocked` を throw し、UI が block dialog にサークル名を提示する
2. **全 group 自動脱退**: block を通過したら `Promise.allSettled` で各 group から `leaveGroup` を順次実行（best-effort）
3. **`auth/requires-recent-login` 後の再認証フロー**: `user.delete()` が recent-login を要求したら throw せず `needsReauth: true` を返し、UI が provider に応じた dialog（password / Google popup）を出して `reauthenticateAccount` を呼んだ後、削除を再試行する

Firestore Rules / schema の変更ゼロ。既存の `users/{uid}` self-delete と `groups/{gid}` self-leave 経路をそのまま流用し、新規 collection も新ブランチも追加していない。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | (not specified)  | High — plan に従い実装でき、検証も全て green |
| Files Changed | 約 12 files (CREATE 6 / UPDATE 6) | 11 files (CREATE 5 / UPDATE 6) — `repositories/groups.ts` は触れず（`isSoleOwner` は schema 側のみで完結したため） |

## Tasks Completed

| #   | Task                                                | Status      | Notes                                                                                  |
| --- | --------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------- |
| 1   | `isSoleOwner` pure helper + 4 unit tests            | Complete    | `schemas/group.ts` のみに追加（`repositories/groups.ts` への重複設置は不要と判断、deviation 1） |
| 2   | `reauthenticateAccount` helper + 6 unit tests       | Complete    | `auth-actions.ts` に追記。`wrapAuthError` を再利用し popup-closed / wrong-password を正規化 |
| 3   | `deleteAccount` orchestrator + 10 unit tests        | Complete    | `account-delete.ts` 新規作成。pre-check / leave / users 削除 / `user.delete` の 4 段構成    |
| 4   | `AccountDeleteSection` component + 6 component tests | Complete    | dialog state machine（closed / confirm / blocked-sole-owner / reauth / deleting）。匿名は早期 return null |
| 5   | settings-client.tsx への組込                          | Complete    | `<hr />` で区切り、form の下に `<AccountDeleteSection user={user} />` を additive 追加        |
| 6   | AuthBadge / Logout 影響評価                          | Complete    | 変更不要（plan の評価通り）                                                                |
| 7   | Firestore Rules emulator 検証                        | N/A         | rule 変更ゼロ。既存 self-delete / self-leave 経路で成立し、新 emulator validator は不要      |
| 8   | E2E spec `account-self-delete.spec.ts`              | Complete    | 2 シナリオ（sole-owner block / 通常削除）。`requires-recent-login` は emulator で再現困難なため unit test に委譲（plan 通り） |
| 9   | docs 更新                                            | Complete    | `.claude/rules/group-membership.md` の権限マトリクスに「アカウント自己削除」行を追加し、ロール遷移節の下に新セクションを追記 |

## Validation Results

| Level           | Status | Notes                                                                                |
| --------------- | ------ | ------------------------------------------------------------------------------------ |
| Static Analysis | Pass   | `npm run typecheck` / `npm run lint` ともに green                                    |
| Unit Tests      | Pass   | 1073 tests pass（新規 26 件: schema 4 / auth-actions 6 / account-delete 10 / component 6） |
| Build           | Pass   | `npm run build` green。/settings ルートは 8.72 kB（拡張前は不明だが妥当な増分）          |
| Integration     | N/A    | 該当なし                                                                              |
| Edge Cases      | Pass   | 0 group / 1 sole-owner / 複数 sole-owner / co-owner のみ / per-group leave 失敗 / `deleteUserProfile` 失敗 / `requires-recent-login` を unit でカバー |

## Files Changed

| File                                                | Action  | Notes                                                                       |
| --------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `src/lib/firebase/schemas/group.ts`                 | UPDATE  | `isSoleOwner` pure helper を追加（+12 行）                                  |
| `src/lib/firebase/schemas/index.test.ts`            | UPDATE  | `isSoleOwner` の 4 テストケース（+53 行）                                   |
| `src/lib/services/auth-actions.ts`                  | UPDATE  | `reauthenticateAccount` helper（+55 行）                                    |
| `src/lib/services/auth-actions.test.ts`             | UPDATE  | `reauthenticateAccount` の 6 テストケース + mock 拡張（+89 行）             |
| `src/lib/services/account-delete.ts`                | CREATE  | `deleteAccount` orchestrator + `AccountDeleteSoleOwnerBlocked` AppError サブクラス |
| `src/lib/services/account-delete.test.ts`           | CREATE  | 10 テストケース（pre-check / leave / requires-recent-login 等）              |
| `src/components/auth/AccountDeleteSection.tsx`      | CREATE  | 削除セクション UI + 3 dialog の state machine（confirm / blocked / reauth） |
| `src/components/auth/AccountDeleteSection.test.tsx` | CREATE  | 6 テスト（anonymous null / dialog 表示 / blocked dialog / reauth retry）    |
| `src/app/settings/settings-client.tsx`              | UPDATE  | `<AccountDeleteSection user={user} />` を additive 追加（+3 行）             |
| `tests/e2e/account-self-delete.spec.ts`             | CREATE  | E2E 2 シナリオ                                                              |
| `.claude/rules/group-membership.md`                 | UPDATE  | 権限マトリクス + 新セクション「アカウント自己削除（通常アカウント）」      |

## Deviations from Plan

1. **`isSoleOwner` の配置**: plan は `repositories/groups.ts` への追加も「任意 / 推奨」としていたが、実装では `schemas/group.ts` の 1 か所のみに集約した。`deriveRole` / `isOrganizerRole` / `isOwnerRole` 等の他の pure helper と同居するのが自然で、import が浅く 1 箇所で済むため。`repositories/groups.ts` はそのまま無変更。
2. **AccountDeleteSection のテスト件数**: plan は 5 件と書いていたが、reauth retry まで含めて 6 件にした（より明確にカバレッジを増やすため）。
3. **error 表示の見せ方**: 一般エラーは inline `role="alert"` の `<p>` で、blocked / reauth は dedicated dialog で表示する 2 系統に分けた（既存の settings-client / LinkAccountDialog の慣習に倣う）。
4. **README / spec 更新**: plan の Task 9 では README と `docs/specification/` の追記も触れていたが、本実装では `.claude/rules/group-membership.md` の更新のみに留めた。README と spec は機能の運用が安定してから別 commit で更新する想定（今回の changeset を肥大化させない判断）。

## Issues Encountered

なし。plan に書かれた hot-spot（mock 境界 / `wrapAuthError` 再利用 / `Promise.allSettled` パターン）はすべて素直に流用でき、実装中に未知の落とし穴は出なかった。

## Tests Written

| Test File                                             | Tests   | Coverage area                                                          |
| ----------------------------------------------------- | ------- | ---------------------------------------------------------------------- |
| `src/lib/firebase/schemas/index.test.ts`              | 4 new   | `isSoleOwner` の 4 ケース（sole / co-owner / non-owner / empty defensive） |
| `src/lib/services/auth-actions.test.ts`               | 6 new   | `reauthenticateAccount`（password OK / missing / wrong / google OK / popup-closed / unsupported） |
| `src/lib/services/account-delete.test.ts`             | 10      | `deleteAccount` の pre-check / leave / users 削除 / `user.delete` 全分岐 |
| `src/components/auth/AccountDeleteSection.test.tsx`   | 6       | dialog state machine の主要遷移（anonymous null / confirm / blocked / reauth password / reauth google / retry） |
| `tests/e2e/account-self-delete.spec.ts`               | 2       | sole-owner block の UX / 正常削除（uid + users + memberUids 全消失）    |

## Next Steps

- [ ] Code review via `/code-review`（recommended）
- [ ] E2E を実機で 1 回確認（emulator + dev server で `npm run test:e2e -- account-self-delete`）
- [ ] PRD 01 の Implementation Phases 表に Phase 5.x として「アカウント自己削除」を additive 追加するかは PRP オーナーに委ねる（plan の Notes 通り）
- [ ] 必要なら README にも 1 行で機能紹介を追加
- [ ] PR 作成（`/prp-pr`）
