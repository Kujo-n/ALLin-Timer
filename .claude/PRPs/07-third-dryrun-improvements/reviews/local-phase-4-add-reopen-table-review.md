# ローカルレビュー: Phase 4（07-third-dryrun-improvements）卓を増やす／再開

**レビュー日**: 2026-06-07
**ブランチ**: feature/phase3-4（未コミット変更）
**対象**: 「卓を増やす／閉じた卓を再開」機能の実装
**判定**: APPROVE（comments 付き）

## サマリー

運営者が席不足時に卓を増やし、閉鎖済み卓を再開できるようにする追加実装。`planAddTable` 純関数 ＋ `reopenTable` repository ＋ `useTableLifecycle` hook ＋ `UnseatedPlayersGuide` バナー ＋ SeatingBoard の「再開」ボタンの 5 層で構成され、いずれも既存規範（`useTableClose` / `markTableBroken` / 既存 D&D droppable）に忠実。Firestore rules は変更なしで成立し、その主張も検証で裏付けられた。CRITICAL / HIGH / MEDIUM の指摘はなく、検証はすべて green。

## Findings

### CRITICAL

なし

### HIGH

なし

### MEDIUM

なし

### LOW

- **L1 — 「再開」ボタンが書込中に visual disable されない（✅ 対応済み 2026-06-07）**
  [SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) /
  [useTableLifecycle.ts:75-89](../../../../src/lib/hooks/useTableLifecycle.ts#L75-L89)
  当初、`reopenBusy` は hook 内の再入ガード（`if (!uid || reopenBusy) return;`）にのみ使われ、UI 側のボタン disabled には連動していなかった（dashboard が `reopenBusy` を分割代入から外していた）。書込は idempotent な単独フィールド `updateDoc` で成功後は snapshot 反映でボタンが unmount されるため実害はなかったが、close ボタンとの UX 一貫性のため対応した。
  **対応内容**: `SeatingBoard` に `reopenBusy` prop を追加し再開ボタンに `disabled={reopenBusy}`（+ `disabled:opacity-50 disabled:pointer-events-none`）を付与。dashboard が hook の `reopenBusy` を `reopenTableBusy` として取り出して SeatingBoard へ渡す。`reopenBusy=true` 時に disabled かつクリック不発火を検証する component test を追加（SeatingBoard.test.tsx 11 件 green）。

- **L2 — 未配席ガイドが displayName を上限なしで全件連結**
  [UnseatedPlayersGuide.tsx:27-29](../../../../src/components/tournament/UnseatedPlayersGuide.tsx#L27-L29)
  未配席者名を `、` で全件 join するため、多数同時未配席時にバナーが伸長しうる。本アプリのスケール（≤20 名・通常の未配席は late entry の 1〜2 名）では顕在化しないため、現状の実装で妥当。将来大規模化する場合のみ件数キャップ（「他 N 名」表示等）を検討。

## 検証で確認した設計上の正しさ（特記）

- **rule 無変更の主張は正確**: reopen（`isBroken` 単独書換）は [firestore.rules:692-720](../../../../firestore.rules#L692-L720) の update 経路 A（`!affectedKeys().hasAny(['label','color'])`）でカバーされ、Phase 3 の `markTableBroken`（`isBroken:true`）と構造同型。卓追加（`upsertTable` の `setDoc`）は既存 `allow create`（organizer 限定）でカバー。本番 deploy 不要で permission-denied の罠なし。
- **MAX_TABLES 超過の防御層**: rule に `tableNum <= 6` 制約はなく、UI（`nextTableNum===null` で disabled）＋ service（early `onError`）で deny する方針。report で明示済みで、organizer は信頼ロール・空卓 doc は無害（players rule の `seatNum/tableNum <= 6` が seating を防御）という根拠も妥当。
- **engine 改修なしでの「追加/再開卓は自動配席対象外」**: [engine.ts:208-218](../../../../src/lib/services/seating/engine.ts#L208-L218) の `planLateEntrySeat` は着席プレイヤー集合からしか live 卓を導出しないため、空卓（追加/再開卓）は構造的に候補外。lock-in テストで固定済み。
- **ガイドバナーの表示条件**: `showSeatingBoard`（= `seating`/`running`/`paused` のみ true）配下かつ非 busted の `tableNum===null` のときのみ表示。`setup`（commit 前）では SeatingBoard 自体が非表示のため誤表示しない。さらに dashboard は非 organizer を `/live` へ redirect する（[dashboard-client.tsx:318-321](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L318-L321)）ため、ガイドは organizer のみに見える。
- **broken 卓を占有扱いにする判断**: `useTableLifecycle` が `tables.map(t => t.tableNum)` を `!t.isBroken` で filter せず planAddTable に渡すのは正しい。filter すると broken 卓番号を再 create して `setDoc` が上書きし、意図せず reopen 相当になる事故を防いでいる（コメントで明示済み）。
- **error helper の使い分け**: hook は `unwrapOrFrom` で素通し（repository が `wrapFirestoreWrite` で既に warn 済みのため二重 warn を回避）。error-logging.md 準拠。

## Validation Results

| Check      | Result                          |
| ---------- | ------------------------------- |
| Type check | Pass（`tsc --noEmit`）          |
| Lint       | Pass（`next lint`・警告 0）      |
| Tests      | Pass（unit 全 1568 件・100 file）|
| Build      | Skipped（typecheck で代替）     |

E2E（`tests/e2e/table-add-reopen.spec.ts`）は emulator + Playwright 必要のため本ローカルレビューでは未走行。マージ前に `npm run test:e2e` での走行を推奨（testing.md「E2E 走行のタイミング: 新機能 PR は実装直後と最終マージ前に最低 1 回ずつ」準拠）。

## Files Reviewed

- Modified: [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx)
- Modified: [src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) + test
- Modified: [src/lib/firebase/repositories/tables.ts](../../../../src/lib/firebase/repositories/tables.ts) + test
- Modified: [src/lib/services/seating/engine.ts](../../../../src/lib/services/seating/engine.ts) + test
- Added: [src/components/tournament/UnseatedPlayersGuide.tsx](../../../../src/components/tournament/UnseatedPlayersGuide.tsx) + test
- Added: [src/lib/hooks/useTableLifecycle.ts](../../../../src/lib/hooks/useTableLifecycle.ts) + test
- Added: [tests/e2e/table-add-reopen.spec.ts](../../../../tests/e2e/table-add-reopen.spec.ts)
- Docs: [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) / [.claude/rules/group-membership.md](../../../rules/group-membership.md) / PRD 進捗表
