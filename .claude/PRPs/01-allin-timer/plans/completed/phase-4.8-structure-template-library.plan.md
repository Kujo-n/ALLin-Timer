# Plan: Phase 4.8 — Structure Template Library

## Summary

サークル横断でストラクチャのひな形を共有できる **テンプレート図書館**を導入する。`structureTemplates/{tid}` コレクションを新設し、サインイン済みユーザーは誰でも閲覧・新規作成可能。編集は本人のみ、削除は本人または**テンプレート管理者**（`templateAdmins/{uid}` doc 存在）。作成者脱会後も管理者がクリーンアップできる。`/templates` 一覧・`/templates/new` 作成・`/templates/{tid}/edit` 編集の 3 ページと、`/structures/new` での Firestore 取得テンプレート選択 UI を追加。Firestore Rules に 2 match ブロックを追加デプロイ + 初回管理者を Console で手動 seed する運用手順あり。

## User Story

As a サークル運営者（初心者・出先でスマホからでも操作したい）,
I want アプリ上でストラクチャのテンプレートを追加・選択でき、他サークルの運営が公開したテンプレートも流用できる状態,
So that 開発環境を触らず・サークル固有の「先人の工夫」をその場で再利用してストラクチャ設計の初心者ペインを解消できる。

And as a テンプレート管理者,
I want 作成者がサークル参加をやめてしまったテンプレートも削除できる状態,
So that 退会ユーザーの残置テンプレを整理して図書館を健全に保てる。

## Problem → Solution

**Current state (Phase 4.7 完了時点)**:

- `/structures/new` はゼロからの編集のみ。初心者運営者は「SB/BB/持続時間をどう設定すればいいか」が分からず詰まる
- 他サークルから持ち込めるテンプレート共有の仕組みがない
- 開発者が定数としてテンプレを仕込むのは MIT ライセンスの公開リポジトリでメンテ不便（出先でスマホから追加できない）

**Desired state (Phase 4.8 完了時点)**:

- **`structureTemplates/{tid}` コレクション**: サインイン済みユーザー全員が閲覧・作成可能。作成者情報（`createdByUid` / `createdByDisplayName`）は doc 内に snapshot として保存（`users/{uid}` の self-only read 制約回避）
- **`/templates` ページ**: 全テンプレの一覧カード（作成者名・初期 stack・レベル数表示）、本人のみ「編集」「削除」ボタン、管理者は他人のテンプレにも「削除」ボタンが出る
- **`/templates/new` / `/templates/{tid}/edit`**: StructureForm を再利用したテンプレ作成・編集画面
- **`/structures/new` の TemplatePicker**: Phase 4.7 の定数ベースから Firestore クエリベースに変更。`listStructureTemplates()` で全件取得し、選択でフォームに一括反映
- **`templateAdmins/{uid}` コレクション**: doc 存在 = 管理者。rule で `isTemplateAdmin()` helper を提供。bootstrap は Firestore Console で最初の 1 人を手動 seed
- Firestore Rules に 2 match ブロック追加：`structureTemplates` は read=signed-in / create=self-named / update=owner-only / **delete=owner OR admin**。`templateAdmins` は read=self / list=false / write=admin-only

## Metadata

- **Complexity**: Medium-Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **Source memo**: [tmp/08_Phase4.6_memo.md](../../../tmp/08_Phase4.6_memo.md) item 2 + [tmp/09_pahse4.7_memo.md](../../../tmp/09_pahse4.7_memo.md)
- **PRD Phase**: Phase 4.8 — Structure Template Library（Phase 4.7 完了後・Phase 5 前）
- **Depends on**: Phase 4.7 の `levelSchema.isBreak` / `structureBodySchema.rebuyStack/addOnStack` 拡張
- **Estimated Files**: 約 17 files（新規 14・編集 3）

---

## UX Design

### `/templates` （新規・一覧）

```
┌─────────────────────────────────────────────────────┐
│ テンプレート図書館                      [新規作成]  │
│ サークル横断で共有されるストラクチャのひな形。       │
├─────────────────────────────────────────────────────┤
│ ┌───────────────────────────┐ ┌───────────────────┐ │
│ │ 標準 20min               │ │ ターボ 10min      │ │
│ │ 平均的な進行             │ │ 短時間向け        │ │
│ │ 初期 10,000 / 15 レベル  │ │ 初期 5,000 / 12Lv │ │
│ │ 作成者: たろう           │ │ 作成者: なつき    │ │
│ │ [このテンプレを使う]     │ │ [このテンプレを..│ │
│ │ [編集] [削除]  ←本人のみ  │ │ [削除] ← 管理者   │ │
│ └───────────────────────────┘ └───────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### `/templates/new`

```
┌─────────────────────────────────────────────────────┐
│ テンプレートを作成                                   │
│ 名前:        [__________]                            │
│ 説明（任意）: [____________________]                 │
│ 初期スタック / リバイ / アドオン / 締切Lv / levels  │
│ ※ 入力項目は StructureForm と同じ                   │
│ [保存]  [キャンセル]                                 │
└─────────────────────────────────────────────────────┘
```

### `/structures/new` の TemplatePicker（Phase 4.7 から変更）

```
┌─────────────────────────────────────────────────────┐
│ ストラクチャを新規作成                                │
│                                                      │
│ ── テンプレートから読み込む（任意） ──                │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│ │ 標準    │ │ ターボ  │ │ ディープ│ ... (Firestore) │
│ │ 作成:   │ │ 作成:   │ │ 作成:   │                │
│ │ たろう  │ │ なつき  │ │ たろう  │                │
│ └─────────┘ └─────────┘ └─────────┘                │
│ → /templates で全件閲覧・新規作成                    │
│                                                      │
│ ── 編集 ──（以下は従来と同じ）                       │
│ ストラクチャ名・初期/リバイ/アドオン・締切Lv・levels │
└─────────────────────────────────────────────────────┘
```

### 権限マトリクス

| ユーザー | `/templates` 閲覧 | 作成 | 編集 | 削除 |
| -------- | ----------------- | ---- | ---- | ---- |
| 未ログイン | × | × | × | × |
| 匿名（ゲスト） | × | × | × | × |
| サインイン済（一般） | ○ | ○（`createdByUid == auth.uid` 必須） | ○（本人のみ） | ○（本人のみ） |
| **テンプレート管理者**（`templateAdmins/{uid}` 存在） | ○ | ○（本人名で） | ○（本人のみ） | **○（任意のテンプレ）** |

### Interaction Changes

| Touchpoint | Before (Phase 4.7) | After (Phase 4.8) | Notes |
| ---------- | ------------------ | ----------------- | ----- |
| `/templates` | 該当画面なし | 一覧カード＋「新規作成」＋削除ボタン | 匿名ユーザーはログイン誘導 |
| `/templates/new` / `/templates/{tid}/edit` | 該当画面なし | StructureForm 流用 + 説明欄 | 匿名不可、本人のみ編集 |
| `/structures/new` テンプレ選択 | なし（ゼロから編集のみ） | Firestore 取得のテンプレカード | 0 件なら「/templates/new で作成」案内 |
| 他人のテンプレに対する削除 | N/A | 管理者のみ削除ボタン表示・実行可能 | rule で二重防御 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ / repository / rule の 3 点同期パターン |
| P0 | [.claude/rules/security.md](../../rules/security.md) | all | 公開コレクション追加時の list 禁止方針、rule helper の作法 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | AppError / logger 規約 |
| P0 | [.claude/PRPs/plans/phase-4.7-onboarding-polish-structure-enhancements.plan.md](phase-4.7-onboarding-polish-structure-enhancements.plan.md) | all | 前提となる schema 拡張（levelSchema.isBreak / rebuyStack / addOnStack）を確認 |
| P0 | [firestore.rules](../../../firestore.rules) | 5-45, 128-150 | helper（isSignedIn / isOrganizer）と groupJoinCodes の get-only パターンを mirror |
| P0 | [src/lib/firebase/schemas/structure.ts](../../../src/lib/firebase/schemas/structure.ts) | all | Phase 4.7 で拡張済 の levelSchema を templates でも再利用 |
| P0 | [src/lib/firebase/repositories/structures.ts](../../../src/lib/firebase/repositories/structures.ts) | all | repositories の mirror 元（zodConverter + addDoc/getDoc/getDocs + AppError wrap） |
| P0 | [src/lib/firebase/repositories/groupJoinCodes.ts](../../../src/lib/firebase/repositories/groupJoinCodes.ts) | all | 小粒 collection の repo パターン（setDoc ベース） |
| P0 | [src/components/structure/StructureForm.tsx](../../../src/components/structure/StructureForm.tsx) | all | mode 追加 refactor の対象 |
| P1 | [src/app/structures/new/structure-new-client.tsx](../../../src/app/structures/new/structure-new-client.tsx) | all | TemplatePicker 差込の対象 |
| P1 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/[gid]/group-detail-client.tsx) | all | shadcn/ui Dialog 利用パターンの mirror 元 |
| P1 | [README.md](../../../README.md) | (Phase 4.6 section) | migration 手順追記の差込位置 |
| P2 | [.claude/PRPs/plans/completed/phase-4.6-member-role-split.plan.md](completed/phase-4.6-member-role-split.plan.md) | all | rule 拡張 + new collection + bootstrap の手順 mirror |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firestore rules `exists()` / `get()` | [firebase.google.com/docs/firestore/security/rules-conditions#access_documents](https://firebase.google.com/docs/firestore/security/rules-conditions#access_documents) | `exists()` は rule read 1 消費。`isTemplateAdmin()` は delete 時のみ呼ばれる |
| Firestore collection-level list rule | [firebase.google.com/docs/firestore/security/rules-query](https://firebase.google.com/docs/firestore/security/rules-query) | `allow list: if false` で enumeration 禁止（groupJoinCodes 先例）|
| Firestore atomic writes と getAfter | [firebase.google.com/docs/reference/rules/rules.firestore.Request](https://firebase.google.com/docs/reference/rules/rules.firestore.Request) | 本 Phase では使わない（single-doc 操作のみ）|

```
KEY_INSIGHT: 管理者の bootstrap は rule では付与不可（chicken-and-egg）
APPLIES_TO: Task 4 (rules) + Task 11 (README)
GOTCHA: `templateAdmins.create` rule が `isTemplateAdmin()` を require するため、最初の 1 人目は必ず Firestore Console 経由で手動作成する必要がある。README とリリース手順に明記

KEY_INSIGHT: users/{uid} は self-only read のため cross-user の displayName lookup ができない
APPLIES_TO: Task 1 (schema)
GOTCHA: template doc に `createdByDisplayName: string` を snapshot 保存する。作成者が後から rename しても古いテンプレは旧 name のまま（仕様として許容）

KEY_INSIGHT: StructureForm の groupId/createdByUid は structures 固有のためテンプレでは不要
APPLIES_TO: Task 7 (StructureForm mode refactor)
GOTCHA: `mode: "structure" | "template"` props で分岐する形に refactor。dummy groupId を渡す回避策よりクリーン

KEY_INSIGHT: listStructureTemplates は件数 100+ で getDocs が重くなる
APPLIES_TO: Task 2 (repository)
GOTCHA: 当面は全件 getDocs で運用（20〜数百件スケール想定）。将来 pagination/cursor 化可能な形に設計
```

---

## Patterns to Mirror

### NEW_COLLECTION_SCHEMA_PATTERN (Phase 4.7 の levelSchema を再利用)

```ts
// SOURCE: src/lib/firebase/schemas/structure.ts:13-26 (structureBody) を mirror
// Phase 4.8: structureTemplates は group 依存を持たないグローバル doc。
// Phase 4.7 の levelSchema (isBreak 対応済み) と rebuyStack/addOnStack を再利用する。
export const structureTemplateBodySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).default(""),
  initialStack: z.number().int().positive(),
  rebuyStack: z.number().int().positive().nullable().default(null),
  addOnStack: z.number().int().positive().nullable().default(null),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
  createdByUid: z.string().min(1),
  createdByDisplayName: z.string().min(1),  // 作成時の snapshot
  createdAt: z.instanceof(Timestamp),
});
```

### RULE_HELPER_PATTERN (admin 判定)

```js
// SOURCE: firestore.rules:12-16 (isGroupMember) を mirror
function isTemplateAdmin() {
  return isSignedIn()
         && exists(/databases/$(database)/documents/templateAdmins/$(request.auth.uid));
}

// match /structureTemplates/{tid}
//   allow read: if isSignedIn();
//   allow create: if isSignedIn()
//                 && request.resource.data.createdByUid == request.auth.uid
//                 && request.resource.data.createdByDisplayName is string
//                 && request.resource.data.createdByDisplayName.size() > 0;
//   allow update: if isSignedIn()
//                 && resource.data.createdByUid == request.auth.uid
//                 && request.resource.data.createdByUid == resource.data.createdByUid
//                 && request.resource.data.createdByDisplayName == resource.data.createdByDisplayName
//                 && request.resource.data.createdAt == resource.data.createdAt;
//   allow delete: if isSignedIn()
//                 && (resource.data.createdByUid == request.auth.uid || isTemplateAdmin());
```

### REPOSITORY_WRITE_PATTERN (既存 structures.ts を mirror)

```ts
// SOURCE: src/lib/firebase/repositories/structures.ts:29-42
const templatesRef = collection(firestore, "structureTemplates").withConverter(
  zodConverter(structureTemplateBodySchema, "structureTemplates"),
);

export async function createStructureTemplate(input: CreateStructureTemplateInput): Promise<string> {
  try {
    const ref = await addDoc(templatesRef, {
      ...input,
      description: input.description ?? "",
      rebuyStack: input.rebuyStack ?? null,
      addOnStack: input.addOnStack ?? null,
      createdAt: serverTimestamp(),
    });
    logger.info("structure template create ok", { tid: ref.id, uid: input.createdByUid });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "テンプレート作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
```

### HOOK_PATTERN (useIsTemplateAdmin)

```ts
// SOURCE: src/lib/hooks/useTournamentTimer.ts の user-scoped effect を mirror
export function useIsTemplateAdmin(): { isAdmin: boolean; loading: boolean } {
  const { user, loading: authLoading } = useAuthUser();
  const [state, setState] = useState<{ isAdmin: boolean; loading: boolean }>({
    isAdmin: false,
    loading: true,
  });

  useEffect(() => {
    if (authLoading) return;
    if (!user || user.isAnonymous) {
      setState({ isAdmin: false, loading: false });
      return;
    }
    let cancelled = false;
    (async () => {
      const ok = await isTemplateAdmin(user.uid);
      if (!cancelled) setState({ isAdmin: ok, loading: false });
    })();
    return () => { cancelled = true; };
  }, [user, authLoading]);

  return state;
}
```

### LIST_UI_PATTERN (既存 tournaments-client を mirror)

```tsx
// SOURCE: src/app/tournaments/tournaments-client.tsx:91-118 (card grid + buttons)
<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
  {items.map((t) => (
    <Card key={t.id}>
      <CardHeader>
        <CardTitle>{t.name}</CardTitle>
        <CardDescription>{t.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div>作成者: {t.createdByDisplayName}</div>
        <div className="flex gap-2">
          {canEdit ? <Button onClick={() => onEdit(t)}>編集</Button> : null}
          {canDelete ? <Button variant="destructive" onClick={() => onDelete(t)}>削除</Button> : null}
        </div>
      </CardContent>
    </Card>
  ))}
</div>
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/firebase/schemas/structureTemplate.ts` | CREATE | body schema（名前 / 説明 / チップ量 / レベル / 作成者情報 / createdAt）、createInput / updateInput |
| `src/lib/firebase/schemas/templateAdmin.ts` | CREATE | `templateAdmins/{uid}` の empty marker schema（createdAt のみ） |
| `src/lib/firebase/repositories/structureTemplates.ts` | CREATE | CRUD + list（createdAt desc client-side sort）|
| `src/lib/firebase/repositories/templateAdmins.ts` | CREATE | `isTemplateAdmin(uid)` / `grantTemplateAdmin(uid)` / `revokeTemplateAdmin(uid)` |
| `firestore.rules` | UPDATE | `match /structureTemplates/{tid}` と `match /templateAdmins/{uid}` を追加、`isTemplateAdmin()` helper |
| `src/lib/hooks/useIsTemplateAdmin.ts` | CREATE | `templateAdmins/{auth.uid}` の exist 判定 hook |
| `src/components/structure/StructureForm.tsx` | UPDATE | `mode?: "structure" \| "template"` / `description` 任意フィールド追加 |
| `src/components/structure/StructureTemplateCard.tsx` | CREATE | `/templates` と picker で共用するカード。作成者名・操作ボタン |
| `src/components/structure/StructureTemplatePicker.tsx` | CREATE | `/structures/new` 用。`listStructureTemplates()` を呼び、選択で親に通知 |
| `src/app/templates/page.tsx` | CREATE | Server Component entry |
| `src/app/templates/templates-client.tsx` | CREATE | 一覧 + 新規作成ボタン + 削除ハンドラ + useIsTemplateAdmin 連携 |
| `src/app/templates/new/page.tsx` | CREATE | Server Component entry |
| `src/app/templates/new/template-new-client.tsx` | CREATE | StructureForm 流用で作成 |
| `src/app/templates/[tid]/edit/page.tsx` | CREATE | Server Component entry |
| `src/app/templates/[tid]/edit/template-edit-client.tsx` | CREATE | 本人以外は redirect、StructureForm 流用で編集 |
| `src/app/structures/new/structure-new-client.tsx` | UPDATE | `StructureTemplatePicker` を差込、`StructureForm` の initialValue を controlled に |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | `structureTemplateBodySchema` / `templateAdminBodySchema` のテスト |
| `src/lib/firebase/repositories/structureTemplates.test.ts` | CREATE | mock firestore ベースの CRUD テスト |
| `src/lib/firebase/repositories/templateAdmins.test.ts` | CREATE | isTemplateAdmin の true/false path |
| `src/components/structure/StructureTemplateCard.test.tsx` | CREATE | variant / canEdit / canDelete の表示制御 |
| `README.md` | UPDATE | 「テンプレート管理者の bootstrap」手順を追記 |
| `.claude/rules/security.md` | UPDATE | `templateAdmins` の list 禁止・bootstrap 運用を追記 |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Phase 4.8 行を追加、Phase 5 の Depends に 4.8 を追加 |

## NOT Building

- **テンプレ作成時に既存 structure からコピーするフロー**: `/structures/[sid]` 画面に「このストラクチャをテンプレとして公開」ボタンを出す案は本 Phase では対象外。ユーザーは `/templates/new` で手入力するか、既存 structure の内容を目視で転記する。Phase 5 以降の UX 改善として検討
- **テンプレの favorite / ピン留め**: 件数少ない前提のため不要
- **テンプレのタグ / カテゴリ / 検索**: カード一覧 + createdAt desc ソートのみ。数が 100+ になったら Phase 5+ で追加
- **管理者 UI からの付与／剥奪**: 初期管理者は Firestore Console で手動 seed。管理者同士の grant/revoke は rule 的には可能だが、UI は本 Phase では提供しない（repository 層のみ用意して将来に備える）
- **テンプレ作成者名の追従更新**: `createdByDisplayName` は doc への snapshot。作成者が rename しても古いテンプレの表示名は更新しない
- **匿名ユーザーからのテンプレ作成**: `/templates/new` は匿名ユーザーを拒否。`createdByDisplayName` の信頼性担保のため
- **テンプレ削除時のカスケード処理**: structures はテンプレを snapshot してコピー済み（テンプレ参照ではない）のため、テンプレ削除で structure には影響しない。明示的な連携は不要
- **テンプレ用の独立 levelSchema**: Phase 4.7 の `levelSchema`（isBreak 対応済）を共用。schema drift 防止

---

## Step-by-Step Tasks

### Task 1: structureTemplate / templateAdmin zod schema 作成

- **ACTION**: `src/lib/firebase/schemas/structureTemplate.ts` と `src/lib/firebase/schemas/templateAdmin.ts` を新規作成
- **IMPLEMENT**:
  ```ts
  // structureTemplate.ts
  import { Timestamp } from "firebase/firestore";
  import { z } from "zod";
  import { levelSchema } from "./structure";

  export const structureTemplateBodySchema = z.object({
    name: z.string().min(1).max(60),
    description: z.string().max(200).default(""),
    initialStack: z.number().int().positive(),
    rebuyStack: z.number().int().positive().nullable().default(null),
    addOnStack: z.number().int().positive().nullable().default(null),
    lateEntryDeadlineLevel: z.number().int().positive(),
    levels: z.array(levelSchema).min(1),
    createdByUid: z.string().min(1),
    createdByDisplayName: z.string().min(1),
    createdAt: z.instanceof(Timestamp),
  });
  export type StructureTemplateBody = z.infer<typeof structureTemplateBodySchema>;
  export type StructureTemplateDoc = StructureTemplateBody & { id: string };

  export const createStructureTemplateInputSchema = z.object({
    name: z.string().min(1, "名前を入力してください").max(60),
    description: z.string().max(200).default(""),
    initialStack: z.number().int().positive(),
    rebuyStack: z.number().int().positive().nullable().optional(),
    addOnStack: z.number().int().positive().nullable().optional(),
    lateEntryDeadlineLevel: z.number().int().positive(),
    levels: z.array(levelSchema).min(1),
    createdByUid: z.string().min(1),
    createdByDisplayName: z.string().min(1),
  });
  export type CreateStructureTemplateInput = z.infer<typeof createStructureTemplateInputSchema>;

  export const updateStructureTemplateInputSchema =
    createStructureTemplateInputSchema.omit({ createdByUid: true, createdByDisplayName: true }).partial();
  export type UpdateStructureTemplateInput = z.infer<typeof updateStructureTemplateInputSchema>;

  // templateAdmin.ts
  import { Timestamp } from "firebase/firestore";
  import { z } from "zod";

  export const templateAdminBodySchema = z.object({
    createdAt: z.instanceof(Timestamp),
  });
  export type TemplateAdminBody = z.infer<typeof templateAdminBodySchema>;
  ```
- **MIRROR**: [schemas/structure.ts](src/lib/firebase/schemas/structure.ts) / [schemas/groupJoinCode.ts](src/lib/firebase/schemas/groupJoinCode.ts)
- **IMPORTS**: `z`, `Timestamp`, `levelSchema`（structure.ts から）
- **GOTCHA**:
  - `levelSchema` は Phase 4.7 で拡張済みの `isBreak` を含む
  - `description` は default("")、UI は optional だが保存時は空文字列で必ず書込
  - `createdByDisplayName` は min(1) 必須
- **VALIDATE**:
  - `structureTemplateBodySchema.parse({ ..., description: undefined })` が成功し `description === ""`
  - `parse({ ..., createdByDisplayName: "" })` が失敗

### Task 2: structureTemplates repository 新設

- **ACTION**: `src/lib/firebase/repositories/structureTemplates.ts` を新規作成
- **IMPLEMENT**:
  ```ts
  import { addDoc, collection, deleteDoc, doc, getDoc, getDocs,
           serverTimestamp, updateDoc } from "firebase/firestore";
  import { AppError } from "@/lib/errors";
  import { firestore } from "@/lib/firebase/client";
  import { zodConverter } from "@/lib/firebase/converters";
  import {
    structureTemplateBodySchema,
    type CreateStructureTemplateInput,
    type StructureTemplateDoc,
    type UpdateStructureTemplateInput,
  } from "@/lib/firebase/schemas/structureTemplate";
  import { logger } from "@/lib/logger";

  const templatesRef = collection(firestore, "structureTemplates").withConverter(
    zodConverter(structureTemplateBodySchema, "structureTemplates"),
  );

  export async function createStructureTemplate(input: CreateStructureTemplateInput): Promise<string> {
    try {
      const ref = await addDoc(templatesRef, {
        ...input,
        description: input.description ?? "",
        rebuyStack: input.rebuyStack ?? null,
        addOnStack: input.addOnStack ?? null,
        createdAt: serverTimestamp(),
      });
      logger.info("structure template create ok", { tid: ref.id, uid: input.createdByUid });
      return ref.id;
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "テンプレート作成に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      throw wrapped;
    }
  }

  export async function getStructureTemplate(tid: string): Promise<StructureTemplateDoc> {
    try {
      const snap = await getDoc(doc(templatesRef, tid));
      if (!snap.exists()) {
        throw new AppError(`template not found: ${tid}`, "firestore/not-found");
      }
      return { id: snap.id, ...snap.data() };
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "テンプレート取得に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
  }

  export async function listStructureTemplates(): Promise<StructureTemplateDoc[]> {
    try {
      const snap = await getDocs(templatesRef);
      const items: StructureTemplateDoc[] = [];
      for (const d of snap.docs) {
        try { items.push({ id: d.id, ...d.data() }); }
        catch (e) {
          logger.warn("template list skipped invalid doc", { tid: d.id, code: "firestore/invalid-data" });
        }
      }
      items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      return items;
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "テンプレート一覧取得に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      throw wrapped;
    }
  }

  export async function updateStructureTemplate(tid: string, patch: UpdateStructureTemplateInput): Promise<void> {
    try {
      await updateDoc(doc(templatesRef, tid), patch);
      logger.info("structure template update ok", { tid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "テンプレート更新に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
  }

  export async function deleteStructureTemplate(tid: string): Promise<void> {
    try {
      await deleteDoc(doc(templatesRef, tid));
      logger.info("structure template delete ok", { tid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "テンプレート削除に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: [src/lib/firebase/repositories/structures.ts](src/lib/firebase/repositories/structures.ts)
- **IMPORTS**: zodConverter, schemas, logger, AppError
- **GOTCHA**:
  - listStructureTemplates は where 句なしで全件取得（数百件規模でもスケール問題なし）
  - 個別 doc の validate 失敗は warn ログ + skip（一覧全体を落とさない）
- **VALIDATE**: createStructureTemplate 後 Firestore console で doc 構造確認、listStructureTemplates が createdAt desc でソート

### Task 3: templateAdmins repository 新設

- **ACTION**: `src/lib/firebase/repositories/templateAdmins.ts` を新規作成
- **IMPLEMENT**:
  ```ts
  import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
  import { AppError } from "@/lib/errors";
  import { firestore } from "@/lib/firebase/client";
  import { zodConverter } from "@/lib/firebase/converters";
  import { templateAdminBodySchema } from "@/lib/firebase/schemas/templateAdmin";
  import { logger } from "@/lib/logger";

  const templateAdminsRef = collection(firestore, "templateAdmins").withConverter(
    zodConverter(templateAdminBodySchema, "templateAdmins"),
  );

  /** 現在ログイン中のユーザーが管理者かどうかを返す。rule が self-only read なので自分の uid で呼ぶこと。 */
  export async function isTemplateAdmin(uid: string): Promise<boolean> {
    try {
      const snap = await getDoc(doc(templateAdminsRef, uid));
      return snap.exists();
    } catch (e) {
      // permission-denied でも false を返す（非管理者扱い）
      logger.warn("isTemplateAdmin check failed", { code: "firestore/read_failed", uid });
      return false;
    }
  }

  /** 管理者を付与する（既存管理者からの呼出し前提、rule で enforce）。本 Phase では UI 未実装、将来用 */
  export async function grantTemplateAdmin(uid: string): Promise<void> {
    try {
      await setDoc(doc(templateAdminsRef, uid), { createdAt: serverTimestamp() });
      logger.info("template admin grant ok", { uid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "管理者付与に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid });
      throw wrapped;
    }
  }

  /** 管理者を剥奪する（既存管理者からの呼出し前提）。本 Phase では UI 未実装、将来用 */
  export async function revokeTemplateAdmin(uid: string): Promise<void> {
    try {
      await deleteDoc(doc(templateAdminsRef, uid));
      logger.info("template admin revoke ok", { uid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "管理者剥奪に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: [src/lib/firebase/repositories/groupJoinCodes.ts](src/lib/firebase/repositories/groupJoinCodes.ts) の setDoc パターン
- **IMPORTS**: 上記
- **GOTCHA**:
  - `isTemplateAdmin` は read 失敗時に false を返す（rule が self-only のため他人の uid で呼ぶと permission-denied）
  - `grantTemplateAdmin` / `revokeTemplateAdmin` は本 Phase では UI から呼び出さない（README で Console 手順を明記）
- **VALIDATE**: 管理者 seed 後 `isTemplateAdmin(adminUid)` が true、非管理者では false

### Task 4: Firestore Security Rules に新規 match ブロック追加

- **ACTION**: `firestore.rules` に `isTemplateAdmin()` helper、`match /structureTemplates/{tid}`、`match /templateAdmins/{uid}` を追加
- **IMPLEMENT**:
  ```js
  // helper（既存の isGroupMember 等の横に配置）
  function isTemplateAdmin() {
    return isSignedIn()
           && exists(/databases/$(database)/documents/templateAdmins/$(request.auth.uid));
  }

  match /structureTemplates/{tid} {
    allow read: if isSignedIn();
    allow create: if isSignedIn()
                  && request.resource.data.createdByUid == request.auth.uid
                  && request.resource.data.createdByDisplayName is string
                  && request.resource.data.createdByDisplayName.size() > 0;
    // 編集は本人のみ。createdByUid / createdAt / createdByDisplayName は immutable
    allow update: if isSignedIn()
                  && resource.data.createdByUid == request.auth.uid
                  && request.resource.data.createdByUid == resource.data.createdByUid
                  && request.resource.data.createdByDisplayName == resource.data.createdByDisplayName
                  && request.resource.data.createdAt == resource.data.createdAt;
    // 削除は本人または管理者
    allow delete: if isSignedIn()
                  && (resource.data.createdByUid == request.auth.uid || isTemplateAdmin());
  }

  // templateAdmins: 管理者のみが他のユーザーを admin に grant／revoke できる。
  // list 禁止（管理者一覧の列挙防止）。read は self のみ（自分が管理者かどうかの確認）。
  match /templateAdmins/{uid} {
    allow get: if isSignedIn() && request.auth.uid == uid;
    allow list: if false;
    allow create, delete: if isTemplateAdmin();
    allow update: if false;  // 空 doc なので更新不要
  }
  ```
- **MIRROR**: [firestore.rules:128-150 (groupJoinCodes)](firestore.rules#L128-L150)
- **IMPORTS**: N/A
- **GOTCHA**:
  - `isTemplateAdmin()` は rule 評価 1 回につき 1 read 消費。delete 時のみ呼ばれるので頻度は低い
  - `list: if false` で管理者 enumeration 不可（security.md の招待コード原則と同じ方針）
  - **bootstrap**: 最初の 1 人目の管理者は rule では付与不可（chicken-and-egg）。Firestore Console で手動作成する必要あり
- **VALIDATE**:
  - 非管理者が他人のテンプレを delete → permission-denied
  - 管理者が他人のテンプレを delete → 成功
  - 本人は自分のテンプレを update/delete できる
  - `createdByUid` を書換ようとする update → permission-denied
  - 非管理者が `templateAdmins` を list → permission-denied

### Task 5: useIsTemplateAdmin hook 新設

- **ACTION**: `src/lib/hooks/useIsTemplateAdmin.ts` を新規作成
- **IMPLEMENT**:
  ```ts
  "use client";
  import { useEffect, useState } from "react";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { isTemplateAdmin } from "@/lib/firebase/repositories/templateAdmins";

  /**
   * 現在ログイン中のユーザーがテンプレート管理者かどうかを返す hook。
   * 初期値は `{ isAdmin: false, loading: true }`。
   * 未ログイン / 匿名ユーザーは常に `{ isAdmin: false, loading: false }`。
   */
  export function useIsTemplateAdmin(): { isAdmin: boolean; loading: boolean } {
    const { user, loading: authLoading } = useAuthUser();
    const [state, setState] = useState<{ isAdmin: boolean; loading: boolean }>({
      isAdmin: false,
      loading: true,
    });

    useEffect(() => {
      if (authLoading) return;
      if (!user || user.isAnonymous) {
        setState({ isAdmin: false, loading: false });
        return;
      }
      let cancelled = false;
      (async () => {
        const ok = await isTemplateAdmin(user.uid);
        if (!cancelled) setState({ isAdmin: ok, loading: false });
      })();
      return () => { cancelled = true; };
    }, [user, authLoading]);

    return state;
  }
  ```
- **MIRROR**: [src/lib/hooks/useTournamentTimer.ts](src/lib/hooks/useTournamentTimer.ts) の user-scoped effect
- **IMPORTS**: `useAuthUser`, `isTemplateAdmin`
- **GOTCHA**: user 切替（ログイン → ログアウト → 別ユーザー）で state が古いまま残らないよう cancelled フラグ
- **VALIDATE**: 管理者 uid でログイン → `isAdmin: true`。非管理者で false。ログアウト → false

### Task 6: StructureTemplateCard / StructureTemplatePicker コンポーネント新設

- **ACTION**: 以下 2 つを新規作成
  - `src/components/structure/StructureTemplateCard.tsx`（`/templates` 一覧と picker 共用）
  - `src/components/structure/StructureTemplatePicker.tsx`（`/structures/new` 専用）
- **IMPLEMENT**:
  ```tsx
  // StructureTemplateCard.tsx
  import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

  interface Props {
    template: StructureTemplateDoc;
    variant: "picker" | "library";
    canEdit?: boolean;
    canDelete?: boolean;
    onApply?: (t: StructureTemplateDoc) => void;
    onEdit?: (t: StructureTemplateDoc) => void;
    onDelete?: (t: StructureTemplateDoc) => void;
  }

  export function StructureTemplateCard({ template: t, variant, canEdit, canDelete, onApply, onEdit, onDelete }: Props) {
    return (
      <Card className="flex flex-col">
        <CardHeader>
          <CardTitle className="text-base">{t.name}</CardTitle>
          {t.description ? <CardDescription>{t.description}</CardDescription> : null}
        </CardHeader>
        <CardContent className="mt-auto space-y-2 text-xs text-muted-foreground">
          <div>初期 {t.initialStack.toLocaleString()} / {t.levels.length} レベル</div>
          <div>作成者: {t.createdByDisplayName}</div>
          <div className="flex flex-wrap gap-2 pt-2">
            {variant === "picker" && onApply ? (
              <Button size="sm" variant="outline" onClick={() => onApply(t)}>このテンプレを使う</Button>
            ) : null}
            {variant === "library" && canEdit && onEdit ? (
              <Button size="sm" variant="outline" onClick={() => onEdit(t)}>編集</Button>
            ) : null}
            {variant === "library" && canDelete && onDelete ? (
              <Button size="sm" variant="destructive" onClick={() => onDelete(t)}>削除</Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  // StructureTemplatePicker.tsx
  "use client";
  import Link from "next/link";
  import { useEffect, useState } from "react";
  import { AppError } from "@/lib/errors";
  import { listStructureTemplates } from "@/lib/firebase/repositories/structureTemplates";
  import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
  import { logger } from "@/lib/logger";
  import { StructureTemplateCard } from "./StructureTemplateCard";

  interface Props {
    onSelect: (template: StructureTemplateDoc) => void;
  }

  export function StructureTemplatePicker({ onSelect }: Props) {
    const [items, setItems] = useState<StructureTemplateDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      let cancelled = false;
      (async () => {
        try {
          const list = await listStructureTemplates();
          if (!cancelled) setItems(list);
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/read_failed", "テンプレート取得失敗");
          logger.warn(wrapped.message, { code: wrapped.code });
          if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, []);

    if (loading) return <p className="text-sm text-muted-foreground">テンプレート読込中…</p>;
    if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
    if (items.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          テンプレートがありません。<Link href="/templates/new" className="underline">/templates/new</Link> で作成できます。
        </p>
      );
    }
    return (
      <section aria-label="テンプレート選択" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">テンプレートから読み込む（任意）</h2>
        <div className="grid gap-3 md:grid-cols-3">
          {items.map((t) => (
            <StructureTemplateCard key={t.id} template={t} variant="picker" onApply={onSelect} />
          ))}
        </div>
      </section>
    );
  }
  ```
- **MIRROR**: [src/app/tournaments/tournaments-client.tsx:91-118](src/app/tournaments/tournaments-client.tsx#L91-L118)、[src/components/tournament/TournamentForm.tsx:66-89](src/components/tournament/TournamentForm.tsx#L66-L89)
- **IMPORTS**: shadcn/ui Card, Button, Link, listStructureTemplates
- **GOTCHA**:
  - picker はサインイン必須（未ログイン時は `/structures/new` 自体 guard で弾かれる）
  - library variant の ban 条件は親で決定
- **VALIDATE**: picker で 0 件表示・複数件表示、library で本人 / 他人 / 管理者のケース別表示

### Task 7: StructureForm の mode prop 追加（軽微 refactor）

- **ACTION**: `src/components/structure/StructureForm.tsx` を更新し、structures と templates の両方から使えるようにする
- **IMPLEMENT**:
  ```tsx
  interface Props {
    initialValue?: StructureFormInitialValue;
    submitLabel?: string;
    mode?: "structure" | "template";    // 新規、default "structure"
    groupId?: string;                   // structure mode でのみ必須
    createdByUid?: string;               // structure mode でのみ必須
    onSubmit: (input: {
      name: string;
      description: string;              // template mode でのみ使う（structure では無視）
      initialStack: number;
      rebuyStack: number | null;
      addOnStack: number | null;
      lateEntryDeadlineLevel: number;
      levels: Level[];
      groupId?: string;
      createdByUid?: string;
    }) => Promise<void>;
    onCancel?: () => void;
  }

  // mode === "template" のときは UI に description 入力欄を出す
  {mode === "template" ? (
    <div className="space-y-2">
      <Label htmlFor="t-desc">説明（任意）</Label>
      <Input id="t-desc" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={200} />
    </div>
  ) : null}

  // submit 時は mode に応じて validate 呼出を分岐
  if (mode === "structure") {
    const parsed = createStructureInputSchema.safeParse({
      ...commonFields, groupId, createdByUid,
    });
    if (!parsed.success) { setError(...); return; }
    await onSubmit({ ...parsed.data });
  } else {
    // template mode: validate は呼出側（template-new-client）で createStructureTemplateInputSchema を使う
    await onSubmit({ ...commonFields, description });
  }
  ```
- **MIRROR**: 既存 [src/components/structure/StructureForm.tsx:46-95](src/components/structure/StructureForm.tsx#L46-L95)
- **IMPORTS**: 既存のまま
- **GOTCHA**:
  - description 入力欄は template mode でのみ表示
  - structure mode の既存呼出は `mode="structure"` を明示追加（optional だが明確化）
  - initialValue に description フィールドを追加（default ""）
- **VALIDATE**: structures / templates の両 flow で保存が通る

### Task 8: `/templates` 一覧ページ作成

- **ACTION**: `src/app/templates/page.tsx` と `src/app/templates/templates-client.tsx` を新規作成
- **IMPLEMENT**:
  ```tsx
  // templates/page.tsx
  import { TemplatesClient } from "./templates-client";
  export default function Page() { return <TemplatesClient />; }

  // templates-client.tsx
  "use client";
  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { useEffect, useState } from "react";
  import { StructureTemplateCard } from "@/components/structure/StructureTemplateCard";
  import { Button } from "@/components/ui/button";
  import { AppError } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import {
    deleteStructureTemplate,
    listStructureTemplates,
  } from "@/lib/firebase/repositories/structureTemplates";
  import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
  import { useIsTemplateAdmin } from "@/lib/hooks/useIsTemplateAdmin";
  import { logger } from "@/lib/logger";

  export function TemplatesClient() {
    const { user, loading: authLoading } = useAuthUser();
    const { isAdmin } = useIsTemplateAdmin();
    const router = useRouter();
    const [items, setItems] = useState<StructureTemplateDoc[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
      if (authLoading || !user) return;
      let cancelled = false;
      (async () => {
        try {
          const list = await listStructureTemplates();
          if (!cancelled) setItems(list);
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/read_failed", "一覧取得失敗");
          if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => { cancelled = true; };
    }, [user, authLoading]);

    if (authLoading) return <main className="p-8 text-sm text-muted-foreground">読込中…</main>;
    if (!user) return <main className="p-8"><Link href="/login"><Button>ログイン</Button></Link></main>;

    async function onDelete(t: StructureTemplateDoc) {
      if (!confirm(`「${t.name}」を削除しますか？`)) return;
      try {
        await deleteStructureTemplate(t.id);
        setItems((prev) => prev.filter((x) => x.id !== t.id));
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/write_failed", "削除失敗");
        logger.warn(wrapped.message, { code: wrapped.code, tid: t.id });
        setError(`${wrapped.code}: ${wrapped.message}`);
      }
    }

    return (
      <main className="mx-auto max-w-4xl space-y-6 p-8">
        <header className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">テンプレート図書館</h1>
            <p className="text-sm text-muted-foreground">サークル横断で共有されるストラクチャのひな形。</p>
          </div>
          <Link href="/templates/new"><Button>新規作成</Button></Link>
        </header>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        {loading ? <p className="text-sm text-muted-foreground">読込中…</p>
          : items.length === 0 ? <p className="text-sm text-muted-foreground">まだテンプレートがありません。</p>
          : (
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {items.map((t) => {
                const isOwner = t.createdByUid === user.uid;
                return (
                  <StructureTemplateCard
                    key={t.id}
                    template={t}
                    variant="library"
                    canEdit={isOwner}
                    canDelete={isOwner || isAdmin}
                    onEdit={(x) => router.push(`/templates/${x.id}/edit`)}
                    onDelete={onDelete}
                  />
                );
              })}
            </div>
          )}
      </main>
    );
  }
  ```
- **MIRROR**: [src/app/structures/structures-client.tsx](src/app/structures/structures-client.tsx)、[src/app/tournaments/tournaments-client.tsx](src/app/tournaments/tournaments-client.tsx)
- **IMPORTS**: 上記
- **GOTCHA**:
  - `confirm()` は shadcn/ui Dialog に置き換えた方が UX 良いが、スコープ圧縮のため一旦 `window.confirm`（structures 側と合わせる）
  - 削除後の state 更新は optimistic、rule 違反時は error 表示
- **VALIDATE**:
  - 本人テンプレに「編集」「削除」、他人（非管理者）は何もなし、管理者なら「削除」
  - 未ログイン時はログインボタンに誘導

### Task 9: `/templates/new` と `/templates/{tid}/edit` ページ作成

- **ACTION**: 4 ファイル新規作成
  - `src/app/templates/new/page.tsx` / `template-new-client.tsx`
  - `src/app/templates/[tid]/edit/page.tsx` / `template-edit-client.tsx`
- **IMPLEMENT**:
  ```tsx
  // template-new-client.tsx
  "use client";
  import { useRouter } from "next/navigation";
  import { useState } from "react";
  import { StructureForm } from "@/components/structure/StructureForm";
  import { AppError } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { createStructureTemplate } from "@/lib/firebase/repositories/structureTemplates";
  import { logger } from "@/lib/logger";

  export function TemplateNewClient() {
    const { user, loading } = useAuthUser();
    const router = useRouter();
    const [error, setError] = useState<string | null>(null);

    if (loading) return <main className="p-8 text-sm text-muted-foreground">読込中…</main>;
    if (!user || user.isAnonymous) {
      // 匿名ユーザーは createdByDisplayName の信頼性担保のため拒否
      return <main className="p-8 text-sm text-muted-foreground">テンプレ作成には通常アカウントでログインしてください。</main>;
    }
    const displayName = user.displayName?.trim() || user.email || user.uid;

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <h1 className="text-2xl font-bold">テンプレートを作成</h1>
        {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
        <StructureForm
          mode="template"
          onSubmit={async (input) => {
            try {
              await createStructureTemplate({
                name: input.name,
                description: input.description ?? "",
                initialStack: input.initialStack,
                rebuyStack: input.rebuyStack ?? null,
                addOnStack: input.addOnStack ?? null,
                lateEntryDeadlineLevel: input.lateEntryDeadlineLevel,
                levels: input.levels,
                createdByUid: user.uid,
                createdByDisplayName: displayName,
              });
              router.push("/templates");
            } catch (e) {
              const wrapped = AppError.from(e, "firestore/write_failed", "作成失敗");
              logger.warn(wrapped.message, { code: wrapped.code });
              setError(`${wrapped.code}: ${wrapped.message}`);
              throw e;
            }
          }}
          onCancel={() => router.push("/templates")}
          submitLabel="作成"
        />
      </main>
    );
  }

  // template-edit-client.tsx (概略)
  export function TemplateEditClient({ tid }: { tid: string }) {
    const { user } = useAuthUser();
    const router = useRouter();
    const [doc, setDoc] = useState<StructureTemplateDoc | null>(null);
    const [notFound, setNotFound] = useState(false);

    useEffect(() => {
      if (!user) return;
      let cancelled = false;
      (async () => {
        try {
          const d = await getStructureTemplate(tid);
          if (cancelled) return;
          if (d.createdByUid !== user.uid) {
            router.replace("/templates");
            return;
          }
          setDoc(d);
        } catch (e) {
          if (!cancelled) setNotFound(true);
        }
      })();
      return () => { cancelled = true; };
    }, [user, tid, router]);

    if (notFound) return <main className="p-8">テンプレートが見つかりません</main>;
    if (!doc || !user) return <main className="p-8 text-sm text-muted-foreground">読込中…</main>;

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <h1 className="text-2xl font-bold">テンプレートを編集</h1>
        <StructureForm
          mode="template"
          initialValue={{
            name: doc.name,
            description: doc.description,
            initialStack: doc.initialStack,
            rebuyStack: doc.rebuyStack,
            addOnStack: doc.addOnStack,
            lateEntryDeadlineLevel: doc.lateEntryDeadlineLevel,
            levels: doc.levels,
          }}
          onSubmit={async (input) => {
            await updateStructureTemplate(tid, {
              name: input.name,
              description: input.description ?? "",
              initialStack: input.initialStack,
              rebuyStack: input.rebuyStack ?? null,
              addOnStack: input.addOnStack ?? null,
              lateEntryDeadlineLevel: input.lateEntryDeadlineLevel,
              levels: input.levels,
            });
            router.push("/templates");
          }}
          onCancel={() => router.push("/templates")}
          submitLabel="保存"
        />
      </main>
    );
  }
  ```
- **MIRROR**: [src/app/structures/new/structure-new-client.tsx](src/app/structures/new/structure-new-client.tsx)、[src/app/structures/[sid]/edit/structure-edit-client.tsx](src/app/structures/[sid]/edit/structure-edit-client.tsx)
- **IMPORTS**: 各 repository / schemas / StructureForm
- **GOTCHA**:
  - 匿名ユーザー (`user.isAnonymous`) は `/templates/new` に到達しても作成できない。早期 return
  - edit は他人の doc にアクセスしたら redirect（rule でも弾かれるが UX 的に即戻す）
  - displayName は auth profile から取る（email fallback）
- **VALIDATE**:
  - 本人が /templates/new で作成 → /templates にリスト表示
  - 他人の edit URL 直打ち → /templates に redirect
  - 匿名ユーザーで /templates/new 到達 → 「通常アカウントでログインしてください」

### Task 10: `/structures/new` に TemplatePicker を差込

- **ACTION**: `src/app/structures/new/structure-new-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  "use client";
  import { useState } from "react";
  import { StructureForm } from "@/components/structure/StructureForm";
  import { StructureTemplatePicker } from "@/components/structure/StructureTemplatePicker";
  import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
  // ...

  export function StructureNewClient() {
    const { user } = useAuthUser();
    const { currentGroupId, isOrganizer, loading } = useCurrentGroup();
    const router = useRouter();
    const [initialValue, setInitialValue] = useState<StructureFormInitialValue | undefined>(undefined);
    const [resetKey, setResetKey] = useState(0);

    // ロール gate（既存のまま）

    function applyTemplate(t: StructureTemplateDoc) {
      setInitialValue({
        name: t.name,
        initialStack: t.initialStack,
        rebuyStack: t.rebuyStack,
        addOnStack: t.addOnStack,
        lateEntryDeadlineLevel: t.lateEntryDeadlineLevel,
        levels: t.levels.map((l) => ({ ...l })),
      });
      setResetKey((k) => k + 1);
    }

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <h1 className="text-2xl font-bold">ストラクチャを新規作成</h1>
        <StructureTemplatePicker onSelect={applyTemplate} />
        <StructureForm
          key={resetKey}
          mode="structure"
          initialValue={initialValue}
          groupId={currentGroupId}
          createdByUid={user.uid}
          onSubmit={async (input) => {
            await createStructure({
              ...input,
              groupId: currentGroupId,
              createdByUid: user.uid,
            });
            router.push("/structures");
          }}
          onCancel={() => router.push("/structures")}
          submitLabel="作成"
        />
      </main>
    );
  }
  ```
- **MIRROR**: 既存 [structure-new-client.tsx](src/app/structures/new/structure-new-client.tsx)
- **IMPORTS**: `useState`, `StructureTemplatePicker`, `StructureTemplateDoc`
- **GOTCHA**:
  - `key={resetKey}` で StructureForm を unmount/remount することで内部の useState を再初期化できる
  - picker がテンプレ 0 件なら picker 側で empty メッセージ表示（親は変更なし）
- **VALIDATE**:
  - Firestore に 2〜3 件テンプレを seed した状態で picker から選択 → フォームが書換
  - テンプレ 0 件なら「テンプレートがありません。/templates/new で作成できます」表示

### Task 11: README / security.md に管理者 bootstrap 手順追記

- **ACTION**: 以下を追記
  - `README.md` に「Phase 4.8: テンプレート管理者の bootstrap」section
  - `.claude/rules/security.md` に templateAdmins の運用ルール
- **IMPLEMENT**:
  ```markdown
  ## Phase 4.8: テンプレート管理者の bootstrap

  Phase 4.8 デプロイ後、**最初の管理者は Firestore Console で手動作成**が必要です。Firestore Security Rules は管理者の create を「既存の管理者による操作」に限定しているため、初回だけは Console からの手動 seed が必須です。

  1. Firebase Console で対象プロジェクトの Firestore を開く
  2. `templateAdmins` コレクションを作成
  3. ドキュメント ID: 最初の管理者の `uid`（Auth タブで確認）
  4. フィールド: `createdAt` (timestamp, 現在時刻)
  5. 保存

  この 1 回の操作を行わないと、作成者不明のテンプレートを誰も削除できない状態で運用が始まります（作成者脱会後のクリーンアップ手段がなくなる）。
  ```
  security.md には templateAdmins の list 禁止 + bootstrap 制約を追記
- **MIRROR**: README の Phase 4.6 migration section
- **IMPORTS**: N/A
- **GOTCHA**:
  - 「最後の管理者が 0 人」にしないよう運用で注意（Console で再 seed するしか復旧できない）
  - セキュリティとしては「rule の bootstrap 穴を塞ぐ」設計になっているので正しい
- **VALIDATE**: README に手順があり、rule doc を読めば `templateAdmins` の list 禁止が分かる

### Task 12: Tests — schemas / repositories / card

- **ACTION**: 以下の test ファイルを更新・新設
  - `src/lib/firebase/schemas/index.test.ts` UPDATE（新規 schema の parse ケース）
  - `src/lib/firebase/repositories/structureTemplates.test.ts` CREATE
  - `src/lib/firebase/repositories/templateAdmins.test.ts` CREATE
  - `src/components/structure/StructureTemplateCard.test.tsx` CREATE
- **IMPLEMENT**:
  ```ts
  // structureTemplates.test.ts
  it("createStructureTemplate: normalizes undefined rebuyStack to null", async () => {
    const addDoc = vi.fn().mockResolvedValue({ id: "new-tid" });
    // ... mock setup ...
    await createStructureTemplate({ ...minimal, rebuyStack: undefined });
    expect(addDoc).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      rebuyStack: null,
    }));
  });

  it("listStructureTemplates: skips doc that fails schema validation", async () => {
    // Mock getDocs to return 2 valid docs + 1 invalid, expect result length === 2
  });

  // templateAdmins.test.ts
  it("isTemplateAdmin: returns true when doc exists", async () => {
    // Mock getDoc.exists() === true
    await expect(isTemplateAdmin("admin-uid")).resolves.toBe(true);
  });

  it("isTemplateAdmin: returns false on permission-denied", async () => {
    // Mock getDoc to throw FirebaseError("permission-denied")
    await expect(isTemplateAdmin("other-uid")).resolves.toBe(false);
  });

  // StructureTemplateCard.test.tsx
  it("library variant: shows edit + delete for owner", () => {
    render(<StructureTemplateCard template={t} variant="library" canEdit canDelete onEdit={fn} onDelete={fn} />);
    expect(screen.getByText("編集")).toBeInTheDocument();
    expect(screen.getByText("削除")).toBeInTheDocument();
  });

  it("library variant: shows only delete for admin (non-owner)", () => {
    render(<StructureTemplateCard template={t} variant="library" canEdit={false} canDelete onDelete={fn} />);
    expect(screen.queryByText("編集")).not.toBeInTheDocument();
    expect(screen.getByText("削除")).toBeInTheDocument();
  });

  it("picker variant: shows 'このテンプレを使う'", () => {
    render(<StructureTemplateCard template={t} variant="picker" onApply={fn} />);
    expect(screen.getByText("このテンプレを使う")).toBeInTheDocument();
  });
  ```
- **MIRROR**: [src/lib/firebase/repositories/groups.test.ts](src/lib/firebase/repositories/groups.test.ts)
- **IMPORTS**: vitest, @testing-library/react, mock firestore
- **GOTCHA**:
  - Timestamp / serverTimestamp は mock する（既存テストと同様）
  - `vi.mock("@/lib/firebase/client", ...)` で firestore を空 object に mock
- **VALIDATE**: `npm test -- --run` で新規追加 10〜15 件が green

### Task 13: Firestore Rules デプロイ + emulator 確認（任意）

- **ACTION**: rules をデプロイ
- **IMPLEMENT**:
  ```bash
  # ローカル emulator で rule テスト（推奨）
  firebase emulators:start --only firestore
  # 別ターミナルで手動確認: 管理者 seed → 他人テンプレ削除 → 成功 / 非管理者が同じ操作 → denied

  # 本番反映
  firebase deploy --only firestore:rules
  ```
- **MIRROR**: Phase 4.6 のデプロイ手順
- **IMPORTS**: N/A
- **GOTCHA**:
  - 本番デプロイ直後に Console で最初の管理者を seed する（README 手順）
  - emulator は最低限確認。本番で破壊操作しない
- **VALIDATE**: `firebase deploy` exit 0、deploy 後 `/templates` が動作する

### Task 14: PRD 更新

- **ACTION**: `.claude/PRPs/prds/allin-timer.prd.md` に Phase 4.8 行を追加し、Phase 5 の Depends を更新
- **IMPLEMENT**:
  - Implementation Phases テーブルに 4.8 行追加（status: in-progress）
  - Phase 5 の Depends を `3, 4, 4.5, 4.6, 4.7` → `3, 4, 4.5, 4.6, 4.7, 4.8`
  - Phase Details に "Phase 4.8" section を追加
  - Parallelism Notes に「Phase 4.8 は Phase 4.7 完了後。rules 追加 + bootstrap 運用あり」を追記
- **MIRROR**: 既存の Phase 4.6 エントリ
- **IMPORTS**: N/A
- **GOTCHA**: 行番号順（4.7 の直後）を守る
- **VALIDATE**: `grep -E "4\.(7|8)"` で両 phase 行が出る

### Task 15: lint / typecheck / build 確認

- **ACTION**: 検証コマンド実行
- **IMPLEMENT**: `npm run typecheck && npm run lint && npm test -- --run && npm run build`
- **MIRROR**: Phase 4.6 の validation 手順
- **IMPORTS**: N/A
- **GOTCHA**: 新規ページ 3 本（/templates, /templates/new, /templates/[tid]/edit）が build で認識されるか確認
- **VALIDATE**: 全コマンド exit 0

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| structureTemplateBodySchema parse | 全フィールド valid | parse success | 標準 |
| structureTemplateBodySchema parse (no description) | description undefined | `description === ""` | default |
| structureTemplateBodySchema parse (invalid createdByDisplayName) | empty string | safeParse → success: false | min(1) 担保 |
| createStructureTemplate | input.rebuyStack === undefined | addDoc が `null` で呼ばれる | 正規化 |
| listStructureTemplates | 2 valid + 1 invalid doc | length === 2, invalid は warn log | doc 耐性 |
| isTemplateAdmin | doc exists | true | admin=true |
| isTemplateAdmin | permission-denied | false | 非管理者 |
| StructureTemplateCard (library, owner) | canEdit=true, canDelete=true | 編集・削除両方表示 | owner 権限 |
| StructureTemplateCard (library, other + non-admin) | canEdit=false, canDelete=false | 編集・削除なし | 閲覧のみ |
| StructureTemplateCard (library, admin non-owner) | canEdit=false, canDelete=true | 削除のみ | 管理者削除 |
| StructureTemplateCard (picker) | variant=picker | "このテンプレを使う" 表示 | picker UI |

### Edge Cases Checklist

- [x] 非管理者が他人のテンプレ削除を試みる → permission-denied（rule）
- [x] 管理者が他人のテンプレを削除 → 成功
- [x] 作成者が `/settings` で rename しても既存テンプレの `createdByDisplayName` は不変
- [x] 匿名ユーザーが `/templates/new` にアクセス → 早期 return
- [x] `createdByUid` を書き換える update → rule で reject
- [x] `templateAdmins` の list クエリ → rule で reject
- [x] 管理者が自分を revoke して 0 人 → Console で再 seed でのみ復旧（README に注意書き）
- [x] テンプレ 0 件で `/structures/new` を開く → picker が empty メッセージ + `/templates/new` リンク表示
- [x] `/templates/{tid}/edit` に他人の tid を渡す → `/templates` に redirect

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors（新規型 `StructureTemplateDoc` / `StructureTemplateBody` / `TemplateAdminBody` が解決）

### Lint

```bash
npm run lint
```

EXPECT: No warnings

### Unit Tests

```bash
npm test -- --run
```

EXPECT: 全 test pass（Phase 4.7 の 325〜327 件 + 新規 12〜15 件）

### Build

```bash
npm run build
```

EXPECT: Next.js 全ページ生成成功（/templates、/templates/new、/templates/[tid]/edit の 3 pages 追加）

### Firestore Rules

```bash
# ローカル確認（推奨）
firebase emulators:start --only firestore
# 本番反映
firebase deploy --only firestore:rules
```

EXPECT: structureTemplates と templateAdmins の match ブロックが追加されたデプロイが成功する

### Bootstrap（手動運用）

```
Firestore Console で手動作成:
  コレクション: templateAdmins
  ドキュメント ID: <最初の管理者の uid>
  フィールド: createdAt (timestamp, 現在時刻)
```

**この操作を行わないと「作成者不明テンプレの削除」機能が使えない状態で運用が始まる**。README に注意書き。

### Manual Browser Validation

```bash
npm run dev
```

Then perform:

- [ ] `/templates/new` で自作テンプレを作成 → `/templates` 一覧に「作成者: （自分の表示名）」で表示 → 本人なので編集・削除ボタン表示
- [ ] 別ユーザーでログイン → `/templates` で上記テンプレは表示されるが編集・削除ボタン非表示（作成者名は見える）
- [ ] Firestore Console で自分の uid の `templateAdmins/{uid}` doc を手動作成 → `/templates` 再読込で他人テンプレにも削除ボタン表示
- [ ] 管理者として他人テンプレを削除 → 一覧から消える → 別ユーザーで再読込しても消えている
- [ ] `/structures/new` → Firestore 取得のテンプレカード表示 → カードクリック → フォーム全項目が書換 → 編集して保存 → `/structures` で確認
- [ ] `/structures/{sid}/edit` → テンプレートカードが**表示されない**（編集画面）
- [ ] 匿名ユーザーで `/templates/new` → 「通常アカウントでログインしてください」表示
- [ ] 他人のテンプレの `/templates/{tid}/edit` を URL 直打ち → `/templates` に redirect

---

## Acceptance Criteria

- [ ] 全 15 タスク完了
- [ ] `npm run typecheck` / `lint` / `test -- --run` / `build` が全 green
- [ ] `firestore.rules` が本番にデプロイされ、最初の管理者が Console で seed 済み
- [ ] `/templates` / `/templates/new` / `/templates/{tid}/edit` / `/structures/new` の TemplatePicker が手動ブラウザで動作確認済み
- [ ] PRD の Implementation Phases テーブルに Phase 4.8 が in-progress で載っている

## Completion Checklist

- [ ] Code follows discovered patterns（zod schema / repository / AppError / logger）
- [ ] Error handling matches codebase style
- [ ] Tests follow test patterns
- [ ] No hardcoded admin uids in code（Firestore doc で管理）
- [ ] Documentation updated（PRD / README / security.md）
- [ ] Self-contained — 実装中に追加の判断が不要

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| テンプレ作成が spam される | M | S | サインイン必須 + `createdByUid == auth.uid` で作者紐付けが担保。管理者削除機能で対処。Phase 5 で件数確認後、必要なら Cloud Functions で rate limit |
| 管理者が 0 人の状態で運用が始まり、作成者不明テンプレが削除不能 | M | M | README に「Phase 4.8 デプロイ後、必ず 1 人以上 Firestore Console で管理者を seed する」手順を追記。運用ルール徹底 |
| 管理者が自分を revoke して 0 人 | L | M | UI に self-revoke を出さない（本 Phase では grant/revoke UI 自体未実装）。Console 経由で再 seed で復旧可 |
| `createdByDisplayName` が stale | M | S | 仕様として許容（NOT Building）。本人が /templates/{tid}/edit で delete + recreate すれば更新可能 |
| `structureTemplates` の件数増大で listStructureTemplates が遅くなる | L | S | 20〜数百件スケールなら問題なし。1000+ で pagination |
| Firestore Rules デプロイミスで既存機能が壊れる | L | H | rules に追加する match ブロックのみで既存に触れない。デプロイ前に `git diff firestore.rules` で追加箇所のみを確認 |
| Phase 4.7 の schema 拡張を先行完了しないまま実装着手 | M | H | plan の Depends を明記。Phase 4.7 merge 後に 4.8 着手 |

## Notes

- **互換レイヤは作らない**（Phase 2.5 / 4.6 の方針踏襲）: 新規 collection のみで既存に影響しない
- **作成者名 snapshot**: `createdByDisplayName` は doc 内に保存。users/{uid} の self-only read を回避しつつ、作成者の rename 追従は仕様として放棄（許容）
- **管理者モデルのシンプル化**: `templateAdmins/{uid}` doc 存在のみで判定。配列管理や role 階層は作らない（グローバル role なので Phase 4.6 group role とは独立）
- **将来の拡張余地**:
  - `/admin/templates` ページで grant/revoke UI（repository はすでに用意済み）
  - `/structures/[sid]` から「テンプレとして公開」ボタン（doc コピー機能）
  - タグ / カテゴリ / 検索（件数増加時）
- **Codex レビュー対策**: 本計画書は CLAUDE.md 記載の通り Codex レビュー対象
