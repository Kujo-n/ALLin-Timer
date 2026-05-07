# Plan: Phase 4.16 — Tournament Default Name (Finished Counter) + Group 詳細での確認・修正

## Summary

`/tournaments/new` でトーナメント名フィールドが空のまま提示されている UX を改善し、`[サークル名]トーナメント-X` のフォーマットでデフォルト値を流し込む。`X` はサークル単位で「**終了したトーナメントの数 + 1**」とし、その数値を `groups/{gid}.finishedTournamentCount`（schema additive）として永続化する。`finishTournament()` で **`writeBatch` を使い tournaments doc 更新と group counter increment を atomic に** 書く。プレ実装期の既存トーナメント数は計上しない（zod default 0 で legacy doc を補完）。

加えて、サークル詳細画面（`/groups/[gid]`）に **開催数（finishedTournamentCount）の確認・修正 UI** を追加する。**全メンバーが現在値を確認**でき、**owner / organizer は手動修正**できる（運用ミスや実装前の既存データで番号がズレた場合の補正手段）。Firestore Rules は organizer 配下が `finishedTournamentCount` を任意の非負整数値で書き換えできる branch を 1 件追加し、自動 `+1` と手動修正の両方を同一 branch でカバーする。

## User Story

As a サークル運営者（owner / organizer）,
I want トーナメント新規作成画面でトーナメント名がサークル名 + 連番でプリセットされる,
So that 命名規則の手入力を省きつつ、何回目に終了予定のトーナメントなのかを一目で判別できる。

And as a サークル運営者（owner / organizer）,
I want サークル詳細画面で現在の開催数を確認でき、必要なら手動で値を補正できる,
So that 実装前から運用していたサークルの実績数に counter を合わせ込んだり、誤操作による counter ズレを `/tournaments/new` のデフォルト名に反映させずに修復できる。

And as a サークル一般メンバー,
I want サークル詳細画面で現在の開催数を確認できる,
So that サークルの活動度合いを把握できる（編集権限は不要）。

## Problem → Solution

**Current state**:

- [src/app/tournaments/new/tournament-new-client.tsx:35-46](../../../src/app/tournaments/new/tournament-new-client.tsx#L35-L46) は `<TournamentForm>` を `initialName` 未指定で render しており、[src/components/tournament/TournamentForm.tsx:50](../../../src/components/tournament/TournamentForm.tsx#L50) の default `""` がそのまま表示される。
- 運営者は毎回手で「Saturday 月例 #3」のような名前を入れる手間があり、特に同じサークルで何回目かを把握しづらい。
- `groups/{gid}` には開催数を表す数値フィールドがなく、サークル詳細画面でも実績を一望できない。実装前にサークル外で運用していた回数を反映する手段もない。

**Desired state**:

- 画面表示時、`name` 入力欄に `[<group.name>]トーナメント-<finishedCount + 1>` がプリセットされる。
- `finishTournament()` 完了で group の `finishedTournamentCount` が +1 される。次回作成時の連番が自動で繰り上がる。
- 運営者がそのまま「作成」を押せば人間可読な名前で保存され、必要なら自由に上書きできる（既存の入力可能な挙動を維持）。
- サークル詳細画面（`/groups/[gid]`）の「メンバー」カードと並列に「**開催数**」カードがあり、現在値の表示と、owner / organizer 限定の inline edit（数字入力 + 保存 / キャンセル）が提供される。一般メンバーには表示のみで編集 affordance は出さない。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 4.16（Phase 4.15 後の小規模 polish。Phase 5 ブロッカー外）
- **Stage scope**: schema additive + repository batch 化 + rules 1 branch 追加 + 新規作成画面 UI + サークル詳細画面 UI（確認 / 修正）
- **Estimated Files**: 約 12 files（schema 1 / repository 2 / service 1 / rules 1 / 新規作成 client 1 / 詳細 client 1 / tests 3 / docs 2、PRD は別途）

---

## UX Design

### Before

```
/tournaments/new （/tournaments → 「新規作成」ボタン経由）

┌──────────────────────────────────────────────┐
│ トーナメントを新規作成                       │
│                                              │
│ トーナメント名                               │
│ ┌──────────────────────────────────────────┐ │
│ │                                          │ │ ← 空欄。毎回手入力
│ └──────────────────────────────────────────┘ │
│                                              │
│ ストラクチャ  [▼ 選択してください]           │
│ 1 Table あたりの席数  [9]                   │
│                                              │
│ [作成]  [キャンセル]                         │
└──────────────────────────────────────────────┘
```

### After

```
/tournaments/new

┌──────────────────────────────────────────────┐
│ トーナメントを新規作成                       │
│                                              │
│ トーナメント名                               │
│ ┌──────────────────────────────────────────┐ │
│ │ [サタデーサークル]トーナメント-3         │ │ ← グループ名+連番でプリセット
│ └──────────────────────────────────────────┘ │   （「3」= 終了済み2件＋1）
│                                              │
│ ストラクチャ  [▼ Default (12 レベル)]       │
│ 1 Table あたりの席数  [9]                   │
│                                              │
│ [作成]  [キャンセル]                         │
└──────────────────────────────────────────────┘
```

### Group 詳細画面（`/groups/[gid]`）の Before / After

**Before**:

```
/groups/[gid]

┌────────────────────────────────────────────────────┐
│ [サタデーサークル]                                 │
│ メンバー 5 人 / オーナー 1 人 / あなたはオーナー   │
│                                                    │
│ ┌── メンバー ──────────────────────────────────┐   │
│ │ ・Alice  オーナー あなた                     │   │
│ │ ・Bob    運営                                │   │
│ │ ・...                                        │   │
│ └──────────────────────────────────────────────┘   │
│                                                    │
│ ┌── 招待コード ────────────────────────────────┐   │
│ │ ...                                          │   │
│ └──────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────┘
```

**After**（owner / organizer 表示時）:

```
/groups/[gid]

┌────────────────────────────────────────────────────┐
│ [サタデーサークル]                                 │
│ メンバー 5 人 / オーナー 1 人 / あなたはオーナー   │
│                                                    │
│ ┌── 開催数 ────────────────────────────────────┐   │
│ │ 終了したトーナメント: 12 回    [ ✎ 修正 ]    │   │
│ │ ※ 新規作成時のデフォルト名連番に使用        │   │
│ └──────────────────────────────────────────────┘   │
│                                                    │
│ ┌── メンバー ──────────────────────────────────┐   │
│ │ ・Alice  オーナー あなた                     │   │
│ │ ...                                          │   │
│ └──────────────────────────────────────────────┘   │
│                                                    │
│ ┌── 招待コード ────────────────────────────────┐ ...│
└────────────────────────────────────────────────────┘

修正クリック後（inline edit）:

┌── 開催数 ────────────────────────────────────┐
│ 終了したトーナメント:                        │
│   [ 12 ▲▼ ]  [保存]  [キャンセル]            │
│ ※ 0 以上の整数。空 / 負値は弾かれます。     │
└──────────────────────────────────────────────┘
```

**After**（一般メンバー表示時）:

```
┌── 開催数 ────────────────────────────────────┐
│ 終了したトーナメント: 12 回                  │
└──────────────────────────────────────────────┘
```

— 編集ボタンは出さない。ロール非依存で表示自体は出す（メンバーがサークルの活動度合いを把握できる）。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/tournaments/new` 表示時の `name` 欄 | 空文字 `""` | `[<group.name>]トーナメント-<n+1>`（n = 終了済み件数） | プリセットだが上書き自由 |
| `finishTournament()`（運営者の「終了」操作） | tournaments/{tid} のみ更新 | tournaments/{tid} 更新 + groups/{gid}.finishedTournamentCount を `increment(1)`（writeBatch atomic） | 失敗は両方ロールバック |
| `groups/{gid}` の `read` payload | `finishedTournamentCount` 不在 | 数値（legacy doc は zod default 0） | スキーマ互換性維持 |
| 既存トーナメント編集（`/tournaments/[tid]/edit`） | 変更なし | 変更なし | プリセットは新規作成画面のみ |
| `useCurrentGroup()` の `groups` payload | 既存フィールドのみ | + `finishedTournamentCount` | 追加で 1 fetch しないため UX へのコストなし |
| **`/groups/[gid]` 詳細画面** | 開催数の表示なし | 全メンバー: 値表示。owner / organizer: inline edit ボタン表示 | rename 既存パターンを mirror（`Pencil` アイコン + Input + 保存/キャンセル） |
| 開催数 inline edit 確定 | N/A | `setFinishedTournamentCount(gid, value)` を呼び `groups/{gid}` を更新 → `reload()` + `refreshGroups()` | 失敗時はカード内に AppError ラベルを表示 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ追加の三点同期（schema / repo / rules）規約 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | `AppError.from(e, "firestore/...")` ラップと logger 経由出力 |
| P0 | [.claude/rules/group-membership.md](../../rules/group-membership.md) | データモデル / 権限マトリクス | `groups/{gid}` のフィールド追加と organizer 権限 |
| P0 | [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | 22-83 | `audioSettings` を additive に追加した先例。同じ pattern で `finishedTournamentCount` を追加 |
| P0 | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | 351-371, 463-498 | `finishTournament` 既存実装と `writeBatch + cascade delete` の先例 |
| P0 | [firestore.rules](../../../firestore.rules) | 70-185 | `groups/{gid}` の update branches。新 organizer-only counter increment branch を追加する位置 |
| P0 | [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) | all | プリセット適用先。`useCurrentGroup` の `groups` から既ロード値を取り出す |
| P0 | [src/components/tournament/TournamentForm.tsx](../../../src/components/tournament/TournamentForm.tsx) | 21-66, 125-130 | `initialName` prop は既に対応済み（`useState(initialName)`）。フォーム本体は不変で済む |
| P0 | [src/lib/services/current-group.tsx](../../../src/lib/services/current-group.tsx) | 23-49, 150-155 | `groups` 配列の利用パターン。追加 fetch なしで `finishedTournamentCount` を取れる |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | 67-220, 275-355 | サークル名 inline edit のパターン（`Pencil` アイコン + `Input` + `requestAnimationFrame` focus + Esc / 同名キャンセル）。本プランの開催数 inline edit はこれを mirror |
| P0 | [src/lib/services/group.ts](../../../src/lib/services/group.ts) | 261-278 | `renameGroup` の owner-only assert + repository 経由 update パターン。本プランの `setFinishedTournamentCount` を同形で実装 |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | 35-54, 112-140, 207-235 | `groupDocRef(gid)` ヘルパー + `updateGroupName` / `updateAudioSettings` の error wrap pattern。新規 `updateFinishedTournamentCount` を追加する位置 |
| P1 | [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) | 307-496 | `groupBodySchema` 追加フィールドの test pattern（"defaults X for legacy docs without the field" / "rejects invalid X"） |
| P1 | [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) | 1-127, 549-573, 648-744 | SDK モック ＋ `writeBatch` モック先例。`finishTournament` 既存テストの diff 範囲 |
| P1 | [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) | all | groups repository のテストパターン。`updateFinishedTournamentCount` の試験を追加する基盤 |
| P1 | [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) | all | service 層の owner / organizer assert パターン。`setFinishedTournamentCount` の test を追加 |
| P2 | [src/lib/firebase/converters.ts](../../../src/lib/firebase/converters.ts) | all | zodConverter が `default()` を hydrate するため legacy doc は read 時に補完される |
| P2 | [.claude/PRPs/plans/completed/phase-4.9-audio-notifications.plan.md](completed/phase-4.9-audio-notifications.plan.md) | 151-265 | additive スキーマ拡張 + organizer-only update branch を追加した直近の先例。本プランの設計はこれを踏襲 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firestore `FieldValue.increment` | https://firebase.google.com/docs/reference/js/firestore_.fieldvalue#increment | サーバ側で atomic に数値加算する sentinel。`writeBatch.update(ref, { field: increment(1) })` で他フィールドと同一トランザクションに乗せられる |
| Firestore `writeBatch` の atomicity | https://firebase.google.com/docs/firestore/manage-data/transactions#batched-writes | 複数 doc への書込を 1 リクエストで原子的に実行。一部失敗で全体ロールバック |
| Security Rules `request.resource.data.diff(...).affectedKeys()` | https://firebase.google.com/docs/reference/rules/rules.MapDiff#affectedkeys | 差分のキー集合を返す。`hasOnly(['x'])` で「特定フィールドのみ変更可」を rule で強制 |

GOTCHA:

- `increment(1)` は schema 上は `z.number()` を満たすが、`default(0)` 適用前の legacy doc に対しても**正しく 1 を書き込む**（Firestore がサーバ側で 0 + 1 として解決）。schema validation は read 時のみで write 時は Firestore に解決を委ねる。
- `request.resource.data.finishedTournamentCount == resource.data.get('finishedTournamentCount', 0) + 1` という rule 表現で legacy doc（フィールドなし → 0 として扱う）と新 doc 両方をカバーできる。`.get(field, default)` パターンは Phase 4.7 で `memberDisplayNames` に対して既に使われている（`firestore.rules:148`）。
- `writeBatch` は `runTransaction` と異なり**読取できない**。`finishTournament` 内では既に `assertCanManage` で事前 read しているため問題ないが、`if (t.state === "finished") return;` の早期 return ガードを **batch 構築前に** 必ず置くこと（二重 increment 防止）。
- `useCurrentGroup()` の `groups` は `listMyGroups` 経由で fetch される（[src/lib/services/current-group.tsx:95](../../../src/lib/services/current-group.tsx#L95)）。`finishTournament` 完了直後に新規作成画面を開くと、自端末の `groups` payload にはまだ古い counter が反映されている可能性がある。**今回は許容**（運営者が同セッションで「終了」→ 即「新規作成」する頻度が低く、自分で名前を上書き可能なため）。許容しない場合は `refreshGroups()` 呼び出しを `finishTournament` 後の dashboard でトリガーする選択肢があるが、本プランの scope 外。

---

## Patterns to Mirror

### NAMING_CONVENTION（schema additive）

```typescript
// SOURCE: src/lib/firebase/schemas/group.ts:71-73
audioSettings: audioSettingsSchema,
```

`audioSettings` と同列で `finishedTournamentCount` を追加。zod の `default(0)` で legacy doc を補完する。

```typescript
// 追加形（本プラン）
finishedTournamentCount: z.number().int().nonnegative().default(0),
```

### ERROR_HANDLING

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:351-371
export async function finishTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state === "finished") return;
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "finished",
      finishedAt: serverTimestamp(),
      pausedAt: null,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament finish ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "終了処理に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
```

batch 化後も同じ `try / catch / AppError.from / logger.warn` 構造を維持。code は `firestore/write_failed`、メッセージは「終了処理に失敗しました」を継続使用。

### LOGGING_PATTERN

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:365
logger.info("tournament finish ok", { tid, uid });
```

`logger.info("tournament finish ok", { tid, uid, gid: t.groupId })` に拡張（counter increment 対象 gid を可観測化）。

### REPOSITORY_PATTERN（writeBatch + increment + cascade delete の先例）

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:478-485
const batch = writeBatch(firestore);
const playersSnap = await getDocs(collection(firestore, "tournaments", tid, "players"));
playersSnap.forEach((d) => batch.delete(d.ref));
const tablesSnap = await getDocs(collection(firestore, "tournaments", tid, "tables"));
tablesSnap.forEach((d) => batch.delete(d.ref));
batch.delete(doc(tournamentsRef, tid));
await batch.commit();
```

本プランの `finishTournament` は read 不要（`assertCanManage` 済み）なので shape は次のとおり:

```typescript
const batch = writeBatch(firestore);
batch.update(doc(tournamentsRef, tid), {
  state: "finished",
  finishedAt: serverTimestamp(),
  pausedAt: null,
  updatedAt: serverTimestamp(),
});
batch.update(doc(firestore, "groups", t.groupId), {
  finishedTournamentCount: increment(1),
});
await batch.commit();
```

### FIRESTORE_RULE_PATTERN（既存 owner update branch + 追加 organizer counter branch）

```firestore-rules
// SOURCE: firestore.rules:172-181（Phase 4.9 で追加された audioSettings branch）
) || (
  // Phase 4.9: organizer による audioSettings 単独書換。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['audioSettings'])
  && request.resource.data.audioSettings is map
);
```

audioSettings branch のあとに OR で **counter update 専用 branch** を追加（自動 +1 と手動修正の両方を 1 branch でカバー）:

```firestore-rules
) || (
  // 本プラン: organizer による finishedTournamentCount の任意の非負整数値書換。
  //   2 経路で発火:
  //     (1) finishTournament() の writeBatch で `increment(1)`（旧値+1）
  //     (2) サークル詳細画面 inline edit で任意の非負整数値（手動補正）
  //   どちらも affectedKeys は 'finishedTournamentCount' のみ。
  //   `+1 限定` にせず `>= 0 の int` まで広げているのは (2) の運用補正用途を rule で塞がないため。
  //   organizer は元々サークルの全 CRUD を持つ信頼ロールのため、空値書込のリスクは許容範囲。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['finishedTournamentCount'])
  && request.resource.data.finishedTournamentCount is int
  && request.resource.data.finishedTournamentCount >= 0
)
```

owner branch（`firestore.rules:85-91`）は包括的なので owner なら counter も自由に書ける（既に通る、本プランで変更しない）。

### REACT_HOOK_PATTERN（既ロード状態からの算出）

```typescript
// SOURCE: src/app/tournaments/new/tournament-new-client.tsx:11-27（既存）
const { user } = useAuthUser();
const { currentGroupId, isOrganizer, loading } = useCurrentGroup();
```

`groups` を破壊代入で取り出し、`useMemo` で defaultName を派生:

```typescript
const { user } = useAuthUser();
const { currentGroupId, groups, isOrganizer, loading } = useCurrentGroup();

const defaultName = useMemo(() => {
  if (!currentGroupId) return "";
  const g = groups.find((x) => x.id === currentGroupId);
  if (!g) return "";
  const next = (g.finishedTournamentCount ?? 0) + 1;
  return `[${g.name}]トーナメント-${next}`;
}, [currentGroupId, groups]);
```

### TEST_STRUCTURE（schema additive）

```typescript
// SOURCE: src/lib/firebase/schemas/index.test.ts:434-461
it("supplies default audioSettings for legacy docs without the field", () => {
  const parsed = groupBodySchema.parse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
  });
  expect(parsed.audioSettings).toEqual(DEFAULT_AUDIO_SETTINGS);
});
```

本プランの schema test:

```typescript
it("defaults finishedTournamentCount to 0 for legacy docs without the field", () => {
  const parsed = groupBodySchema.parse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
  });
  expect(parsed.finishedTournamentCount).toBe(0);
});

it("preserves explicit finishedTournamentCount", () => {
  const parsed = groupBodySchema.parse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
    finishedTournamentCount: 7,
  });
  expect(parsed.finishedTournamentCount).toBe(7);
});

it("rejects negative finishedTournamentCount", () => {
  const result = groupBodySchema.safeParse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
    finishedTournamentCount: -1,
  });
  expect(result.success).toBe(false);
});
```

### REPOSITORY_TEST_MOCK_PATTERN（writeBatch）

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:649-665
type FakeBatch = {
  delete: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  commit: ReturnType<typeof vi.fn>;
};

function mockBatch(commitImpl?: () => Promise<void>): FakeBatch {
  const batch: FakeBatch = {
    delete: vi.fn(),
    set: vi.fn(),
    update: vi.fn(),
    commit: vi.fn(commitImpl ?? (async () => undefined)),
  };
  vi.mocked(writeBatch).mockReturnValueOnce(batch as never);
  return batch;
}
```

`finishTournament` テストでは:

- `mockGetTournament(makeTournament({ state: "running" }))` で対象を仕込む
- `mockBatch()` で batch を仕込む
- 関数を呼んで `batch.update` が **2 回**（tournaments + groups）呼ばれていること
- 1 回目の引数 payload に `state: "finished"` 等が入っていること
- 2 回目の引数 payload に `{ finishedTournamentCount: <increment sentinel> }` が入っていること
- `batch.commit` が 1 回呼ばれること

を assert する。`increment` のモックは `firebase/firestore` の partial mock リストに `increment: vi.fn((n) => ({ __op: "increment", n }))` を追加して sentinel object として比較する（`serverTimestamp` の既存先例 `tournaments.test.ts:31` と同型）。

### FIELDVALUE_INCREMENT_MOCK（新規パターン）

`firebase/firestore` mock 定義に `increment` を追加（既存の `serverTimestamp` と同型）:

```typescript
// 既存: tournaments.test.ts:31
serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
// 追加:
increment: vi.fn((n: number) => ({ __op: "increment", n })),
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | UPDATE | `groupBodySchema` に `finishedTournamentCount` フィールド追加（`z.number().int().nonnegative().default(0)`） |
| [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | UPDATE | `finishTournament` を `writeBatch` 化し group counter を `increment(1)` |
| [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | UPDATE | `updateFinishedTournamentCount(gid, value)` を新設（手動修正経路）。`updateAudioSettings` の error wrap pattern と同形 |
| [src/lib/services/group.ts](../../../src/lib/services/group.ts) | UPDATE | `setFinishedTournamentCount({ gid, uid, value })` を新設。`assertOrganizer` で actor が organizer 以上か検証してから repository を呼ぶ |
| [firestore.rules](../../../firestore.rules) | UPDATE | `groups/{gid}` update に organizer-only counter update branch を 1 件 OR 追加（任意の非負整数値を許可。自動 +1 と手動修正を同 branch でカバー） |
| [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) | UPDATE | `useCurrentGroup().groups` から default name を派生し `<TournamentForm initialName=...>` に渡す |
| [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | UPDATE | 「開催数」カードを追加。全メンバーに値表示、owner / organizer に inline edit（`renameGroup` の inline-edit パターンを mirror） |
| [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) | UPDATE | `finishedTournamentCount` の legacy default / explicit / negative 拒否の 3 ケース追加 |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) | UPDATE | `firebase/firestore` mock に `increment` 追加。`finishTournament` の writeBatch 化（tournaments + groups の 2 update + commit）を assert |
| [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) | UPDATE | `updateFinishedTournamentCount` の happy path と permission エラー wrap を追加 |
| [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) | UPDATE | `setFinishedTournamentCount` の owner / organizer / member 各ケース + バリデーション（負値・非整数）を追加 |
| [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | UPDATE | `groups/{gid}.finishedTournamentCount` は `finishTournament()` の writeBatch（自動 +1）と `setFinishedTournamentCount()`（手動修正）の 2 経路でのみ更新する旨を追記 |
| [.claude/rules/group-membership.md](../../rules/group-membership.md) | UPDATE | データモデル節の `groups/{gid}` フィールド一覧に `finishedTournamentCount` を追加。権限マトリクスに「開催数の参照（全ロール）/ 修正（owner / organizer のみ）」を追加 |
| [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) | UPDATE | Phase 4.16 として進捗表に 1 行追加（`pending` → 実装後に `complete`）。Phase 5 ブロッカーには含めない |

## NOT Building

- **既存 group の backfill（自動）**：実装前のトーナメント数を自動集計はしない。代わりに **サークル詳細の手動修正 UI**（owner / organizer 限定）で運営者自身が値を合わせ込めるようにする
- **連番のゼロ埋め**（例: `-001`）：仕様としてフォーマット固定なので素の整数を使う
- **削除済み終了トーナメントの counter 巻き戻し**：自動では減らさない。誤った増分は手動修正 UI で運営者自身が補正する
- **`/tournaments/[tid]/edit` のデフォルト値変更**：編集画面は `initialName=tournament.name` を既存どおり使う（プリセットは新規作成画面のみ）
- **複数同時 in-flight トーナメントでの命名衝突回避**：`A` と `B` を立て続けに作るとどちらも同じ default 番号になる。本プランは「上書き可能なプリセット」で運用上の許容範囲。完全な一意性が必要になれば Cloud Functions 化（Phase 5+）
- **`groupJoinCodes` のような Cloud Functions 化**：本プランは organizer 信頼モデルで rule のみ。手動修正での arbitrary set リスクは [.claude/rules/group-membership.md](../../rules/group-membership.md) の既知リスク扱い（影響はトーナメント名連番のみで軽微）
- **修正履歴（audit log）**：誰がいつ何に変更したかは保持しない。必要になれば別 collection（`groupAuditLog/{...}`）として後付けで追加する
- **既存トーナメント名のフォーマット変換**：過去に作られた任意フォーマット名はそのまま保持する
- **モバイルでの数値スピナー**：HTML5 `<input type="number">` の標準挙動に任せる（独自スピナー / ステッパーは作らない）
- **i18n / 多言語化**：CLAUDE.md の言語規約に従い日本語固定で実装（"トーナメント" 部分の英語切替は対象外）

---

## Step-by-Step Tasks

### Task 1: schema 拡張 — `finishedTournamentCount` を additive 追加

- **ACTION**: [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) の `groupBodySchema` に新フィールドを追加。
- **IMPLEMENT**:
  ```typescript
  // 既存の audioSettings の隣に追加
  // 本プラン: 終了済みトーナメント数。finishTournament() で increment(1) される。
  //   旧 doc（本フィールド未定義）は default(0) で受容される。次の終了で 1 になる。
  finishedTournamentCount: z.number().int().nonnegative().default(0),
  ```
- **MIRROR**: NAMING_CONVENTION セクション（`audioSettings: audioSettingsSchema` と同列で additive に追加）
- **IMPORTS**: 既存の `import { z } from "zod";` で十分。新規 import なし。
- **GOTCHA**:
  - `.refine(...)` チェーンが既に 2 段ある。`finishedTournamentCount` は invariants と無関係なので refine の追加は不要。
  - `.default(0)` を付けることで `groupBodySchema.parse(legacyDoc)` が通る（converters.ts が `fromFirestore` で zod parse する経路）。
- **VALIDATE**:
  - Task 5 の schema test 3 ケースが通る
  - `pnpm typecheck` で `GroupBody` / `GroupDoc` 型が `finishedTournamentCount: number` を持つこと

### Task 2: `finishTournament` を writeBatch 化

- **ACTION**: [src/lib/firebase/repositories/tournaments.ts:351-371](../../../src/lib/firebase/repositories/tournaments.ts#L351-L371) の `finishTournament` 関数を書き換える。
- **IMPLEMENT**:
  ```typescript
  // 既存 import に追加
  import { increment, writeBatch } from "firebase/firestore";

  export async function finishTournament(
    tid: string,
    uid: string,
    userGroupIds: string[],
  ): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (t.state === "finished") return; // 二重 increment 防止（既存ガードを保持）
    try {
      const batch = writeBatch(firestore);
      batch.update(doc(tournamentsRef, tid), {
        state: "finished",
        finishedAt: serverTimestamp(),
        pausedAt: null,
        updatedAt: serverTimestamp(),
      });
      batch.update(doc(firestore, "groups", t.groupId), {
        finishedTournamentCount: increment(1),
      });
      await batch.commit();
      logger.info("tournament finish ok", { tid, uid, gid: t.groupId });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "終了処理に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN（`deleteTournament` の writeBatch 先例）+ ERROR_HANDLING
- **IMPORTS**: `increment` と `writeBatch` を `firebase/firestore` から追加。`writeBatch` は既存 `deleteTournament` で import 済みなので 2 度書かないこと。
- **GOTCHA**:
  - 早期 return `if (t.state === "finished") return;` は **batch 構築前** に必ず置く（既存どおり）。
  - `doc(firestore, "groups", t.groupId)` は repository 既存パターンと一致（[src/lib/firebase/repositories/groups.ts:31-33](../../../src/lib/firebase/repositories/groups.ts#L31-L33) の `groupDocRef` を直接使うか、collection ref をローカルに作る）。本タスクでは `doc(firestore, ...)` の素呼びで OK（zodConverter は不要、increment sentinel しか書かないため）。
  - `assertCanManage` で取得した `t` を再利用するので、再度 `getTournament` は呼ばないこと。
- **VALIDATE**:
  - Task 6 の repository test（writeBatch 2 update + commit）が通る
  - 既存 test ケース「returns silently when already finished」「wraps updateDoc errors」も batch 経路に合わせて更新後に通る

### Task 3: Firestore Rules に counter update branch を追加

- **ACTION**: [firestore.rules:172-181](../../../firestore.rules#L172-L181) の `audioSettings` branch の **直後** に OR で 1 件追加。**`+1 限定` ではなく `>= 0 の int` まで広げる**（自動 +1 と手動修正の両方をカバー）。
- **IMPLEMENT**:
  ```firestore-rules
  ) || (
    // 本プラン: organizer による finishedTournamentCount の任意の非負整数値書換。
    //   2 経路で発火:
    //     (1) finishTournament() の writeBatch で `increment(1)`（旧値+1）
    //     (2) サークル詳細画面 inline edit で任意の非負整数値（手動補正）
    //   どちらも affectedKeys は 'finishedTournamentCount' のみに限定。他フィールドは触らせない。
    //   `+1 限定` にせず `>= 0 の int` まで広げているのは (2) の手動補正用途を rule 側で塞がないため。
    //   organizer は元々サークルの全 CRUD を持つ信頼ロールのため、空値書込のリスクは許容範囲。
    isOrganizer(gid)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['finishedTournamentCount'])
    && request.resource.data.finishedTournamentCount is int
    && request.resource.data.finishedTournamentCount >= 0
  );
  ```
  最終 `;` は今までの最後の branch（audioSettings）に付いていたものを移動して付け替えること。
- **MIRROR**: FIRESTORE_RULE_PATTERN（Phase 4.9 で追加された audioSettings branch）。`affectedKeys().hasOnly([...])` で atomic に変更可能フィールドを限定するパターン。
- **IMPORTS**: なし（rule helper `isOrganizer(gid)` は既に定義済み）
- **GOTCHA**:
  - `affectedKeys().hasOnly([...])` は writeBatch の **当該 doc 単独** の変更キーで評価される（tournaments doc 側の変更とは独立に判定される）。よって writeBatch でも問題なく通る。
  - owner は既存 owner branch（`firestore.rules:85-91`）でフリーパス、本 branch を経由しなくても counter を書ける。重複は問題なし（OR 評価）。
  - **`+1 限定` にしない理由**: 手動修正 UI で organizer が任意の値（例: 12 → 8 への減算）に補正できるようにするため。`+1 限定` だと repository 側で `increment(1)` 経由しか書けず、手動修正 UI が `setFinishedTournamentCount(gid, 8)` を呼べなくなる。
  - rule のデプロイは `firebase deploy --only firestore:rules`。エミュレータで先にテストすること（[.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) 規約）。
- **VALIDATE**:
  - emulator: organizer が `update(groups/g1, { finishedTournamentCount: increment(1) })` を投げたとき allow（自動経路）
  - emulator: organizer が `update(groups/g1, { finishedTournamentCount: 0 })` を投げたとき allow（手動補正・リセット）
  - emulator: organizer が `update(groups/g1, { finishedTournamentCount: 12 })` を投げたとき allow（手動補正・任意値）
  - emulator: 同じ書込を一般 member が投げたとき deny
  - emulator: organizer が `finishedTournamentCount: -1` を投げたとき deny
  - emulator: organizer が `finishedTournamentCount: 5, name: "x"` のように複数フィールド変更を投げたとき deny（`affectedKeys().hasOnly` で reject）
  - emulator: legacy doc（counter 未定義）に対して新値 1 が allow

### Task 4: 新規作成画面でデフォルト名を流し込む

- **ACTION**: [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) で `useCurrentGroup().groups` から default name を派生し、`<TournamentForm>` の `initialName` に渡す。
- **IMPLEMENT**:
  ```typescript
  "use client";

  import { useRouter } from "next/navigation";
  import { useEffect, useMemo } from "react";

  import { TournamentForm } from "@/components/tournament/TournamentForm";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { createTournament } from "@/lib/firebase/repositories/tournaments";
  import { useCurrentGroup } from "@/lib/services/current-group";

  export function TournamentNewClient() {
    const { user } = useAuthUser();
    const router = useRouter();
    const { currentGroupId, groups, isOrganizer, loading } = useCurrentGroup();

    useEffect(() => {
      if (loading) return;
      if (!isOrganizer) {
        router.replace("/tournaments");
      }
    }, [loading, isOrganizer, router]);

    // 本プラン: [サークル名]トーナメント-X デフォルト名（X = 終了済み件数 + 1）。
    //   `useCurrentGroup` が既に `groups` を fetch 済みのため追加 read は不要。
    //   legacy doc（finishedTournamentCount 未定義）は zod default で 0 として hydrate される。
    const defaultName = useMemo(() => {
      if (!currentGroupId) return "";
      const g = groups.find((x) => x.id === currentGroupId);
      if (!g) return "";
      const next = (g.finishedTournamentCount ?? 0) + 1;
      return `[${g.name}]トーナメント-${next}`;
    }, [currentGroupId, groups]);

    if (!user || !currentGroupId) return null;
    if (loading || !isOrganizer) {
      return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
    }

    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl font-bold">トーナメントを新規作成</h1>
        <TournamentForm
          groupId={currentGroupId}
          initialName={defaultName}
          onSubmit={async ({ name, snapshot, seatsPerTable }) => {
            const tid = await createTournament({
              groupId: currentGroupId,
              createdByUid: user.uid,
              name,
              structureSnapshot: snapshot,
              seatsPerTable,
            });
            router.push(`/tournaments/${tid}`);
          }}
          onCancel={() => router.push("/tournaments")}
          submitLabel="作成"
        />
      </main>
    );
  }
  ```
- **MIRROR**: REACT_HOOK_PATTERN（`useCurrentGroup` 既ロード値から useMemo で派生）
- **IMPORTS**: `useMemo` を `react` から追加。
- **GOTCHA**:
  - `TournamentForm` は `useState(initialName)` で初期化するため、**`defaultName` が後から変わっても入力欄には反映されない**（[src/components/tournament/TournamentForm.tsx:57](../../../src/components/tournament/TournamentForm.tsx#L57)）。これは React の意図された挙動で、ユーザーが既に typing し始めた値を上書きすると UX が壊れるため正しい。
  - 結果として「`groups` 未ロード時に空文字でレンダリング → ロード後に `defaultName` が決まっても反映されない」現象がある。これを避けるため `if (!user || !currentGroupId) return null;` を **`groups` がロードされ default name が決定されるまで** 描画させない順序に保つ。`loading` true の間は `読込中…` を返す既存ガードがそのまま機能する。
  - グループ名に `[` `]` が含まれていてもエスケープせず素通しでよい（仕様としてフォーマット固定）。
- **VALIDATE**:
  - 手動: `/tournaments/new` を開き、`name` 欄に `[<グループ名>]トーナメント-1` がプリセットされる（counter 0 のとき）
  - 手動: 1 件終了させてから再度 `/tournaments/new` を開くと `-2` に繰り上がる
  - 手動: その状態のまま入力欄を編集 → onChange は破壊しない
  - typecheck: `groups` が `GroupDoc[]` で `finishedTournamentCount` を持つこと

### Task 5: schema test を 3 ケース追加

- **ACTION**: [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) の `describe("groupBodySchema")` 末尾（`audioSettings` テスト群の後）に追加。
- **IMPLEMENT**:
  ```typescript
  it("defaults finishedTournamentCount to 0 for legacy docs without the field", () => {
    const parsed = groupBodySchema.parse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(parsed.finishedTournamentCount).toBe(0);
  });

  it("preserves explicit finishedTournamentCount", () => {
    const parsed = groupBodySchema.parse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
      finishedTournamentCount: 7,
    });
    expect(parsed.finishedTournamentCount).toBe(7);
  });

  it("rejects negative finishedTournamentCount", () => {
    const result = groupBodySchema.safeParse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
      finishedTournamentCount: -1,
    });
    expect(result.success).toBe(false);
  });
  ```
- **MIRROR**: TEST_STRUCTURE（`memberDisplayNames` / `audioSettings` の追加テストと同形）
- **IMPORTS**: 既存どおり（`groupBodySchema` / `now` は既に import 済み）
- **GOTCHA**: `Phase 4.9: ...` のような phase ラベルは付けず、簡潔に意図がわかる it 名にする（本プランは標準フェーズ外のため）。
- **VALIDATE**: `pnpm test schemas/index.test.ts` で 3 ケース pass

### Task 6: `finishTournament` の repository test を更新

- **ACTION**: [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) の以下を変更:

  1. `firebase/firestore` mock 定義（L12-34）に `increment` を追加
  2. `describe("finishTournament")` ブロック（L550-573）の 2 つのテストを書き直し、新規 1 件を追加

- **IMPLEMENT**:
  ```typescript
  // L31 付近の mock 定義に追加
  serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
  writeBatch: vi.fn(),
  increment: vi.fn((n: number) => ({ __op: "increment", n })),

  // L41 付近の import 文に追加
  import {
    addDoc,
    getDoc,
    getDocs,
    increment,
    onSnapshot,
    runTransaction,
    serverTimestamp,
    updateDoc,
    writeBatch,
  } from "firebase/firestore";

  // L550-573 を以下に置換
  describe("finishTournament", () => {
    type FakeBatch = {
      delete: ReturnType<typeof vi.fn>;
      set: ReturnType<typeof vi.fn>;
      update: ReturnType<typeof vi.fn>;
      commit: ReturnType<typeof vi.fn>;
    };

    function mockBatch(commitImpl?: () => Promise<void>): FakeBatch {
      const batch: FakeBatch = {
        delete: vi.fn(),
        set: vi.fn(),
        update: vi.fn(),
        commit: vi.fn(commitImpl ?? (async () => undefined)),
      };
      vi.mocked(writeBatch).mockReturnValueOnce(batch as never);
      return batch;
    }

    it("returns silently when already finished (no batch issued)", async () => {
      mockGetTournament(makeTournament({ state: "finished" }));
      await finishTournament("t1", "u1", ["g1"]);
      expect(writeBatch).not.toHaveBeenCalled();
    });

    it("writes finished state and increments group counter atomically via writeBatch", async () => {
      mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
      const batch = mockBatch();

      await finishTournament("t1", "u1", ["g1"]);

      expect(batch.update).toHaveBeenCalledTimes(2);

      // 1st update: tournaments/{tid}
      const tournamentPayload = batch.update.mock.calls[0][1] as Record<string, unknown>;
      expect(tournamentPayload.state).toBe("finished");
      expect(tournamentPayload.finishedAt).toEqual({ __op: "serverTimestamp" });
      expect(tournamentPayload.pausedAt).toBeNull();

      // 2nd update: groups/{gid}.finishedTournamentCount = increment(1)
      const groupPayload = batch.update.mock.calls[1][1] as Record<string, unknown>;
      expect(groupPayload.finishedTournamentCount).toEqual({ __op: "increment", n: 1 });

      expect(batch.commit).toHaveBeenCalledTimes(1);
    });

    it("wraps batch.commit errors as firestore/write_failed", async () => {
      mockGetTournament(makeTournament({ state: "running" }));
      mockBatch(async () => {
        throw new Error("perm");
      });

      await expect(finishTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
        code: "firestore/write_failed",
      });
    });
  });
  ```
- **MIRROR**: REPOSITORY_TEST_MOCK_PATTERN（`deleteTournament` の `mockBatch` 先例）+ FIELDVALUE_INCREMENT_MOCK
- **IMPORTS**: `increment` を named import に追加
- **GOTCHA**:
  - 既存テスト「writes finished state with finishedAt server timestamp」は `updateDoc` への直書込を assert していたが、batch 化により `updateDoc` は呼ばれなくなる。書き直しが必要（上記コードが置換済み）。
  - `mockBatch` ヘルパーは `deleteTournament` describe のローカルにあるので、`finishTournament` describe にも複製する（共通化はしない、test ごとの独立性を優先）。
- **VALIDATE**: `pnpm test tournaments.test.ts` で 3 ケース pass、既存の他テスト（advanceLevel / deleteTournament 等）も regression なし

### Task 7: repository に `updateFinishedTournamentCount(gid, value)` を追加

- **ACTION**: [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) に `updateAudioSettings` の隣に新関数を追加。
- **IMPLEMENT**:
  ```typescript
  /**
   * 本プラン: groups/{gid}.finishedTournamentCount を任意の非負整数値で上書きする（手動修正経路）。
   *   - 自動 +1 経路は finishTournament() 内の writeBatch + increment(1) で別途行う。
   *   - rule は organizer 以上の場合のみ許可し、affectedKeys を 'finishedTournamentCount' のみに限定。
   *   - 値の範囲（>= 0 / int）も rule + 本関数の事前チェックで二重防御。
   */
  export async function updateFinishedTournamentCount(
    gid: string,
    value: number,
  ): Promise<void> {
    if (!Number.isInteger(value) || value < 0) {
      throw new AppError(
        "開催数は 0 以上の整数で指定してください",
        "validation/finished-count-invalid",
      );
    }
    try {
      await updateDoc(groupDocRef(gid), { finishedTournamentCount: value });
      logger.info("group finishedTournamentCount updated", { gid, value });
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "開催数の更新に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code, gid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN（`updateAudioSettings` / `updateGroupName` と同形）+ ERROR_HANDLING
- **IMPORTS**: 既存どおり（`updateDoc` / `groupDocRef` / `AppError` / `logger` は import 済み）
- **GOTCHA**:
  - validation コードは **`validation/finished-count-invalid`** で揃える。`firestore/...` ではない（クライアント側のバリデーションエラーのため）。
  - `updateDoc` 1 回の単純更新で OK。`writeBatch` は不要（単一 doc のみ書き換え）。
  - increment sentinel ではなく **素の数値** を書く。rule が `is int` でチェックするため、`Number.isInteger(value)` を事前検証して NaN / Infinity / 小数を弾く。
- **VALIDATE**:
  - Task 10 の repository test（happy path / 負値 / 非整数 / permission エラー）が通る
  - typecheck pass

### Task 8: service 層に `setFinishedTournamentCount` を追加

- **ACTION**: [src/lib/services/group.ts](../../../src/lib/services/group.ts) に `renameGroup` の隣に新 service を追加。owner / organizer のみ実行可。
- **IMPLEMENT**:
  ```typescript
  // renameGroup の直後に追加。
  // 既存の `assertOwner` の隣に `assertOrganizer` ヘルパーを必要なら追加（既存になければ）。

  function assertOrganizer(group: GroupDoc, uid: string): void {
    if (!group.organizerUids.includes(uid)) {
      throw new AppError("運営のみ実行できます", "group/not-organizer");
    }
  }

  /**
   * 本プラン: 開催数（finishedTournamentCount）を手動補正する。owner / organizer 限定。
   *   サークル詳細画面の inline edit から呼ばれる想定。
   *   rule 側でも organizer-only branch で再 enforce する。
   */
  export async function setFinishedTournamentCount({
    gid,
    uid,
    value,
  }: {
    gid: string;
    uid: string;
    value: number;
  }): Promise<void> {
    if (!Number.isInteger(value) || value < 0) {
      throw new AppError(
        "開催数は 0 以上の整数で指定してください",
        "validation/finished-count-invalid",
      );
    }
    const group = await getGroup(gid);
    assertOrganizer(group, uid);
    await updateFinishedTournamentCount(gid, value);
    logger.info("setFinishedTournamentCount ok", { gid, uid, value });
  }
  ```
- **MIRROR**: SERVICE_PATTERN（`renameGroup` の owner-only assert + repository 呼出）。`assertOrganizer` は既存 `assertOwner` と同形。
- **IMPORTS**:
  - 新規 `updateFinishedTournamentCount` を `@/lib/firebase/repositories/groups` から import
  - `GroupDoc` を `@/lib/firebase/schemas/group` から import（既存 import がなければ）
- **GOTCHA**:
  - `assertOwner` ではなく `assertOrganizer` を使う（手動修正は organizer 以上で OK の仕様）。
  - 既に `assertOrganizer` 相当のヘルパーが service 内にあれば再利用する（重複追加しない）。なければ最小限の helper として追加。
  - validation を repository / service の **両方** に書いている（防御の二重化）。値が repo に到達する前に service で弾けば、rule に行く前に AppError として返せる UX。
- **VALIDATE**:
  - Task 11 の service test（owner / organizer / member / 負値 / 非整数）が通る
  - typecheck pass

### Task 9: サークル詳細画面に「開催数」カードを追加

- **ACTION**: [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) の「メンバー」カードの **直前**（あるいは「招待コード」と「メンバー」の間）に新 Card を追加。inline edit パターンは既存の `renameGroup` フローを mirror。
- **IMPLEMENT**:
  ```typescript
  // file 上部の import に追加
  import { setFinishedTournamentCount } from "@/lib/services/group";

  // useState 群に追加（既存の renameValue / editingName と並列）
  const [editingCount, setEditingCount] = useState(false);
  const [countValue, setCountValue] = useState<string>("0");
  const countInputRef = useRef<HTMLInputElement | null>(null);

  // group が読み込まれるたびに input の値を同期（reload と整合）
  useEffect(() => {
    if (group) setCountValue(String(group.finishedTournamentCount ?? 0));
  }, [group?.finishedTournamentCount]);

  function startEditingCount() {
    if (!group) return;
    setCountValue(String(group.finishedTournamentCount ?? 0));
    setEditingCount(true);
    requestAnimationFrame(() => {
      countInputRef.current?.focus();
      countInputRef.current?.select();
    });
  }

  function cancelEditingCount() {
    setEditingCount(false);
    setCountValue(String(group?.finishedTournamentCount ?? 0));
  }

  async function onSaveCount(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !group) return;
    const parsed = Number(countValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("validation/finished-count-invalid: 開催数は 0 以上の整数で指定してください");
      return;
    }
    if (parsed === (group.finishedTournamentCount ?? 0)) {
      setEditingCount(false);
      return;
    }
    setWorking(true);
    try {
      await setFinishedTournamentCount({ gid, uid: user.uid, value: parsed });
      setEditingCount(false);
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "group/finished-count-failed", "開催数の更新に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  // JSX 内、メンバー Card の直前に挿入
  <Card>
    <CardHeader>
      <CardTitle>開催数</CardTitle>
      <CardDescription>
        終了したトーナメントの累計数。新規作成画面のデフォルト名連番に使用されます。
      </CardDescription>
    </CardHeader>
    <CardContent>
      {isOrganizer && editingCount ? (
        <form onSubmit={onSaveCount} className="flex flex-wrap items-center gap-2">
          <Input
            ref={countInputRef}
            type="number"
            min={0}
            step={1}
            value={countValue}
            onChange={(e) => setCountValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                cancelEditingCount();
              }
            }}
            aria-label="開催数"
            disabled={working}
            className="h-10 w-32 text-base"
          />
          <span className="text-sm text-muted-foreground">回</span>
          <Button type="submit" size="sm" disabled={working}>
            {working ? "保存中…" : "保存"}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={cancelEditingCount}
            disabled={working}
          >
            キャンセル
          </Button>
        </form>
      ) : (
        <div className="flex items-center gap-2">
          <p className="text-base">
            終了したトーナメント:{" "}
            <span className="font-semibold">{group.finishedTournamentCount ?? 0}</span> 回
          </p>
          {isOrganizer ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={startEditingCount}
              aria-label="開催数を修正"
            >
              <Pencil className="h-4 w-4" aria-hidden /> 修正
            </Button>
          ) : null}
        </div>
      )}
    </CardContent>
  </Card>
  ```
- **MIRROR**: 既存の rename inline-edit パターン（[group-detail-client.tsx:78-220](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx#L78-L220)）+ Card レイアウト規約
- **IMPORTS**:
  - `setFinishedTournamentCount` を `@/lib/services/group` から
  - `Pencil` は既に import 済み（`lucide-react`）
- **GOTCHA**:
  - `<input type="number">` は `step={1}` / `min={0}` 属性を付けても **ブラウザ実装によっては小数や負値の入力を物理的に防げない**（特に keyboard 入力）。`onSaveCount` 内で `Number.isInteger` を必ず再検証する。
  - 一般メンバー（`!isOrganizer`）には `修正` ボタン自体を出さない。
  - inline edit 中は `working === true` で Button / Input を disabled にして race を防ぐ。
  - 値変更なし（`parsed === current`）の保存はサーバ呼び出しせず即 `setEditingCount(false)`（既存 `onRename` と同方針）。
  - エラー時は既存の `setError(...)` で画面上部の error バナーに流す（このカード内専用 error 表示は作らない）。
- **VALIDATE**:
  - 手動: owner で `/groups/[gid]` を開き「修正」ボタン → 値変更 → 「保存」 → カードに新値が反映
  - 手動: organizer でも同操作が成功
  - 手動: 一般 member は値表示のみ、「修正」ボタンが見えない
  - 手動: 負値・小数を入れて保存 → AppError バナーが上部に出る
  - typecheck pass

### Task 10: groups repository test に `updateFinishedTournamentCount` ケース追加

- **ACTION**: [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) に新 describe を追加。
- **IMPLEMENT**:
  ```typescript
  describe("updateFinishedTournamentCount", () => {
    it("calls updateDoc with the given non-negative int", async () => {
      vi.mocked(updateDoc).mockResolvedValueOnce(undefined);
      await updateFinishedTournamentCount("g1", 12);
      const payload = vi.mocked(updateDoc).mock.calls[0][1] as Record<string, unknown>;
      expect(payload.finishedTournamentCount).toBe(12);
    });

    it("rejects negative values with validation code", async () => {
      await expect(updateFinishedTournamentCount("g1", -1)).rejects.toMatchObject({
        code: "validation/finished-count-invalid",
      });
    });

    it("rejects non-integer values with validation code", async () => {
      await expect(updateFinishedTournamentCount("g1", 1.5)).rejects.toMatchObject({
        code: "validation/finished-count-invalid",
      });
    });

    it("wraps updateDoc errors as firestore/write_failed", async () => {
      vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
      await expect(updateFinishedTournamentCount("g1", 5)).rejects.toMatchObject({
        code: "firestore/write_failed",
      });
    });
  });
  ```
- **MIRROR**: 既存 `groups.test.ts` の repository test pattern（`updateGroupName` / `updateAudioSettings` 等のテストに倣う）
- **IMPORTS**: `updateFinishedTournamentCount` を named import に追加
- **GOTCHA**: 既存ファイルの SDK モック設定（`updateDoc` モックの reset を `beforeEach` で行うかどうか）に合わせる。
- **VALIDATE**: `pnpm test groups.test.ts` で 4 ケース pass

### Task 11: service test に `setFinishedTournamentCount` ケース追加

- **ACTION**: [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) に新 describe を追加。
- **IMPLEMENT**:
  ```typescript
  describe("setFinishedTournamentCount", () => {
    it("allows owner to set value", async () => {
      mockGetGroup({ ownerUids: ["uOwner"], organizerUids: ["uOwner"], memberUids: ["uOwner"] });
      vi.mocked(updateFinishedTournamentCount).mockResolvedValueOnce(undefined);
      await setFinishedTournamentCount({ gid: "g1", uid: "uOwner", value: 8 });
      expect(updateFinishedTournamentCount).toHaveBeenCalledWith("g1", 8);
    });

    it("allows organizer to set value", async () => {
      mockGetGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      });
      vi.mocked(updateFinishedTournamentCount).mockResolvedValueOnce(undefined);
      await setFinishedTournamentCount({ gid: "g1", uid: "uOrg", value: 3 });
      expect(updateFinishedTournamentCount).toHaveBeenCalledWith("g1", 3);
    });

    it("rejects general member with group/not-organizer", async () => {
      mockGetGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      });
      await expect(
        setFinishedTournamentCount({ gid: "g1", uid: "uMember", value: 5 }),
      ).rejects.toMatchObject({ code: "group/not-organizer" });
    });

    it("rejects negative value with validation code", async () => {
      await expect(
        setFinishedTournamentCount({ gid: "g1", uid: "uOwner", value: -1 }),
      ).rejects.toMatchObject({ code: "validation/finished-count-invalid" });
    });

    it("rejects non-integer with validation code", async () => {
      await expect(
        setFinishedTournamentCount({ gid: "g1", uid: "uOwner", value: 1.5 }),
      ).rejects.toMatchObject({ code: "validation/finished-count-invalid" });
    });
  });
  ```
- **MIRROR**: 既存 `group.test.ts` の service test pattern（`renameGroup` / `promoteToOrganizer` 等のロール検証テストと同形）
- **IMPORTS**: `setFinishedTournamentCount` を named import に追加。`updateFinishedTournamentCount` を `vi.mock` 経由で repository モックに含める。
- **GOTCHA**: 既存 `mockGetGroup` ヘルパーがある前提（無ければファイル上部の他テスト先例に倣って追加）。
- **VALIDATE**: `pnpm test group.test.ts` で 5 ケース pass

### Task 12: ドキュメント更新（rules / PRD）

- **ACTION**: 2 箇所のルールドキュメントを追記（PRD の Phases テーブル / Parallelism Notes は本プラン作成時点で更新済み、本タスクでは触らない）。
- **IMPLEMENT**:

  **(a) [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md)** — 「Firestore アクセス」節末尾または「変更時のチェック」節に短く追記:
  ```markdown
  - `groups/{gid}.finishedTournamentCount` の更新は以下 2 経路に限定する。それ以外で書込んでいる箇所があれば違反:
    - 自動 +1 — `finishTournament()` の `writeBatch + increment(1)`
    - 手動修正 — `setFinishedTournamentCount(gid, uid, value)`（service）→ `updateFinishedTournamentCount(gid, value)`（repository）

  rule 側でも `affectedKeys().hasOnly(['finishedTournamentCount'])` + `is int` + `>= 0` で他フィールド汚染を deny する（[firestore.rules](../../firestore.rules) の groups update 末尾分岐）。
  ```

  **(b) [.claude/rules/group-membership.md](../../rules/group-membership.md)** — 「データモデル」節の `groups/{gid}` フィールド一覧と権限マトリクスに追加:
  ```markdown
  - `groups/{gid}` — name / ownerUids[] / organizerUids[] / memberUids / memberDisplayNames / audioSettings / **finishedTournamentCount** / createdAt / joinCodeId
    - `finishedTournamentCount`（本プラン追加）: 当該サークルで `state="finished"` に遷移したトーナメントの累計数。
      自動経路は `finishTournament()` の writeBatch で `increment(1)`、手動経路はサークル詳細画面の inline edit。
      新規作成画面のデフォルト名連番（`[サークル名]トーナメント-X`）に使用。
      rule は organizer 以上の任意の非負整数値書換を許可（任意フィールド変更は deny）。空書込攻撃のリスクは [既知のセキュリティリスク](#既知のセキュリティリスク) 参照。
  ```

  権限マトリクスに 1 行追加:
  ```markdown
  | 開催数（`finishedTournamentCount`）の参照 | ○ | ○ | ○ |
  | 開催数（`finishedTournamentCount`）の修正 | ○ | ○ | × |
  ```

  「既知のセキュリティリスク」節にも 1 項追加:
  ```markdown
  ### `finishedTournamentCount` の任意値書換による嫌がらせ

  organizer 権限を持つメンバーは `setFinishedTournamentCount` 経由で counter を任意の非負整数値に書き換えできる（rule は `>= 0 の int` のみ許可、任意フィールド変更は deny）。影響範囲は新規作成画面のトーナメント名デフォルト連番のみで、permission / billing / 集計など他のロジックには波及しない。

  **緩和**: organizer は既に CRUD 全般を持つ信頼ロールのため、嫌がらせによる実害は無視できる。完全に rule で塞ぐには Cloud Functions 化（`finishTournament` / `setFinishedTournamentCount` を Callable 化し、クライアントから groups.update を deny に戻す）が必要。Phase 5+ で counter を他用途に流用する際は再評価する。
  ```

- **MIRROR**: 既存 [.claude/rules/group-membership.md](../../rules/group-membership.md) の「データモデル」「権限マトリクス」「既知のセキュリティリスク」節構造
- **IMPORTS**: なし
- **GOTCHA**:
  - 権限マトリクスの行追加位置は既存の似た行（例: structures CRUD / tournaments CRUD）の付近にすると整合性が出る。
  - PRD の Phases テーブル / Parallelism Notes は本プラン作成時点で既に更新済み（Phase 4.16 を `in-progress` で 1 行追加、blocker 外と明記済み）。実装完了時に `complete` に遷移させるのは `/prp-implement` 側の責務。
- **VALIDATE**:
  - markdown lint pass（プロジェクト規約）
  - リンクの相対パスが壊れていないこと（`../../` の階層が plan ファイル位置と整合）

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| schema: legacy doc に finishedTournamentCount 不在 | `{...必須fields}` | parse 成功 + `finishedTournamentCount === 0` | yes（互換性） |
| schema: 明示値 7 | `{..., finishedTournamentCount: 7}` | parse 成功 + `=== 7` | no |
| schema: 負値 | `{..., finishedTournamentCount: -1}` | parse 失敗 | yes |
| repo (tournaments): finishTournament が already finished | `state: "finished"` の tournament | writeBatch 未呼出 / 早期 return | yes |
| repo (tournaments): finishTournament が running | `state: "running"` の tournament | batch.update が 2 回（tournaments + groups）/ commit 1 回 | no（happy path） |
| repo (tournaments): batch.commit が permission エラー | mock で reject | `firestore/write_failed` で throw | yes |
| repo (groups): updateFinishedTournamentCount happy | `(g1, 12)` | `updateDoc` に `finishedTournamentCount: 12` | no |
| repo (groups): updateFinishedTournamentCount 負値 | `(g1, -1)` | `validation/finished-count-invalid` で throw | yes |
| repo (groups): updateFinishedTournamentCount 小数 | `(g1, 1.5)` | `validation/finished-count-invalid` で throw | yes |
| repo (groups): updateFinishedTournamentCount permission エラー | mock で `updateDoc` reject | `firestore/write_failed` で throw | yes |
| service: setFinishedTournamentCount owner | owner uid | repo を呼出 | no |
| service: setFinishedTournamentCount organizer | organizer uid | repo を呼出 | no |
| service: setFinishedTournamentCount member | member uid（organizer 外） | `group/not-organizer` で throw | yes |
| service: setFinishedTournamentCount 負値 | `value: -1` | `validation/finished-count-invalid` で throw | yes |
| service: setFinishedTournamentCount 小数 | `value: 1.5` | `validation/finished-count-invalid` で throw | yes |

### Edge Cases Checklist

- [x] **legacy doc**（`finishedTournamentCount` 未定義）— zod default 0 / rule の `affectedKeys().hasOnly(...)` で吸収
- [x] **二重 finishTournament 呼出** — 早期 return ガードで increment が 1 回のみ
- [x] **同一サークルで複数 in-flight** — 並行作成時の名前衝突は許容（手動上書き可能）。手動修正 UI で運営者が必要に応じて補正
- [x] **削除されたトーナメントの counter 巻き戻し** — 自動では巻き戻さない仕様。手動修正 UI で減算可能
- [x] **権限エラー** — 一般 member の counter 直書き → rule で deny。UI 側でも編集ボタン非表示
- [x] **rule の `affectedKeys` 違反** — `name` 同時変更などは deny
- [x] **rule の負値書込** — `>= 0 の int` で deny
- [x] **`useCurrentGroup` 未ロード時の表示** — `loading` ガードで「読込中…」を返す既存挙動を維持
- [x] **トーナメント名の入力上書き** — `useState(initialName)` の React 仕様で初期値のみ反映、ユーザー編集を破壊しない
- [x] **手動修正後の即時反映** — `reload()` + `refreshGroups()` でカード値と sidebar 等の `useCurrentGroup` の両方が更新
- [x] **inline edit 中の同時送信防止** — `working === true` で Button / Input を disabled に

---

## Validation Commands

### Static Analysis

```bash
pnpm typecheck
```

EXPECT: ゼロエラー。`GroupDoc.finishedTournamentCount: number` 型が伝播し、`tournament-new-client.tsx` の参照型もエラーにならない。

### Lint

```bash
pnpm lint
```

EXPECT: ゼロ警告。`logger` 経由ログ・no-console rule など既存規約を遵守。

### Unit Tests

```bash
pnpm test schemas/index.test.ts tournaments.test.ts groups.test.ts services/group.test.ts
```

EXPECT: 全 pass。Task 5 / 6 / 10 / 11 で追加した schema 3 + tournaments repo 3 + groups repo 4 + service 5 = 計 15 ケースが含まれること。

### Full Test Suite

```bash
pnpm test
```

EXPECT: regression なし（既存 296+ tests 全 pass）。`finishTournament` の挙動変更は公開 contract 不変（戻り値 / throw 条件 / 副作用範囲は同じ、ただし内部実装が batch 化）。

### Build

```bash
pnpm build
```

EXPECT: Next.js 本番ビルドが成功し、bundle に余計な依存が増えていないこと。

### Firestore Rules（エミュレータ）

```bash
# プロジェクトの rule テストハーネスがある場合（無ければ手動）
pnpm test:rules
# または:
firebase emulators:start --only firestore
# 別 shell で SDK から書込を試して allow/deny を確認
```

EXPECT:

- organizer による `update(groups/g1, { finishedTournamentCount: increment(1) })` が allow（自動経路）
- organizer による `update(groups/g1, { finishedTournamentCount: 0 })` が allow（手動補正・リセット）
- organizer による `update(groups/g1, { finishedTournamentCount: 12 })` が allow（手動補正・任意値）
- 一般 member による同 update が deny
- organizer による `finishedTournamentCount: -1` が deny（負値）
- organizer による `finishedTournamentCount: 5, name: "x"` の同時書換が deny（`affectedKeys().hasOnly` で reject）

### Browser Validation（手動）

```bash
pnpm dev
```

EXPECT（新規作成画面）:

- `/tournaments/new` 表示時、`name` フィールドに `[<group.name>]トーナメント-1`（counter 0 の新規グループ）がプリセットされる
- 既に終了済みトーナメントが N 件あるグループでは `-${N + 1}` がプリセットされる
- ユーザーが入力欄をクリックして編集すると、自由に上書きできる
- 「作成」ボタンで意図した name で保存される
- ダッシュボードで finishTournament を実行（state="finished" 化）後、Firestore Console で `groups/{gid}.finishedTournamentCount` が +1 されている

EXPECT（サークル詳細画面）:

- owner / organizer で `/groups/[gid]` を開くと「開催数」カードが見え、現在値と「修正」ボタンが出る
- 「修正」クリックで input が表示され focus + select される。Esc / キャンセル / 同値保存はサーバ呼び出しせず即座に閉じる
- 数値変更 → 「保存」 → カード値が更新され、画面ヘッダ上のサークル切替や `/tournaments/new` のデフォルト名にも次回読込で反映される
- 一般 member で同ページを開くと値表示のみで「修正」ボタンが出ない

### Manual Validation

新規作成画面:

- [ ] 新規グループを作成し、`/tournaments/new` で `[<groupName>]トーナメント-1` が見える
- [ ] そのまま「作成」して保存が成功する
- [ ] トーナメントを `setup` → `seating` → `running` → 任意操作で終了させる
- [ ] 再度 `/tournaments/new` を開くと `[<groupName>]トーナメント-2` に繰り上がっている
- [ ] 入力欄を手動で別の名前に書き換えても保存できる
- [ ] 一般 member（organizer 権限なし）には新規作成画面自体が `/tournaments` にリダイレクトされる（既存挙動）
- [ ] グループ名に括弧 `[]` や全角文字を含めて表示崩れがないこと

サークル詳細画面（開催数カード）:

- [ ] owner で /groups/[gid] を開き「開催数: N 回」が見え、「修正」ボタンが押せる
- [ ] 「修正」 → input にフォーカスし全選択される
- [ ] Esc キーでキャンセルが効き、表示モードに戻る
- [ ] キャンセルボタンでも同様
- [ ] 同じ値のまま保存しても無駄にサーバ呼び出しが発生しない（network タブで確認）
- [ ] 値変更 → 保存後、カード値が即時更新され、`/tournaments/new` を別タブで開くと連番が新値+1 に追従する
- [ ] 負値（例: -1）を入れて保存 → 上部 error バナーに `validation/finished-count-invalid` が出る
- [ ] 小数（例: 1.5）を入れて保存 → 同様
- [ ] organizer ロールでも同じ操作ができる
- [ ] 一般 member でログインして `/groups/[gid]` を開く → 値表示のみで「修正」ボタンが出ない

---

## Acceptance Criteria

- [ ] Task 1〜12 が全て完了
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` / `pnpm build` がいずれも green
- [ ] schema test 3 + tournaments repo test 3 + groups repo test 4 + service test 5 = 計 15 ケースが追加され pass
- [ ] Firestore Rules 変更がエミュレータで allow/deny 通り検証済み（自動 +1 / 手動任意値 / 負値 deny / 同時フィールド変更 deny / 一般 member deny）
- [ ] 手動検証チェックリストが新規作成画面 / サークル詳細画面の両方で全項目 ✓
- [ ] [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) の進捗表に Phase 4.16 が記載され、本プランへのリンクが貼られている（**作成済み**）
- [ ] [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) と [.claude/rules/group-membership.md](../../rules/group-membership.md) が更新されている

## Completion Checklist

- [ ] schema 拡張は `audioSettings` の additive 追加と同じパターン（`.default(0)`）
- [ ] error / log 規約に従い `AppError.from(e, "firestore/write_failed", ...)` + `logger.warn` を維持
- [ ] validation エラーは `validation/finished-count-invalid` を repository / service の両層で同じコードで投げる
- [ ] `console.*` の直呼びゼロ
- [ ] writeBatch / increment は既存 `deleteTournament` / `serverTimestamp` 先例と同形
- [ ] Firestore Rules は既存 4 + 1 (audioSettings) branch のあとに OR 追加（既存 owner branch は不変）
- [ ] サークル詳細画面の inline edit は `renameGroup` 既存パターンを mirror（focus + select / Esc / 同値キャンセル）
- [ ] React コンポーネントの hooks 順序を変えていない（`useEffect` / `useMemo` / 新 `useState` を既存 hooks の後ろに追加）
- [ ] 文書（rules）が現状と整合（PRD は本プラン作成時に更新済み）
- [ ] スコープ外の追加変更なし（NOT Building 守る）
- [ ] Self-contained — 実装中に追加調査が必要な箇所なし

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| organizer による任意値書換（嫌がらせ） | L | 低（影響範囲はトーナメント名連番のみ） | rule で `>= 0 の int` のみ許可、`affectedKeys.hasOnly` で他フィールド変更 deny。完全に塞ぐには Cloud Functions 化（Phase 5+） |
| writeBatch 化により既存テストが broken | M | 中（CI ブロック） | Task 6 で既存 finishTournament test を batch 形に書き直す。`mockBatch` ヘルパーを deleteTournament 先例から複製 |
| `useCurrentGroup().groups` の counter が古い | M | 低（手動編集 + `refreshGroups()` で回避可能） | サークル詳細での修正後は `refreshGroups()` を呼んでサイドバー / 新規作成画面に伝播。dashboard の「終了」操作後の伝播は scope 外（次ページ読込で反映） |
| グループ名に `[` `]` を含むケースで二重括弧 | L | 低（仕様としてフォーマット固定） | エスケープ・除去は行わない。プリセットは編集前提なので運営者が必要なら書き直す |
| 並行 in-flight 重複（A・B 同時作成で同名デフォルト） | M | 低（手動編集可） | scope 外。完全な一意性は Cloud Functions 化が必要 |
| 手動修正中に他端末からの自動 +1 とレース | L | 低（last-write-wins、運営者ロールで自然解決） | 本プランは onSnapshot 化しない（reload + refresh で十分）。気になる場合は将来 onSnapshot 化を検討 |
| `<input type="number">` のブラウザ別挙動差 | L | 低（運営者の理解で回避可能） | `Number.isInteger` で再検証。step / min は補助的。エラー時は AppError バナーで明示 |
| rule デプロイ忘れによる localhost 動作 / 本番 deny の差分 | L | 中 | `firebase deploy --only firestore:rules` を実装完了時の必須手順に含める。リリース前に `npx firebase firestore:rules:get` で diff 確認 |

## Notes

- 本プランは **Phase 4.15 後の単発 UX polish** という位置づけで、Phase 5 のブロッカーには含めない（Phase 5 中・後でも投入可能）。
- counter の用途は **新規作成画面のデフォルト名のみ**。集計・統計・課金・アナリティクスには使わない（流用を始める際は本プランの「組織者信頼モデル」の前提を再評価すること）。
- 自動経路（`+1 increment`）と手動経路（`任意値書換`）を 1 つの rule branch でカバーしているため、`+1 限定` の rule に比べて若干緩い。これは「手動修正 UI の運用補正用途を rule で塞がない」という意図的なトレードオフ。
- 削除 → 番号スキップを **自動補正しない**のは「monotonic に増やす」シンプルさを優先したため。代わりに **手動修正 UI** で運営者が任意の値（増加・減少どちらも）に補正できるため、運用上の柔軟性は確保される。
- `useCurrentGroup` の `groups` を増分なしで使えるのは、本プラン以前の counter 不在期でも legacy doc が `default(0)` で hydrate されるため。これにより新規作成画面側で追加 fetch が一切不要。
- 修正履歴（誰がいつ何に変更したか）の audit log は本プランで作らない。必要になれば `groupAuditLog/{...}` 等を後付けで導入する。
