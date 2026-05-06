# Implementation Report: Phase 5.2 — ダイナミック ブラインド調整（レベル時間の進行中変更）

## Summary

進行中（または setup 中）のトーナメントの `tournaments/{tid}.structureSnapshot.levels[i].durationSec`
を、運営者（owner / organizer）が任意レベル単位で書き換えられるようにする機能を実装した。
schema・Firestore Rules には追加変更なし（`tournaments/{tid}` `update` は既に
`isOrganizer(resource.data.groupId)` で gate 済み）。inline edit は Phase 4.17 の
`useInlineNumberEdit` パターンを mirror し、`StructureSnapshotCard` 内に
`EditableLevelDurationCell` を埋め込む形で組み込んだ。

進行中レベルの `durationSec` を変更したときは `getRemainingMs` の `duration - elapsed`
数式が pure function であるおかげで自動的に新値に追従する（次フレームで
再評価され、`onSnapshot` 経由で全端末が約 1 秒以内に切り替わる）。この性質は
`timer.test.ts` に characterization test として lock した。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | High             | High           |
| Files Changed | 約 9 files        | 9 files (8 src + 1 plan) |

## Tasks Completed

| #   | Task                                                  | Status   | Notes                                                                 |
| --- | ----------------------------------------------------- | -------- | --------------------------------------------------------------------- |
| 1   | `canEditLevelDurations` 純関数 + characterization test | Complete | 9 ケースで全 state × levelIndex 組合せを検証                           |
| 2   | `setLevelDurationSec` repository 関数の追加            | Complete | `runTransaction` + dot-path partial array overwrite                    |
| 3   | `MAX_LEVEL_DURATION_SEC` を `limits.ts` に追加         | Complete | 86400（24h）。rules 側転記なし                                         |
| 4   | `EditableLevelDurationCell` 新規コンポーネント         | Complete | `useInlineNumberEdit` を消費する td 内 view                            |
| 5   | `StructureSnapshotCard` への組込み                     | Complete | 既存 caller (`live-client`) は prop 未指定で read-only 維持             |
| 6   | `EditableLevelDurationCell` 単体テスト                 | Complete | 11 ケース（render / 編集 mode / Esc / 保存 / validate / AppError 伝播）|
| 7   | `setLevelDurationSec` repository unit test            | Complete | 14 ケース（happy / preserve / permission / range / state / wrap）      |
| 8   | `dashboard-client.tsx` への配線                        | Complete | `isOrganizer` を `canEdit` に流用、`setError` を `onEditError` に渡す  |
| 9   | `getRemainingMs` after duration change の characterization test | Complete | 4 ケース（残時間追従 / 0 クランプ / 未来 Lv 不変 / etaMs 再計算） |
| 10  | ローカル動作確認（手動ブラウザ）                       | 未実施   | Auto モードのため typecheck / lint / test / build で代替              |

## Validation Results

| Level                  | Status | Notes                                                       |
| ---------------------- | ------ | ----------------------------------------------------------- |
| Static Analysis (typecheck) | Pass | `tsc --noEmit` がゼロエラー                                  |
| Static Analysis (lint) | Pass   | `next lint` warning / error なし                             |
| Unit Tests             | Pass   | 728 tests / 34 files、新規追加 38 tests                      |
| Build                  | Pass   | `next build` 成功（全ルート生成 OK）                         |
| Firestore Rules limits | Pass   | `npm run test:rules-limits` 6/6 green（変更なし確認）         |
| Manual Browser         | N/A    | Auto モードの自動判定範囲外。次回 PR レビュー時に手動確認     |

## Files Changed

| File                                                                       | Action  | Notes                                                          |
| -------------------------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `src/lib/services/tournament-state.ts`                                     | UPDATE  | `canEditLevelDurations` 純関数を追加                            |
| `src/lib/services/tournament-state.test.ts`                                | UPDATE  | 9 件のテスト追加                                                |
| `src/lib/limits.ts`                                                        | UPDATE  | `MAX_LEVEL_DURATION_SEC` を追加                                 |
| `src/lib/firebase/repositories/tournaments.ts`                             | UPDATE  | `setLevelDurationSec` を runTransaction で追加、import 拡張    |
| `src/lib/firebase/repositories/tournaments.test.ts`                        | UPDATE  | `setLevelDurationSec` describe（14 件）追加                     |
| `src/components/tournament/EditableLevelDurationCell.tsx`                  | CREATE  | inline edit cell 新規                                           |
| `src/components/tournament/EditableLevelDurationCell.test.tsx`             | CREATE  | 11 件のテスト                                                   |
| `src/components/tournament/StructureSnapshotCard.tsx`                      | UPDATE  | edit prop 4 種を追加（後方互換、live-client は read-only 維持） |
| `src/components/tournament/StructureSnapshotCard.test.tsx`                 | UPDATE  | edit prop 用 6 件のテスト追加（既存 7 件は変更なし）              |
| `src/lib/services/timer.test.ts`                                           | UPDATE  | duration mutation 後の数式自然追従の characterization 4 件追加   |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                           | UPDATE  | `<StructureSnapshotCard>` に prop 4 種を渡す                    |
| `src/app/tournaments/[tid]/live/live-client.tsx`                           | NO CHANGE | read-only。新 prop 未指定で従来挙動を維持                       |

## Deviations from Plan

なし — 計画書通りに実装。例外は次の 2 点のみ:

- Task 10（ローカル動作確認）は Auto モードのため未実施。typecheck / lint / test / build で代替検証。
- Task 6 のテストで `vi.useFakeTimers({ toFake: ["requestAnimationFrame"] })` の代わりに
  `act(async () => { fireEvent.submit(...) })` を採用（focus 検証を行わずに済むため、より単純）。

## Issues Encountered

なし — Validation 全 green、追加修正不要。

## Tests Written

| Test File                                                       | Tests | Coverage                                                        |
| --------------------------------------------------------------- | ----- | --------------------------------------------------------------- |
| `src/lib/services/tournament-state.test.ts`                     | +9    | `canEditLevelDurations` の全 state × levelIndex 組合せ         |
| `src/lib/firebase/repositories/tournaments.test.ts`             | +14   | `setLevelDurationSec` の happy / 範囲外 / permission / state    |
| `src/components/tournament/EditableLevelDurationCell.test.tsx`  | +11   | render / edit mode / Esc / 保存 / validate / AppError 伝播     |
| `src/components/tournament/StructureSnapshotCard.test.tsx`      | +6    | edit prop 各種で affordance が出る/出ない、state 別の表示判定  |
| `src/lib/services/timer.test.ts`                                | +4    | `duration - elapsed` 数式の自然追従、未来 Lv 変更の影響範囲    |
| **Total**                                                       | **+44** |                                                               |

## Next Steps

- [ ] `/code-review` で diff レビュー（特に `runTransaction` の race 安全性と
      dot-path array overwrite が `structureSnapshot` の他フィールドを潰さないか）
- [ ] 手動ブラウザ動作確認（dev server で organizer / member / live 視聴者の
      3 役割で Pencil 表示・残時間追従・range 外エラーを目視確認）
- [ ] `/prp-pr` で PR 作成
- [ ] PRD の「Implementation Phases」表で Phase 5.2 を `complete` に更新
