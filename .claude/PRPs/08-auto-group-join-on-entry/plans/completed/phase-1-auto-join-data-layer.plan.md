# Plan: Phase 1 — 自動所属 データ層

## Summary

トーナメント受付（`tournaments/{tid}/players/{uid}` の存在）を **サークル加入の消費証明**として使う基盤を、Firestore Security Rules・zod schema・repository・service の 4 層で確立する。招待コードの `hasValidJoinCodeConsumption(gid, code)` と対になる `hasTournamentEntryProof(gid, tid)` ヘルパーを新設し、`groups/{gid}` の `allow update` に **第 2 の self-add ブランチ**を additive 追加する。UI 接続（受付フローへの結線）は Phase 2 の担当で、本 Phase はデータ層のみ。

## User Story

As a **小規模サークルの参加メンバー**,
I want **トーナメント受付を済ませただけでサークルメンバーになれる仕組み**,
So that **サークル加入 QR の読み忘れでシーズン戦績から漏れることがなくなる**.

## Problem → Solution

**現状**: `groups/{gid}` への self-add 経路は招待コード（`hasValidJoinCodeConsumption`）ただ 1 つ。受付フロー（`receipt.ts`）は `players/{uid}` を作るだけで `groups/{gid}` に一切触れない。2 導線が構造的に分離しているため、QR を 2 枚読ませる運用になり、2 枚目が忘れられる。

**あるべき姿**: 通常アカウント（Google / メール＋PW）が、自分の player doc の存在を根拠に `groups/{gid}` へ `member` ロールで self-add できる。rule 側が「その tid が本当にこの gid のもので、受付可能 state で、かつ自分の player doc が実在する」ことを atomic に検証する。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md)
- **PRD Phase**: Phase 1「自動所属 データ層」
- **Estimated Files**: 15（新規 3 / 更新 12）

---

## UX Design

### Before / After

**N/A — 内部（データ層）変更**。本 Phase では UI から呼ばれる経路を追加しない。ユーザーに見える変化は Phase 2（`receipt.ts` への結線 + 受付完了画面のフィードバック）で発生する。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| `groups/{gid}` の書込経路 | owner-update / self-add(招待コード) / self-leave / self-key displayName / organizer 単独フィールド × 7 / owner 単独フィールド × 2 | 上記 ＋ **self-add(トーナメント受付)** | rule ブランチが 1 つ増える。既存ブランチは無変更 |
| `groups/{gid}` の schema | 12 フィールド + `joinCodeId` / `latestJoinCodeId` | ＋ `joinedViaTournamentId`（nullable / default null） | additive。旧 doc は `null` で hydrate |
| service API | `consumeJoinCode({ code, uid })` のみ | ＋ `joinGroupViaTournament({ tid, gid, uid, displayName })` | Phase 2 が `receipt.ts` から消費する |

---

## Mandatory Reading

実装前に必ず読むファイル。

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [firestore.rules](../../../../firestore.rules) | 47-62, 85-124 | `hasValidJoinCodeConsumption` と既存 self-add ブランチ。新ブランチはこの構造を 1:1 でミラーする |
| P0 | [firestore.rules](../../../../firestore.rules) | 5-45 | `isSignedIn` / `isSignedInNotAnon` / `isGroupMember` 等の既存 helper 群。新 helper はこの直後に置く |
| P0 | [firestore.rules](../../../../firestore.rules) | 556-589 | `players/{pid}` `allow create` の 4 state リテラル。同期対象 |
| P0 | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 124-227 | `groupBodySchema`。`latestJoinCodeId`(140) が additive 追加の最新先例 |
| P0 | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 91-172 | `consumeJoinCode`。membership 判定 / displayName 解決 / consumption proof 書込のパターン源 |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 179-227, 290-310 | `removeMemberSelf` / `setMemberDisplayName` / `updateLatestJoinCodeId`。新 repository 関数の型 |
| P1 | [scripts/test-rules-proxy-create.mjs](../../../../scripts/test-rules-proxy-create.mjs) | all | emulator validator の最新雛形（REST + HTTP status 判定）。新 validator はこれをベースにする |
| P1 | [scripts/test-rules-latest-join-code.mjs](../../../../scripts/test-rules-latest-join-code.mjs) | 133-216 | `groups/{gid}` 対象の allow/deny ケース構成の先例 |
| P1 | [scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs) | 117-140, 195-240 | `minOccurrences` による drift 削除検出。memberDisplayNames の期待出現数を 2 → 3 に更新する |
| P1 | [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | 1-200 | mock 境界 / `makeGroup` fixture factory のパターン |
| P1 | [src/lib/errors.ts](../../../../src/lib/errors.ts) | all | `AppError` / `getErrorCode` / `assertNonEmptyString` |
| P1 | [src/lib/firebase/wrap.ts](../../../../src/lib/firebase/wrap.ts) | all | `wrapFirestoreWrite` / `wrapFirestoreRead` |
| P2 | [src/lib/services/proxy-receipt.ts](../../../../src/lib/services/proxy-receipt.ts) | all | 「Phase 1 で service だけ作り Phase 2 で UI が消費する」先例 |
| P2 | [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | 192-209 | `isAcceptingProxyEntry` の DRIFT WARNING コメント。新 rule リテラルも同じ注記対象になる |
| P2 | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | all | データモデル / 権限マトリクス / 既知のセキュリティリスクの更新先 |
| P2 | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | `groups/{gid}` allowed-keys 一覧の節 | 新ブランチの行を追加する表 |

## External Documentation

**外部調査は不要** — 既存の内部パターン（`hasValidJoinCodeConsumption` の consumption proof 設計、`wrapFirestoreWrite`、emulator REST validator）だけで完結する。Firestore Rules の `exists()` / `get()` / `diff().affectedKeys().hasOnly()` はすべて本リポジトリ内に先例がある。

---

## Patterns to Mirror

### RULE_HELPER（consumption proof ヘルパー）

```
// SOURCE: firestore.rules:53-62
function hasValidJoinCodeConsumption(gid, code) {
  return exists(/databases/$(database)/documents/groupJoinCodes/$(code))
         && get(/databases/$(database)/documents/groupJoinCodes/$(code)).data.gid == gid
         && get(/databases/$(database)/documents/groupJoinCodes/$(code)).data.expiresAt.toMillis() > request.time.toMillis()
         && getAfter(/databases/$(database)/documents/groupJoinCodes/$(code)).data.usesCount
            == get(/databases/$(database)/documents/groupJoinCodes/$(code)).data.usesCount + 1
         && ...;
}
```

要点: **`exists()` ガードを必ず `get()` の前に置く**（外部 doc 参照規約）。gid 一致検証を必ず含める。

### RULE_SELF_ADD_BRANCH（不変条件の並べ方）

```
// SOURCE: firestore.rules:102-123
isSignedIn()
&& request.resource.data.diff(resource.data).affectedKeys()
     .hasOnly(['memberUids', 'organizerUids', 'joinCodeId', 'memberDisplayNames'])
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
&& request.resource.data.joinCodeId is string
&& hasValidJoinCodeConsumption(gid, request.resource.data.joinCodeId)
&& request.resource.data.get('memberDisplayNames', {})
     .diff(resource.data.get('memberDisplayNames', {}))
     .affectedKeys()
     .hasOnly([request.auth.uid])
&& request.resource.data.memberDisplayNames[request.auth.uid] is string
&& request.resource.data.memberDisplayNames[request.auth.uid].size() >= 1
&& request.resource.data.memberDisplayNames[request.auth.uid].size() <= 15
```

要点: `affectedKeys().hasOnly` を**先頭に置く**（他フィールド汚染を最初に閉じる）。`memberUids` の増分は「厳密に +1 かつ既存を全包含」で表現する。

### SCHEMA_ADDITIVE_FIELD

```ts
// SOURCE: src/lib/firebase/schemas/group.ts:135-140
// dryrun-feedback-batch-1 (Phase C.1): `generateJoinCode` が「最新発行コード」へのポインタ
//   として管理する。... 旧 doc（Phase E 以前）はフィールド不在のため default(null) で hydrate される。
latestJoinCodeId: z.string().min(1).nullable().default(null),
```

要点: `.nullable().default(null)` で旧 doc 互換。JSDoc に「どの経路が書くか」「旧 doc の扱い」を必ず書く。

### REPOSITORY_PATTERN（self 書込 + wrap）

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:201-227
export async function setMemberDisplayName(
  gid: string,
  uid: string,
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名が空です", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(
      `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "メンバー表示名の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        [`memberDisplayNames.${uid}`]: trimmed,
      });
    },
    { gid, uid },
  );
  logger.info("group member displayName set ok", { gid, uid });
}
```

要点: 成功ログ（`logger.info`）は wrap の**外**。失敗ログは wrap が担当（二重 warn 禁止）。

### SERVICE_PATTERN（membership 判定 + displayName 解決 + 消費証明書込）

```ts
// SOURCE: src/lib/services/group.ts:125-171
// 既メンバー判定は users/{uid}.groupIds（自分自身の doc、常に read 可）で行う。
// groups/{gid} の read は memberUids に含まれるユーザーにしか許されないため、
// 加入前のユーザーで getGroup を呼ぶと firestore/permission-denied になる。
const profile = await getUserProfile(uid);
if (profile?.groupIds?.includes(codeDoc.gid)) { ... return { alreadyMember: true }; }

// Phase 4.7: 自分の表示名を group.memberDisplayNames に同時登録する。
//   email をフォールバックにすると PII がメンバー全員に露出するため、
//   auth.displayName → users/{uid}.displayName → uid の順で解決する。
const authUser = firebaseAuth.currentUser;
const selfDisplayName =
  authUser?.displayName?.trim() || profile?.displayName?.trim() || uid;

...
tx.update(groupRef, {
  memberUids: arrayUnion(uid),
  joinCodeId: code,
  [`memberDisplayNames.${uid}`]: selfDisplayName,
});
...
await addGroupIdToUser(uid, codeDoc.gid);
```

要点: **`arrayUnion` を使う**（加入前は group を read できないため、既存配列を知らずに +1 できる唯一の手段）。`email` にはフォールバックしない（PII）。

### ERROR_HANDLING（best-effort と code の使い分け）

```ts
// SOURCE: src/lib/services/group.ts:291-301（best-effort + getErrorCode）
if (prev && prev !== code) {
  try {
    await deleteJoinCode(prev);
  } catch (e) {
    logger.warn("previous join code delete failed", {
      errorCode: getErrorCode(e),
      gid,
      prev,
    });
  }
}
```

```ts
// SOURCE: src/lib/services/proxy-receipt.ts:76-86（入口の防御 + ドメインエラー）
assertNonEmptyString(tid, "tid");
assertNonEmptyString(organizerUid, "organizerUid");
...
if (!group.memberUids.includes(memberUid)) {
  throw new AppError("対象はサークルのメンバーではありません", "group/not-member");
}
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/group.test.ts:9-62（mock 境界は repository）
vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));
vi.mock("@/lib/firebase/repositories/groups", () => ({
  groupDocRef: vi.fn((gid: string) => ({ __ref: "groups", gid })),
  getGroup: vi.fn(),
  ...
}));
vi.mock("@/lib/firebase/repositories/users", () => ({
  addGroupIdToUser: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
  ...
}));
```

```ts
// SOURCE: src/lib/services/group.test.ts:135-165（fixture factory）
function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  ...
  return { id: "g1", name: "Saturday", ownerUids, ..., ...overrides };
}
```

### EMULATOR_VALIDATOR

```js
// SOURCE: scripts/test-rules-proxy-create.mjs:107-132
async function expectAllow(label, fn) {
  const r = await fn();
  if (r.ok) results.push({ label, status: "PASS (allow)" });
  else {
    const body = await r.text();
    results.push({ label, status: `FAIL (expected allow, got ${r.status}): ${body.slice(0, 200)}` });
  }
}
async function expectDeny(label, fn) {
  const r = await fn();
  if (r.status === 403) results.push({ label, status: "PASS (deny 403)" });
  else if (r.ok) results.push({ label, status: `FAIL (expected deny, got ${r.status})` });
  ...
}
```

要点: Firestore Web SDK の `updateDoc` は emulator 下で楽観 resolve することがあるため、**REST API + HTTP status で判定**する（既存 validator 全て同方針）。

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| [firestore.rules](../../../../firestore.rules) | UPDATE | `hasTournamentEntryProof(gid, tid)` helper ＋ 第 2 self-add ブランチを additive 追加 |
| [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | UPDATE | `joinedViaTournamentId` を additive 追加 |
| [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | UPDATE | `addSelfViaTournamentEntry` 追加 ＋ `createGroup` の seed に `joinedViaTournamentId: null` |
| `src/lib/services/auto-group-join.ts` | CREATE | `joinGroupViaTournament` service（membership probe → self-add → groupIds 更新） |
| `src/lib/services/auto-group-join.test.ts` | CREATE | service の unit test（9 ケース） |
| `scripts/test-rules-tournament-join.mjs` | CREATE | 専用 emulator validator（allow 3 / deny 10 / 非回帰 3） |
| [package.json](../../../../package.json) | UPDATE | `test:rules-tournament-join` script 追加 |
| [scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs) | UPDATE | memberDisplayNames drift check の `minOccurrences` を 2 → 3 |
| [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | UPDATE | `isAcceptingProxyEntry` の DRIFT WARNING に新 rule 経路を追記（コメントのみ） |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | UPDATE | データモデル / 権限マトリクス / 新節 / 既知のセキュリティリスク |
| [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | UPDATE | `groups/{gid}` allowed-keys 一覧に新ブランチ行 |
| [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | UPDATE | `makeGroup` fixture に `joinedViaTournamentId: null` |
| [src/lib/firebase/schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) | UPDATE | `GroupBody` fixture × 2 に同上 |
| [src/lib/hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) | UPDATE | `GroupDoc` fixture に同上 |
| [src/lib/services/account-delete.test.ts](../../../../src/lib/services/account-delete.test.ts) | UPDATE | `GroupDoc` fixture に同上 |
| [src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx) | UPDATE | `GroupDoc` fixture に同上 |

## NOT Building

- **`receipt.ts` への結線** — Phase 2。本 Phase では `joinGroupViaTournament` を export するだけで、呼び出し側は作らない（`proxy-receipt.ts` が Phase 1 で service のみ作った先例に倣う）。
- **受付完了画面のフィードバック UI / `GroupProvider` 即時反映** — Phase 2。
- **`/join/[tid]` の新規メール登録タブ** — Phase 3。
- **メンバー除名 service / UI** — Phase 4（rule 変更不要・本 Phase と完全独立）。
- **E2E spec** — Phase 2 で UI 経路が通ってから追加する。本 Phase の検証は unit test + emulator validator。
- **匿名ゲストの自動所属** — PRD で明示的に対象外。rule の `isSignedInNotAnon()` と service の `isAnonymous` ガードで二重に除外する。
- **`consumeJoinCode` の displayName フォールバックの修正** — 「Notes」の既知事項参照。本 Phase では触らない。
- **Cloud Functions 化** — 既存方針踏襲。

---

## Step-by-Step Tasks

### Task 1: `firestore.rules` に `hasTournamentEntryProof` helper を追加

- **ACTION**: `hasValidJoinCodeConsumption`（firestore.rules:53-62）の**直後**に新 helper を追加する。
- **IMPLEMENT**:

```
    // Phase 1 (08-auto-group-join-on-entry): トーナメント受付を「サークル加入の消費証明」として
    // 使うための検証 helper。招待コードの hasValidJoinCodeConsumption と対になる第 2 の proof。
    //
    // 検証内容:
    //   1. tournaments/{tid} が実在する（exists ガード — 外部 doc 参照規約）
    //   2. その tournament が本当にこの gid のもの（groupId == gid）
    //      — これが無いと、別サークルのトーナメントに受付した uid が任意 group に加入できる
    //   3. 受付可能 state（setup / seating / running / paused）
    //      — finished 済みトーナメントの過去参加者が後からいつでも加入できる経路を塞ぐ
    //   4. 自分の player doc（pid == auth.uid）が実在する = 受付済みである
    //      — 「名前だけ」代理受付 player は合成 pid のため本条件を満たさない（設計通り）
    //
    // ⚠ DRIFT WARNING: 受付可能 4 state リテラルは以下と**手動同期**する
    //   （Cloud Firestore Rules に const 機構がないためハードコード）:
    //   - src/lib/services/tournament-state.ts の `isAcceptingProxyEntry`
    //   - match /players/{pid} allow create の member-proxy / name-only ブランチ
    //
    // read コスト: exists + get（同一 rule 評価内で同一 path の get は cache される）+ exists で
    //   2〜3 read。加入時 1 回のみ発火し、既メンバーは service 側の probe で write 自体が起きない。
    function hasTournamentEntryProof(gid, tid) {
      return exists(/databases/$(database)/documents/tournaments/$(tid))
             && get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId == gid
             && get(/databases/$(database)/documents/tournaments/$(tid)).data.state
                  in ["setup", "seating", "running", "paused"]
             && exists(/databases/$(database)/documents/tournaments/$(tid)/players/$(request.auth.uid));
    }
```

- **MIRROR**: RULE_HELPER
- **IMPORTS**: なし（rules）
- **GOTCHA**:
  - `exists()` を `get()` の**前**に置く（firebase-patterns.md の外部 doc 参照規約）。順序を逆にすると存在しない doc の `get()` で rule 評価が失敗する。
  - `state in [...]` の判定に `.get('state', '')` は**使わない** — `state` は tournament schema の必須フィールドで、旧 doc も全て保持しているため直接参照でよい（既存 players create ブランチと同形）。
  - PRD Open Questions の「rule 側の受付可能 state ガードを入れるか」は **入れる**で確定。理由は上記コメント 3 の通り（終了済みトーナメントの過去参加者による無期限加入を塞ぐ）。代償として同期リテラルが 1 箇所増えるので DRIFT WARNING を必ず書く。
- **VALIDATE**: `npm run test:rules-tournament-join`（Task 8 で作成）のケース 5〜7 が deny になること。

### Task 2: `firestore.rules` に第 2 self-add ブランチを追加

- **ACTION**: `groups/{gid}` の `allow update` で、既存 self-add（招待コード / firestore.rules:92-124）の**直後**、self-leave（:124-）の**直前**に新ブランチを OR で挿入する。
- **IMPLEMENT**:

```
      ) || (
        // Phase 1 (08-auto-group-join-on-entry): self-add（トーナメント受付経由の自動所属）。
        //   招待コード self-add と**並列の第 2 経路**。consumption proof は
        //   `joinedViaTournamentId`（受付した tournament の tid）で、`hasTournamentEntryProof` が
        //   「その tid が本当にこの gid のもので、受付可能 state で、かつ自分の player doc が
        //   実在する」ことを atomic に検証する。
        //
        //   匿名ユーザーは isSignedInNotAnon() で除外する（メンバー一覧が使い捨てアカウントで
        //   汚染されるのを防ぐ）。UI 側でも `joinAsGuest` からは自動所属を呼ばない二重防御。
        //
        //   不変条件は招待コード self-add と**完全に同一の並び**にする:
        //     memberUids は自分 1 人だけ +1 / organizerUids・ownerUids・name・createdAt は不変 /
        //     memberDisplayNames の差分は自分のキーのみ・1〜15 文字。
        //   affectedKeys を 4 キーに限定することで、加入と同時に audioSettings /
        //   finishedTournamentCount / seasonPointsRule 等を改竄する経路を塞ぐ（Phase 4.16 の教訓）。
        isSignedInNotAnon()
        && request.resource.data.diff(resource.data).affectedKeys()
             .hasOnly(['memberUids', 'organizerUids', 'joinedViaTournamentId', 'memberDisplayNames'])
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
        && request.resource.data.joinedViaTournamentId is string
        && hasTournamentEntryProof(gid, request.resource.data.joinedViaTournamentId)
        && request.resource.data.get('memberDisplayNames', {})
             .diff(resource.data.get('memberDisplayNames', {}))
             .affectedKeys()
             .hasOnly([request.auth.uid])
        && request.resource.data.memberDisplayNames[request.auth.uid] is string
        && request.resource.data.memberDisplayNames[request.auth.uid].size() >= 1
        && request.resource.data.memberDisplayNames[request.auth.uid].size() <= 15
```

- **MIRROR**: RULE_SELF_ADD_BRANCH
- **IMPORTS**: なし
- **GOTCHA**:
  - `affectedKeys().hasOnly` に **`organizerUids` を含める**（招待コードブランチと同じ）。同時に `organizerUids == resource.data.organizerUids` も並べるので、実質「no-op 書込のみ許可」になり権限は増えない。ミラーの一貫性を優先する。
  - **`match /{sub=**}` のような wildcard は絶対に追加しない**（Phase 5.4 で発見した重大バグの再発防止。firebase-patterns.md の subcollection 設計原則）。
  - 既存 self-leave / self-key ブランチは**触らない**。両者とも `affectedKeys().hasOnly` が `joinedViaTournamentId` を含まないため、新フィールドは自動的に immutable になる（Phase 4.16 の設計が効く）。
  - `<= 15` のリテラルは `DISPLAY_NAME_MAX_LENGTH` と同期。Task 9 の drift check が出現数 3 を要求するようになる。
- **VALIDATE**: `npm run test:rules-tournament-join` 全 green ＋ `npm run test:rules-limits` green。

### Task 3: `schemas/group.ts` に `joinedViaTournamentId` を追加

- **ACTION**: `groupBodySchema` の `latestJoinCodeId`（:140）の直後にフィールドを追加する。
- **IMPLEMENT**:

```ts
    // Phase 1 (08-auto-group-join-on-entry): トーナメント受付経由の self-add で書き込まれる
    //   consumption proof。`joinCodeId`（招待コード経由の proof）と同じ役割で、rule 側の
    //   `hasTournamentEntryProof(gid, tid)` が「この tid が本当にこの gid のトーナメントで、
    //   受付可能 state で、かつ書込者の player doc が実在する」ことを検証する。
    //   最後に自動加入したメンバーの tid で上書きされるため**監査ログ用途には使えない**
    //   （`joinCodeId` と同じ性質）。owner はフルアクセス経由で自由に null 化してよい。
    //   旧 doc（本 Phase 以前）はフィールド不在のため default(null) で hydrate される。
    joinedViaTournamentId: z.string().min(1).nullable().default(null),
```

- **MIRROR**: SCHEMA_ADDITIVE_FIELD
- **IMPORTS**: 追加不要（`z` は既に import 済み）
- **GOTCHA**: `joinCodeId` は `.nullable().optional()` という旧形だが、**新規は `.nullable().default(null)`**（`latestJoinCodeId` / `seasonStartDate` と同じ最新形）を使う。`.optional()` にすると出力型が `string | null | undefined` になり、fixture / UI 側の扱いがぶれる。
- **VALIDATE**: `npm run typecheck` — この時点で fixture 6 箇所（Task 11）が型エラーになるのが正しい挙動。

### Task 4: `repositories/groups.ts` に `addSelfViaTournamentEntry` を追加

- **ACTION**: `setMemberDisplayName`（:227）の直後に新 repository 関数を追加し、`createGroup` の seed にも新フィールドを足す。
- **IMPLEMENT**:

```ts
/**
 * Phase 1 (08-auto-group-join-on-entry): トーナメント受付を消費証明とした self-add。
 *
 * 招待コード経由の `consumeJoinCode`（services/group.ts）と対になる書込経路で、
 * rule 側は `hasTournamentEntryProof(gid, joinedViaTournamentId)` を検証する。
 *
 *   - **`arrayUnion` 必須**: 加入前のユーザーは `groups/{gid}` を read できない
 *     （rule が memberUids 所属を要求）ため、既存配列を知らずに +1 できる唯一の手段。
 *     配列丸ごと上書きにすると他メンバーを消し飛ばす（かつ rule の hasAll で deny される）。
 *   - **displayName は 15 字以内必須**: rule が `size() <= 15` を強制するため、
 *     超過値を渡すと permission-denied になる。呼出側（service）で slice 済みの値を渡すこと。
 *     本関数でも防御的に再検証する（seasonStats で同じ罠を踏んだ先例）。
 *   - `runTransaction` は使わない: 招待コードと違い、同 request 内で +1 消費すべき
 *     外部 doc（`groupJoinCodes`）が存在しないため、単一 doc の updateDoc で足りる。
 */
export async function addSelfViaTournamentEntry(
  gid: string,
  uid: string,
  input: { tid: string; displayName: string },
): Promise<void> {
  const trimmed = input.displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名が空です", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(
      `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークルへの自動加入に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayUnion(uid),
        joinedViaTournamentId: input.tid,
        [`memberDisplayNames.${uid}`]: trimmed,
      });
    },
    { gid, uid, tid: input.tid },
  );
  logger.info("group self-add via tournament ok", { gid, uid, tid: input.tid });
}
```

`createGroup` の `addDoc` payload（:84-87 付近、`joinCodeId: null` の隣）に追加:

```ts
        // Phase 1 (08-auto-group-join-on-entry): 新規作成時は受付経由の加入なし。
        joinedViaTournamentId: null,
```

- **MIRROR**: REPOSITORY_PATTERN
- **IMPORTS**: `firebase/firestore` の import 文に **`arrayUnion` を追加**（現在 `arrayRemove` のみ）。`AppError` / `DISPLAY_NAME_MAX_LENGTH` / `wrapFirestoreWrite` / `logger` は既に import 済み。
- **GOTCHA**:
  - repository のエラーコードは firebase-patterns.md に従い **`firestore/write_failed`** のまま。ドメインコード `group/auto-join-failed` への写像は service 層（Task 5）で行う。ここで `group/...` を使うと規約から外れる。
  - `logger.info` は `wrapFirestoreWrite` の**外**に置く。
- **VALIDATE**: `npm run typecheck` / `npm run lint`。

### Task 5: `services/auto-group-join.ts` を新規作成

- **ACTION**: 新ファイルを作成し、`joinGroupViaTournament` を実装する。
- **IMPLEMENT**（全文）:

```ts
import { AppError, assertNonEmptyString, getErrorCode } from "@/lib/errors";
import { firebaseAuth } from "@/lib/firebase/client";
import {
  addSelfViaTournamentEntry,
  getGroup,
} from "@/lib/firebase/repositories/groups";
import {
  addGroupIdToUser,
  getUserProfile,
} from "@/lib/firebase/repositories/users";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

/**
 * Phase 1 (08-auto-group-join-on-entry): トーナメント受付を根拠としたサークル自動所属。
 *
 * `receipt.ts` の受付成功直後（player doc 作成後）に Phase 2 が呼び出す。
 * **呼出順序は「受付（player 作成）→ 本 service」を厳守**する。rule の
 * `hasTournamentEntryProof` が player doc の存在を前提にするため、逆順・並列だと必ず deny される。
 *
 * 本 service は throw する（best-effort 化は呼出側の責務）。PRD の設計方針上、
 * 受付そのものは自動所属の失敗で止めてはならないため、Phase 2 の callsite は
 * try/catch + logger.warn で握る。
 */

/**
 * - `joined`: 本呼出で `memberUids` に追加した
 * - `already-member`: 既にメンバーだった（no-op。`users/{uid}.groupIds` の補修だけ行う）
 * - `skipped-anonymous`: 匿名アカウントのため対象外（rule でも deny されるので事前に skip）
 */
export type AutoJoinOutcome = "joined" | "already-member" | "skipped-anonymous";

export type AutoJoinResult = {
  gid: string;
  outcome: AutoJoinOutcome;
};

/**
 * サークル内表示名を解決して 15 字に切り詰める。
 *
 * 解決順序は `consumeJoinCode` と同じ:
 *   hint（受付フォーム / 受付時に解決済みの名前）
 *     → Firebase Auth の displayName
 *     → users/{uid}.displayName
 *     → uid
 *
 * **email にはフォールバックしない**（`memberDisplayNames` は group メンバー全員に
 * read されるため、生 email が PII として露出する）。
 *
 * `slice(0, DISPLAY_NAME_MAX_LENGTH)` は必須 — Google の表示名は 15 字を超え得るが
 * rule は `size() <= 15` を強制するため、切り詰めないと permission-denied で
 * 自動所属が静かに失敗する（seasonStats で踏んだ罠と同型）。
 * Firebase の uid は 28 字なので、uid フォールバック時も切り詰めが効く。
 */
async function resolveMemberDisplayName(
  uid: string,
  hint: string | null | undefined,
): Promise<string> {
  const hintTrimmed = hint?.trim();
  if (hintTrimmed) return hintTrimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
  const authName = firebaseAuth.currentUser?.displayName?.trim();
  if (authName) return authName.slice(0, DISPLAY_NAME_MAX_LENGTH);
  const profile = await getUserProfile(uid);
  const profileName = profile?.displayName?.trim();
  if (profileName) return profileName.slice(0, DISPLAY_NAME_MAX_LENGTH);
  return uid.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * `groups/{gid}` の read 可否そのものをメンバーシップ判定に使う。
 *
 * rule が `memberUids` 所属を read の条件にしているため、
 *   - 成功 → メンバー確定（配列も併せて確認する）
 *   - 失敗（permission-denied 等）→ 非メンバーとして扱う
 * が成立する。`users/{uid}.groupIds` を見る `consumeJoinCode` 方式と違い、
 * **除名後に残る stale な groupIds に引きずられない**（再受付で自己修復する）。
 *
 * ネットワーク一時障害でも false を返すが、その場合は後続の self-add が
 * rule の `!(uid in resource.data.memberUids)` で deny され、再 probe で
 * `already-member` に倒れる（呼出側から見た挙動は変わらない）。
 */
async function probeMembership(gid: string, uid: string): Promise<boolean> {
  try {
    const group = await getGroup(gid);
    return group.memberUids.includes(uid);
  } catch (e) {
    logger.debug("auto-join membership probe treated as non-member", {
      gid,
      uid,
      errorCode: getErrorCode(e),
    });
    return false;
  }
}

export async function joinGroupViaTournament({
  tid,
  gid,
  uid,
  displayName,
}: {
  tid: string;
  gid: string;
  uid: string;
  displayName?: string | null;
}): Promise<AutoJoinResult> {
  assertNonEmptyString(tid, "tid");
  assertNonEmptyString(gid, "gid");
  assertNonEmptyString(uid, "uid");

  // 匿名アカウントは対象外（rule の isSignedInNotAnon() と二重防御）。
  // 端末を跨げず参加取消時に auth ごと削除される設計のため、メンバーとして永続させない。
  if (firebaseAuth.currentUser?.isAnonymous) {
    logger.info("auto-join skipped: anonymous account", { tid, gid, uid });
    return { gid, outcome: "skipped-anonymous" };
  }

  let outcome: AutoJoinOutcome = "already-member";

  if (!(await probeMembership(gid, uid))) {
    const memberDisplayName = await resolveMemberDisplayName(uid, displayName);
    try {
      await addSelfViaTournamentEntry(gid, uid, {
        tid,
        displayName: memberDisplayName,
      });
      outcome = "joined";
    } catch (e) {
      // 多端末・連打による同時 self-add では片方が rule の
      // `!(uid in resource.data.memberUids)` で deny される。再 probe して
      // 既にメンバーになっていれば成功扱いに倒す（ユーザーには成功として見せる）。
      if (await probeMembership(gid, uid)) {
        logger.info("auto-join lost the race but membership is established", {
          tid,
          gid,
          uid,
          errorCode: getErrorCode(e),
        });
        outcome = "already-member";
      } else {
        // repository の wrapFirestoreWrite が既に warn 済みのため、ここでは
        // 再ログせずドメインコードだけ被せて throw する（二重 warn 禁止）。
        throw new AppError(
          "サークルへの自動加入に失敗しました",
          "group/auto-join-failed",
          e,
        );
      }
    }
  }

  // `users/{uid}.groupIds` は逆引きキャッシュ（サイドバー / サークル一覧の描画元）。
  // **outcome によらず毎回 arrayUnion する**ことで、
  //   - 前回の自動所属で groupIds 更新だけ失敗していたケース
  //   - 除名後に stale だったケース
  // を次回受付で自己修復させる。冪等（arrayUnion）なので重複しない。
  // ここでの失敗は group メンバーシップ（真実源）の成否に影響しないため best-effort。
  try {
    await addGroupIdToUser(uid, gid);
  } catch (e) {
    logger.warn("auto-join: groupIds backfill failed", {
      code: "group/auto-join-groupids-failed",
      tid,
      gid,
      uid,
      errorCode: getErrorCode(e),
    });
  }

  logger.info("auto-join via tournament done", { tid, gid, uid, outcome });
  return { gid, outcome };
}
```

- **MIRROR**: SERVICE_PATTERN / ERROR_HANDLING
- **IMPORTS**: 上記コード冒頭のとおり。**`@/lib/services/group.ts` には置かない** — Phase 4（メンバー除名 service）が `group.ts` を編集するため、並行着手時のマージ競合を避ける（PRD の Parallelism Notes に従う）。
- **GOTCHA**:
  - `getGroup` の失敗を「非メンバー」と解釈するのは意図的な設計（PRD Decisions Log の「メンバーシップ判定」）。`AppError.code` は `firestore/read_failed` に正規化済みで `permission-denied` は `.cause` にしか残らないため、**code で分岐しない**。
  - `group/auto-join-failed` は `error-logging.md` に未登録のドメインコード。Task 10 でルールファイルに追記する。
  - `new AppError(..., e)` を使い `AppError.from` は使わない — `AppError.from` は既に `AppError` なら**素通し**するため、repository の `firestore/write_failed` がそのまま出てしまいドメインコードが被らない。
  - `logger.debug` は本番（Vercel）では出力されない設計（`logger.ts` の resolveLevel が既定 `info`）。probe 失敗は正常系（初回加入時は必ず失敗する）なので warn にしない。
- **VALIDATE**: Task 6 の unit test が全 green。

### Task 6: `services/auto-group-join.test.ts` を新規作成

- **ACTION**: unit test を 9 ケース書く。
- **IMPLEMENT**: mock 境界は repository（`repositories/groups` / `repositories/users`）と `firebase/client`。

```ts
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroup: vi.fn(),
  addSelfViaTournamentEntry: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/users", () => ({
  addGroupIdToUser: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
}));

import { AppError } from "@/lib/errors";
import {
  addSelfViaTournamentEntry,
  getGroup,
} from "@/lib/firebase/repositories/groups";
import {
  addGroupIdToUser,
  getUserProfile,
} from "@/lib/firebase/repositories/users";

import { joinGroupViaTournament } from "./auto-group-join";

// firebaseAuth.currentUser を差し替える helper（group.test.ts の先例と同形）
async function setCurrentUser(value: unknown) {
  const clientMock = await import("@/lib/firebase/client");
  Object.defineProperty(clientMock, "firebaseAuth", {
    configurable: true,
    value: { currentUser: value },
  });
}

const now = Timestamp.fromDate(new Date("2026-07-31T00:00:00Z"));

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc { /* group.test.ts の makeGroup を流用（joinedViaTournamentId: null を含める） */ }

// 想定ケース:
//  1. 既メンバー → self-add を呼ばず outcome="already-member"、groupIds は補修される
//  2. 非メンバー（probe が permission-denied 相当で reject）→ self-add 呼出 / outcome="joined"
//  3. 15 字超の displayName hint → slice(0,15) された値で self-add が呼ばれる
//  4. hint 未指定 → auth.displayName → profile.displayName → uid の順で解決される
//  5. 匿名 currentUser → outcome="skipped-anonymous"、self-add / groupIds 書込ともに発火しない
//  6. self-add 失敗だが再 probe でメンバー → throw せず outcome="already-member"（race 自己修復）
//  7. self-add 失敗 + 再 probe も非メンバー → group/auto-join-failed を throw
//  8. addGroupIdToUser 失敗 → throw せず outcome を返す（best-effort）
//  9. tid / gid / uid が空文字 → validation/empty-string で throw（書込は一切発火しない）
```

- **MIRROR**: TEST_STRUCTURE
- **IMPORTS**: 上記。
- **GOTCHA**:
  - ケース 2 の probe 失敗は `vi.mocked(getGroup).mockRejectedValue(new AppError("...", "firestore/read_failed"))` で作る。**`mockResolvedValue(null)` にはしない**（`getGroup` は not-found でも throw する契約）。
  - ケース 6 は `getGroup` を 1 回目 reject / 2 回目 resolve（メンバー入り）に切り替える（`mockRejectedValueOnce` → `mockResolvedValue`）。
  - `console.*` を直接 assert しない（testing.md）。ログ検証が必要なら `vi.spyOn(logger, "warn")`。
- **VALIDATE**: `npm test -- auto-group-join` が全 green。

### Task 7: `package.json` に npm script を追加

- **ACTION**: `test:rules-proxy-create` の隣（アルファベット順を維持する必要はない。既存の並びに合わせる）に追加する。
- **IMPLEMENT**:

```json
    "test:rules-tournament-join": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-tournament-join.mjs\"",
```

- **MIRROR**: `package.json:19`（`test:rules-proxy-create`）
- **GOTCHA**: `--only auth,firestore` を必ず付ける（storage は不要で起動が遅くなる）。project id は `allin-pokertimer-e2e` 固定。
- **VALIDATE**: `npm run test:rules-tournament-join` が起動すること。

### Task 8: `scripts/test-rules-tournament-join.mjs` を新規作成

- **ACTION**: `test-rules-proxy-create.mjs` を土台に、`groups/{gid}` の新 self-add ブランチを検証する validator を書く。
- **IMPLEMENT**: ヘッダー・`signUpOrIn` / `tv` / `fields` / `patchDoc` / `createDoc` / `expectAllow` / `expectDeny` はそのまま流用。追加で**匿名サインイン**の helper を書く:

```js
/**
 * 匿名ユーザーを作る。email/password を渡さない accounts:signUp が
 * signInAnonymously と同じ経路で、token の firebase.sign_in_provider は 'anonymous' になる。
 * rule の isSignedInNotAnon() が正しく効いているかの検証に使う。
 */
async function signUpAnonymous() {
  const r = await fetch(`${AUTH_BASE}/accounts:signUp?key=${API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`anon auth: ${JSON.stringify(j)}`);
  return { uid: j.localId, idToken: j.idToken };
}
```

seed 構成:

- `owner` / `member`（既メンバー）/ `newbie` / `newbie2` / `otherOwner` / `anon`
- `gid`: owner が create → `memberUids: [owner, member]` に expand（`memberDisplayNames` も同時）
- `otherGid`: otherOwner が create（別サークル）
- tournaments（すべて owner が create、`groupId: gid`）: `tidRunning`(running) / `tidFinished`(finished) / `tidOther`(otherGid・running)
- players: `newbie` / `newbie2` / `anon` が `tidRunning` に self-create（`pid == uid`）。`newbie` は `tidFinished` にも self-create。`newbie2` は `tidOther` にも self-create。

**注意**: PATCH は REST なので `arrayUnion` が使えない。`memberUids` は「既存配列 + 自分」の**完全な配列**を組み立てて送る（seed 時点の配列を script が把握しているので可能）。`memberDisplayNames` も既存 entry を含む完全な map を送る（rule の diff は自分のキーのみ変化していれば通る）。

検証ケース（allow 3 / deny 10 / 非回帰 3 = 16）:

| # | ケース | 期待 |
| --- | --- | --- |
| 1 | 通常アカウント（player doc あり・running）が memberUids+joinedViaTournamentId+memberDisplayNames を書く | allow |
| 2 | 別の通常アカウント（newbie2）が同 tid で加入 | allow |
| 3 | setup state の tournament 経由で加入 | allow |
| 4 | 匿名アカウント（player doc あり）が同じ書込 | **deny**（`isSignedInNotAnon`） |
| 5 | player doc を持たないユーザーが加入 | **deny**（proof なし） |
| 6 | 別サークル（otherGid）の tid を proof に使う | **deny**（`groupId == gid` 違反） |
| 7 | 存在しない tid を proof に使う | **deny**（`exists` 違反） |
| 8 | finished tournament の tid を proof に使う（過去参加者・player doc あり） | **deny**（state ガード） |
| 9 | 加入と同時に `organizerUids` へ自分を追加 | **deny**（昇格阻止） |
| 10 | 加入と同時に `name` を書換 | **deny**（`affectedKeys`） |
| 11 | 加入と同時に `finishedTournamentCount` を書換 | **deny**（`affectedKeys`） |
| 12 | `memberDisplayNames` に 16 字を書く | **deny**（`size() <= 15`） |
| 13 | `memberDisplayNames` に他人のキーを書く | **deny**（self-key 限定） |
| 14 | 既メンバー（member）が同じ書込を行う | **deny**（`!(uid in resource.data.memberUids)`） |
| 15 | 非回帰: `joinedViaTournamentId` 抜きで memberUids だけ +1（proof なしの素の加入） | **deny** |
| 16 | 非回帰: 既メンバーの self-key displayName 更新（既存ブランチ）が引き続き動く | allow |

- **MIRROR**: EMULATOR_VALIDATOR
- **GOTCHA**:
  - ケース 1 が allow になった後は `newbie` が既メンバーになるため、**後続ケースの実行順序に注意**。ケース 14 は `member`（seed 時点からのメンバー）を使うので影響なし。ケース 9〜13 は `newbie2` ではなく専用の追加ユーザー（`newbie3`〜）を使うか、**ケース 9〜15 を先に実行してからケース 1〜3 の allow を実行**する構成にする。**推奨: deny ケースを先に、allow ケースを後に並べる**（deny は状態を変えないため順序自由、allow は状態を変える）。
  - group seed の `createDoc` payload には `joinedViaTournamentId: null` / `latestJoinCodeId: null` を含める（schema と揃える。rule 自体は必須にしないが、実データと乖離させない）。
  - tournament seed の `state` は `tournamentSeed()`（proxy-create の関数をそのまま流用）で切り替える。
  - `expectDeny` は 403 のみ PASS。404 や 400 が返る場合は seed の不備なので FAIL として扱う（既存 helper の挙動どおり）。
- **VALIDATE**: `npm run test:rules-tournament-join` → `ALL GREEN` / exit 0。

### Task 9: `scripts/test-rules-limits.mjs` の drift check を更新

- **ACTION**: memberDisplayNames の `minOccurrences` を 2 → 3 に上げ、コメントを更新する。
- **IMPLEMENT**:

```js
  {
    label: "groups.memberDisplayNames[uid] upper bound (<= DISPLAY_NAME_MAX_LENGTH)",
    pattern: /memberDisplayNames\[request\.auth\.uid\]\.size\(\)\s*<=\s*(\d+)/g,
    expected: EXPECTED.DISPLAY_NAME_MAX_LENGTH,
    // self-add(招待コード) / self-add(トーナメント受付) / self-key update の 3 箇所
    // （3 つ目は 08-auto-group-join-on-entry Phase 1 で追加）
    minOccurrences: 3,
  },
```

同ファイル冒頭のヘッダーコメント（:14-18 の「displayName 上限（<= DISPLAY_NAME_MAX_LENGTH）: 3 経路」の内訳）も「4 経路」に更新する。

- **MIRROR**: `scripts/test-rules-limits.mjs:121-126`
- **GOTCHA**: `collectMatches` は「全 match の値が同一」も検証するため、新ブランチで誤って `<= 20` などと書くと `multiple distinct values found` で FAIL する（意図どおり）。
- **VALIDATE**: `npm run test:rules-limits` → `ALL GREEN`。

### Task 10: ドキュメント（rules ファイル）を更新

- **ACTION**: 3 ファイルを更新する。
- **IMPLEMENT**:

**(a) [.claude/rules/group-membership.md](../../../rules/group-membership.md)**

1. 「データモデル」の `groups/{gid}` フィールド列挙に `joinedViaTournamentId` を追加し、下位の箇条書きに説明を追加:

```md
  - `joinedViaTournamentId`（08-auto-group-join-on-entry Phase 1 追加・default null）:
    トーナメント受付を消費証明とした self-add で書き込まれる tid。`joinCodeId`（招待コードの
    consumption proof）と同じ役割・同じ性質（**最後の加入者の値で上書きされるため監査ログ用途には
    使えない**）。書込経路は `joinGroupViaTournament`（services/auto-group-join.ts）→
    `addSelfViaTournamentEntry`（repositories/groups.ts）の 1 系統のみ。
    旧 doc はフィールド不在のため `default(null)` で hydrate される。
```

2. 「招待コードの rule 側検証（Phase 4.6.1）」の直後に新節を追加:

```md
### トーナメント受付による self-add の rule 側検証（08-auto-group-join-on-entry Phase 1）

`groups/{gid}` の self-add には**第 2 の経路**がある。トーナメント受付そのものを
消費証明として使い、招待コードなしで member として自己加入する経路:

1. 書込者が**通常アカウント**であること（`isSignedInNotAnon()` — 匿名は deny）
2. ペイロードに `joinedViaTournamentId: <tid>` が含まれること（`is string`）
3. `tournaments/{tid}` が存在し、`groupId` が現在の group と一致
4. `tournaments/{tid}.state` が受付可能 4 state（`setup` / `seating` / `running` / `paused`）
5. `tournaments/{tid}/players/{auth.uid}` が存在する（= 受付済み）
6. `affectedKeys().hasOnly(['memberUids','organizerUids','joinedViaTournamentId','memberDisplayNames'])`
   ＋ 招待コード self-add と同一の不変条件（memberUids は +1 のみ / organizerUids・ownerUids・
   name・createdAt は不変 / memberDisplayNames は self-key のみ・1〜15 文字）

⚠ DRIFT WARNING: 受付可能 4 state リテラルは `isAcceptingProxyEntry`（tournament-state.ts）
および `players/{pid}` create の member-proxy / name-only ブランチと**手動同期**する。

emulator validation: [scripts/test-rules-tournament-join.mjs](../../scripts/test-rules-tournament-join.mjs)
（`npm run test:rules-tournament-join`）。
```

3. 「権限マトリクス」に行を追加:

```md
| トーナメント受付経由のサークル自動加入（通常アカウント） | ○ | ○ | ○（未所属者が member として加入） |
| 同上（匿名ゲスト） | - | - | ×（rule + service の二重防御で deny） |
```

4. 「既知のセキュリティリスク」に節を追加:

```md
### トーナメント QR の拡散による意図しないメンバー化（08-auto-group-join-on-entry Phase 1〜）

受付 QR（`/join/[tid]`）を知る通常アカウントは、受付するだけで当該サークルの member に
なれる。招待コードのような 129bit ランダム性は tid（base62 ≈ 117bit）にもあるが、
**QR を提示した場ではその場の全員が読み取れる**点が招待コードとの違い。

**緩和**: 「トーナメント QR はサークルに入れてよい相手にのみ提示する」運用前提を
ユーザーと合意済み（PRD の Users & Context / Decisions Log）。加えて rule 側で
受付可能 4 state に限定しているため、終了済みトーナメントの QR が後から拡散しても
加入経路にはならない。誤加入メンバーはオーナーの除名 UI（Phase 4）で事後回収する。
member ロールで加入するため、structures / tournaments への write 権限は付かない。
```

**(b) [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md)**

「`groups/{gid}` update の allowed-keys 一覧」の表に、self-add（招待コード加入）行の直下へ:

```md
| **self-add**（トーナメント受付加入） | 非メンバー + 通常アカウント + 有効な参加証明 | `memberUids` / `organizerUids` / `joinedViaTournamentId` / `memberDisplayNames` |
```

同節冒頭の「9 ブランチに分かれており」というブランチ数の記述も実数に合わせて更新する。

**(c) [.claude/rules/error-logging.md](../../../rules/error-logging.md)**

ドメインコード prefix の `group/*` の説明に、本 Phase で追加する `group/auto-join-failed` を例示として追記する（`seating/*` が Phase 別に列挙している形式に倣う）。

- **GOTCHA**: rules ファイルは frontmatter の適用範囲が真実源。**表 → schema → rule → test の順**で更新する規約（firebase-patterns.md）に沿い、実装後にドキュメントを後追いさせない。
- **VALIDATE**: 目視（markdown lint はなし）。リンク先パスが実在すること。

### Task 11: `isAcceptingProxyEntry` の DRIFT WARNING を更新

- **ACTION**: [tournament-state.ts:198-202](../../../../src/lib/services/tournament-state.ts) の DRIFT WARNING に、新しい同期対象を 1 行足す。
- **IMPLEMENT**:

```ts
 * ⚠ DRIFT WARNING: 本述語の許可 state 集合は `firestore.rules` の以下 2 箇所の
 *   `["setup", "seating", "running", "paused"]` リテラルと**手動同期**すること
 *   （Cloud Firestore Rules に const 機構がないためハードコード）:
 *   - `match /players/{pid}` `allow create` の member-proxy / name-only ブランチ
 *   - `hasTournamentEntryProof(gid, tid)`（08-auto-group-join-on-entry Phase 1 追加。
 *     トーナメント受付を消費証明とした `groups/{gid}` self-add で使う）
 *   state を増減する場合は上記すべてと本述語を同時更新する。
```

- **GOTCHA**: 関数の実装は**変更しない**（コメントのみ）。`tournament-state.test.ts` の characterization test は無変更で pass するはず。
- **VALIDATE**: `npm test -- tournament-state` が green のまま。

### Task 12: 既存 fixture 6 箇所に `joinedViaTournamentId: null` を追加

- **ACTION**: `GroupBody` / `GroupDoc` の完全な object literal を持つテスト fixture に新フィールドを足す。`latestJoinCodeId: null` の直後に置く。
- **IMPLEMENT**: 対象（`npm run typecheck` で全件検出できる）:
  - [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) — `makeGroup`
  - [src/lib/firebase/schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) — `baseGroup`（:915 付近）と もう 1 箇所（:957 付近）
  - [src/lib/hooks/useAudioPlayer.test.tsx](../../../../src/lib/hooks/useAudioPlayer.test.tsx) — group fixture（:94 付近）
  - [src/lib/services/account-delete.test.ts](../../../../src/lib/services/account-delete.test.ts) — group fixture（:73 付近）
  - [src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx) — group fixture（:53 付近）
- **MIRROR**: 各ファイルの既存 `latestJoinCodeId: null,` の行
- **GOTCHA**: `index.test.ts` の 2 箇所は `GroupBody` 型（`id` なし）、他は `GroupDoc` 型。どちらも新フィールドは必須になる（`.default(null)` は zod の**入力**を optional にするだけで、`z.infer` の出力型は required）。
- **VALIDATE**: `npm run typecheck` → 0 errors。

---

## Testing Strategy

### Unit Tests（`src/lib/services/auto-group-join.test.ts`）

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| 既メンバー no-op | `getGroup` が `memberUids: ["u1"]` を返す / uid=`u1` | `outcome: "already-member"` / `addSelfViaTournamentEntry` 未呼出 / `addGroupIdToUser` は呼出 | - |
| 初回加入 | `getGroup` が reject | `outcome: "joined"` / `addSelfViaTournamentEntry(gid, uid, { tid, displayName })` 呼出 | - |
| 15 字超 displayName | hint = 20 字の Google 名 | `addSelfViaTournamentEntry` に**15 字**の値が渡る | ✅ |
| displayName フォールバック | hint 未指定 / auth なし / profile あり | profile.displayName（15 字 slice）が渡る | ✅ |
| uid フォールバック | hint / auth / profile すべてなし | uid の先頭 15 字が渡る（rule の 1..15 を満たす） | ✅ |
| 匿名 skip | `currentUser.isAnonymous = true` | `outcome: "skipped-anonymous"` / 書込 0 件 | ✅ |
| 同時 self-add race | self-add reject → 再 probe でメンバー | throw せず `outcome: "already-member"` | ✅ |
| 恒久的な加入失敗 | self-add reject → 再 probe も非メンバー | `AppError` code=`group/auto-join-failed` を throw | ✅ |
| groupIds 補修失敗 | `addGroupIdToUser` reject | throw せず `outcome` を返す（`logger.warn` 1 本） | ✅ |
| 空文字引数 | `tid: ""` | `validation/empty-string` で throw / 書込 0 件 | ✅ |

### Emulator Validator（`scripts/test-rules-tournament-join.mjs`）

Task 8 の 16 ケース表を参照。allow 4 / deny 11 / 非回帰 1 の内訳で、PRD の Success signal（「匿名 / player doc なし / 別 group の tid / 存在しない tid / 他フィールド同時改竄 / organizerUids 昇格 → 全て deny」）を全て含む。

### Edge Cases Checklist

- [x] 空文字引数（`assertNonEmptyString`）
- [x] 最大長入力（displayName 15 字ちょうど / 16 字）
- [x] 不正な型（rule の `joinedViaTournamentId is string`）
- [x] 同時アクセス（多端末 self-add race → 再 probe で自己修復）
- [x] ネットワーク失敗（probe 失敗 → 非メンバー扱い → self-add deny → 再 probe → already-member）
- [x] permission denied（未加入時の `getGroup` 失敗が正常系）
- [x] 匿名アカウント（rule + service の二重防御）
- [x] 除名後の stale `groupIds`（probe を `getGroup` ベースにしたことで影響を受けない ＋ 毎回 `arrayUnion` で補修）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
npm run lint
```

EXPECT: 型エラー 0 / lint エラー 0（`console.*` 直呼びなし）

### Unit Tests

```bash
npm test -- auto-group-join
npm test -- group
npm test -- tournament-state
```

EXPECT: 全 pass

### Full Test Suite

```bash
npm test
```

EXPECT: 既存テスト非回帰（fixture 更新後）

### Rules Drift Check（emulator 不要）

```bash
npm run test:rules-limits
```

EXPECT: `ALL GREEN`（memberDisplayNames が `15 × 3` で検出される）

### Rules Emulator Validation

```bash
npm run test:rules-tournament-join
```

EXPECT: 16/16 PASS / `ALL GREEN` / exit 0

既存 validator の非回帰（rule を触ったため全件走らせる）:

```bash
npm run test:rules-proxy-create
npm run test:rules-clone-players
npm run test:rules-latest-join-code
npm run test:rules-season
npm run test:rules-season-points-rule
npm run test:rules-spectate
npm run test:rules-table-labels
npm run test:rules-card-background
```

EXPECT: 全て `ALL GREEN`

npm script のない validator も emulator 経由で走らせる:

```bash
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-finished-count.mjs"
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-default-seats.mjs"
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-pd.mjs"
```

EXPECT: 全て `ALL GREEN`（特に `test-rules-finished-count.mjs` は self-* 分岐の `affectedKeys` 回帰を検出する）

### Build

```bash
npm run build
```

EXPECT: 成功

### Rules Deploy（Phase 完了報告に必須）

```bash
firebase deploy --only firestore:rules
```

EXPECT: デプロイ成功。**emulator が green でも本番へ deploy しないと Phase 2 以降で `permission-denied` になる**。

### Manual Validation

- [ ] `firestore.rules` に `match /{...=**}` パターンが**追加されていない**ことを目視確認
- [ ] 新ブランチの不変条件が、既存 self-add（招待コード）の条件と 1:1 で対応していることを差分で確認
- [ ] `.claude/rules/group-membership.md` / `firebase-patterns.md` のリンク先が実在すること
- [ ] `git diff` に `.env` / `apiKey` / `token` / `secret` が混入していないこと（security-base.md）

---

## Acceptance Criteria

- [ ] Task 1〜12 完了
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` が全 green
- [ ] `npm run test:rules-limits` が `ALL GREEN`（出現数 3 を検出）
- [ ] `npm run test:rules-tournament-join` が 16/16 PASS
- [ ] 既存 emulator validator が全件非回帰
- [ ] `firebase deploy --only firestore:rules` 実行済み
- [ ] PRD Phase 1 の Success signal を全て満たす

## Completion Checklist

- [ ] rule 新ブランチが既存 self-add の不変条件を完全にミラーしている
- [ ] エラー処理が `error-logging.md` に準拠（repository=`firestore/*` / service=`group/auto-join-failed` / 二重 warn なし）
- [ ] ログが `logger.ts` 経由のみ（`console.*` 直呼びなし）
- [ ] テストが `testing.md` の mock 境界規約（repository 境界）に準拠
- [ ] 数値リテラル（15 / 4 state）がハードコードされている箇所に DRIFT WARNING がある
- [ ] `.claude/rules/*.md` 3 ファイルを更新済み
- [ ] スコープ外（Phase 2〜4）の変更を含まない
- [ ] 実装とテストが同一 commit にペアで入っている（testing.md）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| 新 self-add ブランチが既存 invariant を bypass する穴を作る | M | **H** | 既存 self-add の不変条件を 1 行も欠かさずミラー。wildcard 厳禁。emulator validator に deny ケースを 11 件（organizerUids 昇格 / 他フィールド改竄 / 別 group tid / player なし / 匿名）投入。既存 validator 全件を非回帰確認 |
| 15 字超の Google 表示名で rule deny → 自動所属が静かに失敗 | **H** | M | service の `resolveMemberDisplayName` で `slice(0, DISPLAY_NAME_MAX_LENGTH)` を**全経路**に適用。repository でも再検証（二重防御）。unit test で 15 字超・uid フォールバックを固定 |
| 受付可能 4 state リテラルの drift（rule 側だけ / helper 側だけ変更） | M | M | `isAcceptingProxyEntry` と `hasTournamentEntryProof` の両方に相互参照の DRIFT WARNING。emulator validator に finished→deny ケース |
| 除名/脱退後の stale `groupIds` で再加入が阻害される | M | M | membership probe を `getGroup` の成否ベースにして stale に依存させない。加えて outcome によらず毎回 `addGroupIdToUser` で補修（Phase 4 の除名 → 再受付 E2E で最終確認） |
| 多端末・連打による同時 self-add で片方が deny | L | L | self-add 失敗時に再 probe し、メンバーになっていれば `already-member` に倒す（ユーザーには成功として見せる） |
| schema additive 追加で既存 fixture の typecheck が壊れる | **H** | L | Task 12 で 6 箇所を先に洗い出し済み。`npm run typecheck` が漏れを機械検出する |
| 本番 rules 未 deploy で Phase 2 が `permission-denied` になる | M | **H** | Acceptance Criteria に `firebase deploy --only firestore:rules` を必須項目として明記 |

## Notes

### PRD Open Questions への回答（本 Phase で確定した判断）

1. **「rule 側の受付可能 state ガードを入れるか」→ 入れる**。`players` doc の存在だけを条件にすると、終了済みトーナメントの過去参加者がいつでも加入できてしまう（QR が後から流出した場合の攻撃面が無期限に開く）。代償の同期リテラル 1 箇所は、`isAcceptingProxyEntry` と `hasTournamentEntryProof` の相互参照 DRIFT WARNING ＋ emulator validator の finished→deny ケースで管理する。

2. **「除名後の stale `groupIds` で再受付時に既メンバーと誤判定されないか」→ されない**。membership probe を `getGroup(gid)` の成否ベースにしたため、`groupIds` の内容を一切参照しない。加えて outcome によらず毎回 `addGroupIdToUser` を呼ぶので、逆向き（メンバーだが groupIds に無い）も次回受付で自己修復する。

3. **「`joinedViaTournamentId` は最後の加入者の tid で上書きされる」→ 仕様として受容**。schema の JSDoc とドキュメントに「監査ログ用途には使えない」と明記した。`joinCodeId` と同じ性質。

### 既知の隣接バグ（本 Phase では**触らない**）

[`consumeJoinCode`](../../../../src/lib/services/group.ts#L138) の displayName フォールバックは
`authUser?.displayName?.trim() || profile?.displayName?.trim() || uid` で、**`slice` を通していない**。
Firebase の uid は 28 字なので、displayName が一切解決できないユーザーが招待コードで加入すると
rule の `memberDisplayNames[uid].size() <= 15` で deny される可能性がある（表示名なしの
匿名/新規ユーザーが招待コード経由で加入する稀な経路）。

本 Phase の新規経路は `resolveMemberDisplayName` で必ず slice するため同じ罠は踏まないが、
既存経路の修正はスコープ外とした（招待コード導線に手を入れる Phase ではないため）。
修正が必要になったら 1 行の `.slice(0, DISPLAY_NAME_MAX_LENGTH)` 追加で済む。

### service の配置理由

`joinGroupViaTournament` は `src/lib/services/group.ts`（`consumeJoinCode` の隣）ではなく
新規ファイル `src/lib/services/auto-group-join.ts` に置く。PRD の Parallelism Notes が
「Phase 4（除名 UI）は Phase 1〜3 と完全に独立・同時着手して構わない」としており、
Phase 4 は `group.ts` の owner 系 service を編集するため、同ファイルを避けることで
並行着手時のマージ競合をゼロにする。`group.ts` は既に 836 行あり、分割の方向性とも整合する。

### Phase 2 への申し送り

- 呼出順序は **`ensurePlayerCreated`（player doc 作成）→ `joinGroupViaTournament`** を厳守する。逆順・並列は rule で必ず deny される。
- 呼出は `joinViaGoogle` / `joinAsExistingUser` / `joinAsCurrentUser` の 3 経路のみ。**`joinAsGuest` には接続しない**（匿名除外）。
- best-effort 化は Phase 2 の callsite の責務。`try { ... } catch (e) { logger.warn(..., { errorCode: getErrorCode(e) }) }` で握り、受付結果はそのまま返す。
- 戻り値 `AutoJoinOutcome`（`joined` / `already-member` / `skipped-anonymous`）が受付完了画面のフィードバック文言の分岐に使える。
- `already-joined` の再受付でも呼ぶ（PRD の Q1(b)）— 本 service は既メンバーなら no-op で安全。
