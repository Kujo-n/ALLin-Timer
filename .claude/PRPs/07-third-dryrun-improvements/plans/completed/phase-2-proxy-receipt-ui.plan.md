# Plan: Phase 2 — 受付代理 UI

## Summary

運営者（organizer / owner）がトーナメントダッシュボードから参加者を代理受付できる UI を追加する。「参加者を追加」ダイアログ（タブ: メンバーから選ぶ / ゲストで追加）、名前のみ player の「管理専用」バッジ、名前のみ player の表示名修正を提供する。Phase 1 で実装済みの `proxy-receipt.ts` service と rule 経路を消費する純 UI 層 + 表示名修正用の薄い repository/service 追加で完結する。

## User Story

As a 小規模 NLH サークルの運営者,
I want トーナメントダッシュボードの手元操作だけで参加者（メンバー / 名前のみ）を代理登録し、名前のみ参加者の表示名を後から修正できる,
So that 本人スマホの充電切れ等で受付できない参加者をアプリ内で救済し、アプリの席指示と現実を一致させたまま進行できる。

## Problem → Solution

**Current**: Phase 1 で代理受付のデータ層（rule 3 ブランチ / `proxy-receipt.ts` service / `createNamedOnlyPlayer` repository / `isAcceptingProxyEntry` 述語）は完成しているが、それを呼ぶ UI が無い。運営者は参加者を代理登録する手段を持たない。
**Desired**: ダッシュボードの `PlayerList` から「参加者を追加」ダイアログを開き、(1) サークルメンバーを選んで uid 紐づけ代理登録、(2) 名前だけで `uid=null` の管理専用 player を登録できる。名前のみ player は一覧で「管理専用」と判別でき、表示名を修正できる。

## Metadata

- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/07-third-dryrun-improvements/prds/07-third-dryrun-improvements.prd.md`
- **PRD Phase**: Phase 2 — 受付代理 UI
- **Estimated Files**: 8（新規 2 / 更新 6）

---

## UX Design

### Before

```
┌─ 参加者 (3) ───────────────────────────────┐
│ リアルタイム同期中。                        │
│ ───────────────────────────────────────── │
│ Alice            Table:1, No.2   [PD] 🗑    │
│ Bob              エントリー中    [PD] 🗑    │
│ Carol            脱落                  🗑    │
└────────────────────────────────────────────┘
（運営者が参加者を追加する手段が無い）
```

### After

```
┌─ 参加者 (3)              [＋ 参加者を追加] ─┐   ← canAddParticipant のとき表示
│ リアルタイム同期中。                        │
│ ───────────────────────────────────────── │
│ Alice            Table:1, No.2   [PD] 🗑    │
│ Bob              エントリー中    [PD] 🗑    │
│ Dave 〔管理専用〕 エントリー中   ✏  🗑      │   ← uid===null は バッジ + 表示名編集
└────────────────────────────────────────────┘

［＋ 参加者を追加］を押すと:
┌─ 参加者を追加 ─────────────────────────────┐
│ [ メンバーから選ぶ ] [ ゲストで追加 ]       │  ← role=tablist（join-client パターン）
│ ───────────────────────────────────────── │
│ (メンバータブ)                              │
│   メンバー: [ ▼ Eve              ]          │  ← 未追加メンバーのみ列挙する <select>
│                                             │
│ (名前タブ)                                  │
│   表示名:   [ ____________ ] (≤15)          │
│                                             │
│ エラー表示（role="alert"）                  │
│                    [ キャンセル ] [ 追加 ]   │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| PlayerList ヘッダ | タイトルのみ | 受付可能 state で「参加者を追加」ボタン | `canAddParticipant`（= `isAcceptingProxyEntry(data)`）で gating |
| 参加者追加 | 不可 | 2 タブダイアログから代理登録 | member → `addMemberPlayerByOrganizer` / name → `addNamedOnlyPlayerByOrganizer` |
| 名前のみ player 行 | 他参加者と同表示 | 「管理専用」バッジ + 表示名編集（✏） | `p.uid === null` で判定 |
| 名前のみ player 表示名修正 | 不可 | 編集ダイアログ → 保存 | 新 `updatePlayerDisplayNameByOrganizer` service |

---

## Mandatory Reading

| Priority       | File           | Lines | Why                    |
| -------------- | -------------- | ----- | ---------------------- |
| P0 (critical)  | `src/lib/services/proxy-receipt.ts` | all | Phase 2 が消費する 2 つの service 関数（member / name-only）。シグネチャと検証フロー |
| P0 (critical)  | `src/components/tournament/PlayerList.tsx` | all | バッジ・編集・追加ボタンを差し込む対象。既存 cancel dialog の local-state パターン |
| P0 (critical)  | `src/components/auth/DisplayNameDialog.tsx` | all | ダイアログ + form + AppError/logger/loading の標準パターン（mirror 元） |
| P0 (critical)  | `src/app/join/[tid]/join-client.tsx` | 260-295 | `role="tablist"` の手動タブパターン（shadcn Tabs は未導入） |
| P1 (important) | `src/lib/services/entry-guards.ts` | all | `parseDisplayName` / `assertAcceptingEntries`。service で再利用 |
| P1 (important) | `src/lib/firebase/repositories/players.ts` | 84-161 | `upsertPlayer` / `createNamedOnlyPlayer` の隣に `updatePlayerDisplayName` を追加 |
| P1 (important) | `src/lib/firebase/schemas/group.ts` | 23,231,238-299 | `GroupDoc`（memberUids / memberDisplayNames / organizerUids）/ `deriveRole` / `assertOrganizer` / `DISPLAY_NAME_MAX_LENGTH` |
| P1 (important) | `src/app/tournaments/[tid]/dashboard-client.tsx` | 160-290,490-525 | `tournamentGroup` / `user` / `isOrganizer` / `PlayerList` 呼出箇所。新 props を渡す |
| P2 (reference) | `src/components/tournament/AppendLevelDialog.tsx` | all | ダイアログ submit + `unwrapOrFrom` の別例 |
| P2 (reference) | `src/components/tournament/AppendLevelDialog.test.tsx` | all | ダイアログのテストパターン（render / fireEvent.submit / role="alert" / onOpenChange） |
| P2 (reference) | `src/components/tournament/PlayersCard.test.tsx` | all | fixture factory `makePlayer` の形 |
| P2 (reference) | `src/lib/services/proxy-receipt.test.ts` | all | service テストの mock 境界（repository / getTournament / getGroup を mock） |
| P2 (reference) | `firestore.rules` | 590-644 | players の `allow update` organizer 経路（displayName は無制約 → 編集可。**rule 変更不要**の根拠） |

## External Documentation

No external research needed — feature uses established internal patterns（shadcn Dialog / Radix Select / 既存 service / logger / AppError）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/proxy-receipt.ts:40-50
// service 関数は動詞 + ByOrganizer、引数は named object。
export async function addMemberPlayerByOrganizer({
  tid,
  organizerUid,
  memberUid,
  displayName,
}: {
  tid: string;
  organizerUid: string;
  memberUid: string;
  displayName: string;
}): Promise<void> {
```

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:136-140
// repository は collection 名 + 動詞、第1引数 tid。
export async function createNamedOnlyPlayer(
  tid: string,
  displayName: string,
): Promise<string> {
```

### ERROR_HANDLING（service 層）

```ts
// SOURCE: src/lib/services/proxy-receipt.ts:51-65
assertNonEmptyString(tid, "tid");
assertNonEmptyString(organizerUid, "organizerUid");
const name = parseDisplayName(displayName, { maxLength: DISPLAY_NAME_MAX_LENGTH });
const t = await getTournament(tid);
const group = await getGroup(t.groupId);
assertOrganizer(group, organizerUid);          // role 再評価（UI の gid を信頼しない）
// ... membership / state ガード
```

### ERROR_HANDLING（UI 層）

```ts
// SOURCE: src/components/auth/DisplayNameDialog.tsx:44-56（mirror）
setSubmitting(true);
try {
  await addMemberPlayerByOrganizer({ tid, organizerUid, memberUid, displayName: name });
  onOpenChange(false);
} catch (e) {
  // service 側で warn 済み — UI catch は表示用 message 抽出のみ
  const wrapped = unwrapOrFrom(e, "firestore/write_failed", "参加者の追加に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code });
  setError(formatErrorForDisplay(wrapped));
} finally {
  setSubmitting(false);
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:159
// repository: 成功時 logger.info を wrap の外に置く（失敗 warn は wrapFirestoreWrite の責務）。
logger.info("named-only player create ok", { tid, pid });
```

### REPOSITORY_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:91-121（mirror for updatePlayerDisplayName）
await wrapFirestoreWrite(
  "firestore/write_failed",
  "参加者表示名の更新に失敗しました",
  async () => {
    await updateDoc(doc(playersRef(tid), pid), { displayName });
  },
  { tid, pid },
);
logger.info("player displayName update ok", { tid, pid });
```

### SERVICE_PATTERN（role 再評価）

```ts
// SOURCE: src/lib/services/proxy-receipt.ts:55-57
const t = await getTournament(tid);
const group = await getGroup(t.groupId);
assertOrganizer(group, organizerUid);
```

### TAB_PATTERN（shadcn Tabs 未導入のため手動）

```tsx
// SOURCE: src/app/join/[tid]/join-client.tsx:266-290
<div role="tablist" className="flex gap-1 border-b text-sm">
  {([["member", "メンバーから選ぶ"], ["name", "ゲストで追加"]] as [Tab, string][]).map(
    ([value, label]) => (
      <button
        key={value}
        role="tab"
        aria-selected={tab === value}
        onClick={() => { setTab(value); setError(null); }}
        className={`border-b-2 px-3 py-2 ${
          tab === value ? "border-primary font-medium" : "border-transparent text-muted-foreground"
        }`}
      >
        {label}
      </button>
    ),
  )}
</div>
```

### DIALOG_LOCAL_STATE（PlayerList に既存）

```tsx
// SOURCE: src/components/tournament/PlayerList.tsx:52,156-184
const [cancelTarget, setCancelTarget] = useState<PlayerDoc | null>(null);
// ...
<Dialog open={cancelTarget !== null} onOpenChange={(open) => { if (!open) setCancelTarget(null); }}>
```

### TEST_STRUCTURE

```ts
// SOURCE: src/components/tournament/AppendLevelDialog.test.tsx
// 1) vi.fn() で callback / service を mock、2) render + fireEvent、3) role="alert" で error 検証
const onAppend = vi.fn(async () => {});
render(<AppendLevelDialog open onOpenChange={onOpenChange} existingLevels={[level()]} onAppend={onAppend} />);
await act(async () => { fireEvent.submit(screen.getByLabelText("SB").closest("form")!); });
expect(onAppend).toHaveBeenCalledWith({ ... });
```

```ts
// SOURCE: src/components/tournament/PlayersCard.test.tsx（fixture factory）
function makePlayer(id: string, overrides: Partial<PlayerDoc> = {}): PlayerDoc {
  return { id, displayName: id, uid: id, entryAt: ts, isBusted: false, bustedAt: null,
    tableNum: null, seatNum: null, lastMovedAt: null, isPlayingDealer: false, ...overrides };
}
```

---

## Files to Change

| File                  | Action | Justification           |
| --------------------- | ------ | ----------------------- |
| `src/lib/firebase/repositories/players.ts` | UPDATE | `updatePlayerDisplayName(tid, pid, displayName)` 追加（名前のみ player の編集経路。`upsertPlayer` は uid キーのため流用不可） |
| `src/lib/services/proxy-receipt.ts` | UPDATE | `updatePlayerDisplayNameByOrganizer({ tid, organizerUid, pid, displayName })` 追加（organizer 再評価 + `parseDisplayName`） |
| `src/components/tournament/AddParticipantDialog.tsx` | CREATE | 2 タブの代理受付ダイアログ（member select / name input） |
| `src/components/tournament/PlayerList.tsx` | UPDATE | ヘッダに追加ボタン、`uid===null` バッジ + 編集ダイアログ、新 props（`group` / `organizerUid` / `canAddParticipant`） |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `PlayerList` に `group={tournamentGroup}` / `organizerUid={user.uid}` / `canAddParticipant={isAcceptingProxyEntry(data)}` を渡す |
| `src/lib/firebase/repositories/players.test.ts` | UPDATE | `updatePlayerDisplayName` の payload / error wrap テスト |
| `src/lib/services/proxy-receipt.test.ts` | UPDATE | `updatePlayerDisplayNameByOrganizer` の role / 検証 / repo 呼出形テスト |
| `src/components/tournament/AddParticipantDialog.test.tsx` | CREATE | 両タブ submit / 検証エラー / onOpenChange / メンバー除外のテスト |
| `src/components/tournament/PlayerList.test.tsx` | CREATE/UPDATE | バッジ表示・編集アフォーダンス・追加ボタン gating のテスト（既存が無ければ新規） |

## NOT Building

- **firestore.rules の変更** — create 3 ブランチは Phase 1 で完成済み。表示名修正は既存 organizer-update 経路（[firestore.rules:618-644](../../../../firestore.rules#L618-L644)）が displayName を無制約で許可するため**追加不要**。新規 emulator validator も不要。
- **メンバー player の表示名修正 UI** — メンバーの表示名は `groups/{gid}.memberDisplayNames` / 本人プロフィール由来。編集 UI は **名前のみ（uid===null）player のみ**に出す（PRD: 「名前のみ player の表示名修正」）。
- **名前のみ player の本人アカウント移行** — PRD で明示的に Won't。
- **卓を空けて閉じる / 増やす UI**（Phase 3 / 4）。
- **shadcn Tabs コンポーネントの新規導入** — 手動 `role="tablist"` で足りる（依存追加は ask モードでもあり回避）。
- **作成画面（new）からの代理受付** — スコープは開催中ダッシュボード。

---

## Step-by-Step Tasks

### Task 1: repository `updatePlayerDisplayName` 追加

- **ACTION**: `src/lib/firebase/repositories/players.ts` に名前のみ player（合成 pid）の表示名を更新する関数を追加する。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 2 (07-third-dryrun-improvements): 運営者が player の表示名のみを更新する。
   *  - 名前のみ（uid=null・合成 pid）player の入力ミス救済に使う。
   *  - `upsertPlayer` は doc id に uid を使うため合成 pid の player には流用不可。
   *  - displayName の trim / ≤15 検証は service 層（proxy-receipt）の責務。
   *  - 権限の最終防衛は Firestore Rules（organizer-update 経路。displayName は無制約）。
   */
  export async function updatePlayerDisplayName(
    tid: string,
    pid: string,
    displayName: string,
  ): Promise<void> {
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "参加者表示名の更新に失敗しました",
      async () => {
        await updateDoc(doc(playersRef(tid), pid), { displayName });
      },
      { tid, pid },
    );
    logger.info("player displayName update ok", { tid, pid });
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN / LOGGING_PATTERN（`unbustPlayer` / `createNamedOnlyPlayer` 隣接）。
- **IMPORTS**: 既存（`updateDoc` / `doc` / `wrapFirestoreWrite` / `logger` / `playersRef`）。追加 import 不要。
- **GOTCHA**: `updateDoc`（merge ではなく patch）でよい。`setDoc(..., {merge:true})` でも可だが既存パターンの `assignSeat` 等は `updateDoc`。displayName 単独 patch なら organizer-update rule（uid/entryAt immutable など）を全て満たす。
- **VALIDATE**: `npx tsc --noEmit` 0 errors。後続 Task 6 のテストで payload を確認。

### Task 2: service `updatePlayerDisplayNameByOrganizer` 追加

- **ACTION**: `src/lib/services/proxy-receipt.ts` に表示名修正 service を追加する。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 2: 運営者が代理受付した player の表示名を修正する（入力ミス救済）。
   * role 再評価 + displayName 検証は他経路と共有のガードを使う。
   */
  export async function updatePlayerDisplayNameByOrganizer({
    tid,
    organizerUid,
    pid,
    displayName,
  }: {
    tid: string;
    organizerUid: string;
    pid: string;
    displayName: string;
  }): Promise<void> {
    assertNonEmptyString(tid, "tid");
    assertNonEmptyString(organizerUid, "organizerUid");
    assertNonEmptyString(pid, "pid");
    const name = parseDisplayName(displayName, { maxLength: DISPLAY_NAME_MAX_LENGTH });
    const t = await getTournament(tid);
    const group = await getGroup(t.groupId);
    assertOrganizer(group, organizerUid);
    await updatePlayerDisplayName(tid, pid, name);
    logger.info("proxy update displayName ok", { tid, organizerUid, pid, gid: t.groupId });
  }
  ```
- **MIRROR**: SERVICE_PATTERN（`addNamedOnlyPlayerByOrganizer` と同じ role 再評価フロー）。
- **IMPORTS**: 既存 import に `updatePlayerDisplayName` を `@/lib/firebase/repositories/players` から追加（`createNamedOnlyPlayer` / `upsertPlayer` の import 行に足す）。
- **GOTCHA**: `assertAcceptingEntries` は**呼ばない**。表示名修正は finished 後でも許してよい（履歴の名前訂正）。create とはガードが異なる点に注意。
- **VALIDATE**: `npx tsc --noEmit`。Task 7 の service テストで role deny / parseDisplayName を確認。

### Task 3: `AddParticipantDialog` コンポーネント新規作成

- **ACTION**: `src/components/tournament/AddParticipantDialog.tsx` を作成。2 タブ（メンバー / 名前）で代理受付する controlled dialog。
- **IMPLEMENT**:
  - Props:
    ```ts
    interface Props {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      tid: string;
      organizerUid: string;
      group: GroupDoc;            // memberUids / memberDisplayNames を使う
      existingPlayerUids: string[]; // 既に追加済みの member を除外
    }
    ```
  - `type Tab = "member" | "name";` の `useState<Tab>("member")`。`role="tablist"` は TAB_PATTERN を mirror。
  - state: `selectedUid`（member タブ）/ `displayName`（name タブ）/ `error` / `submitting`。
  - **メンバータブ**: `group.memberUids.filter((uid) => !existingPlayerUids.includes(uid))` を candidates とし、ネイティブ `<select aria-label="メンバー">` で列挙（表示は `group.memberDisplayNames[uid] ?? uid`）。candidates が空なら「追加できるメンバーがいません」を表示。Radix `Select` ではなく**ネイティブ `<select>`** を使う（jsdom テスト容易性のため。GOTCHA 参照）。
    - submit: `await addMemberPlayerByOrganizer({ tid, organizerUid, memberUid: selectedUid, displayName: group.memberDisplayNames[selectedUid] ?? selectedUid })`。
    - メンバーの表示名は group の memberDisplayNames を渡す（player の displayName をメンバー名で初期化）。
  - **名前タブ**: `<Input aria-label="表示名" maxLength={DISPLAY_NAME_MAX_LENGTH} />` + 補助テキスト「(15 文字以内)」。
    - submit: `await addNamedOnlyPlayerByOrganizer({ tid, organizerUid, displayName })`。
  - 成功時 `onOpenChange(false)` + フォーム reset。失敗時 UI ERROR_HANDLING（`unwrapOrFrom` → `logger.warn` → `formatErrorForDisplay`、ダイアログは開いたまま）。
  - `<form onSubmit>` でタブごとに分岐、Footer に「キャンセル」「追加」ボタン（`disabled={submitting}`、ラベルは `submitting ? "追加中…" : "追加"`）。
- **MIRROR**: DisplayNameDialog（form/error/loading）、join-client（TAB_PATTERN）、AppendLevelDialog（Footer）。
- **IMPORTS**:
  ```ts
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { Button } from "@/components/ui/button";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
  import { DISPLAY_NAME_MAX_LENGTH, type GroupDoc } from "@/lib/firebase/schemas/group";
  import { logger } from "@/lib/logger";
  import { addMemberPlayerByOrganizer, addNamedOnlyPlayerByOrganizer } from "@/lib/services/proxy-receipt";
  ```
- **GOTCHA**:
  - **Radix `Select` を使わない**: Radix Select は Portal + pointer capture で jsdom テストが極めて困難。member 数は ≤20 なのでネイティブ `<select>` で十分かつ testing-library の `fireEvent.change` で素直にテストできる。
  - `group` の型は `GroupDoc`（`schemas/group.ts` の export）。`group.memberDisplayNames` は `Record<string, string>`、未登録 uid もあり得るので `?? uid` fallback。
  - 締切超過（in-progress late entry）は service が `tournament/late-entry-closed` を throw する。ダイアログ内 error として表示されれば良い（UI 側で事前ブロックしない）。
- **VALIDATE**: Task 8 のコンポーネントテストで両タブ submit と service 呼出形を確認。

### Task 4: `PlayerList` に追加ボタン・バッジ・編集を統合

- **ACTION**: `src/components/tournament/PlayerList.tsx` を更新。
- **IMPLEMENT**:
  1. Props 追加（すべて optional・後方互換）:
     ```ts
     /** 代理受付ダイアログ用。canManage かつ canAddParticipant のとき「参加者を追加」を出す。 */
     group?: GroupDoc | null;
     organizerUid?: string | null;
     /** 受付可能 state か（dashboard が isAcceptingProxyEntry(data) を渡す）。 */
     canAddParticipant?: boolean;
     ```
  2. CardHeader を flex 化し、`canManage && canAddParticipant && group && organizerUid` のとき「参加者を追加」ボタン（`onClick={() => setAddOpen(true)}`）を右寄せ配置。`<AddParticipantDialog open={addOpen} onOpenChange={setAddOpen} tid={tid} organizerUid={organizerUid} group={group} existingPlayerUids={players.filter(p => p.uid).map(p => p.uid!)} />` を render。
  3. 各行 `<span className="flex-1 truncate">{p.displayName}</span>` の隣に、`p.uid === null` のとき管理専用バッジ:
     ```tsx
     {p.uid === null ? (
       <span className="ml-1 inline-flex items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
         管理専用
       </span>
     ) : null}
     ```
  4. 行のアクション群に、`canManage && p.uid === null && organizerUid` のとき編集（✏ `Pencil`）ボタン（`onClick={() => setEditTarget(p)}`、`aria-label={`edit-${p.displayName}`}`）。
  5. 編集ダイアログを cancel dialog と同じ local-state パターンで追加（`editTarget` / `editName` / `editError` / `editSaving`）。submit で `updatePlayerDisplayNameByOrganizer({ tid, organizerUid, pid: editTarget.id, displayName: editName })`。成功で `setEditTarget(null)`。
- **MIRROR**: DIALOG_LOCAL_STATE（cancelTarget）、ERROR_HANDLING（UI）。
- **IMPORTS**: 追加 `import { Pencil } from "lucide-react";`（`Trash2` の隣）、`import { AddParticipantDialog } from "@/components/tournament/AddParticipantDialog";`、`import { Input } from "@/components/ui/input";`、`import type { GroupDoc } from "@/lib/firebase/schemas/group";`、`import { updatePlayerDisplayNameByOrganizer } from "@/lib/services/proxy-receipt";`。
- **GOTCHA**:
  - 既存呼出（live-client など PlayerList を使う箇所があれば）に新 props を渡さなくても optional なので壊れない。`canManage=false` の観戦/live では追加・編集とも出ない。
  - `existingPlayerUids` は `uid !== null` の player のみ（名前のみ player は uid を持たないのでメンバー除外に関与しない）。
  - バッジは truncate する displayName の外（兄弟要素）に置き、行幅を圧迫しないよう `flex-shrink-0`。
- **VALIDATE**: Task 8 の PlayerList テストでバッジ・編集ボタンの表示条件を確認。

### Task 5: `dashboard-client.tsx` から新 props を渡す

- **ACTION**: [dashboard-client.tsx:517-524](../../../../src/app/tournaments/[tid]/dashboard-client.tsx#L517-L524) の `PlayerList` 呼出に props を追加。
- **IMPLEMENT**:
  ```tsx
  <PlayerList
    tid={tid}
    players={players}
    subscribeError={playersError}
    canManage={isMember}
    tournamentState={data.state}
    onTogglePd={handleTogglePd}
    group={tournamentGroup}
    organizerUid={user.uid}
    canAddParticipant={isAcceptingProxyEntry(data)}
  />
  ```
- **MIRROR**: 既存 props の渡し方。
- **IMPORTS**: `isAcceptingProxyEntry` を `@/lib/services/tournament-state` から import（既存 import 群に追加。`canEditTournament` 等と同じ source）。
- **GOTCHA**: `tournamentGroup` / `user` はこの render 位置で確定済み（line 276-284 の guard 通過後）。`data` も non-null。`isAcceptingProxyEntry(t: TournamentDoc)` は TournamentDoc を取る（state 文字列ではない）。
- **VALIDATE**: `npx tsc --noEmit` + `npm run build`。

### Task 6: repository テスト追加

- **ACTION**: `src/lib/firebase/repositories/players.test.ts` に `updatePlayerDisplayName` のテストを追加。
- **IMPLEMENT**: 既存 `createNamedOnlyPlayer` のテストと同じ mock 境界で、(1) `updateDoc` が `{ displayName }` で呼ばれる、(2) 失敗時 `firestore/write_failed` が throw、を検証。
- **MIRROR**: 既存 players.test.ts の mock（`vi.mock("firebase/firestore")` 境界）。
- **VALIDATE**: `npm run test -- players.test`。

### Task 7: service テスト追加

- **ACTION**: `src/lib/services/proxy-receipt.test.ts` に `updatePlayerDisplayNameByOrganizer` のテストを追加。
- **IMPLEMENT**: 既存 service テストの mock（`getTournament` / `getGroup` / repository を mock）で、(1) organizer のとき `updatePlayerDisplayName(tid, pid, trimmedName)` が呼ばれる、(2) member（非 organizer）のとき `group/not-organizer` で deny、(3) 空表示名で `validation/display-name-required`、(4) 16 字で `validation/display-name-too-long`、(5) `assertAcceptingEntries` を**呼ばない**（finished tournament でも成功する）ことを確認。
- **MIRROR**: `proxy-receipt.test.ts` の既存 11 ケース。
- **VALIDATE**: `npm run test -- proxy-receipt.test`。

### Task 8: コンポーネントテスト追加

- **ACTION**: `AddParticipantDialog.test.tsx`（新規）と `PlayerList.test.tsx`（新規 or 既存更新）。
- **IMPLEMENT**:
  - `AddParticipantDialog.test.tsx`: proxy-receipt service を `vi.mock` し、(1) メンバータブで select 変更 → submit → `addMemberPlayerByOrganizer` が選択 uid + memberDisplayName で呼ばれる、(2) 名前タブで input → submit → `addNamedOnlyPlayerByOrganizer` が呼ばれる、(3) service が AppError throw 時に `role="alert"` 表示 + `onOpenChange(false)` が呼ばれない、(4) `existingPlayerUids` に含まれる member が select に出ない、(5) 追加できるメンバーがいないとき案内表示。
  - `PlayerList.test.tsx`: fixture factory `makePlayer`。(1) `uid===null` の行に「管理専用」バッジ + `edit-*` ボタンが出る、(2) `uid!==null` の行には出ない、(3) `canManage && canAddParticipant && group && organizerUid` のとき「参加者を追加」ボタンが出る / `canAddParticipant=false` で出ない、(4) 編集 submit で `updatePlayerDisplayNameByOrganizer` が呼ばれる（service mock）。
- **MIRROR**: AppendLevelDialog.test / PlayersCard.test。
- **GOTCHA**: ネイティブ `<select>` は `fireEvent.change(screen.getByLabelText("メンバー"), { target: { value: uid } })` でテスト可。Radix Dialog はテストで `open` prop を直接渡せば render される（AppendLevelDialog.test と同様）。
- **VALIDATE**: `npm run test -- AddParticipantDialog PlayerList`。

### Task 9: E2E スペック（Should・任意）

- **ACTION**: 既存 E2E 基盤があれば「運営者がメンバー / 名前のみを追加 → PlayerList に反映 → 名前のみは管理専用バッジ」を 1 本追加。
- **IMPLEMENT**: `tests/e2e/` の既存 Page Object Model に倣う。emulator + Playwright。
- **GOTCHA**: emulator 起動コストが高いため、最低限ダッシュボードで 2 方式追加 → 反映までを 1 spec に集約。Phase 1 rules が emulator/本番に反映済みであること（前提）。
- **VALIDATE**: `npm run test:e2e`（該当 spec）。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `updatePlayerDisplayName` payload | tid, pid, "新名" | `updateDoc(doc, { displayName: "新名" })` | - |
| `updatePlayerDisplayName` 失敗 | updateDoc reject | throw `firestore/write_failed` | ✓ |
| `updatePlayerDisplayNameByOrganizer` organizer | organizer uid | repo 呼出 + info ログ | - |
| 同 非 organizer | member uid | throw `group/not-organizer` | ✓ |
| 同 空名 | "" | throw `validation/display-name-required` | ✓ |
| 同 16 字 | 16 文字 | throw `validation/display-name-too-long` | ✓ |
| 同 finished tournament | state=finished | 成功（accepting ガード無し） | ✓ |
| AddParticipantDialog member submit | select uid → 追加 | `addMemberPlayerByOrganizer` 呼出 + close | - |
| AddParticipantDialog name submit | "Dave" → 追加 | `addNamedOnlyPlayerByOrganizer` 呼出 + close | - |
| AddParticipantDialog service error | service throw | `role="alert"` 表示・close されない | ✓ |
| AddParticipantDialog member 除外 | existingPlayerUids に既存 | select に出ない | ✓ |
| AddParticipantDialog 候補ゼロ | 全員追加済み | 案内表示・追加 disabled | ✓ |
| PlayerList バッジ | `uid===null` player | 「管理専用」+ edit ボタン | ✓ |
| PlayerList 追加ボタン gating | `canAddParticipant=false` | ボタン非表示 | ✓ |

### Edge Cases Checklist

- [x] Empty input（空表示名 → validation/display-name-required）
- [x] Maximum size input（16 字 → too-long）
- [ ] Invalid types（UI は string のみ。N/A）
- [x] Concurrent access（同 member 二重追加は `upsertPlayer` merge で冪等。重複 select は除外で予防）
- [ ] Network failure（service の wrap が `firestore/write_failed` 化 → ダイアログ error 表示）
- [x] Permission denied（非 organizer → `group/not-organizer`。本番では rule deny も二重防御）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```

EXPECT: Zero type errors

```bash
npx next lint
```

EXPECT: No warnings（`console.*` 直呼び・未使用 import の混入なし）

### Unit Tests

```bash
npm run test -- proxy-receipt players AddParticipantDialog PlayerList
```

EXPECT: All affected tests pass

### Full Test Suite

```bash
npm run test
```

EXPECT: No regressions（Phase 1 の 1479 件 + 本 Phase 追加分が green）

### Build

```bash
npm run build
```

EXPECT: `next build` success

### Database / Rules Validation（変更なしの確認）

本 Phase は `firestore.rules` を変更しない。Phase 1 の rules が**本番 deploy 済み**であることが前提:

```bash
firebase deploy --only firestore:rules
```

EXPECT: Phase 1 report の「⚠ 本番反映が必須」が未実施なら先に実行。実施済みなら no-op。

### Manual Validation

- [ ] organizer でダッシュボードを開き「参加者を追加」→ メンバータブで未追加メンバーを選び追加 → PlayerList に反映
- [ ] 名前タブで「Dave」を追加 → 「管理専用」バッジ付きで反映
- [ ] 名前のみ player の ✏ から表示名を「Dave2」に修正 → 反映
- [ ] 締切超過の running トーナメントで名前追加 → late-entry-closed エラーがダイアログ内に表示
- [ ] 16 字入力 → too-long エラー表示

---

## Acceptance Criteria

- [ ] All tasks completed
- [ ] All validation commands pass
- [ ] Tests written and passing（service / repository / component）
- [ ] No type errors
- [ ] No lint errors
- [ ] Matches UX design（追加ボタン / 2 タブ / バッジ / 編集）

## Completion Checklist

- [ ] Code follows discovered patterns（service role 再評価 / UI unwrapOrFrom / logger / wrapFirestoreWrite）
- [ ] Error handling matches codebase style（AppError + logger.warn、UI は formatErrorForDisplay）
- [ ] Logging follows conventions（repository info ログ、service info ログ）
- [ ] Tests follow test patterns（fixture factory / vi.mock 境界 / role="alert"）
- [ ] No hardcoded values（`DISPLAY_NAME_MAX_LENGTH` を import、state は `isAcceptingProxyEntry`）
- [ ] ユーザー向けメッセージに技術スタック名を出さない（"Firebase" 等を dialog/toast に露出しない）
- [ ] No unnecessary scope additions（rules / Phase 3-4 に触れない）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Phase 1 rules が本番未 deploy で代理 create が permission-denied | M | H | Phase 2 着手前に `firebase deploy --only firestore:rules`（Phase 1 report 既出） |
| Radix `Select` をメンバー選択に使うと jsdom テストが破綻 | M | M | ネイティブ `<select>` を採用（Task 3 GOTCHA） |
| `PlayerList` の既存呼出元（live 等）に props 追加で破壊 | L | M | 全新 props を optional に。`canManage=false` で追加/編集とも非表示 |
| 開催中の締切超過で混乱（ボタンは出るが追加失敗） | L | L | service の `late-entry-closed` をダイアログ error として表示。PRD 方針（事前ブロックせず警告）に合致 |
| メンバー表示名（memberDisplayNames 未登録）で空に | L | L | `?? uid` fallback。service の `parseDisplayName` が空を弾く |

## Notes

- **rule 変更なしの根拠**: create は Phase 1 の 3 ブランチで完成。表示名修正は organizer-update 経路（[firestore.rules:618-644](../../../../firestore.rules#L618-L644)）が `uid`/`entryAt` immutable・`isBusted is bool`・table/seat 範囲・`isPlayingDealer is bool` のみを enforce し **displayName を無制約**で許可するため、`updateDoc({ displayName })` がそのまま通る。新 emulator validator は不要。
- **member-proxy は `upsertPlayer` 冪等**: 同一メンバーを誤って二重追加しても merge で冪等。UI でも `existingPlayerUids` で除外して予防。
- **名前のみ player と `/live`**: uid=null player は本人端末で `/live` を開けない（Auth 無し）。管理専用バッジで運営者に明示する（PRD Open Question / 次回ドライランで運用十分性を検証）。
- **並行性**: 本 Phase（要望①系列）は Phase 3（卓操作）と独立。最終統合時に SeatingBoard / dashboard のマージ競合のみ確認（PRD Parallelism Notes）。
