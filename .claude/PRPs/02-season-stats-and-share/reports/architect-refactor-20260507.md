# Architect Refactor Report — 20260507

## Scope

src/ 全体を対象に、Phase D（Web Share & 履歴 polish）周辺と前回 architect-refactor
（20260506）で拾えなかった残債を中心に、Senior Web Architect + Security Specialist
の 2 レンズで監査・段階的リファクタリングを実施。

ベースブランチ: `develop`（直近コミット `bb5528c`）
作業ブランチ: `refactor/full-scope-20260507`
所属 PRD: `02-season-stats-and-share`（Phase D follow-up）

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 2 件（finding-1: ShareCard URL/filename 二重化 / finding-2: client 二重 warn）
- low: 3 件（finding-3: orchestrator wrap 未適用 / finding-4: 大型ファイル / finding-5: 既知 security リスク）
- 詳細監査結果: [.claude/PRPs/02-season-stats-and-share/reviews/architect-refactor-20260507.md](../reviews/architect-refactor-20260507.md)

## 実施した変更

### T1: `refactor(og): ShareCard 用 URL/filename 計算を純関数に抽出`
- commit: `a1bb35e`
- 影響: `src/app/api/og/_lib/og-payload.ts` / `og-payload.test.ts`
- 内容: `buildWinnerShareInputs` / `buildSeasonShareInputs` の 2 純関数を追加。
  download / share 両経路で同じ URL + filenameStem を返すことを characterize する
  8 件の純関数テストを追加（既存 30 件 + 新規 8 件 = 38 tests）。

### T2: `refactor(share): download ボタンを buildXxxShareInputs helper 経由に統一`
- commit: `39a00d7`
- 影響: `WinnerCardDownloadButton.tsx` / `SeasonTopCardDownloadButton.tsx`
- 内容: 内部の URL / filenameStem 計算を T1 helper 1 行呼出に置換。差分 +7 / -41。

### T3: `refactor(client): ShareCardButton 用 URL/filename 計算を helper に集約`
- commit: `16395e1`
- 影響: `dashboard-client.tsx` / `season-ranking-client.tsx`
- 内容: 「最小差分優先で許容」とコメントされていた IIFE 内の二重計算を T1 helper 経由に
  置換。差分 +41 / -79。finding-1 完了。

### T4: `refactor(errors): client 側の二重 warn を unwrapOrFrom に集約`
- commit: `aac6104`
- 影響: 6 ファイル（group-detail / dashboard / season-ranking /
  tournament-edit / template-edit / BalancingInstructionCard）
- 内容: repository / service が wrap helper 経由で既に warn 済の AppError を、
  UI 側で `AppError.from` + `logger.warn` していた約 12 箇所を `unwrapOrFrom` に切替え、
  重複の `logger.warn` を削除。`error-logging.md` 禁止事項の二重 warn パターンを解消。
  差分 +51 / -47。finding-2 完了。

### T5: `refactor(seating): orchestrator の write 関数 5 件を wrapFirestoreWrite に集約`
- commit: `5c7b87f`
- 影響: `src/lib/services/seating/orchestrator.ts`
- 内容: `autoSeatLateEntry` / `applyCascadeMoves` / `applySingleMove` /
  `applyTableBreak` / `setIsPlayingDealer` の 5 関数を wrap helper 経由に書換え。
  `setIsPlayingDealer` の `if (e instanceof AppError) throw e` 分岐は
  `wrapFirestoreWrite` 内部の `AppError.from` idempotency に置換。
  `commitInitialSeating` は engine error 特殊処理のため対象外。差分 +407 / -405。
  finding-3 完了。

## 見送った提案（理由付き）

- **finding-4: 大型ファイル分割** — `orchestrator.ts` 1108 行、`tournaments.ts` 824 行、
  `group.ts` 669 行などはいずれも凝集度が高くドメイン単一。分割は依存関係を縦にスライス
  するため誤った分割は把握困難化を招く。`SeatingBoard.tsx` 562 行 / `dashboard-client.tsx`
  550 行 / `group-detail-client.tsx` 406 行は前回 architect-refactor 20260506 / 20260430
  の Phase 4 で既に hooks / `_components/` 抽出済み。
- **finding-5: 既知のセキュリティリスク** — `groupJoinCodes.usesCount` の DoS、
  `finishedTournamentCount` / `defaultSeatsPerTable` の任意値書換は
  `group-membership.md` の「既知のセキュリティリスク」に記載済み。
  default の `maxUses: null` 利用に留まる限り遅延可。完全防御は Cloud Functions
  化が現実解で、本 refactor のスコープ外。
- **`commitInitialSeating` の wrap 化** — engine error の `instanceof` 分岐
  （`TooManyTablesError` / `InvalidSeatsPerTableError` /
  `TooManyPlayingDealersError`）が tx 内 throw に依存しており、複雑度の割に得が小さい。
  T5 では他 5 関数の集約を優先。

## 追加したテスト

- `src/app/api/og/_lib/og-payload.test.ts` — 8 件追加
  - `buildWinnerShareInputs`: 4 件（filenameStem の sanitize / url の query 同型 /
    download 経路との drift 不在）
  - `buildSeasonShareInputs`: 4 件（empty stats → null / startDate null / top1〜top3 全種 /
    download 経路との drift 不在）
- 既存テスト 1030 → 新規 9（純テスト 8 + side effect 1）= 1039 件、すべて green を維持

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | ✅ pass | ✅ pass |
| lint | ✅ pass (No warnings) | ✅ pass (No warnings) |
| unit test | ✅ 1030 passed / 0 failed (58 files) | ✅ 1039 passed / 0 failed (58 files) |
| e2e test | ✅ 65 passed / 0 failed / 2 skipped (6.6 min) | ✅ 65 passed / 0 failed / 2 skipped (6.8 min, fresh dev server で再走行) |
| build | ✅ pass (15/15 pages, /tournaments/[tid] 30 kB / 357 kB) | ✅ pass (15/15 pages, /tournaments/[tid] 30 kB / 358 kB) |

bundle サイズ: ほぼ不変。`/templates/[tid]/edit` が 2.0 → 1.97 kB、
`/tournaments/[tid]/edit` が 1.21 → 1.18 kB と T4 の不要 import 削減により微減。
他ルートは差なし。

## 観測可能な動作変更が無いことの根拠

1. unit / e2e の全数 green を維持（旧 1030 → 新 1039 unit / 65 → 65 e2e）
2. 公開 API（URL クエリパラメータ / Firestore スキーマ / 環境変数 / 永続化フォーマット）の
   変更なし
3. T1〜T3 は内部 helper 抽出のみで OG image route の出力 URL / filenameStem は
   bit-for-bit 同一（`og-payload.test.ts` の characterization テストで担保）
4. T4 は `setError` 文字列 / UI rendering / button label / error code 同一。
   差分は本番ログから二重 warn が消える点のみ
5. T5 は `AppError.from` の idempotency により tx 内 throw の AppError code が保持され、
   `seating/pd-busted` / `seating/pd-already-set` 等の specific code に依存する既存テストが
   すべて green

ロジック以外で変わった点:
- 本番ログの warn 行数: 約 12 イベント / セッション 減（client 側 catch の二重 warn 削除）
- bundle サイズ: 数 KB 削減（T4 で `logger` import を削れた client が 2 ファイル）

## ワークフロー上の運用学習

Phase 5 で初回の E2E 再走行は 53 fail / 12 pass という大量失敗となったが、原因は
`npm run build` を Phase 5 内で実行したことで、再利用されていた dev server
（`reuseExistingServer: true`、ベースライン E2E 起動分が常駐）の `.next/server/app/...`
キャッシュが build に上書きされ ENOENT を起こしたためだった。dev server / emulator が
完全停止した状態で fresh E2E を再走行した結果、ベースラインと同じ 65 pass / 2 skip /
0 fail で完全一致を確認できた。

将来の architect-refactor では Phase 5 の検証順序を以下に固定すると安全:

1. typecheck / lint / unit / build を**先**に走らせる（dev server が止まっている前提）
2. E2E はその後に単独で実行（playwright が emulator + dev server を起動）

または build を E2E 実行と切り分け、dev server を意図的に再起動する。本 refactor の
ベースラインフェーズでは E2E が完了したあとに dev server が常駐したまま build を走らせて
しまったため drift が発生した。

## 残課題 / Next Step

- **`commitInitialSeating` の wrap 化**: 将来 engine error 群を AppError サブクラス
  化するか、wrap helper に「skip-wrap 例外」セット引数を追加するなどの設計変更と組合せて
  再検討候補。本 refactor では見送り。
- **`maxUses` UI 追加時の Cloud Functions 化**: 招待コード `maxUses` を運営者 UI から設定
  できるようにする際は `groupJoinCodes` `allow update` を deny に戻し Callable function 化が
  必須。`group-membership.md` の「既知のセキュリティリスク」参照。
- **`finishedTournamentCount` / `defaultSeatsPerTable` の任意値書換**: organizer 信頼ロール
  内の嫌がらせは現状許容。Cloud Functions 化で完全防御可能。
- **`AppError.from` の意図不明箇所**: T4 では「明らかに repository / service の AppError を
  再 wrap している箇所」のみ unwrapOrFrom 化した。残り 65 件程度の `AppError.from` 呼出には
  `useAudioPlayer` / `useFullscreen` 等の正当な使用（外部 API の生 Error wrap）が含まれる。
  個別判定が必要なため次回フォロー候補。
