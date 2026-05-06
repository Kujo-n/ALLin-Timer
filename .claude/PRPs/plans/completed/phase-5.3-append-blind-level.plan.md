# Plan: Phase 5.3 — Append Blind Level（進行中のレベル追加）

## Summary

事前作成したストラクチャの最終レベルに到達しても優勝者が決定しない場合に備え、運営者（owner / organizer）が**進行中のトーナメントに新規ブラインドレベルを末尾追加**できるようにする。
現状は `advanceLevel` が `currentLevel >= levels.length` で no-op するため最終レベルに張り付き、SB/BB/Ante が固定されたままチップ集約が遅延する。
`StructureSnapshotCard` の表末尾に「+ レベル追加」ボタン（organizer かつ `state !== "finished"` のみ表示）を配置し、`AppendLevelDialog` で SB / BB / Ante / durationMin / `isBreak` を入力。
repository は `appendLevel(tid, uid, gids, levelInput)` を `runTransaction` で追加し、tx 内で旧 `levels` を read → 末尾に push した新配列を `structureSnapshot.levels` の dot-path で書き戻す（Phase 5.2 `setLevelDurationSec` と同パターン、race-safe）。
schema 変更なし（`levelSchema` を流用）、Firestore Rules 変更なし（`tournaments/{tid}` update は既に `isOrganizer(resource.data.groupId)` で gate 済み）、`MAX_LEVELS_PER_TOURNAMENT=50` を `limits.ts` に追加して暴走防止。
最終レベル張り付き時の auto-advance no-op 挙動は維持し、append 後は次 tick で `shouldAutoAdvance` が新値ベースに自然追従して発火する。`/live` は read-only 維持（regression 0）。

## User Story

As a サークル運営者（owner / organizer）,
I want 進行中のトーナメントが事前ストラクチャの最終レベルに到達してもまだ複数人残っているとき、その場で新規レベル（SB/BB を 1.5〜2 倍にした追加レベル）を末尾に追加できる,
So that 「ストラクチャを使い切ったがまだ終わらない」場面で、毎回 advance/revert を連打して粘る運用を強いられず、TDA 進行（チップ集約）を維持しつつ自然に決勝へ向かえる。

And as a サークル一般メンバー / 参加者,
I want 編集権限がない場合は表示のみで、誤操作でレベル数が増えてしまわない,
So that 自分が握っている `/live` から運営者だけがチューニングできる安心感がある。

## Problem → Solution

**Current state**:

- [src/lib/services/timer.ts:150-157](../../src/lib/services/timer.ts#L150-L157) `shouldAutoAdvance` は `tournament.currentLevel < tournament.structureSnapshot.levels.length` をガードに含むため、最終レベル到達後は `false` を返し続ける（auto-advance 停止）。
- [src/lib/firebase/repositories/tournaments.ts:329](../../src/lib/firebase/repositories/tournaments.ts#L329) `advanceLevel` も `t.currentLevel >= t.structureSnapshot.levels.length` で early return し、手動「次レベル」ボタンも no-op。
- [src/components/tournament/StructureSnapshotCard.tsx:86-138](../../src/components/tournament/StructureSnapshotCard.tsx#L86-L138) は Phase 5.2 で各行 `EditableLevelDurationCell` 化されたが、**配列末尾に追加する経路は無い**。
- [src/app/tournaments/\[tid\]/edit/](../../src/app/tournaments/[tid]/edit/) は `state === "setup"` 限定のため、進行中トーナメントから structureSnapshot 全体を再編集する経路はない。
- [firestore.rules:316](../../firestore.rules#L316) は `tournaments/{tid}` `update` を `isOrganizer(resource.data.groupId)` で gate 済み — application は organizer 限定経路を作るだけで rule 側は変更不要。
- 運営者の現在の回避策は (1) ストラクチャ事前作成時に過剰なレベル数を仕込む、(2) 最終レベルに張り付いて手動 bust を待つ、のいずれか。「予測できない長期化」に対するアプリ側の支援が無い。

**Desired state**:

- `StructureSnapshotCard` の表末尾に **「+ レベル追加」ボタン** が並ぶ（organizer かつ `state !== "finished"` のみ表示）。
- クリックで `AppendLevelDialog` が開き、直前レベルから quick-fill された default 値（SB/BB を 2 倍、Ante はそのまま、durationMin はそのまま、isBreak=false）を上書き入力できる。
- 「追加」ボタンで `appendLevel({ tid, uid, gids, level: { sb, bb, ante, durationSec, isBreak } })` を呼び、`runTransaction` で旧 levels 配列を read → 末尾に push した新配列を `structureSnapshot.levels` に dot-path 書き戻し。`level` 番号は `oldLevels.length + 1` で repository が自動採番する。
- 追加直後に `onSnapshot` が発火し全端末に反映。最終レベルに張り付いていた場合、次 tick で `shouldAutoAdvance` が `currentLevel < levels.length` を満たして auto-advance が発火する（運営者は何もせずレベルが進む）。
- Phase 5.2 で完成済みの `EditableLevelDurationCell` がそのまま新レベルにも適用されるため、append 直後にもう一度 inline edit で時間調整が可能。
- 一般メンバー視点 / `/live` 視点: 「+ レベル追加」ボタンは描画されず、表示は Phase 5.2 完了時点と完全一致（regression 0）。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 5.3（Phase 5.2 完了後に投入。最終レベル張り付き issue は Phase 5.2 完了レビュー 2026-05-06 で確認）
- **Stage scope**: schema 変更なし / Firestore Rules 変更なし / repository 1 関数追加 / `tournament-state` に純関数 1 つ追加 / `limits.ts` に定数 1 つ追加 / `StructureSnapshotCard` に append callback prop 追加 / 新コンポーネント `AppendLevelDialog` を 1 つ追加 / dashboard-client 配線 / tests
- **Estimated Files**: 約 9 files（repository 1 / tournament-state 1 / limits 1 / `StructureSnapshotCard` 1 + 新規 Dialog 1 / dashboard-client 1 / tests 4 + plan 1）

---

## UX Design

### Before（運営者 dashboard・最終レベル張り付き）

```
┌── ストラクチャ snapshot ─────────────────────────────┐
│ Lv │ SB    │ BB    │ Ante │ 分                      │
│ 1  │ 100   │ 200   │ 0    │ 12                      │
│ 2  │ 150   │ 300   │ 0    │ 12                      │
│ ...                                                  │
│ 12 │ 2000  │ 4000  │ 500  │ 15  ← 現在 Lv（最終）   │
└──────────────────────────────────────────────────────┘

「タイマー 00:00 で張り付き、SB/BB が固定」
  → advanceLevel ボタンも disabled（最終レベル超過のため）
  → revert→play の繰り返ししか選択肢なし
```

### After（owner / organizer・dashboard）

```
┌── ストラクチャ snapshot ─────────────────────────────┐
│ Lv │ SB    │ BB    │ Ante │ 分                      │
│ 1  │ 100   │ 200   │ 0    │ 12                      │
│ ...                                                  │
│ 12 │ 2000  │ 4000  │ 500  │ 15 ✎ ← 現在 Lv（最終） │
│                                                      │
│ [ + レベル追加 ]  ← organizer・!finished のみ        │
└──────────────────────────────────────────────────────┘

ボタンクリック → AppendLevelDialog:
┌─ レベル 13 を末尾に追加 ──────────────────────┐
│ SB:       [ 4000  ]                          │
│ BB:       [ 8000  ]    （直前 BB の 2 倍）   │
│ Ante:     [ 500   ]                          │
│ 分:       [ 15    ]                          │
│ ☐ ブレイクとして追加                          │
│                                              │
│            [ キャンセル ] [ 追加 ]           │
└──────────────────────────────────────────────┘

「追加」 → onSnapshot 反映 → タイマーが新 Lv 13 で再カウントダウン
```

### After（一般メンバー / `/live` 視聴者）

「+ レベル追加」ボタンは描画されず、表示は Phase 5.2 完了時点と完全一致（regression 0）。

### Interaction Changes

| Touchpoint                                                | Before                                | After                                                                                          | Notes                                                                                                                |
| --------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| StructureSnapshotCard 末尾                                | 何も無し                              | organizer・`!finished` で「+ レベル追加」ボタン表示                                            | `canAppend` prop（dashboard では `true`、live では `undefined`）                                                     |
| AppendLevelDialog open                                    | ボタン無し                            | Dialog open / SB・BB・Ante・durationMin・isBreak フォームを直前レベルからの quick-fill で初期化  | break レベルを直前にしている場合は最後の非 break レベルから派生（zod の `!isBreak && bb<=0` refine を満たすため）   |
| 「追加」ボタン submit                                     | -                                     | `appendLevel` 呼出 → tx で `structureSnapshot.levels` を末尾追加で書換                          | `level` 番号は repository が `oldLevels.length + 1` で自動採番                                                       |
| 最終 Lv 張り付き状態で append 後                          | 永続的に no-op                        | 次 tick で `shouldAutoAdvance(t, now) === true` が成立 → auto-advance 発火 → 新 Lv にカウント開始 | `currentLevel < levels.length` の guard が満たされる                                                                 |
| 追加直後の `EditableLevelDurationCell` 編集               | -                                     | 末尾レベルも `canEditLevelDurations` で `levelIndex >= currentLevel - 1` を満たすため即編集可  | Phase 5.2 で実装済の inline edit が新レベルに自動適用                                                                |
| ストラクチャ snapshot doc サイズ上限                      | -                                     | `MAX_LEVELS_PER_TOURNAMENT=50` で UI / repository 双方が deny                                  | Firestore 1 doc 1MiB、1 level 約 80B → 50 levels で 4KB。実利用は 30 内に収まる前提                                |
| `/tournaments/[tid]/edit`                                 | `state === "setup"` のみ              | 変更なし（破壊しない）                                                                         | 進行中の structureSnapshot 丸ごと書換は依然 unsupported                                                              |
| `/live` ページ                                            | StructureSnapshotCard read-only       | 変更なし（`canAppend` 未指定で従来挙動）                                                       | regression 0。E2E で確認                                                                                             |

---

## Mandatory Reading

| Priority       | File                                                                                                                | Lines       | Why                                                                                                                                                       |
| -------------- | ------------------------------------------------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0 (critical)  | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts)                | 376-451     | Phase 5.2 `setLevelDurationSec` の `runTransaction` 内 array-rewrite パターン。`appendLevel` は同 file に並べて push パターンを mirror する                |
| P0 (critical)  | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts)                | 296-355     | `advanceLevel` の race guard 設計。最終レベル超過時の `t.currentLevel >= t.structureSnapshot.levels.length` 早期 return が append 後も維持される          |
| P0 (critical)  | [src/lib/services/timer.ts](../../../src/lib/services/timer.ts)                                                     | 150-157     | `shouldAutoAdvance` の `currentLevel < levels.length` 判定式。append 後の自動進行が成立する根拠                                                            |
| P0 (critical)  | [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts)                               | 93-156      | `canAdvanceLevel` / `canEditLevelDurations` 純関数群と並べて `canAppendLevel` を追加する位置                                                              |
| P0 (critical)  | [src/lib/firebase/schemas/structure.ts](../../../src/lib/firebase/schemas/structure.ts)                             | 12-25       | `levelSchema` の制約と break 例外の `.refine()`。append 時の入力 validation はこれを通すこと                                                              |
| P0 (critical)  | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts)                           | 11-19       | `structureSnapshotSchema.levels` の `min(1)` のみで上限なし。`MAX_LEVELS_PER_TOURNAMENT` は repository / UI 側で enforce                                  |
| P0 (critical)  | [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx) | 47-143      | `editingEnabled` 算出と tbody。append ボタンは tbody の外（CardContent 直下に footer 行）に置き、既存の current ハイライトロジックに干渉させない          |
| P0 (critical)  | [src/components/auth/DisplayNameDialog.tsx](../../../src/components/auth/DisplayNameDialog.tsx)                     | 1-97        | shadcn `Dialog` + form submit + AppError ラップ + setError の典型パターン。`AppendLevelDialog` は同骨格を踏襲                                              |
| P0 (critical)  | [src/lib/limits.ts](../../../src/lib/limits.ts)                                                                     | 1-39        | `MAX_LEVEL_DURATION_SEC` の宣言形を mirror。`MAX_LEVELS_PER_TOURNAMENT` を末尾に追加                                                                     |
| P1 (important) | [src/components/structure/LevelTable.tsx](../../../src/components/structure/LevelTable.tsx)                         | 86-99       | structures 編集画面の `addRow` quick-fill ロジック（last の bb\*2 / sb\*2 / ante そのまま / durationSec そのまま）。`AppendLevelDialog` の default で mirror |
| P1 (important) | [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts)     | 641-831     | `setLevelDurationSec` の test 構造（`mockTransaction` helper / `makeFiveLevelTournament` / happy / permission / range / state / wrap）を mirror           |
| P1 (important) | [src/components/tournament/StructureSnapshotCard.test.tsx](../../../src/components/tournament/StructureSnapshotCard.test.tsx) | 108-239     | Phase 5.2 で追加された edit prop test の配置。append 用も同 describe ブロックを追加                                                                       |
| P1 (important) | [src/lib/services/tournament-state.test.ts](../../../src/lib/services/tournament-state.test.ts)                     | 1-60        | `tournament(overrides)` factory 形式と `ALL_STATES` 配列パターン。`canAppendLevel` の characterization test もこの形を踏襲                                |
| P1 (important) | [firestore.rules](../../../firestore.rules)                                                                          | 310-316     | `tournaments/{tid}` update が `isOrganizer(resource.data.groupId)` で gate 済み。**rule 追加不要**を最終確認                                              |
| P2 (reference) | [.claude/PRPs/plans/completed/phase-5.2-dynamic-blind-adjustment.plan.md](completed/phase-5.2-dynamic-blind-adjustment.plan.md) | all         | array-rewrite + runTransaction + organizer-only update のテンプレート。本 plan は同骨格を踏襲                                                              |
| P2 (reference) | [tests/e2e/dynamic-blind-adjustment.spec.ts](../../../tests/e2e/dynamic-blind-adjustment.spec.ts)                   | all         | `readLevelDurationSec` REST helper / `seedOrganizerTournament` flow / `/live` regression パターン。append-blind-level の E2E は同 file 構造を mirror      |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md)                                              | 「単一フィールド単独書換の rule 経路」 | tournaments への新 single-field write 設計時のチェックリスト（今回も rule 変更なしだが慣習を踏襲する判断材料）                                            |

## External Documentation

No external research needed — feature uses established internal patterns（Phase 5.2 で確立した `setLevelDurationSec` の array-rewrite + `runTransaction` パターンを末尾 push に変奏するのみ）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:395-451 (setLevelDurationSec)
export async function setLevelDurationSec(
  tid: string,
  uid: string,
  userGroupIds: string[],
  levelIndex: number,
  durationSec: number,
): Promise<void> { /* ... */ }
```

→ 命名: `<verb><Object>(tid, uid, userGroupIds, ...rest)` 形。本 plan では `appendLevel(tid: string, uid: string, userGroupIds: string[], levelInput: AppendLevelInput): Promise<void>` とする。`levelInput` は `level` 番号を**含まない**入力 DTO（repository が自動採番する）。

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:402-414
if (
  !Number.isInteger(durationSec) ||
  durationSec < 1 ||
  durationSec > MAX_LEVEL_DURATION_SEC
) {
  throw new AppError(
    `レベル時間は 1 秒以上 ${MAX_LEVEL_DURATION_SEC} 秒以下の整数で指定してください`,
    "validation/level-duration-invalid",
  );
}
if (!Number.isInteger(levelIndex) || levelIndex < 0) {
  throw new AppError("levelIndex が不正です", "tournament/invalid-level-index");
}
```

→ tx 起動前の早期 validation は同 helper 内で `AppError` throw。本 plan の新ドメインコード:

- `validation/level-input-invalid` — sb/bb/ante/durationSec が型・値域違反、または break/!break の整合性違反（`!isBreak && bb <= 0`）
- `tournament/levels-limit-exceeded` — `oldLevels.length >= MAX_LEVELS_PER_TOURNAMENT`
- `tournament/append-not-allowed` — `state === "finished"` での append 試行
- `firestore/permission-denied` — userGroupIds に対象 groupId 含まれず（既存）
- `firestore/not-found` — tx 内で snapshot.exists() = false（既存）
- `firestore/write_failed` — runTransaction 自体の失敗（wrapFirestoreWrite が wrap、既存）

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:450
logger.info("level duration updated", { tid, uid, levelIndex, durationSec });
```

→ 成功ログは `wrapFirestoreWrite` の**外**で `logger.info`（[firebase-patterns.md](../../rules/firebase-patterns.md) の「repository の error wrap」）。本 plan では `logger.info("level appended", { tid, uid, newLevelNumber, isBreak, durationSec })`。

### REPOSITORY_PATTERN（dot-path partial array overwrite + tx race guard）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:419-446 (setLevelDurationSec の tx 本体)
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
  const oldLevels = cur.structureSnapshot.levels;
  // …state guard…
  const newLevels = oldLevels.map((l, i) =>
    i === levelIndex ? { ...l, durationSec } : l,
  );
  tx.update(ref, {
    "structureSnapshot.levels": newLevels,
    updatedAt: serverTimestamp(),
  });
});
```

→ Phase 5.2 と完全同パターン。`appendLevel` は `oldLevels.map` の代わりに `[...oldLevels, newLevel]` で末尾 push する。`structureSnapshot` 全体ではなく `structureSnapshot.levels` の dot-path で書くことで `name` / `initialStack` / `lateEntryDeadlineLevel` 等の他フィールドを保持する。

### SERVICE_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:395-451 (setLevelDurationSec)
//   service 層を経由せず repository が tx 内で組織者判定を完結させる。
//   userGroupIds は呼出側（dashboard-client）から手元の useCurrentGroup().groupIds を渡す。
```

→ Phase 5.2 と同方針。`appendLevel` も service を作らず repository に集約。Phase 4.16 `finishTournament` も同パターン。理由は `useCurrentGroup` から `groupIds` が既に手元にあり、tournament 単位で 1 関数閉じる方が orchestration コストが低いから。

### TEST_STRUCTURE（repository unit test）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:641-831 (setLevelDurationSec describe)
describe("setLevelDurationSec", () => {
  function makeFiveLevelTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
    return makeTournament({ /* 5 levels の structureSnapshot */, state: "running", currentLevel: 3, ...overrides });
  }
  function mockTransaction(state: TournamentDoc | null, captureUpdate?: ...) {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const tx = { get: vi.fn().mockResolvedValue({...}), update: vi.fn(...), ... };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
  }
  it("happy path: ...", async () => {/* ... */});
  it("preserves other fields ...", async () => {/* ... */});
  /* permission / range / state / wrap / race */
});
```

→ 本 plan の `appendLevel` test も同 file の同 describe 隣に配置。`mockTransaction` helper を流用（現在の export スコープが describe 内ならば `appendLevel` describe 内に再宣言してよい）。

### COMPONENT_PATTERN（shadcn Dialog + form submit）

```tsx
// SOURCE: src/components/auth/DisplayNameDialog.tsx:36-97
export function DisplayNameDialog({ open, onDone, initialName = "" }: Props) {
  const [name, setName] = useState(initialName);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await updateDisplayName(name);
      onDone();
    } catch (e) {
      const wrapped = AppError.from(e, "auth/unknown", "保存に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent>
        <form onSubmit={onSave}>{/* ... */}</form>
      </DialogContent>
    </Dialog>
  );
}
```

→ `AppendLevelDialog` も同骨格。違いは:

- `onOpenChange` は提供する（backdrop / Esc で閉じてよい — 必須 dialog ではない）
- 入力フィールド 5 種（sb / bb / ante / durationMin / isBreak）+ default を直前レベルから quick-fill
- submit 後 `onAppend` callback を await し、成功時は dialog を閉じる
- AppError は `unwrapOrFrom` で wrap（[error-logging.md](../../rules/error-logging.md) — repository が AppError ラップ済みなので二重 wrap 防止）

---

## Files to Change

| File                                                                                                                                                | Action    | Justification                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [src/lib/limits.ts](../../../src/lib/limits.ts)                                                                                                     | UPDATE    | `MAX_LEVELS_PER_TOURNAMENT = 50` を末尾追加                                                                                                                     |
| [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts)                                                               | UPDATE    | `canAppendLevel(t)` 純関数を `canEditLevelDurations` の隣に追加                                                                                                |
| [src/lib/services/tournament-state.test.ts](../../../src/lib/services/tournament-state.test.ts)                                                     | UPDATE    | `canAppendLevel` の characterization test を追加（state x levels.length 組合せ）                                                                              |
| [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts)                                               | UPDATE    | `appendLevel(tid, uid, userGroupIds, levelInput)` を `runTransaction` で追加（`setLevelDurationSec` の隣に配置）                                              |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts)                                     | UPDATE    | `appendLevel` の happy / permission / range / state / wrap / break / max-limit を追加                                                                          |
| [src/components/tournament/AppendLevelDialog.tsx](../../../src/components/tournament/AppendLevelDialog.tsx)                                         | CREATE    | shadcn `Dialog` + form。直前レベル quick-fill default + zod validate + onAppend callback                                                                       |
| [src/components/tournament/AppendLevelDialog.test.tsx](../../../src/components/tournament/AppendLevelDialog.test.tsx)                               | CREATE    | render / quick-fill default / break チェック時 sb/bb/ante=0 化 / submit / AppError 表示 の単体テスト                                                            |
| [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx)                                 | UPDATE    | `onAppendLevel` callback prop と `canAppend` prop を additive で追加。tbody の下（CardContent 内）に「+ レベル追加」ボタンと `<AppendLevelDialog>` を mount    |
| [src/components/tournament/StructureSnapshotCard.test.tsx](../../../src/components/tournament/StructureSnapshotCard.test.tsx)                       | UPDATE    | append button visibility（organizer・!finished のみ表示 / member 不可視 / live 不可視）の test を追加                                                          |
| [src/app/tournaments/\[tid\]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx)                                         | UPDATE    | `<StructureSnapshotCard>` に `canAppend={isOrganizer && !isFinished}` と `onAppendLevel={async (input) => appendLevel(tid, user.uid, groupIds, input)}` を渡す  |
| [src/app/tournaments/\[tid\]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx)                                          | NO CHANGE | live は read-only。`canAppend` 未指定で従来挙動を維持（regression 0）                                                                                          |
| [tests/e2e/append-blind-level.spec.ts](../../../tests/e2e/append-blind-level.spec.ts)                                                                | CREATE    | running 状態で organizer が append → Firestore に新レベル反映 → `EditableLevelDurationCell` でも編集可、`/live` で append ボタン非描画（regression 0）        |

## NOT Building

- **新規 schema フィールド・新規 collection の追加**（`levelSchema` / `structureSnapshotSchema` を流用）
- **Firestore Rules の追加**（`tournaments/{tid}` update は既に `isOrganizer` で gate 済み）
- **任意位置への levelInsert（途中行の挿入）**— 末尾 push のみ。途中挿入は `level` 番号の振り直しが必要で複雑性が跳ね上がる。MVP 後ヒアリング
- **levelDelete（行削除）**— 同上、現在 Lv との整合性管理が必要。`/tournaments/[tid]/edit`（setup のみ）は引き続き残るので削除はそちらで対応
- **bulk append（複数レベル一括追加）**— 1 レベルずつ追加する MVP で十分。実運用フィードバック後に判断
- **直前レベルからの auto-doubling 設定 toggle**（LevelTable のような autoSbHalf）— Dialog はステートレスで simplest path を取る。ユーザーは default を上書き可能
- **Cloud Functions 化**（organizer 信頼ロールのため空書込攻撃のリスクは許容範囲。`setLevelDurationSec` と同方針）
- **`/tournaments/[tid]/edit` 画面の進行中編集対応**（依然 setup のみ）
- **structureSnapshot.name / initialStack / lateEntryDeadlineLevel の進行中編集**（本 plan は `levels` 配列の末尾 push のみ）

---

## Step-by-Step Tasks

### Task 1: `MAX_LEVELS_PER_TOURNAMENT` を `limits.ts` に追加

- **ACTION**: [src/lib/limits.ts](../../../src/lib/limits.ts) に新定数を追加
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.3: 1 トーナメントの structureSnapshot.levels 配列の最大要素数。値: 50。
   *
   * 運営者が誤って append を連打して Firestore doc 1MiB 上限に近づくことを防ぐ。
   * 1 level ≈ 80B（zod schema の 5 数値 + 1 boolean）として 50 levels で約 4KB、
   * doc 全体でも 10KB 程度に収まり余裕がある。実運用は 30 内に収まる前提（NLH トーナメントの
   * 通常レベル数は 12〜25）で、50 は「異常系の防衛線」として設定する。
   *
   * Phase 5.3 では rule 側で範囲制約を設けない（`tournaments/{tid}` update は organizer 信頼経路、
   * `setLevelDurationSec` と同方針）。将来 Cloud Functions 化する際の参照定数として残す。
   */
  export const MAX_LEVELS_PER_TOURNAMENT = 50;
  ```
- **MIRROR**: 同 file の `MAX_LEVEL_DURATION_SEC` 宣言形（[src/lib/limits.ts:29-38](../../../src/lib/limits.ts#L29-L38)）
- **IMPORTS**: なし（top-level export）
- **GOTCHA**: `firestore.rules` には転記しない（rule 側で範囲制約を入れないため `scripts/test-rules-limits.mjs` への登録不要、Phase 5.2 と同方針）
- **VALIDATE**: `npm run typecheck` で参照側（repositories/tournaments.ts、tournament-state.ts、AppendLevelDialog.tsx）の import が解決すること

---

### Task 2: `canAppendLevel` 純関数を `tournament-state.ts` に追加

- **ACTION**: [src/lib/services/tournament-state.ts](../../../src/lib/services/tournament-state.ts) の末尾（`canEditLevelDurations` の直下）に新 predicate を追加
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.3: 末尾レベル append が可能か。
   *  - state === "finished": false（履歴を改竄しない）
   *  - state === "setup" / "seating" / "running" / "paused": levels.length < MAX_LEVELS_PER_TOURNAMENT
   *
   * MAX_LEVELS_PER_TOURNAMENT を超える append は repository / UI 双方で deny。
   */
  export function canAppendLevel(t: TournamentDoc): boolean {
    if (isFinished(t)) return false;
    return t.structureSnapshot.levels.length < MAX_LEVELS_PER_TOURNAMENT;
  }
  ```
- **MIRROR**: 既存の `canAdvanceLevel` / `canEditLevelDurations` と同じ pure-function 形式（[src/lib/services/tournament-state.ts:93-155](../../../src/lib/services/tournament-state.ts#L93-L155)）
- **IMPORTS**:
  ```ts
  import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";
  ```
- **GOTCHA**: `t.structureSnapshot.levels.length` は zod schema により最低 1 が保証されているため下限チェック不要。`isFinished` は同 file の既存述語を使う
- **VALIDATE**: `npm run test -- tournament-state` で characterization test が green（Task 3 と同時に検証）

---

### Task 3: `canAppendLevel` の characterization test を追加

- **ACTION**: [src/lib/services/tournament-state.test.ts](../../../src/lib/services/tournament-state.test.ts) に describe ブロックを追加
- **IMPLEMENT**: 5 ケース
  1. state="setup" / levels.length=3 → true
  2. state="seating" / levels.length=3 → true
  3. state="running" / levels.length=3 → true
  4. state="paused" / levels.length=3 → true
  5. state="finished" / levels.length=3 → false
  6. state="running" / levels.length=MAX_LEVELS_PER_TOURNAMENT → false（boundary）
  7. state="running" / levels.length=MAX_LEVELS_PER_TOURNAMENT-1 → true（boundary）
- **MIRROR**: [src/lib/services/tournament-state.test.ts:1-60](../../../src/lib/services/tournament-state.test.ts#L1-L60) の `tournament(overrides)` factory + `ALL_STATES` 配列パターン
- **IMPORTS**:
  ```ts
  import { canAppendLevel } from "./tournament-state";
  import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";
  ```
- **GOTCHA**: factory の `levels` array に MAX_LEVELS_PER_TOURNAMENT 個の dummy entry を作るには `Array.from({ length: 50 }, (_, i) => ({ level: i+1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }))` のようなヘルパーを使う
- **VALIDATE**: `npm run test -- tournament-state` が green

---

### Task 4: `appendLevel` repository 関数の追加

- **ACTION**: [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) の `setLevelDurationSec` の直下（`finishTournament` の前）に新規関数を追加
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.3: 進行中（または setup 中）のトーナメントの structureSnapshot.levels 末尾に
   * 新規レベルを 1 つ append する。Phase 5.2 setLevelDurationSec と同じ array-rewrite +
   * runTransaction パターン。
   *
   *  - 権限: `userGroupIds` に対象 tournament の groupId が含まれることを tx 内で再 check。
   *    最終防衛は Firestore Rules の `isOrganizer(resource.data.groupId)`。
   *  - 値域: levelInput は AppendLevelInput（sb/bb/ante: nonneg int / durationSec: 1..MAX_LEVEL_DURATION_SEC int /
   *    isBreak: bool）。`!isBreak && bb <= 0` は levelSchema の .refine() で deny される。
   *  - state: `canAppendLevel` で finished / 上限到達を弾く。
   *  - 採番: 新 level 番号は `oldLevels.length + 1`（呼出側で number を作らせない）。
   *  - 残時間挙動: 現在 Lv は変更されないため `getRemainingMs` は不変。最終 Lv 張り付き状態
   *    だった場合、次 tick で `shouldAutoAdvance` が `currentLevel < levels.length` を満たし
   *    auto-advance が発火する（運営者は何もせず新 Lv に進む）。
   *  - lastLevelChangeKind は touch しない（append は「レベル遷移」ではない）。
   */
  export interface AppendLevelInput {
    sb: number;
    bb: number;
    ante: number;
    durationSec: number;
    isBreak: boolean;
  }

  export async function appendLevel(
    tid: string,
    uid: string,
    userGroupIds: string[],
    levelInput: AppendLevelInput,
  ): Promise<void> {
    // tx 起動前の早期 validation（zod schema は tx 内 read 後に再評価される前提だが、
    // ネットワーク往復を節約するため明白な型違反はここで弾く）。
    if (
      !Number.isInteger(levelInput.sb) || levelInput.sb < 0 ||
      !Number.isInteger(levelInput.bb) || levelInput.bb < 0 ||
      !Number.isInteger(levelInput.ante) || levelInput.ante < 0 ||
      !Number.isInteger(levelInput.durationSec) ||
      levelInput.durationSec < 1 || levelInput.durationSec > MAX_LEVEL_DURATION_SEC ||
      typeof levelInput.isBreak !== "boolean" ||
      (!levelInput.isBreak && levelInput.bb <= 0)
    ) {
      throw new AppError(
        "新規レベルの入力値が不正です（SB/BB/Ante は 0 以上の整数、分は 1 以上、プレイレベルは BB > 0）",
        "validation/level-input-invalid",
      );
    }
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "レベル追加に失敗しました",
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
          if (isFinished(cur)) {
            throw new AppError(
              "終了済みのトーナメントにはレベルを追加できません",
              "tournament/append-not-allowed",
            );
          }
          const oldLevels = cur.structureSnapshot.levels;
          if (oldLevels.length >= MAX_LEVELS_PER_TOURNAMENT) {
            throw new AppError(
              `レベル数の上限（${MAX_LEVELS_PER_TOURNAMENT}）に達しています`,
              "tournament/levels-limit-exceeded",
            );
          }
          const newLevel: Level = {
            level: oldLevels.length + 1,
            sb: levelInput.sb,
            bb: levelInput.bb,
            ante: levelInput.ante,
            durationSec: levelInput.durationSec,
            isBreak: levelInput.isBreak,
          };
          const newLevels = [...oldLevels, newLevel];
          tx.update(ref, {
            "structureSnapshot.levels": newLevels,
            updatedAt: serverTimestamp(),
          });
        });
      },
      { tid, levelsLengthBefore: undefined },
    );
    logger.info("level appended", {
      tid,
      uid,
      isBreak: levelInput.isBreak,
      durationSec: levelInput.durationSec,
    });
  }
  ```
- **MIRROR**: [src/lib/firebase/repositories/tournaments.ts:395-451](../../../src/lib/firebase/repositories/tournaments.ts#L395-L451) の `setLevelDurationSec` 構造をそのまま流用
- **IMPORTS**:
  ```ts
  import type { Level } from "@/lib/firebase/schemas/structure";
  import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";
  // 既存の canAppendLevel / isFinished import に追加（tournament-state から）
  ```
  既存 import は `canEditLevelDurations` を持つため、 `canAppendLevel` を同 named import に追加。
- **GOTCHA 1**: Firestore array dot-path（`structureSnapshot.levels.50`）は **非対応**。必ず**配列全体を新オブジェクトで上書き**する（`setLevelDurationSec` と同 GOTCHA）
- **GOTCHA 2**: `tx.update(ref, { "structureSnapshot.levels": newLevels, updatedAt: ... })` のように `structureSnapshot.levels` のみ dot-path で書換えれば、`name` / `initialStack` / `lateEntryDeadlineLevel` 等の他フィールドは保持される
- **GOTCHA 3**: `lastLevelChangeKind` は書き換えない（append は「レベル遷移」ではないので `useAudioPlayer` の levelUp 検知トリガにしない）
- **GOTCHA 4**: `pausedAt` / `pausedAccumMs` / `levelStartedAt` / `currentLevel` は touch しない。tournament 進行は新レベル append とは独立（最終 Lv 張り付き状態だった場合、次 tick で auto-advance が自然発火する）
- **GOTCHA 5**: 早期 validation の `!isBreak && bb <= 0` 条件は zod の `levelSchema.refine` と同等。tx 内 zod 再評価は converter に委ねるが、明白な型違反はここで先に弾く方が UX 良い
- **GOTCHA 6**: `Level` 型は `levelSchema` の `.refine()` 後の型のため `isBreak: false` でも型エラーにならないが、TypeScript narrowing の都合で `bb` を任意指定できる必要がある。zod を介さず直接 `Level` object を作る場合、refine 違反は runtime まで残る — 早期 validation で覆っていることが必須
- **VALIDATE**:
  ```bash
  npm run test -- tournaments
  ```
  EXPECT: 新規追加した test（happy / 範囲外 / permission / state / wrap / break / max-limit）すべて pass

---

### Task 5: `appendLevel` repository の単体テスト

- **ACTION**: [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) の `setLevelDurationSec` describe の直下に describe ブロックを追加
- **IMPLEMENT**: 11 テストケース
  1. **happy path**: state="running" / levels.length=5 → tx.update に `{ "structureSnapshot.levels": [...5 levels..., 新 Lv 6], updatedAt }` で呼ばれる
  2. **other levels preserved**: 既存 levels[0..4] の sb/bb/ante/durationSec/isBreak が完全保持される
  3. **does not touch currentLevel / levelStartedAt / pausedAt / lastLevelChangeKind**: `setLevelDurationSec` と同様の no-touch 検証
  4. **permission denied**: `userGroupIds` に対象 tournament の groupId が含まれない → `firestore/permission-denied`
  5. **not found**: tx 内 snap.exists()=false → `firestore/not-found`
  6. **finished tournament**: state="finished" → `tournament/append-not-allowed`
  7. **max levels exceeded**: oldLevels.length=MAX_LEVELS_PER_TOURNAMENT → `tournament/levels-limit-exceeded`
  8. **invalid input — sb/bb/ante 負**: `validation/level-input-invalid`（早期 throw、tx 起動なし）
  9. **invalid input — durationSec=0 / -1 / 1.5 / Number.NaN / >MAX_LEVEL_DURATION_SEC**: `validation/level-input-invalid`
  10. **invalid input — !isBreak && bb=0**: `validation/level-input-invalid`（refine 違反）
  11. **break level OK with bb=0**: `isBreak: true, bb: 0, sb: 0, ante: 0, durationSec: 600` → tx.update に正常に push される
  12. **append during setup**: state="setup" / currentLevel=0 → 正常 append（state guard が finished のみ deny する仕様の lock）
  13. **wraps runTransaction errors as firestore/write_failed**: `mockRejectedValueOnce(new Error("perm"))` で wrap 経路が機能することを確認
- **MIRROR**: [src/lib/firebase/repositories/tournaments.test.ts:641-831](../../../src/lib/firebase/repositories/tournaments.test.ts#L641-L831) の `setLevelDurationSec` describe（`mockTransaction` helper と `makeFiveLevelTournament` factory を再利用 — 同 file 内に既存）
- **IMPORTS**:
  ```ts
  // 既存の import から:
  import { appendLevel, /* setLevelDurationSec, ... */ } from "./tournaments";
  import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";
  ```
- **GOTCHA 1**: `mockTransaction` helper は describe ローカル関数のため、新 describe 内でも同 helper を再宣言するか、外側 module スコープに hoist して共有する。Phase 5.2 が前者を取っているため踏襲（重複は許容）
- **GOTCHA 2**: max-limit test のために `Array.from({ length: 50 }, (_, i) => ({ level: i+1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }))` で 50 levels factory を作る
- **GOTCHA 3**: `tx.update` の引数オブジェクトは `expect.objectContaining({ "structureSnapshot.levels": ... })` で部分一致。captured array の length が `oldLength + 1` になっていることと、最後の要素が想定通りであることを assert
- **VALIDATE**: `npm run test -- tournaments` が green、coverage 維持

---

### Task 6: `AppendLevelDialog` 新規コンポーネントの作成

- **ACTION**: [src/components/tournament/AppendLevelDialog.tsx](../../../src/components/tournament/AppendLevelDialog.tsx) を新規作成
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { useEffect, useMemo, useState } from "react";

  import { Button } from "@/components/ui/button";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { unwrapOrFrom } from "@/lib/errors";
  import type { AppendLevelInput } from "@/lib/firebase/repositories/tournaments";
  import type { Level } from "@/lib/firebase/schemas/structure";
  import { logger } from "@/lib/logger";

  interface AppendLevelDialogProps {
    /** dialog 表示制御。trigger 側（StructureSnapshotCard）が制御する。 */
    open: boolean;
    /** open 状態を変える callback（backdrop / Esc / 「キャンセル」/ submit 成功時に false で呼ばれる）。 */
    onOpenChange: (open: boolean) => void;
    /** 既存 levels（quick-fill default の派生元と「新 Lv 番号」の表示に使う）。 */
    existingLevels: readonly Level[];
    /** 追加処理 — repository 呼出。AppError throw を許容（dialog が unwrapOrFrom で表示）。 */
    onAppend: (input: AppendLevelInput) => Promise<void>;
  }

  /**
   * Phase 5.3: 末尾レベル追加 dialog。
   *
   *  - default 値は「直前のプレイレベル（最後の非 break）」から派生させる:
   *    SB = last.sb * 2、BB = last.bb * 2、Ante = last.ante、durationMin = last.durationSec/60、isBreak = false
   *    全 break / 空配列の場合は控えめな初期値（sb=25 / bb=50 / ante=0 / dur=10 / isBreak=false）
   *  - isBreak チェック時は SB/BB/Ante を 0 に倒し、Input を disabled にする（LevelTable.toggleBreak と同方針）
   *  - submit 時は AppendLevelInput を組み立てて onAppend を await。成功時 onOpenChange(false)
   *  - 失敗時は AppError を unwrapOrFrom で wrap し dialog 内に表示（dialog は閉じない）
   */
  export function AppendLevelDialog({
    open,
    onOpenChange,
    existingLevels,
    onAppend,
  }: AppendLevelDialogProps) {
    const newLevelNumber = existingLevels.length + 1;

    const defaults = useMemo(() => {
      // last play level（後ろから探す）からの派生。全 break / 空なら控えめな初期値。
      for (let i = existingLevels.length - 1; i >= 0; i -= 1) {
        const l = existingLevels[i];
        if (l.isBreak) continue;
        return {
          sb: Math.max(0, l.sb * 2),
          bb: Math.max(1, l.bb * 2),
          ante: Math.max(0, l.ante),
          durationMin: Math.max(1, Math.round(l.durationSec / 60)),
        };
      }
      return { sb: 25, bb: 50, ante: 0, durationMin: 10 };
    }, [existingLevels]);

    const [sb, setSb] = useState(defaults.sb);
    const [bb, setBb] = useState(defaults.bb);
    const [ante, setAnte] = useState(defaults.ante);
    const [durationMin, setDurationMin] = useState(defaults.durationMin);
    const [isBreak, setIsBreak] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // dialog open 時に default を再 hydrate（前回の入力を引き継がない）。
    useEffect(() => {
      if (open) {
        setSb(defaults.sb);
        setBb(defaults.bb);
        setAnte(defaults.ante);
        setDurationMin(defaults.durationMin);
        setIsBreak(false);
        setError(null);
      }
    }, [open, defaults]);

    function toggleBreak(checked: boolean): void {
      setIsBreak(checked);
      if (checked) {
        // ブレイク化: SB/BB/Ante=0 で zod の `!isBreak && bb<=0` refine を通過。
        setSb(0);
        setBb(0);
        setAnte(0);
      } else {
        // ブレイク解除: BB は最低 1 に戻す（refine 通過のため）。
        setBb((prev) => Math.max(1, prev));
      }
    }

    async function onSubmit(e: React.FormEvent): Promise<void> {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        await onAppend({
          sb,
          bb,
          ante,
          durationSec: durationMin * 60,
          isBreak,
        });
        onOpenChange(false);
      } catch (e) {
        // repository が AppError ラップ済 → 二重 wrap を avoid
        const wrapped = unwrapOrFrom(e, "tournament/append-failed", "レベル追加に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code });
        setError(`${wrapped.code}: ${wrapped.message}`);
      } finally {
        setSubmitting(false);
      }
    }

    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>レベル {newLevelNumber} を末尾に追加</DialogTitle>
            <DialogDescription>
              直前レベルから派生した値を初期表示しています。必要に応じて上書きしてください。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSubmit} className="space-y-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isBreak}
                onChange={(e) => toggleBreak(e.target.checked)}
                aria-label="append-is-break"
              />
              <span>ブレイクとして追加</span>
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="append-sb">SB</Label>
                <Input
                  id="append-sb"
                  type="number"
                  min={0}
                  step={1}
                  value={sb}
                  disabled={isBreak}
                  onChange={(e) => setSb(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="append-bb">BB</Label>
                <Input
                  id="append-bb"
                  type="number"
                  min={isBreak ? 0 : 1}
                  step={1}
                  value={bb}
                  disabled={isBreak}
                  onChange={(e) => setBb(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="append-ante">Ante</Label>
                <Input
                  id="append-ante"
                  type="number"
                  min={0}
                  step={1}
                  value={ante}
                  disabled={isBreak}
                  onChange={(e) => setAnte(Number(e.target.value))}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="append-dur">分</Label>
                <Input
                  id="append-dur"
                  type="number"
                  min={1}
                  step={1}
                  value={durationMin}
                  onChange={(e) => setDurationMin(Number(e.target.value))}
                />
              </div>
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={submitting}>
                {submitting ? "追加中…" : "追加"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }
  ```
- **MIRROR**: [src/components/auth/DisplayNameDialog.tsx](../../../src/components/auth/DisplayNameDialog.tsx) の Dialog + form + AppError 表示パターン、[src/components/structure/LevelTable.tsx:68-79](../../../src/components/structure/LevelTable.tsx#L68-L79) の `toggleBreak` ロジック、[src/components/structure/LevelTable.tsx:86-99](../../../src/components/structure/LevelTable.tsx#L86-L99) の `addRow` quick-fill ロジック
- **IMPORTS**: 上記コードに記載
- **GOTCHA 1**: `useMemo` で defaults を計算するが、`open` true → false → true で同じ existingLevels を渡された場合は再計算が走らないので、`useEffect` で「open になったタイミングで再 hydrate」する。これによりユーザーが前回キャンセルした入力を引き継がない（運営者の意図に沿う）
- **GOTCHA 2**: `isBreak` チェック時に `bb=0` に倒すが、zod schema の `!isBreak && bb <= 0` refine をクリアするには「`bb=0` の状態で `isBreak` も `true` にセットされている」必要がある。state 更新の順序は `setIsBreak(true)` → `setBb(0)` で一度に doubleupdate される（React batching で同 frame）が、submit はその後の onSubmit で評価されるため race にならない
- **GOTCHA 3**: `<input type="checkbox">` の aria-label は `LevelTable` の慣例（`level-N-is-break`）と整合させ、test で getByLabelText に拾えるようにする。本 Dialog では `append-is-break` を採用（`level-N` の N が無いため）
- **GOTCHA 4**: defaults の派生は「最後の non-break」から取る。全 break / 空配列のときは fixed 初期値。これは `LevelTable.addRow` が `last.bb*2` だけで break 区別していない（refine が拾う）のと違うが、運用上はプレイレベルから派生する方が自然
- **GOTCHA 5**: error 表示は dialog 内 `<p role="alert">`。dialog を閉じずにユーザーが値を直して再 submit できる（DisplayNameDialog と同方針）
- **VALIDATE**: 単体テスト（後述 Task 7）が green

---

### Task 7: `AppendLevelDialog` の単体テスト

- **ACTION**: [src/components/tournament/AppendLevelDialog.test.tsx](../../../src/components/tournament/AppendLevelDialog.test.tsx) を新規作成
- **IMPLEMENT**: 8 テストケース
  1. open=false なら content 非描画
  2. open=true で title「レベル N を末尾に追加」が表示される（N = existingLevels.length + 1）
  3. defaults: 直前のプレイレベル sb=100/bb=200/ante=25/durationSec=600 → input value が 200 / 400 / 25 / 10 で初期化される
  4. defaults: 全 break / 空配列 → fixed 値 sb=25 / bb=50 / ante=0 / dur=10
  5. ブレイクチェック → SB/BB/Ante input が disabled、value=0 に倒れる、BB の min=0 になる
  6. submit → onAppend に `{ sb, bb, ante, durationSec: durationMin*60, isBreak }` が渡る
  7. onAppend reject (AppError) → dialog 内 `role="alert"` に `<code>: <message>` が表示、open 維持
  8. キャンセルボタン → onOpenChange(false) 呼出、onAppend 未呼出
  9. open=true → false → true でユーザー入力が defaults に再 hydrate（前回入力リセット）
- **MIRROR**: [src/components/tournament/EditableLevelDurationCell.test.tsx](../../../src/components/tournament/EditableLevelDurationCell.test.tsx)（あれば）の `vitest` + `@testing-library/react` パターン、[src/components/auth/DisplayNameDialog.tsx](../../../src/components/auth/DisplayNameDialog.tsx) のテスト（あれば）
- **IMPORTS**: `import { render, screen, fireEvent, act, within } from "@testing-library/react"`、`import { vi, describe, it, expect } from "vitest"`、`import { AppError } from "@/lib/errors"`
- **GOTCHA 1**: shadcn Dialog は Portal 経由で body に mount されるため `screen.getByRole(...)` で十分（document scope で検索）
- **GOTCHA 2**: open=false → true の rerender は `useEffect` で defaults 再 hydrate を fire するため、`act(() => { rerender(...) })` で flush する
- **VALIDATE**: `npm run test -- AppendLevelDialog` が green

---

### Task 8: `StructureSnapshotCard` への組込み

- **ACTION**: [src/components/tournament/StructureSnapshotCard.tsx](../../../src/components/tournament/StructureSnapshotCard.tsx) に append callback prop を追加し、tbody の下に「+ レベル追加」ボタン + `<AppendLevelDialog>` を mount
- **IMPLEMENT**:
  ```tsx
  // 既存 Props を additive に拡張:
  interface Props {
    /* ... 既存 props ... */
    /**
     * Phase 5.3: 末尾レベル追加 callback。指定なし or `canAppend !== true` のとき
     * append affordance を出さない。失敗時は AppError throw、Dialog が unwrapOrFrom で表示。
     */
    onAppendLevel?: (input: AppendLevelInput) => Promise<void>;
    /**
     * Phase 5.3: append 権限。owner / organizer かつ `state !== "finished"` のときのみ true。
     * 指定なし or false で append button 非表示（read-only）。
     */
    canAppend?: boolean;
  }

  // tbody の閉じタグの直後（CardContent 内）に append button を追加:
  // ...既存 table の閉じタグ </table> の直後 </div> の直後 </CardContent> の手前 ...
  {canAppend === true && onAppendLevel !== undefined ? (
    <div className="mt-3 flex justify-end">
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => setAppendOpen(true)}
        aria-label="レベル追加"
      >
        + レベル追加
      </Button>
      <AppendLevelDialog
        open={appendOpen}
        onOpenChange={setAppendOpen}
        existingLevels={snapshot.levels}
        onAppend={onAppendLevel}
      />
    </div>
  ) : null}
  ```

  component 関数の冒頭で:
  ```tsx
  const [appendOpen, setAppendOpen] = useState(false);
  ```

- **MIRROR**: [src/components/tournament/StructureSnapshotCard.tsx:47-143](../../../src/components/tournament/StructureSnapshotCard.tsx#L47-L143) の `editingEnabled` 算出 + tbody 内 `EditableLevelDurationCell` 切替パターン。append button は tbody 外（CardContent 直下）に置く（current ハイライトロジックに干渉させないため）
- **IMPORTS**:
  ```ts
  import { useState } from "react";
  import { Button } from "@/components/ui/button";
  import { AppendLevelDialog } from "./AppendLevelDialog";
  import type { AppendLevelInput } from "@/lib/firebase/repositories/tournaments";
  ```
- **GOTCHA 1**: 旧 caller（`live-client.tsx`）は `canAppend` / `onAppendLevel` を渡さないため append button 非描画 → regression 0。E2E で確認
- **GOTCHA 2**: append button の visibility 判定は `canAppend === true && onAppendLevel !== undefined`。`canAppend` が undefined の場合（live など）は false 扱い
- **GOTCHA 3**: `canAppendLevel(t)` 純関数の呼出は呼出側（dashboard-client）に集約する。card 側は `canAppend` boolean を受け取るだけにすることで、card コンポーネント自体は state 判定ロジックを持たない（pure な view）
- **GOTCHA 4**: append button の aria-label を `レベル追加` で固定（`+` 記号は SR 利用者には伝わらないため）
- **VALIDATE**: 既存の `StructureSnapshotCard.test.tsx` の test が prop 未指定で green（regression 0 を確認）、新規 test が green

---

### Task 9: `StructureSnapshotCard.test.tsx` への追加 test

- **ACTION**: [src/components/tournament/StructureSnapshotCard.test.tsx](../../../src/components/tournament/StructureSnapshotCard.test.tsx) の Phase 5.2 describe の隣に append 用 describe を追加
- **IMPLEMENT**: 5 テストケース
  1. canAppend=true / onAppendLevel 指定 / state="running" → append button「レベル追加」が描画
  2. canAppend=undefined → append button 非描画（live 経路の regression 0 lock）
  3. canAppend=false → append button 非描画（一般メンバー）
  4. canAppend=true で onAppendLevel undefined → append button 非描画（callback 必須の lock）
  5. append button click → AppendLevelDialog が open（Title「レベル N を末尾に追加」が表示される）
  6. append 成功 → dialog close、`onAppendLevel` に正しい input が渡される（spy 検証）
- **MIRROR**: [src/components/tournament/StructureSnapshotCard.test.tsx:108-239](../../../src/components/tournament/StructureSnapshotCard.test.tsx#L108-L239) の Phase 5.2 編集 test と同じ describe + makeTournament 関数を流用
- **IMPORTS**: 既存
- **GOTCHA**: dialog open 検証は `screen.getByRole("dialog")` ではなく title text `getByText(/レベル \d+ を末尾に追加/)` で拾う（shadcn Dialog の role=dialog は背景含むため）
- **VALIDATE**: `npm run test -- StructureSnapshotCard` が green

---

### Task 10: `dashboard-client.tsx` への配線

- **ACTION**: [src/app/tournaments/\[tid\]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) の `<StructureSnapshotCard>` 呼出に props を additive 追加
- **IMPLEMENT**:
  ```tsx
  // SOURCE: src/app/tournaments/[tid]/dashboard-client.tsx:540-550 の既存 prop に追加
  <StructureSnapshotCard
    snapshot={data.structureSnapshot}
    currentLevel={data.currentLevel}
    showDescription
    tournament={data}
    canEdit={isOrganizer}
    onUpdateDurationSec={async (levelIndex, durationSec) => {
      await setLevelDurationSec(tid, user.uid, groupIds, levelIndex, durationSec);
    }}
    onEditError={setError}
    canAppend={isOrganizer && canAppendLevel(data)}
    onAppendLevel={async (input) => {
      await appendLevel(tid, user.uid, groupIds, input);
    }}
  />
  ```
- **MIRROR**: 同 file [L540-550](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L540-L550) の `setLevelDurationSec` 呼出パターン（Phase 5.2 の inline arrow callback）
- **IMPORTS**:
  ```ts
  // 既存の import に追加
  import {
    appendLevel,
    deleteTournament,
    setLevelDurationSec,
  } from "@/lib/firebase/repositories/tournaments";
  // 既存の import に追加
  import {
    canAppendLevel,
    canDelete as canDeleteTournament,
    canEdit as canEditTournament,
    isInProgress,
    showSeatingBoard as showSeatingBoardForState,
  } from "@/lib/services/tournament-state";
  ```
- **GOTCHA 1**: `canAppend={isOrganizer && canAppendLevel(data)}` は member redirect 経路の前で評価されるため、`isOrganizer` の guard で member は到達しない（組み合わせ条件は fail-fast safe）
- **GOTCHA 2**: `setError` は append callback が AppError throw した場合 dialog 内で表示するため、ここでは渡さない（dialog の自前 error state で完結する）
- **GOTCHA 3**: live-client.tsx は触らない（read-only のため）。`canAppend` 未指定 = append 不可で従来挙動
- **VALIDATE**: ブラウザで dashboard を開き、organizer は append button 表示、member redirect で live は append button 非描画

---

### Task 11: E2E spec の追加

- **ACTION**: [tests/e2e/append-blind-level.spec.ts](../../../tests/e2e/append-blind-level.spec.ts) を新規作成
- **IMPLEMENT**: 3 テストケース
  1. **setup 状態の organizer が append → Firestore に新 Lv 反映**:
     - `seedOrganizerTournament` で setup 状態のトーナメント作成（default 2 levels）
     - dashboard 開く → 「レベル追加」 button click → Dialog 開く → 「追加」 click（defaults のまま）
     - Firestore で `tournaments/{tid}.structureSnapshot.levels.length === 3` と新 Lv 3 の sb/bb/durationSec が default 派生値（last.sb*2 / last.bb*2 / last.durationSec）であることを検証
     - 新 Lv 3 行が UI に描画され、Phase 5.2 の `Lv 3 の時間を変更` Pencil ボタンも表示される（同時 inline edit 可の lock）
  2. **running 状態で append**:
     - seedOrganizerTournament + 自己参加 + ゲスト参加（active=2）→ startTournament → state="running"
     - 「レベル追加」 button → Dialog → 「ブレイクとして追加」チェック → 「追加」
     - Firestore で末尾に `isBreak: true / sb=0 / bb=0 / ante=0` の Lv が追加されることを検証
  3. **/live ページでは append button が描画されない（regression 0）**:
     - seedOrganizerTournament で organizer のまま `/live` に直接アクセス（live-client は canAppend 未指定）
     - `getByRole("button", { name: "レベル追加" })` の count = 0
- **MIRROR**: [tests/e2e/dynamic-blind-adjustment.spec.ts](../../../tests/e2e/dynamic-blind-adjustment.spec.ts) の `seedOrganizerTournament` / `joinAsGuest` / `tournamentDashboardPage` / `livePage` / `getDocument` REST helper / `readLevelDurationSec` 同方針 helper パターン
- **IMPORTS**: 同 file 内の既存 import を mirror
- **GOTCHA 1**: REST レスポンスから `structureSnapshot.levels` の長さと末尾要素の各フィールドを取り出す helper を新設（`readLevelArray(doc): Array<{...}> | null`）
- **GOTCHA 2**: `expect.poll` で Firestore 反映を await（Phase 5.2 の spec と同 timeout=10_000）
- **GOTCHA 3**: append → Lv 3 が UI に出現したタイミングで Phase 5.2 の Pencil button も出現する（同 cell に EditableLevelDurationCell が組み込まれているため）。これを assert することで Phase 5.2 と 5.3 の組合せが破壊されていないことを lock する
- **VALIDATE**:
  ```bash
  npx playwright test tests/e2e/append-blind-level.spec.ts
  ```
  emulator 起動 + dev server 起動の前提（既存 e2e と同じ）

---

### Task 12: ローカル動作確認（運営者ドライラン）

- **ACTION**: dev server 起動 + ブラウザで dashboard を開いて手動確認
- **IMPLEMENT**:
  ```bash
  npm run dev
  ```
  確認項目:
  1. **owner / organizer**: dashboard で `StructureSnapshotCard` の表末尾に「+ レベル追加」 button が出ること（state ≠ finished）
  2. **member**: dashboard 自体に access 不可（既存 redirect）
  3. **`/live` 視聴者**: append button 出ない、表示は Phase 5.2 完了時点と完全一致
  4. **finished tournament**: dashboard で append button 非描画（`canAppend === false`）
  5. **append happy path（setup）**: defaults のまま「追加」 → 末尾に新 Lv が追加され、Phase 5.2 Pencil で edit 可
  6. **append happy path（running・最終 Lv 張り付き状態）**: 最終 Lv で 00:00 張り付き → append → 次 tick で auto-advance が発火、新 Lv にカウント開始
  7. **append happy path（running・break）**: 「ブレイクとして追加」チェック → SB/BB/Ante=0 + disabled → 「追加」 → 表に BREAK 行が追加
  8. **append validation**: durationMin=0 / -1 → 入力 invalid（HTML min 違反 で submit 不可）、bb=0 で !isBreak → submit 後 `validation/level-input-invalid` が dialog 内に表示
  9. **append max-limit**: levels=49 まで作って append → OK、50 まで作って append → button 自体が非描画（`canAppendLevel === false`）
  10. **同時 append レース**: 別端末（タブ）で同時に append → 両方反映される（runTransaction が逐次化）
- **VALIDATE**: 上記 10 件すべて手動 OK（auto モードのため省略可、その場合 typecheck / lint / test / build / e2e で代替）

---

## Testing Strategy

### Unit Tests

| Test                                                                                                                | Input                                                                            | Expected Output                                                                                | Edge Case? |
| ------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ---------- |
| `canAppendLevel(setup, 3)`                                                                                          | state="setup", levels.length=3                                                  | true                                                                                           | -          |
| `canAppendLevel(seating, 3)`                                                                                        | state="seating"                                                                  | true                                                                                           | -          |
| `canAppendLevel(running, 3)`                                                                                        | state="running"                                                                  | true                                                                                           | -          |
| `canAppendLevel(paused, 3)`                                                                                         | state="paused"                                                                   | true                                                                                           | -          |
| `canAppendLevel(finished, 3)`                                                                                       | state="finished"                                                                 | false                                                                                          | ✓          |
| `canAppendLevel(running, MAX_LEVELS_PER_TOURNAMENT)`                                                                | levels at limit                                                                  | false                                                                                          | ✓          |
| `canAppendLevel(running, MAX_LEVELS_PER_TOURNAMENT - 1)`                                                            | levels just below limit                                                         | true                                                                                           | ✓          |
| `appendLevel` happy path（running）                                                                                 | tid / uid / [gid] / { sb=200, bb=400, ante=25, durationSec=900, isBreak=false } | tx.update に `{ "structureSnapshot.levels": [...old, 新 Lv 6], updatedAt }`                    | -          |
| `appendLevel` other levels preserved                                                                                | 上記                                                                            | levels[0..4] が完全保持                                                                        | -          |
| `appendLevel` does not touch currentLevel / levelStartedAt / pausedAt / lastLevelChangeKind                         | -                                                                                | tx.update.patch にこれらが含まれない                                                           | -          |
| `appendLevel` permission denied                                                                                     | userGroupIds が対象 groupId を含まない                                          | `firestore/permission-denied`                                                                  | ✓          |
| `appendLevel` not found in tx                                                                                       | snap.exists()=false                                                              | `firestore/not-found`                                                                          | -          |
| `appendLevel` finished                                                                                              | state="finished"                                                                 | `tournament/append-not-allowed`                                                                | ✓          |
| `appendLevel` levels-limit-exceeded                                                                                 | oldLevels.length=MAX_LEVELS_PER_TOURNAMENT                                      | `tournament/levels-limit-exceeded`                                                              | ✓          |
| `appendLevel` invalid input（sb=-1 / bb=0 で !isBreak / durationSec=0 / durationSec=Number.NaN / durationSec>MAX）  | -                                                                                | `validation/level-input-invalid`（早期 throw）                                                 | ✓          |
| `appendLevel` break level OK with bb=0                                                                              | { sb=0, bb=0, ante=0, durationSec=600, isBreak=true }                            | tx.update に push される                                                                       | -          |
| `appendLevel` setup でも append 可                                                                                  | state="setup" / currentLevel=0                                                  | tx.update に push される                                                                       | -          |
| `appendLevel` wraps runTransaction errors                                                                           | runTransaction reject                                                            | `firestore/write_failed` で wrap                                                                | -          |
| `AppendLevelDialog` open=false                                                                                      | -                                                                                | content 非描画                                                                                 | -          |
| `AppendLevelDialog` open=true で title 表示                                                                         | existingLevels.length=12                                                         | 「レベル 13 を末尾に追加」が表示                                                               | -          |
| `AppendLevelDialog` defaults from last play level                                                                   | last sb=100/bb=200/ante=25/durationSec=600                                       | input value: sb=200, bb=400, ante=25, durationMin=10                                           | -          |
| `AppendLevelDialog` defaults — all break / empty                                                                    | -                                                                                | sb=25 / bb=50 / ante=0 / dur=10                                                                 | ✓          |
| `AppendLevelDialog` ブレイク チェック                                                                               | isBreak=true 切替                                                                | sb/bb/ante=0、input disabled                                                                    | -          |
| `AppendLevelDialog` submit                                                                                          | defaults のまま「追加」                                                          | onAppend(`{ sb, bb, ante, durationSec: durationMin*60, isBreak }`) 呼出                        | -          |
| `AppendLevelDialog` AppError 表示                                                                                   | onAppend reject (AppError)                                                       | dialog 内 role="alert" に `<code>: <message>` 表示、open 維持                                   | ✓          |
| `AppendLevelDialog` キャンセル                                                                                      | キャンセルボタン                                                                 | onOpenChange(false)、onAppend 未呼出                                                            | -          |
| `AppendLevelDialog` open=true → false → true で defaults 再 hydrate                                                 | -                                                                                | input value がリセットされる                                                                   | ✓          |
| `StructureSnapshotCard` append button visibility                                                                    | canAppend=true / canAppend=false / canAppend=undefined / onAppendLevel=undefined | true のときのみ button 描画                                                                    | -          |
| `StructureSnapshotCard` append button click → Dialog open                                                           | -                                                                                | Dialog title「レベル N を末尾に追加」が表示                                                    | -          |

### Edge Cases Checklist

- [ ] `appendLevel` で配列 length が 1 のとき（最小レベル数）も append 可能
- [ ] `appendLevel` を異なるトーナメントに対して並行に runTransaction → 両方成功
- [ ] `appendLevel` を同一トーナメントに対して並行に runTransaction → 逐次化、両方反映（先勝ちにはならない）
- [ ] dashboard 編集中に別端末が finishTournament → submit 試行で `tournament/append-not-allowed` がエラー表示
- [ ] dashboard 編集中に別端末が append（先行）→ 自端末の append も成功（race-safe、先行分も保持）
- [ ] `currentLevel === levels.length`（最終 Lv 張り付き）状態で append → 次 tick で auto-advance 発火（手動操作不要）
- [ ] break レベルとして append → tbody に BREAK 行（colspan=3）が描画
- [ ] append 後の新 Lv にも Phase 5.2 の `Pencil` ボタンが描画される（`canEditLevelDurations` の `levelIndex >= currentLevel - 1` を満たす）
- [ ] 全 break 構造に新規 play レベルを append → `!isBreak && bb > 0` refine を通過
- [ ] state="setup" で append → `state === "setup"` の append 経路の lock（既存の `/tournaments/[tid]/edit` と機能重複だが両立）

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
npm run test -- tournaments       # repositories/tournaments.test.ts
npm run test -- AppendLevelDialog
npm run test -- StructureSnapshotCard
```

EXPECT: 既存テストと新規テストすべて pass、coverage 維持

### Full Test Suite

```bash
npm run test
```

EXPECT: 全 unit test green、regression なし（Phase 5.2 の `setLevelDurationSec` 系も green 維持）

### Build

```bash
npm run build
```

EXPECT: build 成功

### Firestore Rules（変更なし確認）

```bash
npm run test:rules-limits
```

EXPECT: drift 検出 0（`MAX_LEVELS_PER_TOURNAMENT` は rules 側に転記しないため EXPECTED に追加しない）

### E2E

```bash
# emulator 起動済み + dev server 起動済みの前提
npx playwright test tests/e2e/append-blind-level.spec.ts
npx playwright test tests/e2e/dynamic-blind-adjustment.spec.ts  # regression
```

EXPECT: 新規 spec 3 件 + 既存 5.2 spec すべて green

### Manual Browser Validation（dev server）

```bash
npm run dev
```

確認項目（[Task 12](#task-12-ローカル動作確認運営者ドライラン) 詳細参照）:

- [ ] owner / organizer で append button 表示
- [ ] member（直接 `/tournaments/[tid]` 打ち）→ live にリダイレクト
- [ ] `/live` 視聴で append button 出ない（regression 0）
- [ ] finished tournament で append button 非描画
- [ ] append happy path（setup / running・最終 Lv 張り付き / running・break）
- [ ] validation エラー（durationMin=0 / bb=0 で !isBreak）
- [ ] max-limit（levels=50 で button 非描画）
- [ ] 同時 append が両方反映

---

## Acceptance Criteria

- [ ] `canAppendLevel` 純関数が pass し characterization test がすべて green（state x levels.length 組合せ網羅）
- [ ] `appendLevel` repository が runTransaction で実装され、permission / range / state / break / max-limit のエラーパスが test green
- [ ] `AppendLevelDialog` が direct-edit ↔ break toggle ↔ AppError 表示の全フローを単体テストで覆う
- [ ] `StructureSnapshotCard` の既存 caller（live-client）が**変更なしで read-only 維持**（regression 0 を E2E で確認）
- [ ] dashboard で organizer ロールが新規レベルを append でき、Firestore に反映される
- [ ] 最終 Lv 張り付き状態で append すると次 tick で auto-advance が発火する（手動ブラウザまたは E2E で確認）
- [ ] typecheck / lint / test / build / `test:rules-limits` 全 green
- [ ] E2E append-blind-level.spec.ts の 3 テストすべて green、Phase 5.2 dynamic-blind-adjustment.spec.ts も regression なし

## Completion Checklist

- [ ] Code follows discovered patterns（Phase 5.2 の `setLevelDurationSec` array-rewrite + `runTransaction` を末尾 push に変奏）
- [ ] Error handling: `AppError` ラップ、`validation/level-input-invalid` / `tournament/append-not-allowed` / `tournament/levels-limit-exceeded` ドメインコード追加
- [ ] Logging: `logger.info("level appended", { tid, uid, isBreak, durationSec })`
- [ ] Tests: characterization（純関数）+ repository unit + component unit + E2E
- [ ] No hardcoded values: `MAX_LEVELS_PER_TOURNAMENT` は `limits.ts` から
- [ ] Documentation: 本 plan を `.claude/PRPs/plans/phase-5.3-append-blind-level.plan.md` に保存、PRD の Implementation Phases で Phase 5.3 を `in-progress` に更新（PRP Plan link を本 plan にセット）
- [ ] No unnecessary scope additions: levelInsert（途中行）/ levelDelete / bulk append / structureSnapshot 全体書換は触らない
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk                                                                                                          | Likelihood | Impact | Mitigation                                                                                                                                                                |
| ------------------------------------------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 最終 Lv 張り付き状態で append した直後に複数端末で auto-advance race                                          | 低         | 低     | `advanceLevel(opts.expectedLevel)` の既存 race guard が `currentLevel == expected` を tx 内で再 read するため 1 端末だけが通る。Phase 5.2 と同じ rationale                  |
| 配列全体上書きパターンの size 上限（Firestore 1 doc ≈ 1MiB）                                                  | 低         | 低     | `MAX_LEVELS_PER_TOURNAMENT=50` で 50 levels × 80B ≈ 4KB の bound を作る。doc 全体でも数 KB に収まり 1MiB 上限から大きく離れる                                              |
| break レベル append 時の zod refine 違反（`!isBreak && bb<=0`）                                              | 低         | 低     | repository の早期 validation で同 condition を deny。UI 側も `toggleBreak` で sb/bb/ante=0 化、break 解除時に bb=Math.max(1, prev) で復元                                  |
| organizer 信頼ロールでの空 append 攻撃（嫌がらせで levels を 50 まで埋める）                                  | 低         | 低     | organizer は元々 CRUD 全権、Phase 4.16/4.17 と同方針で許容範囲。Cloud Functions 化は将来課題                                                                              |
| 同時 append レース（2 organizer が同時に append）                                                             | 低         | 低     | `runTransaction` で楽観ロック。2 件目は最新 levels を read してから push するため、両方 push される（last-writer-wins ではなく append-only safe）                          |
| Dialog defaults の派生で全 break 構造のとき fixed 値（25/50/0/10）が運用にそぐわない                           | 中         | 低     | 運営者は default を上書き可能なため実害は低い。改善要望が出たら quick-fill ロジックを高度化（破壊的変更ではない follow-up）                                                  |
| `MAX_LEVELS_PER_TOURNAMENT=50` が将来狭い／広い                                                               | 低         | 低     | `limits.ts` の単一定数のため変更コスト低。実運用フィードバック後に調整                                                                                                    |
| Phase 5.2 で確立した dot-path partial array overwrite が `structureSnapshot` の他フィールドを潰さないかの再確認 | 低         | 低     | E2E で append 前後の `name` / `initialStack` / `lateEntryDeadlineLevel` を読んで保持されていることを assert（regression lock）                                              |
| `appendLevel` が repository で `getTournament` + `assertCanManage` を経由せず tx 内で全 check                 | 低         | 低     | Phase 5.2 / 4.16 と同設計（tx 内で permission + state guard）。一貫性あり                                                                                                  |

## Notes

- 本 plan は `.claude/rules/firebase-patterns.md` の「単一フィールド単独書換の rule 経路」原則からは**逸脱**する（`structureSnapshot.levels` という map 配下の単独書換のため `affectedKeys().hasOnly([...])` の制約を rule で強制しない）。理由は Phase 5.2 と同じ:`tournaments/{tid}` は既に `isOrganizer(groupId)` で gate 済みかつ `groups/{gid}` のような massively-shared trust boundary ではない。
- 「最終 Lv 張り付き状態で append すると次 tick で auto-advance が自然発火する」という挙動は、`shouldAutoAdvance` の判定式 `tournament.currentLevel < tournament.structureSnapshot.levels.length` が状態を持たない pure 述語であるおかげで自動的に成り立つ。**この性質は既存 `timer.test.ts` に既に lock されている**（Phase 5.2 で追加した duration 短縮 → 0 クランプ → auto-advance のテストが levels.length 変化にも該当する）。
- 将来 Cloud Functions 化（`tournaments/{tid}` の write を Callable に集約）を選んだ際は、`appendLevel` を 1 callable として移植可能。schema 影響なし。
- 提案 [tmp/14_運営者向け追加機能提案.md](../../../tmp/14_運営者向け追加機能提案.md) の流れで、Phase 5.2 完了レビュー（2026-05-06）で判明した「最終レベル張り付き対応の欠落」を埋める phase。Phase 5.2 の `setLevelDurationSec` だけでは duration 変更しかできず、`levels.length` を伸ばす経路は皆無だった。Phase 5.3 でこのギャップを埋めると、運営者は (a) `setLevelDurationSec` で個別レベルの時間調整 + (b) `appendLevel` で末尾レベル追加、の組合せで進行中の TDA 対応 fully covered になる。
- 当初検討した「直前レベルから auto-doubling 量子化（BB を 1.5x → ラウンド）」は MVP では採用せず、シンプルな `*2` 派生に留める（既存 `LevelTable.addRow` と同方針）。運営者はキー数値を default の上に手で打ち直すユースケースが多く、量子化 quick-fill の価値は限界的。

---

## Plan Created

- **File**: .claude/PRPs/plans/phase-5.3-append-blind-level.plan.md
- **Source PRD**: .claude/PRPs/prds/allin-timer.prd.md
- **Phase**: Phase 5.3（Append Blind Level）
- **Complexity**: Medium
- **Scope**: 11 files (10 src + 1 plan)、12 tasks
- **Key Patterns**: Phase 5.2 array-rewrite + `runTransaction` / shadcn `Dialog` + form / `useInlineNumberEdit` 隣接配置
- **External Research**: none needed — feature uses established internal patterns
- **Risks**: 配列上書きパターンの doc-size 衝突（mitigated by MAX_LEVELS_PER_TOURNAMENT=50）
- **Confidence Score**: 9/10 — 単一 schema 変更なし + Phase 5.2 で確立済みパターンの忠実な拡張で、新規ロジックは Dialog UI のみ
