# Implementation Report: 音声タイミング（ローカル残り0検知）＋タイマー2秒飛び緩和（要望④⑤）

## Summary

ブラインドアップ音のトリガを「`currentLevel` 変化（Firestore 往復後）」から「ローカルで残り 0
を検知した瞬間」に変更し（要望④）、あわせてレベル遷移時の「タイマー2秒飛び」を auto-advance
の `levelStartedAt` を構造定義から決定論的に算出して書き込むことで緩和した（要望⑤）。④⑤は
密結合のため同一実装で扱った。

- `timer.ts` に純関数 `shouldPlayLevelEndSound` / `computeAutoAdvanceLevelStartMs` を追加
- `useAudioPlayer` の levelUp effect を `currentLevel` 変化検知から `remainingMs <= 0` の
  ローカル検知へ置換。二重再生は `levelStartedAt` をキーにした ref ガードで防止
- `advanceLevel` の auto-advance transaction 経路のみ、新レベルの `levelStartedAt` を
  `Timestamp.fromMillis(前レベル理想終了時刻)` で固定（手動 / offline fallback は serverTimestamp 据え置き）

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Medium           | Medium |
| Files Changed | 8（実装5 + テスト3） | 9（実装6 + テスト3） |

実装ファイルが 1 件増えたのは、`useAudioPlayer` の 3 番目の消費側
[AudioSettingsCard.tsx](../../../../src/app/groups/[gid]/_components/AudioSettingsCard.tsx)
（設定ページの試聴）が plan の Files to Change から漏れていたため。新 prop `remainingMs` を
必須化したことで typecheck が検出し、`remainingMs: null` を追加して解消した。

## Tasks Completed

| #   | Task                                              | Status   | Notes |
| --- | ------------------------------------------------- | -------- | ----- |
| 1   | timer.ts に pure helper 2 つ追加                  | Complete | |
| 2   | timer.test.ts に characterization test 追加        | Complete | shouldPlayLevelEndSound 11件 + computeAutoAdvanceLevelStartMs 2件 |
| 3   | useAudioPlayer.ts のトリガ置換                     | Complete | prevLevelRef → playedLevelEndKeyRef、doc コメントも更新 |
| 4   | useAudioPlayer.test.tsx の levelUp ブロック書換    | Complete | factory を 3 レベルに拡張（最終/非最終を区別） |
| 5   | advanceLevel auto tx の levelStartedAt 決定論化     | Complete | levelTransitionUpdates に startOverrideMs 引数を追加 |
| 6   | tournaments.test.ts に決定論的 levelStartedAt assert | Complete | 既存 2 件はそのまま green |
| 7   | dashboard / live に remainingMs を結線             | Complete | Deviated — AudioSettingsCard も結線（plan 漏れ） |
| 8   | ⑤原因レポート記載                                  | Complete | 本レポート下部 |

## Validation Results

| Level           | Status | Notes |
| --------------- | ------ | ----- |
| Static Analysis | Pass   | tsc --noEmit エラー 0 / next lint 警告 0 |
| Unit Tests      | Pass   | 全 91 ファイル / 1461 tests green（新規 13 + 書換済 30 含む） |
| Build           | Pass   | next build 成功 |
| Integration     | N/A    | rule 未変更のため emulator rule テストは無影響 |
| Edge Cases      | Pass   | remaining null / 最終レベル / 二重再生抑止 / role gate / seating→running / 手動遷移 を unit で網羅 |

## Files Changed

| File | Action | 概要 |
| ---- | ------ | ---- |
| `src/lib/services/timer.ts` | UPDATED | pure helper 2 つ追加 |
| `src/lib/services/timer.test.ts` | UPDATED | characterization test 13 件追加 |
| `src/lib/hooks/useAudioPlayer.ts` | UPDATED | remainingMs prop 追加・levelUp effect 置換・prevLevelRef 削除 |
| `src/lib/hooks/useAudioPlayer.test.tsx` | UPDATED | levelUp describe を remainingMs 駆動に書換・全呼出に remainingMs 付与 |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATED | auto tx の levelStartedAt を決定論化 |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATED | 決定論的 levelStartedAt の assert 追加 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATED | remainingMs を結線 |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATED | remainingMs を結線 |
| `src/app/groups/[gid]/_components/AudioSettingsCard.tsx` | UPDATED | remainingMs: null を結線（plan 漏れ補完） |

## Deviations from Plan

1. **AudioSettingsCard.tsx の追加結線**（Task 7）— plan の Files to Change に含まれていなかったが、
   `remainingMs` を必須 prop にしたため第 3 の消費側でも結線が必要だった。試聴専用で tournament=null
   のため `remainingMs: null` を渡す（音は鳴らない）。
2. **hook テスト factory のレベル数**（Task 4）— plan は makeTournament を 2 レベル想定としていたが、
   「新レベル currentLevel 2 で再発火」と「最終レベル currentLevel 2 で無音」の両ケースは 2 レベルでは
   矛盾する（currentLevel 2 が最終になる）。timer.test.ts の factory に倣い 3 レベルに拡張して、
   currentLevel 2 を非最終・currentLevel 3 を最終として両ケースを成立させた。

## Issues Encountered

- typecheck が AudioSettingsCard の prop 不足を即検出（必須化の意図どおり）。`remainingMs: null` で解消。
- それ以外の回帰なし。winner / unlock / preview / pause-on-flip の各 describe は `remainingMs: null`
  付与のみで振る舞い維持。

## Tests Written

| Test File | 追加/書換 | カバレッジ |
| --------- | --------- | ---------- |
| `src/lib/services/timer.test.ts` | +13 件 | shouldPlayLevelEndSound（running/0、負値、>0、null、最終、paused/finished/setup/seating、levelStartedAt null）/ computeAutoAdvanceLevelStartMs（accum 0 / 30s） |
| `src/lib/hooks/useAudioPlayer.test.tsx` | levelUp describe 全書換 | role gate / unlock 前 / 二重再生抑止 / 新レベル再発火 / 最終レベル無音 / setup・seating 無音 / 手動相当無音 |
| `src/lib/firebase/repositories/tournaments.test.ts` | +1 件 | auto tx の levelStartedAt が t0+600s（決定論的境界） |

## ⑤ 2秒飛びの原因と緩和

- **原因**: auto-advance の transaction が新レベルの `levelStartedAt: serverTimestamp()`（= commit 時刻）
  で stamp していた。auto-advance はローカル残り 0（= 前レベルの理想終了時刻）で発火するが、commit は
  そこから Firestore 往復遅延ぶん後、新 snapshot の端末 render は更に後になる。差分（往復＋描画ラグ
  ≈ 2 秒）ぶん新レベルが進んだ状態（10:00 ではなく 9:58 など）で表示されていた。
- **検証**: `getRemainingMs` の running 分岐（[timer.ts:74-75](../../../../src/lib/services/timer.ts)）と
  `levelTransitionUpdates` の `serverTimestamp()`（[tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts)）の
  コード追跡で確定。tick 解像度（`formatRemaining` の `Math.floor`,
  [TimerDisplay.tsx:22](../../../../src/components/tournament/TimerDisplay.tsx)）は 1 秒単位の表示丸めで、
  2 秒規模の飛びの主因ではない（副次的に 1 秒の前後揺れはあり得る）。
- **緩和**: auto tx の `levelStartedAt` を `computeAutoAdvanceLevelStartMs`（前レベル理想終了時刻
  = `levelStartedAt + durationMs + pausedAccumMs`）で決定論化。レベル境界を構造定義に固定し、
  往復遅延を吸収しないようにした。
- **残課題**: offline `updateDoc` fallback 経路・端末長時間バックグラウンド後の連鎖 auto-advance は
  据え置き（許容。1 tick 1 レベルで自己整合する。完全な root fix は将来 Cloud Functions 化）。

## Next Steps

- [ ] Manual Validation（実機）: dashboard でレベル終了瞬間に音が即鳴る / 二重再生なし /
      手動レベル変更で無音 / seating→running 無音 / finished 無音 / レベル切替の 2 秒飛び体感解消
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
