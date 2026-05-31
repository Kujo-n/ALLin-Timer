# Plan: 音声タイミング（ローカル残り0検知）＋タイマー2秒飛び緩和

## Summary

ブラインドアップ音のトリガを「`currentLevel` 変化（Firestore 往復後）」から「ローカルで残り 0 を検知した瞬間」に変更し、Firestore 往復遅延の影響を受けずレベル終了と同時に音を鳴らす（要望④）。あわせてレベル遷移時に発生する「タイマー2秒飛び」の原因（`levelStartedAt` を commit 時刻で stamp することによる往復遅延の吸収漏れ）を特定し、auto-advance のレベル開始時刻を構造定義から決定論的に算出して書き込むことで緩和する（要望⑤）。④⑤は密結合のため同一 PR で扱う。

## User Story

As a トーナメント運営者,
I want レベル終了の瞬間にブラインドアップ音が鳴り、レベル切替時にタイマーが不自然に飛ばないこと,
So that 会場で正確なタイミングのアナウンスができ、参加者がブラインド変更を聞き逃さない。

## Problem → Solution

- **現状④**: ブラインドアップ音は auto-advance の transaction が commit → `onSnapshot` で `currentLevel` 変化が届いて初めて鳴る。Firestore 往復（1〜2 秒）ぶん遅れる。
- **解決④**: ローカルの `remainingMs <= 0` 検知で即 `void play()`。各端末が自分のクロックでレベル終了を検知して鳴らすため往復遅延ゼロ。二重再生は `levelStartedAt` をキーにした ref ガードで防止。
- **現状⑤**: `levelTransitionUpdates` が新レベルの `levelStartedAt: serverTimestamp()` を **transaction commit 時刻**で stamp する。auto-advance は残り 0（= 前レベルの理想終了時刻）で発火するが、commit はそこから往復遅延ぶん後になる。新 snapshot が端末に戻って render される頃には更にラグが乗り、新レベルが「最初の約 2 秒を飛ばした状態」で表示される。
- **解決⑤**: auto-advance の transaction 内で、新レベルの `levelStartedAt` を **決定論的な理想終了時刻**（`前レベル levelStartedAt + 前レベル durationMs + pausedAccumMs`）として `Timestamp.fromMillis(...)` で書き込む。レベル境界を構造定義に固定し、往復遅延を吸収しないようにする。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/06-second-dryrun-improvements/prds/06-second-dryrun-improvements.prd.md](../prds/06-second-dryrun-improvements.prd.md)
- **PRD Phase**: Phase 4「音声タイミング＋タイマー2秒飛び（要望④⑤）」
- **Estimated Files**: 7（実装 4 + テスト 3）

---

## UX Design

### Before

```
レベル終了（残り0）
   │  ← auto-advance tx を発火
   │  ……Firestore 往復（1〜2秒）……  ← この間は無音
   ▼
currentLevel 変化が snapshot で届く
   ▼
ここで初めてブラインドアップ音 ♪（1〜2秒遅れ）
   ＋ 新レベルのタイマーが 10:00 ではなく 9:58 から表示（2秒飛び）
```

### After

```
レベル終了（残り0）
   ▼
即ブラインドアップ音 ♪（ローカル検知・往復待ちなし）
   │  ← auto-advance tx を発火（音とは独立）
   ▼
currentLevel 変化が snapshot で届く
   ▼
新レベルのタイマーが構造定義どおり 10:00 から表示（飛びなし）
   ＊ 既に鳴らした音は ref ガードで二重再生しない
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| ブラインドアップ音の発火点 | `currentLevel` 変化（snapshot 受信後） | ローカル `remainingMs <= 0` 検知 | 運営者ロール / enabled / unlocked の gate は不変 |
| 手動「次/前レベル」での音 | 鳴らさない（`lastLevelChangeKind === "manual"` で抑止） | 鳴らさない（手動遷移は残り 0 を経由しないため自然に無音） | 抑止ロジックが ref/state ベースから「残り 0 を経由するか」へ移る |
| seating→running 開始時の音 | 鳴らさない（`prev === 0` ガード） | 鳴らさない（running 開始直後は残り full > 0） | 自然に無音 |
| finished 表示時の音 | 鳴らさない | 鳴らさない（`isRunning` false） | 据え置き |
| 最終レベル終了 | 鳴らさない（次がなく auto-advance しない） | 鳴らさない（次レベルが無いとき抑止） | `shouldPlayLevelEndSound` で明示ガード |
| レベル切替時のタイマー表示 | 約2秒飛ぶ | 構造定義どおり連続 | auto-advance の online 経路のみ。offline fallback / 手動は据え置き |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [src/lib/hooks/useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) | 166-211 | 既存の levelUp（currentLevel 変化）/ winner 検知 effect。④で levelUp effect を置換する |
| P0 (critical) | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | 46-76, 195-202 | `getRemainingMs` / `shouldAutoAdvance`。新規 pure helper をここに追加し、同じガード条件を踏襲 |
| P0 (critical) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 410-523 | `levelTransitionUpdates` / `advanceLevel`。⑤で auto-advance tx 経路の `levelStartedAt` を決定論的値に変更 |
| P1 (important) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 738-743 | `finishTournament` が tx 内で `serverTimestamp()` ではなく client `Timestamp.now()` を使う先例。決定論的 Timestamp 書込の前例として踏襲 |
| P1 (important) | [src/lib/hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) | 144-398 | levelUp 検知の既存テスト群。新トリガ（remainingMs 推移）へ振る舞いを保ったまま書換える |
| P1 (important) | [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | 497-554 | advanceLevel auto tx の mock harness（tx.update payload を capture）。⑤の assertion を追加 |
| P1 (important) | [src/lib/services/timer.test.ts](../../../../src/lib/services/timer.test.ts) | 1-52, 288-328 | fixture factory `makeTournament` / `shouldAutoAdvance` テスト。新 helper の characterization test を追加 |
| P2 (reference) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 82-91, 183-189 | `useTournamentTimer` の `remainingMs` と `useAudioPlayer` 呼出。新 prop を結線 |
| P2 (reference) | [src/app/tournaments/[tid]/live/live-client.tsx](../../../../src/app/tournaments/[tid]/live/live-client.tsx) | 46-47, 105-113 | live でも同 hook を使う。同じく `remainingMs` を結線（参加者は role gate で無音だが API 一貫性のため渡す） |
| P2 (reference) | [src/components/tournament/TimerDisplay.tsx](../../../../src/components/tournament/TimerDisplay.tsx) | 20-28 | `formatRemaining` は `Math.floor(ms/1000)`。tick 解像度仮説の検証用（⑤調査） |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | all | repository 変更時の wrap / rule 整合の規約 |
| P2 (reference) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | logger / AppError 規約（既存 play() の catch を踏襲） |
| P2 (reference) | [.claude/rules/testing.md](../../../rules/testing.md) | all | characterization first / fixture factory / mock 境界 / skip 禁止 |

## External Documentation

No external research needed — feature uses established internal patterns（Firestore Timestamp / React hook effect / vitest renderHook）。

---

## Patterns to Mirror

### NAMING_CONVENTION（pure helper・timer service）

```ts
// SOURCE: src/lib/services/timer.ts:195-202
export function shouldAutoAdvance(tournament: TournamentDoc, nowMs: number): boolean {
  if (!isRunning(tournament)) return false;
  if (tournament.levelStartedAt === null) return false;
  const remaining = getRemainingMs(tournament, nowMs);
  if (remaining === null) return false;
  if (remaining > 0) return false;
  return tournament.currentLevel < tournament.structureSnapshot.levels.length;
}
```

### EFFECT_TRIGGER_PATTERN（前回値 ref で遷移検知・二重再生抑止）

```ts
// SOURCE: src/lib/hooks/useAudioPlayer.ts:201-211（winner 検知）
useEffect(() => {
  if (!tournament) return;
  const w = resolveWinner(tournament, players);
  const wid = w?.id ?? null;
  const prev = prevWinnerIdRef.current;
  prevWinnerIdRef.current = wid;
  if (isFinished(tournament)) return;
  if (prev === null && wid !== null) {
    void play(group?.audioSettings.winnerSoundId ?? "default:victory-chime");
  }
}, [tournament, players, group?.audioSettings.winnerSoundId, play]);
```

### REPOSITORY_PATTERN（tx 内で client Timestamp を使う先例）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:740-743
// serverTimestamp() を tx.set フィールドに渡すと sentinel pending のまま zod の
// `instanceof(Timestamp)` validate に倒れるリスクがあるため、client clock の Timestamp.now() で固定する。
const finishedAtClient = Timestamp.now();
```

### REPOSITORY_PATTERN（level 遷移 update の共通 helper）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:410-424
function levelTransitionUpdates(
  prevState: TournamentDoc["state"],
  newCurrentLevel: number,
  kind: "auto" | "manual",
): Record<string, unknown> {
  const isPaused = prevState === "paused";
  return {
    currentLevel: newCurrentLevel,
    levelStartedAt: serverTimestamp(),
    pausedAt: isPaused ? serverTimestamp() : null,
    pausedAccumMs: 0,
    lastLevelChangeKind: kind,
    updatedAt: serverTimestamp(),
  };
}
```

### TEST_STRUCTURE（fixture factory + remainingMs 駆動の renderHook）

```ts
// SOURCE: src/lib/hooks/useAudioPlayer.test.tsx:144-153
interface RenderArgs {
  tournament: TournamentDoc | null;
  group: GroupDoc | null;
  players: readonly PlayerDoc[];
  role: AudioRole;
  // ← 追加: remainingMs: number | null
}
function renderAudioPlayer(initial: RenderArgs) {
  return renderHook((args: RenderArgs) => useAudioPlayer(args), { initialProps: initial });
}
```

### TEST_STRUCTURE（advanceLevel auto tx payload capture）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:543-553
it("commits update when expected matches and not on final level", async () => {
  let captured: Record<string, unknown> | null = null;
  mockTransaction(makeTournament({ currentLevel: 1 }), (p) => {
    captured = p as Record<string, unknown>;
  });
  await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 });
  expect(captured!.currentLevel).toBe(2);
  expect(captured!.lastLevelChangeKind).toBe("auto");
});
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/services/timer.ts` | UPDATE | 純関数 `shouldPlayLevelEndSound` / `computeAutoAdvanceLevelStartMs` を追加 |
| `src/lib/services/timer.test.ts` | UPDATE | 上記 2 関数の characterization test を追加 |
| `src/lib/hooks/useAudioPlayer.ts` | UPDATE | `remainingMs` prop 追加・levelUp effect をローカル残り0検知に置換・古い currentLevel effect / `prevLevelRef` 削除 |
| `src/lib/hooks/useAudioPlayer.test.tsx` | UPDATE | levelUp describe ブロックを remainingMs 駆動に書換（振る舞いは維持） |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | auto-advance tx の `levelStartedAt` を決定論的 `Timestamp.fromMillis(...)` に変更 |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATE | auto tx が決定論的 `levelStartedAt` を書くことを assert |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `useAudioPlayer` 呼出に `remainingMs` を渡す |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 同上 |

## NOT Building

- `firestore.rules` の変更（`tournaments` update は `isOrganizer` のみで `levelStartedAt` の値・`request.time` 制約は無い。computed Timestamp 書込は現行 rule で許可済み）
- schema（`tournament.ts`）変更（新フィールドなし。`lastLevelChangeKind` も維持）
- offline `updateDoc` fallback 経路（tournaments.ts:493-499）の `levelStartedAt` 変更（offline は client `t` が catch スコープ外で、タイミング semantics も既に degraded。online tx 経路のみ対象）
- 手動 advance / revert の `levelStartedAt` 変更（手動は「今」開始が正しいので `serverTimestamp()` 据え置き）
- 1 秒 tick 解像度そのものの変更（`useTournamentTimer` の setInterval は据え置き。調査結果次第で別 Phase）
- 音声プリロード / Web Audio バッファ化（今回は HTMLAudioElement のまま）

---

## Step-by-Step Tasks

### Task 1: timer.ts に pure helper を 2 つ追加（characterization first）

- **ACTION**: `src/lib/services/timer.ts` に `shouldPlayLevelEndSound` と `computeAutoAdvanceLevelStartMs` を追加。
- **IMPLEMENT**:
  ```ts
  /**
   * ブラインドアップ音をローカルで鳴らすべきか（要望④）。
   * 条件は shouldAutoAdvance と同一: running + levelStartedAt 確定 + 残り <= 0 + 次レベルあり。
   * 「auto-advance が妥当な瞬間 = レベル終了の瞬間」と意味的に一致させる。
   * 最終レベルの終了（次がない）は「ブラインドアップ」ではないため鳴らさない。
   */
  export function shouldPlayLevelEndSound(
    tournament: TournamentDoc,
    remainingMs: number | null,
  ): boolean {
    if (!isRunning(tournament)) return false;
    if (tournament.levelStartedAt === null) return false;
    if (remainingMs === null) return false;
    if (remainingMs > 0) return false;
    return tournament.currentLevel < tournament.structureSnapshot.levels.length;
  }

  /**
   * auto-advance 時、新レベルの決定論的な開始時刻 ms（要望⑤・2秒飛び緩和）。
   * = 現レベルの理想終了時刻 = levelStartedAt + 現レベル durationMs + pausedAccumMs。
   * commit 時刻（serverTimestamp）で stamp すると往復遅延ぶん新レベルが飛ぶため、
   * 構造定義に固定したこの値を Timestamp.fromMillis で書く。
   */
  export function computeAutoAdvanceLevelStartMs(tournament: TournamentDoc): number {
    const info = getLevelInfo(tournament);
    const durationMs = (info?.current.durationSec ?? 0) * 1000;
    const startMs = tournament.levelStartedAt?.toMillis() ?? 0;
    const accum = tournament.pausedAccumMs ?? 0;
    return startMs + durationMs + accum;
  }
  ```
- **MIRROR**: `shouldAutoAdvance`（timer.ts:195-202）のガード並び。
- **IMPORTS**: 既存の `isRunning` / `getLevelInfo` は同ファイル内。追加 import 不要。
- **GOTCHA**: `shouldPlayLevelEndSound` は `nowMs` ではなく `remainingMs` を引数に取る（hook 側が既に `remainingMs` を持つため）。`shouldAutoAdvance` と条件が重複するが、入力が違う（nowMs vs remainingMs）ので別関数として残す。
- **VALIDATE**: 次タスクのテストが green。

### Task 2: timer.test.ts に characterization test を追加

- **ACTION**: `src/lib/services/timer.test.ts` に 2 つの describe を追加。
- **IMPLEMENT**:
  - `describe("shouldPlayLevelEndSound")`:
    - running + remaining 0 + 次レベルあり → true
    - running + remaining 1 → false
    - running + remaining null → false
    - paused / setup / seating / finished → false（remaining 0 でも）
    - levelStartedAt null → false
    - 最終レベル（currentLevel === levels.length）+ remaining 0 → false
  - `describe("computeAutoAdvanceLevelStartMs")`:
    - `levelStartedAt=t0, duration=600s, accum=0` → `t0Ms + 600_000`
    - `pausedAccumMs=30_000` → `t0Ms + 600_000 + 30_000`
- **MIRROR**: `describe("shouldAutoAdvance")`（timer.test.ts:288-328）と fixture factory `makeTournament`（timer.test.ts:19）。
- **IMPORTS**: 既存 import に新関数名を追加。
- **GOTCHA**: `makeTournament` の `structureSnapshot.levels` は 2 件想定。最終レベルケースは `currentLevel: 2`（levels.length と同じ）で組む。
- **VALIDATE**: `npm run test -- timer.test` が green。

### Task 3: useAudioPlayer.ts のトリガを置換

- **ACTION**: `useAudioPlayer` の args に `remainingMs: number | null` を追加し、levelUp effect をローカル残り0検知に置換。古い currentLevel 変化 effect（166-194）と `prevLevelRef`（88）を削除。
- **IMPLEMENT**:
  - `UseAudioPlayerArgs` に `remainingMs: number | null;` を追加（doc コメント付き）。関数 destructure に `remainingMs` を追加。
  - `prevLevelRef` を削除し、`const playedLevelEndKeyRef = useRef<number | null>(null);` を追加。
  - 旧 levelUp effect を以下に置換:
    ```ts
    // 要望④: レベル終了（ローカル残り0）の瞬間にブラインドアップ音を鳴らす。
    // currentLevel 変化（Firestore 往復後）を待たないため遅延ゼロ。
    // levelStartedAt をキーに二重再生を抑止（残り0が複数 tick 続いても 1 回）。
    // 手動遷移は残り0を経由しないため自然に無音、seating→running は残り full のため無音、
    // finished / 最終レベルは shouldPlayLevelEndSound 側で除外。
    useEffect(() => {
      if (!tournament) return;
      if (!shouldPlayLevelEndSound(tournament, remainingMs)) return;
      const key = tournament.levelStartedAt?.toMillis() ?? null;
      if (key === null) return;
      if (playedLevelEndKeyRef.current === key) return;
      playedLevelEndKeyRef.current = key;
      void play(group?.audioSettings.levelUpSoundId ?? "default:blind-up");
    }, [tournament, remainingMs, group?.audioSettings.levelUpSoundId, play]);
    ```
- **MIRROR**: winner 検知 effect（useAudioPlayer.ts:201-211）の ref-guard 構造。
- **IMPORTS**: `import { resolveWinner } from "@/lib/services/timer";` を `import { resolveWinner, shouldPlayLevelEndSound } from "@/lib/services/timer";` に拡張。
- **GOTCHA**:
  - `play` は内部で `!isOrganizer || !enabled || !unlocked` を gate するため、role / enabled / unlock の判定は effect 側で重複させない（既存 currentLevel effect と同じ前提）。
  - ref を play 前に set する（play が gate で no-op でも key を消費＝旧実装の `prevLevelRef` 更新と同じ挙動。unlock 遅れ時の取りこぼしは許容）。
  - `lastLevelChangeKind` への依存を削除する（新トリガでは参照しない）。effect deps から外す。
- **VALIDATE**: typecheck 通過。次タスクのテスト green。

### Task 4: useAudioPlayer.test.tsx の levelUp ブロックを書換

- **ACTION**: `RenderArgs` に `remainingMs: number | null` を追加し、`renderAudioPlayer` / 各呼出に渡す。`describe("useAudioPlayer — role filter")` 内の levelUp 系テストを remainingMs 推移駆動に書換。
- **IMPLEMENT**（振る舞いを維持しつつトリガを差替）:
  - 共通: 初期 `remainingMs: 5000`（running, level 1）。unlock 後に `remainingMs: 0` へ rerender して発火を観測。
  - `organizer`: 5000 → 0 で `playSpy` 1 回。
  - `member` / `null`: 5000 → 0 で 0 回。
  - `enabled:false`: 0 回。
  - unlock 前: 0 回。
  - 二重再生なし: 同 `levelStartedAt` のまま 0 → 0 を 2 連続 rerender で 1 回のみ。
  - 新レベル再発火: `levelStartedAt` を別 Timestamp + `currentLevel:2` + remaining 0 にすると再度 1 回。
  - 初回 mount（remaining 5000）では 0 回。
  - setup / seating（state 非 running）で remaining 0 でも 0 回。
  - seating→running（currentLevel 0→1, remaining full > 0）で 0 回。
  - 最終レベル（currentLevel 2 = levels.length, remaining 0）で 0 回。
  - 手動遷移相当（currentLevel 1→2, remaining は 4000 のまま > 0）で 0 回 → `lastLevelChangeKind` 依存テスト 2 件はこの「残り0を経由しない遷移は無音」テストへ置換。
- **MIRROR**: 既存 role filter テスト（useAudioPlayer.test.tsx:155-398）の構造と makeTournament factory。
- **IMPORTS**: 変更なし（同ファイル内 factory 利用）。
- **GOTCHA**:
  - `makeTournament` は `levelStartedAt: baseTimestamp`。二重再生／新レベル切替テストでは `levelStartedAt` を `Timestamp.fromMillis(baseTimestamp.toMillis() + N)` で変えてキー差を作る。
  - winner 検知 describe（400-512）と unlock / preview / pause describe は**変更不要**（remainingMs を渡していない呼出は `undefined` になるので、RenderArgs の `remainingMs` は optional にせず、それら describe の呼出にも `remainingMs: null` を明示追加する）。
- **VALIDATE**: `npm run test -- useAudioPlayer` green。

### Task 5: advanceLevel auto tx の levelStartedAt を決定論化（⑤）

- **ACTION**: `levelTransitionUpdates` に任意の開始時刻 override を受ける引数を追加し、auto-advance の transaction 経路でのみ `computeAutoAdvanceLevelStartMs(t)` を渡す。
- **IMPLEMENT**:
  - signature 拡張:
    ```ts
    function levelTransitionUpdates(
      prevState: TournamentDoc["state"],
      newCurrentLevel: number,
      kind: "auto" | "manual",
      startOverrideMs?: number,
    ): Record<string, unknown> {
      const isPaused = prevState === "paused";
      return {
        currentLevel: newCurrentLevel,
        levelStartedAt:
          startOverrideMs !== undefined
            ? Timestamp.fromMillis(startOverrideMs)
            : serverTimestamp(),
        pausedAt: isPaused ? serverTimestamp() : null,
        pausedAccumMs: 0,
        lastLevelChangeKind: kind,
        updatedAt: serverTimestamp(),
      };
    }
    ```
  - auto tx 内（tournaments.ts:458）:
    ```ts
    tx.update(
      ref,
      levelTransitionUpdates(
        t.state,
        t.currentLevel + 1,
        "auto",
        computeAutoAdvanceLevelStartMs(t),
      ),
    );
    ```
  - 手動 advance（517）と offline fallback（493-499）は **変更しない**（override 未指定 = serverTimestamp 据え置き）。
- **MIRROR**: `finishTournament` の client `Timestamp.now()` 先例（tournaments.ts:740-743）。
- **IMPORTS**: `Timestamp` は既に import 済み（tournaments.ts:12）。`computeAutoAdvanceLevelStartMs` を `@/lib/services/timer` から import 追加。
- **GOTCHA**:
  - tx 内 `t` は `loadTournamentInTx` の validated `TournamentDoc`。running 経路では `levelStartedAt` 非 null だが、helper は null フォールバックを持つので安全。
  - 端末が長時間バックグラウンド後に発火すると `startOverrideMs` が過去になり、新レベルが即残り 0 → 次 tick で連鎖 auto-advance しうる。1 tick 1 レベルで自己整合するため許容（コメントで明示）。
  - tournaments.ts:551-552 のテストコメント「useAudioPlayer がブラインドアップ音を鳴らす判定に使う」は新トリガで stale。`lastLevelChangeKind` フィールド自体は維持（schema 不変・診断用）だが、Task 6 でこのコメントを実態に合わせ更新。
- **VALIDATE**: 次タスクのテスト green。`npm run test:rules-spectate` 等の既存 rule テストは無影響（rule 未変更）。

### Task 6: tournaments.test.ts に決定論的 levelStartedAt の assert を追加

- **ACTION**: `describe("advanceLevel (auto with expectedLevel)")` に levelStartedAt の値検証を追加。
- **IMPLEMENT**:
  ```ts
  it("stamps levelStartedAt at deterministic level boundary (no 2s skip)", async () => {
    let captured: Record<string, unknown> | null = null;
    // makeTournament: levelStartedAt=t0, level1 durationSec=600, pausedAccumMs=0 を前提
    mockTransaction(makeTournament({ currentLevel: 1 }), (p) => {
      captured = p as Record<string, unknown>;
    });
    await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 });
    const ls = captured!.levelStartedAt as Timestamp;
    expect(ls.toMillis()).toBe(t0.toMillis() + 600_000);
    // serverTimestamp sentinel ではないこと
    expect(captured!.levelStartedAt).not.toEqual({ __op: "serverTimestamp" });
  });
  ```
  - 既存テスト（543-553）はそのまま green を維持（currentLevel / lastLevelChangeKind の assert は不変）。
  - 手動 advance / offline fallback の既存テスト（447-495 / 556-）は `levelStartedAt` 値を assert していない（fallback は `toHaveProperty("levelStartedAt")` のみ）ため無影響を確認。
  - tournaments.ts:551-552 のコメント文言を「auto 経路を記録（診断用ラベル。音声トリガは timer のローカル残り0検知に移行済み）」へ更新。
- **MIRROR**: tournaments.test.ts:543-553 の capture harness。`makeTournament`（同ファイル 90 付近）の `levelStartedAt` / `structureSnapshot` を確認して期待値を組む。
- **IMPORTS**: `Timestamp` は test で利用済み（`t0`）。
- **GOTCHA**: `makeTournament` の level1 `durationSec` を読んで期待値を合わせる（600 でなければ実値に合わせる）。
- **VALIDATE**: `npm run test -- tournaments.test` green。

### Task 7: 消費側（dashboard / live）に remainingMs を結線

- **ACTION**: `useAudioPlayer({...})` 呼出に `remainingMs` を渡す。
- **IMPLEMENT**:
  - dashboard-client.tsx:183-189 の `useAudioPlayer({ tournament: data, group: tournamentGroup, players, role: myRole, onError: setError })` に `remainingMs,` を追加（`remainingMs` は同 component 上部で `useTournamentTimer` から分解済み）。
  - live-client.tsx:105-113 の `useAudioPlayer({ tournament, group: tournamentGroup, players, role: audioRole, onError: setAudioError })` に `remainingMs,` を追加（同様に分解済み）。
- **MIRROR**: 既存の prop 受け渡し。
- **IMPORTS**: 不要。
- **GOTCHA**: live は role gate で実際には鳴らないが、prop は必須化したので両方に渡す（型エラー防止）。
- **VALIDATE**: `npm run build`（typecheck 込み）成功。

### Task 8: ⑤ 原因レポートを実装レポートに記載

- **ACTION**: Phase 完了時の実装レポート（`reports/` 配下、別途 `/prp-implement` 完了時に生成）に「2秒飛びの原因と緩和」節を含める。
- **IMPLEMENT**: 以下を文章化:
  - **原因**: auto-advance tx が `levelStartedAt: serverTimestamp()`（commit 時刻）で新レベルを stamp。auto-advance はローカル残り0（= 前レベル理想終了時刻）で発火するが、commit はそこから往復遅延ぶん後、新 snapshot の端末 render は更に後。差分（往復＋描画ラグ ≈ 2 秒）ぶん新レベルが進んだ状態で表示される。
  - **検証**: `getRemainingMs`（running 分岐 timer.ts:74-75）と `levelTransitionUpdates`（tournaments.ts:418）のコード追跡で確定。tick 解像度（`formatRemaining` の `Math.floor`, TimerDisplay.tsx:22）は 1 秒単位の表示丸めで、2 秒規模の飛びの主因ではない（副次的に 1 秒の前後揺れはあり得る）。
  - **緩和**: auto tx の `levelStartedAt` を `computeAutoAdvanceLevelStartMs`（前レベル理想終了時刻）で決定論化。レベル境界を構造定義に固定し往復遅延を吸収しない。
  - **残課題**: offline fallback / 端末長時間バックグラウンド後の連鎖 advance は据え置き（許容・将来 Cloud Functions 化で根本解決）。
- **VALIDATE**: レポートに上記 4 点が含まれる。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| shouldPlayLevelEndSound | running, remaining 0, 次レベルあり | true | - |
| shouldPlayLevelEndSound | running, remaining 1 | false | - |
| shouldPlayLevelEndSound | running, remaining null | false | ✓ pending write |
| shouldPlayLevelEndSound | paused/finished/setup/seating, remaining 0 | false | ✓ |
| shouldPlayLevelEndSound | 最終レベル, remaining 0 | false | ✓ |
| computeAutoAdvanceLevelStartMs | t0, dur 600s, accum 0 | t0Ms + 600000 | - |
| computeAutoAdvanceLevelStartMs | accum 30s | t0Ms + 600000 + 30000 | ✓ paused 累積 |
| useAudioPlayer levelUp | organizer, remaining 5000→0 | play 1 回 | - |
| useAudioPlayer levelUp | member/null/enabled:false/未unlock | play 0 回 | ✓ gate |
| useAudioPlayer levelUp | 同 levelStartedAt で 0→0 連続 | play 1 回 | ✓ 二重再生抑止 |
| useAudioPlayer levelUp | levelStartedAt 変化 + remaining 0 | 再度 play 1 回 | ✓ 次レベル |
| useAudioPlayer levelUp | seating→running (remaining full) | play 0 回 | ✓ 開始時無音 |
| useAudioPlayer levelUp | currentLevel 1→2 だが remaining > 0（手動相当） | play 0 回 | ✓ 手動無音 |
| advanceLevel auto tx | level1 (dur 600s) → advance | levelStartedAt.toMillis() == t0+600000 | ✓ 2秒飛び緩和 |

### Edge Cases Checklist

- [ ] remaining null（pending write / levelStartedAt 未確定）で無音
- [ ] 最終レベル終了で無音（次がない）
- [ ] 二重再生抑止（残り0が複数 tick 継続）
- [ ] role / enabled / unlock gate（既存挙動維持）
- [ ] seating→running 開始で無音
- [ ] 手動遷移で無音
- [ ] finished 表示で無音（winner 音含め既存維持）
- [ ] offline fallback / 手動 advance の levelStartedAt は serverTimestamp 据え置き（無影響）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
npx eslint src/lib/services/timer.ts src/lib/hooks/useAudioPlayer.ts src/lib/firebase/repositories/tournaments.ts "src/app/tournaments/[tid]/dashboard-client.tsx" "src/app/tournaments/[tid]/live/live-client.tsx"
```

EXPECT: 型エラー 0 / lint エラー 0

### Unit Tests（対象）

```bash
npm run test -- timer.test useAudioPlayer tournaments.test
```

EXPECT: 全 pass（既存 + 新規）

### Full Test Suite

```bash
npm run test
```

EXPECT: 回帰なし（特に live-client.test.tsx / TimerDisplay.test.tsx）

### Build

```bash
npm run build
```

EXPECT: 成功

### Manual Validation

- [ ] dashboard で running 中、レベル終了の瞬間（残り0）にブラインドアップ音が即鳴る
- [ ] 同レベルで音が 1 回だけ（連打されない）
- [ ] 「次レベル」「前レベル」ボタンでは鳴らない
- [ ] seating→running 開始で鳴らない
- [ ] finished トーナメントを開いて無音（要望③回帰なし）
- [ ] レベル切替時、新レベルのタイマーが構造定義どおりの値から始まる（2秒飛びが体感的に解消）

---

## Acceptance Criteria

- [ ] レベル終了瞬間にローカル検知で音が鳴る（往復待ちなし）
- [ ] 二重再生なし
- [ ] 手動レベル変更・seating→running で誤発火しない
- [ ] finished で誤発火しない（③維持）
- [ ] 2秒飛びの原因が特定され、auto-advance の決定論的 levelStartedAt で体感改善
- [ ] 全 validation コマンド pass

## Completion Checklist

- [ ] pure helper は timer.ts に集約（hook / repository から import）
- [ ] play() の error handling（AppError + logger.warn）は既存踏襲（新規 catch 追加なし）
- [ ] logger 規約遵守（console.* 直呼びなし）
- [ ] テストは実装と同 commit にペア（testing.md）
- [ ] skip / disable なし（既存テストは振る舞い維持で書換）
- [ ] firestore.rules 無変更で成立することを確認
- [ ] 実装レポートに⑤原因分析を記載

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 既存 useAudioPlayer テストの書換漏れで回帰 | 中 | 中 | role filter describe を網羅書換 + 他 describe に `remainingMs: null` を明示付与。full suite で確認 |
| 決定論的 levelStartedAt が rule で deny | 低 | 高 | rule は `isOrganizer` のみ（値・request.time 制約なし）を確認済み。emulator は変更不要だが手動で 1 度 advance を実機確認 |
| 端末長時間バックグラウンド後の連鎖 auto-advance | 低 | 低 | 1 tick 1 レベルで自己整合。コメントで明示し許容（将来 Cloud Functions 化） |
| 複数組織者端末で各自が鳴らす | 低 | 低 | 仕様上正しい（各端末がローカルで正確なタイミングに鳴る）。旧実装でも snapshot 受信で各自鳴っていた |
| `lastLevelChangeKind` が孤児化 | 低 | 低 | フィールド・書込は維持（診断用）。stale コメントのみ更新 |

## Notes

- ④と⑤は密結合（どちらも「Firestore 往復遅延がレベル境界の体感を悪化させる」問題）。同一 PR で扱う（PRD Decisions Log 準拠）。
- `shouldPlayLevelEndSound` と `shouldAutoAdvance` は条件が同型。「auto-advance が妥当な瞬間 = ブラインドアップ音を鳴らす瞬間」という意味的一致を保つことで、片方だけ仕様が drift しないよう pure 関数として timer.ts に並置する。
- ⑤の緩和は online auto-advance tx 経路のみ。offline / 手動は意図的に serverTimestamp 据え置き（それぞれ「今開始」が正しい / タイミング semantics が別）。
- `lastLevelChangeKind` は新トリガでは音声判定に使われなくなるが、フィールドは schema 維持（既存 doc 互換・将来の診断用）。
