# Implementation Report: ストラクチャ時間の一括設定モード（Phase 1）

## Summary

`LevelTable` に「個別設定 / 一括設定」のラジオトグルを追加し、一括モードでは 1 つの分数入力で全レベル（ブレイク含む）の `durationSec` を一律代入できるようにした。全行一律代入・分→秒変換・初期分推定のロジックは純関数（`structure-levels.ts`）として切り出し、characterization test で固定した。schema / repository / Firestore rules は不変。既定は個別モード（永続化なし）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Small            | Small  |
| Confidence    | —（plan に記載なし） | 高 — 既存 `autoSbHalf` パターンの忠実な mirror |
| Files Changed | 4（新規 2 / 更新 2） | 4（新規 2 / 更新 2） |

## Tasks Completed

| #   | Task                                              | Status      | Notes |
| --- | ------------------------------------------------- | ----------- | ----- |
| 1   | 純関数を切り出す（`structure-levels.ts`）          | ✅ Complete | plan の IMPLEMENT 通り |
| 2   | 純関数の characterization test                     | ✅ Complete | 11 ケース（mutate 検証を 1 件追加） |
| 3   | `LevelTable` に一括/個別トグルと一括入力を追加      | ✅ Complete | plan の IMPLEMENT 通り |
| 4   | `LevelTable.test.tsx` にトグル振る舞いテスト追加    | ✅ Complete | 5 ケース追加（既存 10 + 新規 5 = 15） |

## Validation Results

| Level           | Status  | Notes |
| --------------- | ------- | ----- |
| Static Analysis | ✅ Pass | `npx tsc --noEmit` ゼロエラー |
| Unit Tests      | ✅ Pass | 全件 1438 pass（structure-levels 11 + LevelTable 15 含む） |
| Lint            | ✅ Pass | `npm run lint` No warnings or errors |
| Build           | ✅ Pass | `npm run build` 成功 |
| Integration     | N/A     | ローカル UI state のみ。E2E 不要（plan「E2E 不要の判断」に従う） |
| Edge Cases      | ✅ Pass | 空入力→60 秒 / 負値→60 秒 / break 含む一律代入 を unit で固定 |

## Files Changed

| File                                              | Action  | Lines |
| ------------------------------------------------- | ------- | ----- |
| `src/lib/services/structure-levels.ts`            | CREATED | +31   |
| `src/lib/services/structure-levels.test.ts`       | CREATED | +99   |
| `src/components/structure/LevelTable.tsx`         | UPDATED | +60 / -1 |
| `src/components/structure/LevelTable.test.tsx`    | UPDATED | +97   |

## Deviations from Plan

- Task 2 で純関数の「入力配列を mutate しない」検証ケースを 1 件追加（plan のテーブルには 10 ケース想定だったが純関数の不変契約を明示するため 11 ケースに）。挙動・スコープは変えていない。

## Issues Encountered

None — 既存 `autoSbHalf` トグルパターンの mirror で完結。

## Tests Written

| Test File                                       | Tests    | Coverage |
| ----------------------------------------------- | -------- | -------- |
| `src/lib/services/structure-levels.test.ts`     | 11 tests | 純関数（一律代入 / 分→秒下限 / 初期分推定 / 非破壊） |
| `src/components/structure/LevelTable.test.tsx`  | +5 tests | トグル既定 / 表示切替 / disabled / 全行反映 / unify |

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
