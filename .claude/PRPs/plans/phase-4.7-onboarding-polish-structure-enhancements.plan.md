# Plan: Phase 4.7 — Onboarding Polish & Structure Enhancements

## Summary

実投入直前の 6 つの UX / 機能ペインを一括解消する。Google 新規ログインとゲスト参加での displayName 取り扱いを整理し、初心者運営者向けにストラクチャテンプレートと「ブレイク」レベルを追加、トーナメントにリバイ／アドオン用のチップ量フィールドと平均スタック表示を導入する。既存データは additive に拡張し、破壊的 migration は行わない（zod `default` / `optional` で旧 doc を受容）。

## User Story

As a サークル運営者（初心者・ポーカー歴浅め）,
I want Google でログインしても表示名をサークル用ニックネームに設定でき、運営者側が用意したストラクチャのテンプレートから開始でき、トーナメント進行中にブレイクを挟んだり平均スタックを見られる状態,
So that 本名を晒さずにサークルを回せ、ストラクチャ設計に悩まず、進行中も TDA 相当の情報（平均スタック・ブレイク）を参加者に示せる。

And as a サークル参加者（ゲスト匿名）,
I want ゲスト参加時に入力した表示名がヘッダと受付一覧に即座に反映される,
So that 自分のアカウントが正しく認識されているか確認できる。

## Problem → Solution

**Current state (Phase 4.6 完了時点)**:

1. **Google 新規ログイン**: アカウントが無い状態で Google ログインすると Google プロフィールの本名がそのまま displayName として保存される。変更は `/settings` から個別操作が必要で、**初参加者は本名が参加者一覧に載る**リスクがある。
2. **ストラクチャ初期設定**: `/structures/new` はゼロからの編集のみ。初心者運営者は「SB/BB/持続時間をどう設定すればいいか」が分からず設計で詰まる。
3. **ゲスト参加後の header 表示**: 匿名参加で `signInAsGuest` → `updateProfile(displayName)` 後、`onAuthStateChanged` は再発火しないため [AuthBadge.tsx:42-44](src/components/auth/AuthBadge.tsx#L42-L44) は `displayName = null` のままになり「ゲスト: （名前未設定）」と表示される（次回の auth 状態変化まで）。
4. **チップ量設定**: ストラクチャに `initialStack` しかなく、リバイ／アドオンのスタック量を事前に記録できない。
5. **平均スタック**: 計算式（総チップ ÷ 未バスト人数）が画面に出ていない。運営者が暗算する必要がある。
6. **ブレイク**: `levels: [{sb, bb, ante, durationSec}]` のみで「ブレイク（休憩）」を levels 配列の中に表現する手段がない。ブラインド 0/0 でごまかせば一応止められるが、UI に「BREAK」と表示されないため参加者に伝わらない。

**Desired state (Phase 4.7 完了時点)**:

1. Google 新規ログイン時、`users/{uid}` が未作成のユーザーには **「表示名設定ダイアログ」を必須表示**。既存ユーザーは自動 skip。
2. `/structures/new` に **テンプレート選択セクション**を追加。3〜4 種のプリセット（例: 標準 20min・ターボ 10min・ディープ 30min）をクリックすると各フィールドが埋まる。テンプレートはクライアントバンドル内の定数（新規コレクション不要）。
3. `signInAsGuest` / `registerWithEmail` / `updateDisplayName` の直後に **AuthProvider の `refreshUser()` を呼び、React state を `firebaseAuth.currentUser` の最新値で置換**。ヘッダの displayName が即反映される。
4. `structures.{rebuyStack, addOnStack}` と同等の `structureSnapshot.{rebuyStack, addOnStack}` を **nullable number** として追加。UI にも入力欄追加。トーナメント側では参照表示のみ（リバイ／アドオン実操作は v1.1 以降）。
5. `/tournaments/{tid}` ダッシュボードと `/live` の TimerDisplay 下に **「平均スタック: X,XXX」** カードを追加。計算式は `(totalEntries × initialStack) ÷ activePlayers`（リバイ／アドオン管理は未実装のため初期スタック基準）。
6. `levelSchema` に **`isBreak: z.boolean().default(false)`** を追加。LevelTable に「ブレイク」チェックボックスを追加。TimerDisplay は `isBreak === true` のレベルを **「BREAK」表示**に切替（SB/BB/Ante は隠す）。auto-advance は既存通り動作。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **Source memo**: [tmp/08_Phase4.6_memo.md](../../../tmp/08_Phase4.6_memo.md)
- **PRD Phase**: Phase 4.7 — Onboarding Polish & Structure Enhancements（Phase 4.6 完了後・Phase 5 前）
- **Estimated Files**: 約 18 files（新規 3・編集 15・削除 0）

---

## UX Design

### Item 1 & 3（Google 新規ログイン displayName / ゲスト header）

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

### Item 2（ストラクチャテンプレート）

```
/structures/new （After）
┌─────────────────────────────────────────────────────┐
│ ストラクチャを新規作成                                │
│                                                      │
│ ── テンプレートから読み込む（任意） ──                │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐                │
│ │ 標準    │ │ ターボ  │ │ ディープ│                │
│ │ 20min   │ │ 10min   │ │ 30min   │                │
│ │ Lv×15   │ │ Lv×15   │ │ Lv×20   │                │
│ │ 初期1万 │ │ 初期5千 │ │ 初期3万 │                │
│ └─────────┘ └─────────┘ └─────────┘                │
│                                                      │
│ ── 編集 ──                                           │
│ ストラクチャ名: [__________]                         │
│ 初期スタック:  [______]                              │
│ リバイ:       [______]     ← 新設 (任意)             │
│ アドオン:     [______]     ← 新設 (任意)             │
│ 締切 Lv:      [__]                                   │
│                                                      │
│ ブラインド構造:                                      │
│ Lv SB BB Ant 分 BREAK[ ] [×]  ← チェックで休憩       │
│  1 25 50 0  10  [ ]       [×]                        │
│  2 ...                                               │
│ [+ レベル追加]                                       │
└─────────────────────────────────────────────────────┘
```

### Item 5（平均スタック表示）

```
/tournaments/{tid} ダッシュボード（After）
┌──────────────────────────────────────┐
│ [TimerDisplay]                       │
│                                      │
│ Lv 3  [進行中]                       │
│  08:42                               │
│  SB 100 / BB 200 / Ante 0            │
│  Next: Lv 4 (150 / 300)              │
│                                      │
│ ── チップ情報 ── ← 新設              │
│ 平均スタック: 12,500                 │
│ 参加 15 / 残 12 (初期 10,000)         │
└──────────────────────────────────────┘
```

### Item 6（ブレイクレベル表示）

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

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| Google 新規ログイン | 直接 redirect | displayName 入力ダイアログ → redirect | 既存ユーザー (users/{uid} 存在) はダイアログ skip |
| ゲスト参加後ヘッダ | `displayName = null` のまま | 即 displayName 反映 | AuthProvider.refreshUser を呼出 |
| `/structures/new` | 空フォームのみ | テンプレート選択ボタン群 + 空フォーム | テンプレート適用後もフィールドは全て編集可能 |
| `/structures/new` フィールド | 初期スタックのみ | 初期 / リバイ / アドオン の 3 入力 | リバイ / アドオンは任意（空欄 OK） |
| LevelTable 各行 | SB/BB/Ante/分/削除 | + ブレイクチェックボックス | チェック時 SB/BB/Ante の編集は disabled に |
| TimerDisplay | SB/BB/Ante 常時表示 | `isBreak === true` の level は「☕ BREAK」のみ | Next は従来どおり |
| ダッシュボード / live | タイマーのみ | + 平均スタックカード（running/paused 時） | 0 人時は非表示 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | スキーマ拡張・zod 三点同期・repository 規約 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | AppError ラップ / logger 経由出力の徹底 |
| P0 | [.claude/rules/group-membership.md](../../rules/group-membership.md) | all | Phase 4.6 のロール判定。`/structures/new` は organizer only の前提を維持 |
| P0 | [src/lib/firebase/schemas/structure.ts](../../../src/lib/firebase/schemas/structure.ts) | all | `levelSchema` と `structureBodySchema` に additive 拡張 |
| P0 | [src/lib/firebase/schemas/tournament.ts](../../../src/lib/firebase/schemas/tournament.ts) | all | `structureSnapshotSchema` にも同拡張を伝播 |
| P0 | [src/lib/firebase/AuthProvider.tsx](../../../src/lib/firebase/AuthProvider.tsx) | all | `refreshUser` を expose する context 拡張 |
| P0 | [src/lib/services/auth-actions.ts](../../../src/lib/services/auth-actions.ts) | 127-207 | Google sign-in の「新規 vs 既存」判定追加、refresh トリガ |
| P0 | [src/components/auth/AuthBadge.tsx](../../../src/components/auth/AuthBadge.tsx) | 42-44 | 匿名 label は user.displayName 依存。refresh で解消される |
| P0 | [src/components/structure/StructureForm.tsx](../../../src/components/structure/StructureForm.tsx) | all | rebuy/addon 入力欄とテンプレート適用ロジック |
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

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firebase Auth `additionalUserInfo.isNewUser` | [firebase.google.com/docs/reference/js/auth.additionaluserinfo](https://firebase.google.com/docs/reference/js/auth.additionaluserinfo) | `getAdditionalUserInfo(UserCredential)` で `isNewUser` を取得可。Google provider の初回ログイン判定に使える |
| `onIdTokenChanged` vs `onAuthStateChanged` | [firebase.google.com/docs/reference/js/auth.auth.md#authonidtokenchanged](https://firebase.google.com/docs/reference/js/auth.auth.md#authonidtokenchanged) | `updateProfile` は **どちらにも発火しない**。手動で state refresh する必要がある |
| zod `default` / `optional` | [zod.dev/?id=default](https://zod.dev/?id=default) | `z.boolean().default(false)` は parse 時に未定義を false に置換。既存データ受容に利用 |

```
KEY_INSIGHT: updateProfile は onAuthStateChanged を再発火させない
APPLIES_TO: Item 3 / Task 5 (AuthProvider refresh)
GOTCHA: user.reload() 後に onIdTokenChanged が fire するケースもあるが保証されない。AuthProvider 側で setState({ user: firebaseAuth.currentUser }) を呼ぶ方式が最も確実

KEY_INSIGHT: Google sign-in の「新規 vs 既存」判定は `additionalUserInfo.isNewUser` か `users/{uid}` doc 存在チェックのどちらか
APPLIES_TO: Item 1 / Task 4 (signInWithGoogle 分岐)
GOTCHA: `additionalUserInfo` は `getAdditionalUserInfo(cred)` を `signInWithPopup` の戻り値に対して呼ぶ必要あり。リンク経由 (linkGoogleWithPassword) では適用されない点に注意

KEY_INSIGHT: schema 拡張は `z.default(false)` / `.optional()` で旧 doc を受容
APPLIES_TO: Item 4, 6 / Task 1 (schema 拡張)
GOTCHA: `.default()` は parse 時点で値を埋めるため zodConverter 経由で読んだ UI は `isBreak === false` を受け取る。書込側でも undefined ではなく false/null を明示して integrity を保つ

KEY_INSIGHT: 平均スタックはリバイ／アドオンなしでも算出できる
APPLIES_TO: Item 5 / Task 8 (平均スタックカード)
GOTCHA: 分母は activePlayers = players.filter(p => !p.isBusted).length。0 人時は非表示（Infinity 回避）。totalChips = totalEntries * initialStack（リバイ/アドオン入力欄があっても実操作は未実装のため snapshot 値は計算に使わない）

KEY_INSIGHT: isBreak レベルも durationSec で auto-advance する
APPLIES_TO: Item 6 / Task 7 (BREAK UI)
GOTCHA: shouldAutoAdvance は state / levelStartedAt / remaining のみを見ているため isBreak の区別不要。break だけ特別に「手動 advance 必須」にしたい場合は別途分岐を追加するが、本 Phase では自動進行を維持する
```

---

## Patterns to Mirror

### NAMING_CONVENTION (client-side templates / constants)

```ts
// SOURCE: src/components/structure/StructureForm.tsx:27-35
const DEFAULT_INITIAL: StructureFormInitialValue = {
  name: "",
  initialStack: 10000,
  lateEntryDeadlineLevel: 6,
  levels: [
    { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 },
    { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600 },
  ],
};
// Phase 4.7: src/lib/data/structure-templates.ts に Template 配列として複数追加。
// 同じ StructureFormInitialValue 型を再利用（id と displayLabel を添えるだけ）。
```

### ZOD_ADDITIVE_EXTENSION

```ts
// SOURCE: src/lib/firebase/schemas/structure.ts:4-10 （Phase 4.7 追加形式）
export const levelSchema = z.object({
  level: z.number().int().positive(),
  sb: z.number().int().nonnegative(),
  bb: z.number().int().positive(),
  ante: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
  // Phase 4.7 追加: default(false) で旧 doc を受容。書込時は常に明示 false / true を送る。
  isBreak: z.boolean().default(false),
});
// NOTE: break level は bb > 0 制約と衝突する（ブレイクは bb=0 にしたい）。
//   → superRefine で `isBreak === true の場合は sb/bb/ante の制約を緩和` する or
//     bb は break 時でも 1 で通す（UI 表示は isBreak 優先で隠す）
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

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => setState({ user, loading: false }),
      (error) => { /* ... */ setState({ user: null, loading: false }); },
    );
    return unsubscribe;
  }, []);

  // Phase 4.7 追加: updateProfile 後に呼び出して手動で React state を最新化する。
  // onAuthStateChanged は updateProfile で再 fire しないため、従来は表示名変更がヘッダに反映されなかった。
  const refreshUser = useCallback(() => {
    setState({ user: firebaseAuth.currentUser, loading: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
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
// Phase 4.7: input に rebuyStack / addOnStack が optional に含まれる。addDoc に直接渡すのみで OK。
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
      name: "s", initialStack: 10000, lateEntryDeadlineLevel: 6,
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
| `src/lib/firebase/schemas/structure.ts` | UPDATE | `levelSchema.isBreak` 追加、`structureBodySchema.rebuyStack/addOnStack` 追加（いずれも default/optional） |
| `src/lib/firebase/schemas/tournament.ts` | UPDATE | `structureSnapshotSchema` に `rebuyStack / addOnStack` を伝播 |
| `src/components/structure/StructureForm.tsx` | UPDATE | rebuy/addon 入力、テンプレート選択、initialValue の拡張 |
| `src/components/structure/LevelTable.tsx` | UPDATE | 各行にブレイクチェックボックス。isBreak === true の行は sb/bb/ante を disabled にする |
| `src/lib/data/structure-templates.ts` | CREATE | 3〜4 種のプリセット配列。`{ id, label, description, initialValue }` 構造 |
| `src/components/structure/StructureTemplatePicker.tsx` | CREATE | テンプレートカード UI（`/structures/new` でのみ表示） |
| `src/app/structures/new/structure-new-client.tsx` | UPDATE | `StructureTemplatePicker` を差込、`StructureForm` の initialValue を controlled に |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx` | UPDATE | edit 画面は template picker 非表示、initialValue に rebuy/addon を含める |
| `src/lib/firebase/AuthProvider.tsx` | UPDATE | `refreshUser: () => void` を context に追加 |
| `src/lib/services/auth-actions.ts` | UPDATE | `signInWithGoogle` が `{ user, isNewUser }` を返す形に変更、`updateDisplayName` は refresh と併用（呼び出し側で refreshUser を呼ぶ） |
| `src/app/login/login-client.tsx` | UPDATE | Google sign-in 戻り値の `isNewUser` を見て `DisplayNameDialog` を開く |
| `src/components/auth/DisplayNameDialog.tsx` | CREATE | displayName 入力必須ダイアログ。`updateDisplayName` → `refreshUser()` → 親の `onDone` コールバック |
| `src/app/settings/settings-client.tsx` | UPDATE | `updateDisplayName` 後に `refreshUser()` を呼び出し、ヘッダ即反映を保証 |
| `src/app/join/[tid]/join-client.tsx` | UPDATE | `joinAsGuest` 呼出後に `refreshUser()` を呼ぶ |
| `src/components/tournament/TimerDisplay.tsx` | UPDATE | `isBreak === true` の level は `☕ BREAK` 表示に切替、Next は従来通り |
| `src/components/tournament/AverageStackCard.tsx` | CREATE | 平均スタックカード。props: `{ players, initialStack }` を受け取り、running/paused 時に計算表示 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | `<AverageStackCard />` を TimerDisplay 直下に追加 |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | 同様に live でも表示 |
| `src/components/tournament/TimerDisplay.test.tsx` | UPDATE | BREAK 表示ケースを追加 |
| `src/components/tournament/AverageStackCard.test.tsx` | CREATE | 平均計算・0 人時非表示テスト |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | `levelSchema.isBreak` default false の受容、rebuy/addon optional の受容テスト |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Phase 4.7 行を Implementation Phases に追加、Phase 5 の Depends に 4.7 を追加 |
| `.claude/rules/group-membership.md` | UPDATE（軽微） | 該当なし。参照不変 |

## NOT Building

- **サークル間でのストラクチャコピー機能** (memo item 2 の「運営権限を持っているサークル間であればストラクチャ設定をコピー可能」): クライアントバンドル内のテンプレートで「悩まない」要件は満たせるため、**cross-group copy 機能は実装しない**。将来必要なら Phase 5+ で `POST /api/structures/clone` 相当を追加
- **システム提供サークル（全員が強制参加）**: 個別アカウントの強制所属は実運用で嫌がられる。テンプレートを定数で持つ方式が同じペインを解消する
- **リバイ／アドオン実操作（count up / スタック増加イベント）**: memo item 4 は「チップ量を設定できるようにしたい」であり、実操作は要求されていない。本 Phase では値の保存と表示のみ。実操作は v1.1 以降
- **ブレイクの専用タイマーモード（手動 advance / 延長）**: `isBreak === true` でも既存の `shouldAutoAdvance` に従って自動繰り上げ。手動 advance を強制したい場合は将来 `breakMode: "auto" | "manual"` を追加
- **displayName 必須チェックの Firestore rule 化**: rule で `users/{uid}.displayName` 未設定を弾く経路は作らない。UI ダイアログで強制するのみ（Phase 4.6 の方針に従い UI + service で担保）
- **Google sign-in のリンク経路（linkGoogleWithPassword）での displayName ダイアログ**: link は既存ユーザー同士の統合なので displayName はすでに設定済み。対象外
- **平均スタックにリバイ／アドオン量を加算**: リバイ／アドオン実操作が未実装のため、加算ロジックは持たない。計算式は `totalEntries × initialStack ÷ activePlayers` に固定
- **テンプレートの admin 編集 UI**: 定数ファイル直接編集で十分。テンプレートの追加変更は開発者 commit で行う

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
    bb: z.number().int().nonnegative(),  // M1: break で 0 を許容するため positive → nonnegative に緩和
    ante: z.number().int().nonnegative(),
    durationSec: z.number().int().positive(),
    isBreak: z.boolean().default(false),  // 新規
  }).superRefine((v, ctx) => {
    // play level では bb > 0 を維持する（break 以外で bb=0 は意味不明）
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
- **MIRROR**: 既存の `levelSchema` の構造を保持、refine で invariant 表現。`.default()` は parse 時に未定義を埋めるため旧 doc を自動受容
- **IMPORTS**: `z`, `Timestamp`（既存）
- **GOTCHA**:
  - `bb: z.number().int().positive()` → `nonnegative()` に緩和。プレイレベルの bb>0 は superRefine で別途担保
  - `rebuyStack/addOnStack` は `null` と `undefined` の両方を受け入れる。`.nullable().default(null)` で書き込み時は null、読込時は null
  - zodConverter の fromFirestore は parse 結果を UI に渡すため、旧 doc は parse 時点で `isBreak: false, rebuyStack: null, addOnStack: null` が補完される
- **VALIDATE**:
  - `levelSchema.parse({ level: 1, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true })` が成功
  - `levelSchema.parse({ level: 1, sb: 25, bb: 0, ante: 0, durationSec: 600 })` は superRefine で失敗（bb=0 かつ !isBreak）
  - `structureBodySchema.parse({ ...旧 doc without rebuyStack/addOnStack, createdAt: ts })` が成功し、`rebuyStack === null / addOnStack === null` が返る

### Task 2: createStructureInput / createStructure repository の rebuy/addon 伝搬

- **ACTION**: `src/lib/firebase/repositories/structures.ts` は変更不要（`...input` で既に spread されている）。ただし書込時に `rebuyStack/addOnStack` が undefined のまま渡ると Firestore は `undefined` を書かずフィールド欠落する。明示的 null を埋めて確実に null で書く
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
  `updateStructure` は部分更新なので patch をそのまま通す。UI 側で `rebuyStack: null` を明示する
- **MIRROR**: 既存 [src/lib/firebase/repositories/structures.ts:29-42](src/lib/firebase/repositories/structures.ts#L29-L42)
- **IMPORTS**: 既存のまま
- **GOTCHA**: Firestore は `undefined` を黙って drop する。書込パスで必ず `null` に正規化しておかないと、後続 read で schema validation が失敗（null 許容しているなら OK）
- **VALIDATE**: createStructure 実行後、Firestore console で doc に rebuyStack/addOnStack フィールドが `null` として存在

### Task 3: ストラクチャテンプレートの定数ファイル作成

- **ACTION**: `src/lib/data/structure-templates.ts` を新規作成
- **IMPLEMENT**:
  ```ts
  import type { Level } from "@/lib/firebase/schemas/structure";

  export interface StructureTemplate {
    id: string;
    label: string;
    description: string;
    initialStack: number;
    rebuyStack: number | null;
    addOnStack: number | null;
    lateEntryDeadlineLevel: number;
    levels: Level[];
  }

  /**
   * 運営初心者向けのプリセットストラクチャ集。クライアントバンドル内で配布し、
   * `/structures/new` の「テンプレートから読み込む」から適用する。
   *
   * 出典: TDA 公式ではなく一般的なライブキャッシュゲームの経験則。
   * Phase 4.7 時点では 3 種類で運用し、実地フィードバック後に Phase 5+ で調整する。
   */
  export const STRUCTURE_TEMPLATES: readonly StructureTemplate[] = [
    {
      id: "standard-20",
      label: "標準 (20 分 / Lv)",
      description: "平均的な進行。3〜4 時間のトーナメント向け。",
      initialStack: 10000,
      rebuyStack: 10000,
      addOnStack: 15000,
      lateEntryDeadlineLevel: 6,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 1200, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 1200, isBreak: false },
        { level: 3, sb: 75, bb: 150, ante: 0, durationSec: 1200, isBreak: false },
        { level: 4, sb: 100, bb: 200, ante: 25, durationSec: 1200, isBreak: false },
        { level: 5, sb: 0, bb: 0, ante: 0, durationSec: 600, isBreak: true },   // ☕ BREAK
        { level: 6, sb: 150, bb: 300, ante: 25, durationSec: 1200, isBreak: false },
        // ... 全 12 レベル程度
      ],
    },
    {
      id: "turbo-10",
      label: "ターボ (10 分 / Lv)",
      description: "短時間向け。2 時間で完走を目指す。",
      initialStack: 5000,
      rebuyStack: 5000,
      addOnStack: null,
      lateEntryDeadlineLevel: 4,
      levels: [ /* ... durationSec: 600 中心 ... */ ],
    },
    {
      id: "deep-30",
      label: "ディープ (30 分 / Lv)",
      description: "じっくり派向け。5 時間超の重厚な進行。",
      initialStack: 30000,
      rebuyStack: 30000,
      addOnStack: 40000,
      lateEntryDeadlineLevel: 8,
      levels: [ /* ... durationSec: 1800 中心 ... */ ],
    },
  ];
  ```
- **MIRROR**: 既存の `DEFAULT_INITIAL`（[StructureForm.tsx:27-35](src/components/structure/StructureForm.tsx#L27-L35)）と同じ型を踏襲
- **IMPORTS**: `Level` from schemas
- **GOTCHA**:
  - `isBreak: true` の行は sb/bb/ante = 0 で設定する（UI では隠す）
  - `durationSec` は break でも正の値必須（BREAK 時間）
  - template の `levels` は読み取り専用参照として扱い、適用時は structured clone（`levels.map(l => ({ ...l }))`）してから state に入れる
- **VALIDATE**: TypeScript 型チェックで Level の全フィールドが揃っていることを確認、`z.array(levelSchema).parse(template.levels)` が成功

### Task 4: StructureTemplatePicker コンポーネント新設

- **ACTION**: `src/components/structure/StructureTemplatePicker.tsx` を新規作成
- **IMPLEMENT**:
  ```tsx
  "use client";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { STRUCTURE_TEMPLATES, type StructureTemplate } from "@/lib/data/structure-templates";

  interface Props {
    onSelect: (template: StructureTemplate) => void;
  }

  export function StructureTemplatePicker({ onSelect }: Props) {
    return (
      <section aria-label="テンプレート選択" className="space-y-3">
        <h2 className="text-sm font-semibold text-muted-foreground">
          テンプレートから読み込む（任意）
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {STRUCTURE_TEMPLATES.map((t) => (
            <Card key={t.id} className="flex flex-col">
              <CardHeader>
                <CardTitle className="text-base">{t.label}</CardTitle>
                <CardDescription>{t.description}</CardDescription>
              </CardHeader>
              <CardContent className="mt-auto space-y-2 text-xs text-muted-foreground">
                <div>初期 {t.initialStack.toLocaleString()} / {t.levels.length} レベル</div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => onSelect(t)}
                >
                  このテンプレートを使う
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    );
  }
  ```
- **MIRROR**: shadcn/ui の Card パターンは [src/app/tournaments/tournaments-client.tsx:91-118](src/app/tournaments/tournaments-client.tsx#L91-L118) を参考
- **IMPORTS**: `Button`, `Card` 系（既存 shadcn/ui）、`STRUCTURE_TEMPLATES`
- **GOTCHA**: onSelect はフォームの state を置換する。ユーザー編集中のデータが上書きされるため、/structures/new でのみ表示し /edit では表示しない
- **VALIDATE**: `/structures/new` を開いて 3 枚のカードが表示され、クリックで下段フォームの initialStack / levels が切り替わる

### Task 5: StructureForm に rebuy/addon 入力とテンプレート適用ロジックを追加

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

  // props に controlled initialValue を許容（template 適用用）
  interface Props {
    initialValue?: StructureFormInitialValue;
    submitLabel?: string;
    groupId: string;
    createdByUid: string;
    onSubmit: (input: CreateStructureInput) => Promise<void>;
    onCancel?: () => void;
    // 追加: 親から props 経由で initialValue を切替可能にするため、key prop 用の resetKey
    resetKey?: string;
  }

  // state 初期化の useState 引数を initialValue に一本化
  const [name, setName] = useState(initialValue.name);
  const [initialStack, setInitialStack] = useState(initialValue.initialStack);
  const [rebuyStack, setRebuyStack] = useState<number | null>(initialValue.rebuyStack);
  const [addOnStack, setAddOnStack] = useState<number | null>(initialValue.addOnStack);
  // ...
  const [levels, setLevels] = useState<Level[]>(initialValue.levels);

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
  - テンプレート適用は親（`structure-new-client.tsx`）から resetKey を更新し、子の useState の初期値を再計算する。実装は `useEffect(() => setName(initialValue.name), [resetKey])` などで同期するか、`key={resetKey}` prop で component を unmount/remount する方が確実
  - 既存 test が `DEFAULT_INITIAL` の形状に依存している場合は型追加を反映
- **VALIDATE**: `/structures/new` で rebuy/addon を空欄のまま保存 → Firestore doc に `rebuyStack: null, addOnStack: null` で保存される

### Task 6: LevelTable に isBreak チェックボックスを追加

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

### Task 7: TimerDisplay を BREAK 表示に対応

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
  - テキストの折返し・色のコントラスト（ダークモード対応）。`text-amber-700 dark:text-amber-400`
  - preview level（setup / seating 中）でも `previewLevel.isBreak` を見る
- **VALIDATE**:
  - Lv1 が `isBreak: true` の tournament を作成 → タイマー開始 → 画面に「☕ BREAK」表示
  - TimerDisplay.test.tsx に `isBreak: true` ケースを追加

### Task 8: AverageStackCard コンポーネント新設

- **ACTION**: `src/components/tournament/AverageStackCard.tsx` を新規作成
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
  - リバイ／アドオンを後で加算するなら `totalChips` の計算式を `events` 集計ベースに差替える必要あり。現状は initialStack × 総参加のみ
  - toLocaleString は `"ja-JP"` 不要（default でカンマ区切り）
- **VALIDATE**:
  - setup / seating / finished では非表示
  - players 空で非表示
  - 20 人参加・5 人残の場合 `Math.floor(20 × 10000 / 5) = 40000` が表示される

### Task 9: ダッシュボード / live に AverageStackCard を差込

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` と `src/app/tournaments/[tid]/live/live-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  // dashboard-client.tsx, TimerDisplay の直下に追加
  <TimerDisplay tournament={data} remainingMs={remainingMs} levelInfo={levelInfo} />
  <AverageStackCard tournament={data} players={players} />

  // live-client.tsx, WinnerBanner の後 or TimerDisplay 直下
  <TimerDisplay tournament={tournament} remainingMs={remainingMs} levelInfo={levelInfo} className="w-full max-w-md" />
  <AverageStackCard tournament={tournament} players={players} className="w-full max-w-md" />
  ```
- **MIRROR**: 既存の [dashboard-client.tsx:247-289](src/app/tournaments/[tid]/dashboard-client.tsx#L247-L289) と [live-client.tsx:112-119](src/app/tournaments/[tid]/live/live-client.tsx#L112-L119)
- **IMPORTS**: `AverageStackCard`
- **GOTCHA**: live-client は既に players を subscribe している（me 判定用）。そのまま渡す
- **VALIDATE**: running 中のトーナメントでダッシュボードと live の両方に「平均スタック: X,XXX」が表示される

### Task 10: AuthProvider に refreshUser を追加

- **ACTION**: `src/lib/firebase/AuthProvider.tsx` を更新
- **IMPLEMENT**:
  ```tsx
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

    // Phase 4.7: updateProfile 後に手動で state を最新化する。
    // onAuthStateChanged は updateProfile では再 fire しないため、
    // displayName 変更後にヘッダ等へ反映させるにはこの refreshUser() を明示呼出する必要がある。
    const refreshUser = useCallback(() => {
      setState({ user: firebaseAuth.currentUser, loading: false });
    }, []);

    return (
      <AuthContext.Provider value={{ ...state, refreshUser }}>
        {children}
      </AuthContext.Provider>
    );
  }
  ```
- **MIRROR**: 既存の [AuthProvider.tsx:11-32](src/lib/firebase/AuthProvider.tsx#L11-L32)
- **IMPORTS**: `useCallback`
- **GOTCHA**:
  - 他の場所で `useAuthUser()` を destructure している箇所 (`const { user, loading } = useAuthUser()`) は変更不要（追加プロパティは無視される）
  - `firebaseAuth.currentUser` は updateProfile 直後なら新 displayName を持つ（同じ User オブジェクトを mutate するため）
  - setState で同じ User オブジェクトを渡すと React は diff 検出しない。そのため実際には `{ user: { ...firebaseAuth.currentUser } }` の spread は React に効かない（class instance のため）。**回避策**: `bumpKey` を数値で持ち、Context value を `{ user, loading, bumpKey }` にして consumer に bump を observe させる、または setState で新オブジェクト参照を渡す
  - **最も確実な実装**: `const [, force] = useReducer((x) => x + 1, 0)` を使い、`refreshUser` で `force()` を呼ぶ。これにより context の value 参照が毎回変わり consumer が再描画
- **VALIDATE**:
  - ダミー flow: signInAsGuest → updateProfile → refreshUser 呼出 → `useAuthUser().user.displayName` が新値になる
  - Unit test: mock user の displayName を変え、refreshUser を呼んで consumer の render 回数が増えることを確認

### Task 11: signInAsGuest / registerWithEmail / updateDisplayName の呼出側で refreshUser を呼ぶ

- **ACTION**: 以下の箇所を更新
  - `src/app/join/[tid]/join-client.tsx` — `joinAsGuest` の呼出後
  - `src/app/settings/settings-client.tsx` — `updateDisplayName` の呼出後
  - `src/app/login/login-client.tsx` — `registerWithEmail` の呼出後（displayName が更新された直後）
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
  // register flow
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

### Task 12: signInWithGoogle を isNewUser 判定付きの戻り値に変更

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
      // 既存の AccountLinkRequired 分岐はそのまま維持
      // ...
    }
  }
  ```
- **MIRROR**: 既存の [auth-actions.ts:127-168](src/lib/services/auth-actions.ts#L127-L168)
- **IMPORTS**: `getAdditionalUserInfo`
- **GOTCHA**:
  - 既存呼出箇所が 2 箇所（`login-client.tsx` と `receipt.ts` の `joinViaGoogle`）。受け渡しの戻り値型変更に追従させる
  - `joinViaGoogle` は isNewUser を使わない（受付フローは displayName ダイアログ不要、Google の名前をそのまま使う判断）。ただし新規ユーザーでも `users/{uid}` を作成する必要あり — `ensurePlayerCreated` が `upsertUserProfile` を呼ぶため実際には問題ない
  - **破壊的変更**のため、呼出側全修正と同時にコミット
- **VALIDATE**:
  - 新規 Google ログイン → `isNewUser: true` 戻り
  - 既存 Google ログイン → `isNewUser: false` 戻り
  - 既存ユーザーでは `upsertUserProfile` が**実行されない**（displayName 上書き防止）

### Task 13: DisplayNameDialog コンポーネント新設 + login-client で発火

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
        // redirect は dialog の onDone で行う
        return;
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
  - `onOpenChange` を渡さないことで dialog を閉じられなくする（X ボタン / backdrop クリックで escape 不可）。保存後のみ dismiss
  - 匿名ユーザーは本 flow の対象外（join で別 flow）
  - 登録中のエラーで user が中断したら `users/{uid}` は未作成のまま。次回ログイン時に再度 isNewUser 判定が true → ダイアログ再表示。UX としては望ましい（放置でも整合性は崩れない）
- **VALIDATE**:
  - 新規 Google ログイン → ダイアログ表示 → 表示名入力して保存 → `/tournaments` などに redirect
  - `/settings` に行き displayName が保存されていることを確認
  - 既存 Google ログイン → ダイアログ表示されず直接 redirect

### Task 14: receipt.ts の joinViaGoogle 戻り値対応

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
- **GOTCHA**:
  - 受付 flow では displayName ダイアログを挟まない（QR で来たゲストは Google プロフィール名のまま参加で OK、サークルメンバー化しない一時利用）
  - 必要なら将来 `joinViaGoogle` にも isNewUser 分岐を追加可能だが本 Phase の scope 外
- **VALIDATE**: QR から Google で join → Google プロフィール名でエントリー登録される（現行と同じ）

### Task 15: StructureForm の propagate — structure-new-client / structure-edit-client 更新

- **ACTION**: `src/app/structures/new/structure-new-client.tsx` と `src/app/structures/[sid]/edit/structure-edit-client.tsx` を更新
- **IMPLEMENT**:
  ```tsx
  // structure-new-client.tsx
  "use client";
  import { useState } from "react";
  import { StructureForm } from "@/components/structure/StructureForm";
  import { StructureTemplatePicker } from "@/components/structure/StructureTemplatePicker";
  import type { StructureTemplate } from "@/lib/data/structure-templates";
  // ...

  export function StructureNewClient() {
    const { user } = useAuthUser();
    const { currentGroupId, isOrganizer, loading } = useCurrentGroup();
    const router = useRouter();
    const [initialValue, setInitialValue] = useState(undefined);
    const [resetKey, setResetKey] = useState(0);

    // ロール gate（既存のまま）

    function applyTemplate(t: StructureTemplate) {
      setInitialValue({
        name: t.label,
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
          initialValue={initialValue}
          groupId={currentGroupId}
          createdByUid={user.uid}
          onSubmit={async (input) => {
            await createStructure(input);
            router.push("/structures");
          }}
          onCancel={() => router.push("/structures")}
          submitLabel="作成"
        />
      </main>
    );
  }

  // structure-edit-client.tsx — template picker を出さず initialValue を既存 doc から渡す
  <StructureForm
    initialValue={{
      name: doc.name,
      initialStack: doc.initialStack,
      rebuyStack: doc.rebuyStack ?? null,
      addOnStack: doc.addOnStack ?? null,
      lateEntryDeadlineLevel: doc.lateEntryDeadlineLevel,
      levels: doc.levels,
    }}
    ...
  />
  ```
- **MIRROR**: [structure-new-client.tsx](src/app/structures/new/structure-new-client.tsx) / 同 edit-client
- **IMPORTS**: `useState`, `StructureTemplatePicker`
- **GOTCHA**:
  - `key={resetKey}` で StructureForm を unmount/remount することで内部の useState を再初期化できる（initialValue の controlled 化より実装が軽い）
  - edit-client は template picker を表示しない（既存 doc の編集に限定）
  - 既存の旧 doc（rebuyStack/addOnStack 未設定）は schema の default で null に補完されるため型崩れしない
- **VALIDATE**:
  - テンプレート「ターボ 10min」選択 → フォームの initialStack / levels / rebuy / addOn が一斉に書換
  - 「クリア」相当（template 外す）は提供しない — テンプレート適用後もユーザー手動編集は自由

### Task 16: Tests — schema / TimerDisplay / AverageStackCard / timer service

- **ACTION**: 以下の test ファイルを更新・新設
  - `src/lib/firebase/schemas/index.test.ts` UPDATE
  - `src/components/tournament/TimerDisplay.test.tsx` UPDATE
  - `src/components/tournament/AverageStackCard.test.tsx` CREATE
  - `src/lib/services/timer.test.ts` UPDATE（既存あれば追記）
- **IMPLEMENT**:
  ```ts
  // schemas/index.test.ts — 既存 / 新規 doc 双方の受容
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

### Task 17: PRD 更新 & 既存文書のリンク差替

- **ACTION**: `.claude/PRPs/prds/allin-timer.prd.md` を更新
- **IMPLEMENT**:
  - Implementation Phases テーブルに行追加:
    ```
    | 4.7 | Onboarding Polish & Structure Enhancements | Google 新規 displayName 設定 UI、ストラクチャテンプレート、匿名ヘッダ displayName 反映、rebuy/addon チップ量、平均スタック、ブレイクレベル | in-progress | - | 4.6 | [phase-4.7-onboarding-polish-structure-enhancements.plan.md](../plans/phase-4.7-onboarding-polish-structure-enhancements.plan.md) |
    ```
  - Phase 5 の Depends を `3, 4, 4.5, 4.6` → `3, 4, 4.5, 4.6, 4.7` に変更
  - Phase Details に "Phase 4.7" section を追加（Goal / Background / Scope / Success signal）
  - Parallelism Notes に「Phase 4.7（UX / schema additive）は Phase 4.6 完了後に単独実施。破壊的変更なしのため migration は不要」を追記
- **MIRROR**: 既存の Phase 4.6 エントリ（PRD line 217）
- **IMPORTS**: N/A
- **GOTCHA**: 行の番号順（4.6 の直後）を守る。Phase 5 の Depends を漏らさず更新
- **VALIDATE**: `cat .claude/PRPs/prds/allin-timer.prd.md | grep -E "4\.(6|7)"` で新行が出力される

### Task 18: lint / typecheck / build 確認

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
| StructureTemplatePicker | 3 templates | 3 枚のカード + 各ボタンで onSelect 発火 | UI 動作 |

### Edge Cases Checklist

- [x] 既存 doc（rebuyStack / addOnStack / isBreak 未設定）の schema parse が成功
- [x] break level (bb=0) の保存が zod validation を通る
- [x] 旧コードが書いた rebuy/addOn 未設定 doc → zodConverter 経由で null に正規化
- [x] Google sign-in の new user / existing user の両分岐
- [x] signInAsGuest 後の refreshUser 呼出でヘッダ即反映
- [x] 平均スタック: active 0 人で非表示
- [x] 平均スタック: totalChips が Number.MAX_SAFE_INTEGER を超えない（initialStack 〜 100 万 × 人数 〜 100 人で十分小さい）
- [x] DisplayNameDialog は backdrop / escape で閉じられない
- [x] DisplayNameDialog を放置して離脱 → 次回ログインで再表示（users/{uid} 未作成のまま）
- [x] break level の auto-advance が機能する（isBreak に依存しない既存 shouldAutoAdvance）
- [x] StructureTemplatePicker で選択 → 手動編集 → 保存 の順序で想定通り保存される

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors（新規型 `StructureTemplate` / `GoogleSignInResult` / AuthState 拡張が解決する）

### Lint

```bash
npm run lint
```

EXPECT: No warnings（`console.*` 残置禁止・existing patterns 遵守）

### Unit Tests

```bash
npm test -- --run
```

EXPECT: 全 test pass（既存 315 件 + 新規 10〜15 件、合計 325〜330 件）

### Build

```bash
npm run build
```

EXPECT: Next.js 全ページ生成成功（13 pages + 新規ダイアログ / カード追加で count 変動なし、CREATE した component は client-side のみ）

### Manual Browser Validation

```bash
npm run dev
```

Then perform:

- [ ] **Item 1**: 新規 Google アカウントでログイン → 表示名ダイアログ表示 → "テスト太郎" 入力・保存 → `/tournaments` 遷移 → ヘッダに "テスト太郎" 表示
- [ ] **Item 1**: 既存 Google アカウントで再ログイン → ダイアログ表示されず直接遷移
- [ ] **Item 2**: `/structures/new` → "ターボ 10min" テンプレートクリック → フォーム全項目が書換 → 編集して保存 → `/structures` で確認
- [ ] **Item 2**: `/structures/{sid}/edit` → テンプレートカードが**表示されない**（編集画面）
- [ ] **Item 3**: 新規匿名アカウントで `/join/{tid}` → 表示名 "なつき" 入力・ゲスト参加 → ヘッダに即座に "ゲスト: なつき" 表示（ページリロードなし）
- [ ] **Item 4**: `/structures/new` に rebuyStack / addOnStack 入力欄 → 空欄 OK / 数値 OK で保存 → Firestore console で確認
- [ ] **Item 5**: running 中のトーナメント → ダッシュボード / live に「平均スタック: X,XXX」表示 → バストで active 減少 → 平均上昇 → 0 人で非表示
- [ ] **Item 6**: テンプレート「標準 20min」で作成したトーナメント → Lv5（break）到達時 TimerDisplay が "☕ BREAK" 表示 → 5 分後に auto-advance → Lv6 で通常表示

### Firestore Rules

Phase 4.7 は Firestore Rules を変更しない（additive schema 変更のみ・rule 側の読書権限は不変）。確認だけ:

```bash
firebase deploy --only firestore:rules --dry-run
```

EXPECT: No diff（`firestore.rules` 未変更）

---

## Acceptance Criteria

- [ ] 全 18 タスク完了
- [ ] `npm run typecheck` / `lint` / `test -- --run` / `build` が全 green
- [ ] 6 件の memo 改善項目それぞれについて手動ブラウザ検証が通る
- [ ] 既存（Phase 4.6 までの）doc が schema 拡張後も読書できる（bogus migration なしで動く）
- [ ] PRD の Implementation Phases テーブルに Phase 4.7 が in-progress で載っている

## Completion Checklist

- [ ] Code follows discovered patterns（AppError / logger / zod schema / repository）
- [ ] Error handling matches codebase style（wrapAuthError / AppError.from）
- [ ] Logging follows codebase conventions（logger.info / warn、code 付与）
- [ ] Tests follow test patterns（vi.hoisted / makeTournament ヘルパー）
- [ ] No hardcoded values（STRUCTURE_TEMPLATES は定数化）
- [ ] No unnecessary scope additions（cross-group copy / rebuy 実操作 / 強制参加サークルは NOT Building に明記）
- [ ] Documentation updated（PRD）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `levelSchema` の bb 制約緩和（positive→nonnegative）で他箇所の前提が崩れる | L | M | superRefine で `!isBreak && bb <= 0` を禁止 → 既存呼出は全てプレイレベル（bb>0）のため影響なし。seating engine / balancing は `bb` を参照しない |
| `refreshUser` の実装が単純な setState では React が diff 検出せず再描画しない | M | M | useReducer で forceUpdate する実装に倒す（Task 10 GOTCHA）。実装時に test でヘッダ再描画を確認 |
| `getAdditionalUserInfo` が `linkWithCredential` 経由の Google リンクで `null` を返す | L | L | `additional?.isNewUser ?? false` でフェイルセーフ。link 経路は既存ユーザー前提のため isNewUser=false で問題ない |
| テンプレート適用後にユーザーが手動編集した内容が key リセットで消える | L | L | applyTemplate を呼ぶのはユーザーが明示的にカード click したとき。誤操作の防止は「本当に適用しますか」confirm を入れない代わりに Undo 相当の「元に戻す」ボタンは作らない（スコープ外） |
| rebuy/addOn が null で保存された doc を将来の rebuy 実操作 (v1.1) で扱うときに再 migration 必要 | L | L | Phase 4.7 では保存/表示のみ。rebuy 実操作を作る v1.1 plan で schema を `z.number().nullable()` → `.default(0)` 等に変更する選択が可能 |
| 平均スタックにリバイ／アドオンを加算する将来要望 | M | S | 本 Phase では計算式を固定（`totalEntries × initialStack ÷ active`）、将来要望は events 集計で加算する形に差替え可能。`AverageStackCard` に props で totalChips を受け取る形に変更できるよう実装を疎にしておく |
| `isBreak: true` のまま auto-advance が「BREAK は手動で advance したい」要望と衝突 | L | S | 本 Phase では auto-advance 維持。将来必要なら `Level.breakMode: "auto"|"manual"` を optional 追加 |

## Notes

- **互換レイヤは作らない**（Phase 2.5 / 4.6 の方針踏襲）: ただし本 Phase は schema additive のみのため、互換レイヤ不要。旧 doc は zod default で自動的に新フィールドが null/false に埋まる
- **Google 既存ユーザーの displayName 上書きをやめる**（Task 12）ことで、サークル用ニックネーム設定済みユーザーが Google プロフィールを変更しても dashboardu 表示が維持される副次効果がある
- **テンプレートは JavaScript 定数**: Firestore に持たない。運用者がテンプレートを追加したいなら本プロジェクトへの PR で対応（MIT なのでフォーク可）。将来的に管理 UI が要るなら Phase 5+ で Cloud Functions ベースの admin tool を検討
- **平均スタックの計算式**: リバイ / アドオン実装前の暫定式（`initialStack × totalEntries ÷ activePlayers`）。v1.1 で rebuy/addOn の events を集計する形に差替予定
- **ブレイクの扱い**: TDA rule 上は「ブラインドレベルの延長として break を挟むか、独立したレベルとして扱うか」は運営者の裁量。本実装は「独立したレベル + isBreak フラグ」方式。level 番号は連番を維持（Lv5 が break で Lv6 が次のプレイ）
- **Codex レビュー対策**: 本計画書は CLAUDE.md 記載の通り Codex レビュー対象。実装時は各 Task の IMPLEMENT / GOTCHA を Codex コメントで参照されやすいよう、コード内コメントも同文脈を要約しておく
