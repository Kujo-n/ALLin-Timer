# ローカルレビュー: 音声タイミング（ローカル残り0検知）＋タイマー2秒飛び緩和（要望④⑤）

**Reviewed**: 2026-05-31
**Mode**: Local Review（未コミット変更）
**Branch**: develop
**Decision**: APPROVE（comments 付き）

## Summary

ブラインドアップ音のトリガをローカル残り0検知へ移行し、auto-advance の `levelStartedAt` を
決定論化する変更。設計は plan どおりで、pure helper への集約・ref ガード・rule 無変更の
いずれも規約に沿っている。CRITICAL / HIGH なし。指摘は LOW 3 件（いずれもコード内コメントで
明示済みの許容トレードオフ）。

## Findings

### CRITICAL

None

### HIGH

None

### MEDIUM

None

### LOW

1. **`computeAutoAdvanceLevelStartMs` の null フォールバックは「壊れない」止まり**
   （[timer.ts:230-236](../../../../src/lib/services/timer.ts)）
   `levelStartedAt` が null のとき `startMs = 0` となり、戻り値は `durationMs + accum`
   （≈ 1970-01-01 起点の値）になる。実際の auto-advance tx では running tournament の
   `levelStartedAt` は非 null が保証されるため発生しないが、tx 内では `currentLevel == expected`
   のみ guard し `levelStartedAt !== null` は再 check していない。防御的フォールバックとしては
   妥当（crash しない）だが、万一 null だった場合に無意味な過去 Timestamp を書く。
   **対応不要**（理論上のみ）。気になるなら helper 冒頭で null のとき `serverTimestamp` 相当に
   倒す設計も可能だが、純関数の戻り型が ms 固定のため今回は据え置き。

2. **unlock 前にレベルが終了すると、そのレベルの終了音は取りこぼす**
   （[useAudioPlayer.ts:184-186](../../../../src/lib/hooks/useAudioPlayer.ts)）
   `play` が gate（unlocked=false）で no-op でも `playedLevelEndKeyRef` のキーを消費する。
   後から unlock しても同レベルでは鳴らない。旧実装の `prevLevelRef` 更新と同じ挙動で、
   コメントにも「取りこぼしは許容」と明示済み。**意図どおり**。

3. **端末長時間バックグラウンド後の連鎖 auto-advance**
   （[tournaments.ts:467-479](../../../../src/lib/firebase/repositories/tournaments.ts)）
   決定論的 `startOverrideMs` が過去になり、新レベルが即残り0 → 次 tick で連鎖進行しうる。
   1 tick 1 レベルで自己整合するためコメントで許容と明示。根本解決は将来 Cloud Functions 化。
   **意図どおり**。

## 観点別チェック

| Category | 評価 |
| --- | --- |
| Correctness | OK。`shouldPlayLevelEndSound` は `shouldAutoAdvance` と同条件（入力が nowMs vs remainingMs の差のみ）。負値・null・最終レベル境界を test で網羅 |
| Type Safety | OK。`remainingMs: number \| null` を必須 prop 化し typecheck が 3 消費側の結線漏れを検出。`any` なし |
| Pattern Compliance | OK。pure helper は timer.ts に集約・hook/repository から import。Timestamp.fromMillis は `finishTournament` の client Timestamp 先例に準拠。error-logging / firebase-patterns 規約遵守 |
| Security | OK。秘密情報なし。firestore.rules 無変更で、computed Timestamp 書込は既存 `isOrganizer` rule（値・request.time 制約なし）で許可済み |
| Performance | OK。effect は tick 毎（1s）に再評価されるが early return で軽量。re-subscribe / 余計な write なし |
| Completeness | OK。新規 helper 2 つに characterization test 13 件、hook の levelUp describe を remainingMs 駆動に全書換（30 件）、auto tx の決定論的 levelStartedAt assert 追加。skip / disable なし |
| Maintainability | OK。`lastLevelChangeKind` は孤児化するが診断用ラベルとして残置（schema 維持・stale コメント更新済み）。リファクタ時の削除はユーザー合意済み |

## Validation Results

| Check | Result |
| --- | --- |
| Type check | Pass（tsc --noEmit エラー 0） |
| Lint | Pass（next lint 警告 0） |
| Tests | Pass（全 1461 / 対象 3 file 193 件 green） |
| Build | Pass（next build 成功） |

## Files Reviewed

- `src/lib/services/timer.ts` — Modified（pure helper 2 つ追加）
- `src/lib/services/timer.test.ts` — Modified（test +13）
- `src/lib/hooks/useAudioPlayer.ts` — Modified（トリガ置換・prevLevelRef → playedLevelEndKeyRef）
- `src/lib/hooks/useAudioPlayer.test.tsx` — Modified（levelUp describe 全書換）
- `src/lib/firebase/repositories/tournaments.ts` — Modified（auto tx の levelStartedAt 決定論化）
- `src/lib/firebase/repositories/tournaments.test.ts` — Modified（決定論的 assert 追加）
- `src/app/tournaments/[tid]/dashboard-client.tsx` — Modified（remainingMs 結線）
- `src/app/tournaments/[tid]/live/live-client.tsx` — Modified（remainingMs 結線）
- `src/app/groups/[gid]/_components/AudioSettingsCard.tsx` — Modified（remainingMs: null 結線）
- `.claude/PRPs/.../prds/06-second-dryrun-improvements.prd.md` — Modified（Phase 4 を complete に）

## 残作業（merge ブロックではない）

- 実機 Manual Validation: レベル終了瞬間の即時再生 / 二重再生なし / 手動・seating→running 無音 /
  finished 無音 / 2秒飛び体感解消 / auto-advance で permission-denied が出ないこと
