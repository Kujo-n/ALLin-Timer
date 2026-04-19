# エラー / ログ規約

Phase 1 で確立。例外処理・ログ出力は以下に統一する。

## エラー

- すべての例外は **`AppError`（`src/lib/errors.ts`）でラップ**する
- ドメインコード（prefix）を必ず付与:
  - `firestore/*` — Firestore 操作起因
  - `auth/*` — 認証起因
  - `tournament/*` — ドメインロジック起因
  - 例: `firestore/permission-denied`, `auth/email-already-in-use`, `tournament/seat-conflict`
- `throw new Error(...)` の直接使用は禁止（`AppError` でラップ）
- 外部 SDK（Firebase 等）から来た Error は `AppError.from(error, "domain/code")` で包み直す

## ログ

- 出力は **`src/lib/logger.ts` 経由のみ**
- **`console.log` / `console.error` の直呼び禁止**
- ログレベル: `debug` / `info` / `warn` / `error` を適切に使い分け
- 本番（Vercel）では `info` 以上のみ出力、ローカル開発では `debug` も出力

## 禁止事項

- `try { ... } catch (e) { /* swallow */ }` — 握りつぶし禁止。最低でも `logger.warn` で記録
- `console.*` の残置 — Lint ルールで検出する
