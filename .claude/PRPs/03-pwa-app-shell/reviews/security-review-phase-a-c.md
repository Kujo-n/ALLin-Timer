# Security Review: PWA Phase A + Phase C

**Reviewed**: 2026-05-08
**Branch**: develop（main から 11 commits ahead）
**Scope**: 03-pwa-app-shell の Service Worker / PWA manifest / Wake Lock / Orientation Lock / AudioContext resume の全変更
**Reviewer perspective**: OWASP / Web Platform security focus（既存の local code review とは独立に security のみ評価）
**Decision**: **APPROVE**（CRITICAL / HIGH なし、MEDIUM 2 件 / LOW 3 件 / Informational 3 件）

## Summary

PWA 化（Service Worker 登録・manifest・端末 API 統合）は OWASP Top 10 / SW 固有の典型脆弱性に対して堅実な実装で、HIGH 以上のリスクは検出されなかった。秘密情報・XSS・SQLi・SSRF・CSRF・unsafe deserialization の attack surface はいずれも増えていない。ただし、Service Worker が `request.mode === "navigate"` の HTML を **無制限・user-agnostic に runtime cache へ蓄積**する点が将来的な情報漏えいベクタになりうるため、SSR が user-private データを返さない契約を明文化することを推奨する。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

#### S-M1. Service Worker が `mode === "navigate"` の HTML を user-agnostic に runtime cache へ格納

[public/sw.js:73-76](public/sw.js#L73-L76)・[public/sw.js:92-108](public/sw.js#L92-L108)

`networkFirst()` は `cache.put(req, res.clone())` を成功 HTTP 応答に対して実行する。SW は Browser のグローバルなオリジン単位 Cache に書き込むため、**同一ブラウザを複数ユーザが共有する端末**（運営者の共用 PC・キオスク）では:

- ユーザ A がログイン中に取得した HTML（`/groups/[gid]` 等）が `RUNTIME_CACHE` に残留
- ユーザ B が同端末でログイン後にオフラインで同 URL を踏むと、`networkFirst` の catch 句経由でキャッシュされた A 由来の HTML が返却される

**現状の影響**: 本アプリは "use client" 比重が高く、SSR HTML はほぼ静的シェル + 初期 placeholder。user-private 情報（displayName / 役割 chip / participant list）はクライアント側で `onSnapshot` 経由でハイドレーションする設計のため、cache に持ち込まれるのは「ログイン誘導付き空シェル」が大半で、**実害は現時点では極めて軽微**。

**ただし**: 今後、Server Component で `getServerSession`-相当のフローを足したり、`<title>{user.displayName} のサークル</title>` のような per-user metadata を SSR でレンダリングし始めると、即座に cross-user 漏えい経路が成立する。

**推奨対応（Phase D 以降）**:

1. SW の `networkFirst` の navigate 経路に **path allowlist** を導入し、`/`・`/login`・`/help` のような auth-free / user-agnostic な page のみ runtime cache する。`/groups/**` / `/tournaments/**` / `/settings` はキャッシュを bypass（fetch のみで cache.put しない）
2. `app/layout.tsx` および server component に「**user-private データを SSR HTML に埋めない**」契約をコメントで明記
3. Cookie / Authorization ヘッダ付きリクエストは `Vary: Cookie` を尊重しないと別ユーザ間で混線する。Next.js は基本的に static / RSC レイヤで `Set-Cookie` を扱わないため現状成立しているが、将来 cookie-based auth を入れる場合は再評価

ローカル code review の M3 と同根の指摘。security 観点では「現状実害は軽微だが、SSR の振る舞い変更で即座に脆弱化するため契約として固定すべき」というポイント。

---

#### S-M2. `RUNTIME_CACHE` にサイズ / TTL 上限がなく、storage quota 攻撃を受けやすい

[public/sw.js:96-98](public/sw.js#L96-L98)・[public/sw.js:113-115](public/sw.js#L113-L115)

`networkFirst` / `staleWhileRevalidate` のいずれも `cache.put` 後に entry 数 / バイト数の eviction を行わない。攻撃モデルは限定的（同一オリジンの認証必須エンドポイントが多い）が、以下のシナリオが残存:

- 攻撃者が認証経由で `/groups/[gid]` 等の **大量 distinct path** を踏むスクリプトを誘導 → quota 上限到達 → `cache.put` が `QuotaExceededError` で失敗 → 以降の precache 更新も同様に失敗 → **PWA の SW が deploy 後の更新を取りこぼし、古い shell に pin される DoS**
- 共用端末で他ユーザのキャッシュが quota を圧迫し、Wake Lock / Audio などのローカルストレージ依存機能が副次的に degrade する

**Mitigation**:

- 短期: `CACHE_VERSION` を bump すれば全 cache がまとめて消えるため、deploy 単位で運用上は緩和される
- 中期: navigate / static それぞれに entry 数の simple LRU（直近 N 件のみ保持）を `staleWhileRevalidate` 内で実装するか、[workbox-strategies](https://developer.chrome.com/docs/workbox/) に倒す検討

ローカル code review の M2 と同根。security 観点では「同一オリジン認証下の DoS なので一般 web に対する攻撃面ではないが、社内悪意ユーザによるサークル DoS（運営者端末の SW を死亡させる嫌がらせ）が成立する」という温度感。本 phase の MIT 公開・小規模サークル前提では受容可。

---

### LOW

#### S-L1. `next.config.ts` に CSP / X-Frame-Options / X-Content-Type-Options が未設定（pre-existing）

[next.config.ts:22-38](next.config.ts#L22-L38)

`/sw.js` への `Cache-Control: no-cache` のみ設定されており、グローバルな security headers が未定義:

- **Content-Security-Policy**: 未設定 → XSS 軽減層が browser default のみ
- **X-Frame-Options** / **frame-ancestors**: 未設定 → 任意の origin で iframe 埋め込み可能（clickjacking）
- **X-Content-Type-Options: nosniff**: 未設定 → MIME sniffing による drive-by 経路がわずかに残る
- **Referrer-Policy**: 未設定 → デフォルト `strict-origin-when-cross-origin`（OK）
- **Permissions-Policy**: 未設定 → wake-lock / fullscreen / microphone 等の policy が default

**注**: これは PWA Phase A で **新規導入された問題ではない** が、PWA 化により「同 origin の HTML が SW cache 経由でユーザに長期 served される」性質が強まったため、CSP の重要度がやや上がった。`script-src 'self' 'unsafe-inline'` の最低限ポリシーから始めるだけでも XSS の影響範囲を狭められる。Next.js の nonce-based CSP は middleware で実装する公式パターンあり（[Next.js docs: Content Security Policy](https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy)）。

**Recommendation**: 別 PR で `next.config.ts` の `headers()` に security headers を追加する Phase（PRD の Phase E? と並列化可能）を計画する。

---

#### S-L2. iOS Install Hint の UA sniffing が偽装可能（情報露出は無し）

[src/components/pwa/IOsInstallHint.tsx:20-29](src/components/pwa/IOsInstallHint.tsx#L20-L29)

`/iPad|iPhone|iPod/.test(navigator.userAgent)` は UA Client Hints 時代では非推奨、かつ簡単に偽装可能。ただし:

- 露出しているのは「Safari の共有ボタンを押す案内文」のみで攻撃者にとっての価値はゼロ
- 偽装してもサーバへ何も送信しない（純粋にローカル UI 切替）

⇒ **security 観点では問題なし**。aria の問題は local review M4 で別観点から指摘済み。

---

#### S-L3. Service Worker scope = `/` で全 origin path を支配（設計上は妥当）

[src/components/pwa/ServiceWorkerRegistration.tsx:24](src/components/pwa/ServiceWorkerRegistration.tsx#L24)

`navigator.serviceWorker.register("/sw.js", { scope: "/" })` は **オリジン全体**の fetch を SW が傍受する設計。SW 自身が悪意ある JS を送り込むまでは脅威にならないが:

- 万一 attacker が `/sw.js` の応答を改ざん（CDN / vercel deploy chain 侵害）した場合、攻撃者が **すべての fetch を operate** できる ⇒ persistent malware の経路
- これは PWA の宿命であり、Vercel + GitHub の deploy chain 信頼性に依存。`updateViaCache: "none"` + `Cache-Control: no-cache` で「古い SW pin」は防いでいるが、**SW 内容の真正性検証**は web platform に存在しない（subresource integrity は SW に未対応）

**Mitigation**:

- 既存の二重防御（`Cache-Control: no-cache` + `updateViaCache: "none"`）は適切
- deploy chain の整合性は別軸の話なので本 PR の責任範囲外
- 念のため: 将来 sw.js を分割 / 動的生成する場合は **同 origin の単一ファイル**に必ず留め、cross-origin 経由で読み込まない

---

### Informational

#### S-I1. `cache.put` 前に `res.ok` を確認しているが、`res.type === "opaque"` のチェックがない（影響なし）

[public/sw.js:96-97](public/sw.js#L96-L97)・[public/sw.js:115](public/sw.js#L115)

cross-origin 応答は line 70 の early return で SW 経路に乗らないため、現実には opaque 応答が `cache.put` に渡らない。今後 cross-origin を SW 経路に通すような変更が入った場合、opaque 応答（`res.type === "opaque"` / `res.status === 0`）は `res.ok` が false になるため `cache.put` されない仕様で偶然守られているが、明示的に `if (res && res.ok && res.type !== "opaque")` のガードを書いておくと安全。

#### S-I2. `request.method !== "GET"` で skip しており、POST/PUT/DELETE は SW を通らない（OK）

[public/sw.js:65](public/sw.js#L65)

mutation 系を cache に積む経路がないことは確認済。Firestore SDK は WebSocket / fetch ベースで動作するが、いずれも cross-origin で line 70 に当たるため、SW は Firestore 通信に一切干渉しない。良好。

#### S-I3. `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` の利用なし（XSS 0 件）

`d:\dev\ALLin-Timer\src` 全体を grep した結果、危険な動的 HTML / 動的コード生成 API の利用は 0 件。React の標準 escape に任せた healthy な実装。

#### S-I4. Wake Lock / Orientation Lock は user-gesture / standalone gating されており、無断使用なし

両 hook ともブラウザの permission モデル / display-mode 検出で early return する設計。ユーザ同意なしに OS リソースを掴むことはない。

#### S-I5. `scripts/generate-pwa-icons.mjs` は dev-only / 入力は repo 内の固定 png

[scripts/generate-pwa-icons.mjs:25-26](scripts/generate-pwa-icons.mjs#L25-L26)

`SOURCE` は `public/icons/icon_pwa.png` の固定パス。外部入力なし、SVG composite の input も固定文字列。XSS / path traversal / SSRF いずれも該当なし。

## Security Checklist

### 1. Secrets Management ✅

- [x] No hardcoded API keys, tokens, passwords in `public/sw.js` / `manifest.ts` / `next.config.ts` / generated icons
- [x] `.env*.local` / `.env` が `.gitignore` 済み（[.gitignore:28-29](.gitignore#L28-L29)）
- [x] `git ls-files` で `.env*` がコミット履歴に存在しない
- [x] PWA icons は運営者提供のロゴで個人情報なし

### 2. Input Validation ✅

- [x] PWA は user input を受けるエンドポイントを追加していない
- [x] `IOsInstallHint` の UA 検査はローカル UI 判定のみ（サーバ送信なし）
- [x] `useWakeLock` / `useOrientationLock` の引数は内部 boolean / enum のみで外部入力なし

### 3. SQL Injection ✅

- [x] Firestore 使用のため SQL 経路なし
- [x] PWA changes に DB 操作なし

### 4. Authentication & Authorization ✅

- [x] 既存の Firebase Auth フロー（`AuthProvider` / `RequireAuth` / Firestore Rules）に変更なし
- [x] SW は cross-origin 経路（Firestore / Google Auth）を傍受しない（[sw.js:70](public/sw.js#L70)）
- [x] 認証トークンは httpOnly cookie ではなく Firebase SDK 管理（IndexedDB ベース）— 既存設計、本 phase で変更なし

### 5. XSS Prevention ✅

- [x] `dangerouslySetInnerHTML` 不使用（grep 0 件）
- [x] React の標準 escape に依存
- [x] Service Worker はテンプレート文字列を HTML に注入しない
- [ ] **CSP 未設定**（S-L1 で指摘）

### 6. CSRF Protection ✅

- [x] state-changing 操作は Firestore SDK 経由で同 origin の Cookie を使わない（CSRF 概念上同等の問題なし）
- [x] PWA 変更で CSRF 攻撃面は増えていない

### 7. Rate Limiting N/A

- 本アプリは Cloud Functions / 自前 API を持たない（Firestore Rules のみ）。PWA changes に該当なし

### 8. Sensitive Data Exposure ✅

- [x] `logger.warn` 経由のログに UID / token などの secret は含まれていない
- [x] `AppError.from` で wrap した error の message はユーザ向け日本語文（技術スタック名なし、`feedback_no_tech_stack_in_user_messages.md` 準拠）
- [x] `console.*` 直呼びなし（[error-logging.md](.claude/rules/error-logging.md) 準拠）
- [ ] **SW HTML cache の cross-user 漏えい**（S-M1 で指摘、現状実害なし）

### 9. Dependency Security ✅

- [x] PWA Phase 追加 dep は `sharp`（icon generator script の dev tool 用途）のみ
- [x] [scripts/generate-pwa-icons.mjs](scripts/generate-pwa-icons.mjs) は dev-only、production bundle に含まれない
- [x] `package-lock.json` 更新分は本 PR 範囲（Phase A 着手時の `sharp` 追加）

### 10. Service Worker / PWA 固有

- [x] **SW scope** は `/` で広いが、設計上必要範囲（S-L3 informational）
- [x] **`updateViaCache: "none"`** + **`Cache-Control: no-cache`** の二重防御で SW 更新が確実に検出される（[next.config.ts:22-38](next.config.ts#L22-L38)）
- [x] **Cross-origin requests** は SW で扱わずスルー（[sw.js:70](public/sw.js#L70)）— Firestore / Google Auth 通信が SW に干渉されない
- [x] **GET only** で SW intercepts（[sw.js:65](public/sw.js#L65)）— mutation 系は cache に積まない
- [x] **Manifest** の `start_url` / `scope` は同 origin / `/` で他 origin への redirect なし
- [x] **Maskable icon** に safe area（80%）を確保し、display ロゴ自体に PII / 秘密情報なし
- [x] **`navigator.serviceWorker.register` は production のみ**（[ServiceWorkerRegistration.tsx:20](src/components/pwa/ServiceWorkerRegistration.tsx#L20)）— dev で SW が HMR を阻害しない
- [ ] **HTML navigate cache に user allowlist がない**（S-M1）
- [ ] **RUNTIME_CACHE eviction なし**（S-M2）

## Threat Model 観点での評価

| Threat                                       | 該当 finding | 評価                                                                                |
| -------------------------------------------- | ------------ | ----------------------------------------------------------------------------------- |
| Secret leakage in repo / build artifact      | -            | OK（grep 0 件、generated icons に EXIF などの metadata 残存もなし）                 |
| XSS via user content                         | S-I3         | OK（`dangerouslySetInnerHTML` 不使用 / React escape）                               |
| CSP bypass                                   | S-L1         | CSP 未設定（pre-existing）。PWA 化で重要度微増                                      |
| Cross-origin data leakage via SW             | S-M1         | 現状実害なし、SSR contract 明文化推奨                                               |
| Cache poisoning of `/sw.js`                  | -            | OK（`Cache-Control: no-cache` + `updateViaCache: "none"`）                          |
| Persistent SW malware via deploy compromise  | S-L3         | Vercel + GitHub の deploy chain 信頼に依存（既存リスク）                            |
| DoS via cache quota exhaustion               | S-M2         | 同一 origin 認証下なので攻撃面狭。CACHE_VERSION bump で緩和可能                     |
| Privilege escalation via Wake Lock / Orient. | -            | OK（user-gesture gating + feature detection）                                       |
| Audit / log tampering                        | -            | logger 経由で集中、`console.*` なし                                                 |
| Clickjacking                                 | S-L1         | X-Frame-Options / frame-ancestors 未設定（pre-existing）                            |

## Validation Results

| Check                          | Result   | Notes                                                                       |
| ------------------------------ | -------- | --------------------------------------------------------------------------- |
| Hardcoded secrets grep         | **Pass** | `apiKey` / `secret` / `password` / `token` 0 件（`public/` / `manifest.ts`）|
| Dangerous DOM API grep         | **Pass** | `dangerouslySetInnerHTML` / `innerHTML` / `eval` / `new Function` 0 件      |
| `.env*` git history audit      | **Pass** | コミット履歴に `.env*` 痕跡なし                                             |
| `.gitignore` env coverage      | **Pass** | `.env` / `.env*.local` が ignore 済み                                       |
| SW scope / cross-origin handling | **Pass** | Firestore / Google APIs は SW を通らない（line 70 で early return）         |
| SW method allowlist            | **Pass** | GET 以外は SW を通らない（line 65）                                         |

## Recommendations

### 本 PR でのアクション（最低限）

なし — 現状の attack surface に対して即時対応必須の脆弱性はない。

### Phase D 以降のフォローアップ（PRD への追記推奨）

1. **S-M1**: SW navigate cache の path allowlist 化 + SSR user-private データ禁止契約のコメント明記
2. **S-M2**: `RUNTIME_CACHE` の entry 数 LRU（最低 50 entry 程度）導入、または workbox 採用検討
3. **S-L1**: `next.config.ts` の `headers()` にグローバル security headers（CSP / X-Frame-Options / X-Content-Type-Options / Permissions-Policy）追加。Next.js 公式 nonce-based CSP パターンに倣う

### 中長期（別 PR / 別 Phase）

- Vercel deploy chain 監視（branch protection / required reviewers）— PWA は SW 経由で persistent な domain 支配権を持つため、deploy 経路の整合性が他の web app より重要
- Lighthouse PWA + Security audit を CI に追加し、回帰検出

## Files Reviewed（security 観点）

### High-impact（SW / 同 origin 全体に影響）

- [public/sw.js](public/sw.js) — Service Worker（fetch 戦略 / cache 設計）
- [next.config.ts](next.config.ts) — `/sw.js` の Cache-Control / Content-Type ヘッダ
- [src/components/pwa/ServiceWorkerRegistration.tsx](src/components/pwa/ServiceWorkerRegistration.tsx) — SW 登録（production 限定）

### Medium-impact（manifest / metadata）

- [src/app/manifest.ts](src/app/manifest.ts) — Web App Manifest
- [src/app/layout.tsx](src/app/layout.tsx) — `<link rel="manifest">` / appleWebApp / SW 登録 mount

### Low-impact（UI / 端末 API）

- [src/components/pwa/IOsInstallHint.tsx](src/components/pwa/IOsInstallHint.tsx)
- [src/components/tournament/DeviceFallbackHints.tsx](src/components/tournament/DeviceFallbackHints.tsx)
- [src/lib/hooks/useWakeLock.ts](src/lib/hooks/useWakeLock.ts)
- [src/lib/hooks/useOrientationLock.ts](src/lib/hooks/useOrientationLock.ts)
- [src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx](src/components/tournament/_timer-controls/TimerControlsRunningPaused.tsx)
- [src/components/tournament/_timer-controls/TimerControlsSeating.tsx](src/components/tournament/_timer-controls/TimerControlsSeating.tsx)
- [src/app/tournaments/[tid]/dashboard-client.tsx](src/app/tournaments/[tid]/dashboard-client.tsx)

### Out of security scope

- [scripts/generate-pwa-icons.mjs](scripts/generate-pwa-icons.mjs) — dev-only icon generator、固定入力
- [public/icons/*.png](public/icons/) — 静的アセット、metadata 確認済（PII なし）
- `.claude/PRPs/03-pwa-app-shell/**` — ドキュメントのみ

## 結論

PWA Phase A + Phase C の実装は OWASP / Web Platform security best practice に対して堅実で、CRITICAL / HIGH 級のリスクは検出されなかった。MEDIUM 2 件はいずれも将来の機能追加（SSR で user-private データを返す変更 / 大量 path への access）が起きたときに脆弱化する性質のもので、現状実害はない。**APPROVE for merge**。

ただし、SW は一度本番に出ると「全 fetch を支配する persistent な layer」になるため、Phase D で SW cache contract（S-M1 の allowlist + S-M2 の eviction）を整理するタイミングで CSP / 他 security headers（S-L1）も合わせて整備することを強く推奨する。
