# Architect Refactor Review — 2026-05-06

## Scope

リポジトリ全体（src/ / firestore.rules / scripts/ / .claude/rules/）を Web Architect + Security Specialist の二眼で監査。
2026-04-30 の architect-refactor 完了以降、Phase 4.16 / 4.17 / 5.1 / 5.2 / 5.3 / 5.4 の機能追加が累積したことによる新たな構造的負債と、前回 refactor 以降に発生した drift を抽出する。

- Branch: `feature/hole-refactor`
- Baseline commit: `1c00ad4`
- 観察可能な動作変更: 0（rule / API / URL / Firestore schema / 環境変数 / 招待コードフォーマット 全て不変）

## Baseline test 状況（Phase 1 結果）

| 検査 | 結果 |
| --- | --- |
| `npm run typecheck` | pass |
| `npm run lint` | pass (warnings 0) |
| `npm test` (vitest) | **789 / 0 fail** （前回 626 → +163） |
| `npm run test:rules-limits` | 6/6 pass |
| `npm run test:rules-clone-players` | 7/7 pass |
| `npm run build` | pass |
| `npm run test:e2e` (Playwright) | **56 pass / 0 fail / 2 skipped**（5.4 分） |

skip された 2 件は意図的: `note-screenshots.spec.ts`（CAPTURE_SCREENSHOTS 環境変数 gate）と `anonymous-self-delete.spec.ts:19`（runtime 条件 skip。本流外）。本リファクタ対象外。

## 規約遵守 grep（全て green）

- `console.*` 直呼び: **logger.ts のみ**（規約準拠）
- `throw new Error`: **test 内のみ**（規約準拠 — error-logging.md §禁止事項）
- 握りつぶし `catch { }`: **0 件**
- 手書き型ガード `e instanceof Error && "code" in e`: **0 件**（前回 refactor の `getErrorCode` 集約が維持されている）

## 主要ファイル行数（大→中順）

| ファイル | 行数 | 前回 (2026-04-30) | コメント |
| --- | --- | --- | --- |
| `src/lib/services/seating/orchestrator.ts` | 1107 | ~870 | Phase 5.1 setIsPlayingDealer / Phase 5.x manual D&D / cascade で +~240 行 |
| `src/lib/firebase/repositories/tournaments.ts` | 736 | ~570 | Phase 5.2 setLevelDurationSec / Phase 5.3 appendLevel / Phase 4.16 finishedTournamentCount で +~165 行 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | **597** | **394** | **+52% 再肥大化**（Phase 5.x D&D + undo banner state 80 行が dashboard 直書き）|
| `src/components/tournament/SeatingBoard.tsx` | 510 | ~340 | Phase 5.x DnD 化で +~170 行（責務分割は SeatRow / PlainSeat / DnDSeat / PdCheckbox の 5 構成で妥当） |
| `src/lib/services/seating/engine.ts` | 471 | ~330 | Phase 5.1 PD planInitialSeating / Phase 5.x cascade plan で +~140 行（pure 関数群として責務分散明確） |
| `src/lib/services/group.ts` | 452 | ~370 | Phase 4.16 / 4.17 で counter / defaultSeats 設定 service +~80 行 |
| `src/lib/services/auth-actions.ts` | 385 | ~370 | ほぼ不変。良い形を維持 |
| `src/app/join/[tid]/join-client.tsx` | 376 | ~330 | Phase 5.1 動線完結追加で +~45 行 |
| `src/app/groups/[gid]/group-detail-client.tsx` | 355 | 354 | 不変。前回 refactor の効果が維持 |
| `src/components/tournament/TimerControls.tsx` | 222 | 222 | 不変。前回 refactor の効果が維持 |

bundle 実測（`npm run build` 出力より）:
- `/tournaments/[tid]` route: **27.7 kB / First Load 351 kB**（dashboard-client 肥大化と一致）

---

## Findings

### finding-A1: dashboard-client.tsx の D&D / undo state を hook 抽出

- **Lens**: architect
- **Severity**: medium
- **場所**: [src/app/tournaments/[tid]/dashboard-client.tsx:88-288](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L88-L288)
- **観察事実**: Phase 5.x で追加された `seatChangeBusy` / `seatChangeUndo` / `undoTimeoutRef` の state 管理 + `handleMoveSeat` / `handleUndoSeatChange` callback（合計 80 行）が dashboard 直書き。前回 refactor 後 394 → **597 行（+52%）** の主要因
- **影響**: dashboard-client.tsx の責務が「dashboard 全体の orchestration」と「D&D 手動席移動の細かい state 管理」の二重化。`/tournaments/[tid]` bundle 27.7 kB の肥大化の主犯
- **案**: `useManualSeatChange({ tid, uid, groupIds, players })` hook を [src/lib/hooks/](../../../src/lib/hooks/) に抽出。返り値 `{ busy, undoBanner, handleMoveSeat, handleUndoSeatChange }`
- **テスト保護**: dashboard-polish E2E + 既存 unit。新規 `useManualSeatChange.test.tsx` を追加（characterization 4〜5 件）
- **リスク**: 30 秒 undo timeout の cleanup タイミング、cascade label 文言生成。テストで pin

### finding-A2: 同卓 player ID 計算の重複（3 箇所）を helper 化

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - [src/app/tournaments/[tid]/dashboard-client.tsx:494-505](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L494-L505)（SeatingBoard `onTogglePd`）
  - [src/app/tournaments/[tid]/dashboard-client.tsx:531-541](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L531-L541)（PlayerList `onTogglePd`）
  - [src/components/tournament/PlayerList.tsx:140-149](../../../src/components/tournament/PlayerList.tsx#L140-L149)（BustButton `sameTablePlayerIds`）
- **観察事実**: 「同卓・他人・非busted・(PD のみ)」の filter + map(id) パターンが 3 箇所で重複。dashboard 2 箇所は「PD 全員」、PlayerList 1 箇所は「PD 在籍者のみ」と filter 条件が微妙に違う
- **影響**: PD 制約の filter 条件が変わったとき 3 箇所同時更新が必要。Phase 5.1 で同卓 1 PD invariant を実装するときに見落としやすい drift 源
- **案**: `src/lib/services/seating/same-table.ts` に 2 helper を集約:
  - `getSameTableActiveOtherIds(player, players): string[]` — 同卓の他 active player ID 全員
  - `getSameTableActivePdOtherIds(player, players): string[]` — 同卓の他 active かつ PD player ID
- **テスト保護**: 既存 PD E2E + orchestrator.test。新規 `same-table.test.ts` を追加（小さい characterization 4〜6 件）
- **リスク**: 低（pure 関数）

### finding-A3: `isBeforeStart` 純関数を tournament-state.ts に追加

- **Lens**: architect
- **Severity**: low
- **場所**:
  - [src/components/tournament/TimerDisplay.tsx:25](../../../src/components/tournament/TimerDisplay.tsx#L25)
  - [src/components/tournament/NextBreakCard.tsx:54](../../../src/components/tournament/NextBreakCard.tsx#L54)
  - [src/components/tournament/AverageStackCard.tsx:29](../../../src/components/tournament/AverageStackCard.tsx#L29)
- **観察事実**: `tournament.state === "setup" || tournament.state === "seating"` が 3 component で重複。`tournament-state.ts` には既存 `isSetup` / `isSeating` があるが、合成は呼出側
- **影響**: state 体系拡張時 3 箇所同時変更
- **案**: [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts) に `isBeforeStart(t): boolean` を追加（`isSetup(t) || isSeating(t)` の純関数）。3 component で置換
- **テスト保護**: tournament-state.test に characterization 1 件追加 + 既存 component test
- **リスク**: 極低

### finding-A4: ロール判定 `isOrganizerRole` helper を schemas/group.ts に追加

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - [src/app/tournaments/[tid]/clone/clone-client.tsx:79](../../../src/app/tournaments/[tid]/clone/clone-client.tsx#L79)
  - [src/app/tournaments/[tid]/dashboard-client.tsx:305](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L305)
  - [src/app/groups/[gid]/group-detail-client.tsx:180](../../../src/app/groups/[gid]/group-detail-client.tsx#L180)
  - [src/lib/hooks/useAudioPlayer.ts:83](../../../src/lib/hooks/useAudioPlayer.ts#L83)
- **観察事実**: `role === "owner" || role === "organizer"` が **4 箇所**で重複。前回 refactor 時から 1 → 4 に増加（Phase 4.6 の 3 階層ロール導入時に明示 helper を作らなかった drift）
- **影響**: role 体系拡張時に 4 箇所同時変更が必要。命名の一貫性も損なう（変数名は `isOrganizer` だが「owner も含む」意図を毎回コメントで補わないと誤読を招く）
- **案**: [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) の `deriveRole` の隣に追加:
  ```ts
  export type GroupRole = "owner" | "organizer" | "member";
  export function isOrganizerRole(role: GroupRole | null): boolean { ... }
  export function isOwnerRole(role: GroupRole | null): boolean { ... }
  ```
  4 箇所を `isOrganizerRole(myRole)` で置換
- **テスト保護**: schemas/group.test.ts に characterization 4 件追加 + 既存 E2E（member-role-split / dashboard-polish 等）が caller を端から検証
- **リスク**: 低（pure 関数置換）

### finding-A5: orchestrator.ts / repositories/tournaments.ts の tx prelude を helper 化

- **Lens**: architect
- **Severity**: medium
- **場所**:
  - orchestrator.ts: [86-95](../../../src/lib/services/seating/orchestrator.ts#L86-L95) / [232-240](../../../src/lib/services/seating/orchestrator.ts#L232-L240) / [608-616](../../../src/lib/services/seating/orchestrator.ts#L608-L616) / [735-743](../../../src/lib/services/seating/orchestrator.ts#L735-L743) / [854-862](../../../src/lib/services/seating/orchestrator.ts#L854-L862) / [987-995](../../../src/lib/services/seating/orchestrator.ts#L987-L995) — **6 箇所**
  - repositories/tournaments.ts: [313-322](../../../src/lib/firebase/repositories/tournaments.ts#L313-L322) / [422-431](../../../src/lib/firebase/repositories/tournaments.ts#L422-L431) / [515-524](../../../src/lib/firebase/repositories/tournaments.ts#L515-L524) / [581-592](../../../src/lib/firebase/repositories/tournaments.ts#L581-L592) — **4 箇所**
- **観察事実**: tx 内の「tournament 取得 + exists guard + groupId guard」boilerplate が **合計 10 箇所**で完全重複（各 7〜10 行）
  ```ts
  const tRef = tournamentRef(tid);
  const tSnap = await tx.get(tRef);
  if (!tSnap.exists()) {
    throw new AppError("not found", "firestore/not-found");
  }
  const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
  if (!userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  ```
- **影響**: groupId guard 仕様や error code を変えるとき 10 箇所同時変更が必要。前回 refactor の `wrapFirestoreWrite` / `wrapFirestoreRead` と同じ集約思想に欠けている層
- **案**: [src/lib/firebase/tx-helpers.ts](../../../src/lib/firebase/tx-helpers.ts) を新設し、汎用 helper を集約:
  ```ts
  export async function loadTournamentInTx(
    tx: Transaction,
    tid: string,
    userGroupIds: readonly string[],
  ): Promise<TournamentDoc> { ... }
  ```
  10 箇所を 1 行 (`const t = await loadTournamentInTx(tx, tid, userGroupIds);`) に置換 → 約 50 行削減
- **テスト保護**: 既存 orchestrator.test (12+ 件) + repositories/tournaments.test (50+ 件) の高密度 characterization。新規 `tx-helpers.test.ts` 追加（4 件: success / not-found / not-allowed / userGroupIds 含む型バリエーション）
- **リスク**: tx 内ロジックの書換のため race / state guard を壊さないよう慎重に。E2E が幅広くカバーするため検出は容易

### finding-A6: tournament-clone.ts の手書き型ガードを unwrapOrFrom に置換

- **Lens**: architect
- **Severity**: low
- **場所**: [src/lib/services/tournament-clone.ts:48-51](../../../src/lib/services/tournament-clone.ts#L48-L51)
- **観察事実**:
  ```ts
  throw e instanceof AppError
    ? e
    : AppError.from(e, "firestore/write_failed", "クローンに失敗しました");
  ```
  これは [error-logging.md](../../../.claude/rules/error-logging.md) の `unwrapOrFrom` パターンで 1 行化可能なのに、Phase 5.4 実装時に新しい helper が使われなかった drift
- **影響**: 規約 drift（前回 refactor で `unwrapOrFrom` を導入したが、新規コードへの浸透が完全ではない）
- **案**: `unwrapOrFrom(e, "firestore/write_failed", "クローンに失敗しました")` 1 行で置換
- **テスト保護**: 既存 [tournament-clone.test.ts](../../../src/lib/services/tournament-clone.test.ts)
- **リスク**: 極低

### finding-A7: orchestrator.ts の `playerFromSnap` helper（11 箇所重複）

- **Lens**: architect
- **Severity**: low
- **場所**: orchestrator.ts 内 11 箇所（`const fresh: PlayerDoc = { id: snap.id, ...snap.data() };` パターン）
- **観察事実**: snap → PlayerDoc 復元の 1 行が 11 箇所で重複。型注釈ヘルプが反復
- **影響**: 削減効果は限定的（11 行 → 11 行で行数は同じだが、可読性向上 + 型注釈集約）。ただし finding-A5 と同じ helper 化思想で纏めるのが自然
- **案**: orchestrator.ts 内 private helper、または finding-A5 と同じ tx-helpers.ts に `playerFromSnap(snap): PlayerDoc | null` を追加
- **テスト保護**: 既存 orchestrator.test
- **リスク**: 低（pure 関数）

### finding-A8: dashboard-client.tsx の audio toggle inline handler を局所抽出

- **Lens**: architect
- **Severity**: low
- **場所**: [src/app/tournaments/[tid]/dashboard-client.tsx:401-423](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L401-L423)
- **観察事実**: audio toggle の `updateAudioSettings + unwrapOrFrom + setError + refreshGroups` の 23 行 callback が dashboard inline で TimerControls に prop として渡されている
- **影響**: dashboard 肥大化の局所要因。同 logic は他で使われていない
- **案**: dashboard-client.tsx 内に局所 `handleToggleAudio` 関数を抽出（hook 化までは過剰、KISS 範囲）
- **テスト保護**: audio-settings E2E（既存）
- **リスク**: 極低

### finding-S1: `groupJoinCodes.usesCount` の DoS 空消費（既知・対策見送り）

- **Lens**: security
- **Severity**: medium（既知、Cloud Functions 化が前提のため Phase 5+ に先送り）
- **場所**: [firestore.rules:240-249](../../../firestore.rules#L240-L249)
- **観察事実**: 認証済みユーザーは `usesCount + 1` の単独 update を rule で許可されており、流出した招待コード文字列に対して任意ユーザーが `maxUses` まで空消費して DoS できる
- **影響**: 現状 default `maxUses: null` のため顕在化しないが、`maxUses` UI を将来追加する際は必須対策
- **案**: 前回 refactor の finding-11 と同じく **Cloud Functions（Callable）化** が現実解。今回は再録のみ
- **テスト保護**: なし（既知リスクの記載のみ）
- **リスク**: なし（コード変更しない）

### finding-S2: `tournaments` route の bundle 肥大化（軽度）

- **Lens**: architect / performance
- **Severity**: low
- **場所**: `npm run build` 出力 — `/tournaments/[tid]` route 27.7 kB / First Load 351 kB
- **観察事実**: dashboard-client.tsx の 597 行 + 関連 sub-component import が 1 route に集中
- **影響**: 初回ロード時間（特にスマホ会場）。20 人サークル規模で実害は無いが、refactor の副次効果として finding-A1 で hook 抽出すれば 15〜20 kB は減る見込み
- **案**: finding-A1 / A8 の対応で副次的に改善
- **テスト保護**: build size を監視する仕組みは現状なし。本 refactor 後の実測比較で記録
- **リスク**: なし

---

## サマリ

| Severity | 件数 | 解決予定 | 見送り |
| --- | --- | --- | --- |
| critical | 0 | 0 | 0 |
| high | 0 | 0 | 0 |
| medium | 5 | 5 | 0 |
| low | 4 | 4 | 0 |
| info / 既知 | 1 (S1) | 0 | 1 |
| **合計** | **10** | **9** | **1** |

特徴:
- 前回 refactor で集約した helper（`wrapFirestoreWrite` / `unwrapOrFrom` / `tournament-state.ts` / 5 sub-component 分割）は維持されている
- Phase 5.x の機能追加で **dashboard-client.tsx に状態管理が逆流**（finding-A1）し、同卓計算の重複（A2）と `isOrganizer` 判定の drift（A4）が発生
- orchestrator / repositories の **tx prelude 10 箇所**（A5）は前回未着手の構造的負債で、Phase 5.x で更に増えた
- セキュリティ重大項目は新規追加なし。S1 は既知の継続課題

## 関連

- 前回レビュー: [.claude/PRPs/reviews/architect-refactor-20260430.md](architect-refactor-20260430.md)
- 前回レポート: [.claude/PRPs/reports/architect-refactor-20260430.md](../reports/architect-refactor-20260430.md)
- 規約: [.claude/rules/](../../rules/) （error-logging / firebase-patterns / group-membership / security-base / security-env / testing）
