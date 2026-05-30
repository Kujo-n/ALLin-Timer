# Implementation Report: 終了済みトーナメントで優勝音を鳴らさないガード（Phase 3 / 要望③）

## Summary

終了済み（`state === "finished"`）トーナメントの運営ページ（dashboard / live）を開いた瞬間に優勝音が誤発火するバグを修正した。`useAudioPlayer` の winner 検知 effect に `isFinished(tournament)` ガードを追加し、finished のときは `prevWinnerIdRef` を更新する（再発火防止）が `play()` しないようにした。進行中（running / paused）の `null → winner` 遷移での正常な優勝音は維持している。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Small            | Small  |
| Confidence    | 高（既存パターン踏襲） | 高（計画どおり） |
| Files Changed | 2（実装 1 + テスト 1） | 2 |

## Tasks Completed

| #   | Task | Status | Notes |
| --- | ---- | ------ | ----- |
| 1   | finished で鳴らない red テストを先行追加 | ✅ Complete | 2 件追加。`null → winner while finished` が想定どおり red |
| 2   | winner effect に `isFinished` ガード + import 追加 | ✅ Complete | EFFECT_GUARD_PATTERN（ref 先更新 → 早期 return）に準拠 |
| 3   | 全体検証（typecheck / lint / 全 UT / build） | ✅ Complete | すべて green |

## Validation Results

| Level | Status | Notes |
| ----- | ------ | ----- |
| Static Analysis (typecheck) | ✅ Pass | `tsc --noEmit` 0 error |
| Static Analysis (lint) | ✅ Pass | `next lint` warning/error 0 |
| Unit Tests | ✅ Pass | useAudioPlayer 29 件 / 全体 1422 件 pass。新規 2 件 |
| Build | ✅ Pass | `next build` 成功 |
| Integration | N/A | Firestore 書込・rule 変更なし（hook の effect ガードのみ） |
| Edge Cases | ✅ Pass | finished mount / finished 中遷移 / running 回帰 / member 回帰 |

## Files Changed

| File | Action | Lines |
| ---- | ------ | ----- |
| `src/lib/hooks/useAudioPlayer.ts` | UPDATED | +6 / -0（import 1 行 + ガード 1 行 + コメント 4 行） |
| `src/lib/hooks/useAudioPlayer.test.tsx` | UPDATED | +44 / -0（winner detection に `it` 2 件追加） |

## Deviations from Plan

None — 計画どおり実装。

## Issues Encountered

- 1 件目のテスト「finished mount で鳴らない」は**修正前から pass**していた。理由は mount 時に winner effect が走るタイミングでは AudioContext が `suspended`（未 unlock）で play gate に弾かれ、その後 `unlock()` しても deps 不変で effect が再評価されないため。プラン GOTCHA でも言及済み。バグの真の再現は 2 件目「finished 中の `null → winner` 遷移」（mount→unlock 後に rerender で遷移）が担い、これは想定どおり red → ガード追加で green になった。1 件目はガード追加後も有効な回帰ガードとして維持。

## Tests Written

| Test File | Tests | Coverage |
| --------- | ----- | -------- |
| `src/lib/hooks/useAudioPlayer.test.tsx` | 2 件 | finished mount で無音 / finished 中の null→winner 遷移で無音 |

## Next Steps

- [ ] `/code-review` でレビュー（Codex レビュー対象）
- [ ] `/prp-commit` または `/prp-pr` でコミット・PR 作成
- [ ] 手動確認: dev server で finished の運営ページ無音・進行中の winner 確定で再生
- [ ] Phase 4（要望④⑤）に着手（DEPENDS: 3、同じ `useAudioPlayer.ts` を触る）
