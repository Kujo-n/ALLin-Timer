# Plan: Phase D — Install Promotion & Polish

## Summary

Phase A〜C で整えた PWA 基盤・オフライン耐性・端末制御の最後の仕上げとして、**トップ画面 `/` のみに集約した PWA インストール促進 UI**（Android Chrome 系の `beforeinstallprompt` 受信 + iOS UA 判定の hint）と、Phase A レビューで M2 / M3 / S-M1 / S-M2 として残された **Service Worker cache の運用ハードニング**（runtime cache の path allowlist 化 + 簡易 LRU eviction）を実装する。インストール促進は **role gating を持たず全ユーザーに表示**するが mount 点をトップ画面のみに限定することで、会場 dashboard / live 中に促進バナーが邪魔をする事故を排除する。dismiss は `localStorage` に 30 日永続化。本 Phase 完了で PRD 03 のスコープを完了させ、観測フェーズ（運営者ヒアリング / 開発者サークル参加時の目視確認）に入る。

## User Story

As a サークル運営者または訪問者,
I want トップ画面 (`/`) を開いたとき、Android では「ホーム画面に追加」を 1 タップで実行できるカスタムバナー、iOS では「共有 → ホーム画面に追加」のテキスト案内が見えてほしい,
So that 「PWA としてインストール可能であること」を最初の入口でだけ知らせて、会場到着時の「ブラウザでお気に入りから探す」摩擦をゼロに倒せる。

And as a 同 PWA を月 1〜2 回しか起動しない運営者,
I want 一度「閉じる」を押したインストールバナーが 30 日は再表示されないでほしい,
So that 月 1 回の利用パターンで「使うたびに毎回 dismiss する」煩わしさが消える。

And as a SW cache に長期蓄積される `/_next/static/*` / 過去 HTML / `/sounds/*` を抱える PWA install ユーザー,
I want runtime cache が自動的に古いエントリを捨て、auth-aware な動的ルートはキャッシュに乗せないでほしい,
So that 長期 PWA install で `QuotaExceededError` で SW が壊れるリスクと、共用端末でユーザー A の HTML がユーザー B に透過する漏えいリスクが消える。

## Problem → Solution

**Current state**:

- 運営者向けインストール促進 UI が**未実装**。Phase A で iOS テキスト案内 (`<IOsInstallHint />`) は配置済みだが、`app/layout.tsx` で全画面に mount されており、会場 dashboard / live でも上端に居座る（[src/app/layout.tsx:81](../../../../src/app/layout.tsx#L81)）。
- Android Chrome 系の `beforeinstallprompt` event は[どこにも capture されておらず](../../../../src/components/pwa)、運営者がカスタムバナーから直接インストールする経路がない（ブラウザ標準 UI 任せ）。
- Service Worker [public/sw.js:73-90](../../../../public/sw.js#L73-L90) は `request.mode === "navigate"` の HTML を **path allowlist なし**で `RUNTIME_CACHE` に格納する（local review M3 / security review S-M1）。
- `RUNTIME_CACHE` は `cache.put` のみで eviction なし（local review M2 / security review S-M2）。`CACHE_VERSION` bump で全消しはできるが、PWA install 中の長期利用で quota error の温床。
- Phase A レビューで上記 3 点（M2 / M3 / S-M1 / S-M2）を Phase D 範疇として明示的に積み残し、本 Phase の Goal に [PRD の Phase D Scope](../prds/03-pwa-app-shell.prd.md#L235-L239) として記載済み。

**Desired state**:

- `<PwaInstallPromotion />` がトップ画面 (`src/app/page.tsx`) にのみ mount され、以下を担う:
  - **role gating なし** — 認証済 / 匿名 / 未ログインのいずれでも表示候補。member ロールの参加者が見えても「dismiss するだけ」とコスト低（PRD Decisions Log の方針見直し参照）。
  - Android Chrome 系: `beforeinstallprompt` event を capture して preventDefault → state に保持。「ホーム画面に追加」ボタン onClick で `prompt()` 起動 → `userChoice` を待って banner dismiss。
  - dismiss は `localStorage["allinpt.pwaInstallDismissedAt"]` に ms epoch を書き、30 日以内なら再表示しない。`appinstalled` event 受信時は同じく書込（永続 hide）。
- `<IOsInstallHint />` も同じく **トップ画面に移動**し、layout からは除去:
  - mount 点を `app/layout.tsx` → `src/app/page.tsx` に移し、`/groups/...` / `/tournaments/...` 等では出さない。
  - 「今は閉じる」ボタンを追加し、`PwaInstallPromotion` と同じ `localStorage` key で 30 日 dismiss 永続化。
  - Phase A コメントの TODO（"Phase D: useGroupRole で role !== "member" のときのみ表示する gating を追加"）は **role gating を導入せず削除**して、新しい設計判断（mount 点限定で十分）をコメントで明記。
- Service Worker:
  - **path allowlist**: `request.mode === "navigate"` の HTML のうち、`/`・`/login` 等の auth-free / user-agnostic な path のみ `cache.put` する。`/groups/**` / `/tournaments/**` / `/settings`・`/account` 等の auth-aware な path は `networkFirst` の応答を返すが cache に書き込まない（fetch のみ・cache miss 時の fallback も `/` shell を返す既存挙動を維持）。
  - **簡易 LRU eviction**: `RUNTIME_CACHE` の entry 数上限を導入（`MAX_RUNTIME_ENTRIES = 50`）。`cache.put` 直後に `cache.keys()` を取得し、超過分の最古エントリを `cache.delete()` で間引く。`SHELL_CACHE` は precache だけで eviction しない。
  - `CACHE_VERSION` を `"v1"` → `"v2"` に bump し、既存 install 端末の旧 cache を activate 時に全消し（新 LRU schema へ整合）。
- 観測フェーズ:
  - 開発者サークル参加時に DevTools の network throttling で auto-advance fallback / install banner / runtime cache eviction の挙動を実機検証
  - 運営者向けに「ホーム画面に追加した」「タイマーが止まらなかった」のヒアリング実施（PRD Success Metrics に対応）
  - PRD Implementation Phases 表で Phase D を `complete` に更新

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md](../prds/03-pwa-app-shell.prd.md)
- **PRD Phase**: Phase D — Install Promotion & Polish
- **Estimated Files**: 約 8 files（新規 component 1 + test / sw.js update / IOsInstallHint dismiss 化 + test 更新 / page.tsx 更新 / layout.tsx 更新 / PRD 表更新 / report 1）

---

## UX Design

### Before（現状）

トップ画面 `/`（owner / organizer / member いずれでも同じ）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  …                          [👤 owner]  │ ← header
├──────────────────────────────────────────────────────────┤
│ ⓘ iOS でホーム画面に追加するには、Safari 下部の          │ ← IOsInstallHint
│   ⤴ 共有ボタン →「ホーム画面に追加」を選択してください │   (layout の全画面 mount)
├──────────────────────────────────────────────────────────┤
│         ALLin-PokerTimer                                 │
│   NLH（ノーリミットテキサスホールデム）…                 │
│   [サークル一覧へ] [トーナメント一覧へ]                   │
└──────────────────────────────────────────────────────────┘
```

`/tournaments/[tid]`（dashboard、運営者）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  [Monthly トーナメント]      [👤 owner] │
├──────────────────────────────────────────────────────────┤
│ ⓘ iOS でホーム画面に追加するには…                         │ ← ⚠ dashboard 上にも居座る
├──────────────────────────────────────────────────────────┤
│ ⚠ 通信が一時切れています — 操作は端末に保存され…         │ ← OfflineBanner（Phase B）
├──────────────────────────────────────────────────────────┤
│ QrPanel / Timer / PlayersCard …                            │
└──────────────────────────────────────────────────────────┘
```

問題:
- iOS hint が **全画面**で表示されており、会場 dashboard / live 中にも上端を占有
- Android Chrome 自前 install prompt は manifest 要件を満たしていても自動で前面表示されないことが多く、運営者は「PWA 化されている」ことを知らずにブラウザ起動を続ける

### After

トップ画面 `/`（Android Chrome、初訪問）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  …                                       │
├──────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐   │
│ │ ⊞ アプリをホーム画面に追加すると会場運用が         │   │ ← PwaInstallPromotion
│ │   1 タップで起動できます                           │   │   (amber 系)
│ │   [ホーム画面に追加]   [今は閉じる]                │   │
│ └────────────────────────────────────────────────────┘   │
│         ALLin-PokerTimer                                 │
│   NLH（ノーリミットテキサスホールデム）…                 │
│   [サークル一覧へ] [トーナメント一覧へ]                   │
└──────────────────────────────────────────────────────────┘
```

トップ画面 `/`（iOS Safari、初訪問）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  …                                       │
├──────────────────────────────────────────────────────────┤
│ ┌────────────────────────────────────────────────────┐   │
│ │ ⓘ iOS でホーム画面に追加するには、Safari 下部の    │   │ ← IOsInstallHint
│ │   ⤴ 共有ボタン →「ホーム画面に追加」を選択して     │   │   (page.tsx に移動)
│ │   ください                          [今は閉じる]   │   │
│ └────────────────────────────────────────────────────┘   │
│         ALLin-PokerTimer                                 │
│   …                                                       │
└──────────────────────────────────────────────────────────┘
```

`/tournaments/[tid]`（dashboard、運営者）:

```
┌──────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer  [Monthly トーナメント]      [👤 owner] │
├──────────────────────────────────────────────────────────┤
│ ⚠ 通信が一時切れています — …                              │ ← OfflineBanner だけ
├──────────────────────────────────────────────────────────┤
│ QrPanel / Timer / PlayersCard …                            │ ← install hint 消失
└──────────────────────────────────────────────────────────┘
```

dismiss 後、30 日以内に再訪問しても install hint / promotion は出ない。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| トップ画面 `/` 訪問（Android Chrome） | install prompt 自動表示は不安定 | `PwaInstallPromotion` カスタムバナー表示。「ホーム画面に追加」で `prompt()` 起動 | `beforeinstallprompt` を capture / preventDefault |
| 同上（iOS Safari） | `IOsInstallHint` を全画面で見せていた | 同 hint は `/` のみ表示。「今は閉じる」で 30 日 dismiss | mount 点を layout → page.tsx に移動 |
| `/groups/[gid]` / `/tournaments/[tid]` 系 | iOS hint が上端に居座る | install 関連 UI 一切非表示 | mount 点限定 |
| 受付参加者の `/join/[tid]` 系 | iOS hint 表示 | 表示なし（mount 点が `/` のみのため） | dismiss 不要 |
| 「今は閉じる」押下（Android） | （UI なし） | 30 日以内は再表示しない | `localStorage["allinpt.pwaInstallDismissedAt"]` |
| 「今は閉じる」押下（iOS hint） | （UI なし） | 同上、両 component で storage key 共有 | 同上 |
| インストール完了（`appinstalled` event） | 自動消滅しない | banner 即時 hide + 永続 dismiss | `appinstalled` 受信で `Date.now()` 記録 |
| `/_next/static/*` の長期蓄積 | 無制限蓄積 | 50 entry 超で最古から間引き | LRU on `cache.put` |
| `/groups/[gid]` HTML の SW cache | runtime cache に格納 | navigate path allowlist で skip | 共用端末漏えいリスク低減 |
| `/login` HTML の SW cache | runtime cache に格納 | runtime cache に格納（auth-free） | allowlist 通過 |

---

## Mandatory Reading

実装着手前に必ず Read すること（記憶頼りで作業すると規約違反 / drift のリスクあり）:

| Priority       | File                                                                                          | Lines        | Why                                                                                                      |
| -------------- | --------------------------------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------- |
| P0 (critical)  | [src/app/page.tsx](../../../../src/app/page.tsx)                                              | all          | トップ画面の現コード。Phase D で `<PwaInstallPromotion />` / `<IOsInstallHint />` を mount する場所       |
| P0 (critical)  | [src/components/pwa/IOsInstallHint.tsx](../../../../src/components/pwa/IOsInstallHint.tsx)    | 1-46         | 既存 install hint。Phase D で dismiss 経路追加 + Phase A の TODO コメント解消                             |
| P0 (critical)  | [src/components/pwa/IOsInstallHint.test.tsx](../../../../src/components/pwa/IOsInstallHint.test.tsx) | all   | matchMedia / userAgent stub の現行パターン。新規 test もこれを雛形にする                                  |
| P0 (critical)  | [public/sw.js](../../../../public/sw.js)                                                       | 60-120       | navigate path 判定 + `networkFirst` / `staleWhileRevalidate`。allowlist 追加と LRU 挿入の改修場所         |
| P0 (critical)  | [src/app/layout.tsx](../../../../src/app/layout.tsx)                                          | 51-91        | 既存 `<IOsInstallHint />` mount 位置。Phase D で **layout から除去**し、page.tsx に移動                    |
| P0 (critical)  | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md)                  | all          | logger 経由のみ / `console.*` 禁止 / `device/*` ドメインに合わせ Phase D は `pwa/install-*` 系を導入する  |
| P0 (critical)  | [.claude/rules/security-base.md](../../../../.claude/rules/security-base.md)                  | all          | 公開リポジトリ運用 / サークル固有情報禁止                                                                 |
| P1 (important) | [.claude/PRPs/03-pwa-app-shell/reviews/local-phase-a-c-pwa-review.md](../reviews/local-phase-a-c-pwa-review.md) | 39-77 | M2 / M3 の正準。本 Phase の SW 改修要件はここから直引きする                                              |
| P1 (important) | [.claude/PRPs/03-pwa-app-shell/reviews/security-review-phase-a-c.md](../reviews/security-review-phase-a-c.md) | 25-65 | S-M1 / S-M2 の正準。allowlist 化と eviction の理由付け / 期待形                                         |
| P1 (important) | [src/components/tournament/OfflineBanner.tsx](../../../../src/components/tournament/OfflineBanner.tsx) | all     | role gating なしの banner の現行コンポーネントパターン（aria / dark mode / amber 系）                    |
| P1 (important) | [src/components/tournament/OfflineBanner.test.tsx](../../../../src/components/tournament/OfflineBanner.test.tsx) | all | 純表示分岐の test 雛形（getByTestId / queryBy で空 / 表示の双方を assert）                                |
| P1 (important) | [src/lib/hooks/useWakeLock.ts](../../../../src/lib/hooks/useWakeLock.ts)                      | 1-50         | feature detection + AppError + logger.warn の hook 雛形（`device/wake-lock-failed`）                     |
| P1 (important) | [src/lib/hooks/useWakeLock.test.tsx](../../../../src/lib/hooks/useWakeLock.test.tsx)          | 1-100        | navigator stub / event simulator の test 雛形                                                             |
| P1 (important) | [src/components/pwa/ServiceWorkerRegistration.tsx](../../../../src/components/pwa/ServiceWorkerRegistration.tsx) | all | `process.env.NODE_ENV === "production"` gate / `AppError.from` + `logger.warn` の現行 pattern             |
| P1 (important) | [src/lib/errors.ts](../../../../src/lib/errors.ts)                                            | all          | `AppError.from` / `unwrapOrFrom` / `getErrorCode`                                                         |
| P2 (reference) | [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx)          | 50-72        | `localStorage` の `STORAGE_KEY` 命名規約（`allinpt.<key>`）。`pwaInstallDismissedAt` も同 prefix で揃える |
| P2 (reference) | [next.config.ts](../../../../next.config.ts)                                                  | all          | 本 Phase では編集しない（security headers は別 PR スコープ S-L1）                                         |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| `beforeinstallprompt` event | MDN: [Window: beforeinstallprompt event](https://developer.mozilla.org/en-US/docs/Web/API/Window/beforeinstallprompt_event) | `event.preventDefault()` で auto-prompt を抑止 → state に保持 → 任意時点で `event.prompt()` 起動 → `event.userChoice` で `outcome: "accepted" \| "dismissed"` |
| `appinstalled` event | MDN: [Window: appinstalled event](https://developer.mozilla.org/en-US/docs/Web/API/Window/appinstalled_event) | install 完了時に発火（Android Chrome / Edge）。iOS Safari は発火しないため UA + display-mode 経由で検出 |
| Web App Install Prompt 仕様 | [web.dev: Customize the install experience](https://web.dev/customize-install/) | 1 つの BeforeInstallPromptEvent は **1 回しか prompt() できない**。dismiss 後に同じインスタンスを再利用しない。次の event 発火を待つ |
| Service Worker LRU cache | [web.dev: Workbox cache strategies — Cache expiration](https://developer.chrome.com/docs/workbox/modules/workbox-expiration) | workbox 採用しない場合は `cache.keys()` の戻り値が **挿入順**。先頭から `keys.length - MAX` 件を delete すればシンプル LRU 相当 |
| `navigator.standalone` | [Apple: Configuring Web Applications](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html) | iOS Safari の standalone 検出。Phase A の既存 fallback と同形 |

```
KEY_INSIGHT: BeforeInstallPromptEvent は capture 時に preventDefault しないと
  ブラウザの自動 install banner が出てしまうため、必ず最初の event listener で
  preventDefault する。state にも保持し、ユーザーが「ホーム画面に追加」を押下した
  ときに e.prompt() を呼ぶ。
APPLIES_TO: Task 1 (PwaInstallPromotion 実装)
GOTCHA: e.prompt() を呼ばずに長時間放置すると、ブラウザが内部状態をクリーンアップ
  して event が無効化されることがある。dismiss 時はちゃんと state を null に戻し、
  次回の beforeinstallprompt 発火を待つ
```

```
KEY_INSIGHT: iOS Safari は beforeinstallprompt / appinstalled いずれも非対応で
  あり、UA 判定 + display-mode 検出のみで標準パターン。Next.js 公式ガイドが
  採用する `(window as Navigator & { standalone?: boolean }).standalone === true` の
  fallback を Phase A の IOsInstallHint で既に踏襲済み
APPLIES_TO: Task 1（Android 経路）と Task 4（iOS hint dismiss 化）の責務分離
GOTCHA: 同一コンポーネント内で OS 分岐すると test も複雑になるため、
  Android 系は新規 PwaInstallPromotion / iOS 系は既存 IOsInstallHint に分けて
  両者を page.tsx に並列 mount する設計が読みやすい
```

```
KEY_INSIGHT: cache.keys() は Cache API 仕様で「挿入順」を返すと明文化されている。
  これにより workbox 等の依存追加なしに簡易 LRU を実装可能
APPLIES_TO: Task 3 (sw.js eviction)
GOTCHA: cache.put 直後の eviction を await すると navigate のレイテンシが伸びる。
  fire-and-forget で `event.waitUntil` に渡す形が望ましい（waitUntil でないと
  SW が早期 terminated される可能性）。簡易には put のあとで非 await の delete
  Promise を握っておけば充分
```

```
KEY_INSIGHT: navigate path allowlist の判定は「pathname の startsWith」が正確で
  シンプル。`/groups/...` / `/tournaments/...` / `/settings` / `/account` /
  `/structures/...` / `/join/...` を skip 対象。`/` と `/login` は必ず allow
  （shell precache でもあり、auth-free な静的 URL）
APPLIES_TO: Task 3 (sw.js navigate cache allowlist)
GOTCHA: query string や hash で挙動を変えると test が壊れやすい。pathname だけ
  見る。SSR で query 依存の output が将来増える可能性を考慮し、所属を pathname
  prefix のみで決め打つ
```

```
KEY_INSIGHT: localStorage["allinpt.pwaInstallDismissedAt"] の値は ms epoch (number).
  read 時は `parseInt(...,10)` で number 化して `Date.now() - dismissedAt < THIRTY_DAYS_MS`
  を判定。SSR / private mode で localStorage が使えない環境は **dismiss 永続化を諦め
  「常に表示候補」**として扱う（current-group.tsx の現行 fallback と同方針）
APPLIES_TO: Task 1 (PwaInstallPromotion dismiss 永続化) と Task 4 (IOsInstallHint dismiss)
GOTCHA: STORAGE_KEY は current-group.tsx の prefix `allinpt.` に揃える。新規 storage
  key を増やすと regression test の seed / cleanup 漏れが増えるが、本 Phase で
  必要な分だけ追加し、後の Phase で集約する
```

```
KEY_INSIGHT: トップ画面 `/` のみに mount することで「会場 dashboard / live で
  install banner が居座る」事故を排除しつつ、role gating の実装と test 複雑度を回避できる
APPLIES_TO: Task 5 (layout.tsx から除去) / Task 6 (page.tsx に mount)
GOTCHA: 直リンクで `/groups/[gid]` 等にしか到達しない訪問者は install hint を
  見ない。これは仕様（受付参加者は member 想定で promotion 不要）。それでも
  PWA install したい人は `/` 直訪問で表示される。月 1〜2 回の運営者の主要な入口は
  ログイン直後の `/` であり、ここに集約する設計
```

---

## Patterns to Mirror

### NAMING_CONVENTION（PWA component / hook）

```tsx
// SOURCE: src/components/pwa/IOsInstallHint.tsx:15
export function IOsInstallHint() { ... }

// SOURCE: src/lib/hooks/useWakeLock.ts:28
export function useWakeLock(active: boolean): UseWakeLockState { ... }
```

新規も同じ形:

- `src/components/pwa/PwaInstallPromotion.tsx` — `export function PwaInstallPromotion()` / 引数なし
- 必要なら `src/components/pwa/use-install-dismiss.ts` — 共有 dismiss helper（PwaInstallPromotion と IOsInstallHint で同 storage key を扱う部分の DRY 化候補。最初は inline で OK）

### ERROR_HANDLING（device/* / pwa/* ドメイン）

```tsx
// SOURCE: src/lib/hooks/useWakeLock.ts:94-105
} catch (e) {
  const wrapped = AppError.from(
    e,
    "device/wake-lock-failed",
    "画面消灯防止に失敗しました",
  );
  logger.warn(wrapped.message, { code: wrapped.code });
  if (!cancelled) {
    setHeld(false);
    setLastError(wrapped);
  }
}
```

Phase D で導入するドメインコード（[error-logging.md](../../../../.claude/rules/error-logging.md) 参照）:

- `pwa/install-prompt-failed` — `e.prompt()` の throw / userChoice の reject
- `pwa/storage-failed` — `localStorage.getItem/setItem` の throw（private browsing 等）

これらは throw まで伝播させず、`logger.warn` のみで握る（PWA 機能無しでもアプリは動く設計）。

### LOGGING_PATTERN

```tsx
// SOURCE: src/components/pwa/ServiceWorkerRegistration.tsx:25-34
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
```

Phase D 例:
- `logger.info("pwa install prompt accepted", { outcome })` — userChoice 確定時
- `logger.info("pwa install dismissed", { reason: "user-click" | "appinstalled" })` — banner 閉じた時

### SERVICE_WORKER_LRU（Cache API シンプル LRU）

```js
// REFERENCE: workbox-expiration の最小同等品
async function trimCache(cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys(); // 挿入順
  if (keys.length <= maxEntries) return;
  const removeCount = keys.length - maxEntries;
  await Promise.all(keys.slice(0, removeCount).map((k) => cache.delete(k)));
}

// 既存 networkFirst / staleWhileRevalidate の cache.put 直後に
// event.waitUntil(trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES)) で
// fire-and-forget eviction（fetch event の lifetime 内で完了させる）
```

### SERVICE_WORKER_PATH_ALLOWLIST（navigate cache）

```js
// SOURCE: 本 Phase で新設。形式は既存 sw.js#L77-L84 の startsWith 列挙と同形
const NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"];
function shouldCacheNavigate(pathname) {
  return NAVIGATE_CACHE_ALLOWLIST.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`),
  );
}
```

### TEST_STRUCTURE（component test）

```tsx
// SOURCE: src/components/pwa/IOsInstallHint.test.tsx:6-32
function setUserAgent(ua: string) { Object.defineProperty(navigator, "userAgent", { configurable: true, get: () => ua }); }
function setMatchMedia(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((q) => ({
    matches: q === "(display-mode: standalone)" ? standalone : false,
    media: q, onchange: null,
    addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}
beforeEach(() => { setMatchMedia(false); setUserAgent("..."); });
afterEach(() => { vi.restoreAllMocks(); });
```

**role gating を持たない**ため、新規 component の test も `useCurrentGroup` 等の mock は不要。`localStorage` だけ stub すれば足りる:

```tsx
// localStorage stub
function setDismissedAt(value: number | null): void {
  if (value === null) {
    window.localStorage.removeItem("allinpt.pwaInstallDismissedAt");
  } else {
    window.localStorage.setItem("allinpt.pwaInstallDismissedAt", String(value));
  }
}
beforeEach(() => { setDismissedAt(null); });
afterEach(() => { setDismissedAt(null); });
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/components/pwa/PwaInstallPromotion.tsx` | CREATE | Android 系 `beforeinstallprompt` capture + カスタムバナー（role gating なし） |
| `src/components/pwa/PwaInstallPromotion.test.tsx` | CREATE | event capture / accept / dismiss / appinstalled / 30 日 TTL の 6 ケース |
| `src/components/pwa/IOsInstallHint.tsx` | UPDATE | 「今は閉じる」dismiss ボタン追加 + `localStorage` 30 日 dismiss。Phase A の TODO コメントを「mount 点限定で gating 不要」に書き換え |
| `src/components/pwa/IOsInstallHint.test.tsx` | UPDATE | 既存 4 ケースに dismiss 関連の 2 ケースを追加 |
| `public/sw.js` | UPDATE | `NAVIGATE_CACHE_ALLOWLIST` 導入 + `trimCache` 追加 + `CACHE_VERSION` を `v2` に bump（既存 cache 全消し） |
| `src/app/layout.tsx` | UPDATE | `<IOsInstallHint />` の mount を **除去**（page.tsx に移動するため） |
| `src/app/page.tsx` | UPDATE | `<PwaInstallPromotion />` と `<IOsInstallHint />` を mount。signed-in / not signed-in / loading のいずれの分岐でも上端に出す |
| `.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md` | UPDATE | Phase D 行を完了時 `complete` 化（plan 作成時点で既に in-progress に更新済み） |
| `.claude/PRPs/03-pwa-app-shell/reports/phase-d-install-promotion-and-polish-report.md` | CREATE | Phase 完了時のレポート（既存 phase-a/b/c report のフォーマット踏襲） |

## NOT Building

- **role gating（owner / organizer 限定表示）** — PRD Decisions Log の方針見直し（2026-05-09）で「member への誤表示は dismiss するだけでコスト低、mount 点限定で十分」と判定。`useCurrentGroup` / `useGroupRole` を本 component から触らない設計
- **`/groups/[gid]` / `/tournaments/[tid]` 等での promotion 表示** — トップ画面 `/` のみに集約。会場 dashboard / live で促進バナーが邪魔をする事故を排除
- **`PwaInstallPromotion` 用の独立 hook (`usePwaInstall`) の export** — component 内 inline で完結する。`useFullscreen` / `useWakeLock` は app コードから複数 callsite で呼ばれる前提で hook 化されているが、本 banner は 1 callsite のため YAGNI
- **navigator.userAgentData (UA Client Hints) への移行** — security review S-L2 で「現行 UA sniffing は偽装可能だが純粋ローカル UI 切替で実害なし」と評価済み。UA Client Hints に倒すと iOS Safari 対応が逆に複雑化するため踏襲
- **CSP / X-Frame-Options / Permissions-Policy の追加** — security review S-L1 で「別 PR で `next.config.ts` の `headers()` に追加する Phase」として PRD 03 のスコープ外と明記。本 Phase では触らない
- **workbox / serwist の導入** — Phase A で素 SW を選んだ理由（Turbopack 互換）に変更なし。LRU は 10〜20 行の自前実装で必要十分
- **multi-tab 同時オープン警告 UI** — Phase B の Could 扱いとして PRD 行 105 / Phase B plan 行 5 で「Phase D 範囲」と書かれていたが、Phase B の characterization テストとレビューで「Firestore SDK の multi-tab leader race 既知バグの正規回避は本 PRD 範囲外」として確定。本 Phase で扱わない
- **iOS install hint の dismiss 期間ユーザー設定 UI** — 30 日固定で十分（YAGNI）
- **install 完了統計 / Analytics** — 本プロジェクトは Analytics を導入していない。「運営チャットで報告される」を Success Metric の真実源とする
- **`appinstalled` 経由で Firestore に install 履歴記録** — 個人情報・端末情報の Firestore 保存禁止規約（[security-base.md](../../../../.claude/rules/security-base.md)）に抵触するため不可

---

## Step-by-Step Tasks

### Task 1: `PwaInstallPromotion` コンポーネント作成

- **ACTION**: Android Chrome 系の `beforeinstallprompt` event を capture し、カスタムバナーを表示する client component を新規作成（role gating なし）
- **IMPLEMENT**:
  - `"use client"` 宣言
  - state: `event: BeforeInstallPromptEvent | null` / `dismissed: boolean`
  - effect:
    - SSR ガード（`typeof window === "undefined"` で early return）
    - `localStorage` から `allinpt.pwaInstallDismissedAt` を読み、30 日以内なら `setDismissed(true)`
    - `window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); setEvent(e as BeforeInstallPromptEvent); })`
    - `window.addEventListener("appinstalled", () => { setEvent(null); persistDismissedAt(Date.now()); logger.info("pwa install completed"); })`
    - cleanup で listener 解除
  - `event === null || dismissed` なら何も render しない
  - 表示時: amber 系（`<IOsInstallHint />` と統一）の `<section role="region" aria-label="アプリのインストール案内">` で「ホーム画面に追加」ボタン + 「今は閉じる」ボタン
  - 「ホーム画面に追加」: `await event.prompt()` → `await event.userChoice` → `outcome === "accepted"` なら state を null（appinstalled が来るまで待つ）、`outcome === "dismissed"` なら `persistDismissedAt(Date.now())` で 30 日 dismiss
  - 「今は閉じる」: `persistDismissedAt(Date.now())` + `setDismissed(true)`
  - persistDismissedAt は try/catch + `AppError.from(e, "pwa/storage-failed", ...)` + `logger.warn`（throw しない）
- **MIRROR**:
  - 全体構造: `IOsInstallHint.tsx`（"use client" / SSR ガード / matchMedia 検出 / role="region"）
  - error wrap: `ServiceWorkerRegistration.tsx:28-34` の `AppError.from + logger.warn` パターン
  - storage 規約: `current-group.tsx:21,52-72` の `STORAGE_KEY = "allinpt.<feature>"` 命名 + try/catch fallback
- **IMPORTS**:
  ```tsx
  import { Download, X } from "lucide-react";
  import { useCallback, useEffect, useState } from "react";
  import { Button } from "@/components/ui/button";
  import { AppError } from "@/lib/errors";
  import { logger } from "@/lib/logger";
  ```
- **GOTCHA**:
  - `BeforeInstallPromptEvent` は標準型に存在しないので、structural type alias を component file 内で定義（`{ prompt(): Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }`）。`any` は使わない
  - `e.prompt()` は **同じ event インスタンスで 2 回呼べない**。「ホーム画面に追加」を押下したら state を null に倒し、次の `beforeinstallprompt` を待つ
  - `useCurrentGroup` を **import しない**（role gating 廃止のため）
- **VALIDATE**:
  - `npm run typecheck` で type 通る
  - `npm run lint` で warning ゼロ
  - 単体動作: dispatchEvent で `beforeinstallprompt` 模擬発火 → banner 表示 → click で prompt 起動 / dismiss

### Task 2: `PwaInstallPromotion` 単体テスト

- **ACTION**: 6 ケース（event 未捕捉時非表示 / event capture / accepted / dismissed / appinstalled / 30 日 TTL）を書く
- **IMPLEMENT**: testing.md 規約準拠で helper 境界 mock。`localStorage` だけ stub すればよく、role-related mock は不要
  - **case 1**: event 未発火 → 「ホーム画面に追加」表示なし（`queryByRole("region", ...)` で null）
  - **case 2**: `beforeinstallprompt` dispatch → 「ホーム画面に追加」「今は閉じる」ボタン表示
  - **case 3**: 「ホーム画面に追加」click → `event.prompt()` 呼出、`outcome="accepted"` なら banner 消滅 + `pwaInstallDismissedAt` は **未書込**（appinstalled を待つ）
  - **case 4**: 同上で `outcome="dismissed"` → banner 消滅 + `pwaInstallDismissedAt` 書込（30 日 dismiss）
  - **case 5**: 「今は閉じる」click → banner 消滅 + `pwaInstallDismissedAt` 書込
  - **case 6**: `appinstalled` event dispatch → banner 消滅 + `pwaInstallDismissedAt` に Date.now()
  - **case 7**: mount 時 `pwaInstallDismissedAt` が 5 日前 → `beforeinstallprompt` 発火しても banner 出ない
  - **case 8**: mount 時 `pwaInstallDismissedAt` が 31 日前 → event で banner 出る（TTL 境界）
  - **case 9**: localStorage 例外（private mode 模擬）→ banner 動作（warn 出る / throw しない）
- **MIRROR**:
  - userAgent / matchMedia stub: `IOsInstallHint.test.tsx:6-25`
  - 純表示分岐の getByTestId / queryByTestId: `OfflineBanner.test.tsx`
  - logger spy: `useWakeLock.test.tsx:43-46`
- **IMPORTS**:
  ```tsx
  import { fireEvent, render, screen, waitFor } from "@testing-library/react";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
  import { logger } from "@/lib/logger";
  import { PwaInstallPromotion } from "./PwaInstallPromotion";
  ```
- **GOTCHA**:
  - `BeforeInstallPromptEvent` の dispatch は `new Event("beforeinstallprompt")` に手動で `prompt` / `userChoice` プロパティを生やす形でよい（jsdom には未実装）
  - `localStorage` は jsdom に実装されているので `vi.spyOn(Storage.prototype, "setItem")` で throw を simulate して private mode を再現
  - `useCurrentGroup` を mock しない（role gating 廃止）
- **VALIDATE**: 9 件の test が pass。`vi.spyOn(logger, "warn")` で `pwa/storage-failed` の warn が想定 case のみ出ることを確認

### Task 3: `public/sw.js` の path allowlist + LRU eviction + CACHE_VERSION bump

- **ACTION**:
  - `CACHE_VERSION` を `"v2"` に上げ、既存 cache を activate 時に全消し
  - `networkFirst` の `cache.put` 前に `shouldCacheNavigate(url.pathname)` で gating
  - `staleWhileRevalidate` の `cache.put` 後に `trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES)` を fire-and-forget
  - 同様に `networkFirst` の `cache.put` 後にも `trimCache` を呼ぶ（allowlist 通過した path のみ）
- **IMPLEMENT**:
  ```js
  const CACHE_VERSION = "v2"; // Phase D bump（旧 cache 全消し / 新 LRU schema）
  const MAX_RUNTIME_ENTRIES = 50;
  const NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"];

  function shouldCacheNavigate(pathname) {
    return NAVIGATE_CACHE_ALLOWLIST.some((p) =>
      p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`),
    );
  }

  async function trimCache(cacheName, maxEntries) {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= maxEntries) return;
    const removeCount = keys.length - maxEntries;
    await Promise.all(keys.slice(0, removeCount).map((k) => cache.delete(k)));
  }

  async function networkFirst(req, url) {
    const cache = await caches.open(RUNTIME_CACHE);
    try {
      const res = await fetch(req);
      if (res && res.ok && shouldCacheNavigate(url.pathname)) {
        cache.put(req, res.clone());
        // fire-and-forget eviction
        trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES).catch(() => {});
      }
      return res;
    } catch {
      const cached = await cache.match(req);
      if (cached) return cached;
      const shell = await caches.match("/");
      if (shell) return shell;
      return new Response("offline", { status: 503, statusText: "offline" });
    }
  }

  // staleWhileRevalidate も cache.put 直後に trimCache を fire-and-forget
  ```
  - fetch event ハンドラで `event.respondWith(networkFirst(request, url))` のように `url` を渡せるよう signature を更新
- **MIRROR**:
  - 既存 `sw.js:79-86` の startsWith 列挙パターン（path 判定）
  - 既存 `sw.js:48-60` の activate 時 cache key cleanup（CACHE_VERSION bump で旧 cache 削除）
- **IMPORTS**: なし（`sw.js` は vanilla JS）
- **GOTCHA**:
  - `cache.keys()` は仕様上挿入順を返すが、ブラウザによっては実装の差異がある可能性がある（仕様準拠の主流ブラウザでは挿入順で問題なし）
  - allowlist 通過しない path は `cache.put` を skip する **だけ** で、`fetch(req)` は通常通り行い online 時は最新を返す。offline 時は cache に残っている古いものが返らないため `caches.match("/")` の shell fallback で着地する（既存挙動と整合）
  - eviction は fire-and-forget で十分。失敗しても `.catch(() => {})` で握る（次回の put で再評価される）
  - **CACHE_VERSION を上げると既存 install 端末で `v1` cache が一度に全削除**される。Phase A 直後に install した運営者は再 precache が走るが、shell URLs が 7 個しかないため起動時間に体感影響なし
- **VALIDATE**:
  - `next build` が壊れない（`public/sw.js` は build 時に静的 serve されるので transform はない、文法エラーのみ care）
  - DevTools Application → Service Worker → Update on reload で `v2` cache が生成されることを手動確認
  - DevTools の Cache Storage で `/groups/...` 系 navigate が cache に積まれず、`/` / `/login` のみ積まれることを確認
  - 同上で 50 件超 navigate / static 取得後に最古が間引かれることを確認

### Task 4: `IOsInstallHint` に dismiss 経路を追加

- **ACTION**:
  - 「今は閉じる」ボタンを末尾に追加し、押下時に `localStorage["allinpt.pwaInstallDismissedAt"]` に Date.now() を書く（PwaInstallPromotion と同 storage key を共有）
  - mount 時 `pwaInstallDismissedAt` が 30 日以内なら `setShow(false)`（既存 effect に condition を追加）
  - Phase A の TODO コメント `// Phase D: useGroupRole で role !== "member" のときのみ表示する gating を追加` を削除し、新規コメントで「mount 点を `/` に限定したため gating 不要」と明示
  - **role gating 関連の import / state は追加しない**
- **IMPLEMENT**:
  ```tsx
  const [show, setShow] = useState(false);
  // 既存 UA / standalone 検出 effect に dismiss check を追加
  useEffect(() => {
    if (typeof window === "undefined") return;
    // ① UA / standalone 既存判定
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !("MSStream" in window);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!isIOS || isStandalone) {
      setShow(false);
      return;
    }
    // ② dismiss check
    const at = readDismissedAt();
    if (at !== null && Date.now() - at < THIRTY_DAYS_MS) {
      setShow(false);
      return;
    }
    setShow(true);
  }, []);

  function onDismiss() {
    persistDismissedAt(Date.now());
    setShow(false);
  }
  ```
- **MIRROR**: PwaInstallPromotion Task 1 の `persistDismissedAt` / `readDismissedAt` helper を共通化したい場合は `src/components/pwa/install-dismiss.ts` に切り出して両 component から import する（YAGNI 判断: 最初は両 file に同じ関数を inline で OK、test 共通化が必要になったら抽出）
- **IMPORTS**: 既存 import に `Button`（または「今は閉じる」用の `<button>` 直接記述）を追加
- **GOTCHA**:
  - storage key を Android / iOS で共有することで「Android で「今は閉じる」を押した後、別ブラウザの iOS で開いたら IOsInstallHint が出る」ケースは依然発生する（localStorage はオリジン+ブラウザスコープ）。これは仕様であって bug ではない
  - 既存 4 ケースの test を壊さないため、デフォルトの mock で `pwaInstallDismissedAt: null` をセットする
- **VALIDATE**:
  - 既存 4 ケース + 追加ケース（dismiss 永続化 / 30 日 TTL）が pass
  - `npm run lint` warning ゼロ

### Task 5: `IOsInstallHint.test.tsx` の dismiss ケース追加

- **ACTION**: 4 ケース（既存）→ 6 ケースに拡張
  - 追加 case: 初回表示後「今は閉じる」click → 表示消滅 + localStorage に書込
  - 追加 case: mount 時に `pwaInstallDismissedAt` が 5 日前 → 表示なし
  - 追加 case: mount 時に `pwaInstallDismissedAt` が 31 日前 → 表示あり（TTL 境界。1 ケースで足りる場合は省略可）
- **IMPLEMENT**: 既存 file の `beforeEach` / `afterEach` に `localStorage` reset を追加。新規 case は既存 setUserAgent / setMatchMedia と組み合わせる
- **MIRROR**: PwaInstallPromotion.test.tsx と同じ `localStorage` stub 構造
- **IMPORTS**: 変更なし（既存）
- **GOTCHA**: 既存 test の `setUserAgent` / `setMatchMedia` 構造は維持
- **VALIDATE**: 6 件 pass

### Task 6: `app/layout.tsx` から `<IOsInstallHint />` を除去 + `app/page.tsx` に mount

- **ACTION**:
  - `app/layout.tsx` の `<IOsInstallHint />` mount 行を削除（import も削除）
  - `app/page.tsx` で `<PwaInstallPromotion />` と `<IOsInstallHint />` を `<main>` の直前 / 内部最上部に配置
- **IMPLEMENT**:
  ```tsx
  // src/app/page.tsx
  "use client";
  import Link from "next/link";
  import { Button } from "@/components/ui/button";
  import { IOsInstallHint } from "@/components/pwa/IOsInstallHint";
  import { PwaInstallPromotion } from "@/components/pwa/PwaInstallPromotion";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";

  export default function Page() {
    const { user, loading } = useAuthUser();
    const signedIn = !!user && !user.isAnonymous;
    return (
      <>
        <PwaInstallPromotion />
        <IOsInstallHint />
        <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8 text-center">
          {/* 既存ヒーロー / ボタン群 */}
        </main>
      </>
    );
  }
  ```
- **MIRROR**: 既存 layout.tsx の mount 順（`<IOsInstallHint />` を `<AppShell>` の外に置く形）を踏襲
- **IMPORTS**:
  - `app/layout.tsx` から `IOsInstallHint` import 削除
  - `app/page.tsx` に `PwaInstallPromotion` / `IOsInstallHint` を import 追加
- **GOTCHA**:
  - `app/page.tsx` は既に `"use client"` 化されているため、追加インポートに制約はない
  - layout の `<header>` / sidebar は `<main>` を render する前段にあるため、page.tsx で `<>` Fragment で先頭に install banner を出すと layout の `<header>` の **直後・`<AppShell>` 内** に着地する。これで望ましい配置になる
  - 既存 `IOsInstallHint` を**完全に layout から除去**するため、`/login` / `/groups/...` 等で iOS hint を見られなくなる仕様変更を release notes（report）に明記
- **VALIDATE**:
  - `npm run typecheck`
  - `npm run build`
  - dev で `/` を iOS UA で開き hint 表示 / `/groups` で非表示 を確認
  - dev で Chrome DevTools の `beforeinstallprompt` を手動 dispatch するか、`Application → Manifest → Add to homescreen` 経由で動作を目視確認

### Task 7: PRD 表更新 + 実装レポート作成

- **ACTION**:
  - `03-pwa-app-shell.prd.md` の Implementation Phases 表で Phase D 行を完了時 `complete` 化
  - `.claude/PRPs/03-pwa-app-shell/reports/phase-d-install-promotion-and-polish-report.md` を生成し、Validation Results / Files Changed / Deviations / Tests Written / Next Steps を記載
- **MIRROR**: `phase-c-device-controls-report.md` のフォーマット
- **IMPORTS**: なし（doc）
- **GOTCHA**: PRD 更新は plan 作成時に `pending` → `in-progress` のみ既に完了済み。`complete` への遷移は `/prp-implement` 完了後に行う
- **VALIDATE**: PRD 表が link 切れなし

### Task 8: 観測フェーズ準備（手動検証チェックリスト）

- **ACTION**: report 内に以下のチェックリストを設置し、開発者がサークル参加時に検証する
  - [ ] Android Chrome（実機 / DevTools 模擬）でトップ画面 `/` 訪問 → `beforeinstallprompt` capture → カスタムバナー表示 → `prompt()` accepted で `appinstalled` 受信して banner 消える
  - [ ] iOS Safari 実機でトップ画面 `/` を開いて `IOsInstallHint` 表示 + 「今は閉じる」で 30 日 dismiss → 同 30 日内にトップ画面再訪問で hint が出ないこと
  - [ ] `/groups/[gid]` / `/tournaments/[tid]` / `/login` 等で install hint / promotion が一切出ないこと（mount 点限定の確認）
  - [ ] 同 PWA install 後の起動で SW navigate cache に `/groups/...` / `/tournaments/...` が乗らないことを DevTools Cache Storage で確認
  - [ ] 50 件以上の static asset を取得後、最古から間引かれることを確認
  - [ ] auto-advance fallback（Phase B）は network throttling Offline で動作することを目視確認
- **IMPLEMENT**: report の最後に「実機検証ログ（TODO — 担当者が記入）」セクションを設置
- **MIRROR**: `phase-a-pwa-foundation-report.md:99-128` の形式
- **IMPORTS**: なし
- **GOTCHA**: 本 Phase 完了の判定は「実装＋テスト green」までで、観測フェーズの完了は別軸（PRD Success Metrics の真実源）
- **VALIDATE**: report の TODO 欄が空テンプレで埋まっていること

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| PwaInstallPromotion: event 未発火時非表示 | mount のみ | `queryByRole("region", { name: /アプリのインストール/ })` is null | ✓ |
| 同: event 発火で表示 | `beforeinstallprompt` dispatch | 「ホーム画面に追加」「今は閉じる」ボタンあり | - |
| 同: 「ホーム画面に追加」click → accepted | event.prompt() ok, userChoice resolves accepted | banner 消滅 / localStorage **未書込** | - |
| 同: 同 click → dismissed | userChoice resolves dismissed | banner 消滅 / localStorage 書込 | ✓ 30日抑止 |
| 同: 「今は閉じる」click | dismiss button click | banner 消滅 / localStorage 書込 | - |
| 同: appinstalled event | dispatch appinstalled | banner 消滅 / localStorage 書込 | ✓ install 完了 |
| 同: 5 日前 dismiss 状態で再 mount | localStorage に dismissedAt = 5 日前 | event 来ても banner 出ない | ✓ persistence |
| 同: 31 日前 dismiss 状態で再 mount | localStorage に dismissedAt = 31 日前 | event で banner 出る | ✓ TTL boundary |
| 同: localStorage 例外（private mode 模擬） | setItem throw | banner 動作（warn 出る / throw しない） | ✓ pwa/storage-failed |
| IOsInstallHint: 既存 4 ケース | 既存と同じ | 既存と同じ | - |
| IOsInstallHint: 「今は閉じる」click | iOS UA で表示 → dismiss click | banner 消滅 / localStorage 書込 | - |
| IOsInstallHint: 5 日前 dismiss 状態で再 mount | localStorage に dismissedAt = 5 日前 | iOS UA でも banner null | ✓ persistence |
| sw.js（手動 / DevTools） | `/groups/g-1` 訪問 → 再訪問 offline | cache miss → shell fallback（cache に乗っていない） | ✓ allowlist |
| sw.js（手動 / DevTools） | static 51 件取得 | 50 件に縮小 | ✓ LRU |

### Edge Cases Checklist

- [x] SSR（`typeof window === "undefined"`）で early return
- [x] `BeforeInstallPromptEvent` 標準型未対応 → structural type
- [x] localStorage 利用不可（private mode）→ catch + warn / throw しない
- [x] `appinstalled` 受信時の banner 即時 hide
- [x] `userChoice` の reject ケース（NotAllowedError 等）→ AppError("pwa/install-prompt-failed") + warn
- [x] dismiss 30 日 TTL 境界（29 日 / 31 日）
- [x] `cache.keys()` の挿入順保証（仕様 OK）
- [x] CACHE_VERSION bump で旧 cache 全消し（既存 activate 経路で対応）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: 0 errors

### Lint

```bash
npm run lint
```

EXPECT: 0 warnings / 0 errors

### Unit Tests

```bash
# PWA scope のみ
npx vitest run src/components/pwa

# 全件
npm test
```

EXPECT: 既存 1149 件 + 新規約 11 件（PwaInstallPromotion 9 / IOsInstallHint 追加 2）が green

### Build

```bash
npm run build
```

EXPECT: `next build` Compiled successfully、`/manifest.webmanifest` static、`public/sw.js` 整合性 OK

### Manual Validation (DevTools / 実機)

- [ ] Chrome DevTools の `Application → Manifest → Add to homescreen` で install 起動 → `appinstalled` 経由で banner 消える
- [ ] DevTools Console から `window.dispatchEvent(new Event("beforeinstallprompt"))` の合成イベントを発火させてカスタムバナー表示確認
  - **GOTCHA**: 標準で発火しない場合があるため、本検証は test の dispatch ロジックと等価動作を確認するための補助。manifest 要件と SW 登録が完了している必要がある
- [ ] DevTools Application → Cache Storage → `allin-runtime-v2` に `/groups/...` の navigate response が積まれていないこと
- [ ] 同 cache が 50 件超で最古から間引かれること（手動で `/_next/static/*` を 50+ 件 fetch して確認）
- [ ] `/login` / `/` の navigate は引き続き runtime cache に積まれること
- [ ] member ロールの参加者端末で `/tournaments/[tid]/live` を開き、install hint / promotion が一切出ないこと（mount 点限定検証）
- [ ] iOS Safari 実機で `/` 訪問時に IOsInstallHint 表示・`/groups/[gid]` 訪問時に非表示

---

## Acceptance Criteria

- [ ] `<PwaInstallPromotion />` がトップ画面 `/` のみで mount され、role gating なしで `beforeinstallprompt` capture 時に表示される
- [ ] custom button から `prompt()` を発火可能、`appinstalled` で banner 自動 hide
- [ ] dismiss / appinstalled で `localStorage["allinpt.pwaInstallDismissedAt"]` を更新し、30 日内は再表示しない
- [ ] `<IOsInstallHint />` も `app/layout.tsx` から除去され `app/page.tsx` に移設される（mount 点はトップ画面のみ）
- [ ] `<IOsInstallHint />` に「今は閉じる」ボタンを追加し、PwaInstallPromotion と同 storage key で 30 日 dismiss 永続化
- [ ] Phase A の TODO コメント（"useGroupRole で role !== "member" のときのみ表示する gating を追加"）が削除され、新コメントで mount 点限定の設計が明記される
- [ ] `public/sw.js` の `networkFirst` が `NAVIGATE_CACHE_ALLOWLIST`（`/` と `/login`）以外を cache に積まない
- [ ] `RUNTIME_CACHE` が 50 entry 上限で最古から間引かれる
- [ ] `CACHE_VERSION` を `v2` に bump し、既存 install 端末で旧 cache が活性化時に削除される
- [ ] PWA 関連の test ファイルが pass（PwaInstallPromotion / IOsInstallHint）
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` 全 green
- [ ] PRD の Implementation Phases 表で Phase D が `complete` と plan link が記載される
- [ ] 実装レポート（`reports/phase-d-install-promotion-and-polish-report.md`）が生成される

## Completion Checklist

- [ ] コードが既存パターン（IOsInstallHint / ServiceWorkerRegistration / useWakeLock）を踏襲
- [ ] エラーは `AppError.from + logger.warn`、技術スタック名をユーザー向けメッセージに含めない
- [ ] `console.*` の直呼びなし（lint で検出）
- [ ] テストが helper 境界 mock（内部実装ではなく観測可能挙動を検証）
- [ ] localStorage 例外を catch + warn して throw しない
- [ ] sw.js の cache key / allowlist / LRU は既存パターンに沿った最小実装（workbox 等の依存追加なし）
- [ ] PRD のスコープを超える追加変更なし（CSP / security headers / multi-tab 警告 UI 等は本 Phase 外）
- [ ] 実装内容が plan の "NOT Building" を侵していない
- [ ] role gating を実装に持ち込んでいない（PRD Decisions Log の方針通り）
- [ ] code review（`/code-review`）と security review（`/security-review`）を実施

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `beforeinstallprompt` がブラウザの内部判定（user engagement）を満たさず発火しない | M | M | manifest / SW / icons の最低要件を満たす Phase A の状態を維持。dev では DevTools の手動 trigger を補助として使う |
| `cache.keys()` の挿入順がブラウザによりズレ、LRU が真の最古を捨てない | L | L | 仕様準拠の主流ブラウザでは挿入順。万一ズレてもキャッシュ整合性は保たれる（ヒット率に微小影響のみ） |
| navigate allowlist で必要な path が漏れて offline shell fallback が作動 | L | M | `/` を最終 fallback として shell precache 維持（既存挙動）。`/groups/...` は Firestore IndexedDB 側から復元できるため UI が真っ白にはならない |
| `localStorage` の private mode 例外で dismiss が永続化されず毎回出る | L | L | warn のみ。private mode 利用率は会場運営者で極小、影響軽微 |
| CACHE_VERSION bump で全 install 端末の起動時間が一時的に伸びる | L | L | shell URLs は 7 件のみで再取得は数百ms以内。Phase A 直後の install 端末は再 precache 1 回で済む |
| 直リンクで `/groups/...` / `/tournaments/...` にしか到達しない訪問者が install hint を見ない | L | L | 仕様。`/` 直訪問時に表示される。月 1〜2 回の運営者の主要な入口は ログイン直後 `/` のため許容 |
| BeforeInstallPromptEvent の structural type を間違って書き component が type-error | L | L | Mandatory Reading の `useWakeLock.ts` で同種の `Navigator & { ... }` 形を確認、TypeScript 5.x 環境で typecheck で検出 |

## Notes

- **方針見直しの根拠（2026-05-09）**: 当初 plan は `useGroupRole` / `useCurrentGroup` での role gating + 全画面 mount を想定していたが、ユーザー方針見直しにより「mount 点を `/` に限定 + role gating なし」に変更。理由: (1) 会場 dashboard / live 中に促進バナーが邪魔をする事故を排除、(2) member への誤表示は dismiss するだけでコスト低、(3) role gating の実装と test 複雑度を回避できる。詳細は PRD Decisions Log 参照
- **storage key の共有**: `PwaInstallPromotion` と `IOsInstallHint` は同一 `localStorage["allinpt.pwaInstallDismissedAt"]` を共有する設計。Android で「今は閉じる」を押したら iOS hint も 30 日出さない、というシンプルなルール
- **dev での SW**: Phase A の `ServiceWorkerRegistration` は production gate のため、dev で sw.js の挙動を試す場合は `npm run build && npm run start` で本番モード起動が必要
- **observability**: `logger.info("pwa install completed")` などの info ログは Vercel logs / dev console で観測可能。Analytics は導入していないため、Success Metric は「運営チャットでの口頭報告」を真実源とする（PRD Success Metrics）
- **CSP との関係**: security review S-L1 で別 PR スコープと整理済み。本 Phase でグローバル security headers を触らない理由は「Phase D = 機能の polish」「security headers = inline script CSP の挙動を全画面で検証する別 task」と分離するため
- **Phase 完了後**: `/prp-implement` → `/code-review` → `/security-review` → `/prp-pr` の順で進める。PR タイトルは「feat: Phase D PWA インストール促進と SW polish」相当
