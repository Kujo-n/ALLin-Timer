# ローカルレビュー: ストラクチャ時間の一括設定モード（Phase 1）

**Reviewed**: 2026-05-31
**Author**: Kujo-n
**Branch**: develop（未コミット変更）
**Decision**: APPROVE（コメント付き）

## Summary

`LevelTable` への一括/個別トグル追加と純関数 `structure-levels.ts` の切り出しは、既存の `autoSbHalf` トグル・`tournament-state.ts` precedent を忠実に mirror しており、規約（error-logging / testing / firebase-patterns いずれもスコープ外）に適合。CRITICAL / HIGH はなし。指摘は LOW 2 件のみ。

> 注: `useAudioPlayer.ts` / `useAudioPlayer.test.tsx` の未コミット変更は本 plan（structure-bulk-duration）と無関係な別 work-stream のため本レビュー対象外。

## Findings

### CRITICAL

None

### HIGH

None

### MEDIUM

None

## LOW

**L-1: `inferBulkDurationMin` の no-op 三項（`structure-levels.ts:28-29`）**
`const uniform = levels.every(...)` を計算した上で `return uniform ? first : first;` と両分岐が同値を返す。plan に「将来の挙動変更余地のため明示」と意図が記録されており、JSDoc コメントもある。現状は `uniform` の `every` ループが純粋に無駄な計算（小規模配列のため実害なし）。
- 提案: 現状のまま許容で問題なし。将来「不揃い時に既定 10 を返す」等の分岐を実装する際にこの足場を活かす。気になる場合は `uniform` 計算を削り `return first;` に簡約しても挙動同値。

**L-2: 入力クリア時の一時表示（`LevelTable.tsx:54-58`）**
一括分入力を空にすると `parseIntSafe("")→0→setBulkMin(0)` で input が一瞬 `0` を表示し、`onChange` は 60 秒（`Math.max(1,...)`）を適用する。既存 `updateDurationMin` と同じ寛容さで、plan の GOTCHA に明記済み。実害なし。

## 確認した良い点

- **immutable**: 全ハンドラが `map` による新配列生成で `onChange`。引数 mutate なし（test で `applyBulkDurationMin` の非破壊も固定）。
- **規約適合**: 例外処理・logger・Firestore に触れない純 UI / 純関数のため AppError / logger 不要（error-logging.md 対象外）。schema / repository / rules 不変。
- **a11y**: `role="radiogroup"` + 各 radio に `aria-label`、可視ラベルは `<label>` ラップで関連付け。
- **テスト**: factory パターン + 振る舞い検証（disabled / onChange の `objectContaining`）で testing.md の純関数 characterization + component 振る舞いの作法に準拠。break 行含む一律代入を固定。
- **consumer 不変**: props 契約（`levels` / `onChange`）を変えず、`StructureForm` / 新規・編集クライアントは無変更。

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass（`npx tsc --noEmit` ゼロエラー） |
| Lint       | Pass（`npm run lint` warnings/errors なし） |
| Tests      | Pass（全 1438 / 新規 structure-levels 11 + LevelTable +5） |
| Build      | Pass（`npm run build` 成功） |

## Files Reviewed

- `src/lib/services/structure-levels.ts` — Added
- `src/lib/services/structure-levels.test.ts` — Added
- `src/components/structure/LevelTable.tsx` — Modified
- `src/components/structure/LevelTable.test.tsx` — Modified
