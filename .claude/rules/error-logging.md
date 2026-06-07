---
applyAlways: false
applyOnPaths:
  - "src/**/*.{ts,tsx}"
applyOnPathsExclude:
  - "**/*.test.{ts,tsx}"
  - "src/lib/firebase/schemas/*.ts"
---

# エラー / ログ規約

Phase 1 で確立。Phase 4 architect-refactor で helper を 3 種類に拡張。例外処理・ログ出力は以下に統一する。

## 適用範囲

- **対象**: `src/**/*.{ts,tsx}`（アプリ実装コード全般）
- **除外**:
  - `**/*.test.{ts,tsx}` — UT は `vi.spyOn(logger, ...)` 経由の検証や、意図的な throw 注入を行うため本規約の `console.*` 禁止 / `AppError` ラップ義務は適用しない
  - `src/lib/firebase/schemas/*.ts` — 純粋な zod schema 定義のみで、try/catch / logger 呼出を持たない
- **対象外（include に含まれない）**:
  - `scripts/**` — CLI スクリプトは `console.*` と素の `throw new Error` を許容（logger.ts パイプラインを通さない）
  - `tests/e2e/**` — Playwright spec は本規約の対象外
  - `next.config.*` / `playwright.config.ts` / その他 root 直下の config — 例外処理を持たない

## エラー

- すべての例外は **`AppError`（`src/lib/errors.ts`）でラップ**する
- ドメインコード（prefix）を必ず付与:
  - `firestore/*` — Firestore 操作起因
  - `auth/*` — 認証起因
  - `tournament/*` — ドメインロジック起因
  - `validation/*` — 入力検証起因
  - `seating/*` — 席決め起因（Phase 3 (07-third-dryrun-improvements) で手動卓閉鎖の `seating/table-close-overflow`（残卓が定員 ≤10 で収容不能なため閉鎖をブロック）/ `seating/table-close-last`（最後の 1 卓は閉鎖不可）を追加）
  - `group/*` — group 操作起因
  - `season/*` — シーズン管理起因（Phase A 追加。`startNewSeason` の tx 失敗 / pre-check 違反等）
  - `pwa/*` — PWA インストール / Service Worker / ブラウザストレージ起因（Phase D 追加。`pwa/storage-failed` / `pwa/install-prompt-failed` 等）
  - `spectate/*` — 観戦モード起因（04-spectate-mode Phase 1 追加。書込 service / `/spectate/[tid]` ページは Phase 2/3 で具体 code が増える予定。`spectate/permission-denied` 等）
  - `theme/*` — テーマ切替（個人 preference）起因（05-post-launch-polish Track D / Phase D.1 追加。`theme/storage-failed`（localStorage write/read 例外）/ `theme/invalid-value`（既存 stored 値が `"light" | "dark" | "system"` でない場合）等）
  - 例: `firestore/permission-denied`, `auth/email-already-in-use`, `tournament/seat-conflict`, `seating/table-close-overflow`, `seating/table-close-last`, `season/start-failed`, `season/in-progress-tournament`, `pwa/storage-failed`, `spectate/permission-denied`, `theme/storage-failed`
- `throw new Error(...)` の直接使用は禁止（`AppError` でラップ）

## エラー helper の使い分け（Phase 4 architect-refactor 以降）

`src/lib/errors.ts` は 3 つの helper を提供する。用途を明示的に区別する:

| helper                           | 用途                                                                        | 既存 AppError の扱い                       |
| -------------------------------- | --------------------------------------------------------------------------- | ------------------------------------------ |
| `AppError.from(e, code, msg)`    | 確実に未 wrap のエラーを wrap する（Firebase SDK の生 `Error` 等）          | 既に `AppError` なら**素通し**（同一参照） |
| `unwrapOrFrom(e, code, msg)`     | 既に wrap されている**可能性のある**エラーを尊重して wrap                   | 既に `AppError` なら**素通し**（同上）     |
| `getErrorCode(e)`                | `code` 文字列のみが必要なとき（`Promise.allSettled` の reason / log 整形）  | 取得しないが AppError なら `e.code` を返す |

挙動は `AppError.from` と `unwrapOrFrom` で実質同じだが、**呼出側の意図表現が違う**ため使い分ける:

```ts
// AppError.from: 「ここで初めて wrap する」意図
try {
  await updateDoc(...);
} catch (e) {
  throw AppError.from(e, "firestore/write_failed", "保存失敗");
}

// unwrapOrFrom: 「内側で既に wrap 済みかも、未 wrap のときだけ補完したい」意図
try {
  await updateAudioSettings(gid, settings);  // 内部で AppError ラップ済み
} catch (e) {
  // 二重 ログを避けるため unwrapOrFrom で透過。code/message は内側のものを尊重
  const err = unwrapOrFrom(e, "firestore/write_failed", "サウンド設定の更新に失敗しました");
  setError(`${err.code}: ${err.message}`);
}

// getErrorCode: code 文字列だけ欲しい
results.forEach((r) => {
  if (r.status === "rejected") {
    logger.warn("propagate failed", { code: getErrorCode(r.reason) });
  }
});
```

### 禁止パターン

```ts
// bad — 手書き型ガード（getErrorCode で置換する）
const code = e && typeof e === "object" && "code" in e
  ? (e as { code: string }).code
  : "unknown";

// bad — 既に wrap 済み AppError を二重 wrap してログを 2 重出力
catch (e) {
  const wrapped = AppError.from(e, "...", "...");  // 内側でも warn 済み
  logger.warn(wrapped.message, ...);                // ← 二重 warn
}
```

## repository の wrap helper（Phase 4 architect-refactor 以降）

repository 層の手書き try/catch + AppError.from + logger.warn は `@/lib/firebase/wrap.ts` に集約済み。詳細は [firebase-patterns.md](firebase-patterns.md) の「repository の error wrap」を参照。

## ログ

- 出力は **`src/lib/logger.ts` 経由のみ**
- **`console.log` / `console.error` の直呼び禁止**
- ログレベル: `debug` / `info` / `warn` / `error` を適切に使い分け
- 本番（Vercel）では `info` 以上のみ出力、ローカル開発では `debug` も出力

## 禁止事項

- `try { ... } catch (e) { /* swallow */ }` — 握りつぶし禁止。最低でも `logger.warn` で記録
- `console.*` の残置 — Lint ルールで検出する
- 手書きの `e instanceof Error && "code" in e` 型ガード — `getErrorCode(e)` を使う
- 既に AppError ラップ済みのエラーをさらに `AppError.from` で wrap 直す（二重 warn を引き起こす）— `unwrapOrFrom` を使う
