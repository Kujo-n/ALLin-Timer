# Architect Refactor Report — 20260510 (2 サイクル目)

## Scope

直近 architect-refactor サイクル（同日 1 サイクル目）の見送り finding-7 の解消 + 未踏領域の二レンズ新規監査。結論として **実効的な refactor target は finding-7 のみ**で、新規監査領域は false positive / 既知制約 / 軽微 edge case のため不採用。

- 作業 branch: `refactor/post-spectate-followup-20260510`
- ベース commit: develop tip（直前サイクル `796add8` を継承した状態）
- 動作変更ポリシー: セキュリティ / バグ修正は許容

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 0 件
- low: 1 件（finding-7、前サイクル見送りから今回適用）
- 詳細監査結果: [reviews/architect-refactor-20260510-2.md](../reviews/architect-refactor-20260510-2.md)

新規監査領域で agent が挙げた 5 件はすべて不採用（検証で false positive / 既知制約 / 軽微 edge case と判明）。

## 実施した変更

| commit | サマリ | 影響範囲 | 関連 finding |
| --- | --- | --- | --- |
| `d47a9ea` | `assertNonEmptyString` helper 追加 + `setSpectateEnabled` に適用 + characterization test 追加 | 3 files / +97 -2 | 前サイクル #7 |

合計: 1 commit / 3 files / +97 -2 行（plan + review + report 除く）。

### 設計上の判断ポイント

- **fail-fast 防御の明示化**: empty/whitespace `tid` / `uid` を渡すと、Firebase SDK の `getDoc(doc(ref, ""))` が `invalid-argument` で fail し、wrap helper 経由で `firestore/...` に倒れていた。新 helper で `validation/empty-string` に倒すことで、SDK 直叩き / 開発時 typo / future caller の防御として明示的になる。
- **適用範囲を狭く**: ユーザーが「finding-7 だけ今回適用して閉じる」と明示したため、`setSpectateEnabled` 1 callsite のみに適用。他の service 関数（`setFinishedTournamentCount` / `setDefaultSeatsPerTable` / `consumeJoinCode` / `leaveGroup` 等）への展開は次回以降の独立 refactor として保留。
- **test 追加の判断**: 純粋な refactor（既存の characterization test が安全網）だが、新規 helper の振る舞いは既存テストでカバーされないため、`errors.test.ts` に 5 ケース（pass / empty / whitespace / non-string / paramName）+ 既存 `formatErrorForDisplay` の 2 ケースを追加（unit 1267 → 1274）。

## 見送った提案（理由付き）

監査 agent が挙げた 5 件のうち、検証で不採用と判定:

| 案 | エージェント主張 | 検証で判明した実態 |
| --- | --- | --- |
| memberDisplayNames whitespace 防御 | rule が trim 強制しない | service 層で trim 済、攻撃経路は organizer 信頼ロール限定。実害なし |
| finishedTournamentCount race | tx 内再 read なし | **誤り**。`tournaments.ts:752-756` に tx 内 state guard あり、CLAUDE.md 記載通り防御済み |
| isPlayingDealer 唯一性 rule 検証 | rule で同卓唯一性検証なし | **既知の設計制約**。CLAUDE.md `firebase-patterns.md` で documented。Cloud Functions 化が将来課題 |
| clonePlayersFromTournament displayName 検証 | converter 抜けで empty 通る | converter 経由 (`playersRef`) で `min(1)` 強制済、whitespace edge case のみ |
| consumeJoinCode displayName fallback | comment と動作の齟齬 | fallback chain 自体は意図通り、comment-level のみ |

### 教訓: 累積整理済み codebase の監査

5 サイクル累積で cross-cutting な負債は徹底整理済み。新規領域監査エージェントを回しても **5 件中 4 件が false positive / 既知制約の再掲**だった。次回以降は:

1. 前サイクル見送り findings の再評価
2. PRD ベースの新規 work-stream 終了直後の局所監査

に集中するのが効率的（agent による広域監査は ROI が下がる）。

## 追加したテスト

- `src/lib/errors.test.ts` に 7 ケース追加:
  - `assertNonEmptyString`: pass / empty / whitespace / non-string / paramName 反映 の 5 ケース
  - `formatErrorForDisplay`: AppError / FirebaseError-like の characterization 2 ケース

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass | pass |
| unit test | 1267 pass / 0 fail | 1274 pass / 0 fail (+7 cases) |
| build | pass | pass |
| e2e test | 90 pass / 3 skip / 0 fail (前サイクル 7.3 min 計測) | 90 pass / 3 skip / 0 fail (8.1 min) |

## 観測可能な動作変更が無いことの根拠

- 唯一の変更点: `setSpectateEnabled` に empty/whitespace `tid` / `uid` を渡した場合の error code が `firestore/not-found` → `validation/empty-string` に変わる
- 通常経路（UI / unit test / E2E）はすべて非空の値を渡すため observable 変化なし
- E2E 90 pass で regression なしを確認

## 本番 deploy が必要な変更

なし（`firestore.rules` 変更なし、コード変更のみ）。

## 残課題 / Next Step

- `assertNonEmptyString` の他 service 関数への展開は別サイクルで検討（`setFinishedTournamentCount` / `setDefaultSeatsPerTable` / `consumeJoinCode` / `leaveGroup` / `cancelOwnEntry` 等）
- 直近 5 サイクルで cross-cutting な負債は整理済み。次回 architect-refactor は **新規 PRD（05+）の terminal phase が安定した後** に実施するのが効率的

## 関連リンク

- 監査結果: [reviews/architect-refactor-20260510-2.md](../reviews/architect-refactor-20260510-2.md)
- 計画: [plans/completed/architect-refactor-20260510-2.plan.md](../plans/completed/architect-refactor-20260510-2.plan.md)
- 前サイクル report: [reports/architect-refactor-20260510.md](architect-refactor-20260510.md)
- 直近の architect-refactor 履歴:
  - 20260430（01-allin-timer）
  - 20260506（01-allin-timer）
  - 20260507（02-season-stats-and-share）
  - 20260509（03-pwa-app-shell）
  - 20260510（04-spectate-mode、1 サイクル目）
  - **20260510-2（04-spectate-mode、2 サイクル目 / 本レポート）**
