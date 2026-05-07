# Implementation Report: ストラクチャフォームに「SB を BB の半額で自動入力」トグル追加

## Summary

ストラクチャ作成／編集フォームの [LevelTable](../../../src/components/structure/LevelTable.tsx) に「SB を BB の半額で自動入力」チェックボックス（デフォルト ON）を追加した。
ON のときは SB 入力欄を `disabled` にし、BB 入力が変更されたタイミングで SB を `Math.floor(bb / 2)` に自動追従させる。OFF のときは従来通り SB を手動編集可能。
既存データが変則ブラインド（SB ≠ BB/2）の場合は自動推定で OFF 起動させ、誤って値を上書きしないようにしている。列順（SB → BB → Ante → 分 → BREAK）は業界標準（WSOP / PokerStars）に揃えて維持。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
| --- | --- | --- |
| Complexity | Small | Small |
| Confidence | — | High（想定通り） |
| Files Changed | 1 変更 + 1 新規テスト | 1 変更 + 1 新規テスト |

## Tasks Completed

| # | Task | Status | Notes |
| --- | --- | --- | --- |
| 1 | 初期値推定 util `inferAutoSbHalfFromLevels` を追加 | [done] Complete | トップレベル純粋関数として `parseIntSafe` / `secToMin` に並べて配置 |
| 2 | `useState<boolean>(inferAutoSbHalfFromLevels(levels))` を追加 | [done] Complete | `import { useState } from "react"` を新規追加。lazy initializer 採用 |
| 3 | チェックボックス UI をテーブル上部に追加 | [done] Complete | 素の `<input type="checkbox">` を `<label>` でラップ、`aria-label="auto-sb-half"` |
| 4 | `handleAutoSbHalfToggle` と `updateChip` のロジック拡張 | [done] Complete | BB 分岐で SB 同時更新、OFF→ON 切替で一括再計算 |
| 5 | SB Input に `disabled={l.isBreak \|\| autoSbHalf}` を追加 | [done] Complete | `l.isBreak` と OR 結合 |
| 6 | `LevelTable.test.tsx` を新規作成 | [done] Complete | 10 ケース実装・全 pass |
| 7 | ビルド／型／Lint の最終確認 | [done] Complete | `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build` すべて green |

## Validation Results

| Level | Status | Notes |
| --- | --- | --- |
| Static Analysis (typecheck) | [done] Pass | zero errors |
| Static Analysis (lint) | [done] Pass | No ESLint warnings or errors |
| Unit Tests | [done] Pass | 10 new tests / 全 411 tests 24 files green（回帰なし） |
| Build | [done] Pass | Next.js `npm run build` 成功、静的ページ 15 ルートも通常通り |
| Integration | N/A | UI ローカル state のみ、永続化層・API 層に変更なし |
| Edge Cases | [done] Pass | BB=1, BB=奇数, 変則データ, break 行, OFF→ON ラウンドトリップ, OFF 時 BB 変更で SB 不変を unit test でカバー |

## Files Changed

| File | Action | Lines |
| --- | --- | --- |
| `src/components/structure/LevelTable.tsx` | UPDATED | +41 / -4（概算） |
| `src/components/structure/LevelTable.test.tsx` | CREATED | +120 |

## Deviations from Plan

None — プラン通りに実装。

## Issues Encountered

None。プランの GOTCHA（`useState` 未 import・break 行のスキップ・`Math.floor` 採用）は事前に認識していたため引っ掛からなかった。

## Tests Written

| Test File | Tests | Coverage |
| --- | --- | --- |
| `src/components/structure/LevelTable.test.tsx` | 10 tests | 初期推定 ON/OFF・ON 時の SB disabled・BB→SB 追従・奇数 BB（floor）・BB=1（SB=0 境界）・OFF 時 BB で SB 不変・OFF 時 SB 手動編集・OFF→ON 一括再計算（break 行除外）・列順確認・Ante 変更の非干渉 |

## Manual Validation

ブラウザでの目視確認（`/structures/new` / `/templates/new` / `/structures/{sid}/edit`）は未実施。UI 単体テストで挙動を保証しており、`npm run build` も通っているため、通常動作への影響はない前提。実地確認は PR レビュー前に任意で実施推奨。

## Next Steps

- [ ] 必要に応じて `npm run dev` で UX 目視確認
- [ ] `/code-review` でローカル変更レビュー
- [ ] `/prp-commit` → `/prp-pr` でコミット／PR 作成
