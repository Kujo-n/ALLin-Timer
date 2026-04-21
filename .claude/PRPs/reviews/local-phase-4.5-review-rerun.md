---
# Local Review (再実行): Phase 4.5 — Pre-Phase 5 Improvements

**Reviewed**: 2026-04-21 (rerun)
**Reviewer**: /code-review — local mode
**Branch**: develop（未コミット差分）
**Decision**: APPROVE with comments

## Summary

Phase 4.5 の全 25 変更ファイル（編集 19 / 新規 6 / 削除 2）を独立再レビュー。
- 既知の MEDIUM 2 件（auto-finish 依存 / `resolveWinner` 二重呼出）は対応済みの実装を確認。
- `CRITICAL` / `HIGH` 該当なし。
- 新たな `MEDIUM` 1 件（live-client anonymous self-delete effect が `user.delete()` 後に onSnapshot の `permission-denied` noise を出しうる — 観測のみ、動作影響なし）。
- 既存 `LOW` 指摘は概ね妥当（実時間 `setTimeout(20)` 待機、page.tsx 初回 hydrate flash など）。

型検査 / lint / 296 unit tests / build すべて green。コミット / PR 可。

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

1. **live-client の匿名自己削除後、onSnapshot が `permission-denied` を出す可能性** — observation only
   - 場所: [src/app/tournaments/[tid]/live/live-client.tsx:52-74](src/app/tournaments/[tid]/live/live-client.tsx#L52-L74)
   - `user.delete()` が成功すると Firebase Auth の currentUser が null になる。その後も `subscribePlayers` の onSnapshot コールバックは一瞬生き続け、Firestore rule の `isSignedIn()` が false になるため `permission-denied` を投げ、`subscribePlayers` の err handler が `logger.warn("live players subscribe error", ...)` を出力する。
   - UX への影響はなし（page はアンマウント間近 / 匿名ユーザーがリダイレクトされる前のノイズ）。ただし本番ログに出てくると原因を追いづらい。
   - 対応案（必須ではない）: `selfDeleteInflightRef` を立てる前に `unsub()` を呼ぶ、または err handler の中で `user === null` 状態を検知したら warn を debug に落とす。Phase 5 実地テストで確認してから判断で十分。

### LOW

2. **`cancelOwnEntry` / `logout` の匿名 self-delete が非 atomic**
   - 場所: [src/lib/services/auth-actions.ts:259-285](src/lib/services/auth-actions.ts#L259-L285) / [src/lib/services/receipt.ts:154-176](src/lib/services/receipt.ts#L154-L176)
   - `deleteUserProfile` と `user.delete()` の 2 段が両方成功する保証はない。best-effort 方針は plan で明示されており、後続 phase で Cloud Functions による整理を想定済み。コード変更不要。

3. **auto-finish `inflightRef` の reset が cleanup 依存**
   - 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:119-140](src/app/tournaments/[tid]/dashboard-client.tsx#L119-L140)
   - 成功経路: `finishTournament` 完了 → `data.state === "finished"` → 次の effect で早期 return → cleanup 未実行（deps 変わっていれば cleanup）。`state === finished` に遷移する際に `dataState` が変わるので cleanup は必ず 1 度走る → inflight クリア → 以降の再評価で早期 return を継続 → 問題なし。
   - 失敗経路: `setTimeout` callback 内の `.catch` で inflight を false に戻す。その後の snapshot で再 arm される。idempotent なので OK。
   - 設計意図通り。

4. **E2E テストが実時間 `setTimeout(20)` に依存**
   - 場所: [src/app/tournaments/[tid]/live/live-client.test.tsx:259,280](src/app/tournaments/[tid]/live/live-client.test.tsx#L259)
   - 副作用が走らないことを 20ms 待機で確認。vitest fake timers へ置き換えると堅牢性が上がる。現状 flaky は確認されていないが候補。

5. **page.tsx の SSR→CSR hydrate flash**
   - 場所: [src/app/page.tsx](src/app/page.tsx)
   - `"use client"` 化により初回は常に「読込中…」を描画してから切替わる。プラン受容済み。

6. **`.gitignore` 追加（playwright / emulator cache 系）**
   - 場所: [.gitignore](.gitignore)
   - `.firebase/` / `firebase-debug.log` / `/playwright-report` 等を追加。妥当。

## Pattern / Security Compliance

- **[.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md)**: 初期化 singleton、`useAuthUser` 経由の購読、repositories 層経由 CRUD、`zodConverter` 適用、`AppError.from` ラップ — 全遵守。`deleteUserProfile` は既存 rule の self-write 許可範囲内で動作。
- **[.claude/rules/error-logging.md](.claude/rules/error-logging.md)**: `console.*` 直呼出しは `src/lib/logger.ts` 内部の 4 箇所のみ（logger 実装本体）。握りつぶしなし（全 catch に `logger.warn` あり）。
- **[.claude/rules/security.md](.claude/rules/security.md)**: 新規環境変数なし、秘密情報の残留なし（`grep -i "apiKey|secret|token|password"` は test dummy `"pw"` のみ一致）。client.ts への emulator 接続は `NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true"` ガードで本番影響なし。`.gitignore` は `.env*.local` / `.env` を既にカバー。
- **[.claude/rules/group-membership.md](.claude/rules/group-membership.md)**: group コンテキスト周りの変更なし（`GroupProvider` / `useCurrentGroup` API 維持）。

## Validation Results

| Check      | Result                                                                |
| ---------- | --------------------------------------------------------------------- |
| Type check | **Pass** (`npm run typecheck` — 0 errors)                              |
| Lint       | **Pass** (`npm run lint` — 0 warnings)                                 |
| Tests      | **Pass** (`npm test` — 296 tests / 17 files pass, 2.5s)                |
| Build      | **Pass** (`next build` — 13 routes, no `/auth/email-link`, no new warnings) |

## Files Reviewed

### Edited (19)
- `.claude/PRPs/prds/allin-timer.prd.md`
- `.gitignore`
- `firebase.json`
- `package.json` / `package-lock.json`
- `src/app/groups/[gid]/group-detail-client.tsx`
- `src/app/join/[tid]/join-client.tsx`
- `src/app/login/login-client.tsx`
- `src/app/page.tsx`
- `src/app/tournaments/[tid]/dashboard-client.tsx`
- `src/app/tournaments/[tid]/live/live-client.tsx` + `.test.tsx`
- `src/components/auth/AuthBadge.tsx`
- `src/components/tournament/TimerControls.tsx`
- `src/lib/firebase/client.ts`
- `src/lib/firebase/repositories/users.ts`
- `src/lib/services/auth-actions.ts` + `.test.ts`
- `src/lib/services/receipt.ts` + `.test.ts`
- `src/lib/services/seating/orchestrator.test.ts`
- `src/lib/services/timer.ts`

### Added (6)
- `playwright.config.ts`
- `src/components/tournament/WinnerBanner.tsx`
- `src/lib/logger.test.ts`
- `tests/e2e/**`（fixtures, pages, 5 specs + README）
- `.claude/PRPs/reports/phase-4.5-e2e-test-report.md`
- `.claude/PRPs/reports/phase-4.5-pre-phase5-improvements-report.md`

### Deleted (2)
- `src/app/auth/email-link/page.tsx`
- `src/app/auth/email-link/email-link-client.tsx`

## Decision

**APPROVE with comments.**

`CRITICAL` / `HIGH` なし。MEDIUM 1 件は観測レベルで動作影響なし。Phase 5 実地テストで `permission-denied` ログのノイズが気になるようなら unsub 順序の調整で解消可能。コミット / PR 作成して良い。

## Next Steps

- [ ] `/prp-commit` もしくは `/prp-pr` で develop へ
- [ ] Phase 5 実地ドライラン中に MEDIUM 1（self-delete 後 noise）の有無を確認
- [ ] 匿名自己削除の atomicity は Phase 6+ の Cloud Functions で一括対応予定
