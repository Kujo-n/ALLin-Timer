# Architect Refactor Plan — 20260510 (2 サイクル目)

review: [reviews/architect-refactor-20260510-2.md](../../reviews/architect-refactor-20260510-2.md)

## 全体方針

直近サイクルの見送り finding-7 のみを単独 1 task で適用する小規模サイクル。新規監査領域は false positive / 既知制約 / 軽微 edge case で実効 refactor target なし（review 参照）。

- 観測動作変更: empty/whitespace `tid` / `uid` を渡した場合の error code が `firestore/not-found` → `validation/empty-string` に変わる。通常経路では発生しない（unit / E2E は empty 入力を与えないため regression リスク 0）
- ユーザー判断: 「セキュリティ / バグ修正は許容」ポリシーで適用 OK

## タスク

### Task 1: `assertNonEmptyString` helper を `src/lib/errors.ts` に追加し、`setSpectateEnabled` に適用

- finding: 前サイクル #7
- 対象:
  - 追加: `src/lib/errors.ts` の末尾に `assertNonEmptyString(value: unknown, paramName: string): asserts value is string` を export。実装は `typeof value !== "string" || value.trim().length === 0` のとき `validation/empty-string` で throw
  - 修正: `src/lib/services/tournament.ts:setSpectateEnabled` で `assertNonEmptyString(tid, "tid")` / `assertNonEmptyString(uid, "uid")` を入口に追加。doc コメントの error code 一覧にも追記
  - 追加 test: `src/lib/errors.test.ts` に assertNonEmptyString の 5 ケース（pass / empty / whitespace / non-string / paramName 反映）+ formatErrorForDisplay の 2 ケース（既存 helper の characterization）を追加
- 期待される diff: helper 追加 ~22 行 / setSpectateEnabled +5 行 / test +72 行
- 安全網:
  - 既存の `tournament.test.ts` 7 ケース（empty 入力を与えていない）が破綻しないこと
  - 新規 7 cases で helper の振る舞いを直接 lock
- 動作変更: 上述（empty/whitespace 入力時のみ）
- commit メッセージ: `refactor(errors): assertNonEmptyString helper を追加し setSpectateEnabled の tid / uid empty/whitespace を fail-fast に倒す`

## 不変条件再確認

- ✅ 観測可能な動作変更: empty 入力時のみ（policy 内）
- ✅ 既存テストへの skip / disable 無し
- ✅ 公開 API / Firestore スキーマの破壊的変更無し
- ✅ 1 commit で完結
- ✅ プロジェクト固有ルール準拠（[error-logging.md](../../../rules/error-logging.md) の `validation/*` prefix）
- ✅ 日本語コミットメッセージ

## 推定影響範囲

| 層 | ファイル数 | 推定 LoC 変動 |
|---|---|---|
| pure helper (errors.ts) | 1 | +22 行 |
| service 層 (tournament.ts) | 1 | +5 / -2 行 |
| test (errors.test.ts) | 1 | +72 行 |
| **合計** | **3 files** | **+97 / -2 行** |
