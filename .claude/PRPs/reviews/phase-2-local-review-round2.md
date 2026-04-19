# Local Review (Round 2): Phase 2 delta

**Reviewed**: 2026-04-19
**Scope**: Google ログイン / アカウント連携 / `/settings` / トーナメント開始ボタン / エントリー取消など、初回レビュー後に積み上げた変更の差分レビュー
**Decision**: APPROVE — HIGH 2 件 + 主要 MEDIUM 5 件を修正し全検証 pass

## Summary

security-reviewer + typescript-reviewer を並列で走らせ、初回レビュー以降の変更に対する delta 分析を実施。HIGH 2 件（LinkAccountDialog の浮動 Promise、startTournament 周辺のエラー分類）、MEDIUM 5 件（displayName clear、reload 後参照、rules の update 制約、exists() ガード、sanitizeRedirect 重複）、LOW 1 件（receipt.test.ts カバレッジ）を対応。

## Findings

### CRITICAL
None.

### HIGH

| # | File | Issue | 対応 |
|---|---|---|---|
| 1 | `src/components/auth/LinkAccountDialog.tsx` | `onLinked` の型が `() => void` なので /join の async コールバックが浮遊。失敗が拾われず、ダイアログ閉じ順序も不定 | **Fixed** — 型を `() => void \| Promise<void>` に、`onSubmit` で `await Promise.resolve(onLinked())` |
| 2 | `src/lib/firebase/repositories/tournaments.ts` `startTournament` | `getTournament` の失敗（例: `firestore/not-found`）と `updateDoc` の失敗がダッシュボードで「開始失敗」として混同されやすい | **Fixed** — read の try/catch は `getTournament` 内に閉じ、`startTournament` は write だけ catch。コメントで意図明示 |

### MEDIUM

| # | File | Issue | 対応 |
|---|---|---|---|
| 1 | `src/lib/services/receipt.ts` `joinViaEmailLinkComplete` | 成功時のみ `clearStoredDisplayNameForSignIn` を呼んでいた。エラー時は localStorage に前回の displayName が残留する | **Fixed** — `try/finally` で常にクリア |
| 2 | `src/lib/services/auth-actions.ts` `linkGoogleWithPassword` | `cred.user.reload()` 後に同じ参照を使うのは SDK の mutable 挙動依存で将来壊れうる | **Fixed** — `firebaseAuth.currentUser ?? cred.user` で最新を参照 |
| 3 | `src/lib/services/auth-actions.ts` `completeEmailLink` | `signInWithEmailLink` 後の処理も outer catch に入り、成功後のサイド処理失敗まで「メールリンク認証失敗」として再ラップされる | **Fixed** — 外側の try を `signInWithEmailLink` に限定、それ以降は best-effort |
| 4 | `firestore.rules` `players/{pid}` update | `uid` / `isBusted` / `entryAt` / `bustedAt` が immutable 化されておらず、参加者本人が任意のフィールドを書き換え可能。Phase 4（バスト）で問題化 | **Fixed** — `request.resource.data.X == resource.data.X` で immutable 制約。update は displayName のみ変更可 |
| 5 | `firestore.rules` players `delete` の owner 判定 | `get()` が存在しない doc を返すと暗黙 false だが、意図不明瞭 | **Fixed** — `exists() && get(...).data.ownerUid == ...` で明示ガード |
| 6 | `src/lib/services/auth-actions.ts` `buildEmailLinkContinueUrl` | `redirectPath.startsWith("/")` だけで `sanitizeRedirect`（`%2F%2F` bypass 対策済）と乖離 | **Fixed** — `sanitizeRedirect` に統一 |

### LOW

| # | File | Issue | 対応 |
|---|---|---|---|
| 1 | `src/lib/services/receipt.test.ts` | `resolveDisplayName` の priority chain テスト不足 | **Fixed** — `joinAsCurrentUser` 経由で hint優先 / profile fallback / Auth fallback / 全 null で throw の 4 ケースを追加（計 +4 テスト、合計 33 件） |

### 受容した指摘（今回スコープ外）

- `AccountLinkRequired` が React state に `pendingCredential` を保持する件 → セキュリティ的には Firebase SDK 推奨パターン。Phase 2 では許容。XSS 自体は React の自動エスケープ + 他の多重防衛で守られている
- `fetchSignInMethodsForEmail` 失敗時に `methods = []` で続行 → 現在 UI で `methods` を使い分けていないため実害なし。将来利用時に注意
- `cancelPlayerEntry` のクライアント側 owner チェック欠落 → rules 側で owner 要件は担保。Fail-secure 観点で望ましくはあるが実害なし
- TOCTOU（startTournament の getTournament → updateDoc 間） → 単一 owner 運用で実害なし、Phase 5 で optimistic lock 検討可

## Validation Results

| Check | Result |
|---|---|
| Type check (`tsc --noEmit`) | Pass |
| Lint (`next lint`) | Pass |
| Tests (`vitest run`) | Pass（33 件、+4） |
| Build (`next build`) | Pass |

## Files Changed in this Round

| File | Action |
|---|---|
| `src/components/auth/LinkAccountDialog.tsx` | `onLinked` を Promise 許容 + await |
| `src/app/login/login-client.tsx` | `onLinked` の onOpenChange 制御を簡素化（dialog 側が閉じる） |
| `src/lib/services/auth-actions.ts` | `linkGoogleWithPassword`: currentUser 参照 / `completeEmailLink`: outer catch 縮小 / `buildEmailLinkContinueUrl`: sanitizeRedirect 統一 |
| `src/lib/services/receipt.ts` | `joinViaEmailLinkComplete` try/finally 化 |
| `src/lib/firebase/repositories/tournaments.ts` | `startTournament` try/catch 役割分離 + コメント明示 |
| `firestore.rules` | players の update を immutable 化、delete に `exists()` ガード |
| `src/lib/services/receipt.test.ts` | `vi.hoisted` + `resolveDisplayName` priority chain テスト 4 ケース追加 |

## 次のアクション

- [ ] `firebase deploy --only firestore:rules` で新しい immutable 制約 / exists ガードをデプロイ
- [ ] 手動 E2E
  - Google ログイン（新規 / 既存 / 連携フロー）
  - `/settings` で displayName 編集
  - トーナメント「開始」ボタン → state=running 後に編集／削除が消えること
  - 参加取消（自己 + 運営）
- [ ] `/prp-commit` または `/prp-pr`
