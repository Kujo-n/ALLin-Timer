# Plan: Phase 5.2 — ダイナミック ブラインド調整（レベル時間の進行中変更）

## Summary

進行中のトーナメントで `tournaments/{tid}.structureSnapshot.levels[i].durationSec` を運営者（owner / organizer）が**任意レベル単位で書き換えられる**ようにする。「次のレベルだけ +5 分」「予定より早く終わらせるため後半レベルを 10 分に短縮」といった現場柔軟性を獲得する。schema は新規フィールド不要（既存 `levels[i].durationSec` を mutable 化する経路を 1 本追加するのみ）、Firestore Rules は既存の `tournaments/{tid}` `update` を `isOrganizer` で gate しているため追加不要。`StructureSnapshotCard` の各レベル行に inline edit（`Pencil` → `Input(min=1, unit=分)` → 保存/キャンセル）を追加し、Phase 4.17 の `useInlineNumberEdit` / `InlineNumberEditCard` パターンを mirror する。**現在進行中レベルの `durationSec` を変更したときの残時間挙動は「即時反映」**（`getRemainingMs` の数式 `duration - elapsed` がそのまま新しい duration を採用するため自然に再計算される。仕様として明示する）。

## User Story

As a サークル運営者（owner / organizer）,
I want 開始済みのトーナメントで、現在レベルや未来レベルの `durationSec` をその場で変更できる,
So that 「予定より進行が早い／遅い」場面で、トーナメント全体を作り直す or 手動 advance/revert を連打する代わりに、レベル時間を直接調整して TDA 進行を維持できる。

And as a サークル一般メンバー / 参加者,
I want 編集権限がない場合は表示のみで、誤操作で時間を変更してしまわない,
So that 自分が握っている `/live` から運営者だけがチューニングできる安心感がある。

## Problem → Solution

**Current state**:

- [src/lib/services/timer.ts:39-69](../../src/lib/services/timer.ts#L39-L69) `getRemainingMs` は `info.current.durationSec * 1000` を毎フレーム参照しており、`structureSnapshot.levels[i].durationSec` を書き換えるだけで残時間計算は新値で動く（再計算ロジックはすでに正しい）。
- [src/lib/firebase/repositories/tournaments.ts:296-372](../../src/lib/firebase/repositories/tournaments.ts#L296-L372) `advanceLevel` / `revertLevel` は **`currentLevel` だけを移動**するヘルパで、`durationSec` を変える経路は存在しない。`updateTournament` は `structureSnapshot` 丸ごとの更新を許すが、`state !== "setup"` の進行中編集を組織的に扱うフロー / UI が無い（`/tournaments/[tid]/edit` は `state === "setup"` のみ受付ける）。
- [src/components/tournament/StructureSnapshotCard.tsx:50-86](../../src/components/tournament/StructureSnapshotCard.tsx#L50-L86) は read-only。各レベル行の「分」セルに inline edit affordance がない。
- 運営者は現状、「予定より早く終わらせたい」場合は `advanceLevel`（手動）連打、「+5 分延ばしたい」は不可（`revertLevel` は前のレベルへ戻すだけで時間延長にならない）。
- [firestore.rules:316](../../firestore.rules#L316) は `tournaments/{tid}` `update` を `isOrganizer(resource.data.groupId)` で gate 済み — application は organizer 限定経路を作るだけで rule 側は変更不要。

**Desired state**:

- `StructureSnapshotCard` の各レベル行に、organizer 以上ロールのときのみ表示される **`Pencil` ボタン** が並ぶ。
- クリックすると当該レベルの「分」セルが `Input(min=1, type=number)` に置換され、保存ボタンで `setLevelDurationMin({ tid, uid, userGroupIds, levelIndex, durationMin })` を呼んで Firestore に書き戻す。
- `Esc` / 同値 / 空でキャンセル、`Enter` / blur では保存（`useInlineNumberEdit` の挙動を mirror）。
- 進行中レベル（`currentLevel === l.level`）を編集した場合、`/live` 含む全端末の残時間表示が `onSnapshot` で約 1 秒以内に新値ベースに切り替わる（数式 `duration - elapsed` が自然に追従）。
- 未来レベル（`l.level > currentLevel`）の編集は `getNextBreakInfo` の ETA も自動再計算される。
- 過去レベル（`l.level < currentLevel`）の編集は表示上は変更されるが進行には影響しない（運営者の混乱を避けるため UI 側で disabled にする）。
- 一般メンバー視点: `Pencil` ボタンは描画されず、表示は完全に既存と同じ（regression 0）。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 5.2（Phase 5.1 完了後に投入。提案 [tmp/14_運営者向け追加機能提案.md](../../../tmp/14_運営者向け追加機能提案.md) の優先度高 #5）
- **Stage scope**: schema 変更なし / Firestore Rules 変更なし / repository 1 関数追加 / service 1 関数追加 / `StructureSnapshotCard` に inline edit 統合（新コンポーネント `EditableLevelDurationCell` 抽出） / dashboard-client 側で `canEdit` prop を流す / tests
- **Estimated Files**: 約 9 files（repository 1 / service 1 / `StructureSnapshotCard` 1 + 新規 sub-component 1 / dashboard-client 1（prop 渡しのみ） / live-client は無変更（read-only） / tests 3 / docs 1）

---

## UX Design

### Before

```
┌── ストラクチャ snapshot ─────────────────────────┐
│ Lv │ SB    │ BB    │ Ante │ 分                  │
│ 1  │ 100   │ 200   │ 0    │ 12                  │
│ 2  │ 150   │ 300   │ 0    │ 12                  │
│ 3  │ 200   │ 400   │ 50   │ 12  ← 現在 Lv (sky) │
│ 4  │ 300   │ 600   │ 75   │ 12                  │
│ 5  │ ☕ BREAK                  │ 10              │
│ ...                                              │
└──────────────────────────────────────────────────┘

「Lv 4 を 17 分にしたい」運営者の動線:
  → 既存機能では不可能（structures 側を編集しても snapshot には反映されない）
```

### After（owner / organizer）

```
┌── ストラクチャ snapshot ─────────────────────────────┐
│ Lv │ SB    │ BB    │ Ante │ 分                      │
│ 1  │ 100   │ 200   │ 0    │ 12   (過去 disabled)    │
│ 2  │ 150   │ 300   │ 0    │ 12   (過去 disabled)    │
│ 3  │ 200   │ 400   │ 50   │ 12 ✎ ← 現在 Lv (sky)    │
│ 4  │ 300   │ 600   │ 75   │ 12 ✎                    │
│ 5  │ ☕ BREAK                  │ 10 ✎                │
│ ...                                                  │
└──────────────────────────────────────────────────────┘

Pencil クリック → 行が編集 mode に切替:
│ 4  │ 300   │ 600   │ 75   │ [ 17 ▲▼ ] 分 [保存] [×] │
```

### After（一般メンバー / `/live` 視聴者）

`Pencil` 列が描画されず、表示は Phase 4.17 完了時点と完全一致（regression 0）。

### Interaction Changes

| Touchpoint                         | Before                  | After                                                            | Notes                                                                          |
| ---------------------------------- | ----------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| StructureSnapshotCard の行         | 完全 read-only          | organizer のみ未来 / 現在 Lv 行に `Pencil` ボタン表示            | `canEditFutureLevels` prop（dashboard では `true`、live では `undefined`）     |
| 編集 mode 入力中の他端末表示       | 何も起こらない          | 何も起こらない（保存後に onSnapshot 経由で反映）                 | optimistic UI なし、`useInlineNumberEdit` 既定挙動                             |
| 進行中 Lv の `durationSec` 変更後  | 不可                    | 残時間表示が約 1 秒以内に新値ベースに再計算                      | `getRemainingMs` の `duration - elapsed` 数式が自然に追従                      |
| 進行中 Lv を短縮し残時間が負になる | 不可                    | `Math.max(0, ...)` で 0 クランプ → 次の auto-advance が発火      | `useTournamentTimer` の `shouldAutoAdvance` が次 tick で true になり advance 発火 |
| 過去 Lv の編集                     | 不可                    | UI 側で `disabled`（数式上 `getRemainingMs` には影響しないが混乱回避） | `levelIndex < currentLevel - 1` のとき編集ボタン非表示                          |
| `/tournaments/[tid]/edit`          | `state === "setup"` のみ | 変更なし（破壊しない）                                           | 進行中の structureSnapshot 丸ごと書換は依然 unsupported                        |

---

## Mandatory Reading

| Priority       | File                                                                                                                | Lines       | Why                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------- |
| P0 (critical)  | [src/lib/services/timer.ts](../../../src/lib/services/timer.ts)                                                      | 39-157      | `getRemainingMs` / `getNextBreakInfo` / `shouldAutoAdvance` の数式が新 `durationSec` で正しく再計算されることを確認 |
| P0 (critical)  | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts)                | 121-372     | `updateTournament` / `levelTransitionUpdates` / `advanceLevel` の組み合わせ。新規 `setLevelDuration` は同 wrap pattern を mirror |
| P0 (critical)  | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts)                            | 11-56       | `structureSnapshotSchema` / `levelSchema` の制約（`durationSec.positive()`）。partial update は `updateDoc` の dot-path で行うため schema 全体再 validate なし |
| P0 (critical)  | [src/lib/firebase/schemas/structure.ts](../../../src/lib/firebase/schemas/structure.ts)                              | 12-25       | `levelSchema.refine` の break 例外（break 時 `bb=0` 許容）。`durationSec` は無条件で正の整数 |
| P0 (critical)  | [src/lib/services/group.ts](../../../src/lib/services/group.ts)                                                      | 285-338     | `setFinishedTournamentCount` / `setDefaultSeatsPerTable` の service パターン（getGroup → assertOrganizer → repository 呼出）。今回は group ではなく tournament の groupId 経由なので少し変奏 |
| P0 (critical)  | [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx) | 1-93        | tbody の各レベル行を編集可能化する。`isCurrent` ハイライトと break 行の特殊処理を維持 |
| P0 (critical)  | [src/lib/hooks/useInlineNumberEdit.ts](../../../src/lib/hooks/useInlineNumberEdit.ts)                                | 75-150      | inline edit hook の契約（validate / save / onSaved / onError + Esc キャンセル + 同値 noop） |
| P1 (important) | [src/components/group/InlineNumberEditCard.tsx](../../../src/components/group/InlineNumberEditCard.tsx)              | 45-119      | `useInlineNumberEdit` を消費する view パターン（`canEdit` で edit ボタン gate） |
| P1 (important) | [firestore.rules](../../../firestore.rules)                                                                          | 311-407     | `tournaments/{tid}` の write を `isOrganizer(resource.data.groupId)` で gate 済み。**rule 追加不要** |
| P1 (important) | [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts)                                | 36-134      | `isInProgress` / `isAcceptingLateSeats` 等の純関数。今回は新たな predicate を 1 つ追加（`canEditLevelDurations`） |
| P1 (important) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx)            | 40-299, 537-541 | `useGroupRole` の使い方、`isOrganizer` 算出、`StructureSnapshotCard` 配置位置 |
| P2 (reference) | [.claude/PRPs/plans/completed/phase-4.17-group-default-seats-per-table.plan.md](completed/phase-4.17-group-default-seats-per-table.plan.md) | all         | 直近の inline-edit + organizer-only update のテンプレート。本 plan は同骨格を踏襲 |
| P2 (reference) | [src/components/structure/LevelTable.tsx](../../../src/components/structure/LevelTable.tsx)                          | 159-166     | structures 編集画面の duration min input の既存 UX（`min={1}` + `Math.max(1, parseIntSafe(min)) * 60`） |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md)                                              | 「単一フィールド単独書換の rule 経路」 | tournaments への新 single-field write 設計時のチェックリスト（今回は rule 変更なしだが慣習を踏襲する判断材料） |

## External Documentation

No external research needed — feature uses established internal patterns（Phase 4.16 / 4.17 で確立した inline edit + organizer-only single-field write の組み合わせ + Phase 4.11 で確立した `levelTransitionUpdates` / `lastLevelChangeKind` を踏襲）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:243-262
export async function updateFinishedTournamentCount(gid: string, value: number): Promise<void> {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError("...", "validation/finished-count-invalid");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "...",
    async () => { await updateDoc(groupDocRef(gid), { finishedTournamentCount: value }); },
    { gid },
  );
  logger.info("group finishedTournamentCount updated", { gid, value });
}
```

→ 命名: `update<Domain><Field>(<id>, value)` 形。本 plan では `updateLevelDurationSec(tid, levelIndex, durationSec)` とする（`update<Domain><Field>` を維持しつつ目的語が「level の duration」と分かる名前）。

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:121-134
export async function updateTournament(tid: string, patch: UpdateTournamentInput): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "トーナメント更新に失敗しました",
    async () => {
      await updateDoc(doc(tournamentsRef, tid), { ...patch, updatedAt: serverTimestamp() });
    },
    { tid },
  );
  logger.info("tournament update ok", { tid });
}
```

→ tournaments 系の write helper は `wrapFirestoreWrite` 経由。`{ tid }` を context として log に含める。AppError でラップしない直接 `updateDoc` は禁止（[error-logging.md](../../rules/error-logging.md)）。

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:333, 352
logger.info("advance level ok (auto)", { tid, uid, expected });
logger.info("advance level ok (manual)", { tid, uid });
```

→ 成功ログは wrap の**外**で `logger.info`（[firebase-patterns.md](../../rules/firebase-patterns.md) の「repository の error wrap」）。本 plan では `logger.info("level duration updated", { tid, uid, levelIndex, durationSec })`。

### REPOSITORY_PATTERN（dot-path partial update）

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:153-167（self-leave で dot-path delete）
await updateDoc(groupDocRef(gid), {
  memberUids: arrayRemove(uid),
  organizerUids: arrayRemove(uid),
  ownerUids: arrayRemove(uid),
  [`memberDisplayNames.${uid}`]: deleteField(),
});
```

→ Firestore は dot-path で nested map / array 要素の partial update が可能。**ただし `levels` は array のため `levels.0.durationSec` のような index path は Firestore SDK / Rules 双方で機能しない**（array index addressing は SDK サポート外、`arrayUnion` / `arrayRemove` のみ）。

→ **採用方針**: server 側で `tournament.structureSnapshot.levels` を read（`runTransaction` または事前 `getTournament`） → 該当 index の `durationSec` だけを差し替えた**新 levels 配列**を作成 → `structureSnapshot.levels: newLevels` の dot-path で `updateDoc` する。**race ガードのため `runTransaction` を採用**（複数運営者が同時に別レベルを編集した場合に最後勝ちにしない）。

### SERVICE_PATTERN（assertOrganizer + group lookup → repository）

```ts
// SOURCE: src/lib/services/group.ts:289-308
export async function setFinishedTournamentCount({ gid, uid, value }): Promise<void> {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError("...", "validation/finished-count-invalid");
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateFinishedTournamentCount(gid, value);
  logger.info("setFinishedTournamentCount ok", { gid, uid, value });
}
```

→ 本 plan は **group ではなく tournament 経由**で organizer 判定するため、`tournaments.ts` 側の既存 `assertCanManage(tid, userGroupIds)` を呼ぶ runTransaction で済ませる（service 層は不要、repository の中で済む）。理由: `userGroupIds` は `useCurrentGroup` から既に手元にあり、tournament 単位で 1 関数閉じる方が orchestration コストが低い。Phase 4.16 の `finishTournament` も同パターン（service 不要）。

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts（既存パターン抜粋）
vi.mock("firebase/firestore", () => ({
  /* updateDoc / runTransaction / serverTimestamp の mock */
}));

describe("setLevelDurationSec", () => {
  it("updates structureSnapshot.levels[levelIndex].durationSec via runTransaction", async () => {
    // arrange: makeTournament fixture, mock tx.get → snap.exists() = true
    // act: await setLevelDurationSec(tid, uid, [gid], 2, 720)
    // assert: tx.update called with structureSnapshot.levels === expected new array
  });

  it("throws permission-denied when user is not in groupId", async () => { /* ... */ });
  it("throws validation/level-duration-invalid for non-positive integers", async () => { /* ... */ });
  it("throws tournament/invalid-level-index for out of range", async () => { /* ... */ });
  it("preserves other levels unchanged", async () => { /* ... */ });
});
```

```ts
// SOURCE: src/lib/services/timer.test.ts（既存パターン）
describe("getRemainingMs after duration change", () => {
  // characterization test: 進行中 Lv の duration を 12min → 17min に変えた直後の残時間が
  // 「(17min - elapsed)」になっていることを確認（数式の自然な追従を documentation する）
});
```

---

## Files to Change

| File                                                                                                                                                      | Action | Justification                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts)                                                     | UPDATE | `setLevelDurationSec(tid, uid, userGroupIds, levelIndex, durationSec)` を `runTransaction` で追加                  |
| [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts)                                                                     | UPDATE | `canEditLevelDurations(t, levelIndex)`（過去レベルや setup 中の disable 判定）の純関数を追加                       |
| [src/lib/services/tournament-state.test.ts](../../../src/lib/services/tournament-state.test.ts)                                                           | UPDATE | `canEditLevelDurations` の characterization test を追加（state x levelIndex の組合せ）                              |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts)                                           | UPDATE | `setLevelDurationSec` の happy / 範囲外 / permission / race（`runTransaction` 競合）を追加                          |
| [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx)                                       | UPDATE | 各レベル行の「分」セルを `EditableLevelDurationCell` に切替（`canEdit && isFutureOrCurrent` のときのみ編集 affordance） |
| [src/components/tournament/EditableLevelDurationCell.tsx](../../../src/components/tournament/EditableLevelDurationCell.tsx)                               | CREATE | `useInlineNumberEdit` を消費する小さな td 内 view。Phase 4.17 `InlineNumberEditCard` の縮小版（カード枠ではなく cell 内）|
| [src/components/tournament/EditableLevelDurationCell.test.tsx](../../../src/components/tournament/EditableLevelDurationCell.test.tsx)                     | CREATE | render / Pencil 表示 / 編集 mode / Esc キャンセル / 保存呼出 の単体テスト                                          |
| [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx)                                                  | UPDATE | `<StructureSnapshotCard>` に `canEditLevelDurations`（`isOrganizer && !isFinished`）と `onUpdateDurationSec` callback を渡す |
| [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx)                                                  | NO CHANGE | live は read-only。`canEditLevelDurations` 未指定で従来挙動を維持（regression 0）                                  |

## NOT Building

- **新規 schema フィールド・新規 collection の追加**（既存 `levels[i].durationSec` の mutate のみ）
- **Firestore Rules の追加**（`tournaments/{tid}` update は既に `isOrganizer` で gate 済み）
- **structureSnapshot 全体の構造変更**（`levels.length` 増減 / break 切替 / sb/bb/ante 変更）— 本 plan は `durationSec` 単独編集のみ。残項目は将来の Phase 5.x 候補
- **`/tournaments/[tid]/edit` 画面の進行中編集対応**（依然 setup のみ）
- **複数レベルの bulk 編集 UI**（「Lv 4-9 を全部 +5 分」等）— MVP 後ヒアリング
- **Cloud Functions 化**（organizer 信頼ロールのため空書込攻撃のリスクは許容範囲。`finishedTournamentCount` と同方針）
- **過去レベル編集** — `levelIndex < currentLevel - 1` は UI で disabled（運営者の混乱回避）。schema / repository は受け付けるが UI が出さない
- **手動 advance/revert との衝突 UX**（編集中に別端末が advance した race の特別 UX）— `useInlineNumberEdit` の onError で警告表示、ユーザーがキャンセルで再評価する自然な動線

---

## Step-by-Step Tasks

### Task 1: `canEditLevelDurations` 純関数の追加と characterization test

- **ACTION**: [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts) に新 predicate を追加し、テストを先行投入する
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.2: 指定レベルの durationSec を運営者が編集できるか。
   *  - state === "setup": 全レベル編集可（structureSnapshot 全体の編集経路 /edit が別途あるが、こちらでも認める）
   *  - state === "seating" / "running" / "paused": currentLevel 以降のみ編集可（過去レベルは混乱回避で弾く）
   *  - state === "finished": 編集不可（履歴を改竄しない）
   *  - levelIndex は 0-based。currentLevel は 1-based のため `levelIndex >= currentLevel - 1` で「現在以降」を判定する
   *    （seating 中は currentLevel === 0 なので全レベル編集可）。
   */
  export function canEditLevelDurations(t: TournamentDoc, levelIndex: number): boolean {
    if (levelIndex < 0 || levelIndex >= t.structureSnapshot.levels.length) return false;
    if (t.state === "finished") return false;
    if (t.state === "setup") return true;
    return levelIndex >= t.currentLevel - 1;
  }
  ```
- **MIRROR**: 既存の `canPause` / `canAdvanceLevel` 等と同 file に並べる pure-function 形式（[src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts:80-100)）
- **IMPORTS**: `import type { TournamentDoc } from "@/lib/firebase/schemas/tournament"`（既存）
- **GOTCHA**: `currentLevel === 0`（setup / seating）では `levelIndex >= -1` が常に true。意図通りなのでガード不要だが、`finished` 後に edit 試みを deny する点だけテストで担保
- **VALIDATE**: `npm run test -- tournament-state` で characterization test が green

---

### Task 2: `setLevelDurationSec` repository 関数の追加

- **ACTION**: [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) に `runTransaction` ベースの新規関数を追加
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.2: 進行中（または setup 中）のトーナメントの structureSnapshot.levels[i].durationSec を
   * 単独書換える。Firestore の array element addressing は dot-path 非対応のため、tx 内で
   * 旧 levels 配列を read し、該当 index だけ置換した新配列を `structureSnapshot.levels` に書く。
   *  - userGroupIds に対象 tournament の groupId を含むかを事前 check し、最終防衛は Rules
   *  - 値域: durationSec は 1〜MAX_LEVEL_DURATION_SEC の整数（MAX は limits.ts から import、後述）
   *  - levelIndex の範囲外 / canEditLevelDurations === false は AppError
   *  - levelTransitionUpdates は呼ばない（currentLevel / levelStartedAt / pausedAt は変更しない）
   *  - lastLevelChangeKind も書換えない（音声判定のため "manual" を意味するが、これはレベル"遷移"ではない）
   */
  export async function setLevelDurationSec(
    tid: string,
    uid: string,
    userGroupIds: string[],
    levelIndex: number,
    durationSec: number,
  ): Promise<void> {
    if (!Number.isInteger(durationSec) || durationSec < 1 || durationSec > MAX_LEVEL_DURATION_SEC) {
      throw new AppError(
        `レベル時間は 1 秒以上 ${MAX_LEVEL_DURATION_SEC} 秒以下の整数で指定してください`,
        "validation/level-duration-invalid",
      );
    }
    if (!Number.isInteger(levelIndex) || levelIndex < 0) {
      throw new AppError("levelIndex が不正です", "tournament/invalid-level-index");
    }
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "レベル時間の更新に失敗しました",
      async () => {
        await runTransaction(firestore, async (tx) => {
          const ref = doc(tournamentsRef, tid);
          const snap = await tx.get(ref);
          if (!snap.exists()) {
            throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
          }
          const cur: TournamentDoc = { id: snap.id, ...snap.data() };
          if (!cur.groupId || !userGroupIds.includes(cur.groupId)) {
            throw new AppError("not allowed", "firestore/permission-denied");
          }
          if (!canEditLevelDurations(cur, levelIndex)) {
            throw new AppError(
              "このレベルは編集できません（過去レベルまたは終了済み）",
              "tournament/level-edit-not-allowed",
            );
          }
          const oldLevels = cur.structureSnapshot.levels;
          if (levelIndex >= oldLevels.length) {
            throw new AppError("levelIndex が範囲外です", "tournament/invalid-level-index");
          }
          const newLevels = oldLevels.map((l, i) =>
            i === levelIndex ? { ...l, durationSec } : l,
          );
          tx.update(ref, {
            "structureSnapshot.levels": newLevels,
            updatedAt: serverTimestamp(),
          });
        });
      },
      { tid, levelIndex, durationSec },
    );
    logger.info("level duration updated", { tid, uid, levelIndex, durationSec });
  }
  ```
- **MIRROR**: [src/lib/firebase/repositories/tournaments.ts:381-418](../../../src/lib/firebase/repositories/tournaments.ts#L381-L418) `finishTournament` の `runTransaction` 構造、および同 file [296-353](../../../src/lib/firebase/repositories/tournaments.ts#L296-L353) `advanceLevel` の transaction guard
- **IMPORTS**:
  ```ts
  import { canEditLevelDurations } from "@/lib/services/tournament-state";
  import { MAX_LEVEL_DURATION_SEC } from "@/lib/limits";
  ```
- **GOTCHA 1**: Firestore array dot-path（`structureSnapshot.levels.2.durationSec`）は **非対応**。SDK / Rules 双方が無視 or reject するため、必ず**配列全体を新オブジェクトで上書き**する。事前 read（`tx.get`）必須
- **GOTCHA 2**: `tx.update(ref, { "structureSnapshot.levels": newLevels, updatedAt: ... })` のように `structureSnapshot.levels` のみ dot-path で書換えれば、`structureSnapshot.name` / `initialStack` などは保持される（map 部分更新）。**`structureSnapshot` 全体を `{ levels: ... }` の object 1 個で上書きすると他フィールドが消える事故になる**ので注意
- **GOTCHA 3**: `lastLevelChangeKind` は書き換えない（duration 変更は「レベル遷移」ではないので `useAudioPlayer` の levelUp 検知トリガにしない）
- **GOTCHA 4**: tx 内で `cur.state === "running"` のレベルを編集した場合、`pausedAccumMs` / `levelStartedAt` は touch しない。残時間は `getRemainingMs` の数式 `duration - elapsed` がそのまま新 duration を採用するので追加処理不要
- **VALIDATE**:
  ```bash
  npm run test -- tournaments
  ```
  EXPECT: 新規追加したテスト（happy / 範囲外 / permission / race）すべて pass

---

### Task 3: `MAX_LEVEL_DURATION_SEC` を `limits.ts` に追加

- **ACTION**: [src/lib/limits.ts](../../../src/lib/limits.ts) に新定数を追加
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.2: 1 レベルの最大 durationSec。運営者が誤って `99999` 等を入れて
   * Firestore の int 上限まで膨らませることを防ぐ。値: 86400（= 24h）。
   * Phase 5.2 では rule 側で範囲制約を設けない（`tournaments/{tid}` update は organizer 信頼経路）が、
   * 将来 Cloud Functions 化する際の参照定数として残す。
   */
  export const MAX_LEVEL_DURATION_SEC = 86400;
  ```
- **MIRROR**: 同 file の `MAX_TABLES` / `MAX_SEATS_PER_TABLE` の宣言形（[src/lib/limits.ts:24-27](../../../src/lib/limits.ts#L24-L27)）
- **IMPORTS**: なし（top-level export）
- **GOTCHA**: `firestore.rules` に転記する必要なし（今回は rule 側で範囲制約を入れないため `scripts/test-rules-limits.mjs` への登録不要）
- **VALIDATE**: `npm run typecheck` で参照側（repositories/tournaments.ts）の import が解決すること

---

### Task 4: `EditableLevelDurationCell` 新規コンポーネントの作成

- **ACTION**: [src/components/tournament/EditableLevelDurationCell.tsx](../../../src/components/tournament/EditableLevelDurationCell.tsx) を新規作成
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { Pencil } from "lucide-react";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { useInlineNumberEdit } from "@/lib/hooks/useInlineNumberEdit";

  interface Props {
    /** 0-based level index（save callback に渡す）。 */
    levelIndex: number;
    /** 表示している durationSec（編集していないとき）。 */
    durationSec: number;
    /** 編集権限（false なら Pencil 非表示・read-only）。 */
    canEdit: boolean;
    /** 保存時の callback。新 durationSec（秒）を受け取る。失敗時に AppError throw 可。 */
    onSave: (levelIndex: number, durationSec: number) => Promise<void>;
    /** エラー時に呼ばれる（dashboard の setError に流す）。 */
    onError: (message: string) => void;
  }

  export function EditableLevelDurationCell({
    levelIndex,
    durationSec,
    canEdit,
    onSave,
    onError,
  }: Props) {
    // 表示単位は分。内部は秒で扱う（schema は秒）。
    const editor = useInlineNumberEdit({
      currentValue: Math.round(durationSec / 60),
      save: async (durationMin) => {
        await onSave(levelIndex, durationMin * 60);
      },
      validate: (n) =>
        Number.isInteger(n) && n >= 1 && n <= 1440
          ? null
          : "validation/level-duration-invalid: レベル時間は 1〜1440 分の整数で指定してください",
      onError,
      errorCode: "tournament/level-duration-failed",
      errorMessage: "レベル時間の更新に失敗しました",
    });

    if (!canEdit) {
      return <>{Math.round(durationSec / 60)}</>;
    }

    if (editor.editing) {
      return (
        <form onSubmit={editor.onSubmit} className="flex items-center gap-1">
          <Input
            ref={editor.inputRef}
            type="number"
            min={1}
            max={1440}
            step={1}
            value={editor.value}
            onChange={(e) => editor.onChange(e.target.value)}
            onKeyDown={editor.onKeyDown}
            aria-label={`Lv ${levelIndex + 1} の時間（分）`}
            disabled={editor.saving}
            className="h-7 w-16 text-xs"
          />
          <Button type="submit" size="sm" variant="outline" disabled={editor.saving}>
            {editor.saving ? "…" : "保存"}
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={editor.cancel} disabled={editor.saving}>
            ×
          </Button>
        </form>
      );
    }

    return (
      <button
        type="button"
        onClick={editor.start}
        aria-label={`Lv ${levelIndex + 1} の時間を変更`}
        className="inline-flex items-center gap-1 rounded px-1 hover:bg-muted"
      >
        {Math.round(durationSec / 60)}
        <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
      </button>
    );
  }
  ```
- **MIRROR**: [src/components/group/InlineNumberEditCard.tsx:60-119](../../../src/components/group/InlineNumberEditCard.tsx#L60-L119) の `editor.editing` 分岐 + Pencil 表示パターンを **table cell 内に圧縮**
- **IMPORTS**: 上記コードに記載
- **GOTCHA 1**: `Math.round(durationSec / 60)` で表示するため、`durationSec=720` なら `12 分` 表示。保存時は `min * 60` で 60 倍する。**60 で割り切れない `durationSec`（既存コードベースでは構造を分単位で作成するためほぼ発生しないが）は `Math.round` で丸まる**。LevelTable [src/components/structure/LevelTable.tsx:159](../../../src/components/structure/LevelTable.tsx#L159) と同方針
- **GOTCHA 2**: 編集 mode のフォームは `<form>` で submit を取る。Phase 4.17 の `InlineNumberEditCard` と同じ。**Enter で保存、Esc で cancel** が `useInlineNumberEdit` 側から自動配線
- **GOTCHA 3**: `<button>` を `<td>` 内で使う際、shadcn の `Button` は font / padding が大きすぎて行高さを壊すため、custom `<button class="inline-flex...">` を採用
- **GOTCHA 4**: `aria-label` は SR 利用者に「どのレベルを編集」が伝わるよう `Lv N の時間を変更` の形で固定
- **VALIDATE**: 単体テスト（後述 Task 6）が green

---

### Task 5: `StructureSnapshotCard` への組込み

- **ACTION**: [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx) に edit prop を追加し、`<td>` の「分」セルを `EditableLevelDurationCell` に切替
- **IMPLEMENT**:
  ```tsx
  // SOURCE: src/components/tournament/StructureSnapshotCard.tsx:7-14（既存 Props を拡張）
  interface Props {
    snapshot: StructureSnapshot;
    currentLevel?: number;
    showDescription?: boolean;
    className?: string;
    /** Phase 5.2: 各レベルの durationSec を編集できる callback。指定なしは read-only（既存挙動）。 */
    onUpdateDurationSec?: (levelIndex: number, durationSec: number) => Promise<void>;
    /** Phase 5.2: tournament（state + currentLevel）。各行の編集可否判定に使う。 */
    tournament?: TournamentDoc;
    /** Phase 5.2: ロール判定。owner / organizer のみ編集可。指定なし or false は read-only。 */
    canEdit?: boolean;
    /** Phase 5.2: 編集失敗時に呼ばれる（dashboard の setError に流す）。 */
    onEditError?: (message: string) => void;
  }
  ```

  tbody 内の break / 通常 行で、最終 td を以下に置換:
  ```tsx
  // canEdit + tournament 両方与えられたときのみ編集可能化、それ以外は従来表示
  const cellEditable =
    canEdit === true &&
    tournament !== undefined &&
    onUpdateDurationSec !== undefined &&
    canEditLevelDurations(tournament, l.level - 1);

  // 既存の `<td className="px-2 py-1">{Math.round(l.durationSec / 60)}</td>` を:
  <td className="px-2 py-1">
    {cellEditable && onEditError !== undefined ? (
      <EditableLevelDurationCell
        levelIndex={l.level - 1}
        durationSec={l.durationSec}
        canEdit
        onSave={onUpdateDurationSec}
        onError={onEditError}
      />
    ) : (
      Math.round(l.durationSec / 60)
    )}
  </td>
  ```
- **MIRROR**: 既存の `isCurrent` ハイライトロジック（[src/components/tournament/StructureSnapshotCard.tsx:51,72-76](../../../src/components/tournament/StructureSnapshotCard.tsx#L51)）を保持。break 行の処理 [L52-67](../../../src/components/tournament/StructureSnapshotCard.tsx#L52-L67) も同じ条件式で edit 可
- **IMPORTS**:
  ```ts
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  import { canEditLevelDurations } from "@/lib/services/tournament-state";
  import { EditableLevelDurationCell } from "@/components/tournament/EditableLevelDurationCell";
  ```
- **GOTCHA 1**: 旧 caller（`live-client.tsx`）は新 prop を渡さない → `cellEditable === false` で read-only 維持。**規制 0 を CI で検証する E2E や smoke テストで確認**
- **GOTCHA 2**: break 行も `EditableLevelDurationCell` を表示する（break レベルの長さ調整は十分ある運用ニーズ）。`l.isBreak` の特別扱いは数値表示のみ
- **GOTCHA 3**: `currentLevel` prop と `tournament.currentLevel` が二重情報になるが、`tournament` 必須化は破壊的変更なので両方残す。`canEditLevelDurations` は `tournament` から内部参照する
- **VALIDATE**: 既存の `StructureSnapshotCard.test.tsx`（あれば）の snapshot が edit prop なしで変わらないこと（regression 0）

---

### Task 6: `EditableLevelDurationCell` の単体テスト

- **ACTION**: [src/components/tournament/EditableLevelDurationCell.test.tsx](../../../src/components/tournament/EditableLevelDurationCell.test.tsx) を新規作成
- **IMPLEMENT**: 4-5 テストケース
  1. `canEdit === false` のとき Pencil ボタンを描画せず、数値だけ出る
  2. `canEdit === true` のとき Pencil 付きボタンが描画される（`aria-label` 含む）
  3. クリックで編集 mode に入り、`Input` に focus + select される（`requestAnimationFrame` を `vi.useFakeTimers` で消化）
  4. Esc で cancel、保存ボタンで `onSave(levelIndex, durationMin * 60)` が呼ばれる
  5. validate エラー（`-1` / 非整数）で `onError` に `validation/level-duration-invalid: ...` が渡る
- **MIRROR**: [src/lib/hooks/useInlineNumberEdit.test.ts](../../../src/lib/hooks/useInlineNumberEdit.test.ts)（あれば） / 他 component test の `vitest` + `@testing-library/react` パターン
- **IMPORTS**: `import { render, screen, fireEvent } from "@testing-library/react"`、`import { vi, describe, it, expect } from "vitest"`
- **GOTCHA**: `requestAnimationFrame` を `vi.useFakeTimers({ toFake: ["requestAnimationFrame"] })` で fake 化しないと focus 検証が flaky になる
- **VALIDATE**: `npm run test -- EditableLevelDurationCell` が green

---

### Task 7: `setLevelDurationSec` repository の単体テスト

- **ACTION**: [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) に describe ブロックを追加
- **IMPLEMENT**: 6 テストケース
  1. **happy path**: state="running" / currentLevel=3 / Lv 4（levelIndex=3）の duration を 720→1020 に変更 → tx.update が `{ "structureSnapshot.levels": [変更済み配列], updatedAt: ... }` で呼ばれる
  2. **other levels preserved**: 上記 happy path で levels[0..2,4..] の sb/bb/ante/durationSec が完全保持される
  3. **permission denied**: `userGroupIds` に対象 tournament の groupId が含まれない → `firestore/permission-denied`
  4. **range error**: `durationSec=0` / `durationSec=-1` / `durationSec=1.5` → `validation/level-duration-invalid`
  5. **invalid level index**: `levelIndex=-1` / `levelIndex=structureSnapshot.levels.length` → `tournament/invalid-level-index`
  6. **edit not allowed**: state="finished" / state="running" + 過去レベル → `tournament/level-edit-not-allowed`
  7. **race**: tx 内で別端末が advance してた → 編集対象が「現在以降」になっていれば成功、過去になっていれば `tournament/level-edit-not-allowed` で revert
- **MIRROR**: [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) の `finishTournament` race test、`advanceLevel` の expectedLevel guard test
- **IMPORTS**: 既存の vi.mock パターン
- **GOTCHA 1**: `runTransaction` mock は `tx.get` / `tx.update` の呼出順序を assert する。`tx.update` の引数オブジェクトは `expect.objectContaining({ "structureSnapshot.levels": ... })` で部分一致
- **GOTCHA 2**: fixture factory `makeTournament` を使い、`structureSnapshot.levels` の配列を 5-6 個用意
- **VALIDATE**: `npm run test -- tournaments` が green、coverage 維持

---

### Task 8: `dashboard-client.tsx` への配線

- **ACTION**: [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) の `<StructureSnapshotCard>` 呼出に props を追加
- **IMPLEMENT**:
  ```tsx
  // SOURCE: src/app/tournaments/[tid]/dashboard-client.tsx:537-541（既存）に prop 追加
  <StructureSnapshotCard
    snapshot={data.structureSnapshot}
    currentLevel={data.currentLevel}
    showDescription
    tournament={data}
    canEdit={isOrganizer}
    onUpdateDurationSec={async (levelIndex, durationSec) => {
      const groupIds = tournamentGroup ? [tournamentGroup.id] : [];
      await setLevelDurationSec(tid, user.uid, groupIds, levelIndex, durationSec);
    }}
    onEditError={setError}
  />
  ```
- **MIRROR**: 同 file [L518-535](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L518-L535) の `setIsPlayingDealer` 呼出パターン（`groupIds` 算出 + organizer check + setError）
- **IMPORTS**: `import { setLevelDurationSec } from "@/lib/firebase/repositories/tournaments"`
- **GOTCHA 1**: `setLevelDurationSec` は repository に直書きしているため service 層を経由しない。Phase 4.16 の `finishTournament` 同様、tournament の groupId 確認を repository tx 内で行う
- **GOTCHA 2**: `isOrganizer` は同 file [L299](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L299) で算出済み — 流用
- **GOTCHA 3**: live-client.tsx には何も追加しない（read-only のため）。`canEdit` 未指定 = 編集不可で従来挙動
- **VALIDATE**: ブラウザで dashboard を開き、organizer は Pencil 表示、member redirect で live は read-only

---

### Task 9: characterization test for `getRemainingMs` after duration change

- **ACTION**: [src/lib/services/timer.test.ts](../../../src/lib/services/timer.test.ts) に新 describe を追加
- **IMPLEMENT**: 「進行中レベルの `durationSec` を変えたら、次フレームで残時間が新値ベースに変わる」ことを documentation する characterization test を 2-3 件追加
  ```ts
  describe("getRemainingMs after structureSnapshot.levels[i].durationSec mutation", () => {
    it("running 中に現在 Lv の durationSec を 12min → 17min に増やすと残時間が +5min する", () => {
      // arrange: t.state="running", currentLevel=3, levels[2].durationSec=720, elapsed=300s
      // act: levels[2].durationSec を 1020 に書き換えた tournament で getRemainingMs を再評価
      // assert: 旧: 720000-300000=420000ms / 新: 1020000-300000=720000ms
    });
    it("現在 Lv の durationSec を経過時間より短くすると 0 にクランプされ、shouldAutoAdvance が true になる", () => {
      // arrange: elapsed=600s, levels[2].durationSec を 540s に短縮
      // assert: getRemainingMs === 0、shouldAutoAdvance === true
    });
    it("未来 Lv の durationSec 変更は現在 Lv の残時間に影響しない", () => {
      // arrange: 現在 Lv=2, levels[3].durationSec を変える
      // assert: getRemainingMs（Lv 2）は変化なし、getNextBreakInfo の etaMs は新値ベースに変化
    });
  });
  ```
- **MIRROR**: [src/lib/services/timer.test.ts](../../../src/lib/services/timer.test.ts) の `getRemainingMs` 既存テストの `Timestamp.fromMillis` パターン
- **IMPORTS**: 既存
- **GOTCHA**: `Timestamp.fromMillis` でテストの時刻基準を作る。`nowMs` を fixed value で固定して計算ずれを排除
- **VALIDATE**: `npm run test -- timer` が green

---

### Task 10: ローカル動作確認（運営者ドライラン）

- **ACTION**: dev server 起動 + ブラウザで dashboard を開いて手動確認
- **IMPLEMENT**:
  ```bash
  npm run dev
  ```
  確認項目:
  1. **owner / organizer**: dashboard で `StructureSnapshotCard` の各 行（現在 Lv 以降）に Pencil が出ること
  2. **member**: dashboard 自体に access 不可（既存 redirect）
  3. **`/live` 視聴者**: Pencil 出ない、表示は Phase 4.17 完了時点と完全一致
  4. 現在 Lv の duration を 12→7 分に変更 → 残時間が 7min - elapsed に切り替わる（数秒で `00:00` に到達して auto-advance）
  5. 未来 Lv の duration を 12→17 分に変更 → 次 break ETA が 5 分ぶん延びる（NextBreakCard で確認）
  6. 編集 mode で Esc / 同値 Enter / `0` 入力 / `9999999` 入力 / 空 Enter のキャンセル & エラー表示
  7. 別端末（タブ）で同時に別レベルを編集 → 両方反映、先勝ちにはならない（`runTransaction` で safe）
  8. 別端末が advance を押した直後に編集 → `tournament/level-edit-not-allowed` エラー表示で revert（過去になったため）
- **VALIDATE**: 上記 8 件すべて手動 OK

---

## Testing Strategy

### Unit Tests

| Test                                                                                   | Input                                              | Expected Output                                                          | Edge Case? |
| -------------------------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------------------------------ | ---------- |
| `canEditLevelDurations(setup, 0)`                                                      | state="setup", levelIndex=0                        | true                                                                     | -          |
| `canEditLevelDurations(seating, 5)`                                                    | state="seating", levelIndex=5                      | true                                                                     | -          |
| `canEditLevelDurations(running, 0)` w/ currentLevel=3                                  | levelIndex=0（過去）                               | false                                                                    | ✓          |
| `canEditLevelDurations(running, 2)` w/ currentLevel=3                                  | levelIndex=2（現在）                               | true                                                                     | -          |
| `canEditLevelDurations(paused, 5)` w/ currentLevel=3                                   | levelIndex=5（未来）                               | true                                                                     | -          |
| `canEditLevelDurations(finished, 5)`                                                   | state="finished"                                   | false                                                                    | ✓          |
| `canEditLevelDurations(running, -1)`                                                   | levelIndex 負                                      | false                                                                    | ✓          |
| `canEditLevelDurations(running, levels.length)`                                        | levelIndex 範囲外                                  | false                                                                    | ✓          |
| `setLevelDurationSec` happy（running 中の現在 Lv）                                     | tid / uid / [gid] / levelIndex=2 / durationSec=1020 | tx.update に `{ structureSnapshot.levels: [...新配列...], updatedAt }`    | -          |
| `setLevelDurationSec` other levels preserved                                           | 上記                                               | levels[0,1,3,4].durationSec が変化なし                                  | -          |
| `setLevelDurationSec` permission denied                                                | userGroupIds が対象 groupId を含まない             | `firestore/permission-denied`                                            | ✓          |
| `setLevelDurationSec` durationSec=0 / -1 / 1.5                                         | -                                                  | `validation/level-duration-invalid`                                       | ✓          |
| `setLevelDurationSec` levelIndex=-1 / levels.length                                    | -                                                  | `tournament/invalid-level-index`                                         | ✓          |
| `setLevelDurationSec` finished                                                         | state="finished"                                   | `tournament/level-edit-not-allowed`                                       | ✓          |
| `getRemainingMs` after duration mutation（現在 Lv +5min）                              | elapsed=300s, levels[idx].durationSec: 720→1020    | 旧 420_000 → 新 720_000                                                  | -          |
| `getRemainingMs` 短縮で 0 クランプ                                                     | elapsed=600s, durationSec: 720→540                 | 0、`shouldAutoAdvance === true`                                          | ✓          |
| `getRemainingMs` 未来 Lv 変更は現在 Lv 残時間に影響しない                              | currentLevel=2, levels[3] 変更                     | Lv 2 残時間 unchanged、Lv 4 break ETA 増減                              | -          |
| `EditableLevelDurationCell` canEdit=false                                              | -                                                  | Pencil 非描画、数値のみ                                                  | ✓          |
| `EditableLevelDurationCell` Pencil クリック → 編集 mode → 保存                         | onSave callback                                    | `onSave(levelIndex, durationMin*60)` で呼ばれる                          | -          |
| `EditableLevelDurationCell` Esc cancel                                                 | -                                                  | 編集 mode 抜出、`onSave` 未呼出                                          | -          |
| `EditableLevelDurationCell` validate error                                             | 入力 `-1` / `0` / 空 / 1500（>1440）               | `onError` に `validation/level-duration-invalid: ...`                    | ✓          |
| `EditableLevelDurationCell` 同値 noop                                                  | 既存値と同じ値で submit                            | `onSave` 未呼出、編集 mode 抜出のみ                                      | -          |

### Edge Cases Checklist

- [ ] `setLevelDurationSec` で配列 length が 1 のとき（最小レベル数）も動く
- [ ] `setLevelDurationSec` を異なるレベルに対して並行に runTransaction → 両方成功
- [ ] `setLevelDurationSec` を同じレベルに対して並行に runTransaction → どちらかが「最後に書いた値」で確定（Firestore の楽観ロックで safe）
- [ ] dashboard 編集中に別端末が finishTournament → 編集 cancel した場合は無事、submit した場合 `tournament/level-edit-not-allowed`（state="finished"）でエラー
- [ ] `currentLevel === 0`（setup / seating）でも全レベル編集できる
- [ ] break レベル（`isBreak === true`）の duration も編集できる
- [ ] `Math.round(durationSec / 60)` が 0 になる極小値（`durationSec=29` 等）→ UI 表示「0 分」だが内部 29 秒で動作。validate min は 1 分 = 60 秒なので保存は不可、表示のみ
- [ ] `/tournaments/[tid]/edit` 画面（setup のみ）の `structureSnapshot` 全体書換と本機能の互換性（`updateTournament` と `setLevelDurationSec` のレース）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
npm run lint
```

EXPECT: ゼロ type / lint エラー

### Unit Tests

```bash
npm run test -- tournament-state
npm run test -- timer
npm run test -- tournaments      # repositories/tournaments.test.ts
npm run test -- EditableLevelDurationCell
```

EXPECT: 既存テストと新規テストすべて pass、coverage 維持

### Full Test Suite

```bash
npm run test
```

EXPECT: 全 unit test green、regression なし

### Build

```bash
npm run build
```

EXPECT: build 成功

### Firestore Rules（変更なし確認）

```bash
npm run test:rules-limits
```

EXPECT: drift 検出 0（`MAX_LEVEL_DURATION_SEC` は rules 側に転記しないため EXPECTED に追加しない）

### Manual Browser Validation（dev server）

```bash
npm run dev
```

確認項目（[Task 10](#task-10) 詳細参照）:

- [ ] owner / organizer で各レベル行に Pencil 表示
- [ ] member（直接 `/tournaments/[tid]` 打ち）→ live にリダイレクト
- [ ] `/live` 視聴で Pencil 出ない（regression 0）
- [ ] 現在 Lv の duration 変更 → 残時間即時反映
- [ ] 未来 Lv の duration 変更 → NextBreakCard ETA 反映
- [ ] 過去 Lv は編集ボタン非表示（disabled）
- [ ] Esc / 同値 / 空 / 範囲外（0, -1, 1.5, 1500）で適切なエラー表示またはキャンセル
- [ ] 同時編集（別端末で別レベル）が両方成功
- [ ] state="finished" の tournament で編集ボタン非表示（または error）

---

## Acceptance Criteria

- [ ] `canEditLevelDurations` 純関数が pass し characterization test がすべて green
- [ ] `setLevelDurationSec` repository が runTransaction で実装され、permission / range / level-edit-not-allowed のエラーパスが test green
- [ ] `EditableLevelDurationCell` が `canEdit` prop で完全に gate される（false なら Pencil 非描画 + 数値のみ）
- [ ] `StructureSnapshotCard` の既存 caller（live-client）が**変更なしで read-only 維持**
- [ ] dashboard で organizer ロールが各 level の duration を inline edit で書き換えられる
- [ ] 現在 Lv 編集後、`getRemainingMs` が新値で再計算される（手動ブラウザ確認）
- [ ] typecheck / lint / test / build / `test:rules-limits` 全 green

## Completion Checklist

- [ ] Code follows discovered patterns（`useInlineNumberEdit` + `wrapFirestoreWrite` + `runTransaction`）
- [ ] Error handling: `AppError` ラップ、`validation/level-duration-invalid` / `tournament/invalid-level-index` / `tournament/level-edit-not-allowed` ドメインコード追加
- [ ] Logging: `logger.info("level duration updated", { tid, uid, levelIndex, durationSec })`
- [ ] Tests: characterization（純関数）+ repository unit + component unit + timer 数式の characterization
- [ ] No hardcoded values: `MAX_LEVEL_DURATION_SEC` は `limits.ts` から
- [ ] Documentation: 本 plan を `.claude/PRPs/plans/phase-5.2-dynamic-blind-adjustment.plan.md` に保存、PRD の Implementation Phases に Phase 5.2 行を追加（pending）
- [ ] No unnecessary scope additions: structureSnapshot 全体書換 / break 切替 / level 追加削除は触らない
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk                                                                                                          | Likelihood | Impact | Mitigation                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------- |
| 現在 Lv の duration 短縮で残時間が即 0 になり、観戦中の参加者が混乱（突然次 Lv にジャンプ）                   | 中         | 中     | Phase 4.11 で導入した `lastLevelChangeKind` は touch しないため、auto-advance が次 tick で発火 → blind-up 音は鳴る。**仕様として「短縮 = auto-advance 即発火」を運営者向けドキュメントに明記** |
| 配列全体上書きパターンの size 上限（Firestore 1 doc ≈ 1MiB）                                                  | 低         | 低     | レベル数 = 通常 12〜30、1 level ≈ 200B → 配列全体で ~6KB。1MB 上限にも全く届かない                                       |
| 過去 Lv 編集を弾く UI 判定が `currentLevel - 1` ベースで off-by-one                                           | 中         | 中     | `canEditLevelDurations` の characterization test で全 state x level 組合せを網羅                                          |
| 並行編集レース（2 organizer が同 levelIndex を同時編集）                                                      | 低         | 低     | `runTransaction` で楽観ロック。最後の write が勝つ（許容）                                                                |
| `60` で割って表示・`60` 倍で保存する round-trip で精度が落ちる（ユーザーが秒単位構造を組んだ場合）            | 低         | 低     | structures 編集 UI も分単位（[LevelTable.tsx:159](../../../src/components/structure/LevelTable.tsx#L159)）。秒精度は構造で持っていない前提なので問題なし |
| `setLevelDurationSec` が repository で `getTournament` + `assertCanManage` を経由せず tx 内で全 check するため、サービス層との bus 不整合 | 低         | 低     | Phase 4.16 `finishTournament` と同設計（tx 内で permission + state guard）。一貫性あり                                     |
| `useTournamentTimer` の auto-advance race（duration 短縮の同フレームで両端末が advance を試みる）             | 低         | 低     | `advanceLevel` の `expectedLevel` guard で 1 tx だけ通る既存設計が引き続き機能                                            |

## Notes

- 本 plan は `.claude/rules/firebase-patterns.md` の「単一フィールド単独書換の rule 経路」原則からは**逸脱**する（`structureSnapshot.levels` という map 配下の単独書換のため `affectedKeys().hasOnly([...])` の制約を rule で強制しない）。理由: `tournaments/{tid}` は既に `isOrganizer(groupId)` で gate 済みかつ `groups/{gid}` のような massively-shared trust boundary ではない。`finishTournament` も同 collection で organizer 信頼 + tx atomic + 値域チェックのみで済ませており、本 plan も同方針
- 将来 Cloud Functions 化（`tournaments/{tid}` の write を Callable に集約）を選んだ際は、`setLevelDurationSec` を 1 callable として移植可能。schema 影響なし
- 「現在 Lv の duration を変えると即時反映」という挙動は、`getRemainingMs` の数式 `duration - elapsed` が状態を持たない pure function であるおかげで自動的に成り立つ。**この性質を `timer.test.ts` の characterization test で documentation することで将来のリファクタが壊さない安全網になる**
- 提案 [tmp/14_運営者向け追加機能提案.md](../../../tmp/14_運営者向け追加機能提案.md) の「論点: 現在進行中レベルの残時間計算は ... 現在レベルの durationSec を変えた場合の挙動（即時反映 vs 次レベルから）を運営者ヒアリングで確認」について、本 plan は**「即時反映」**を採用した。理由: (1) 数式が自然に追従するため実装シンプル、(2) `revertLevel` で擬似的に同 Lv 先頭に戻す代替手段が既に存在する、(3) 短縮しすぎて auto-advance が即発火するケースは「結果的に運営者が手動 advance した」のと同じ意味で運営者の意図と整合する
