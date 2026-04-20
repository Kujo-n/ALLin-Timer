# Implementation Report: Phase 3 — Timer & Realtime & Viewer

## Summary

トーナメント進行のコア体験「サーバ時刻基準のタイマー」と「全端末リアルタイム同期」を実装。`tournaments/{tid}` にタイマー駆動用フィールド（`levelStartedAt` / `pausedAt` / `pausedAccumMs` / `finishedAt`）を追加し、state 遷移操作（pause / resume / advance / revert / finish）と onSnapshot 購読を repository に新設。`useTournamentTimer` hook がサーバ時刻から残り時間を derive し、運営者ダッシュボード／参加者向け `/live` ページにタイマー UI を提供。Firestore オフライン永続化を有効化し、接続切断時も最後の state でタイマー継続表示できるようにした。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Large            | Large          |
| Confidence    | 高               | 高             |
| Files Changed | 20〜25           | 16             |

実装ファイル数は plan より少なめ。`useSubscribedPlayers` hook は計画されていたが、`PlayerList` 内に直接 `subscribePlayers` を埋め込めば十分シンプルだったため省略（薄いラッパが価値を生まなかった）。

## Tasks Completed

| #   | Task                                                       | Status   | Notes                                                                |
| --- | ---------------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| 1   | tournament schema 拡張（timer fields）                     | Complete |                                                                      |
| 2   | schema テストに新フィールドケース                          | Complete | 4 ケース追加（valid populated / requires accum / negative / invalid） |
| 3   | timer 純粋関数（getLevelInfo / getRemainingMs / shouldAutoAdvance） | Complete |                                                                      |
| 4   | timer 関数 unit tests                                      | Complete | 19 ケース（setup / running / paused / finished / pendingWrite / 境界） |
| 5   | tournament repository 拡張（pause/resume/advance/revert/finish/subscribe） | Complete | `assertCanManage` ヘルパで早期失敗を共通化                           |
| 6   | players repository に subscribePlayers                     | Complete |                                                                      |
| 7   | useTournamentTimer hook                                    | Complete | visibilitychange / autoAdvance options 込み                          |
| 8   | ConnectionBadge / TimerDisplay / TimerControls             | Complete |                                                                      |
| 9   | dashboard-client.tsx を timer hook ベースに書き換え        | Complete | start ダイアログを TimerControls に統合（dialog 自体は削除）         |
| 10  | PlayerList を subscribePlayers ベースに                    | Complete | reload ボタンは debug 用に残置                                       |
| 11  | /tournaments/[tid]/live ページ                             | Complete | RequireAuth allowAnonymous で参加者も閲覧可                          |
| 12  | join 成功画面に /live 導線                                 | Complete |                                                                      |
| 13  | Firestore オフライン永続化                                 | Complete | persistentLocalCache + persistentMultipleTabManager、SSR/HMR ガード  |
| 14  | firestore.rules 変更不要を確認                             | Complete | 差分なし                                                             |
| 15  | 既存 tournaments の破壊的削除                              | Skipped  | コード変更なし。実機検証時に Console から削除する手順                |
| 16  | 最終検証（typecheck / lint / test / build）                | Complete | すべて緑                                                             |

## Validation Results

| Level           | Status | Notes                                       |
| --------------- | ------ | ------------------------------------------- |
| Static Analysis | Pass   | typecheck / lint いずれもエラーなし         |
| Unit Tests      | Pass   | 82 tests passed（新規 timer.test.ts: 19）    |
| Build           | Pass   | Next.js production build 成功（/live: 5.95 kB） |
| Integration     | N/A    | 実端末 E2E（Task 16 シナリオ）は別途運用検証 |
| Edge Cases      | Pass   | timer.test.ts で網羅（pendingWrite / 最終 level / paused 凍結） |

## Files Changed

| File                                                       | Action  | Notes                                                             |
| ---------------------------------------------------------- | ------- | ----------------------------------------------------------------- |
| `src/lib/firebase/schemas/tournament.ts`                   | UPDATED | 4 timer fields 追加                                               |
| `src/lib/firebase/schemas/index.test.ts`                   | UPDATED | baseTournament 更新 + 4 ケース追加                                |
| `src/lib/firebase/repositories/tournaments.ts`             | UPDATED | createTournament / startTournament 初期化 + 6 関数 + subscribe 追加 |
| `src/lib/firebase/repositories/players.ts`                 | UPDATED | subscribePlayers 追加                                             |
| `src/lib/services/timer.ts`                                | CREATED | 3 pure functions                                                  |
| `src/lib/services/timer.test.ts`                           | CREATED | 19 tests                                                          |
| `src/lib/hooks/useTournamentTimer.ts`                      | CREATED | subscribe + tick + autoAdvance                                    |
| `src/components/tournament/ConnectionBadge.tsx`            | CREATED |                                                                   |
| `src/components/tournament/TimerDisplay.tsx`               | CREATED | pure presentational                                               |
| `src/components/tournament/TimerControls.tsx`              | CREATED | state 別ボタン群                                                  |
| `src/components/tournament/PlayerList.tsx`                 | UPDATED | subscribePlayers ベースへ                                         |
| `src/app/tournaments/[tid]/dashboard-client.tsx`           | UPDATED | useTournamentTimer + Timer UI 配置、開始 dialog 削除              |
| `src/app/tournaments/[tid]/live/page.tsx`                  | CREATED | RequireAuth allowAnonymous                                        |
| `src/app/tournaments/[tid]/live/live-client.tsx`           | CREATED | read-only タイマービュー                                          |
| `src/app/join/[tid]/join-client.tsx`                       | UPDATED | 受付完了画面に /live 導線追加                                     |
| `src/lib/firebase/client.ts`                               | UPDATED | initializeFirestore + persistentLocalCache                        |
| `src/lib/services/receipt.test.ts`                         | UPDATED | makeTournament factory に新フィールド追加（型整合）                |

## Deviations from Plan

- **`src/lib/hooks/useSubscribedPlayers.ts` を作らなかった** — Plan では薄い wrapper を計画していたが、`PlayerList` 内に `subscribePlayers` を直接埋めるだけで十分シンプルになった。間接層を増やす利得がないため省略。
- **dashboard-client の開始 Dialog 削除** — Plan では「dialog は残す」と書いていたが、TimerControls の `[開始]` ボタンが直接 `startTournament` を呼ぶ単純な UI で十分なため、Phase 3 の長い説明文 dialog はまるごと削除した（「Phase 3 で追加予定」の文言除去という plan の意図と整合）。

## Issues Encountered

- **既存 `createTournament` が新フィールド追加で type error** — Task 1 で schema を拡張した時点で発覚。Task 5 の `startTournament` 修正と一緒に `createTournament` でも 4 フィールドを `null` / `0` で初期化して解消。
- **`receipt.test.ts` の `makeTournament` factory が型不整合** — TournamentDoc 型が拡張されて test factory の object literal が「missing properties」となった。test factory に同じ初期値を追加して解消。

## Tests Written

| Test File                                  | Tests   | Coverage                                                                |
| ------------------------------------------ | ------- | ----------------------------------------------------------------------- |
| `src/lib/firebase/schemas/index.test.ts`   | +4      | tournament timer fields parse / require / reject                        |
| `src/lib/services/timer.test.ts`           | 19 (new)| getLevelInfo / getRemainingMs / shouldAutoAdvance（全分岐 + 境界）      |

## Next Steps

- [ ] **既存 `tournaments/*` ドキュメントの削除（Console / CLI）** — 破壊的スキーマ変更のため、Phase 3 ブランチ稼働前に必須
- [ ] 実端末 E2E 検証（PC + スマホ 2 台）
  - Lv 同期、pause/resume、auto-advance（durationSec=5 のテスト用 structure で確認）
  - 機内モード ↔ 復帰で ConnectionBadge と timer 継続表示
  - ゲスト → /live で参加者からの閲覧
- [ ] PRD の Phase 3 ステータスを `complete` に更新（PR マージ時）
- [ ] `/code-review` で diff レビュー
- [ ] `/prp-pr` で PR 作成
