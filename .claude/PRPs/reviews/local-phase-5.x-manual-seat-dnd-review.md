# Local Review: Phase 5.x 手動席移動 D&D（運営者向け）

**Reviewed**: 2026-05-04
**Branch**: feature/phase5
**Scope**: uncommitted changes against HEAD（d660646）
**Decision**: APPROVE with comments

## Summary

`@dnd-kit/core` を新規導入し、`SeatingBoard` に運営者向けの席ドラッグ＆ドロップを足した変更。
engine 側は同卓 cascade 計算 (`planManualSeatCascade`) を pure function として追加し、orchestrator 側に
`applyManualSeatChange` / `applyManualSeatUndo` / `applyCascadeMoves` を追加。dashboard-client.tsx は
30 秒 undo banner 付きで結線。既存 `applySingleMove` には `verifyBalancingDiff` 引数を追加して手動経路では
diff-resolved guard を skip。テストは characterization fixture を追加し、合計 681 件 green。
typecheck / lint / build / vitest すべて pass。CRITICAL / HIGH なし。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M1. `engine.test.ts` の test 名が assertion と乖離**
- 場所: [src/lib/services/seating/engine.test.ts:310-329](src/lib/services/seating/engine.test.ts#L310-L329)
- 状況: `it("過剰卓全員 PD → null（バランシング不能）", ...)` だが、fixture の卓 2 は非 PD で move が成立し
  `expect(move?.playerId).toBe("x1")` で「成立」を assert している（コメント側で説明はしているが
  test 名と矛盾）。`null` 経路は `diagnoseBalancingNeed` 側のテストで `allPdMax` fixture で別途確認済み。
- 影響: テスト自体は green で動作正しいが、test 名が「null になるはずのケース」と誤読される。
  `git bisect` 等で見たときに混乱を招く。
- 提案: test 名を `"PD のみ卓が source 候補にならない（非 PD 卓の方が多い場合は逆方向で移動）"` 等の
  実際の挙動を表す名前に変更する。`null` 経路の characterization は `diagnoseBalancingNeed` 側で十分なので
  本テストはそのまま「成立する経路」の名前にした方が読みやすい。

**M2. `applyCascadeMoves` の `otherTablePlayerIds` が snapshot 由来で残存 race**
- 場所: [src/lib/services/seating/orchestrator.ts:578-587](src/lib/services/seating/orchestrator.ts#L578-L587)
- 状況: cascade の newly-occupied seat 衝突を検出するため `players` snapshot から「同卓の cascade 外プレイヤー」を
  抽出しているが、snapshot 取得後・本 tx 開始前に新規 player が当該卓に乱入（late entry / 別 cascade）した場合、
  その player は `otherTablePlayerIds` に含まれず `freshOthers` で再 read もされない。
- 影響: 20 人 × 月 1〜2 回スケールでは事実上発生しないが、PD ON race window と同列の残存 race として
  `setIsPlayingDealer` の doc comment（orchestrator.ts:953-961）と同様の説明を `applyCascadeMoves` 側にも
  添えると design intent が明確になる。
- 提案: `applyCascadeMoves` の冒頭 doc comment に「⚠ 残存 race window: snapshot 取得後に involved table へ
  新規 player が join した場合は newly-occupied 検証から漏れる。20 人スケールでは許容」のような注意書きを
  足す。コード変更は不要（実害が現実的にゼロのため）。

**M3. `applyManualSeatChange` の cross-table snapshot 検査が rules で再評価されない**
- 場所: [src/lib/services/seating/orchestrator.ts:493-506](src/lib/services/seating/orchestrator.ts#L493-L506)
- 状況: 卓間移動で drop 先が snapshot 上で占有されていれば早期 reject するが、これは UX 早期 return のための
  もので、Firestore Rules 側では強制されない。snapshot で空席だった場合は `applySingleMove` の `seat-taken`
  検査に委ねる設計（コメントに記載済み）。これは設計通りで実装も正しい。
- 影響: なし（設計通り）。
- 提案: `applyManualSeatChange` の JSDoc に「snapshot ベースの早期 reject は UX 用、最終 race guard は
  applySingleMove の `seat-taken`」と一行追記すると、将来 rule 側の再現を期待する人が混乱しなくて済む。

### LOW

**L1. `autoSeatLateEntry` の seed 計算が弱いハッシュ**
- 場所: [src/lib/services/seating/orchestrator.ts:213-216](src/lib/services/seating/orchestrator.ts#L213-L216)
- 状況: `Date.now() ^ Array.from(playerId).reduce(...)` で seed を作っており、衝突確率は実用上ゼロだが
  暗号学的強度はない。コメントで「seat 抽選用」と明記されているので問題ない。

**L2. `dashboard-client.tsx` の undo banner 30 秒タイマーは tab inactive で延びる**
- 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:232-235](src/app/tournaments/[tid]/dashboard-client.tsx#L232-L235)
- 状況: `setTimeout(... 30_000)` は tab background 中の throttle 対象なので 30 秒よりも長く undo 可能になる
  ことがある。30 秒 ≒ 「直近の操作」を表す UX 文脈では実害なし。

**L3. `SeatingBoard` の `dndBusy` は in-flight drag を中断できない**
- 場所: [src/components/tournament/SeatingBoard.tsx:274-280](src/components/tournament/SeatingBoard.tsx#L274-L280)
- 状況: `dndBusy=true` は次の drag を抑止するが、進行中の drag が drop して `onMoveSeat` を triggers した
  場合は `seatChangeBusy` の二重呼出ガード（dashboard-client.tsx:205）が効くので applied=false で抜ける。
  dnd-kit を完全停止させるには DndContext の `accessibility` 経由の cancel が必要だが、ここまでやる UX
  価値は低い。

**L4. `BalancingInstructionCard` は変更なし（path に出ているのは confirm 用）**
- 確認: `git diff --stat` でも本 commit セットに含まれていない。今回の D&D は SeatingBoard 経由で実装し、
  `BalancingInstructionCard`（候補ボタン UI）はそのまま残す方針で問題ない。

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass   |
| Lint       | Pass（`✔ No ESLint warnings or errors`） |
| Tests      | Pass（33 files / 681 tests） |
| Build      | Pass（`✓ Compiled successfully in 2.3s`、route diff: `/tournaments/[tid]` 28.2 kB） |

## Files Reviewed

- Modified: `package.json` / `package-lock.json` — `@dnd-kit/core@^6.3.1` 追加（MIT license / 公開リポジトリ運用 OK）
- Modified: `src/lib/services/seating/engine.ts` — `planManualSeatCascade` 追加（pure function、80 行追加）
- Modified: `src/lib/services/seating/engine.test.ts` — cascade 7 ケース追加（M1 で言及）
- Modified: `src/lib/services/seating/orchestrator.ts` — `applyManualSeatChange` / `applyManualSeatUndo` /
  `applyCascadeMoves` 追加、`applySingleMove` に `verifyBalancingDiff` パラメータ追加
- Modified: `src/lib/services/seating/orchestrator.test.ts` — 9 cases 追加
  （applyManualSeatChange × 6 / applyManualSeatChange same-table cascade × 3 / applyManualSeatUndo × 2）
- Modified: `src/components/tournament/SeatingBoard.tsx` — `DndContext` 包み + `DnDSeat` / `PlainSeat` 分岐
- Modified: `src/app/tournaments/[tid]/dashboard-client.tsx` — `handleMoveSeat` / `handleUndoSeatChange` /
  undo banner（30 秒自動消去）

## 設計強み

- engine（pure）と orchestrator（tx）の責務分離が一貫している。`planManualSeatCascade` は busted /
  PD / target=source の defensive guard を持ち、各 case にテストがある。
- `applyCascadeMoves` の race guard は cascade 各 player の `lastMovedAt` + from-seat 一致 + newly-occupied
  seat の他 player 占有再確認で 3 重防御。既存 `applySingleMove` / `applyTableBreak` と同じ設計言語。
- `applySingleMove` への `verifyBalancingDiff: boolean = true` の追加は破壊的変更ゼロ（既存呼出は default で
  従来挙動）。手動経路だけ false で skip する分岐が明示的でレビューしやすい。
- undo は cascade 全体を reverse 適用する設計で、単純 1 件 move は `applySingleMove` 経由・cascade は
  `applyCascadeMoves` 経由と内部実装の使い分けが透過的。

## 推奨アクション

1. M1（test 名修正）— 単純 rename。次回 commit に含めることを推奨。
2. M2（doc comment 追加）— 1〜2 行のコメント追記。後追い PR で十分。
3. M3（doc comment 追加）— 同上。
4. それ以外の LOW は記録のみ。

CRITICAL / HIGH 0 件、MEDIUM 3 件はいずれも doc / test 名の polishing で実装挙動への影響なし。
本変更は安全にコミット可能。
