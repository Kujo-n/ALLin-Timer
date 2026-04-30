# エラー / ログ規約

Phase 1 で確立。Phase 4 architect-refactor で helper を 3 種類に拡張。例外処理・ログ出力は以下に統一する。

## エラー

- すべての例外は **`AppError`（`src/lib/errors.ts`）でラップ**する
- ドメインコード（prefix）を必ず付与:
  - `firestore/*` — Firestore 操作起因
  - `auth/*` — 認証起因
  - `tournament/*` — ドメインロジック起因
  - `validation/*` — 入力検証起因
  - `seating/*` — 席決め起因
  - `group/*` — group 操作起因
  - 例: `firestore/permission-denied`, `auth/email-already-in-use`, `tournament/seat-conflict`
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
