# Local Review: Phase D — Install Promotion & Polish

**Reviewed**: 2026-05-09
**Author**: Kujo-n
**Branch**: develop（uncommitted local changes）
**Decision**: APPROVE with comments

## Summary

Phase D は「PWA インストール促進 UI（`PwaInstallPromotion` / `IOsInstallHint` の dismiss 化 + トップ画面 `/` への mount 集約）」と「Service Worker hardening（path allowlist + 簡易 LRU + `CACHE_VERSION` v1→v2）」の 2 軸を実装し、Phase A の M2 / M3 / S-M1 / S-M2 を解消している。Tier 1 検証（typecheck / lint / unit 1194 件 / build）はすべて green、設計判断（role gating を mount 点限定に置換）の理由も PRD / report に明記済みで、merge 可能な完成度。CRITICAL / HIGH の指摘なし。MEDIUM 3 件 / LOW 5 件は次回 architect-refactor もしくは observation phase での改善候補。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M1. `PwaInstallPromotion.tsx:107-127` — `prompt()` 失敗パスのテスト欠落**

[src/components/pwa/PwaInstallPromotion.tsx:107-127](src/components/pwa/PwaInstallPromotion.tsx#L107-L127) の catch 分岐で `persistDismissedAt(Date.now())` + `setDismissed(true)` を実行する経路が単体テストでカバーされていない。

実装レポートでは「想定外のブラウザ実装で `prompt()` が reject するケースで毎回ボタンを出し続けると UX が荒れるため、失敗時も dismiss として扱う」と意図的な分岐として明示しているが、`PwaInstallPromotion.test.tsx` の 9 ケース（event 未捕捉 / capture+preventDefault / accepted / dismissed / 「今は閉じる」/ appinstalled / 5d / 31d / private mode の setItem throw）には該当ケースがない。

**修正案**: `makeBeforeInstallPromptEvent` の `prompt: vi.fn().mockRejectedValue(new Error("..."))` パターンを追加し、(1) banner が消える / (2) `localStorage` に dismissedAt が書かれる / (3) `pwa/install-prompt-failed` の warn が出る、の 3 点を assert する 1 ケースを追加。

[src/components/pwa/PwaInstallPromotion.tsx:107](src/components/pwa/PwaInstallPromotion.tsx#L107)

---

**M2. 新規 `AppError` prefix `pwa/*` が `error-logging.md` のドメインコード表に未追記**

[src/components/pwa/IOsInstallHint.tsx:36,51](src/components/pwa/IOsInstallHint.tsx#L36) / [src/components/pwa/PwaInstallPromotion.tsx:42,57,119](src/components/pwa/PwaInstallPromotion.tsx#L42) で `pwa/storage-failed` / `pwa/install-prompt-failed` を新規導入している。

[.claude/rules/error-logging.md](.claude/rules/error-logging.md) のドメインコード一覧は `firestore/*` / `auth/*` / `tournament/*` / `validation/*` / `seating/*` / `group/*` / `season/*` を例示しており、Phase A `season/*` 追加時には同 file を更新する慣行（"`season/*` — シーズン管理起因（Phase A 追加。…）"）が確立されている。`pwa/*` も同様に追記しておかないと、grep で「未知 prefix が許可済みか」を判断する後続レビューで揺らぎが出る。

**修正案**: [.claude/rules/error-logging.md](.claude/rules/error-logging.md) の prefix 表に `pwa/* — PWA インストール / SW / ストレージ起因（Phase D 追加。`pwa/storage-failed` / `pwa/install-prompt-failed`）` を 1 行追記。code 側変更は不要。

---

**M3. `public/sw.js` — `cache.put` と `trimCache` の race**

[public/sw.js:122-127](public/sw.js#L122-L127) / [public/sw.js:144-149](public/sw.js#L144-L149) いずれも:

```js
cache.put(req, res.clone());                                // promise 未 await
trimCache(RUNTIME_CACHE, MAX_RUNTIME_ENTRIES).catch(() => {}); // 直後に fire-and-forget
```

`cache.put` 完了前に `trimCache` が `cache.keys()` を取ると、新エントリがまだ index に登録されないため、結果として「今回追加した分は count されず、間引きが 1 cycle 遅れる」race が成立する。

実害は RUNTIME_CACHE の entry 数が一時的に 50 → 51 に振れる程度で quota 的には許容範囲だが、コメント (`// fire-and-forget eviction. 失敗しても次の put で再評価されるため握る。`) は「失敗時の話」しか説明しておらず、成功時にも `trimCache` 起動のタイミングで race を持つ点が読めない。

**修正案（軽い順）**:
- (a) `await cache.put(...)` を入れて trimCache の前に index 確定させる（最もシンプル / 1 行 + 関数を `async` 化）
- (b) `cache.put().then(() => trimCache(...))` で順序を担保
- (c) コメントだけ補強し race window の存在を明記する

PWA install 端末の長期運用で `MAX_RUNTIME_ENTRIES` 周辺を行ったり来たりする状況では (a) が無難。

[public/sw.js:122](public/sw.js#L122) / [public/sw.js:144](public/sw.js#L144)

### LOW

**L1. `STORAGE_KEY` / `THIRTY_DAYS_MS` / `readDismissedAt` / `persistDismissedAt` のコピペ重複**

[src/components/pwa/IOsInstallHint.tsx:23-56](src/components/pwa/IOsInstallHint.tsx#L23-L56) と [src/components/pwa/PwaInstallPromotion.tsx:29-62](src/components/pwa/PwaInstallPromotion.tsx#L29-L62) で完全に同一の helper を持つ。

実装レポート Deviations の通り「最初は inline で OK、必要なら抽出」を承知の上で inline 配置されており、現時点では問題なし。次回 architect-refactor で `src/lib/services/install-dismiss.ts`（または `src/components/pwa/install-dismiss.ts`）に抽出することを推奨。`pwa/storage-failed` の AppError ラップ・logger.warn 経路も集約できる。

---

**L2. `RUNTIME_CACHE` を navigate cache と static cache で共有することの読み取りにくさ**

[public/sw.js:17-21](public/sw.js#L17-L21) で `RUNTIME_CACHE = allin-runtime-${CACHE_VERSION}` を navigate (`networkFirst`) と static (`staleWhileRevalidate`) の両方が共用しているため、`MAX_RUNTIME_ENTRIES = 50` は **両者合計**の上限になる。

precache の `/` shell は `SHELL_CACHE` 側にあるため `caches.match("/")` のフォールバックに乗り、navigate 用の最終 fallback は壊れない。しかし `/_next/static/*` の流入で `/login` の navigate cache が evict されることはあり得る（`/login` は SHELL_CACHE に precache 済みのためここも実害なし）。

設計意図はコメントに表現されているが、`MAX_RUNTIME_ENTRIES = 50` のすぐ脇に「navigate + static の合算上限。precache 側は SHELL_CACHE に常駐なのでフォールバック保証は維持」を 1 行補足するとレビュアーフレンドリー。

[public/sw.js:21](public/sw.js#L21)

---

**L3. `accepted` 後に `appinstalled` が来ないブラウザでの永続化漏れ**

[src/components/pwa/PwaInstallPromotion.tsx:108-115](src/components/pwa/PwaInstallPromotion.tsx#L108-L115) の `userChoice.outcome === "accepted"` 分岐は `localStorage` に書かず、`appinstalled` listener に永続化を委ねている（コメントの設計判断通り）。ただし `appinstalled` event が発火しないブラウザ実装、または PWA 化途中で失敗するエッジケースでは、`event` を `null` にして banner を一時 hide した状態で persistent dismiss が掛からない。

次回 visit で `beforeinstallprompt` が再発火しないと banner は出ないため通常はユーザに見えないが、再発火する実装ではすぐ banner が戻る。

**緩和**: `accepted` 分岐でも `setDismissed(true)` + `persistDismissedAt(Date.now())` を入れて TTL に倒すと安全側（`appinstalled` 受信時に再度書かれるが冪等）。ただし「accepted 後 OS install dialog で cancel した」場合に dismiss される可能性もあるため、トレードオフ。

[src/components/pwa/PwaInstallPromotion.tsx:108](src/components/pwa/PwaInstallPromotion.tsx#L108)

---

**L4. `shouldCacheNavigate("/login/...")` の prefix match は将来想定**

[public/sw.js:41-45](public/sw.js#L41-L45) で `/login/...` も allowlist 対象になっているが、現状アプリに `/login` 配下のサブルートはない。将来 `/login/forgot-password` 等を予期した設計なら docstring に明記、不要なら exact match `pathname === "/login"` に絞ったほうが意図が明確。

[public/sw.js:39](public/sw.js#L39)

---

**L5. iOS hint テストの `setUserAgent` 副作用が test 間に持続**

[src/components/pwa/IOsInstallHint.test.tsx:11-16](src/components/pwa/IOsInstallHint.test.tsx#L11-L16) の `setUserAgent` は `Object.defineProperty(navigator, "userAgent")` で getter を上書きしている。`beforeEach` で毎回 Linux UA に戻しているため現状は問題ないが、`afterEach` 側でも同様に reset しておくと test 単独実行時 / 失敗 reproduction 時に safety net になる。Phase A から続く既存パターンのため Phase D で必須ではない。

[src/components/pwa/IOsInstallHint.test.tsx:11](src/components/pwa/IOsInstallHint.test.tsx#L11)

## Validation Results

| Check      | Result |
| ---------- | ------ |
| Type check | Pass（`tsc --noEmit` 0 errors） |
| Lint       | Pass（`next lint` 0 warnings / 0 errors） |
| Tests      | Pass（vitest 1194 / 1194、Phase D 関連 16 件: PwaInstallPromotion 9 + IOsInstallHint 7） |
| Build      | Pass（`next build` Compiled successfully） |

## Files Reviewed

| File | Action |
| ---- | ------ |
| `.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md` | Modified — Phase D 表更新 + role gating 廃止の Decisions Log |
| `public/sw.js` | Modified — allowlist + LRU + v2 bump |
| `src/app/layout.tsx` | Modified — `IOsInstallHint` mount 除去 |
| `src/app/page.tsx` | Modified — `PwaInstallPromotion` + `IOsInstallHint` mount |
| `src/components/pwa/IOsInstallHint.tsx` | Modified — dismiss 経路追加・30 日 TTL |
| `src/components/pwa/IOsInstallHint.test.tsx` | Modified — dismiss / 5d / 31d ケース追加（4→7 件） |
| `src/components/pwa/PwaInstallPromotion.tsx` | Added — Android Chrome 系 install promotion |
| `src/components/pwa/PwaInstallPromotion.test.tsx` | Added — 9 件（accepted / dismissed / appinstalled / TTL 境界 / private mode） |
| `.claude/PRPs/03-pwa-app-shell/plans/completed/phase-d-install-promotion-and-polish.plan.md` | Added — 完了済み plan |
| `.claude/PRPs/03-pwa-app-shell/reports/phase-d-install-promotion-and-polish-report.md` | Added — 実装レポート |

## Next Steps

- M1（prompt() reject テスト追加）と M2（error-logging.md への `pwa/*` 追記）は本 PR に追加 commit するのが軽い。M3（`cache.put` の await）は `await` を 1 行入れるだけなので同 PR で対応推奨。
- L1〜L5 は次回 architect-refactor 観点での observation phase 中の判断で良い。
- 実機検証ログ（report 末尾の TODO）は別タスクとして PR マージ後・本番 deploy 後に消化する。
- PRD 03 の S-L1（CSP / security headers）は Phase D scope 外として明示済み、別 PR で起票するか観測フェーズで判断。
