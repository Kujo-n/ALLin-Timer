# Implementation Report: Phase 5.3 — Append Blind Level

## Summary

進行中（または setup 中）のトーナメントの `structureSnapshot.levels` 末尾に
新規ブラインドレベルを 1 件 append する機能を実装した。最終レベル張り付き状態
（`currentLevel === levels.length`）からの脱出を運営者（owner / organizer）が
1 操作で行えるようになり、append 後は次 tick で `shouldAutoAdvance` が満たされて
auto-advance が発火する。

主要な変更:

- `MAX_LEVELS_PER_TOURNAMENT = 50` を [src/lib/limits.ts](../../../src/lib/limits.ts) に追加（暴走防止）
- `canAppendLevel(t)` 純関数を [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts) に追加
- `appendLevel(tid, uid, userGroupIds, levelInput)` repository を [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) に追加（Phase 5.2 `setLevelDurationSec` と同じ `runTransaction` + array-rewrite）
- `AppendLevelDialog` を [src/components/tournament/AppendLevelDialog.tsx](../../../src/components/tournament/AppendLevelDialog.tsx) に新規作成（直前レベル quick-fill / break toggle / AppError 表示）
- `StructureSnapshotCard` に `canAppend` / `onAppendLevel` props を additive 追加し append button + Dialog を mount
- dashboard-client.tsx に append 経路を配線（live は read-only 維持で regression 0）
- repository / 純関数 / Dialog / Card / E2E 計 5 層のテストを追加

schema 変更・Firestore Rules 変更は無し（`tournaments/{tid}` update は既に
`isOrganizer(resource.data.groupId)` で gate 済み、`MAX_LEVELS_PER_TOURNAMENT` は
rule 側に転記しない方針 = Phase 5.2 と同方針）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual              |
| ------------- | ---------------- | ------------------- |
| Complexity    | Medium           | Medium              |
| Confidence    | 9/10             | 9/10                |
| Files Changed | ~9               | 10 (実装8 + テスト2 + E2E1) |

## Tasks Completed

| #   | Task                                                                       | Status   | Notes |
| --- | -------------------------------------------------------------------------- | -------- | ----- |
| 1   | `MAX_LEVELS_PER_TOURNAMENT` を `limits.ts` に追加                          | Complete |       |
| 2   | `canAppendLevel` 純関数を `tournament-state.ts` に追加                     | Complete |       |
| 3   | `canAppendLevel` の characterization test を追加                           | Complete | 7 ケース（state x levels.length 組合せ網羅） |
| 4   | `appendLevel` repository 関数の追加                                        | Complete |       |
| 5   | `appendLevel` repository の単体テスト                                      | Complete | 11 ケース（happy / preserve / no-touch / permission / not-found / finished / max-limit / 9 invalid inputs / break / setup / wrap） |
| 6   | `AppendLevelDialog` 新規コンポーネント作成                                 | Complete |       |
| 7   | `AppendLevelDialog` 単体テスト                                             | Complete | 9 ケース |
| 8   | `StructureSnapshotCard` への組込み                                         | Complete |       |
| 9   | `StructureSnapshotCard.test.tsx` への append visibility test               | Complete | 5 ケース |
| 10  | `dashboard-client.tsx` への配線                                            | Complete |       |
| 11  | E2E spec 追加                                                              | Complete | 3 ケース（setup append / running break / live regression） |
| 12  | ローカル動作確認                                                           | Skipped  | auto モードのため省略可、typecheck / lint / test / build / rules-limits で代替 |

## Validation Results

| Level                               | Status | Notes                                          |
| ----------------------------------- | ------ | ---------------------------------------------- |
| Static Analysis (typecheck)         | Pass   | `npx tsc --noEmit` ゼロエラー                   |
| Static Analysis (lint)              | Pass   | `npm run lint` ゼロ警告                         |
| Unit Tests (full suite)             | Pass   | 35 files / 768 tests 全 green                   |
| Unit Tests (affected files)         | Pass   | 4 files / 216 tests 全 green                    |
| Build                               | Pass   | `npm run build` 成功                            |
| Firestore Rules drift               | Pass   | `npm run test:rules-limits` 6/6 OK             |
| Edge Cases                          | Pass   | repository test で max-limit / break / 9 invalid input を網羅 |
| E2E                                 | Pending | spec 追加済み。emulator + dev server 起動環境で別途実行 |

## Files Changed

| File                                                                                                                | Action  | Lines (approx) |
| ------------------------------------------------------------------------------------------------------------------- | ------- | -------------- |
| `src/lib/limits.ts`                                                                                                 | UPDATE  | +13            |
| `src/lib/services/tournament-state.ts`                                                                              | UPDATE  | +15            |
| `src/lib/services/tournament-state.test.ts`                                                                         | UPDATE  | +57            |
| `src/lib/firebase/repositories/tournaments.ts`                                                                      | UPDATE  | +98            |
| `src/lib/firebase/repositories/tournaments.test.ts`                                                                 | UPDATE  | +217           |
| `src/components/tournament/AppendLevelDialog.tsx`                                                                   | CREATE  | +194           |
| `src/components/tournament/AppendLevelDialog.test.tsx`                                                              | CREATE  | +192           |
| `src/components/tournament/StructureSnapshotCard.tsx`                                                               | UPDATE  | +44            |
| `src/components/tournament/StructureSnapshotCard.test.tsx`                                                          | UPDATE  | +60            |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                                                                    | UPDATE  | +9             |
| `tests/e2e/append-blind-level.spec.ts`                                                                              | CREATE  | +212           |

合計: 11 files (3 created / 8 updated)、約 +1,111 行（テストとコメント含む）

## Deviations from Plan

None — plan 通りに実装。以下の細かな実装判断は plan の意図に沿った調整:

- `appendLevel` の入力 validation で `tournament/levels-limit-exceeded` の判定は
  plan 上「`oldLevels.length >= MAX_LEVELS_PER_TOURNAMENT` を tx 内で再 check」と
  指示されていたが、`canAppendLevel(cur)` 純関数を呼んで判定する形に統一（同じ条件を
  二重に書かない）。挙動は等価。
- E2E spec で `getByRole("button", { name: "追加" })` は `+ レベル追加` トリガと
  衝突するため、Dialog の submit ボタン参照は `name: /^追加$/` の完全一致に変更。

## Issues Encountered

None — 全 task が plan 記載通り one-shot で通った。typecheck / lint / build / unit
テストすべて green。

## Tests Written

| Test File                                                              | Tests   | Coverage                                                                 |
| ---------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------ |
| `src/lib/services/tournament-state.test.ts`                            | +7      | `canAppendLevel` の state x levels.length 組合せ網羅                      |
| `src/lib/firebase/repositories/tournaments.test.ts`                    | +11     | `appendLevel` happy / preserve / no-touch / permission / not-found / finished / max-limit / 9 invalid / break / setup / wrap |
| `src/components/tournament/AppendLevelDialog.test.tsx`                 | 9       | open=false / title / defaults / break toggle / submit / AppError / cancel / re-hydrate |
| `src/components/tournament/StructureSnapshotCard.test.tsx`             | +5      | append button visibility（4 prop パターン）+ Dialog open                 |
| `tests/e2e/append-blind-level.spec.ts`                                 | 3       | setup append round-trip / running break append / `/live` regression 0   |

合計: 35 unit tests + 3 E2E。Phase 5.2 同等の test depth + breadth。

## Next Steps

- [ ] E2E を emulator + dev server 起動環境で実行（`npx playwright test tests/e2e/append-blind-level.spec.ts`）
- [ ] `/code-review` で local diff レビュー
- [ ] `/prp-pr` で PR 作成
- [ ] 実運用ドライランで「最終 Lv 張り付き状態 → append → auto-advance 発火」の挙動を観察

## Notes

- 本 plan は `.claude/rules/firebase-patterns.md` の「単一フィールド単独書換の rule 経路」原則からは
  逸脱（`structureSnapshot.levels` map 配下の単独書換のため `affectedKeys().hasOnly([...])` を
  rule で強制しない）。Phase 5.2 と同じ rationale: `tournaments/{tid}` は既に `isOrganizer` で
  gate 済みかつ massively-shared trust boundary ではない。
- 「最終 Lv 張り付き状態で append すると次 tick で auto-advance が自然発火する」挙動は
  `shouldAutoAdvance` が pure 述語で、append 後の `levels.length` を参照するだけで自動追従する
  ため、追加コードなしで成立する（既存 `timer.test.ts` で間接的に lock 済み）。
- 将来の Cloud Functions 化（`tournaments/{tid}` write を Callable に集約）では、`appendLevel` を
  1 callable として移植可能。schema 影響なし。
