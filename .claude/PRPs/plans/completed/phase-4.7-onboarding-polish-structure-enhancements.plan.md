# Plan: Phase 4.7 — Onboarding Polish & Structure Enhancements

## Summary

実投入直前の 7 つの UX / 機能ペインを一括解消する（テンプレート図書館は Phase 4.8 に分離）。Google 新規ログインとゲスト参加での displayName 取り扱いを整理し、トーナメントにリバイ／アドオン用のチップ量フィールドと平均スタック表示を導入、ブレイクレベルに対応。さらに group メンバー一覧で UID ではなく displayName を表示できるよう `memberDisplayNames` snapshot を追加し、トーナメント一覧カードに状態別の色分けを導入する。既存データは additive に拡張し、破壊的 migration は不要（zod `default` / `optional` / `nullable` で旧 doc を受容）。Firestore Rules は **group の self-update に 1 条件のみ追加**（`memberDisplayNames` の self-key 書込許可）。

## User Story

As a サークル運営者（初心者・ポーカー歴浅め）,
I want Google でログインしても表示名をサークル用ニックネームに設定でき、トーナメント進行中にブレイクを挟んだり平均スタックを見られ、サークルメンバー一覧で UID ではなく displayName が見え、トーナメント一覧で開催中／未開催／終了済みをパッと見分けられる状態,
So that 本名を晒さずにサークルを回せ、進行中も TDA 相当の情報（平均スタック・ブレイク）を参加者に示せ、メンバー同士の識別や当日のトーナメント状態把握が瞬時にできる。

And as a サークル参加者（ゲスト匿名）,
I want ゲスト参加時に入力した表示名がヘッダと受付一覧に即座に反映される,
So that 自分のアカウントが正しく認識されているか確認できる。

## Problem → Solution

**Current state (Phase 4.6 完了時点)**:

1. **Google 新規ログイン**: アカウントが無い状態で Google ログインすると Google プロフィールの本名がそのまま displayName として保存される。変更は `/settings` から個別操作が必要で、**初参加者は本名が参加者一覧に載る**リスクがある。
2. **ゲスト参加後の header 表示**: 匿名参加で `signInAsGuest` → `updateProfile(displayName)` 後、`onAuthStateChanged` は再発火しないため [AuthBadge.tsx:42-44](src/components/auth/AuthBadge.tsx#L42-L44) は `displayName = null` のままになり「ゲスト: （名前未設定）」と表示される（次回の auth 状態変化まで）。
3. **チップ量設定**: ストラクチャに `initialStack` しかなく、リバイ／アドオンのスタック量を事前に記録できない。
4. **平均スタック**: 計算式（総チップ ÷ 未バスト人数）が画面に出ていない。運営者が暗算する必要がある。
5. **ブレイク**: `levels: [{sb, bb, ante, durationSec}]` のみで「ブレイク（休憩）」を levels 配列の中に表現する手段がない。ブラインド 0/0 でごまかせば一応止められるが、UI に「BREAK」と表示されないため参加者に伝わらない。
6. **group メンバー一覧で UID 表示になる**: `/groups/{gid}` の [group-detail-client.tsx:76-83](src/app/groups/[gid]/group-detail-client.tsx#L76-L83) で `getUserProfile(uid)` を loop しているが、`users/{uid}` rule が self-only read のため**他メンバー分は必ず permission-denied で uid にフォールバック**する。招待された側が「誰が誰なのか」判別できない。
7. **トーナメント一覧が状態で見分けにくい**: `/tournaments` の各カードは `state` を小さい badge で表示するだけ。一覧パッ見で「今どれが開催中？」「どれが終了済み？」が分からない。

**Desired state (Phase 4.7 完了時点)**:

1. Google 新規ログイン時、`users/{uid}` が未作成のユーザーには **「表示名設定ダイアログ」を必須表示**。既存ユーザーは自動 skip。
2. `signInAsGuest` / `registerWithEmail` / `updateDisplayName` の直後に **AuthProvider の `refreshUser()` を呼び、React state を `firebaseAuth.currentUser` の最新値で置換**。ヘッダの displayName が即反映される。
3. `structures.{rebuyStack, addOnStack}` と同等の `structureSnapshot.{rebuyStack, addOnStack}` を **nullable number** として追加。UI にも入力欄追加。トーナメント側では参照表示のみ（リバイ／アドオン実操作は v1.1 以降）。
4. `/tournaments/{tid}` ダッシュボードと `/live` の TimerDisplay 直下に **「平均スタック: X,XXX」カード**を独立して追加。計算式は `(totalEntries × initialStack) ÷ activePlayers`（リバイ／アドオン管理は未実装のため初期スタック基準）。TimerDisplay の枠外に配置（兄弟要素）。
5. `levelSchema` に **`isBreak: z.boolean().default(false)`** を追加。LevelTable に「ブレイク」チェックボックスを追加。TimerDisplay は `isBreak === true` のレベルを **「☕ BREAK」表示**に切替（SB/BB/Ante は隠す）。auto-advance は既存通り動作。
6. `groups/{gid}` に **`memberDisplayNames: Record<uid, displayName>`** フィールドを追加（zod `z.record(...).default({})` で旧 doc 受容）。
   - `consumeJoinCode` で自分のエントリを追加
   - `updateDisplayName` service で自分が所属する全 group に best-effort で伝播
   - `removeMemberSelf` / `leaveGroup` で自分のエントリを削除
   - `firestore.rules` の groups update に「self-update: `memberDisplayNames` の `auth.uid` キーのみ変更」パターンを追加（`diff().affectedKeys().hasOnly([auth.uid])`）
   - `/groups/{gid}` UI は `group.memberDisplayNames[uid] ?? uid` を表示し、permission-denied ベースの `getUserProfile` loop を廃止
7. `/tournaments` のカードで **state に応じた border 色とバッジ色**を適用。
   - `setup` / `seating` → slate（未開催）
   - `running` / `paused` → emerald（開催中）
   - `finished` → muted / 半透明（終了済み）

## Metadata

- **Complexity**: Medium-Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **Source memo**: [tmp/08_Phase4.6_memo.md](../../../tmp/08_Phase4.6_memo.md) + [tmp/09_pahse4.7_memo.md](../../../tmp/09_pahse4.7_memo.md)
- **PRD Phase**: Phase 4.7 — Onboarding Polish & Structure Enhancements（Phase 4.6 完了後・Phase 4.8 前）
- **Split rationale**: memo-08 Item 2（テンプレート図書館）は新規 collection + Rules + bootstrap 運用を伴う独立機能のため Phase 4.8 に分離。Phase 4.7 は本体 schema additive + UX 改善（memo-08 item 1/3/4/5/6 + memo-09 item 1/2）に絞る
- **Estimated Files**: 約 20 files（新規 3・編集 17）

---

## UX Design

### Item 1 & 2（Google 新規ログイン displayName / ゲスト header）

```
Before（Google 新規ログイン）                  After
┌──────────────────────┐                       ┌──────────────────────┐
│  [Google でログイン]  │                       │  [Google でログイン]  │
└──────────┬───────────┘                       └──────────┬───────────┘
           │                                               │
           ▼                                               ▼
  トーナメント一覧 (本名表示！)                  ┌──────────────────────┐
                                                  │ 表示名を設定          │
                                                  │ サークルで使うニックネ │
                                                  │ ームを入力してください │
                                                  │ [________] [保存]     │
                                                  └──────────┬───────────┘
                                                             ▼
                                                  トーナメント一覧 (ニックネーム表示)

Before（ゲスト参加後）                          After
┌──────────────────────┐                       ┌──────────────────────┐
│ ヘッダ: ゲスト:       │                       │ ヘッダ: ゲスト: なつき │
│       （名前未設定）  │                       │                      │
└──────────────────────┘                       └──────────────────────┘
 ↑ updateProfile 反映されず                     ↑ refreshUser で即反映
```

### Item 3（リバイ／アドオン入力）

```
/structures/new （After）
┌─────────────────────────────────────────────────────┐
│ ストラクチャを新規作成                                │
│                                                      │
│ ストラクチャ名: [__________]                         │
│ 初期スタック:  [______]                              │
│ リバイ:       [______]     ← 新設 (任意・nullable)    │
│ アドオン:     [______]     ← 新設 (任意・nullable)    │
│ 締切 Lv:      [__]                                   │
│                                                      │
│ ブラインド構造:                                      │
│ Lv SB BB Ant 分 BREAK[ ] [×]  ← チェックで休憩       │
│  1 25 50 0  10  [ ]       [×]                        │
│  2 ...                                               │
│ [+ レベル追加]                                       │
└─────────────────────────────────────────────────────┘
```

### Item 4（平均スタック表示）

チップ情報は **TimerDisplay の枠外に独立した Card** として配置する（TimerDisplay の内部には追加しない）。

```
/tournaments/{tid} ダッシュボード（After）
┌──────────────────────────────────────┐   ← TimerDisplay（既存カード・変更なし）
│ Lv 3  [進行中]                       │
│  08:42                               │
│  SB 100 / BB 200 / Ante 0            │
│  Next: Lv 4 (150 / 300)              │
└──────────────────────────────────────┘

┌──────────────────────────────────────┐   ← AverageStackCard（新規・独立カード）
│ 平均スタック         参加 15 / 残 12 │
│ 12,500              初期 10,000      │
└──────────────────────────────────────┘
```

### Item 5（ブレイクレベル表示）

```
TimerDisplay during break（After）
┌──────────────────────────────────────┐
│ Lv 5  [進行中]                       │
│  05:00                               │
│                                      │
│   ☕ BREAK                           │
│                                      │
│  Next: Lv 6 (200 / 400)              │
└──────────────────────────────────────┘
```

### Item 6（group メンバー一覧の displayName 表示）

```
Before（/groups/{gid}）                          After
┌─ メンバー ─────────────────┐                  ┌─ メンバー ─────────────────┐
│ ・abc123def456789... [運営] │                  │ ・たろう [運営]            │
│ ・xyz789ghi012345... [一般] │  ← uid フォール  │ ・なつき [一般]            │
│ ・山田 [オーナー] [あなた]  │     バック        │ ・山田 [オーナー] [あなた] │
└─────────────────────────────┘                  └─────────────────────────────┘
```

実装: `groups/{gid}.memberDisplayNames[uid] → displayName` を表示。未登録は uid にフォールバック（初回 dry-run 時点で各ユーザーが自分の entry を触ったタイミングで自動 backfill される）。

### Item 7（トーナメント一覧カードの状態色分け）

```
Before（/tournaments 一覧）                      After
┌──────────────────────┐                         ┌══════════════════════┐ ← emerald 枠（開催中）
│ Monthly 12 月         │                         │ ▶ Monthly 12 月       │
│ [running] 15Lv/10k    │                         │ [進行中] 15Lv/10k    │
└──────────────────────┘                         └══════════════════════┘

┌──────────────────────┐                         ┌──────────────────────┐ ← slate 枠（未開催）
│ Monthly 1 月          │                         │ Monthly 1 月          │
│ [setup] 15Lv/10k      │                         │ [未開催] 15Lv/10k    │
└──────────────────────┘                         └──────────────────────┘

┌──────────────────────┐                         ┌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┐ ← muted / 半透明（終了）
│ Monthly 11 月         │                         │ ✓ Monthly 11 月       │
│ [finished] 15Lv/10k   │                         │ [終了] 15Lv/10k      │
└──────────────────────┘                         └╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| Google 新規ログイン | 直接 redirect | displayName 入力ダイアログ → redirect | 既存ユーザー (users/{uid} 存在) はダイアログ skip |
| ゲスト参加後ヘッダ | `displayName = null` のまま | 即 displayName 反映 | AuthProvider.refreshUser を呼出 |
| `/structures/new` フィールド | 初期スタックのみ | 初期 / リバイ / アドオン の 3 入力 | リバイ / アドオンは任意（空欄 OK） |
| LevelTable 各行 | SB/BB/Ante/分/削除 | + ブレイクチェックボックス | チェック時 SB/BB/Ante の編集は disabled に |
| TimerDisplay | SB/BB/Ante 常時表示 | `isBreak === true` の level は「☕ BREAK」のみ | Next は従来どおり |
| ダッシュボード / live | タイマーのみ | + 平均スタックカード（running/paused 時） | 0 人時は非表示 |
| `/groups/{gid}` メンバー一覧 | uid フォールバック表示 | `memberDisplayNames[uid] ?? uid` | 未登録の旧メンバーは uid のまま（rename で backfill） |
| `/tournaments` 一覧カード | 単色ボーダー + state badge | state で border 色 + badge 色変更 + 日本語ラベル | 終了済みは opacity 下げで「完了感」 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ拡張・zod 三点同期・repository 規約 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | AppError ラップ / logger 経由出力の徹底 |
| P0 | [src/lib/firebase/schemas/structure.ts](../../../src/lib/firebase/schemas/structure.ts) | all | `levelSchema` と `structureBodySchema` に additive 拡張 |
| P0 | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts) | all | `structureSnapshotSchema` にも同拡張を伝播 |
| P0 | [src/lib/firebase/AuthProvider.tsx](../../../src/lib/firebase/AuthProvider.tsx) | all | `refreshUser` を expose する context 拡張 |
| P0 | [src/lib/services/auth-actions.ts](../../../src/lib/services/auth-actions.ts) | 127-207 | Google sign-in の「新規 vs 既存」判定追加、refresh トリガ |
| P0 | [src/components/auth/AuthBadge.tsx](../../../src/components/auth/AuthBadge.tsx) | 42-44 | 匿名 label は user.displayName 依存。refresh で解消される |
| P0 | [src/components/structure/StructureForm.tsx](../../../src/components/structure/StructureForm.tsx) | all | rebuy/addon 入力欄追加 |
| P0 | [src/components/structure/LevelTable.tsx](../../../src/components/structure/LevelTable.tsx) | all | isBreak チェックボックス追加 |
| P0 | [src/components/tournament/TimerDisplay.tsx](../../../src/components/tournament/TimerDisplay.tsx) | all | BREAK 表示分岐 |
| P1 | [src/lib/services/timer.ts](../../../src/lib/services/timer.ts) | 5-25 | `getLevelInfo` は既存のまま利用可。break 判定は Level.isBreak で行う |
| P1 | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 190-300 | 平均スタックカードの差込位置 |
| P1 | [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | 106-120 | 平均スタックカード（参加者向け） |
| P1 | [src/app/login/login-client.tsx](../../../src/app/login/login-client.tsx) | 70-87 | Google sign-in 成功時の分岐追加 |
| P1 | [src/app/join/[tid]/join-client.tsx](../../../src/app/join/[tid]/join-client.tsx) | 87-103 | `joinAsGuest` 成功後の refresh トリガ |
| P2 | [src/components/tournament/TimerDisplay.test.tsx](../../../src/components/tournament/TimerDisplay.test.tsx) | all | BREAK 表示テスト追加 |
| P2 | [src/lib/services/timer.test.ts](../../../src/lib/services/timer.test.ts) | all | 平均スタック / BREAK level の shouldAutoAdvance 挙動テスト |
| P2 | [.claude/PRPs/plans/completed/phase-4.6-member-role-split.plan.md](completed/phase-4.6-member-role-split.plan.md) | 1-300 | 破壊的変更の mirror 元（本 phase は非破壊だが記法を踏襲） |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/[gid]/group-detail-client.tsx) | 60-90, 269-376 | memberDisplayNames 利用対象。getUserProfile loop を廃止する差替位置 |
| P0 | [src/lib/firebase/schemas/group.ts](../../../src/lib/firebase/schemas/group.ts) | all | `memberDisplayNames` フィールド追加の対象 |
| P0 | [src/lib/firebase/repositories/groups.ts](../../../src/lib/firebase/repositories/groups.ts) | all | consumeJoinCode / removeMemberSelf / updateGroupRoles で map の self-key 書込を追加 |
| P0 | [src/lib/services/group.ts](../../../src/lib/services/group.ts) | all | consumeJoinCode 時の displayName 書込、`propagateDisplayNameToGroups` 新規関数 |
| P0 | [src/lib/services/auth-actions.ts](../../../src/lib/services/auth-actions.ts) | 230-252 | updateDisplayName から propagateDisplayNameToGroups を呼出（best-effort） |
| P0 | [firestore.rules](../../../firestore.rules) | 53-122 | groups update rule に self-key 書込パターン追加（`diff().affectedKeys().hasOnly([auth.uid])`） |
| P0 | [src/app/tournaments/tournaments-client.tsx](../../../src/app/tournaments/tournaments-client.tsx) | 88-118 | 状態別カード色分けの適用箇所 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firebase Auth `additionalUserInfo.isNewUser` | [firebase.google.com/docs/reference/js/auth.additionaluserinfo](https://firebase.google.com/docs/reference/js/auth.additionaluserinfo) | `getAdditionalUserInfo(UserCredential)` で `isNewUser` を取得可。Google provider の初回ログイン判定に使える |
| `onIdTokenChanged` vs `onAuthStateChanged` | [firebase.google.com/docs/reference/js/auth.auth.md#authonidtokenchanged](https://firebase.google.com/docs/reference/js/auth.auth.md#authonidtokenchanged) | `updateProfile` は **どちらにも発火しない**。手動で state refresh する必要がある |
| zod `default` / `optional` | [zod.dev/?id=default](https://zod.dev/?id=default) | `z.boolean().default(false)` は parse 時に未定義を false に置換。既存データ受容に利用 |
| Firestore rules `.diff().affectedKeys()` | [firebase.google.com/docs/reference/rules/rules.MapDiff](https://firebase.google.com/docs/reference/rules/rules.MapDiff) | map フィールドの「特定キーのみ変更」を rule で検証可能。`request.resource.data.memberDisplayNames.diff(resource.data.memberDisplayNames).affectedKeys().hasOnly([request.auth.uid])` |
| Firestore dot-path update | [firebase.google.com/docs/firestore/manage-data/add-data#update_fields_in_nested_objects](https://firebase.google.com/docs/firestore/manage-data/add-data#update_fields_in_nested_objects) | `updateDoc(ref, { [`memberDisplayNames.${uid}`]: name })` で map の特定キーのみ書込 |

```
KEY_INSIGHT: updateProfile は onAuthStateChanged を再発火させない
APPLIES_TO: Item 2 / Task 5 (AuthProvider refresh)
GOTCHA: user.reload() 後に onIdTokenChanged が fire するケースもあるが保証されない。AuthProvider 側で setState({ user: firebaseAuth.currentUser }) を呼ぶ方式が最も確実（同じオブジェクト参照で React が diff 検出しない問題があるため useReducer 版 forceUpdate に倒す）

KEY_INSIGHT: Google sign-in の「新規 vs 既存」判定は `additionalUserInfo.isNewUser` か `users/{uid}` doc 存在チェックのどちらか
APPLIES_TO: Item 1 / Task 4 (signInWithGoogle 分岐)
GOTCHA: `additionalUserInfo` は `getAdditionalUserInfo(cred)` を `signInWithPopup` の戻り値に対して呼ぶ必要あり。リンク経由 (linkGoogleWithPassword) では適用されない点に注意

KEY_INSIGHT: schema 拡張は `z.default(false)` / `.optional()` で旧 doc を受容
APPLIES_TO: Item 3, 5 / Task 1 (schema 拡張)
GOTCHA: `.default()` は parse 時点で値を埋めるため zodConverter 経由で読んだ UI は `isBreak === false` を受け取る。書込側でも undefined ではなく false/null を明示して integrity を保つ

KEY_INSIGHT: 平均スタックはリバイ／アドオンなしでも算出できる
APPLIES_TO: Item 4 / Task 8 (平均スタックカード)
GOTCHA: 分母は activePlayers = players.filter(p => !p.isBusted).length。0 人時は非表示（Infinity 回避）。totalChips = totalEntries * initialStack（リバイ/アドオン入力欄があっても実操作は未実装のため snapshot 値は計算に使わない）

KEY_INSIGHT: isBreak レベルも durationSec で auto-advance する
APPLIES_TO: Item 5 / Task 7 (BREAK UI)
GOTCHA: shouldAutoAdvance は state / levelStartedAt / remaining のみを見ているため isBreak の区別不要。break だけ特別に「手動 advance 必須」にしたい場合は別途分岐を追加するが、本 Phase では自動進行を維持する

KEY_INSIGHT: groups/{gid}.memberDisplayNames の self-key 書込を rule で安全に許可する
APPLIES_TO: Item 6 / Task 15 (rule 拡張)
GOTCHA: `memberDisplayNames.diff(resource.data.memberDisplayNames).affectedKeys().hasOnly([request.auth.uid])` で他人の entry 書換を禁止。併せて他フィールド（memberUids / ownerUids / organizerUids / name / createdAt / joinCodeId）の immutable チェックも必須。self-leave / self-add rule は既存条件に合わせて memberDisplayNames の entry 同期（add / remove）を許可する

KEY_INSIGHT: 既存 groups doc の memberDisplayNames backfill
APPLIES_TO: Item 6 / Task 14
GOTCHA: 旧 doc は `memberDisplayNames` フィールド未設定。zod default({}) で受容しつつ、各ユーザーは自分の entry のみ書込可なので「他メンバーの名前は本人が rename するまで uid のまま」になる。dry-run 直前に運営者各自が /settings で自分の displayName を保存する運用でも backfill される（軽い手順で解決）。script migration は不要
```

---

## Patterns to Mirror

### ZOD_ADDITIVE_EXTENSION

```ts
// SOURCE: src/lib/firebase/schemas/structure.ts:4-10 （Phase 4.7 追加形式）
export const levelSchema = z.object({
  level: z.number().int().positive(),
  sb: z.number().int().nonnegative(),
  bb: z.number().int().nonnegative(),  // M1: break で 0 を許容するため positive → nonnegative に緩和
  ante: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  // Phase 4.7 追加: default(false) で旧 doc を受容。書込時は常に明示 false / true を送る。
  isBreak: z.boolean().default(false),
}).superRefine((v, ctx) => {
  // play level では bb > 0 を維持する（break 以外で bb=0 は意味不明）
  if (!v.isBreak && v.bb <= 0) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bb"], message: "BB は正の整数（プレイレベル）" });
  }
});
```

### ERROR_HANDLING (service-level, existing pattern)

```ts
// SOURCE: src/lib/services/auth-actions.ts:72-98
export async function registerWithEmail(email, password, displayName): Promise<User> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
  try {
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    await updateProfile(cred.user, { displayName: trimmed });
    await upsertUserProfile({ uid: cred.user.uid, displayName: trimmed, email: cred.user.email ?? null });
    logger.info("register ok", { uid: cred.user.uid });
    return cred.user;
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/register-failed", "新規登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
// Phase 4.7: Google sign-in に isNewUser 判定を追加しつつ、この catch/log/throw 形式を維持。
```

### AUTH_REFRESH_PATTERN (Phase 4.7 新規)

```ts
// SOURCE: 新規 — src/lib/firebase/AuthProvider.tsx 拡張
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });
  // Phase 4.7: 再描画を確実に走らせるため useReducer の force を使う
  const [bump, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => setState({ user, loading: false }),
      (error) => { /* ... */ setState({ user: null, loading: false }); },
    );
    return unsubscribe;
  }, []);

  // updateProfile 後に呼び出して手動で React state を最新化する。
  const refreshUser = useCallback(() => {
    // 同じ User オブジェクト参照のまま displayName が変わるため、bump で再レンダを強制。
    force();
  }, []);

  const value = useMemo(
    () => ({ user: firebaseAuth.currentUser ?? state.user, loading: state.loading, refreshUser }),
    [state, bump, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
```

### TIMER_DISPLAY_BRANCH (Phase 4.7 で break を追加)

```tsx
// SOURCE: src/components/tournament/TimerDisplay.tsx:79-92 を差替
{current ? (
  current.isBreak ? (
    <div className="flex items-center gap-2 text-xl font-semibold text-amber-700 dark:text-amber-400">
      <span aria-hidden>☕</span>
      <span>BREAK</span>
    </div>
  ) : (
    <div className="text-base text-muted-foreground">
      SB {current.sb} / BB {current.bb} / Ante {current.ante}
    </div>
  )
) : null}
```

### REPOSITORY_WRITE_PATTERN (既存・そのまま利用)

```ts
// SOURCE: src/lib/firebase/repositories/structures.ts:29-42
export async function createStructure(input: CreateStructureInput): Promise<string> {
  try {
    const ref = await addDoc(structuresRef, {
      ...input,
      rebuyStack: input.rebuyStack ?? null,
      addOnStack: input.addOnStack ?? null,
      createdAt: serverTimestamp(),
    });
    logger.info("structure create ok", { sid: ref.id, gid: input.groupId });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "ストラクチャ作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
// Phase 4.7: input に rebuyStack / addOnStack が optional に含まれる。undefined は null に正規化して書込。
```

### TEST_STRUCTURE (既存・そのまま利用)

```ts
// SOURCE: src/lib/services/timer.test.ts パターン
import { describe, expect, it } from "vitest";
import { Timestamp } from "firebase/firestore";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
    name: "t",
    structureSnapshot: {
      name: "s", initialStack: 10000, rebuyStack: null, addOnStack: null, lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
    },
    state: "running",
    currentLevel: 1,
    levelStartedAt: Timestamp.fromMillis(0),
    pausedAt: null,
    pausedAccumMs: 0,
    startedAt: Timestamp.fromMillis(0),
    finishedAt: null,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: Timestamp.fromMillis(0),
    updatedAt: Timestamp.fromMillis(0),
    ...overrides,
  };
}
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/firebase/schemas/structure.ts` | UPDATE | `levelSchema.isBreak` 追加、`structureBodySchema.rebuyStack/addOnStack` 追加（いずれも default/nullable） |
| `src/lib/firebase/schemas/tournament.ts` | UPDATE | `structureSnapshotSchema` に `rebuyStack / addOnStack` を伝播 |
| `src/lib/firebase/repositories/structures.ts` | UPDATE | createStructure で rebuy/addOn undefined を null 正規化 |
| `src/components/structure/StructureForm.tsx` | UPDATE | rebuy/addon 入力、initialValue の拡張 |
| `src/components/structure/LevelTable.tsx` | UPDATE | 各行にブレイクチェックボックス。isBreak === true の行は sb/bb/ante を disabled にする |
| `src/lib/firebase/AuthProvider.tsx` | UPDATE | `refreshUser: () => void` を context に追加（useReducer bump 経由） |
| `src/lib/services/auth-actions.ts` | UPDATE | `signInWithGoogle` が `{ user, isNewUser }` を返す形に変更、既存ユーザーの displayName 上書きを停止 |
| `src/app/login/login-client.tsx` | UPDATE | Google sign-in 戻り値の `isNewUser` を見て `DisplayNameDialog` を開く + register 後に refreshUser |
| `src/components/auth/DisplayNameDialog.tsx` | CREATE | displayName 入力必須ダイアログ。`updateDisplayName` → `refreshUser()` → 親の `onDone` コールバック |
| `src/app/settings/settings-client.tsx` | UPDATE | `updateDisplayName` 後に `refreshUser()` を呼び出し、ヘッダ即反映を保証 |
| `src/app/join/[tid]/join-client.tsx` | UPDATE | `joinAsGuest` 呼出後に `refreshUser()` を呼ぶ |
| `src/lib/services/receipt.ts` | UPDATE | `joinViaGoogle` が `signInWithGoogle()` の新戻り値 `{ user }` を分割代入 |
| `src/components/tournament/TimerDisplay.tsx` | UPDATE | `isBreak === true` の level は `☕ BREAK` 表示に切替、Next も break 対応 |
| `src/components/tournament/AverageStackCard.tsx` | CREATE | 平均スタックカード（TimerDisplay の枠外・独立）。props: `{ tournament, players }` を受け取り、running/paused 時に計算表示 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `<AverageStackCard />` を TimerDisplay の兄弟要素として追加 |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 同様に live でも表示 |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx` | UPDATE | initialValue に rebuy/addon を含める |
| `src/lib/firebase/schemas/group.ts` | UPDATE | `memberDisplayNames: z.record(...).default({})` 追加 |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | `setMemberDisplayName(gid, uid, name)` / self-add 時の同時書込パターン追加 |
| `src/lib/services/group.ts` | UPDATE | `consumeJoinCode` で自分の displayName を map に書込、`propagateDisplayNameToGroups(uid, groupIds, name)` 新規 |
| `src/lib/services/auth-actions.ts` | UPDATE | `updateDisplayName` 後に `propagateDisplayNameToGroups` を best-effort で呼ぶ（失敗しても throw しない） |
| `firestore.rules` | UPDATE | groups update の 3 経路（self-add / self-leave / owner-full）すべてで `memberDisplayNames` の整合性検証を追加、+ 新規 self-key update 経路を追加 |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | `getUserProfile` loop を削除、`group.memberDisplayNames[uid] ?? uid` を表示 |
| `src/app/tournaments/tournaments-client.tsx` | UPDATE | state 別カード色分け + 日本語ラベル化 |
| `src/components/tournament/TimerDisplay.test.tsx` | UPDATE | BREAK 表示ケースを追加 |
| `src/components/tournament/AverageStackCard.test.tsx` | CREATE | 平均計算・0 人時非表示テスト |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | `levelSchema.isBreak` default false の受容、rebuy/addon optional の受容テスト、`memberDisplayNames` default {} の受容テスト |
| `src/lib/services/group.test.ts` | UPDATE | `propagateDisplayNameToGroups` のテスト、consumeJoinCode の map 書込確認 |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Phase 4.7 行を 7 items scope に更新（テンプレート関連を Phase 4.8 へ移管） |

## NOT Building

- **ストラクチャテンプレート図書館** → **Phase 4.8 で別途実装**。本 Phase では rebuy/addOn / isBreak の schema 拡張のみ行い、テンプレートはスコープ外
- **リバイ／アドオン実操作（count up / スタック増加イベント）**: memo item 4 は「チップ量を設定できるようにしたい」であり、実操作は要求されていない。本 Phase では値の保存と表示のみ。実操作は v1.1 以降
- **ブレイクの専用タイマーモード（手動 advance / 延長）**: `isBreak === true` でも既存の `shouldAutoAdvance` に従って自動繰り上げ。手動 advance を強制したい場合は将来 `breakMode: "auto" | "manual"` を追加
- **displayName 必須チェックの Firestore rule 化**: rule で `users/{uid}.displayName` 未設定を弾く経路は作らない。UI ダイアログで強制するのみ（Phase 4.6 の方針に従い UI + service で担保）
- **Google sign-in のリンク経路（linkGoogleWithPassword）での displayName ダイアログ**: link は既存ユーザー同士の統合なので displayName はすでに設定済み。対象外
- **平均スタックにリバイ／アドオン量を加算**: リバイ／アドオン実操作が未実装のため、加算ロジックは持たない。計算式は `totalEntries × initialStack ÷ activePlayers` に固定
- **`users/{uid}` の rule 緩和で displayName を公開 read にする**: 現状の self-only read 原則を維持（email 等も同 doc にあるため public read はプライバシーリスク）。代わりに group 単位の `memberDisplayNames` snapshot で対応
- **displayName 変更時の強力なカスケード整合性保証**: `propagateDisplayNameToGroups` は **best-effort**（一部 group で失敗しても updateDisplayName 全体を throw しない）。厳密同期は Cloud Functions 導入時の責務。実運用で見え方がズレるケースは稀で、rename 主体が自分自身のためユーザー側で再試行可能
- **旧 groups doc に対する migration script**: `memberDisplayNames` は zod default({}) で受容し、各ユーザーが自分の entry を書込したタイミングで自動 backfill。script は作らない（Phase 2.5 / 4.6 では collection 変換のため script が必要だったが、本件は entry 追加のみで全員が自力で backfill 可能）
- **トーナメント状態アイコン / 視覚装飾の追加**: 本 Phase は border + badge 色 + 日本語ラベル + opacity のみ。アニメーション / アイコン（▶ / ✓ 等）は ASCII mockup 上の比喩で、実装は記号の有無ではなくテキストラベル（「進行中」「未開催」「終了」）と色で区別する

---

## Step-by-Step Tasks

### Task 1: zod スキーマに isBreak / rebuyStack / addOnStack を additive に追加

- **ACTION**: `src/lib/firebase/schemas/structure.ts` と `src/lib/firebase/schemas/tournament.ts` を更新
- **IMPLEMENT**:
  ```ts
  // structure.ts
  export const levelSchema = z.object({
    level: z.number().int().positive(),
    sb: z.number().int().nonnegative(),
    bb: z.number().int().nonnegative(),  // break 対応で positive → nonnegative
    ante: z.number().int().nonnegative(),
    durationSec: z.number().int().positive(),
    isBreak: z.boolean().default(false),  // 新規
  }).superRefine((v, ctx) => {
    if (!v.isBreak && v.bb <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["bb"], message: "BB は正の整数（プレイレベル）" });
    }
  });

  export const structureBodySchema = z.object({
    groupId: z.string().min(1),
    createdByUid: z.string().min(1),
    name: z.string().min(1),
    initialStack: z.number().int().positive(),
    rebuyStack: z.number().int().positive().nullable().default(null),   // 新規
    addOnStack: z.number().int().positive().nullable().default(null),   // 新規
    lateEntryDeadlineLevel: z.number().int().positive(),
    levels: z.array(levelSchema).min(1),
    createdAt: z.instanceof(Timestamp),
  });

  export const createStructureInputSchema = z.object({
    groupId: z.string().min(1),
    createdByUid: z.string().min(1),
    name: z.string().min(1, "名前を入力してください"),
    initialStack: z.number().int().positive("初期スタックは正の整数"),
    rebuyStack: z.number().int().positive().nullable().optional(),
    addOnStack: z.number().int().positive().nullable().optional(),
    lateEntryDeadlineLevel: z.number().int().positive(),
    levels: z.array(levelSchema).min(1, "レベルを最低 1 つ追加してください"),
  });

  // tournament.ts
  export const structureSnapshotSchema = z.object({
    name: z.string().min(1),
    initialStack: z.number().int().positive(),
    rebuyStack: z.number().int().positive().nullable().default(null),   // 新規
    addOnStack: z.number().int().positive().nullable().default(null),   // 新規
    lateEntryDeadlineLevel: z.number().int().positive(),
    levels: z.array(levelSchema).min(1),
  });
  ```
- **MIRROR**: 既存の `levelSchema` の構造を保持。`.default()` は parse 時に未定義を埋めるため旧 doc を自動受容
- **IMPORTS**: `z`, `Timestamp`（既存）
- **GOTCHA**:
  - `bb: z.number().int().positive()` → `nonnegative()` に緩和。プレイレベルの bb>0 は superRefine で別途担保
  - `rebuyStack/addOnStack` は `null` と `undefined` の両方を受け入れる。`.nullable().default(null)` で書き込み時は null、読込時は null
  - zodConverter の fromFirestore は parse 結果を UI に渡すため、旧 doc は parse 時点で `isBreak: false, rebuyStack: null, addOnStack: null` が補完される
- **VALIDATE**:
  - `levelSchema.parse({ level: 1, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true })` が成功
  - `levelSchema.parse({ level: 1, sb: 25, bb: 0, ante: 0, durationSec: 600 })` は superRefine で失敗（bb=0 かつ !isBreak）
  - `structureBodySchema.parse({ ...旧 doc without rebuyStack/addOnStack, createdAt: ts })` が成功し、`rebuyStack === null / addOnStack === null` が返る

### Task 2: createStructure repository の rebuy/addOn 正規化

- **ACTION**: `src/lib/firebase/repositories/structures.ts` の `createStructure` で undefined を null に正規化
- **IMPLEMENT**:
  ```ts
  export async function createStructure(input: CreateStructureInput): Promise<string> {
    try {
      const ref = await addDoc(structuresRef, {
        ...input,
        rebuyStack: input.rebuyStack ?? null,
        addOnStack: input.addOnStack ?? null,
        createdAt: serverTimestamp(),
      });
      // ...
    }
  }
  ```
- **MIRROR**: 既存 [src/lib/firebase/repositories/structures.ts:29-42](src/lib/firebase/repositories/structures.ts#L29-L42)
- **IMPORTS**: 既存のまま
- **GOTCHA**: Firestore は `undefined` を黙って drop する。書込パスで必ず `null` に正規化しておかないと、後続 read で schema validation が失敗（null 許容しているなら OK だが明示する方が安全）
- **VALIDATE**: createStructure 実行後、Firestore console で doc に rebuyStack/addOnStack フィールドが `null` として存在

### Task 3: StructureForm に rebuy/addon 入力を追加

- **ACTION**: `src/components/structure/StructureForm.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  interface StructureFormInitialValue {
    name: string;
    initialStack: number;
    rebuyStack: number | null;    // 新規
    addOnStack: number | null;    // 新規
    lateEntryDeadlineLevel: number;
    levels: Level[];
  }

  const DEFAULT_INITIAL: StructureFormInitialValue = {
    name: "",
    initialStack: 10000,
    rebuyStack: null,
    addOnStack: null,
    lateEntryDeadlineLevel: 6,
    levels: [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
    ],
  };

  const [rebuyStack, setRebuyStack] = useState<number | null>(initialValue.rebuyStack);
  const [addOnStack, setAddOnStack] = useState<number | null>(initialValue.addOnStack);

  // UI に入力欄追加
  <div className="space-y-2">
    <Label htmlFor="s-rebuy">リバイ スタック（任意）</Label>
    <Input
      id="s-rebuy"
      type="number"
      min={1}
      value={rebuyStack ?? ""}
      onChange={(e) => {
        const v = e.target.value.trim();
        setRebuyStack(v === "" ? null : Number.parseInt(v, 10) || null);
      }}
    />
  </div>
  // addOnStack も同様
  ```
- **MIRROR**: 既存の [StructureForm.tsx:96-144](src/components/structure/StructureForm.tsx#L96-L144) の入力欄パターンに並べる
- **IMPORTS**: 既存のまま（`Level` 型に isBreak 追加済）
- **GOTCHA**:
  - rebuy/addon は空欄（null）も valid。`value ?? ""` で controlled input を維持
  - 既存 test が `DEFAULT_INITIAL` の形状に依存している場合は型追加を反映
- **VALIDATE**: `/structures/new` で rebuy/addon を空欄のまま保存 → Firestore doc に `rebuyStack: null, addOnStack: null` で保存される

### Task 4: LevelTable に isBreak チェックボックスを追加

- **ACTION**: `src/components/structure/LevelTable.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  // thead に列追加
  <th className="px-2 py-1">BREAK</th>

  // 各行
  <td className="px-2 py-1 text-center">
    <input
      type="checkbox"
      checked={l.isBreak}
      onChange={(e) => {
        const isBreak = e.target.checked;
        const next = levels.map((row, i) =>
          i === index
            ? (isBreak
                ? { ...row, isBreak: true, sb: 0, bb: 0, ante: 0 }  // ブレイク化で blind をリセット
                : { ...row, isBreak: false, bb: Math.max(1, row.bb) })
            : row
        );
        onChange(next);
      }}
      aria-label={`level-${l.level}-is-break`}
    />
  </td>

  // sb/bb/ante の Input を isBreak で disabled
  <Input ... disabled={l.isBreak} />

  // addRow: isBreak: false をデフォルト
  const base: Level = last ? { ...last, level: levels.length + 1, isBreak: false } : { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false };
  ```
- **MIRROR**: 既存の LevelTable 行描画パターン（[LevelTable.tsx:73-124](src/components/structure/LevelTable.tsx#L73-L124)）
- **IMPORTS**: 変更なし
- **GOTCHA**:
  - isBreak 切替時に sb/bb/ante を自動リセット（0 化）しないと、zod superRefine で `!isBreak && bb <= 0` に引っかかる再編集フローで保存時エラー
  - 同時に isBreak → false に戻した場合は bb = 0 のままで save が失敗するため、最低 `bb = 1` を復元する
  - aria-label を付けて test で取れるようにする
- **VALIDATE**: ブレイクチェック ON → sb/bb/ante が disabled 表示 + 0 になる → 保存成功。OFF に戻すと bb=1 が復元される

### Task 5: TimerDisplay を BREAK 表示に対応

- **ACTION**: `src/components/tournament/TimerDisplay.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  {current ? (
    current.isBreak ? (
      <div className="flex items-center gap-2 text-2xl font-semibold text-amber-700 dark:text-amber-400">
        <span aria-hidden>☕</span>
        <span>BREAK</span>
      </div>
    ) : (
      <div className="text-base text-muted-foreground">
        SB {current.sb} / BB {current.bb} / Ante {current.ante}
      </div>
    )
  ) : null}

  {next ? (
    next.isBreak ? (
      <div className="text-sm text-muted-foreground">Next: Lv {next.level} (☕ BREAK)</div>
    ) : (
      <div className="text-sm text-muted-foreground">
        Next: Lv {next.level} ({next.sb} / {next.bb}
        {next.ante > 0 ? ` / ante ${next.ante}` : ""})
      </div>
    )
  ) : ...}
  ```
- **MIRROR**: 既存 [TimerDisplay.tsx:79-92](src/components/tournament/TimerDisplay.tsx#L79-L92) の `{current ? ... : null}` 分岐
- **IMPORTS**: 変更なし
- **GOTCHA**:
  - preview level（setup / seating 中）でも `previewLevel.isBreak` を見る
  - ダークモード対応: `text-amber-700 dark:text-amber-400`
- **VALIDATE**:
  - Lv1 が `isBreak: true` の tournament を作成 → タイマー開始 → 画面に「☕ BREAK」表示
  - TimerDisplay.test.tsx に `isBreak: true` ケースを追加

### Task 6: AverageStackCard コンポーネント新設（TimerDisplay の枠外に独立配置）

- **ACTION**: `src/components/tournament/AverageStackCard.tsx` を新規作成（**TimerDisplay とは独立した Card コンポーネント**。TimerDisplay 本体には手を入れない）
- **IMPLEMENT**:
  ```tsx
  "use client";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  import { Card, CardContent } from "@/components/ui/card";

  interface Props {
    tournament: TournamentDoc;
    players: PlayerDoc[];
    className?: string;
  }

  /**
   * 平均スタック表示。
   *  - state が running / paused のとき、かつ参加者が 1 人以上いるときのみ表示
   *  - 計算: totalChips = totalEntries * initialStack
   *          average = totalChips / activePlayers
   *  - リバイ／アドオン実操作は未実装のため、snapshot 値は計算に使わない（参考表示のみ）
   */
  export function AverageStackCard({ tournament, players, className }: Props) {
    if (tournament.state !== "running" && tournament.state !== "paused") return null;
    if (players.length === 0) return null;
    const active = players.filter((p) => !p.isBusted);
    if (active.length === 0) return null;
    const initialStack = tournament.structureSnapshot.initialStack;
    const totalChips = players.length * initialStack;
    const average = Math.floor(totalChips / active.length);
    return (
      <Card className={className}>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div>
            <div className="text-xs text-muted-foreground">平均スタック</div>
            <div className="font-mono text-2xl font-bold tabular-nums">
              {average.toLocaleString()}
            </div>
          </div>
          <div className="text-xs text-muted-foreground text-right">
            <div>参加 {players.length} / 残 {active.length}</div>
            <div>初期 {initialStack.toLocaleString()}</div>
          </div>
        </CardContent>
      </Card>
    );
  }
  ```
- **MIRROR**: 既存の [TimerDisplay.tsx:55-94](src/components/tournament/TimerDisplay.tsx#L55-L94) のセクション構造、shadcn/ui Card
- **IMPORTS**: `PlayerDoc`, `TournamentDoc`, `Card`, `CardContent`
- **GOTCHA**:
  - `active.length === 0` の早期 return は必須（Infinity 回避）
  - `totalChips` の計算式を差替えやすいよう props 設計は疎に（将来 rebuy/addOn events 集計ベース化可能）
  - toLocaleString は default でカンマ区切り
- **VALIDATE**:
  - setup / seating / finished では非表示
  - players 空で非表示
  - 20 人参加・5 人残の場合 `Math.floor(20 × 10000 / 5) = 40000` が表示される

### Task 7: ダッシュボード / live に AverageStackCard を差込

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` と `src/app/tournaments/[tid]/live/live-client.tsx` を更新。**AverageStackCard は TimerDisplay の兄弟要素として配置する**（TimerDisplay の内部に入れ子にしない）
- **IMPLEMENT**:
  ```tsx
  // dashboard-client.tsx, TimerDisplay の直下に独立カードとして追加
  <TimerDisplay tournament={data} remainingMs={remainingMs} levelInfo={levelInfo} />
  <AverageStackCard tournament={data} players={players} />

  // live-client.tsx, TimerDisplay の直下に独立カードとして追加
  <TimerDisplay tournament={tournament} remainingMs={remainingMs} levelInfo={levelInfo} className="w-full max-w-md" />
  <AverageStackCard tournament={tournament} players={players} className="w-full max-w-md" />
  ```
- **MIRROR**: 既存の [dashboard-client.tsx:247-289](src/app/tournaments/[tid]/dashboard-client.tsx#L247-L289) と [live-client.tsx:112-119](src/app/tournaments/[tid]/live/live-client.tsx#L112-L119)
- **IMPORTS**: `AverageStackCard`
- **GOTCHA**:
  - live-client は既に players を subscribe している（me 判定用）。そのまま渡す
  - TimerDisplay 本体の JSX には手を入れない。AverageStackCard を入れ子にすると Tailwind の中心寄せに引きずられるため、必ず兄弟要素として配置
- **VALIDATE**: running 中のトーナメントでダッシュボードと live の両方に「平均スタック: X,XXX」が TimerDisplay と別枠で表示される

### Task 8: AuthProvider に refreshUser を追加

- **ACTION**: `src/lib/firebase/AuthProvider.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  import { useCallback, useMemo, useReducer, useEffect, useState, createContext, useContext, type ReactNode } from "react";

  type AuthState = { user: User | null; loading: boolean; refreshUser: () => void };

  const AuthContext = createContext<AuthState>({
    user: null,
    loading: true,
    refreshUser: () => {},
  });

  export function AuthProvider({ children }: { children: ReactNode }) {
    const [state, setState] = useState<{ user: User | null; loading: boolean }>({
      user: null,
      loading: true,
    });
    // Phase 4.7: updateProfile は onAuthStateChanged を再発火させないため、
    // 明示的な bump で再レンダを強制する。
    const [bump, force] = useReducer((x: number) => x + 1, 0);

    useEffect(() => {
      const unsubscribe = onAuthStateChanged(
        firebaseAuth,
        (user) => setState({ user, loading: false }),
        (error) => {
          const code = error instanceof FirebaseError ? error.code : "auth/unknown";
          logger.error("auth state change error", { code, message: error.message });
          setState({ user: null, loading: false });
        },
      );
      return unsubscribe;
    }, []);

    const refreshUser = useCallback(() => {
      force();
    }, []);

    // bump を依存に含めることで value が毎回新しい参照になり、consumer が再描画される。
    const value = useMemo<AuthState>(
      () => ({
        user: firebaseAuth.currentUser ?? state.user,
        loading: state.loading,
        refreshUser,
      }),
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [state, bump, refreshUser],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
  }
  ```
- **MIRROR**: 既存の [AuthProvider.tsx:11-32](src/lib/firebase/AuthProvider.tsx#L11-L32)
- **IMPORTS**: `useCallback`, `useMemo`, `useReducer`
- **GOTCHA**:
  - 他の場所で `useAuthUser()` を destructure している箇所は変更不要（追加プロパティは無視される）
  - `firebaseAuth.currentUser` は updateProfile 直後なら新 displayName を持つ（同じ User オブジェクトを mutate するため）
  - `bump` を useMemo の依存に入れることで、同じ User 参照でも value 全体が新オブジェクトになり consumer が再描画される
- **VALIDATE**:
  - ダミー flow: signInAsGuest → updateProfile → refreshUser 呼出 → AuthBadge が再描画して新 displayName 表示
  - Unit test: mock user の displayName を変え、refreshUser を呼んで consumer の render 回数が増えることを確認

### Task 9: signInAsGuest / registerWithEmail / updateDisplayName の呼出側で refreshUser を呼ぶ

- **ACTION**: 以下の箇所を更新
  - `src/app/join/[tid]/join-client.tsx` — `joinAsGuest` の呼出後
  - `src/app/settings/settings-client.tsx` — `updateDisplayName` の呼出後
  - `src/app/login/login-client.tsx` — `registerWithEmail` の呼出後
- **IMPLEMENT**:
  ```tsx
  // join-client.tsx
  const { user, loading: authLoading, refreshUser } = useAuthUser();
  // ...
  const result = await joinAsGuest({ tid, displayName: parsed.data.displayName });
  refreshUser();  // ヘッダの "ゲスト: xxx" 表示を即更新
  setStatus({ kind: "joined", result });

  // settings-client.tsx
  const { user, refreshUser } = useAuthUser();
  // ...
  await updateDisplayName(displayName);
  refreshUser();
  setStatus({ kind: "saved" });

  // login-client.tsx
  const { refreshUser } = useAuthUser();
  if (mode === "register") {
    await registerWithEmail(email, password, displayName);
    refreshUser();
  }
  ```
- **MIRROR**: それぞれの既存 try/catch パターン
- **IMPORTS**: `useAuthUser` は既に import 済
- **GOTCHA**:
  - `auth-actions.ts` 内で refreshUser を呼ぶ設計にはしない（service 層は hook を知らない）。呼出側（client component）で trigger する
  - refreshUser は idempotent なので副作用を気にする必要はない
- **VALIDATE**:
  - ゲスト参加 → ヘッダ即座に「ゲスト: なつき」表示
  - `/settings` で displayName 変更 → ヘッダ即座に反映
  - 新規登録直後にトーナメント一覧に遷移しても displayName が既に反映

### Task 10: signInWithGoogle を isNewUser 判定付きの戻り値に変更

- **ACTION**: `src/lib/services/auth-actions.ts` を更新
- **IMPLEMENT**:
  ```ts
  import { getAdditionalUserInfo } from "firebase/auth";

  export interface GoogleSignInResult {
    user: User;
    isNewUser: boolean;
  }

  export async function signInWithGoogle(): Promise<GoogleSignInResult> {
    const provider = new GoogleAuthProvider();
    try {
      const cred = await signInWithPopup(firebaseAuth, provider);
      const additional = getAdditionalUserInfo(cred);
      const isNewUser = additional?.isNewUser ?? false;
      // 新規ユーザーは users/{uid} がまだ存在しない状態（displayName ダイアログで後から書込）。
      // 既存ユーザーは Google プロフィールで上書きしない（サークル用 displayName が設定済みのため）。
      if (!isNewUser && cred.user.displayName) {
        await upsertUserProfile({
          uid: cred.user.uid,
          displayName: cred.user.displayName,
          email: cred.user.email ?? null,
        });
      }
      logger.info("google sign-in ok", { uid: cred.user.uid, isNewUser });
      return { user: cred.user, isNewUser };
    } catch (e) {
      // 既存の AccountLinkRequired 分岐はそのまま維持（wrapAuthError も据え置き）
      if (e instanceof FirebaseError && e.code === "auth/account-exists-with-different-credential") {
        // ... 既存ロジック据え置き ...
      }
      const wrapped = wrapAuthError(e, "auth/google-failed", "Google ログインに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: 既存の [auth-actions.ts:127-168](src/lib/services/auth-actions.ts#L127-L168)
- **IMPORTS**: `getAdditionalUserInfo`
- **GOTCHA**:
  - 既存呼出箇所が 2 箇所（`login-client.tsx` と `receipt.ts` の `joinViaGoogle`）。受け渡しの戻り値型変更に追従させる
  - `joinViaGoogle` は isNewUser を使わない（受付フローは displayName ダイアログ不要、Google の名前をそのまま使う判断）
  - **破壊的変更**のため、呼出側全修正と同時にコミット
- **VALIDATE**:
  - 新規 Google ログイン → `isNewUser: true` 戻り
  - 既存 Google ログイン → `isNewUser: false` 戻り
  - 既存ユーザーでは `upsertUserProfile` が**実行されない**（displayName 上書き防止）

### Task 11: receipt.ts の joinViaGoogle 戻り値対応

- **ACTION**: `src/lib/services/receipt.ts` の `joinViaGoogle` を更新
- **IMPLEMENT**:
  ```ts
  export async function joinViaGoogle({ tid }: { tid: string }): Promise<ReceiptResult> {
    const { user } = await signInWithGoogle();  // isNewUser は受付 flow では無視
    const result = await ensurePlayerCreated(tid, user);
    logger.info("join via google ok", { tid, uid: user.uid, result });
    return result;
  }
  ```
- **MIRROR**: [receipt.ts:106-111](src/lib/services/receipt.ts#L106-L111)
- **IMPORTS**: 変更なし
- **GOTCHA**: 受付 flow では displayName ダイアログを挟まない
- **VALIDATE**: QR から Google で join → Google プロフィール名でエントリー登録される（現行と同じ）

### Task 12: DisplayNameDialog コンポーネント新設 + login-client で発火

- **ACTION**: `src/components/auth/DisplayNameDialog.tsx` を新規作成、`src/app/login/login-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  // DisplayNameDialog.tsx
  "use client";
  import { useState } from "react";
  import { Button } from "@/components/ui/button";
  import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { AppError } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { logger } from "@/lib/logger";
  import { updateDisplayName } from "@/lib/services/auth-actions";

  interface Props {
    open: boolean;
    onDone: () => void;   // 成功時のみ呼ばれる。dialog は close できず、設定完了後のみ dismiss
    initialName?: string;
  }

  export function DisplayNameDialog({ open, onDone, initialName = "" }: Props) {
    const { refreshUser } = useAuthUser();
    const [name, setName] = useState(initialName);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function onSave(e: React.FormEvent) {
      e.preventDefault();
      setSubmitting(true);
      setError(null);
      try {
        await updateDisplayName(name);
        refreshUser();
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
        {/* onOpenChange を渡さず閉じられないようにする */}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>表示名を設定</DialogTitle>
            <DialogDescription>
              サークルで使うニックネームを入力してください。後から /settings でも変更できます。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={onSave} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="dn">表示名</Label>
              <Input id="dn" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive" role="alert">{error}</p> : null}
            <DialogFooter>
              <Button type="submit" disabled={submitting}>
                {submitting ? "保存中…" : "保存"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  // login-client.tsx
  async function onGoogleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const { isNewUser } = await signInWithGoogle();
      if (isNewUser) {
        setDisplayNameDialogOpen(true);
        return;  // redirect は dialog の onDone で行う
      }
      router.replace(redirect);
    } catch (e) { /* ... */ }
    finally { setSubmitting(false); }
  }

  // render
  {displayNameDialogOpen ? (
    <DisplayNameDialog
      open={displayNameDialogOpen}
      initialName=""
      onDone={() => {
        setDisplayNameDialogOpen(false);
        router.replace(redirect);
      }}
    />
  ) : null}
  ```
- **MIRROR**: 既存の [LinkAccountDialog](src/components/auth/LinkAccountDialog.tsx) パターン
- **IMPORTS**: shadcn/ui Dialog, `updateDisplayName`, `useAuthUser`
- **GOTCHA**:
  - `onOpenChange` を渡さないことで dialog を閉じられなくする（X ボタン / backdrop クリックで escape 不可）
  - 匿名ユーザーは本 flow の対象外（join で別 flow）
  - 登録中断で `users/{uid}` 未作成のままでも、次回ログイン時に再度 isNewUser 判定が true → ダイアログ再表示。UX としては望ましい
- **VALIDATE**:
  - 新規 Google ログイン → ダイアログ表示 → 表示名入力して保存 → `/tournaments` などに redirect
  - 既存 Google ログイン → ダイアログ表示されず直接 redirect

### Task 13: structure-edit-client の rebuy/addOn initialValue 対応

- **ACTION**: `src/app/structures/[sid]/edit/structure-edit-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  <StructureForm
    initialValue={{
      name: doc.name,
      initialStack: doc.initialStack,
      rebuyStack: doc.rebuyStack ?? null,
      addOnStack: doc.addOnStack ?? null,
      lateEntryDeadlineLevel: doc.lateEntryDeadlineLevel,
      levels: doc.levels,
    }}
    groupId={doc.groupId}
    createdByUid={doc.createdByUid}
    onSubmit={...}
  />
  ```
- **MIRROR**: [structure-edit-client.tsx](src/app/structures/[sid]/edit/structure-edit-client.tsx)
- **IMPORTS**: 既存のまま
- **GOTCHA**: 旧 doc（rebuyStack/addOnStack 未設定）は schema の default で null に補完されるため型崩れしない
- **VALIDATE**: 既存 structure を edit 画面で開き、rebuy/addon 欄が空欄（null）として表示される

### Task 14: Tests — schema / TimerDisplay / AverageStackCard / timer service

- **ACTION**: 以下の test ファイルを更新・新設
  - `src/lib/firebase/schemas/index.test.ts` UPDATE（levelSchema / structureBodySchema の拡張受容）
  - `src/components/tournament/TimerDisplay.test.tsx` UPDATE（BREAK 表示）
  - `src/components/tournament/AverageStackCard.test.tsx` CREATE
  - `src/lib/services/timer.test.ts` UPDATE（既存あれば追記）
- **IMPLEMENT**:
  ```ts
  // schemas/index.test.ts
  it("levelSchema: accepts legacy doc without isBreak (defaults to false)", () => {
    const parsed = levelSchema.parse({ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 });
    expect(parsed.isBreak).toBe(false);
  });

  it("levelSchema: accepts break level with bb=0", () => {
    const parsed = levelSchema.parse({ level: 5, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true });
    expect(parsed.isBreak).toBe(true);
  });

  it("levelSchema: rejects play level with bb=0", () => {
    const r = levelSchema.safeParse({ level: 5, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: false });
    expect(r.success).toBe(false);
  });

  it("structureBodySchema: accepts legacy doc without rebuyStack/addOnStack", () => {
    const parsed = structureBodySchema.parse({
      groupId: "g1", createdByUid: "u1", name: "s",
      initialStack: 10000, lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 }],
      createdAt: Timestamp.fromMillis(0),
    });
    expect(parsed.rebuyStack).toBeNull();
    expect(parsed.addOnStack).toBeNull();
  });

  // AverageStackCard.test.tsx
  it("shows average for 20 players with 5 active and initial 10000", () => {
    render(<AverageStackCard tournament={makeTournament({ state: "running" })} players={[/* 20 players, 5 !isBusted */]} />);
    expect(screen.getByText(/40,000/)).toBeInTheDocument();
  });

  it("does not render when state is setup", () => {
    const { container } = render(<AverageStackCard tournament={makeTournament({ state: "setup" })} players={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when no active players", () => {
    const { container } = render(<AverageStackCard tournament={makeTournament({ state: "running" })} players={[/* all busted */]} />);
    expect(container).toBeEmptyDOMElement();
  });
  ```
- **MIRROR**: [src/lib/services/timer.test.ts](src/lib/services/timer.test.ts), [src/components/tournament/TimerDisplay.test.tsx](src/components/tournament/TimerDisplay.test.tsx)
- **IMPORTS**: vitest, @testing-library/react, makeTournament / makePlayer helpers
- **GOTCHA**:
  - `render` のために jsdom が必要（既存 vitest 設定で対応済み）
  - Timestamp を import して mock に使う — 既存テスト同様
- **VALIDATE**: `npm test -- --run` で全 test pass、新規追加 10+ 件の assertion が green

### Task 14b: group.memberDisplayNames schema + repository + service 拡張

- **ACTION**: 以下を更新
  - `src/lib/firebase/schemas/group.ts` に `memberDisplayNames` フィールド追加
  - `src/lib/firebase/repositories/groups.ts` に `setMemberDisplayName` / 既存関数の map 同期を追加
  - `src/lib/services/group.ts` の `consumeJoinCode` で自分の entry を書込、`propagateDisplayNameToGroups` を新設
  - `src/lib/services/auth-actions.ts` の `updateDisplayName` から propagate を best-effort 呼出
- **IMPLEMENT**:
  ```ts
  // schemas/group.ts
  export const groupBodySchema = z
    .object({
      name: z.string().min(1).max(60),
      ownerUids: z.array(z.string().min(1)).min(1),
      organizerUids: z.array(z.string().min(1)).min(1),
      memberUids: z.array(z.string().min(1)).min(1),
      createdAt: z.instanceof(Timestamp),
      joinCodeId: z.string().min(1).nullable().optional(),
      // Phase 4.7: uid → displayName のマップ snapshot。旧 doc は default({}) で受容。
      // rule 側は self-key 書込のみ許可（diff().affectedKeys().hasOnly([auth.uid])）。
      memberDisplayNames: z.record(z.string().min(1), z.string()).default({}),
    })
    .refine(...)  // 既存 invariant 維持

  // repositories/groups.ts
  import { FieldValue, deleteField } from "firebase/firestore";

  export async function setMemberDisplayName(
    gid: string,
    uid: string,
    displayName: string,
  ): Promise<void> {
    try {
      await updateDoc(groupDocRef(gid), {
        [`memberDisplayNames.${uid}`]: displayName,
      });
      logger.info("group member displayName set ok", { gid, uid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "メンバー表示名の更新に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, gid, uid });
      throw wrapped;
    }
  }

  // removeMemberSelf: memberDisplayNames の自キーも deleteField で削除
  export async function removeMemberSelf(gid: string, uid: string): Promise<void> {
    try {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayRemove(uid),
        organizerUids: arrayRemove(uid),
        ownerUids: arrayRemove(uid),
        [`memberDisplayNames.${uid}`]: deleteField(),
      });
      logger.info("group remove member ok", { gid, uid });
    } catch (e) { /* ... */ }
  }

  // services/group.ts
  export async function consumeJoinCode({ code, uid }: { code: string; uid: string }) {
    // ... 既存ロジック ...
    const authUser = firebaseAuth.currentUser;
    const displayName = authUser?.displayName?.trim() || authUser?.email || uid;
    await runTransaction(firestore, async (tx) => {
      // ... 既存の codeDoc / groupDoc 操作 ...
      tx.update(codeRef, { usesCount: increment(1) });
      tx.update(groupRef, {
        memberUids: arrayUnion(uid),
        joinCodeId: code,
        [`memberDisplayNames.${uid}`]: displayName,
      });
    });
    // ...
  }

  /**
   * 自分の displayName を所属全 group の memberDisplayNames に反映する。
   * best-effort — 個別 group の書込失敗は warn で握りつぶし、updateDisplayName 全体は throw しない。
   */
  export async function propagateDisplayNameToGroups(
    uid: string,
    groupIds: readonly string[],
    displayName: string,
  ): Promise<void> {
    const results = await Promise.allSettled(
      groupIds.map((gid) => setMemberDisplayName(gid, uid, displayName)),
    );
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) {
      logger.warn("propagate displayName partial fail", {
        uid, total: groupIds.length, failed, code: "group/propagate-partial-fail",
      });
    }
  }

  // services/auth-actions.ts
  export async function updateDisplayName(newName: string): Promise<void> {
    // ... 既存の updateProfile + upsertUserProfile ...
    // Phase 4.7: 所属全 group の memberDisplayNames に反映（best-effort）
    const profile = await getUserProfile(user.uid);
    const groupIds = profile?.groupIds ?? [];
    if (groupIds.length > 0) {
      await propagateDisplayNameToGroups(user.uid, groupIds, trimmed).catch((e) => {
        logger.warn("propagateDisplayNameToGroups failed", {
          code: "group/propagate-failed", uid: user.uid,
        });
      });
    }
    logger.info("display name updated", { uid: user.uid });
  }
  ```
- **MIRROR**: 既存の [groups.ts:132-145 (removeMemberSelf)](src/lib/firebase/repositories/groups.ts#L132-L145)、[group.ts:56-116 (consumeJoinCode)](src/lib/services/group.ts#L56-L116)、[auth-actions.ts:230-252 (updateDisplayName)](src/lib/services/auth-actions.ts#L230-L252)
- **IMPORTS**: `deleteField`, 既存 repo/service
- **GOTCHA**:
  - `memberDisplayNames.${uid}` の dot-path 構文で map の特定キーのみ書込できる（Firestore SDK 機能）
  - `consumeJoinCode` の transaction 内で map 書込する際も dot-path OK
  - `propagateDisplayNameToGroups` は `Promise.allSettled` で一部失敗を許容。rule が未デプロイ状態でも他処理をブロックしない
  - auth-actions は service 層のため、呼出は `firebaseAuth.currentUser.uid` を直接使わず parameter で受け取る設計（`services/group.ts` 側）
- **VALIDATE**:
  - `consumeJoinCode` で加入 → 対象 group doc の `memberDisplayNames[自分 uid]` に値がある
  - `updateDisplayName("新しい名前")` 後、所属全 group の map が更新されている
  - group メンバーから脱退 → map から自分の entry が消える

### Task 14c: Firestore Rules に memberDisplayNames 関連条件を追加

- **ACTION**: `firestore.rules` の groups update の 3 経路（self-add / self-leave / owner-full）すべてで `memberDisplayNames` の整合性条件を追加し、**新規 4 つ目の経路「self-key update」**を追加
- **IMPLEMENT**:
  ```js
  // groups update 全体を書き直し
  allow update: if (
    // 1. owner update（name / ロール配列 / memberUids / memberDisplayNames 自由、createdAt 不変）
    isSignedIn()
    && request.auth.uid in resource.data.ownerUids
    && request.resource.data.ownerUids.size() >= 1
    && request.resource.data.createdAt == resource.data.createdAt
    // memberDisplayNames は owner なら自由に書込可（運用上名前の整理に使える）
  ) || (
    // 2. self-add（招待コード経由の加入）— 一般メンバーとして加入 + 自分の displayName を map に追加
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
    && request.resource.data.joinCodeId is string
    && hasValidJoinCodeConsumption(gid, request.resource.data.joinCodeId)
    // memberDisplayNames: 自分の entry を追加（他人の entry は変更しない）
    && request.resource.data.memberDisplayNames
         .diff(resource.data.get('memberDisplayNames', {}))
         .affectedKeys()
         .hasOnly([request.auth.uid])
  ) || (
    // 3. self-leave（非 owner のみ）— 自分を各配列 / map から除去
    isSignedIn()
    && request.auth.uid in resource.data.memberUids
    && !(request.auth.uid in resource.data.ownerUids)
    && !(request.auth.uid in request.resource.data.memberUids)
    && !(request.auth.uid in request.resource.data.organizerUids)
    && request.resource.data.memberUids.size() == resource.data.memberUids.size() - 1
    && resource.data.memberUids.hasAll(request.resource.data.memberUids)
    && (...既存 organizerUids の条件...)
    && request.resource.data.ownerUids == resource.data.ownerUids
    && request.resource.data.name == resource.data.name
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.joinCodeId == resource.data.joinCodeId
    // memberDisplayNames: 自分の entry だけ削除（他は不変）
    && request.resource.data.memberDisplayNames
         .diff(resource.data.get('memberDisplayNames', {}))
         .affectedKeys()
         .hasOnly([request.auth.uid])
  ) || (
    // 4. (新規) self-key displayName update — 既メンバーが自分の displayName entry を更新
    isSignedIn()
    && request.auth.uid in resource.data.memberUids
    && request.resource.data.memberUids == resource.data.memberUids
    && request.resource.data.organizerUids == resource.data.organizerUids
    && request.resource.data.ownerUids == resource.data.ownerUids
    && request.resource.data.name == resource.data.name
    && request.resource.data.createdAt == resource.data.createdAt
    && request.resource.data.joinCodeId == resource.data.joinCodeId
    && request.resource.data.memberDisplayNames
         .diff(resource.data.get('memberDisplayNames', {}))
         .affectedKeys()
         .hasOnly([request.auth.uid])
  );
  ```
- **MIRROR**: 既存 [firestore.rules:68-118 (groups update)](firestore.rules#L68-L118)
- **IMPORTS**: N/A
- **GOTCHA**:
  - 旧 doc は `memberDisplayNames` フィールド未設定の可能性があるため `resource.data.get('memberDisplayNames', {})` で default {} を与えて diff を取る
  - rule v2 の `MapDiff.affectedKeys()` は map 全体で差分を取り、`hasOnly([auth.uid])` で自キーのみ変更を担保
  - self-add rule は join code 消費 + memberUids 追加 + memberDisplayNames 追加を **atomic** に検証（request 1 回で完結）
- **VALIDATE**:
  - 非メンバーが招待コード経由で加入 → memberUids / joinCodeId / memberDisplayNames[auth.uid] が atomic に書き込まれる
  - 既メンバーが自分の displayName を group で更新 → self-key update ルールで通る
  - 既メンバーが他人の displayName を書き換えようとする → diff のキーに 2 uid 含まれ denied
  - 未デプロイ時の旧コードは schema default でフィールドなしでも動作する（backward compatible）

### Task 14d: group-detail-client.tsx の UI 切替

- **ACTION**: `src/app/groups/[gid]/group-detail-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  // 既存 reload の getUserProfile loop を廃止し、group.memberDisplayNames から直接取る
  const reload = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const g = await getGroup(gid);
      setGroup(g);
      setRenameValue(g.name);
      const lines: MemberLine[] = g.memberUids.map((uid) => ({
        uid,
        displayName: g.memberDisplayNames?.[uid] ?? uid,
      }));
      setMembers(lines);
    } catch (e) { /* ... */ }
  }, [gid, user]);

  // import から getUserProfile を削除
  ```
- **MIRROR**: [group-detail-client.tsx:69-90](src/app/groups/[gid]/group-detail-client.tsx#L69-L90)
- **IMPORTS**: `getUserProfile` 削除（他で使っていなければ）
- **GOTCHA**:
  - 旧 doc のメンバーは `memberDisplayNames[uid]` が undefined のため uid 表示になる。各ユーザーが自分で rename したタイミングで backfill される（軽微な手順で解決、README に「dry-run 前に運営 3 人ほど各自 /settings で displayName を保存しよう」と明記）
  - `Promise.allSettled` が不要になり render は高速化
- **VALIDATE**:
  - 3 人 group で各自が自分の表示名を保存 → `/groups/{gid}` 一覧で 3 人とも displayName 表示
  - 旧 doc で誰も操作していない状態 → UID が残る（想定通り・運用で解消）

### Task 14e: トーナメント一覧カードの状態別色分け

- **ACTION**: `src/app/tournaments/tournaments-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  import type { TournamentState } from "@/lib/firebase/schemas/tournament";

  type Tone = {
    border: string;
    badge: string;
    label: string;
    dim?: boolean;
  };

  function toneForState(state: TournamentState): Tone {
    switch (state) {
      case "running":
      case "paused":
        return {
          border: "border-emerald-400 dark:border-emerald-500",
          badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
          label: state === "paused" ? "一時停止" : "進行中",
        };
      case "finished":
        return {
          border: "border-muted",
          badge: "bg-muted text-muted-foreground",
          label: "終了",
          dim: true,
        };
      case "setup":
      case "seating":
      default:
        return {
          border: "border-slate-300 dark:border-slate-600",
          badge: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
          label: state === "seating" ? "席決め中" : "未開催",
        };
    }
  }

  // render 部分
  {items.map((t) => {
    const tone = toneForState(t.state);
    return (
      <Card
        key={t.id}
        className={cn(
          "transition border-2",
          tone.border,
          tone.dim ? "opacity-70 hover:opacity-100" : "hover:bg-accent/30",
        )}
      >
        <CardHeader>
          <CardTitle>{t.name}</CardTitle>
          <CardDescription>
            <span className={cn("mr-2 rounded px-2 py-0.5 text-xs", tone.badge)}>
              {tone.label}
            </span>
            {t.structureSnapshot.levels.length} レベル / 初期{" "}
            {t.structureSnapshot.initialStack}
          </CardDescription>
        </CardHeader>
        {/* CardContent は既存のまま */}
      </Card>
    );
  })}
  ```
- **MIRROR**: [tournaments-client.tsx:88-118](src/app/tournaments/tournaments-client.tsx#L88-L118)
- **IMPORTS**: `TournamentState`, `cn`
- **GOTCHA**:
  - ダークモードでも視認性を保つため `dark:` 変種を明示
  - `finished` は opacity 70% でトーンダウン、hover で 100% に戻して読みやすく
  - 既存の state 文字列（"setup" / "seating" / "running" / "paused" / "finished"）が直接ユーザーに見える問題も同時に解消（日本語ラベル化）
- **VALIDATE**:
  - 3 種類の状態の tournament を並べた `/tournaments` で色分けが視認できる
  - `ConnectionBadge` や他の CardDescription 要素との衝突なし
  - モバイル幅でもカードが縮まず色分けが機能する

### Task 15: PRD 更新 & 既存文書のリンク差替

- **ACTION**: `.claude/PRPs/prds/allin-timer.prd.md` の Phase 4.7 行を 5 items scope に更新
- **IMPLEMENT**:
  - Phase 4.7 scope 記述から「ストラクチャテンプレート」を削除
  - 新規 Phase 4.8 エントリ（次 plan で詳細記述）の存在を明示
  - Phase 5 の Depends を `3, 4, 4.5, 4.6, 4.7, 4.8` に更新
- **MIRROR**: 既存の Phase 4.6 エントリ
- **IMPORTS**: N/A
- **GOTCHA**: 本タスクは計画書の最終化と同時に行う
- **VALIDATE**: `cat .claude/PRPs/prds/allin-timer.prd.md | grep -E "4\.(7|8)"` で両 phase が出力される

### Task 16: lint / typecheck / build 確認

- **ACTION**: 検証コマンド実行
- **IMPLEMENT**: ターミナルで以下を順次実行
- **MIRROR**: Phase 4.6 の validation 手順
- **IMPORTS**: N/A
- **GOTCHA**:
  - `npm run typecheck` で schema 拡張の型整合を検証
  - `npm run lint` で `console.*` 残置がないか確認
  - `npm run build` で Next.js ページ生成が通るか確認
  - test 追加により vitest 全件 pass
- **VALIDATE**: 全コマンド exit 0

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| levelSchema parse (legacy) | `{level:1, sb:25, bb:50, ante:0, durationSec:600}` | `isBreak === false` | 旧 doc 受容 |
| levelSchema parse (break) | `{level:5, sb:0, bb:0, ante:0, durationSec:300, isBreak:true}` | parse success | break 有効 |
| levelSchema parse (invalid) | `{level:5, sb:0, bb:0, ante:0, durationSec:300, isBreak:false}` | safeParse → success: false | break なし bb=0 禁止 |
| structureBodySchema parse (legacy) | doc without rebuy/addOn | `rebuyStack===null, addOnStack===null` | defaults |
| AverageStackCard | state=running, 20 players (5 active), initial 10000 | "40,000" 表示 | 標準 |
| AverageStackCard | state=setup | 非表示 (empty container) | 非対応 state |
| AverageStackCard | active=0 | 非表示 | 0 除算回避 |
| TimerDisplay (break) | isBreak: true | "☕ BREAK" 表示 / SB,BB 非表示 | break 表示 |
| TimerDisplay (play) | isBreak: false | "SB 100 / BB 200 / Ante 0" 表示 | 通常 |
| groupBodySchema parse (legacy) | doc without memberDisplayNames | `memberDisplayNames === {}` | default |
| propagateDisplayNameToGroups | 3 groups all succeed | 3 setMemberDisplayName 呼出 | 標準 |
| propagateDisplayNameToGroups | 1 group fail | 他 2 件 success、warn log 出力、throw しない | best-effort |
| toneForState(state) | "running" | emerald border + "進行中" label | running |
| toneForState(state) | "setup" | slate border + "未開催" label | setup |
| toneForState(state) | "finished" | muted + dim true + "終了" label | finished |

### Edge Cases Checklist

- [x] 既存 doc（rebuyStack / addOnStack / isBreak 未設定）の schema parse が成功
- [x] break level (bb=0) の保存が zod validation を通る
- [x] 旧コードが書いた rebuy/addOn 未設定 doc → zodConverter 経由で null に正規化
- [x] Google sign-in の new user / existing user の両分岐
- [x] signInAsGuest 後の refreshUser 呼出でヘッダ即反映
- [x] 平均スタック: active 0 人で非表示
- [x] 平均スタック: totalChips が Number.MAX_SAFE_INTEGER を超えない
- [x] DisplayNameDialog は backdrop / escape で閉じられない
- [x] DisplayNameDialog を放置して離脱 → 次回ログインで再表示
- [x] break level の auto-advance が機能する（isBreak に依存しない既存 shouldAutoAdvance）
- [x] 旧 groups doc が `memberDisplayNames` フィールド未設定でも schema parse が成功し UI が動作する（uid フォールバック）
- [x] self-key memberDisplayNames 更新: 他人の entry を含む書込は rule で deny
- [x] propagateDisplayNameToGroups: 一部 group で失敗しても他処理をブロックしない（best-effort）
- [x] `/tournaments` 一覧: 状態 5 種類すべて（setup / seating / running / paused / finished）で意図通りの配色とラベル
- [x] ダークモードで tournament カード色分けが視認できる

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors（新規型 `GoogleSignInResult` / AuthState 拡張が解決する）

### Lint

```bash
npm run lint
```

EXPECT: No warnings（`console.*` 残置禁止・existing patterns 遵守）

### Unit Tests

```bash
npm test -- --run
```

EXPECT: 全 test pass（既存 315 件 + 新規 10〜12 件、合計 325〜327 件）

### Build

```bash
npm run build
```

EXPECT: Next.js 全ページ生成成功

### Manual Browser Validation

```bash
npm run dev
```

Then perform:

- [ ] **Item 1**: 新規 Google アカウントでログイン → 表示名ダイアログ表示 → "テスト太郎" 入力・保存 → `/tournaments` 遷移 → ヘッダに "テスト太郎" 表示
- [ ] **Item 1**: 既存 Google アカウントで再ログイン → ダイアログ表示されず直接遷移
- [ ] **Item 2**: 新規匿名アカウントで `/join/{tid}` → 表示名 "なつき" 入力・ゲスト参加 → ヘッダに即座に "ゲスト: なつき" 表示（ページリロードなし）
- [ ] **Item 3**: `/structures/new` に rebuyStack / addOnStack 入力欄 → 空欄 OK / 数値 OK で保存 → Firestore console で確認
- [ ] **Item 4**: running 中のトーナメント → ダッシュボード / live に「平均スタック: X,XXX」が TimerDisplay 枠外の独立カードで表示 → バストで active 減少 → 平均上昇 → 0 人で非表示
- [ ] **Item 5**: Lv5 が break の tournament → Lv5 到達時 TimerDisplay が "☕ BREAK" 表示 → duration 経過で auto-advance → Lv6 で通常表示
- [ ] **Item 6**: ユーザー A でサークル作成 → 招待コード発行 → 別アカウント B で join → A から `/groups/{gid}` を開くと B の displayName が表示される（uid ではない）
- [ ] **Item 6**: A が `/settings` で displayName を変更 → 同じ `/groups/{gid}` を開くと A の entry が新名で更新されている（propagate）
- [ ] **Item 6**: 既存（旧 rule デプロイ前）の group に対し、新 rule デプロイ後に誰も操作していない → UID 表示が残る（想定通り）。各ユーザーが /settings で displayName を保存するタイミングで順次 backfill される
- [ ] **Item 7**: setup / seating / running / paused / finished のトーナメントを並べた `/tournaments` 一覧で、カード border 色と badge が状態ごとに意図通り表示される → finished カードは半透明で hover すると不透明化

### Firestore Rules

Phase 4.7 は groups の update rule に **memberDisplayNames self-key 書込**の条件を追加する（他 collection は変更なし）。デプロイが必要:

```bash
# ローカル emulator で rule テスト（任意・推奨）
firebase emulators:start --only firestore
# 別ターミナルで手動確認:
#   - self-add (join via code) で memberDisplayNames[auth.uid] のみ追加される → OK
#   - self-key update で memberDisplayNames[auth.uid] のみ変更 → OK
#   - 他人の uid の entry を書換しようとする → denied
#   - 既存の self-leave / owner-full update も引き続き通る

# 本番反映
firebase deploy --only firestore:rules
```

EXPECT:
- groups update rule の self-add / self-leave / owner-full / 新規 self-key update の 4 経路がすべて動作
- 他 collection (users / structures / tournaments / groupJoinCodes) のルールは変更なし

---

## Acceptance Criteria

- [ ] 全 20 タスク（Task 1〜14、14b〜14e、15〜16）完了
- [ ] `npm run typecheck` / `lint` / `test -- --run` / `build` が全 green
- [ ] 7 件の改善項目（memo-08: 1, 3, 4, 5, 6 + memo-09: 1, 2）それぞれについて手動ブラウザ検証が通る
- [ ] 既存（Phase 4.6 までの）doc が schema 拡張後も読書できる（migration なしで動く）
- [ ] PRD の Implementation Phases テーブルに Phase 4.7 が in-progress、Phase 4.8 が pending で載っている

## Completion Checklist

- [ ] Code follows discovered patterns（AppError / logger / zod schema / repository）
- [ ] Error handling matches codebase style（wrapAuthError / AppError.from）
- [ ] Logging follows codebase conventions（logger.info / warn、code 付与）
- [ ] Tests follow test patterns（vi.hoisted / makeTournament ヘルパー）
- [ ] No hardcoded values
- [ ] No unnecessary scope additions（テンプレート図書館は Phase 4.8 へ明確に分離）
- [ ] Documentation updated（PRD）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `levelSchema` の bb 制約緩和（positive→nonnegative）で他箇所の前提が崩れる | L | M | superRefine で `!isBreak && bb <= 0` を禁止 → 既存呼出は全てプレイレベル（bb>0）のため影響なし。seating engine / balancing は `bb` を参照しない |
| `refreshUser` の実装が単純な setState では React が diff 検出せず再描画しない | M | M | useReducer で forceUpdate する実装に倒す（Task 8）。実装時に test でヘッダ再描画を確認 |
| `getAdditionalUserInfo` が `linkWithCredential` 経由の Google リンクで `null` を返す | L | L | `additional?.isNewUser ?? false` でフェイルセーフ。link 経路は既存ユーザー前提のため isNewUser=false で問題ない |
| rebuy/addOn が null で保存された doc を将来の rebuy 実操作 (v1.1) で扱うときに再 migration 必要 | L | L | Phase 4.7 では保存/表示のみ。rebuy 実操作を作る v1.1 plan で schema を `.default(0)` 等に変更する選択が可能 |
| 平均スタックにリバイ／アドオンを加算する将来要望 | M | S | 本 Phase では計算式を固定。将来要望は events 集計で加算する形に差替え可能。`AverageStackCard` の props 設計を疎にしておく |
| `isBreak: true` のまま auto-advance が「BREAK は手動で advance したい」要望と衝突 | L | S | 本 Phase では auto-advance 維持。将来必要なら `Level.breakMode: "auto"|"manual"` を optional 追加 |
| memberDisplayNames の rule 条件が複雑化し既存の self-add / self-leave / owner update を壊す | M | H | 4 経路すべてを emulator で個別検証してから本番 deploy。特に self-add は「招待コード消費 + memberUids 追加 + memberDisplayNames 追加」の atomic 検証が崩れないかを重点確認 |
| propagateDisplayNameToGroups が 10 groups で呼ばれ書込量が急増 | L | L | 20 人 × 月 1-2 回スケールなら個人が所属する group 数は 1-3 が現実的。10 groups は想定外 |
| 旧 group doc の memberDisplayNames が未設定で UI が uid 表示のまま残る | H | S | README の dry-run 準備手順に「運営各自が /settings で displayName を保存」を追加。自動 migration しない判断（仕様として許容） |
| 状態色分けでアクセシビリティ（色覚対応）が不十分 | M | S | 色だけでなく**日本語ラベル**（進行中 / 未開催 / 終了）で区別するため、色覚依存しない。opacity / アイコンも補助 |

## Notes

- **互換レイヤは作らない**（Phase 2.5 / 4.6 の方針踏襲）: 本 Phase は schema additive のみのため、互換レイヤ不要。旧 doc は zod default で自動的に新フィールドが null/false に埋まる
- **Google 既存ユーザーの displayName 上書きをやめる**（Task 10）ことで、サークル用ニックネーム設定済みユーザーが Google プロフィールを変更しても dashboardu 表示が維持される副次効果がある
- **平均スタックの計算式**: リバイ / アドオン実装前の暫定式（`initialStack × totalEntries ÷ activePlayers`）。v1.1 で rebuy/addOn の events を集計する形に差替予定
- **ブレイクの扱い**: TDA rule 上は「ブラインドレベルの延長として break を挟むか、独立したレベルとして扱うか」は運営者の裁量。本実装は「独立したレベル + isBreak フラグ」方式。level 番号は連番を維持
- **テンプレート図書館は Phase 4.8**: `structureTemplates` / `templateAdmins` collection、`/templates` ページ、rule 追加、管理者 bootstrap を含む。Phase 4.7 の `levelSchema.isBreak` / `structureBodySchema.rebuyStack/addOnStack` を re-use するため 4.7 → 4.8 の順で実装する
- **memberDisplayNames の snapshot 方式を採用した理由**: `users/{uid}` の rule を public read に緩和する案は email 等の他フィールドも露出するためリスクが高い。Phase 4.8 の `createdByDisplayName` と同じ snapshot パターンに揃えることで、rule 変更の影響範囲を最小化しつつプライバシーも維持
- **dry-run 準備手順に displayName backfill を追記**: Phase 4.7 デプロイ後、運営 3 人程度が各自 `/settings` で自分の displayName を保存することで各 group の memberDisplayNames が自動 backfill される。README の Phase 4.7 migration section に明記予定（Task 15 で）
- **Codex レビュー対策**: 本計画書は CLAUDE.md 記載の通り Codex レビュー対象。実装時は各 Task の IMPLEMENT / GOTCHA を Codex コメントで参照されやすいよう、コード内コメントも同文脈を要約しておく
