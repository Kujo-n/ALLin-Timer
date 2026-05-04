# Local Code Review: Phase 5.x — TDA 準拠バランシング (operator-pick + diff-resolved race guard)

**Reviewed**: 2026-05-04
**Branch**: feature/phase5
**Scope**: 5 file の uncommitted 変更
**Decision**: APPROVE with comments（CRITICAL / HIGH なし）

## 変更概要

`applyBalancingOnce` の auto-pick（最小席番号）が TDA の「BB 次プレイヤー」を近似しきれない問題に対し、engine から `diagnoseBalancingNeed`（卓と席だけ算出、誰を動かすかは候補リストとして返す）を切り出し、UI が候補ボタンから運営者に選ばせる `applyManualBalancingMove` を追加。あわせて `applySingleMove` に **diff-resolved race guard**（snapshot → tx 間で source 卓のバストが進み diff < 2 になっていた場合の skip）を導入。

- `engine.ts`: `BalancingDiagnosis` 型 / `diagnoseBalancingNeed` 関数を追加。`planBalancingMove` は `diagnoseBalancingNeed.candidatePlayerIds[0]` ラッパに書き換え（互換性維持）。
- `orchestrator.ts`: `applyManualBalancingMove` 追加。`applySingleMove` に source 卓再カウント + `sourceActiveCount - destActiveCount < 2 → skipReason="diff-resolved"` を追加。
- `BalancingInstructionCard.tsx`: `breakPlan` / `diag` の二分岐表示。break は従来の自動適用、diag は候補プレイヤーのボタン列。
- 両 test に対応する 79 件のテストケース（all green）。

## Validation Results

| Check      | Result                                  |
| ---------- | --------------------------------------- |
| Type check | Pass (`tsc --noEmit` クリーン)          |
| Lint       | Pass (`next lint` 警告 0)               |
| Tests      | Pass (seating unit 79/79 green)         |
| Build      | Skipped（小規模な純粋実装変更のため）   |

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

#### M1. `applyManualBalancingMove` の候補フィルタが engine 側 `diagnoseBalancingNeed` と暗黙連動

[orchestrator.ts:361-401](../../src/lib/services/seating/orchestrator.ts#L361-L401) で `playerId` のバリデーションは個別フィールド再判定（`isBusted` / `tableNum === null` / `seatNum === null` / `isPlayingDealer` / `tableNum !== diag.sourceTableNum`）になっている。これは `diagnoseBalancingNeed` の `candidatePlayerIds` 抽出条件（[engine.ts:258-267](../../src/lib/services/seating/engine.ts#L258-L267)）と完全に同じ集合を表現するために**式の意味で同期**しているだけで、引数として `diag.candidatePlayerIds` を直接参照していない。engine 側にフィルタが追加された（例: `lastMovedAt` クールダウン / 「最後のラウンド以降に移動した player は除外」等）ときに orchestrator 側が静かに drift する。

**Suggested fix**: 個別 if 群の前に膜として 1 行だけ追加して engine を真実源にする。

```ts
// 候補ガードは engine 側 diag.candidatePlayerIds に集約する。
// 個別フィールドの判定（isBusted / tableNum / seatNum / isPlayingDealer / sourceTableNum）は
// すべて diagnoseBalancingNeed の filter 内に同居するため、そちらが真実源。
if (player.isPlayingDealer) {
  // PD は明示的なエラーで運営者に伝える（候補リストから外れている時点でクライアント UI には
  // 出ないが、サーバ側でも防御的に弾く）。
  throw new AppError(
    "PD（プレイングディーラー）はバランシングで移動できません",
    "seating/manual-pd-not-movable",
  );
}
if (!diag.candidatePlayerIds.includes(playerId)) {
  logger.info("manual balancing skipped (not a candidate)", { tid, playerId });
  return { applied: false, description: null };
}
```

これで engine の filter が変わっても orchestrator は自動追従し、静かな drift を防げる。

#### M2. `handleManualMove` で snapshot stale による silent no-op に運営者向けフィードバックがない

[BalancingInstructionCard.tsx:98-121](../../src/components/tournament/BalancingInstructionCard.tsx#L98-L121) は `applied=false` のとき `logger.info` で記録するが `onError` を呼ばない。orchestrator 側で `not on source table` / `player invalid` と判定された snapshot stale ケース（race direct）では、運営者は「ボタンを押したが何も起きない」状態になる。次の `onSnapshot` 反映までに数百 ms の lag があり、その間「壊れた」ように見える。

candidate ボタンは tx 内 race ではなく、card render 時点の snapshot と `applyManualBalancingMove` の判定 snapshot が一致しているケースが大半なので頻度は低いが、診断ログだけで沈黙する設計はテーブルバランシングという run-critical 操作には不親切。

**Suggested fix**: `applied=false` の場合に控えめなトーストを表示する。

```ts
if (!result.applied) {
  logger.info("manual balancing move skipped (race)", { tid, playerId });
  if (mounted.current) {
    onError?.("バランシング状態が更新されました。再度ご確認ください。");
  }
}
```

`onError` を「エラー」用途から汎用フィードバック chan に流用する形になるので、命名上もう少し丁寧にやるなら親 page 側で `onInfo` / `onWarn` を分けるのが筋（既存設計範囲では `onError` 流用で許容）。

### LOW

#### L1. diff-resolved guard は seat-taken と同じ snapshot-based undercount の race window を持つ

[orchestrator.ts:417-425, 484-498](../../src/lib/services/seating/orchestrator.ts#L417-L498) で `targetTableExistingIds` / `sourceTableExistingIds` は呼出時点の snapshot から構築される。snapshot 取得後・tx 開始前に当該卓へ late entry が新規追加された場合、その新 player の id は ID リストに入らないので tx.get で再 read されず、`destActiveCount` / `sourceActiveCount` が undercount される。結果: 実際は diff < 2 なのに guard が見逃して move を commit する経路が原理上残る。

snapshot stale window は seat-taken / lastMovedAt 既存 guard と同じ性質で、20 人 × 月 1〜2 回のスケールでは現実的に踏まない（Phase 5.1 PD docs と同じ判定）。新規 race を追加したわけではないので情報共有のみ。完全防止には source / dest 卓を `where("tableNum","==",N)` で tx 内 query するか Cloud Functions 化が必要。

#### L2. `applyBalancingOnce → planBalancingMove` 経路は production UI からほぼ unreachable

[BalancingInstructionCard.tsx](../../src/components/tournament/BalancingInstructionCard.tsx) は `breakPlan` が non-null のときだけ `applyBalancingOnce` を呼ぶ。orchestrator 内で `applyBalancingOnce` は最初に `planTableBreak` を再評価してから fallback として `planBalancingMove` を呼ぶ。`handleBreak` の起動条件と orchestrator 内の判定は同一 `players` snapshot を使うため、production では fallback 経路（`planBalancingMove → applySingleMove`）に到達しない設計になっている。

[engine.ts:296-302](../../src/lib/services/seating/engine.ts#L296-L302) のコメントも「characterization tests 互換」と明記しており、意図的な dead retention であることが分かる。問題ではないが、Phase 5.x 完了時点で `planBalancingMove` を `@deprecated` にし、次の architect-refactor で削除候補として残すとよい。

#### L3. `aria-label={\`balancing-candidate-${pid}\`}` は visible button label を screen reader 上で上書きする

[BalancingInstructionCard.tsx:165](../../src/components/tournament/BalancingInstructionCard.tsx#L165) の `aria-label` がボタンの可視テキスト（`プレイヤー名（席 N）`）を screen reader 上で上書きするため、視覚 UI と音声 UI が不一致になる。

ただし [BustButton.tsx:66](../../src/components/tournament/BustButton.tsx#L66) `bust-${pid}` / [PlayerList.tsx:126](../../src/components/tournament/PlayerList.tsx#L126) `pd-${displayName}` 等で同じパターンが既に確立されており、E2E selector 兼用の意図が読み取れる。WCAG 2.2 A11Y の観点では本来 `data-testid` への分離が望ましいが、本 PR で初出ではないので別タスクとしてフォローするのが妥当。

`balancing-apply-break` の方は visible text が「指示完了」で、aria-label の上書きにより operator が「balancing-apply-break」と読まれてしまう。同様に項目消費。

## ハイライト（良い変更点）

- **engine と orchestrator の責務分離が明示的に**: 「卓と席は engine、誰を動かすかは運営者」のハイブリッド設計をコメント・型・関数名で揃えていて、TDA 準拠の意図が後から読めるようになっている。
- **diff-resolved guard の test カバレッジ**: `applyBalancingOnce → applySingleMove` と `applyManualBalancingMove` 両方で同パターンの「他 player バスト → diff < 2」をテストしており、tx 内 race の代表シナリオが押さえられている。
- **race スキップ理由の明示化**: `skipReason = "diff-resolved"` のような string literal を追加して logger に流す形は、production trace で「なぜ commit されなかったか」を運営者・開発者双方が読める設計で良い。
- **`planBalancingMove` を `diagnoseBalancingNeed` 経由のラッパに書き換え**: characterization test 互換を保ちつつ実装の真実源を 1 つに集約しており、内部詳細依存していた既存テストを壊さずに refactor する手本になっている。

## Files Reviewed

| ファイル                                                  | 変更種別 |
| --------------------------------------------------------- | -------- |
| `src/lib/services/seating/engine.ts`                      | Modified |
| `src/lib/services/seating/engine.test.ts`                 | Modified |
| `src/lib/services/seating/orchestrator.ts`                | Modified |
| `src/lib/services/seating/orchestrator.test.ts`           | Modified |
| `src/components/tournament/BalancingInstructionCard.tsx`  | Modified |

## 推奨アクション

1. **M1**（候補フィルタ集約）と **M2**（運営者へ silent no-op フィードバック）は本 PR にマージ前に取り込むのを推奨。差分は小さい。
2. **L1 / L2 / L3** は別 issue / 次の architect-refactor で扱うのが適切。
3. CRITICAL / HIGH なしのため、commit ブロックは不要。
