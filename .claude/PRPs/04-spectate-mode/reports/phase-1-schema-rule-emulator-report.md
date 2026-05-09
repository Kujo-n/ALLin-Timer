# Implementation Report: Phase 1 — Schema + Rule + Emulator Validator（観戦モード基盤）

## Summary

`tournaments/{tid}` に `spectateEnabled: z.boolean().default(false)` を additive 追加し、firestore.rules の `tournaments` / `players` / `tables` 3 経路の `allow read` を「`spectateEnabled === true` のとき unauthenticated read 可」に OR 拡張。`tournaments/{tid}` の `allow update, delete` を分割し、update に `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` の単独書換ブランチを additive 追加。emulator validator `scripts/test-rules-spectate.mjs` で 14 ケース（read allow / deny / write 経路据え置き / delete 回帰 / non-bool 経路 A 通過）を網羅検証。規約ドキュメント 3 件を更新。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | high             | high           |
| Files Changed | 7                | 22 (うち test fixture 14 件は schema 必須化に伴う付帯修正) |

## Tasks Completed

| #   | Task                                                              | Status        | Notes                                                                                              |
| --- | ----------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| 1   | schema additive 追加（spectateEnabled）                           | [done] 完了   | zod default(false) で旧 doc 互換。test fixture 14 件と createTournament repository に明示値追加     |
| 2   | firestore.rules tournaments allow read 拡張                       | [done] 完了   | `isSignedIn() || resource.data.get('spectateEnabled', false) == true`                              |
| 3   | firestore.rules players allow read 拡張                           | [done] 完了   | 親 tournament を `exists() + get()` で参照                                                         |
| 4   | firestore.rules tables allow read 拡張                            | [done] 完了   | players と同型                                                                                     |
| 5   | firestore.rules tournaments allow update に spectateEnabled ブランチ | [done] 完了 | `allow update, delete` を分割。update は organizer 経路 OR `affectedKeys + is bool` 経路 B          |
| 6   | scripts/test-rules-spectate.mjs 作成                              | [done] 完了   | 14 ケース全 pass。rule 分割の delete 回帰 (case 14) を追加                                          |
| 7   | package.json に test:rules-spectate 追加                          | [done] 完了   | アルファベット順で table-labels の前に挿入                                                          |
| 8   | error-logging.md に spectate/* prefix 追加                        | [done] 完了   |                                                                                                    |
| 9   | firebase-patterns.md 更新                                         | [done] 完了   | subcollection 表に spectate 行追加 + tournaments doc 自体の Phase 1 拡張を明記                      |
| 10  | group-membership.md 更新                                          | [done] 完了   | 権限マトリクス 2 行追加 + Phase 1 小節（observable scope = tournament 単位）追加                     |

## Validation Results

| Level                     | Status      | Notes                                            |
| ------------------------- | ----------- | ------------------------------------------------ |
| Static Analysis (typecheck) | [done] Pass | 0 errors                                         |
| Lint (next lint)          | [done] Pass | 0 warnings/errors                                |
| Unit Tests (vitest)       | [done] Pass | 1213/1213（70 files）                            |
| Build (next build)        | [done] Pass | static / dynamic 両 route 通過                   |
| Emulator: test:rules-spectate | [done] Pass | 14/14                                          |
| Emulator: test:rules-limits   | [done] Pass | 14/14（drift check）                            |
| Emulator: test:rules-clone-players | [done] Pass | 7/7                                       |
| Emulator: test:rules-season       | [done] Pass | 12/12                                      |
| Emulator: test:rules-season-points-rule | [done] Pass | 11/11                                |
| Emulator: test:rules-table-labels | [done] Pass | 16/16                                      |

## Files Changed

| File                                                                         | Action  | Notes                                                                       |
| ---------------------------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `src/lib/firebase/schemas/tournament.ts`                                     | UPDATE  | `spectateEnabled: z.boolean().default(false)` を `tournamentBodySchema` に追加 |
| `src/lib/firebase/repositories/tournaments.ts`                               | UPDATE  | `createTournament` の addDoc payload に `spectateEnabled: false` 明示       |
| `firestore.rules`                                                            | UPDATE  | tournaments 3 経路の read 拡張 + update 分岐 OR + delete 分割              |
| `scripts/test-rules-spectate.mjs`                                            | CREATE  | 14 ケース validator                                                         |
| `package.json`                                                               | UPDATE  | `test:rules-spectate` script 追加                                           |
| `.claude/rules/error-logging.md`                                             | UPDATE  | `spectate/*` prefix 追加                                                    |
| `.claude/rules/firebase-patterns.md`                                         | UPDATE  | subcollection rule 表に Phase 1 行追加                                      |
| `.claude/rules/group-membership.md`                                          | UPDATE  | 権限マトリクス 2 行追加 + Phase 1 小節                                       |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md`                 | UPDATE  | Phase 1 を `in-progress` → `complete` に遷移、report link 追加              |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`                        | UPDATE  | fixture に `spectateEnabled: false` を追加                                  |
| `src/components/tournament/AverageStackCard.test.tsx`                        | UPDATE  | 同上                                                                         |
| `src/components/tournament/NextBreakCard.test.tsx`                           | UPDATE  | 同上                                                                         |
| `src/components/tournament/StructureSnapshotCard.test.tsx`                   | UPDATE  | 同上                                                                         |
| `src/components/tournament/TimerDisplay.test.tsx`                            | UPDATE  | 同上                                                                         |
| `src/components/tournament/_timer-controls/TimerControlsRunningPaused.test.tsx` | UPDATE | 同上                                                                         |
| `src/lib/firebase/repositories/tournaments.test.ts`                          | UPDATE  | 同上                                                                         |
| `src/lib/firebase/tx-helpers.test.ts`                                        | UPDATE  | 同上                                                                         |
| `src/lib/hooks/useAudioPlayer.test.tsx`                                      | UPDATE  | 同上                                                                         |
| `src/lib/hooks/useSeatingAutoOrchestrator.test.ts`                           | UPDATE  | 同上                                                                         |
| `src/lib/services/receipt.test.ts`                                           | UPDATE  | 同上                                                                         |
| `src/lib/services/seating/orchestrator.test.ts`                              | UPDATE  | 同上                                                                         |
| `src/lib/services/timer.test.ts`                                             | UPDATE  | 同上                                                                         |
| `src/lib/services/tournament-state.test.ts`                                  | UPDATE  | 同上                                                                         |

## Deviations from Plan

### 想定外: 既存 test fixture 14 件への `spectateEnabled: false` 注入

- **WHAT**: plan は「schema additive のみで logic を露出しないため Unit Tests への追加は不要」と書いていたが、実際は zod schema の `_output` 型推論により `TournamentDoc` の `spectateEnabled` が **non-optional `boolean`** として TS に伝播し、既存 fixture（object literal で `TournamentDoc` を構築するもの）が型エラーになった
- **WHY**: zod の `.default(value)` は **input optional / output required** のセマンティクス。`fromFirestore` で legacy doc を hydrate する際は default が適用されるため runtime 動作は plan の想定どおりだが、型上は output で必須となり、TS 型エラーが出る
- **対応**: 全 fixture（14 ファイル）と `createTournament` の addDoc payload に `spectateEnabled: false` を明示追加。fixture factory の "additive 互換" 原則は satisfied（`...overrides` 前に default 値を挟むだけ）

### 想定外（軽微）: case 12 の検証期待値

- plan 段階で「rule 動作を実装時に確認してケース文言を調整」と明記済み
- 実機で確認した結果、想定どおり経路 A（broad organizer update）が non-bool でも 200 を返すため、`expectAllow` で記述。schema 側 zod が最終ライン防御という想定どおりの結論

## Issues Encountered

なし。typecheck で fixture の連鎖修正が必要になった以外は、plan のサンプルコードをそのまま適用して動作。

## Tests Written

| Test File                            | Tests   | Coverage                                                              |
| ------------------------------------ | ------- | --------------------------------------------------------------------- |
| `scripts/test-rules-spectate.mjs`    | 14      | unauthenticated read allow / deny / legacy doc / signed-in regression / write 経路据え置き / delete 回帰 |

Phase 1 はユニットテストの追加は不要（schema additive のみで logic を露出しないため）。`/spectate/[tid]` ロジック / `setSpectateEnabled` service のテストは Phase 2 / 3 で追加。

## Code Review 反映（2026-05-09 ローカルレビュー後の追加修正）

レビュー記録: [.claude/PRPs/04-spectate-mode/reviews/local-phase-1-review.md](../reviews/local-phase-1-review.md)

### MEDIUM 対応済み

- **`tournaments/{tid}` `allow read` を `allow get` + `allow list` に分割** — `allow read` 複合形のままだと anon が
  `where("spectateEnabled", "==", true)` で公開中の全 tournament を列挙できる discovery 経路が成立するため、
  `groupJoinCodes` と同方針（`allow get` open + `allow list: if isSignedIn()`）で defense-in-depth を入れた。
- emulator validator に 2 ケース追加 (15, 16): anon list deny / signed-in member list allow。
- `firebase-patterns.md` の Phase 1 セクションも分割を反映。

### LOW（次 Phase TODO に積む）

Phase 2 / 3 / 4 着手者は plan 着手前に下記を消化すること:

- [ ] **`tournaments/{tid}` `allow update` 経路 B が経路 A に完全包含されている件の TODO**
  emulator validator case 12 が「organizer non-bool が経路 A 経由で allow になる」を `expectAllow` で記録している。
  将来 Phase で経路 A を狭めるとき、case 12 を `expectDeny` に変える修正と `is bool` 検証の再評価が必要。
- [ ] **emulator validator に owner-delete ケースを追加**（現状は organizer-delete のみ）。
  `ownerUids ⊆ organizerUids` 前提で暗黙に pass するが、明示確認として 1 ケース追加（case 17 想定）。
- [ ] **`firebase-patterns.md` の rule read コスト節に観戦経路を 1 行追記**。
  `/spectate/[tid]` の `subscribePlayers(tid)` listen で各 player rule 評価が `exists() + get()` を発火する。
  20 人月 1〜2 回スケールでは無視可だが、次 Phase 実装者の認知負荷削減。

## Next Steps

- [ ] **`firebase deploy --only firestore:rules`** — emulator green でも本番未 deploy で permission-denied する罠（メモリ規約）。Phase 2 / 3 が rule に依存する前に必ず実行
- [ ] Create PR via `/prp-pr`
- [ ] Phase 2（`/spectate/[tid]` Read-only Page）と Phase 3（Toggle UI + 共有導線）と Phase 4（PWA Cache Allowlist）は独立着手可能（plan 「NOT Building」セクション参照）
