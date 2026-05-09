# Plan: Phase 4 — PWA Cache Allowlist 追加（観戦モード）

## Summary

`public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` を additive 追加し、`CACHE_VERSION` を `v2` → `v3` に bump して旧 runtime cache を一掃する。新規・既存 SW いずれの runtime cache でも `/spectate/{tid}` の navigate response が `network-first` で積まれ、Wi-Fi 不安定時には直近キャッシュを fallback で返せるようになる。stale 戦略は既存 `networkFirst` をそのまま流用するため「オンライン時は最新を取りに行く / 失敗時のみキャッシュ」の挙動が自動的に得られ、stale 許容範囲は実質「最後にオンラインで取れた snapshot」（数分〜数十分単位、運用上問題ない範囲）に収束する。

加えて `shouldCacheNavigate` の挙動 unit test を新規追加し、`/spectate/{tid}` 系 path の cache 許可 / 既存 auth-aware path（`/groups/...`・`/tournaments/...`・`/settings`・`/account` 等）の cache 不許可 / `/spectate`（trailing slash なし exact）の経路を全て pin する。E2E 側の Phase D static contract test (`tests/e2e/phase-d-install-promotion.spec.ts`) も `NAVIGATE_CACHE_ALLOWLIST` の expected entries と `CACHE_VERSION` の regex を更新して同期させる。

## User Story

As a 会場の予備モニタを操作する運営者, I want 会場の Wi-Fi が一瞬切れても予備モニタの `/spectate/{tid}` 画面が white / 503 にならず、直前のタイマー / ブラインド / 席表が見え続ける, so that 投影中のタイマー画面が瞬断で真っ白になって参加者を不安にさせる事故を防げる。

And as a 観戦 URL を共有された遅刻参加者, I want 移動中の電波が途切れた瞬間でもアプリが完全に固まらず、再接続後に自動で最新化される, so that 「タイマーがフリーズしたから今は分からない」と諦めず、ベストエフォートで現状把握を継続できる。

And as a 開発者, I want SW の `shouldCacheNavigate` 挙動が unit test で固定され、将来 allowlist を変えるときに意図しない path（`/groups/...` 等の auth-aware path）が誤って通らないことを機械検証できる, so that Phase D の M3 / S-M1 で確立した「auth-aware page を navigate cache に積まない」原則を退行させない。

## Problem → Solution

**Current state**: Phase 1〜3 で `tournaments.spectateEnabled` field・Firestore Rules anon read 拡張・`/spectate/[tid]` ページ（Phase 2）・toggle UI と共有導線（Phase 3）が揃った状態。ただし Service Worker `public/sw.js` の [`NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"]`](../../../../public/sw.js#L39) は Phase D 確立時点のもので、`/spectate/{tid}` を含まない。会場の Wi-Fi 不安定（瞬断）が起きると:

- `networkFirst` が `fetch(req)` で throw → cache 内に `/spectate/...` が無いため `caches.match("/")` の shell fallback に着地 → 観戦モードが「ALLin-PokerTimer のトップ画面」に瞬間置換される
- 予備モニタ投影が一瞬で「会場で見せたくないトップ画面（ログインボタンや一般メッセージ）」に切り替わる UX 事故

また `CACHE_VERSION` は `v2` のまま据え置きのため、Phase D の install 端末は新 allowlist 拡張だけ受け入れて旧キャッシュは温存する。同 cache key 内では allowlist の差分は無害だが、後続の architect-refactor で SW 内部設計を変える可能性があるため、本 Phase で先回りして `v3` に bump し旧 runtime cache を綺麗に飛ばす。

`shouldCacheNavigate` の挙動は現状 e2e の static contract regex check（[tests/e2e/phase-d-install-promotion.spec.ts:160-189](../../../../tests/e2e/phase-d-install-promotion.spec.ts#L160-L189)）でしか pin されておらず、関数本体の行を 1 文字ずれで書き換えても regex が通る恐れがある（例: `pathname.startsWith` を `pathname.includes` に変えても regex check では検出不可）。

**Desired state**:

- `NAVIGATE_CACHE_ALLOWLIST = ["/", "/login", "/spectate"]` で `/spectate/{tid}` の navigate response が `RUNTIME_CACHE` に積まれる
- 会場 Wi-Fi 瞬断で SW が cache fallback を返し、観戦画面が直前の状態を保ったまま表示継続する（投影 UX を破壊しない）
- `CACHE_VERSION = "v3"` で activate 時に旧 `allin-runtime-v2` / `allin-shell-v2` が活性化時に削除され、新 allowlist が clean state で適用される
- `shouldCacheNavigate` の挙動 unit test (`src/lib/sw/sw-allowlist.test.ts` 新設) が以下を pin:
  - `"/"` → true（exact match）
  - `"/login"` / `"/login/forgot-password"` → true
  - `"/spectate"` （exact、現状 route は無いが allowlist 表記由来で true）→ true
  - `"/spectate/abc123def456"` → true
  - `"/groups/g-1"` / `"/tournaments/t-1"` / `"/tournaments/t-1/live"` → false（auth-aware path 既存挙動）
  - `"/settings"` / `"/account"` / `"/structures/s-1"` / `"/join/t-1"` → false（同上）
  - `""` / `"/foo"` / `"/spectatethief"` → false（startsWith の prefix 誤マッチを防ぐ。`startsWith("/spectate/")` の trailing slash で守る）
- E2E static contract test (`tests/e2e/phase-d-install-promotion.spec.ts`) の `NAVIGATE_CACHE_ALLOWLIST` 配列 regex と `CACHE_VERSION` regex が `v3` + `/spectate` 含みに更新され、同 spec が引き続き green
- 観測フェーズ（実機 / DevTools 手動検証）で「予備モニタの瞬断時に直前 state で表示継続」を確認するチェックリストが report に積まれる

## Metadata

- **Complexity**: Small（実装変更は sw.js + 1 unit test + 1 e2e regex 更新の 3 箇所）
- **Source PRD**: [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md)
- **PRD Phase**: Phase 4 — PWA Cache Allowlist 追加
- **Estimated Files**: 約 5 files（sw.js 1 / unit test 1 / e2e 更新 1 / PRD 更新 1 / report 1）

---

## UX Design

### Before（Phase 3 完了時点）

```
会場運営者の予備モニタ（投影中）  Wi-Fi 瞬断（数秒）
┌────────────────────────┐         ┌────────────────────────┐
│ 観戦モード              │         │ ALLin-PokerTimer        │
│ Lv 4 / SB 100 BB 200    │   →     │  [サークル一覧へ]       │ ← shell fallback
│ Players 14 / 18         │         │  [トーナメント一覧へ]   │   が瞬間置換
│ [SeatingBoard]          │         │   ...                  │
└────────────────────────┘         └────────────────────────┘
```

問題:
- `/spectate/{tid}` は `NAVIGATE_CACHE_ALLOWLIST` 外のため SW runtime cache に積まれない
- offline 時に `caches.match("/")` の shell fallback に着地 → 観戦画面が「サークル一覧 / トーナメント一覧」を案内するトップ画面に化ける
- 投影中の参加者・来場者には「タイマーが消えた」と見える UX 事故

### After（Phase 4 完了時点）

```
会場運営者の予備モニタ（投影中）  Wi-Fi 瞬断（数秒）
┌────────────────────────┐         ┌────────────────────────┐
│ 観戦モード              │         │ 観戦モード              │
│ Lv 4 / SB 100 BB 200    │   →     │ Lv 4 / SB 100 BB 200    │ ← cache から
│ Players 14 / 18         │         │ Players 14 / 18         │   直前 HTML が返る
│ [SeatingBoard]          │         │ [SeatingBoard]          │
└────────────────────────┘         └────────────────────────┘
                                       ↓ 復旧
                                    Firestore IndexedDB の last seen state で
                                    数秒〜数十秒以内に最新値に追従
```

挙動:
- `/spectate/{tid}` の HTML が `RUNTIME_CACHE` に network-first で蓄積される
- 瞬断時は cache から直前 HTML を返し、Firestore IndexedDB（既存 PWA 基盤）の `last seen state` を `subscribe*` 系 hook が再描画
- 復旧後は次の navigate 時に最新 HTML を fetch / cache に上書き

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/spectate/{tid}` を online で初回訪問 | network 直行（cache に積まれない） | network-first で fetch + cache.put | 体感差なし。allowlist 変更による副作用 |
| `/spectate/{tid}` を online で再訪問 | 毎回 network 直行 | network-first（オンラインなら最新を返す） | 体感差なし。stale な cache を**返さない**ため数分内 stale の懸念なし |
| `/spectate/{tid}` を offline で再訪問 | shell `/` に fallback（観戦画面が消える） | cache から直前 HTML 返却 | **本 Phase の主要 UX 改善** |
| `/groups/{gid}` / `/tournaments/{tid}` の cache 挙動 | 不変（cache に積まれない） | 不変 | Phase D で確立した auth-aware path の cache 除外を維持 |
| 既存 install 端末で v2 cache | 残存 | activate で削除 → v3 で再 precache | shell URLs 7 件のみで体感影響なし |

---

## Mandatory Reading

実装前に必ず読むべきファイル。

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [public/sw.js](../../../../public/sw.js) | 1-159 | 現行 SW 全体。`CACHE_VERSION` / `NAVIGATE_CACHE_ALLOWLIST` / `shouldCacheNavigate` / `networkFirst` / activate listener の全責務を把握する必要あり |
| P0 (critical) | [tests/e2e/phase-d-install-promotion.spec.ts](../../../../tests/e2e/phase-d-install-promotion.spec.ts) | 160-189 | static contract test の更新箇所。`CACHE_VERSION` regex と `NAVIGATE_CACHE_ALLOWLIST` regex を含む |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md) | 245-264 | Phase 4 の Goal / Scope / Success signal / Parallelism Notes |
| P0 (critical) | [.claude/PRPs/03-pwa-app-shell/plans/completed/phase-d-install-promotion-and-polish.plan.md](../../03-pwa-app-shell/plans/completed/phase-d-install-promotion-and-polish.plan.md) | 488-549 | Phase D の sw.js 設計判断（path allowlist / LRU / fire-and-forget eviction）の参照源 |
| P0 (critical) | [.claude/PRPs/03-pwa-app-shell/reviews/local-phase-d-install-promotion-and-polish-review.md](../../03-pwa-app-shell/reviews/local-phase-d-install-promotion-and-polish-review.md) | 46-86 | M3（cache.put race）/ L2（runtime cache 共有）/ L4（`/login` prefix match）の指摘。本 Phase でも踏襲すべき設計判断 |
| P1 (important) | [tests/e2e/pwa-foundation.spec.ts](../../../../tests/e2e/pwa-foundation.spec.ts) | 1-80 | E2E spec のヘッダ JSDoc / describe ブロック構造の参考フォーマット |
| P1 (important) | [.claude/PRPs/04-spectate-mode/reports/phase-1-schema-rule-emulator-report.md](../reports/phase-1-schema-rule-emulator-report.md) | 1-128 | Report のフォーマット / Validation Results 表 / Code Review 反映節の例 |
| P1 (important) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | 全体 | `pwa/*` prefix の利用方針。本 Phase は新規 prefix 追加なし（sw.js 側で `console.warn` を許容しているため `AppError` ラップ不要）の判断確認 |
| P1 (important) | [.claude/rules/testing.md](../../../rules/testing.md) | 全体 | unit test の helper 境界 mock / characterization test ファースト原則 |
| P2 (reference) | [.claude/PRPs/04-spectate-mode/plans/completed/phase-1-schema-rule-emulator.plan.md](completed/phase-1-schema-rule-emulator.plan.md) | 1-80 | 同 PRD 内の plan format 参考（Mandatory Reading / Patterns to Mirror / Tasks） |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | "対象外" 節 | sw.js は本 rule の include 範囲外（vanilla JS / SDK 直接呼出なし）。AppError ラップ義務が及ばないことの確認 |

## External Documentation

- **MDN Service Worker Cache API** — `cache.keys()` の挿入順仕様、`cache.put` の race（Phase D M3 で既に await 化済み）の理解確認。Phase 4 では既存 `networkFirst` / `staleWhileRevalidate` をそのまま流用するため、新規 race の心配なし
- **Web App Manifest / display-mode** — Phase A で `start_url: "/"` / `scope: "/"` / `display: "standalone"` 設定済み。`/spectate/...` は `scope: "/"` 配下なので manifest 変更不要

> 注: 本 Phase は外部ライブラリ追加（workbox / serwist 等）を行わない。Phase D の Decisions Log の通り「LRU は 10〜20 行の自前実装で必要十分 / Turbopack 互換性のため素 SW を維持」を踏襲する。

---

## Patterns to Mirror

### NAMING_CONVENTION（SW 定数 / 関数）

```js
// SOURCE: public/sw.js:15-39
const CACHE_VERSION = "v2";
const SHELL_CACHE = `allin-shell-${CACHE_VERSION}`;
const RUNTIME_CACHE = `allin-runtime-${CACHE_VERSION}`;
const MAX_RUNTIME_ENTRIES = 50;
const SHELL_URLS = ["/", "/login", "/manifest.webmanifest", ...];
const NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"];
```

新規 entry も同形:

- `NAVIGATE_CACHE_ALLOWLIST = ["/", "/login", "/spectate"]` — alphabetical 順ではなく **既存順 + 末尾追加**（diff を最小化）
- `CACHE_VERSION = "v3"` — Phase D の `v2` から +1 bump

### SW_PATH_ALLOWLIST_HELPER（既存・無変更）

```js
// SOURCE: public/sw.js:41-45
function shouldCacheNavigate(pathname) {
  return NAVIGATE_CACHE_ALLOWLIST.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`),
  );
}
```

`/spectate` を allowlist に積むだけで `pathname === "/spectate"` または `pathname.startsWith("/spectate/")` のいずれかで true が返り、`/spectate/<tid>` がカバーされる。**関数本体は変更しない**（Phase D で確立した startsWith 判定を退行させない）。

### SW_NETWORK_FIRST（既存・無変更）

```js
// SOURCE: public/sw.js:119-140
async function networkFirst(req, url) {
  const cache = await caches.open(RUNTIME_CACHE);
  try {
    const res = await fetch(req);
    if (res && res.ok && shouldCacheNavigate(url.pathname)) {
      await cache.put(req, res.clone());  // M3 fix で await 済み
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
```

`/spectate/{tid}` も同経路で扱われる（allowlist 通過後に cache.put、offline 時は cache match → shell fallback の順）。**関数本体は変更しない**。

### SW_ACTIVATE_CACHE_CLEANUP（既存・無変更）

```js
// SOURCE: public/sw.js:75-88
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
```

`CACHE_VERSION` を `v3` に bump すると `SHELL_CACHE` / `RUNTIME_CACHE` の suffix が `-v3` に変わり、旧 `-v2` cache が `keys.filter(...)` で「現行と一致しない」と判定されて削除される。新規 cache (`-v3`) は SHELL_URLS の precache から再構築される（[public/sw.js:55-73](../../../../public/sw.js#L55-L73)）。

### SW_STATIC_CONTRACT_E2E（既存パターン）

```ts
// SOURCE: tests/e2e/phase-d-install-promotion.spec.ts:161-188
const res = await request.get("/sw.js");
const body = await res.text();

expect(body).toMatch(/const\s+CACHE_VERSION\s*=\s*"v2"/);
expect(body).toMatch(/NAVIGATE_CACHE_ALLOWLIST\s*=\s*\[\s*"\/"\s*,\s*"\/login"\s*\]/);
expect(body).toContain("function shouldCacheNavigate");
expect(body).toContain("trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES)");
```

Phase 4 で更新する箇所:

- `CACHE_VERSION` regex を `v3` に
- `NAVIGATE_CACHE_ALLOWLIST` regex に `/spectate` を含める

### TEST_STRUCTURE（vitest unit test for vanilla JS sw.js）

vitest unit テストから vanilla JS の関数を取り出して挙動検証する pattern。本 Phase で初導入するため新規 file:

```ts
// SOURCE: 本 Phase で新設 (src/lib/sw/sw-allowlist.test.ts)
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const swSource = readFileSync(resolve(__dirname, "../../../public/sw.js"), "utf8");

// NAVIGATE_CACHE_ALLOWLIST の配列リテラルを抽出（drift 検出も兼ねる）
const allowlistMatch = swSource.match(
  /const\s+NAVIGATE_CACHE_ALLOWLIST\s*=\s*(\[[^\]]+\])\s*;/,
);
if (!allowlistMatch) throw new Error("NAVIGATE_CACHE_ALLOWLIST not found in public/sw.js");

// shouldCacheNavigate 関数本体を抽出（function declaration ベース）
const fnMatch = swSource.match(
  /function\s+shouldCacheNavigate\(pathname\)\s*\{[\s\S]*?\n\}/,
);
if (!fnMatch) throw new Error("shouldCacheNavigate not found in public/sw.js");

// 抽出した allowlist + 関数を Node 上で評価し、シンプルなクロージャ関数として取り出す
const shouldCacheNavigate = new Function(
  "NAVIGATE_CACHE_ALLOWLIST",
  `${fnMatch[0]}\nreturn shouldCacheNavigate;`,
)(JSON.parse(allowlistMatch[1])) as (pathname: string) => boolean;

describe("public/sw.js: shouldCacheNavigate", () => {
  // ...behavior assertions
});
```

**MIRROR 元**: `vitest` を使った unit test 全般 ([src/lib/services/tournament-state.test.ts](../../../../src/lib/services/tournament-state.test.ts) のような pure 関数ベースの spec を踏襲)。`testing.md` の「characterization test ファースト」原則に沿い、**実装の内部詳細（regex 文字列等）に依存せず、観測可能な挙動（boolean 出力）のみを検証**する。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `public/sw.js` | UPDATE | `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` 追加 + `CACHE_VERSION` を `v2` → `v3` に bump（旧 cache 一掃） |
| `src/lib/sw/sw-allowlist.test.ts` | CREATE | `shouldCacheNavigate` の挙動 unit test（vitest）。allowlist drift 検出も兼ねる |
| `tests/e2e/phase-d-install-promotion.spec.ts` | UPDATE | static contract test の `CACHE_VERSION` regex と `NAVIGATE_CACHE_ALLOWLIST` regex を `v3` / `/spectate` 含みに同期 |
| `.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md` | UPDATE | Phase 4 行のステータスを `pending` → `in-progress`（plan 作成時点）→ 完了時に `complete` 化 + plan link / report link 追加 |
| `.claude/PRPs/04-spectate-mode/reports/phase-4-pwa-cache-allowlist-report.md` | CREATE | 実装レポート。Phase 1 / 2 / 3 と同形式（Validation Results / Files Changed / Tests Written / Next Steps） |

## NOT Building

- **`/spectate/[tid]` ページ本体の実装** — Phase 2 のスコープ。本 Phase は SW cache allowlist のみ
- **Toggle UI / 共有導線（dashboard / URL コピー / QR code / 一覧 badge）** — Phase 3 のスコープ
- **新規 PWA component の追加**（`PwaInstallPromotion` 系）— Phase D で完了済み
- **workbox / serwist の導入** — Phase D の Decisions Log で却下済み（Turbopack 互換性 + 自前 LRU で必要十分）
- **新規 cache strategy（stale-while-revalidate / max-age 制御）の追加** — 既存 `networkFirst` で「オンライン時は最新 / offline 時のみ cache」が満たせるため YAGNI。PRD の「stale 許容 = 数分（network-first or 短い max-age）」は network-first で実質 0 stale を選択
- **`MAX_RUNTIME_ENTRIES` の引き上げ** — 50 件で実運用上問題ない（観戦中の navigate は 1〜2 件 / `/_next/static/*` 等と合算）。引き上げが必要になったら observation phase で再評価
- **Service Worker registration 経路の変更** — `src/components/pwa/ServiceWorkerRegistration.tsx` は production gate のまま据え置き
- **CSP / X-Frame-Options 等の security headers 追加** — Phase D の S-L1 で別 PR スコープと整理済み、本 Phase 範囲外
- **`shouldCacheNavigate` の TypeScript 化 / sw.js → TS migration** — Phase D で却下済みの依存追加（Turbopack 互換）。drift 検出は本 Phase の unit test で十分
- **`pwa/*` 新規 AppError prefix 追加** — sw.js は logger.ts パイプラインを通さない（`error-logging.md` 対象外）。本 Phase で新規エラー code 追加なし
- **観戦経路の Firestore Rules read コスト最適化** — Phase 1 review LOW（後続 Phase TODO）として記録済み、本 Phase は SW 層のみ

---

## Step-by-Step Tasks

### Task 1: `public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` 追加 + `CACHE_VERSION` bump

- **ACTION**: `public/sw.js` の 2 箇所を更新する（最小 diff）
- **IMPLEMENT**:
  - 15 行目: `const CACHE_VERSION = "v2";` → `const CACHE_VERSION = "v3";`
  - 8-9 行目（先頭コメント）: Phase D の説明に観戦モードの allowlist 拡張を 1 行追記
    ```js
    // Phase 4 (04-spectate-mode): /spectate を NAVIGATE_CACHE_ALLOWLIST に追加し、
    //   会場 Wi-Fi 瞬断時に予備モニタが直前 HTML を保持できるようにする。
    //   network-first のため stale 許容範囲は数分以内。CACHE_VERSION v2 → v3 に bump し旧 cache を一掃。
    ```
  - 39 行目: `const NAVIGATE_CACHE_ALLOWLIST = ["/", "/login"];` → `const NAVIGATE_CACHE_ALLOWLIST = ["/", "/login", "/spectate"];`
  - 36-38 行目（allowlist 直前コメント）: 末尾に 1 行追加して観戦モードの位置づけを明示
    ```js
    // /spectate は anon 公開かつ tid 推測困難（base62 ≈ 117bit）のため共用端末漏えいリスク無し。
    // 会場予備モニタの瞬断耐性のため allowlist に含める（Phase 4 / 04-spectate-mode）。
    ```
- **MIRROR**:
  - 全体の vanilla JS スタイル: `public/sw.js` の現行 ESM 不可 / `// @ts-nocheck` / `/* eslint-disable */` 維持
  - allowlist 配列の追加形式: 既存の `["/", "/login"]` のように **alphabetical 順ではなく既存末尾追加** で diff を最小化
  - CACHE_VERSION bump コメント: Phase D plan の bump 解説 ([phase-d-install-promotion-and-polish.plan.md:497](../../03-pwa-app-shell/plans/completed/phase-d-install-promotion-and-polish.plan.md#L497))
- **IMPORTS**: なし（vanilla JS）
- **GOTCHA**:
  - `shouldCacheNavigate` 関数本体は **変更しない**。`/spectate` を 3 件目の要素として配列に積むだけで `pathname === "/spectate"` または `pathname.startsWith("/spectate/")` のいずれかで true が返る挙動が成立する
  - **`/spectate` の trailing slash の扱い**: `pathname.startsWith("/spectate/")` は `/spectate/<tid>` では true、`/spectatethief` のような prefix 偽マッチは false。これは Phase D L4 で議論された `/login/...` の prefix match と同じ設計（[review#L4](../../03-pwa-app-shell/reviews/local-phase-d-install-promotion-and-polish-review.md#L102-L107)）
  - **`v3` への bump で旧 install 端末の cache が一度全消し**される。SHELL_URLS は 7 件のみで再 precache のコストは数百 ms 以内（Phase D plan の評価と同一）
  - `RUNTIME_CACHE` 内の旧 navigate cache（`/` / `/login` 等）も全消しされ、初回再訪問で再 cache される。体感影響なし
  - `static SHELL_URLS` には `/spectate` を **追加しない**。`/spectate` は tid 必須の動的 route（`/spectate/[tid]`）であり、引数なしで存在する route ではない（Next.js 15 App Router の page.tsx は `[tid]` 配下にのみ存在）
- **VALIDATE**:
  - `npm run build` が壊れない（`public/sw.js` は build 時に静的 serve されるため transform はない、文法エラーのみ care）
  - `cat public/sw.js | grep -E 'CACHE_VERSION|NAVIGATE_CACHE_ALLOWLIST'` で `v3` / `/spectate` が visible
  - dev では SW 未登録のため挙動確認は production build (`npm run build && npm run start`) で行う

### Task 2: `src/lib/sw/sw-allowlist.test.ts` を新設し `shouldCacheNavigate` の挙動を pin

- **ACTION**: `public/sw.js` から `NAVIGATE_CACHE_ALLOWLIST` 配列と `shouldCacheNavigate` 関数本体を Node の `new Function` で抽出評価し、複数 path の boolean 出力を検証する unit test を作成
- **IMPLEMENT**:
  ```ts
  // src/lib/sw/sw-allowlist.test.ts
  import { readFileSync } from "node:fs";
  import { resolve } from "node:path";
  import { describe, expect, it } from "vitest";

  const swPath = resolve(__dirname, "../../../public/sw.js");
  const swSource = readFileSync(swPath, "utf8");

  // 1. NAVIGATE_CACHE_ALLOWLIST 配列リテラルの抽出（[ ... ]; までを greedy でなく lazy に拾う）
  const allowlistMatch = swSource.match(
    /const\s+NAVIGATE_CACHE_ALLOWLIST\s*=\s*(\[[^\]]+\])\s*;/,
  );
  if (!allowlistMatch) {
    throw new Error("NAVIGATE_CACHE_ALLOWLIST literal not found in public/sw.js");
  }
  // JSON.parse は double-quoted string array を期待するため、sw.js の表記がそのまま JSON 互換である前提
  const allowlist = JSON.parse(allowlistMatch[1]) as string[];

  // 2. shouldCacheNavigate function declaration の抽出
  const fnMatch = swSource.match(
    /function\s+shouldCacheNavigate\(pathname\)\s*\{[\s\S]*?\n\}/,
  );
  if (!fnMatch) {
    throw new Error("shouldCacheNavigate function not found in public/sw.js");
  }

  // 3. allowlist を引数で注入しつつ関数を取り出す
  const shouldCacheNavigate = new Function(
    "NAVIGATE_CACHE_ALLOWLIST",
    `${fnMatch[0]}\nreturn shouldCacheNavigate;`,
  )(allowlist) as (pathname: string) => boolean;

  describe("public/sw.js NAVIGATE_CACHE_ALLOWLIST contract", () => {
    it("Phase 4 で必要な 3 entry を含む", () => {
      // 順序非依存に「全部入っている」だけ pin する。順序を pin すると将来の追加で過剰 fail する
      expect(allowlist).toEqual(expect.arrayContaining(["/", "/login", "/spectate"]));
    });
  });

  describe("public/sw.js shouldCacheNavigate", () => {
    it.each([
      ["/", true],
      ["/login", true],
      ["/login/forgot-password", true], // 既存 prefix match を尊重
      ["/spectate", true],               // exact、今後の架空ルート用にも開けておく
      ["/spectate/abc123def456", true], // 主要 navigate target
      ["/spectate/t-1/sub", true],       // 階層深掘りも allowlist 配下で OK
    ])("allow: %s → %s", (path, expected) => {
      expect(shouldCacheNavigate(path)).toBe(expected);
    });

    it.each([
      ["", false],                        // 空文字（防御的に）
      ["/foo", false],
      ["/spectatethief", false],          // prefix 誤マッチ防止（"/spectate/" の trailing slash で守る）
      ["/groups/g-1", false],
      ["/tournaments/t-1", false],
      ["/tournaments/t-1/live", false],
      ["/settings", false],
      ["/account", false],
      ["/structures/s-1", false],
      ["/join/t-1", false],
    ])("deny: %s → %s", (path, expected) => {
      expect(shouldCacheNavigate(path)).toBe(expected);
    });

    it("ルート exact 判定が trailing-slash sensitive である（既存 sw.js#L42 の特例）", () => {
      // "/" は startsWith("//") に変わらないよう exact 判定をしている
      expect(shouldCacheNavigate("/")).toBe(true);
      expect(shouldCacheNavigate("//")).toBe(false);
    });
  });
  ```
- **MIRROR**:
  - vitest pure 関数 spec の構造: [src/lib/services/tournament-state.test.ts](../../../../src/lib/services/tournament-state.test.ts) の `describe` + `it.each` でテーブル駆動
  - drift 検出スタイル: [scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs) のように、ソースを文字列として読み込んで「期待値」と突き合わせる pattern を踏襲
  - error throwing on missing match: scripts 系 validator が `throw new Error(...)` で setup 失敗を即停止する pattern と同じ（`testing.md` の「skip 禁止」原則）
- **IMPORTS**:
  ```ts
  import { readFileSync } from "node:fs";
  import { resolve } from "node:path";
  import { describe, expect, it } from "vitest";
  ```
- **GOTCHA**:
  - **`new Function` の評価コンテキスト**: `self` / `caches` / `fetch` 等の SW グローバルにアクセスする関数は評価不可だが、`shouldCacheNavigate` は純粋に `pathname` と `NAVIGATE_CACHE_ALLOWLIST` のみを参照する pure 関数のため安全に evaluate できる。本 Phase ではこの仮定を破らない（sw.js 側で `shouldCacheNavigate` に SW グローバル依存を追加しない）
  - **regex 抽出の brittle 性**: `function shouldCacheNavigate(pathname) {` のシグネチャ表記が変わると test setup で `throw` する。これは drift 検出として意図的な挙動（誤 rename を fail で気付く）
  - **JSON.parse 前提**: `NAVIGATE_CACHE_ALLOWLIST` の配列リテラルは double-quoted string のみ、コメント / trailing comma / single quote を含めない。本 Phase では `["/", "/login", "/spectate"]` のシンプル形を維持する
  - **`__dirname` の解決**: `__dirname` は ESM では未定義のため、vitest config の `test.environment` が `"node"` であること、もしくは vitest の `import.meta.url` 経由を使う必要がある場合は調整。**本 codebase は CommonJS 互換の `__dirname` が利用可能** ([vitest.config.ts](../../../../vitest.config.ts) の現状を確認した上で、必要なら `fileURLToPath(import.meta.url)` に切替)
  - **vitest 環境での Node fs アクセス**: `vitest.config.ts` の `test.environment` は jsdom を使うことが多いが、`node:fs` は jsdom 環境でも動作する（Node API は jsdom と並立）
  - **新規 directory `src/lib/sw/`**: 既存 codebase に存在しない。test ファイル単独でも問題なく作れるが、将来 sw 関連 helper を集約するための naming hub として用意する。test ファイルだけ置く形でも構わない（`describe` の名前が `public/sw.js ...` になっているため場所より名前で意図伝達される）
- **VALIDATE**:
  - `npx vitest run src/lib/sw/sw-allowlist.test.ts` で全 case green
  - 意図的に sw.js の `NAVIGATE_CACHE_ALLOWLIST` から `/spectate` を一時削除すると `Phase 4 で必要な 3 entry を含む` ケースが赤になる（drift 検出の動作確認）
  - `npm test` 全件 green（既存 1213 件 + 本 Phase の約 13 ケース）

### Task 3: `tests/e2e/phase-d-install-promotion.spec.ts` の static contract regex を Phase 4 に同期

- **ACTION**: 既存 spec を**新規ファイル化せず in-place 更新**。Phase D で確立した「sw.js static contract test」は Phase 4 でも同じ contract で運用する形で、CACHE_VERSION と NAVIGATE_CACHE_ALLOWLIST の expected を変更する
- **IMPLEMENT**:
  - `tests/e2e/phase-d-install-promotion.spec.ts` の以下を更新:
    - 13 行目（先頭 JSDoc）: `Phase D で導入された invariant ...` の説明に `// + Phase 4 (04-spectate-mode): allowlist に /spectate 追加・CACHE_VERSION v3` を 1 行追記
    - 161 行目の test title: `"/sw.js が Phase D の invariant ... を保持する"` → `"/sw.js が Phase D + Phase 4 の invariant ... を保持する"` に同期
    - 173 行目の regex: `/const\s+CACHE_VERSION\s*=\s*"v2"/` → `/const\s+CACHE_VERSION\s*=\s*"v3"/`
    - 177 行目の regex: `/NAVIGATE_CACHE_ALLOWLIST\s*=\s*\[\s*"\/"\s*,\s*"\/login"\s*\]/` → `/NAVIGATE_CACHE_ALLOWLIST\s*=\s*\[\s*"\/"\s*,\s*"\/login"\s*,\s*"\/spectate"\s*\]/`
  - 説明コメントの「`"/" + "/login"` のみ」を「`"/" + "/login" + "/spectate"`」に同期（177 行目周辺）
- **MIRROR**:
  - 既存 spec の test 構造（`test.describe(...)` + `request.get("/sw.js")` + `body.text()` + `expect(...).toMatch(...)`）をそのまま流用
  - 新規 e2e ファイルは作らない（同じ static contract を 2 箇所で重複検査する DRY 違反を避ける）
- **IMPORTS**: 変更なし
- **GOTCHA**:
  - **e2e は `npm run test:e2e` で起動する**。本 Phase で新たな fixture / page object は不要（既存 `request.get` API のみ使用）
  - regex 内の `\s*` を保ちつつ要素を 1 つ追加する。`,` の前後の空白 patten は既存に合わせる
  - 本 spec は `Phase D` を冠してきたが、Phase 4 の追加更新を含むことで運用上は両 Phase の contract test を兼ねる。**新規 `phase-4-spectate-pwa-cache.spec.ts` を作らない**理由は、(1) e2e は同じファイルを fetch し同じ contract を検証するため重複、(2) test 数が増えるとローカル CI の起動オーバヘッドが増える、(3) Phase D plan の `Phase 完了後の保守` でも「同 spec を更新する」を前提としていた、の 3 点
  - test title 変更は **CI の test name を見て判断するスクリプト**（社内 monitoring / artifact 名）に影響しないか確認。本 codebase は test name で artifact 名を作っていないため安全
- **VALIDATE**:
  - `npm run build` 後に `npx playwright test tests/e2e/phase-d-install-promotion.spec.ts` で全 case green（4 case 想定: install banner 3 + sw.js contract 1）
  - `npm run test:e2e` の全件 green（regression なし）

### Task 4: PRD `04-spectate-mode.prd.md` の Phase 4 行ステータス更新

- **ACTION**: `/prp-plan` 規約に従い、plan 作成時点で Phase 4 を `pending` → `in-progress` に倒し、`PRP Plan` 列に本 plan ファイルへの relative link を追加。完了時は `/prp-implement` 後に `complete` に遷移する（本 Task は plan 作成時点の更新のみ）
- **IMPLEMENT**:
  - PRD の Implementation Phases 表 Phase 4 行（[04-spectate-mode.prd.md:182](../prds/04-spectate-mode.prd.md#L182)）:
    - `Status` を `pending` → `in-progress` に更新
    - `PRP Plan` を `-` → `[phase-4-pwa-cache-allowlist.plan.md](../plans/phase-4-pwa-cache-allowlist.plan.md)` に更新
- **MIRROR**: Phase 2 / 3 の plan 作成時の更新パターン（[04-spectate-mode.prd.md:180-181](../prds/04-spectate-mode.prd.md#L180-L181)）
- **IMPORTS**: なし（doc）
- **GOTCHA**:
  - **plan 作成時は `in-progress` 化のみ**、`complete` は実装完了 + `/prp-implement` のレポート生成時の遷移
  - PRD の `## Implementation Phases` 表以外（Phase Details 節等）はテキスト変更不要。`pending | in-progress | complete` のステータス遷移は表行のみが真実源
- **VALIDATE**:
  - `npm run lint` には影響しない（markdown）
  - 表の Markdown が崩れていないこと（パイプ `|` の数を保つ）
  - relative link が PRD ファイルからの相対パスで解決すること（`../plans/phase-4-pwa-cache-allowlist.plan.md`）

### Task 5: 実装レポート作成（実装完了時 / `/prp-implement` フェーズで完成させる雛形のみ用意）

- **ACTION**: `phase-4-pwa-cache-allowlist-report.md` を `/prp-implement` 後に作成する（plan の段階では空テンプレ言及のみ）。Phase 1 report ([phase-1-schema-rule-emulator-report.md](../reports/phase-1-schema-rule-emulator-report.md)) のフォーマットを踏襲
- **IMPLEMENT**: 実装完了時に以下のセクションを書く
  - Summary
  - Assessment vs Reality
  - Tasks Completed
  - Validation Results（`npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run test:e2e` / `npm run test:rules-spectate` の各結果）
  - Files Changed
  - Deviations from Plan（あれば）
  - Issues Encountered（あれば）
  - Tests Written
  - Code Review 反映（ローカルレビュー後の追加修正があれば）
  - Next Steps（**`firebase deploy --only firestore:rules` は本 Phase では不要**。sw.js / PWA cache のみ変更で Firestore Rules 変更なし。次のチェックは「Vercel deploy 後に DevTools の Application > Cache Storage で `allin-runtime-v3` に `/spectate/{tid}` が積まれていること」「会場予備モニタの Wi-Fi 瞬断 simulation で UI が直前 state を保持」など）
- **MIRROR**: [phase-1-schema-rule-emulator-report.md](../reports/phase-1-schema-rule-emulator-report.md) の節構造
- **IMPORTS**: なし
- **GOTCHA**:
  - **本 Phase は Firestore Rules 変更なし**のため、メモリ規約「Firestore rules 変更時は deploy 案内を必須」の適用対象外。代わりに「Vercel preview / production deploy 後の SW 更新確認」を Next Steps に明記する（CACHE_VERSION bump で旧 SW が新 SW に置き換わるまで `skipWaiting` + `clients.claim` の挙動を実機確認）
  - 報告対象の test 件数は plan 段階では未確定。`/prp-implement` 完了時点で confirm
- **VALIDATE**: report の link 切れなし、Phase 1 report と同じ節構造

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `NAVIGATE_CACHE_ALLOWLIST` に Phase 4 必須 3 entry が含まれる | sw.js 文字列読み込み + JSON.parse | `["/", "/login", "/spectate"]` を superset として含む | ✓ drift 検出 |
| `shouldCacheNavigate("/")` | exact match | true | ✓ root 特例 |
| `shouldCacheNavigate("//")` | trailing slash | false | ✓ exact 判定 sensitivity |
| `shouldCacheNavigate("/login")` | exact | true | - |
| `shouldCacheNavigate("/login/forgot-password")` | startsWith match | true | ✓ prefix |
| `shouldCacheNavigate("/spectate")` | exact | true | ✓ allowlist 由来 |
| `shouldCacheNavigate("/spectate/abc123def456")` | startsWith match | true | ✓ 主要 navigate |
| `shouldCacheNavigate("/spectate/t-1/sub")` | 多階層 | true | - |
| `shouldCacheNavigate("/spectatethief")` | prefix 偽マッチ | false | ✓ trailing slash 守備 |
| `shouldCacheNavigate("/groups/g-1")` | auth-aware | false | ✓ Phase D 既存契約 |
| `shouldCacheNavigate("/tournaments/t-1")` | auth-aware | false | ✓ 同上 |
| `shouldCacheNavigate("/tournaments/t-1/live")` | auth-aware nested | false | - |
| `shouldCacheNavigate("/settings" / "/account" / "/structures/s-1" / "/join/t-1")` | 各 auth-aware | false | - |
| `shouldCacheNavigate("")` | 空文字 | false | ✓ 防御的 |

### E2E Tests（既存 spec 更新）

| Test | Input | Expected Output |
| ---- | ----- | --------------- |
| `tests/e2e/phase-d-install-promotion.spec.ts` の sw.js static contract | `request.get("/sw.js")` の body 文字列 | `CACHE_VERSION = "v3"` / `NAVIGATE_CACHE_ALLOWLIST = ["/", "/login", "/spectate"]` / `shouldCacheNavigate` 関数定義あり / `trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES)` 呼出あり |

### Edge Cases Checklist

- [x] `/spectate` 単独 path（exact match）— allowlist の表記で OK、`pathname === "/spectate"` で true
- [x] `/spectate/{tid}`（startsWith match）— `pathname.startsWith("/spectate/")` で true
- [x] `/spectatethief` 等の prefix 偽マッチ防止 — startsWith は `${p}/` で trailing slash を強制
- [x] CACHE_VERSION bump で旧 cache 削除 — 既存 activate listener が処理（無変更）
- [x] `cache.put` race（Phase D M3）— 既に await 済みで本 Phase で再発しない
- [x] `RUNTIME_CACHE` の LRU（50 件上限）— `/spectate/{tid}` 追加で navigate 件数増えるが、observation phase で見直し対象（本 Phase では引き上げない）
- [x] dev では SW 未登録 — production build (`npm run build && npm run start`) で実機確認
- [x] vitest が `node:fs` を扱える — vitest.config.ts は jsdom 環境でも node API 並立で OK

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
# Phase 4 のみ
npx vitest run src/lib/sw/sw-allowlist.test.ts

# 全件
npm test
```

EXPECT: 全件 green。Phase 4 で約 13 ケース新規追加（drift check 1 + allow group 6 + deny group 6）

### Build

```bash
npm run build
```

EXPECT: `next build` Compiled successfully、`public/sw.js` が build 後の `.next` に static serve される

### E2E Tests

```bash
# Phase D / Phase 4 共有の static contract test
npx playwright test tests/e2e/phase-d-install-promotion.spec.ts

# 全件
npm run test:e2e
```

EXPECT: 全件 green。本 Phase は banner 系 e2e に影響しない（regex 更新のみ）

### Emulator Tests（regression のみ、Phase 4 は新規 rule 変更なし）

```bash
npm run test:rules-spectate
npm run test:rules-limits
```

EXPECT: 既存 14 ケース + 14 ケース が green（Phase 1 確立の rule contract に regression なし）

### Manual Validation（DevTools / 実機）

- [ ] `npm run build && npm run start` で production build 起動
- [ ] Chrome DevTools の Application → Service Workers で `v3` cache が生成されることを確認（旧 `v2` が一度に消えること）
- [ ] DevTools Network throttling を `Slow 3G` または Offline に切替
- [ ] `/spectate/{tid}` を online で 1 回開いて runtime cache に積ませる → Application → Cache Storage → `allin-runtime-v3` に `/spectate/{tid}` の navigate response がいることを目視
- [ ] Offline に切替えた状態で `/spectate/{tid}` をリロード → 直前 HTML が cache から返ってくること（shell `/` に化けない）
- [ ] Online 復帰後にもう一度リロード → 最新 HTML が fetch される（network-first 挙動）
- [ ] `/groups/{gid}` / `/tournaments/{tid}` を訪問 → cache に積まれていないこと（auth-aware path 既存挙動の retain）
- [ ] iOS Safari 実機で同じシナリオ（`Settings.app → Safari → Advanced → Experimental Features` から SW 確認）

---

## Acceptance Criteria

- [ ] `public/sw.js` の `NAVIGATE_CACHE_ALLOWLIST` に `/spectate` が含まれる
- [ ] `public/sw.js` の `CACHE_VERSION` が `"v3"` に bump されている
- [ ] `shouldCacheNavigate` 関数本体は変更されていない（startsWith 判定維持）
- [ ] `src/lib/sw/sw-allowlist.test.ts` が新設され、allow / deny の挙動を網羅 unit test で pin している
- [ ] `tests/e2e/phase-d-install-promotion.spec.ts` の `CACHE_VERSION` regex と `NAVIGATE_CACHE_ALLOWLIST` regex が `v3` / `/spectate` 含みに更新されている
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run test:e2e` の全 green
- [ ] PRD の Implementation Phases 表で Phase 4 が `in-progress`（plan 作成時）→ 完了時に `complete` 化される
- [ ] 実装レポート（`reports/phase-4-pwa-cache-allowlist-report.md`）が `/prp-implement` 完了時に生成される

## Completion Checklist

- [ ] コードが既存 sw.js パターン（vanilla JS / `// @ts-nocheck` / `/* eslint-disable */` / function declaration / `const` 大文字 SCREAMING_SNAKE_CASE）を踏襲
- [ ] 新規 npm 依存追加なし（workbox / serwist 等を入れない）
- [ ] sw.js の `console.warn` は維持（logger.ts は SW 内で利用不可）
- [ ] Firestore Rules / schema / repository / service / UI コンポーネントへの変更なし（sw.js + test のみ）
- [ ] `pwa/*` 新規 AppError prefix 追加なし（sw.js は error-logging.md の include 範囲外）
- [ ] PRD のスコープを超える追加変更なし（CSP / max-age / new cache strategy / workbox 追加 等は本 Phase 外）
- [ ] 実装内容が plan の "NOT Building" を侵していない
- [ ] code review (`/code-review`) を実施し、CRITICAL / HIGH 指摘なしで merge 可能な状態
- [ ] `/spectate/[tid]` ページ（Phase 2）と toggle UI（Phase 3）が完成していなくても本 Phase の test は green になる（並列実装可能性の維持 — Phase 2/3 が後追いで本 Phase の cache 効果を享受）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `CACHE_VERSION` bump 直後に旧 SW を握っている end user が再ロードするまで新 allowlist が効かない | M | L | SW の `skipWaiting` + `clients.claim` を Phase A から維持しているため、次回 navigate で v3 にスムーズ切替。観測 phase で実機確認を継続 |
| `shouldCacheNavigate` の startsWith 判定が将来の新規 path（例: `/spectate-admin/...` 仮想）と prefix 衝突 | L | M | trailing slash の `${p}/` で守備済み。`/spectate-admin` は `/spectate/` で startsWith しないため false に倒れる（unit test で pin） |
| vitest の `new Function` 評価で `__dirname` 解決が失敗 | L | L | vitest config の調整（`fileURLToPath(import.meta.url)` の fallback を Task 2 の GOTCHA で言及）。テスト失敗で即気付く |
| sw.js の文法エラーで `next build` が壊れる | L | H | `next build` は public/ 配下を transform しないため文法エラーは検出されない。**Task 1 完了直後に DevTools の Service Worker 登録ログを確認**して invalid script 起因の register 失敗を catch |
| `/spectate/{tid}` の HTML cache が auth-aware 情報を含む（Phase D の S-M1 と同じ漏えいリスク） | L | L | Phase 1 で確立した観戦モードの read-only スコープ（uid / displayName / 卓配置のみ）は意図的公開対象。共用端末で別ユーザに漏れても問題ない設計（PRD `What We're NOT Building` 参照） |
| `RUNTIME_CACHE` の 50 件上限を navigate 件数で超過する | L | L | navigate は `/spectate/{tid}` + `/` + `/login` の最大 3 件 / `/_next/static/*` が 47 件まで残存可能。実用上不足しないが observation phase で監視 |
| iOS Safari の Service Worker 仕様差で `cache.match` が異なる挙動を取る | L | L | iOS は WebKit ベースで Cache API は標準準拠。実機検証 Manual Validation を必須化 |
| Phase 2 / 3 が並列で merge されると test fixture や e2e の競合が起きる | L | M | 本 Phase は sw.js + test のみで Phase 2/3 とファイル境界が明確分離。git の merge は cleanly 通る想定 |

## Notes

- **Phase 4 の独立性**: Phase 1（schema + rule）に依存しない。`/spectate/[tid]` ページが未完成でも sw.js の allowlist 拡張は無害（cache 対象 path は実在しないため何も積まれない）。Phase 2 / 3 完了後に observation phase で「allowlist が実際に効いている」ことを確認する流れ
- **stale 戦略の選択理由**: PRD は「数分以内」を許容しているが、`networkFirst` を選ぶことで online 時の stale を実質 0 にできる（network 失敗時のみ cache）。`staleWhileRevalidate` を選ぶと online 時にも cache を返してしまい「数分前のブラインドを表示」リスクが発生する。本 Phase は network-first 一択
- **CACHE_VERSION bump の波及**: SHELL_URLS の precache 7 件がすべて再 fetch される。`/` / `/login` / `/manifest.webmanifest` / icons 4 件で総ペイロード約 30〜80KB（環境依存）。会場の Wi-Fi が安定している前提なら数百 ms で完了
- **error-logging.md の include 範囲外**: `public/sw.js` は本 codebase の AppError ラップ義務を持たない。`console.warn` で握る既存 pattern をそのまま踏襲する。新規 `pwa/*` prefix は導入しない（Phase D の M2 で既に追記済み）
- **observation phase との関係**: 本 Phase 完了は「実装＋ test green」までで、「会場予備モニタの瞬断 UX 改善」効果の検証は report の Manual Validation TODO に積む。Success Metric への寄与は PRD の「観戦モード ON 率 30%」とは独立した間接効果（投影 UX の信頼性向上）
- **Phase 完了後**: `/prp-implement` → `/code-review` → `/prp-pr` の順で進める。PR タイトルは「feat: 観戦モード Phase 4 - PWA cache allowlist に /spectate を追加」相当。Firestore Rules 変更なしのため `firebase deploy --only firestore:rules` は不要、Vercel deploy のみで反映完了
