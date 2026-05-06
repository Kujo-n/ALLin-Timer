---
mode: local
phase: 5.2
title: Phase 5.2 — ダイナミック ブラインド調整（レベル時間の進行中変更）
date: 2026-05-06
reviewer: Claude (`/code-review` local mode)
decision: APPROVE
---

# レビュー結果: Phase 5.2 — Dynamic Blind Adjustment

**Decision**: APPROVE

## Summary

進行中（および setup / seating）トーナメントの `structureSnapshot.levels[i].durationSec` を運営者が
inline edit できる機能。`canEditLevelDurations` 純関数 / `setLevelDurationSec` repository（runTransaction
+ dot-path partial array overwrite）/ `EditableLevelDurationCell` を新設し、`StructureSnapshotCard` に
組込み済み。validation（typecheck / lint / 728 unit tests / build）すべて green、新規 44 test を含む。
schema・rules 変更なしで既存の `isOrganizer` rule path にそのまま乗る設計で、後方互換も維持されている
（`live-client.tsx` は新 prop 未指定で従来 read-only を維持）。

## Findings

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

なし。

### LOW

#### LOW-1: `dashboard-client.tsx:551-552` 余分な空行

[src/app/tournaments/[tid]/dashboard-client.tsx#L550-L553](src/app/tournaments/%5Btid%5D/dashboard-client.tsx#L550-L553) で
`<StructureSnapshotCard ... />` の閉じタグと `<Dialog>` の間に空行 2 行が挟まっている。実害なしの cosmetic。
急ぎでないが、次回の polish PR でついでに 1 行に詰めてもよい。

```tsx
        onEditError={setError}
      />


      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
```

**Fix（任意）**: 空行 1 行に。

#### LOW-2: `MAX_LEVEL_DURATION_SEC` は rule 側で enforce されない

[src/lib/limits.ts#L29-L38](src/lib/limits.ts#L29-L38) で `MAX_LEVEL_DURATION_SEC = 86400`（24h）を定義し、
[src/lib/firebase/repositories/tournaments.ts#L402-L411](src/lib/firebase/repositories/tournaments.ts#L402-L411)
で repository 層が値域を強制するが、`firestore.rules` の
`tournaments/{tid}` `allow update: if isOrganizer(resource.data.groupId);` は durationSec の上限を見ない。
`limits.ts` のコメントで「organizer 信頼経路のため rule 側制約は省略」と明示されており、`group-membership.md`
の既知のセキュリティリスク章 (`finishedTournamentCount` / `defaultSeatsPerTable`) と同じ「organizer 嫌がらせ」
パターンに分類される。Phase 5+ で Cloud Functions 化する際の参照定数として温存する設計判断は妥当。

**Action**: 不要（intentional / documented）。Phase 5+ で Callable 化する際に rule 側制約も検討。

#### LOW-3: 「未来 Lv 編集 → 編集中に auto-advance で当該 Lv が現在 Lv に格上げ」の UX corner case

例: 運営者が currentLevel=2 で Lv 3（未来）の編集モードに入る → 編集中にタイマー満了で auto-advance が
走り currentLevel=3 になる → submit 時の tx 内 read で `canEditLevelDurations(t, 2)` は `2 >= 3-1=2` で true
なので保存は成立するが、運営者の認知的には「未来 Lv の値を変えたつもりが現在 Lv に変更」となる。

実害は「進行中の残時間が即座に新値に追従する」だけで、データ整合は崩れない（`getRemainingMs` が
pure function で `duration - elapsed` を毎フレーム再評価するため自然に切替）。ただし運営者から見た
体感としては surprise になり得るので、将来 UI で「現在 Lv 編集時は警告ダイアログを出す」等の
拡張余地はある。今回は spec として許容範囲。

**Action**: 不要（許容範囲）。気になる場合は次 phase で confirm ダイアログを検討。

## Validation Results

| Check                      | Result | Notes                                                                              |
| -------------------------- | ------ | ---------------------------------------------------------------------------------- |
| Type check (`tsc --noEmit`) | Pass   | exit=0                                                                             |
| Lint (`next lint`)         | Pass   | warning / error なし                                                                |
| Unit tests (`vitest run`)  | Pass   | 728 / 728（新規 44 件含む）                                                         |
| Build (`next build`)       | Pass   | 全ルート生成 OK、`/tournaments/[tid]` の bundle size 28.3 kB                         |
| Firestore Rules            | N/A    | rules 変更なし（既存の `isOrganizer(resource.data.groupId)` path をそのまま利用）     |

## Reviewer Notes — 良かった点

1. **schema / rules 変更ゼロでの拡張** — `tournaments/{tid}` `update` が既に organizer-only な点と、
   `structureSnapshot.levels` 配列の dot-path partial overwrite が rule 側 `affectedKeys` 制約を持たない
   点を正しく理解しており、最小差分で機能追加できている。

2. **`runTransaction` + `levelIndex` 範囲・state の二段 guard** — repository 層で
   `Number.isInteger` 入力検証 → tx 内で `levelIndex >= oldLevels.length` 防衛 → `canEditLevelDurations`
   による state guard と多層防御。`finishTournament` の race guard と同じ流儀で読みやすい。

3. **characterization test の lock** — `timer.test.ts` の `getRemainingMs after structureSnapshot.levels[i].durationSec mutation`
   describe で「pure function が新値に自然追従する」性質を 4 ケースで lock した。次回 architect-refactor で
   `getRemainingMs` 周辺を触る際に regression を検出できる。

4. **既存呼出者の後方互換** — `StructureSnapshotCard` の新 props（`onUpdateDurationSec` / `tournament`
   / `canEdit` / `onEditError`）はすべて optional で、`live-client.tsx` 等の既存 caller は無変更で
   read-only 動作を維持。Phase 4 architect-refactor 流の additive 拡張パターンに準拠。

5. **テスト境界が helper 単位** — `EditableLevelDurationCell.test.tsx` は `useInlineNumberEdit` 内部実装には
   立ち入らず、`onSave(levelIndex, durationSec)` の helper 契約と `onError` propagation のみを assert する
   設計。[testing.md](../rules/testing.md) の mock 境界規約を遵守。

## Files Reviewed

| File | Change | Lines | Status |
| --- | --- | --- | --- |
| `src/lib/services/tournament-state.ts` | UPDATE | +20 | Approved |
| `src/lib/services/tournament-state.test.ts` | UPDATE | +77 | Approved |
| `src/lib/limits.ts` | UPDATE | +11 | Approved |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | +79 | Approved |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATE | +193 | Approved |
| `src/components/tournament/EditableLevelDurationCell.tsx` | CREATE | +105 | Approved |
| `src/components/tournament/EditableLevelDurationCell.test.tsx` | CREATE | +163 | Approved |
| `src/components/tournament/StructureSnapshotCard.tsx` | UPDATE | +57/-15 | Approved |
| `src/components/tournament/StructureSnapshotCard.test.tsx` | UPDATE | +142 | Approved |
| `src/lib/services/timer.test.ts` | UPDATE | +78 | Approved |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | +11/-3 | Approved (LOW-1) |
| `.claude/PRPs/plans/phase-5.2-dynamic-blind-adjustment.plan.md` | MOVED | - | Approved (completed/ へ移動) |
| `.claude/PRPs/reports/phase-5.2-dynamic-blind-adjustment-report.md` | CREATE | - | Approved |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | +1 | Approved |

## Next Steps

1. ✅ APPROVE — このまま `/prp-commit` / `/prp-pr` で commit & PR 作成可。
2. （任意）LOW-1 の空行を削るなら commit 前に 1 行 edit。
3. report.md の Task 10（手動ブラウザ動作確認）は PR レビュー時に reviewer が `npm run dev` で
   organizer / member / live 視聴者の 3 役で Pencil 表示・残時間追従・range 外エラーを目視確認推奨。
