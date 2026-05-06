# Plan: Phase 4.17 — Group ごとの「1 Table あたりの席数」デフォルト値設定

## Summary

`/tournaments/new` でトーナメント作成時に指定する「**1 Table あたりの席数（`seatsPerTable`）**」の初期値を、サークル単位で永続化できるようにする。`groups/{gid}.defaultSeatsPerTable` を schema additive で追加（`z.number().int().min(2).max(10).default(9)`）し、新規作成画面はその値を `<TournamentForm initialSeatsPerTable=...>` に流し込む。値の編集 UI はサークル詳細（`/groups/[gid]`）の inline edit（`Pencil` アイコン + Input + 保存/キャンセル）で提供し、Phase 4.16 で確立した「開催数」カードのパターンを完全に mirror する。Firestore Rules には organizer-only の `defaultSeatsPerTable` 単独書換 branch を 1 件追加し、`affectedKeys().hasOnly([...])` + `is int` + `>= 2 && <= 10` で他フィールド汚染を deny する。

## User Story

As a サークル運営者（owner / organizer）,
I want 自サークルのトーナメントで標準的に使う 1 Table あたりの席数（例: 6 席運用なら 6、9 席運用なら 9）をサークル単位で保存できる,
So that 毎回トーナメントを作るたびに `9` を `6` に直す手間が消え、サークルの運用ルールに合わせた席数が初期表示される。

And as a サークル一般メンバー,
I want サークル詳細画面で現在のデフォルト席数を確認できる,
So that 自分のサークルが何人卓運用なのかを把握できる（編集権限は不要）。

## Problem → Solution

**Current state**:

- [src/components/tournament/TournamentForm.tsx:35](../../../src/components/tournament/TournamentForm.tsx#L35) に `DEFAULT_SEATS_PER_TABLE = 9` がハードコードされており、新規作成時はサークルに関係なく毎回 `9` が初期表示される。
- [src/app/tournaments/new/tournament-new-client.tsx:43-58](../../../src/app/tournaments/new/tournament-new-client.tsx#L43-L58) の `<TournamentForm>` 呼出は `initialSeatsPerTable` を渡していないため、`9` 固定。
- 6 人卓運用のサークルでは毎回 `9 → 6` に直す手間がある（運営者ヒアリングで挙がる典型ペイン）。
- `groups/{gid}` には席数のデフォルトを表す数値フィールドが無い。

**Desired state**:

- `/tournaments/new` を開くと、`1 Table あたりの席数` 欄に**そのサークルで設定済みの値**（未設定なら 9）がプリセットされる。
- サークル詳細画面（`/groups/[gid]`）の「開催数」カードと並列に「**1 Table あたりの席数（デフォルト）**」カードがあり、現在値の表示と、owner / organizer 限定の inline edit（`min=2 max=10` の数字入力 + 保存/キャンセル）が提供される。一般メンバーには表示のみで編集 affordance は出さない。
- 既存サークルは `default(9)` で legacy doc を補完するため破壊的 migration は不要。明示的に変更したサークルだけ値が変わる。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 4.17（Phase 4.16 後の小規模 polish。Phase 5 ブロッカー外）
- **Stage scope**: schema additive + repository 1 関数 + service 1 関数 + rules 1 branch 追加 + 新規作成 client（1 行追加） + サークル詳細 client（1 カード追加） + tests
- **Estimated Files**: 約 12 files（schema 1 / repository 1 / service 1 / rules 1 / 新規作成 client 1 / 詳細 client 1 / tests 3 / docs 2、PRD は別途）

---

## UX Design

### Before

```
/tournaments/new

┌──────────────────────────────────────────────┐
│ トーナメントを新規作成                       │
│                                              │
│ トーナメント名                               │
│   [サタデーサークル]トーナメント-3           │
│                                              │
│ ストラクチャ  [▼ Default (12 レベル)]       │
│ 1 Table あたりの席数  [ 9 ]                 │  ← 常に 9 固定。毎回直す
│                                              │
│ [作成]  [キャンセル]                         │
└──────────────────────────────────────────────┘
```

### After

```
/tournaments/new （サークルが defaultSeatsPerTable=6 を設定済みのとき）

┌──────────────────────────────────────────────┐
│ トーナメントを新規作成                       │
│                                              │
│ トーナメント名                               │
│   [サタデーサークル]トーナメント-3           │
│                                              │
│ ストラクチャ  [▼ Default (12 レベル)]       │
│ 1 Table あたりの席数  [ 6 ]                 │  ← サークルの既定値で起動
│                                              │
│ [作成]  [キャンセル]                         │
└──────────────────────────────────────────────┘
```

### Group 詳細画面（`/groups/[gid]`）の Before / After

**Before**（Phase 4.16 完了時点）:

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
│ ┌── メンバー ──────────────────────────────────┐ ...│
└────────────────────────────────────────────────────┘
```

**After**（owner / organizer 表示時）:

```
┌── 開催数 ────────────────────────────────────┐
│ 終了したトーナメント: 12 回    [ ✎ 修正 ]    │
└──────────────────────────────────────────────┘

┌── 1 Table あたりの席数（デフォルト） ────────┐
│ 6 席          [ ✎ 変更 ]                     │
│ ※ 新規トーナメント作成時の初期値に使用       │
└──────────────────────────────────────────────┘
```

修正クリック後（inline edit）:

```
┌── 1 Table あたりの席数（デフォルト） ────────┐
│ [ 6 ▲▼ ]  [保存]  [キャンセル]               │
│ ※ 2 〜 10 の整数。範囲外は弾かれます。      │
└──────────────────────────────────────────────┘
```

**After**（一般メンバー表示時）:

```
┌── 1 Table あたりの席数（デフォルト） ────────┐
│ 6 席                                         │
└──────────────────────────────────────────────┘
```

— 編集ボタンは出さない。表示自体はロール非依存。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/tournaments/new` 表示時の `seatsPerTable` 欄 | 常に `9` | `groups[currentGroupId].defaultSeatsPerTable ?? 9` | プリセットだが上書き自由 |
| `/groups/[gid]` の **デフォルト席数カード** | カード自体なし | 全メンバー: 値表示。owner / organizer: inline edit ボタン表示 | 「開催数」カードを mirror（`Pencil` アイコン + Input + `requestAnimationFrame` focus + Esc / 同値キャンセル） |
| デフォルト席数 inline edit 確定 | N/A | `setDefaultSeatsPerTable({ gid, uid, value })` を呼び `groups/{gid}` を更新 → `reload()` + `refreshGroups()` | 失敗時はカード内に AppError ラベルを表示 |
| `groups/{gid}` の `read` payload | `defaultSeatsPerTable` 不在 | 数値（legacy doc は zod default 9） | スキーマ互換性維持 |
| `useCurrentGroup()` の `groups` payload | 既存フィールドのみ | + `defaultSeatsPerTable` | schema 拡張だけで自動取得（context 層変更なし） |
| 既存トーナメント編集（`/tournaments/[tid]/edit`） | 変更なし | 変更なし | プリセットは新規作成画面のみ |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ追加の三点同期（schema / repo / rules）規約・単一フィールド書込経路の限定パターン |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | `AppError.from(e, "firestore/...")` ラップと logger 経由出力 |
| P0 | [.claude/rules/group-membership.md](../../rules/group-membership.md) | データモデル / 権限マトリクス / 既知のセキュリティリスク | `groups/{gid}` のフィールド追加と organizer 権限。Phase 4.16 で追記された self-* affectedKeys 制約の方針 |
| P0 | [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | 22-87 | `audioSettings` / `finishedTournamentCount` を additive 追加した先例。同じ pattern で `defaultSeatsPerTable` を追加 |
| P0 | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts) | 38-75 | 既存 `seatsPerTable` の制約（`int().min(2).max(10)`）。group 側のデフォルトと**完全に同じ範囲制約**を使うこと（drift 防止） |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | 238-278 | `updateFinishedTournamentCount` の error wrap pattern。新規 `updateDefaultSeatsPerTable` を直後に追加する位置 |
| P0 | [src/lib/services/group.ts](../../../src/lib/services/group.ts) | 287-311 | `setFinishedTournamentCount` の owner / organizer assert + repository 経由 update パターン。本プランの `setDefaultSeatsPerTable` を同形で実装 |
| P0 | [firestore.rules](../../../firestore.rules) | 185-211 | `groups/{gid}` update の `audioSettings` / `finishedTournamentCount` の organizer-only branch。新 `defaultSeatsPerTable` branch を `finishedTournamentCount` branch の直後に追加する位置 |
| P0 | [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) | all | プリセット適用先。Phase 4.16 で `defaultName` を派生した `useMemo` の隣に `defaultSeatsPerTable` の派生を追加し、`<TournamentForm initialSeatsPerTable={...}>` を渡す |
| P0 | [src/components/tournament/TournamentForm.tsx](../../../src/components/tournament/TournamentForm.tsx) | 21-66, 161-175 | `initialSeatsPerTable` prop は既に Phase 4.16 以前から対応済み（`useState(initialSeatsPerTable ?? DEFAULT_SEATS_PER_TABLE)`）。フォーム本体は不変で済む |
| P0 | [src/lib/services/current-group.tsx](../../../src/lib/services/current-group.tsx) | 23-49, 150-160 | `groups` 配列・`isOwner` / `isOrganizer` の利用パターン。追加 fetch なしで `defaultSeatsPerTable` を取れる |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | 80-83, 231-270, 406-467 | Phase 4.16 「開催数」カードの inline edit パターン（state ペア・`Pencil` アイコン・`requestAnimationFrame` focus・Esc / 同値キャンセル・`reload()` + `refreshGroups()`）。本プランの「デフォルト席数」カードはこれを完全 mirror |
| P0 | [.claude/PRPs/plans/completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md](completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md) | all | 直近の同型 plan。schema additive + repository / service / rules 拡張 + 新規作成画面と詳細画面の UI 追加が完全に対称構造。本プランは PRD・report・rule 文の文言まで含めて同じ書式で書く |
| P1 | [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) | 307-496 | `groupBodySchema` 追加フィールドの test pattern（"defaults X for legacy docs without the field" / "preserves explicit X" / "rejects out-of-range X"）。既存 `audioSettings` / `finishedTournamentCount` 群の隣に追加 |
| P1 | [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) | `updateFinishedTournamentCount` 周辺 | groups repository のテストパターン。`updateDefaultSeatsPerTable` の試験を追加する基盤 |
| P1 | [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) | `setFinishedTournamentCount` 周辺 | service 層の owner / organizer assert パターン + `makeGroup()` fixture。`setDefaultSeatsPerTable` の test を追加 |
| P1 | [scripts/test-rules-finished-count.mjs](../../../scripts/test-rules-finished-count.mjs) | all | Firestore Rules emulator スクリプトの先例。同型で `scripts/test-rules-default-seats.mjs` を新規作成 |
| P2 | [src/lib/firebase/converters.ts](../../../src/lib/firebase/converters.ts) | all | zodConverter が `default()` を hydrate するため legacy doc は read 時に補完される |
| P2 | [src/app/tournaments/[tid]/edit/tournament-edit-client.tsx](../../../src/app/tournaments/%5Btid%5D/edit/tournament-edit-client.tsx) | `initialSeatsPerTable={data.seatsPerTable}` を渡す行 | 編集画面は既にトーナメント自身の値を渡しているため**変更不要**。プリセットは新規作成画面のみ |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firestore Security Rules `request.resource.data.diff(...).affectedKeys()` | https://firebase.google.com/docs/reference/rules/rules.MapDiff#affectedkeys | 差分のキー集合を返す。`hasOnly(['x'])` で「特定フィールドのみ変更可」を rule で強制。Phase 4.9 / 4.16 で同パターンを採用済み |
| Firestore Security Rules `is int` / 範囲比較 | https://firebase.google.com/docs/reference/rules/rules.Integer | `value is int && value >= 2 && value <= 10` で値域を rule で強制可能 |

GOTCHA:

- `DEFAULT_SEATS_PER_TABLE = 9`（[TournamentForm.tsx:35](../../../src/components/tournament/TournamentForm.tsx#L35)）と group schema の `default(9)` は**同じ値で揃える**こと。group 側は Single Source Of Truth ではないが、未設定サークルの挙動が一致しないと UX に矛盾が生じる。
- `seatsPerTable` の min/max（`int().min(2).max(10)`）は [tournament.ts:44](../../../src/lib/firebase/schemas/tournament.ts#L44) と完全一致させる。drift すると「rule では allow されたが service / form で reject される」逆コーナーが発生する。
- 上限 `10` は Firestore Rules の `players/{pid}` 分岐でも `seatNum <= 10` としてハードコードされており（[tournament.ts:43-44](../../../src/lib/firebase/schemas/tournament.ts#L43-L44) DRIFT WARNING コメント参照）。本プランで上限を変更しないこと（rule 側にも DRIFT WARNING コメントを継承する）。
- `<TournamentForm>` は `useState(initialSeatsPerTable ?? DEFAULT_SEATS_PER_TABLE)` で初期化するため、**`initialSeatsPerTable` が後から変わっても入力欄には反映されない**（React の意図された挙動）。Phase 4.16 で `initialName` について同じ問題があり、`if (!user || !currentGroupId) return null;` のガードで `groups` ロード前は描画させない設計で解決済み。本プランも同経路にそのまま乗る。
- `useCurrentGroup()` の `groups` は `listMyGroups` 経由で fetch される。inline edit で値を保存した直後は `refreshGroups()` を呼ぶことで `/tournaments/new` を新しいタブで開いたときに新値が反映される（同タブで進む遷移でも Provider 共有のため反映される）。Phase 4.16 の `setFinishedTournamentCount` と全く同じパターン。
- `defaultSeatsPerTable` の rule 側上限 `<= 10` は将来「7 テーブル以上対応」を解禁したときも変えない（席数の上限と卓数の上限は別軸）。

---

## Patterns to Mirror

### NAMING_CONVENTION（schema additive）

```typescript
// SOURCE: src/lib/firebase/schemas/group.ts:74-78
// Phase 4.16: 終了したトーナメントの累計数。`finishTournament()` の runTransaction で
//   `increment(1)` され、`/tournaments/new` のデフォルト名連番に使用する。tx 内で
//   `state !== "finished"` を再 read することで、複数端末同時呼び出しでも +1 のみ進める。
//   旧 doc（Phase 4.15 以前）は default(0) で受容され、次回終了時に 1 になる。
finishedTournamentCount: z.number().int().nonnegative().default(0),
```

`finishedTournamentCount` の直後に同列で `defaultSeatsPerTable` を追加。zod の `default(9)` で legacy doc を補完する。

```typescript
// 追加形（本プラン）
// Phase 4.17: トーナメント新規作成時の `seatsPerTable` 初期値。サークル詳細画面の inline edit
//   から organizer 以上が更新する。schema は `tournament.seatsPerTable` と完全に同じ範囲制約を使う
//   （DRIFT WARNING: 上限 10 は firestore.rules の players seatNum 上限と連動。同時に変更）。
//   旧 doc（Phase 4.16 以前）は default(9) で受容される。
defaultSeatsPerTable: z.number().int().min(2).max(10).default(9),
```

### ERROR_HANDLING / LOGGING_PATTERN（repository update）

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:245-267
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

`updateDefaultSeatsPerTable` も完全に同形で実装する（メッセージとコードのみ差し替え）:

```typescript
export async function updateDefaultSeatsPerTable(
  gid: string,
  value: number,
): Promise<void> {
  if (!Number.isInteger(value) || value < 2 || value > 10) {
    throw new AppError(
      "デフォルト席数は 2 以上 10 以下の整数で指定してください",
      "validation/default-seats-invalid",
    );
  }
  try {
    await updateDoc(groupDocRef(gid), { defaultSeatsPerTable: value });
    logger.info("group defaultSeatsPerTable updated", { gid, value });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "firestore/write_failed",
      "デフォルト席数の更新に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}
```

### SERVICE_PATTERN（owner / organizer assert + repository 呼出）

```typescript
// SOURCE: src/lib/services/group.ts:292-311
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

`setDefaultSeatsPerTable` も同形:

```typescript
// Phase 4.17: デフォルト席数を手動補正する。owner / organizer 限定。
//   サークル詳細画面の inline edit から呼ばれる。rule 側でも organizer-only branch で再 enforce する。
export async function setDefaultSeatsPerTable({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (!Number.isInteger(value) || value < 2 || value > 10) {
    throw new AppError(
      "デフォルト席数は 2 以上 10 以下の整数で指定してください",
      "validation/default-seats-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultSeatsPerTable(gid, value);
  logger.info("setDefaultSeatsPerTable ok", { gid, uid, value });
}
```

### FIRESTORE_RULE_PATTERN（既存 organizer-only counter branch + 追加 organizer-only seats branch）

```firestore-rules
// SOURCE: firestore.rules:194-207（Phase 4.16 で追加された finishedTournamentCount branch）
) || (
  // Phase 4.16: organizer による finishedTournamentCount の任意の非負整数値書換。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['finishedTournamentCount'])
  && request.resource.data.finishedTournamentCount is int
  && request.resource.data.finishedTournamentCount >= 0
);
```

`finishedTournamentCount` branch のあとに OR で **defaultSeatsPerTable 専用 branch** を追加:

```firestore-rules
) || (
  // Phase 4.17: organizer による defaultSeatsPerTable の単独書換。
  //   サークル詳細画面 inline edit から `setDefaultSeatsPerTable({ gid, uid, value })` 経由で発火。
  //   affectedKeys は 'defaultSeatsPerTable' のみに限定。他フィールドは触らせない。
  //   値域 2..10 は src/lib/firebase/schemas/tournament.ts の seatsPerTable.min(2).max(10) と
  //   厳密一致させる（DRIFT WARNING: tournaments の seatsPerTable / players seatNum 上限と連動）。
  //   organizer は元々サークルの全 CRUD を持つ信頼ロールのため、空値書込のリスクは許容範囲。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['defaultSeatsPerTable'])
  && request.resource.data.defaultSeatsPerTable is int
  && request.resource.data.defaultSeatsPerTable >= 2
  && request.resource.data.defaultSeatsPerTable <= 10
)
```

owner branch（`firestore.rules:85-91`）は包括的なので owner なら本 branch を経由しなくても更新できる（OR 評価）。

### REACT_HOOK_PATTERN（既ロード状態からの算出）

```typescript
// SOURCE: src/app/tournaments/new/tournament-new-client.tsx:24-33（Phase 4.16 既実装）
const defaultName = useMemo(() => {
  if (!currentGroupId) return "";
  const g = groups.find((x) => x.id === currentGroupId);
  if (!g) return "";
  const next = (g.finishedTournamentCount ?? 0) + 1;
  return `[${g.name}]トーナメント-${next}`;
}, [currentGroupId, groups]);
```

その隣に `defaultSeatsPerTable` 派生を追加:

```typescript
// Phase 4.17: 1 Table あたりの席数のサークル既定値。`groups[currentGroupId].defaultSeatsPerTable`
//   を `<TournamentForm initialSeatsPerTable=...>` に流し込む。legacy doc（未設定）は zod default で 9 として hydrate。
const defaultSeatsPerTable = useMemo(() => {
  if (!currentGroupId) return undefined;
  const g = groups.find((x) => x.id === currentGroupId);
  return g?.defaultSeatsPerTable ?? undefined; // undefined のまま渡せば TournamentForm 側の DEFAULT_SEATS_PER_TABLE=9 にフォールバック
}, [currentGroupId, groups]);
```

### UI_INLINE_EDIT_PATTERN（Phase 4.16 「開催数」カードを mirror）

```tsx
// SOURCE: src/app/groups/[gid]/group-detail-client.tsx:406-467（Phase 4.16 「開催数」カード）
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
        <Input ref={countInputRef} type="number" min={0} step={1}
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
               className="h-10 w-32 text-base" />
        <span className="text-sm text-muted-foreground">回</span>
        <Button type="submit" size="sm" disabled={working}>
          {working ? "保存中…" : "保存"}
        </Button>
        <Button type="button" size="sm" variant="outline"
                onClick={cancelEditingCount} disabled={working}>
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
          <Button type="button" size="sm" variant="outline"
                  onClick={startEditingCount}
                  aria-label="開催数を修正">
            <Pencil className="h-4 w-4" aria-hidden /> 修正
          </Button>
        ) : null}
      </div>
    )}
  </CardContent>
</Card>
```

本プランの「1 Table あたりの席数（デフォルト）」カードは、上記をそっくり複製し以下を差し替える:

- `editingCount` / `setEditingCount` → `editingSeats` / `setEditingSeats`
- `countValue` / `setCountValue` → `seatsValue` / `setSeatsValue`
- `countInputRef` → `seatsInputRef`
- `startEditingCount` / `cancelEditingCount` / `onSaveCount` → `startEditingSeats` / `cancelEditingSeats` / `onSaveSeats`
- `<Input min={0} step={1}>` → `<Input min={2} max={10} step={1}>`
- 表示文言: 「終了したトーナメント: X 回」→「X 席」
- バリデーション: `parsed < 0` → `parsed < 2 || parsed > 10`
- service 呼出: `setFinishedTournamentCount` → `setDefaultSeatsPerTable`
- AppError code: `group/finished-count-failed` → `group/default-seats-failed`

### TEST_STRUCTURE（schema additive）

```typescript
// SOURCE: src/lib/firebase/schemas/index.test.ts: groupBodySchema 既存 audioSettings / finishedTournamentCount 群
it("defaults defaultSeatsPerTable to 9 for legacy docs without the field", () => {
  const parsed = groupBodySchema.parse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
  });
  expect(parsed.defaultSeatsPerTable).toBe(9);
});

it("preserves explicit defaultSeatsPerTable in [2..10]", () => {
  const parsed = groupBodySchema.parse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
    defaultSeatsPerTable: 6,
  });
  expect(parsed.defaultSeatsPerTable).toBe(6);
});

it("rejects defaultSeatsPerTable below 2", () => {
  const result = groupBodySchema.safeParse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
    defaultSeatsPerTable: 1,
  });
  expect(result.success).toBe(false);
});

it("rejects defaultSeatsPerTable above 10", () => {
  const result = groupBodySchema.safeParse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
    defaultSeatsPerTable: 11,
  });
  expect(result.success).toBe(false);
});

it("rejects non-integer defaultSeatsPerTable", () => {
  const result = groupBodySchema.safeParse({
    name: "G",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    createdAt: now,
    defaultSeatsPerTable: 5.5,
  });
  expect(result.success).toBe(false);
});
```

### REPOSITORY_TEST_PATTERN（updateDoc 引数 assert）

`updateFinishedTournamentCount` のテスト（[groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts)）と同形:

- 値域内（例: 6）→ `updateDoc` が `{ defaultSeatsPerTable: 6 }` で 1 回呼ばれる
- 値域外（1, 11, 5.5）→ `AppError("validation/default-seats-invalid")` を throw、`updateDoc` 呼ばれず
- `updateDoc` が reject → `firestore/write_failed` でラップされる

### SERVICE_TEST_PATTERN（owner / organizer / member ロールごと）

`setFinishedTournamentCount` のテスト（[group.test.ts](../../../src/lib/services/group.test.ts)）と同形:

- owner が呼ぶ → `updateDefaultSeatsPerTable` が呼ばれる
- organizer が呼ぶ → `updateDefaultSeatsPerTable` が呼ばれる
- member が呼ぶ → `assertOrganizer` で reject（`AppError("group/forbidden")`）、repository 呼ばれず
- 値域外（1, 11） → 早期 `AppError("validation/default-seats-invalid")`、`getGroup` すら呼ばれず

### EMULATOR_SCRIPT_PATTERN（rules 検証）

`scripts/test-rules-finished-count.mjs` をベースに `scripts/test-rules-default-seats.mjs` を新規作成。`expectAllow` / `expectDeny` ヘルパーは流用し、6 ケースを検証する:

1. organizer が `defaultSeatsPerTable: 6` を書く → allow
2. organizer が `defaultSeatsPerTable: 2`（境界・最小）を書く → allow
3. organizer が `defaultSeatsPerTable: 10`（境界・最大）を書く → allow
4. organizer が `defaultSeatsPerTable: 1`（境界外）を書く → deny
5. organizer が `defaultSeatsPerTable: 11`（境界外）を書く → deny
6. organizer が `{ defaultSeatsPerTable: 6, name: "x" }` 同時書込 → deny（affectedKeys 違反）
7. member が `defaultSeatsPerTable: 6` を書く → deny
8. owner がフル update（`{ name: "x", defaultSeatsPerTable: 6 }`）→ allow（owner branch で通る）
9. legacy doc（フィールド未定義）に対し organizer が `defaultSeatsPerTable: 6` を書く → allow

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | UPDATE | `groupBodySchema` に `defaultSeatsPerTable` フィールド追加（`z.number().int().min(2).max(10).default(9)`） |
| [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | UPDATE | `updateDefaultSeatsPerTable(gid, value)` を新設。`updateFinishedTournamentCount` の隣に同形で配置 |
| [src/lib/services/group.ts](../../../src/lib/services/group.ts) | UPDATE | `setDefaultSeatsPerTable({ gid, uid, value })` を新設。`assertOrganizer` で actor が organizer 以上か検証してから repository を呼ぶ |
| [firestore.rules](../../../firestore.rules) | UPDATE | `groups/{gid}` update に organizer-only `defaultSeatsPerTable` 単独書換 branch を 1 件 OR 追加（`finishedTournamentCount` branch の直後） |
| [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) | UPDATE | `useCurrentGroup().groups` から `defaultSeatsPerTable` を派生し `<TournamentForm initialSeatsPerTable=...>` に渡す（`defaultName` 派生の隣に追加） |
| [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | UPDATE | 「1 Table あたりの席数（デフォルト）」カードを「開催数」カードの隣に追加。Phase 4.16 inline edit パターンを mirror |
| [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) | UPDATE | `defaultSeatsPerTable` の legacy default / explicit valid / 範囲外（min-1 / max+1 / 非整数）の 5 ケース追加 |
| [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) | UPDATE | `updateDefaultSeatsPerTable` の happy path / 範囲外 / Firestore reject の 3 系統テストを追加。fixture（`baseGroup` 等）に `defaultSeatsPerTable: 9` を補完 |
| [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) | UPDATE | `setDefaultSeatsPerTable` の owner / organizer / member / 範囲外 各ケース追加。`makeGroup()` fixture に `defaultSeatsPerTable: 9` を補完 |
| [scripts/test-rules-default-seats.mjs](../../../scripts/test-rules-default-seats.mjs) | CREATE | rules emulator スクリプト。`test-rules-finished-count.mjs` をベースに 9 ケース実装 |
| [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | UPDATE | 「単一フィールドの書込経路を限定するルール」節（`finishedTournamentCount` の項）に **`defaultSeatsPerTable` の書込経路は `setDefaultSeatsPerTable()` 1 系統のみ** を追記。rule 側の `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + range 制約も明記 |
| [.claude/rules/group-membership.md](../../rules/group-membership.md) | UPDATE | データモデル節の `groups/{gid}` フィールド一覧に `defaultSeatsPerTable` を追加。権限マトリクスに「デフォルト席数の参照（全ロール）/ 修正（owner / organizer のみ）」を追加。Phase 4.16 既知のセキュリティリスクの議論と同型で「organizer による任意値書換は実害ほぼなし（`/tournaments/new` の初期値のみ）」を追記 |
| [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) | UPDATE | Phase 4.17 として進捗表に 1 行追加（`pending` → 実装後に `complete`）。Phase 5 ブロッカーには含めない（Phase 4.16 と同方針）。Phase Details 節にも同様の段落を追加 |
| [src/components/tournament/TournamentForm.tsx](../../../src/components/tournament/TournamentForm.tsx) | NO CHANGE | `initialSeatsPerTable` prop は既存対応済み。`undefined` のとき `DEFAULT_SEATS_PER_TABLE = 9` にフォールバックする既存コードがそのまま機能する |
| [src/app/tournaments/[tid]/edit/tournament-edit-client.tsx](../../../src/app/tournaments/%5Btid%5D/edit/tournament-edit-client.tsx) | NO CHANGE | 編集画面は既にトーナメント自身の `seatsPerTable` を渡しているためサークル既定値の影響を受けない |

## NOT Building

- **既存 group の backfill（自動）**: 9 が default として hydrate されるので一律バックフィルは不要。明示的に変更したいサークルだけ詳細画面で値を入れる。
- **TournamentForm 自体の挙動変更**: `initialSeatsPerTable` の取り回しは既存どおり。プリセット渡しに使う side だけが本プランの責務。
- **`/tournaments/[tid]/edit` 編集画面でのデフォルト適用**: 編集画面は対象トーナメント自身の `seatsPerTable` を保持する。サークル既定値の変更が遡って反映されるとデータ破壊になる。
- **テーブル数（`tablesCount`）のサークル既定値**: 卓数は人数÷席数で運用上自動算出されるため別フィールド化しない。
- **席数 default のロール別表示**: 一般メンバーには「ロール非依存で値を表示・編集ボタンを出さない」既存パターンを踏襲。値そのものを member に隠す要件はない。
- **修正履歴（audit log）**: 誰がいつ何に変更したかは保持しない。Phase 4.16 と同方針。
- **Cloud Functions 化（任意値書換の rule 側強化）**: 任意整数値の writable は Phase 4.16 で受容済み。`/tournaments/new` の初期値しか影響を受けず実害が軽微なので、本プランも rule + service の二重防御止まり。
- **複数同時 edit の楽観排他**: 短期間に owner / organizer 同士で同フィールドを連続編集した場合、後勝ちを許容する（Firestore のデフォルト挙動）。
- **モバイルでの数値スピナー独自実装**: HTML5 `<input type="number" min={2} max={10}>` の標準挙動に任せる。
- **i18n / 多言語化**: CLAUDE.md の言語規約に従い日本語固定で実装。

---

## Step-by-Step Tasks

### Task 1: schema 拡張 — `defaultSeatsPerTable` を additive 追加

- **ACTION**: [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) の `groupBodySchema` の `finishedTournamentCount` 行の**直後**に新フィールドを追加。
- **IMPLEMENT**:
  ```typescript
  // 既存（Phase 4.16）
  finishedTournamentCount: z.number().int().nonnegative().default(0),
  // 追加（本プラン）
  // Phase 4.17: トーナメント新規作成時の `seatsPerTable` 初期値。サークル詳細画面の inline edit
  //   から organizer 以上が更新する。値域は src/lib/firebase/schemas/tournament.ts の
  //   `seatsPerTable.min(2).max(10)` と完全一致させる（DRIFT WARNING: tournaments の
  //   seatsPerTable / players seatNum 上限 10 と連動。同時に変更）。
  //   旧 doc（Phase 4.16 以前）は default(9) で受容され、未明示なら 9 として hydrate される。
  defaultSeatsPerTable: z.number().int().min(2).max(10).default(9),
  ```
- **MIRROR**: NAMING_CONVENTION セクション（`audioSettings` / `finishedTournamentCount` と同列で additive に追加）
- **IMPORTS**: 既存の `import { z } from "zod";` で十分。新規 import なし。
- **GOTCHA**:
  - `.refine(...)` チェーンが既に 2 段ある。`defaultSeatsPerTable` は invariants と無関係なので refine の追加は不要。
  - `.default(9)` を付けることで `groupBodySchema.parse(legacyDoc)` が通る（converters.ts が `fromFirestore` で zod parse する経路）。
  - `default(9)` の数値は `src/components/tournament/TournamentForm.tsx:35` の `DEFAULT_SEATS_PER_TABLE = 9` と必ず一致させる。
- **VALIDATE**:
  - Task 7 の schema test 5 ケースが通る
  - `pnpm typecheck` で `GroupBody` / `GroupDoc` 型が `defaultSeatsPerTable: number` を持つこと
  - `useCurrentGroup` の `groups` 配列の各要素にも自動で `defaultSeatsPerTable` が露出する

### Task 2: repository に `updateDefaultSeatsPerTable` を追加

- **ACTION**: [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) の `updateFinishedTournamentCount`（L245-267）の**直後**に新関数を追加。
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase 4.17: groups/{gid}.defaultSeatsPerTable を 2..10 の整数値で上書きする。
   *   - サークル詳細画面 inline edit からのみ呼ばれる（organizer / owner 限定）。
   *   - rule は `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + `>= 2` + `<= 10` で
   *     他フィールド汚染を deny。
   *   - 値の範囲は本関数の事前チェックで二重防御し、UI バリデーション失敗時の Firestore 余計な
   *     write を抑止する。
   */
  export async function updateDefaultSeatsPerTable(
    gid: string,
    value: number,
  ): Promise<void> {
    if (!Number.isInteger(value) || value < 2 || value > 10) {
      throw new AppError(
        "デフォルト席数は 2 以上 10 以下の整数で指定してください",
        "validation/default-seats-invalid",
      );
    }
    try {
      await updateDoc(groupDocRef(gid), { defaultSeatsPerTable: value });
      logger.info("group defaultSeatsPerTable updated", { gid, value });
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "デフォルト席数の更新に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code, gid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: ERROR_HANDLING / LOGGING_PATTERN（`updateFinishedTournamentCount` と完全に同形）
- **IMPORTS**: 既存どおり（`updateDoc` / `groupDocRef` / `AppError` / `logger` は既に import 済み）
- **GOTCHA**:
  - **`Number.isInteger(5.5)` は false**（小数点付きは弾かれる）。`Number.isInteger(NaN)` も false。
  - logger の `value` は数値そのまま出してよい（PII でない）。`gid` は短いので暴露しても安全。
  - メッセージとコード文字列は AppError 規約（`.claude/rules/error-logging.md`）に従い `firestore/write_failed` 系を使い回す。
- **VALIDATE**:
  - Task 8 の repository test（happy path / 範囲外 / Firestore reject）が通る
  - typecheck で関数シグネチャが `(gid: string, value: number) => Promise<void>` であること

### Task 3: service に `setDefaultSeatsPerTable` を追加

- **ACTION**: [src/lib/services/group.ts](../../../src/lib/services/group.ts) の `setFinishedTournamentCount`（L292-311）の**直後**に新関数を追加。
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase 4.17: デフォルト席数（defaultSeatsPerTable）を手動補正する。owner / organizer 限定。
   *   サークル詳細画面の inline edit から呼ばれる。
   *   rule 側でも organizer-only branch で再 enforce する。
   */
  export async function setDefaultSeatsPerTable({
    gid,
    uid,
    value,
  }: {
    gid: string;
    uid: string;
    value: number;
  }): Promise<void> {
    if (!Number.isInteger(value) || value < 2 || value > 10) {
      throw new AppError(
        "デフォルト席数は 2 以上 10 以下の整数で指定してください",
        "validation/default-seats-invalid",
      );
    }
    const group = await getGroup(gid);
    assertOrganizer(group, uid);
    await updateDefaultSeatsPerTable(gid, value);
    logger.info("setDefaultSeatsPerTable ok", { gid, uid, value });
  }
  ```
- **MIRROR**: SERVICE_PATTERN（`setFinishedTournamentCount` と完全に同形）
- **IMPORTS**:
  - 関数 `updateDefaultSeatsPerTable` を `@/lib/firebase/repositories/groups` の named import に追加（既存の `updateFinishedTournamentCount` の隣）
  - `assertOrganizer` / `getGroup` / `AppError` / `logger` は既に import 済み
- **GOTCHA**:
  - service 層で値域チェックする理由: rule で deny される前に明示的な AppError を上げることで UI が正確なメッセージを出せる（rule deny だと `firestore/permission-denied` の汎用エラーになる）。
  - `assertOrganizer(group, uid)` は owner / organizer の両方を allow する（Phase 4.6 で確立）。member は `AppError("group/forbidden")` で reject。
- **VALIDATE**:
  - Task 9 の service test（owner / organizer / member / 範囲外）が通る
  - typecheck で関数シグネチャが `({ gid: string; uid: string; value: number }) => Promise<void>` であること

### Task 4: Firestore Rules に `defaultSeatsPerTable` 専用 branch を追加

- **ACTION**: [firestore.rules:194-207](../../../firestore.rules#L194-L207) の `finishedTournamentCount` branch の **直後** に OR で 1 件追加。
- **IMPLEMENT**:
  ```firestore-rules
  ) || (
    // Phase 4.17: organizer による defaultSeatsPerTable の単独書換。
    //   サークル詳細画面 inline edit から `setDefaultSeatsPerTable({ gid, uid, value })` 経由で発火。
    //   affectedKeys は 'defaultSeatsPerTable' のみに限定。他フィールドは触らせない。
    //   値域 2..10 は src/lib/firebase/schemas/tournament.ts の seatsPerTable.min(2).max(10) と
    //   厳密一致させる（DRIFT WARNING: tournaments seatsPerTable / players seatNum 上限と連動）。
    //   organizer は元々サークルの全 CRUD を持つ信頼ロールのため、空値書込のリスクは許容範囲。
    isOrganizer(gid)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['defaultSeatsPerTable'])
    && request.resource.data.defaultSeatsPerTable is int
    && request.resource.data.defaultSeatsPerTable >= 2
    && request.resource.data.defaultSeatsPerTable <= 10
  );
  ```
  最終 `;` は今までの最後の branch（`finishedTournamentCount`）に付いていたものを移動して付け替えること。
- **MIRROR**: FIRESTORE_RULE_PATTERN（Phase 4.16 で追加された `finishedTournamentCount` branch）。`affectedKeys().hasOnly([...])` で atomic に変更可能フィールドを限定。
- **IMPORTS**: なし（rule helper `isOrganizer(gid)` は既に定義済み）
- **GOTCHA**:
  - **owner は既存 owner branch（`firestore.rules:85-91`）でフリーパス**、本 branch を経由しなくても更新できる。重複は問題なし（OR 評価）。
  - self-* update 分岐（`affectedKeys().hasOnly([...])` で `memberDisplayNames` 等のみ許可）は **`defaultSeatsPerTable` を含まない**ので、member が self-key 経路で改竄しようとしても deny される。Phase 4.16 で同方針で確認済み。
  - rule のデプロイは `firebase deploy --only firestore:rules`。エミュレータで先に Task 10 のスクリプトでテストすること（[.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) 規約）。
  - 範囲 `2..10` を逸脱した値は service 層で先に弾かれるが、rule 側でも独立にチェックする。攻撃者が service を迂回して直接 `updateDoc` を叩いた場合の保険。
- **VALIDATE**: Task 10 の emulator script で 9 ケース全てが意図した allow / deny を返すこと

### Task 5: 新規作成画面で `defaultSeatsPerTable` を流し込む

- **ACTION**: [src/app/tournaments/new/tournament-new-client.tsx](../../../src/app/tournaments/new/tournament-new-client.tsx) で `useCurrentGroup().groups` から `defaultSeatsPerTable` を派生し、`<TournamentForm>` の `initialSeatsPerTable` prop に渡す。
- **IMPLEMENT**:
  ```typescript
  // Phase 4.17: サークル設定の `defaultSeatsPerTable` を新規作成画面の初期値として流し込む。
  //   `useCurrentGroup` が既に `groups` を fetch 済みのため追加 read は不要。legacy doc（未設定）
  //   は zod default で 9 として hydrate されるため undefined はほぼ発生しないが、
  //   コンテキストから group が見つからないケース（race / 切替直後）に備えて undefined を許容する。
  const defaultSeatsPerTable = useMemo(() => {
    if (!currentGroupId) return undefined;
    const g = groups.find((x) => x.id === currentGroupId);
    return g?.defaultSeatsPerTable;
  }, [currentGroupId, groups]);
  ```
  そして `<TournamentForm>` 呼出に prop を 1 行追加:
  ```tsx
  <TournamentForm
    groupId={currentGroupId}
    initialName={defaultName}
    initialSeatsPerTable={defaultSeatsPerTable}  // ← Phase 4.17 追加
    onSubmit={async ({ name, snapshot, seatsPerTable }) => {
      ...
    }}
    ...
  />
  ```
- **MIRROR**: REACT_HOOK_PATTERN（Phase 4.16 の `defaultName` 派生と同形）
- **IMPORTS**: `useMemo` は既に Phase 4.16 で import 済み。新規 import なし。
- **GOTCHA**:
  - `TournamentForm` 内部は `useState(initialSeatsPerTable ?? DEFAULT_SEATS_PER_TABLE)` で初期化されるため、**`initialSeatsPerTable` が後から変わっても入力欄には反映されない**（[TournamentForm.tsx:61-63](../../../src/components/tournament/TournamentForm.tsx#L61-L63)）。Phase 4.16 で `initialName` について同じ問題を確認済み。
  - `if (!user || !currentGroupId) return null;` のガード（[tournament-new-client.tsx:35](../../../src/app/tournaments/new/tournament-new-client.tsx#L35)）と `loading` ガード（L36-38）が **`groups` ロード前は描画させない順序**を保証している。Phase 4.17 では追加修正不要。
  - `g?.defaultSeatsPerTable` は schema の `default(9)` で常に number として hydrate されるため、実運用で undefined になるのは「currentGroupId と groups の race」のような一瞬のみ。`undefined` を渡せば TournamentForm 側が `DEFAULT_SEATS_PER_TABLE = 9` にフォールバックするので問題なし。
- **VALIDATE**:
  - 手動: サークル A（`defaultSeatsPerTable: 6` 設定済み）で `/tournaments/new` を開き、席数欄に `6` がプリセット
  - 手動: サークル B（未設定）で `/tournaments/new` を開き、席数欄に `9` がプリセット（schema default）
  - 手動: 入力欄を編集して `8` に → onChange は破壊しない（既存挙動の維持）
  - typecheck: `groups` が `GroupDoc[]` で `defaultSeatsPerTable: number` を持つこと

### Task 6: サークル詳細画面に「デフォルト席数」カードを追加

- **ACTION**: [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) で「開催数」カード（L406-467）の**直後**に新カードを追加。state / handler / Card JSX をそれぞれセットで追加する。
- **IMPLEMENT**:
  - **追加 state**（L80-82 付近、`editingCount` ペアの直後）:
    ```typescript
    const [editingSeats, setEditingSeats] = useState(false);
    const [seatsValue, setSeatsValue] = useState<string>("9");
    const seatsInputRef = useRef<HTMLInputElement | null>(null);
    ```
  - **追加 handler**（L231-270 付近、`startEditingCount` / `cancelEditingCount` / `onSaveCount` の隣）:
    ```typescript
    function startEditingSeats() {
      if (!group) return;
      setSeatsValue(String(group.defaultSeatsPerTable ?? 9));
      setEditingSeats(true);
      requestAnimationFrame(() => {
        seatsInputRef.current?.focus();
        seatsInputRef.current?.select();
      });
    }

    function cancelEditingSeats() {
      setEditingSeats(false);
      setSeatsValue(String(group?.defaultSeatsPerTable ?? 9));
    }

    async function onSaveSeats(e: React.FormEvent) {
      e.preventDefault();
      if (!user || !group) return;
      const parsed = Number(seatsValue);
      if (!Number.isInteger(parsed) || parsed < 2 || parsed > 10) {
        setError("validation/default-seats-invalid: デフォルト席数は 2 以上 10 以下の整数で指定してください");
        return;
      }
      if (parsed === (group.defaultSeatsPerTable ?? 9)) {
        setEditingSeats(false);
        return;
      }
      setWorking(true);
      try {
        await setDefaultSeatsPerTable({ gid, uid: user.uid, value: parsed });
        setEditingSeats(false);
        await reload();
        await refreshGroups();
      } catch (e) {
        const wrapped = AppError.from(e, "group/default-seats-failed", "デフォルト席数の更新に失敗しました");
        setError(`${wrapped.code}: ${wrapped.message}`);
      } finally {
        setWorking(false);
      }
    }
    ```
  - **追加 JSX**（L467 直後、「開催数」Card の閉じタグ直後）:
    ```tsx
    <Card>
      <CardHeader>
        <CardTitle>1 Table あたりの席数（デフォルト）</CardTitle>
        <CardDescription>
          新規トーナメント作成時の「1 Table あたりの席数」初期値（2〜10）。
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isOrganizer && editingSeats ? (
          <form onSubmit={onSaveSeats} className="flex flex-wrap items-center gap-2">
            <Input
              ref={seatsInputRef}
              type="number"
              min={2}
              max={10}
              step={1}
              value={seatsValue}
              onChange={(e) => setSeatsValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault();
                  cancelEditingSeats();
                }
              }}
              aria-label="1 Table あたりの席数（デフォルト）"
              disabled={working}
              className="h-10 w-32 text-base"
            />
            <span className="text-sm text-muted-foreground">席</span>
            <Button type="submit" size="sm" disabled={working}>
              {working ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={cancelEditingSeats}
              disabled={working}
            >
              キャンセル
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-base">
              <span className="font-semibold">{group.defaultSeatsPerTable ?? 9}</span> 席
            </p>
            {isOrganizer ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={startEditingSeats}
                aria-label="デフォルト席数を変更"
              >
                <Pencil className="h-4 w-4" aria-hidden /> 変更
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
    ```
- **MIRROR**: UI_INLINE_EDIT_PATTERN（Phase 4.16 の「開催数」カード全体構造）
- **IMPORTS**:
  - `setDefaultSeatsPerTable` を `@/lib/services/group` の named import に追加（既存の `setFinishedTournamentCount` の隣）
  - `Pencil` / `Card` / `Input` / `Button` 等は既に import 済み（同 file の他カードで利用中）
- **GOTCHA**:
  - **`isOrganizer` は同 file 内で既に算出済み**（Phase 4.16 で `myRole === "owner" || myRole === "organizer"` のローカル変数として導出）。再算出しない。
  - 「同値で submit すれば noop で閉じる」挙動は `parsed === (group.defaultSeatsPerTable ?? 9)` で再現（Phase 4.16 と同型）。
  - エラー文字列の prefix `validation/default-seats-invalid:` / `group/default-seats-failed:` は `setError` で UI に表示される（既存パターン）。コードと文言は service 層と完全一致させる。
  - `Esc` キーで cancel する `onKeyDown` も Phase 4.16 と同型で必須。
  - 同 file 内に既存の error / working state は使い回す（追加 state は不要）。
- **VALIDATE**:
  - 手動: owner として開く → 「デフォルト席数」カードに `9 席` + `[ ✎ 変更 ]` ボタン表示
  - 手動: 「変更」クリック → input にフォーカス + 全選択、`6` 入力 → `保存` で `6 席` に表示更新
  - 手動: `1` を入れて保存 → AppError `validation/default-seats-invalid: ...` がカード内に表示
  - 手動: `Esc` で cancel すると元の値に戻る
  - 手動: 同値で submit すると即 close（service 呼出なし）
  - 手動: organizer / member の表示差異が正しい（organizer は編集ボタンあり、member は値表示のみ）

### Task 7: schema test を 5 ケース追加

- **ACTION**: [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) の `describe("groupBodySchema")` 内、`finishedTournamentCount` テスト群の**直後**に追加。
- **IMPLEMENT**: TEST_STRUCTURE セクションのスニペット 5 ケースをそのまま追加。`now` / `groupBodySchema` は既に import 済み。
- **MIRROR**: TEST_STRUCTURE（`finishedTournamentCount` の追加テストと同形）
- **IMPORTS**: 既存どおり（変更なし）
- **GOTCHA**: `Phase 4.17: ...` のような phase ラベルは付けず、簡潔に意図がわかる it 名にする（Phase 4.16 と同方針）。
- **VALIDATE**: `pnpm test schemas/index.test.ts` で 5 ケース pass

### Task 8: repository test を 3 系統追加

- **ACTION**: [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) の `describe("updateFinishedTournamentCount")` の**直後**に `describe("updateDefaultSeatsPerTable")` を追加。
- **IMPLEMENT**: 以下 3 系統:
  ```typescript
  describe("updateDefaultSeatsPerTable", () => {
    beforeEach(() => {
      vi.mocked(updateDoc).mockReset();
    });

    it("calls updateDoc with { defaultSeatsPerTable: value } for valid integers in [2,10]", async () => {
      vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
      await updateDefaultSeatsPerTable("g1", 6);
      const call = vi.mocked(updateDoc).mock.calls[0];
      expect(call[1]).toEqual({ defaultSeatsPerTable: 6 });
    });

    it.each([1, 11, 0, -1, 5.5, NaN, Infinity])(
      "rejects %p with validation/default-seats-invalid",
      async (bad) => {
        await expect(updateDefaultSeatsPerTable("g1", bad as number)).rejects.toMatchObject({
          code: "validation/default-seats-invalid",
        });
        expect(updateDoc).not.toHaveBeenCalled();
      },
    );

    it("wraps Firestore reject as firestore/write_failed", async () => {
      vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
      await expect(updateDefaultSeatsPerTable("g1", 6)).rejects.toMatchObject({
        code: "firestore/write_failed",
      });
    });
  });
  ```
- **MIRROR**: REPOSITORY_TEST_PATTERN（既存 `updateFinishedTournamentCount` テストと同型）
- **IMPORTS**: `updateDefaultSeatsPerTable` を `@/lib/firebase/repositories/groups` の named import に追加（既存の `updateFinishedTournamentCount` の隣）
- **GOTCHA**:
  - 既存 `baseGroup` などの fixture（`makeGroup` 等）に `defaultSeatsPerTable: 9` の補完が必要かどうかは fixture 定義箇所による。schema が `default(9)` を持つので zod 経由なら自動補完されるが、**素のオブジェクトを `GroupDoc` キャストで使っている fixture** があれば型エラーになるため明示的に `defaultSeatsPerTable: 9` を入れる。
  - `it.each` で範囲外バリデーションを 7 値で網羅。`5.5` は非整数、`NaN` / `Infinity` は `Number.isInteger` で false。
- **VALIDATE**: `pnpm test repositories/groups.test.ts` で全 pass

### Task 9: service test を owner / organizer / member 全パターンで追加

- **ACTION**: [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) の `describe("setFinishedTournamentCount")` の**直後**に `describe("setDefaultSeatsPerTable")` を追加。
- **IMPLEMENT**:
  ```typescript
  describe("setDefaultSeatsPerTable", () => {
    beforeEach(() => {
      vi.mocked(getGroup).mockReset();
      vi.mocked(updateDefaultSeatsPerTable).mockReset();
    });

    it("allows owner to set value", async () => {
      vi.mocked(getGroup).mockResolvedValueOnce(makeGroup({ ownerUids: ["u1"], organizerUids: ["u1"], memberUids: ["u1"] }));
      vi.mocked(updateDefaultSeatsPerTable).mockResolvedValueOnce(undefined);
      await setDefaultSeatsPerTable({ gid: "g1", uid: "u1", value: 6 });
      expect(updateDefaultSeatsPerTable).toHaveBeenCalledWith("g1", 6);
    });

    it("allows organizer (non-owner) to set value", async () => {
      vi.mocked(getGroup).mockResolvedValueOnce(makeGroup({ ownerUids: ["u1"], organizerUids: ["u1", "u2"], memberUids: ["u1", "u2"] }));
      vi.mocked(updateDefaultSeatsPerTable).mockResolvedValueOnce(undefined);
      await setDefaultSeatsPerTable({ gid: "g1", uid: "u2", value: 8 });
      expect(updateDefaultSeatsPerTable).toHaveBeenCalledWith("g1", 8);
    });

    it("rejects member with group/forbidden", async () => {
      vi.mocked(getGroup).mockResolvedValueOnce(makeGroup({ ownerUids: ["u1"], organizerUids: ["u1"], memberUids: ["u1", "u2"] }));
      await expect(setDefaultSeatsPerTable({ gid: "g1", uid: "u2", value: 6 })).rejects.toMatchObject({
        code: "group/forbidden",
      });
      expect(updateDefaultSeatsPerTable).not.toHaveBeenCalled();
    });

    it.each([1, 11, 5.5, -1])(
      "rejects out-of-range value %p before fetching group",
      async (bad) => {
        await expect(
          setDefaultSeatsPerTable({ gid: "g1", uid: "u1", value: bad as number }),
        ).rejects.toMatchObject({
          code: "validation/default-seats-invalid",
        });
        expect(getGroup).not.toHaveBeenCalled();
        expect(updateDefaultSeatsPerTable).not.toHaveBeenCalled();
      },
    );
  });
  ```
- **MIRROR**: SERVICE_TEST_PATTERN（`setFinishedTournamentCount` テストと同型）
- **IMPORTS**:
  - `setDefaultSeatsPerTable` を `@/lib/services/group` の named import に追加
  - `updateDefaultSeatsPerTable` を `@/lib/firebase/repositories/groups` の named import に追加（vi.mock 対象）
- **GOTCHA**:
  - `makeGroup()` fixture が `defaultSeatsPerTable` を持っていないと型エラー。fixture 定義に `defaultSeatsPerTable: 9` を補完する。
  - `setFinishedTournamentCount` テストの `vi.mock("@/lib/firebase/repositories/groups", ...)` の named imports リストに `updateDefaultSeatsPerTable: vi.fn()` を追加する必要があるかどうか確認（既存のモック方法に依存）。
  - 早期 validation チェックは `getGroup` の前に実行されるため、`getGroup.not.toHaveBeenCalled()` を assert することで service 層の責務分離を保証する。
- **VALIDATE**: `pnpm test services/group.test.ts` で全 pass

### Task 10: rules emulator script を新規作成

- **ACTION**: [scripts/test-rules-default-seats.mjs](../../../scripts/test-rules-default-seats.mjs) を新規作成。`scripts/test-rules-finished-count.mjs` をベースとして以下のケースを実装する。
- **IMPLEMENT**: 9 ケース（EMULATOR_SCRIPT_PATTERN セクション参照）。`expectAllow` / `expectDeny` ヘルパーは流用。
  - Setup: 2 ユーザー（organizer / member）+ 1 group（`ownerUids: [owner]`, `organizerUids: [owner, organizer]`, `memberUids: [owner, organizer, member]`）を作る
  - Case 1〜3: organizer が `defaultSeatsPerTable: 6 / 2 / 10` → allow
  - Case 4〜5: organizer が `defaultSeatsPerTable: 1 / 11` → deny（範囲）
  - Case 6: organizer が `{ defaultSeatsPerTable: 6, name: "x" }` 同時書込 → deny（affectedKeys）
  - Case 7: member が `defaultSeatsPerTable: 6` → deny（権限）
  - Case 8: owner がフル update（`{ name: "newname", defaultSeatsPerTable: 6 }`）→ allow（owner branch）
  - Case 9: legacy doc（フィールドなし）に対し organizer が `defaultSeatsPerTable: 6` → allow
- **MIRROR**: EMULATOR_SCRIPT_PATTERN（`test-rules-finished-count.mjs`）
- **IMPORTS**: なし（mjs script は既存のヘルパーを再利用）
- **GOTCHA**:
  - emulator は手元にデプロイされた `firestore.rules` を読むので、Task 4 の rule 修正後でないと意味がない。先に Task 4 を完了させる。
  - 実行コマンドは `firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-default-seats.mjs"`（Phase 4.16 README 手順を踏襲）。`firebase` CLI が必要。
  - `expectAllow` / `expectDeny` の判定は HTTP status の 200 / 403 で行う（既存実装どおり）。
- **VALIDATE**: スクリプトが終了コード 0 で終わる（全 9 ケース pass）

### Task 11: ルールファイル / PRD / docs 更新

- **ACTION**: 以下 3 ファイルを更新。
  1. [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) — 「単一フィールドの書込経路を限定するルール」節（`finishedTournamentCount` の項）の隣に **`defaultSeatsPerTable` の書込経路は `setDefaultSeatsPerTable() → updateDefaultSeatsPerTable()` 1 系統のみ** を追記。rule 側の制約も明記。
  2. [.claude/rules/group-membership.md](../../rules/group-membership.md) — データモデル節の `groups/{gid}` フィールド一覧に `defaultSeatsPerTable` を追加。権限マトリクスに「デフォルト席数の参照（全ロール）/ 修正（owner / organizer のみ）」行を追加。「既知のセキュリティリスク」節に Phase 4.16 と同型で「organizer による任意値書換は実害ほぼなし（`/tournaments/new` の初期値のみ・卓数 / 賞金 / 集計に波及せず）」を追加。
  3. [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) — `## Implementation Phases` 表に Phase 4.17 行を 4.16 の直後に追加（Status: `pending` / Parallel: `with 4.10` / Depends: `4.16` / PRP Plan: 本ファイルへの相対リンク）。`### Phase Details` 節にも Phase 4.16 と同型で goal / 背景 / Scope / Success signal を 1 段落追加。Phase 4 Dependencies 節（L578-590）に「Phase 4.17 は Phase 4.16 後に単独実施。**schema は additive**」の注記を追加。**Phase 5 ブロッカーには含めない**（Phase 4.16 と同方針）。
- **IMPLEMENT**: 各ファイルの該当箇所に文言追記。フォーマットは Phase 4.16 完了時の状態と完全に揃える（参考: `git log --oneline | head -10`）。
- **MIRROR**: Phase 4.16 plan の Task 11（同型 docs 更新）
- **IMPORTS**: なし
- **GOTCHA**:
  - PRD の Phase 進捗表は表形式の単一行 markdown。改行なしの 1 行で書き、長くなりすぎないようにする（Phase 4.16 が手本）。
  - `.claude/rules/group-membership.md` のデータモデル節にフィールドを 1 行追加するときは、Phase 番号（Phase 4.17）とデフォルト値（9）を明記する。
  - `firebase-patterns.md` の「単一フィールドの書込経路を限定するルール」節タイトルは Phase 4.16 で `finishedTournamentCount` 専用に書かれているため、複数フィールド対応に書き換える（例: 「単一フィールド単独書換の rule 経路（Phase 4.16〜）」 → 「単一フィールド単独書換の rule 経路（Phase 4.16 以降の polish 系列）」）。
- **VALIDATE**: 該当箇所の文言が Phase 4.16 と同型で追記されていること（review 時に視認）。

### Task 12: 動作確認 / 検証ループ

- **ACTION**: 以下を順に実行し全部 green であることを確認。
  - `pnpm typecheck` — 型エラーなし
  - `pnpm lint` — lint エラーなし
  - `pnpm test` — 全 unit test pass
  - `pnpm build` — Next.js build 成功
  - emulator: `firebase emulators:exec --only auth,firestore --project <project-id> "node scripts/test-rules-default-seats.mjs"` で 9 ケース全部 pass
  - 手動ブラウザ:
    - サークル詳細画面 owner / organizer / member の 3 視点で「デフォルト席数」カードの表示・編集が仕様どおり
    - サークル A（`defaultSeatsPerTable: 6` 設定）で `/tournaments/new` を開くと席数欄が `6`
    - サークル B（未設定）で `/tournaments/new` を開くと席数欄が `9`
    - 範囲外値（`1` / `11`）を inline edit で入れると AppError 文言が表示される
    - 既存 `/tournaments/[tid]/edit` 画面は変更なし（regression なし）
- **IMPLEMENT**: コマンド実行のみ
- **MIRROR**: Phase 4.16 plan の Validation Commands
- **IMPORTS**: なし
- **GOTCHA**:
  - `pnpm test` が emulator を要求しない構成（Vitest mock）であることを既存 group.test.ts で確認済み。本タスクの test もすべて `firebase/firestore` mock で完結する。
  - `firebase deploy --only firestore:rules` は手動で実行する（README 手順）。本プランは local-only emulator 検証で完結し、本番デプロイは PR レビュー後に運営者が行う。
- **VALIDATE**: 全コマンド終了コード 0、手動確認チェックリスト全項目 OK

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| schema: legacy doc default | フィールド未定義 | `defaultSeatsPerTable === 9` | Yes（migration なし） |
| schema: explicit valid | `defaultSeatsPerTable: 6` | parse 成功・値保持 | No |
| schema: out-of-range low | `defaultSeatsPerTable: 1` | parse 失敗 | Yes（境界） |
| schema: out-of-range high | `defaultSeatsPerTable: 11` | parse 失敗 | Yes（境界） |
| schema: non-integer | `defaultSeatsPerTable: 5.5` | parse 失敗 | Yes |
| repo: valid integer | `updateDefaultSeatsPerTable("g1", 6)` | `updateDoc({ defaultSeatsPerTable: 6 })` 1 回 | No |
| repo: out-of-range | `updateDefaultSeatsPerTable("g1", 1\|11\|5.5)` | `AppError("validation/default-seats-invalid")` | Yes |
| repo: Firestore reject | `updateDoc.mockReject(...)` | `AppError("firestore/write_failed")` | Yes |
| service: owner | owner uid | repository 呼出 | No |
| service: organizer | organizer uid | repository 呼出 | No |
| service: member | member uid | `AppError("group/forbidden")`、repo 呼ばれず | Yes |
| service: out-of-range early | `value: 1` | `AppError("validation/default-seats-invalid")`、`getGroup` 呼ばれず | Yes |

### Edge Cases Checklist

- [x] フィールド未定義 legacy doc（schema default で 9 補完）
- [x] 値域境界（min=2 / max=10 で allow、1 / 11 で deny）
- [x] 非整数（5.5）
- [x] NaN / Infinity
- [x] 同値 submit（noop で close）
- [x] 範囲外値の inline edit（AppError 文言表示、Firestore に到達せず）
- [x] member ロールの編集試行（UI に編集ボタン非表示・rule で deny）
- [x] currentGroupId / groups の race（`undefined` で TournamentForm の `?? 9` フォールバック）
- [x] 編集中に Esc キャンセル
- [x] schema validation を迂回した攻撃（rule で deny）
- [x] 他フィールド汚染を狙った同時 update（`affectedKeys().hasOnly` で deny）
- [ ] 賞金計算 / 集計への波及 — **対象外**（NOT Building 参照）

---

## Validation Commands

### Static Analysis

```bash
pnpm typecheck
```

EXPECT: Zero type errors（`GroupDoc` に `defaultSeatsPerTable: number` が露出、`TournamentNewClient` が `initialSeatsPerTable` prop を渡している）

### Lint

```bash
pnpm lint
```

EXPECT: lint エラーなし

### Unit Tests

```bash
pnpm test
```

EXPECT: 全 unit test pass（schema / repository / service / 既存テスト含めて regression なし）

### Build

```bash
pnpm build
```

EXPECT: Next.js build 成功

### Rules Emulator Validation

```bash
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-default-seats.mjs"
```

EXPECT: スクリプト終了コード 0（9 ケース全部 expected allow / deny）

### Browser Validation（Manual）

- [ ] サークル A（owner）で `/groups/[gid]` を開き「デフォルト席数」カードに `9 席`（既定） + 「変更」ボタンが表示
- [ ] 「変更」をクリック → input にフォーカス + 全選択、`6` に変更 → `保存` クリックで `6 席` に表示更新
- [ ] サークル A で `/tournaments/new` を開くと席数欄が `6`
- [ ] サークル B（未設定）で `/tournaments/new` を開くと席数欄が `9`
- [ ] サークル A の inline edit に `1` を入れて保存 → カード内に `validation/default-seats-invalid: ...` のエラー文言
- [ ] `Esc` キーで cancel すると元の値に戻る
- [ ] 同値（`6` のまま）で保存すると noop で close（network log で `updateDoc` が呼ばれていない）
- [ ] organizer（非 owner）で同操作を実行できる
- [ ] member で開くと「デフォルト席数」カードに値表示のみで編集ボタンは出ない
- [ ] 既存 `/tournaments/[tid]/edit` 画面は変更なし（席数欄が対象トーナメントの値を維持）

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation commands pass
- [ ] schema / repository / service / rules emulator のテスト追加と pass
- [ ] 型エラーなし、lint エラーなし
- [ ] 手動ブラウザ確認で UX 設計と一致
- [ ] PRD の Phase 進捗表が `complete` に更新される（実装完了時）
- [ ] `.claude/rules/firebase-patterns.md` / `group-membership.md` の追記が完了

## Completion Checklist

- [ ] Phase 4.16 の `finishedTournamentCount` パターンと完全対称な実装になっている
- [ ] error wrap / logger 出力が `.claude/rules/error-logging.md` 規約に準拠
- [ ] AppError ドメインコード（`validation/default-seats-invalid` / `firestore/write_failed` / `group/forbidden` / `group/default-seats-failed`）が一貫している
- [ ] テストが TEST_STRUCTURE / REPOSITORY_TEST_PATTERN / SERVICE_TEST_PATTERN を mirror
- [ ] rule の `affectedKeys().hasOnly([...])` + 値域制約が他フィールド汚染を deny する
- [ ] schema の `default(9)` と `TournamentForm.tsx` の `DEFAULT_SEATS_PER_TABLE = 9` が一致
- [ ] schema の `min(2).max(10)` と `tournament.ts` の `seatsPerTable.min(2).max(10)` が一致
- [ ] PRD の Phase 4.17 行が追加され Phase 5 ブロッカーから除外されている
- [ ] `git diff` で `.env` / API key / 招待コード等の機密が漏れていない（`.claude/rules/security.md` 規約）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| schema の値域 drift（group.defaultSeatsPerTable と tournament.seatsPerTable が独立に変化） | Low | Medium | DRIFT WARNING コメントを schema / rule の両方に明記。範囲を変える場合は両方同時。 |
| 旧クライアント（Phase 4.16 以前）が新フィールドの存在を知らずに動作 | Low | Low | schema additive + zod default で legacy doc を補完。旧クライアントは `defaultSeatsPerTable` を読まないので影響なし。 |
| `useCurrentGroup().groups` のロード前に `<TournamentForm>` が render されて初期値が `9` で固定される race | Low | Low | 既存ガード（`if (!user || !currentGroupId) return null;` + `loading` ガード）が `groups` ロード前は描画させない（Phase 4.16 で確認済み） |
| organizer による任意値書換の DoS / 嫌がらせ | Low | Low | rule + service 二重防御。影響範囲は `/tournaments/new` の初期値のみで、permission / billing / 集計に波及なし。Phase 4.16 と同方針で許容範囲扱い |
| inline edit の `setError` 文字列が技術的すぎてユーザーに伝わらない | Medium | Low | 「2 以上 10 以下の整数で指定してください」と日本語で説明済み。Phase 4.16 と同型 |
| seatsPerTable 上限 10 の DRIFT WARNING が将来更新され忘れる | Low | Medium | schema / rule / form / players seatNum の 4 箇所すべてに `DRIFT WARNING` コメントを残す。Grep でまとめて発見できるようにする |

## Notes

- 本プランは Phase 4.16 と完全対称な構造の polish 系列。実装工数は schema / repo / service / rules / UI / test のすべてで Phase 4.16 とほぼ同じか少し軽い（writeBatch 化のような複雑要素がない）。
- Phase 5 ブロッカーには含めない（Phase 4.16 と同方針）。Phase 5 ドライランで運営者から「6 人卓運用なのに毎回 9 を 6 に直す手間」のフィードバックが出る前に先回りで解消しておく位置づけ。
- 将来 `[サークル名]トーナメント-X` 形式と組み合わせて、サークルごとの「席数 + 命名規則」をまとめて管理する `groups/{gid}.tournamentDefaults: { seatsPerTable, namePrefix, ... }` のような統合フィールド化も考えられるが、本プランの scope 外（YAGNI）。当面は flat field でシンプルに保つ。
- audit log（誰がいつ変更したか）は本プランも非対応。Phase 4.16 で議論済みの NOT Building と同方針。
- Phase 4.17 と Phase 4.10（カスタム音源アップロード）は完全に独立で並行可能（互いに別 collection / 別関数）。PRD の進捗表 Parallel 列は `with 4.10` で問題ない。
