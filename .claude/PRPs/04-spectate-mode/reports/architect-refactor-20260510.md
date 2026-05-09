# Architect Refactor Report — 20260510

## Scope

04-spectate-mode 周辺＋全体横断（src/ 全層）。直近完了した PRD 04-spectate-mode の Phase 1〜4 の累積負債を中心に、二レンズ（Senior Web Architect / Security Specialist）で監査し抽出した findings を atomic タスクに分解して段階実行。

- 作業ブランチ: `refactor/spectate-and-global-20260510`
- ベース commit: `575805e`（develop tip）
- 動作変更ポリシー: セキュリティ / バグ修正は許容（観測可能な動作変更は 0）

## Findings 概要

- critical: 0 件
- high: 1 件（finding-1: `tournament.state` 直接比較が 25+ 箇所に残存）
- medium: 3 件（finding-2 / finding-3 / finding-5）
- low: 2 件（finding-4 / finding-6）
- informational: 2 件（finding-7 / finding-8 / finding-9）
- 詳細監査結果: [`.claude/PRPs/04-spectate-mode/reviews/architect-refactor-20260510.md`](../reviews/architect-refactor-20260510.md)

## 実施した変更

PRD 進捗表の流れで適用。各 commit は単一の atomic な変更で typecheck / lint / unit が green。

| commit | サマリ | 影響範囲 | 関連 finding |
| --- | --- | --- | --- |
| `55d9d47` | `assertOwner` / `assertOrganizer` を `schemas/group.ts` に集約 | 3 files / +28 -16 | #3 |
| `c6a156a` | `timer.ts` / `receipt.ts` の state 直接比較を helper 化 | 2 files / +17 -18 | #1 |
| `37469e8` | `TimerDisplay` / `TimerControls` の state 直接比較を helper 化 | 2 files / +19 -14 | #1 |
| `4c88b5b` | `live-client` / `dashboard-client` / `spectate-client` の state 直接比較を helper 化 | 3 files / +11 -9 | #1 |
| `55b3714` | `spectate-client` の subscribe onError 3 重複を local helper に集約 | 1 file / +23 -32 | #2 |
| `7e22b26` | `firestore.rules` の `tournaments allow update` 右側 dead branch を撤去 | 1 file / +12 -17 | #6 |
| `149379f` | `SpectateLateEntryBanner` を `_components/` に co-location | 2 files / +71 -64 | #4 |
| `6dee65b` | `formatErrorForDisplay` helper を追加し `${code}: ${message}` 重複を 35 files / 57+ callsite で集約 | 35 files / +104 -91 | #5 |

合計: 8 commits / 44 files / +282 -258 行（plan + review ドキュメント除く）。

### 設計上の判断ポイント

- **Task 1**: 当初 `services/group.ts` の file-private 関数を `export` する計画だったが、`services/tournament.ts` の既存 unit test (`tournament.test.ts`) が `services/group.ts` 経由の transitive Firebase 初期化で破綻した（Firestore SDK の `collection()` が mock された `firestore: {}` で失敗）。pure helper として `schemas/group.ts` に置き、Firebase 初期化を transitively 持ち込まない構造に変更したことで、unit test の mock 境界（[testing.md](../../../rules/testing.md) 規約）を保ちつつ集約を達成。
- **Task 5**: subscribe onError の 3 重複を `useCallback` 経由ではなく file-internal closure で集約。`tid` は props 由来で stable のため `eslint-disable-next-line react-hooks/exhaustive-deps` で deps 起動条件を既存と同一に保った（`tid` 変更時のみ re-subscribe）。
- **Task 6**: rule の右側 OR 分岐は両分岐とも `isOrganizer` を要求していたため strict subset で permissions を一切追加しない dead branch だった。emulator validator のケース 12「organizer non-bool spectateEnabled — passes via broad path A」が示す通り、`is bool` 制約も effective でなかった（zod schema が application 層で同制約を enforce 済み）。
- **Task 8**: 当初予定外だったが、ユーザー判断で in-scope に追加。35 files / 57+ callsite を helper 経由に置換しても出力は byte-identical。将来「code を非表示にして message のみ表示」など UI フォーマット変更時の単一書換点として導入。

## 見送った提案（理由付き）

- **finding-7（`setSpectateEnabled` の input validation 型穴）**: empty / whitespace `tid` で early throw に倒すと、`getTournament` 経由の `firestore/not-found` 経路と error code が変わる。観測動作変更を含むため今回スコープから除外（ユーザー判断にて確認済み）。次回 architect-refactor で `assertNonEmptyString` helper を含む input validation の集約と合わせて再検討。
- **finding-8（rule 経路 A での `is bool` 強制）**: 「organizer 信頼ロールが zod を bypass して非 bool 値を書ける」は理論的攻撃 surface だが、zod schema が load 時に再 validate するため UI には届かない。Cloud Functions 化（将来課題）と合わせて再評価。
- **finding-9（観戦経路の anon read コスト）**: `firebase-patterns.md` で記録済みの既知の trade-off。会場規模（20 人 × 6 卓）では無視可能。記録のみ。

## 追加したテスト

なし（純粋なリファクタのため characterization test は不要。既存テストが安全網）。Task 6 の rule cleanup は `scripts/test-rules-spectate.mjs` 既存 19 ケースで完全カバー（19/19 green を確認）。

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | pass | pass |
| lint | pass | pass |
| unit test | 1267 pass / 0 fail | 1267 pass / 0 fail |
| build | pass | pass |
| e2e test | 90 pass / 3 skipped / 0 fail (8.2 min) | 90 pass / 3 skipped / 0 fail (7.3 min) |
| firestore rules emulator (spectate) | 19 pass | 19 pass |

## 観測可能な動作変更が無いことの根拠

- 全 task で出力が byte-identical（`formatErrorForDisplay` の戻り値は `\`${err.code}: ${err.message}\`` と同値、tournament-state helper の戻り値は `state ===` と同値、assertOrganizer の throw する AppError code / message は同一）
- rule の経路 B 撤去は emulator validator で「rule の deny / allow 結果が完全に同じ」を 19/19 で確認
- E2E は本 phase 完了時点で全件再走行（90 specs 中、変更がスペック挙動に与える影響なし）

## 本番 deploy が必要な変更

- **`firestore.rules`** — Task 6（経路 B dead branch 撤去）。観測動作は変わらないが本番ルールも同期するため `firebase deploy --only firestore:rules` を実行する必要がある。本 PR マージ後に運営者が手動で deploy。

## 残課題 / Next Step

- finding-5（formatErrorForDisplay）は今回適用したが、message のみ表示への transition は別 task。
- finding-7 / finding-8 は次回 architect-refactor で再評価（input validation helper の集約と合わせて）。
- `finishedTournamentCount` / `defaultSeatsPerTable` の任意値書換 finding（既知のセキュリティリスクとして CLAUDE.md に記録済み）の Cloud Functions 化は本 phase 範囲外。Phase 5+ で再評価。

## 関連リンク

- 監査結果: [reviews/architect-refactor-20260510.md](../reviews/architect-refactor-20260510.md)
- 計画: [plans/completed/architect-refactor-20260510.plan.md](../plans/completed/architect-refactor-20260510.plan.md)（Phase 5 完了時点で `completed/` に移動）
- 直近の architect-refactor 履歴:
  - 20260430（01-allin-timer）
  - 20260506（01-allin-timer）
  - 20260507（02-season-stats-and-share）
  - 20260509（03-pwa-app-shell）
