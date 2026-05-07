# Plan: Phase C — Table Label & Color

## Summary

トーナメント単位のテーブル呼称（`label` / `color`）を `tournaments/{tid}/tables/{n}` に additive 追加し、サークル単位のデフォルト一覧 `groups/{gid}.defaultTableLabels[]` から新規作成時に auto-fill する。SeatingBoard / BalancingInstructionCard / live-client の「Table N」表示は label が設定されていれば label を優先し、未設定時は従来通り `Table N` フォールバック。inline edit はサークル詳細画面（defaultTableLabels）と tournament dashboard（tables.label / color）の 2 か所で provide。Phase A と並列開発が可能で、Phase B と無依存（Phase D で `color` のプリセット picker を polish する想定）。

## User Story

As a サークル運営者（owner / organizer）,
I want 卓ごとに「赤卓」「青卓」「初心者卓」のような呼称を設定し、サークル全体で繰り返し使うデフォルト名を一度登録しておける,
So that 会場で複数卓を運営している最中に「Table 3 の 5 番」ではなく「赤卓の 5 番」と口頭伝達でき、誤認による席案内ミスがなくなる。

And as a サークル参加者,
I want 自分の Live 画面とテーブル一覧で表示される呼称が同じ「赤卓」になっている,
So that 運営者の口頭指示と画面の表示が一致し、自分の卓を迷わない。

## Problem → Solution

**Current state**:

- [SeatingBoard.tsx:174-176](../../../../src/components/tournament/SeatingBoard.tsx#L174-L176) は常に「Table {tableNum}」を出力し、機械的な番号でしか卓を区別できない。
- [BalancingInstructionCard.tsx:137-153](../../../../src/components/tournament/BalancingInstructionCard.tsx#L137-L153) のバランシング指示も `Table 2` のように番号のみ。
- 3 卓以上展開すると、運営者が卓カードに付箋を貼って「赤卓」「青卓」と命名してアプリと突き合わせる運用になっており、口頭伝達のロスが発生する。
- 開発者本人がサークル参加時に検証可能（PRD の検証方針 Q4 後半）。

**Desired state**:

- `tournaments/{tid}/tables/{n}.label`（カスタム文字列、未設定可）/ `.color`（`#RRGGBB` または null）を additive 追加。
- `groups/{gid}.defaultTableLabels[]`（最大 `MAX_TABLES = 6` 件、各要素 1〜`TABLE_LABEL_MAX_LENGTH` = 10 文字）をサークル単位で保持し、新規 `commitInitialSeating` 時に index 順で自動コピー。
- SeatingBoard / BalancingInstructionCard / live-client の「Table N」表示は label が空文字 / null でない場合 label を優先表示。
- 運営者は tournament dashboard の各卓カードから label / color を inline edit できる（dashboard を `seating` 以降の状態で表示する `SeatingBoard` に edit ボタン拡張）。
- サークル詳細画面に「テーブル呼称デフォルト」カードを追加し、6 行までの自由入力 + 追加 / 削除 / 並び替えで運営者が編集する。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md)
- **PRD Phase**: Phase C — Table Label & Color
- **Stage scope**: schema 2 件拡張（table / group） / repository 2 件拡張（tables / groups） / service 1 件追加（group の defaultTableLabels 更新） / orchestrator 1 件拡張（commitInitialSeating の auto-fill） / rule branch 2 件追加（groups update / tables update の affectedKeys 拡張） / UI 4 か所更新（SeatingBoard / BalancingInstructionCard / live-client / TournamentForm 系は不要） / inline edit UI 2 件新設（GroupDefaultTableLabelsCard / TableLabelEditPopover）
- **Estimated Files**: 約 18 files（schema 2 / repository 2 / service 1 + test / orchestrator 1 / rules 1 / limits 1 / UI 5 / drift script 1 / emulator validator 1 / npm scripts 1 / PRD 1）

---

## UX Design

### Before（現状）

```
/tournaments/[tid]   （seating 状態）
┌────────────────────────────────────────────┐
│ Table 1（5 人）                            │
│ 1: Alice ★                                 │
│ 2: Bob                                     │
│ 3: —                                       │
│ ...                                        │
├────────────────────────────────────────────┤
│ Table 2（4 人）                            │
│ 1: Carol                                   │
│ ...                                        │
├────────────────────────────────────────────┤
│ Table 3（4 人） 閉鎖                       │
│ ...                                        │
└────────────────────────────────────────────┘

⚠ 次のアクション
  Table 2 が 1 人多いです。BB の次プレイヤーを Table 3 / 席 4 へ移動してください。

/live   （参加者画面）
  Table: 2   No.: 5
```

### After

```
/tournaments/[tid]
┌────────────────────────────────────────────┐
│ ■ 赤卓（5 人）                ✎              │  ← label + color band（左端）
│ 1: Alice ★                                 │
│ 2: Bob                                     │
│ ...                                        │
├────────────────────────────────────────────┤
│ ■ 青卓（4 人）                ✎              │
│ 1: Carol                                   │
│ ...                                        │
├────────────────────────────────────────────┤
│ ■ 緑卓（4 人） 閉鎖           ✎              │
│ ...                                        │
└────────────────────────────────────────────┘

⚠ 次のアクション
  青卓 が 1 人多いです。BB の次プレイヤーを 緑卓 / 席 4 へ移動してください。

/live
  Table: 青卓   No.: 5

/groups/[gid]   （新規カード）
┌────────────────────────────────────────────┐
│ テーブル呼称デフォルト                     │
│ 新規トーナメント作成時、上から順に各卓へ    │
│ 自動でコピーされます（最大 6 件 / 10 字）。 │
│  1) 赤卓        ✕                          │
│  2) 青卓        ✕                          │
│  3) 緑卓        ✕                          │
│  [+ 追加]   [保存]   [キャンセル]          │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| SeatingBoard の卓ヘッダ | `Table 1（5 人）` | `■ 赤卓（5 人） ✎`（label 未設定時は `Table 1`） | color は左端に 6px 帯で表示。`✎` は dashboard で organizer のみ表示し popover で edit |
| BalancingInstructionCard | `Table 2 が 1 人多いです` | `青卓 が 1 人多いです`（label 未設定時は `Table 2`） | label を渡す signature 拡張で対応（純関数 engine は触らず view 層で formatTableLabel 経由） |
| live-client の Table 表示 | `Table: 2` | `Table: 青卓`（label 未設定時は `Table: 2`） | dashboard と同じ formatTableLabel ヘルパーを共有 |
| サークル詳細画面 | （なし） | 新規「テーブル呼称デフォルト」カード（最大 6 件 / 10 字 / 並び替え） | organizer のみ edit、member は read のみ |
| 新規 tournament 作成 | 卓は engine 計算後に upsert（label 無し） | 同上 + `defaultTableLabels[i]` を index 順に各卓 label として tx.set | `commitInitialSeating` 内 tx で完結（中間状態を残さない） |
| ⑫ MVP の color | （なし） | `#RRGGBB` 文字列を保存 + 帯表示。色選択 UI は textarea 入力（自由 hex） | プリセット picker は Phase D（Should） |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 1-144 | 既存 group schema の additive 拡張パターン（`defaultSeatsPerTable` / `seasonStartDate` の default / nullable / `DISPLAY_NAME_MAX_LENGTH` import）の正本 |
| P0 | [src/lib/firebase/schemas/table.ts](../../../../src/lib/firebase/schemas/table.ts) | all | `tableBodySchema` 既存定義（極小 3 フィールド）。`label` / `color` を additive 追加する直接対象 |
| P0 | [firestore.rules](../../../../firestore.rules) | 70-272, 487-492 | groups の 7 ブランチ allowed-keys 一覧、tables の explicit branch（旧 wildcard 設計原則 / [firebase-patterns.md](../../../rules/firebase-patterns.md)）。新規 affectedKeys 拡張の正本 |
| P0 | [src/lib/services/seating/orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts) | 78-180 | `commitInitialSeating` の runTransaction 内で tables.set している箇所。`defaultTableLabels` から label を流し込む唯一の改変点 |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 274-298 | `updateDefaultSeatsPerTable` の wrap helper パターンを踏襲。`updateDefaultTableLabels` を同形で追加 |
| P0 | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 334-358 | `setDefaultSeatsPerTable` の `assertOrganizer` + 値域チェックパターン。`setDefaultTableLabels` を同形で追加 |
| P1 | [src/components/group/InlineNumberEditCard.tsx](../../../../src/components/group/InlineNumberEditCard.tsx) | all | 既存 inline edit カードの構造。テーブル呼称は配列のため `InlineArrayEditCard` 風の独自コンポーネントが必要。`useInlineNumberEdit` の API は配列に流用しないが、設計の一貫性として参照 |
| P1 | [src/lib/hooks/useInlineNumberEdit.ts](../../../../src/lib/hooks/useInlineNumberEdit.ts) | all | start / cancel / saving / errorCode / onSaved の state machine の正本（label 配列の編集 hook を新設するときの形式) |
| P1 | [src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) | 168-208 | 卓ヘッダ render 箇所。label / color の表示は `aria-label="table-${tableNum}"` を維持しつつ追加 |
| P1 | [src/components/tournament/BalancingInstructionCard.tsx](../../../../src/components/tournament/BalancingInstructionCard.tsx) | 60-160 | 「Table N」テキストを formatTableLabel(table) に置換する箇所。`tables` props を既に受け取っているため signature 拡張不要 |
| P1 | [src/app/tournaments/[tid]/live/live-client.tsx](../../../../src/app/tournaments/[tid]/live/live-client.tsx) | 220-260 | `me.tableNum` 表示部に label を流し込む箇所。tables を別途 subscribe する必要がある（dashboard と同パターン） |
| P1 | [src/lib/firebase/repositories/tables.ts](../../../../src/lib/firebase/repositories/tables.ts) | all | tables repository の wrap helper / converter パターン。`updateTableLabel(tid, tableNum, { label, color })` を additive 追加 |
| P1 | [src/lib/limits.ts](../../../../src/lib/limits.ts) | all | `MAX_TABLES = 6` 等の数値リテラルの正本。`TABLE_LABEL_MAX_LENGTH = 10` を新規追加する場所 |
| P2 | [scripts/test-rules-default-seats.mjs](../../../../scripts/test-rules-default-seats.mjs) | all | REST 直叩き emulator validator の雛形。`test-rules-table-labels.mjs` を同形で起こす |
| P2 | [scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs) | 1-202 | `firestore.rules` 内ハードコード数値の drift 検出。新規 `TABLE_LABEL_MAX_LENGTH` / `defaultTableLabels.size() <= MAX_TABLES` を追加対象 |
| P2 | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx) | 1-330 | サークル詳細画面のカード積み上げパターン。`GroupDefaultTableLabelsCard` を `SeasonCard` の手前に追加 |
| P2 | [src/app/groups/[gid]/_components/SeasonCard.tsx](../../../../src/app/groups/[gid]/_components/SeasonCard.tsx) | all | `_components/` 配下 client component の構造。`GroupDefaultTableLabelsCard` を同フォルダで新規作成 |
| P2 | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | 145-260 | groups update の allowed-keys 一覧 / subcollection 設計原則 / drift WARNING の更新責務 |
| P2 | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | 60-170 | 権限マトリクス・データモデルの記述箇所。`defaultTableLabels` 行と権限を追加する場所 |

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| Cloud Firestore Security Rules — list operations | https://firebase.google.com/docs/reference/rules/rules.List | `request.resource.data.<list>.size()` で配列長制約、`<list>[i] is string` は表現できないため、サイズ + 上限のみ rule 強制し、各要素の値域は service / schema 側 |
| Firestore — additive field migration | https://firebase.google.com/docs/firestore/data-model | フィールドを後から追加する場合は zod default で `undefined` を許容し、既存 doc の hydrate 時に補完する（破壊的 migration なし） |

外部研究は不要。すべて既存パターン（`defaultSeatsPerTable` / `audioSettings` / `seasonStartDate` の additive 追加）の踏襲で完結する。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/limits.ts:33-35
/**
 * 新規作成画面の `seatsPerTable` 既定値。
 *
 * Phase A (シーズン戦績基盤): 9 → 8 に変更。
 */
export const DEFAULT_SEATS_PER_TABLE = 8;
```

```ts
// SOURCE: src/lib/firebase/schemas/group.ts:80-92
finishedTournamentCount: z.number().int().nonnegative().default(0),
defaultSeatsPerTable: z
  .number()
  .int()
  .min(MIN_SEATS_PER_TABLE)
  .max(MAX_SEATS_PER_TABLE)
  .default(DEFAULT_SEATS_PER_TABLE),
seasonStartDate: z.instanceof(Timestamp).nullable().default(null),
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:274-297
export async function updateDefaultSeatsPerTable(
  gid: string,
  value: number,
): Promise<void> {
  if (
    !Number.isInteger(value) ||
    value < MIN_SEATS_PER_TABLE ||
    value > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/default-seats-invalid",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "デフォルト席数の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { defaultSeatsPerTable: value });
    },
    { gid },
  );
  logger.info("group defaultSeatsPerTable updated", { gid, value });
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/group.ts:334-357
export async function setDefaultSeatsPerTable({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (
    !Number.isInteger(value) ||
    value < MIN_SEATS_PER_TABLE ||
    value > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/default-seats-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultSeatsPerTable(gid, value);
  logger.info("setDefaultSeatsPerTable ok", { gid, uid, value });
}
```

### REPOSITORY_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tables.ts:80-90
export async function markTableBroken(tid: string, tableNum: number): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル閉鎖に失敗しました",
    async () => {
      await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: true });
    },
    { tid, tableNum },
  );
  logger.info("table broken ok", { tid, tableNum });
}
```

### SERVICE_PATTERN

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:125-135
// M-3.1 fix: tables/{n} の upsert を同一 tx 内に統合。
// 以前は tx 後の writeBatch 経由だったため、tx 成功後のネットワーク断等で
// 「players は seat 済みだが tables doc が空」の中間状態が残り得た。
for (const n of plan.tableNums) {
  tx.set(doc(tablesRef(tid), String(n)), {
    tableNum: n,
    isBroken: false,
    createdAt: ts,
  });
}
```

### RULE_BRANCH_PATTERN

```firestore-rules
// SOURCE: firestore.rules:207-220
} || (
  // Phase 4.17: organizer による defaultSeatsPerTable の単独書換。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['defaultSeatsPerTable'])
  && request.resource.data.defaultSeatsPerTable is int
  && request.resource.data.defaultSeatsPerTable >= 2
  && request.resource.data.defaultSeatsPerTable <= 10
)
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/firebase/repositories/tables.test.ts （既存パターン参照）
// repositories の test では Firestore SDK を vi.mock で stub し、
// updateDoc に正しい引数で呼ばれること / wrap helper 経由で AppError が
// 正しい code でラップされることを検証する。

// SOURCE: scripts/test-rules-default-seats.mjs:172-209
// emulator validator は REST 直叩きで HTTP 200 / 403 を assert する。
await expectAllow("(1) organizer set to 6", () =>
  patchDoc(org.idToken, `groups/${gid}`, { defaultSeatsPerTable: 6 }),
);
await expectDeny("(6) organizer set seats + name (deny: affectedKeys)", () =>
  patchDoc(org.idToken, `groups/${gid}`, {
    defaultSeatsPerTable: 6,
    name: "Changed",
  }),
);
```

### UI_INLINE_EDIT_PATTERN

```tsx
// SOURCE: src/app/groups/[gid]/group-detail-client.tsx:148-162
const defaultSeatsEditor = useInlineNumberEdit({
  currentValue: group?.defaultSeatsPerTable ?? DEFAULT_SEATS_PER_TABLE,
  save: (value) => setDefaultSeatsPerTable({ gid, uid: user!.uid, value }),
  validate: (n) =>
    Number.isInteger(n) && n >= MIN_SEATS_PER_TABLE && n <= MAX_SEATS_PER_TABLE
      ? null
      : `validation/default-seats-invalid: ...`,
  onSaved: async () => {
    await reload();
    await refreshGroups();
  },
  onError: setError,
  errorCode: "group/default-seats-failed",
  errorMessage: "デフォルト席数の更新に失敗しました",
});
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/lib/limits.ts` | UPDATE | `TABLE_LABEL_MAX_LENGTH = 10` 追加。drift 検査の単一真実源 |
| `src/lib/firebase/schemas/table.ts` | UPDATE | `label: z.string().min(1).max(TABLE_LABEL_MAX_LENGTH).nullable().optional()` / `color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional()` を additive 追加。型は `TableDoc` に伝播 |
| `src/lib/firebase/schemas/group.ts` | UPDATE | `defaultTableLabels: z.array(z.string().min(1).max(TABLE_LABEL_MAX_LENGTH)).max(MAX_TABLES).default([])` を additive 追加 |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | `createGroup` の addDoc に `defaultTableLabels: []` を追加。`updateDefaultTableLabels(gid, labels)` を新設（事前 trim / 重複検査は service 層） |
| `src/lib/firebase/repositories/tables.ts` | UPDATE | `updateTableLabel(tid, tableNum, { label, color })` を新設。`label === ""` は `null` に正規化（Firestore で空文字列保存しない） |
| `src/lib/services/group.ts` | UPDATE | `setDefaultTableLabels({ gid, uid, labels })` を新設（assertOrganizer + 値域チェック） |
| `src/lib/services/seating/orchestrator.ts` | UPDATE | `commitInitialSeating` の tx 内で、`groupDoc.defaultTableLabels[i]` を index 順に `label` として `tx.set(tableDoc, ...)` する（既存 tables doc は再 upsert で塗り替えない設計のため、tx 内で `tx.get(tablesRef)` を使わず create-or-merge を実装） |
| `src/lib/services/seating/orchestrator.ts` | UPDATE | tournament の `groupId` から `groupDoc` を tx 内で 1 度 read（既に loadTournamentInTx で tournament を読んでいるが、defaultTableLabels を引くために `tx.get(groupDocRef(t.groupId))` を追加。read は 1 件のみ追加） |
| `firestore.rules` | UPDATE | groups update に `defaultTableLabels` ブランチ追加（`affectedKeys.hasOnly(['defaultTableLabels'])` + `is list` + `size() <= 6`）。tables update / write は既存 `allow write: if isOrganizer(...)` を `allow create / update` 分岐に再分割し、`update` で `affectedKeys.hasOnly([..., 'label', 'color'])` + `label is string \|\| null` 程度を additive で許容 |
| `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx` | CREATE | サークル詳細画面用の inline 配列 edit カード（最大 6 行 / 各 10 字 / 並び替え不要 MVP・追加削除のみ） |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | `GroupDefaultTableLabelsCard` を `SeasonCard` の前に積む（owner / organizer のみ edit、member は read 表示） |
| `src/components/tournament/SeatingBoard.tsx` | UPDATE | 卓ヘッダで `formatTableLabel(table)` を呼出し（label が空文字 / null なら `Table N` フォールバック）。color が non-null なら左端に 6px 幅の border-l でカラー帯を表示。aria-label は `table-${tableNum}` を維持（テスト互換のため） |
| `src/components/tournament/BalancingInstructionCard.tsx` | UPDATE | `Table ${diag.sourceTableNum}` を `formatTableLabel(tables.find(t => t.tableNum === diag.sourceTableNum))` に置換。label を返す純関数を import |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | `subscribeTables` を追加し、`me.tableNum` から table doc を引いて `formatTableLabel(table)` で表示。tables 取得失敗時は warn のみで `Table N` フォールバック |
| `src/lib/services/format-table-label.ts` | CREATE | 純関数 `formatTableLabel(table: { tableNum: number; label?: string \| null }): string`。3 view から共通利用 |
| `src/lib/services/format-table-label.test.ts` | CREATE | label 設定済み / null / 空文字 / undefined（旧 doc） / 制御文字混入のケースを網羅 |
| `src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx` | CREATE | dashboard の SeatingBoard 卓ヘッダから開くポップオーバー。label / color の inline edit。organizer のみ |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `SeatingBoard` に `canEditTableLabel` / `onSaveTableLabel` props を渡す（organizer かつ `seating` 以降の状態のみ true） |
| `scripts/test-rules-table-labels.mjs` | CREATE | groups.defaultTableLabels の rule 検証 + tables.label / color の rule 検証（REST 直叩き / `firebase emulators:exec` 起動） |
| `scripts/test-rules-limits.mjs` | UPDATE | `TABLE_LABEL_MAX_LENGTH` を `EXPECTED` に追加し、`label is string && size() <= 10` 等の pattern を check に追加 |
| `package.json` | UPDATE | `test:rules-table-labels` script を追加（`test:rules-default-seats` の隣） |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` | UPDATE | Phase C 行を `pending` → `in-progress` にし、PRP Plan 列に本 plan へのリンクを追加 |
| `.claude/rules/firebase-patterns.md` | UPDATE | groups update の allowed-keys 一覧に `defaultTableLabels` 行を追加。tables の rule 経路を `affectedKeys` 強制に切替えた旨を記録 |
| `.claude/rules/group-membership.md` | UPDATE | 権限マトリクスに「テーブル呼称デフォルト（`defaultTableLabels`）の参照 / 修正」「卓 label / color の参照 / 修正」を追加 |

## NOT Building

- **並び替え（drag-and-drop）の `defaultTableLabels`** — MVP は追加 / 削除のみ（最大 6 件）。並び替えは Phase D の polish に回す
- **Color picker UI（プリセット 6〜8 色のクリック選択）** — Phase D（Should）。Phase C は `<input type="color">` ネイティブピッカーまたは hex 文字列 textarea で着地
- **observer モード / 観戦 URL での label 表示** — Phase 別 PRD（観戦モード）で対応。Phase C は認証済みユーザーのみ表示
- **過去 tournament の label retroactive 適用** — `commitInitialSeating` 時点の `defaultTableLabels` snapshot のみ自動コピー。後から `defaultTableLabels` を変えても既存 tournament には伝播しない（運営者は dashboard の inline edit で個別調整）
- **engine.ts 純関数（planInitialSeating / planTableBreak）への label 注入** — engine は完全に番号ベースのまま。view / orchestrator が label を扱う
- **seasonStats / seasonHistory への影響** — Phase A / B と完全に独立。schema の変更は無し
- **テーブル label の collectionGroup query** — 既存の `match /{path=**}/players/{pid}` のような追加 wildcard rule は不要。tables は subscribe 経路がトーナメントスコープのみ

---

## Step-by-Step Tasks

### Task 1: 数値リミット定数の追加

- **ACTION**: `src/lib/limits.ts` に `TABLE_LABEL_MAX_LENGTH = 10` を追加
- **IMPLEMENT**: `export const TABLE_LABEL_MAX_LENGTH = 10;` + JSDoc で「DRIFT WARNING: `firestore.rules` の `defaultTableLabels[i].size() <= 10` / `tables/{n}.label.size() <= 10` と連動」を明記
- **MIRROR**: NAMING_CONVENTION 節（`DEFAULT_SEATS_PER_TABLE` / `MAX_TABLES` の定数定義）
- **IMPORTS**: なし
- **GOTCHA**: 既存の `MAX_TABLES` / `MIN_SEATS_PER_TABLE` 等と同じ位置に置く（drift 検査の正規表現が `export const NAME = N;` のフォーマットを期待するため、コメント以外の付属物を入れない）
- **VALIDATE**: `npm run test:rules-limits` で既存検査が green のまま動くこと（このタスク単体では rule 側に変更がないので drift 検出はスキップ）

### Task 2: table schema に label / color を additive 追加

- **ACTION**: `src/lib/firebase/schemas/table.ts` を更新
- **IMPLEMENT**:
  ```ts
  import { TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
  export const tableBodySchema = z.object({
    tableNum: z.number().int().positive(),
    isBroken: z.boolean(),
    createdAt: z.instanceof(Timestamp),
    // Phase C: 卓のカスタム呼称。設定なし=null、空文字は repository 側で null に正規化。
    // 旧 doc（field 不在）は default(null) で hydrate される。
    label: z.string().min(1).max(TABLE_LABEL_MAX_LENGTH).nullable().default(null),
    // Phase C: 卓カードの色帯。#RRGGBB hex 文字列または null。
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().default(null),
  });
  ```
- **MIRROR**: NAMING_CONVENTION 節（`seasonStartDate` の `nullable().default(null)` パターン）
- **IMPORTS**: `import { TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";`
- **GOTCHA**: `label.optional()` ではなく `nullable().default(null)` にすることで、UI が `table.label === null ? Table N : label` の単一分岐で扱える。`optional()` を使うと `undefined` / `null` の二重判定が必要になり SeatingBoard / live-client / BalancingInstructionCard の 3 か所で漏れる
- **VALIDATE**: `npm test` で table schema のテストが green。`tsc --noEmit` で `TableDoc` を import している全ファイル（10 か所）が break しないこと

### Task 3: group schema に defaultTableLabels を additive 追加

- **ACTION**: `src/lib/firebase/schemas/group.ts` を更新
- **IMPLEMENT**:
  ```ts
  import { MAX_TABLES, TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
  // 既存 groupBodySchema 内、seasonStartDate の直後に追加
  defaultTableLabels: z
    .array(z.string().min(1).max(TABLE_LABEL_MAX_LENGTH))
    .max(MAX_TABLES)
    .default([]),
  ```
- **MIRROR**: `defaultSeatsPerTable` / `seasonStartDate` の additive 追加箇所（[group.ts:80-97](../../../../src/lib/firebase/schemas/group.ts#L80-L97)）
- **IMPORTS**: `MAX_TABLES` / `TABLE_LABEL_MAX_LENGTH` from `@/lib/limits`
- **GOTCHA**: 旧 doc は `default([])` で空配列 hydrate。zod `default` は新規 hydrate 時のみ適用されるため、既存 group の Firestore 上の doc には field が無い状態のまま（明示的な migration は不要）
- **VALIDATE**: `npm test` で既存の group schema test が green。新規 unit test で `defaultTableLabels.max(7)` の入力が parse error になることを確認

### Task 4: groups repository / service の `defaultTableLabels` 経路を新設

- **ACTION**: `src/lib/firebase/repositories/groups.ts` と `src/lib/services/group.ts` を更新
- **IMPLEMENT**:
  - `groups.ts` `createGroup` 内 `addDoc` ペイロードに `defaultTableLabels: []` を追加
  - `groups.ts` `updateDefaultTableLabels(gid, labels: string[])` を新設。事前検査:
    - `Array.isArray(labels)`
    - `labels.length <= MAX_TABLES`
    - 各要素が `string`、trim 後 1〜`TABLE_LABEL_MAX_LENGTH` 文字
    - 重複検査は行わない（同名運用を許容、運用判断）
  - `group.ts` `setDefaultTableLabels({ gid, uid, labels })` を新設（`assertOrganizer` 後、上記検査 → `updateDefaultTableLabels` 呼出）
- **MIRROR**: REPOSITORY_PATTERN / SERVICE_PATTERN 節（`updateDefaultSeatsPerTable` + `setDefaultSeatsPerTable`）
- **IMPORTS**: `MAX_TABLES`, `TABLE_LABEL_MAX_LENGTH` from `@/lib/limits`
- **GOTCHA**: `updateDoc(groupDocRef(gid), { defaultTableLabels: labels })` で配列を丸ごと上書きする（部分更新しない）。`arrayUnion` / `arrayRemove` を使うと rule の `affectedKeys.hasOnly` 検査と整合しない
- **VALIDATE**: `npm test` で repository / service の unit test が green。エラー code (`validation/default-table-labels-invalid`) が rule deny 前に client 早期失敗していることを確認

### Task 5: orchestrator.commitInitialSeating で defaultTableLabels を auto-fill

- **ACTION**: `src/lib/services/seating/orchestrator.ts` の `commitInitialSeating` を更新
- **IMPLEMENT**:
  ```ts
  // tx 内 loadTournamentInTx の直後で group doc を read（label auto-fill のため 1 read 追加）
  const groupSnap = await tx.get(groupDocRef(t.groupId));
  const groupBody = groupSnap.exists() ? groupSnap.data() : null;
  const defaultLabels: string[] = groupBody?.defaultTableLabels ?? [];

  // 既存 plan.tableNums の loop で、index 順に defaultLabels から label を流し込む
  for (let i = 0; i < plan.tableNums.length; i += 1) {
    const n = plan.tableNums[i];
    const label = defaultLabels[i] ?? null; // index 不足は null
    tx.set(doc(tablesRef(tid), String(n)), {
      tableNum: n,
      isBroken: false,
      createdAt: ts,
      label,
      color: null, // color は手動編集のみで auto-fill しない（プリセット未対応のため）
    });
  }
  ```
- **MIRROR**: SERVICE_PATTERN 節（`tx.set(tableDoc, ...)` の merge 不要 / 全フィールドセット）
- **IMPORTS**: `groupDocRef` を `@/lib/firebase/repositories/groups` から追加 import
- **GOTCHA**:
  - 既存 `tables/{n}` doc が存在する場合、`tx.set` は丸ごと上書きするため、運営者が dashboard で手動 edit した label が再度 commitInitialSeating で消える可能性がある。これを避けるため、`tx.get(tablesRef ...)` で既存 doc を read し、`label` の既存値が non-null なら維持する merge ロジックを入れる
  - tx 内 read は順序に注意（read を全て `tx.update`/`tx.set` より先に行うのが Firestore tx の制約）
  - `defaultTableLabels` 配列要素が `MAX_TABLES = 6` 超えて入る可能性は schema で塞がれているが、`plan.tableNums.length` も `MAX_TABLES` 以内なので safe
- **VALIDATE**: orchestrator の既存 test が green。新規 test で「defaultLabels=['赤卓','青卓'] / tableNums=[1,2,3] のとき table 3 の label=null になる」「既に table 1 の label='緑卓' が存在するとき再 commit で塗り替えない」ケースを追加

### Task 6: firestore.rules の groups update / tables update を拡張

- **ACTION**: `firestore.rules` を更新
- **IMPLEMENT**:
  - groups update に新ブランチ:
    ```
    || (
      // Phase C: organizer による defaultTableLabels の単独書換。
      isOrganizer(gid)
      && request.resource.data.diff(resource.data).affectedKeys()
           .hasOnly(['defaultTableLabels'])
      && request.resource.data.defaultTableLabels is list
      && request.resource.data.defaultTableLabels.size() <= 6
    )
    ```
  - tables の `allow write` を `allow create` / `allow update` に分割:
    ```
    match /tables/{tableId} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
                    && exists(/databases/$(database)/documents/tournaments/$(tid))
                    && isOrganizer(get(/.../tournaments/$(tid)).data.groupId);
      allow update: if isSignedIn()
                    && exists(/databases/$(database)/documents/tournaments/$(tid))
                    && isOrganizer(get(/.../tournaments/$(tid)).data.groupId)
                    && (
                      // 既存の isBroken / createdAt 等の単独 update ではフィールドの型のみ強制しない
                      // （commitInitialSeating の tx は丸ごと set で書込むため update branch を通らない）
                      // dashboard の inline edit 経路は label / color の affectedKeys に絞る
                      !request.resource.data.diff(resource.data).affectedKeys()
                        .hasAny(['label', 'color'])
                      || (
                        request.resource.data.diff(resource.data).affectedKeys()
                          .hasOnly(['label', 'color'])
                        && (
                          request.resource.data.label == null
                          || (request.resource.data.label is string
                              && request.resource.data.label.size() >= 1
                              && request.resource.data.label.size() <= 10)
                        )
                        && (
                          request.resource.data.color == null
                          || (request.resource.data.color is string
                              && request.resource.data.color.matches('^#[0-9a-fA-F]{6}$'))
                        )
                      )
                    );
    }
    ```
- **MIRROR**: RULE_BRANCH_PATTERN 節（`defaultSeatsPerTable` の affectedKeys 強制）
- **IMPORTS**: なし（rule ファイル）
- **GOTCHA**:
  - `commitInitialSeating` は `tx.set` で丸ごと書込むため update rule の `affectedKeys` 検査を通らない（create / 全フィールド再 set 経路に倒れる）。inline edit 経路だけが update branch を通る前提で OR 条件を組む
  - `request.resource.data.label.matches(...)` の正規表現は Cloud Firestore Rules の `string.matches()` を使う（部分一致）。color hex は `^#[0-9a-fA-F]{6}$` でアンカー必須
  - `defaultTableLabels` の各要素 string 長 / 1 文字以上は rule で表現困難（list 内 element validate 不可）。schema + service 側で enforce
- **VALIDATE**: 次タスクの emulator validator で allow / deny を実観測

### Task 7: emulator validator を追加

- **ACTION**: `scripts/test-rules-table-labels.mjs` を新規作成 + `package.json` に `test:rules-table-labels` script を追加
- **IMPLEMENT**: `test-rules-default-seats.mjs` を雛形として REST 直叩き / signUp / patchDoc / createDoc / expectAllow / expectDeny を流用。検証ケース最低 10 件:
  - groups: organizer が `defaultTableLabels = ['赤','青']` で update → allow
  - groups: organizer が `defaultTableLabels = []` で update → allow
  - groups: organizer が `defaultTableLabels = [...8件]` で update → deny（size > 6）
  - groups: organizer が `defaultTableLabels + name` 同時 update → deny（affectedKeys 違反）
  - groups: member が `defaultTableLabels` を update → deny
  - tables: organizer が `label = '赤卓' / color = '#FF0000'` で update → allow
  - tables: organizer が `label = '...11文字...'` で update → deny（size > 10）
  - tables: organizer が `color = '#GGGGGG'` で update → deny（regex 違反）
  - tables: member が `label` を update → deny
  - tables: organizer が `label + isBroken` 同時 update → deny（affectedKeys 違反）
- **MIRROR**: TEST_STRUCTURE 節（[test-rules-default-seats.mjs:172-209](../../../../scripts/test-rules-default-seats.mjs#L172-L209)）
- **IMPORTS**: なし
- **GOTCHA**: tables doc は tournament 配下のため、validator 内で先に tournament を seed する必要がある。既存 validator はサブコレクション seed 経験があるので参考にする
- **VALIDATE**: `firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-table-labels.mjs"` で `ALL GREEN`

### Task 8: drift 検査を更新

- **ACTION**: `scripts/test-rules-limits.mjs` を更新
- **IMPLEMENT**:
  - `EXPECTED` に `TABLE_LABEL_MAX_LENGTH = parseConstFromText(limitsText, "TABLE_LABEL_MAX_LENGTH", "src/lib/limits.ts")` を追加
  - `checks` に以下を追加:
    ```js
    {
      label: "tables.label upper bound (<= TABLE_LABEL_MAX_LENGTH)",
      pattern: /\.label\.size\(\)\s*<=\s*(\d+)/g,
      expected: EXPECTED.TABLE_LABEL_MAX_LENGTH,
      minOccurrences: 1,
    },
    {
      label: "groups.defaultTableLabels upper bound (<= MAX_TABLES)",
      pattern: /defaultTableLabels\.size\(\)\s*<=\s*(\d+)/g,
      expected: EXPECTED.MAX_TABLES,
      minOccurrences: 1,
    },
    ```
- **MIRROR**: [test-rules-limits.mjs:69-130](../../../../scripts/test-rules-limits.mjs#L69-L130)
- **IMPORTS**: なし
- **GOTCHA**: `defaultTableLabels` は単一 path のため `minOccurrences: 1`。`label.size()` は `tables/{tableId}` の rule branch 内 1 箇所
- **VALIDATE**: `npm run test:rules-limits` で `ALL GREEN`。drift を意図的に作って FAIL することも確認

### Task 9: SeatingBoard / BalancingInstructionCard / live-client の label 表示を追加

- **ACTION**: `src/lib/services/format-table-label.ts` を新規作成、3 view を更新
- **IMPLEMENT**:
  ```ts
  // src/lib/services/format-table-label.ts
  export function formatTableLabel(table: { tableNum: number; label?: string | null }): string {
    const trimmed = table.label?.trim();
    return trimmed ? trimmed : `Table ${table.tableNum}`;
  }
  ```
  - SeatingBoard.tsx [L174-L176](../../../../src/components/tournament/SeatingBoard.tsx#L174-L176): `Table {table.tableNum}` を `{formatTableLabel(table)}` に置換。color が non-null なら `<span style={{ borderLeft: '6px solid ${color}' }} />` を CardHeader 左端に追加
  - BalancingInstructionCard.tsx [L137,L151,L153](../../../../src/components/tournament/BalancingInstructionCard.tsx#L137): `Table ${diag.sourceTableNum}` 等を `formatTableLabel(tables.find(t => t.tableNum === diag.sourceTableNum) ?? { tableNum: diag.sourceTableNum, label: null })` に置換
  - live-client.tsx [L235-L240](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L235-L240): `subscribeTables(tid, ...)` を effect で追加し、`tables.find(t => t.tableNum === me.tableNum)` から label を引いて表示
- **MIRROR**: 既存の `cn` / `clsx` / `<CardHeader>` 構造
- **IMPORTS**: `formatTableLabel` from `@/lib/services/format-table-label`
- **GOTCHA**:
  - `aria-label="table-${tableNum}"` は SeatingBoard で維持（[TournamentsPage.ts:62-64](../../../../tests/e2e/pages/TournamentsPage.ts#L62-L64) のテスト互換のため、label 文字列を含めない）
  - live-client は現状 tables を subscribe していない。新規 subscribe を追加するが、エラー時は warn のみで Live 表示自体は壊さない
  - color 帯は dark mode で見にくい色（黒など）でも視認できるよう border 6px 幅 + 透明度 1.0 で固定。プリセット picker（Phase D）が来るまでは運営者の自己責任
- **VALIDATE**: `npm test` で SeatingBoard / BalancingInstructionCard の test が green。E2E で「label='赤卓' を設定後に SeatingBoard ヘッダに 赤卓 表示」「label='' のときは Table 1 fallback」を確認

### Task 10: dashboard inline edit UI を追加

- **ACTION**: `src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx` を新規作成、`SeatingBoard.tsx` に edit ボタン領域を追加、`dashboard-client.tsx` で organizer 判定を渡す
- **IMPLEMENT**:
  - Popover は shadcn/ui の Popover が未導入なら、Radix の `@radix-ui/react-popover` を依存追加せずに既存の Dialog で代用（小規模 UI）
  - 簡易実装: 「✎」ボタンクリック → 小型 Dialog → `<Input maxLength={10}>` + `<input type="color">` + 保存 / キャンセル
  - 保存時に `updateTableLabel(tid, tableNum, { label, color })` 呼出
  - SeatingBoard は `canEditTableLabel: boolean` / `onSaveTableLabel?: (tableNum, { label, color }) => Promise<void>` を新規 props で受ける
- **MIRROR**: [PlayerList.tsx:161-189](../../../../src/components/tournament/PlayerList.tsx#L161-L189) の Dialog パターン
- **IMPORTS**: `Dialog` from `@/components/ui/dialog`、`Input` / `Button`、`updateTableLabel` from `@/lib/firebase/repositories/tables`
- **GOTCHA**:
  - color picker は `<input type="color" value={color ?? '#888888'}>` の native picker で MVP。値は `value || null` に正規化して `null` を保存
  - `running` / `paused` 中の edit を許容するか? → MVP では SeatingBoard が表示される `seating` / `running` / `paused` / `finished` 全状態で organizer のみ edit 可。テンプレ rule は `state` 制約を入れない（運営者信頼）
- **VALIDATE**: dashboard で organizer ログインし「✎」→ 「赤卓」入力 → 保存 → SeatingBoard ヘッダが「赤卓」になる手動確認。member ログインだと「✎」が表示されないことを確認

### Task 11: GroupDefaultTableLabelsCard を追加

- **ACTION**: `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx` を新規作成、`group-detail-client.tsx` で SeasonCard の前に積む
- **IMPLEMENT**:
  - Card 構造は SeasonCard を踏襲
  - 表示モード: `group.defaultTableLabels` を `1) 赤卓` / `2) 青卓` / ... の順番付きリストで表示。label 0 件なら「未設定」
  - 編集モード（organizer のみ「編集」ボタン → モード切替）: 各行に `<Input maxLength={10}>` + `[✕ 削除]`、最下部に `[+ 追加]`（最大 6 件で disabled）、`[保存]` / `[キャンセル]`
  - 保存時に `setDefaultTableLabels({ gid, uid, labels })` 呼出
- **MIRROR**: [SeasonCard.tsx](../../../../src/app/groups/[gid]/_components/SeasonCard.tsx) の構造
- **IMPORTS**: `setDefaultTableLabels` from `@/lib/services/group`、`MAX_TABLES`, `TABLE_LABEL_MAX_LENGTH` from `@/lib/limits`
- **GOTCHA**:
  - 配列 state は React で管理し、保存時のみ Firestore に書込む（途中 cancel で破棄）
  - 並び替えは MVP 範囲外。`削除 → 再追加` で順序を変える運用
  - 表示モードの未設定状態に「新規トーナメント作成時、上から順に各卓へ自動コピーされます（最大 6 件 / 10 字）」のヘルプテキスト
- **VALIDATE**: 手動で organizer / member / 非ログインの各ロールで開き、edit 権限が正しく制御されることを確認

### Task 12: PRD と rule ドキュメントの更新

- **ACTION**: PRD と関連 rule ファイルを更新
- **IMPLEMENT**:
  - `02-season-stats-and-share.prd.md` の Phase C 行を `pending` → `in-progress` に変更し、PRP Plan 列に `[phase-c-table-label-color.plan.md](../plans/phase-c-table-label-color.plan.md)` を追加
  - `firebase-patterns.md` の groups update allowed-keys 一覧に `defaultTableLabels` 行を追加
  - `firebase-patterns.md` の subcollection 設計原則節に `tables.label / color` の単独書換 rule を追記
  - `group-membership.md` の権限マトリクスに「テーブル呼称デフォルトの参照 / 修正」「卓 label / color の参照 / 修正」を追加
- **MIRROR**: 既存の Phase 4.16 / 4.17 の追記スタイル
- **IMPORTS**: なし（ドキュメントのみ）
- **GOTCHA**: rule ファイルの「適用範囲」節は変えない（`label` / `color` は既存 path 配下なので新規 path 追加なし）
- **VALIDATE**: `git diff` で意図した箇所だけが変わっていること

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `formatTableLabel` 通常 | `{ tableNum: 1, label: '赤卓' }` | `'赤卓'` | No |
| `formatTableLabel` 未設定 | `{ tableNum: 2, label: null }` | `'Table 2'` | Yes |
| `formatTableLabel` 空文字 | `{ tableNum: 3, label: '' }` | `'Table 3'`（空文字も fallback） | Yes |
| `formatTableLabel` 旧 doc | `{ tableNum: 4 }`（label undefined） | `'Table 4'` | Yes |
| `formatTableLabel` 前後空白 | `{ tableNum: 5, label: '  赤卓  ' }` | `'赤卓'`（trim 後） | Yes |
| `tableBodySchema.parse` 旧 doc | `{ tableNum: 1, isBroken: false, createdAt: now }` | label / color が null として hydrate | Yes |
| `tableBodySchema.parse` label 11 字 | `{ ..., label: 'あいうえおかきくけこさ' }` | parse error | Yes |
| `tableBodySchema.parse` color invalid | `{ ..., color: '#GGGGGG' }` | parse error | Yes |
| `groupBodySchema.parse` defaultTableLabels 7 件 | `{ ..., defaultTableLabels: [...×7] }` | parse error | Yes |
| `updateDefaultTableLabels` 値域違反 | `labels = ['', '赤卓']`（空文字混入） | `AppError("validation/...")` | Yes |
| `setDefaultTableLabels` 非 organizer | uid が member | `AppError("group/not-organizer")` | Yes |
| `commitInitialSeating` auto-fill | `defaultTableLabels=['赤','青'] / tableNums=[1,2,3]` | table 1=赤 / 2=青 / 3=null | No |
| `commitInitialSeating` 既存 label 維持 | 既に table 1 の label='緑卓' があるとき再 commit | label が緑卓のまま塗り替わらない | Yes |
| `updateTableLabel` color null | `{ label: '赤卓', color: null }` | Firestore に null で保存 | Yes |

### Edge Cases Checklist

- [ ] 旧 group doc（field 不在）で defaultTableLabels が空配列として hydrate される
- [ ] 旧 table doc（field 不在）で label / color が null として hydrate される
- [ ] `defaultTableLabels = []` のときに `commitInitialSeating` は label=null で全テーブル作成（fallback 動作）
- [ ] tables.label = `'  '`（空白のみ）の場合、UI は `Table N` で fallback
- [ ] tables.color = `'#abcdef'`（小文字 hex）でも rule allow（regex `[0-9a-fA-F]`）
- [ ] organizer が dashboard で label を空文字保存 → repository で null に正規化 → rule allow
- [ ] member が tables doc を直接 SDK 経由で update → rule deny（403）
- [ ] commitInitialSeating の race（複数端末同時実行）でも tx 内 read-then-write で塗り替えが atomic
- [ ] live-client で tables subscribe 失敗時は label fallback で `Table N` 表示（致命でない warn のみ）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: No new warnings

### Unit Tests

```bash
npm test
```

EXPECT: All tests pass（既存 + Phase C 新規）

### Drift Check

```bash
npm run test:rules-limits
```

EXPECT: `ALL GREEN`（TABLE_LABEL_MAX_LENGTH と defaultTableLabels.size() の drift 検出を含む）

### Emulator Validator (Phase C)

```bash
npm run test:rules-table-labels
```

EXPECT: `ALL GREEN`（前述 10+ ケース）

### Existing Emulator Validators (regression)

```bash
npm run test:rules-clone-players
npm run test:rules-season
```

EXPECT: 既存 validator が green（subcollection rule の再分割で degrade していないこと）

### Build

```bash
npm run build
```

EXPECT: Next.js production build success

### Browser Validation

```bash
npm run dev
```

EXPECT:
- 手動: organizer ログインで `/groups/[gid]` を開き、テーブル呼称デフォルトを 3 件登録 → 新規 tournament 作成 → SeatingBoard で 1〜3 番卓に label 表示
- 手動: organizer が dashboard 「✎」で label を変更 → SeatingBoard / BalancingInstructionCard / live-client（別タブ）の 3 か所で同期表示
- 手動: member ログインで「✎」が表示されない / `defaultTableLabels` カードが read のみ

### Manual Validation

- [ ] 開発者がサークル参加時に「Table 1 / 2 / 3」呼称が消え、カスタム呼称（赤卓 / 青卓 / 緑卓）で口頭伝達が完結したことを目視確認（PRD の Success Metrics）
- [ ] Firestore Console で旧 group doc を開き、`defaultTableLabels` field が無いままでも UI が壊れないことを確認

---

## Acceptance Criteria

- [ ] 全タスク 1〜12 が完了
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` が green
- [ ] `npm run test:rules-limits` / `npm run test:rules-table-labels` / `npm run test:rules-clone-players` / `npm run test:rules-season` が green
- [ ] organizer / member / 非ログインの各ロールで edit / view 権限が rule + UI の両方で正しく制御
- [ ] PRD Phase C 行が `in-progress` 表記になり PRP Plan 列にリンク
- [ ] `firebase deploy --only firestore:rules` が本 plan の最終 commit 直前にチェックリスト化されている

## Completion Checklist

- [ ] Patterns to Mirror の各 SOURCE と新コードの形式が一致
- [ ] AppError の code prefix が既存 mapping（`firestore/*` / `validation/*` / `group/*`）に従う
- [ ] logger.info / logger.warn が wrap 外に置かれている（成功時のみ info）
- [ ] テスト fixture が schema 全フィールドを並べていない（factory 関数経由）
- [ ] `console.*` 直呼びがない（logger 経由のみ）
- [ ] `aria-label="table-${tableNum}"` がテスト互換のため維持されている
- [ ] PRD / firebase-patterns.md / group-membership.md の追記が drift WARNING を含む
- [ ] **Firestore rules deploy 案内が完了報告に含まれる**（emulator green でも本番未 deploy で permission-denied する罠を回避）
- [ ] Self-contained — 実装者が追加質問なしで進行可能

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `tables/{n}` の rule を `allow write` から `allow create` / `allow update` に分割した際、`commitInitialSeating` の `tx.set` 経路が `update` 扱いされて affectedKeys 違反になる | M | High | tx 内で既存 doc を `tx.get` してから「存在しない場合のみ tx.set（= create）」「存在する場合は tx.update で label のみ patch」と分岐する設計に切替。emulator validator で create / update 経路を別々に検証 |
| 既存 SeatingBoard / BalancingInstructionCard の test fixture が label / color を持たないため、TableDoc 型変更で型エラー | M | Medium | schema の `nullable().default(null)` で旧 fixture が parse 可能。test fixture factory（`makeTable(overrides)`）を導入していない箇所は今回の Phase C で factory 化 |
| live-client の subscribeTables 追加で permission-denied（観戦モード前提を壊す）| L | High | live-client の `RequireAuth` は維持されているため group メンバー以外は到達しない。subscribeTables 失敗は warn のみで Live 表示は壊さない fallback |
| `defaultTableLabels` 配列の rule で要素の string 長 / 1 文字以上を強制できない | M | Medium | service 層の `setDefaultTableLabels` で trim + 1〜10 字検査を必須化。client 側経路でしか書込まないため、rule 表現の限界は許容 |
| color の自由 hex 入力で運営者が読みにくい色を選んでしまう | L | Low | Phase D の color picker（プリセット）で polish 対応。Phase C は MVP として自由入力 |
| `commitInitialSeating` の tx に group doc read 1 件追加で tx サイズが膨張 | L | Low | 1 read 追加は Firestore tx 上限（500 ops）に対して無視できる範囲 |
| 既存 `match /tables/{tableId}` rule の `allow write` を `allow create` / `allow update` に分割する変更が、既知のテストで silent regression を起こす | M | High | emulator validator で create / update / member deny を網羅。`test:rules-clone-players` を再走させ Phase 5.4 の wildcard 設計原則と整合確認 |

## Notes

- 実装順序は `Task 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12` を推奨（schema → rule → orchestrator → UI → docs）
- Phase A と並列で進められるが、`commitInitialSeating` 拡張は orchestrator.ts 内で `finishTournament` の `seasonStats` 増分（Phase A）と編集箇所が物理的に分離している（別 export 関数）ため conflict は発生しにくい
- 観測フェーズ（Phase D）で「画像保存ボタン押下が複数回観測されたか」の Success Metric は Phase B 側、「テーブル呼称が口頭伝達で完結したか」は本 Phase C 側で測定（開発者がサークル参加時に目視）
- `color` プリセット（Phase D の Should）は本 Phase で hex 文字列を保存する形で着地し、Phase D で UI のみ拡張すれば schema / rule は無変更で済む設計
