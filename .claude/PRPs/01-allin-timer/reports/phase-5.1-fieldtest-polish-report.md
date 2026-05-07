# Implementation Report: Phase 5.1 — ドライラン #1 で判明した UX / バグ Polish 一括対応

## Summary

Phase 5（Field Test & Polish）の **1 回目のドライラン**で発生した UX 摩擦・バグ 9 件と、追加ヒアリングで方針確定した 2 件（座席確定後 (state=seating) の自動配席遅延・ゲスト匿名は受付完了画面のみで完結）を、schema additive / Firestore Rules / Service / UI の各層で最小限の差分で解決した。**PD（プレイングディーラー）モデル**を `players/{pid}.isPlayingDealer: boolean` で導入し、初回席決め時の席 1 固定 / 同卓 1 PD 制約 / バランシング除外 / bust・閉鎖時の auto-OFF を実装。**初回席決めと late entry の連番化を解消**して seed-driven ランダム抽選に変更（BB ポジション再現の余地を確保）。**匿名ゲスト導線**は受付完了画面で動線完結する設計に転換し、`/live` 直接アクセスは `/` に redirect。**暗黙音声 unlock** を `pointerdown` で発火する hook を追加（明示ボタンは fallback として残置）。**サイドバー「参加中のトーナメント」section** を `collectionGroup` 経由で realtime 表示する `JoinedTournamentsNav` を追加。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Large            | Large（plan 通り） |
| Confidence    | High             | High           |
| Files Changed | 約 25 ファイル        | 32 ファイル変更 + 7 ファイル新規（テスト含む） |

## Tasks Completed

| #     | Task                                                       | Status            | Notes |
| ----- | ---------------------------------------------------------- | ----------------- | ----- |
| 1     | schema 追加 — `players.isPlayingDealer`                       | [done] Complete   | additive `default(false)`、破壊的 migration なし |
| 2     | PD 純関数（pd.ts）— characterization test 先行                    | [done] Complete   | `planPlayingDealerShift` / `pinPlayingDealersToSeat1` + 11 ケース |
| 3     | `planInitialSeating` を PD 分散 + ランダム抽選 + 席 1 強制               | [done] Complete   | `TooManyPlayingDealersError` 新規、最少人数 bucket 動的選択 |
| 4     | `planLateEntrySeat` 空席ランダム抽選                              | [done] Complete   | seed 引数追加（default=0） |
| 5     | `planBalancingMove` で PD 除外                                | [done] Complete   | `!p.isPlayingDealer` filter 追加 |
| 6     | `commitInitialSeating` で PD ID 集合引渡                       | [done] Complete   | tx 内 liveActive から PD ID 抽出、`seating/pd-too-many` ラップ |
| 6.5   | `state=seating` で自動配席発火 + `isAcceptingLateSeats`            | [done] Complete   | hook + tx 両方で state guard 緩和、純関数 helper 新設 |
| 7     | `setIsPlayingDealer` service 追加                            | [done] Complete   | tx 内 race guard + rotation 統合 |
| 8     | `bustPlayer` で同卓全員 `isPlayingDealer=false`                  | [done] Complete   | writeBatch 化、`sameTablePlayerIds` 引数追加 |
| 9     | `applyTableBreak` で閉鎖卓 `isPlayingDealer=false`               | [done] Complete   | tx 内 update に統合 |
| 10    | Firestore Rules に `isPlayingDealer` 書込許容                    | [done] Complete   | self/organizer 経路ともに `.get(..., false)` 互換で legacy doc 対応 |
| 11    | SeatingBoard / PlayerList に PD checkbox                    | [done] Complete   | seating 以降は SeatingBoard、setup 中は PlayerList で出し分け |
| 12    | `useImplicitAudioUnlock` hook                              | [done] Complete   | `useAudioPlayer` 冒頭で呼び出し |
| 13    | AppShell fullscreen pattern 撤廃 + 匿名 gate                  | [done] Complete   | `FULLSCREEN_PATTERN` 削除、匿名は main のみ render |
| 14    | HeaderMenuButton 匿名で null                                  | [done] Complete   | `useAuthUser` 経由 |
| 15    | `subscribePlayersByUid` (collectionGroup)                  | [done] Complete   | 新規 repository ファイル |
| 16    | `JoinedTournamentsNav` と PrimaryNav 統合                    | [done] Complete   | tids subscribe → 個別 tournament subscribe で realtime |
| 17    | DisplayNameDialog 発火条件拡張                                  | [done] Complete   | `signInWithGoogle` の戻り値に `needsDisplayNameSetup` 追加 |
| 18    | `/live` 匿名 redirect                                       | [done] Complete   | useEffect で `router.replace("/")`、UI ちらつき防止 |
| 19    | `/join/{tid}` 受付完了画面分岐                                  | [done] Complete   | 匿名は「受付が完了しました」のみ、タイマー画面ボタン非表示 |
| 20    | emulator validation script (`test-rules-pd.mjs`)            | [done] Complete   | 6 ケース（self deny / organizer ON/OFF / member deny / 同時更新 / legacy） |
| 21    | docs / rule 表 update（firebase-patterns.md）                 | [done] Complete   | `players.isPlayingDealer` セクション追記 |
| 22    | 既存 fixture / E2E の連番依存修正                                  | [done] Complete   | `engine.test.ts` の planLateEntrySeat 期待値を characterization 化、各 fixture factory に `isPlayingDealer: false` を追加 |

## Validation Results

| Level           | Status        | Notes                                                                       |
| --------------- | ------------- | --------------------------------------------------------------------------- |
| Static Analysis | [done] Pass   | typecheck 0 errors / lint 0 warnings                                         |
| Unit Tests      | [done] Pass   | 649 passed (33 test files, 既存 627 → 649 に増加 = 新規 22 ケース) |
| Build           | [done] Pass   | Next.js 15 production build 成功                                              |
| Integration     | N/A           | Firestore Rules emulator validation script は手動実行（CI には含めない方針） |
| Edge Cases      | [done] Pass   | engine の random seat / PD 配分 / balancing exclusion / late entry race を unit test で網羅 |

## Files Changed

### 新規作成（7 ファイル）

| File                                                | Purpose                                                |
| --------------------------------------------------- | ------------------------------------------------------ |
| `src/lib/services/seating/pd.ts`                    | PD 純関数（rotation / pin）                              |
| `src/lib/services/seating/pd.test.ts`               | PD 純関数の characterization test（11 ケース）            |
| `src/lib/firebase/repositories/playersByUid.ts`     | collectionGroup 経由の participating tournaments 購読 |
| `src/lib/hooks/useImplicitAudioUnlock.ts`           | document `pointerdown` で AudioContext resume         |
| `src/components/nav/JoinedTournamentsNav.tsx`       | サイドバー「参加中のトーナメント」section                 |
| `scripts/test-rules-pd.mjs`                         | `players.isPlayingDealer` の rules emulator validator |
| `.claude/PRPs/plans/phase-5.1-fieldtest-polish.plan.md` | 本サブフェーズの実装計画（plan ファイル） |

### 既存更新（32 ファイル）

| File                                                              | Action |
| ----------------------------------------------------------------- | ------ |
| `firestore.rules`                                                 | UPDATE — players update branch に `isPlayingDealer` の self immutable / organizer bool 強制 |
| `src/lib/firebase/schemas/player.ts`                              | UPDATE — `isPlayingDealer: z.boolean().default(false)` additive |
| `src/lib/firebase/repositories/players.ts`                        | UPDATE — `bustPlayer(tid, pid, sameTablePlayerIds)` writeBatch 化、`upsertPlayer` で `isPlayingDealer: false` 初期化 |
| `src/lib/services/seating/engine.ts`                              | UPDATE — `planInitialSeating` PD 配分 + random seat、`planLateEntrySeat` seed 引数追加、`planBalancingMove` PD 除外、`TooManyPlayingDealersError` |
| `src/lib/services/seating/orchestrator.ts`                        | UPDATE — `commitInitialSeating` PD ID 抽出、`autoSeatLateEntry` state guard 緩和 + seed pass、`setIsPlayingDealer` 新設、`bustPlayer` ラッパ拡張、`applyTableBreak` で `isPlayingDealer=false` |
| `src/lib/services/tournament-state.ts`                            | UPDATE — `isAcceptingLateSeats(t)` 新設 |
| `src/lib/hooks/useSeatingAutoOrchestrator.ts`                     | UPDATE — 発火条件を `isAcceptingLateSeats` 経由に切替 |
| `src/lib/hooks/useAudioPlayer.ts`                                 | UPDATE — `useImplicitAudioUnlock` を mount 時に呼ぶ |
| `src/lib/services/auth-actions.ts`                                | UPDATE — `signInWithGoogle` の戻り値に `needsDisplayNameSetup` 追加（profile 不在 / displayName 空のケースを捕捉） |
| `src/components/nav/AppShell.tsx`                                 | UPDATE — fullscreen pattern 早期 return 撤廃、匿名は main のみ render |
| `src/components/nav/HeaderMenuButton.tsx`                         | UPDATE — 匿名は null |
| `src/components/nav/PrimaryNav.tsx`                               | UPDATE — `JoinedTournamentsNav` を items 末尾に挿入 |
| `src/components/tournament/SeatingBoard.tsx`                      | UPDATE — 各席に PD checkbox + `tablePd` 1 卓 1 PD UI ガード |
| `src/components/tournament/PlayerList.tsx`                        | UPDATE — setup 時のみ PD checkbox、`sameTablePlayerIds` を BustButton に渡す |
| `src/components/tournament/BustButton.tsx`                        | UPDATE — `sameTablePlayerIds` prop 追加 |
| `src/app/login/login-client.tsx`                                  | UPDATE — `needsDisplayNameSetup` で dialog 発火 |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                  | UPDATE — `setIsPlayingDealer` を SeatingBoard / PlayerList に wire |
| `src/app/tournaments/[tid]/live/live-client.tsx`                  | UPDATE — 匿名は `/` に redirect、UI placeholder |
| `src/app/join/[tid]/join-client.tsx`                              | UPDATE — 受付完了画面を匿名 / 通常で分岐 |
| `.claude/rules/firebase-patterns.md`                              | UPDATE — `players.isPlayingDealer` セクション追記 |
| 各種 test fixture（`engine.test.ts` 等 12 ファイル）                | UPDATE — `isPlayingDealer: false` を fixture factory に追加、`planLateEntrySeat` の連番期待値を characterization に変換 |
| `.claude/PRPs/prds/allin-timer.prd.md`                            | UPDATE — Phase 5 進捗反映（既存変更分） |

## Deviations from Plan

| 項目 | What | Why |
| --- | ---- | --- |
| `planLateEntrySeat` の seed | plan は `(seatedPlayers, broken, sps, seed: number)` を必須化していたが、実装は `seed: number = 0` のデフォルト引数にした | 既存 callsite が多数あり、後方互換を保ちつつ orchestrator 側で `Date.now() ^ playerId hash` を渡す方が衝突が少ない。tests は引数を明示して deterministic にする |
| `setIsPlayingDealer` の `tablePlayerIds` 引数 | plan は `fetchTablePlayers(tx, tid, tableNum)` 内部実装を提案していたが、引数で渡す形にした | plan の GOTCHA でも「全 tournament players を tx.get するのは重いので引数で受け取る形にする」と記載あり |
| `setIsPlayingDealer` の setup 中 ON | plan は同卓検証だけ skip していたが、setup 中は `tableNum=null` で同卓検証を完全 skip + フラグだけ ON する経路を分岐 | tx 内で「同卓 player 全員」を検索する実装を簡略化、setup 中は PD 数 制約を `commitInitialSeating` に任せる |
| 匿名ゲストの subscribePlayers | plan は subscribePlayers を匿名でも動かす想定なし | live-client 既存テスト（self-delete on finish）4 件が anonymous + finished + me マッチを前提としているため subscribePlayers を匿名でも有効化（redirect は別 useEffect で並行実行） |
| `live-client` redirect の placeholder UI | plan は `return <main>...受付完了画面に戻ります…</main>` | 通常の loading state より目立つ表示で、redirect 中であることを明示。実装は plan 通り |

## Issues Encountered

| Issue | Resolution |
| --- | --- |
| `planLateEntrySeat` を random 化したことで既存テスト「最小卓 / seat 4」「最小空席 / seat 2」が壊れた | `engine.test.ts` を characterization に書き換え（seat ∈ [2..9] のいずれか / seed 固定で再現性のみ確認）。「seat-taken race」テストは「卓に 8 人配席して空席を {2} のみに絞る」設計に変更 |
| `useSeatingAutoOrchestrator.test.ts` の「seating で発火しない」テストが Phase 5.1 の挙動と矛盾 | 「seating で発火する」テストに反転 |
| `live-client.test.tsx` の anonymous self-delete 4 ケースが redirect 早期 return で全滅 | subscribePlayers 早期 return を撤廃して self-delete useEffect を引き続き動かす（redirect は別 useEffect で並行）。テストは触らずに通る形に倒した |
| `auth-actions.test.ts` の signInWithGoogle 戻り値テストが `needsDisplayNameSetup` 追加で壊れた | `toEqual({ user, isNewUser })` を `expect(result.user).toBe / result.isNewUser` の field-by-field に変更し、`needsDisplayNameSetup` の追加を許容 |
| `group.test.ts` の `consumeJoinCode` で「招待コード期限切れ」エラー（fixture 日付が現在時刻 2026-05-02 を超えていなかった） | `future` を `2026-05-01` → `2030-05-01` に更新（プレ既存の test rot を併せて修正） |
| `repositories/players.test.ts` の bustPlayer テストが `updateDoc` を assert していた | writeBatch 化に合わせ `writeBatch` を mock し、`batch.update` の呼出を assert する形に再構築。同卓 PD OFF / self-skip を含む 4 ケースに拡張 |

## Tests Written

| Test File | Tests | Coverage |
| --- | --- | --- |
| `src/lib/services/seating/pd.test.ts` | 11 ケース | `planPlayingDealerShift` / `pinPlayingDealersToSeat1` の純関数仕様 |
| `src/lib/services/seating/engine.test.ts` | +6 ケース追加（合計 29） | PD 0/1/= numTables / > numTables / busted PD / random seat の characterization、PD 除外バランシング |
| `src/lib/services/seating/orchestrator.test.ts` | 既存 36 件は維持（fixture factory + assertion 修正） | `bustPlayer` の sameTable 引数 / autoSeatLateEntry の random seat / seat-taken race |
| `src/lib/firebase/repositories/players.test.ts` | +2 ケース追加（同卓 PD OFF / self-skip） | `bustPlayer` writeBatch 化の動作確認 |
| `src/lib/hooks/useSeatingAutoOrchestrator.test.ts` | 1 ケース反転 | seating での発火を確認 |

## Next Steps

- [ ] Code review via `/code-review`（unit テスト全 pass / typecheck / lint / build green の状態でレビュー）
- [ ] `firebase emulators:exec --only firestore "node scripts/test-rules-pd.mjs"` で rules 検証（手動実行）
- [ ] **2 回目のドライラン**で 11 件の改善を実機検証（PRD Success Metric「サークルで 3 回連続使用」の積み上げ継続）
- [ ] Phase 5.2 として残課題（マスター機 1 台モード / 賞金計算 / `/groups` 詳細→開く リネーム）の起票判断
- [ ] PR via `/prp-pr`
