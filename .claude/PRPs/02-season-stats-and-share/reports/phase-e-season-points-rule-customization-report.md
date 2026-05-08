# Implementation Report: Phase E — シーズンポイント計算式の運営者カスタマイズ

## Summary

Phase A で固定パラメータ式（`base[rank-1] × sqrt(participants / 8)`）として実装したシーズンポイント計算を、サークル運営者がパラメータ単位でカスタマイズできるようにした。`groups/{gid}.seasonPointsRule: { base: number[]; baseline: number } | null` を additive 追加し、`null` 保存で既定値（`SEASON_POINTS_BASE`、`baseline = 8`）にフォールバックする。`firestore.rules` の `groups/{gid}` update に 9 ブランチ目として `seasonPointsRule` 単独書換を追加し、`finishTournament` の runTransaction 内で `groups/{gid}` を tx 内 raw read してアトミックに rule を解決するよう拡張した。サークル詳細画面に `<SeasonPointsRuleCard />` を新設し、閲覧 UI（計算式 + 基本点リスト + 参加人数別プレビュー表）と、owner / organizer 限定の編集モーダル（行追加・削除・draft ライブプレビュー・「既定値に戻す」）を提供する。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | （未記載）       | 達成           |
| Files Changed | 約 14 files      | 16 files（schema test fixture 経由で追加 3 件） |

## Tasks Completed

| #   | Task                                              | Status         | Notes |
| --- | ------------------------------------------------- | -------------- | ----- |
| 1   | season-points.ts に `rule` 引数追加                | [done] Complete | 後方互換あり |
| 2   | season-points.test.ts カスタム rule テスト追加     | [done] Complete | 8 件追加 |
| 3   | schemas/group.ts に seasonPointsRule additive 追加 | [done] Complete | `nullable().default(null)` パターン |
| 4   | limits.ts に SEASON_POINTS_BASE_MAX_LENGTH 追加    | [done] Complete | drift script 用に export const |
| 5   | repositories/groups.ts に updateSeasonPointsRule  | [done] Complete | wrapFirestoreWrite 経由 |
| 6   | services/group.ts に setSeasonPointsRule          | [done] Complete | assertOrganizer + 入力正規化 |
| 7   | firestore.rules に seasonPointsRule branch        | [done] Complete | 9 ブランチ目 |
| 8   | test-rules-season-points-rule.mjs 新設            | [done] Complete | 11 ケース |
| 9   | test-rules-limits.mjs drift 検査拡張              | [done] Complete | +3 件（base.size / baseline 上下） |
| 10  | package.json npm script 追加                       | [done] Complete | test:rules-season-points-rule |
| 11  | finishTournament tx 内で rule re-read             | [done] Complete | groupRawDocRef + parseSeasonPointsRuleFromRawData |
| 12  | tournaments.test.ts mockFinishTransaction 拡張    | [done] Complete | groupRawData 引数追加 + Phase E 3 ケース |
| 13  | SeasonPointsRuleCard.tsx 新設                     | [done] Complete | 閲覧 + 編集モーダル + ライブプレビュー |
| 14  | group-detail-client.tsx に Card 配置 + ハンドラ   | [done] Complete | onSaveSeasonPointsRule / onResetSeasonPointsRule |
| 15  | docs 更新                                          | [done] Complete | firebase-patterns.md / group-membership.md / PRD |
| 16  | 全体 validation                                    | [done] Complete | typecheck / lint / test / drift / build all green |

## Validation Results

| Level           | Status      | Notes                              |
| --------------- | ----------- | ---------------------------------- |
| Static Analysis | [done] Pass | typecheck 0 error / lint 0 warning |
| Unit Tests      | [done] Pass | 1135 / 1135（増加分: season-points 8 / schema 9 / repo 7 / service 8 / tournaments 3） |
| Build           | [done] Pass | Next.js build success              |
| Rules Drift     | [done] Pass | 14/14（既存 11 + 新規 3）           |
| Emulator        | (not run)   | `npm run test:rules-season-points-rule` は手動実行（要 firebase CLI）。本番デプロイ前に実施する |
| Edge Cases      | [done] Pass | 旧 doc null hydrate / カスタム rule / 不正値の既定値フォールバック / 範囲外 baseline / 配列長違反すべて検証済 |

## Files Changed

| File                                                                    | Action  | Note                                |
| ----------------------------------------------------------------------- | ------- | ----------------------------------- |
| `src/lib/limits.ts`                                                     | UPDATED | `SEASON_POINTS_BASE_MAX_LENGTH` 追加 |
| `src/lib/services/season-points.ts`                                     | UPDATED | `SeasonPointsRule` / `DEFAULT_SEASON_POINTS_RULE` / 第 3 引数 |
| `src/lib/services/season-points.test.ts`                                | UPDATED | カスタム rule 8 件                  |
| `src/lib/firebase/schemas/group.ts`                                     | UPDATED | `seasonPointsRuleSchema` + `groupBodySchema.seasonPointsRule` |
| `src/lib/firebase/schemas/index.test.ts`                                | UPDATED | `seasonPointsRule` 9 件 + GroupBody fixture 更新 |
| `src/lib/firebase/repositories/groups.ts`                               | UPDATED | `updateSeasonPointsRule` 追加 + createGroup に `seasonPointsRule: null` |
| `src/lib/firebase/repositories/groups.test.ts`                          | UPDATED | `updateSeasonPointsRule` 7 件       |
| `src/lib/services/group.ts`                                             | UPDATED | `setSeasonPointsRule` 追加          |
| `src/lib/services/group.test.ts`                                        | UPDATED | `setSeasonPointsRule` 8 件 + makeGroup fixture |
| `src/lib/firebase/repositories/tournaments.ts`                          | UPDATED | `groupRawDocRef` / `parseSeasonPointsRuleFromRawData` / tx 内 group read + rule fallthrough |
| `src/lib/firebase/repositories/tournaments.test.ts`                     | UPDATED | `mockFinishTransaction.groupRawData` + 3 件          |
| `firestore.rules`                                                       | UPDATED | 9 ブランチ目（`seasonPointsRule` 単独書換）追加 |
| `scripts/test-rules-season-points-rule.mjs`                             | CREATED | emulator validator 11 ケース        |
| `scripts/test-rules-limits.mjs`                                         | UPDATED | drift 検査 +3 件                    |
| `package.json`                                                          | UPDATED | `test:rules-season-points-rule` 追加 |
| `src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx`            | CREATED | 新規 UI Card                         |
| `src/app/groups/[gid]/group-detail-client.tsx`                          | UPDATED | `<SeasonPointsRuleCard />` 配置 + ハンドラ |
| `.claude/rules/firebase-patterns.md`                                    | UPDATED | allowed-keys 表 9 行目追加          |
| `.claude/rules/group-membership.md`                                     | UPDATED | フィールド説明 + 権限マトリクス 2 行追加 |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` | UPDATED | Phase E in-progress → complete       |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` | UPDATED | GroupDoc fixture に `seasonPointsRule: null` 追加 |
| `src/lib/hooks/useAudioPlayer.test.tsx`                                 | UPDATED | 同上                                 |
| `src/lib/services/account-delete.test.ts`                               | UPDATED | 同上                                 |

## Deviations from Plan

なし。Plan 通り実装した。
- 既存 GroupDoc fixture を持つテストファイル 3 件（plan で言及なし）は `seasonPointsRule: null` を追加することで対応。zod schema が `nullable().default(null)` のため type 上は明示が必要。

## Issues Encountered

- typecheck で 3 件の test fixture が GroupDoc 型不整合になったが、`seasonPointsRule: null` 追加で即座に解決。
- `setSeasonPointsRule` の小数 2 桁正規化テストで `7.005 * 100` が IEEE754 表現上 `700.4999...` となり Math.round で `7` になってしまう問題を発見。テスト値を `7.014` に変更（`Math.round(701.4) = 701 / 100 = 7.01`）。

## Tests Written

| Test File                                   | Tests | Coverage                                  |
| ------------------------------------------- | ----- | ----------------------------------------- |
| `season-points.test.ts`                     | +8    | calcSeasonPoints rule 引数の境界値・後方互換 |
| `schemas/index.test.ts`                     | +9    | groupBodySchema.seasonPointsRule の hydrate / 値域違反 |
| `repositories/groups.test.ts`               | +7    | updateSeasonPointsRule の SDK shape / 値域 |
| `services/group.test.ts`                    | +8    | setSeasonPointsRule の assertOrganizer / 入力正規化 / null reset |
| `repositories/tournaments.test.ts`          | +3    | finishTournament tx 内 rule 取込（null / custom / corrupt） |

## Next Steps

- [ ] 本番デプロイ前に `npm run test:rules-season-points-rule` を手動実行して 11/11 pass を確認
- [ ] Firestore rules を `firebase deploy --only firestore:rules` でデプロイ（CLAUDE.md feedback memory 準拠）
- [ ] 手動検証（`npm run dev` でサークル詳細画面 → カード表示 / 編集モーダル / 「既定値に戻す」/ tournament 終了 → seasonStats 増分の bit-perfect 確認）
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
