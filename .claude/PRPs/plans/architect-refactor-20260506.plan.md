# Architect Refactor Plan — 2026-05-06

## Status

- Status: `pending-approval`
- Branch: `feature/hole-refactor`
- Baseline commit: `1c00ad4`
- Source review: [.claude/PRPs/reviews/architect-refactor-20260506.md](../reviews/architect-refactor-20260506.md)

## Goal

Phase 4.16 / 4.17 / 5.1 / 5.2 / 5.3 / 5.4 で累積した構造的負債（dashboard-client.tsx 再肥大化 / tx prelude の 10 箇所重複 / isOrganizer 判定の 4 箇所 drift / 同卓計算の 3 箇所重複 等）を atomic な commit 列で集約する。

不変条件:
- 既存テスト（unit 789 / E2E 56）を**常に green** に戻す
- 観察可能な動作変更は **0**（rule / API / URL / Firestore schema / 環境変数 / 招待コードフォーマット 全て不変）
- 1 commit = 1 refactor、revert 1 つで安全に戻せる粒度

## ループ手順（各タスク共通）

```
1. 実装（Edit/Write）
2. npm run typecheck
3. npm run lint
4. npm test
5. （必要に応じて）npm run test:rules-limits / test:rules-clone-players
6. npm run build
7. （影響範囲が広い場合）npm run test:e2e
8. 全 green なら git add 対象ファイル → commit（日本語メッセージ）
9. 1 つでも red なら revert / 再分割 / 計画見直し
```

E2E は重い（5.4 分）ため毎 commit 不要。**E2E 必須**は ★ 印で明示する（dashboard / D&D / PD / clone を触る commit）。それ以外は最終 Phase 5 で 1 回だけ走らせる。

---

## Task 列（依存順、合計 10 commit 想定）

### P0 — 安全網拡張（先行）

#### P0-1. characterization test 拡張（先行投入）

- **目的**: helper 抽出と純関数追加の安全網を先に貼る
- **対象**:
  - [src/lib/services/tournament-state.test.ts](../../../src/lib/services/tournament-state.test.ts) に `isBeforeStart` の characterization 5 件先行追加（`isSetup` / `isSeating` の組合わせ true / それ以外 3 state false / null 入力なし — 入力は TournamentDoc 型なので簡素）
  - [src/lib/firebase/schemas/group.test.ts](../../../src/lib/firebase/schemas/group.test.ts) に `isOrganizerRole` / `isOwnerRole` の characterization 8 件先行追加（4 入力 × 2 関数）
  - [src/lib/services/seating/same-table.test.ts](../../../src/lib/services/seating/same-table.test.ts) を新設し `getSameTableActiveOtherIds` / `getSameTableActivePdOtherIds` の characterization 6 件先行追加
- **実装**: 同 commit で:
  - `tournament-state.ts` に `isBeforeStart(t)` 仮実装を追加
  - `schemas/group.ts` に `isOrganizerRole` / `isOwnerRole` 仮実装を追加
  - `same-table.ts` を新設し 2 helper を実装
- **commit メッセージ案**:
  `test: refactor 先行 characterization（isBeforeStart / isOrganizerRole / same-table helpers）`
- **テスト**: typecheck / lint / vitest（追加分含めて全 green）
- **E2E**: 不要（純関数追加のみ）

### P1 — 命名・小集約（risk 低）

#### P1-1. `isOrganizerRole` を 4 callsite で利用 → drift 解消

- **目的**: finding-A4
- **対象**:
  - [src/app/tournaments/[tid]/clone/clone-client.tsx:79](../../../src/app/tournaments/[tid]/clone/clone-client.tsx#L79)
  - [src/app/tournaments/[tid]/dashboard-client.tsx:305](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L305)
  - [src/app/groups/[gid]/group-detail-client.tsx:180](../../../src/app/groups/[gid]/group-detail-client.tsx#L180)
  - [src/lib/hooks/useAudioPlayer.ts:83](../../../src/lib/hooks/useAudioPlayer.ts#L83)
- **実装**: `isOrganizer = role === "owner" || role === "organizer"` を `isOrganizer = isOrganizerRole(role)` に置換
- **commit メッセージ案**:
  `refactor(role): isOrganizerRole helper を 4 callsite に展開して drift を解消`
- **テスト**: typecheck / lint / vitest
- **E2E**: 不要（pure 置換、既存 E2E が caller を端から検証）

#### P1-2. `isBeforeStart` を 3 component で利用

- **目的**: finding-A3
- **対象**:
  - [src/components/tournament/TimerDisplay.tsx:25](../../../src/components/tournament/TimerDisplay.tsx#L25)
  - [src/components/tournament/NextBreakCard.tsx:54](../../../src/components/tournament/NextBreakCard.tsx#L54)
  - [src/components/tournament/AverageStackCard.tsx:29](../../../src/components/tournament/AverageStackCard.tsx#L29)
- **実装**: `tournament.state === "setup" || tournament.state === "seating"` を `isBeforeStart(tournament)` に置換
- **commit メッセージ案**:
  `refactor(tournament-state): isBeforeStart helper で TimerDisplay / NextBreakCard / AverageStackCard の state 直比較を集約`
- **テスト**: typecheck / lint / vitest
- **E2E**: 不要

#### P1-3. tournament-clone.ts の手書き型ガードを `unwrapOrFrom` に置換

- **目的**: finding-A6
- **対象**: [src/lib/services/tournament-clone.ts:48-51](../../../src/lib/services/tournament-clone.ts#L48-L51)
- **実装**: `e instanceof AppError ? e : AppError.from(...)` を `throw unwrapOrFrom(e, ...)` に置換
- **commit メッセージ案**:
  `refactor(tournament-clone): 手書き型ガードを unwrapOrFrom に置換し error-logging 規約に揃える`
- **テスト**: typecheck / lint / vitest（既存 tournament-clone.test）
- **E2E**: 不要

### P2 — 同卓 helper 集約（finding-A2）

#### P2-1. 同卓 helper を 3 callsite に展開

- **目的**: finding-A2
- **対象**:
  - [src/app/tournaments/[tid]/dashboard-client.tsx:494-505](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L494-L505) — SeatingBoard onTogglePd
  - [src/app/tournaments/[tid]/dashboard-client.tsx:531-541](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L531-L541) — PlayerList onTogglePd
  - [src/components/tournament/PlayerList.tsx:140-149](../../../src/components/tournament/PlayerList.tsx#L140-L149) — BustButton sameTablePlayerIds
- **実装**:
  - dashboard 2 箇所 → `getSameTableActiveOtherIds(player, players)`
  - PlayerList 1 箇所 → `getSameTableActivePdOtherIds(player, players)`
- **commit メッセージ案**:
  `refactor(seating): 同卓 ID 計算の重複を same-table helper に集約（3 箇所）`
- **テスト**: typecheck / lint / vitest
- **E2E**: ★ playing-dealer / dashboard-polish spec が動作裏付け（最終 Phase 5 でまとめて検証）

### P3 — tx-helpers 集約（finding-A5 / A7・risk 中）

#### P3-1. `loadTournamentInTx` / `playerFromSnap` helper を新設

- **目的**: finding-A5 / A7 の helper 本体
- **対象**: 新設 [src/lib/firebase/tx-helpers.ts](../../../src/lib/firebase/tx-helpers.ts)
- **実装**:
  ```ts
  export async function loadTournamentInTx(
    tx: Transaction,
    tid: string,
    userGroupIds: readonly string[],
  ): Promise<TournamentDoc> {
    const tRef = doc(collection(firestore, "tournaments").withConverter(zodConverter(...)), tid);
    const tSnap = await tx.get(tRef);
    if (!tSnap.exists()) throw new AppError("not found", "firestore/not-found");
    const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
    if (!userGroupIds.includes(t.groupId)) {
      throw new AppError("not allowed", "firestore/permission-denied");
    }
    return t;
  }

  export function playerFromSnap(snap: QueryDocumentSnapshot<PlayerDoc>): PlayerDoc | null { ... }
  ```
- **テスト**: 新規 [tx-helpers.test.ts](../../../src/lib/firebase/tx-helpers.test.ts) を 5 件追加（success / not-found / not-allowed / userGroupIds 空 / userGroupIds 含む）
- **commit メッセージ案**:
  `feat(firebase): tx-helpers に loadTournamentInTx と playerFromSnap を追加`
- **E2E**: 不要（helper 本体のみ）

#### P3-2. orchestrator.ts の 6 箇所 tx prelude を `loadTournamentInTx` に置換

- **目的**: finding-A5
- **対象**: orchestrator.ts 内 6 関数
  - `commitInitialSeating` / `autoSeatLateEntry` / `applyCascadeMoves` / `applySingleMove` / `applyTableBreak` / `setIsPlayingDealer`
- **実装**: 各 tx 開始 7〜10 行を `const t = await loadTournamentInTx(tx, tid, userGroupIds);` 1 行に置換
- **commit メッセージ案**:
  `refactor(seating): orchestrator の 6 関数で tx prelude を loadTournamentInTx に集約`
- **テスト**: typecheck / lint / vitest（既存 orchestrator.test 12+ 件で characterization）
- **E2E**: ★ 必須（playing-dealer / clone / dashboard-polish 等 D&D / PD / cascade 系が広く影響）— commit 単位では skip し、Phase 5 でまとめて回す

#### P3-3. repositories/tournaments.ts の 4 箇所 tx prelude を `loadTournamentInTx` に置換

- **目的**: finding-A5（repositories 側）
- **対象**: `advanceLevel`(expected 経路) / `setLevelDurationSec` / `appendLevel` / `finishTournament`
- **実装**: 各 tx 開始 9〜11 行を `loadTournamentInTx` 経由に置換
- **commit メッセージ案**:
  `refactor(tournaments): repository の 4 関数で tx prelude を loadTournamentInTx に集約`
- **テスト**: typecheck / lint / vitest（repositories/tournaments.test 50+ 件で characterization）
- **E2E**: ★ append-blind-level / dynamic-blind-adjustment / winner-banner-and-auto-finish 等が影響 — Phase 5 でまとめて

#### P3-4. orchestrator.ts の 11 箇所 player snap → fresh PlayerDoc 復元を `playerFromSnap` に置換

- **目的**: finding-A7
- **対象**: orchestrator.ts 内 11 箇所
- **実装**: `const fresh: PlayerDoc = { id: snap.id, ...snap.data() };` を `const fresh = playerFromSnap(snap);` に置換 + null guard 追加（`if (!fresh) ...` の小修正）
- **commit メッセージ案**:
  `refactor(seating): orchestrator の player snap 復元を playerFromSnap helper に集約`
- **テスト**: typecheck / lint / vitest
- **E2E**: 不要（型注釈ヘルプ集約のみ）

### P4 — dashboard-client 肥大化解消（finding-A1 / A8）

#### P4-1. `useManualSeatChange` hook を抽出

- **目的**: finding-A1 の本体
- **対象**: [src/app/tournaments/[tid]/dashboard-client.tsx:88-288](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L88-L288) を新規 [src/lib/hooks/useManualSeatChange.ts](../../../src/lib/hooks/useManualSeatChange.ts) に抽出
- **実装**:
  ```ts
  export function useManualSeatChange({
    tid, uid, groupIds, players,
  }: { ... }): {
    busy: boolean;
    undoBanner: { summary: string; moves: BalancingMove[] } | null;
    handleMoveSeat: (player: PlayerDoc, to: { tableNum: number; seatNum: number }) => Promise<{ error?: string }>;
    handleUndoSeatChange: () => Promise<{ error?: string }>;
  } { ... }
  ```
  - cascade label 文言生成、30 秒 undo timeout の cleanup、AppError wrap も hook 内に集約
  - dashboard 側は `const { busy, undoBanner, handleMoveSeat, handleUndoSeatChange } = useManualSeatChange({ ... });` に簡略化
  - error 表示は dashboard 側 `setError` を hook の戻り値で受ける（`{ error?: string }` 形式）
- **テスト**: 新規 [useManualSeatChange.test.tsx](../../../src/lib/hooks/useManualSeatChange.test.tsx) 5 件
  - busy が true の間 2 度目の handleMoveSeat は no-op
  - applied=false 時に error が返る
  - 成功時に undoBanner が 30 秒で auto clear
  - undo 経路が reverseMoves で applyManualSeatUndo を呼ぶ
  - unmount で timeout が cleanup
- **commit メッセージ案**:
  `refactor(dashboard): D&D 手動席移動 state を useManualSeatChange hook に抽出`
- **E2E**: ★ 必須（dashboard-polish + 手動 D&D が effect。Phase 5 でまとめて）

#### P4-2. dashboard-client.tsx の audio toggle handler を局所抽出

- **目的**: finding-A8
- **対象**: [src/app/tournaments/[tid]/dashboard-client.tsx:401-423](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L401-L423)
- **実装**: dashboard 内に `handleToggleAudio(next: boolean)` を関数抽出。`audio={ ..., onToggleEnabled: handleToggleAudio }` で渡す
- **commit メッセージ案**:
  `refactor(dashboard): audio toggle inline handler を局所関数に抽出`
- **テスト**: typecheck / lint / vitest
- **E2E**: ★ audio-settings spec が effect

---

## 順序とリスク

```
P0-1 (test 先行)
  ↓
P1-1 → P1-2 → P1-3   （並行可・risk 低）
  ↓
P2-1                  （helper 利用）
  ↓
P3-1 → P3-2 → P3-3 → P3-4   （tx 系・順次・risk 中）
  ↓
P4-1 → P4-2           （dashboard 抽出・risk 中）
  ↓
最終 npm run test:e2e（Phase 5 で 1 回）
```

**risk 中** タスク（P3-2 / P3-3 / P4-1）は実装後に必ず unit + build を確認し、Phase 5 で E2E を回して動作確認する。中間 commit で E2E は走らせない（5.4 分 × 4 commit = ~20 分の節約）。

## 想定される行数変化

| ファイル | Before | After (見込み) | 削減率 |
| --- | --- | --- | --- |
| `dashboard-client.tsx` | 597 | 〜480 | -20% |
| `orchestrator.ts` | 1107 | 〜990 | -10% |
| `repositories/tournaments.ts` | 736 | 〜700 | -5% |
| 新規 `useManualSeatChange.ts` | — | 〜140 | — |
| 新規 `tx-helpers.ts` | — | 〜80 | — |
| 新規 `same-table.ts` | — | 〜30 | — |

純減: 全体で約 80 行減。新規 helper / hook ファイルは 100 行未満に収まり責務分散が改善する。

## 見送り

- finding-S1（招待コード空消費 DoS）— Cloud Functions 化が前提のため、前回 refactor と同じく見送り。`group-membership.md` の記載が真実源
- orchestrator.ts のさらなるファイル分割（manual / pd / balancing / lifecycle の domain split）— 1107 行 → 990 行で十分集約可能、ファイル分割は test 配置 / import 修正コストが大きく ROI が悪い
- subscribePlayers の hook 化（dashboard / live / clone で個別 state 管理が異なるため unify cost > effect）

## ユーザー承認待ち

本計画で進めて良いか確認をお願いします:

1. **対象スコープ** — 上記 10 commit、対象は `src/app/**` / `src/components/**` / `src/lib/**` の純内部リファクタ
2. **観察可能な動作変更** — 0（rule / Firestore schema / URL / 環境変数 全て不変）
3. **テスト保護** — P0-1 で characterization 19 件先行投入、P3-1 で 5 件、P4-1 で 5 件追加。合計約 30 件追加で安全網拡張
4. **E2E 走行** — 中間 commit ではスキップ、Phase 5 最終検証で 1 回（約 5.4 分）

承認いただければ Phase 4（段階実行）に着手します。
