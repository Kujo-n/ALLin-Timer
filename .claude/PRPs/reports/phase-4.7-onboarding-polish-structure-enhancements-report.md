# Implementation Report: Phase 4.7 — Onboarding Polish & Structure Enhancements

## Summary

Phase 5 ドライラン直前の 7 件の UX / 機能ペインを一括解消した。Google 新規ログインの displayName 設定ダイアログ、匿名参加後のヘッダ表示即反映（AuthProvider.refreshUser）、リバイ／アドオン スタック量フィールド、平均スタックカード、ブレイクレベル（`Level.isBreak`）、サークルメンバー displayName snapshot（`groups/{gid}.memberDisplayNames`）、`/tournaments` 一覧の状態別カード色分けを実装。schema は全て additive（zod `.default()` / `.nullable()`）で旧 doc は自動受容。Firestore Rules は groups update に self-key `memberDisplayNames` 書込条件を追加するのみ。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual        |
| ------------- | ---------------- | ------------- |
| Complexity    | Medium-Large     | Medium-Large  |
| Confidence    | -                | High          |
| Files Changed | 約 20           | 24           |

## Tasks Completed

| #   | Task                                              | Status       | Notes                                                                   |
| --- | ------------------------------------------------- | ------------ | ----------------------------------------------------------------------- |
| 1   | zod schema additive                                | done Complete |                                                                         |
| 2   | createStructure repository 正規化                   | done Complete |                                                                         |
| 3   | StructureForm に rebuy/addon 入力                  | done Complete |                                                                         |
| 4   | LevelTable に isBreak チェックボックス            | done Complete |                                                                         |
| 5   | TimerDisplay BREAK 表示                            | done Complete |                                                                         |
| 6   | AverageStackCard コンポーネント                     | done Complete |                                                                         |
| 7   | dashboard / live に AverageStackCard 差込          | done Complete |                                                                         |
| 8   | AuthProvider.refreshUser（useReducer bump）        | done Complete |                                                                         |
| 9   | refreshUser 呼出側（join / settings / login）      | done Complete |                                                                         |
| 10  | signInWithGoogle に isNewUser 付き戻り値            | done Complete | Deviated — plan の upsert 条件が逆だったため未 upsert に修正            |
| 11  | receipt.ts joinViaGoogle 戻り値対応                | done Complete |                                                                         |
| 12  | DisplayNameDialog + login-client 発火              | done Complete |                                                                         |
| 13  | structure-edit-client に rebuy/addOn initial       | done Complete |                                                                         |
| 14  | Tests (schema / TimerDisplay / AverageStackCard)   | done Complete | 新規 13 assertions（schema 4 + Level 4 + TimerDisplay 2 + AverageStackCard 7） |
| 14b | group.memberDisplayNames schema + repo + service   | done Complete | createGroup に ownerDisplayName 追加、removeMemberSelf で deleteField、setMemberDisplayName 新規、propagateDisplayNameToGroups 新規 |
| 14c | Firestore Rules memberDisplayNames 条件追加        | done Complete | self-add / self-leave / 新規 self-key update の 3 経路に diff().affectedKeys().hasOnly() を追加 |
| 14d | group-detail-client UI 切替                        | done Complete | getUserProfile loop を廃止し memberDisplayNames 参照に変更              |
| 14e | tournaments-client 状態別カード色分け              | done Complete | toneForState() + border + badge + opacity + 日本語ラベル                |
| 15  | PRD 更新                                           | done Complete |                                                                         |
| 16  | 最終 validation                                    | done Complete |                                                                         |

## Validation Results

| Level           | Status      | Notes                                 |
| --------------- | ----------- | ------------------------------------- |
| Static Analysis | done Pass   | `npm run typecheck` — zero errors     |
| Lint            | done Pass   | `npm run lint` — No warnings          |
| Unit Tests      | done Pass   | `npm test -- --run` — 338 tests pass  |
| Build           | done Pass   | `npm run build` — all pages generated |
| Integration     | N/A         | E2E は scope 外（Phase 5 ドライランで検証） |
| Edge Cases      | done Pass   | 旧 doc の default 受容、break level、平均スタック 0 人時 |

## Files Changed

| File                                                                 | Action  |
| -------------------------------------------------------------------- | ------- |
| `src/lib/firebase/schemas/structure.ts`                              | UPDATE  |
| `src/lib/firebase/schemas/tournament.ts`                             | UPDATE  |
| `src/lib/firebase/schemas/group.ts`                                  | UPDATE  |
| `src/lib/firebase/schemas/index.test.ts`                             | UPDATE  |
| `src/lib/firebase/repositories/structures.ts`                        | UPDATE  |
| `src/lib/firebase/repositories/groups.ts`                            | UPDATE  |
| `src/lib/firebase/repositories/tournaments.test.ts`                  | UPDATE  |
| `src/lib/firebase/AuthProvider.tsx`                                  | UPDATE  |
| `src/lib/services/auth-actions.ts`                                   | UPDATE  |
| `src/lib/services/auth-actions.test.ts`                              | UPDATE  |
| `src/lib/services/group.ts`                                          | UPDATE  |
| `src/lib/services/group.test.ts`                                     | UPDATE  |
| `src/lib/services/receipt.ts`                                        | UPDATE  |
| `src/lib/services/receipt.test.ts`                                   | UPDATE  |
| `src/lib/services/timer.test.ts`                                     | UPDATE  |
| `src/lib/hooks/useSeatingAutoOrchestrator.test.ts`                   | UPDATE  |
| `src/lib/services/seating/orchestrator.test.ts`                      | UPDATE  |
| `src/components/structure/StructureForm.tsx`                         | UPDATE  |
| `src/components/structure/LevelTable.tsx`                            | UPDATE  |
| `src/components/tournament/TimerDisplay.tsx`                         | UPDATE  |
| `src/components/tournament/TimerDisplay.test.tsx`                    | UPDATE  |
| `src/components/tournament/TournamentForm.tsx`                       | UPDATE  |
| `src/components/tournament/AverageStackCard.tsx`                     | CREATE  |
| `src/components/tournament/AverageStackCard.test.tsx`                | CREATE  |
| `src/components/auth/DisplayNameDialog.tsx`                          | CREATE  |
| `src/app/login/login-client.tsx`                                     | UPDATE  |
| `src/app/join/[tid]/join-client.tsx`                                 | UPDATE  |
| `src/app/join/[tid]/*.test.tsx`                                      | UPDATE (test mock) |
| `src/app/settings/settings-client.tsx`                               | UPDATE  |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx`            | UPDATE  |
| `src/app/groups/[gid]/group-detail-client.tsx`                       | UPDATE  |
| `src/app/tournaments/tournaments-client.tsx`                         | UPDATE  |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                     | UPDATE  |
| `src/app/tournaments/[tid]/live/live-client.tsx`                     | UPDATE  |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`                | UPDATE  |
| `firestore.rules`                                                    | UPDATE  |
| `.claude/PRPs/prds/allin-timer.prd.md`                               | UPDATE  |

## Deviations from Plan

- **Task 10 (signInWithGoogle)**: 計画書 IMPLEMENT には `if (!isNewUser && cred.user.displayName)` で upsert する記述があったが、Notes セクションでは「既存ユーザーの displayName 上書きをやめる」としており矛盾していた。Notes の意図を採用して **新規・既存いずれの場合も upsertUserProfile を呼ばない**形に修正。既存ユーザーの `users/{uid}` 保護を優先し、新規ユーザーは DisplayNameDialog 経由で `updateDisplayName` が users/{uid} を作成する flow に統一。
- **Task 14b (`createGroupWithOwner`)**: 計画書には明記されていなかったが、`createGroup` repository に `ownerDisplayName` を渡してオーナー自身の `memberDisplayNames` entry を初期登録する形を追加（サークル作成直後からオーナー名が正しく表示されるため）。
- **Task 16b (README / security.md 追記)**: 計画書には独立タスクとして記述されていたが、propagate は best-effort であり旧 doc も自動 backfill される設計のため、dry-run 前の追記は Phase 5 実施時のチェックリスト化で十分と判断し本 Phase では見送り（deferred）。

## Issues Encountered

- **zod v4 の levelSchema 拡張で既存 Level 構築箇所が型エラー**: `isBreak` を `default(false)` で追加したが TypeScript の infer 型では required。既存のテスト helper とプロダクションコードで Level を直書きしている 9 箇所を `isBreak: false` 明示に修正（Task 1 の fix-up として）。
- **auth-actions.test.ts が services/group を読み込めずモジュール副作用で fail**: `updateDisplayName` が `propagateDisplayNameToGroups` を呼ぶため `services/group.ts` → `repositories/groups.ts` → `collection(firestore)` のチェーンが test でクラッシュ。`vi.mock("@/lib/services/group", ...)` で空実装をモックして解消。
- **`groupBodySchema` 型変更で `GroupBody` / `GroupDoc` を使う test 2 箇所が fail**: `memberDisplayNames: {}` を追加して解消。

## Tests Written

| Test File                                             | Tests added | Coverage                                                      |
| ----------------------------------------------------- | ----------- | ------------------------------------------------------------- |
| `src/lib/firebase/schemas/index.test.ts`              | 8 new       | structureBodySchema の rebuy/addOn default/positive、levelSchema の isBreak default/break level/play level/refine |
| `src/components/tournament/TimerDisplay.test.tsx`     | 2 new       | BREAK 表示（current / next）                                  |
| `src/components/tournament/AverageStackCard.test.tsx` | 7           | 全 state 別・0 人時非表示・標準計算                             |

合計 17 件の新規 assertion、既存 tests 含めて 338 passed / 0 failed。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] **本番 Firestore に rule 適用**: `firebase deploy --only firestore:rules`（memberDisplayNames の self-key update rule）
- [ ] Phase 5 ドライラン前チェックリスト: 運営 3 人が各自 `/settings` で displayName 保存 → `memberDisplayNames` backfill 確認
- [ ] Phase 4.8（Structure Template Library）着手 — `/prp-implement .claude/PRPs/plans/phase-4.8-structure-template-library.plan.md`
