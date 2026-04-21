# Plan: Phase 4.6 — Member Role Split

## Summary

サークル所属を単一ロール（フラットな `memberUids`）から 3 階層（owner / organizer / general member）に拡張する。運営者（organizer）は structures / tournaments を CRUD でき、一般メンバー（general member）は自サークルのトーナメント一覧を閲覧してワンタップで参加申込できる。オーナー（owner）は複数名設定可能で、ロールの昇格・降格はオーナーのみ行える。`groups/{gid}.ownerUid: string` を `ownerUids: string[]` に拡張し、`organizerUids: string[]` を新設する破壊的スキーマ変更と rules の厳格化を伴う。

## User Story

As a サークルの一般メンバー（非運営）,
I want サークル加入後、アプリから所属サークルのトーナメント一覧を閲覧し、ワンタップで参加申込できる状態,
So that 運営者に QR を見せてもらう必要なく、自分のタイミングで開催中のトーナメントに参加できる。

And as a サークルオーナー,
I want メンバーを運営・一般メンバー・オーナーに昇降格できる状態,
So that サークル運営を複数人で分担しつつ、トーナメント操作の権限を適切に絞れる。

## Problem → Solution

**Current state (Phase 4.5 完了時点)**: `groups/{gid}.memberUids` がフラットな文字列配列で、加入したメンバー全員が structures / tournaments を CRUD できる。一般メンバー相当の「見る・参加するだけ」の権限が存在せず、運営に誘わないと加入させられない。オーナーは 1 名限定（`ownerUid: string`）で、運営者を複数持ちたい実運用ニーズと不整合。

**Desired state (Phase 4.6 完了時点)**:

- `groups/{gid}` が 3 階層のロールを保持（`memberUids` ⊇ `organizerUids` ⊇ `ownerUids`、後二者が新設フィールド）
- 既存メンバーは**全員 organizer**として移行（運営権限は保持、破壊なし）、**オーナーは既存 `ownerUid` の 1 名**から `ownerUids: [ownerUid]` に昇格
- 一般メンバー：新規招待コード加入のデフォルト。`/tournaments` 一覧閲覧可、トーナメント個別画面は `/live` のみ（運営ダッシュボード非表示）、ワンタップ参加ボタンあり
- オーナーのみロール変更 UI を操作可能（member ↔ organizer、organizer ↔ owner、owner ↔ organizer）。最後のオーナーは降格不可（rule + service 二重ガード）
- structures / tournaments の write 条件が `isGroupMember` → `isOrganizer` に強化
- `groups/{gid}` 削除は「オーナー全員のうちの 1 人」が実行可能（rule 変更）

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 4.6 — Member Role Split（Phase 4.5 完了後に着手）
- **Estimated Files**: 約 22 files（新規 2・編集 17・削除 0・テスト修正 3・migration script 1）

---

## UX Design

### Before（Phase 4.5 完了時点）

```
┌─ /groups/{gid} ─────────────────────┐
│ サークル名  (オーナー: 山田)         │
│ ── メンバー ──                       │
│  ・山田 [オーナー] [あなた]          │
│  ・佐藤                              │  ← 全員対等・運営権限あり
│  ・鈴木                              │
│  ・田中                              │
│ ── 招待コード ──                     │
│  [発行]                              │  ← 加入したら自動的に運営
└──────────────────────────────────────┘

┌─ /tournaments (全メンバー共通) ─────┐
│ [新規作成]  [編集] [削除]           │  ← 全員が作成・削除可能
│ ・Monthly 11 月                     │
└──────────────────────────────────────┘

┌─ /tournaments/{tid}（組織者 UI）──┐
│ [席を決定] [自分も参加] [終了]   │  ← 全員に運営 UI が見える
└────────────────────────────────────┘
```

### After（Phase 4.6 完了時点）

```
┌─ /groups/{gid} ─────────────────────┐
│ サークル名  (オーナー 2 人)          │
│ ── メンバー ──                       │
│  ・山田 [オーナー] [運営] [あなた]   │
│  ・佐藤 [オーナー] [運営]            │
│  ・鈴木 [運営]                       │  ← 運営 (組織者)
│  ・田中 [一般]                       │  ← 一般メンバー
│  [昇格] [降格] [オーナーへ] ← オーナーのみ表示
│ ── 招待コード ──                     │
│  [発行]                              │  ← 加入すると「一般」でスタート
└──────────────────────────────────────┘

┌─ /tournaments (一般メンバー視点) ──┐
│                        [サークル]  │  ← 新規作成ボタンなし
│ ・Monthly 11 月 [running]          │
│   └ [タイマー画面へ] [参加する]    │  ← ワンタップ参加
└─────────────────────────────────────┘

┌─ /tournaments (運営視点) ──────────┐
│ [新規作成]  [編集] [削除]           │  ← 従来どおり
│ ・Monthly 11 月                     │
└─────────────────────────────────────┘

┌─ /tournaments/{tid} (一般) ───────┐
│ → /tournaments/{tid}/live にリダイレクト │
│   Lv5 / SB 400/BB 800 / 残り 08:42      │
│   [自分の席]  [参加する] (未参加時)     │
└─────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/groups/{gid}` メンバー一覧 | ロール表示なし（「オーナー」「あなた」のみ） | ロール badge（オーナー／運営／一般） | owner badge は複数可 |
| `/groups/{gid}` 昇降格 UI | なし | オーナー限定のロール変更ボタン | member ↔ organizer ↔ owner の遷移 |
| 招待コード加入 | 全員 organizer として入る | デフォルト「一般」で入る | 昇格はオーナー操作 |
| `/tournaments` 一覧 | 全員に `[新規作成]` 表示 | organizer のみ `[新規作成]` 表示 | 一般は閲覧のみ |
| `/tournaments/{tid}` 個別 | 全員に dashboard UI | organizer → dashboard / 一般 → `/live` | 一般が URL 直打ちしても rule + UI で block |
| `/tournaments/{tid}/live` | 「受付登録されていません」表示 | 一般メンバーは「参加する」ボタン表示 | `joinAsCurrentUser({ tid })` 呼出 |
| `/structures` | 全員が CRUD | organizer のみ CRUD（一般は閲覧のみ or 非表示） | 一般は「structures」タブ自体非表示 |
| オーナー脱退 | 禁止（`owner-cannot-leave`） | 他オーナーが 1 名以上いれば脱退可 | `ownerUids.length >= 2` で許可 |
| group 削除 | 単一オーナーのみ | オーナー全員のうち 1 人 | rule: `request.auth.uid in resource.data.ownerUids` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ変更・zod 三点同期・rule 作法 |
| P0 | [.claude/rules/group-membership.md](../../rules/group-membership.md) | all | Phase 2.5 のモデル定義。Phase 4.6 でアップデート必要 |
| P0 | [.claude/rules/security.md](../../rules/security.md) | all | 招待コード原則（デフォルトロール変更に影響） |
| P0 | [.claude/PRPs/plans/completed/phase-2.5-group-management.plan.md](completed/phase-2.5-group-management.plan.md) | all | Phase 2.5 の破壊的 migration 手順をミラー |
| P0 | [firestore.rules](../../../firestore.rules) | all | 全面書換が必要（helper 追加、structures/tournaments 条件変更） |
| P0 | [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | all | zod スキーマの破壊的拡張 |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | all | `createGroup` / `getGroup` の戻り値、新規 `promoteToOrganizer` / `demoteToMember` / `promoteToOwner` / `demoteOwner` 追加 |
| P0 | [src/lib/services/group.ts](../../../src/lib/services/group.ts) | all | `createGroupWithOwner` / `consumeJoinCode` / `leaveGroup` / `deleteGroupByOwner` / `renameGroup` — 新ロール対応 |
| P0 | [src/lib/services/current-group.tsx](../../../src/lib/services/current-group.tsx) | all | `useCurrentGroup` に role 情報を追加（`isOrganizer` / `isOwner` の導出） |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/[gid]/group-detail-client.tsx) | all | ロール badge・昇降格 UI 追加 |
| P1 | [src/app/tournaments/tournaments-client.tsx](../../../src/app/tournaments/tournaments-client.tsx) | all | 「新規作成」ボタンの role gate、一般メンバー向け「参加する」リンク表示 |
| P1 | [src/app/tournaments/[tid]/page.tsx](../../../src/app/tournaments/[tid]/page.tsx) | all | role 判定で dashboard / live を出し分け、一般メンバーは live にリダイレクト |
| P1 | [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | all | 「参加する」ボタン追加（未参加の一般メンバー向け） |
| P1 | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | all | isOrganizer ガードで UI 隠蔽 |
| P1 | [src/app/structures/structures-client.tsx](../../../src/app/structures/structures-client.tsx) | all | 一般メンバー非表示 or ログで 403、ナビゲーションからも除外 |
| P1 | [src/app/page.tsx](../../../src/app/page.tsx) | all | トップボタンの role gate（一般メンバーは「ストラクチャ」非表示） |
| P1 | [src/components/auth/AuthBadge.tsx](../../../src/components/auth/AuthBadge.tsx) | all | group 切替プルダウンに role 表示を併記（optional） |
| P2 | [src/app/groups/join/[code]/](../../../src/app/groups/join/[code]/) | all | 加入メッセージを「一般メンバーとして加入」に変更 |
| P2 | [src/lib/firebase/repositories/groups.test.ts](../../../src/lib/firebase/repositories/groups.test.ts) | — | 存在確認。あれば schema 変更に合わせて更新 |
| P2 | [src/lib/services/group.test.ts](../../../src/lib/services/group.test.ts) | — | 存在確認。ロール操作のテスト追加 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firestore rules custom helpers | [firebase.google.com/docs/firestore/security/rules-conditions#custom_functions](https://firebase.google.com/docs/firestore/security/rules-conditions#custom_functions) | `function isOwner(gid) { ... }` 形式で追加。既存 `isGroupMember` パターンと同形 |
| Firestore `get()` の read quota | [firebase.google.com/docs/firestore/security/rules-conditions#access_documents](https://firebase.google.com/docs/firestore/security/rules-conditions#access_documents) | `isOwner` / `isOrganizer` が追加で get() を消費する。同一 rule 内の同一 path なら cache されるが、effect として +2 read/評価にとどめる設計（helper 内で 1 path に集約） |
| Firestore 複合フィールドの migration | [stackoverflow.com/questions/67174720/cloud-firestore-migrate-document-format](https://stackoverflow.com/questions/67174720/cloud-firestore-migrate-document-format) | admin SDK スクリプトで一括 update。本 phase では手動 CLI で実行（Firestore Console でも可、件数少） |

```
KEY_INSIGHT: ownerUid (単数) を ownerUids (配列) に広げる破壊的変更
APPLIES_TO: Tasks 1, 2, 8 (schema, repository, migration)
GOTCHA: Phase 2.5 precedent に従い、互換レイヤは作らない。migration 実行前の旧コードは動作不可。README に実行手順を明記する

KEY_INSIGHT: rule helper の get() は 1 評価につき 1 read 消費。isOwner / isOrganizer を追加しても、同一 gid への get は同 rule 評価内で cache される（Firebase SDK の仕様）
APPLIES_TO: Task 3 (rules)
GOTCHA: ただし structures と tournaments の write は別ルール評価なので、write 1 回につき 1 read 消費。20 人 x 月 1-2 回スケールでは無視可能（Phase 2.5 で確認済）

KEY_INSIGHT: 一般メンバーが /tournaments/{tid}/players/{uid} の create を rule で許可されている必要あり
APPLIES_TO: Task 3 (rules), Task 6 (live の 参加ボタン)
GOTCHA: 既存 rule は `pid == request.auth.uid && request.resource.data.uid == request.auth.uid && isBusted == false && tableNum == null && seatNum == null` を要求。これは一般メンバーでも満たせる（isGroupMember 不要）ので rule 変更は不要
```

---

## Patterns to Mirror

### NAMING_CONVENTION (existing group service)

```ts
// SOURCE: src/lib/services/group.ts:138-156
export async function generateJoinCode({
  gid,
  createdByUid,
  expiresInDays = 7,
  maxUses = null,
}: {
  gid: string;
  createdByUid: string;
  expiresInDays?: number;
  maxUses?: number | null;
}): Promise<string> {
  // 引数はオブジェクト分割、validation は先頭で、AppError で throw
}
```

### ERROR_HANDLING (repository-level)

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:95-104
export async function updateGroupName(gid: string, name: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), { name });
    logger.info("group rename ok", { gid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル名の更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}
```

### ROLE_GUARD (service-level business rule check)

```ts
// SOURCE: src/lib/services/group.ts:117-133 (leaveGroup 内の owner 判定)
export async function leaveGroup({ gid, uid }: { gid: string; uid: string }): Promise<void> {
  const group = await getGroup(gid);
  if (group.ownerUid === uid) {
    throw new AppError(
      "オーナーは脱退できません。先にオーナーを移譲するか group を削除してください。",
      "group/owner-cannot-leave",
    );
  }
  // ...
}
// Phase 4.6 では上記の owner 単一チェックを「ownerUids に含まれる、かつ最後のオーナー」に拡張
```

### RULE_HELPER_PATTERN

```js
// SOURCE: firestore.rules:11-21
function isGroupMember(gid) {
  return isSignedIn()
         && exists(/databases/$(database)/documents/groups/$(gid))
         && request.auth.uid in get(/databases/$(database)/documents/groups/$(gid)).data.memberUids;
}

function isGroupOwner(gid) {
  return isSignedIn()
         && exists(/databases/$(database)/documents/groups/$(gid))
         && get(/databases/$(database)/documents/groups/$(gid)).data.ownerUid == request.auth.uid;
}
// Phase 4.6 では isGroupOwner を ownerUids 配列判定に書換、isOrganizer を新規追加
```

### ZOD_SCHEMA_PATTERN

```ts
// SOURCE: src/lib/firebase/schemas/group.ts:8-14
export const groupBodySchema = z.object({
  name: z.string().min(1).max(60),
  ownerUid: z.string().min(1),
  memberUids: z.array(z.string().min(1)).min(1),
  createdAt: z.instanceof(Timestamp),
});
// Phase 4.6 では ownerUid → ownerUids、organizerUids を追加。refine で invariant 検証
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/receipt.test.ts:9-45
const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));
vi.mock("@/lib/firebase/client", () => ({ firebaseAuth: mockAuthState, firestore: {} }));
vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroup: vi.fn(),
  updateGroupRoles: vi.fn(),  // Phase 4.6 新規
}));
// beforeEach で reset → it で振る舞いを mock → action → assert のパターン
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/firebase/schemas/group.ts` | UPDATE | `ownerUid: string` → `ownerUids: string[]`、`organizerUids: string[]` 追加、invariant refine |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | `createGroup` の書込フィールド更新、`updateGroupRoles` 追加、`removeMemberSelf` は organizerUids / ownerUids からも除去 |
| `src/lib/services/group.ts` | UPDATE | `createGroupWithOwner` / `consumeJoinCode` / `leaveGroup` / `deleteGroupByOwner` / `renameGroup` を新ロール対応、昇降格サービス新設 |
| `src/lib/services/current-group.tsx` | UPDATE | `useCurrentGroup` に `role` / `isOrganizer` / `isOwner` を導出フィールドとして追加 |
| `firestore.rules` | UPDATE | `isGroupOwner` → `isOwner`（配列判定）、`isOrganizer` 追加、structures / tournaments の write を `isOrganizer` に強化、groups の rename / delete / roles update を `isOwner` に |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | ロール badge 表示、オーナー専用の昇降格ボタン群、owner 脱退条件変更 |
| `src/app/groups/new/new-group-client.tsx` | UPDATE | `createGroupWithOwner` の引数に合わせる（ownerUids 配列化） |
| `src/app/groups/groups-client.tsx` | UPDATE | 所属 group の表示に自分の role を併記（optional） |
| `src/app/groups/join/[code]/join-code-client.tsx` | UPDATE | 加入メッセージを「一般メンバーとして加入します」に変更 |
| `src/app/tournaments/tournaments-client.tsx` | UPDATE | 「新規作成」ボタンを `isOrganizer` で gate、一般メンバー視点の「参加する」リンクをカードに表示 |
| `src/app/tournaments/new/` | UPDATE | 一般メンバーが URL 直打ちしたら `/tournaments` にリダイレクト |
| `src/app/tournaments/[tid]/page.tsx` | UPDATE | role 判定で dashboard-client / live にリダイレクト分岐 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | 万一一般メンバーが到達した場合のガード追加（rule と二重防御） |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 未参加の一般メンバー向け「参加する」ボタン追加 |
| `src/app/structures/structures-client.tsx` | UPDATE | 一般メンバーの場合は編集 UI を隠し、閲覧専用表示にする（or ナビから外す） |
| `src/app/page.tsx` | UPDATE | トップの「ストラクチャ」ボタンは非表示（一般メンバー時）※ Phase 4.5 で page.tsx を Client Component 化済み前提 |
| `src/lib/firebase/repositories/groups.test.ts` | CREATE / UPDATE | 新スキーマのテスト（無ければ新規） |
| `src/lib/services/group.test.ts` | CREATE / UPDATE | 昇降格 / 最後のオーナー防御 / leaveGroup 新条件 のテスト |
| `scripts/migrate-phase-4.6-roles.ts` | CREATE | admin SDK で全 group を scan し `ownerUids: [ownerUid]` / `organizerUids: [...memberUids]` を書込、`ownerUid` フィールドは削除 |
| `.claude/rules/group-membership.md` | UPDATE | ロール定義を 3 階層に書換、昇降格フローと rule 変更を追記 |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Phase 4.6 行を追加、Phase 5 の Depends に 4.6 を追加 |
| `README.md` | UPDATE | migration 実行手順（`node scripts/migrate-phase-4.6-roles.ts`）を追記 |

## NOT Building

- **ロール別の操作履歴ログ / 監査**: 誰がいつ誰を昇格/降格したかの audit log は作らない。必要なら Phase 5+ で Firestore の `auditLogs` サブコレクション新設
- **オーナー移譲（transfer）専用 UI**: 「owner promote」と「owner demote」の 2 操作で賄える（既存オーナーが降格 + 別メンバーを昇格）。ワンクリック移譲 UI は作らない
- **招待コードのロール指定**: 「運営用コード」「一般用コード」を分けない。全て「一般」で加入 → オーナーが手動昇格
- **ロール変更の通知 / メール**: 昇降格イベントの通知は出さない（対面運営前提）
- **一般メンバーの席情報閲覧制限**: 一般メンバーもトーナメント中は `/live` で全席表示を見られる（既存動作のまま）
- **structures の閲覧制限**: 一般メンバーも structures は閲覧できる（編集のみ不可）。完全非表示にはしない
- **Cloud Functions によるロール管理の server 側**: 全て client-side + rules で担保（既存パターン踏襲）
- **既存組織の「この人は元々運営だが 4.6 では一般メンバー扱いにしたい」選択的 migration**: 全員 organizer に移行する一律 migration のみ。個別再選別は手動で行う

---

## Step-by-Step Tasks

### Task 1: zod スキーマの破壊的拡張

- **ACTION**: `src/lib/firebase/schemas/group.ts` を更新
- **IMPLEMENT**:
  ```ts
  export const groupBodySchema = z.object({
    name: z.string().min(1).max(60),
    ownerUids: z.array(z.string().min(1)).min(1),
    organizerUids: z.array(z.string().min(1)).min(1),
    memberUids: z.array(z.string().min(1)).min(1),
    createdAt: z.instanceof(Timestamp),
  }).refine(
    (v) => v.ownerUids.every((uid) => v.organizerUids.includes(uid)),
    { message: "ownerUids must be a subset of organizerUids" },
  ).refine(
    (v) => v.organizerUids.every((uid) => v.memberUids.includes(uid)),
    { message: "organizerUids must be a subset of memberUids" },
  );

  export type GroupBody = z.infer<typeof groupBodySchema>;
  export type GroupDoc = GroupBody & { id: string };

  export const createGroupInputSchema = z.object({
    name: z.string().min(1, "名前を入力してください").max(60),
    ownerUid: z.string().min(1), // UI は単数のまま受け取り、repository で配列化
  });

  export type MemberRole = "owner" | "organizer" | "member";
  export function deriveRole(group: GroupBody, uid: string): MemberRole {
    if (group.ownerUids.includes(uid)) return "owner";
    if (group.organizerUids.includes(uid)) return "organizer";
    return "member";
  }
  ```
- **MIRROR**: 既存 `groupBodySchema` の構造をそのまま踏襲。`refine` で invariant を表現
- **IMPORTS**: `z`, `Timestamp`
- **GOTCHA**:
  - refine の順番重要: `memberUids.min(1)` → `organizerUids.min(1)` → invariant の順で評価
  - `MemberRole` / `deriveRole` を export しておくと UI で統一的に使える
- **VALIDATE**: `z.parse({ ownerUids: ["a"], organizerUids: ["a"], memberUids: ["a", "b"], name: "x", createdAt: ts })` が成功、`z.parse({ ownerUids: ["c"], organizerUids: ["a"], memberUids: ["a"], ... })` が refine で失敗

### Task 2: repository のフィールド対応と新規メソッド追加

- **ACTION**: `src/lib/firebase/repositories/groups.ts` を更新
- **IMPLEMENT**:
  1. `createGroup` の書込オブジェクトを `{ ownerUids: [input.ownerUid], organizerUids: [input.ownerUid], memberUids: [input.ownerUid], ... }` に変更
  2. 新規メソッド:
     ```ts
     export async function updateGroupRoles(
       gid: string,
       patch: { ownerUids?: string[]; organizerUids?: string[]; memberUids?: string[] },
     ): Promise<void> {
       try {
         await updateDoc(groupDocRef(gid), patch);
         logger.info("group roles updated", { gid, patch: Object.keys(patch) });
       } catch (e) {
         const wrapped = AppError.from(e, "firestore/write_failed", "ロール更新に失敗しました");
         logger.warn(wrapped.message, { code: wrapped.code, gid });
         throw wrapped;
       }
     }
     ```
  3. `removeMemberSelf` を「memberUids / organizerUids / ownerUids の 3 配列から同時に除去」に変更（`arrayRemove` を 3 回適用）
- **MIRROR**: `updateGroupName` の try/catch 構造、`removeMemberSelf` の `arrayRemove` パターン
- **IMPORTS**: `arrayRemove` / `updateDoc` 既存
- **GOTCHA**:
  - Firestore の単一 update 内で同じフィールドに対する `arrayRemove` 複数呼出は問題ないが、異なるフィールドなら 1 updateDoc で指定可能（`{ ownerUids: arrayRemove(uid), organizerUids: arrayRemove(uid), memberUids: arrayRemove(uid) }`）
  - `updateGroupRoles` に渡す patch は配列全置換（partial にしない）。呼び出し側で「現在の配列 + 変更分」を組み立てて渡す方針
- **VALIDATE**: 新規 group 作成後に `getGroup(gid)` で `ownerUids: [uid]` / `organizerUids: [uid]` / `memberUids: [uid]` が全て設定されていること

### Task 3: Firestore Security Rules の書換

- **ACTION**: `firestore.rules` を更新
- **IMPLEMENT**:
  ```js
  function isSignedIn() { return request.auth != null; }

  function groupData(gid) {
    return get(/databases/$(database)/documents/groups/$(gid)).data;
  }

  function isGroupMember(gid) {
    return isSignedIn()
           && exists(/databases/$(database)/documents/groups/$(gid))
           && request.auth.uid in groupData(gid).memberUids;
  }

  function isOrganizer(gid) {
    return isSignedIn()
           && exists(/databases/$(database)/documents/groups/$(gid))
           && request.auth.uid in groupData(gid).organizerUids;
  }

  function isOwner(gid) {
    return isSignedIn()
           && exists(/databases/$(database)/documents/groups/$(gid))
           && request.auth.uid in groupData(gid).ownerUids;
  }

  // structures: 運営のみ write、メンバー全員 read
  match /structures/{sid} {
    allow read: if isGroupMember(resource.data.groupId);
    allow create: if isSignedIn()
                  && request.resource.data.createdByUid == request.auth.uid
                  && isOrganizer(request.resource.data.groupId);
    allow update, delete: if isOrganizer(resource.data.groupId);
  }

  // tournaments: read は認証済み（参加者向け QR 直踏み）／ write は運営のみ
  match /tournaments/{tid} {
    allow read: if isSignedIn();
    allow create: if isSignedIn()
                  && request.resource.data.createdByUid == request.auth.uid
                  && isOrganizer(request.resource.data.groupId);
    allow update, delete: if isOrganizer(resource.data.groupId);

    // players: self create (一般メンバーも可) / self displayName update / organizer bust/seat / delete は self or organizer
    match /players/{pid} {
      allow read: if isSignedIn();
      allow create: if isSignedIn()
                    && pid == request.auth.uid
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.isBusted == false
                    && request.resource.data.tableNum == null
                    && request.resource.data.seatNum == null;
      allow update: if isSignedIn()
                    && (
                      (pid == request.auth.uid && ...self-only diff...)
                      ||
                      (exists(/databases/$(database)/documents/tournaments/$(tid))
                       && isOrganizer(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
                       && ...organizer diff...)
                    );
      allow delete: if isSignedIn()
                    && (pid == request.auth.uid
                        || (exists(/databases/$(database)/documents/tournaments/$(tid))
                            && isOrganizer(get(...).data.groupId)));
    }

    match /{sub=**} {
      allow read: if isSignedIn();
      allow write: if isSignedIn()
                   && exists(/databases/$(database)/documents/tournaments/$(tid))
                   && isOrganizer(get(...).data.groupId);
    }
  }

  // groups: read は memberUids、update は owner 全権 / 非メンバーの self-add / 非 owner の self-leave
  match /groups/{gid} {
    allow read: if isSignedIn() && request.auth.uid in resource.data.memberUids;
    allow create: if isSignedIn()
                  && request.resource.data.ownerUids.size() == 1
                  && request.resource.data.ownerUids.hasOnly([request.auth.uid])
                  && request.resource.data.organizerUids.hasOnly([request.auth.uid])
                  && request.resource.data.memberUids.hasOnly([request.auth.uid]);
    allow update: if (
      // owner: 自由更新（ただし ownerUids は空にできない、createdAt 不変）
      isSignedIn()
      && request.auth.uid in resource.data.ownerUids
      && request.resource.data.ownerUids.size() >= 1
      && request.resource.data.createdAt == resource.data.createdAt
    ) || (
      // self-add（招待コード加入）: 一般メンバーとして入る
      isSignedIn()
      && !(request.auth.uid in resource.data.memberUids)
      && request.auth.uid in request.resource.data.memberUids
      && !(request.auth.uid in request.resource.data.organizerUids)
      && !(request.auth.uid in request.resource.data.ownerUids)
      && request.resource.data.memberUids.size() == resource.data.memberUids.size() + 1
      && request.resource.data.memberUids.hasAll(resource.data.memberUids)
      && request.resource.data.organizerUids == resource.data.organizerUids
      && request.resource.data.ownerUids == resource.data.ownerUids
      && request.resource.data.name == resource.data.name
      && request.resource.data.createdAt == resource.data.createdAt
    ) || (
      // self-leave（非 owner のみ）
      isSignedIn()
      && request.auth.uid in resource.data.memberUids
      && !(request.auth.uid in resource.data.ownerUids)
      && !(request.auth.uid in request.resource.data.memberUids)
      && !(request.auth.uid in request.resource.data.organizerUids)
      && !(request.auth.uid in request.resource.data.ownerUids)
      && request.resource.data.memberUids.size() == resource.data.memberUids.size() - 1
      && resource.data.memberUids.hasAll(request.resource.data.memberUids)
      && request.resource.data.ownerUids == resource.data.ownerUids
      && request.resource.data.name == resource.data.name
      && request.resource.data.createdAt == resource.data.createdAt
    );

    allow delete: if isSignedIn() && request.auth.uid in resource.data.ownerUids;
  }

  // groupJoinCodes: create は isOrganizer（運営のみ発行可）
  match /groupJoinCodes/{code} {
    allow read: if isSignedIn();
    allow create: if isSignedIn()
                  && request.resource.data.createdByUid == request.auth.uid
                  && isOrganizer(request.resource.data.gid);
    // 既存 update / delete の分岐は維持（owner / gid owner → ownerUids 判定に置換）
    ...
  }

  // users: 既存のまま self-only read/write
  ```
- **MIRROR**: 既存 rules のヘルパー構造、owner/member 分岐の 3 分岐パターン
- **IMPORTS**: N/A (rules)
- **GOTCHA**:
  - `request.resource.data.ownerUids == resource.data.ownerUids` のリスト比較は rules で動作する（Firestore documentation 参照）
  - `hasOnly` は配列に「それだけが含まれる」を検証するが、順序無視
  - `isOrganizer` の get() コストは rule 評価内 cache されるが、structures / tournaments / groupJoinCodes で連続書込すると各 rule 評価で 1 read 消費（20 人 × 月 1-2 回では無視可）
  - 既存 tests（emulator test）はすべて rules 変更に追随させる必要あり
- **VALIDATE**: emulator で以下を通す
  - owner は organizerUids / ownerUids を書き換えられる
  - organizer 以下は structures / tournaments を create できない
  - 一般メンバーは tournaments を read できるが write できない
  - 一般メンバーは players/{uid} を create できる
  - self-leave で owner は脱退できない（ownerUids に含まれていたら reject）

### Task 4: group service の昇降格フロー実装

- **ACTION**: `src/lib/services/group.ts` に以下を追加 / 変更
- **IMPLEMENT**:
  ```ts
  // 昇格: member → organizer（owner のみ実行可、rule で担保）
  export async function promoteToOrganizer({ gid, actorUid, targetUid }: {...}): Promise<void> {
    const group = await getGroup(gid);
    assertOwner(group, actorUid);  // owner 判定
    if (!group.memberUids.includes(targetUid)) throw new AppError("対象はメンバーではありません", "group/not-member");
    if (group.organizerUids.includes(targetUid)) return;  // idempotent
    await updateGroupRoles(gid, { organizerUids: [...group.organizerUids, targetUid] });
    logger.info("promote to organizer", { gid, actorUid, targetUid });
  }

  // 降格: organizer → member（owner のみ、ただし対象が owner でない）
  export async function demoteToMember({ gid, actorUid, targetUid }: {...}): Promise<void> {
    const group = await getGroup(gid);
    assertOwner(group, actorUid);
    if (group.ownerUids.includes(targetUid))
      throw new AppError("オーナーは運営降格できません。先にオーナー降格してください", "group/target-is-owner");
    if (!group.organizerUids.includes(targetUid)) return;  // idempotent
    await updateGroupRoles(gid, {
      organizerUids: group.organizerUids.filter((u) => u !== targetUid),
    });
    logger.info("demote to member", { gid, actorUid, targetUid });
  }

  // owner 昇格: organizer → owner（owner のみ、対象は既に organizer）
  export async function promoteToOwner({ gid, actorUid, targetUid }: {...}): Promise<void> {
    const group = await getGroup(gid);
    assertOwner(group, actorUid);
    if (!group.organizerUids.includes(targetUid))
      throw new AppError("運営でないメンバーはオーナー昇格できません", "group/target-not-organizer");
    if (group.ownerUids.includes(targetUid)) return;  // idempotent
    await updateGroupRoles(gid, { ownerUids: [...group.ownerUids, targetUid] });
    logger.info("promote to owner", { gid, actorUid, targetUid });
  }

  // owner 降格: owner → organizer（owner のみ、最後のオーナーは降格不可）
  export async function demoteOwner({ gid, actorUid, targetUid }: {...}): Promise<void> {
    const group = await getGroup(gid);
    assertOwner(group, actorUid);
    if (!group.ownerUids.includes(targetUid)) return;
    if (group.ownerUids.length <= 1)
      throw new AppError("最後のオーナーは降格できません", "group/last-owner");
    await updateGroupRoles(gid, {
      ownerUids: group.ownerUids.filter((u) => u !== targetUid),
    });
    logger.info("demote owner", { gid, actorUid, targetUid });
  }

  function assertOwner(group: GroupDoc, uid: string): void {
    if (!group.ownerUids.includes(uid)) {
      throw new AppError("オーナーのみ実行できます", "group/not-owner");
    }
  }
  ```
- **ACTION 2**: 既存関数の更新:
  ```ts
  // leaveGroup: 最後のオーナーのみ脱退不可、それ以外は脱退可能
  export async function leaveGroup({ gid, uid }: {...}) {
    const group = await getGroup(gid);
    if (group.ownerUids.includes(uid) && group.ownerUids.length <= 1) {
      throw new AppError("最後のオーナーは脱退できません。先に別のメンバーをオーナーに昇格するか group を削除してください。", "group/last-owner-cannot-leave");
    }
    // ... (既存の memberUids 除去を、organizerUids / ownerUids も含めるよう repository 側で拡張)
  }

  // deleteGroupByOwner: owner チェックを配列対応
  export async function deleteGroupByOwner({ gid, uid }: {...}) {
    const group = await getGroup(gid);
    if (!group.ownerUids.includes(uid)) {
      throw new AppError("オーナーのみ削除できます", "group/not-owner");
    }
    // ...
  }

  // renameGroup: 同上
  export async function renameGroup({ gid, uid, name }: {...}) {
    // ownerUids.includes(uid) チェックに変更
  }
  ```
- **MIRROR**: 既存 `leaveGroup` / `deleteGroupByOwner` の owner 判定パターン。`arrayUnion` / `arrayRemove` ではなく「配列フィルタして全置換」を採用（並行 race の損害が小さい & 検証容易）
- **IMPORTS**: `updateGroupRoles`, 既存 `getGroup` 他
- **GOTCHA**:
  - 全置換 vs `arrayUnion/Remove`: Firestore race は現実的にほぼない（owner 操作は 1 人ずつ）
  - `promoteToOrganizer` で target が既に organizer の場合は no-op（冪等）
  - 一般メンバー→オーナー直接昇格は禁止（先に organizer を経由）。API 的にも `promoteToOwner` は `organizerUids.includes(target)` を必須にする
- **VALIDATE**:
  - unit test: owner が member を organizer に昇格 → `organizerUids` に追加されている
  - owner でないユーザーが昇格実行 → `group/not-owner` throw
  - 最後のオーナーの降格 → `group/last-owner` throw
  - 対象が member の `promoteToOwner` → `group/target-not-organizer` throw

### Task 5: `useCurrentGroup` に role 情報を追加

- **ACTION**: `src/lib/services/current-group.tsx` を更新
- **IMPLEMENT**:
  ```ts
  export interface CurrentGroupContextValue {
    loading: boolean;
    groups: GroupDoc[];
    currentGroupId: string | null;
    setCurrentGroupId: (gid: string | null) => void;
    refreshGroups: () => Promise<void>;
    groupIds: string[];

    // Phase 4.6 追加
    currentGroupRole: MemberRole | null;   // "owner" | "organizer" | "member" | null
    isOrganizer: boolean;  // currentGroupRole === "owner" || "organizer"
    isOwner: boolean;      // currentGroupRole === "owner"
  }
  ```
- **MIRROR**: 既存 context の state 拡張パターン。useMemo で派生値を安定化
- **IMPORTS**: `deriveRole`, `MemberRole` from `@/lib/firebase/schemas/group`
- **GOTCHA**:
  - currentGroupId が null の場合は role も null
  - isOrganizer は UI ガードで頻繁に使うため、毎回 filter するよりも memoize
- **VALIDATE**: context provider の test が存在すれば role 派生のテストを追加

### Task 6: UI の role gate

- **ACTION**: 以下のファイルで `isOrganizer` / `isOwner` に基づく UI 出し分け
- **IMPLEMENT**:
  1. **`src/app/tournaments/tournaments-client.tsx`**:
     - `[新規作成]` ボタンを `isOrganizer` で gate
     - トーナメントカードに `isOrganizer === false` なら「参加する」ボタン追加（→ `/tournaments/{tid}/live` 遷移、live 側で `joinAsCurrentUser`）
  2. **`src/app/tournaments/[tid]/page.tsx`**:
     - `useCurrentGroup()` を参照し、`isOrganizer === false` なら `redirect(`/tournaments/${tid}/live`)`
     - ただし server component で redirect する場合、tournament.groupId を先に読んで role を解決する必要あり（tricky）
     - 代替: Client Component 側で分岐して router.replace する方が単純
  3. **`src/app/tournaments/[tid]/live/live-client.tsx`**:
     - 未参加（`me === null`）かつ state === "setup" or "seating" or "running" （late entry 可）なら「参加する」ボタン
     - クリックで `joinAsCurrentUser({ tid })` → 成功後 re-subscribe で `me` が埋まる
  4. **`src/app/tournaments/[tid]/dashboard-client.tsx`**:
     - useEffect で `!isOrganizer` なら `router.replace(/tournaments/${tid}/live)` をガード（UI を描画する前に）
  5. **`src/app/structures/structures-client.tsx`**:
     - `!isOrganizer` なら編集ボタン非表示、`/structures/new` と edit リンクも非表示
  6. **`src/app/page.tsx`（Phase 4.5 で Client Component 化済み前提）**:
     - 「ストラクチャ」ボタンを `isOrganizer` で gate（一般メンバーは「トーナメント」「サークル」のみ）
  7. **`src/app/groups/[gid]/group-detail-client.tsx`**:
     - メンバー一覧に role badge（オーナー / 運営 / 一般）
     - `isOwner` の場合、各メンバー行に昇降格ボタン（`[運営へ昇格] / [一般へ降格] / [オーナーへ] / [オーナー降格]`）
     - ボタン活性条件: target ≠ self（自己降格を避ける）、last-owner の降格不可、target が member で owner への直接昇格は不可（先に organizer 必要）
- **MIRROR**: Phase 4.5 の Task 4（TimerControls の自己参加ボタン）と同じ Button / run() パターン
- **IMPORTS**: service 新規関数（`promoteToOrganizer` / `demoteToMember` / `promoteToOwner` / `demoteOwner`）
- **GOTCHA**:
  - UI gate は rule 側の二重防御。一般メンバーが URL 直打ちしても rule で permission-denied
  - structures 完全非表示派の議論: 今回は閲覧可（一般メンバーもブラインド構造を見たいはず）
  - dashboard redirect 時の flash: useEffect + router.replace は一瞬 dashboard が見えるため、role 未確定時はローディング表示で遅延
- **VALIDATE**: 一般メンバー試験アカウントで全画面を踏破し、運営 UI が見えないこと

### Task 7: 招待コード加入フローの再利用（変更不要）

- **ACTION**: `src/lib/services/group.ts` の `consumeJoinCode` は memberUids のみ arrayUnion しているので、そのまま一般メンバー加入になる（organizerUids / ownerUids には追加されない）
- **IMPLEMENT**: 変更不要。確認のみ
- **MIRROR**: 既存ロジック
- **IMPORTS**: 変更なし
- **GOTCHA**: rule 側で「self-add は memberUids のみ +1、organizerUids / ownerUids 不変」を要求している（Task 3）。consumeJoinCode のクライアントコードがこの不変条件を満たしていれば OK
- **VALIDATE**: emulator で一般ユーザーが招待コードから加入 → memberUids のみに追加、organizerUids / ownerUids は不変

### Task 8: Migration スクリプト

- **ACTION**: `scripts/migrate-phase-4.6-roles.ts` を作成
- **IMPLEMENT**:
  ```ts
  #!/usr/bin/env tsx
  // Admin SDK で全 groups を scan し、ownerUid → ownerUids / organizerUids を付与。
  // ownerUid フィールドは削除。
  //
  // Usage:
  //   GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrate-phase-4.6-roles.ts [--dry-run]

  import admin from "firebase-admin";
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });

  const db = admin.firestore();

  async function main() {
    const dryRun = process.argv.includes("--dry-run");
    const snap = await db.collection("groups").get();
    console.log(`found ${snap.size} groups`);

    for (const doc of snap.docs) {
      const data = doc.data();
      if (data.ownerUids) {
        console.log(`  ${doc.id}: already migrated, skip`);
        continue;
      }
      const ownerUid: string = data.ownerUid;
      const memberUids: string[] = data.memberUids ?? [];
      if (!ownerUid) {
        console.warn(`  ${doc.id}: no ownerUid, skip`);
        continue;
      }
      const patch = {
        ownerUids: [ownerUid],
        organizerUids: [...memberUids],  // 全員 organizer
        ownerUid: admin.firestore.FieldValue.delete(),
      };
      console.log(`  ${doc.id}: ${dryRun ? "[dry-run] " : ""}would patch`, patch);
      if (!dryRun) {
        await doc.ref.update(patch);
      }
    }
    console.log("migration done");
  }
  main().catch((e) => { console.error(e); process.exit(1); });
  ```
- **MIRROR**: Phase 2.5 の migration がある場合はそれをミラー
- **IMPORTS**: `firebase-admin`（dev dependency で追加: `npm i -D firebase-admin tsx`）
- **GOTCHA**:
  - Service Account Key は `.gitignore` に含める
  - `--dry-run` で先に確認
  - Firestore のローカル emulator でも走るが、本番実行は必ず backup 取得後
  - 既に ownerUids が入っている doc は skip（冪等）
- **VALIDATE**:
  - dry-run で期待される patch 内容が出力される
  - 本実行後、`firestore rules` が新形式を受け入れ、旧 `ownerUid` フィールドが消えている

### Task 9: group-membership.md の更新

- **ACTION**: `.claude/rules/group-membership.md` を更新
- **IMPLEMENT**:
  - 「ロール定義」セクションを新設し、owner / organizer / member の 3 階層と invariant を記載
  - 「権限マトリクス」を追加:
    | 操作 | owner | organizer | member |
    |---|---|---|---|
    | group rename / delete / roles 変更 | ○ | × | × |
    | structures CRUD | ○ | ○ | read のみ |
    | tournaments CRUD | ○ | ○ | read のみ |
    | tournaments/players create（自分の参加） | ○ | ○ | ○ |
    | tournaments/players bust / seat（他人） | ○ | ○ | × |
    | 招待コード発行 | ○ | ○ | × |
  - 既存の「既知のセキュリティリスク」セクションに `usesCount` 空消費への言及を残す（変更なし）
- **MIRROR**: 既存ファイル構造
- **IMPORTS**: N/A
- **VALIDATE**: CLAUDE.md から参照されるため、md-lint が通ること（doc update 系 hook があれば）

### Task 10: README の migration 手順追記

- **ACTION**: `README.md` の「運用手順」「Migration」セクションに Phase 4.6 の手順を追加
- **IMPLEMENT**:
  ```md
  ## Phase 4.6 Migration (ownerUid → ownerUids / organizerUids)

  Phase 4.5 → 4.6 への移行は破壊的スキーマ変更。既存 groups を以下のスクリプトで一括変換する:

  1. Firebase Console で **backup を取得**（Firestore → Export）
  2. `.env` に `GOOGLE_APPLICATION_CREDENTIALS=./service-account.json` を設定
  3. Dry-run: `npx tsx scripts/migrate-phase-4.6-roles.ts --dry-run`
  4. 本実行: `npx tsx scripts/migrate-phase-4.6-roles.ts`
  5. `firebase deploy --only firestore:rules` で新 rules をデプロイ
  ```
- **MIRROR**: Phase 2.5 の migration 記述があればそれ
- **VALIDATE**: README を読むだけで migration を実行できる

### Task 11: テスト更新 / 追加

- **ACTION**:
  - `src/lib/services/group.test.ts`（存在しなければ新設）に以下を追加:
    - `promoteToOrganizer` / `demoteToMember` / `promoteToOwner` / `demoteOwner` の happy path と `group/not-owner` / `group/last-owner` / `group/target-not-organizer` エラー path
    - `leaveGroup`: 最後のオーナーは throw、別オーナーがいれば可
    - `deleteGroupByOwner`: `ownerUids.includes` に基づく許可判定
  - `src/lib/firebase/repositories/groups.test.ts`（同上）に:
    - `createGroup` が `ownerUids / organizerUids / memberUids` を全て設定すること
    - `updateGroupRoles` が指定 patch のみ反映
  - `firestore.rules` の emulator test（存在すれば）を新条件に合わせて更新
- **IMPLEMENT**: Task 4 で追加した service 関数に対応する describe ブロックを書く
- **MIRROR**: `receipt.test.ts` の構造
- **IMPORTS**: vi.mock で `getGroup` / `updateGroupRoles` / `removeMemberSelf` / `deleteGroup` を mock
- **GOTCHA**: `updateGroupRoles` mock は呼出引数を assert するだけで十分（実際の Firestore 挙動は emulator test で担保）
- **VALIDATE**: `npm test` で pass

### Task 12: PRD の更新

- **ACTION**: `.claude/PRPs/prds/allin-timer.prd.md` を更新
- **IMPLEMENT**:
  - Implementation Phases テーブルに Phase 4.6 行を追加（Status: `pending`、Depends: `4.5`）
  - Phase 5 の Depends を `3, 4, 4.5` → `3, 4, 4.5, 4.6` に変更
  - Phase Details に Phase 4.6 セクションを追記（Goal / Scope / Success signal）
  - Parallelism Notes に「Phase 4.6 は 4.5 完了後。実装 phase 単独」を追記
- **MIRROR**: Phase 2.5 / 4.5 の既存 PRD 記述
- **VALIDATE**: PRD テーブルが崩れない、リンク切れがない

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `promoteToOrganizer` happy | owner that promotes a member | `organizerUids` に追加 | - |
| `promoteToOrganizer` not owner | non-owner が実行 | `group/not-owner` throw | yes |
| `promoteToOrganizer` already organizer | idempotent | 冪等（no-op） | yes |
| `demoteToMember` happy | organizer を member に | `organizerUids` から除外 | - |
| `demoteToMember` target is owner | target が ownerUids に含まれる | `group/target-is-owner` throw | yes |
| `promoteToOwner` happy | organizer → owner | `ownerUids` 追加 | - |
| `promoteToOwner` target is member | organizer でない target | `group/target-not-organizer` throw | yes |
| `demoteOwner` happy | owner 2 人中 1 人降格 | `ownerUids` から除外 | - |
| `demoteOwner` last owner | 最後の 1 人 | `group/last-owner` throw | yes |
| `leaveGroup` owner が脱退（他 owner あり） | 成功 | memberUids / organizerUids / ownerUids から除外 | - |
| `leaveGroup` 最後のオーナー | 失敗 | `group/last-owner-cannot-leave` throw | yes |
| `deleteGroupByOwner` owner | 成功 | deleteGroup 呼出 | - |
| `deleteGroupByOwner` non-owner | `group/not-owner` throw | - | yes |
| `createGroup` | input: ownerUid | 書込みオブジェクトに `ownerUids: [uid]` / `organizerUids: [uid]` / `memberUids: [uid]` | - |
| `updateGroupRoles` | patch | 指定フィールドのみ updateDoc | - |
| `deriveRole` owner | uid in ownerUids | `"owner"` | - |
| `deriveRole` organizer | uid in organizerUids only | `"organizer"` | - |
| `deriveRole` member | uid in memberUids only | `"member"` | - |

### Rules Tests (emulator) — 重要

| Test | 期待 |
| ---- | ---- |
| 非メンバーが structures を read | deny |
| 一般メンバーが structures を read | allow |
| 一般メンバーが structures を create | deny |
| organizer が structures を create | allow |
| 一般メンバーが tournaments を read | allow (認証済み) |
| 一般メンバーが tournaments を create | deny |
| 一般メンバーが tournaments/{tid}/players/{uid} を create | allow |
| 一般メンバーが tournaments/{tid}/players/{other} を update | deny |
| 一般メンバーが招待コードを create | deny (organizer のみ) |
| 非 owner が organizerUids を更新 | deny |
| owner が organizerUids に追加 | allow |
| owner が ownerUids を空にする更新 | deny |
| 非メンバーが memberUids に自分を追加 | allow（招待コード経由） |
| 非メンバーが memberUids と同時に organizerUids に自分を追加 | deny |

### Edge Cases Checklist

- [x] 最後のオーナーの降格 / 脱退 / group 削除時の owner 残存検証
- [x] `promoteToOwner` で target が organizer でない場合（直接 member → owner を防ぐ）
- [x] 招待コード加入で organizerUids / ownerUids が誤って膨らまないよう rule で不変条件チェック
- [x] 一般メンバーが URL 直打ちで `/tournaments/{tid}` （dashboard）にアクセスした場合、UI + rule で block
- [x] role 変更直後の UI 反映（`useCurrentGroup` の `refreshGroups` が呼ばれること）
- [x] Migration 済み doc を dry-run / 本実行すると skip される冪等性
- [x] 2 owner 環境で 1 owner が group を削除 → もう 1 owner の users/{uid}.groupIds は残留（既存仕様）。UI 側で「見えない group」として扱えることを確認（listMyGroups が permission-denied で skip する既存動作）

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

EXPECT: Zero lint errors

### Unit Tests

```bash
npm test -- --run
```

EXPECT: All tests pass

### Rules Tests

```bash
firebase emulators:exec "npm test -- rules" --only firestore
```

EXPECT: 上記 Rules Tests の全シナリオが pass

### Migration Dry-Run

```bash
GOOGLE_APPLICATION_CREDENTIALS=./service-account.json npx tsx scripts/migrate-phase-4.6-roles.ts --dry-run
```

EXPECT: 既存 groups を scan し、ownerUids / organizerUids の patch が console に出力される。書込なし。

### Browser Validation

```bash
npm run dev
```

シナリオ:
- [ ] オーナーでログイン → `/groups/[gid]` でロール badge 表示、昇降格ボタン表示
- [ ] オーナー以外（organizer / member）でログイン → 昇降格ボタン非表示
- [ ] organizer でログイン → `/tournaments` で「新規作成」ボタン見える、ダッシュボード開ける
- [ ] 一般メンバーでログイン → `/tournaments` で「新規作成」なし、カードに「参加する」ボタン、ダッシュボード URL 直打ちで `/live` リダイレクト
- [ ] 一般メンバーが `/tournaments/[tid]/live` で「参加する」ボタンクリック → players に追加される
- [ ] オーナーが organizer に昇格 → 対象ユーザーのダッシュボード権限が反映される
- [ ] 最後のオーナーが降格 / 脱退しようとすると error 表示
- [ ] 招待コード加入 → デフォルト「一般」で入る → オーナーが「運営へ昇格」

---

## Acceptance Criteria

- [ ] 12 タスクすべて完了
- [ ] typecheck / lint / test / build / rules test すべて green
- [ ] 全 UX シナリオの手動確認（owner / organizer / member の 3 視点）
- [ ] Migration スクリプトが dry-run / 本実行の両方で期待通り動作
- [ ] PRD / README / group-membership.md が 3 階層モデルに更新済み
- [ ] Firestore rules が新スキーマに準拠し、emulator で 3 階層の権限が正しく enforce される

## Completion Checklist

- [ ] schema / repository / rules / services / UI の 5 層すべてが新ロールモデルに整合
- [ ] 既存メンバーが全員 organizer として動作する（migration 後に operation テスト）
- [ ] 一般メンバーがトーナメント参加を完遂できる（ワンタップ参加）
- [ ] `/tournaments/[tid]` の dashboard redirect が role change 後に正しく反映（再レンダリング）
- [ ] test coverage: 昇降格 / last-owner ガード / leave / delete の各 path
- [ ] 無関係の Phase 4.5 機能（Winner 演出、auto-finish、匿名削除）が回帰していない
- [ ] AppError ラップ・logger 経路・repository 層経由の規約順守

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| Migration スクリプト実行失敗で doc が中途半端な状態になる | L | H | dry-run 必須、本実行前に Firestore export で backup |
| 新 rules が既存クライアント（migration 前の旧アプリ）を拒否 | M | M | 新 rules デプロイと migration を同期実行。旧アプリはデプロイ時点で強制リロードされる（Vercel fresh deploy） |
| 最後のオーナー降格の race condition | L | M | service + rule の二重チェック。rule 側で `request.resource.data.ownerUids.size() >= 1` ガード |
| 一般メンバーが /live で「参加する」連打 → 複数 player ドキュメント作成 | L | L | `upsertPlayer` が idempotent（pid=uid 前提）なので 2 回目以降は無視 |
| Cloud Functions で users/{uid}.groupIds 逆引き不整合 | L | L | 現状 client-side の best-effort で維持（Phase 2.5 からの制約、本 phase では変更なし） |
| UI ガードを忘れた画面で一般メンバーが運営ボタンを押せてしまう | M | M | rule 側の isOrganizer チェックで実際の書込は拒否される（二重防御）。UI 側は Phase 5 のドライランで総ざらい |
| rule 内 get() の read quota 増加 | L | L | 同一 rule 評価内の同じ gid に対する get は cache される。20 人 × 月 1-2 回スケールでは問題なし |
| 既存ロール（Phase 2.5 時点の運営メンバー）の人が「一般メンバー相当の挙動してほしい」運用変更を事後希望 | M | L | オーナーが手動で `demoteToMember` を叩けば対応可（UI で提供） |

## Notes

- **オーナー複数化の UX 意図**: 実サークルで「2-3 人で運営、その中の誰かがグループの最終判断者」という体制。全員に削除権限を持たせると誤操作リスクが上がるため、オーナー層を意図的に狭く保つ。
- **招待コード 1 種類戦略**: 「一般メンバー用／運営用」を分けると運用が煩雑。オーナーの「昇格」操作で十分賄える（加入後 1 クリック）。
- **dashboard redirect の UX**: 一般メンバーが URL 直打ちで dashboard に来た場合、一瞬 "dashboard 読込中…" が見える可能性あり。`useCurrentGroup` が loading な間は `<Loading />` を出すことで flash を最小化。
- **Phase 5 への繋ぎ**: Phase 5（field test）は 4.6 完了後。ロール機能が実サークルで期待通り動作するか、owner-only UI が十分かを確認するドライランを兼ねる。
- **Cloud Functions 化の将来検討**: ロール変更は現状 client-side transaction ベース。将来の audit log や通知機能が必要になったら Callable Function 化する設計余地あり。本 phase では不採用。

---
