# Plan: Track D — Chic Dark Theme & Theme Toggle（個人単位）

## Summary

Phase A.x / B.1 / C.1 が完了し PRD 01〜04 の core 機能が成熟した今、UI 全体に「シックなダークモード」基調の選択肢を導入する。既に `globals.css` には shadcn 標準の `.dark` パレットが定義済みで、`tailwind.config.ts` も `darkMode: ["class"]` で class-toggle 方式に揃っているが、(1) **切替手段（toggle UI）が無い**、(2) **既存 `.dark` palette が stock の zinc/black で「シック」と呼べる完成度に届かない**、(3) **page.tsx / WinnerBanner / QrPanel など一部にハードコード色が残り dark 切替時に視認性が崩れる** の 3 点で実用に至らない。

本 plan は **post-launch-polish PRD の新 Track D / Phase D.1** として、(a) `chic` を意識したカスタムダークパレット（深ネイビー + 暖色グレー + 銀アクセント）への塗替え、(b) `ThemeProvider`（手動実装・依存追加なし）+ **`/settings` 画面の新規 Card として配置するトグル UI**、(c) `localStorage["allinpt.theme"]` による個人 preference 永続化、(d) ハードコード色の dark variant 補完、(e) PWA manifest / viewport themeColor の light/dark 整合を 1 PR に bundle する。`next-themes` は導入しない（security-base.md の依存追加 ask 規約と「依存最小化」プロジェクト方針に従う）。OG SSR 画像経路は Satori が CSS 変数を解決しない構造上対象外（既存の `bgTextTheme` query で既に dual-theme 対応済み）。

**設計方針**: テーマは **個人 preference（ユーザー端末ごとの選択）**。Firestore / `groups/{gid}` には一切依存しない。トグル UI は **`/settings` 画面に集約**し、サイドバー / ヘッダ / その他に同種トグルを置かない（個人設定の集約場所として `/settings` を一本化）。`/settings` は signed-in 必須（`RequireAuth`）のため、signed-out / 匿名ユーザーは UI から切替できないが、ThemeProvider 自体は全画面で動作し、初期値 = `system` で OS 設定追従するため UX 破綻はない。

## User Story

As a サークル運営者 / 参加者,
I want アプリのトップから設定 / トーナメント運営画面まで一貫した「落ち着いた色調」で操作したい。会場の照明が暗い夜帯セッションでも目に優しく、SNS スクリーンショットでも安っぽく見えないトーンが欲しい。自分の端末ごとに Light / Dark / System を選べる,
So that 長時間の運営でも疲れず、SNS で他サークルに紹介したくなる質感のアプリだと感じられる。

## Problem → Solution

| 現状 | 目標 |
| --- | --- |
| Light のみ表示（明るい / 白基調） | Light / Dark / System の 3 状態を切替可能 |
| `.dark` パレット = shadcn stock（zinc）で雑然 | `.dark` パレット = 深ネイビー基調の chic な配色 |
| トグル UI 無し（OS の dark 検出も拾わない） | **`/settings` 画面に「テーマ」Card を新規追加**し Sun / Moon / Auto トグル。`localStorage["allinpt.theme"]` に永続化、初期値 = system |
| signed-out / 匿名ユーザーには切替手段なし（仕様） | ThemeProvider は全画面で動作。signed-out / 匿名は初期値 `system` で OS 設定追従。明示的切替は signed-in 後に `/settings` で行う |
| ハードコード色（QR `bg-white`, amber グラデの一部）が dark で崩れる | `dark:` prefix 補完、QR は `bg-card`、`to-yellow-200` は dark variant 追加 |
| viewport.themeColor 固定 `#0a0a0f` で light モード時にもブラウザ chrome が暗い | light / dark を `<meta name="theme-color" media="...">` で 2 値供給 |

## Metadata

- **Complexity**: Medium-Large（10〜13 ファイル / ~400 行）
- **Source PRD**: `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`
- **PRD Phase**: Track D / Phase D.1（新規 Track として PRD Implementation Phases / Decisions Log に登録済み）
- **Estimated Files**: 新規 5 / 改修 7〜9
- **DB 影響**: ゼロ（Firestore / rule / schema / emulator validator は無変更）

---

## UX Design

### Before（現状）

```
┌─────────────────────────────────────────────┐
│ ALLin-PokerTimer        ☰  [Pageタイトル]   │  ← 白ヘッダー (bg-background = #fff)
├──────────┬──────────────────────────────────┤
│ 🟢user名 │                                  │
│          │   ALLin-PokerTimer (h1)          │
│ 🏠ホーム  │   サークル一覧へ  [→]            │  ← 白基調・shadcn stock
│ 🪑卓決め  │                                  │
│ ...       │   note 紹介カード（sky / amber  │
│          │     グラデ、light のみ綺麗）     │
│          │                                  │
│ [ログアウト]                                 │
└──────────┴──────────────────────────────────┘
   ↑ サイドバー footer にトグル無し
```

### After（導入後）

```
[トップ / 各画面] — dark テーマ適用時
┌─────────────────────────────────────────────┐
│ ALLin-PokerTimer        ☰  [Pageタイトル]   │  ← Dark: 深ネイビー #0E1422
├──────────┬──────────────────────────────────┤
│ 🟢user名 │                                  │
│          │   ALLin-PokerTimer (h1)          │
│ 🏠ホーム  │   [サークル一覧へ]  [→]          │  ← 暖色シルバー文字
│ 🪑卓決め  │                                  │
│ ...       │   note 紹介カード（深い藍       │
│          │     グラデ、dark で落ち着く）    │
│ [ログアウト]                                 │  ← footer は手付かず（既存維持）
└──────────┴──────────────────────────────────┘

[個人設定画面 /settings] — 切替 UI はここに集約
┌─────────────────────────────────────────────┐
│  ┌─────────────────────────────────────┐    │
│  │ アカウント設定                        │    │  ← 既存 Card
│  │  メール / 方式 / 表示名               │    │
│  │  ─────────────────────────────────  │    │
│  │  アカウント削除                       │    │
│  └─────────────────────────────────────┘    │
│  ┌─────────────────────────────────────┐    │
│  │ テーマ 🆕                            │    │  ← 新規 Card
│  │  ◯ ☀ ライト                          │    │
│  │  ● 🌙 ダーク     ← 現在の選択         │    │
│  │  ◯ 🖥 自動 (OS の設定に従う)         │    │
│  │  ※ 設定はこの端末にのみ保存されます    │    │
│  └─────────────────────────────────────┘    │
└─────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| サイドバー footer | アカウント名 + ログアウトのみ | **無変更**（個人設定の集約場所として `/settings` を一本化したため、ここにはトグルを置かない） | PrimaryNav.tsx は touch しない |
| `/settings` 画面 | 「アカウント設定」Card 1 枚（表示名 + アカウント削除）のみ | + 「テーマ」Card を additive 追加（3 状態 radio + 説明文） | 個人設定が複数列ぶリスト感が出る。既存 Card と並列で `<main>` 内に配置 |
| 初回起動 | 常に light | `prefers-color-scheme` を初期値、preference は `localStorage["allinpt.theme"]` | FOUC 防止のため `<html>` に inline script で先に class を載せる |
| ヘッダ / カード / Dialog | light 固定 | class-based。`.dark` 適用時に palette 切替 | shadcn components は既に semantic token 経由なので追加改修不要 |
| QR コード（受付・観戦） | `bg-white` 固定 | `bg-card`（dark で薄ネイビー、light で白） | カメラ読取性のため QR 自体の前景は黒固定 |
| ブラウザ chrome（PWA / モバイル） | `#0a0a0f` 固定 | light = `#fafafa` / dark = `#0E1422` の 2 値メタ | OS 設定に応じてブラウザが選択 |
| signed-out / 匿名ユーザー | 切替手段なし（仕様）。`/settings` は `RequireAuth` で signed-in 必須 | 同上。ThemeProvider は全画面で動作し、初期値 `system` で OS 設定追従するため UI 破綻なし | 観戦モード（anon）も OS 設定追従。要望が増えれば D.2 でヘッダ右側に最小トグルを additive する選択肢 |

---

## Mandatory Reading

実装前に必ず Read するファイル:

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | `src/app/globals.css` | 1-80 | 既存 `:root` / `.dark` CSS 変数を確認し、新パレットへ差し替える対象を把握 |
| P0 | `tailwind.config.ts` | 1-65 | `darkMode: ["class"]` が既に有効。新規 token 追加が不要であることを確認 |
| P0 | `src/app/layout.tsx` | 1-90 | Provider 階層。`ThemeProvider` の挿入位置（AuthProvider の外側）と inline script の置き場 |
| P0 | `src/app/settings/settings-client.tsx` | 全体 | `/settings` 画面の構造（Card / RequireAuth / `useAuthUser`）。新規「テーマ」Card を既存 Card の下に並列追加するパターンを把握 |
| P0 | `src/app/settings/page.tsx` | 全体 | `RequireAuth(allowAnonymous=false)` で signed-in 必須をかけている前提。匿名ユーザーは `/settings` に到達できない |
| P0 | `src/app/manifest.ts` | 1-50 | `theme_color` / `background_color` 値の根拠コメントを更新 |
| P1 | `src/lib/services/current-group.tsx` | 1-50 | `localStorage["allinpt.currentGroupId"]` の先例パターン（SSR ガード + 初回 mount で hydrate） |
| P1 | `src/components/pwa/install-dismiss-storage.ts` | full | 既存 localStorage helper のパターン（key 命名 `allinpt.*` / TTL 管理 / try/catch wrap） |
| P1 | `.claude/rules/error-logging.md` | 全体 | `AppError` ラップ / `logger` 経由ログ。`pwa/storage-failed` 同様の `theme/storage-failed` を追加 |
| P1 | `src/app/page.tsx` | 51-121 | グラデーション色（sky / amber / rose）に既に `dark:` prefix 適用済みの先例 |
| P2 | `src/components/qr/QrPanel.tsx` | 全体 | `bg-white` 固定箇所。`bg-card` への置換対象 |
| P2 | `src/components/tournament/WinnerBanner.tsx` | 全体 | `from-amber-100 to-yellow-200` の dark variant が片側のみ。`to-yellow-200` の dark 補完対象 |
| P2 | `src/app/api/og/_lib/og-card-styles.ts` | 11-21 | OG 画像が CSS 変数を使わないことを念押し（dark theme は OG 経路を触らない） |
| P2 | `src/components/tournament/StructureSnapshotCard.test.tsx` | 79-102 | sky-500 token は本 Track で触らないため literal 維持（修正不要） |

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| `prefers-color-scheme` media | MDN | `window.matchMedia("(prefers-color-scheme: dark)").matches` で OS 設定取得。listener で `change` 検出 |
| `<meta name="theme-color" media="...">` | web.dev / MDN | 2 つ並べると OS 設定に応じてブラウザが選択 |
| Tailwind `darkMode: ["class"]` | Tailwind v3 docs | `.dark` クラスが祖先要素に付いた配下で `dark:` prefix が有効 |
| FOUC 対策（手動 dark mode） | next-themes README | inline `<script>` で hydration 前に class を設定 |

---

## Patterns to Mirror

### LOCALSTORAGE_PERSISTENCE_PATTERN

```ts
// SOURCE: src/components/pwa/install-dismiss-storage.ts:1-30
const STORAGE_KEY = "allinpt.pwaInstallDismissedAt";

export function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch (e) {
    logger.warn("pwa install dismiss storage read failed", {
      code: "pwa/storage-failed",
      message: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}
```

**新規 helper の対応点**: `theme-storage.ts` で同じ shape（`STORAGE_KEY = "allinpt.theme"` / SSR ガード / `try { localStorage.getItem } catch { logger.warn("theme/storage-failed") }`）。

### PROVIDER_BOOTSTRAP_PATTERN

```tsx
// SOURCE: src/lib/services/current-group.tsx:55-90 (抜粋)
export function GroupProvider({ children }: { children: ReactNode }) {
  const [currentGroupId, setCurrentGroupIdState] = useState<string | null>(null);

  useEffect(() => {
    const stored = readStoredGroupId();
    if (stored) setCurrentGroupIdState(stored);
  }, []);

  const setCurrentGroupId = useCallback((gid: string | null) => {
    setCurrentGroupIdState(gid);
    writeStoredGroupId(gid);
  }, []);

  return <GroupContext.Provider value={{ currentGroupId, setCurrentGroupId }}>{children}</GroupContext.Provider>;
}
```

**新規 ThemeProvider の対応点**: 同じ「useState + useEffect で hydrate + setter で localStorage write」の構造。`system` モード時のみ `matchMedia` listener を追加で attach。

### EXTERNAL_LINK_BUTTON_PATTERN（既存 dark variant 参考）

```tsx
// SOURCE: src/app/page.tsx:65-88 — Track B B.1 で追加済みの先例
<a
  className="... border border-border bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-100
             ... dark:from-sky-950/40 dark:via-blue-950/30 dark:to-indigo-950/40
             ... focus-visible:ring-sky-400 ..."
>
```

**新規ファイル改修の対応点**: WinnerBanner の `from-amber-100 to-yellow-200` も同じ「`dark:from-amber-950/40 dark:to-yellow-900/30`」形式で補完。

### ERROR_HANDLING（[error-logging.md](../../../rules/error-logging.md)準拠）

新規 prefix `theme/*` を [error-logging.md](../../../rules/error-logging.md) のエラードメインコード表に追加する（`pwa/*` と同列）。実利用箇所:

- `theme/storage-failed` — localStorage write/read 例外
- `theme/invalid-value` — 既存 stored 値が `"light" | "dark" | "system"` でない場合（最低限の type-guard）

### TEST_STRUCTURE（[testing.md](../../../rules/testing.md)準拠）

```tsx
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

import { ThemeProvider, useTheme } from "./theme";

describe("useTheme", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("初期値は system", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => <ThemeProvider>{children}</ThemeProvider>,
    });
    expect(result.current.theme).toBe("system");
  });

  it("setTheme('dark') 後に localStorage に保存される", () => {
    const { result } = renderHook(() => useTheme(), { wrapper: ThemeProvider });
    act(() => result.current.setTheme("dark"));
    expect(window.localStorage.getItem("allinpt.theme")).toBe("dark");
  });
});
```

---

## Files to Change

### 新規ファイル

| File | Action | Justification |
| --- | --- | --- |
| `src/lib/services/theme.tsx` | CREATE | `ThemeProvider` + `useTheme` hook + matchMedia 連動 + html.dark toggle |
| `src/lib/services/theme.test.tsx` | CREATE | ThemeProvider の characterization test（初期値 / setTheme / system モード反応 / SSR safe） |
| `src/lib/services/theme-storage.ts` | CREATE | localStorage helper（read / write / SSR ガード / `logger.warn`） |
| `src/lib/services/theme-storage.test.ts` | CREATE | SSR ガード / 不正値 / quota 例外 |
| `src/components/theme/ThemeToggle.tsx` | CREATE | サイドバー footer 用 segmented control（Sun / Moon / Monitor アイコン） |
| `src/components/theme/ThemeToggle.test.tsx` | CREATE | a11y（aria-label / radiogroup role）+ click → setTheme assert |

### 改修ファイル

| File | Action | Justification |
| --- | --- | --- |
| `src/app/layout.tsx` | UPDATE | (1) `<head>` 内 inline script で FOUC 防止 / (2) `<html suppressHydrationWarning>` / (3) Provider 階層に `ThemeProvider` を AuthProvider の外側に追加 / (4) viewport.themeColor を light/dark 2 値配列に |
| `src/app/globals.css` | UPDATE | `.dark` パレットを「シック」値に塗替え（深ネイビー基調）。`:root` は据置 |
| `src/app/settings/settings-client.tsx` | UPDATE | 既存「アカウント設定」Card の下に新規「テーマ」Card を additive 追加（`<ThemeToggle />` + 説明文「設定はこの端末にのみ保存されます」） |
| `src/app/manifest.ts` | UPDATE | `background_color` を dark 寄り `#0E1422` に変更 + コメント更新 |
| `src/components/qr/QrPanel.tsx` | UPDATE | `bg-white` → `bg-card` |
| `src/app/groups/[gid]/_components/InviteCodeCard.tsx` | UPDATE | `bg-white` → `bg-card` |
| `src/components/tournament/SpectateModeCard.tsx` | UPDATE | `bg-white` → `bg-card` |
| `src/components/tournament/WinnerBanner.tsx` | UPDATE | `to-yellow-200` に dark variant を補完 |
| `.claude/rules/error-logging.md` | UPDATE | `theme/*` プレフィックスを「エラー / ログ規約」の prefix 一覧に追記 |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | UPDATE | Track D / Phase D.1 を「個人単位設定 + `/settings` 集約」方針に整合させる |

### 無変更（明示）

| File | Why no change |
| --- | --- |
| `src/components/nav/PrimaryNav.tsx` | 個人設定の集約場所として `/settings` を一本化したため、sidebar footer は touch しない |
| `src/lib/firebase/schemas/group.ts` | 個人 preference 設計のため DB schema 変更ゼロ |
| `src/lib/firebase/repositories/groups.ts` | 同上 |
| `src/lib/services/group.ts` | 同上 |
| `firestore.rules` | 同上。`firebase deploy --only firestore:rules` 不要 |
| `.claude/rules/firebase-patterns.md` / `.claude/rules/group-membership.md` | groups schema を触らないため更新不要 |
| `src/components/tournament/StructureSnapshotCard.test.tsx` | sky-500 token は本 Track で触らないため literal 維持で green |
| `src/app/api/og/**/*` | OG 画像は Satori が CSS 変数を解決しない構造上対象外。既存 `bgTextTheme` query で dual-theme 済み |

## NOT Building

- **`next-themes` ライブラリの導入** — security-base.md の依存追加 ask 規約および本 PRD のミニマル依存方針に反する。`ThemeProvider` は手動実装（差分 < 100 行）
- **サークル単位 / アカウント単位の theme 永続化** — 個人 preference のみ。Firestore に保存しない（端末ごとに独立、デバイス横断同期なし）
- **OG 画像の dark テーマ動的選択** — Satori は CSS 変数を解決しない。既存の `bgTextTheme` query は維持
- **コンポーネント単位の theme override** — global 切替のみ
- **アニメーション付きトランジション** — CSS `transition` で自然な色変化のみ。専用クロスフェード演出は不要
- **テーマ自動切替スケジューラ**（日没で自動 dark） — system モードで OS 任せ
- **`prefers-contrast` / High Contrast モード** — WCAG AAA 対応は別 PRD
- **既存 player / Firestore データへの影響** — DB schema 変更ゼロ
- **`firestore.rules` 変更** — DB を触らないため rule deploy 不要
- **E2E の dark mode visual regression suite 全件追加** — 既存 e2e の主要 1 spec（top-page）で「theme toggle で `<html>` に `dark` class が付与される」flow を 1 ケース追加するに留める
- **新規 Track D 配下の追加 Phase（D.2 以降）** — D.1 完了後にドライランフィードバックを見て判断

---

## Step-by-Step Tasks

### Task 1: chic dark palette を `globals.css` に確定

- **ACTION**: `.dark` ブロックの CSS 変数値を「深ネイビー + 暖色グレー + 銀アクセント」に置換
- **IMPLEMENT**: 以下の HSL 値で `.dark { ... }` を上書き
  ```css
  .dark {
    --background: 220 30% 8%;
    --foreground: 35 25% 92%;          /* 暖色寄りシルバー */
    --card: 222 28% 11%;                /* 背景より +2 brightness */
    --card-foreground: 35 25% 92%;
    --popover: 222 28% 11%;
    --popover-foreground: 35 25% 92%;
    --primary: 35 25% 92%;              /* 銀色トグル */
    --primary-foreground: 222 35% 12%;
    --secondary: 220 18% 18%;
    --secondary-foreground: 35 25% 92%;
    --muted: 220 18% 18%;
    --muted-foreground: 220 10% 65%;
    --accent: 220 18% 18%;
    --accent-foreground: 35 25% 92%;
    --destructive: 0 65% 45%;
    --destructive-foreground: 0 0% 98%;
    --border: 220 18% 18%;
    --input: 220 18% 18%;
    --ring: 35 25% 70%;                 /* 銀色 focus ring */
  }
  ```
- **MIRROR**: 既存 `.dark` の構造（変数名は変更しない）
- **IMPORTS**: なし（CSS のみ）
- **GOTCHA**: HSL の値は **スペース区切り**で書く（Tailwind の `hsl(var(--background))` が `hsl(220 30% 8%)` を期待）。誤って `0, 0%, 100%` のコンマ区切りにすると壊れる
- **VALIDATE**: `npm run dev` で `<html class="dark">` を DevTools から付与すると、ヘッダ・カード・ボタンが新パレットになる

### Task 2: localStorage helper を新規追加（`src/lib/services/theme-storage.ts`）

- **ACTION**: テーマ preference を `localStorage["allinpt.theme"]` に永続化する read/write helper を作る
- **IMPLEMENT**:
  ```ts
  import { logger } from "@/lib/logger";

  export type ThemePreference = "light" | "dark" | "system";
  const STORAGE_KEY = "allinpt.theme";
  const VALID: readonly ThemePreference[] = ["light", "dark", "system"] as const;

  function isValid(v: unknown): v is ThemePreference {
    return typeof v === "string" && (VALID as readonly string[]).includes(v);
  }

  export function readTheme(): ThemePreference {
    if (typeof window === "undefined") return "system";
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      return isValid(raw) ? raw : "system";
    } catch (e) {
      logger.warn("theme storage read failed", {
        code: "theme/storage-failed",
        message: e instanceof Error ? e.message : String(e),
      });
      return "system";
    }
  }

  export function writeTheme(value: ThemePreference): void {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, value);
    } catch (e) {
      logger.warn("theme storage write failed", {
        code: "theme/storage-failed",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  export const THEME_STORAGE_KEY = STORAGE_KEY;
  ```
- **MIRROR**: `src/components/pwa/install-dismiss-storage.ts`（SSR ガード + try/catch + `logger.warn` + `code` プレフィックス）
- **IMPORTS**: `@/lib/logger`
- **GOTCHA**: Safari Private mode の QuotaExceeded / SecurityError を catch、メイン flow を止めない
- **VALIDATE**: 単体テストで SSR ガード（`typeof window === "undefined"` 偽装）、不正値、quota 例外をカバー

### Task 3: ThemeProvider 実装（`src/lib/services/theme.tsx`）

- **ACTION**: React Context で current theme と setter を公開、システムモード時の `matchMedia` 連動、html クラスへの反映までを担う
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

  import { readTheme, writeTheme, type ThemePreference } from "./theme-storage";

  type ResolvedTheme = "light" | "dark";

  interface ThemeContextValue {
    theme: ThemePreference;            // ユーザー選択値
    resolvedTheme: ResolvedTheme;      // 実際に適用されている値（system → 実値解決後）
    setTheme: (next: ThemePreference) => void;
  }

  const ThemeContext = createContext<ThemeContextValue | null>(null);

  function resolveSystem(): ResolvedTheme {
    if (typeof window === "undefined") return "light";
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }

  function applyHtmlClass(resolved: ResolvedTheme): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    if (resolved === "dark") root.classList.add("dark");
    else root.classList.remove("dark");
  }

  export function ThemeProvider({ children }: { children: ReactNode }) {
    const [theme, setThemeState] = useState<ThemePreference>("system");
    const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

    // 初回マウントで localStorage から hydrate
    useEffect(() => {
      const stored = readTheme();
      setThemeState(stored);
      const next = stored === "system" ? resolveSystem() : stored;
      setResolvedTheme(next);
      applyHtmlClass(next);
    }, []);

    // system モード時のみ matchMedia change を listen
    useEffect(() => {
      if (theme !== "system" || typeof window === "undefined") return;
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const handler = () => {
        const next: ResolvedTheme = mq.matches ? "dark" : "light";
        setResolvedTheme(next);
        applyHtmlClass(next);
      };
      mq.addEventListener("change", handler);
      return () => mq.removeEventListener("change", handler);
    }, [theme]);

    const setTheme = useCallback((next: ThemePreference) => {
      setThemeState(next);
      writeTheme(next);
      const resolved: ResolvedTheme = next === "system" ? resolveSystem() : next;
      setResolvedTheme(resolved);
      applyHtmlClass(resolved);
    }, []);

    const value = useMemo<ThemeContextValue>(
      () => ({ theme, resolvedTheme, setTheme }),
      [theme, resolvedTheme, setTheme],
    );

    return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
  }

  export function useTheme(): ThemeContextValue {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
    return ctx;
  }
  ```
- **MIRROR**: `src/lib/services/current-group.tsx`（`useState + useEffect で hydrate + setter で localStorage write` 構造）
- **IMPORTS**: React の hooks / `./theme-storage`
- **GOTCHA**:
  - SSR で `window` / `document` が undefined のため必ず `typeof window === "undefined"` で早期 return
  - inline script で先に html.dark を載せるため、`applyHtmlClass` の再適用は idempotent であること
  - `theme === "system"` 以外のとき matchMedia listener を attach するとユーザー明示選択を上書きしてしまうので必ず if guard
- **VALIDATE**: `theme.test.tsx` の `renderHook` で `result.current.theme === "system"` 初期値、`setTheme("dark")` 後の `localStorage.getItem("allinpt.theme") === "dark"` と `document.documentElement.classList.contains("dark") === true` を assert

### Task 4: FOUC 防止 inline script + Provider 挿入（`src/app/layout.tsx`）

- **ACTION**:
  - (1) `<head>` 直下に `<script dangerouslySetInnerHTML>` で localStorage → html.dark 設定（hydration 前）
  - (2) `<body>` 直下の Provider ツリーに `ThemeProvider` を `AuthProvider` の **外側**に挿入
  - (3) `viewport.themeColor` をオブジェクト形式の `light` / `dark` 2 値配列に切替
  - (4) `<html lang="ja">` に `suppressHydrationWarning` を付与
- **IMPLEMENT**: 関連部分のみ抜粋
  ```tsx
  export const viewport: Viewport = {
    themeColor: [
      { media: "(prefers-color-scheme: light)", color: "#fafafa" },
      { media: "(prefers-color-scheme: dark)", color: "#0E1422" },
    ],
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",
  };

  const themeBootstrap = `(function(){
    try {
      var stored = localStorage.getItem("allinpt.theme");
      var theme = (stored === "light" || stored === "dark" || stored === "system") ? stored : "system";
      var resolved = theme === "system"
        ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
        : theme;
      if (resolved === "dark") document.documentElement.classList.add("dark");
    } catch (e) {}
  })();`;

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="ja" suppressHydrationWarning>
        <head>
          <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
        </head>
        <body className="min-h-screen bg-background text-foreground antialiased">
          <a href="#main" className="skip-link">メインコンテンツへスキップ</a>
          <ThemeProvider>
            <AuthProvider>
              <GroupProvider>
                <NavStateProvider>
                  <PageTitleProvider>
                    {/* ... 既存ヘッダ + AppShell ... */}
                  </PageTitleProvider>
                </NavStateProvider>
              </GroupProvider>
            </AuthProvider>
          </ThemeProvider>
          <ServiceWorkerRegistration />
        </body>
      </html>
    );
  }
  ```
- **MIRROR**: next-themes README の inline script パターン
- **IMPORTS**: `@/lib/services/theme` の `ThemeProvider`
- **GOTCHA**:
  - `<html suppressHydrationWarning>` 必須（inline script が hydration 前に class を書き換えるため React の警告を抑止）
  - `viewport.themeColor` の配列形式は Next.js 15 の `Viewport` type に合致しているか typecheck で確認
  - inline script は IIFE 形式に minify。try/catch でストレージ例外を握りつぶす
  - **ThemeProvider を AuthProvider の外側に置く理由**: 認証 state とは独立で、ログイン前 / 匿名 / signed-in の全画面に同じテーマを適用するため
- **VALIDATE**: `npm run dev` で初回ロード時に「白フラッシュ → dark」となる FOUC が無いことを目視確認（モバイル emulation で `prefers-color-scheme: dark` を有効化してリロード）

### Task 5: ThemeToggle UI（`src/components/theme/ThemeToggle.tsx`）

- **ACTION**: Sun / Moon / Monitor アイコンを並べた segmented control を実装
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { Monitor, Moon, Sun } from "lucide-react";

  import { Button } from "@/components/ui/button";
  import { useTheme } from "@/lib/services/theme";
  import { cn } from "@/lib/utils";
  import type { ThemePreference } from "@/lib/services/theme-storage";

  const OPTIONS: { value: ThemePreference; label: string; Icon: typeof Sun }[] = [
    { value: "light", label: "ライトモード", Icon: Sun },
    { value: "dark", label: "ダークモード", Icon: Moon },
    { value: "system", label: "OS の設定に従う", Icon: Monitor },
  ];

  export function ThemeToggle() {
    const { theme, setTheme } = useTheme();
    return (
      <div
        role="radiogroup"
        aria-label="テーマ"
        className="flex items-center gap-1 rounded-md border border-border bg-background p-0.5"
      >
        {OPTIONS.map(({ value, label, Icon }) => {
          const active = theme === value;
          return (
            <Button
              key={value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={label}
              variant="ghost"
              size="sm"
              onClick={() => setTheme(value)}
              className={cn(
                "size-7 rounded p-0",
                active && "bg-accent text-accent-foreground",
              )}
            >
              <Icon className="size-4" aria-hidden />
            </Button>
          );
        })}
      </div>
    );
  }
  ```
- **MIRROR**: `src/components/nav/PrimaryNav.tsx` 内の `<Button variant="outline" size="sm" />` 系のラッピング / `cn(...)` 利用パターン
- **IMPORTS**: lucide / ui / hooks
- **GOTCHA**:
  - `role="radiogroup"` + 各 `<Button role="radio" aria-checked>` で WAI-ARIA 準拠（segmented control パターン）
  - visible テキストが無いため `aria-label` 必須（WCAG 4.1.2 Name, Role, Value）
- **VALIDATE**: `ThemeToggle.test.tsx` で `screen.getByRole("radio", { name: "ダークモード" })` → click → `useTheme().theme === "dark"` を assert

### Task 6: ThemeToggle を `/settings` 画面に新規 Card として配置（`src/app/settings/settings-client.tsx`）

- **ACTION**: 既存の「アカウント設定」`<Card>` の下に、新規「テーマ」`<Card>` を additive 追加。中で `<ThemeToggle />` を render
- **IMPLEMENT**: `<main>` 直下を `space-y-6` を維持したまま 2 Card 並列構造に変更
  ```tsx
  // import 追加
  import { ThemeToggle } from "@/components/theme/ThemeToggle";

  // ... 既存 return 内の <main> ブロックを下記に拡張 ...
  return (
    <main className="mx-auto max-w-md space-y-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>アカウント設定</CardTitle>
          {/* ...既存内容据置... */}
        </CardHeader>
        <CardContent>
          {/* ...既存 form + AccountDeleteSection 据置... */}
        </CardContent>
      </Card>

      {/* 新規 Card */}
      <Card>
        <CardHeader>
          <CardTitle>テーマ</CardTitle>
          <CardDescription>
            アプリの色調を選択します。設定はこの端末にのみ保存されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ThemeToggle />
        </CardContent>
      </Card>
    </main>
  );
  ```
- **MIRROR**: 既存 `settings-client.tsx:84-138` の Card / CardHeader / CardContent パターン。`max-w-md space-y-6 p-8` の `<main>` 構造を維持
- **IMPORTS**: `@/components/theme/ThemeToggle` を追加
- **GOTCHA**:
  - 既存 `if (!user || !initialized) return <main>...読込中…</main>;` の早期 return ブロックには ThemeToggle を出さない（loading 状態にトグルが見えると混乱）
  - 新規 Card は `Card` / `CardHeader` / `CardTitle` / `CardDescription` / `CardContent` を **すべて import 済みであることを確認**（既存 import L8 に `CardDescription` が含まれる）
  - 「この端末にのみ保存」の文言で個人 preference 性を明示。これがないと「サークル / アカウント共有では？」のサポート質問が増える
  - signed-out / 匿名ユーザーは `/settings` 自体に到達できない（`page.tsx` の `RequireAuth(allowAnonymous=false)`）。この仕様は plan の Notes / Risks に明示済み
- **VALIDATE**:
  - dev サーバで signed-in アカウントで `/settings` を開き、新規「テーマ」Card が「アカウント設定」Card の下に表示される
  - 3 状態 radio をクリックすると即座に UI 全体（ヘッダ / カード / Dialog）が切り替わる
  - リロード後も preference が保持される

### Task 7: ハードコード色の dark variant 補完

- **ACTION**: 調査で洗い出した 4 件のハードコード色箇所に `dark:` 補完または semantic token 置換
- **IMPLEMENT**:
  - `src/components/qr/QrPanel.tsx`: `bg-white` → `bg-card`（QR の前景色は黒固定 / 背景のみ可変）
  - `src/app/groups/[gid]/_components/InviteCodeCard.tsx`: `bg-white` → `bg-card`
  - `src/components/tournament/SpectateModeCard.tsx`: `bg-white` → `bg-card`
  - `src/components/tournament/WinnerBanner.tsx` の `to-yellow-200` を含む箇所: `dark:to-yellow-900/30` を追加
- **MIRROR**: `src/app/page.tsx:65-115` Track B B.1 の `dark:from-... dark:via-... dark:to-...` 三段 prefix パターン
- **IMPORTS**: なし（class 文字列のみ）
- **GOTCHA**:
  - QR コードは **QR 自体の色コントラスト** が読取性を決める。`qrcode.react` の `<QRCodeSVG fgColor="#000" bgColor="#fff" />` の **プロパティは触らない**。外側 wrapper のみ semantic token に
  - 視認性が破綻する場合は wrapper を `bg-white` のまま残し、border を semantic token にする方針へ revert
- **VALIDATE**: dark を有効化した state で QR / 招待コードカード / 観戦モードカードを表示し、視認性が破綻していないか目視確認

### Task 8: PWA manifest と error-logging.md の更新

- **ACTION**:
  - `src/app/manifest.ts` の `background_color` を `#0E1422` に変更し、コメントを「主たるブランドカラーは dark 寄り、light モード時は HTML meta で `#fafafa` を別途供給」に更新
  - `.claude/rules/error-logging.md` の prefix 一覧に `theme/*` を追加（`pwa/*` と同列）
- **IMPLEMENT**: 既存値の上書きとコメント追加のみ
- **MIRROR**: PRP 04 で `spectate/*` を追加した同 file 編集パターン
- **IMPORTS**: なし
- **GOTCHA**: manifest.ts は build 時に static manifest として配信されるため、light/dark 切替には反応しない（仕様）。`theme_color` は `#0a0a0f` のまま据置、`background_color` のみ調整
- **VALIDATE**: `npm run build` で `/manifest.webmanifest` が生成され、Chrome DevTools > Application > Manifest で新 `background_color` が読まれる

### Task 9: 単体テスト追加（新規 3 ファイル）

- **ACTION**: 新規 3 ファイル追加。既存 `StructureSnapshotCard.test.tsx` は **無修正** で維持（sky-500 token は本 Track で触らないため literal でも green）
- **IMPLEMENT**:
  - `theme-storage.test.ts`: SSR ガード（`vi.stubGlobal("window", undefined)` → `readTheme()` が `"system"` を返す）/ 不正値 / quota 例外（`localStorage.setItem` を `vi.spyOn` で throw 化）
  - `theme.test.tsx`: 初期値 / `setTheme` → localStorage 反映 / `setTheme("dark")` → `document.documentElement.classList.contains("dark")` / `theme === "system"` 時の matchMedia change handler 反応 / Provider 外での `useTheme()` 呼出が throw
  - `ThemeToggle.test.tsx`: 3 つの radio が render される / click で active state 変化 / aria-label が日本語 / `role="radiogroup"` 親要素が visible
- **MIRROR**: [testing.md](../../../rules/testing.md) の「mock の境界」「fixture factory」「characterization test ファースト」の 3 原則
- **IMPORTS**: `@testing-library/react` / `vitest`
- **GOTCHA**:
  - jsdom には `matchMedia` がデフォルト未実装 → `beforeEach` で `vi.stubGlobal("matchMedia", vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }))` で polyfill
  - SSR ガードのテストでは `vi.unstubAllGlobals()` を `afterEach` で呼ぶ
- **VALIDATE**: `npm test -- theme` で 3 ファイル green

### Task 10: PRD 更新（Phase D.1 詳細 + Decisions Log）

- **ACTION**: PRD の Phase D.1 Scope / Decisions Log を「個人単位設定」方針に整合させる
- **IMPLEMENT**:
  - Phase D.1 の Scope を Firestore / rule / emulator validator / `ThemeSettingCard` / 規約 3 ファイル を **対象外** とした本 plan の内容に書換
  - Decisions Log に「2026-05-13 第 2 次転換」エントリを追加: 「サークル単位設定」→「個人単位設定」に再転換、理由（個人の好み・端末ごとの独立性・サークル設定の複雑度回避）を記録
  - Implementation Phases テーブルの D.1 行 Description を個人単位設定の説明に更新
- **MIRROR**: 既存 Decisions Log のエントリ書式（`| Decision | Choice | Alternatives | Rationale |`）
- **IMPORTS**: なし
- **GOTCHA**: PRD と plan は **同 PR で同期**。過去の Decisions Log は履歴として残し、最新方針を末尾に追記する形で audit trail を維持
- **VALIDATE**: PRD を Read して Phase D.1 と Decisions Log が本 plan と一致

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `theme-storage.readTheme()` SSR | `typeof window === "undefined"` | `"system"` 返却 | ✓ |
| `theme-storage.readTheme()` 不正値 | localStorage に `"weird"` 格納 | `"system"` fallback | ✓ |
| `theme-storage.writeTheme()` quota error | localStorage.setItem が throw | `logger.warn` 1 回、メイン flow 継続 | ✓ |
| `useTheme()` 初期 | provider mount 直後 | `theme === "system"` / `resolvedTheme` が matchMedia 結果 | |
| `useTheme().setTheme("dark")` | provider 配下で setTheme | localStorage に `"dark"` / `document.documentElement.classList.contains("dark")` | |
| `useTheme()` system 時の matchMedia change | system モード + media change イベント | `resolvedTheme` 切替 / html クラス更新 | ✓ |
| `useTheme()` outside provider | `<ThemeProvider>` の外で useTheme 呼出 | throws `"useTheme must be used within ThemeProvider"` | ✓ |
| `<ThemeToggle>` render | provider 内で render | 3 radios（Sun / Moon / Monitor）visible | |
| `<ThemeToggle>` click | "ダークモード" radio click | `theme === "dark"` / aria-checked=true | |
| `<ThemeToggle>` a11y | render | `role="radiogroup"` + 各 radio に `aria-label` | ✓ |

### Edge Cases Checklist

- [ ] Safari Private mode（localStorage write 例外）でも `setTheme` が UI 上は動作する（UX は維持 / 永続化のみ失敗）
- [ ] SSR 経由の初回 HTML に `<script>` で hydration 前に class が付く（FOUC ゼロ）
- [ ] `prefers-color-scheme` 未対応ブラウザ（古い IE / 古い Android）でも light fallback
- [ ] signed-out / 匿名ユーザーは `/settings` に到達できないが、ThemeProvider が初期値 `system` で OS 設定追従するため UI 破綻なし
- [ ] サイドバー / ヘッダ / トップ画面など `/settings` 以外には theme トグルが存在しないこと（個人設定の集約場所一本化）
- [ ] PWA standalone モード（iOS / Android）で theme-color meta が OS 設定に追従
- [ ] 設定切替後にページリロードしても preference が保持される
- [ ] `system` モード時に OS の dark / light を切り替えると、リロードなしで UI が追従

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: ゼロエラー（特に `viewport.themeColor` の配列形式が `Viewport` type と合致）

```bash
npm run lint
```

EXPECT: ゼロ警告（新規ファイルに `console.*` / 直 `throw new Error` なし）

### Unit Tests

```bash
npm test
```

EXPECT: 全 spec green（新規 3 ファイルを含む）

```bash
npm test -- theme
```

EXPECT: 新規 theme 関連 3 ファイル個別 green

### Build

```bash
npm run build
```

EXPECT: build 成功、`out/manifest.webmanifest` に新 `background_color` 反映

### Browser Validation（必須・UI 機能ゆえ）

```bash
npm run dev
```

EXPECT:
- 初回ロードで `prefers-color-scheme: dark` の OS では即座に dark UI（FOUC なし）
- signed-in アカウントで `/settings` に遷移し「テーマ」Card のトグルで 3 状態切替が機能
- 切替後にリロード → preference 保持
- `<html class="dark">` 状態でヘッダ・カード・Button・Dialog の色が新 palette
- QR コードがダーク背景でもカメラ読取可能
- WinnerBanner / トーナメント一覧の amber カードが dark で潰れない
- サイドバー footer にトグル UI が **無い** こと（個人設定一本化の確認）

### E2E（最小 1 ケース追加）

```bash
npx playwright test tests/e2e/specs/top-page.spec.ts
```

EXPECT: 「theme toggle で dark を選択 → `<html>` に `dark` class が付与される」flow が 1 ケース pass

### Manual Validation

- [ ] PC（Chrome）で signed-in 後 `/settings` を開き、ライト / ダーク / 自動 を順次クリックして UI 切替を確認
- [ ] PC（Chrome）で DevTools > Rendering > Emulate CSS prefers-color-scheme を dark に変更し、`system` モード時に追従することを確認
- [ ] iPhone Safari で OS の Light / Dark 切替に追従することを確認
- [ ] PWA インストール後（standalone）の splash / status bar の色を確認
- [ ] サークル詳細 / トーナメント受付 / live timer 各画面で dark UI の見栄えを確認
- [ ] signed-out 状態のトップ画面で OS が dark なら自動 dark、light なら自動 light（個人 preference 未設定の挙動）
- [ ] 観戦モード（`/spectate/[tid]`）が anon ユーザーで OS 設定に追従する（明示切替手段は無いが UI 破綻もない）
- [ ] サイドバー / ヘッダー / 他画面に theme トグルが追加されていないこと

---

## Acceptance Criteria

- [ ] 全 Task 完了
- [ ] 全 Validation Commands グリーン
- [ ] 新規 / 修正テストが pass
- [ ] typecheck / lint ゼロ
- [ ] `/settings` 画面に「テーマ」Card が出現し、3 状態切替が機能
- [ ] サイドバー footer / ヘッダー / 他画面に theme トグルが配置されていない
- [ ] `prefers-color-scheme: dark` の OS で初回ロード時 FOUC なし
- [ ] dark テーマ時のヘッダ / カード / Dialog / Sheet / Button が新 palette
- [ ] QR / 招待コード / 観戦モードカードが dark で破綻しない
- [ ] PRD `05-post-launch-polish.prd.md` の Phase D.1 Scope + Decisions Log が「個人単位設定」方針と一致

## Completion Checklist

- [ ] `ThemeProvider` が AuthProvider の **外側** に配置されている（認証非依存のため）
- [ ] localStorage helper が SSR ガード + `logger.warn` + `theme/storage-failed` で error-logging.md 準拠
- [ ] inline FOUC 防止スクリプトが `<head>` 直下に出力されている
- [ ] `<html suppressHydrationWarning>` が付与されている
- [ ] viewport.themeColor が light / dark 2 値配列で設定されている
- [ ] PWA manifest.ts の `background_color` が dark 寄りに調整されている
- [ ] error-logging.md に `theme/*` プレフィックスが追記されている
- [ ] OG 画像経路（`src/app/api/og/`）に変更が **入っていない** ことを diff で再確認
- [ ] `firestore.rules` / `groups/{gid}` schema / repository / service に変更が **入っていない** ことを diff で再確認
- [ ] Codex review に出せる粒度

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| chic palette の HSL 値が想像と異なる | M | M | Task 1 完成後にスクショで合意 / HSL は revert / 微調整が低コスト |
| inline script の FOUC 対策が SSR + hydration 不整合 | L | H | `suppressHydrationWarning` + useEffect 再適用で idempotent |
| QR `bg-white` → `bg-card` でカメラ読取性低下 | L | M | QR 自身の `bgColor="#fff"` プロパティは無変更。wrapper のみ。検証で破綻したら revert |
| dark palette と既存 amber / sky / emerald 状態色がコントラスト不足 | M | M | shadcn semantic token 経由は問題なし。ハードコード色のみ Task 7 で個別補完 |
| jsdom の matchMedia 未実装でテストが落ちる | M | L | Task 9 GOTCHA で `vi.stubGlobal("matchMedia", ...)` を明示 |
| viewport.themeColor の配列形式が Next.js 15 type に不一致 | L | L | Next.js 15 公式 docs で `themeColor: ThemeColor | ThemeColor[]` 対応済み、typecheck で即検出 |
| 個人 preference の端末横断同期がない | - | L | これは仕様。デバイスごとに独立で OK（複数端末を使うユーザーは初回 system fallback でほぼ自然） |
| 同じサークルのメンバー間で theme が異なる | - | L | これも仕様。個人 preference のため一貫性は要求しない |
| signed-out / 匿名ユーザーが theme を切替できない | M | L | `/settings` は `RequireAuth(allowAnonymous=false)` のため UI から到達できない。ThemeProvider は全画面で動作し初期値 `system` で OS 設定追従するため UI 破綻なし。明示切替要望が増えれば D.2 でヘッダ右側に最小トグル additive |

## Notes

### 設計判断（個人単位設定）

- **真実源**: `localStorage["allinpt.theme"]`。デバイスごとに独立。Firestore に保存しない
- **理由**: ユーザーから「個人単位の設定に戻す」明示要求あり（2026-05-13、2 度目の方針確定）
- **副次的メリット**:
  - DB schema / rule / emulator validator / 規約ファイル touch ゼロ → diff が小さい
  - signed-out / 観戦モード（anon）でも機能（Firestore 認証経路に依存しない）
  - サークル設定の複雑度（権限・rule・cache 整合）を持ち込まない
- **副次的デメリット**:
  - 端末横断同期なし（PC と iPhone で別 preference になる）
  - サークル単位のブランディング統一は実現できない
  - これらは個人 preference 設計の必然として受容

### 履歴

本 plan の方針は 2026-05-13 に 3 度転換した:

1. **初版（個人 preference + サイドバー footer トグル）**: localStorage 真実源・PrimaryNav footer 配置
2. **第 1 次転換（サークル単位）**: ユーザー「色の設定はサークル単位で保持したい」要求で Firestore 設計に転換
3. **第 2 次転換（個人 preference に再回帰 + サイドバー footer）**: ユーザー「個人単位の設定に戻します」要求で初版相当に戻る
4. **第 3 次転換（個人 preference + `/settings` 集約・最終）**: ユーザー「設定は個人設定の欄にまとめて」要求で、トグル UI を `/settings` 画面の新規 Card に集約。サイドバー footer は touch しない

第 3 次転換の判断: 個人設定の集約場所として `/settings` を一本化することで (a) 既存「アカウント設定」と同じメンタルモデル、(b) サイドバー footer が現状の「アカウント名 + ログアウト」最小構成のまま保たれる、(c) PrimaryNav.tsx を touch せずに済み、PR の差分が小さくなる。副次効果として signed-out / 匿名は明示切替不可だが、OS 設定追従で UX 破綻はない。

### chic palette の意図

- **Hue 220（深ネイビー）**: ポーカー業界のクラシック調 + 落ち着き
- **Foreground Hue 35（暖色シルバー）**: 白すぎないコントラスト。長時間視認でも目に優しい
- **Ring Hue 35**: focus ring が暖色 → 機械的でなく落ち着いた印象
- **Secondary / Muted Hue 220 Lightness 18%**: 単なる zinc よりわずかにネイビー寄り。階層感を出す
- Light モードは **据置**（既存運営者が驚かない）

### 将来の polish（D.2 候補・本 plan 対象外）

- ヘッダーの blur 強度を dark で増やす（`backdrop-blur-md`）
- アクセントカラー（金色 hsl 40 60% 55%）を Button primary に導入する案
- signed-out / 匿名ユーザー向けのヘッダ右側最小トグル（要望が増えた場合）
- 必要が出れば「サークル単位設定」を additive で重ねる選択肢（個人 preference との両立は users/{uid}.themeOverride で）

### review コメントの想定論点

- 「サークル単位の方が一貫性が出るのでは？」 → 2 度の方針転換を経て個人単位に確定。Decisions Log 参照
- 「`<script dangerouslySetInnerHTML>` は CSP 違反では？」 → Next.js 自身が script を inject する経路と同じ `unsafe-inline` 前提なら問題なし
- 「`next-themes` を入れた方が安全では？」 → security-base.md + 依存最小化方針で非採用。差分 < 100 行で済むため移行コストは低い
- 「Provider 配置順は AuthProvider の **内側** が正しいのでは？」 → 認証 state に依存しない / 全画面共通 / 匿名ユーザーにも影響するため外側が妥当（Decisions Log にも明記）
