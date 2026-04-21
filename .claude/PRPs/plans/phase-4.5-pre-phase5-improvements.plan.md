# Plan: Phase 4.5 — Pre-Phase 5 Improvements

## Summary

Phase 4 完了後〜Phase 5（実地テスト）前に、ユーザー利用で洗い出された 7 件の UX / 運用改善をまとめて対応する。運営者の参加登線の整備、未ログイン時のトップ画面簡素化、メールリンク方式の廃止、Winner 演出と匿名アカウントの後始末を含む。破壊的変更は Email Link 削除と Firestore rules の微修正のみ。

## User Story

As a サークル運営者（兼任プレイヤー）／参加者,
I want 受付・進行・終了・後始末の各画面で不要な迷いや操作を排除した状態,
So that Phase 5 のドライランで UX のノイズに邪魔されず、コア機能（タイマー・席管理）の検証に集中できる。

## Problem → Solution

**Current state (Phase 4 完了時点)**: 受付ができ、席決め・バランシング・Late Entry・バストまで自動化されたが、日常運用で以下の摩擦が残る:

- `/groups` 画面からトーナメント／ストラクチャへ直接遷移できない（一度トップに戻る必要がある）
- ヘッダーにユーザーのメールアドレスが表示される（displayName のほうが見やすく、プライバシ的にも好ましい）
- 運営者自身が参加者になる際、QR をスキャンするか `/join/[tid]` を URL 入力するかしかない
- 最後の 1 人を決定した際、ただ「脱落者が増えた」表示のみで優勝演出が無く、終了操作も手動
- 匿名ゲスト参加者が Firebase Auth に蓄積し続ける（再利用されないゴミ）
- トップ画面で未ログイン時に「サークル一覧」「トーナメント一覧」を押しても結局 `/login` に飛ぶだけ
- Email Link 方式は実運用で不要（Google + Password + Guest で足りる）で、メンテ負荷だけ残る

**Desired state (Phase 4.5 完了時点)**:

- `/groups/[gid]` から直接「このサークルのトーナメント / ストラクチャ」へ遷移
- ヘッダーは displayName 優先表示（email はフォールバック）
- 運営者ダッシュボードで 1 クリックで自分を参加登録
- 最後の 1 人になったら自動で祝福バナー → 2 秒後に `finishTournament` 自動呼び出し
- トーナメント終了を検知した匿名ゲスト端末は、自身の auth + users/{uid} をベストエフォートで自己削除
- 未ログイン時のトップは「ログイン / 新規登録」ボタンのみ
- `/login` / `/join/[tid]` から「メールリンク」タブが消え、関連コード・テスト・ルート・localStorage キーを全削除

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)
- **PRD Phase**: Phase 4.5 — Pre-Phase 5 Improvements（新設）
- **Estimated Files**: 約 18 files（編集 13・削除 5・テスト修正 3）

---

## UX Design

### Before（Phase 4 完了時点）

```
┌─ / (Top) ──────────────────────┐  ┌─ AuthBadge (Header) ─────┐
│ ALLin-PokerTimer               │  │ ● alice@example.com      │
│ [サークル一覧へ]               │  │ [ログアウト]              │
│ [トーナメント一覧へ]           │  └───────────────────────────┘
│ [ログイン/新規登録]            │
└─────────────────────────────────┘   ※ 未ログインでも全ボタン表示

┌─ /groups/{gid} ────────────────┐  ┌─ /login ─────────────────┐
│ サークル名                     │  │ [ログイン] [新規登録]      │
│ [一覧へ] [名前変更] [削除]     │  │ [メールリンク] ← 不要     │
│ ── メンバー ──                 │  └───────────────────────────┘
│ ── 招待コード ──               │
└─────────────────────────────────┘  ※ トーナメント / ストラクチャへの動線なし

┌─ /tournaments/{tid} (setup) ───┐  ┌─ /live (残り 1 人時) ────┐
│ [席を決定]                     │  │ Lv 5  SB 400/BB 800       │
│  参加者 (5)  - 山田 ...       │  │ あなたの席 Table:2 No.3    │
│                                │  │  ※ 演出・終了導線なし     │
│ ※ 運営者の自己参加導線なし     │  │  ※ 匿名 auth はゴミ化      │
└─────────────────────────────────┘  └───────────────────────────┘
```

### After（Phase 4.5 完了時点）

```
┌─ / (未ログイン) ───────────────┐  ┌─ AuthBadge (Header) ─────┐
│ ALLin-PokerTimer               │  │ ● 山田太郎                │
│ [ログイン/新規登録]            │  │ [ログアウト]              │
└─────────────────────────────────┘  └───────────────────────────┘

┌─ / (ログイン済み) ─────────────┐
│ ALLin-PokerTimer               │
│ [サークル一覧へ]               │
│ [トーナメント一覧へ]           │
│ [ログアウト]                   │
└─────────────────────────────────┘

┌─ /groups/{gid} ────────────────┐  ┌─ /login ─────────────────┐
│ サークル名                     │  │ [ログイン] [新規登録]      │
│ [一覧へ] [トーナメント]        │  │    ↑ Email Link 削除     │
│ [ストラクチャ] [名前変更]      │  └───────────────────────────┘
│ [削除]                         │
│ ── メンバー ── 招待コード ──   │
└─────────────────────────────────┘

┌─ /tournaments/{tid} (setup) ───┐  ┌─ /live (残り 1 人 → 終了) ┐
│ [席を決定] [自分も参加する]    │  │ 🏆  優勝  山田太郎 🏆      │
│  参加者 (5)  - 山田(あなた)   │  │ (+confetti banner)        │
│                                │  │ ── 5 秒後に自動終了 ──    │
│                                │  │ (匿名ゲストは auth 自己削除)│
└─────────────────────────────────┘  └───────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| トップ (未ログイン) | 3 ボタン全て表示 | 「ログイン/新規登録」1 つ | `useAuthUser` で条件分岐（Server → Client Component） |
| ヘッダー | email 表示 | displayName 表示（email フォールバック） | 匿名時は既存の「ゲスト: 表示名」維持 |
| /groups/[gid] | 一覧へのみ | トーナメント / ストラクチャへのボタン追加 | 遷移前に `setCurrentGroupId(gid)` を実行 |
| 受付画面（運営者 setup） | QR のみ | 「自分も参加する」ボタン追加 | `joinAsCurrentUser({ tid })` 呼び出し、既参加なら非表示 |
| /live（残り 1 人） | 脱落増えるだけ | Winner バナー + 2 秒後自動 `finishTournament` | 運営者端末のみ finish 呼出（rule が write 要求）。参加者端末は表示のみ |
| /live（tournament finished） | 何もしない | 匿名ユーザーは auth を自己削除（best-effort） | `deletePlayer` せずに auth / users/{uid} のみ削除（参加記録は履歴として残す） |
| ログアウト（匿名時） | signOut のみ | auth 自己削除 + users/{uid} 削除 | requires-recent-login で失敗したら signOut に degrade |
| /login | 3 タブ | 2 タブ（ログイン / 新規登録） | Email Link タブ削除 |
| /join/[tid] | 3 タブ | 2 タブ（ゲスト / ログイン） | Email Link タブ削除 |
| /auth/email-link | 存在 | 削除 | ルート / コンポーネント / test ごと削除 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | all | Firestore 変更・rules 修正・security 基本 |
| P0 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | all | AppError ラップ / logger 経由 |
| P0 | [src/lib/services/auth-actions.ts](../../../src/lib/services/auth-actions.ts) | all | Email Link 削除対象・logout 変更 |
| P0 | [src/lib/services/receipt.ts](../../../src/lib/services/receipt.ts) | all | Email Link 削除対象・cancelOwnEntry 匿名削除 |
| P0 | [src/app/tournaments/[tid]/live/live-client.tsx](../../../src/app/tournaments/[tid]/live/live-client.tsx) | all | Winner 演出 + 匿名自己削除 + auto-finish 実装先 |
| P0 | [src/components/tournament/TimerControls.tsx](../../../src/components/tournament/TimerControls.tsx) | 68-93 | setup 分岐に「自分も参加する」ボタンを追加 |
| P1 | [src/components/auth/AuthBadge.tsx](../../../src/components/auth/AuthBadge.tsx) | 42-44 | 表示名優先への変更 |
| P1 | [src/app/groups/[gid]/group-detail-client.tsx](../../../src/app/groups/[gid]/group-detail-client.tsx) | 180-201 | 遷移ボタン追加位置 |
| P1 | [src/app/page.tsx](../../../src/app/page.tsx) | all | Client Component 化 + useAuthUser 分岐 |
| P1 | [src/app/login/login-client.tsx](../../../src/app/login/login-client.tsx) | 170-236 | email-link タブ削除 |
| P1 | [src/app/join/[tid]/join-client.tsx](../../../src/app/join/[tid]/join-client.tsx) | 285-392 | email タブ削除 |
| P1 | [src/lib/services/auth-actions.test.ts](../../../src/lib/services/auth-actions.test.ts) | 319-450 | Email Link 関連 describe ブロック削除 |
| P1 | [src/lib/services/receipt.test.ts](../../../src/lib/services/receipt.test.ts) | 31-36 | Email Link mock 削除 |
| P1 | [firestore.rules](../../../firestore.rules) | 23-26, 113-122 | users/{uid} self-delete 既に許可されている確認・players.create/update/delete の影響検討 |
| P2 | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | 336-356 | finishTournament の挙動把握（auto-finish 前提） |
| P2 | [src/lib/hooks/useTournamentTimer.ts](../../../src/lib/hooks/useTournamentTimer.ts) | 20-80 | autoAdvance 多重発火防止 (`advanceInflightRef`) をモデルに auto-finish を書く |
| P2 | [src/lib/firebase/repositories/users.ts](../../../src/lib/firebase/repositories/users.ts) | all | `deleteUserProfile` 追加必要（現状なければ） |
| P2 | [.claude/PRPs/plans/completed/phase-4-seating-automation.plan.md](completed/phase-4-seating-automation.plan.md) | 1-80 | Phase 4 の plan.md 構造・Task 粒度をミラー |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firebase Auth delete() エラー | [firebase.google.com/docs/reference/js/auth.user#userdelete](https://firebase.google.com/docs/reference/js/auth.user#userdelete) | `auth/requires-recent-login` エラーが返る可能性があり、再認証が必要なケースを考慮する。匿名ユーザーは通常発生しないが fallback を用意 |
| 匿名ユーザーの Cloud Functions 削除 | [firebase.google.com/docs/auth/admin/manage-users#delete_a_user](https://firebase.google.com/docs/auth/admin/manage-users#delete_a_user) | Admin SDK `deleteUser(uid)` / `deleteUsers(uids[])` が使える。Phase 5+ で必要になったら Functions 化（本 Phase では client self-delete のみ） |

```
KEY_INSIGHT: Firebase Client SDK の user.delete() は currentUser のみ削除可能
APPLIES_TO: Task 9 (匿名ユーザー自己削除)
GOTCHA: 他のユーザーを削除するには Admin SDK が必要 = Cloud Functions 導入 = Blaze プラン。Phase 4.5 では client self-delete のみ（best-effort）

KEY_INSIGHT: finishTournament は group メンバー運営者の uid でしか呼べない (rule: isGroupMember(tournament.groupId))
APPLIES_TO: Task 7 (auto-finish)
GOTCHA: 参加者（ゲスト／非メンバー）端末から finishTournament を呼ぶと permission-denied。autoAdvance と同じく「運営者端末のみ trigger」パターンで実装する（複数運営端末で衝突しないよう inflight ref + transaction-like 多重防止）
```

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/services/receipt.ts:88-103
export async function joinAsExistingUser({
  tid,
  email,
  password,
}: {
  tid: string;
  email: string;
  password: string;
}): Promise<ReceiptResult> {
  // export function は camelCase、引数はオブジェクト分割
  const user = await loginWithEmail(email, password);
  const result = await ensurePlayerCreated(tid, user);
  logger.info("join as existing user ok", { tid, uid: user.uid, result });
  return result;
}
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/services/auth-actions.ts:67-77
export async function loginWithEmail(email: string, password: string): Promise<User> {
  try {
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    logger.info("login ok", { uid: cred.user.uid });
    return cred.user;
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/login-failed", "ログインに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/hooks/useTournamentTimer.ts:57-60
logger.warn("timer subscribe error", { code: err.code, tid });
// メッセージは短い英文、構造化データは第二引数。console.log / console.error は禁止
```

### AUTO_TRIGGER_PATTERN（autoAdvance と同形）

```ts
// SOURCE: src/lib/hooks/useTournamentTimer.ts:46, 70-110 相当
const advanceInflightRef = useRef(false);
// ...
if (shouldAutoAdvance(tournament) && !advanceInflightRef.current) {
  advanceInflightRef.current = true;
  void advanceLevel(tid, uid, userGroupIds)
    .catch((e) => logger.warn("auto advance failed", { code: e?.code, tid }))
    .finally(() => { advanceInflightRef.current = false; });
}
```

auto-finish もこの ref + void pattern を踏襲する。

### REPOSITORY_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:336-356
export async function finishTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state === "finished") return;  // 冪等
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "finished",
      finishedAt: serverTimestamp(),
      pausedAt: null,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament finish ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "終了処理に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}
```

### TEST_STRUCTURE（受付テストと同じ vi.mock + beforeEach reset）

```ts
// SOURCE: src/lib/services/receipt.test.ts:9-45
const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));

vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: mockAuthState,
  firestore: {},
}));

vi.mock("@/lib/firebase/repositories/players", () => ({
  getPlayer: vi.fn(),
  upsertPlayer: vi.fn(),
  deletePlayer: vi.fn(),
}));
// ...
beforeEach(() => {
  vi.mocked(upsertPlayer).mockReset();
  mockAuthState.currentUser = null;
});
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/app/page.tsx` | UPDATE | Client Component 化 + useAuthUser 分岐（未ログイン時はログインボタンのみ）|
| `src/components/auth/AuthBadge.tsx` | UPDATE | 表示名優先に並べ替え（L44） |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | 「トーナメント」「ストラクチャ」ボタン追加 + currentGroupId 設定 |
| `src/components/tournament/TimerControls.tsx` | UPDATE | setup 分岐に「自分も参加する」ボタン追加（自分が未参加時のみ） |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | TimerControls に自己参加に必要な props（自分が参加済みか判定用）を追加（不要なら skip） |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | Winner バナー、匿名自己削除、auto-finish（運営者端末のみ）を実装 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | Winner バナー表示（運営者側にも演出）。auto-finish trigger は live 側に集約するか dashboard 側に置くか plan で確定（→ dashboard 側に置く。/live は参加者も開くため rule 違反が出る） |
| `src/lib/services/auth-actions.ts` | UPDATE | Email Link 関連を削除（`sendEmailLinkForJoin` / `completeEmailLink` / `isEmailLinkUrl` / localStorage ヘルパー／`buildEmailLinkContinueUrl`）。logout を匿名削除対応に拡張 |
| `src/lib/services/receipt.ts` | UPDATE | Email Link 関連（`joinViaEmailLinkRequest` / `joinViaEmailLinkComplete`）削除、cancelOwnEntry で匿名時 user.delete() |
| `src/lib/firebase/repositories/users.ts` | UPDATE | `deleteUserProfile(uid)` を追加（未実装なら） |
| `src/app/login/login-client.tsx` | UPDATE | email-link タブ・関連 state 削除 |
| `src/app/join/[tid]/join-client.tsx` | UPDATE | email タブ・関連 state 削除 |
| `src/app/auth/email-link/page.tsx` | DELETE | Email Link ルート削除 |
| `src/app/auth/email-link/email-link-client.tsx` | DELETE | Email Link クライアント削除 |
| `src/app/auth/` ディレクトリ | DELETE | 空になったら削除 |
| `src/lib/services/auth-actions.test.ts` | UPDATE | Email Link 関連 describe 削除、logout の匿名削除ケース追加 |
| `src/lib/services/receipt.test.ts` | UPDATE | Email Link mock 削除、cancelOwnEntry 匿名削除ケース追加 |
| `src/app/tournaments/[tid]/live/live-client.test.tsx` | UPDATE | Winner 演出 / auto-finish / 匿名自己削除 のテスト追加 |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Phase 4.5 行を Implementation Phases テーブルに追加し、Phase Details を差し込む |

## NOT Building

- **Cloud Functions 導入**: 匿名ユーザーの「確実削除」は Admin SDK が必要だが、Blaze プラン移行を伴うため Phase 4.5 では導入しない。client self-delete の best-effort に留める。tail の残骸は Phase 5+ で Functions 化または Firebase Console の定期手動 cleanup で運用
- **Cloud Functions による tournament 終了 trigger**: 同上。auto-finish は運営者端末の JS が呼ぶ（autoAdvance と同じモデル）
- **Email Link を Firebase Console で無効化する手順の自動化**: コード削除のみで、Firebase Console 側の Email Link プロバイダー無効化は運用 README に手順を追記するに留める（必須でもない — 使われなくなるだけ）
- **受付待ち画面からの walk-in ゲスト代理登録**: 運営者 uid と別 uid を同時に持てないため、同一端末内での代理登録は rule 違反。`/join/[tid]` を別タブで開かせる導線は作らず、既存の QR / URL コピーで充足（項目 3 は「運営者の自己参加」と同義と解釈 → 統合）
- **Winner 演出の音・派手なアニメーション**: バナー表示と 2 秒ディレイだけで十分。confetti などは Phase 5 の UX 磨きで検討
- **匿名ユーザーのユーザー設定画面からの手動「アカウント削除」機能**: 今回は tournament finish / logout / cancelOwnEntry の自動削除のみ。設定画面の手動ボタンは別機能

---

## Step-by-Step Tasks

### Task 1: ヘッダー表示名優先

- **ACTION**: `src/components/auth/AuthBadge.tsx:44` の `label` 導出式を変更
- **IMPLEMENT**:
  ```ts
  const label = user.isAnonymous
    ? `ゲスト: ${user.displayName ?? "（名前未設定）"}`
    : (user.displayName ?? user.email ?? user.uid);
  ```
- **MIRROR**: 変更点は 1 行。他の表示ルール（bg-muted pill 等）は現状維持
- **IMPORTS**: 変更不要
- **GOTCHA**: 既存ユーザーが displayName 未設定（Phase 1 時代の account）の場合、email が表示される → OK
- **VALIDATE**: 開発環境で displayName 設定済みユーザーでログイン → ヘッダーが displayName 表示になることを確認

### Task 2: トップ画面を未ログイン時は簡素化

- **ACTION**: `src/app/page.tsx` を Server Component から Client Component に変更し、`useAuthUser` で分岐
- **IMPLEMENT**:
  ```tsx
  "use client";
  import Link from "next/link";
  import { Button } from "@/components/ui/button";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";

  export default function Page() {
    const { user, loading } = useAuthUser();
    // 3 状態で出し分け: loading / signed-in (non-anonymous) / else
    // signed-in: サークル・トーナメント・ログアウト
    // else: ログイン/新規登録 のみ（匿名も未ログインと同等に扱う）
    // ログアウトは AuthBadge 側にあるが、トップでは導線を意識して別途用意しない（現状維持で OK）
  }
  ```
- **MIRROR**: [src/app/groups/[gid]/group-detail-client.tsx:80](../../../src/app/groups/[gid]/group-detail-client.tsx#L80) の `if (!user) return null;` パターンを参考に `loading` 状態の判定
- **IMPORTS**: `useAuthUser`, `Link`, `Button`
- **GOTCHA**: Client Component 化により metadata 設定が失われないよう注意（`src/app/layout.tsx` 側で metadata 宣言済みなら問題なし）
- **VALIDATE**: 未ログインで `/` にアクセス → 「ログイン/新規登録」ボタンのみ表示 / ログイン済みで `/` → サークル＋トーナメントボタン表示

### Task 3: /groups/[gid] からトーナメント・ストラクチャ遷移ボタン

- **ACTION**: `src/app/groups/[gid]/group-detail-client.tsx` の header `div.flex.flex-wrap.gap-2`（L180-201）に 2 つのボタンを追加
- **IMPLEMENT**:
  ```tsx
  <Button
    variant="outline"
    size="sm"
    onClick={() => {
      setCurrentGroupId(gid);
      router.push("/tournaments");
    }}
  >
    トーナメント
  </Button>
  <Button
    variant="outline"
    size="sm"
    onClick={() => {
      setCurrentGroupId(gid);
      router.push("/structures");
    }}
  >
    ストラクチャ
  </Button>
  ```
- **MIRROR**: 同ファイル L180-185 の `<Link href="/groups">` パターン。ただし遷移前に `setCurrentGroupId(gid)` が必要なため `<Link>` ではなく onClick で router.push
- **IMPORTS**: 既に `useRouter` / `useCurrentGroup` import 済み
- **GOTCHA**: `setCurrentGroupId` は非同期ではない（同期 setState）ため、直後の `router.push` で新 state がまだ反映されないが、`/tournaments` 側の `useCurrentGroup` は localStorage を最優先で読むので問題ない（実装確認要）
- **VALIDATE**: 複数サークル所属のユーザーで `/groups/[gid1]` → 「トーナメント」ボタンクリック → `/tournaments` で gid1 配下のトーナメント一覧が表示されることを確認

### Task 4: 運営者の自己参加ボタン（項目 3 + 4 統合）

- **ACTION**: `src/components/tournament/TimerControls.tsx:68-93` の setup 分岐に「自分も参加する」ボタンを追加
- **IMPLEMENT**:
  ```tsx
  if (tournament.state === "setup") {
    const activeCount = players.filter((p) => !p.isBusted).length;
    const alreadyJoined = players.some((p) => p.uid === uid);
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button ... disabled>席を決定</Button>
        {!alreadyJoined ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run(
                // 新 op 種別 "self-join" を Op union に追加
                "self-join",
                async () => {
                  await joinAsCurrentUser({ tid });
                },
                "自己参加に失敗",
              )
            }
          >
            {busy === "self-join" ? "登録中…" : "自分も参加する"}
          </Button>
        ) : null}
        ...
      </div>
    );
  }
  ```
- **MIRROR**: 同ファイル L72-87 の Button + run() パターン。`Op` union に `"self-join"` を追加
- **IMPORTS**: `joinAsCurrentUser` from `@/lib/services/receipt`
- **GOTCHA**: `joinAsCurrentUser` は displayName を Firebase Auth / users/{uid} から解決するが、いずれも空なら throw する。運営者は通常 register 時に displayName 設定済みなので問題ないが、fallback エラー（validation/display-name-required）を UI で表示する動作は `run()` が既にカバー
- **VALIDATE**: 運営者で setup 状態のトーナメントダッシュボードを開く → 「自分も参加する」クリック → 参加者一覧に自分が出現 → 再 render でボタンが消える

### Task 5: Winner 演出（バナー表示）

- **ACTION**: `src/app/tournaments/[tid]/live/live-client.tsx` と `src/app/tournaments/[tid]/dashboard-client.tsx` 両方で、残り 1 人検知時にバナー表示
- **IMPLEMENT**:
  1. 共通コンポーネントを `src/components/tournament/WinnerBanner.tsx` に新設
     ```tsx
     "use client";
     import type { PlayerDoc } from "@/lib/firebase/schemas/player";

     export function WinnerBanner({ winner }: { winner: PlayerDoc }) {
       return (
         <section
           role="status"
           aria-live="polite"
           className="w-full max-w-md rounded-lg border-2 border-amber-400 bg-gradient-to-br from-amber-100 to-yellow-200 p-6 text-center shadow-lg dark:from-amber-900/40 dark:to-yellow-900/40"
         >
           <div className="mb-2 text-5xl">🏆</div>
           <p className="text-sm font-medium text-amber-900 dark:text-amber-100">優勝</p>
           <p className="mt-1 text-2xl font-bold text-amber-950 dark:text-amber-50">
             {winner.displayName}
           </p>
         </section>
       );
     }
     ```
  2. live-client.tsx / dashboard-client.tsx で以下の判定で WinnerBanner を表示:
     ```ts
     const activePlayers = players.filter((p) => !p.isBusted);
     const isRunningOrPaused = tournament.state === "running" || tournament.state === "paused";
     const isFinished = tournament.state === "finished";
     const winner = (
       (isRunningOrPaused && activePlayers.length === 1 && players.length >= 2)
       || (isFinished && activePlayers.length === 1)
     ) ? activePlayers[0] : null;
     ```
- **MIRROR**: [src/app/tournaments/[tid]/live/live-client.tsx:107-115](../../../src/app/tournaments/[tid]/live/live-client.tsx#L107) の `recentlyMoved` バナーの構造（role="status" / aria-live / amber palette）
- **IMPORTS**: `WinnerBanner`, 既存の `players` state
- **GOTCHA**: `players.length >= 2` を入れないと、1 人だけで開始した意味不明なケースで演出が走る。また `dashboard-client.tsx` では既に `players` を subscribe している（L65-74）ので新規 subscribe は不要
- **VALIDATE**: 3 人参加→ 2 人バスト → 残り 1 人になった瞬間にバナー表示（両画面で）。再ロードしても演出維持

### Task 6: Auto-finish（運営者端末のみ呼出）

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` に「Winner 確定 2 秒後に `finishTournament` を呼ぶ」effect を追加
- **IMPLEMENT**:
  ```tsx
  // dashboard-client.tsx 内
  const autoFinishInflightRef = useRef(false);
  useEffect(() => {
    if (!data || !user) return;
    if (!isMember) return;  // 非 group メンバーは呼ぶと permission-denied
    if (data.state !== "running" && data.state !== "paused") return;
    const activeCount = players.filter((p) => !p.isBusted).length;
    if (activeCount !== 1 || players.length < 2) return;
    if (autoFinishInflightRef.current) return;

    autoFinishInflightRef.current = true;
    const timer = setTimeout(() => {
      void finishTournament(tid, user.uid, groupIds)
        .catch((e) => {
          logger.warn("auto finish failed", {
            code: e instanceof AppError ? e.code : "unknown",
            tid,
          });
          autoFinishInflightRef.current = false;
        });
    }, 2000);
    return () => {
      clearTimeout(timer);
      autoFinishInflightRef.current = false;
    };
  }, [tid, user, isMember, data, players, groupIds]);
  ```
- **MIRROR**: [src/lib/hooks/useTournamentTimer.ts:46](../../../src/lib/hooks/useTournamentTimer.ts#L46) の `advanceInflightRef` パターン
- **IMPORTS**: `finishTournament` from repositories/tournaments、`useRef`、`AppError`、`logger`
- **GOTCHA**:
  - 多重発火防止: inflight ref + state === finished チェック（finishTournament 側で state === "finished" なら no-op）
  - 複数運営端末で同時に呼ばれても Firestore の冪等性で 2 回目以降は no-op（finishTournament 内で `if (t.state === "finished") return;`）
  - `/live` 側では呼ばない（参加者端末で rule 違反になる）
- **VALIDATE**: 残り 1 人 → 2 秒待つ → state === "finished" に遷移 → Winner バナーは表示され続ける

### Task 7: 匿名ユーザーの自己削除（tournament finish 検知）

- **ACTION**: `src/app/tournaments/[tid]/live/live-client.tsx` で、自分が匿名かつ参加者かつ tournament が finished になった瞬間に auth + users/{uid} を削除
- **IMPLEMENT**:
  ```tsx
  const selfDeleteInflightRef = useRef(false);
  useEffect(() => {
    if (!user || !user.isAnonymous) return;
    if (!tournament) return;
    if (tournament.state !== "finished") return;
    if (!me) return;  // この tournament の参加者でない場合は対象外
    if (selfDeleteInflightRef.current) return;
    selfDeleteInflightRef.current = true;

    void (async () => {
      try {
        await deleteUserProfile(user.uid);   // users/{uid} 削除
        await user.delete();                  // auth 削除 = signOut も兼ねる
        logger.info("anonymous self-delete ok", { uid: user.uid, tid });
      } catch (e) {
        logger.warn("anonymous self-delete failed", {
          code: e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "unknown",
          uid: user.uid,
        });
        // best-effort: 失敗しても何もしない（次回ログアウト時に再試行）
      }
    })();
  }, [user, tournament, me, tid]);
  ```
- **MIRROR**: `subscribePlayers` effect（L27-39）の構造を踏襲
- **IMPORTS**: `deleteUserProfile` from `@/lib/firebase/repositories/users`（新規追加）
- **GOTCHA**:
  - player ドキュメント（`tournaments/{tid}/players/{uid}`）は **削除しない**。履歴として残す。rule の delete 条件（pid == auth.uid）は満たすが、運営者が後から参加履歴を見たいので残す判断
  - `user.delete()` は `auth/requires-recent-login` を throw する可能性がある（匿名ユーザーはほぼ発生しないが）。エラーは logger.warn に記録して終了
  - 削除成功後は onAuthStateChanged が走って user === null になり、/live の「受付登録されていません」表示に変わる
- **VALIDATE**:
  - 匿名ユーザーで受付 → 運営者側で auto-finish → Firebase Auth コンソールで該当 uid が削除されていることを確認
  - users/{uid} も同時削除
  - 参加者一覧の player 行は残っている（脱落表示）

### Task 8: ログアウト時の匿名ユーザー削除

- **ACTION**: `src/lib/services/auth-actions.ts` の `logout` を匿名時に user.delete() する分岐に拡張
- **IMPLEMENT**:
  ```ts
  export async function logout(): Promise<void> {
    const user = firebaseAuth.currentUser;
    if (user?.isAnonymous) {
      try {
        await deleteUserProfile(user.uid);
        await user.delete();
        logger.info("anonymous logout (self-delete) ok", { uid: user.uid });
        return;
      } catch (e) {
        const wrapped = AppError.from(e, "auth/anon-delete-failed", "匿名アカウントの削除に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code });
        // fallthrough: signOut にフォールバック
      }
    }
    try {
      await signOut(firebaseAuth);
      logger.info("logout ok");
    } catch (e) {
      const wrapped = AppError.from(e, "auth/logout-failed", "ログアウトに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: 既存 `logout` の try/catch 構造。削除失敗時のフォールバックは degrade（通常 signOut）
- **IMPORTS**: `deleteUserProfile`
- **GOTCHA**: `user.delete()` 成功時は onAuthStateChanged で user === null になるので signOut 不要（`user.delete()` が signOut 相当の効果を持つ）
- **VALIDATE**: 匿名ユーザーでログイン → [ログアウト] クリック → Firebase Auth コンソールで該当 uid が消える

### Task 9: cancelOwnEntry での匿名削除

- **ACTION**: `src/lib/services/receipt.ts` の `cancelOwnEntry` を匿名時に user.delete() する分岐に拡張
- **IMPLEMENT**:
  ```ts
  export async function cancelOwnEntry(tid: string): Promise<void> {
    const user = firebaseAuth.currentUser;
    if (!user) {
      throw new AppError("ログインしてください", "auth/not-authenticated");
    }
    await deletePlayer(tid, user.uid);
    logger.info("cancel own entry ok", { tid, uid: user.uid });

    if (user.isAnonymous) {
      try {
        await deleteUserProfile(user.uid);
        await user.delete();
        logger.info("anonymous self-delete after cancel", { uid: user.uid, tid });
      } catch (e) {
        logger.warn("anonymous self-delete failed", {
          code: e instanceof Error && "code" in e ? String((e as { code: unknown }).code) : "unknown",
          uid: user.uid,
        });
        // best-effort
      }
    }
  }
  ```
- **MIRROR**: Task 7 / 8 と同構造
- **IMPORTS**: `deleteUserProfile`
- **GOTCHA**: deletePlayer を必ず先に実行（成功後に auth 削除しないと、次回ログインで player が残る可能性）
- **VALIDATE**: ゲスト参加 → 受付完了画面 → [参加を取り消す] → Firebase Auth + players + users/{uid} が消える

### Task 10: deleteUserProfile 追加（users repository）

- **ACTION**: `src/lib/firebase/repositories/users.ts` に `deleteUserProfile(uid)` を追加
- **IMPLEMENT**:
  ```ts
  import { deleteDoc, doc } from "firebase/firestore";
  import { AppError } from "@/lib/errors";
  import { usersRef } from "./base"; // 実際の参照名は現コード参照
  import { logger } from "@/lib/logger";

  export async function deleteUserProfile(uid: string): Promise<void> {
    try {
      await deleteDoc(doc(usersRef, uid));
      logger.info("user profile deleted", { uid });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "ユーザープロフィール削除に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid });
      throw wrapped;
    }
  }
  ```
- **MIRROR**: 同ファイル内の `upsertUserProfile` と同構造。rules は既に `users/{uid}` で self-write 許可済み（L24-26）なので追加 rule は不要
- **IMPORTS**: `deleteDoc`
- **GOTCHA**: `users/{uid}` 削除は自己所有のみ rule で許可（既存: `request.auth.uid == uid`）。他の uid を削除しようとすると permission-denied
- **VALIDATE**: 既存 users repository テストに delete ケースを追加（存在すれば）、なければ実行時に確認

### Task 11: Email Link 機能の削除（auth-actions）

- **ACTION**: `src/lib/services/auth-actions.ts` から以下を削除:
  - `EMAIL_STORAGE_KEY`, `DISPLAY_NAME_STORAGE_KEY` 定数
  - `buildEmailLinkContinueUrl`
  - `sendEmailLinkForJoin`
  - `getStoredEmailForSignIn`, `clearStoredEmailForSignIn`
  - `getStoredDisplayNameForSignIn`, `clearStoredDisplayNameForSignIn`
  - `isEmailLinkUrl`, `completeEmailLink`
- **IMPLEMENT**: 該当関数と `firebase/auth` からの `isSignInWithEmailLink` / `sendSignInLinkToEmail` / `signInWithEmailLink` import も削除。`sanitizeRedirect` は他で使われていれば維持
- **MIRROR**: 単純削除
- **IMPORTS**: 削除した関数に依存する import 行を整理
- **GOTCHA**:
  - `receipt.ts` が `clearStoredDisplayNameForSignIn` / `completeEmailLink` / `sendEmailLinkForJoin` を import している → Task 12 と合わせて削除
  - tests が import している → Task 15 で削除
- **VALIDATE**: `grep -r "sendEmailLinkForJoin\|completeEmailLink\|isEmailLinkUrl" src/` が空

### Task 12: Email Link 機能の削除（receipt）

- **ACTION**: `src/lib/services/receipt.ts` から `joinViaEmailLinkRequest` / `joinViaEmailLinkComplete` を削除、関連 import も削除
- **IMPLEMENT**: 該当 export 関数と、`clearStoredDisplayNameForSignIn` / `completeEmailLink` / `sendEmailLinkForJoin` import を削除
- **MIRROR**: 単純削除
- **IMPORTS**: 整理
- **VALIDATE**: `grep -r "joinViaEmailLinkRequest\|joinViaEmailLinkComplete" src/` が空

### Task 13: Email Link ルート / UI 削除

- **ACTION**: 以下を削除:
  - `src/app/auth/email-link/page.tsx`
  - `src/app/auth/email-link/email-link-client.tsx`
  - `src/app/auth/email-link/` ディレクトリ
  - `src/app/auth/` 配下が空になったらディレクトリ削除
- **IMPLEMENT**: `rm` で削除
- **MIRROR**: N/A
- **GOTCHA**: Next.js App Router は空ディレクトリを残しても問題ない（route は登録されない）が、クリーンアップとして削除
- **VALIDATE**: `/auth/email-link` へのアクセスで 404

### Task 14: /login と /join/[tid] から Email Link タブ削除

- **ACTION**:
  - `src/app/login/login-client.tsx` から `Mode` から `"email-link"` を削除、該当タブボタン（L175-193）、email-link form（L198-235）、`linkSentTo` state・`onSubmitEmailLink` 削除
  - `src/app/join/[tid]/join-client.tsx` から `Tab` から `"email"` を削除、該当タブボタン、email form（L362-392）、`onEmailLinkSubmit` 削除
- **IMPLEMENT**: タブ配列 / ハンドラ / form を削除し、`Mode = "login" | "register"`、`Tab = "login" | "guest"` に縮める
- **MIRROR**: 既存のタブ切替 UI はそのまま（`role="tablist"`）
- **IMPORTS**: `sendEmailLinkForJoin` / `joinViaEmailLinkRequest` import 削除
- **GOTCHA**: `linkSentTo` など email-link 専用 state が他で参照されていないか確認
- **VALIDATE**: /login /join/[tid] で email-link タブが存在せず、2 タブのみ表示

### Task 15: テスト更新

- **ACTION**:
  - `src/lib/services/auth-actions.test.ts`: `describe("sendEmailLinkForJoin"...)` / `describe("storage helpers"...)` / `describe("isEmailLinkUrl"...)` / `describe("completeEmailLink"...)` ブロックを削除。`describe("logout"...)` に匿名削除成功 / 失敗 fallback ケースを追加
  - `src/lib/services/receipt.test.ts`: `vi.mock("@/lib/services/auth-actions")` の `sendEmailLinkForJoin` / `completeEmailLink` を削除。`describe("cancelOwnEntry"...)` を新設して匿名時 `user.delete()` が呼ばれるケースを追加
  - `src/app/tournaments/[tid]/live/live-client.test.tsx`: Winner バナー表示 / 匿名自己削除 / state="finished" 検知 のテストを追加
  - `useTournamentTimer` / `useSeatingAutoOrchestrator` のテストには影響しない（auto-finish は dashboard-client 側の useEffect に書くため）
- **IMPLEMENT**: Task 1-10 で削除・変更した関数に対応する test を削除／追加
- **MIRROR**: 既存 test 構造（`vi.hoisted` + `vi.mock` + `beforeEach(reset)`）
- **IMPORTS**: `user.delete()` の mock 追加（`makeUser` に `delete: vi.fn().mockResolvedValue(undefined)`）
- **GOTCHA**: `live-client.test.tsx` 既存テストの subscribePlayers mock と衝突しないように、新 test では別 describe ブロックに分ける
- **VALIDATE**: `npm test` で全テスト pass

### Task 16: PRD 更新

- **ACTION**: `.claude/PRPs/prds/allin-timer.prd.md` の Implementation Phases テーブルに Phase 4.5 行を追加し、Phase Details セクションに説明を差し込む
- **IMPLEMENT**:
  - テーブル行: `| 4.5 | Pre-Phase 5 Improvements | UX 改善・Email Link 削除・Winner 演出・auto-finish・匿名削除 | in-progress | - | 4 | [phase-4.5-pre-phase5-improvements.plan.md](../plans/phase-4.5-pre-phase5-improvements.plan.md) |`
  - Phase Details: Phase 4 と Phase 5 の間に Phase 4.5 セクションを追加（本 plan と同内容の要約）
  - Phase 5 の Depends を `3, 4` → `3, 4, 4.5` に更新（optional だが推奨）
- **MIRROR**: Phase 2.5 の追加時と同パターン
- **VALIDATE**: PRD が lint できる（md-lint があれば）、テーブルが崩れない

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `logout` 匿名 happy path | `currentUser.isAnonymous = true`, `user.delete` resolves | `deleteUserProfile` → `user.delete` 呼出、`signOut` 不要 | - |
| `logout` 匿名 delete 失敗 | `user.delete` rejects | logger.warn 後、`signOut` に fallback | yes |
| `logout` 通常 | `currentUser.isAnonymous = false` | `signOut` のみ呼出 | - |
| `cancelOwnEntry` 匿名 | `currentUser.isAnonymous = true` | `deletePlayer` → `deleteUserProfile` → `user.delete` の順 | - |
| `cancelOwnEntry` 通常 | `currentUser.isAnonymous = false` | `deletePlayer` のみ | - |
| live-client Winner バナー | players: 3 人, 2 人 bust, state=running | WinnerBanner render | - |
| live-client 自己削除 | user.isAnonymous, me!=null, state=finished | `deleteUserProfile` + `user.delete` 呼出 | yes |
| dashboard auto-finish | players 1 人残, state=running, 2 秒経過 | `finishTournament` 呼出 | - |
| dashboard auto-finish 既 finished | state=finished で evaluate | 呼出されない | yes |
| dashboard auto-finish 非メンバー | isMember=false | 呼出されない（permission-denied 回避） | yes |
| TimerControls 自己参加 | setup state, alreadyJoined=false | 「自分も参加する」ボタン表示 | - |
| TimerControls 自己参加 | setup state, alreadyJoined=true | ボタン非表示 | - |
| deleteUserProfile | uid 指定 | `deleteDoc` 呼出、AppError ラップ確認 | - |

### Edge Cases Checklist

- [x] 匿名ユーザーで tournament finish 前にタブを閉じた → auth 残留（受容範囲、Phase 5+ で cleanup）
- [x] `user.delete()` が requires-recent-login で失敗 → signOut にフォールバック（logout）
- [x] 複数運営端末で auto-finish が同時発火 → 2 回目以降は finishTournament 側で no-op
- [x] Email Link localStorage 残骸 → Task 11 で key 削除 + Task 15 test で localStorage clear 確認
- [x] Next.js App Router で `/auth/email-link` の 404 → 削除後に確認
- [x] setup 中に運営者が自分を追加した直後に「席を決定」 → `alreadyJoined` は reload 後に更新、button 非表示に切替（race なし）
- [x] Winner が 2 人以上 → `activePlayers.length === 1` の判定なので、2 人同時生存中はバナー出ない
- [x] 0 人参加で開始 → `players.length >= 2` ガードで演出走らない
- [x] /groups→tournaments 遷移時の setCurrentGroupId race → useCurrentGroup の localStorage 書込タイミングを確認（既存実装に依存）

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

EXPECT: Zero lint errors（console.log / biome-ignore なし）

### Unit Tests

```bash
npm test -- --run
```

EXPECT: All tests pass（vitest）

### Build

```bash
npm run build
```

EXPECT: Next.js build succeeds / Turbopack warning なし

### Firestore Rules Test（手動）

```bash
# 匿名ユーザーの自己削除が rule で許可されていることを確認
firebase emulators:start --only firestore
# 別ターミナルで匿名 signIn → users/{uid} delete が通ることを手動確認
```

EXPECT: users/{uid} self-delete 成功、他 uid への delete は permission-denied

### Browser Validation

```bash
npm run dev
```

シナリオ:
- [ ] 未ログインで `/` → 「ログイン/新規登録」のみ表示
- [ ] ログイン済みで `/` → 全ボタン表示
- [ ] ヘッダーが displayName 表示
- [ ] `/groups/[gid]` からトーナメント / ストラクチャへ 1 クリック遷移
- [ ] トーナメント受付画面で「自分も参加する」→ 参加者一覧に自分が出る
- [ ] 3 人参加 → 2 人バスト → 残り 1 人で Winner バナー表示 → 2 秒後 state=finished
- [ ] 匿名ゲスト → tournament finished → Firebase Auth コンソールで uid が消える
- [ ] 匿名ゲストでログアウト → auth 消える
- [ ] `/login` / `/join/[tid]` にメールリンクタブが無い
- [ ] `/auth/email-link` が 404

---

## Acceptance Criteria

- [ ] 16 タスクすべて完了
- [ ] typecheck / lint / test / build すべて green
- [ ] 全 7 改善要望の挙動確認（ブラウザ検証シナリオ）
- [ ] Firestore rules を変更した場合は emulator でテスト
- [ ] PRD に Phase 4.5 が追加され、Status=in-progress → 完了後 complete
- [ ] Email Link 関連のコード・テスト・ルート・localStorage キーがリポジトリから完全消滅（`grep -r "emailLink\|EmailLink\|email-link" src/` が空）
- [ ] 匿名アカウント削除の best-effort 動作が確認できる（手動で Auth コンソール観察）

## Completion Checklist

- [ ] コードが既存パターン（AppError ラップ、logger 経由、repository 層経由 Firestore アクセス）に準拠
- [ ] 削除したコードに伴う dead import / dead dependency が無い
- [ ] tests が現存パターン（vi.hoisted / vi.mock / beforeEach reset）に準拠
- [ ] ハードコード値なし（定数は既存 schema / service 定数を参照）
- [ ] CLAUDE.md / README.md への影響がないか確認（README に Email Link 記述があれば更新）
- [ ] 意図しない scope 追加なし（NOT Building セクション遵守）
- [ ] plan を読むだけで追加の codebase 調査なしで実装できる

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| auto-finish が複数運営端末で同時発火 | M | L | finishTournament 側の冪等性（state=finished なら no-op）で吸収。inflightRef は端末内のみ |
| 匿名 user.delete() が requires-recent-login で失敗 | L | L | signOut にフォールバック（データ残留だが整合性は維持） |
| Email Link 削除で依存コードが残存 | L | M | Task 11-14 後に `grep -r` で検証、CI typecheck で検出 |
| Winner バナー判定が Late Entry 直後に誤発火 | L | M | `players.length >= 2` + `isBusted` フィルタで二重ガード |
| /groups 遷移後の currentGroupId 反映遅延 | L | L | useCurrentGroup の localStorage writing 実装次第。既存パターンに合わせるだけなので低リスク |
| Firebase Console 側で Email Link プロバイダー有効のまま残る | L | L | 使われなくなるだけで害はない。運用 README に無効化手順を追記 |
| `user.delete()` 後に onSnapshot が permission-denied を throw | M | L | live-client の subscribe error handler で logger.warn するだけで UI 影響なし（該当 listener は user=null で unsubscribe される） |

## Notes

- **項目 3 の解釈変更**: 初版 plan では「運営者ダッシュボードから /join/[tid] を別タブで開く」導線を追加する案だったが、ユーザーヒアリングで「運営者は既にログイン済みなので 1 クリック自己参加」が本意と判明。Task 4 に統合（項目 4 と同一実装）。
- **auto-finish 2 秒ディレイ**: Winner 演出が視認できるタイミング。短すぎると「いきなり finished 表示」で戸惑う、長すぎると UX が鈍重。Phase 5 のドライランで微調整余地あり。
- **匿名削除の再認証フロー**: Firebase の `user.delete()` は登録から長時間経過すると `requires-recent-login` を返すが、匿名ユーザーは通常 `signInAnonymously` → 即参加 → 数時間以内に finish になるため現実的には発生しにくい。発生時は signOut フォールバックで済む。
- **Phase 5+ で Cloud Functions 化する場合の受け口**: auto-finish も auto-seat も「運営者端末の JS が呼ぶ」client-authoritative パターン。Phase 5+ で Functions に寄せる場合、finishTournament 内で onWrite trigger を追加して匿名一括削除する設計が最短。
- **Firebase Console 側の Email Link プロバイダー無効化**: 手動手順として README に追記する（「Firebase Console → Authentication → Sign-in method → Email/Password → Email link (passwordless sign-in) を無効化」）。コード変更だけでは Firebase 側の設定は変わらないが、使われなくなるだけで害はない。

---
