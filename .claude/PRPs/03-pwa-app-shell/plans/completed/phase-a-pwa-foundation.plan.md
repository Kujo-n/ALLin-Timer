# Plan: Phase A — PWA Foundation

## Summary

Next.js 15 公式 PWA ガイドの素 SW 構成で **manifest / Service Worker / アイコン素材 / iOS meta tags / iOS install hint** を整備し、ALLin-PokerTimer をホーム画面に追加可能な PWA に変える。Service Worker は **HTML network-first / 静的アセット stale-while-revalidate / Firestore は SW で扱わない** のキャッシュ戦略で、一時通信障害時に UI が真っ白にならないアプリシェルを提供する。本 Phase は Phase B/C/D の前提となる基盤層で、auto-advance fallback（Phase B） / Wake Lock（Phase C） / install promotion 強化（Phase D）はここに乗せる。

## User Story

As a サークル運営者（owner / organizer）,
I want スマホブラウザから 1 度開いただけで「ホーム画面に追加」できる PWA としてアプリを認識させ、ホーム画面アイコンタップ → standalone 起動（URL バー / タブが消える）で会場到着時の起動所作を最小化したい,
So that 月 1〜2 回の会場運営で「ブラウザのお気に入りから探す」「URL を打ち込む」「他のタブと混ざる」摩擦を 1 タップで消せて、運営に専念できる。

And as a 参加者 / 運営者を問わない訪問者,
I want 一時的に通信が切れた瞬間にブラウザリロードや別画面遷移をしてもアプリシェル（HTML / CSS / JS）は cache から表示される,
So that 「会場 Wi-Fi がチカチカする」状態でも UI が真っ白にならず、Firestore の IndexedDB cache で表示されているタイマー / 席表が見え続ける。

## Problem → Solution

**Current state**:

- [src/app/layout.tsx:15-18](../../../../src/app/layout.tsx#L15-L18) は `metadata = { title, description }` のみで、`manifest` / `themeColor` / `appleWebApp` / icon refs が一切ない。
- `public/` 配下は [public/sounds/](../../../../public/sounds) の 4 ファイル（mp3 / ogg）のみ。`manifest.webmanifest` / `sw.js` / `icons/*` 何も置かれていない。
- DevTools Application タブで manifest が **無効** と表示され、Chrome の install prompt も Lighthouse PWA も全部 fail。
- ブラウザがリロード時にネットワークから index.html を取りに行こうとして通信切れ → 真っ白画面（既存の Firestore IndexedDB cache が見えない）。
- iOS Safari で「ホーム画面に追加」しても apple-touch-icon が無く真っ白なアイコンになる、status bar が標準スタイル、`apple-mobile-web-app-capable` 未設定で URL バー残る。

**Desired state**:

- `app/manifest.ts` で `MetadataRoute.Manifest` を返し、`/manifest.webmanifest` が auto-served される。
- `public/sw.js` が precache（shell URLs + 静的アセット） + runtime cache（HTML network-first / 静的 SWR）を提供する。
- `public/icons/` 配下に 192×192 / 512×512（通常 + maskable） / 180×180（Apple touch）の 4 PNG を配置。
- `app/layout.tsx` の `metadata` / `viewport` で `manifest` ref / `themeColor` / `appleWebApp.capable` / `statusBarStyle` を設定し、Next.js が自動で `<link rel="manifest">` / `<meta name="theme-color">` / `apple-mobile-web-app-*` 一式を inject する。
- `<ServiceWorkerRegistration />` が production gate で `navigator.serviceWorker.register("/sw.js")` を実行（dev は SW 無効）。
- iOS UA + 非 standalone 検出時のみ「共有 → ホーム画面に追加」テキスト hint を表示（`<IOsInstallHint />`）。
- DevTools Application → Manifest が green、`display-mode: standalone` で起動可能。Lighthouse PWA に Installable / Service Worker green が並ぶ。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md](../prds/03-pwa-app-shell.prd.md)
- **PRD Phase**: Phase A — PWA Foundation
- **Estimated Files**: 約 12 files（manifest 1 / SW 1 / icons 4 / components 2 + test / layout update 1 / next.config update 1 / README update 1 / plan 1）

---

## UX Design

### Before（現状）

```
スマホブラウザ（Safari / Chrome）
┌────────────────────────────────────────┐
│ ⌖ allin-pokertimer.vercel.app          │ ← URL バー常時表示
│ ─────────────────────────────────────  │
│ ALLin-PokerTimer                       │
│ NLH（ノーリミットテキサスホールデム）  │
│ 小規模サークル向けトーナメント進行支援 │
│ アプリ。                               │
│   [ ログイン / 新規登録 ]              │
└────────────────────────────────────────┘
   ⊟  ⊞  ⊕  ⤓  …                      ← ブラウザ UI
```

ブラウザの「ホーム画面に追加」を試みても:
- Android Chrome: アイコンは Chrome アイコン + 表題、無味
- iOS Safari: 真っ白アイコン + URL バー / status bar 標準スタイル

通信切れリロード:
```
┌────────────────────────────────────────┐
│ ⊘ インターネットに接続できません        │ ← OS / ブラウザのエラー画面
└────────────────────────────────────────┘
```

### After

```
スマホ（ホーム画面）
┌──────────────────────────┐
│ 📱  ☎  ✉  ⊞               │
│                          │
│  ⊞   ◐                  │
│ Mail  ALLin              │ ← apple-touch-icon が反映
│      Timer                │
│                          │
└──────────────────────────┘

タップ起動 →
┌────────────────────────────────────────┐
│  ▼  ▽  📶  🔋               12:34       │ ← status bar（black-translucent）
│ ─────────────────────────────────────  │
│ ALLin-PokerTimer                       │
│ NLH（ノーリミットテキサスホールデム）  │
│ ...                                    │
│   [ ログイン / 新規登録 ]              │
└────────────────────────────────────────┘
```
（URL バー / タブ無し、standalone）

iOS Safari 訪問時 + 非 standalone:
```
┌────────────────────────────────────────┐
│ ⌖ allin-pokertimer.vercel.app          │
│ ─────────────────────────────────────  │
│ ALLin-PokerTimer                       │
│ ...                                    │
│ ┌──────────────────────────────────┐   │
│ │ ⓘ iOS でホーム画面に追加するには  │   │ ← IOsInstallHint
│ │ Safari 共有ボタン → 「ホーム画面 │   │
│ │ に追加」を選択してください       │   │
│ └──────────────────────────────────┘   │
└────────────────────────────────────────┘
```

通信切れリロード（インストール後）:
```
┌────────────────────────────────────────┐
│ ALLin-PokerTimer                       │ ← cache から HTML/CSS/JS 提供
│ NLH（ノーリミットテキサスホールデム）  │   タイマー画面なら Firestore IndexedDB
│ サークル: ALLin                        │   から最終 snapshot で表示継続
│                                        │
│ ┌─────────────┐                        │
│ │  ⏱  06:42   │ ← Phase B でバナー追加   │
│ │  Lv. 5      │   （本 Phase 範囲外）    │
│ └─────────────┘                        │
└────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint                    | Before                                                | After                                                                              | Notes                                       |
| ----------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------- |
| ホーム画面追加                | アイコン無色 / URL バー残る                           | apple-touch-icon 適用 / standalone 起動                                            | iOS Safari + Android Chrome 両対応          |
| iOS 訪問初回                  | 何のヒントもなし                                      | `IOsInstallHint` で「共有 → ホーム画面に追加」を案内                               | UA + display-mode で出し分け                |
| 通信切れ後の再アクセス        | OS のオフラインエラー画面                             | アプリシェルが cache から提供されアプリ UI が表示                                  | Firestore IndexedDB cache の表示継続が成立  |
| Chrome DevTools Lighthouse    | PWA: Installable ✗ / SW ✗                            | PWA: Installable ✓ / SW ✓                                                          | 監査基準として QA で検証                    |
| Chrome 自前 install prompt    | 出ない                                                | 引き続き出ない（Phase D で beforeinstallprompt 受信）                              | Phase A 範囲外。manifest は Phase D の前提  |

---

## Mandatory Reading

実装着手前に必ず Read すること（記憶頼りで作業すると規約違反 / drift のリスクあり）:

| Priority       | File                                                                          | Lines        | Why                                                                                       |
| -------------- | ----------------------------------------------------------------------------- | ------------ | ----------------------------------------------------------------------------------------- |
| P0 (critical)  | [src/app/layout.tsx](../../../../src/app/layout.tsx)                          | 1-58         | metadata 既存形 / `<html lang="ja">` / Provider tree。Phase A はここに meta tags を増設   |
| P0 (critical)  | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md)  | all          | logger 経由のみ / `console.*` 禁止 / AppError ラップ。SW 登録 / iOS hint も logger 経由   |
| P0 (critical)  | [.claude/rules/security-base.md](../../../../.claude/rules/security-base.md)  | all          | 公開リポジトリ運用 / サークル固有情報禁止。アイコン素材も MIT 互換性確認                   |
| P0 (critical)  | [.claude/rules/security-env.md](../../../../.claude/rules/security-env.md)    | all          | `next.config.ts` 編集時の規約。SW 用 headers 追加で本ファイル trigger                     |
| P1 (important) | [src/lib/hooks/useFullscreen.ts](../../../../src/lib/hooks/useFullscreen.ts)  | 1-62         | client-only feature detection の現行パターン（SSR ガード / webkit fallback / logger.warn） |
| P1 (important) | [src/lib/logger.ts](../../../../src/lib/logger.ts)                            | all          | `logger.info/warn` の API 形式。SW 登録の成功 / 失敗ログで使う                            |
| P1 (important) | [src/lib/errors.ts](../../../../src/lib/errors.ts)                            | all          | `AppError.from(e, code, msg)` の使い方。SW 登録失敗 wrap で使う                           |
| P1 (important) | [src/lib/firebase/client.ts](../../../../src/lib/firebase/client.ts)          | 14-22, 73-95 | `useEmulator` / `process.env.NODE_ENV` のような env-gate の現行パターン                   |
| P1 (important) | [src/lib/hooks/useFullscreen.test.tsx](../../../../src/lib/hooks/useFullscreen.test.tsx) | all   | feature-detection hook を vitest で書く現行パターン（matchMedia mock / userAgent mock）   |
| P2 (reference) | [next.config.ts](../../../../next.config.ts)                                  | all          | `outputFileTracingIncludes` の現行構造。`headers()` を追加する場所                        |
| P2 (reference) | [vitest.config.ts](../../../../vitest.config.ts)                              | 22-39        | `coverage.exclude` パターン。`audio-context.ts` / `client.ts` 流の理由で sw 登録も除外候補 |

## External Documentation

| Topic                                       | Source                                                                                                                                            | Key Takeaway                                                                                                                                                           |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Next.js 15 PWA 公式ガイド                   | [https://nextjs.org/docs/app/guides/progressive-web-apps](https://nextjs.org/docs/app/guides/progressive-web-apps)                                | `app/manifest.ts` で `MetadataRoute.Manifest` を返す形が公式推奨。SW は `public/sw.js` に素 JS で書き、`navigator.serviceWorker.register("/sw.js", { scope, updateViaCache })` で登録 |
| `app/manifest.ts` API                       | [https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/manifest) | `MetadataRoute.Manifest` の型 / `display: "standalone"` / `icons[]` の各要素は `{ src, sizes, type, purpose? }`                                                       |
| App icons (file conventions)                | [https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons) | `app/icon.png` / `app/apple-icon.png` を置けば `<link rel="icon">` / `<link rel="apple-touch-icon">` が自動 inject される。ただし**manifest icons[] からは別途 public/icons/ を参照**するのが安定（auto-generated は hash URL） |
| iOS / Safari の PWA 制約                    | [https://developer.apple.com/documentation/webkit/promoting_apps_with_smart_app_banners](https://developer.apple.com/documentation/webkit) (general) | iOS は `display: "standalone"` のみ受付（`fullscreen` 不可）。`beforeinstallprompt` 永久に非対応のため UA + display-mode 検出で「共有 → ホーム画面に追加」テキスト案内が必要         |
| Service Worker キャッシュ戦略               | [https://web.dev/learn/pwa/serving](https://web.dev/learn/pwa/serving)                                                                            | network-first（HTML） / stale-while-revalidate（静的アセット） / cache-only（offline shell fallback）の使い分け。Cross-origin（Firebase）は SW で扱わない                  |
| Turbopack と Service Worker の互換性       | Next.js 15 公式 PWA ガイド + Serwist GitHub README                                                                                                | Serwist / next-pwa は webpack ベース → Turbopack β でビルド失敗する。素 SW（`public/sw.js` を fetch するだけ）なら Turbopack も dev / build 共に問題なし                  |

```
KEY_INSIGHT: Next.js 15 の `app/manifest.ts` は build 時に静的 JSON を生成し、`/manifest.webmanifest` に自動 mount する。`<link rel="manifest" href="/manifest.webmanifest">` も `metadata.manifest` 経由で auto-inject される
APPLIES_TO: Phase A の Task 1（manifest 作成）と Task 4（layout 更新）
GOTCHA: `metadata.manifest` の値は **絶対パス文字列**（"/manifest.webmanifest"）を渡す。`MetadataRoute.Manifest` の戻り値そのものを渡すと型エラー
```

```
KEY_INSIGHT: `public/sw.js` は素の JS ファイルとして serve され、Next.js は中身を一切 transform しない。よって ESM import / TypeScript 構文 / バンドラ依存 API は使えない（vanilla JS のみ）
APPLIES_TO: Task 2（Service Worker 実装）
GOTCHA: `caches` / `self.clients` / `event.waitUntil` 等は Service Worker 標準 API。VS Code で型補完を効かせたい場合は `// @ts-check` + JSDoc で `lib.webworker.d.ts` を参照
```

```
KEY_INSIGHT: `metadata.themeColor` は Next.js 15 で deprecated → `viewport` export に移動した
APPLIES_TO: Task 4（layout 更新）
GOTCHA: `app/layout.tsx` で `export const viewport: Viewport = { themeColor: "..." };` の形を使う。`metadata.themeColor` を残すと build warning + 一部ブラウザで読まれない
```

```
KEY_INSIGHT: iOS Safari の `beforeinstallprompt` は永久に非対応。代わりに `navigator.userAgent` で iOS 判定 + `window.matchMedia("(display-mode: standalone)").matches` で既インストール判定する
APPLIES_TO: Task 6（IOsInstallHint）
GOTCHA: `(window as any).MSStream` チェックは IE11 排除のため。Next.js 公式ガイドが採用する pattern なので踏襲する
```

```
KEY_INSIGHT: Service Worker は dev (`npm run dev` / Turbopack) で登録すると HMR との衝突や stale cache を引き起こすため、`process.env.NODE_ENV === "production"` で gate するのが定石
APPLIES_TO: Task 3（SW 登録 component）
GOTCHA: E2E test が `NEXT_PUBLIC_USE_FIREBASE_EMULATOR=true` で本番 build を起動するケースがあれば、emulator flag でも SW を無効化する選択肢もあるが、本プロジェクトの E2E は Vercel preview ではなく Firebase emulator ベースなので NODE_ENV=production gate のみで十分
```

---

## Patterns to Mirror

実コードベースから抽出した既存パターン。新規コードはこれに揃える。

### NAMING_CONVENTION（hooks / components）

```ts
// SOURCE: src/lib/hooks/useFullscreen.ts:1-62
"use client";

import { useCallback, useEffect, useState } from "react";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface UseFullscreenState {
  isFullscreen: boolean;
  toggle: () => Promise<void>;
}

export function useFullscreen(): UseFullscreenState {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    // ... feature detection + listener setup
  }, []);

  // ...
}
```

- ファイル名: `useXxx.ts`（hook） / `XxxComponent.tsx`（component）
- `"use client"` 必須（client-only feature を扱う場合）
- 戻り値は inline interface で型注釈 → `export function name(): TypeName`
- SSR ガード: `typeof window === "undefined"` / `typeof document === "undefined"` で early return

### ERROR_HANDLING + LOGGING_PATTERN

```ts
// SOURCE: src/lib/hooks/useFullscreen.ts:47-59
const toggle = useCallback(async () => {
  if (typeof document === "undefined") return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await document.documentElement.requestFullscreen();
    }
  } catch (e) {
    const wrapped = AppError.from(e, "ui/fullscreen-failed", "全画面化に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
  }
}, []);
```

- 例外は **`AppError.from(e, "domain/code", "ja msg")` で wrap** → `logger.warn(wrapped.message, { code: wrapped.code })`
- ドメイン prefix を必ず付ける（本 Phase は `pwa/`）
- 失敗は throw せず warn ログのみ（UX 上 no-op で許容するため）

### SSR_GUARD_PATTERN

```ts
// SOURCE: src/lib/audio/audio-context.ts:31-44
function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (cachedContext) return cachedContext;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  // ...
}
```

- `typeof window === "undefined"` で SSR / build を gate
- vendor prefix は `(window as unknown as { webkitFoo?: ... }).webkitFoo` の形でキャスト
- feature detection は `?? null` パターンで縦続ける

### ENV_GATE_PATTERN

```ts
// SOURCE: src/lib/firebase/client.ts:14-22
const useEmulator =
  typeof window !== "undefined" &&
  process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "true";
```

```ts
// SOURCE: src/app/debug/fs/page.tsx:9
if (process.env.NEXT_PUBLIC_ENABLE_DEBUG !== "1") {
  // ...
}
```

- env 値は `process.env.NEXT_PUBLIC_*` で直 access（Next.js inline 化要件）
- bool 値は文字列比較（`=== "true"` / `=== "1"`）で読む
- SW 登録は `process.env.NODE_ENV === "production"` で gate

### TEST_STRUCTURE（feature detection hook / component）

```ts
// SOURCE: src/lib/hooks/useFullscreen.test.tsx:1-30
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { useFullscreen } from "./useFullscreen";

let exitFullscreenMock: ReturnType<typeof vi.fn>;
let requestFullscreenMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  // window / navigator / document の prop を Object.defineProperty で差し替え
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreenMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFullscreen", () => {
  it("initializes ...", () => { /* ... */ });
  it("toggle() warns via logger when ... rejects (no throw)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    // ...
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "ui/fullscreen-failed" }),
    );
  });
});
```

- `Object.defineProperty(window/navigator/document, prop, { configurable: true, get / value })` で feature を mock
- `vi.spyOn(logger, "warn").mockImplementation(() => {})` で logger 検証
- `afterEach(() => vi.restoreAllMocks())` で必ず後始末

### CLIENT_COMPONENT_PATTERN

```tsx
// SOURCE: src/components/audio/SoundUnlockBanner.tsx:1-22
"use client";

import { Bell, Check } from "lucide-react";

import { Button } from "@/components/ui/button";

interface SoundUnlockBannerProps {
  unlocked: boolean;
  enabled: boolean;
  onUnlock: () => Promise<void>;
}

export function SoundUnlockBanner({ unlocked, enabled, onUnlock }: SoundUnlockBannerProps) {
  if (!enabled) return null;
  // ...
}
```

- props は inline interface で型注釈
- `lucide-react` から icon import
- shadcn `Button` / Tailwind utility で UI（border / bg / 色は既存パレット活用）

---

## Files to Change

| File                                                                                          | Action | Justification                                                                                                          |
| --------------------------------------------------------------------------------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------- |
| [src/app/manifest.ts](../../../../src/app/manifest.ts)                                        | CREATE | Next.js 15 metadata API で `MetadataRoute.Manifest` を返し `/manifest.webmanifest` を auto-mount                       |
| [public/sw.js](../../../../public/sw.js)                                                      | CREATE | 素 SW。precache（shell） + runtime cache（HTML network-first / 静的 SWR）                                              |
| [public/icons/icon-192.png](../../../../public/icons/icon-192.png)                            | CREATE | PWA 必須 192×192 PNG。manifest と Android home screen で参照                                                            |
| [public/icons/icon-512.png](../../../../public/icons/icon-512.png)                            | CREATE | PWA 必須 512×512 PNG。Lighthouse PWA audit / splash screen 用                                                           |
| [public/icons/icon-512-maskable.png](../../../../public/icons/icon-512-maskable.png)          | CREATE | maskable 用（Android adaptive icon）。`safe area` 内にロゴを収めた 512×512                                              |
| [public/icons/apple-icon-180.png](../../../../public/icons/apple-icon-180.png)                | CREATE | iOS apple-touch-icon。180×180、フチなし（iOS 自動角丸）                                                                |
| [src/components/pwa/ServiceWorkerRegistration.tsx](../../../../src/components/pwa/ServiceWorkerRegistration.tsx) | CREATE | SW 登録 client component。`process.env.NODE_ENV === "production"` で gate                                              |
| [src/components/pwa/IOsInstallHint.tsx](../../../../src/components/pwa/IOsInstallHint.tsx)    | CREATE | iOS UA + 非 standalone 検出時のみ「共有 → ホーム画面に追加」テキスト案内                                                |
| [src/components/pwa/IOsInstallHint.test.tsx](../../../../src/components/pwa/IOsInstallHint.test.tsx) | CREATE | iOS UA / standalone display-mode の出し分けロジックを vitest で固定化                                                  |
| [src/app/layout.tsx](../../../../src/app/layout.tsx)                                          | UPDATE | `metadata.manifest` / `metadata.appleWebApp` / `viewport.themeColor` 追加。`<ServiceWorkerRegistration />` / `<IOsInstallHint />` を mount |
| [next.config.ts](../../../../next.config.ts)                                                  | UPDATE | `/sw.js` 用の HTTP headers（`Content-Type` / `Cache-Control: no-cache,no-store,must-revalidate` / CSP）を追加          |
| [vitest.config.ts](../../../../vitest.config.ts)                                              | UPDATE | coverage.exclude に `src/components/pwa/ServiceWorkerRegistration.tsx`（jsdom で SW 検証は実価値低）を追加              |
| [README.md](../../../../README.md)                                                            | UPDATE | アイコン素材の差し替え手順 / `npm run build` での manifest / SW 確認方法を Phase A 節として追記（任意・推奨）           |

## NOT Building

- **`advanceLevel(auto)` の updateDoc fallback** — Phase B
- **Wake Lock API / `screen.orientation.lock`** — Phase C
- **AudioContext unlock 強化** — Phase C
- **role-aware install promotion banner（owner/organizer 限定 + dismiss 永続化）** — Phase D
- **Web Push 通知 / `PushSubscription`** — PRD で Won't 明記（iOS 制約多）
- **`@serwist/next` / `next-pwa` 等のフレームワーク導入** — Turbopack β 互換性 / メンテ停滞リスクで排除（[Decisions Log: PWA フレームワーク](../prds/03-pwa-app-shell.prd.md#decisions-log)）
- **Workbox precaching auto-generation** — 素 SW で write、build manifest 自動収集はやらない
- **`/api/*` route の SW キャッシュ** — Phase A は public asset / shell HTML のみ。OG image / og endpoint は network-only

---

## Step-by-Step Tasks

### Task 1: `app/manifest.ts` の作成

- **ACTION**: `src/app/manifest.ts` を新規作成し `MetadataRoute.Manifest` を返す default export を実装
- **IMPLEMENT**:

  ```ts
  // src/app/manifest.ts
  import type { MetadataRoute } from "next";

  export default function manifest(): MetadataRoute.Manifest {
    return {
      name: "ALLin-PokerTimer",
      short_name: "ALLin",
      description: "NLH サークル向けトーナメント進行支援",
      start_url: "/",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#ffffff",
      theme_color: "#0a0a0f",
      icons: [
        {
          src: "/icons/icon-192.png",
          sizes: "192x192",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/icon-512.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "any",
        },
        {
          src: "/icons/icon-512-maskable.png",
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
      lang: "ja",
      categories: ["productivity", "utilities"],
    };
  }
  ```

- **MIRROR**: なし（新規ファイル / Next.js 公式パターン）
- **IMPORTS**: `import type { MetadataRoute } from "next";`
- **GOTCHA**:
  - `start_url: "/"` で home page から起動。loggedIn 状態は home page 側のロジックに任せる
  - `theme_color` は CSS の `--foreground: 240 10% 3.9%` ≒ `#0a0a0f` に揃える（status bar の背景色になる）
  - `background_color` は CSS の `--background: 0 0% 100%` = `#ffffff`（splash screen 背景）
  - `purpose: "maskable"` は Android adaptive icon 用、`purpose: "any"` は通常表示用。両方提供するのが推奨
  - `orientation: "any"` にしておく（Phase C で `screen.orientation.lock` を使うため manifest 側は any のまま）
- **VALIDATE**:
  - `npm run typecheck` zero error
  - `npm run build` 後 `.next/server/app/manifest.webmanifest` が生成され、JSON として valid
  - dev server 起動後 `curl http://localhost:3000/manifest.webmanifest` で返り値が valid JSON

### Task 2: `public/sw.js` の作成（素 Service Worker）

- **ACTION**: `public/sw.js` を新規作成し precache + runtime cache を実装
- **IMPLEMENT**:

  ```js
  // public/sw.js
  // ALLin-PokerTimer Service Worker
  // - precache: app shell HTML + manifest + icons
  // - runtime cache: HTML = network-first, static = stale-while-revalidate
  // - cross-origin (Firestore / Google APIs) はスルー（IndexedDB 側に既存）
  //
  // 注: Phase A 範囲。Phase B では auto-advance fallback の文脈で更新する可能性あり。
  // 本ファイルは vanilla JS（ESM 不可 / TS 不可）。Next.js は中身を transform しない。

  const CACHE_VERSION = "v1";
  const SHELL_CACHE = `allin-shell-${CACHE_VERSION}`;
  const RUNTIME_CACHE = `allin-runtime-${CACHE_VERSION}`;

  // App shell — auth-free / data-free な静的 routes のみ precache する。
  // 動的 route (`/groups/[gid]` / `/tournaments/[tid]` 等) は runtime cache に倒す。
  const SHELL_URLS = [
    "/",
    "/login",
    "/manifest.webmanifest",
    "/icons/icon-192.png",
    "/icons/icon-512.png",
    "/icons/icon-512-maskable.png",
    "/icons/apple-icon-180.png",
  ];

  self.addEventListener("install", (event) => {
    event.waitUntil(
      caches
        .open(SHELL_CACHE)
        .then((cache) => cache.addAll(SHELL_URLS))
        .then(() => self.skipWaiting()),
    );
  });

  self.addEventListener("activate", (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE)
              .map((k) => caches.delete(k)),
          ),
        )
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener("fetch", (event) => {
    const { request } = event;
    if (request.method !== "GET") return;

    const url = new URL(request.url);

    // cross-origin (Firestore / Google Auth / fonts.googleapis.com 等) は SW で扱わない
    if (url.origin !== self.location.origin) return;

    // HTML navigation: network-first, fallback to cache, last fallback to "/"
    if (request.mode === "navigate") {
      event.respondWith(networkFirst(request));
      return;
    }

    // Next.js static assets / public icons: stale-while-revalidate
    if (
      url.pathname.startsWith("/_next/static/") ||
      url.pathname.startsWith("/icons/") ||
      url.pathname.startsWith("/sounds/") ||
      url.pathname === "/manifest.webmanifest"
    ) {
      event.respondWith(staleWhileRevalidate(request));
      return;
    }

    // それ以外（/api/* / /sw.js 自身 / dev HMR endpoint 等）はネットワーク直行
  });

  async function networkFirst(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        cache.put(req, res.clone());
      }
      return res;
    } catch {
      const cached = await cache.match(req);
      if (cached) return cached;
      // 最終フォールバック: shell の "/" を返す（オフライン時の真っ白回避）
      const shell = await caches.match("/");
      if (shell) return shell;
      return new Response("offline", { status: 503, statusText: "offline" });
    }
  }

  async function staleWhileRevalidate(req) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cached = await cache.match(req);
    const network = fetch(req)
      .then((res) => {
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      })
      .catch(() => null);
    return cached ?? (await network) ?? new Response("", { status: 504 });
  }
  ```

- **MIRROR**: なし（vanilla JS / Service Worker 仕様）
- **IMPORTS**: なし（Service Worker scope の global API のみ）
- **GOTCHA**:
  - `public/sw.js` は **transform されない**ため ESM `import` / TS 構文は使えない
  - `event.respondWith(...)` は **同期で呼ばないと throw**。`if (...) { event.respondWith(asyncFn()) }` の形を必ず守る。`await` を `respondWith` の前に置くと「event.respondWith called too late」になる
  - `cross-origin` は早期 return（`return;`）で SW がデフォルト fetch を継続。`event.respondWith` 呼ばないことが大事
  - Firestore は `firestore.googleapis.com` で別 origin → SW スルー → SDK の IndexedDB cache が effective
  - cache key の `request` はそのまま渡す（vary header / query param で別 entry になる）
  - `self.skipWaiting()` + `self.clients.claim()` で update 即座反映。新 SW deploy 時にユーザーが古い HTML を引き続き見る race を縮める
- **VALIDATE**:
  - dev server 起動後 `curl http://localhost:3000/sw.js` で SW スクリプト本体が serve されることを確認
  - `npm run build && npm run start` 後、Chrome DevTools Application → Service Workers で `sw.js` が `activated and is running`
  - DevTools Application → Cache Storage に `allin-shell-v1` / `allin-runtime-v1` が表示
  - Network タブで Offline モード ON にして reload → アプリシェル HTML が cache から読める

### Task 3: SW 登録 client component の作成

- **ACTION**: `src/components/pwa/ServiceWorkerRegistration.tsx` を新規作成し production gate で `navigator.serviceWorker.register` を呼ぶ
- **IMPLEMENT**:

  ```tsx
  // src/components/pwa/ServiceWorkerRegistration.tsx
  "use client";

  import { useEffect } from "react";

  import { AppError } from "@/lib/errors";
  import { logger } from "@/lib/logger";

  /**
   * Service Worker 登録の client-only component。
   *
   * - production build のみで登録（dev では HMR / Turbopack と衝突するため無効化）
   * - `navigator.serviceWorker` 未対応ブラウザは feature detection で no-op
   * - 失敗は logger.warn のみ（PWA 機能無しでもアプリ自体は動く設計）
   *
   * Mount は `app/layout.tsx` の <body> 直下。何も render しない（return null）。
   */
  export function ServiceWorkerRegistration() {
    useEffect(() => {
      if (typeof window === "undefined") return;
      if (process.env.NODE_ENV !== "production") return;
      if (!("serviceWorker" in navigator)) return;

      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .then((reg) => {
          logger.info("sw registered", { scope: reg.scope });
        })
        .catch((e) => {
          const wrapped = AppError.from(
            e,
            "pwa/sw-register-failed",
            "Service Worker の登録に失敗しました",
          );
          logger.warn(wrapped.message, { code: wrapped.code });
        });
    }, []);

    return null;
  }
  ```

- **MIRROR**:
  - SSR ガード + production gate: [src/lib/firebase/client.ts:14-22](../../../../src/lib/firebase/client.ts#L14-L22) と [src/app/debug/fs/page.tsx:9](../../../../src/app/debug/fs/page.tsx#L9) のパターン
  - try/catch + AppError.from + logger.warn: [src/lib/hooks/useFullscreen.ts:55-58](../../../../src/lib/hooks/useFullscreen.ts#L55-L58)
- **IMPORTS**:
  - `import { useEffect } from "react";`
  - `import { AppError } from "@/lib/errors";`
  - `import { logger } from "@/lib/logger";`
- **GOTCHA**:
  - `updateViaCache: "none"` で SW スクリプト自体を HTTP cache させない（Task 4 の next.config で同じ意図を Cache-Control header でも徹底）
  - dev で SW を有効化したい場合は `process.env.NODE_ENV === "production"` の条件を一時的に外して試すが、必ず Application → Unregister + Cache Storage Clear をしてから dev に戻すこと
  - `register` の `.then((reg) => ...)` の reg は ServiceWorkerRegistration（DOM 型） — 同名で衝突するが本ファイルは React component の名前を `ServiceWorkerRegistration` にしているため import 衝突なし
- **VALIDATE**:
  - dev server (`npm run dev`) では SW 登録されない（DevTools Application → Service Workers が空）
  - `npm run build && npm run start` 後 SW 登録される（DevTools Application → Service Workers に `sw.js` が active）
  - 失敗時は `logger.warn` で `pwa/sw-register-failed` が出る
  - vitest 単体テストは jsdom の `navigator.serviceWorker` 未提供で複雑になるため省略可（次の `coverage.exclude` で除外）

### Task 4: `app/layout.tsx` の更新（meta tags + component mount）

- **ACTION**: `src/app/layout.tsx` を更新し PWA meta tags と SW 登録 / iOS hint コンポーネントを mount
- **IMPLEMENT**:

  ```tsx
  // src/app/layout.tsx
  import type { Metadata, Viewport } from "next";  // ← Viewport 追加
  import Link from "next/link";
  import type { ReactNode } from "react";

  import { AuthBadge } from "@/components/auth/AuthBadge";
  import { AppShell } from "@/components/nav/AppShell";
  import { HeaderMenuButton } from "@/components/nav/HeaderMenuButton";
  import { NavStateProvider } from "@/components/nav/nav-state";
  import { PageTitleProvider, PageTitleSlot } from "@/components/nav/page-title";
  import { IOsInstallHint } from "@/components/pwa/IOsInstallHint";  // ← 追加
  import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";  // ← 追加
  import { AuthProvider } from "@/lib/firebase/AuthProvider";
  import { GroupProvider } from "@/lib/services/current-group";

  import "./globals.css";

  export const metadata: Metadata = {
    title: "ALLin-PokerTimer",
    description: "NLH サークル向けトーナメント進行支援",
    manifest: "/manifest.webmanifest",
    applicationName: "ALLin-PokerTimer",
    appleWebApp: {
      capable: true,
      title: "ALLin-PokerTimer",
      statusBarStyle: "black-translucent",
    },
    formatDetection: {
      telephone: false,
    },
    icons: {
      icon: [
        { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
        { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      ],
      apple: [{ url: "/icons/apple-icon-180.png", sizes: "180x180", type: "image/png" }],
    },
  };

  export const viewport: Viewport = {
    themeColor: "#0a0a0f",
    width: "device-width",
    initialScale: 1,
    viewportFit: "cover",  // iOS notch / safe-area 対応
  };

  export default function RootLayout({ children }: { children: ReactNode }) {
    return (
      <html lang="ja">
        <body className="min-h-screen bg-background text-foreground antialiased">
          <a href="#main" className="skip-link">
            メインコンテンツへスキップ
          </a>
          <AuthProvider>
            <GroupProvider>
              <NavStateProvider>
                <PageTitleProvider>
                  <header className="sticky top-0 z-20 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur">
                    <div className="flex items-center gap-2">
                      <HeaderMenuButton />
                      <Link href="/" className="text-sm font-semibold">
                        ALLin-PokerTimer
                      </Link>
                    </div>
                    <div className="flex min-w-0 justify-center">
                      <PageTitleSlot />
                    </div>
                    <div className="flex justify-end">
                      <AuthBadge />
                    </div>
                  </header>
                  <IOsInstallHint />  {/* ← header の下に挟む */}
                  <AppShell>{children}</AppShell>
                </PageTitleProvider>
              </NavStateProvider>
            </GroupProvider>
          </AuthProvider>
          <ServiceWorkerRegistration />  {/* ← body 末尾に mount */}
        </body>
      </html>
    );
  }
  ```

- **MIRROR**:
  - `metadata` export の現行形: [src/app/layout.tsx:15-18](../../../../src/app/layout.tsx#L15-L18)
  - `Viewport` 型は Next.js 15 で `metadata.themeColor` deprecation の替わり
- **IMPORTS**:
  - `import type { Metadata, Viewport } from "next";`（既存 Metadata の隣に Viewport 追加）
  - `import { IOsInstallHint } from "@/components/pwa/IOsInstallHint";`
  - `import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";`
- **GOTCHA**:
  - `metadata.themeColor` ではなく `viewport.themeColor` を使う（`metadata.themeColor` は Next.js 15 で警告）
  - `metadata.icons` を設定すると Next.js が `<link rel="icon">` / `<link rel="apple-touch-icon">` を auto-inject するため、別途 `<head>` に書く必要はなし
  - `<IOsInstallHint />` の挿入位置は header の **下** / `<AppShell>` の **上**。ヒントは header と main コンテンツの間に常時表示（iOS 訪問者のみ表示・非 iOS は null）
  - `<ServiceWorkerRegistration />` は body 末尾、return null コンポーネントなのでどこに置いても visual 影響なし
  - `viewportFit: "cover"` は iOS notch / safe-area で hint の余白崩れを防ぐ。globals.css で `env(safe-area-inset-*)` を使う場合の前提
- **VALIDATE**:
  - `npm run typecheck` zero error
  - `npm run dev` 後 view-source で `<link rel="manifest" href="/manifest.webmanifest">` / `<meta name="theme-color" content="#0a0a0f">` / `<link rel="apple-touch-icon" href="/icons/apple-icon-180.png">` が含まれること
  - DevTools Lighthouse → PWA: Installable → green

### Task 5: アイコン素材の配置

- **ACTION**: `public/icons/` ディレクトリを作成し PNG 4 ファイルを配置
- **IMPLEMENT**: 以下のファイルを配置（バイナリのため repo へ commit）:

  | パス                                   | サイズ    | 用途                                                                                              |
  | -------------------------------------- | --------- | ------------------------------------------------------------------------------------------------- |
  | `public/icons/icon-192.png`            | 192×192   | manifest icons[0] / Android home screen / Lighthouse PWA audit                                    |
  | `public/icons/icon-512.png`            | 512×512   | manifest icons[1] / splash screen / Android adaptive icon の non-maskable variant                 |
  | `public/icons/icon-512-maskable.png`   | 512×512   | manifest `purpose: "maskable"` / Android adaptive icon。中央 80%（safe area）にロゴを収める      |
  | `public/icons/apple-icon-180.png`      | 180×180   | iOS apple-touch-icon。フチなし（iOS が自動で角丸化）                                              |

  **デザイン指針**（PRD Open Question を本 Phase で確定）:
  - 採用方針: **シンプルな monogram（"AT" 文字 + theme color 背景）**を初期デザインとして commit。今後デザイナー / AI 生成画像で差し替え可能
  - 背景色: `#0a0a0f`（manifest theme_color と同一）
  - 前景色: `#ffffff`
  - フォント: 太め sans-serif（Noto Sans JP Bold か Inter Bold）
  - maskable: 192/512 中央 80% に文字を収め、外周 10% は単色 padding
  - **作成手順例**:
    - Figma で `512×512` artboard 作成 → 中央 80% の `409.6×409.6` セーフエリアに「AT」テキスト → `#0a0a0f` 背景 + `#ffffff` 文字 → PNG export 4 サイズ
    - もしくは AI（DALL-E 3 / Midjourney）に「Simple monogram 'AT' on dark background, flat design, 512x512 PNG」を依頼
  - **Phase D / 後続 Phase で改善可**: 専用デザイナーによるロゴ刷新は将来 PRD で対応
- **MIRROR**: なし（バイナリアセット）
- **IMPORTS**: なし
- **GOTCHA**:
  - PNG ファイルは **lossless 圧縮**（pngquant / optipng）で size を削減し、iOS Cache 50MB 上限の余裕を増やす
  - SVG は使わない（一部古い iOS Safari で apple-touch-icon が SVG 非対応）
  - 透過 PNG は iOS Safari で背景がランダム色に化けることがあるため、必ず単色背景の PNG にする
  - maskable は Maskable.app（[https://maskable.app/](https://maskable.app/)）でプレビュー可能
  - `public/icons/` ディレクトリは MIT 互換性確認: 今回 commit する placeholder は自前デザインのため OK。LucideReact / HeroIcons の SVG を流用する場合も MIT ライセンスで OK
- **VALIDATE**:
  - `ls public/icons/` で 4 ファイルが存在
  - `file public/icons/icon-192.png` が `PNG image data, 192 x 192` を出力（macOS / Linux）
  - `npm run dev` 後、ブラウザで `http://localhost:3000/icons/icon-192.png` 等が直接読める
  - Maskable.app に `icon-512-maskable.png` を upload して Android 各機種シミュレートで切れていないこと

### Task 6: `IOsInstallHint` コンポーネントの作成

- **ACTION**: `src/components/pwa/IOsInstallHint.tsx` を新規作成し iOS UA + 非 standalone のときだけ案内を表示
- **IMPLEMENT**:

  ```tsx
  // src/components/pwa/IOsInstallHint.tsx
  "use client";

  import { Info, Share } from "lucide-react";
  import { useEffect, useState } from "react";

  /**
   * iOS Safari 訪問者向けの「ホーム画面に追加」案内バナー。
   *
   * iOS は `beforeinstallprompt` が永久に非対応のため、UA + display-mode で
   * 「未インストールの iOS Safari 訪問者」のみに hint を出す。
   *
   * Phase A: role gating なしで全 iOS 訪問者に表示
   * Phase D: useGroupRole で role !== "member" のときのみ表示する gating を追加
   */
  export function IOsInstallHint() {
    const [show, setShow] = useState(false);

    useEffect(() => {
      if (typeof window === "undefined") return;
      const ua = navigator.userAgent;
      const isIOS =
        /iPad|iPhone|iPod/.test(ua) &&
        !("MSStream" in window);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        // iOS Safari < 16 fallback
        (navigator as Navigator & { standalone?: boolean }).standalone === true;
      setShow(isIOS && !isStandalone);
    }, []);

    if (!show) return null;

    return (
      <section
        role="note"
        className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20"
      >
        <Info aria-hidden className="h-4 w-4 shrink-0" />
        <span className="flex-1">
          iOS でホーム画面に追加するには、Safari 下部の
          <Share aria-hidden className="mx-1 inline h-4 w-4 align-text-bottom" />
          共有ボタン →「ホーム画面に追加」を選択してください。
        </span>
      </section>
    );
  }
  ```

- **MIRROR**:
  - `"use client"` + lucide icon + Tailwind utility のスタイル: [src/components/audio/SoundUnlockBanner.tsx:1-44](../../../../src/components/audio/SoundUnlockBanner.tsx#L1-L44)
  - SSR ガード + UA 判定 + `useState/useEffect` の現行形: [src/lib/hooks/useFullscreen.ts:25-46](../../../../src/lib/hooks/useFullscreen.ts#L25-L46)
- **IMPORTS**:
  - `import { Info, Share } from "lucide-react";`
  - `import { useEffect, useState } from "react";`
- **GOTCHA**:
  - `(navigator as Navigator & { standalone?: boolean }).standalone` は iOS Safari 独自 prop（display-mode media query が古い iOS で動かない場合の fallback）
  - `MSStream` 判定は IE11 排除（Next.js 公式ガイドが採用するパターン）
  - **role gating は本 Phase では入れない**（Phase D で `useGroupRole(gid)` で `role !== "member"` を要件化）。本 Phase で全 iOS 訪問者に出すのは PRD Phase A scope 通り
  - `role="note"` は ARIA 補助情報。`role="alert"` ではない（割り込みではない常設 hint）
  - `aria-hidden` を icon に付けて screen reader が icon 名を読み上げないようにする
  - 表示位置は `app/layout.tsx` の header と main の間。globally 表示
- **VALIDATE**:
  - `npm run typecheck` zero error
  - `npm run dev` で iPhone 風 UA に切替（Chrome DevTools Toggle device toolbar → iPhone 14）→ hint が表示される
  - PC Chrome では hint が非表示
  - DevTools の Application → Manifest → "Add to home screen" を発火させ standalone モード起動 → hint 非表示

### Task 7: `IOsInstallHint` の単体テスト

- **ACTION**: `src/components/pwa/IOsInstallHint.test.tsx` を新規作成し UA / display-mode の場合分けを vitest で検証
- **IMPLEMENT**:

  ```tsx
  // src/components/pwa/IOsInstallHint.test.tsx
  import { render, screen } from "@testing-library/react";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

  import { IOsInstallHint } from "./IOsInstallHint";

  function setUserAgent(ua: string) {
    Object.defineProperty(navigator, "userAgent", {
      configurable: true,
      get: () => ua,
    });
  }

  function setMatchMedia(standalone: boolean) {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(display-mode: standalone)" ? standalone : false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
  }

  beforeEach(() => {
    setMatchMedia(false);
    setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("IOsInstallHint", () => {
    it("renders nothing on non-iOS UA", () => {
      setUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome");
      render(<IOsInstallHint />);
      expect(screen.queryByRole("note")).toBeNull();
    });

    it("renders the hint on iPhone UA when not standalone", () => {
      setUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
      );
      render(<IOsInstallHint />);
      expect(screen.getByRole("note")).toBeInTheDocument();
      expect(screen.getByText(/ホーム画面に追加/)).toBeInTheDocument();
    });

    it("renders nothing on iPhone UA when already in standalone display-mode", () => {
      setUserAgent(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
      );
      setMatchMedia(true);
      render(<IOsInstallHint />);
      expect(screen.queryByRole("note")).toBeNull();
    });

    it("renders nothing on iPad UA when navigator.standalone is true (iOS Safari fallback)", () => {
      setUserAgent("Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1");
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        get: () => true,
      });
      render(<IOsInstallHint />);
      expect(screen.queryByRole("note")).toBeNull();
      // teardown
      Object.defineProperty(navigator, "standalone", {
        configurable: true,
        get: () => undefined,
      });
    });
  });
  ```

- **MIRROR**:
  - `Object.defineProperty(document/navigator/window, prop, { configurable, get })` で feature を mock: [src/lib/hooks/useFullscreen.test.tsx:11-29](../../../../src/lib/hooks/useFullscreen.test.tsx#L11-L29)
  - `vi.restoreAllMocks()` を `afterEach` に置く: [src/lib/hooks/useFullscreen.test.tsx:32-34](../../../../src/lib/hooks/useFullscreen.test.tsx#L32-L34)
- **IMPORTS**:
  - `import { render, screen } from "@testing-library/react";`
  - `import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";`
- **GOTCHA**:
  - `navigator.userAgent` は jsdom のデフォルト値があるため必ず beforeEach で初期化
  - `window.matchMedia` は jsdom 未提供 → `vi.fn().mockImplementation(...)` で stub
  - `navigator.standalone` は iOS 独自 prop なので `Object.defineProperty` でセットアップ + teardown
- **VALIDATE**:
  - `npm test src/components/pwa/IOsInstallHint.test.tsx` で 4 ケース全 pass
  - `npm test` 全体 green（regression なし）

### Task 8: `next.config.ts` に `/sw.js` 用 HTTP headers を追加

- **ACTION**: `next.config.ts` の `headers()` を新規追加し、SW スクリプト自身が HTTP cache に乗らないよう Cache-Control を強制
- **IMPLEMENT**:

  ```ts
  // next.config.ts
  import type { NextConfig } from "next";

  const nextConfig: NextConfig = {
    reactStrictMode: true,
    outputFileTracingIncludes: {
      "/api/og/winner/[tid]": [
        "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff",
        "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
      ],
      "/api/og/season/[gid]": [
        "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-400-normal.woff",
        "./node_modules/@fontsource/noto-sans-jp/files/noto-sans-jp-japanese-700-normal.woff",
      ],
    },
    async headers() {
      return [
        {
          // Phase A: Service Worker スクリプト自身は HTTP cache に乗らないよう
          // 都度サーバから取得させる。register 側の updateViaCache: "none" と二重で
          // 「古い SW が pin されたまま update 検知できない」事故を防ぐ。
          source: "/sw.js",
          headers: [
            {
              key: "Content-Type",
              value: "application/javascript; charset=utf-8",
            },
            {
              key: "Cache-Control",
              value: "no-cache, no-store, must-revalidate",
            },
          ],
        },
      ];
    },
  };

  export default nextConfig;
  ```

- **MIRROR**: 既存 `outputFileTracingIncludes` のスタイル: [next.config.ts:1-19](../../../../next.config.ts)（コメントスタイル / TypeScript 型注釈 / async function 形式）
- **IMPORTS**: なし（`NextConfig` 既存）
- **GOTCHA**:
  - Next.js 公式 PWA ガイドは `Content-Security-Policy: default-src 'self'; script-src 'self'` も推奨するが、**本プロジェクトは別途 CSP を設定していない**ため、`/sw.js` だけ厳密 CSP を入れると整合性が取りにくい。Phase A は CSP は入れず、Cache-Control + Content-Type のみに留める（後続 Phase で全体 CSP を入れる際に統合）
  - `source: "/sw.js"` は exact path match。`source: "/sw.js?**"` のような pattern は不要
- **VALIDATE**:
  - `npm run typecheck` zero error
  - `npm run build && npm run start` 後 `curl -I http://localhost:3000/sw.js` で `Cache-Control: no-cache, no-store, must-revalidate` が出力される

### Task 9: `vitest.config.ts` の coverage exclude 更新

- **ACTION**: SW 登録 component を coverage 対象外に追加（jsdom で `navigator.serviceWorker` を mock するのは複雑かつ価値が低いため、既存 `client.ts` / `audio-context.ts` と同方針）
- **IMPLEMENT**:

  ```ts
  // vitest.config.ts:23-39 の exclude 配列に 1 行追加
  exclude: [
    "src/lib/**/*.test.ts",
    "src/lib/**/*.test.tsx",
    "src/lib/firebase/client.ts",
    "src/lib/services/qr.ts",
    "src/lib/utils.ts",
    "src/lib/hooks/useTournamentTimer.ts",
    "src/lib/audio/audio-context.ts",
    "src/lib/firebase/repositories/groupJoinCodes.ts",
    "src/lib/firebase/repositories/groups.ts",
    "src/lib/firebase/repositories/players.ts",
    "src/lib/firebase/repositories/structures.ts",
    "src/lib/firebase/repositories/users.ts",
  ],
  ```

  ⚠ ただし `vitest.config.ts` の `coverage.include` は `src/lib/**/*.ts` のみ。`src/components/pwa/*` は **そもそも include されない**ため exclude 追加不要。**この Task は no-op で skip**。

  `IOsInstallHint.tsx` は `src/components/pwa/` 配下なので coverage 対象外（既存 `src/components/**` が include されないルール）。テストは記述するが coverage threshold には影響しない。

- **MIRROR**: なし
- **IMPORTS**: なし
- **GOTCHA**:
  - **本 Task は実質 no-op**。本来「SW 登録 component を exclude しなければ coverage threshold 80% を割る」リスクを念頭に置いていたが、`coverage.include` が `src/lib/**/*.ts` のみのため `src/components/pwa/*` は元から対象外
  - 確認のためだけに記載。typecheck / test の green を確認したらこの Task は飛ばしてよい
- **VALIDATE**:
  - `npm test -- --coverage` で coverage threshold 80% を維持

### Task 10: README に Phase A 動作確認手順を追記（任意・推奨）

- **ACTION**: `README.md` に「PWA 動作確認」のセクションを追記
- **IMPLEMENT**:

  ```md
  ## PWA 動作確認（Phase A 以降）

  本アプリは PWA として動作します。`npm run build && npm run start` で本番モード起動後:

  1. Chrome DevTools → Application → Manifest が green
  2. Application → Service Workers に `sw.js` が active
  3. Application → Cache Storage に `allin-shell-v1` / `allin-runtime-v1` が出る
  4. Lighthouse → PWA → Installable / Service Worker が green

  iOS Safari でホーム画面に追加すると、ホーム画面アイコンタップで standalone 起動します。
  `dev` モード（`npm run dev`）では HMR との衝突回避のため SW は登録されません。

  アイコン素材は `public/icons/` 配下にあり、デザイナーによる差し替えは Phase D 以降で予定しています。
  ```

- **MIRROR**: README の既存スタイル（H2 見出し + 番号付きリスト + コードブロック）
- **IMPORTS**: なし
- **GOTCHA**: 任意 Task。本体機能には影響しない。reviewer / 後続作業者向けの手順書
- **VALIDATE**:
  - markdown lint pass（既存の book-keeping を踏襲）
  - 手順通りに動作することを実機 / DevTools で確認

---

## Testing Strategy

### Unit Tests

| Test                                                                               | Input                                              | Expected Output                                                  | Edge Case?                |
| ---------------------------------------------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------------------- | ------------------------- |
| `IOsInstallHint renders nothing on non-iOS UA`                                     | UA = `Linux Chrome`                                | `screen.queryByRole("note")` === null                            | Android Chrome（PWA install banner は別経路） |
| `IOsInstallHint renders the hint on iPhone UA when not standalone`                 | UA = `iPhone Safari`、matchMedia standalone=false  | `<section role="note">` が `「ホーム画面に追加」` を含む         | golden path               |
| `IOsInstallHint renders nothing on iPhone UA when already in standalone display-mode` | UA = `iPhone Safari`、matchMedia standalone=true | render 結果 null                                                 | iOS PWA 内で再表示しない |
| `IOsInstallHint renders nothing on iPad when navigator.standalone===true`          | UA = `iPad Safari`、`navigator.standalone=true`    | render 結果 null                                                 | 古い iOS Safari fallback |

`ServiceWorkerRegistration` の挙動（`navigator.serviceWorker.register` 呼出）は jsdom で再現困難 + 価値低のため unit test 対象外。手動 / Lighthouse / E2E（Phase B 以降で実機確認）でカバー。

### Edge Cases Checklist

- [x] 非 iOS UA — IOsInstallHint テストでカバー
- [x] iOS PWA standalone モード（インストール後再訪） — IOsInstallHint テストでカバー
- [x] dev mode (`NODE_ENV !== "production"`) で SW 登録されないこと — 手動確認（DevTools Application → Service Workers が空）
- [x] `navigator.serviceWorker` 未対応ブラウザ — feature detection で no-op、ログ出ず
- [x] SW 登録失敗（HTTPS でない / scope 違反等） — `logger.warn("...", { code: "pwa/sw-register-failed" })` 1 回出力
- [x] manifest.webmanifest が存在しないブラウザ訪問 — Next.js が 200 で返すため発生しない
- [x] iOS Cache 50MB 上限 — 4 PNG icons + Next.js static + shell HTML で十分余裕（Vercel build 後の bundle size を `npm run build` のログで確認）
- [x] cross-origin（Firestore / Google Auth） SW スルー — sw.js の `if (url.origin !== self.location.origin) return;` で対応

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

EXPECT: Zero lint errors（特に `no-console` 規約 / `import/order` 違反なし）

### Unit Tests

```bash
npm test src/components/pwa/IOsInstallHint.test.tsx
```

EXPECT: 4 ケース pass

```bash
npm test
```

EXPECT: All tests pass、coverage threshold 80% 維持

### Build Verification

```bash
npm run build
```

EXPECT:
- ビルド成功（Turbopack / webpack 警告なし）
- `.next/server/app/manifest.webmanifest` が生成される
- `public/sw.js` がそのまま `.next/static/` 経由で配信可能（`npm run start` で `curl http://localhost:3000/sw.js` が 200）

### Manifest / SW Validation（手動）

```bash
npm run build && npm run start
```

別ターミナル:

```bash
curl -s http://localhost:3000/manifest.webmanifest | jq .
curl -I http://localhost:3000/sw.js
curl -I http://localhost:3000/icons/icon-192.png
```

EXPECT:
- `manifest.webmanifest`: valid JSON、`name` / `icons` / `display: "standalone"` を含む
- `sw.js` の Cache-Control に `no-cache, no-store, must-revalidate`
- `icon-192.png`: HTTP 200 + Content-Type `image/png`

### Browser Validation（手動）

- Chrome DevTools → Application → Manifest: 警告 0 件、`Add to homescreen` ボタン active
- Application → Service Workers: `sw.js` が `activated and is running`
- Application → Cache Storage: `allin-shell-v1` / `allin-runtime-v1` が表示
- Network タブで Offline ON → reload → アプリシェルが表示される（真っ白にならない）
- Lighthouse → PWA タブ: Installable / Splash screen / Themed omnibox / Service worker registers / 全 green
- iPhone DevTools simulator → IOsInstallHint が表示される
- Android Chrome 実機 → 「ホーム画面に追加」プロンプトが表示（手動 install）→ standalone 起動確認
- iOS 実機 Safari → 共有 → 「ホーム画面に追加」→ apple-touch-icon 表示確認 + standalone 起動

### Manual Validation Checklist

- [ ] `app/manifest.ts` が valid TypeScript で `MetadataRoute.Manifest` を返す
- [ ] `public/sw.js` が valid JS で linter / browser console 無警告
- [ ] `public/icons/*.png` が 4 枚揃い、サイズ通り
- [ ] `app/layout.tsx` の view-source に `<link rel="manifest">` / `<meta name="theme-color">` / `<link rel="apple-touch-icon">` 全 出力
- [ ] dev mode で SW 登録されない（DevTools 確認）
- [ ] production mode で SW 登録される（DevTools 確認）
- [ ] iOS UA + 非 standalone で `IOsInstallHint` 表示
- [ ] iOS UA + standalone で `IOsInstallHint` 非表示
- [ ] non-iOS UA で `IOsInstallHint` 非表示
- [ ] Vercel preview / 本番 deploy 後、実機 iOS Safari で「ホーム画面に追加」→ アイコン + standalone 起動確認

---

## Acceptance Criteria

- [ ] Phase A の全 Task（Task 1〜10）完了
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` 全 green
- [ ] Chrome DevTools Lighthouse → PWA カテゴリ: Installable + Service Worker = green
- [ ] iOS / Android 両プラットフォームで「ホーム画面に追加」→ standalone 起動確認（手動・実機 or DevTools simulator）
- [ ] manifest 必須項目（name / icons / display / start_url）が valid
- [ ] SW が `/sw.js` で active、`allin-shell-v1` cache に shell URLs が precache される
- [ ] dev mode で SW 登録されない、production mode で登録される
- [ ] iOS hint が UA + display-mode で正しく出し分けられる（unit test 4 ケース pass）
- [ ] PRD Phase A の **Open Question 全件**が plan / コメント上で確定:
  - [x] Service Worker の precache 対象 routes 範囲 → **shell URLs（`/`, `/login`, `/manifest.webmanifest`, `/icons/*`）に限定**。動的 route は runtime cache に倒す
  - [x] アイコン素材の作成方針 → **自前デザイン（"AT" monogram）を Phase A で初期投入、Phase D 以降でデザイナー差し替え可**
  - [x] 7 日無アクセス自動削除（iOS ITP 7-day cap）対策 → **起動時 SW re-register（ServiceWorkerRegistration が mount のたびに register 呼出）で対処**。critical asset re-fetch は `updateViaCache: "none"` + Cache-Control で SW スクリプト自身が cache されないことで間接的に保証

## Completion Checklist

- [ ] 既存パターン（`useFullscreen` / `audio-context` / `client.ts`）に揃った SSR ガード / production gate / logger.warn 経路
- [ ] `console.*` の直呼びなし（logger 経由）
- [ ] `AppError.from` でラップしたエラーが `pwa/sw-register-failed` 等のドメイン prefix を持つ
- [ ] テストは [src/lib/hooks/useFullscreen.test.tsx](../../../../src/lib/hooks/useFullscreen.test.tsx) と同じ `Object.defineProperty` mock 形式
- [ ] hardcoded value 最小（theme color / cache version は const 化）
- [ ] CLAUDE.md / 規約ファイル違反なし: `console.*` / `throw new Error` / `process.env.NEXT_PUBLIC_*` 動的 access が混入していない
- [ ] PRD Phase A の Success signal が達成済み（DevTools Application で manifest valid + standalone 起動）
- [ ] 不要なスコープ追加なし（auto-advance fallback / Wake Lock / role gating は Phase B/C/D に分離）

## Risks

| Risk                                                                                  | Likelihood | Impact | Mitigation                                                                                                                                                                                |
| ------------------------------------------------------------------------------------- | ---------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turbopack（Next.js 15 デフォルト dev runtime）と SW の dev 環境衝突で `npm run dev` 壊れる | M          | M      | dev mode で SW 登録を `process.env.NODE_ENV === "production"` で gate。dev 中の SW 関連 console 警告は出ない。`public/sw.js` は素 JS で transform 対象外のため Turbopack ビルドへの副作用ゼロ |
| iOS Cache 50MB 上限超過で precache 失敗                                                | L          | M      | precache 対象を **shell URLs（HTML 1〜2 + manifest + icons 4）のみ**に絞り、Next.js static は runtime cache（SWR）で必要時取得。総容量 ~ 1MB 未満に収まる                                |
| `app/manifest.ts` が build エラー（型不一致 / import 漏れ）                            | L          | H      | `import type { MetadataRoute } from "next";` を必ず付け、`MetadataRoute.Manifest` の戻り値型に揃える。`npm run typecheck` で事前検出                                                      |
| `public/sw.js` の `event.respondWith` を非同期外で呼ぶ実装ミスでブラウザコンソール warn | M          | L      | task 2 の GOTCHA に明記。`await` を `event.respondWith(asyncFn())` の **外**には書かない。Lighthouse PWA audit で検出される                                                              |
| アイコン素材のデザイン品質が初期投入時に低い（運営者から「ださい」フィードバック）       | M          | L      | 初期は monogram で機能優先。Phase D 以降でデザイナー差し替え可能と PRD / README に明記                                                                                                   |
| iOS 7 日無アクセス自動削除（ITP 7-day cap）で月 1〜2 回開催の本アプリが「常に未キャッシュ」 | M          | L      | 月 1〜2 回開催のため毎回 cache 再生成は許容範囲。初回 precache は ~1MB / 数百ms で完結。critical asset 不在で起動が遅延するシナリオは存在しない                                          |
| Vercel build / deploy 時に `public/sw.js` が誤って bundle 経由に乗り編集される          | L          | H      | Next.js は `public/` 配下を **そのまま静的配信**する仕様（公式 doc 確認済み）。`outputFileTracingIncludes` 等の Vercel serverless 設定とは独立                                            |

## Notes

- **Phase A は Phase B / C / D の前提**。本 Phase が終わらないと auto-advance fallback / Wake Lock / role-aware install banner は意味を成さない（`display-mode: standalone` 検出 / `useGroupRole` × `beforeinstallprompt` の前提として manifest が必要）
- **Phase A の進捗を PRD の Implementation Phases 表に反映**: Status を `pending` → `in-progress` に更新し、PRP Plan 列に本ファイルへの link を追加（出力時に自動）
- **Phase A 完了後**: PRD の Phase B 行を `pending` のままにしておき、`/prp-plan` を再度 Phase B 用に走らせる
- **アイコン素材の MIT 互換性**: 自前 monogram は MIT 互換問題なし。後続でデザイナー外注 / AI 生成画像に差し替える場合は、ライセンス確認を別途 PR レビューで行う（[security-base.md](../../../../.claude/rules/security-base.md) の依存追加 ask モードに準ずる）
- **Decisions Log への影響**: PRD の Decisions Log を本 plan で改変する必要なし（PWA フレームワーク選定 / multi-tab 方針は変更なし）
- **next.config.ts への CSP 追加**: 公式 PWA ガイドの `Content-Security-Policy` は本 Phase で入れない（プロジェクト全体の CSP 戦略がまだ存在しないため）。後続 PRD で総合的に対応
- **`next-pwa` / `@serwist/next` 排除の決定**: PRD Decisions Log に明記済み。本 plan で再度の検討なし
- **PRD 規約 (CLAUDE.md)**: Phase A は新規 Firestore schema / rule 追加なし → drift check / emulator validator 追加不要。`logger.info("sw registered", { scope })` 等のログは [error-logging.md](../../../../.claude/rules/error-logging.md) に準拠
