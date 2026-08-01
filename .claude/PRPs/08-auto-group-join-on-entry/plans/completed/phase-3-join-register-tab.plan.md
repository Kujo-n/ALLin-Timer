# Plan: Phase 3 — 受付画面の新規登録タブ（トーナメント受付によるサークル自動所属）

## Summary

`/join/[tid]` に 3 つめのタブ「新規登録」を追加し、Google アカウントを持たない参加者が
**受付画面だけでアカウント作成 → 参加登録 → サークル自動所属**まで完結できるようにする。
新経路は Phase 2 の共通 helper `receiveEntry` を必ず通す新 service `joinAsNewUser` として実装し、
自動所属とフィードバック（`applyReceiptOutcome`）を自動的に引き継ぐ。
併せて `/login` と受付画面で重複していた入力欄（表示名 / メールアドレス＋パスワード）を
共有コンポーネント 2 種に抽出する（PRD Open Questions で Phase 3 判断とされていた論点）。

## User Story

As a **Google アカウントを持たない小規模サークルの参加者**,
I want **受付 QR を読んだ画面から、その場でアカウントを作って参加登録まで済ませたい**,
so that **別画面へ移動せずに参加登録とサークル所属の両方が完了し、シーズン戦績に自分が載る**。

## Problem → Solution

**現状**: `/join/[tid]` の選択肢は「Google で参加」「ゲスト（匿名）」「ログイン（既存アカウント）」の 3 つ。
Google を持たず、かつアカウントを未作成の参加者には**匿名ゲストしか道がない**。
匿名は rule / service の二重防御で自動所属の対象外なので、この層は
**構造的にサークルメンバーになれず、シーズン戦績にも載らない**。
アカウントを作るには `/login` へ離脱する必要があり、受付導線が途切れる。

**あるべき姿**: 受付画面の「新規登録」タブで表示名・メール・パスワードを入力すると、
アカウント作成 → 参加登録 → サークル自動所属が 1 操作で完了し、
Phase 2 と同じ「◯◯ のメンバーになりました。」フィードバックが出る。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/08-auto-group-join-on-entry/prds/08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md)
- **PRD Phase**: Phase 3 — 受付画面の新規登録タブ（Depends: Phase 2 `complete`）
- **Estimated Files**: 14（新規 4 / 更新 10）

---

## UX Design

### Before

```
┌────────────────────────────────────────────┐
│ /join/[tid]   （未サインイン）             │
│                                            │
│  [  G  Google で参加  ]                    │
│  ────────────────────────────────────────  │
│   ゲスト* │ ログイン                       │
│  ────────────────────────────────────────  │
│   表示名  [________________]               │
│   15 文字以内で入力してください。          │
│   [      ゲストで受付      ]               │
│   匿名参加です。別端末からの再ログインは   │
│   できません。                             │
└────────────────────────────────────────────┘
        ↑ Google なし・アカウント未作成の人は
          匿名ゲストしか選べない
          → サークルメンバーになれない
          → シーズン戦績に載らない
          （/login へ離脱するしかない）
```

### After

```
┌────────────────────────────────────────────┐
│ /join/[tid]   （未サインイン）             │
│                                            │
│  [  G  Google で参加  ]                    │
│  ────────────────────────────────────────  │
│   ゲスト* │ ログイン │ 新規登録            │  ← タブが 1 つ増える（既定は ゲスト のまま）
│  ────────────────────────────────────────  │
│                                            │
│  ＜「新規登録」タブを選んだとき＞          │
│   表示名        [________________]         │
│   15 文字以内で入力してください。          │
│   メールアドレス [________________]        │
│   パスワード     [________________]        │
│   [      登録して受付      ]               │
│   アカウントを作ると、次回以降も同じ       │
│   アカウントで参加できます。               │
└────────────────────────────────────────────┘
        ↓ 送信
┌────────────────────────────────────────────┐
│ 受付完了                                   │
│ 運営者が席決めするまでお待ちください。     │
│ トーナメント: Monthly                      │
│ ┌────────────────────────────────────────┐ │
│ │ ✓ 土曜サークル のメンバーになりました。│ │  ← Phase 2 の経路をそのまま再利用
│ └────────────────────────────────────────┘ │
│ [ タイマー画面へ ] [ 参加を取り消す ]      │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| `/join/[tid]` のタブ | ゲスト / ログイン（2 つ） | ゲスト / ログイン / **新規登録**（3 つ） | 既定タブは **ゲストのまま**（既存 UX 非回帰・当日最速動線を維持） |
| 新規登録タブ | 存在しない | 表示名 ＋ メール ＋ パスワード ＋「登録して受付」 | `registerWithEmail` → `receiveEntry` の 1 送信で完了 |
| 受付完了画面 | Phase 2 で実装済み | **変更なし** | `applyReceiptOutcome` に合流するため所属メッセージが自動で出る |
| 「Google で参加」 | 上部に常設 | **変更なし** | PRD の「Google 優先」を維持（タブの外に置いたまま） |
| `/login` の見た目 | 表示名ボックス / メール / パスワード | **ピクセル等価**（内部実装のみ共有コンポーネント化） | ラベル文言・id `reg-name`・DOM 構造を保持 |
| 既にサインイン済みで開いた場合 | 「このアカウントで受付」＋ 2 タブ | 「このアカウントで受付」＋ 3 タブ | 既存挙動の踏襲（タブを出し分ける変更はしない） |

### Edge Cases for UX

- **メールが既に登録済み** — `auth/already-exists` を専用文言に差し替え、
  「ログイン」タブへ誘導する（自動でタブ切替はしない＝ 入力済みの値を失わせない）
- **表示名が空 / 15 字超** — 送信前に `joinInputSchema` で弾く（ゲストタブと同じ扱い）。
  ネットワーク往復もアカウント作成も発生させない
- **パスワードが 6 字未満** — `<Input minLength>` でブラウザ側が送信を止める。
  すり抜けても `registerWithEmail` が `auth/weak-password` で失敗する
- **終了済みトーナメントの QR で新規登録** — アカウントは作成されるが受付は
  `tournament/late-entry-closed` で失敗する（`joinAsExistingUser` と同型の既存挙動。Risks 参照）
- **自動所属だけ失敗** — Phase 2 の best-effort 経路がそのまま効き、
  「受付完了」＋「次回の受付時に自動で再試行されます」になる

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) | 33-52, 103-140, 276-400 | 改修の本体。`Tab` 型 / handler / タブリスト / 既存 2 フォーム |
| P0 | [src/app/login/login-client.tsx](../../../../src/app/login/login-client.tsx) | 243-313 | 抽出元。表示名ボックス（id `reg-name`）とメール / パスワード欄 |
| P0 | [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) | 85-150 | `receiveEntry` の契約と `joinAsExistingUser` の形（新 service の雛形） |
| P0 | [src/lib/services/auth-actions.ts](../../../../src/lib/services/auth-actions.ts) | 37-49, 102-125 | `validateDisplayName` / `registerWithEmail` の検証順序と throw code |
| P0 | [.claude/rules/testing.md](../../../rules/testing.md) | all | mock 境界（helper 境界）／ skip 禁止／実装と test を同一 commit |
| P1 | [src/app/join/[tid]/join-client.test.tsx](../../../../src/app/join/%5Btid%5D/join-client.test.tsx) | 1-150 | 既存 mock 構成と `receiveWithSignedInAccount` helper |
| P1 | [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts) | 1-106 | mock ブロック（`auth-actions` / `auto-group-join`）と `makeTournament` factory |
| P1 | [src/lib/firebase/schemas/player.ts](../../../../src/lib/firebase/schemas/player.ts) | 28-40 | `joinInputSchema`（表示名の form 側バリデーション） |
| P1 | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | `AppError` ラップ義務 / 二重 warn 禁止 / `console.*` 禁止 |
| P2 | [tests/e2e/auto-group-join.spec.ts](../../../../tests/e2e/auto-group-join.spec.ts) | 1-95 | 2 context の seed パターンと待機タイムアウトの方針 |
| P2 | [tests/e2e/email-link-removed.spec.ts](../../../../tests/e2e/email-link-removed.spec.ts) | 50-74 | **「メール登録」タブ不在を assert している既存テスト**（更新対象） |
| P2 | [tests/e2e/pages/JoinPage.ts](../../../../tests/e2e/pages/JoinPage.ts) | 13-18 | POM の locator 定義（`emailTab` は現在どこからも使われていない） |
| P2 | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | 「アプリ側の呼出経路（Phase 2）」節 | `receiveEntry` 経由必須の DRIFT WARNING（更新対象） |

## External Documentation

**No external research needed — feature uses established internal patterns.**
`createUserWithEmailAndPassword` / `updateProfile` は `registerWithEmail` 内に既に閉じており、
本 Phase で Firebase SDK を新規に呼ぶ箇所はない。新規依存パッケージもゼロ。

---

## Patterns to Mirror

### NAMING_CONVENTION（service）

```ts
// SOURCE: src/lib/services/receipt.ts:130-150
export async function joinAsExistingUser({
  tid,
  email,
  password,
}: {
  tid: string;
  email: string;
  password: string;
}): Promise<ReceiptOutcome> {
  const user = await loginWithEmail(email, password);
  const outcome = await receiveEntry(tid, user);
  logger.info("join as existing user ok", {
    tid,
    uid: user.uid,
    result: outcome.result,
    autoJoin: outcome.autoJoin?.status,
  });
  return outcome;
}
```

→ 「auth 処理 → `receiveEntry` → `logger.info` → outcome を返す」の 4 行構成。
`joinAsNewUser` はこの形を**そのまま**なぞる。

### UI_PATTERN（タブ定義とフォーム）

```tsx
// SOURCE: src/app/join/[tid]/join-client.tsx:314-338
<div role="tablist" className="flex gap-1 border-b text-sm">
  {(
    [
      ["guest", "ゲスト"],
      ["login", "ログイン"],
    ] as [Tab, string][]
  ).map(([value, label]) => (
    <button
      key={value}
      role="tab"
      aria-selected={tab === value}
      onClick={() => {
        setTab(value);
        setError(null);
      }}
      className={`border-b-2 px-3 py-2 ${
        tab === value ? "border-primary font-medium" : "border-transparent text-muted-foreground"
      }`}
    >
      {label}
    </button>
  ))}
</div>
```

### UI_PATTERN（既存の入力欄 — 抽出対象 A）

```tsx
// SOURCE: src/app/join/[tid]/join-client.tsx:342-354（ゲストタブ）
<div className="space-y-2">
  <Label htmlFor="g-name">表示名</Label>
  <Input
    id="g-name"
    value={displayName}
    onChange={(e) => setDisplayName(e.target.value)}
    required
    maxLength={DISPLAY_NAME_MAX_LENGTH}
  />
  <p className="text-xs text-muted-foreground">
    {DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください。
  </p>
</div>
```

```tsx
// SOURCE: src/app/login/login-client.tsx:245-263（register モードの表示名ボックス）
<div className="space-y-2 rounded-md border bg-muted/50 p-4">
  <Label htmlFor="reg-name" className="font-medium">
    表示名（必須）
  </Label>
  <Input
    id="reg-name"
    required
    maxLength={DISPLAY_NAME_MAX_LENGTH}
    value={displayName}
    onChange={(e) => setDisplayName(e.target.value)}
    className="bg-background"
  />
  <p className="text-xs text-muted-foreground">
    トーナメント参加時に席表・参加者一覧に表示される名前です（
    {DISPLAY_NAME_MAX_LENGTH} 文字以内）。
    <strong className="font-medium">
      メールアドレス／Google のどちらで登録する場合も先に入力してください。
    </strong>
  </p>
</div>
```

→ 差分は **label 文言 / hint 文言 / Input の追加 class** の 3 点のみ。
外側のボックス（`rounded-md border bg-muted/50 p-4`）は `/login` 固有なので**抽出しない**。

### UI_PATTERN（既存の入力欄 — 抽出対象 B）

```tsx
// SOURCE: src/app/login/login-client.tsx:277-299
<div className="space-y-2">
  <Label htmlFor="email">メールアドレス</Label>
  <Input id="email" type="email" autoComplete="email" required
    value={email} onChange={(e) => setEmail(e.target.value)} />
</div>
<div className="space-y-2">
  <Label htmlFor="password">パスワード</Label>
  <Input id="password" type="password"
    autoComplete={mode === "login" ? "current-password" : "new-password"}
    required minLength={6}
    value={password} onChange={(e) => setPassword(e.target.value)} />
</div>
```

```tsx
// SOURCE: src/app/join/[tid]/join-client.tsx:366-387（ログインタブ）
// 差分は id（l-email / l-password）と minLength 無しの 2 点のみ
```

### ERROR_HANDLING（UI 側）

```ts
// SOURCE: src/app/join/[tid]/join-client.tsx:73-77
function wrapError(e: unknown) {
  const wrapped = AppError.from(e, "receipt/unknown", "受付に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code, tid });
  setError(formatErrorForDisplay(wrapped));
}
```

```ts
// SOURCE: src/app/login/login-client.tsx:177-198（code 別に分岐してから汎用へ落とす）
if (e instanceof AppError) {
  if (e.code === "validation/display-name-required" || e.code === "validation/display-name-too-long") {
    setError(e.message);
    document.getElementById("reg-name")?.focus();
    return;
  }
  // 既に AppError なら内側の wrapAuthError で warn 済みなので二重 warn を避ける。
  setError(formatErrorForDisplay(e));
  return;
}
```

→ **既に `AppError` のときは再ラップも再 warn もしない**。`join-client` の新 handler も同形にする。

### UI_PATTERN（form 側の事前バリデーション）

```ts
// SOURCE: src/app/join/[tid]/join-client.tsx:117-126
const parsed = joinInputSchema.safeParse({ tid, displayName });
if (!parsed.success) {
  setError(`validation/join: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
  return;
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/services/receipt.ts:143-148
logger.info("join as existing user ok", {
  tid,
  uid: user.uid,
  result: outcome.result,
  autoJoin: outcome.autoJoin?.status,
});
```

### TEST_STRUCTURE（service unit）

```ts
// SOURCE: src/lib/services/receipt.test.ts:30-40
vi.mock("@/lib/services/auth-actions", () => ({
  attemptAnonymousSelfDelete: vi.fn(),
  signInAsGuest: vi.fn(),
  loginWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
// 08-auto-group-join-on-entry Phase 2: helper 境界で mock する（testing.md）。
// 素通しすると repositories/groups が実体 import され firestore singleton を触って落ちる。
vi.mock("@/lib/services/auto-group-join", () => ({
  joinGroupViaTournament: vi.fn(),
}));
```

### TEST_STRUCTURE（client component unit）

```tsx
// SOURCE: src/app/join/[tid]/join-client.test.tsx:123-131
async function receiveWithSignedInAccount(outcome: ReceiptOutcome) {
  vi.mocked(joinAsCurrentUser).mockResolvedValue(outcome);
  render(<JoinClient tid="t1" />);
  const button = screen.getByRole("button", { name: "このアカウントで受付" });
  await act(async () => {
    fireEvent.click(button);
  });
}
```

### E2E_STRUCTURE（2 context・自動所属）

```ts
// SOURCE: tests/e2e/auto-group-join.spec.ts:95-132
const browser = page.context().browser();
if (!browser) throw new Error("browser unavailable");
const guestCtx = await browser.newContext();
try {
  const joinPage = await guestCtx.newPage();
  await joinPage.goto(`/join/${tid}`);
  await joinPage.getByRole("tab", { name: "ログイン" }).click();
  ...
  await expect(joinPage.getByText("受付完了")).toBeVisible({ timeout: 30_000 });
  await expect(joinPage.getByText(`${GROUP_NAME} のメンバーになりました。`)).toBeVisible({
    timeout: 15_000,
  });
} finally {
  await guestCtx.close();
}
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/components/auth/DisplayNameField.tsx` | CREATE | 表示名入力欄の共有コンポーネント（3 callsite） |
| `src/components/auth/EmailPasswordFields.tsx` | CREATE | メール＋パスワード入力欄の共有コンポーネント（3 callsite）＋ `PASSWORD_MIN_LENGTH` |
| `src/components/auth/DisplayNameField.test.tsx` | CREATE | label / maxLength / hint 差し替えの render 契約を固定 |
| `src/components/auth/EmailPasswordFields.test.tsx` | CREATE | id 生成 / autoComplete の mode 別切替 / minLength を固定 |
| [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) | UPDATE | `joinAsNewUser` を追加（`registerWithEmail` → `receiveEntry`） |
| [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts) | UPDATE | `registerWithEmail` mock 追加 ＋ `joinAsNewUser` の 5 ケース |
| [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) | UPDATE | 「新規登録」タブ ＋ フォーム ＋ handler。既存 2 タブを共有コンポーネントへ差替 |
| [src/app/join/[tid]/join-client.test.tsx](../../../../src/app/join/%5Btid%5D/join-client.test.tsx) | UPDATE | `joinAsNewUser` mock 追加 ＋ 新規登録タブの 4 ケース |
| [src/app/login/login-client.tsx](../../../../src/app/login/login-client.tsx) | UPDATE | 入力欄を共有コンポーネントへ差替（見た目・ラベル・id は等価維持） |
| [tests/e2e/pages/JoinPage.ts](../../../../tests/e2e/pages/JoinPage.ts) | UPDATE | 未使用の `emailTab`（「メール登録」）を `registerTab`（「新規登録」）へ置換 |
| [tests/e2e/email-link-removed.spec.ts](../../../../tests/e2e/email-link-removed.spec.ts) | UPDATE | `/join` のタブ assert を 3 タブ構成に更新（「メールリンク」不在の検証は維持） |
| [tests/e2e/auto-group-join.spec.ts](../../../../tests/e2e/auto-group-join.spec.ts) | UPDATE | 「新規登録タブ → メンバー化」の E2E を 1 件追加 |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | UPDATE | `receiveEntry` を通る経路を 3 → 4 に更新（DRIFT WARNING の実績反映） |
| [PRD](../prds/08-auto-group-join-on-entry.prd.md) | UPDATE | Phase 3 を `in-progress` に ＋ plan link ＋ Open Question / Decisions Log の決着 |

## NOT Building

- **`DisplayNameDialog` / `/settings` の表示名欄の共通化** — 構造は似ているが Dialog 固有の
  `autoFocus` / footer 配置を持ち、Google 新規登録フローの回帰リスクを本 Phase に持ち込む。
  抽出コンポーネントの 4 番目の consumer 候補として**将来の architect-refactor に送る**
- **`/login` のレイアウト変更** — 抽出は「入力欄の中身」のみ。表示名の枠囲みボックス・
  「登録方法を選択」/「または」の区切り線・Google ボタンの配置は 1px も変えない
- **受付画面への Google 新規登録（表示名 upfront 入力）の追加** — 上部の「Google で参加」は
  Google プロフィール名をそのまま使う既存設計（Phase 4.7 の判断）を維持する
- **サインイン済みユーザーへのタブ出し分け** — 現状も「ログイン」タブは出したままなので踏襲。
  タブの可視性制御は別途 UX 判断が要る
- **匿名ゲスト → 新規登録への昇格（アカウント連携）** — PRD の Won't（Q2）。
  匿名状態で新規登録すると別 uid の新アカウントになる（既存「ログイン」タブと同挙動）
- **パスワードリセット / メール確認送信の導線** — 受付画面のスコープ外
- **`firestore.rules` の変更** — Phase 1 で完了済み。本 Phase は rule に一切触れない
- **メンバー除名 UI** — Phase 4 の担当（並行実装中・触るファイルは重複しない）

---

## Step-by-Step Tasks

### Task 1: 共有コンポーネント `DisplayNameField` を作成

- **ACTION**: `src/components/auth/DisplayNameField.tsx` を新規作成。
- **IMPLEMENT**:

  ```tsx
  "use client";

  import type { ReactNode } from "react";

  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";

  interface Props {
    /** `<label for>` と `<input id>` に使う。`/login` は "reg-name" 固定（focus 制御が id 依存）。 */
    id: string;
    value: string;
    onChange: (value: string) => void;
    /** default: "表示名"。`/login` は "表示名（必須）"。 */
    label?: string;
    /** default: 「{15} 文字以内で入力してください。」 */
    hint?: ReactNode;
    /** default: true */
    required?: boolean;
    autoFocus?: boolean;
    /** `<Input>` への追加 class（`/login` の muted ボックス内で "bg-background" を渡す）。 */
    inputClassName?: string;
    /** wrapper への追加 class。 */
    className?: string;
  }

  /**
   * 表示名の入力欄（Label + Input + hint）。
   *
   * 08-auto-group-join-on-entry Phase 3 で `/login`（新規登録モード）と
   * `/join/[tid]`（ゲストタブ / 新規登録タブ）に重複していた同形マークアップを集約した。
   *
   * `maxLength` は必ず `DISPLAY_NAME_MAX_LENGTH` で固定する（呼出側から変更させない）。
   * サークルの `memberDisplayNames` は Firestore Rules 側で `size() <= 15` を強制しており、
   * ここを緩めると自動所属が permission-denied で静かに失敗するため。
   */
  export function DisplayNameField({
    id,
    value,
    onChange,
    label = "表示名",
    hint,
    required = true,
    autoFocus,
    inputClassName,
    className,
  }: Props) {
    return (
      <div className={className ? `space-y-2 ${className}` : "space-y-2"}>
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required={required}
          maxLength={DISPLAY_NAME_MAX_LENGTH}
          autoFocus={autoFocus}
          className={inputClassName}
        />
        <p className="text-xs text-muted-foreground">
          {hint ?? `${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください。`}
        </p>
      </div>
    );
  }
  ```

- **MIRROR**: UI_PATTERN（既存の入力欄 — 抽出対象 A）。ラベル文言・hint 文言・class 名は
  抽出元からコピーする（新しい文言を発明しない）
- **IMPORTS**: `Input` / `Label` / `DISPLAY_NAME_MAX_LENGTH`（上記のとおり）
- **GOTCHA**:
  - **`onChange` は `(value: string) => void`**（`ChangeEvent` ではない）。呼出側が
    `onChange={setDisplayName}` と書けるようにするため。3 callsite すべてこの形に揃える
  - `/login` は元々 `<Label className="font-medium">` を付けているが、`labelVariants` に
    既に `font-medium` が含まれているため**完全な no-op**。抽出時に落として構わない
    （見た目は 1px も変わらない）。落とすことで `labelClassName` prop が不要になる
  - `maxLength` は prop 化しない（上記 docstring の理由）
  - E2E は `getByLabel("表示名")`（substring match）で拾うため、`/login` の
    「表示名（必須）」でも一致する。**ラベル文言の変更は E2E を壊す**ので現状維持
- **VALIDATE**: `npm run typecheck` が 0 error（この時点では未使用 export のみ）

### Task 2: 共有コンポーネント `EmailPasswordFields` を作成

- **ACTION**: `src/components/auth/EmailPasswordFields.tsx` を新規作成。
- **IMPLEMENT**:

  ```tsx
  "use client";

  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";

  /**
   * パスワードの最小長。Firebase Authentication のサーバ側最小要件と同値で、
   * ここでは送信前にブラウザへ知らせるためだけに使う（クライアント検証は補助）。
   *
   * Firestore Rules と連動する数値ではないため `src/lib/limits.ts` には置かない
   * （limits.ts は rule リテラルとの drift check 対象の単一真実源）。
   */
  export const PASSWORD_MIN_LENGTH = 6;

  interface Props {
    /** id 生成の接頭辞。`${idPrefix}-email` / `${idPrefix}-password` になる。 */
    idPrefix: string;
    /** `autoComplete` の切替のみに使う（login: current-password / register: new-password）。 */
    mode: "login" | "register";
    email: string;
    password: string;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    /** 指定時のみ `<input minLength>` を付ける。既存 callsite の挙動を保つため任意。 */
    passwordMinLength?: number;
  }

  /**
   * メールアドレス ＋ パスワードの入力欄ペア。
   *
   * 08-auto-group-join-on-entry Phase 3 で `/login`（ログイン / 新規登録の両モード）と
   * `/join/[tid]`（ログインタブ / 新規登録タブ）に重複していた同形マークアップを集約した。
   */
  export function EmailPasswordFields({
    idPrefix,
    mode,
    email,
    password,
    onEmailChange,
    onPasswordChange,
    passwordMinLength,
  }: Props) {
    const emailId = `${idPrefix}-email`;
    const passwordId = `${idPrefix}-password`;
    return (
      <>
        <div className="space-y-2">
          <Label htmlFor={emailId}>メールアドレス</Label>
          <Input
            id={emailId}
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => onEmailChange(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor={passwordId}>パスワード</Label>
          <Input
            id={passwordId}
            type="password"
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            required
            minLength={passwordMinLength}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
          />
        </div>
      </>
    );
  }
  ```

- **MIRROR**: UI_PATTERN（既存の入力欄 — 抽出対象 B）
- **IMPORTS**: `Input` / `Label`
- **GOTCHA**:
  - **fragment（`<>`）を返す**。呼出側の `<form className="space-y-3|space-y-4">` の
    直下に 2 つの `div` が並ぶ現状の DOM を保つため、wrapper div を足さない
  - `passwordMinLength` を **mode から自動導出しない**。`/login` は現状
    login モードでも `minLength={6}` を付けており、mode 連動にすると
    「6 字未満の既存パスワードでログインできなくなる/できるようになる」挙動変更になる。
    各 callsite が今の値をそのまま渡すことで完全な非回帰にする
  - `/login` の id は `email` / `password` → `login-email` / `login-password` に変わるが、
    **id 参照は `reg-name` の `getElementById` 1 箇所のみ**（grep 済み）。
    E2E / unit は全て `getByLabel` 経由なので影響なし
- **VALIDATE**: `npm run typecheck` が 0 error

### Task 3: `login-client.tsx` を共有コンポーネントへ差し替える

- **ACTION**: [src/app/login/login-client.tsx](../../../../src/app/login/login-client.tsx) を更新。
- **IMPLEMENT**:

  1. import を追加し、不要になったものを外す:

  ```ts
  import { DisplayNameField } from "@/components/auth/DisplayNameField";
  import { EmailPasswordFields, PASSWORD_MIN_LENGTH } from "@/components/auth/EmailPasswordFields";
  ```

  `Input` / `Label` / `DISPLAY_NAME_MAX_LENGTH` の import は
  **他に使用箇所が無くなるため削除**する（残すと lint の unused import で落ちる）。

  2. register モードの表示名ボックス（現行 245-263 行）の**中身だけ**を差し替える。
     外側の `<div className="space-y-2 rounded-md border bg-muted/50 p-4">` は
     `<DisplayNameField className="rounded-md border bg-muted/50 p-4" ...>` に畳む:

  ```tsx
  {mode === "register" ? (
    <>
      <DisplayNameField
        id="reg-name"
        label="表示名（必須）"
        value={displayName}
        onChange={setDisplayName}
        inputClassName="bg-background"
        className="rounded-md border bg-muted/50 p-4"
        hint={
          <>
            トーナメント参加時に席表・参加者一覧に表示される名前です（
            {DISPLAY_NAME_MAX_LENGTH_TEXT} 文字以内）。
            <strong className="font-medium">
              メールアドレス／Google のどちらで登録する場合も先に入力してください。
            </strong>
          </>
        }
      />
      <div className="relative my-2">
        {/* 「登録方法を選択」区切り線は現状のまま */}
      </div>
    </>
  ) : null}
  ```

  `DISPLAY_NAME_MAX_LENGTH_TEXT` という新しい名前は**作らない**。
  hint 内で定数を使うため `DISPLAY_NAME_MAX_LENGTH` の import は**残す**
  （上記 1. の削除対象から除外する）。最終形:

  ```tsx
  hint={
    <>
      トーナメント参加時に席表・参加者一覧に表示される名前です（
      {DISPLAY_NAME_MAX_LENGTH} 文字以内）。
      <strong className="font-medium">
        メールアドレス／Google のどちらで登録する場合も先に入力してください。
      </strong>
    </>
  }
  ```

  3. パスワードフォーム（現行 277-299 行の 2 つの `div`）を置換:

  ```tsx
  <form onSubmit={onSubmitPassword} className="space-y-4">
    <EmailPasswordFields
      idPrefix="login"
      mode={mode}
      email={email}
      password={password}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      passwordMinLength={PASSWORD_MIN_LENGTH}
    />
    {error ? (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    ) : null}
    ...（以降は現状のまま）
  </form>
  ```

- **MIRROR**: 抽出元のマークアップをそのまま移設する（新しい文言・class を足さない）
- **IMPORTS**: 上記のとおり。`Input` / `Label` の import 削除を忘れない
- **GOTCHA**:
  - **`document.getElementById("reg-name")?.focus()`（183 行）が生きているか必ず確認**。
    `DisplayNameField` に `id="reg-name"` を渡し続けること。ここを変えると
    「Google 新規登録で表示名未入力エラー → 入力欄へ focus」が黙って壊れる
  - `mode` は `"login" | "register"` で `EmailPasswordFields` の `mode` と型が一致する
    （`LoginClient` の `Mode` 型をそのまま渡してよい）
  - 見た目の等価性は「差し替え前後で `/login` のスクリーンショットが一致すること」で判断する。
    class 名を 1 つでも落とすと崩れるので、Task 1/2 の docstring どおり
    `inputClassName` / `className` で完全に補うこと
- **VALIDATE**: `npm run typecheck` / `npm run lint` が 0 error。
  `npm run build` 成功。Task 8 の E2E（`email-link-removed.spec.ts` の `/login` 系 3 テスト ＋
  `registerOrganizer` を使う全 spec）が非回帰

### Task 4: `receipt.ts` に `joinAsNewUser` を追加

- **ACTION**: [src/lib/services/receipt.ts](../../../../src/lib/services/receipt.ts) を更新。
- **IMPLEMENT**:

  1. import に `registerWithEmail` を追加（既存 `auth-actions` の import ブロック内・alphabetical 順）:

  ```ts
  import {
    attemptAnonymousSelfDelete,
    loginWithEmail,
    registerWithEmail,
    signInAsGuest,
    signInWithGoogle,
  } from "@/lib/services/auth-actions";
  ```

  2. `joinAsExistingUser` の**直後**に新関数を追加:

  ```ts
  /**
   * 受付画面から新規アカウントを作成して、そのまま受付する。
   * 08-auto-group-join-on-entry Phase 3。
   *
   * `registerWithEmail` が displayName を先に検証する（trim / 非空 / 15 字以内）ため、
   * 不正な表示名で Auth アカウントだけが作られることはない。
   * 作成した user をそのまま `receiveEntry` に渡すので、他の通常アカウント経路と同じく
   * **player 作成 → サークル自動所属** の順序と best-effort 契約が適用される。
   */
  export async function joinAsNewUser({
    tid,
    email,
    password,
    displayName,
  }: {
    tid: string;
    email: string;
    password: string;
    displayName: string;
  }): Promise<ReceiptOutcome> {
    const user = await registerWithEmail(email, password, displayName);
    // 登録時に入力された名前を hint として渡し、players と memberDisplayNames を揃える。
    const outcome = await receiveEntry(tid, user, displayName);
    logger.info("join as new user ok", {
      tid,
      uid: user.uid,
      result: outcome.result,
      autoJoin: outcome.autoJoin?.status,
    });
    return outcome;
  }
  ```

- **MIRROR**: NAMING_CONVENTION（service）／ LOGGING_PATTERN
- **IMPORTS**: `registerWithEmail`（`@/lib/services/auth-actions`）のみ
- **GOTCHA**:
  - **`ensurePlayerCreated` を直接呼ばない**。`receiveEntry` を通さないと自動所属が丸ごと抜ける
    （[group-membership.md](../../../rules/group-membership.md) の DRIFT WARNING）
  - `parseDisplayName` / `joinInputSchema` をここで再検証**しない**。
    `registerWithEmail` 内の `validateDisplayName` が唯一の service 側検証点
    （二重検証はエラーコードの出所を曖昧にする）
  - `registerWithEmail` は失敗時に既に `logger.warn` 済みの `AppError` を throw する。
    ここで catch も再ラップもしない（呼出側の `wrapError` が表示を担当）
  - `receiveEntry` が throw した場合（`tournament/late-entry-closed` 等）、
    **Auth アカウントは既に作成済み**のまま残る。`joinAsExistingUser` の
    「ログイン成功後に受付が失敗する」ケースと同型の既存挙動で、ロールバックはしない
    （Risks 参照）
- **VALIDATE**: `npm run typecheck` が 0 error

### Task 5: `join-client.tsx` に「新規登録」タブを追加

- **ACTION**: [src/app/join/[tid]/join-client.tsx](../../../../src/app/join/%5Btid%5D/join-client.tsx) を更新。
- **IMPLEMENT**:

  1. import を更新:

  ```ts
  import { DisplayNameField } from "@/components/auth/DisplayNameField";
  import { EmailPasswordFields, PASSWORD_MIN_LENGTH } from "@/components/auth/EmailPasswordFields";
  ...
  import {
    cancelOwnEntry,
    joinAsCurrentUser,
    joinAsExistingUser,
    joinAsGuest,
    joinAsNewUser,
    joinViaGoogle,
    type AutoJoinFeedback,
    type ReceiptOutcome,
    type ReceiptResult,
  } from "@/lib/services/receipt";
  ```

  `Input` / `Label` は**新規登録タブでも使わなくなる**ので、他に残存参照が無ければ削除する。
  `DISPLAY_NAME_MAX_LENGTH` はゲストタブの hint を `DisplayNameField` の
  **デフォルト hint に委ねる**ため不要になる（削除する）。

  2. `Tab` 型を拡張:

  ```ts
  type Tab = "login" | "guest" | "register";
  ```

  既定値は **`useState<Tab>("guest")` のまま変更しない**。

  3. 新規登録用の handler を `onLoginSubmit` の直後に追加:

  ```ts
  async function onRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // 表示名はサーバ往復・アカウント作成の前に弾く（ゲストタブと同じ扱い）。
    const parsed = joinInputSchema.safeParse({ tid, displayName });
    if (!parsed.success) {
      setError(`validation/join: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await joinAsNewUser({
        tid,
        email,
        password,
        displayName: parsed.data.displayName,
      });
      // register 内の updateProfile 直後は onAuthStateChanged が再発火しないため、
      // AuthBadge 等のヘッダ表示を即更新する（ゲスト受付と同じ理由）。
      refreshUser();
      await applyReceiptOutcome(outcome);
    } catch (e) {
      if (e instanceof AppError && e.code === "auth/already-exists") {
        // 内側の wrapAuthError で warn 済み。二重 warn を避けて文言だけ差し替える。
        setError("このメールアドレスは既に登録されています。「ログイン」タブから受付してください。");
        return;
      }
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }
  ```

  4. タブリストの配列に 1 要素追加（順序は ゲスト → ログイン → 新規登録）:

  ```tsx
  {(
    [
      ["guest", "ゲスト"],
      ["login", "ログイン"],
      ["register", "新規登録"],
    ] as [Tab, string][]
  ).map(([value, label]) => ( ... ))}
  ```

  5. ゲストタブの表示名欄を `DisplayNameField` に差し替える:

  ```tsx
  {tab === "guest" ? (
    <form onSubmit={onGuestSubmit} className="space-y-3">
      <DisplayNameField id="g-name" value={displayName} onChange={setDisplayName} />
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "処理中…" : "ゲストで受付"}
      </Button>
      <p className="text-xs text-muted-foreground">
        匿名参加です。別端末からの再ログインはできません。
      </p>
    </form>
  ) : null}
  ```

  6. ログインタブのメール / パスワード欄を `EmailPasswordFields` に差し替える
     （`passwordMinLength` は**渡さない** — 現状 minLength なしの挙動を保つ）:

  ```tsx
  {tab === "login" ? (
    <form onSubmit={onLoginSubmit} className="space-y-3">
      <EmailPasswordFields
        idPrefix="l"
        mode="login"
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
      />
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "処理中…" : "ログインして受付"}
      </Button>
    </form>
  ) : null}
  ```

  7. 新規登録タブを追加（ログインタブブロックの直後）:

  ```tsx
  {tab === "register" ? (
    <form onSubmit={onRegisterSubmit} className="space-y-3">
      <DisplayNameField id="r-name" value={displayName} onChange={setDisplayName} />
      <EmailPasswordFields
        idPrefix="r"
        mode="register"
        email={email}
        password={password}
        onEmailChange={setEmail}
        onPasswordChange={setPassword}
        passwordMinLength={PASSWORD_MIN_LENGTH}
      />
      <Button type="submit" className="w-full" disabled={submitting}>
        {submitting ? "処理中…" : "登録して受付"}
      </Button>
      <p className="text-xs text-muted-foreground">
        アカウントを作ると、次回以降も同じアカウントで参加できます。
      </p>
    </form>
  ) : null}
  ```

- **MIRROR**: UI_PATTERN（タブ定義とフォーム）／ UI_PATTERN（form 側の事前バリデーション）／
  ERROR_HANDLING（UI 側）
- **IMPORTS**: 上記のとおり。`AppError` は既に import 済み（`@/lib/errors`）
- **GOTCHA**:
  - **既定タブは `"guest"` のまま**。変更するとタブ既定を前提にした既存 E2E
    （`email-link-removed.spec.ts` / `table-label-and-color.spec.ts` 等の
    ゲスト受付フロー）が壊れる
  - `displayName` / `email` / `password` の state は**ゲスト / ログイン / 新規登録で共用**する。
    現状もゲストとログインで `displayName` / `email` を共用しており、
    タブ切替時にクリアしない挙動を踏襲する（入力の取り違えより、切替直後の消失の方が害が大きい）
  - `id` は `g-name`（ゲスト）/ `l-*`（ログイン）/ `r-*`（新規登録）で衝突しない。
    タブは 1 つずつしか render されないが、**id が重複すると `getByLabel` が
    strict mode 違反になる**ため接頭辞を分ける
  - `refreshUser()` は `applyReceiptOutcome` の**前**に呼ぶ（`onGuestSubmit` と同じ順序）
  - `auth/already-exists` の分岐で `wrapError` を通さないのは**二重 warn 回避**のため
    （`registerWithEmail` 内の `wrapAuthError` が既に warn 済み）。
    ユーザー向け文言に技術スタック名を出さないこと
  - タブが 3 つになるが、`max-w-md` の Card 内で `px-3 py-2` × 3 は 375px 幅でも収まる
    （PRD の Technical Risks「タブ数が増え受付画面が煩雑化」への対応。実機幅で目視確認する）
- **VALIDATE**: `npm run typecheck` / `npm run lint` が 0 error。`npm run build` 成功

### Task 6: 共有コンポーネントの unit test を新規作成

- **ACTION**: `src/components/auth/DisplayNameField.test.tsx` と
  `src/components/auth/EmailPasswordFields.test.tsx` を作成。
- **IMPLEMENT**:

  両ファイルとも **mock 不要**（`Input` / `Label` は firebase を辿らない純 UI プリミティブ、
  `DISPLAY_NAME_MAX_LENGTH` は定数 export）。`render` して DOM 属性を assert する。

  `DisplayNameField.test.tsx`（4 ケース）:

  | # | シナリオ | 検証 |
  | --- | --- | --- |
  | 1 | 既定の props | `getByLabelText("表示名")` が存在し `maxLength="15"` / `required` を持つ／既定 hint「15 文字以内で入力してください。」が出る |
  | 2 | `label` / `hint` を上書き | 「表示名（必須）」が label になり、渡した hint ノードが描画される |
  | 3 | 入力すると `onChange` に**文字列**が渡る | `fireEvent.change(input, { target: { value: "Alice" } })` → `onChange` が `"Alice"` で呼ばれる |
  | 4 | `id` が label と input を結ぶ | `getByLabelText(...)` が `id` 指定の input を返す（`toHaveAttribute("id", "reg-name")`） |

  `EmailPasswordFields.test.tsx`（4 ケース）:

  | # | シナリオ | 検証 |
  | --- | --- | --- |
  | 1 | `idPrefix="l"` | input の id が `l-email` / `l-password` になる |
  | 2 | `mode="login"` | password の `autoComplete` が `current-password` |
  | 3 | `mode="register"` | password の `autoComplete` が `new-password` |
  | 4 | `passwordMinLength` 未指定 / 指定 | 未指定なら `minLength` 属性なし、`6` 指定なら `minLength="6"` |

  骨子:

  ```tsx
  import { fireEvent, render, screen } from "@testing-library/react";
  import { describe, expect, it, vi } from "vitest";

  import { DisplayNameField } from "./DisplayNameField";

  describe("DisplayNameField", () => {
    it("既定 props で表示名ラベル・15 字上限・既定 hint を描画する", () => {
      render(<DisplayNameField id="g-name" value="" onChange={vi.fn()} />);
      const input = screen.getByLabelText("表示名");
      expect(input).toHaveAttribute("maxLength", "15");
      expect(input).toBeRequired();
      expect(screen.getByText("15 文字以内で入力してください。")).toBeInTheDocument();
    });
    ...
  });
  ```

- **MIRROR**: TEST_STRUCTURE（client component unit）。ただし本 2 ファイルは
  firebase 依存が無いため `vi.mock` ブロックを持たない
- **IMPORTS**: `@testing-library/react` / `vitest`（既存の component test と同じ）
- **GOTCHA**:
  - `getByLabelText` を使う（`getByLabel` は Playwright の API で、
    Testing Library では `getByLabelText`）
  - `toHaveAttribute("maxLength", "15")` は **DOM 属性名の大文字小文字に注意**。
    React は `maxLength` prop を `maxlength` 属性に落とすため、
    `toHaveAttribute("maxlength", "15")` の方が確実。どちらか一方で green を確認して採用する
  - **数値 `15` を直書きしない**方針も検討できるが、`DISPLAY_NAME_MAX_LENGTH` を
    テスト側でも import すると「定数を変えたらテストも一緒に動く」ため回帰を検出できない。
    ここは**意図的に literal を書く**（characterization test の性質）
- **VALIDATE**: `npm run test -- src/components/auth` が green

### Task 7: `receipt.test.ts` / `join-client.test.tsx` を更新

- **ACTION**: 既存 2 つの test ファイルに新経路のケースを追加する。
- **IMPLEMENT**:

  (a) [src/lib/services/receipt.test.ts](../../../../src/lib/services/receipt.test.ts)

  1. `auth-actions` の mock に `registerWithEmail` を追加（**これを忘れると
     `receipt.ts` の import が `undefined` になり実行時 TypeError**）:

  ```ts
  vi.mock("@/lib/services/auth-actions", () => ({
    attemptAnonymousSelfDelete: vi.fn(),
    signInAsGuest: vi.fn(),
    loginWithEmail: vi.fn(),
    registerWithEmail: vi.fn(),
    signInWithGoogle: vi.fn(),
  }));
  ```

  併せて import 文と `joinAsNewUser` の import も追加する。

  2. 新規 describe `"joinAsNewUser (08 Phase 3)"` を追加（5 ケース）:

  | # | シナリオ | 検証 |
  | --- | --- | --- |
  | 1 | 正常系 | `registerWithEmail("a@example.com", "pass123456", "Alice")` が 1 回／`outcome` が `{result:"created", autoJoin:{gid:"g1",status:"joined"}}` |
  | 2 | 自動所属へ表示名が渡る | `joinGroupViaTournament` が `expect.objectContaining({ displayName: "Alice" })` で呼ばれる |
  | 3 | 呼出順序 | `registerWithEmail` → `upsertPlayer` → `joinGroupViaTournament` の `mock.invocationCallOrder` が昇順 |
  | 4 | 登録失敗時は受付しない | `registerWithEmail` が `auth/already-exists` の `AppError` を reject → `joinAsNewUser` が同 code で reject し、`upsertPlayer` / `joinGroupViaTournament` が未呼出 |
  | 5 | 自動所属失敗でも受付は成功 | `joinGroupViaTournament` reject → `{result:"created", autoJoin:{gid:"g1",status:"failed"}}` ＋ `logger.warn` 1 本 |

  `beforeEach` の骨子（既存 describe を踏襲）:

  ```ts
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(registerWithEmail)
      .mockReset()
      .mockResolvedValue({
        uid: "u-new",
        email: "a@example.com",
        displayName: "Alice",
        isAnonymous: false,
      } as unknown as Awaited<ReturnType<typeof registerWithEmail>>);
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
    mockAuthState.currentUser = null;
  });
  ```

  (b) [src/app/join/[tid]/join-client.test.tsx](../../../../src/app/join/%5Btid%5D/join-client.test.tsx)

  1. receipt mock に `joinAsNewUser: vi.fn()` を追加し、`beforeEach` で
     `vi.mocked(joinAsNewUser).mockReset()` する。

  2. 新規 describe `"JoinClient — 新規登録タブ（08 Phase 3）"` を追加（4 ケース）:

  | # | シナリオ | 検証 |
  | --- | --- | --- |
  | 1 | タブが 3 つある | `getByRole("tab", { name: "ゲスト" })` / `"ログイン"` / `"新規登録"` がすべて存在し、既定の `aria-selected="true"` は「ゲスト」 |
  | 2 | 新規登録タブで送信 | 表示名 / メール / パスワードを埋めて「登録して受付」→ `joinAsNewUser` が `{tid:"t1", email, password, displayName}` で 1 回呼ばれ、「受付完了」＋「土曜サークル のメンバーになりました。」が出る |
  | 3 | 表示名 15 字超で送信 | `joinAsNewUser` が**呼ばれず**、`validation/join` を含むエラーが出る |
  | 4 | `auth/already-exists` | 「このメールアドレスは既に登録されています。「ログイン」タブから受付してください。」が出て、完了画面へ遷移しない（`queryByText("受付完了")` が null） |

  ケース 4 の reject 値は AppError の実体を使わず、mock 済み helper 境界に合わせて
  `code` を持つオブジェクトで良いか要確認 —— **`join-client.tsx` は
  `e instanceof AppError` で分岐する**ため、`@/lib/errors` は mock せず
  実体の `AppError` を import して reject させる:

  ```ts
  import { AppError } from "@/lib/errors";
  ...
  vi.mocked(joinAsNewUser).mockRejectedValue(
    new AppError("新規登録に失敗しました", "auth/already-exists"),
  );
  ```

  操作 helper（既存 `receiveWithSignedInAccount` の隣に置く）:

  ```tsx
  async function submitRegisterTab(input: {
    displayName: string;
    email: string;
    password: string;
  }) {
    render(<JoinClient tid="t1" />);
    fireEvent.click(screen.getByRole("tab", { name: "新規登録" }));
    fireEvent.change(screen.getByLabelText("表示名"), {
      target: { value: input.displayName },
    });
    fireEvent.change(screen.getByLabelText("メールアドレス"), {
      target: { value: input.email },
    });
    fireEvent.change(screen.getByLabelText("パスワード"), {
      target: { value: input.password },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "登録して受付" }));
    });
  }
  ```

- **MIRROR**: TEST_STRUCTURE（service unit）／ TEST_STRUCTURE（client component unit）／
  [testing.md](../../../rules/testing.md) の mock 境界規約
- **IMPORTS**: `registerWithEmail`（receipt.test）／ `joinAsNewUser` ＋ `AppError`（join-client.test）
- **GOTCHA**:
  - **既存テストを skip / 削除しない**。本 Phase の変更で既存 assertion が壊れるのは
    `join-client.test.tsx` の `getByLabelText` 周りくらいで、
    ゲストタブの label は「表示名」のまま変わらない（`DisplayNameField` の既定値）
  - `fireEvent.click` は `act()` の**外**に出す（Phase 2 で `act()` 環境警告が出た先例）。
    送信ボタンのクリックのみ `await act(async () => ...)` で包む
  - `getByLabelText("パスワード")` は新規登録タブで 1 つだけ（ログインタブは未 render）
  - 順序 assertion は `mock.invocationCallOrder`（vitest 標準）。
    `toHaveBeenCalledBefore` は jest-extended 依存なので使わない
- **VALIDATE**: `npm run test -- src/lib/services/receipt.test.ts` ／
  `npm run test -- src/app/join` がいずれも green

### Task 8: E2E と POM を更新

- **ACTION**: POM 1 ファイル ＋ spec 2 ファイルを更新する。
- **IMPLEMENT**:

  (a) [tests/e2e/pages/JoinPage.ts](../../../../tests/e2e/pages/JoinPage.ts)

  未使用の `emailTab`（旧 Email Link 方式の「メール登録」タブ）を、実装に合わせて置換する:

  ```ts
  readonly guestTab: Locator = this.page.getByRole("tab", { name: "ゲスト" });
  readonly loginTab: Locator = this.page.getByRole("tab", { name: "ログイン" });
  // 08-auto-group-join-on-entry Phase 3: 受付画面から新規アカウントを作るタブ。
  readonly registerTab: Locator = this.page.getByRole("tab", { name: "新規登録" });
  ```

  (b) [tests/e2e/email-link-removed.spec.ts](../../../../tests/e2e/email-link-removed.spec.ts)

  ファイル冒頭コメントの 3 行目と、`/join/[tid]` のテストを更新する。
  **このテストの本来の目的は「Email Link サインイン方式が消えていること」**なので、
  検証対象を「『メール登録』タブが無い」から「『メールリンク』タブが無い」へ移す:

  ```ts
  /**
   * Phase 4.5: Email Link サインイン方式を撤廃した後の回帰テスト。
   *   - `/auth/email-link` へ直接アクセスで 404
   *   - `/login` タブは「ログイン」「新規登録」のみ（「メールリンク」不在）
   *   - `/join/[tid]` タブは「ゲスト」「ログイン」「新規登録」（「メールリンク」/「メール登録」不在）
   *     ※「新規登録」タブは 08-auto-group-join-on-entry Phase 3 で追加（Email Link とは別方式）
   */
  ```

  ```ts
  test("/join/[tid] has guest + login + register tabs (no email link tab)", async ({
    page,
    joinPage,
  }) => {
    ...
    await expect(guestPage.getByRole("tab", { name: "ゲスト" })).toBeVisible();
    await expect(guestPage.getByRole("tab", { name: "ログイン" })).toBeVisible();
    await expect(guestPage.getByRole("tab", { name: "新規登録" })).toBeVisible();
    // 旧 Email Link 方式のタブは復活していない
    await expect(guestPage.getByRole("tab", { name: "メール登録" })).toHaveCount(0);
    await expect(guestPage.getByRole("tab", { name: "メールリンク" })).toHaveCount(0);
    ...
  });
  ```

  (c) [tests/e2e/auto-group-join.spec.ts](../../../../tests/e2e/auto-group-join.spec.ts)

  既存 3 テストの**末尾に 1 件追加**（既存テストは変更しない）:

  ```ts
  test("受付画面の「新規登録」タブでアカウントを作ってメンバーになる", async ({
    page,
    groupDetailPage,
  }) => {
    const { gid, tid } = await seedOwnerTournament(page, "owner4");

    const browser = page.context().browser();
    if (!browser) throw new Error("browser unavailable");
    // 未サインインの端末から、受付画面だけでアカウント作成 → 受付 → 自動所属まで完結させる。
    const newUserCtx = await browser.newContext();
    const newUser = randomOrganizer("newbie");
    try {
      const joinPage = await newUserCtx.newPage();
      await joinPage.goto(`/join/${tid}`);
      await joinPage.getByRole("tab", { name: "新規登録" }).click();
      await joinPage.getByLabel("表示名").fill(newUser.displayName);
      await joinPage.getByLabel("メールアドレス").fill(newUser.email);
      await joinPage.getByLabel("パスワード").fill(newUser.password);
      await joinPage.getByRole("button", { name: "登録して受付" }).click();

      // Cold emulator では auth 作成 + 複数 Firestore write が走るため 30s 許容。
      await expect(joinPage.getByText("受付完了")).toBeVisible({ timeout: 30_000 });
      await expect(joinPage.getByText(`${GROUP_NAME} のメンバーになりました。`)).toBeVisible({
        timeout: 15_000,
      });

      // フルリロード後も（= Firestore に永続化された状態で）サークルが見える
      await joinPage.goto("/groups");
      await expect(joinPage.locator("#main").getByText(GROUP_NAME)).toBeVisible({
        timeout: 15_000,
      });
    } finally {
      await newUserCtx.close();
    }

    // owner 側のメンバー一覧にも現れる（招待コード未使用）
    const detail = groupDetailPage(gid);
    await detail.goto();
    await detail.expectLoaded();
    await detail.selectTab("members");
    await expect(page.getByRole("listitem").filter({ hasText: newUser.displayName })).toBeVisible({
      timeout: 15_000,
    });
  });
  ```

- **MIRROR**: E2E_STRUCTURE（2 context・自動所属）。`seedOwnerTournament` / `GROUP_NAME` /
  `randomOrganizer` は同ファイル内の既存 helper をそのまま使う
- **IMPORTS**: `auto-group-join.spec.ts` は既存 import のみで足りる（追加不要）
- **GOTCHA**:
  - `randomOrganizer("newbie")` は `displayName` を 15 字に切り詰め済み
    （`prefix-suffix` で `newbie-xxxxxx` = 13 字）。listitem の一致に使える
  - `registerOrganizer` は使わない。**`/login` を経由しないこと**が本テストの主旨
  - `getByRole("button", { name: "登録して受付" })` は substring match だが、
    同画面に他の「登録」ボタンは無い
  - `test.describe` 単位で emulator が reset される（`autoResetEmulator` fixture）ため、
    各テストは自前で seed する。`owner4` prefix で他テストとアカウント衝突を避ける
  - 各 context は `finally` で必ず `close()` する（既存 3 テストと同じ）
- **VALIDATE**: `npm run test:e2e -- tests/e2e/auto-group-join.spec.ts` が **4/4 pass**、
  `npm run test:e2e -- tests/e2e/email-link-removed.spec.ts` が **5/5 pass**

### Task 9: ドキュメント更新

- **ACTION**: 規約ファイルと PRD を更新する。
- **IMPLEMENT**:

  (a) [.claude/rules/group-membership.md](../../../rules/group-membership.md) の
  「**アプリ側の呼出経路（Phase 2）**」節を更新する。

  変更前:

  ```markdown
  `joinAsExistingUser` / `joinViaGoogle` / `joinAsCurrentUser` の 3 経路がこれを通り、
  **`joinAsGuest`（匿名）だけが通らない**（rule の `isSignedInNotAnon()` と併せた二重防御）。
  ```

  変更後:

  ```markdown
  `joinAsExistingUser` / `joinViaGoogle` / `joinAsCurrentUser` / `joinAsNewUser`（Phase 3）の
  4 経路がこれを通り、**`joinAsGuest`（匿名）だけが通らない**
  （rule の `isSignedInNotAnon()` と併せた二重防御）。
  ```

  同節末尾の DRIFT WARNING も、Phase 3 が実際に規約どおり実装されたことを反映する:

  ```markdown
  ⚠ DRIFT WARNING: 受付経路を追加する場合は **`receiveEntry` を経由させる**こと。
  `ensurePlayerCreated` を直接呼ぶと自動所属が抜ける。
  Phase 3 の新規登録タブ（`joinAsNewUser` = `registerWithEmail` → `receiveEntry`）が
  この規約に沿った先例。
  ```

  (b) PRD [08-auto-group-join-on-entry.prd.md](../prds/08-auto-group-join-on-entry.prd.md):

  1. Implementation Phases 表の Phase 3 行を
     `pending` → `in-progress` にし、PRP Plan 列に
     `[phase-3-join-register-tab.plan.md](../plans/phase-3-join-register-tab.plan.md)` を入れる
  2. Open Questions の 4 つ目
     「**受付画面の新規メール登録タブ**（Q3 で追加を決定）: … Phase 3 で判断。」に
     決着を追記してチェック済み `[x]` にする:

     ```markdown
     - [x] **受付画面の新規メール登録タブ**（Q3 で追加を決定）: 既存の `/login` 登録フォームとの
       UI 重複は **共通コンポーネント抽出**で解消する（`DisplayNameField` /
       `EmailPasswordFields` を `src/components/auth/` に新設し、`/login` と `/join/[tid]` の
       双方から利用）。`/login` の外側レイアウト（表示名の枠囲みボックス・区切り線・
       Google ボタン配置）は抽出対象外とし、見た目を等価に保つ。（Phase 3 で決定）
     ```
  3. Decisions Log に 2 行追加:

     | Decision | Choice | Alternatives | Rationale |
     | --- | --- | --- | --- |
     | 受付画面と `/login` の登録フォーム共通化 | 共通コンポーネント抽出（`DisplayNameField` / `EmailPasswordFields`） | 受付画面専用の簡易フォーム | 入力欄の重複が 3 callsite に及ぶため。外側レイアウトは抽出せず `/login` の見た目を等価に保つことで回帰リスクを抑える |
     | 受付画面の既定タブ | ゲストのまま | 新規登録を既定にする | 当日の最速動線（匿名受付）を維持し、既存 UX / E2E を非回帰にする。新規登録は 1 タップで到達できる |

- **VALIDATE**: リンク先パスが実在すること（相対パスを手動確認）。
  PRD の Phase 3 行から plan へのリンクが解決すること

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `joinAsNewUser` 正常系 | email/password/displayName | `registerWithEmail` 1 回 ＋ `{result:"created", autoJoin:{status:"joined"}}` | - |
| `joinAsNewUser` の displayName 受渡 | displayName="Alice" | `joinGroupViaTournament` が `displayName:"Alice"` で呼ばれる | - |
| `joinAsNewUser` の呼出順序 | 同上 | `registerWithEmail` < `upsertPlayer` < `joinGroupViaTournament` | ✓（rule 前提） |
| 登録失敗時は受付しない | `registerWithEmail` reject（`auth/already-exists`） | 同 code で reject ／ `upsertPlayer` / `joinGroupViaTournament` 未呼出 | ✓ |
| 自動所属失敗でも受付成功 | `joinGroupViaTournament` reject | `autoJoin.status==="failed"` ＋ warn 1 本 | ✓（best-effort） |
| タブが 3 つ | render | ゲスト / ログイン / 新規登録 が存在、既定選択は ゲスト | ✓（既定非回帰） |
| 新規登録タブ送信 | 3 項目入力 → 「登録して受付」 | `joinAsNewUser` が正しい引数で 1 回 ／ 所属メッセージ表示 | - |
| 表示名 15 字超 | 16 字入力 | `joinAsNewUser` 未呼出 ／ `validation/join` エラー表示 | ✓（アカウント作成前に弾く） |
| 既登録メール | `auth/already-exists` reject | ログインタブ誘導文言 ／ 完了画面へ遷移しない | ✓ |
| `DisplayNameField` 既定 | props 最小 | label「表示名」／ `maxlength=15` ／ 既定 hint | - |
| `DisplayNameField` 上書き | label / hint 指定 | 上書きが反映される（`/login` 用） | ✓ |
| `DisplayNameField` の onChange | change イベント | **文字列**が渡る | ✓（API 契約） |
| `EmailPasswordFields` の id | `idPrefix="l"` | `l-email` / `l-password` | ✓（衝突回避） |
| `EmailPasswordFields` の autoComplete | mode 別 | `current-password` / `new-password` | ✓ |
| `EmailPasswordFields` の minLength | 未指定 / 6 | 属性なし / `minlength=6` | ✓（`/join` ログインタブ非回帰） |

### E2E Tests

| Test | 検証 |
| --- | --- |
| 受付画面の新規登録タブ → メンバー化（新規） | 「受付完了」＋所属メッセージ ／ `/groups` に出る ／ owner 側メンバー一覧に出る（招待コード未使用・`/login` 未経由） |
| `/join/[tid]` のタブ構成（更新） | ゲスト / ログイン / 新規登録 が見え、「メールリンク」「メール登録」が無い |
| 既存 3 テスト（`auto-group-join.spec.ts`） | 非回帰（このアカウントで受付 / ログインして受付 / 匿名ゲスト） |
| `/login` 系（`email-link-removed.spec.ts` ほか） | 抽出後も `registerOrganizer` / `loginPage.register` / `loginPage.login` が動く |

### Edge Cases Checklist

- [ ] 表示名が空 → `validation/join` で弾き、アカウントを作らない
- [ ] 表示名が 15 字超 → 同上（`<Input maxLength>` ですり抜けは通常起きないが二重防御）
- [ ] パスワードが 6 字未満 → ブラウザの `minLength` で送信されない
- [ ] 既に登録済みのメール → ログインタブ誘導文言（二重 warn なし）
- [ ] 終了済みトーナメント → 受付は失敗するがアカウントは残る（既知の既存挙動）
- [ ] 自動所属だけ失敗 → 「受付完了」＋再試行注記（Phase 2 の経路が効く）
- [ ] 匿名ゲストが新規登録タブを使う → 別 uid の新アカウントになる（連携はしない・PRD Won't）
- [ ] タブ切替で入力値が消えない（`displayName` / `email` / `password` は共用 state）
- [ ] `/login` の見た目・ラベル・`reg-name` への focus が非回帰
- [ ] 375px 幅でタブ 3 つが折り返さない

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
npm run lint
```

EXPECT: 0 errors / 0 warnings

### Unit Tests（対象領域）

```bash
npm run test -- src/components/auth
npm run test -- src/lib/services/receipt.test.ts
npm run test -- src/app/join
```

EXPECT: すべて pass

### Full Test Suite

```bash
npm run test
```

EXPECT: Phase 2 完了・レビュー反映後の **1615 passed / 103 files** から
新規分（+17 前後 / +2 files）だけ増加し、失敗ゼロ

### Format

```bash
npx prettier --check "src/components/auth/**" "src/app/join/**" "src/app/login/**" "src/lib/services/receipt.ts" "tests/e2e/**"
```

EXPECT: All matched files use Prettier code style
（`npm run format:check` で全体を見てもよい。整形が要る場合は `npm run format`）

### Build

```bash
npm run build
```

EXPECT: 成功

### Rules 非回帰（rule 変更なしの確認）

```bash
git diff --stat firestore.rules
npm run test:rules-limits
```

EXPECT: `firestore.rules` の差分が**空**（本 Phase は rule に触れない）／
`test:rules-limits` が ALL GREEN

### E2E

```bash
npm run test:e2e -- tests/e2e/auto-group-join.spec.ts
npm run test:e2e -- tests/e2e/email-link-removed.spec.ts
npm run test:e2e
```

EXPECT: `auto-group-join` 4/4 pass ／ `email-link-removed` 5/5 pass ／
全件で既存 spec 非回帰（特に `/login` を経由する `registerOrganizer` 依存の全 spec、
`anonymous-flow-completion` / `displayname-propagation` / `account-self-delete`）

### Manual Validation

- [ ] `/join/[tid]` を未サインインで開き、タブが「ゲスト / ログイン / 新規登録」の 3 つで
      既定が「ゲスト」になっている
- [ ] 「新規登録」タブで表示名・メール・パスワードを入れて「登録して受付」→
      「受付完了」＋「◯◯ のメンバーになりました。」が出る
- [ ] そのままサイドバー / `/groups` に当該サークルが出ている
- [ ] 既に使われているメールで登録するとログインタブ誘導の文言が出る（画面遷移しない）
- [ ] スマホ実機幅（375px 相当）でタブ 3 つが折り返さず、フォームが 1 画面に収まる
- [ ] `/login` の新規登録タブが**従来どおり**（表示名ボックスの枠・区切り線・
      Google ボタン・表示名未入力時の focus 移動）
- [ ] `git diff` に `.env` / `apiKey` / `token` / `secret` の混入がない

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation コマンドが pass
- [ ] テストが実装と**同一 commit** に入っている（[testing.md](../../../rules/testing.md)）
- [ ] 型エラー / lint エラーなし
- [ ] UX デザイン（Before/After）どおりの表示になっている
- [ ] 新規登録経路が `receiveEntry` を通ることが unit test（呼出順序）で固定されている
- [ ] `/login` の DOM ラベル・`reg-name` id・見た目が等価であることを E2E で確認済み
- [ ] `firestore.rules` に一切変更がない（`git diff --stat firestore.rules` が空）
- [ ] 既存テストの skip / 削除がゼロ（`email-link-removed.spec.ts` は
      「振る舞いを検証する形への書き換え」であり削除ではない）

## Completion Checklist

- [ ] 発見したパターンに従っている（component / service / UI / test の 4 層とも）
- [ ] エラー処理が規約どおり（`AppError` 判定で二重 warn を避ける・握りつぶしなし）
- [ ] ログが規約どおり（`logger` 経由のみ、`console.*` なし）
- [ ] テストが test 規約どおり（helper 境界 mock / fixture factory / skip 禁止）
- [ ] ハードコード値なし（`DISPLAY_NAME_MAX_LENGTH` / `PASSWORD_MIN_LENGTH` を定数参照）
- [ ] ユーザー向け文言に技術スタック名が出ていない
- [ ] ドキュメント更新済み（group-membership.md / PRD 進捗表・Open Questions・Decisions Log）
- [ ] 不要なスコープ追加なし（NOT Building を守っている）
- [ ] 自己完結 — 実装中にコードベース検索が要らない

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| **共有コンポーネント抽出で `/login` の見た目・挙動が壊れる**（`/login` に unit test が無い） | **M** | **H** | 抽出は「入力欄の中身」のみに限定し、外側レイアウトは 1 行も動かさない。`inputClassName` / `className` / `label` / `hint` で `/login` 固有の差分を完全に吸収。`reg-name` id を維持。Task 6 で共有コンポーネント自体の unit test を新設し、E2E（`email-link-removed` の `/login` 3 テスト ＋ `registerOrganizer` 依存の全 spec）で最終確認する |
| `email-link-removed.spec.ts` が「メール登録」タブ不在を assert しており、タブ追加で赤くなる | **H**（確実） | L | Task 8 で更新済み。ラベルを「メール登録」ではなく「**新規登録**」にしたため文字列衝突もない（Playwright の substring match でも「新規登録」⊅「メール登録」） |
| 終了済みトーナメントの QR で新規登録すると、受付は失敗するが Auth アカウントが残る | L | L | `joinAsExistingUser`（ログイン成功後に受付失敗）と同型の既存挙動。作られたアカウントはそのままログインに使えるため実害が小さい。ロールバックは `user.delete()` の失敗経路を新設することになり、best-effort 設計と釣り合わない |
| 匿名ゲストが新規登録タブを使い、匿名の player doc が孤立する | L | L | 既存「ログイン」タブと同挙動（アカウント切替）。匿名 → 連携の遡及加入は PRD の Won't。取り消しは `/join` の「参加を取り消す」で可能 |
| タブ 3 つで受付画面が窮屈になる | L | L | PRD の Technical Risks に既出。`max-w-md` × `px-3 py-2` で 375px 幅に収まる計算。Manual Validation に実機幅チェックを入れた |
| `id` 変更（`email`/`password` → `login-email`/`login-password`）で何かが壊れる | L | M | `getElementById` / `locator("#...")` を全 grep 済み。参照は `reg-name` の 1 箇所のみで、それは維持する |
| Phase 4（除名 UI）との同時作業でコンフリクト | L | L | 触るファイルが分離（Phase 4: `group.ts` / `groups/[gid]` 配下）。`group-membership.md` のみ両者が編集するので、本 Phase は「アプリ側の呼出経路（Phase 2）」節だけに追記する |
| E2E の cold emulator タイムアウトで flaky | M | L | アカウント作成 + 受付 + 自動所属で write が増えるため、完了待ちは 30s、以降の表示待ちは 15s（既存 spec と同方針） |

## Notes

### 設計判断: 共通コンポーネントの粒度

PRD Open Questions が Phase 3 に委ねていた「共通コンポーネント抽出 or 受付画面専用の簡易版」は、
ユーザー判断により**抽出**を採用した。ただし抽出の粒度は「フォーム全体」ではなく
**「入力欄（Label + Input + hint）」**に留める。理由:

- `/login` の register モードは、表示名を **メール登録と Google 登録で共有する**ため
  枠囲みボックス ＋「登録方法を選択」区切り線という固有レイアウトを持つ。
  ここまで共通化すると `variant` prop が増えて逆に読みにくくなる（YAGNI）
- 受付画面は Google ボタンがタブの**外**にあり、`/login` とはフォームの組み立てが違う
- 入力欄レベルなら 3 callsite（`/login` / `/join` ゲストタブ / `/join` 新規登録タブ）で
  素直に再利用でき、将来 `DisplayNameDialog` / `/settings` を 4 番目の consumer に
  加える余地も残る

### 設計判断: `joinAsNewUser` を service 層に置く

UI から `registerWithEmail` → `joinAsCurrentUser` を続けて呼ぶ実装でも動くが、採らない:

- Phase 2 の教訓（`group-membership.md` の DRIFT WARNING）どおり、
  **受付経路は `receiveEntry` を通る service 関数として 1 本足す**のが規約
- 「アカウント作成 → 受付」の順序制約と、`displayName` を hint として引き継ぐ責務が
  UI に漏れるのを防ぐ
- `joinAsExistingUser`（ログイン → 受付）と対称になり、
  4 経路が同じ形で並ぶことで次の経路追加時の迷いが消える

### 設計判断: 既定タブを「ゲスト」のまま維持する

PRD の狙い（受付者を確実にメンバー化する）からは「新規登録」を既定にする案もあるが、
ユーザー判断により**ゲスト維持**。当日オペレーションの最速動線を保ちつつ、
新規登録は 1 タップで到達できる。将来「匿名受付が多すぎる」と分かった時点で
再検討すればよい（既定タブの変更は 1 行）。

### `passwordMinLength` を mode 連動にしなかった理由

`/login` は現状 **login モードでも `minLength={6}`** を付けている。
`mode === "register"` のときだけ付ける実装に変えると、
6 字未満の既存パスワードを持つユーザーのログイン可否という**認証挙動の変更**になる。
本 Phase はリファクタであって挙動変更ではないため、各 callsite が現状値を明示的に渡す形にした。
統一するなら別途 UX 判断として切り出す。

### Phase 4 への申し送り

- 本 Phase は `groups/{gid}` の書込経路を増やさない（`joinAsNewUser` も
  既存 `addSelfViaTournamentEntry` に合流する）。除名 UI の設計に影響なし
- `src/components/auth/` に共有入力欄が 2 つ増えたので、除名確認ダイアログで
  入力欄が要る場合は再利用を検討すること
