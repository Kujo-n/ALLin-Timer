# Local Review: Phase 3 未コミット変更

**Reviewed**: 2026-04-20
**Branch**: feature-phase3
**Decision**: APPROVE with recommended fixes (1 HIGH / 5 MEDIUM / 3 LOW)

## Summary

Phase 3（タイマー／リアルタイム同期／/live ビューア）の実装とテスト追加（計 26 ファイル）をレビュー。
機能は計画通りに組まれ、pure 関数・repository・hook・UI の層分離が明快。テストカバレッジも
lib 層 92.72% で基準を超過。**重大な security / correctness バグなし**、CRITICAL なし。
HIGH は 1 件（auto-advance の無駄な書込試行）。MEDIUM は UX と a11y の 5 件で、機能ブロックではない。
マージ前の必須修正は 1 点（H1）のみ推奨。

## Findings

### CRITICAL

None.

### HIGH

**H1 — `DashboardClient.canManage` が tournament の group を見ていない**
- **File**: [src/app/tournaments/[tid]/dashboard-client.tsx:34,43](src/app/tournaments/[tid]/dashboard-client.tsx#L34)
- **Issue**: `canManage = !!user && groupIds.length > 0` は「ユーザがいずれかの group に所属」の判定であり、**今回の tournament の `groupId` に属しているか**の判定になっていない。この値で `autoAdvance` を hook に渡しているため、別 group に所属する運営者の端末が残り 0 秒到達時に `advanceLevel` transaction を試みる。Firestore rule が `permission-denied` で止めるので実害（二重進行）はないが、
  - 毎 tick ごとに失敗 transaction が発生
  - `logger.warn("レベル進行に失敗しました", { code: "firestore/write_failed" })` が大量に出る
  - Firestore の rule evaluation クォータを消費（20 人 × 月 1-2 回では無視可だが好ましくない）
- **Fix（推奨）**: `useTournamentTimer` 内の auto-advance useEffect にガードを追加:
  ```ts
  // src/lib/hooks/useTournamentTimer.ts:100 付近
  if (!auto.userGroupIds.includes(tournament.groupId)) return;
  ```
  もしくは dashboard 側で `data` が解決してから `isMember` で gating（hook を 2 回呼び分けられないため、hook 内ガードの方が自然）。
- **Severity**: HIGH — 顕在的な correctness バグではないが、運用ログノイズと無駄な書込試行が発生するため merge 前の修正が望ましい。

### MEDIUM

**M1 — `[終了]` ボタンに確認ダイアログがない**
- **File**: [src/components/tournament/TimerControls.tsx:120-129](src/components/tournament/TimerControls.tsx#L120-L129)
- **Issue**: 1 クリックで `state=finished` になり、トーナメントは再開不可（repo には `reopen` 関数なし）。`[削除]` は dialog で守られているのに、`[終了]` は素の `onClick` のみ。誤タッチで即時終了のリスクあり。
- **Fix**: dashboard の delete confirm dialog と同じ pattern で `[終了]` にも confirm を付ける。

**M2 — `getRemainingMs` の上限クランプなし**
- **File**: [src/lib/services/timer.ts:54,59](src/lib/services/timer.ts#L54)
- **Issue**: `Math.max(0, durationMs - elapsed)` は下限 0 で clamp するが、`elapsed < 0`（levelStartedAt が未来時刻で pausedAccumMs が大きい等、理論上のみ）だと `durationMs - elapsed > durationMs` になり、duration を超える値を返す。実運用で Firestore serverTimestamp 同士の大小逆転は起きないが、防衛的には `Math.min(durationMs, Math.max(0, ...))` が安全。
- **Fix**: 1 行追加（robustness 向上、実害はほぼない）。

**M3 — ConnectionBadge の `aria-live="polite"` が頻繁にアナウンスされる**
- **File**: [src/components/tournament/ConnectionBadge.tsx:25](src/components/tournament/ConnectionBadge.tsx#L25)
- **Issue**: `lastSyncAt` はサーバ snapshot 受信ごとに更新され、その都度スクリーンリーダーが時刻を読み上げる。ニュースなのは online ↔ offline の遷移だけ。
- **Fix**: `aria-live` をトーン切替部のみに絞る、または `aria-atomic="false"` + 時刻部分は `aria-hidden="true"` にする。

**M4 — `<time>` に `dateTime` 属性がない**
- **File**: [src/components/tournament/ConnectionBadge.tsx:35](src/components/tournament/ConnectionBadge.tsx#L35)
- **Issue**: `<time>` 要素は機械可読な `dateTime="…ISO…"` 属性を持つべき（HTML 仕様）。
- **Fix**: `<time dateTime={lastSyncAt ? new Date(lastSyncAt).toISOString() : undefined}>{formatTime(lastSyncAt)}</time>`

**M5 — PlayerList の手動リロードボタンが subscribe と race する可能性**
- **File**: [src/components/tournament/PlayerList.tsx:50-63,87-96](src/components/tournament/PlayerList.tsx#L50-L63)
- **Issue**: subscribe で自動更新するのに加え、`listPlayers` を呼ぶ reload ボタンが残存。両者の戻り順次第で一瞬古い state が見える可能性あり（低頻度）。コメントで debug 用と説明しているが、通常ユーザには混乱の元。
- **Fix**: リロードボタンを削除する。あるいは `disabled={true}` でラベル「リアルタイム同期中」のみ表示にする。

### LOW

**L1 — `seating` state の取り扱い**
- **File**: [src/components/tournament/TimerControls.tsx:74-130](src/components/tournament/TimerControls.tsx#L74-L130)
- **Issue**: `seating` は Phase 4 で使う state。現在コードは `setup` / `finished` / それ以外（= running / paused / seating）で分岐し、`seating` 中は pause/resume は出ないが revert/advance/finish は出る。Phase 4 で明示的に対処が必要。
- **Fix**: Phase 4 で対応。現時点では動作に影響なし。

**L2 — `advanceInflightRef` が `tid` 変更時にリセットされない**
- **File**: [src/lib/hooks/useTournamentTimer.ts:46,100](src/lib/hooks/useTournamentTimer.ts#L46)
- **Issue**: ref は useEffect の依存配列に関係なくライフタイム持続する。`tid` が変わると subscribe は張り直されるが、inflight フラグは前の tournament の transaction 完了待ちのまま残る。現在のアプリフローでは `tid` は URL から固定なので実害なし。
- **Fix**: `useEffect(() => { advanceInflightRef.current = false; }, [tid])` を足すと堅牢。

**L3 — TimerControls の `disabled={busy !== null}` で全ボタン無効化**
- **File**: [src/components/tournament/TimerControls.tsx:103,114,123](src/components/tournament/TimerControls.tsx#L103)
- **Issue**: 1 つの操作中に他の全ボタンが無効化される。保守的で安全だが、pause 中に revert も止まるなど UX がやや固い。
- **Fix**: 操作ごとに individual ref / busy state を持つか、現状維持（シンプル優先）。

## Validation Results

| Check      | Result                  |
| ---------- | ----------------------- |
| Type check | Pass                    |
| Lint       | Pass（warning 0）       |
| Tests      | Pass（170 / 170）       |
| Coverage   | Pass（lib 92.72% lines / 88.84% branches / 87.5% functions）|
| Build      | Pass（Phase 3 直後に確認済み）|

## Files Reviewed

### 新規

- `src/lib/services/timer.ts` — pure functions（getLevelInfo / getRemainingMs / shouldAutoAdvance）
- `src/lib/services/timer.test.ts` — 19 tests
- `src/lib/services/auth-actions.test.ts` — 44 tests
- `src/lib/hooks/useTournamentTimer.ts` — subscribe + tick + auto-advance
- `src/lib/firebase/repositories/tournaments.test.ts` — 44 tests
- `src/components/tournament/ConnectionBadge.tsx`
- `src/components/tournament/TimerDisplay.tsx`
- `src/components/tournament/TimerControls.tsx`
- `src/app/tournaments/[tid]/live/page.tsx`
- `src/app/tournaments/[tid]/live/live-client.tsx`
- `.claude/PRPs/reports/phase-3-timer-realtime-viewer-report.md`
- `.claude/PRPs/plans/completed/phase-3-timer-realtime-viewer.plan.md`（移動）

### 変更

- `src/lib/firebase/schemas/tournament.ts` — timer fields 追加
- `src/lib/firebase/schemas/index.test.ts` — 新フィールド test 追加
- `src/lib/firebase/repositories/tournaments.ts` — Phase 3 state 遷移関数追加
- `src/lib/firebase/repositories/players.ts` — subscribePlayers 追加
- `src/lib/firebase/client.ts` — persistentLocalCache 有効化
- `src/lib/services/receipt.test.ts` — makeTournament に timer fields 追加
- `src/components/tournament/PlayerList.tsx` — subscribePlayers に切替
- `src/app/tournaments/[tid]/dashboard-client.tsx` — useTournamentTimer + Timer UI
- `src/app/join/[tid]/join-client.tsx` — /live 導線追加
- `vitest.config.ts` — coverage scope 設定
- `package.json` / `package-lock.json` — @vitest/coverage-v8 追加
- `CLAUDE.md` / `.claude/PRPs/prds/allin-timer.prd.md` — Phase 3 完了反映

## 推奨マージ前アクション

1. **H1 修正（必須）** — useTournamentTimer に group 所属ガード追加
2. **M1 修正（強く推奨）** — `[終了]` に confirm dialog 追加（ユーザフィードバックで壊れる前に）
3. **M3/M4（a11y 向上）** — ConnectionBadge の aria 調整
4. **M5（UX ノイズ減）** — PlayerList のリロードボタン整理
5. **M2/L1/L2/L3** — 優先度低、次リリースで対応可

修正完了後、Vercel preview で Task 16 E2E シナリオを実施。
