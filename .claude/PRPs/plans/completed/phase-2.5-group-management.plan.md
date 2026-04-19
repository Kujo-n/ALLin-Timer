# Plan: Phase 2.5 — Group (サークル) Management

## Summary

サークルを第一級エンティティ化し、2〜3 人の運営者で `structures` / `tournaments` を共有できるようにする。具体的には (1) `groups/{gid}` と `groupJoinCodes/{code}` の新規コレクション、(2) `users/{uid}.groupIds` 逆引きフィールド追加、(3) `structures` / `tournaments` を `ownerUid` から `groupId` + `createdByUid` に**破壊的変更**、(4) `/groups`・`/groups/new`・`/groups/[gid]`・`/groups/join/[code]` のページ追加、(5) 既存 UI を「現在選択中の group」コンテキストで動かすよう修正、(6) Firestore Security Rules を group メンバーシップベースに刷新する。

## User Story

As a 2〜3 人で運営するポーカーサークルの運営者,
I want 自分たちのサークル（group）を作成して他の運営者を招待コードで加入させ、保存したストラクチャや作成したトーナメントをサークル全員で共有できるようにしたい,
So that 一人の運営者（`ownerUid`）が作成したトーナメントを他の運営者が編集・開始・削除でき、当日 3 人のうち誰がプレイ中でも即応して進行操作できる。

## Problem → Solution

**現状（Phase 2 完了時点）**: `structures/{sid}` と `tournaments/{tid}` は `ownerUid` ベースの個人所有モデル。`listMyStructures(uid)` / `listMyTournaments(uid)` は `where("ownerUid", "==", uid)` で自分所有分のみ返す。Security Rules も `resource.data.ownerUid == request.auth.uid` で他ユーザーは read／write できない。結果、運営者 A が作ったストラクチャを運営者 B が使えず、サークル運営が破綻する。

**目標状態**:
- 運営者は `/groups/new` で group を作成、または `/groups/join/[code]` で既存 group に加入できる。
- `/groups` に自分の所属 group 一覧が出て、UI のヘッダ等で「現在の group」を切替できる。
- `/structures` / `/tournaments` は現在選択中の group に属するデータのみを一覧・新規作成する。
- group メンバーであれば所属 group の structures / tournaments を自由に read / update / delete できる。
- Firestore Security Rules は group `memberUids` を真実源として read / write を許可する。
- 既存データ（Phase 2 で作った structures / tournaments）は**破壊的に削除**し、`groupId` / `createdByUid` を要求する新スキーマに移行する。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md)
- **PRD Phase**: Phase 2.5 — Group Management
- **Dependencies**: Phase 2（complete）
- **Blocks**: Phase 3 / Phase 4（破壊的スキーマ変更のため、先に完了させる必要あり）
- **Estimated Files**: 30〜40（route／component／lib／schema／rules／test 含む）

---

## UX Design

### Before

```
┌────────────────────────────────────────────────────┐
│  /login                                            │
│  /tournaments       → 自分所有のトーナメント一覧   │
│  /tournaments/new   → 自分所有で新規作成           │
│  /structures        → 自分所有のストラクチャ一覧   │
│  /structures/new    → 自分所有で新規作成           │
│  /join/[tid]        → 参加者受付（tid ベース）     │
│  （group という概念は存在しない）                   │
└────────────────────────────────────────────────────┘
```

### After

```
┌────────────────────────────────────────────────────────────────────┐
│  /login                                                            │
│  /groups                 → 所属 group 一覧＋「新規作成」           │
│  /groups/new             → group 名入力して作成（自分が owner）    │
│  /groups/[gid]           → メンバー一覧・招待コード発行・脱退      │
│  /groups/join/[code]     → 招待コードで group に加入               │
│                                                                    │
│  /tournaments            → **現在の group** のトーナメント一覧     │
│  /tournaments/new        → **現在の group** で新規作成             │
│  /tournaments/[tid]      → group メンバーなら編集／開始／削除可    │
│  /structures             → **現在の group** のストラクチャ一覧     │
│                                                                    │
│  /join/[tid]             → 参加者受付（従来通り tid ベース、       │
│                             group 非依存）                         │
│                                                                    │
│  ヘッダ / サイドバー                                               │
│   現在の group 名 + 切替セレクト（複数所属時）                     │
│                                                                    │
│  初回ログイン時：                                                  │
│   groupIds が空なら /groups にリダイレクト（group 必須導線）       │
└────────────────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
|---|---|---|---|
| ストラクチャ一覧 | `ownerUid == 自分` の 1 次元 | 「現在の group」の全メンバー共有プリセット | group 切替で別サークルのプリセットに切替 |
| トーナメント一覧 | `ownerUid == 自分` の 1 次元 | 「現在の group」の全トーナメント | 運営者 3 人すべてに同一リストが見える |
| トーナメント編集／開始／削除権限 | `ownerUid === 自分` のみ | group メンバー全員 | 当日プレイヤー兼任運営の相互代替を実現 |
| 受付画面 | 変更なし | 変更なし（参加者は group 概念を知らない） | tournament doc を直読する SDK rule のみ調整 |
| サークル（group） | 概念なし | 明示的な group エンティティ | 招待コードで加入／owner のみ削除 |
| 現在の group | 概念なし | localStorage（`allinpt.currentGroupId`）で永続化 | 起動時に groupIds に含まれるか検証、無効なら自動クリア |
| 初回導線 | `/tournaments` 直行 | groupIds 空なら `/groups` に誘導 | Phase 2.5 追加の 1 段階 |

---

## Mandatory Reading

実装着手前に必ず読むファイル。記憶に頼らず毎回 Read で現物確認する。

| Priority | File | Lines | Why |
|---|---|---|---|
| P0 | [CLAUDE.md](CLAUDE.md) | 全体 | プロジェクト全体規約・日本語応答・ルール参照義務 |
| P0 | [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) | 全体 | singleton／`useAuthUser`／`zodConverter`／repositories 層／deny-by-default／client-side sort 設計 |
| P0 | [.claude/rules/error-logging.md](.claude/rules/error-logging.md) | 全体 | `AppError` ラップ、ドメインコード命名、`logger` 経由 |
| P0 | [.claude/rules/security.md](.claude/rules/security.md) | 全体 | `.env.local` 管理、サークル固有情報の Firestore 限定保存 |
| P0 | [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) | 197-254, 300-313 | Implementation Phases 表 / Phase 2.5 scope / Decisions Log の Group 関連 |
| P0 | [src/lib/firebase/client.ts](src/lib/firebase/client.ts) | 1-51 | singleton（`firestore` / `firebaseAuth`）の取り出し方 |
| P0 | [src/lib/firebase/AuthProvider.tsx](src/lib/firebase/AuthProvider.tsx) | 1-43 | `useAuthUser` の戻り値型／ Provider が `src/app/layout.tsx` でラップ済み |
| P0 | [src/lib/firebase/converters.ts](src/lib/firebase/converters.ts) | 1-40 | `zodConverter(schema, collectionName)` の使い方と `firestore/invalid-data` 自動 throw |
| P0 | [src/lib/errors.ts](src/lib/errors.ts) | 1-18 | `AppError` 構造 / `AppError.from()` の pass-through |
| P0 | [src/lib/logger.ts](src/lib/logger.ts) | 1-46 | レベル閾値挙動／`console` 直呼び禁止 |
| P0 | [src/lib/firebase/schemas/structure.ts](src/lib/firebase/schemas/structure.ts) | 1-43 | 現行 schema（`ownerUid` を削って `groupId` + `createdByUid` にする対象） |
| P0 | [src/lib/firebase/schemas/tournament.ts](src/lib/firebase/schemas/tournament.ts) | 1-50 | 現行 schema（同上） |
| P0 | [src/lib/firebase/schemas/user.ts](src/lib/firebase/schemas/user.ts) | 1-23 | 現行 `users/{uid}` schema（`groupIds` 配列追加対象） |
| P0 | [src/lib/firebase/repositories/structures.ts](src/lib/firebase/repositories/structures.ts) | 1-99 | 既存 CRUD パターン（zodConverter 適用・try/catch → AppError.from・client-side sort） |
| P0 | [src/lib/firebase/repositories/tournaments.ts](src/lib/firebase/repositories/tournaments.ts) | 1-155 | 既存 CRUD＋`startTournament` / `deleteTournamentIfSetup` の owner チェック（group 権限チェックに置換） |
| P0 | [src/lib/firebase/repositories/users.ts](src/lib/firebase/repositories/users.ts) | 1-58 | 既存 upsert パターン（`groupIds` 追加時は `arrayUnion` / `arrayRemove` を併用） |
| P0 | [firestore.rules](firestore.rules) | 全体 | 既存ルール（`ownerUid` ベース）。group 版に書き換え |
| P1 | [src/app/structures/structures-client.tsx](src/app/structures/structures-client.tsx) | 1-165 | 一覧 UI 参考（`useAuthUser` → `useCurrentGroup` に置換） |
| P1 | [src/app/tournaments/tournaments-client.tsx](src/app/tournaments/tournaments-client.tsx) | 1-104 | 一覧 UI 参考 |
| P1 | [src/app/tournaments/[tid]/dashboard-client.tsx](src/app/tournaments/[tid]/dashboard-client.tsx) | 1-250 | `canEdit = isOwner && state==="setup"` の isOwner 判定（group メンバー判定に置換） |
| P1 | [src/app/structures/new/structure-new-client.tsx](src/app/structures/new/structure-new-client.tsx) | 1-32 | create 呼び出しの `ownerUid: user.uid` を `groupId / createdByUid` に置換 |
| P1 | [src/app/tournaments/new/tournament-new-client.tsx](src/app/tournaments/new/tournament-new-client.tsx) | 1-33 | 同上 |
| P1 | [src/components/structure/StructureForm.tsx](src/components/structure/StructureForm.tsx) | 1-153 | form props `ownerUid` → `groupId` + `createdByUid` |
| P1 | [src/components/tournament/TournamentForm.tsx](src/components/tournament/TournamentForm.tsx) | 1-175 | 同上 |
| P1 | [src/components/auth/RequireAuth.tsx](src/components/auth/RequireAuth.tsx) | 1-31 | 認証ガードの既存パターン（`RequireGroup` を隣に追加） |
| P1 | [src/components/auth/AuthBadge.tsx](src/components/auth/AuthBadge.tsx) | 1-78 | ヘッダ UI 配置（ここに group 切替を足す） |
| P1 | [src/lib/services/receipt.ts](src/lib/services/receipt.ts) | 1-219 | 受付サービス。tournament 書込時の `ownerUid` チェックを group 権限に置換（`cancelPlayerEntry` 等） |
| P1 | [src/lib/firebase/schemas/index.test.ts](src/lib/firebase/schemas/index.test.ts) | 1-118 | schema テスト命名／配置（`groupBodySchema` / `groupJoinCodeBodySchema` テストを追加） |
| P1 | [src/lib/firebase/converters.test.ts](src/lib/firebase/converters.test.ts) | 1-47 | `zodConverter` 単体テストの書き方（mock snapshot 作成） |
| P1 | [src/lib/services/receipt.test.ts](src/lib/services/receipt.test.ts) | 1-227 | Vitest で `vi.mock` + `vi.hoisted` を使う service テストの例（`group.test.ts` / `current-group.test.ts` で再利用） |
| P1 | [src/lib/firebase/AuthProvider.tsx](src/lib/firebase/AuthProvider.tsx) | 1-43 | Context Provider パターン（`GroupProvider` / `useCurrentGroup` で踏襲） |
| P2 | [.claude/PRPs/plans/completed/phase-2-tournament-setup-receipt.plan.md](.claude/PRPs/plans/completed/phase-2-tournament-setup-receipt.plan.md) | 全体 | Phase 2 の決定事項全体 |
| P2 | [package.json](package.json) | 1-51 | `firebase ^11.1.0` / `zod ^4.3.6` / `vitest ^2.1.8` 依存確認。新規追加は原則不要 |
| P2 | [firestore.indexes.json](firestore.indexes.json) | 全体 | 複合インデックスは空。`where("groupId","==") + orderBy("createdAt")` は **client-side sort** で回避する（`listMyStructures` パターン準拠） |

## External Documentation

| Topic | Source | Key Takeaway |
|---|---|---|
| Firestore — Security Rules `get()` / `exists()` | https://firebase.google.com/docs/firestore/security/rules-conditions#accessing_other_documents | `get(/databases/$(database)/documents/...)` で他 doc を参照、10 `get()` まで。`exists()` ガードで存在しないときの失敗回避 |
| Firestore — Transactions（client） | https://firebase.google.com/docs/firestore/manage-data/transactions#web-version-9 | `runTransaction(firestore, async (tx) => { ... })`。複数 doc を atomic 更新（join code consume で使用） |
| Firestore — `arrayUnion` / `arrayRemove` | https://firebase.google.com/docs/firestore/manage-data/add-data#update_elements_in_an_array | `updateDoc(ref, { members: arrayUnion(uid) })`。重複を気にせず追加／削除できる |
| Firestore — Security Rules list 比較 | https://firebase.google.com/docs/reference/rules/rules.List | `size()` / `hasAll()` / `hasOnly()` / `removeAll()`。配列差分の制約を rule で書ける |
| Firestore — Server Timestamps | https://firebase.google.com/docs/firestore/manage-data/add-data#server_timestamp | `serverTimestamp()` を `createdAt` / `expiresAt` に使用 |
| Firestore — Rules `request.time` | https://firebase.google.com/docs/reference/rules/rules.firestore.Request | `request.time.toMillis()` で現在時刻。`expiresAt` 比較に使える |
| zod — `z.array(z.string())` | https://zod.dev/?id=arrays | `groupIds` / `memberUids` の schema。`.min(1)` で non-empty 強制 |
| Next.js App Router — 動的ルート | https://nextjs.org/docs/app/building-your-application/routing/dynamic-routes | `app/groups/[gid]/page.tsx` と `app/groups/join/[code]/page.tsx`（`params: Promise<{ gid: string }>`） |
| Next.js — `redirect()` | https://nextjs.org/docs/app/api-reference/functions/redirect | サーバ／クライアントから redirect。初回ユーザーが `/groups` に飛ぶ導線で使用 |

**Research Findings**

```
KEY_INSIGHT: Firestore Security Rules の `get()` は read count を 1 消費し、rule evaluation 毎に
最大 10 回まで。group メンバーシップを他コレクション（structures / tournaments / players）の
rule から参照する際、チェーンが深くならないよう groupId を資源 doc 自身に保存しておく。
APPLIES_TO: structures / tournaments / tournaments/{tid}/players の rule 設計
GOTCHA: `get(tournaments/{tid}).data.groupId` + `get(groups/{gid}).data.memberUids` の 2 段 get
        で済むように、tournaments doc に groupId を直接持つ。players rule からも同じ 2 段で辿れる
```

```
KEY_INSIGHT: 招待コード（`groupJoinCodes/{code}`）の「自分を memberUids に追加する」書込は
厳密には「groups の update」と「groupJoinCodes の update（使用カウント増）」の 2 書込。
Security Rules で atomic を保証できないため、rules 側は「それぞれ独立に自己整合的」になるよう書く:
  1) groupJoinCodes/{code} の update: usesCount を +1 のみ、expiresAt 未到達、他フィールド不変
  2) groups/{gid} の update: 自分を memberUids に +1 追加する差分のみ（owner の場合は full edit）
クライアント側は `runTransaction` で 2 書込を束ねる（ただしトランザクション失敗時は rule 単独で
守られるのでデータ整合性は保たれる）。
APPLIES_TO: Task: consumeJoinCode service、groups / groupJoinCodes の rules
GOTCHA: transaction 内の書込順は「まず groupJoinCodes.update」→「次に groups.update」の順で、
        コード失効を早めに検出する。`users/{uid}.groupIds` への arrayUnion はトランザクション
        外で後置（rule で本人のみ更新可なので rollback 不要）。
```

```
KEY_INSIGHT: Firestore Security Rules で「自分を配列に追加するだけ」の update を許可するには
`request.resource.data.memberUids.hasAll(resource.data.memberUids)` で既存要素全保存を、
`request.resource.data.memberUids.size() == resource.data.memberUids.size() + 1` で +1 増加を、
`request.auth.uid in request.resource.data.memberUids` で自分が追加されたことを同時チェックする。
APPLIES_TO: groups/{gid} の self-add update rule
GOTCHA: `arrayUnion(x)` で既に含まれるケースは配列が変化しないため、非メンバーのみが発動する
        `!(request.auth.uid in resource.data.memberUids)` 前提条件も必須。
```

```
KEY_INSIGHT: Firestore の `Timestamp` 型は expiresAt の型として `z.instanceof(Timestamp)` で
validate する。rule 側では `resource.data.expiresAt.toMillis() > request.time.toMillis()` で比較。
APPLIES_TO: groupJoinCodes schema と rules
GOTCHA: クライアントで書き込む際は `Timestamp.fromDate(new Date(Date.now() + 7 * 86400_000))`
        のように明示的に Timestamp にする。serverTimestamp() は読取時 Timestamp に解決されるが、
        期限計算は書込時点では確定したいので `Timestamp.fromDate` を推奨。
```

```
KEY_INSIGHT: 招待コードの code 文字列は Firestore doc id として扱い、衝突を避けるため
`nanoid`（短めの URL-safe）を用いる。ただし外部依存を増やさず済ませるため、本 Phase では
`crypto.getRandomValues` + Base32 的な自前実装か、`Array.from(crypto.getRandomValues(new Uint8Array(8)))`
を hex/base36 化した 12 文字程度で足りる。
APPLIES_TO: `groupJoinCodes/{code}` の code 生成
GOTCHA: サークル規模 20 人／月 1〜2 回では衝突はまず起きない。生成時に `exists()` で再試行する
        フォールバック（最大 3 回）だけ持たせれば十分。
```

```
KEY_INSIGHT: `users/{uid}.groupIds` は真実源ではなく「逆引きキャッシュ」である。真実源は
各 `groups/{gid}.memberUids`。ただしクライアントで自分の group 一覧を取りたいとき `memberUids`
への `array-contains` クエリだと rule が read を許可しにくい（対象 group がまだ read 不可の段階で
list 評価されるため）。`users/{uid}.groupIds` を join/leave 時に同期更新して list 取得はここから行う。
APPLIES_TO: /groups 一覧、GroupProvider
GOTCHA: drift が起きた場合のリカバリ：`users/{uid}.groupIds` に載っている gid が実際には
        `memberUids` に含まれないとき、その gid は表示から除外してサイレントに `arrayRemove` する
        （同期修復）。
```

```
KEY_INSIGHT: Phase 2.5 は「破壊的スキーマ変更」。既存 structures / tournaments には groupId が
無いため、rule 更新後は旧 doc が読めなくなる。PRD の方針通り、**コード変更と同時に Firebase
Console から旧 collection を手動削除**する運用とする（本番データなしの内部検証段階）。互換レイヤは
作らない。
APPLIES_TO: 実装全体（rollback が必要な場合は git revert + rule revert + 手動再投入）
GOTCHA: プラン実行者は実装前に「旧 structures / tournaments を Firestore Console で delete する
        手順」を README もしくは実装レポートに明記すること。
```

---

## Patterns to Mirror

Phase 2 で確立した規約をそのまま踏襲する。新規概念は最小限。

### NAMING_CONVENTION
```ts
// SOURCE: src/lib/firebase/schemas/structure.ts:17-28 / src/lib/firebase/repositories/structures.ts:1-27
// 維持事項:
//   - schema は `{collection}BodySchema`（id を含まない本体）＋ `{Collection}Doc`（body + id）
//   - 入力型は `create{Collection}InputSchema` / `update{Collection}InputSchema`
//   - repository 関数名: `get{Collection}` / `list{Xxx}{Collection}s` / `create{Collection}` /
//     `update{Collection}` / `delete{Collection}`
//   - Phase 2.5 追加:
//     - ファイル名: `src/lib/firebase/schemas/group.ts`, `groupJoinCode.ts`
//     - repository: `repositories/groups.ts`, `repositories/groupJoinCodes.ts`
//     - dynamic route セグメント: `[gid]`, `[code]`
//     - service: `src/lib/services/group.ts`（join / leave / consumeJoinCode）
//     - hook/provider: `src/lib/services/current-group.tsx`（`GroupProvider` + `useCurrentGroup`）
```

### ZOD_SCHEMA
```ts
// SOURCE: src/lib/firebase/schemas/structure.ts:4-37
import { Timestamp } from "firebase/firestore";
import { z } from "zod";

export const structureBodySchema = z.object({
  ownerUid: z.string().min(1),
  name: z.string().min(1),
  initialStack: z.number().int().positive(),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
  createdAt: z.instanceof(Timestamp),
});
export type StructureBody = z.infer<typeof structureBodySchema>;
export type StructureDoc = StructureBody & { id: string };

export const createStructureInputSchema = z.object({
  ownerUid: z.string().min(1),
  name: z.string().min(1, "名前を入力してください"),
  // ...
});
export type CreateStructureInput = z.infer<typeof createStructureInputSchema>;
```

### REPOSITORY_PATTERN
```ts
// SOURCE: src/lib/firebase/repositories/structures.ts:25-73
const structuresRef = collection(firestore, "structures").withConverter(
  zodConverter(structureBodySchema, "structures"),
);

export async function createStructure(
  input: CreateStructureInput,
): Promise<string> {
  try {
    const ref = await addDoc(structuresRef, {
      ...input,
      createdAt: serverTimestamp(),
    });
    logger.info("structure create ok", { sid: ref.id });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "ストラクチャ作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function listMyStructures(uid: string): Promise<StructureDoc[]> {
  try {
    const q = query(structuresRef, where("ownerUid", "==", uid));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // 複合インデックス追加を避けるため client 側で降順ソート
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return items;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "ストラクチャ一覧取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
```

### ERROR_HANDLING
```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:104-130 / src/lib/errors.ts:1-18
export async function startTournament(tid: string, uid: string): Promise<void> {
  const t = await getTournament(tid);
  if (t.ownerUid !== uid) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError(
      "このトーナメントは既に開始されています",
      "tournament/already-started",
    );
  }
  try {
    await updateDoc(/* ... */);
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "...");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}
// Phase 2.5 の owner チェックは group メンバー判定に置換する:
//   if (!t.groupId || !currentUser.groupIds.includes(t.groupId)) throw new AppError(..., "group/not-member");
```

### PROVIDER_PATTERN
```tsx
// SOURCE: src/lib/firebase/AuthProvider.tsx:1-43
// GroupProvider は同じ shape で作る：
"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type GroupState = {
  currentGroupId: string | null;
  groupIds: string[];
  setCurrentGroupId: (gid: string | null) => void;
  loading: boolean;
};
const GroupContext = createContext<GroupState>(/* default */);

export function GroupProvider({ children }: { children: ReactNode }) {
  // users/{uid}.groupIds を購読、localStorage に currentGroupId を永続化
  // user が変わったら state リセット
}

export function useCurrentGroup(): GroupState {
  return useContext(GroupContext);
}
```

### CLIENT_COMPONENT_PAGE
```tsx
// SOURCE: src/app/structures/page.tsx:1-11 + src/app/structures/structures-client.tsx:1-20
// page.tsx（サーバ側）:
import { RequireAuth } from "@/components/auth/RequireAuth";
import { GroupsClient } from "./groups-client";

export default function GroupsPage() {
  return (
    <RequireAuth>
      <GroupsClient />
    </RequireAuth>
  );
}

// groups-client.tsx（"use client"）:
"use client";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
export function GroupsClient() {
  const { user } = useAuthUser();
  // reload / delete / UI ...
}
```

### FIRESTORE_RULES — `get()` ベースの group メンバーシップ判定
```
// SOURCE: firestore.rules:50-56（tournaments の sub=** 書込条件で get() する既存形）
// Phase 2.5 で導入する helper 関数パターン:
function isGroupMember(gid) {
  return request.auth != null
         && exists(/databases/$(database)/documents/groups/$(gid))
         && request.auth.uid in get(/databases/$(database)/documents/groups/$(gid)).data.memberUids;
}

function isGroupOwner(gid) {
  return request.auth != null
         && exists(/databases/$(database)/documents/groups/$(gid))
         && get(/databases/$(database)/documents/groups/$(gid)).data.ownerUid == request.auth.uid;
}
```

### TEST_STRUCTURE（Vitest + hoisted mock）
```ts
// SOURCE: src/lib/services/receipt.test.ts:1-70
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));

vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: mockAuthState,
  firestore: {},
}));
vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroup: vi.fn(),
  updateGroupMembers: vi.fn(),
}));

import { getGroup } from "@/lib/firebase/repositories/groups";
import { consumeJoinCode } from "./group";

describe("consumeJoinCode", () => {
  beforeEach(() => {
    vi.mocked(getGroup).mockReset();
    mockAuthState.currentUser = null;
  });
  // ...
});
```

---

## Files to Change

| File | Action | Justification |
|---|---|---|
| `src/lib/firebase/schemas/group.ts` | CREATE | `groupBodySchema` / `GroupDoc` / `createGroupInputSchema` |
| `src/lib/firebase/schemas/groupJoinCode.ts` | CREATE | 招待コード schema（`gid` / `createdByUid` / `expiresAt` / `maxUses` / `usesCount`） |
| `src/lib/firebase/schemas/user.ts` | UPDATE | `userProfileBodySchema` に `groupIds: z.array(z.string()).default([])` 追加 |
| `src/lib/firebase/schemas/structure.ts` | UPDATE | `ownerUid` 削除、`groupId` + `createdByUid` 追加（body / createInput 双方） |
| `src/lib/firebase/schemas/tournament.ts` | UPDATE | `ownerUid` 削除、`groupId` + `createdByUid` 追加 |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | 新 schema テスト追加、既存テストの fixture を groupId/createdByUid に更新 |
| `src/lib/firebase/repositories/groups.ts` | CREATE | `getGroup` / `listMyGroups(uid)` / `createGroup` / `updateGroupName` / `addMember` / `removeMember` / `deleteGroup` |
| `src/lib/firebase/repositories/groupJoinCodes.ts` | CREATE | `createJoinCode` / `getJoinCode` / `incrementUsesCount` / `deleteJoinCode` |
| `src/lib/firebase/repositories/users.ts` | UPDATE | `groupIds` の arrayUnion / arrayRemove ヘルパ追加 |
| `src/lib/firebase/repositories/structures.ts` | UPDATE | `listMyStructures(uid)` → `listStructuresByGroup(gid)`。create は `groupId`/`createdByUid` を受ける |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | `listMyTournaments` → `listTournamentsByGroup`。`startTournament` / `deleteTournamentIfSetup` の owner チェックを「trx に渡された currentUser が group メンバーか」に置換（ただし API は tid + uid 継続） |
| `src/lib/services/group.ts` | CREATE | `createGroupWithOwner` / `consumeJoinCode` / `leaveGroup` / `generateJoinCode`（transaction 併用） |
| `src/lib/services/group.test.ts` | CREATE | 上記各サービスの unit test（mock 主体） |
| `src/lib/services/current-group.tsx` | CREATE | `GroupProvider` / `useCurrentGroup` / `useRequireGroup`。`users/{uid}` を購読して groupIds を保持、`localStorage` で current を永続化 |
| `src/lib/services/current-group.test.tsx` | CREATE | Provider の主要経路の test |
| `src/components/auth/RequireAuth.tsx` | READ ONLY | 変更不要（`RequireGroup` は別途 `src/components/auth/RequireGroup.tsx` に作る） |
| `src/components/auth/RequireGroup.tsx` | CREATE | `useCurrentGroup` を見て groupIds 空なら `/groups`、currentGroupId 不正なら `/groups` にリダイレクト |
| `src/components/auth/AuthBadge.tsx` | UPDATE | 現在の group 名表示とクリックで切替セレクト（簡易：`<select>`） |
| `src/components/structure/StructureForm.tsx` | UPDATE | `ownerUid` prop 削除、`groupId` / `createdByUid` を受ける |
| `src/components/tournament/TournamentForm.tsx` | UPDATE | 同上 |
| `src/app/layout.tsx` | UPDATE | `AuthProvider` の内側に `GroupProvider` を追加 |
| `src/app/page.tsx` | UPDATE | 「トーナメント一覧へ」の導線文言を「サークル一覧へ」変更＋`/groups` にリンク追加 |
| `src/app/groups/page.tsx` | CREATE | `RequireAuth` + `GroupsClient` |
| `src/app/groups/groups-client.tsx` | CREATE | 所属 group 一覧 / 現在の group の切替 / 「新規作成」ボタン |
| `src/app/groups/new/page.tsx` | CREATE | `RequireAuth` + `GroupNewClient` |
| `src/app/groups/new/group-new-client.tsx` | CREATE | 名前入力 → `createGroupWithOwner` → `/groups/[gid]` |
| `src/app/groups/[gid]/page.tsx` | CREATE | `RequireAuth` + `RequireGroup`（メンバーか rule で弾かれるケースの UI ハンドリング） |
| `src/app/groups/[gid]/group-detail-client.tsx` | CREATE | メンバー一覧／招待コード発行（`generateJoinCode` → リンク表示）／脱退／（owner のみ）削除 |
| `src/app/groups/join/[code]/page.tsx` | CREATE | `RequireAuth` + `JoinGroupClient` |
| `src/app/groups/join/[code]/join-group-client.tsx` | CREATE | `consumeJoinCode` → 成功時に currentGroupId を切替 → `/groups/[gid]` |
| `src/app/tournaments/page.tsx` | UPDATE | `RequireAuth` の下に `RequireGroup` を追加 |
| `src/app/tournaments/tournaments-client.tsx` | UPDATE | `useAuthUser` に加えて `useCurrentGroup` を使い、`listTournamentsByGroup(gid)` を呼ぶ |
| `src/app/tournaments/new/tournament-new-client.tsx` | UPDATE | `createTournament` 引数を `groupId / createdByUid` ベースに |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `isOwner = data.ownerUid === user.uid` を `canManage = user.groupIds.includes(data.groupId)` に置換 |
| `src/app/tournaments/[tid]/edit/*` | UPDATE | `startTournament` / `deleteTournamentIfSetup` の呼び出しは API 不変、Form の props 更新のみ |
| `src/app/structures/page.tsx` | UPDATE | `RequireAuth` の下に `RequireGroup` を追加 |
| `src/app/structures/structures-client.tsx` | UPDATE | `listStructuresByGroup(gid)` を呼ぶ |
| `src/app/structures/new/structure-new-client.tsx` | UPDATE | `createStructure` に `groupId` / `createdByUid` を渡す |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx` | UPDATE | Form の props 更新 |
| `src/lib/services/receipt.ts` | UPDATE | `cancelPlayerEntry` 等の rule 依存コメントだけ更新（外部 API 不変）。ownerUid 参照なし |
| `firestore.rules` | UPDATE | groups / groupJoinCodes 追加、structures / tournaments の ownerUid チェックを isGroupMember 版に書き換え |
| `firestore.indexes.json` | UPDATE | **client-side sort 原則で追加しない**。`where("groupId","==") + orderBy("createdAt")` は client 側で並べる |
| `README.md` | UPDATE | group 運用セクション追加（新規登録 → group 作成 → 他運営者招待 → structures 作成） |

## NOT Building

- **Phase 3 の `onSnapshot` 系**：group メンバー一覧のリアルタイム表示は本 Phase では実装しない。`/groups/[gid]` の memberUids 表示は手動リロードボタン（Phase 2 PlayerList と同形）。
- **ロール（admin / editor / viewer）**：本 Phase は owner と member の 2 種のみ。編集権限はメンバー全員に同一付与。
- **複数 group 横断の検索**：`/structures`・`/tournaments` は常に「現在選択中の group」の 1 group のみ。
- **既存データのマイグレーションスクリプト**：破壊的変更方針のため書かない。README に「Firestore Console から旧 structures / tournaments を削除」と記載するのみ。
- **メール招待（リンク送信）**：本 Phase は「招待コード文字列を owner が口頭/チャット共有」方式のみ。
- **招待コードの使用回数上限 UI**：`maxUses` フィールドは schema に入れるが、UI は「期限のみ」で最初はシンプルに。`maxUses` は将来拡張の余地として保持。
- **Cloud Functions**：本 Phase はクライアント SDK + Firestore Rules のみで完結する。
- **group 削除時の structures / tournaments のカスケード削除**：本 Phase では owner が group を削除しても配下 doc は残さない制約を**ルール側で担保せず**、UI 側で「まず structures / tournaments を削除してから」と promptする。安全なカスケード処理は別 Phase で検討。
- **タイマー・席管理**：Phase 3 / 4 スコープ。

---

## Step-by-Step Tasks

### Task 1: `groupBodySchema` / `groupJoinCodeBodySchema` 新規 schema 追加
- **ACTION**: `src/lib/firebase/schemas/group.ts` と `src/lib/firebase/schemas/groupJoinCode.ts` を作成
- **IMPLEMENT**:
  - `groupBodySchema`: `{ name: string.min(1), ownerUid: string.min(1), memberUids: z.array(z.string().min(1)).min(1), createdAt: Timestamp }`
  - `GroupDoc = GroupBody & { id: string }`
  - `createGroupInputSchema`: `{ name, ownerUid }`（memberUids は create 時に自動で `[ownerUid]`）
  - `groupJoinCodeBodySchema`: `{ gid: string.min(1), createdByUid: string.min(1), expiresAt: Timestamp, maxUses: z.number().int().positive().nullable(), usesCount: z.number().int().nonnegative(), createdAt: Timestamp }`
  - `GroupJoinCodeDoc = GroupJoinCodeBody & { id: string }`（id は code 文字列）
- **MIRROR**: `src/lib/firebase/schemas/structure.ts:17-37` の body / doc / createInput の 3 点 export
- **IMPORTS**: `import { Timestamp } from "firebase/firestore"`; `import { z } from "zod"`
- **GOTCHA**: `maxUses: null` で無制限回数、`expiresAt` は必須（運用上の default 7 日）
- **VALIDATE**: `npm test -- schemas` で新 schema の positive / negative パースが通る

### Task 2: `userProfileBodySchema` に `groupIds` 追加
- **ACTION**: `src/lib/firebase/schemas/user.ts` を更新
- **IMPLEMENT**: `groupIds: z.array(z.string().min(1)).default([])` を body 末尾に追加。`UpsertUserProfileInput` からは省略（services 側で `arrayUnion` する）
- **MIRROR**: `src/lib/firebase/schemas/user.ts:7-13`
- **IMPORTS**: 変更なし
- **GOTCHA**: 既存 `users/{uid}` doc に `groupIds` が無い場合、zod の `default([])` は **parse 時のみ適用**。Firestore writes で省略すると doc に書かれないため、upsert 時は `groupIds: []` を明示的に初期値にする
- **VALIDATE**: `src/lib/firebase/schemas/index.test.ts` で `groupIds` 有無の両ケース parse 成功

### Task 3: `structureBodySchema` / `tournamentBodySchema` の破壊的変更
- **ACTION**: `src/lib/firebase/schemas/structure.ts` と `tournament.ts` の body から `ownerUid` を削除し `groupId: z.string().min(1)` と `createdByUid: z.string().min(1)` を追加
- **IMPLEMENT**:
  - `structureBodySchema`: `{ groupId, createdByUid, name, initialStack, lateEntryDeadlineLevel, levels, createdAt }`
  - `createStructureInputSchema`: `{ groupId, createdByUid, name, initialStack, lateEntryDeadlineLevel, levels }`
  - `updateStructureInputSchema`: `.omit({ groupId: true, createdByUid: true }).partial()`（group 移動と作成者変更は禁止）
  - `tournamentBodySchema`: 同等に `ownerUid` → `groupId` + `createdByUid`
  - `createTournamentInputSchema`: `{ groupId, createdByUid, name, structureSnapshot }`
- **MIRROR**: `src/lib/firebase/schemas/structure.ts:17-42`
- **IMPORTS**: 変更なし
- **GOTCHA**: 既存 index.test.ts fixture も `ownerUid` から `groupId`/`createdByUid` に置換要
- **VALIDATE**: `npm test -- schemas` 全 green

### Task 4: repositories/groups.ts 追加
- **ACTION**: `src/lib/firebase/repositories/groups.ts` を作成
- **IMPLEMENT**:
  - `const groupsRef = collection(firestore, "groups").withConverter(zodConverter(groupBodySchema, "groups"));`
  - `getGroup(gid) -> GroupDoc`（exists チェックで `firestore/not-found`）
  - `listMyGroups(uid) -> GroupDoc[]`: 引数の `user.groupIds` を受け取る版にする（`uid in memberUids` クエリはルール的に回避）。実装: `groupIds.map(gid => getGroup(gid))` を `Promise.allSettled`、read 失敗は skip + warn
  - `createGroup({ name, ownerUid })`: `serverTimestamp()` で createdAt、`memberUids: [ownerUid]` 固定
  - `updateGroupName(gid, name)`: owner 前提（rule 側で担保）
  - `addMemberSelf(gid, uid)`: `updateDoc(groupsRef/gid, { memberUids: arrayUnion(uid) })`
  - `removeMemberSelf(gid, uid)`: `arrayRemove(uid)`
  - `deleteGroup(gid)`: owner 前提（rule 側で担保）
- **MIRROR**: `src/lib/firebase/repositories/structures.ts:25-98` を完全踏襲（try/catch → `AppError.from("firestore/...")` → `logger.warn`）
- **IMPORTS**: `addDoc, arrayRemove, arrayUnion, collection, deleteDoc, doc, getDoc, serverTimestamp, updateDoc` from `firebase/firestore`
- **GOTCHA**: `listMyGroups` は `Promise.allSettled` の rejected を無視するのではなく「rule で拒否された gid は逆引きから消す」運用。それは `GroupProvider` 側で行うので、repository は throw せず `null` を返す方針もあるが、本 Phase は「全 gid が有効」前提で throw し、Provider が catch して drift 修復する
- **VALIDATE**: 型チェック `npm run typecheck` 通過

### Task 5: repositories/groupJoinCodes.ts 追加
- **ACTION**: `src/lib/firebase/repositories/groupJoinCodes.ts` を作成
- **IMPLEMENT**:
  - `codesRef = collection(firestore, "groupJoinCodes").withConverter(zodConverter(groupJoinCodeBodySchema, "groupJoinCodes"))`
  - `generateCodeString(): string` — `crypto.getRandomValues(new Uint8Array(8))` → `Array.from(...).map(b => b.toString(36).padStart(2, "0")).join("")` で 16 文字程度
  - `createJoinCode({ gid, createdByUid, expiresAt, maxUses? })`: `setDoc(doc(codesRef, code), {...})`、code 衝突時は最大 3 回リトライ
  - `getJoinCode(code) -> GroupJoinCodeDoc | null`（exists false → `null`、他は throw）
  - `incrementUsesCount(code)`: `updateDoc` with `usesCount: increment(1)`（後続で transaction に組み込む）
  - `deleteJoinCode(code)`: owner 側で招待コード回収
- **MIRROR**: `src/lib/firebase/repositories/structures.ts` の try/catch パターン
- **IMPORTS**: `doc, getDoc, setDoc, updateDoc, deleteDoc, increment` from `firebase/firestore`
- **GOTCHA**: `getJoinCode` は期限切れでも doc 自体は返す（判定は services 層）。rule が expiresAt 超過の update を拒否するため、consume の atomicity は rule で守られる
- **VALIDATE**: `npm run typecheck` 通過

### Task 6: repositories/users.ts を groupIds 対応
- **ACTION**: `src/lib/firebase/repositories/users.ts` を更新
- **IMPLEMENT**:
  - `upsertUserProfile(input)`: 新規作成時 `groupIds: []` 初期化、merge では触らない
  - 新規: `addGroupIdToUser(uid, gid)` / `removeGroupIdFromUser(uid, gid)` で `arrayUnion` / `arrayRemove`
- **MIRROR**: 既存 `upsertUserProfile` 構造（setDoc + merge）
- **IMPORTS**: `arrayRemove, arrayUnion` を追加
- **GOTCHA**: 既存テスト `joinAsGuest` などは `upsertUserProfile` を mock 経由で呼ぶため、`groupIds: []` を書き込むようになっても mock 側の assert が壊れないか要確認（テストは引数一致で assert）
- **VALIDATE**: `npm test -- users` or 関連テストが green

### Task 7: repositories/structures.ts を groupId ベースに
- **ACTION**: `src/lib/firebase/repositories/structures.ts` を更新
- **IMPLEMENT**:
  - 関数改名: `listMyStructures(uid)` → `listStructuresByGroup(groupId)`
  - `where("ownerUid", "==", uid)` → `where("groupId", "==", groupId)`
  - `createStructure` は `CreateStructureInput`（`groupId`/`createdByUid` 含む）をそのまま使う
- **MIRROR**: `src/lib/firebase/repositories/structures.ts:60-73`（client sort 維持）
- **IMPORTS**: 変更なし
- **GOTCHA**: 呼び出し側（`structures-client.tsx` / `TournamentForm.tsx`）を追従修正すること
- **VALIDATE**: `npm run typecheck` 通過

### Task 8: repositories/tournaments.ts を groupId ベースに
- **ACTION**: `src/lib/firebase/repositories/tournaments.ts` を更新
- **IMPLEMENT**:
  - `listMyTournaments(uid)` → `listTournamentsByGroup(groupId)`
  - `startTournament(tid, uid)` / `deleteTournamentIfSetup(tid, uid)`: `t.ownerUid !== uid` チェックを `!t.groupId` or「呼出側で memberUids を判定済み前提に切替」。最終的に rule で担保するが、クライアント側早期失敗のため `uidGroupIds: string[]` 引数を追加し `!uidGroupIds.includes(t.groupId)` チェック → `firestore/permission-denied` を投げる
  - `createTournament({ groupId, createdByUid, name, structureSnapshot })`: そのまま doc を作る
- **MIRROR**: `src/lib/firebase/repositories/tournaments.ts:104-154`
- **IMPORTS**: 変更なし
- **GOTCHA**: API シグネチャ変更は `dashboard-client.tsx` も追従修正要
- **VALIDATE**: `npm run typecheck` 通過

### Task 9: services/group.ts 追加
- **ACTION**: `src/lib/services/group.ts` を作成
- **IMPLEMENT**:
  - `createGroupWithOwner({ name, ownerUid })`:
    1. `createGroup({ name, ownerUid })` → 新 gid
    2. `addGroupIdToUser(ownerUid, gid)` で逆引き更新
    3. `return gid`
  - `consumeJoinCode({ code, uid })`:
    1. `getJoinCode(code)` で gid / expiresAt 取得。null or 期限切れ or maxUses 到達 → `AppError("group/invalid-code")`
    2. `runTransaction(firestore, async (tx) => { const codeSnap = tx.get(codeRef); /* 有効性再確認 */ tx.update(codeRef, { usesCount: increment(1) }); tx.update(groupRef, { memberUids: arrayUnion(uid) }); });`
    3. transaction 外で `addGroupIdToUser(uid, gid)`
  - `leaveGroup({ gid, uid })`:
    1. `getGroup(gid)`; owner（`ownerUid === uid`）は leave 不可 → `AppError("group/owner-cannot-leave", "先にオーナーを移譲するか group を削除してください")`
    2. `removeMemberSelf(gid, uid)` + `removeGroupIdFromUser(uid, gid)`
  - `generateJoinCode({ gid, createdByUid, expiresInDays })`: default 7 日、`createJoinCode`
- **MIRROR**: `src/lib/services/receipt.ts:73-133` の AppError 集約／logger.info 着弾パターン
- **IMPORTS**: `runTransaction, arrayUnion, increment` from `firebase/firestore`; `firestore` from `@/lib/firebase/client`
- **GOTCHA**: transaction 内は `serverTimestamp()` 使用可。`Timestamp.fromDate` は事前に作る。期限切れの場合、rule も update を拒否するので client 側チェック後でも rule で最終防衛
- **VALIDATE**: `src/lib/services/group.test.ts` で consumeJoinCode の expired / maxUses 到達 / 成功パスを mock 検証

### Task 10: services/current-group.tsx（Provider / Hook）追加
- **ACTION**: `src/lib/services/current-group.tsx` を作成
- **IMPLEMENT**:
  - `GroupProvider` は `AuthProvider` の内側に入り、`user` 変更を検知して以下を行う:
    1. `user` null → state reset（groupIds: [], currentGroupId: null）
    2. `user` あり → `getUserProfile(user.uid)` → `groupIds` を state に反映
    3. `localStorage.getItem("allinpt.currentGroupId")` を読み、groupIds に含まれれば current に、含まれなければクリアして groupIds[0] or null
    4. `onSnapshot` ではなく手動リフレッシュ関数 `refreshGroups()` を expose（Phase 3 で onSnapshot 化予定）
  - `useCurrentGroup()`: `{ currentGroupId, setCurrentGroupId, groupIds, loading, refreshGroups }`
  - `setCurrentGroupId(gid)`: state 更新 + `localStorage.setItem`。null なら `removeItem`
  - drift 修復: `getUserProfile` で得た groupIds 各 gid について `getGroup(gid)` を `Promise.allSettled`、rejected → `removeGroupIdFromUser` を発火（best effort）
- **MIRROR**: `src/lib/firebase/AuthProvider.tsx:1-43` の形
- **IMPORTS**: `useEffect, useState, createContext, useContext, type ReactNode` from `react`; `useAuthUser` from `@/lib/firebase/AuthProvider`
- **GOTCHA**: SSR 時 `localStorage` は undefined。`typeof window !== "undefined"` チェック。`current-group.tsx` は client 専用 (`"use client"`)
- **VALIDATE**: `current-group.test.tsx` で groupIds ロード／localStorage 同期／drift 除外の基本を確認

### Task 11: `src/app/layout.tsx` に `GroupProvider` を追加
- **ACTION**: `src/app/layout.tsx` を更新
- **IMPLEMENT**: `<AuthProvider><GroupProvider>{children}</GroupProvider></AuthProvider>` の並びに変更
- **MIRROR**: `src/app/layout.tsx:15-31`
- **IMPORTS**: `import { GroupProvider } from "@/lib/services/current-group"`
- **GOTCHA**: Provider は ClientComponent なので `"use client"` のままでよいが、Provider が `use` しているものは変えない
- **VALIDATE**: 既存ページが通常通り描画されること（`npm run dev` で `/`, `/login` 確認）

### Task 12: `RequireGroup` ガード追加
- **ACTION**: `src/components/auth/RequireGroup.tsx` を作成
- **IMPLEMENT**:
  - `useCurrentGroup()` で `currentGroupId` / `groupIds` / `loading` を取得
  - `loading` なら読込中表示
  - `groupIds.length === 0` → `router.replace("/groups?empty=1")`
  - `!currentGroupId` なら groupIds[0] を自動セット → return null（再レンダで OK）
- **MIRROR**: `src/components/auth/RequireAuth.tsx:1-31`
- **IMPORTS**: `useEffect, type ReactNode` from `react`; `useRouter, usePathname` from `next/navigation`
- **GOTCHA**: `/groups` 配下は `RequireGroup` で囲まない（groupIds 0 でも見られる必要あり）
- **VALIDATE**: `/tournaments` アクセスで groupIds 0 の場合 `/groups` にリダイレクトされる

### Task 13: `/groups` 一覧ページ
- **ACTION**: `src/app/groups/page.tsx` + `src/app/groups/groups-client.tsx` 作成
- **IMPLEMENT**:
  - page.tsx: `RequireAuth` のみ
  - client: `useAuthUser` + `useCurrentGroup`、`listMyGroups` 呼び出し、Card 一覧表示。各 Card に「現在選択中」バッジ＋「切替」ボタン。ヘッダに「新規作成」
  - 空状態（groupIds 0）：明確な onboarding メッセージ + 「新規作成」or「招待コードを受け取る」導線
- **MIRROR**: `src/app/structures/structures-client.tsx:1-165`
- **IMPORTS**: Button, Card, CardContent, CardHeader, CardTitle, CardDescription, Link, useAuthUser, useCurrentGroup, listMyGroups, logger, AppError
- **GOTCHA**: empty 状態は `searchParams.get("empty")` で「サークルに所属していません」メッセージを付けても良い
- **VALIDATE**: ログイン直後 groupIds 0 で `/groups` にリダイレクト → 空表示 → 新規作成ボタン動作

### Task 14: `/groups/new` 作成ページ
- **ACTION**: `src/app/groups/new/page.tsx` + `group-new-client.tsx` 作成
- **IMPLEMENT**:
  - form: name のみ（`min(1).max(60)`）
  - submit: `createGroupWithOwner({ name, ownerUid: user.uid })` → `setCurrentGroupId(gid)` → `router.push("/groups/" + gid)`
- **MIRROR**: `src/app/structures/new/structure-new-client.tsx:1-32`
- **IMPORTS**: Button, Input, Label, createGroupWithOwner, useAuthUser, useCurrentGroup, useRouter
- **GOTCHA**: 作成直後は `refreshGroups()` を呼ぶ or `setCurrentGroupId` の側で state 追記する
- **VALIDATE**: 作成成功 → `/groups/[gid]` へ遷移

### Task 15: `/groups/[gid]` 詳細ページ
- **ACTION**: `src/app/groups/[gid]/page.tsx` + `group-detail-client.tsx` 作成
- **IMPLEMENT**:
  - page.tsx: `params: Promise<{ gid: string }>`、`RequireAuth` 下で client に gid を渡す
  - client:
    - `getGroup(gid)` 呼び出し（権限なしは AppError `firestore/permission-denied` で表示）
    - メンバー一覧表示（uid を `users/{uid}` から `getUserProfile(uid)` で displayName 解決。失敗時は uid 表示）
    - 「招待コード発行」ボタン: `generateJoinCode` → 結果を `/groups/join/[code]` の完全 URL 化 → copy-to-clipboard 表示
    - owner の場合: 「group 名変更」「group 削除」ボタン
    - 非 owner の場合: 「脱退」ボタン
- **MIRROR**: `src/app/tournaments/[tid]/dashboard-client.tsx:1-250`（取得→編集→削除パターン）
- **IMPORTS**: 上記 repository / service / Dialog / Button など
- **GOTCHA**: 招待リンクのホスト取得は `window.location.origin`。SSR は不要（client 専用）
- **VALIDATE**: owner で招待コード発行 → 別ユーザーで `/groups/join/[code]` → 加入 → owner 画面に member として表示

### Task 16: `/groups/join/[code]` 加入ページ
- **ACTION**: `src/app/groups/join/[code]/page.tsx` + `join-group-client.tsx` 作成
- **IMPLEMENT**:
  - page.tsx: `params: Promise<{ code: string }>`、`RequireAuth` のみ
  - client:
    - `consumeJoinCode({ code, uid: user.uid })` を自動実行
    - 成功 → `setCurrentGroupId(gid)` + `router.push("/groups/" + gid)`
    - 失敗 → エラー表示（`group/invalid-code` / `group/already-member` 等）
    - 既に member の場合: `AppError("group/already-member")` を投げず、サーバ状態に合わせて skip → `router.push` のみ（冪等性確保）
- **MIRROR**: `src/app/auth/email-link/*` のコールバック処理パターン
- **IMPORTS**: `consumeJoinCode`, `useAuthUser`, `useCurrentGroup`, `useRouter`
- **GOTCHA**: 未ログインで code リンクを踏んだ場合、`RequireAuth` が `/login?redirect=/groups/join/[code]` に飛ばすため、ログイン後に戻れる
- **VALIDATE**: 別アカウントで加入フローが完了する

### Task 17: `/tournaments` ページを group コンテキストに
- **ACTION**: `src/app/tournaments/page.tsx` / `tournaments-client.tsx` / `new/tournament-new-client.tsx` / `[tid]/dashboard-client.tsx` / `[tid]/edit/*` を更新
- **IMPLEMENT**:
  - page.tsx: `<RequireAuth><RequireGroup><TournamentsClient /></RequireGroup></RequireAuth>`
  - tournaments-client: `useCurrentGroup()` → `listTournamentsByGroup(currentGroupId)` に差し替え
  - new-client: `createTournament({ groupId: currentGroupId, createdByUid: user.uid, name, structureSnapshot })`
  - dashboard-client: `isOwner` を `canManage = groupIds.includes(data.groupId)` に置換、ボタン出し分けを調整
  - edit-client: form が `groupId` / `createdByUid` を props で受ける。編集可能項目は変わらない（name/structureSnapshot）
- **MIRROR**: 既存 client コンポーネントの useEffect + setState ＋ AppError 表示パターン
- **IMPORTS**: `useCurrentGroup` 追加
- **GOTCHA**: `startTournament(tid, uid, uidGroupIds)` に API 変わるので呼出側も追従
- **VALIDATE**: group を切り替えたとき一覧が入れ替わる。別 group のメンバーが同じ tournament を開始/削除できる

### Task 18: `/structures` ページを group コンテキストに
- **ACTION**: `src/app/structures/page.tsx` / `structures-client.tsx` / `new/structure-new-client.tsx` / `[sid]/edit/structure-edit-client.tsx` を更新
- **IMPLEMENT**:
  - page.tsx: `<RequireAuth><RequireGroup><StructuresClient /></RequireGroup></RequireAuth>`
  - structures-client: `listStructuresByGroup(currentGroupId)`
  - new-client: `createStructure({ groupId, createdByUid, name, ... })`
  - StructureForm の `ownerUid` prop を `groupId`+`createdByUid` に差し替え
- **MIRROR**: task 17 と同構造
- **IMPORTS**: `useCurrentGroup` 追加
- **GOTCHA**: TournamentForm の `ownerUid` 引数も同時に改訂（structures 一覧を引く部分）
- **VALIDATE**: 同様に group 切替で一覧切替・別メンバーが編集可能

### Task 19: `TournamentForm` / `StructureForm` の props 変更
- **ACTION**: `src/components/tournament/TournamentForm.tsx` と `src/components/structure/StructureForm.tsx` を更新
- **IMPLEMENT**:
  - `ownerUid` prop を削除、`groupId: string` / `createdByUid: string` を受ける
  - 内部で `listStructuresByGroup(groupId)` に呼出変更（`TournamentForm` のみ）
  - submit 時 `onSubmit({ name, snapshot })` の caller 側で groupId/createdByUid を付与する（既存の構造維持）
- **MIRROR**: `src/components/tournament/TournamentForm.tsx:39-108`
- **IMPORTS**: 変更なし
- **GOTCHA**: `CreateStructureInput` / `CreateTournamentInput` の型も同時に変わるため、form 内の schema 参照も追従
- **VALIDATE**: `npm run typecheck` 通過、form 描画＆submit 動作

### Task 20: `AuthBadge` に group 切替 UI 追加
- **ACTION**: `src/components/auth/AuthBadge.tsx` を更新
- **IMPLEMENT**:
  - ログイン済＋ groupIds ≥ 1 の場合、現在の group 名を小さく表示
  - groupIds ≥ 2 の場合は `<Select>` で切替可
  - clicking group 名 → `/groups` にリンク
- **MIRROR**: `src/components/auth/AuthBadge.tsx:34-75`（bedge 構造）
- **IMPORTS**: `useCurrentGroup`, shadcn `Select`（既存利用あり）, `getGroup` for name resolution（or cached via provider）
- **GOTCHA**: Provider に group name cache を持たせると便利。Phase 2.5 では簡易に `Promise.all` で gid → name を解決して state 管理
- **VALIDATE**: 2 つ以上の group 所属で切替が可能、切替後 `/tournaments` が再フェッチされる

### Task 21: Firestore Security Rules 書き換え
- **ACTION**: `firestore.rules` を全面刷新
- **IMPLEMENT**:
  ```
  rules_version = '2';
  service cloud.firestore {
    match /databases/{database}/documents {

      function isSignedIn() {
        return request.auth != null;
      }
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

      match /users/{uid} {
        allow read, write: if isSignedIn() && request.auth.uid == uid;
      }

      match /groups/{gid} {
        allow read: if isSignedIn()
                    && request.auth.uid in resource.data.memberUids;
        allow create: if isSignedIn()
                      && request.resource.data.ownerUid == request.auth.uid
                      && request.resource.data.memberUids.hasOnly([request.auth.uid])
                      && request.resource.data.memberUids.size() == 1;
        // owner: name / memberUids 自由編集（ただし ownerUid 不変）
        allow update: if (
          // owner case
          isSignedIn()
          && request.auth.uid == resource.data.ownerUid
          && request.resource.data.ownerUid == resource.data.ownerUid
        ) || (
          // self-add case（非メンバーが自分だけ追加）
          isSignedIn()
          && !(request.auth.uid in resource.data.memberUids)
          && request.auth.uid in request.resource.data.memberUids
          && request.resource.data.memberUids.size() == resource.data.memberUids.size() + 1
          && request.resource.data.memberUids.hasAll(resource.data.memberUids)
          && request.resource.data.ownerUid == resource.data.ownerUid
          && request.resource.data.name == resource.data.name
          && request.resource.data.createdAt == resource.data.createdAt
        ) || (
          // self-leave case（owner 以外のメンバーが自分を外す）
          isSignedIn()
          && request.auth.uid in resource.data.memberUids
          && request.auth.uid != resource.data.ownerUid
          && !(request.auth.uid in request.resource.data.memberUids)
          && request.resource.data.memberUids.size() == resource.data.memberUids.size() - 1
          && resource.data.memberUids.hasAll(request.resource.data.memberUids)
          && request.resource.data.ownerUid == resource.data.ownerUid
          && request.resource.data.name == resource.data.name
          && request.resource.data.createdAt == resource.data.createdAt
        );
        allow delete: if isSignedIn() && request.auth.uid == resource.data.ownerUid;
      }

      match /groupJoinCodes/{code} {
        allow read: if isSignedIn();
        allow create: if isSignedIn()
                      && request.resource.data.createdByUid == request.auth.uid
                      && request.resource.data.usesCount == 0
                      && isGroupMember(request.resource.data.gid);
        // consume: usesCount のみ +1、expires 未到達、maxUses 未超過
        allow update: if isSignedIn()
                      && request.resource.data.gid == resource.data.gid
                      && request.resource.data.createdByUid == resource.data.createdByUid
                      && request.resource.data.expiresAt == resource.data.expiresAt
                      && request.resource.data.maxUses == resource.data.maxUses
                      && request.resource.data.createdAt == resource.data.createdAt
                      && request.resource.data.usesCount == resource.data.usesCount + 1
                      && resource.data.expiresAt.toMillis() > request.time.toMillis()
                      && (resource.data.maxUses == null
                          || request.resource.data.usesCount <= resource.data.maxUses);
        allow delete: if isSignedIn()
                      && isGroupOwner(resource.data.gid);
      }

      match /structures/{sid} {
        allow read, update, delete: if isGroupMember(resource.data.groupId);
        allow create: if isSignedIn()
                      && request.resource.data.createdByUid == request.auth.uid
                      && isGroupMember(request.resource.data.groupId);
      }

      match /tournaments/{tid} {
        allow read: if isSignedIn(); // 参加者閲覧許可（既存踏襲）
        allow create: if isSignedIn()
                      && request.resource.data.createdByUid == request.auth.uid
                      && isGroupMember(request.resource.data.groupId);
        allow update, delete: if isGroupMember(resource.data.groupId);

        match /players/{pid} {
          allow read: if isSignedIn();
          allow create: if isSignedIn()
                        && pid == request.auth.uid
                        && request.resource.data.uid == request.auth.uid
                        && request.resource.data.isBusted == false;
          allow update: if isSignedIn()
                        && pid == request.auth.uid
                        && resource.data.uid == request.auth.uid
                        && request.resource.data.uid == resource.data.uid
                        && request.resource.data.isBusted == resource.data.isBusted
                        && request.resource.data.entryAt == resource.data.entryAt
                        && request.resource.data.bustedAt == resource.data.bustedAt;
          allow delete: if isSignedIn() && (
            pid == request.auth.uid
            || (
              exists(/databases/$(database)/documents/tournaments/$(tid))
              && isGroupMember(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
            )
          );
        }

        match /{sub=**} {
          allow read: if isSignedIn();
          allow write: if isGroupMember(
            get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId
          );
        }
      }
    }
  }
  ```
- **MIRROR**: `firestore.rules:1-67` を現行形の構造／コメント粒度で踏襲
- **IMPORTS**: n/a
- **GOTCHA**:
  - rule の list 評価は各 doc read を独立にする。`listStructuresByGroup` は `where("groupId","==")` + rule で member 判定が成立する組合せで OK
  - `get()` 10 回上限に注意。`{sub=**}` の write で 2 段 get になるが 1 pass に収まる
  - `request.resource.data.memberUids.hasOnly([x])` は `hasOnly` の仕様的に「集合として x のみ含む」。ドキュメント要確認（`hasOnly` = 他要素が無いこと）
- **VALIDATE**: Firebase Emulator でテストするのが理想だが、本 Phase は手動テスト許容。最低限 `firebase deploy --only firestore:rules` で syntax error が無いこと + 代表的な操作が通ること/弾かれること

### Task 22: `receipt.ts` の内部コメント整合化
- **ACTION**: `src/lib/services/receipt.ts` を更新
- **IMPLEMENT**: `cancelPlayerEntry` 等のコメントに「rule 側では group メンバー判定」と記す。API 変更なし。`startTournament` / `deleteTournamentIfSetup` 呼出の引数変更には追従
- **MIRROR**: 既存 receipt パターン
- **IMPORTS**: 変更なし
- **GOTCHA**: 既存 receipt.test.ts が `makeTournament` fixture に `ownerUid` を持つので、groupId+createdByUid 版に置換
- **VALIDATE**: `npm test -- receipt` green

### Task 23: テスト追加／更新
- **ACTION**:
  - `src/lib/firebase/schemas/index.test.ts`: group / groupJoinCode / structure / tournament の fixture を groupId ベースに書き換え + group 系 parse test 追加
  - `src/lib/services/group.test.ts`: consumeJoinCode（expired / maxUses / happy path）、leaveGroup（owner cannot leave）、createGroupWithOwner の mock 検証
  - `src/lib/services/current-group.test.tsx`: Provider で user 変更時の state リセット、drift 除外、localStorage 永続化
- **IMPLEMENT**:
  - mock 構成は `src/lib/services/receipt.test.ts` の `vi.hoisted` パターン踏襲
  - transaction の mock は `vi.mocked(runTransaction).mockImplementation(async (_db, updateFn) => updateFn(mockTx))` 形
- **MIRROR**: `src/lib/services/receipt.test.ts:1-227`
- **IMPORTS**: `vi, describe, it, expect, beforeEach` from `vitest`
- **GOTCHA**: current-group.test.tsx は `@testing-library/react` の `render` + `act` を使う。`localStorage` は `jsdom` 環境で既に存在
- **VALIDATE**: `npm test` 全 green

### Task 24: README 更新
- **ACTION**: `README.md` を更新
- **IMPLEMENT**:
  - 「group（サークル）運用」セクション追加: 新規登録 → group 作成 → 招待コード → 運営者加入 → structure / tournament 作成 の流れ
  - 「Phase 2.5 移行手順（破壊的）」小節: Firebase Console から旧 structures / tournaments を手動削除する旨と手順を箇条書き
  - 「現在のグループ」概念と `localStorage.allinpt.currentGroupId` の説明（デバッグ用）
- **MIRROR**: Phase 2 で追加されたであろう README のセクション構成（要現物確認）
- **IMPORTS**: n/a
- **GOTCHA**: MIT ライセンス／`.env.local` 記述は既存のまま
- **VALIDATE**: 目次の整合、コマンドの typo チェック

### Task 25: 動作確認（手動 E2E）
- **ACTION**: 実機 / dev server で以下を順に確認
- **IMPLEMENT**:
  1. `npm run dev`
  2. 匿名 Google 以外で 2 アカウントを準備（ユーザー A / ユーザー B）
  3. A: `/login` → `/groups` → empty 表示 → 新規作成 → `/groups/[gid]` → 招待コード発行 → リンクコピー
  4. B: 別ブラウザで `/login` → コピーしたリンクを貼付 → `/groups/join/[code]` → 加入成功 → `/groups/[gid]` が閲覧可能
  5. A: `/structures/new` で structure を作成
  6. B: `/structures` に A 作成の structure が表示される。編集／削除も可能
  7. A: `/tournaments/new` で tournament 作成
  8. B: `/tournaments/[tid]` で「開始」ボタンを押せる、Dashboard が編集可能
  9. B: `/groups/[gid]` で脱退 → `/tournaments` にアクセス → 見られなくなる（rule で permission-denied）
- **VALIDATE**: 上記全シナリオ green

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
|---|---|---|---|
| `groupBodySchema.safeParse` | `{ name:"A", ownerUid:"u1", memberUids:["u1"], createdAt: ts }` | success | no |
| `groupBodySchema.safeParse` | `{ memberUids: [] }` ほか | fail | yes（空配列） |
| `groupJoinCodeBodySchema.safeParse` | `{ gid, createdByUid, expiresAt:ts, maxUses: null, usesCount: 0, createdAt: ts }` | success | no |
| `groupJoinCodeBodySchema.safeParse` | `{ usesCount: -1 }` | fail | yes |
| `structureBodySchema` fixture 移行 | `{ groupId, createdByUid, ... }` | success | no |
| `consumeJoinCode` happy | 有効 code | memberUids 追加／ usesCount + 1 | no |
| `consumeJoinCode` expired | `expiresAt < now` の code | `AppError("group/invalid-code")` | yes |
| `consumeJoinCode` maxUses 到達 | `usesCount >= maxUses` | `AppError("group/invalid-code")` | yes |
| `consumeJoinCode` 既メンバー | `memberUids.includes(uid)` | 冪等完了（no-op, not throw） | yes |
| `leaveGroup` owner | `ownerUid === uid` | `AppError("group/owner-cannot-leave")` | yes |
| `createGroupWithOwner` | `{ name:"A", ownerUid:"u1" }` | `gid` 返却、`addGroupIdToUser(u1, gid)` 呼出 | no |
| GroupProvider 初期化 | user null → user あり | groupIds が profile から反映、localStorage の current 反映 | no |
| GroupProvider drift | getGroup rejected の gid | state から除外＋ `removeGroupIdFromUser` 呼出 | yes |
| `zodConverter` で `groups` malformed | `{ ownerUid 欠落 }` | `AppError("firestore/invalid-data")` | yes |

### Edge Cases Checklist
- [ ] 招待コードの期限切れ（client tolerance）／ rule 側での拒否
- [ ] 招待コードの二重消費（usesCount maxUses 到達）
- [ ] 既メンバーが `/groups/join/[code]` を踏む（冪等）
- [ ] owner が自分を `leaveGroup` しようとする（禁止）
- [ ] group 削除時に残る structures / tournaments（本 Phase は UI 側で prompt のみ）
- [ ] groupIds 空状態で `/tournaments` アクセス（`/groups?empty=1` にリダイレクト）
- [ ] localStorage の currentGroupId が groupIds に含まれない場合（auto-clear）
- [ ] SSR 時 `localStorage` 未定義（ガード）
- [ ] Firestore rule で非メンバーの read を拒否（permission-denied を UI で表示）
- [ ] 同 group に別端末で同時加入（transaction / arrayUnion で冪等）

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
EXPECT: No lint errors（Phase 1-2 の禁止事項：`console.*`／`throw new Error()`）

### Unit Tests
```bash
npm test
```
EXPECT: All tests pass, coverage 不降

### Browser Validation
```bash
npm run dev
```
EXPECT: Task 25 の手動 E2E 全シナリオ green

### Firebase Rules Deploy（本番）
```bash
firebase deploy --only firestore:rules
```
EXPECT: syntax error なし。Console の rules simulator で `groups/{gid}` read / update / delete と `groupJoinCodes` consume が期待通りに許可／拒否される

### Manual Validation
- [ ] 既存 structures / tournaments の手動削除が Firestore Console で完了している
- [ ] 匿名ユーザーでは `/groups/new` が弾かれる（rule で）
- [ ] 2 アカウントで相互共有シナリオ（Task 25）完走
- [ ] group 切替で `/structures` / `/tournaments` の一覧が入れ替わる
- [ ] 脱退後、元 group の tournament に read アクセスすると permission-denied（UI エラー表示）

---

## Acceptance Criteria
- [ ] PRD Phase 2.5 Success signal: **運営者 2 人が同じ group に所属した状態で、片方が作った structure / tournament をもう片方が編集・使用できる**
- [ ] `groups/{gid}` / `groupJoinCodes/{code}` / `users/{uid}.groupIds` が zod schema で検証される
- [ ] `structures` / `tournaments` が groupId + createdByUid ベースで動作
- [ ] Firestore Rules が group メンバーシップに基づいて deny-by-default で守られる
- [ ] All validation commands pass
- [ ] Tests written and passing
- [ ] No type errors / lint errors
- [ ] UX design matches（After 図）

## Completion Checklist
- [ ] Code follows discovered patterns（repositories 層 / zodConverter / AppError / logger）
- [ ] Error handling matches codebase style（`AppError.from` + `logger.warn`）
- [ ] Logging follows codebase conventions（`logger` 経由のみ）
- [ ] Tests follow test patterns（Vitest + `vi.hoisted` + `vi.mock`）
- [ ] No hardcoded values（招待コード長・期限 default も定数化）
- [ ] README updated（group 運用セクション）
- [ ] 破壊的移行手順が README に明記
- [ ] No unnecessary scope additions（ロール／カスケード／メール招待は範囲外を厳守）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Firestore rules の list 評価で member クエリが拒否される | M | 一覧が空で表示される | ルール本番デプロイ前に `firebase emulators:exec` で `where("groupId","==")` + `allow read` の組合せを確認。`users/{uid}.groupIds` 逆引きをフォールバックに |
| group 削除後の structures / tournaments の孤児化 | H | 手動でしか消せない／rule で read 不可になるため UI から発見できない | UI の削除 dialog で「先に配下の structure / tournament を消してください」と明記。Phase 3 以降で onDelete 連鎖を検討 |
| 招待コード流出 | M | 部外者が group に入れる | expiresAt default 7 日／`maxUses` nullable で絞れる／owner が都度 delete できる |
| 2 段 get() で rule の read quota 消費増 | L | 日次 50K 読上限への影響 | 20 人 × 月 1-2 回では無視可能。Phase 3 / 4 でホットパスが発生したら再評価 |
| 破壊的変更のロールバック | M | 既存テストデータ損失 | Phase 2.5 開始前に既存 Firestore のバックアップ（Console から export）を確認。作業自体は revert 可能 |
| `GroupProvider` 内の `users/{uid}` ポーリングで無限ループ | L | dev server が重くなる | Provider は `onSnapshot` ではなく手動 refresh。useEffect 依存配列を uid だけに絞る |
| Firestore `serverTimestamp()` を transaction 内で使用時の未解決値 | L | `expiresAt` の比較誤り | 期限系は `Timestamp.fromDate(new Date(...))` で固定、`createdAt` のみ `serverTimestamp()` |
| `hasOnly([x])` / `hasAll` 等の配列 rule 構文の仕様差異 | L | rule のデプロイ失敗 | rules simulator で事前検証。`size()` + `hasAll` の 2 段チェックに分割して単純化 |

## Notes

- PRD Decisions Log の「Phase 2.5 の既存データ互換＝破壊的変更」方針を厳守。互換レイヤ（`groupId` optional など）は作らない。
- 本 Phase 完了後の Phase 3（Timer）／Phase 4（Seating）は、本 Phase で確立した `isGroupMember` / `isGroupOwner` rule helper の上に乗る前提で設計する。
- 招待コード文字列は URL パスセグメントに乗るため URL-safe（a-z0-9）に限定。`crypto.getRandomValues` + base36 で十分。
- 将来拡張のフック: `groups/{gid}.roles` に admin/editor を入れる／`group/tournament/owner-transfer` サービス／group 単位の archived フラグ。本 Phase では導入しない。
- PRD の Implementation Phases 表で Phase 2.5 の行の `Status: pending` を `in-progress` に、`PRP Plan` 欄に本ファイルへのリンクを設定すること（Phase 6 output 指示）。
