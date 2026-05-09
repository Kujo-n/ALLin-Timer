# Architect Refactor Plan — 04-spectate-mode 周辺＋全体横断（2026-05-10）

review: [.claude/PRPs/04-spectate-mode/reviews/architect-refactor-20260510.md](../reviews/architect-refactor-20260510.md)

## 全体方針

- 観測可能な動作変更は 0（純粋な内部リファクタ）
- 1 タスク = 1 commit。各 commit で typecheck / lint / unit が green
- E2E は タスク群完了後にまとめて実行（中間 commit ごとには走らせない、`testing.md` 規約に従う）
- 各タスクで「どのテストが安全網か」を明示

## タスク一覧（優先順）

### Task 1: `assertOrganizer` / `assertOwner` の export 化と局所コピー撤去

- finding: #3
- 対象:
  - `src/lib/services/group.ts:208-218` — `assertOwner` / `assertOrganizer` を `export function` に変更
  - `src/lib/services/tournament.ts:39-43` — 局所コピーを削除し、`import { assertOrganizer } from "@/lib/services/group"` を追加
- 期待される diff: ~10 行
- 安全網: `src/lib/services/group.test.ts`（assert 経路を間接カバー）、`SpectateModeCard.test.tsx`（setSpectateEnabled の error path）
- 動作変更: 0（同一の error code / message）
- commit メッセージ案: `refactor(group/tournament): assertOwner / assertOrganizer を export し tournament.ts の局所コピーを撤去`

### Task 2: service layer の `tournament.state ===` を helper 経由に置換

- finding: #1（A-1）
- 対象:
  - `src/lib/services/timer.ts`:
    - L44: `tournament.state === "setup" || tournament.state === "seating"` → `isBeforeStart(tournament)`
    - L47: `tournament.state === "finished"` → `isFinished(tournament)`
    - L52: 同上
    - L59: `tournament.state === "paused"` → `isPaused(tournament)`
    - L83-84: `isRunningOrPaused = isInProgress(tournament)`、`isFinished = isFinished(tournament)` （local 名前衝突は変数名を `tournamentIsFinished` 等に変更）
    - L159-161: `isBeforeStart(tournament) || isFinished(tournament)`
    - L195: `!isRunning(tournament)`
  - `src/lib/services/receipt.ts`:
    - L20: `isFinished(t)`
    - L26-27: `isInProgress(t) && t.currentLevel > t.lateEntryDeadlineLevel`
- 期待される diff: timer.ts ~20 行、receipt.ts ~5 行
- 安全網: `tournament-state.test.ts`（80+ 件）、`timer.test.ts`、`receipt.test.ts`（テストの直接編集はしない）
- 動作変更: 0（helper の戻り値は `state ===` と同値）
- commit メッセージ案: `refactor(timer/receipt): tournament.state 直接比較を tournament-state helper 経由に統一`

### Task 3: TimerDisplay / TimerControls の `tournament.state ===` を helper 経由に置換

- finding: #1（A-2）
- 対象:
  - `src/components/tournament/TimerDisplay.tsx:29-37` — 三項演算子 chain を `isPaused(t) → isFinished(t) → isRunning(t) → isBeforeStart(t)` の順に書き換え
  - `src/components/tournament/TimerControls.tsx:134, 148, 162` — `isSetup(t)` / `isSeating(t)` / `isFinished(t)` に置換
- 期待される diff: ~15 行
- 安全網: `TimerDisplay.test.tsx`、`TimerControls.test.tsx`（あれば）/ E2E `timer-control-polish.spec.ts`
- 動作変更: 0
- commit メッセージ案: `refactor(timer-display/timer-controls): tournament.state 直接比較を tournament-state helper に統一`

### Task 4: live-client / dashboard-client / spectate-client の `tournament.state ===` を helper 経由に置換

- finding: #1（A-3 / A-4 / A-5）
- 対象:
  - `src/app/tournaments/[tid]/live/live-client.tsx:266-269` — `(isBeforeStart(tournament) || isRunning(tournament)) && !lateEntryClosed` 等価式
  - `src/app/tournaments/[tid]/live/live-client.tsx:335` — `isBeforeStart(tournament)` に置換
  - `src/app/tournaments/[tid]/dashboard-client.tsx:108` — `useWakeLock(isRunning(data))` に置換（data が null のとき false を返す既存挙動を保持）
  - `src/app/tournaments/[tid]/dashboard-client.tsx:370` — `{isRunning(data) ? <DeviceFallbackHints ... /> : null}`
  - `src/app/tournaments/[tid]/dashboard-client.tsx:557` — Dialog の文言分岐は `isSetup(data)` に置換
  - `src/app/spectate/[tid]/spectate-client.tsx:200, 210` — `SpectateLateEntryBanner` 内 `isFinished(tournament)` / `isBeforeStart(tournament)` に置換
- 期待される diff: ~25 行
- 安全網: 全 component の単体 test、E2E `spectate-mode.spec.ts` / `winner-banner-and-auto-finish.spec.ts` / `dashboard-polish.spec.ts`
- 動作変更: 0
- commit メッセージ案: `refactor(client): tournament.state 直接比較を tournament-state helper に統一 (live/dashboard/spectate)`

### Task 5: spectate-client の subscribe onError 3 重複を local helper で集約

- finding: #2
- 対象: `src/app/spectate/[tid]/spectate-client.tsx:50-104`
- 変更:
  - file 上部に `function handleSpectateSubscribeError(err: AppError, scope: "tournament" | "players" | "tables", tid: string, setSpectateEnded: (v: boolean) => void)` を追加
  - 3 つの useEffect から呼び出し、permission-denied 検知ロジックを集約
- 期待される diff: ~30 行（除去 + 追加）
- 安全網: `spectate-client.test.tsx` の 3 件の permission-denied 経路テスト
- 動作変更: 0
- commit メッセージ案: `refactor(spectate-client): subscribe onError 3 重複を helper に集約 (permission-denied → spectateEnded)`

### Task 6: rule の tournaments allow update 右側 dead branch を整理

- finding: #6 / #8
- 対象: `firestore.rules:418-435`
- 変更（方針 1: 削除 + コメント更新）:
  - 経路 B（右側 OR）を削除
  - 経路 A に `request.resource.data.spectateEnabled is bool` の単独制約は追加しない（zod が同制約を強制中、現状の挙動を維持）
  - コメント更新: 「Phase 1 (04-spectate-mode) で経路 B を試作したが redundant のため経路 A に統合」
- 期待される diff: ~12 行（rule 削除 + コメント書き直し）
- 安全網: `scripts/test-rules-spectate.mjs` 全 16 ケース。**ケースを変更しない**（観測動作が変わらないことの保証）
- 動作変更: 0（rule の挙動は完全に同じ）
- 別件: 本変更後、本番 Firestore にも `firebase deploy --only firestore:rules` が必要。Phase 5 で運用上の deploy 案内を出す。
- commit メッセージ案: `refactor(rules): tournaments allow update 右側 dead branch を撤去 (経路 A に統合)`

### Task 7: SpectateLateEntryBanner を `_components/` に co-location

- finding: #4
- 対象:
  - 新規: `src/app/spectate/[tid]/_components/SpectateLateEntryBanner.tsx`
  - 修正: `src/app/spectate/[tid]/spectate-client.tsx`（function 削除 + import 追加）
- 期待される diff: file 移動 ~62 行 + import 1 行
- 安全網: `spectate-client.test.tsx`（banner の文言検証は spectate-client 経由で保たれる）/ E2E `spectate-mode.spec.ts`
- 動作変更: 0
- commit メッセージ案: `refactor(spectate): SpectateLateEntryBanner を _components/ に co-location`

### Task 8: `formatErrorForDisplay` helper を追加し `${code}: ${message}` 重複を集約

- finding: #5（ユーザー判断で in-scope に追加）
- 対象:
  - 追加: `src/lib/errors.ts` に `formatErrorForDisplay(err: { code: string; message: string }): string` を export（実装は `\`${err.code}: ${err.message}\``）
  - callsites (~57 箇所 / 30+ files): `\`${wrapped.code}: ${wrapped.message}\`` パターンを `formatErrorForDisplay(wrapped)` に置換
  - 主な対象 file:
    - `src/lib/hooks/useManualSeatChange.ts`, `src/lib/hooks/useInlineNumberEdit.ts`
    - `src/components/tournament/*.tsx`（BustButton / BalancingInstructionCard / SeatingBoard / SpectateModeCard / TimerControls / TournamentForm / AppendLevelDialog / PlayerList / _table-label-edit/*）
    - `src/components/auth/*.tsx`, `src/components/structure/*.tsx`
    - `src/app/groups/**/*.tsx`, `src/app/tournaments/**/*.tsx`, `src/app/structures/**/*.tsx`, `src/app/templates/**/*.tsx`
    - `src/app/login/login-client.tsx`, `src/app/join/[tid]/join-client.tsx`, `src/app/settings/settings-client.tsx`, `src/app/debug/fs/debug-fs-client.tsx`
- 期待される diff: helper 追加 ~6 行 + callsites 置換 ~57 行（出力 byte-identical）
- 安全網: 既存 unit test の error message regex / 文字列マッチが通ることを確認
- 動作変更: 0（出力 string が同一）
- commit メッセージ案: `refactor(errors): formatErrorForDisplay helper で \`${code}: ${message}\` 重複を集約 (57 callsite)`

## 実行順序の理由

1. **Task 1 (assertOrganizer)** を最初に — 単独で完結し他のタスクとの依存無し。最小 diff で価値高い
2. **Task 2 (service layer)** — 純関数なので動作変更リスク最小。component layer に進む前の足場
3. **Task 3 (Timer components)** — service layer 完了後、UI 一段目
4. **Task 4 (page client)** — Timer components 完了後、UI 二段目（より大きい影響範囲）
5. **Task 5 (spectate onError)** — Task 4 と同じ file を触るが論理的に独立。Task 4 後に実施
6. **Task 6 (rule cleanup)** — 他のタスクと完全独立。実装層が緑になった後に rule を整理
7. **Task 7 (co-location)** — Task 5 で spectate-client.tsx を最後に触ったあと、構造整理

## 検証戦略

- 各 Task 完了時:
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`
  - 各 task 完了で commit、push しない
- Task 6（rule 変更）完了時のみ追加で:
  - `npm run test:rules-spectate`（emulator 起動 + 16 ケース）
  - `npm run test:rules-limits`（drift detection）
- 全 Task 完了後（Phase 5）:
  - dev server / emulator が落ちていることを確認後 `npm run build`
  - `npm run test:e2e` フルパス（27 specs）

## 不変条件再確認

- ✅ 観測可能な動作変更 0（cancellation policy 通り）
- ✅ 既存テストへの skip / disable は無し
- ✅ 公開 API / Firestore スキーマの破壊的変更無し（`groups/{gid}` / `tournaments/{tid}` のフィールド追加削除なし）
- ✅ 各 Task は 1 commit に収まる粒度（最大 ~30 行 / 最小 ~10 行）
- ✅ ルールと PRD の方針に沿う（`refactor-conventions.md` の集約先に揃える）

## 推定影響範囲

| 層 | ファイル数 | 推定 LoC 変動 |
|---|---|---|
| service / pure | 3（timer, receipt, tournament-state は変更なし） | ~30 行 |
| component | 5（TimerDisplay, TimerControls, live-client, dashboard-client, spectate-client） | ~50 行 |
| 構造移動 | 1（SpectateLateEntryBanner co-location） | ~63 行 移動 |
| rule | 1（firestore.rules） | ~12 行 |
| Task 8（`formatErrorForDisplay`） | 30+ files / 57 callsites | ~63 行 |
| **合計** | **40+ files** | **~218 行 修正 / 移動** |

## ユーザー承認待ち事項

以下の点を確認してから Phase 4 に進む:

1. このタスク分解で進めて良いか
2. Task 6（rule 削除）は `firestore.rules` の挙動を変えないが、本番に deploy する必要がある（emulator green では足りない）。`firebase deploy --only firestore:rules` 実行は Phase 5 完了報告に含めるか、本 PR 完了後に運営者に手動で促すか
3. finding-5（`${err.code}: ${err.message}` formatter）と finding-7（input validation）は今回見送りで OK か
4. E2E ベースラインがまだ走行中。完了確認後に Phase 4 着手で良いか
