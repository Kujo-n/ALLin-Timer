# Implementation Report: Phase 4.14 — トーナメント受付画面 + サイドバー UX 改善

## Summary

トーナメント dashboard の状態遷移時の grid 跳ね、サウンドトグルのリアクティブ反映漏れ、終了済みトーナメントの削除導線、別画面遷移型の全画面化を改善し、サイドバー label を rename して開催中トーナメントのサブナビを追加した。Firestore schema / rules には変更を加えていない。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                                           |
| ------------- | ---------------- | ------------------------------------------------ |
| Complexity    | Medium           | Medium                                           |
| Confidence    | 8/10             | 8/10（plan で予見されたとおり、E2E selector の連鎖更新が最大コスト） |
| Files Changed | 9                | 13（カード unit test 3 本と E2E 補修分が plan の見積を超過）           |

## Tasks Completed

| #   | Task                                                                | Status    | Notes                                                                           |
| --- | ------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------- |
| 1   | 受付画面の右列を恒常化（1-1）                                       | Complete  | `showRightColumn` 撤去、`gridColsClass` を 3 列固定。NextBreakCard に setup プレビュー追加 |
| 2   | サウンドトグルのリアクティブ反映（1-2）                             | Complete  | `useCurrentGroup().refreshGroups` を toggle 成功後に await                      |
| 3   | 終了済みトーナメントの削除導線（1-3）                               | Complete  | `deleteTournamentIfSetup` → `deleteTournament` に rename + batch sub-collection 削除 |
| 4   | 「一覧へ戻る」ボタン削除（1-4）                                     | Complete  | サイドバー「トーナメント一覧」で代替                                            |
| 5   | トーナメント名横の state バッジ削除（1-6）                          | Complete  | TimerDisplay 内の日本語ラベル（開始前 / 進行中 / 一時停止中 / 終了）が真実源 |
| 6   | Fullscreen API トグル（1-7）                                        | Complete  | `requestFullscreen` / `exitFullscreen` + `fullscreenchange` 購読                |
| 7   | サイドバー label rename（2-1）                                      | Complete  | サークル → サークル一覧、トーナメント → トーナメント一覧                        |
| 8   | サイドバー「トーナメント一覧」配下に開催中サブナビ追加（2-2）       | Complete  | `subscribeTournamentsByGroup` 新設、`seating/running/paused` を realtime 表示   |
| 9   | E2E テスト追従（2-1 / 2-2 + state バッジ削除追従）                  | Complete  | Page object の stateBadge selector を TimerDisplay 内日本語ラベルに repoint    |

## Validation Results

| Level           | Status | Notes                                                                                  |
| --------------- | ------ | -------------------------------------------------------------------------------------- |
| Static Analysis | Pass   | `npm run typecheck` / `npm run lint` ともに 0 errors                                  |
| Unit Tests      | Pass   | 483 tests / 29 files。新規 `deleteTournament` 5 ケース + `subscribeTournamentsByGroup` 3 ケース |
| Build           | Pass   | `npm run build`、Static / Dynamic ルート構成は不変                                    |
| Integration     | N/A    | E2E は emulator 必須のため本 report では実行しない（PR 時 CI で確認）                |
| Edge Cases      | Pass   | Plan 記載の 9 項目を unit test またはコードパスでカバー                                |

## Files Changed

| File                                                          | Action  | Lines     |
| ------------------------------------------------------------- | ------- | --------- |
| `src/app/tournaments/[tid]/dashboard-client.tsx`              | UPDATE  | +66 / -33 |
| `src/app/tournaments/[tid]/live/live-client.tsx`              | UPDATE  | +1 / -1   |
| `src/components/tournament/NextBreakCard.tsx`                 | UPDATE  | +50 / -8  |
| `src/components/tournament/AverageStackCard.tsx`              | UPDATE  | +6 / -8   |
| `src/components/tournament/PlayersCard.tsx`                   | UPDATE  | +5 / -10  |
| `src/components/nav/nav-items.ts`                             | UPDATE  | +2 / -2   |
| `src/components/nav/PrimaryNav.tsx`                           | UPDATE  | +95 / -8  |
| `src/lib/firebase/repositories/tournaments.ts`                | UPDATE  | +63 / -16 |
| `src/lib/firebase/repositories/tournaments.test.ts`           | UPDATE  | +124 / -22 |
| `src/components/tournament/PlayersCard.test.tsx`              | UPDATE  | +14 / -56 |
| `src/components/tournament/AverageStackCard.test.tsx`         | UPDATE  | +18 / -14 |
| `src/components/tournament/NextBreakCard.test.tsx`            | UPDATE  | +44 / -12 |
| `tests/e2e/pages/TournamentsPage.ts`                          | UPDATE  | +6 / -2   |
| `tests/e2e/nav-and-sound-toggle.spec.ts`                      | UPDATE  | +49 / -10 |
| `tests/e2e/audio-settings.spec.ts`                            | UPDATE  | +2 / -2   |
| `tests/e2e/timer-control-polish.spec.ts`                      | UPDATE  | +6 / -6   |
| `tests/e2e/winner-banner-and-auto-finish.spec.ts`             | UPDATE  | +4 / -4   |

## Deviations from Plan

| What                                                                                    | Why                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `PlayersCard` の Props から `tournament` を完全削除（plan は「使わなければ未使用警告で OK」を想定） | TS strict + 既存 props 仕様を残すと dashboard / live / 既存 unit test の callsite すべてに dead-prop が残り混乱の元になる。一方 `AverageStackCard` は `isBeforeStart` 判定で `tournament.state` を使うため interface 維持。`NextBreakCard` は `tournament.structureSnapshot.levels` を引き続き使うため interface 維持。 |
| state バッジ削除に伴い `TournamentsPage.stateBadge` selector を TimerDisplay 内の日本語ラベルへ repoint | plan は `nav-and-sound-toggle.spec.ts` のみ追従を明記していたが、`audio-settings` / `timer-control-polish` / `winner-banner-and-auto-finish` の 4 spec が `dash.stateBadge` を介して旧 raw badge を参照していた（plan の「Risks: nav E2E spec の漏れ追従で CI red」に該当）。一括で日本語ラベル（進行中 / 一時停止中 / 終了）に置換した。 |

## Issues Encountered

| Problem                                                                                            | Resolution                                                                                                                                              |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| state バッジ削除で 5 spec / page object 1 が連鎖破損（plan task 9 のみで足りない）                  | page object の selector を `region[name=タイマー]` 内の `/^(開始前\|進行中\|一時停止中\|終了)$/` に repoint し、各 spec の expect を日本語ラベルに置換          |
| `PlayersCard` プロップ簡略化に伴い `live-client.tsx` 1 callsite と既存 unit test の 7 ケースを修正 | `tournament` prop を削除した上で setup/seating の「描画されない」テストを「描画される」テストに更新（Phase 4.14 の挙動を反映）                                |

## Tests Written

| Test File                                                  | Tests added/updated | Coverage                                                                                |
| ---------------------------------------------------------- | ------------------- | --------------------------------------------------------------------------------------- |
| `src/lib/firebase/repositories/tournaments.test.ts`        | +5 / -4 in describe | `deleteTournament` × 5（permission / in-progress / setup empty / finished cascade / batch error）+ `subscribeTournamentsByGroup` × 3 |
| `src/components/tournament/PlayersCard.test.tsx`           | rewritten           | tournament prop 削除、setup/seating 描画ケース追加                                      |
| `src/components/tournament/AverageStackCard.test.tsx`      | +2 / -2             | setup / seating で「受付中」キャプション、平均 = initialStack を検証                    |
| `src/components/tournament/NextBreakCard.test.tsx`         | +3 / -2             | setup プレビュー（— + Lv N）、seating プレビュー、no-break 構造の予定なし表示          |
| `tests/e2e/nav-and-sound-toggle.spec.ts`                   | +1 describe         | サブナビ表示 + クリック遷移 + aria-current=page                                        |

## Next Steps

- [ ] E2E スイートを emulator 上で実行（`npm run test:e2e`）
- [ ] PR 作成時に PRD `Implementation Phases` 表へ Phase 4.14 を追記
- [ ] `/code-review` でレビュー
- [ ] `/prp-pr` で PR 化
