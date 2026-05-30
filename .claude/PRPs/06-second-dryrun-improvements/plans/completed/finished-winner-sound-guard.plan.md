# Plan: 終了済みトーナメントで優勝音を鳴らさないガード（Phase 3 / 要望③）

## Summary

終了済み（`state === "finished"`）トーナメントの「運営」ページ（dashboard）を開くと、winner 検知 effect が初回 mount で `null → winner` 遷移を検知して優勝音を再生してしまうバグを修正する。winner effect に `isFinished` ガードを追加し、finished のときは `prevWinnerIdRef` を更新するが `play()` しないようにする。進行中（running / paused）の正常な優勝音は維持する。

## User Story

As a 小規模ポーカーサークルの運営者,
I want 終了済みトーナメントの運営ページを開いても優勝音が鳴らないこと,
So that 既に終わった会で参加者に誤った演出（優勝音）が流れず、タイマー進行への信頼が保たれる。

## Problem → Solution

**現状**: finished トーナメントの dashboard を開く → [useAudioPlayer.ts:196-205](../../../../src/lib/hooks/useAudioPlayer.ts#L196-L205) の winner effect が初回 mount で `prevWinnerIdRef.current === null` かつ `resolveWinner()` が winner を返す（[`resolveWinner`](../../../../src/lib/services/timer.ts#L86-L95) は `isInProgress || isFinished` で winner を返す）→ `null → winner` 遷移とみなして優勝音を再生してしまう。

**あるべき姿**: winner effect で `isFinished(tournament)` のときは `prevWinnerIdRef` を更新して再発火を防ぎつつ `play()` を skip する。進行中の `null → winner` 遷移のときだけ鳴らす。

## Metadata

- **Complexity**: Small
- **Source PRD**: [.claude/PRPs/06-second-dryrun-improvements/prds/06-second-dryrun-improvements.prd.md](../prds/06-second-dryrun-improvements.prd.md)
- **PRD Phase**: Phase 3 — 終了済み優勝音バグ修正
- **Estimated Files**: 2（実装 1 + テスト 1）

---

## UX Design

### Before

```
┌─────────────────────────────────────────────┐
│ 運営者が「終了済み」トーナメントの             │
│ [運営] ボタンを押す                            │
│   → dashboard ページが mount                   │
│   → 🔊 優勝音が鳴る（誤発火）                  │
└─────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────┐
│ 運営者が「終了済み」トーナメントの             │
│ [運営] ボタンを押す                            │
│   → dashboard ページが mount                   │
│   → 🔇 無音（優勝音は鳴らない）                │
│                                               │
│ 進行中（running/paused）で最後の 1 人に        │
│ 確定した瞬間 → 🔊 優勝音は従来どおり鳴る       │
└─────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| 終了済み tournament の dashboard / live を開く | 優勝音が鳴る | 無音 | バグ修正 |
| 進行中に winner 確定（最後の 1 人） | 優勝音が鳴る | 優勝音が鳴る（維持） | running/paused は据え置き |
| 同 winner の再 emit / 取消し→再確定 | 鳴らない（ref ガード） | 鳴らない（維持） | 既存挙動維持 |

---

## Mandatory Reading

Files that MUST be read before implementing:

| Priority       | File           | Lines | Why                    |
| -------------- | -------------- | ----- | ---------------------- |
| P0 (critical)  | [src/lib/hooks/useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) | 195-205 | 修正対象の winner 検知 effect |
| P0 (critical)  | [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | 38-45 | `isFinished` / `isInProgress` helper（経由必須） |
| P0 (critical)  | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | 86-95 | `resolveWinner` が finished でも winner を返すことの確認 |
| P0 (critical)  | [src/lib/hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) | 400-467 | winner detection の既存テスト + fixture factory |
| P1 (important) | [src/lib/hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) | 12-153 | mock 構成（audio-context / play stub）と `makeTournament` factory |
| P2 (reference) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 183-189 | バグが顕在化する consumer（finished でも tournament/players を渡す） |
| P2 (reference) | [.claude/rules/testing.md](../../../../.claude/rules/testing.md) | all | characterization / 振る舞い検証規約 |
| P2 (reference) | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md) | all | logger / AppError 規約（本変更では新規 throw なし） |

## External Documentation

No external research needed — feature uses established internal patterns（既存 hook の effect ガード追加のみ）。

---

## Patterns to Mirror

### EFFECT_GUARD_PATTERN（levelUp effect の state ガード）

```ts
// SOURCE: src/lib/hooks/useAudioPlayer.ts:174-193
useEffect(() => {
  const lv = tournament?.currentLevel ?? null;
  if (lv === null) return;
  const prev = prevLevelRef.current;
  prevLevelRef.current = lv;        // ← ref は早期に更新してから判定する
  if (prev === null) return;
  if (prev === lv) return;
  if (prev === 0) return;
  // 状態が "running" / "paused" のみ。setup / seating / finished は除外。
  const st = tournament?.state;
  if (st !== "running" && st !== "paused") return;
  if (tournament?.lastLevelChangeKind === "manual") return;
  void play(group?.audioSettings.levelUpSoundId ?? "default:blind-up");
}, [
  tournament?.currentLevel,
  tournament?.state,
  tournament?.lastLevelChangeKind,
  group?.audioSettings.levelUpSoundId,
  play,
]);
```

→ levelUp effect は既に「`prev` を ref に保存 → state ガードで早期 return → `void play()`」の形。winner effect も同じ構造（ref 更新を先に、`isFinished` で早期 return）に揃える。

### STATE_HELPER_PATTERN（state 述語の経由）

```ts
// SOURCE: src/lib/services/tournament-state.ts:38-45
export function isFinished(t: TournamentDoc): boolean {
  return t.state === "finished";
}
/** running または paused（タイマー駆動中）。 */
export function isInProgress(t: TournamentDoc): boolean {
  return isRunning(t) || isPaused(t);
}
```

→ `tournament.state === "finished"` の直接比較ではなく `isFinished(tournament)` helper を経由する（group-membership.md「tournament state ごとの許可判定」推奨に準拠）。

### TEST_STRUCTURE（winner detection テスト + fixture factory）

```ts
// SOURCE: src/lib/hooks/useAudioPlayer.test.tsx:400-440
describe("useAudioPlayer — winner detection", () => {
  it("plays once on null → PlayerDoc transition", async () => {
    const initialPlayers = [
      makePlayer({ id: "p1", uid: "u1" }),
      makePlayer({ id: "p2", uid: "u2" }),
    ];
    const { result, rerender } = renderAudioPlayer({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: initialPlayers,
      role: "organizer",
    });
    await act(async () => {
      await result.current.unlock();
    });
    expect(playSpy).not.toHaveBeenCalled();
    // p2 が脱落して winner 確定
    rerender({
      tournament: makeTournament({ state: "running" }),
      group: makeGroup(),
      players: [
        makePlayer({ id: "p1", uid: "u1" }),
        makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
      ],
      role: "organizer",
    });
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});
```

→ 新規テストは既存 `makeTournament` / `makePlayer` / `renderAudioPlayer` / `playSpy` をそのまま使い、winner detection describe ブロックに追記する。`makeTournament` のデフォルト `state` は `"running"` なので、finished ケースは `makeTournament({ state: "finished", finishedAt: baseTimestamp })` で生成する。

---

## Files to Change

| File                  | Action | Justification           |
| --------------------- | ------ | ----------------------- |
| [src/lib/hooks/useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) | UPDATE | winner effect に `isFinished` ガード追加 + import 追加 |
| [src/lib/hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) | UPDATE | finished で鳴らない characterization test 追加（実装と同一 commit） |

## NOT Building

- levelUp 音のタイミング変更（要望④） — Phase 4 のスコープ。本 Phase は触らない。
- タイマー 2 秒飛びの調査（要望⑤） — Phase 4 のスコープ。
- `resolveWinner`（timer.ts）の挙動変更 — finished でも winner を返す契約は winner バナー表示 / 結果カードが依存するため**変更しない**。ガードは hook の effect 側に閉じる。
- finished 以外の state（setup / seating）の扱い変更 — これらは `resolveWinner` が元々 null を返すので対象外。
- consumer（dashboard-client / live-client）側の変更 — 修正は hook に閉じる。

---

## Step-by-Step Tasks

### Task 1: finished で優勝音が鳴らないことを固定するテストを先行追加（red）

- **ACTION**: [useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) の `describe("useAudioPlayer — winner detection", ...)` ブロック（400 行目付近）に新規 `it` を 2 件追加する。
- **IMPLEMENT**:
  - `it("does not play winner sound when mounting a finished tournament")`:
    finished + winner 確定済み players（1 active / 1 busted）で mount → `unlock()` → `expect(playSpy).not.toHaveBeenCalled()`。これがバグの再現（修正前は 1 回鳴る）。
    ```ts
    it("does not play winner sound when mounting a finished tournament", async () => {
      const { result } = renderAudioPlayer({
        tournament: makeTournament({ state: "finished", finishedAt: baseTimestamp }),
        group: makeGroup(),
        players: [
          makePlayer({ id: "p1", uid: "u1" }),
          makePlayer({ id: "p2", uid: "u2", isBusted: true, bustedAt: baseTimestamp }),
        ],
        role: "organizer",
      });
      await act(async () => {
        await result.current.unlock();
      });
      expect(playSpy).not.toHaveBeenCalled();
    });
    ```
  - `it("does not play winner sound on null → winner transition while finished")`:
    finished で全員 active の状態（`resolveWinner` が null）→ rerender で finished + 1 active / 1 busted（winner 確定）→ `expect(playSpy).not.toHaveBeenCalled()`。finished 中の遷移でも鳴らないことを固定。
- **MIRROR**: TEST_STRUCTURE（winner detection の既存 `it`）。`makeTournament` / `makePlayer` / `renderAudioPlayer` / `playSpy` をそのまま使う。
- **IMPORTS**: 追加 import 不要（既存 fixture factory / `act` / `baseTimestamp` を使用）。
- **GOTCHA**:
  - `makeTournament` のデフォルト `state` は `"running"`。finished ケースは必ず `{ state: "finished", finishedAt: baseTimestamp }` を渡す（`finishedAt` は `resolveWinner` には不要だが schema 整合のため `makeTournament` factory で `null` 既定 → finished では明示的に Timestamp を渡す）。
  - `unlock()` を `await act(...)` で呼ばないと `unlocked` が false のままで、そもそも play gate を通らず「鳴らない」理由が曖昧になる。**必ず unlock 済みにしてから**「それでも鳴らない」ことを検証する（gate ではなく finished ガードが効いていることを示すため）。
- **VALIDATE**: `npm test -- useAudioPlayer` を実行し、追加 2 件が **fail（red）** することを確認（修正前は finished で鳴ってしまう）。

### Task 2: winner effect に `isFinished` ガードを追加（green）

- **ACTION**: [useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) の winner effect（195-205 行目）を修正し、`isFinished` import を追加する。
- **IMPLEMENT**:
  - import 追加（17 行目の `resolveWinner` import に併記、または直下に新規行）:
    ```ts
    import { resolveWinner } from "@/lib/services/timer";
    import { isFinished } from "@/lib/services/tournament-state";
    ```
  - winner effect を以下に変更（`prevWinnerIdRef` の更新は早期に行い、その後 `isFinished` で早期 return）:
    ```ts
    // winner 検知: null → PlayerDoc 遷移。同 winner の再 emit / 取消し→再確定の両方に対応。
    // 要望③: finished トーナメントの運営ページを開いた瞬間、resolveWinner が winner を返し
    // null → winner 遷移とみなして優勝音が誤発火するバグを防ぐ。finished のときは
    // prevWinnerIdRef を更新する（再発火防止）が play() しない。進行中（running/paused）の
    // 正常な優勝音は維持する。
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
- **MIRROR**: EFFECT_GUARD_PATTERN（levelUp effect の「ref 先更新 → state ガードで早期 return」）/ STATE_HELPER_PATTERN（`isFinished` 経由）。
- **IMPORTS**: `import { isFinished } from "@/lib/services/tournament-state";`
- **GOTCHA**:
  - **`prevWinnerIdRef.current = wid` を `isFinished` の early return より前に置く**こと。後ろに置くと finished ページ滞在中に ref が null のままになり、別の理由で effect が再評価されたとき（deps 変化）に play する経路が残る。levelUp effect も同じ順序（ref 先更新）。
  - 進行中 → finished の自然遷移では、winner は running 中に確定して既に鳴り、`prevWinnerIdRef` が winner id になっている。その後 finished に遷移しても `prev !== null` かつ `isFinished` return で二重再生しない（ここは元々 ref で守られているが、ガード追加後も維持される）。
  - `resolveWinner` 自体は変更しない（winner バナー / 結果カードが finished でも winner を返す契約に依存）。
- **VALIDATE**: `npm test -- useAudioPlayer` で Task 1 の 2 件が **pass（green）** になり、既存の winner detection テスト（"plays once on null → PlayerDoc transition" 等）も全 pass することを確認。

### Task 3: 全体検証（typecheck / lint / 全 UT）

- **ACTION**: 静的解析と全テストを通す。
- **IMPLEMENT**: 下記 Validation Commands を順に実行。
- **MIRROR**: N/A
- **IMPORTS**: N/A
- **GOTCHA**: `next lint` は warning を error 扱いにしない設定もあるが、本変更で新規 `console.*` / 未使用 import を残さないこと（error-logging.md）。`isFinished` を import したら必ず使用する。
- **VALIDATE**: typecheck 0 error / lint 0 error / `vitest run` 全 pass。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| finished mount で鳴らない | `state:"finished"` + 1 active/1 busted で mount → unlock | `playSpy` 未呼出 | ✅ バグ再現ケース |
| finished 中の null→winner 遷移で鳴らない | finished 全員 active → finished 1 active/1 busted に rerender | `playSpy` 未呼出 | ✅ |
| running の null→winner で鳴る（既存・回帰） | `state:"running"` 全員 active → 1 active/1 busted | `playSpy` 1 回 | 既存テスト維持 |
| 同 winner 再 emit で鳴らない（既存・回帰） | winner 確定後に同 players で rerender | `playSpy` 1 回のまま | 既存テスト維持 |
| member は鳴らない（既存・回帰） | role:"member" で winner 確定 | `playSpy` 未呼出 | 既存テスト維持 |

### Edge Cases Checklist

- [x] finished で mount（バグ本体）→ 無音
- [x] finished 中の winner 遷移 → 無音
- [x] running の正常 winner → 鳴る（回帰）
- [x] paused → finished 遷移後の再 mount → 無音（finished ガードでカバー）
- [ ] Empty input — `players: []` は `resolveWinner` が `players.length < 2` で null（既存挙動、変更なし）
- [ ] Permission denied — 本変更は Firestore 書込なし（rule 影響なし）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors（`isFinished` import が正しく解決される）

```bash
npm run lint
```

EXPECT: Zero lint errors（未使用 import / console 残置なし）

### Unit Tests（対象スコープ）

```bash
npm test -- useAudioPlayer
```

EXPECT: 新規 2 件を含む winner detection テストが全 pass

### Full Test Suite

```bash
npm test
```

EXPECT: 既存テストの回帰なし（全 pass）

### Build Verification

```bash
npm run build
```

EXPECT: ビルド成功

### Manual Validation

- [ ] dev server を起動し、終了済み（finished）トーナメントの「運営」ボタンから dashboard を開く → 優勝音が鳴らないことを確認
- [ ] 進行中トーナメントで最後の 1 人になるまで bust → winner 確定の瞬間に優勝音が鳴ることを確認
- [ ] /live ページでも finished で無音・進行中で鳴ることを確認（dashboard と同じ hook）

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation コマンド pass
- [ ] finished で鳴らない / running で鳴る test が pass
- [ ] 型エラー 0
- [ ] lint エラー 0
- [ ] UX（finished 無音・進行中再生）に一致

## Completion Checklist

- [ ] EFFECT_GUARD_PATTERN（ref 先更新 → 早期 return）に準拠
- [ ] `isFinished` helper 経由（直接 `state === "finished"` 比較をしない）
- [ ] エラー処理は既存どおり（新規 throw / console なし）
- [ ] テストは振る舞い検証（playSpy の呼出有無）であり内部実装に依存しない
- [ ] ハードコード値なし
- [ ] テストと実装を同一 commit に含める（testing.md「新規機能と test の commit セット」）
- [ ] スコープ外（要望④⑤）に手を出していない
- [ ] 追加質問なしで実装完了できる

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| running 中に winner 確定と finished 遷移が 1 snapshot に合体し、優勝音が鳴らない | L | L | 実運用では bust 書込と finishTournament 書込は別 write で、winner は running 中に先に観測されるため鳴る。完全同時の稀ケースで無音になっても PRD success signal（finished 無音優先）と矛盾しない |
| `prevWinnerIdRef` 更新位置を誤り早期 return の後ろに置く | L | M | Task 2 GOTCHA で明示。levelUp effect と同じ「ref 先更新」順序を踏襲 |
| `resolveWinner` を誤って変更し winner バナー / 結果カードを壊す | L | M | NOT Building に明記。ガードは hook effect に閉じる |

## Notes

- 本修正は schema / repository / firestore.rules を一切触らない（hook の effect ガード + テストのみ）。Firestore deploy 不要。
- Phase 4（要望④⑤）は同じ `useAudioPlayer.ts` を触るため、PRD の Parallelism Notes どおり本 Phase 3 のガード追加後に着手する（DEPENDS: 3）。本 Phase で winner effect の構造（ref 先更新 → 早期 return）を整えておくと Phase 4 の levelUp トリガー変更と衝突しにくい。
- Open Question「一括/個別トグルの永続化」「2 秒飛び真因」は本 Phase の対象外（Phase 1 / Phase 4）。
