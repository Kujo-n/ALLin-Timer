# Plan: Phase C — Device Controls（Wake Lock / Orientation Lock / AudioContext unlock 強化）

## Summary

会場プロジェクタ投影に耐えるデバイス制御を 3 種（Wake Lock API による画面消灯防止 / `screen.orientation.lock("landscape")` による横向き固定 / タイマー開始ボタン押下時の確実な AudioContext unlock）導入する。すべて feature detection 必須・未対応環境ではテキスト案内 fallback。本 Phase は Phase A/B/D と独立した「デバイス API 領域」で、依存ゼロのため Phase A と並列実行可能。

## User Story

As a サークル運営者,
I want タイマー画面を会場プロジェクタに投影中に画面消灯やローテーションでタイマーが見えなくなることを防ぎ、開始ボタン押下時に確実に音声が鳴ること,
So that 会場運用中に「画面が消えた」「縦向きで小さくなった」「ブラインドアップ音が鳴らなかった」という体感品質の崩れを排除できる.

## Problem → Solution

**現状**: `/tournaments/[tid]` running 中、OS のスクリーンタイムアウトで画面が消灯する／回転で縦向きに切替わる／開始ボタン押下時に `useImplicitAudioUnlock` の pointerdown 拾い損ねで AudioContext が `suspended` のまま → ブラインドアップ音が鳴らない。

**目標**: タイマー画面（`state === "running"`）で `navigator.wakeLock.request("screen")` を発行し、画面消灯を防止。`screen.orientation.lock("landscape")` を PWA standalone 時に試行。タイマー開始（`confirmSeating` / `resumeTournament`）ボタン押下時に **必ず `await resumeAudioContext()` を実行**してから書込を起動。

## Metadata

- **Complexity**: Medium
- **Source PRD**: `.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md`
- **PRD Phase**: Phase C — Device Controls
- **Estimated Files**: 7 (3 new hook + 1 new component + 3 update)

---

## UX Design

### Before

```
┌─────────────────────────────────────────────┐
│ /tournaments/[tid]  state: running          │
│ ┌──────────────────────────────────────┐    │
│ │   Lv 3  blind 200/400              │    │
│ │   ⏱  10:23                          │    │
│ │   [⏸] [前] [次] [終了]              │    │
│ └──────────────────────────────────────┘    │
│                                             │
│ ❌ 1〜2 分後に OS が画面を消灯              │
│ ❌ ユーザーが端末を縦向きに → 小さく表示   │
│ ❌ 開始ボタン押下 → 音が鳴らないことがある │
└─────────────────────────────────────────────┘
```

### After

```
┌─────────────────────────────────────────────┐
│ /tournaments/[tid]  state: running          │
│ ┌──────────────────────────────────────┐    │
│ │   Lv 3  blind 200/400              │    │
│ │   ⏱  10:23                          │    │
│ │   [⏸] [前] [次] [終了]              │    │
│ └──────────────────────────────────────┘    │
│ ✅ Wake Lock acquired: 画面消灯しない        │
│ ✅ standalone 時は landscape lock           │
│ ✅ 「開始」押下 → AudioContext resume       │
│    → 即時 / 次レベル時に正しく鳴る          │
│                                             │
│ Wake Lock 未対応 (iOS Safari < 16.4):       │
│ 「省電力のため画面が消えないよう設定してく │
│  ださい」のテキスト案内を hint として表示  │
└─────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/tournaments/[tid]` running 中の画面消灯 | OS デフォルト（30s〜数分でタイムアウト） | Wake Lock 取得済（手動 OS lock 以外で消えない）| visibilitychange で再取得、`finished` で release |
| 端末ローテーション（PWA standalone） | OS デフォルト（縦/横自動） | `landscape` で固定 | feature detection 必須。ブラウザタブ閲覧時 / iOS では no-op |
| 「トーナメント開始」ボタン押下 | クリック → confirmSeating → 次レベル時に音が鳴らないことがある | クリック → `await resumeAudioContext()` → confirmSeating | 既存 `useImplicitAudioUnlock` の補助。失敗時は既存 `SoundUnlockBanner` が表示される |
| 「再開」ボタン押下（paused → running） | 同上 | 同上（unlock を await） | 一時停止からの再開でも unlock を試行 |
| Wake Lock 未対応端末 | サイレントに何も起きない | 案内テキスト「省電力のため画面が消えないよう設定してください」を hint 表示 | iOS Safari 16.4 未満を想定 |

---

## Mandatory Reading

| Priority       | File                                                                     | Lines     | Why                                                              |
| -------------- | ------------------------------------------------------------------------ | --------- | ---------------------------------------------------------------- |
| P0 (critical)  | `src/lib/hooks/useFullscreen.ts`                                         | 1-62      | 同種のブラウザ API を扱う hook の正準形（SSR ガード / event sync / AppError + logger.warn の rejection） |
| P0 (critical)  | `src/lib/hooks/useImplicitAudioUnlock.ts`                                | 1-41      | 既存の AudioContext unlock 経路。Phase C で「ボタン押下 await resume」を補助で追加するが、本 hook の存在意義は維持 |
| P0 (critical)  | `src/lib/audio/audio-context.ts`                                         | 1-81      | `resumeAudioContext` の契約 — user gesture 内で同期的に呼ぶ / 戻り値 `AudioContextState \| null` |
| P0 (critical)  | `src/components/tournament/_timer-controls/TimerControlsSeating.tsx`     | 1-75      | 「トーナメント開始」ボタン (`confirmSeating`)。run() callback 内で resumeAudioContext を await する形に書き換える |
| P0 (critical)  | `src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx` | 1-156    | 「再開」ボタン (`resumeTournament`)。同様に await resumeAudioContext を挿入 |
| P0 (critical)  | `src/app/tournaments/[tid]/dashboard-client.tsx`                         | 67-172    | 新 hook (`useWakeLock` / `useOrientationLock`) の mount 位置。`data?.state === "running"` 引数で制御 |
| P1 (important) | `src/lib/services/tournament-state.ts`                                   | 22-56     | `isRunning(t)` / `isInProgress(t)` 純関数。Wake Lock の取得 gate に使う |
| P1 (important) | `src/lib/errors.ts`                                                      | 1-58      | `AppError.from` / `unwrapOrFrom` / `getErrorCode`。新 hook の rejection は AppError でラップ + logger.warn |
| P1 (important) | `src/lib/hooks/useFullscreen.test.tsx`                                   | 1-122     | 新 hook の test 雛形（`Object.defineProperty` による navigator API stub / `vi.spyOn(logger, "warn")` パターン） |
| P1 (important) | `src/lib/hooks/useImplicitAudioUnlock.test.tsx`                          | 1-61      | resume 失敗時に warn のみで throw しない方針の test 例 |
| P2 (reference) | `src/components/share/_share-button/use-can-share-image.ts`              | 1-40      | `typeof navigator === "undefined"` ガード + `vi.stubGlobal("navigator", ...)` の SSR / test 安全パターン |
| P2 (reference) | `src/lib/hooks/useTournamentTimer.ts`                                    | 65-96     | `visibilitychange` 購読パターン（document 未定義ガード / cleanup） |
| P2 (reference) | `.claude/rules/error-logging.md`                                         | all       | `console.*` 直呼び禁止 / AppError ラップ / domain code prefix（本 Phase は新ドメイン `device/*` を導入） |
| P2 (reference) | `.claude/rules/testing.md`                                               | 30-90     | mock 境界 / SSR / fixture factory（unit test の skip 禁止 / characterization first） |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Screen Wake Lock API | MDN `navigator.wakeLock.request("screen")` | 戻り値 `WakeLockSentinel`。`.release()` で解放、`.released` で状態確認、`.addEventListener("release", ...)` で外部解放を検知 |
| Wake Lock visibility 再取得 | MDN: ページ非表示で OS が自動 release | `visibilitychange` で `document.visibilityState === "visible"` のとき re-acquire が必須 |
| Wake Lock 失敗 | DOMException (NotAllowedError 等) | 必ず try/catch。permission policy / battery / OS lock screen 起因で reject される |
| Screen Orientation Lock | `screen.orientation.lock("landscape")` | **PWA standalone でのみ動作**（ブラウザタブでは NotSupportedError）。iOS Safari は完全非対応 |
| 標準 lib.dom.d.ts | TypeScript 5.x | `WakeLockSentinel` / `ScreenOrientation.lock` は標準型に含まれる（tsconfig `lib: ["dom", "dom.iterable", "esnext"]` で OK） |
| AudioContext autoplay | Chrome / Firefox: 任意 user gesture で resume 可 / Safari: 同 event loop 内で resume が必須 | `await resumeAudioContext()` を click handler の **同期パスの先頭**に置く（async 関数の最初の await として OK） |

```
KEY_INSIGHT: navigator.wakeLock.request("screen") は Promise<WakeLockSentinel> を返す。
  release は sentinel.release() で行う。OS / visibility / 永続性ポリシーに依存して
  暗黙 release されるので、復帰用の visibilitychange ハンドラ必須。
APPLIES_TO: Task 1 (useWakeLock hook 実装)
GOTCHA: SSR では `navigator` が未定義。`if (typeof navigator === "undefined") return;`
  必須。また `wakeLock` プロパティ自体が古い環境にないため `if ("wakeLock" in navigator)`
  feature detection も必要

KEY_INSIGHT: screen.orientation.lock("landscape") は PWA standalone でしか動作しない。
APPLIES_TO: Task 2 (useOrientationLock hook)
GOTCHA: iOS Safari は完全非対応で常に reject。display-mode media query で standalone を
  feature detect してから lock を試行。失敗は warn のみで UI 影響ゼロ

KEY_INSIGHT: AudioContext.resume は user gesture と同 event loop で sync 呼出が原則。
  ただし Chrome / Firefox は click handler 内の最初の await までは「同 gesture」と
  みなすので `await resumeAudioContext()` を click handler の先頭に置けば OK。
APPLIES_TO: Task 3 (TimerControlsSeating / RunningPaused の onClick 改修)
GOTCHA: Safari iOS は厳しめ。失敗時は既存 SoundUnlockBanner / SoundToggleButton で
  fallback できる現状を維持
```

---

## Patterns to Mirror

コードベースで既に確立されているパターン。新規 hook はこれらを忠実に踏襲する。

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/hooks/useFullscreen.ts:25
export function useFullscreen(): UseFullscreenState { ... }

// 新規 hook も同パターン:
//   - file 名: src/lib/hooks/useWakeLock.ts / useOrientationLock.ts
//   - export 名: useWakeLock / useOrientationLock
//   - 戻り値型: UseWakeLockState / UseOrientationLockState（同 file 内 interface）
```

### SSR_GUARD

```ts
// SOURCE: src/lib/hooks/useFullscreen.ts:28-29
useEffect(() => {
  if (typeof document === "undefined") return;
  // ...

// SOURCE: src/components/share/_share-button/use-can-share-image.ts:21
if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") {
  setState(false);
  return;
}
```

### FEATURE_DETECTION

```ts
// SOURCE: src/lib/audio/audio-context.ts:34-38
const Ctor =
  window.AudioContext ??
  (window as unknown as { webkitAudioContext?: typeof AudioContext })
    .webkitAudioContext;
if (!Ctor) return null;

// 新規 hook では:
//   if (!("wakeLock" in navigator)) { setSupported(false); return; }
//   if (!screen.orientation || typeof screen.orientation.lock !== "function") return;
```

### ERROR_HANDLING (browser API rejection)

```ts
// SOURCE: src/lib/hooks/useFullscreen.ts:55-58
} catch (e) {
  const wrapped = AppError.from(e, "ui/fullscreen-failed", "全画面化に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code });
}

// SOURCE: src/lib/hooks/useImplicitAudioUnlock.ts:24-30
void resumeAudioContext().catch((e) => {
  const wrapped = AppError.from(
    e,
    "audio/implicit-unlock-failed",
    "暗黙 audio unlock に失敗",
  );
  logger.warn(wrapped.message, { code: wrapped.code });
});

// 新規 hook も同形。domain code は本 Phase で新規 prefix `device/*` を導入:
//   "device/wake-lock-failed", "device/orientation-lock-failed", "device/wake-lock-release-failed"
```

### EVENT_SUBSCRIPTION_CLEANUP

```ts
// SOURCE: src/lib/hooks/useFullscreen.ts:38-44
document.addEventListener("fullscreenchange", handler);
document.addEventListener("webkitfullscreenchange", handler);
return () => {
  document.removeEventListener("fullscreenchange", handler);
  document.removeEventListener("webkitfullscreenchange", handler);
};

// SOURCE: src/lib/hooks/useTournamentTimer.ts:87-94
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", onVisibilityChange);
}
return () => {
  // ...
  if (typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", onVisibilityChange);
  }
};
```

### CLICK_HANDLER_AWAIT_BEFORE_WORK

```ts
// SOURCE: src/lib/hooks/useAudioPlayer.ts:132-143 (preview)
const preview = useCallback(
  async (soundId: string) => {
    if (!unlocked) {
      await unlock();
    }
    if (!isOrganizer || !enabled) return;
    await playInternal(soundId);
  },
  [unlock, unlocked, isOrganizer, enabled, playInternal],
);

// 新規パターン: TimerControls の「開始」「再開」 onClick で同様の await unlock を
//   先頭に置く。失敗は既存 SoundUnlockBanner を残しているため throw しない
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/hooks/useFullscreen.test.tsx:18-30
beforeEach(() => {
  // browser API を Object.defineProperty で stub
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreenMock,
  });
});

// SOURCE: src/components/share/_share-button/use-can-share-image.test.ts:8-18
afterEach(() => {
  vi.unstubAllGlobals();
  if (globalThis.navigator !== realNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
      writable: true,
    });
  }
});

// 新規 test:
//   - navigator.wakeLock を vi.stubGlobal で navigator object 全体を上書き
//   - request をモックして WakeLockSentinel like ({ release: vi.fn(), released: false,
//     addEventListener: vi.fn() }) を返す
```

### LOGGER_USAGE

```ts
// SOURCE: src/lib/hooks/useImplicitAudioUnlock.ts:30
logger.warn(wrapped.message, { code: wrapped.code });

// console.* 直呼びは error-logging.md で禁止。logger 経由のみ。
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/lib/hooks/useWakeLock.ts` | CREATE | Wake Lock 取得 / visibility 再取得 / unmount release を集約する hook |
| `src/lib/hooks/useWakeLock.test.tsx` | CREATE | navigator.wakeLock を stub し、active=true / visibility 再取得 / 未対応 / reject 警告 / unmount release を unit で characterize |
| `src/lib/hooks/useOrientationLock.ts` | CREATE | screen.orientation.lock を PWA standalone 限定で試行する hook |
| `src/lib/hooks/useOrientationLock.test.tsx` | CREATE | screen.orientation を stub し、standalone=true で lock 呼出 / standalone=false で no-op / lock reject の warn を characterize |
| `src/components/tournament/DeviceFallbackHints.tsx` | CREATE | Wake Lock 未対応端末向けのテキスト案内コンポーネント（dashboard 上の running 中に表示） |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | 新 hook を mount。`isRunning(data)` の間だけ Wake Lock active。Orientation lock は dashboard mount 時に試行 |
| `src/components/tournament/_timer-controls/TimerControlsSeating.tsx` | UPDATE | 「トーナメント開始」`onClick` で `await resumeAudioContext()` を先頭に挿入 |
| `src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx` | UPDATE | 「再開」`onClick` で同様に `await resumeAudioContext()` を先頭に挿入 |

> 既存ファイルへの import 追加は最小限（新 hook の import × 2 / `resumeAudioContext` の import × 2）。

## NOT Building

- **`/live` への Wake Lock 適用** — 参加者端末は会場プロジェクタではないため不要。`/tournaments/[tid]` dashboard のみ
- **Wake Lock の paused 中も保持** — paused 状態は「ブラインド進行が止まっている」ため、画面消灯を許す（OS 標準挙動）。`isRunning(data)` のみで取得
- **Orientation Lock の解除 UI** — ユーザー側 unlock ボタンは追加しない（PRD `What We're NOT Building` の「`display: "fullscreen"` 対応外」と整合）
- **Battery Status API による省電力モード判定** — 本 Phase の体感とは無関係
- **`resumeAudioContext` 失敗時の追加 UI** — 既存 `SoundUnlockBanner` / `SoundToggleButton` が UI 上の fallback として既に常設されている
- **Wake Lock の周期的 keepalive ロジック** — `release` event listener で再取得すれば十分。setInterval ベースの heartbeat は不要
- **Phase A の依存関係** — Phase A (PWA Foundation) と並列実行可能（PRD Implementation Phases / Parallelism Notes 参照）
- **Phase B の `advanceLevel(auto)` fallback** — これは Phase B のスコープ。Phase C は触らない
- **AudioContext unlock を hook 化** — TimerControls の onClick で 1 行 `await resumeAudioContext()` を入れるだけで足りるため、新規 hook 抽出はしない（既存 `useImplicitAudioUnlock` を補助で残しつつ click 経路を二重化する設計）

---

## Step-by-Step Tasks

### Task 1: `useWakeLock` hook を作成

- **ACTION**: `src/lib/hooks/useWakeLock.ts` を新規作成
- **IMPLEMENT**:
  - shape: `useWakeLock(active: boolean): { supported: boolean; held: boolean; lastError: AppError | null }`
  - `active=true` のとき `navigator.wakeLock.request("screen")` を取得し ref に保持。`active=false` または unmount 時に `sentinel.release()` を呼ぶ
  - `visibilitychange` で `visibilityState === "visible"` かつ active=true のとき再取得
  - sentinel の `release` event listener を登録し、外部 release を検出して `held=false` に切替
  - 失敗時: `AppError.from(e, "device/wake-lock-failed", "画面消灯防止に失敗しました")` でラップして `logger.warn`、`lastError` state に保持（throw しない）
  - SSR ガード: `if (typeof navigator === "undefined") return;` + `if (!("wakeLock" in navigator)) { setSupported(false); return; }`
- **MIRROR**: NAMING_CONVENTION / SSR_GUARD / FEATURE_DETECTION / ERROR_HANDLING / EVENT_SUBSCRIPTION_CLEANUP（useFullscreen.ts と useTournamentTimer.ts のパターンを混在）
- **IMPORTS**:
  ```ts
  import { useCallback, useEffect, useRef, useState } from "react";
  import { AppError } from "@/lib/errors";
  import { logger } from "@/lib/logger";
  ```
- **GOTCHA**:
  - `WakeLockSentinel` 型は `lib.dom.d.ts` 標準にある（tsconfig.json の `lib: ["dom", ...]` で OK）。独自型定義は不要
  - 同時に `request("screen")` を 2 回呼ぶと race するため `inflight ref` で in-progress 判定して二重呼出を防ぐ
  - `release()` は失敗を返さない（`Promise<void>`）が、念のため `.catch` で warn を残す
  - hook が unmount される前に `active` が `true→false` に変わったケースで release が漏れないよう、`useEffect` の cleanup で常に release する
- **VALIDATE**:
  - `npm run typecheck` が green
  - `npm run test -- useWakeLock` が green
  - 手動: dashboard を `state="running"` で開いて DevTools Application > Storage > Wake Lock 状態を確認

### Task 2: `useWakeLock` の unit test を追加

- **ACTION**: `src/lib/hooks/useWakeLock.test.tsx` を新規作成
- **IMPLEMENT**:
  - test 1: `navigator.wakeLock` 未定義 → `supported=false` / `held=false` で何も起きない
  - test 2: `active=true` で mount → `navigator.wakeLock.request("screen")` が 1 回呼ばれ、`held=true`
  - test 3: `active=true → false` rerender → `sentinel.release` が 1 回呼ばれ、`held=false`
  - test 4: `visibilitychange` で `visibilityState="hidden"` → release 動作 / `visible` 復帰で再 request
  - test 5: `request` reject → `logger.warn` が `code: "device/wake-lock-failed"` で呼ばれ、`held=false`、throw しない
  - test 6: unmount → release が 1 回（active=true mount 中の状態から）
- **MIRROR**: useFullscreen.test.tsx の `Object.defineProperty(document, ...)` パターンを navigator に対して適用。`vi.stubGlobal("navigator", { ...realNavigator, wakeLock: ... })`
- **IMPORTS**:
  ```ts
  import { renderHook, act } from "@testing-library/react";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { logger } from "@/lib/logger";
  import { useWakeLock } from "./useWakeLock";
  ```
- **GOTCHA**:
  - `WakeLockSentinel` を mock する: `{ release: vi.fn().mockResolvedValue(undefined), released: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }`
  - `vi.stubGlobal` で navigator を上書きし、afterEach で `vi.unstubAllGlobals()` + 元 navigator 復元（use-can-share-image.test.ts のパターンを踏襲）
  - test で `document.dispatchEvent(new Event("visibilitychange"))` を発火する場合、`Object.defineProperty(document, "visibilityState", { get: () => "visible" })` で値を切替
  - `console.*` 直呼びは禁止（error-logging.md）。test 内の logger は `vi.spyOn(logger, "warn").mockImplementation(() => {})` で抑制
- **VALIDATE**:
  - `npm run test -- useWakeLock` で 6 件全 pass
  - test の skip 禁止（testing.md）

### Task 3: `useOrientationLock` hook を作成

- **ACTION**: `src/lib/hooks/useOrientationLock.ts` を新規作成
- **IMPLEMENT**:
  - shape: `useOrientationLock(target: "landscape" | "portrait"): { supported: boolean; locked: boolean }`
  - mount 時のみ試行（再 lock は不要）。SSR ガード: `if (typeof window === "undefined") return;`
  - feature detection: `if (typeof window.matchMedia !== "function") return;` + `const standalone = window.matchMedia("(display-mode: standalone)").matches;` + `if (!standalone) return;` + `if (!screen.orientation || typeof screen.orientation.lock !== "function") return;`
  - lock 試行: `await screen.orientation.lock(target);` 成功で `locked=true`
  - 失敗時: `AppError.from(e, "device/orientation-lock-failed", "横向き固定に失敗しました")` で warn ラップ（NotSupportedError / SecurityError 等を全て同一処理）、throw しない
- **MIRROR**: NAMING_CONVENTION / SSR_GUARD / FEATURE_DETECTION / ERROR_HANDLING（useFullscreen.ts のパターン）
- **IMPORTS**:
  ```ts
  import { useEffect, useState } from "react";
  import { AppError } from "@/lib/errors";
  import { logger } from "@/lib/logger";
  ```
- **GOTCHA**:
  - `screen.orientation.lock` の戻り値は `Promise<void>` だが古い型定義では `unknown` の場合があるため、try/catch で wrapping
  - iOS Safari では `screen.orientation` 自体は存在するが `lock` メソッドが未対応で常に reject。warn が頻発するのを避けるため、最初に `typeof screen.orientation.lock !== "function"` を check して early return
  - PWA でない通常タブでも実行されるが、`(display-mode: standalone).matches === false` で確実に early return することで SecurityError ログ汚染を防ぐ
- **VALIDATE**:
  - `npm run typecheck` が green（`screen.orientation.lock` が型エラーなく通ること）
  - `npm run test -- useOrientationLock` が green
  - 手動: PWA standalone で開いてランドスケープ固定確認、ブラウザタブで開いて no-op 確認

### Task 4: `useOrientationLock` の unit test を追加

- **ACTION**: `src/lib/hooks/useOrientationLock.test.tsx` を新規作成
- **IMPLEMENT**:
  - test 1: `matchMedia("(display-mode: standalone)")=false` → `lock` 呼ばれない / `locked=false` / `supported=false`
  - test 2: `screen.orientation.lock` undefined → 同上 (`supported=false`)
  - test 3: standalone=true + lock 成功 → `locked=true` / `lock` が `"landscape"` で 1 回呼ばれる
  - test 4: standalone=true + lock reject → `logger.warn` が `code: "device/orientation-lock-failed"` で呼ばれ、`locked=false`、throw しない
- **MIRROR**: useFullscreen.test.tsx の `Object.defineProperty(window, "matchMedia", ...)` パターン。screen は `Object.defineProperty(window, "screen", { value: { orientation: { lock: ... }}})` で stub
- **GOTCHA**:
  - `window.matchMedia` を stub: `Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: true, ... }) })`
  - test 終了で `Object.defineProperty(window, "screen", { value: realScreen })` で復元
- **VALIDATE**: `npm run test -- useOrientationLock` で 4 件全 pass

### Task 5: `DeviceFallbackHints` コンポーネントを作成

- **ACTION**: `src/components/tournament/DeviceFallbackHints.tsx` を新規作成
- **IMPLEMENT**:
  - props: `{ wakeLockSupported: boolean }`
  - `wakeLockSupported === false` のときのみ「省電力のため画面が消えないよう設定してください」のテキストカードを表示
  - スタイルは `SoundUnlockBanner` の amber 系 banner と同形（`rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm`）
  - `aria-label="device-fallback-hint"` / `role` は省略（操作要求でないため region 級）
  - **CLAUDE.md 規約遵守**: ユーザー向けメッセージに「Wake Lock API」「ブラウザ非対応」等の技術スタック名を出さない（`feedback_no_tech_stack_in_user_messages.md` に従う）
- **MIRROR**: `src/components/audio/SoundUnlockBanner.tsx` の amber banner レイアウト
- **IMPORTS**:
  ```ts
  import { Lightbulb } from "lucide-react";
  ```
- **GOTCHA**: PWA 規約として、ユーザーに直接「OS 設定を変更してください」と依頼するため、message は丁寧かつ簡潔に（「画面が消えないよう」は曖昧だが技術用語を避けた表現）
- **VALIDATE**: `npm run lint` / `npm run typecheck`、手動で `wakeLockSupported=false` で render してメッセージ確認

### Task 6: `dashboard-client.tsx` に Wake Lock / Orientation Lock を統合

- **ACTION**: `src/app/tournaments/[tid]/dashboard-client.tsx` を update
- **IMPLEMENT**:
  - import 追加: `useWakeLock` / `useOrientationLock` / `DeviceFallbackHints`
  - `useFullscreen()` の隣で hook 呼出を追加:
    ```ts
    // Phase C: 会場プロジェクタ投影中の画面消灯防止 / 横向き固定。
    // running の間だけ Wake Lock を取得（paused / setup / seating / finished では release）。
    const wakeLock = useWakeLock(data?.state === "running");
    useOrientationLock("landscape");
    ```
  - `<TimerControls>` 直下に `running` 状態時のみ `<DeviceFallbackHints wakeLockSupported={wakeLock.supported} />` を追加（fallback hint は member には不要だが運営者と member の両方が dashboard を見る場合があるため、`isRunning(data)` を gate に使う / dashboard は organizer のみ閲覧可能で既に redirect されているため特に role gate 不要）
  - hook 呼出位置は **早期 return より前**（`useAudioPlayer` / `useGroupRole` と同じ規律で hook 呼出順を一定に保つ）
- **MIRROR**: dashboard-client.tsx 既存の hook 構造（line 97 useFullscreen / line 142 useAutoFinish / line 167 useAudioPlayer の並び）
- **IMPORTS**:
  ```ts
  import { useWakeLock } from "@/lib/hooks/useWakeLock";
  import { useOrientationLock } from "@/lib/hooks/useOrientationLock";
  import { DeviceFallbackHints } from "@/components/tournament/DeviceFallbackHints";
  ```
- **GOTCHA**:
  - `data` が null（読込中）のとき `data?.state === "running"` は false なので Wake Lock は取得されず安全
  - hook 呼出順を変えない — `usePageTitle(data?.name ?? null)` の直後、`useFullscreen()` の前後など現在の順序を尊重
  - `useOrientationLock` は引数 `"landscape"` 固定で OK（縦向き運用は想定外）
- **VALIDATE**:
  - `npm run typecheck` / `npm run lint` green
  - `npm run dev` で `/tournaments/[tid]` を running 中に表示し、画面消灯しないことを目視確認
  - 手動: PWA standalone で landscape lock を確認

### Task 7: `TimerControlsSeating` の「トーナメント開始」onClick で AudioContext unlock を await

- **ACTION**: `src/components/tournament/_timer-controls/TimerControlsSeating.tsx` を update
- **IMPLEMENT**:
  - import 追加: `import { resumeAudioContext } from "@/lib/audio/audio-context";`
  - `<Button>` の onClick handler を以下に書き換え:
    ```ts
    onClick={() => {
      void run(
        "confirm-seating",
        async () => {
          // Phase C: 開始ボタン押下と同 user gesture 内で AudioContext を resume する
          // ことで、autoplay policy 起因で開始直後のブラインドアップ音が鳴らない事象を回避。
          // 失敗は warn のみ（既存 SoundUnlockBanner / SoundToggleButton で fallback）。
          await resumeAudioContext().catch(() => {/* warn は audio-context 側 / fallback あり */});
          await confirmSeating(tid, uid, userGroupIds);
        },
        "トーナメント開始失敗",
      );
    }}
    ```
  - 「席を再決定」ボタンには適用しない（音を鳴らさない経路のため）
- **MIRROR**: CLICK_HANDLER_AWAIT_BEFORE_WORK パターン（useAudioPlayer.ts:132-143 preview の構造）
- **IMPORTS**: `import { resumeAudioContext } from "@/lib/audio/audio-context";`
- **GOTCHA**:
  - `resumeAudioContext` 内の rejection は audio-context.ts でキャッチされず resolve（state 値を返す）するため、本来 try/catch 不要だが、念のため `.catch(() => {})` でガード
  - `void run(...)` のシグネチャは保ったまま、async callback を渡す形に変更（既存型 `RunOp` に async 関数渡せる）
- **VALIDATE**:
  - `npm run typecheck` / `npm run lint` green
  - `npm run test -- TimerControls` 既存テストが pass（または影響なし確認）
  - 手動: setup → 「トーナメント開始」押下 → 次レベル auto-advance で音が鳴ることを確認

### Task 8: `TimerControlsRunningPaused` の「再開」onClick で AudioContext unlock を await

- **ACTION**: `src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx` を update
- **IMPLEMENT**:
  - import 追加: `import { resumeAudioContext } from "@/lib/audio/audio-context";`
  - `Play` アイコンの「再開」ボタン onClick を以下に書き換え:
    ```ts
    onClick={() =>
      void run(
        "resume",
        async () => {
          await resumeAudioContext().catch(() => {});
          await resumeTournament(tid, uid, userGroupIds);
        },
        "再開失敗",
      )
    }
    ```
  - 「pause」「revert」「advance」「finish」には適用しない（音は副作用として「鳴ったまま」の状態であり、unlock 動機が低い）
- **MIRROR**: Task 7 と同形
- **IMPORTS**: `import { resumeAudioContext } from "@/lib/audio/audio-context";`
- **GOTCHA**: 既存の paused → running 遷移は `lastLevelChangeKind` を "manual" にしないため、既存の useAudioPlayer 内 effect は副作用として鳴ることはない。本変更は **次回の auto-advance で音が鳴る経路**を保証するだけ
- **VALIDATE**:
  - `npm run typecheck` / `npm run lint` green
  - 手動: paused 状態で「再開」押下 → 次レベル auto-advance で音が鳴ることを確認

### Task 9: characterization test を整備（既存テストの green 確認）

- **ACTION**: 既存 test の skip / regression を防ぐ
- **IMPLEMENT**:
  - `npm run test -- TimerControls` が green
  - `npm run test -- useAudioPlayer` が green
  - `npm run test -- useFullscreen` が green
  - `npm run test -- useImplicitAudioUnlock` が green
- **MIRROR**: testing.md「テスト skip / disable / 削除禁止」
- **GOTCHA**: TimerControlsSeating / TimerControlsRunningPaused の onClick を async 化したので、既存 test の `expect(confirmSeating).toHaveBeenCalled()` が `await` 必要に変わる場合あり。既存テストが破綻したら helper 境界の assertion に書き換える（testing.md「mock の境界」原則）
- **VALIDATE**: `npm run test` 全件 green

### Task 10: 全体検証

- **ACTION**: 通常の Phase 完了 validation を実行
- **IMPLEMENT**:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run test`
  - `npm run build`
  - DevTools 手動確認: dashboard を running 状態で開き Application > Wake Lock active 確認
- **MIRROR**: PRD 02 / Phase E 完了プロセスを踏襲
- **GOTCHA**: Wake Lock は HTTPS or localhost でしか動作しない。`npm run dev` (localhost:3000) は OK、Vercel preview もOK
- **VALIDATE**: 上記 4 コマンドが全て green。手動確認チェックリスト（後述）も全て pass

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| useWakeLock — wakeLock 未定義 | `navigator.wakeLock = undefined` | `supported=false / held=false` 何も呼ばれない | ○ |
| useWakeLock — active=true で取得 | active=true、wakeLock.request resolves | `held=true`、request が 1 回呼ばれる | × |
| useWakeLock — active false に切替で release | active=true → false rerender | sentinel.release が 1 回呼ばれる、`held=false` | × |
| useWakeLock — visibility hidden で release / visible で再取得 | visibility 切替 event | hidden で release、visible で再 request | ○ |
| useWakeLock — request reject で warn のみ | request rejects with NotAllowedError | `logger.warn(_, { code: "device/wake-lock-failed" })`、throw しない | ○ |
| useWakeLock — unmount で release | active=true mount → unmount | sentinel.release が 1 回 | ○ |
| useOrientationLock — standalone=false で no-op | matchMedia returns matches=false | `screen.orientation.lock` 呼ばれない、`locked=false`、`supported=false` | ○ |
| useOrientationLock — lock 関数なしで no-op | screen.orientation.lock undefined | 同上 | ○ |
| useOrientationLock — standalone=true で lock 成功 | matchMedia=true、lock resolves | `lock("landscape")` が 1 回、`locked=true` | × |
| useOrientationLock — lock reject で warn | lock rejects with NotSupportedError | `logger.warn(_, { code: "device/orientation-lock-failed" })`、throw しない | ○ |

### Edge Cases Checklist

- [x] SSR（`typeof navigator === "undefined"` / `typeof document === "undefined"` / `typeof window === "undefined"`）
- [x] Wake Lock API 完全未対応（iOS Safari < 16.4）
- [x] Wake Lock 取得後に OS が暗黙 release（`release` event listener で検出）
- [x] visibility hidden → visible での再取得
- [x] orientation.lock が PWA standalone でないタブで呼ばれた場合（NotSupportedError → warn のみ）
- [x] AudioContext.resume の rejection（`useAudioPlayer.preview` の既存 fallback と同じ）
- [x] hook unmount 時に sentinel が release 漏れないこと
- [x] `data` が null（読込中）で Wake Lock が取得されないこと

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

### Lint

```bash
npm run lint
```

EXPECT: 0 lint errors / 0 warnings on touched files

### Unit Tests

```bash
npm run test -- useWakeLock useOrientationLock
```

EXPECT: All 10+ tests pass

### Full Test Suite

```bash
npm run test
```

EXPECT: 既存テスト全件 pass、回帰なし

### Build

```bash
npm run build
```

EXPECT: build success（type error / SSR build エラーなし）

### Browser Validation (manual, dev server)

```bash
npm run dev
```

EXPECT:
- `/tournaments/[tid]` を `state="running"` で開いて 5 分以上画面が消えない（Wake Lock acquired）
- DevTools Application タブで Wake Lock active を確認
- iOS / Android で PWA インストール後に landscape 固定確認
- Chrome DevTools で `state="running"` → tab 非表示 → 表示復帰で再取得確認

### Manual Validation

- [ ] dashboard を `state="setup"` で開く → Wake Lock 取得**されない**ことを DevTools で確認
- [ ] dashboard を `state="running"` で開く → Wake Lock 取得確認 / 5 分放置で画面消灯しない
- [ ] dashboard `state="paused"` 切替 → Wake Lock release 確認
- [ ] dashboard `state="finished"` 遷移 → Wake Lock release 確認
- [ ] tab 非表示 → 表示復帰で再 Wake Lock 取得確認
- [ ] Wake Lock 未対応 UA（iOS Safari simulator / `navigator.wakeLock = undefined` 注入）で `<DeviceFallbackHints>` 表示確認 + メッセージに技術用語が露出していないこと
- [ ] PWA standalone（Phase A 完了後）で `/tournaments/[tid]` を開き `screen.orientation.angle === 90 || === -90` を確認
- [ ] ブラウザタブ（非 standalone）で開き orientation.lock が呼ばれないこと（DevTools console に warn が出ないこと）
- [ ] setup → 「トーナメント開始」押下 → 次レベル auto-advance で blind-up 音が鳴る
- [ ] paused → 「再開」押下 → 次レベル auto-advance で blind-up 音が鳴る
- [ ] AudioContext.resume が reject される環境（音声権限拒否）でも開始ボタン経路自体は break しない

---

## Acceptance Criteria

- [ ] すべての Step-by-Step Tasks が完了
- [ ] 全 validation コマンド（typecheck / lint / test / build）が green
- [ ] unit test が新規 hook の Edge Cases Checklist を網羅
- [ ] dashboard `state="running"` で Wake Lock 取得され、画面消灯しない
- [ ] PWA standalone で landscape 固定が動作（Phase A 完了後の検証）
- [ ] 「トーナメント開始」「再開」押下後の auto-advance で音が鳴る
- [ ] 未対応端末で `<DeviceFallbackHints>` がテキスト案内を表示
- [ ] `console.*` 直呼び / `throw new Error` / 手書き型ガードがない（error-logging.md 規約）
- [ ] ユーザー向けメッセージに技術スタック名が出ない（feedback_no_tech_stack_in_user_messages.md）

## Completion Checklist

- [ ] コードが既存パターン（NAMING / SSR_GUARD / FEATURE_DETECTION / ERROR_HANDLING / EVENT_SUBSCRIPTION_CLEANUP）に忠実
- [ ] エラーは `AppError.from(e, "device/...", 日本語)` でラップし `logger.warn` のみ
- [ ] ログ出力は `logger.warn` 経由（console.* 禁止）
- [ ] テストが mock 境界（hook 自体の契約）で書かれている（深い call chain assert なし）
- [ ] hardcoded value なし（target orientation の `"landscape"` は dashboard-client.tsx の引数として 1 か所）
- [ ] 不要 scope 追加なし（`/live` / `paused` 中の Wake Lock / battery API は扱わない）
- [ ] PRD の Open Question「iOS Safari Wake Lock 対応状況」は実装後に DevTools 手動確認で確定
- [ ] 自己完結 — 実装中に追加調査が必要ない

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| iOS Safari の Wake Lock 対応バージョン分布が低く、fallback テキスト案内が頻発 | M | M（UX 的に煩わしい） | `<DeviceFallbackHints>` を `running` 中のみ表示し、closeable にする選択肢は Phase D で再検討。現状は常駐表示でも軽量 |
| `screen.orientation.lock` の reject ログが頻発（PWA standalone でない大半のケース） | M | L | feature detection で `(display-mode: standalone).matches=false` のとき lock 自体呼ばない（Task 3 GOTCHA に明記） |
| `await resumeAudioContext()` を click handler の async 関数の最初に置いても、Safari で同 user gesture 認定が外れる | L | L | 既存 `SoundUnlockBanner` / `useImplicitAudioUnlock` が pointerdown で fallback unlock するため致命的影響なし |
| Wake Lock sentinel.release が unmount race で漏れて永続的に画面消灯しない | L | M | useEffect cleanup で常に release 実行、test ケース 6 で characterize |
| dashboard 早期 return より前の hook 呼出順を変えてしまい React の hook 順違反 | L | H（runtime crash） | Task 6 で「`usePageTitle` の直後、早期 return より前」を明記。code review で hook 順をチェック |

## Notes

- Phase A（PWA Foundation）と完全に並列実行可能（PRD「Parallelism Notes」）。Phase A 未完了でも Wake Lock / AudioContext unlock 強化は単独で価値がある（ブラウザタブでも有効）
- Orientation lock のみ Phase A の standalone display 完了後にユーザー検証可能。Phase A と同時に検証すると効率的
- 本 Phase は PRD の Open Question 5「iOS Safari Wake Lock API の対応状況」を実装で確定する
- `device/*` は本 PRD で初導入の AppError code prefix。`error-logging.md` の prefix 一覧（`firestore/*` / `auth/*` / `tournament/*` / `validation/*` / `seating/*` / `group/*` / `season/*`）に **`device/*` を追記**することを Phase D 完了時に検討（本 Phase ではコード上の usage のみで rule 文書は触らない設計）
- 開発思想ステップ 2「要件を満たすテストケースを充実させる」を踏まえ、本 Phase は新 hook × 2 + 既存 onClick 改修について characterization test を 10 件以上投入する
