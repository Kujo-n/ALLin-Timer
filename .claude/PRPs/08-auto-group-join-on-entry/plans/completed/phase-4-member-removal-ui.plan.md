# Plan: Phase 4 — メンバー除外 UI

## Summary

オーナーがサークル詳細画面のメンバー一覧から他メンバーを外せるようにする。`groups/{gid}` の **owner-update 経路は既に `memberUids` を含むフル update を許可済み**（[firestore.rules:113-120](../../../../firestore.rules#L113-L120)）なので、**Firestore Rules / zod schema の変更は一切不要**。不足しているのは repository 1 関数 + service 1 関数 + UI（一覧のボタン ＋ 確認ダイアログ）だけである。自動所属（Phase 1〜3）の副作用（誤参加者・一見さんの滞留）に対する事後回収手段であり、PRD の Q7「後で削除できれば問題なし」という許容条件そのものを満たす。

## User Story

As a **サークルのオーナー**,
I want **メンバー一覧から誤って加入した人を外せること**,
So that **トーナメント受付による自動所属を安心して有効化できる**。

## Problem → Solution

**現状**: サークルからメンバーを外す経路は `removeMemberSelf`（本人による自己脱退）のみ。オーナーが他人を外す UI も service も存在しない（rule 上は owner のフル update で可能なのに呼び出し口がない）。自動所属（PRD 08 の中核）を入れると、トーナメント QR を読んだ人が全員メンバーになるため、誤参加者を消す手段がないと運用者が自動所属を有効にできない。

**あるべき姿**: オーナーがメンバー一覧の「除外」ボタン → 確認ダイアログ → 確定で、対象を `memberUids` / `organizerUids` / `ownerUids` / `memberDisplayNames[uid]` から整合的に除去できる。最後のオーナー・自分自身は service + UI の二重ガードで守る。

## Metadata

- **Complexity**: Small〜Medium
- **Source PRD**: [.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md)
- **PRD Phase**: Phase 4「メンバー除名 UI」
- **Estimated Files**: 9（新規 3 / 更新 6）
- **依存**: なし（Phase 1〜3 と完全独立。rule 変更・schema 変更を伴わないため並行着手可能）

---

## UX Design

### Before

```
┌─ サークル詳細 /groups/[gid] ─────────────────────┐
│ [メンバー] [シーズン] [設定]                     │
│                                                  │
│ ── メンバー ─────────────────────────────────── │
│  山田太郎          [オーナー] [あなた]           │
│  佐藤花子          [運営]  (運営へ降格)(ｵｰﾅｰ昇格)│
│  誤って入った人    [一般]  (運営へ昇格)          │
│                              ↑                   │
│                    昇降格しかできない。           │
│                    外す手段が存在しない。         │
└──────────────────────────────────────────────────┘
```

### After

```
┌─ サークル詳細 /groups/[gid] ─────────────────────┐
│ ── メンバー ─────────────────────────────────── │
│  山田太郎          [オーナー] [あなた]           │
│  佐藤花子          [運営] (運営へ降格)(ｵｰﾅｰ昇格) │
│                                      (除外) ←赤  │
│  誤って入った人    [一般] (運営へ昇格) (除外)    │
└──────────────────────────────────────────────────┘
                     ↓ click
┌─ 確認ダイアログ ─────────────────────────────────┐
│ メンバーを除外                                    │
│ 「誤って入った人」を「土曜サークル」から          │
│ 除外します。除外されたメンバーはこのサークルの     │
│ トーナメント／ストラクチャを閲覧できなくなります。 │
│ 過去のトーナメントの参加記録とシーズン戦績は       │
│ そのまま残ります。                                │
│                        [キャンセル] [除外する]    │
└──────────────────────────────────────────────────┘
                     ↓ 確定
        メンバー一覧から即座に消える（reload + refreshGroups）
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| メンバー一覧の行（owner 視点・他人の行） | 昇降格ボタンのみ | ＋「除外」ボタン（`variant="destructive"`） | 自分の行には出さない |
| メンバー一覧の行（organizer / member 視点） | 操作ボタンなし | **変更なし** | 除外は owner 限定（rule も owner-update 経路のみ） |
| 確認ダイアログ | 脱退 / 削除 / シーズン開始の 3 種 | ＋ メンバー除外 | `StartSeasonDialog` と同形の単一目的 dialog |
| 除外された側のサークル一覧 | — | 次回アプリ起動 / `refreshGroups` 時に当該サークルが消える | `GroupProvider` の stale `groupIds` 自己修復が既に実装済み（後述） |
| Firestore Rules | owner-update がフル update を許可 | **変更なし** | 新ブランチ・新フィールドともに不要 |

---

## Mandatory Reading

実装前に必ず読むファイル。

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 172-227 | `removeMemberSelf` — 新規 `removeOtherMember` はこの構造を 1:1 でミラーする（`arrayRemove` × 3 + `deleteField()`） |
| P0 | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 723-835 | `promoteToOrganizer` / `demoteOwner` — `getGroup` → `assertOwner` → 事前ガード → repository → `logger.info` の service 定型 |
| P0 | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 215-243 | `leaveGroup` — 「既にメンバーでない」を no-op で返す冪等パターン |
| P0 | [src/app/groups/[gid]/_components/MemberRoleList.tsx](../../../../src/app/groups/%5Bgid%5D/_components/MemberRoleList.tsx) | all | 除外ボタンを差し込む先。`isOwner && !isSelf` ガードと `onlyOwner` disabled の既存構造 |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | 280-353, 381-411, 512-528 | `runReloadRefreshAction` helper / `MemberRoleList` の callback 配線 / dialog 群の render 位置 |
| P0 | [firestore.rules](../../../../firestore.rules) | 113-120 | owner-update ブランチ。**制約は `ownerUids.size() >= 1` と `createdAt` 不変のみ**（`affectedKeys` 制限なし）＝ rule 変更不要の根拠 |
| P1 | [src/app/groups/[gid]/_components/StartSeasonDialog.tsx](../../../../src/app/groups/%5Bgid%5D/_components/StartSeasonDialog.tsx) | all | 単一目的 confirm dialog の雛形（`RemoveMemberDialog` はこれをミラー） |
| P1 | [src/app/groups/[gid]/_components/LeaveDeleteDialogs.tsx](../../../../src/app/groups/%5Bgid%5D/_components/LeaveDeleteDialogs.tsx) | all | destructive 確認ダイアログの文言・ボタン配置の先例 |
| P1 | [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | 1-80, 135-164, 1221-1262 | mock 境界（repository で割る）/ `makeGroup` fixture factory / `demoteOwner` の describe 構成 |
| P1 | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 237-298 | `deriveRole` / `assertOwner` / `isSoleOwner` — 新 service が使う pure helper |
| P1 | [src/lib/errors.ts](../../../../src/lib/errors.ts) | all | `AppError` / `assertNonEmptyString` / `formatErrorForDisplay` / `unwrapOrFrom` |
| P2 | [src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx](../../../../src/app/groups/%5Bgid%5D/_components/GroupDefaultTableLabelsCard.test.tsx) | all | component test の書き方（`render` + `fireEvent` + `getByRole`/`getByLabelText`） |
| P2 | [tests/e2e/member-role-split.spec.ts](../../../../tests/e2e/member-role-split.spec.ts) | all | 2 browser context（owner / member）で招待コード加入まで通す E2E 雛形 |
| P2 | [tests/e2e/pages/GroupsPage.ts](../../../../tests/e2e/pages/GroupsPage.ts) | `GroupDetailPage` 全体 | POM に locator を足す先。タブ切替 helper の既存規約 |
| P2 | [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) | 90-110 | **stale `groupIds` の自己修復**が既に実装済み（`failedGids` → `removeGroupIdFromUser`）。除外後の挙動の根拠 |
| P2 | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | 権限マトリクス / 実装上の注意 | 更新先 |

## External Documentation

**外部調査は不要** — 既存の内部パターン（owner-update 経路 / `arrayRemove` + `deleteField()` / shadcn Dialog / Playwright POM）だけで完結する。新規依存の追加もなし。

---

## Patterns to Mirror

### NAMING_CONVENTION（layer ごとに動詞を変える）

```ts
// SOURCE: src/lib/services/group.ts:348 / src/lib/firebase/repositories/groups.ts:269
// service: set* / promote* / demote* / leave*  → 意図を表す動詞
export async function setFinishedTournamentCount({ gid, uid, value }) { ... }
// repository: update* / remove* / add*         → Firestore 操作を表す動詞
export async function updateFinishedTournamentCount(gid: string, value: number) { ... }
```

要点: service と repository で**同名を避ける**（`group.ts` は repository を named import するため衝突する）。本 Phase は service `removeMemberByOwner` / repository `removeOtherMember` と割る（`removeMemberSelf` と対になる命名）。

### REPOSITORY_PATTERN（配列 3 本 + map key の整合除去）

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:179-194
export async function removeMemberSelf(gid: string, uid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル脱退に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayRemove(uid),
        organizerUids: arrayRemove(uid),
        ownerUids: arrayRemove(uid),
        [`memberDisplayNames.${uid}`]: deleteField(),
      });
    },
    { gid, uid },
  );
  logger.info("group remove member ok", { gid, uid });
}
```

要点: 3 配列 + map key を **1 回の `updateDoc` で atomic に**外す。成功ログ（`logger.info`）は `wrapFirestoreWrite` の**外**（失敗 warn は wrap が担当、二重 warn 禁止）。

### SERVICE_PATTERN（read → assert → ガード → repository → info）

```ts
// SOURCE: src/lib/services/group.ts:814-835
export async function demoteOwner({ gid, actorUid, targetUid }): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.ownerUids.includes(targetUid)) {
    return;                                  // 冪等 no-op
  }
  if (group.ownerUids.length <= 1) {
    throw new AppError("最後のオーナーは降格できません", "group/last-owner");
  }
  await updateGroupRoles(gid, {
    ownerUids: group.ownerUids.filter((u) => u !== targetUid),
  });
  logger.info("demote owner", { gid, actorUid, targetUid });
}
```

```ts
// SOURCE: src/lib/services/group.ts:227-231（「既にメンバーでない」の no-op 分岐）
if (!group.memberUids.includes(uid)) {
  logger.info("leave group: already not a member", { gid, uid });
  await removeGroupIdFromUser(uid, gid).catch(() => {});
  return;
}
```

### ERROR_HANDLING（ドメインコード + 日本語メッセージ）

```ts
// SOURCE: src/lib/services/group.ts:221-226 / 828-830
throw new AppError(
  "最後のオーナーは脱退できません。先に別のメンバーをオーナーに昇格するか group を削除してください。",
  "group/last-owner-cannot-leave",
);
throw new AppError("最後のオーナーは降格できません", "group/last-owner");
```

```ts
// SOURCE: src/lib/errors.ts:83-93（入口の防御）
assertNonEmptyString(gid, "gid");
```

要点: `throw new Error` 禁止、必ず `AppError` + `group/*` prefix。ユーザー向けメッセージに技術スタック名を出さない。

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/group.ts:747 / 834
logger.info("promote to organizer", { gid, actorUid, targetUid });
logger.info("demote owner", { gid, actorUid, targetUid });
```

要点: `console.*` 禁止。成功は `info`、best-effort 失敗は `warn`。

### UI_DIALOG_PATTERN（単一目的の confirm dialog）

```tsx
// SOURCE: src/app/groups/[gid]/_components/StartSeasonDialog.tsx:19-55
export function StartSeasonDialog({ open, onOpenChange, onConfirm, working }: {
  open: boolean;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  working: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>シーズンを開始しますか？</DialogTitle>
          <DialogDescription>…</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            キャンセル
          </Button>
          <Button onClick={onConfirm} disabled={working}>
            {working ? "開始中…" : "開始する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

### UI_ACTION_PATTERN（親 client の共通アクション helper）

```tsx
// SOURCE: src/app/groups/[gid]/group-detail-client.tsx:294-353
async function runReloadRefreshAction(
  fn: () => Promise<unknown>,
  options: { errorCode: string; errorMessage: string; closeDialog?: () => void },
): Promise<void> {
  setWorking(true);
  setError(null);
  try {
    await fn();
    await reload();
    await refreshGroups();
  } catch (e) {
    const err = unwrapOrFrom(e, options.errorCode, options.errorMessage);
    setError(formatErrorForDisplay(err));
  } finally {
    options.closeDialog?.();
    setWorking(false);
  }
}
```

要点: 新アクションは**必ずこの helper 経由**にする（setWorking / setError / reload / refreshGroups / dialog close の 5 責務が揃う）。

### TEST_STRUCTURE（service unit test）

```ts
// SOURCE: src/lib/services/group.test.ts:1093-1105
it("throws group/not-owner when actor is not an owner", async () => {
  vi.mocked(getGroup).mockResolvedValue(
    makeGroup({
      ownerUids: ["u-owner"],
      organizerUids: ["u-owner", "u-actor"],
      memberUids: ["u-owner", "u-actor", "u-target"],
    }),
  );
  await expect(
    promoteToOrganizer({ gid: "g1", actorUid: "u-actor", targetUid: "u-target" }),
  ).rejects.toMatchObject({ code: "group/not-owner" });
  expect(updateGroupRoles).not.toHaveBeenCalled();
});
```

```ts
// SOURCE: src/lib/services/group.test.ts:135-164（fixture factory）
function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return { id: "g1", name: "Saturday", ownerUids, organizerUids, memberUids, /* … */ ...overrides };
}
```

### TEST_STRUCTURE（component test）

```tsx
// SOURCE: src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx:22-56
const onSave = vi.fn().mockResolvedValue(undefined);
render(<GroupDefaultTableLabelsCard labels={[]} colors={[]} canEdit onSave={onSave} />);
fireEvent.click(screen.getByRole("button", { name: "編集" }));
expect(screen.getByLabelText("default-table-label-1")).toBeInTheDocument();
```

### E2E_STRUCTURE（owner / member の 2 context）

```ts
// SOURCE: tests/e2e/member-role-split.spec.ts:26-45
const owner = randomOrganizer("owner");
await registerOrganizer(page, owner);
const gid = await createGroup(page, "Role Split Group");
const inviteUrl = await issueInviteUrl(page, gid);

const browser = page.context().browser();
if (!browser) throw new Error("browser unavailable");
const memberCtx = await browser.newContext();
try {
  const memberPage = await memberCtx.newPage();
  const member = randomOrganizer("member");
  await registerOrganizer(memberPage, member);
  const joinedGid = await consumeInviteUrl(memberPage, inviteUrl);
  expect(joinedGid).toBe(gid);
  // …
} finally {
  await memberCtx.close();
}
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | UPDATE | `removeOtherMember(gid, targetUid)` を追加（`removeMemberSelf` の直後） |
| [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | UPDATE | `removeMemberByOwner({ gid, actorUid, targetUid })` を追加（`demoteOwner` の直後） |
| [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | UPDATE | mock に `removeOtherMember` を追加 ＋ `describe("removeMemberByOwner")` を 7 ケース追加 |
| [src/app/groups/[gid]/_components/MemberRoleList.tsx](../../../../src/app/groups/%5Bgid%5D/_components/MemberRoleList.tsx) | UPDATE | 「除外」ボタン ＋ `onRemoveMember` prop |
| `src/app/groups/[gid]/_components/MemberRoleList.test.tsx` | CREATE | ボタン表示条件の component test（4 ケース） |
| `src/app/groups/[gid]/_components/RemoveMemberDialog.tsx` | CREATE | 除外確認ダイアログ（`StartSeasonDialog` と同形） |
| [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | UPDATE | `removeTarget` state ＋ `onRemoveMember` ハンドラ ＋ dialog render |
| `tests/e2e/member-removal.spec.ts` | CREATE | 除外 → 一覧から消える → 再加入できる の E2E（2 ケース） |
| [tests/e2e/pages/GroupsPage.ts](../../../../tests/e2e/pages/GroupsPage.ts) | UPDATE | `GroupDetailPage` に除外まわりの locator / helper を追加 |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | UPDATE | 権限マトリクスに行追加 ＋ 除外経路の節を追加（stale `groupIds` の既知制約を明記） |
| [.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md) | UPDATE | Phase 4 を `pending` → `in-progress` ＋ 本 plan へのリンク |

## NOT Building

- **Firestore Rules の変更** — owner-update 経路（[firestore.rules:113-120](../../../../firestore.rules#L113-L120)）が既に `memberUids` を含むフル update を許可しており、追加ブランチも新 helper も不要。**rule ファイルには一切触らない**（触ると Phase 1 の rule 変更とコンフリクトする）。
- **zod schema の変更** — 新フィールドなし。`groupBodySchema` は無変更。
- **除外された uid の `users/{uid}.groupIds` 更新** — 他人の `users/{uid}` は rule で書けない（`deleteGroupByOwner` と同じ既知制約）。除外された本人側の `GroupProvider` が `failedGids` 経由で自己修復するため追加実装しない（[current-group.tsx:95-101](../../../../src/lib/services/current-group.tsx#L95-L101)）。
- **除外された uid の `seasonStats/{uid}` / 過去 `players/{pid}` の削除** — 履歴の継続性のため意図的に残す（`deleteAccount` と同方針）。
- **organizer への除外権限の付与** — owner 限定（rule も owner-update 経路のみ）。
- **ban リスト / 再加入ブロック** — PRD で明示的に対象外。
- **自動所属（Phase 1〜3）との結線** — 完全独立。`receipt.ts` / `join-client.tsx` / `auto-group-join.ts` には触らない。
- **業務仕様書（`docs/specification/02-circles-and-membership.spec.md`）の改訂** — 2.2.6「運用系: メンバーの除外」と権限表（`メンバーを除外 | ○ | × | × | ×`）が**既に本機能を記述済み**。本 Phase は仕様書の記述に実装を追い付かせる位置づけで、文言変更は不要（UI 文言もそれに合わせて「除外」に統一する。後述 Notes 参照）。
- **一括除外 / 複数選択** — 1 人ずつ。
- **除外の監査ログ（誰がいつ誰を外したか）** — Firestore に記録しない。`logger.info` のみ。

---

## Step-by-Step Tasks

### Task 1: `repositories/groups.ts` に `removeOtherMember` を追加

- **ACTION**: `removeMemberSelf`（[groups.ts:179-194](../../../../src/lib/firebase/repositories/groups.ts#L179-L194)）の**直後**に新関数を追加する。
- **IMPLEMENT**:

```ts
/**
 * Phase 4 (08-auto-group-join-on-entry): owner が**他メンバー**を除外する。
 *
 * `removeMemberSelf`（自己脱退）と対になる owner-update 経路の書込。
 *   - rule 側は `groups/{gid}` の owner-update ブランチ（`isSignedIn()` +
 *     `auth.uid in resource.data.ownerUids` + `ownerUids.size() >= 1` +
 *     `createdAt` 不変）だけで成立する。**新ブランチ・新フィールドは不要**。
 *   - `ownerUids` からも外すのは invariant（ownerUids ⊆ organizerUids ⊆ memberUids）
 *     を保つため。対象が最後の owner の場合は rule の `ownerUids.size() >= 1` で
 *     deny されるが、その前に service (`removeMemberByOwner`) が弾く二重防御。
 *   - `arrayRemove` は対象が配列に含まれない場合 no-op なので、role によらず 3 本
 *     まとめて外してよい（`removeMemberSelf` と同じ考え方）。
 *   - `memberDisplayNames[targetUid]` も `deleteField()` で同時に消す。残すと
 *     除外済みの人の表示名がメンバー一覧の裏側に残留する。
 *
 * ⚠ 除外対象の `users/{uid}.groupIds` は**本人以外書き換えられない**（rule の
 *   `users/{uid}` は self-only）。stale な gid は対象者側の `GroupProvider` が
 *   `listMyGroups` の `failedGids` 経由で自己修復する（services/current-group.tsx）。
 */
export async function removeOtherMember(gid: string, targetUid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "メンバーの除外に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayRemove(targetUid),
        organizerUids: arrayRemove(targetUid),
        ownerUids: arrayRemove(targetUid),
        [`memberDisplayNames.${targetUid}`]: deleteField(),
      });
    },
    { gid, targetUid },
  );
  logger.info("group remove other member ok", { gid, targetUid });
}
```

- **MIRROR**: REPOSITORY_PATTERN
- **IMPORTS**: 追加不要 — `arrayRemove` / `deleteField` / `updateDoc` / `wrapFirestoreWrite` / `logger` はすべて [groups.ts:1-37](../../../../src/lib/firebase/repositories/groups.ts#L1-L37) で import 済み。
- **GOTCHA**:
  - repository のエラーコードは [firebase-patterns.md](../../../rules/firebase-patterns.md) に従い **`firestore/write_failed`** のまま。ドメインコード（`group/*`）への写像は service 層の責務。
  - `logger.info` は `wrapFirestoreWrite` の**外**に置く（wrap は失敗時の warn のみ責任を持つ）。
  - `updateDoc` を 1 回にまとめる（3 回に分けると部分適用で invariant が壊れる）。
- **VALIDATE**: `npm run typecheck` / `npm run lint`。

### Task 2: `services/group.ts` に `removeMemberByOwner` を追加

- **ACTION**: `demoteOwner`（[group.ts:814-835](../../../../src/lib/services/group.ts#L814-L835)）の**直後**、ファイル末尾に追加する。
- **IMPLEMENT**:

```ts
/**
 * Phase 4 (08-auto-group-join-on-entry): owner が他メンバーをサークルから除外する。
 *
 * PRD 08 の自動所属（トーナメント受付でメンバーになる）の副作用 —— 誤参加者・
 * 一見さんの滞留 —— に対する事後回収手段。rule 変更は不要で、owner-update 経路
 * （`memberUids` を含むフル update）にそのまま乗る。
 *
 * ガード（すべて service + UI の二重防御）:
 *   1. **自分自身は除外できない** — 脱退は `leaveGroup`（別導線）を使う。
 *      オーナーが自分を消して owner 不在になる事故を防ぐ。
 *   2. actor が owner であること（`assertOwner`）。organizer は不可。
 *   3. 対象が既にメンバーでなければ **no-op で return**（冪等。多端末での二重押し対策）。
 *   4. 対象が owner かつ owner が 1 人しかいない場合は deny。
 *      （1. により actor ≠ target なので、target が owner なら owner は 2 人以上
 *        存在するはず。到達しない防御だが `demoteOwner` と条件を揃えて明示する）
 *
 * ⚠ 除外対象の `users/{uid}.groupIds` は本人以外書き換えられないため stale が残る。
 *   対象者のアプリ側で `GroupProvider` が `failedGids` として検出し自己修復する。
 *   過去トーナメントの `players/{pid}` と `seasonStats/{uid}` は履歴として意図的に残す。
 */
export async function removeMemberByOwner({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  assertNonEmptyString(gid, "gid");
  assertNonEmptyString(actorUid, "actorUid");
  assertNonEmptyString(targetUid, "targetUid");
  if (actorUid === targetUid) {
    throw new AppError(
      "自分自身は除外できません。サークルを抜ける場合は「脱退」を使用してください",
      "group/cannot-remove-self",
    );
  }
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.memberUids.includes(targetUid)) {
    logger.info("remove member: already not a member", { gid, actorUid, targetUid });
    return;
  }
  if (group.ownerUids.includes(targetUid) && group.ownerUids.length <= 1) {
    throw new AppError("最後のオーナーは除外できません", "group/last-owner");
  }
  await removeOtherMember(gid, targetUid);
  logger.info("remove member by owner ok", { gid, actorUid, targetUid });
}
```

- **MIRROR**: SERVICE_PATTERN / ERROR_HANDLING / LOGGING_PATTERN
- **IMPORTS**: `@/lib/firebase/repositories/groups` の named import 一覧（[group.ts:19-35](../../../../src/lib/services/group.ts#L19-L35)）に **`removeOtherMember` を追加**（アルファベット順で `removeMemberSelf` の直後）。`assertNonEmptyString` を `@/lib/errors` の import に追加（現在 `AppError` / `getErrorCode` のみ）。`AppError` / `assertOwner` / `getGroup` / `logger` は既に import 済み。
- **GOTCHA**:
  - 自己除外チェックは **`getGroup` の前**（read を無駄に消費しないフェイルファスト）。
  - `group/cannot-remove-self` は新規ドメインコードだが prefix `group/*` は [error-logging.md](../../../rules/error-logging.md) に登録済みのため rule ファイルの更新は不要。
  - 「対象がメンバーでない」は throw ではなく **no-op return**（`leaveGroup` の先例）。`promoteToOrganizer` は `group/not-member` を throw するが、除外は「結果的にいなくなっていればよい」操作なので冪等側に倒す。
  - `AppError.from` ではなく `new AppError(...)` を使う（ここが初出の throw であり、既存エラーの再ラップではない）。
- **VALIDATE**: Task 3 の unit test が全 green。

### Task 3: `services/group.test.ts` に `removeMemberByOwner` の unit test を追加

- **ACTION**: mock 定義に `removeOtherMember` を追加し、`describe("demoteOwner")` ブロックの直後に新 describe を追加する。
- **IMPLEMENT**:

1. [group.test.ts:26-39](../../../../src/lib/services/group.test.ts#L26-L39) の `vi.mock("@/lib/firebase/repositories/groups", ...)` に 1 行追加:

```ts
  removeOtherMember: vi.fn(),
```

2. import 文に `removeMemberByOwner`（service）と `removeOtherMember`（repository mock 参照用）を追加。

3. 新 describe（7 ケース）:

```ts
describe("removeMemberByOwner", () => {
  // 1. 正常系: 一般メンバーの除外
  it("removes a plain member via removeOtherMember", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    await removeMemberByOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });
    expect(removeOtherMember).toHaveBeenCalledWith("g1", "u-target");
  });

  // 2. 正常系: organizer 兼務メンバーも 1 回の呼出で外れる（repository が 3 配列を同時処理）
  it("removes an organizer member with a single repository call", async () => { /* organizerUids に u-target を含める */ });

  // 3. 自己除外は group/cannot-remove-self（getGroup すら呼ばない）
  it("throws group/cannot-remove-self and does not read the group", async () => {
    await expect(
      removeMemberByOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-owner" }),
    ).rejects.toMatchObject({ code: "group/cannot-remove-self" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(removeOtherMember).not.toHaveBeenCalled();
  });

  // 4. 非 owner（organizer）からの実行は group/not-owner
  it("throws group/not-owner when actor is an organizer", async () => { /* … */ });

  // 5. 最後のオーナーは除外不可
  it("throws group/last-owner when target is the only owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-target"],
        organizerUids: ["u-target", "u-actor"],
        memberUids: ["u-target", "u-actor"],
      }),
    );
    // actor は owner ではないため実際は not-owner が先に出る。
    // last-owner 分岐を突くには actor も owner に含める fixture にする（下記 GOTCHA 参照）
  });

  // 6. 既にメンバーでない → no-op（throw しない / repository を呼ばない）
  it("is a no-op when target is not a member", async () => { /* … */ });

  // 7. 空文字引数は validation/empty-string
  it("throws validation/empty-string for blank targetUid", async () => { /* … */ });
});
```

- **MIRROR**: TEST_STRUCTURE（service unit test）
- **IMPORTS**: 既存の import ブロックに追記するのみ。
- **GOTCHA**:
  - ケース 5 の fixture は `ownerUids: ["u-actor", ...]` にしないと `assertOwner` で先に落ちる。**`ownerUids: ["u-actor"]` かつ `targetUid: "u-actor"`** は自己除外に当たるため到達しない。したがって「actor が owner、target も owner、ただし `ownerUids.length === 1`」という状態は本来作れない（invariant 上ありえない）。テストでは `makeGroup({ ownerUids: ["u-actor"], memberUids: ["u-actor", "u-target"] })` に対し **`ownerUids` を後付けで `["u-target"]` に差し替えた矛盾 fixture**を使い、防御分岐が生きていることだけを固定する（コメントで「到達不能だが防御として維持」と明記）。
  - `beforeEach` の `vi.clearAllMocks()` が既存にあるか確認し、なければケース間で mock 呼出回数が漏れないよう `vi.mocked(getGroup).mockReset()` を各テスト冒頭で行う（既存 describe の書式に合わせる）。
  - `console.*` を直接 assert しない（[testing.md](../../../rules/testing.md)）。
- **VALIDATE**: `npm test -- group.test` が全 green（既存 describe も非回帰）。

### Task 4: `MemberRoleList.tsx` に「除外」ボタンを追加

- **ACTION**: props に `onRemoveMember` を追加し、`isOwner && !isSelf` ブロックの操作ボタン群の**末尾**に destructive ボタンを追加する。
- **IMPLEMENT**:

1. props interface に追加（[MemberRoleList.tsx:27-41](../../../../src/app/groups/%5Bgid%5D/_components/MemberRoleList.tsx#L27-L41)）:

```ts
  /**
   * Phase 4 (08-auto-group-join-on-entry): 「除外」押下（owner のみ・自分以外）。
   * 実際の除外は親が確認ダイアログを挟んでから service を呼ぶ（本 component は
   * 対象行を親へ伝えるだけ）。
   */
  onRemoveMember: (target: MemberLine) => void;
```

2. `CardDescription` を更新:

```tsx
        <CardDescription>
          ロールは「オーナー / 運営 / 一般」の 3 階層。オーナーのみ昇降格・除外できます。
        </CardDescription>
```

3. 操作ボタン群（`targetIsOwner` の分岐の直後、`</div>` の直前）に追加:

```tsx
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={working}
                      aria-label={`${m.displayName} を除外`}
                      onClick={() => onRemoveMember(m)}
                    >
                      除外
                    </Button>
```

- **MIRROR**: 既存の昇降格ボタン（同ファイル :101-141）
- **IMPORTS**: 追加不要（`Button` は import 済み）。
- **GOTCHA**:
  - `aria-label` に **`m.displayName` を埋めて行ごとにユニークにする**（複数メンバーがいるとき `getByRole("button", { name: "除外" })` は strict-mode violation になる。E2E / component test 双方がこの label に依存する）。
  - 表示名が「名前未登録 (xxxx)」フォールバックのときもそのまま label に入る（`MemberLine.displayName` は解決済みの値）。
  - `disabled` は `working` のみ。`onlyOwner` は付けない —— 自分以外の owner を対象にできる時点で owner は 2 人以上おり、`onlyOwner` は必ず false（service 側の `group/last-owner` が最終防御）。
  - 既存の昇降格ボタンの構造・順序は**変更しない**（回帰リスク回避）。
- **VALIDATE**: Task 5 の component test が green ＋ `npm run typecheck`（`group-detail-client.tsx` が新 prop 未指定で型エラーになるのが正しい挙動 → Task 7 で解消）。

### Task 5: `MemberRoleList.test.tsx` を新規作成

- **ACTION**: ボタン表示条件を固定する component test を 4 ケース書く。
- **IMPLEMENT**:

```tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";

import { MemberRoleList, type MemberLine } from "./MemberRoleList";

/**
 * Phase 4 (08-auto-group-join-on-entry): 「除外」ボタンの表示条件を固定する。
 *
 * 不変条件:
 *   1. owner から見た他メンバーの行にだけ「除外」が出る
 *   2. 自分の行には出ない（自己除外は service でも deny）
 *   3. owner でないユーザー（organizer / member）には 1 つも出ない
 *   4. working=true のとき disabled（連打防止）
 */
function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return {
    id: "g1",
    name: "Saturday",
    ownerUids,
    organizerUids,
    memberUids,
    memberDisplayNames: {},
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
    winnerCardBackground: null,
    seasonCardBackground: null,
    latestJoinCodeId: null,
    createdAt: Timestamp.fromDate(new Date("2026-07-31T00:00:00Z")),
    ...overrides,
  };
}

const members: MemberLine[] = [
  { uid: "u-owner", displayName: "オーナー太郎", missing: false },
  { uid: "u-member", displayName: "一般花子", missing: false },
];

function renderList(props: Partial<Parameters<typeof MemberRoleList>[0]> = {}) {
  const onRemoveMember = vi.fn();
  render(
    <MemberRoleList
      group={makeGroup({ memberUids: ["u-owner", "u-member"] })}
      members={members}
      selfUid="u-owner"
      isOwner
      working={false}
      onPromoteOrganizer={vi.fn()}
      onPromoteOwner={vi.fn()}
      onDemoteToMember={vi.fn()}
      onDemoteOwner={vi.fn()}
      onRemoveMember={onRemoveMember}
      {...props}
    />,
  );
  return { onRemoveMember };
}

describe("MemberRoleList の除外ボタン", () => {
  it("owner から見た他メンバー行に出て、click で対象 MemberLine が渡る", () => {
    const { onRemoveMember } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "一般花子 を除外" }));
    expect(onRemoveMember).toHaveBeenCalledWith(members[1]);
  });

  it("自分の行には出ない", () => {
    renderList();
    expect(screen.queryByRole("button", { name: "オーナー太郎 を除外" })).toBeNull();
  });

  it("owner でないユーザーには 1 つも出ない", () => {
    renderList({ isOwner: false, selfUid: "u-member" });
    expect(screen.queryByRole("button", { name: /を除外$/ })).toBeNull();
  });

  it("working=true のとき disabled", () => {
    renderList({ working: true });
    expect(screen.getByRole("button", { name: "一般花子 を除外" })).toBeDisabled();
  });
});
```

- **MIRROR**: TEST_STRUCTURE（component test）
- **IMPORTS**: 上記のとおり。`@testing-library/react` は既存 component test で使用実績あり。
- **GOTCHA**:
  - `Parameters<typeof MemberRoleList>[0]` で props 型を再利用する（`MemberRoleListProps` は export されていないため）。export を増やす変更はしない。
  - `toBeDisabled` は `@testing-library/jest-dom` の matcher。既存 component test（`CardBackgroundCard.test.tsx` 等）で使えている前提だが、使えない場合は `expect(btn).toHaveAttribute("disabled")` に置換する。
- **VALIDATE**: `npm test -- MemberRoleList` が green。

### Task 6: `RemoveMemberDialog.tsx` を新規作成

- **ACTION**: `_components/RemoveMemberDialog.tsx` を作成する。
- **IMPLEMENT**:

```tsx
"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Phase 4 (08-auto-group-join-on-entry): メンバー除外の確認モーダル。
 *
 * `target` が非 null のときだけ open になる（親は「対象行」を state に持つ）。
 * 除外は取り消せない破壊的操作のため、対象名とサークル名を明示して意思確認を取る
 * （`LeaveDeleteDialogs` / `StartSeasonDialog` と同形）。
 */
export function RemoveMemberDialog({
  targetName,
  groupName,
  onOpenChange,
  onConfirm,
  working,
}: {
  /** 除外対象の表示名。null のとき dialog は閉じている。 */
  targetName: string | null;
  groupName: string;
  onOpenChange: (next: boolean) => void;
  onConfirm: () => void;
  working: boolean;
}) {
  return (
    <Dialog open={targetName !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>メンバーを除外</DialogTitle>
          <DialogDescription>
            「{targetName}」を「{groupName}」から除外します。
            除外されたメンバーはこのサークルのトーナメント／ストラクチャを閲覧できなくなります。
            過去のトーナメントの参加記録とシーズン戦績はそのまま残ります。
            再び参加してもらう場合は、招待リンクを渡すか、トーナメント受付をしてもらってください。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
            キャンセル
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={working}>
            {working ? "除外中…" : "除外する"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

- **MIRROR**: UI_DIALOG_PATTERN
- **IMPORTS**: 上記のとおり（`StartSeasonDialog` と同一）。
- **GOTCHA**:
  - `targetName` を受け取る（`MemberLine` 全体ではなく string）ことで、component 側が schema 型に依存しない。
  - `"use client"` を先頭に付ける（`_components/` 配下の全 component の規約）。
  - dialog 文言に技術用語（Firestore / rule 等）を出さない。
  - 「除外する」という文言は E2E / POM が依存するので変更する場合は 3 箇所同時（本 component / POM / spec）。
- **VALIDATE**: `npm run typecheck` / `npm run lint`。

### Task 7: `group-detail-client.tsx` に state / ハンドラ / dialog を配線

- **ACTION**: 4 箇所を編集する。
- **IMPLEMENT**:

1. import を追加（[group-detail-client.tsx:26-41](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx#L26-L41) の service import に `removeMemberByOwner` を追加、`_components` import に `RemoveMemberDialog` を追加）:

```ts
import {
  deleteGroupByOwner,
  demoteOwner,
  demoteToMember,
  generateJoinCode,
  leaveGroup,
  promoteToOrganizer,
  promoteToOwner,
  removeMemberByOwner,
  renameGroup,
  // …
} from "@/lib/services/group";

import { RemoveMemberDialog } from "./_components/RemoveMemberDialog";
```

2. state を追加（`confirmStartSeasonOpen` の隣、:78 付近）:

```ts
  // Phase 4 (08-auto-group-join-on-entry): 除外確認ダイアログの対象行。
  //   null = 閉じている。MemberLine ごと持つのは dialog に表示名を渡すため。
  const [removeTarget, setRemoveTarget] = useState<MemberLine | null>(null);
```

3. ハンドラを追加（`onStartSeason` の隣、:317-324 付近）:

```ts
  /**
   * Phase 4: メンバー除外。owner のみ（ボタン自体が owner にしか出ない）。
   * 除外対象は `removeTarget` state から取る（dialog の確定ボタンから呼ばれる）。
   */
  async function onRemoveMember() {
    if (!user || !removeTarget) return;
    const targetUid = removeTarget.uid;
    await runReloadRefreshAction(
      () => removeMemberByOwner({ gid, actorUid: user.uid, targetUid }),
      {
        errorCode: "group/remove-member-failed",
        errorMessage: "メンバーの除外に失敗しました",
        closeDialog: () => setRemoveTarget(null),
      },
    );
  }
```

4. `MemberRoleList` に prop を渡す（:405-410 の `onDemoteOwner` の直後）:

```tsx
                onRemoveMember={(target) => setRemoveTarget(target)}
```

5. `StartSeasonDialog` の直後（:523-528 の後）に dialog を render:

```tsx
      <RemoveMemberDialog
        targetName={removeTarget?.displayName ?? null}
        groupName={group.name}
        onOpenChange={(next) => {
          if (!next) setRemoveTarget(null);
        }}
        onConfirm={() => void onRemoveMember()}
        working={working}
      />
```

- **MIRROR**: UI_ACTION_PATTERN
- **IMPORTS**: 上記のとおり。`MemberLine` 型は既に import 済み（:49）。
- **GOTCHA**:
  - **必ず `runReloadRefreshAction` 経由**にする（`setWorking` / `setError(null)` / `reload` / `refreshGroups` / `closeDialog` の 5 責務が揃う）。手書きすると既存 7 callsite と挙動がズレる。
  - `onOpenChange` は「閉じる方向のみ」state を落とす（Radix は open=true でも呼び得るため `if (!next)` ガードが必要）。
  - `removeTarget` を `runReloadRefreshAction` の外で `targetUid` に取り出しておく（`closeDialog` が先に走って null 化されても呼出引数がぶれないようにする防御）。
  - service 呼出前に `user` の null チェックを行う（既存ハンドラ全てと同じ）。
- **VALIDATE**: `npm run typecheck` / `npm run lint` / `npm run build`。

### Task 8: E2E POM（`tests/e2e/pages/GroupsPage.ts`）に locator を追加

- **ACTION**: `GroupDetailPage` クラスに除外まわりの locator / helper を追加する（`defaultTableLabels*` 群の直前あたり、メンバー系としてまとめる）。
- **IMPLEMENT**:

```ts
  // === Phase 4 (08-auto-group-join-on-entry): メンバー除外 ===
  // MemberRoleList は <ul><li> で 1 行 1 メンバーを描画する。行の特定は表示名で行う。
  memberRow(displayName: string): Locator {
    return this.page.getByRole("listitem").filter({ hasText: displayName });
  }

  /**
   * 行ごとの「除外」ボタン。accessibleName は `${displayName} を除外` 規約
   * （MemberRoleList.tsx と手動同期。複数メンバー時の strict-mode violation を避けるため
   *  ボタン内テキスト「除外」ではなく aria-label で引く）。
   */
  removeMemberButton(displayName: string): Locator {
    return this.page.getByRole("button", { name: `${displayName} を除外` });
  }

  /** 確認ダイアログの確定ボタン。 */
  readonly confirmRemoveMemberButton: Locator = this.page.getByRole("button", {
    name: /^除外する$/,
  });

  /** 「除外」→ 確認ダイアログ確定 → 対象行が一覧から消えるまでを 1 操作にまとめる。 */
  async removeMember(displayName: string): Promise<void> {
    await this.removeMemberButton(displayName).click();
    await this.confirmRemoveMemberButton.click();
    await expect(this.memberRow(displayName)).toHaveCount(0, { timeout: 15_000 });
  }
```

- **MIRROR**: 既存 `setDefaultTableLabels` helper（同ファイル）
- **IMPORTS**: 追加不要（`expect` / `Locator` は import 済み）。
- **GOTCHA**:
  - メンバー一覧は「メンバー」タブ（default タブ）にあるため、タブ切替は不要。ただし他タブから戻る場合に備えて呼出側で `selectTab("members")` を挟めるようにしておく。
  - `getByRole("listitem")` は page 全体を走査するので、他の `<li>` を持つ card があると誤ヒットしうる。`hasText: displayName` フィルタでユニークに絞れる前提（E2E のユーザー名はランダム接尾辞付き）。
- **VALIDATE**: Task 9 の E2E が green。

### Task 9: `tests/e2e/member-removal.spec.ts` を新規作成

- **ACTION**: owner / member の 2 context で除外 → 再加入まで通す E2E を 2 ケース書く。
- **IMPLEMENT**:

```ts
import { test, expect } from "./fixtures/test-context";
import {
  consumeInviteUrl,
  createGroup,
  issueInviteUrl,
  randomOrganizer,
  registerOrganizer,
} from "./fixtures/flows";

/**
 * Phase 4 (08-auto-group-join-on-entry): オーナーによるメンバー除外。
 *
 * 共通セットアップ:
 *   1. context A: オーナー登録 → group 作成 → 招待リンク発行
 *   2. context B: 別ユーザー登録 → 招待リンクで一般メンバー加入
 */
test.describe("Phase 4: メンバー除外", () => {
  test("オーナーがメンバーを除外すると一覧から消え、除外された側のサークル一覧からも消える", async ({
    page,
    groupDetailPage,
  }) => {
    const owner = randomOrganizer("rm-owner");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Removal Group");
    const inviteUrl = await issueInviteUrl(page, gid);

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    const memberCtx = await browser.newContext();
    try {
      const memberPage = await memberCtx.newPage();
      const member = randomOrganizer("rm-member");
      await registerOrganizer(memberPage, member);
      expect(await consumeInviteUrl(memberPage, inviteUrl)).toBe(gid);

      // --- owner 側: 一覧に member が見えることを確認してから除外 ---
      const detail = groupDetailPage(gid);
      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toBeVisible({ timeout: 15_000 });
      await detail.removeMember(member.displayName);

      // 再読込しても復活しない（Firestore に反映されている）
      await detail.goto();
      await detail.expectLoaded();
      await expect(detail.memberRow(member.displayName)).toHaveCount(0);

      // --- member 側: /groups から当該サークルが消える（stale groupIds の自己修復） ---
      await memberPage.goto("/groups");
      await expect(memberPage.getByText("Removal Group")).toHaveCount(0, {
        timeout: 20_000,
      });
    } finally {
      await memberCtx.close();
    }
  });

  test("除外されたメンバーは招待リンクから再加入できる", async ({ page, groupDetailPage }) => {
    // 上と同じセットアップ → 除外 → member 側で /groups を開いて stale 修復を発火
    // → 同じ招待リンクを再度踏む → owner 側の一覧に再び現れる
  });

  test("オーナー自身の行には除外ボタンが出ない", async ({ page, groupDetailPage }) => {
    const owner = randomOrganizer("rm-self");
    await registerOrganizer(page, owner);
    const gid = await createGroup(page, "Self Removal Guard");
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await expect(detail.removeMemberButton(owner.displayName)).toHaveCount(0);
  });
});
```

- **MIRROR**: E2E_STRUCTURE
- **IMPORTS**: 上記のとおり。
- **GOTCHA**:
  - **再加入テストの必須ステップ**: 除外直後に招待リンクを踏んでも、`consumeJoinCode` が `users/{uid}.groupIds`（stale）を見て「既メンバー」と誤判定し **no-op で終わる**。先に member 側で `/groups` を開いて `GroupProvider` の自己修復（`failedGids` → `removeGroupIdFromUser`）を走らせてから再加入する。この順序は**仕様であり実装の都合ではない**ので spec にコメントで明記する（[current-group.tsx:95-101](../../../../src/lib/services/current-group.tsx#L95-L101)）。
  - `registerOrganizer` の `displayName` はランダム接尾辞付きなので、`getByText` / `filter({ hasText })` の誤ヒットは起きない。
  - member context は必ず `finally` で `close()` する（既存 spec と同じ）。
  - E2E は emulator 前提。`npm run test:e2e` は `playwright.config.ts` の `webServer` / `globalSetup` が emulator を起動する構成（既存 spec と同条件）。
- **VALIDATE**: `npx playwright test tests/e2e/member-removal.spec.ts` → 3 ケース green。その後 `npm run test:e2e` で全件非回帰。

### Task 10: `.claude/rules/group-membership.md` を更新

- **ACTION**: 2 箇所を更新する。
- **IMPLEMENT**:

1. 「権限マトリクス」の表に行を追加（`group 脱退` の直後）:

```md
| 他メンバーの除外（`removeMemberByOwner`） | ○ | × | × |
```

2. 「アカウント自己削除（通常アカウント）」節の**直前**に新節を追加:

```md
### オーナーによるメンバー除外（08-auto-group-join-on-entry Phase 4）

トーナメント受付による自動所属（Phase 1〜3）で入った誤参加者・一見さんを、オーナーが
事後に外すための経路。**Firestore Rules の変更を伴わない** —— 既存の owner-update
ブランチ（`auth.uid in resource.data.ownerUids` + `ownerUids.size() >= 1` +
`createdAt` 不変）が `memberUids` を含むフル update を既に許可しているため。

- service: [`removeMemberByOwner({ gid, actorUid, targetUid })`](../../src/lib/services/group.ts)
  1. **自己除外の禁止**（`group/cannot-remove-self`）— 脱退は `leaveGroup` を使う
  2. `assertOwner`（organizer は不可）
  3. 対象が既に非メンバーなら no-op で return（冪等）
  4. 対象が owner かつ `ownerUids.length <= 1` なら `group/last-owner`
- repository: [`removeOtherMember(gid, targetUid)`](../../src/lib/firebase/repositories/groups.ts)
  — `memberUids` / `organizerUids` / `ownerUids` の `arrayRemove` ＋
  `memberDisplayNames[targetUid]` の `deleteField()` を 1 回の `updateDoc` で atomic に適用
- UI: サークル詳細「メンバー」タブの各行（owner 視点・自分以外）に「除外」ボタン ＋
  確認ダイアログ（`RemoveMemberDialog`）

**既知の制約（設計上の割り切り）**:

- 除外対象の `users/{uid}.groupIds` は**本人以外書き換えられない**（`users/{uid}` は
  self-only rule）。`deleteGroupByOwner` と同じ制約。stale な gid は対象者側の
  [`GroupProvider`](../../src/lib/services/current-group.tsx) が `listMyGroups` の
  `failedGids` として検出し `removeGroupIdFromUser` で自己修復する。
- そのため、**除外直後に招待コードで再加入しようとすると `consumeJoinCode` が
  stale な `groupIds` を見て「既メンバー」と誤判定する**。対象者が一度アプリを開いて
  自己修復を走らせれば解消する。トーナメント受付経由の自動所属（Phase 1 の
  `joinGroupViaTournament`）は membership 判定に `getGroup` の成否を使う設計のため、
  stale `groupIds` の影響を受けない。
- 過去トーナメントの `players/{pid}` と `seasonStats/{uid}` は**意図的に残す**
  （履歴の継続性。アカウント自己削除と同方針）。
```

- **MIRROR**: 同ファイルの「アカウント自己削除（通常アカウント）」節の書式
- **GOTCHA**: 「データモデル」節の `groups/{gid}` フィールド列挙は**変更しない**（新フィールドなし）。rule 経路表（[firebase-patterns.md](../../../rules/firebase-patterns.md) の allowed-keys 一覧）も**変更しない**（owner-update ブランチは既に「上限なし」と記載済み）。
- **VALIDATE**: 目視 ＋ リンク先パスが実在すること。

### Task 11: PRD の Phase 進捗を更新

- **ACTION**: [08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md) の Implementation Phases 表、Phase 4 の行を更新する。
- **IMPLEMENT**:

```md
| 4 | メンバー除名 UI | オーナーがメンバーを除名できる service + サークル詳細 UI（rule 変更なし） | in-progress | with 1, 2 | - | [phase-4-member-removal-ui.plan.md](../plans/phase-4-member-removal-ui.plan.md) |
```

- **GOTCHA**: Status を `pending` → `in-progress` に変更し、`PRP Plan` 列の `-` を plan リンクに置換する。Phase 1 の行（既に `in-progress` + plan リンク）の書式に揃える。
- **VALIDATE**: 目視。

---

## Testing Strategy

### Unit Tests（`src/lib/services/group.test.ts` — 7 ケース）

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| 一般メンバーの除外 | owner=`u-owner`, target=`u-target`(member) | `removeOtherMember("g1", "u-target")` が 1 回 | — |
| organizer 兼務メンバーの除外 | target が `organizerUids` にも居る | 同上（repository が 3 配列を同時処理） | ○ |
| 自己除外 | actor === target | `group/cannot-remove-self` throw / `getGroup` 未呼出 | ○ |
| 非 owner からの実行 | actor が organizer | `group/not-owner` throw / repository 未呼出 | ○ |
| 最後のオーナーの除外 | target が唯一の owner | `group/last-owner` throw | ○（到達不能な防御分岐） |
| 既に非メンバー | target が `memberUids` に居ない | no-op return（throw しない / repository 未呼出） | ○ |
| 空文字引数 | `targetUid: ""` | `validation/empty-string` throw | ○ |

### Component Tests（`MemberRoleList.test.tsx` — 4 ケース）

| Test | Input | Expected Output |
| --- | --- | --- |
| owner 視点・他人の行 | `isOwner=true`, `selfUid="u-owner"` | 「一般花子 を除外」ボタンが存在し click で `onRemoveMember(members[1])` |
| owner 視点・自分の行 | 同上 | 「オーナー太郎 を除外」は存在しない |
| 非 owner 視点 | `isOwner=false` | `/を除外$/` にマッチするボタンが 0 件 |
| 操作中 | `working=true` | 除外ボタンが disabled |

### E2E（`tests/e2e/member-removal.spec.ts` — 3 ケース）

| Test | 検証点 |
| --- | --- |
| 除外 → 一覧から消える | owner 一覧から即消える / 再読込しても復活しない / 除外された側の `/groups` からも消える |
| 除外 → 再加入 | 自己修復（`/groups` 訪問）後に招待リンクで再加入でき、owner 一覧に再び現れる |
| 自己除外ガード | オーナー自身の行に除外ボタンが出ない |

### Edge Cases Checklist

- [x] 自分自身を除外しようとする → service + UI の二重ガード
- [x] 最後のオーナーを除外しようとする → `group/last-owner`（rule の `ownerUids.size() >= 1` が最終防御）
- [x] 既に除外済みのメンバーを再度除外（多端末・二重押し）→ 冪等 no-op
- [x] organizer 兼務メンバーの除外 → 3 配列から同時に外れる
- [x] 除外対象の `memberDisplayNames` エントリ残留 → `deleteField()` で除去
- [x] 除外された側の stale `groupIds` → `GroupProvider` の既存自己修復に委譲（E2E で固定）
- [x] 除外直後の招待コード再加入が no-op になる罠 → E2E に自己修復ステップを明示
- [x] Permission denied（organizer が SDK 直叩き）→ rule の owner-update 条件で deny
- [ ] Network failure → `wrapFirestoreWrite` が warn + `firestore/write_failed` にラップし、UI が `formatErrorForDisplay` で表示（既存経路のため追加テストなし）

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

EXPECT: Zero lint errors（`console.*` 残置なし）

### Unit Tests

```bash
npm test -- group.test
npm test -- MemberRoleList
```

EXPECT: 新規ケース全 pass ＋ 既存 describe 非回帰

### Full Test Suite

```bash
npm test
```

EXPECT: No regressions

### Build

```bash
npm run build
```

EXPECT: Success

### Firestore Rules Validation

```bash
npm run test:rules-limits
```

EXPECT: ALL GREEN

> 本 Phase は **`firestore.rules` を変更しない**ため emulator validator の新規作成は不要。
> ただし他 Phase と並行作業しているため、既存 rule validator（`test:rules-latest-join-code` /
> `test:rules-season` 等）が壊れていないことを最終マージ前に 1 回確認する。
> **rule を変更しないので `firebase deploy --only firestore:rules` も不要**。

### Browser / E2E Validation

```bash
npx playwright test tests/e2e/member-removal.spec.ts
npm run test:e2e
```

EXPECT: 新規 3 ケース green ＋ 全件非回帰（特に `member-role-split.spec.ts` / `group-detail-tabs.spec.ts`）

### Manual Validation

- [ ] オーナーで `/groups/[gid]` を開き、他メンバーの行に赤い「除外」ボタンが出る
- [ ] 自分の行には出ない
- [ ] 別ブラウザで一般メンバーとしてログインし、同画面に除外ボタンが 1 つも出ない
- [ ] 「除外」→ ダイアログに対象名とサークル名が正しく表示される
- [ ] 「キャンセル」で何も起きない
- [ ] 「除外する」で一覧から即消える（reload なしで反映）
- [ ] 除外された側でアプリを開き直すと、サークル一覧から当該サークルが消える
- [ ] 除外された側が招待リンクを踏み直すと再加入できる
- [ ] モバイル幅（375px）でボタンが折り返して重ならない（`flex-wrap` 済み）

---

## Acceptance Criteria

- [ ] Task 1〜11 完了
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` すべて green
- [ ] `npm test` 全 green（新規 11 ケース含む）
- [ ] `npm run test:e2e` 全 green（新規 3 ケース含む）
- [ ] `firestore.rules` / `schemas/group.ts` に**差分がない**こと（`git diff --stat` で確認）
- [ ] UX が本計画の After 図と一致
- [ ] `.claude/rules/group-membership.md` の権限マトリクス ＋ 新節が更新済み
- [ ] PRD の Phase 4 が `in-progress` ＋ plan リンク付き

## Completion Checklist

- [ ] repository / service の命名が既存規約に沿う（`removeMemberSelf` ↔ `removeOtherMember`、service は `removeMemberByOwner`）
- [ ] エラーは全て `AppError` ＋ `group/*` / `validation/*` prefix（`throw new Error` なし）
- [ ] `logger.info` が `wrapFirestoreWrite` の外にある（二重 warn なし）
- [ ] `console.*` の直呼びなし
- [ ] UI 文言に技術スタック名が出ていない
- [ ] `runReloadRefreshAction` を経由している（手書きの try/catch なし）
- [ ] ハードコードされた表示名 / gid がない
- [ ] 実装とテストが同一 commit に含まれている（[testing.md](../../../rules/testing.md) の commit セット規約）
- [ ] Phase 1〜3 のファイル（`firestore.rules` / `receipt.ts` / `join-client.tsx` / `auto-group-join.ts`）に触れていない

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| 除外直後の再加入が stale `groupIds` で no-op になり「再加入できない」と誤解される | **M** | M | `GroupProvider` の自己修復が既存実装として存在することを確認済み。E2E に自己修復ステップを含めて仕様として固定し、rule ドキュメントにも明記する。Phase 1 の `joinGroupViaTournament` は `getGroup` 成否ベースの probe なので影響を受けない |
| `aria-label` 規約（`${displayName} を除外`）が UI / POM / E2E の 3 箇所に散る drift | M | L | POM のコメントに「MemberRoleList.tsx と手動同期」と明記。component test が label 規約を固定するため、変更時に unit で先に落ちる |
| owner が別の owner を除外できてしまう（共同オーナー間の事故） | L | M | 既存の `demoteOwner` も owner が他 owner を降格できる設計であり信頼境界は同じ。確認ダイアログで対象名を明示。最後の 1 人は service + rule で保護 |
| 除外と昇降格の同時操作（多端末）で配列が競合 | L | L | 各操作は単一 `updateDoc` で atomic。`arrayRemove` は冪等。競合しても invariant（ownerUids ⊆ organizerUids ⊆ memberUids）は壊れない（除外は 3 配列を同時に外すため） |
| Phase 1（rule 変更）との同時作業でコンフリクト | L | M | 本 Phase は `firestore.rules` / `schemas/group.ts` に**一切触れない**。`repositories/groups.ts` は追記位置が別（Phase 1 は `setMemberDisplayName` 直後、本 Phase は `removeMemberSelf` 直後）。`services/group.ts` は Phase 1 が新ファイル `auto-group-join.ts` を使うため衝突しない |
| `getByRole("listitem")` が他 card の `<li>` に誤ヒット | L | L | `hasText: displayName`（ランダム接尾辞付き）でユニークに絞る。失敗時は `#group-detail-panel-members` scope を追加する |

## Notes

### UI 文言を「除名」ではなく「除外」にした理由

PRD の Phase 名は「メンバー除名 UI」だが、**UI に出す文言は「除外」に統一する**。理由:

- 業務仕様書 [docs/specification/02-circles-and-membership.spec.md](../../../../docs/specification/02-circles-and-membership.spec.md) が既に
  - 2.2.6「運用系: メンバーの**除外**」（「除外」ボタンで外す、と明記）
  - 権限表「メンバーを**除外** | ○ | × | × | ×」（owner のみ）
  - 主な操作一覧「メンバー**除外**」

  と本機能を記述済みで、実装がその記述に追い付く形になる。仕様書側の 8 箇所を書き換えるより、UI を仕様書に合わせる方が drift が小さい。
- 「除名」より punitive でなく、PRD の想定用途（誤参加者・一見さんの整理）に合う。

**service / repository の識別子は PRD 準拠で `removeMemberByOwner` / `removeOtherMember`**（英語識別子なので日本語の語感問題は発生しない）。「除名」に揃えたい場合の変更点は `MemberRoleList.tsx`（ボタン文字 + aria-label）/ `RemoveMemberDialog.tsx`（タイトル・本文・確定ボタン）/ `GroupsPage.ts`（POM の 2 locator）/ `member-removal.spec.ts` / `MemberRoleList.test.tsx` の 5 ファイルのみ。

### rule 変更が不要である根拠（実装前に必ず確認すること）

[firestore.rules:113-120](../../../../firestore.rules#L113-L120) の owner-update ブランチ:

```
      allow update: if (
        // owner update（name / ロール配列 / memberUids / memberDisplayNames 自由、
        //   ただし ownerUids 空不可・createdAt 不変）
        isSignedIn()
        && request.auth.uid in resource.data.ownerUids
        && request.resource.data.ownerUids.size() >= 1
        && request.resource.data.createdAt == resource.data.createdAt
      ) || (
```

`affectedKeys().hasOnly([...])` による制限が**ない**唯一のブランチであり、`memberUids` /
`organizerUids` / `ownerUids` / `memberDisplayNames` の同時書換をそのまま許可する。
したがって本 Phase では rule に一切触れない。**もし実装中に「rule を足す必要がある」と
感じたら、それは owner-update 以外の経路を踏んでいるサイン**なので、`assertOwner` が
効いているか、actor が本当に owner かを先に疑うこと。

### 除外された人の再加入経路（3 通り）

1. **招待リンク** — 対象者が一度アプリを開いて stale `groupIds` を自己修復してから踏む（本 Phase の E2E で固定）
2. **トーナメント受付による自動所属** — Phase 1 の `joinGroupViaTournament` が `getGroup` の
   成否で membership を判定するため stale `groupIds` の影響を受けず、そのまま再加入できる
   （Phase 2 が結線されたら E2E を追加する。本 Phase では扱わない）
3. **オーナーによる再招待** — 招待リンクを個別に渡す（1 と同じ）

### 実装順序の推奨

Task 1 → 2 → 3（データ層 + テストで green を確認）→ Task 4 → 5 → 6 → 7（UI）→ Task 8 → 9（E2E）
→ Task 10 → 11（ドキュメント）。Task 3 が green になるまで UI に進まないことで、
service のガード条件（自己除外 / 最後のオーナー / 冪等）を先に固めてから
UI を「ガードが効いている前提」で薄く作れる。
