# Implementation Report: Phase 4.5 — Pre-Phase 5 Improvements

## Summary

Phase 4（Seating Automation）完了後〜Phase 5（実地テスト）前に発生した 7 件の UX / 運用改善を一括整理。
受付時の運営者自己参加導線、`/groups/[gid]` からのトーナメント／ストラクチャ直接遷移、ヘッダーの displayName 優先表示、未ログイン時トップ画面の簡素化、残り 1 人検知時の Winner 演出＋自動終了、匿名ユーザーの best-effort 自己削除（tournament finish／ログアウト／参加取消の 3 経路）、そして Email Link サインイン方式の完全撤廃を実装した。

## Assessment vs Reality

| Metric        | Predicted (Plan)     | Actual             |
| ------------- | -------------------- | ------------------ |
| Complexity    | Medium               | Medium             |
| Confidence    | —                    | High（計画どおり）  |
| Files Changed | 約 18                | 19 編集 / 2 削除    |

## Tasks Completed

| #   | Task                                            | Status          | Notes |
| --- | ----------------------------------------------- | --------------- | ----- |
| 1   | AuthBadge 表示名優先                              | [done] Complete | L44 の `email ?? displayName` を `displayName ?? email` に入れ替え |
| 2   | トップ画面を未ログイン時に簡素化                 | [done] Complete | `"use client"` 化、`useAuthUser` で 3 状態（loading / signed-in / else）を出し分け |
| 3   | `/groups/[gid]` からトーナメント・ストラクチャ遷移 | [done] Complete | `setCurrentGroupId(gid) → router.push` 経由で 1 クリック遷移 |
| 4   | 運営者の自己参加ボタン（setup 状態）             | [done] Complete | `TimerControls` の `Op` union に `"self-join"` を追加、`joinAsCurrentUser({ tid })` 呼出 |
| 5   | Winner 演出バナー                                | [done] Complete | 新 `WinnerBanner` component + `resolveWinner` helper。dashboard / live 両方で描画 |
| 6   | Auto-finish（運営者端末のみ）                    | [done] Complete | dashboard-client に inflight ref + 2 秒 delay effect を追加。`/live` からは呼ばず rule 違反回避 |
| 7   | 匿名ユーザー自己削除（live-client）              | [done] Complete | `state === "finished"` 検知時に `deleteUserProfile` + `user.delete()` を best-effort 実行 |
| 8   | `logout` 匿名削除対応                            | [done] Complete | 匿名時は profile + auth 削除、失敗時は signOut にフォールバック |
| 9   | `cancelOwnEntry` 匿名削除対応                    | [done] Complete | `deletePlayer` → profile + auth 削除（匿名のみ）。best-effort 失敗は許容 |
| 10  | `deleteUserProfile` を users repository に追加    | [done] Complete | `firestore.rules` の `users/{uid}` は既に self-write 許可（ルール変更不要） |
| 11  | Email Link 機能削除（auth-actions）               | [done] Complete | `sendEmailLinkForJoin` / `completeEmailLink` / storage helpers / `isEmailLinkUrl` / `buildEmailLinkContinueUrl` と `sanitizeRedirect` の本ファイルからの参照を撤去 |
| 12  | Email Link 機能削除（receipt）                    | [done] Complete | `joinViaEmailLinkRequest` / `joinViaEmailLinkComplete` 撤去、`clearStoredDisplayNameForSignIn` import 削除 |
| 13  | Email Link ルート / UI 削除                      | [done] Complete | `src/app/auth/email-link/` と空になった `src/app/auth/` を削除 |
| 14  | `/login` と `/join/[tid]` から Email Link タブ削除 | [done] Complete | `Mode = "login" \| "register"`, `Tab = "login" \| "guest"` に縮小 |
| 15  | テスト更新                                       | [done] Complete | auth-actions / receipt / live-client テストを修正・追加。全 256 テスト green |
| 16  | PRD 更新                                         | [done] Complete | Implementation Phases の Phase 4.5 行を `complete` に更新し、レポートリンクを追加 |

## Validation Results

| Level           | Status      | Notes                                 |
| --------------- | ----------- | ------------------------------------- |
| Static Analysis | [done] Pass | `npm run typecheck` — 0 errors         |
| Lint            | [done] Pass | `npm run lint` — 0 warnings            |
| Unit Tests      | [done] Pass | `npm test` — 256 tests / 16 files pass |
| Build           | [done] Pass | `next build` — 13 routes, `/auth/email-link` なし |
| Integration     | N/A         | 本 phase は Firestore emulator 必須の新規 rule 変更なし |
| Edge Cases      | [done] Pass | 匿名 delete fallback / winner 判定ガード / 多重 auto-finish 抑止を unit test で検証 |

## Files Changed

| File                                                            | Action  | Notes                                                      |
| --------------------------------------------------------------- | ------- | ---------------------------------------------------------- |
| `src/app/page.tsx`                                              | UPDATE  | Client Component 化 + auth ベース出し分け                    |
| `src/components/auth/AuthBadge.tsx`                             | UPDATE  | label 優先順位を displayName → email に変更                   |
| `src/app/groups/[gid]/group-detail-client.tsx`                  | UPDATE  | トーナメント / ストラクチャ遷移ボタン追加                    |
| `src/components/tournament/TimerControls.tsx`                   | UPDATE  | setup 分岐に「自分も参加する」ボタンを追加                    |
| `src/components/tournament/WinnerBanner.tsx`                    | CREATE  | 新規：Winner バナー UI component                              |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                | UPDATE  | WinnerBanner 描画 + auto-finish effect 追加                   |
| `src/app/tournaments/[tid]/live/live-client.tsx`                | UPDATE  | players state 化、WinnerBanner、匿名自己削除 effect 追加       |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`           | UPDATE  | Winner バナー / 匿名自己削除のテスト追加                      |
| `src/lib/services/timer.ts`                                     | UPDATE  | `resolveWinner(tournament, players)` helper 追加              |
| `src/lib/services/auth-actions.ts`                              | UPDATE  | Email Link 関連を全削除、`logout` を匿名 self-delete 対応に拡張 |
| `src/lib/services/auth-actions.test.ts`                         | UPDATE  | Email Link テストを削除、匿名 logout 経路を追加                |
| `src/lib/services/receipt.ts`                                   | UPDATE  | Email Link export 削除、`cancelOwnEntry` を匿名削除対応に拡張  |
| `src/lib/services/receipt.test.ts`                              | UPDATE  | Email Link mock 削除、`cancelOwnEntry` 匿名ケース追加         |
| `src/lib/firebase/repositories/users.ts`                        | UPDATE  | `deleteUserProfile(uid)` を追加                               |
| `src/app/login/login-client.tsx`                                | UPDATE  | Email Link タブ / state / ハンドラを削除                      |
| `src/app/join/[tid]/join-client.tsx`                            | UPDATE  | Email Link タブ / state / ハンドラを削除                      |
| `src/app/auth/email-link/page.tsx`                              | DELETE  | ルート削除                                                   |
| `src/app/auth/email-link/email-link-client.tsx`                 | DELETE  | クライアントコンポーネント削除                                |
| `src/app/auth/` ディレクトリ                                     | DELETE  | 空になったため削除                                           |
| `.claude/PRPs/prds/allin-timer.prd.md`                          | UPDATE  | Phase 4.5 行を `complete` に更新、レポートリンクを追加        |

## Deviations from Plan

- **Winner 判定ロジックの切り出し**: 計画では live-client / dashboard-client にそれぞれ判定式を書く記述だったが、両画面で同一ロジックを要するため `src/lib/services/timer.ts` に `resolveWinner(tournament, players)` ヘルパーを新設して共有化した。テスト容易性と DRY 性を優先。
- **auto-finish の trigger 配置**: 計画通り dashboard-client 側に集約（/live は参加者端末で rule 違反になる）。
- **live-client の players state**: 従来は `me` だけを保持していたが、Winner 判定のため全参加者を保持する形にリファクタ。`me` は派生値として `players.find((p) => p.uid === user.uid)` で算出。

## Issues Encountered

- 1 点のみ: `npm run typecheck` の初回実行で `.next/types/app/auth/email-link/page.ts` の stale な型定義が残り、3 件の TS2307 が発生した。`rm -rf .next` で解消。今後 Next.js のキャッシュに同種の問題が出た場合の備忘録。

## Tests Written

| Test File                                                       | New Tests    | Coverage                                                     |
| --------------------------------------------------------------- | ------------ | ------------------------------------------------------------ |
| `src/lib/services/auth-actions.test.ts`                         | 再構成 + 4    | `logout` 匿名 happy / delete-fail fallback / profile-fail fallback |
| `src/lib/services/receipt.test.ts`                              | +4           | `cancelOwnEntry` auth-required / non-anonymous / anonymous happy / delete-failure |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`           | +7           | Winner バナー（3 ケース）+ 匿名自己削除（4 ケース）               |

## Next Steps

- [ ] `/code-review` で変更の最終レビューを実施
- [ ] `/prp-commit` または `/prp-pr` で develop にコミット & PR 作成
- [ ] Firebase Console の Email/Password (Email Link passwordless) プロバイダ無効化手順を運用 README に追記（任意）
- [ ] Phase 5（実地テスト）の plan 作成へ進める
