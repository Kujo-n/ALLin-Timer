# E2E Test Report: Phase 4.5

**Date**: 2026-04-21
**Environment**: Playwright 1.59.1 + Firebase Emulator (auth:9099 / firestore:8080) + Java 21 + Windows 11
**Status**: **PASSING** — 9/9 tests green

## Summary

| Metric   | Value            |
| -------- | ---------------- |
| Total    | **9**            |
| Passed   | **9 (100%)**     |
| Failed   | 0                |
| Flaky    | 0                |
| Skipped  | 0                |
| Duration | **56.6s**（wall-clock, worker=1） |

Phase 4.5 の核心機能（Email Link 撤廃 / 運営者自己参加 / Winner 演出 / Auto-finish / 匿名自己削除）を実 Firebase Emulator（auth + firestore）に対して完全自動化で検証。

## Test Results

| #   | Spec                                    | Test                                                                                             | Duration |
| --- | --------------------------------------- | ------------------------------------------------------------------------------------------------ | -------- |
| 1   | `anonymous-self-delete.spec.ts`         | 匿名ゲストが tournament finished 後に auth + users/{uid} 削除（player は履歴として残存）        | 17.2s    |
| 2   | `anonymous-self-delete.spec.ts`         | 匿名ユーザがログアウトで auth 削除                                                                | 5.1s     |
| 3   | `email-link-removed.spec.ts`            | `/auth/email-link` → 404                                                                          | 1.0s     |
| 4   | `email-link-removed.spec.ts`            | `/login` にメールリンクタブなし                                                                   | 0.6s     |
| 5   | `email-link-removed.spec.ts`            | `/join/[tid]` にメール登録タブなし                                                                | 3.8s     |
| 6   | `email-link-removed.spec.ts`            | ログイン後 `localStorage` に `emailForSignIn` / `displayNameForSignIn` 残骸なし                    | 0.9s     |
| 7   | `organizer-self-join.spec.ts`           | 「自分も参加する」→ 参加者一覧反映 → リロード後もボタン非表示                                       | 4.8s     |
| 8   | `winner-banner-and-auto-finish.spec.ts` | 残り 1 人検知で Winner バナー表示 → 2 秒後 state=finished → /live でも同じバナー見える              | 9.2s     |
| 9   | `winner-banner-and-auto-finish.spec.ts` | 参加者が 2 人未満だと Winner バナーは出ない                                                        | 4.2s     |

## Coverage vs Phase 4.5 Task Matrix

| Phase 4.5 Task                      | E2E 検証 | Spec                                     |
| ----------------------------------- | ------- | ---------------------------------------- |
| Task 1: AuthBadge displayName 優先 | 手動確認      | -                                        |
| Task 2: トップ画面未ログイン簡素化  | 手動確認      | -                                        |
| Task 3: /groups/[gid] 遷移ボタン   | 手動確認      | -                                        |
| **Task 4: 運営者自己参加**         | ✓       | `organizer-self-join.spec.ts`            |
| **Task 5: Winner 演出バナー**      | ✓       | `winner-banner-and-auto-finish.spec.ts` |
| **Task 6: Auto-finish (2秒 delay)**| ✓       | `winner-banner-and-auto-finish.spec.ts` |
| **Task 7: 匿名自己削除（finish）** | ✓       | `anonymous-self-delete.spec.ts` (1件目)  |
| **Task 8: logout 匿名削除**        | ✓       | `anonymous-self-delete.spec.ts` (2件目)  |
| Task 9: cancelOwnEntry 匿名削除     | unit covered | `receipt.test.ts`                        |
| **Task 11-14: Email Link 撤廃**    | ✓       | `email-link-removed.spec.ts` (4件)       |

HIGH 優先度の 5 項目すべてを E2E カバー、MEDIUM 優先度の 3 項目は手動確認で対応。

## Infrastructure Added

### Configuration
- [firebase.json](../../../firebase.json) — emulators ブロック（auth:9099 / firestore:8080 / ui:4000、singleProjectMode）
- [src/lib/firebase/client.ts](../../../src/lib/firebase/client.ts) — `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` 時に `connectAuthEmulator` / `connectFirestoreEmulator` 呼出し。globalThis flag で重複接続ガード
- [playwright.config.ts](../../../playwright.config.ts) — `webServer` 配列で emulator + `next dev -p 3001` を自動起動。worker=1、`networkidle` 非使用

### Fixtures / POMs
- [tests/e2e/fixtures/emulator.ts](../../../tests/e2e/fixtures/emulator.ts) — `resetFirestore` / `resetAuth` / `createUserViaEmulator` / `listUsers` / `getDocument` の REST API ヘルパ
- [tests/e2e/fixtures/flows.ts](../../../tests/e2e/fixtures/flows.ts) — UI 経由の seed（organizer 登録 → group → structure → tournament）
- [tests/e2e/fixtures/test-context.ts](../../../tests/e2e/fixtures/test-context.ts) — `autoResetEmulator` fixture + POM 注入
- [tests/e2e/pages/*.ts](../../../tests/e2e/pages/) — 6 POM

### Scripts / Docs
- `npm run test:e2e` / `test:e2e:ui` / `test:e2e:headed` / `test:e2e:debug` / `emulator`
- [tests/e2e/README.md](../../../tests/e2e/README.md) — 運用ドキュメント

## Fixes Applied During Stabilization

テスト実装から全件 green に至るまで 7 回の反復修正:

| # | 修正内容                                          | 影響                                          |
| - | ------------------------------------------------- | --------------------------------------------- |
| 1 | Java 21 への変更（firebase-tools 要求）           | Emulator 起動                                 |
| 2 | Chromium 1217 DL（Playwright 1.59.1 一致版）      | Browser 起動                                  |
| 3 | `waitForLoadState("networkidle")` → `"domcontentloaded"` | Firestore onSnapshot の永続コネクションで timeout 回避 |
| 4 | `waitForURL(/\/tournaments\/[^/]+$/)` → negative lookahead で `new` 除外 | `/tournaments/new` への false match 解消       |
| 5 | `getByRole("heading", ...)` → `getByText(...)`   | shadcn の CardTitle が `<div>` 実装で role なし    |
| 6 | `listitem.filter({ hasText })` + `has` で PlayerList 絞り込み | SeatingBoard の listitem と混同を回避           |
| 7 | BustButton locator を aria-label (`/^bust-/`) 経由へ | `aria-label` が accessible name を上書き       |
| 8 | viewer 用 /live を joinAsGuest から別 tab 経由へ | 4 人目の参加で `resolveWinner` 条件崩壊を回避 |

## Validation

| Check      | Result                         |
| ---------- | ------------------------------ |
| Type check | PASS (`tsc --noEmit` 0 errors) |
| Lint       | PASS (`next lint` 0 warnings)  |
| Unit tests | PASS (296 / 17 files, 97.63% coverage, 本 PR と並存) |
| E2E tests  | **PASS (9 / 9, 56.6s)**        |
| Build      | PASS (`next build` 13 routes)  |

## Not Covered (Phase 5+ 検討)

| 項目                                | 理由                                                                 |
| ----------------------------------- | -------------------------------------------------------------------- |
| オフライン耐性 (`ConnectionBadge`)  | Playwright context offline API で実装可。Phase 5 ドライラン後に検討    |
| Late entry 自動配席                 | Phase 4 のロジック。別 spec 追加でカバー可                            |
| バランシング指示                    | 複数端末 + 10 人以上のシード必要、コスト高。unit で十分カバー済み        |
| モバイル viewport（375x667）        | `projects: [{ use: devices["Pixel 5"] }]` で追加可                    |
| Firebase 実プロジェクト CI          | GitHub Actions + emulator サービス化が望ましい                         |

## Environment Notes

- **Java**: Firebase CLI 15.15 以降は Java 21+ 必須。Java 17 は NG（途中で判明）
- **Playwright browsers**: `@playwright/test` バージョンと完全一致する Chromium が必要。`npx playwright install chromium` で取得
- **Emulator port**: ui=4000 を readiness 目印に利用。既存 emulator が動いていれば `reuseExistingServer` で共用

## Next Steps

- [ ] `/prp-commit` で E2E 基盤 + 4 specs をコミット
- [ ] Phase 5 plan 着手時、このレポートを参照し「カバーしていない項目」を spec 化
- [ ] CI（GitHub Actions）で `test:e2e` を動かす設計（Java 21 セットアップ + Chromium キャッシュ）
