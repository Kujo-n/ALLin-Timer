# Implementation Report: Phase A — PWA Foundation

## Summary

Next.js 15 公式 PWA ガイドの素 SW 構成で **manifest / Service Worker / アイコン素材 / iOS meta tags / iOS install hint** を整備し、ALLin-PokerTimer をホーム画面に追加可能な PWA に変えた。Service Worker は `HTML network-first` / `静的アセット stale-while-revalidate` / `Firestore は SW で扱わない` のキャッシュ戦略で、一時通信障害時に UI が真っ白にならないアプリシェルを提供する。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                  |
| ------------- | ---------------- | ----------------------- |
| Complexity    | Medium           | Medium                  |
| Confidence    | n/a              | High（手戻りなし）      |
| Files Changed | 約 12            | 13（生成スクリプト含む）|

## Tasks Completed

| # | Task | Status | Notes |
|---|------|--------|-------|
| 1 | `app/manifest.ts` 作成 | done | プラン通り |
| 2 | `public/sw.js` 作成 | done | precache を `Promise.all(map(cache.add().catch))` 形式にして個別 entry 失敗で全体崩壊しないよう調整（プランの `cache.addAll` から微変更） |
| 3 | SW 登録 client component | done | プラン通り |
| 4 | `app/layout.tsx` 更新 | done | `metadata` に PWA 系プロパティを追加、`viewport` export を新設、`<IOsInstallHint />` / `<ServiceWorkerRegistration />` を mount |
| 5 | アイコン素材配置 | done | `scripts/generate-pwa-icons.mjs` で sharp + SVG monogram から 4 PNG を生成（バイナリ commit） |
| 6 | `IOsInstallHint` component | done | プラン通り |
| 7 | `IOsInstallHint` 単体テスト | done | 4 ケース全 pass |
| 8 | `next.config.ts` の `/sw.js` headers | done | プラン通り |
| 9 | `vitest.config.ts` の coverage exclude | done(no-op) | プランの GOTCHA 通り `coverage.include` が `src/lib/**` のみのため exclude 追加不要 |
| 10 | README に PWA 動作確認セクション追記 | done | 「E2E テスト」セクション直前に追加 |

## Validation Results

| Level           | Status | Notes |
|-----------------|--------|-------|
| Static Analysis | Pass   | typecheck / lint 共に zero error |
| Unit Tests      | Pass   | 全 1145 tests pass、IOsInstallHint 4 ケース pass |
| Build           | Pass   | `next build` zero error、`/manifest.webmanifest` static route 生成、bundle 異常なし |
| Integration     | Pass   | 本番モード起動 (`npm run start`) → `curl /manifest.webmanifest` valid JSON、`curl -I /sw.js` で `Cache-Control: no-cache, no-store, must-revalidate` + `Content-Type: application/javascript`、`/icons/icon-192.png` 200/`image/png` |
| Edge Cases      | Pass   | 非 iOS / iPhone non-standalone / iPhone standalone display-mode / iPad navigator.standalone fallback の 4 分岐を unit test で検証 |

### HTML head 検証（curl `/`）

inject 確認済み:
- `<link rel="manifest" href="/manifest.webmanifest" />`
- `<meta name="theme-color" content="#0a0a0f" />`
- `<meta name="mobile-web-app-capable" content="yes" />`
- `<meta name="apple-mobile-web-app-title" content="ALLin-PokerTimer" />`
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />`
- `<link rel="icon" href="/icons/icon-192.png" sizes="192x192" type="image/png" />`
- `<link rel="icon" href="/icons/icon-512.png" sizes="512x512" type="image/png" />`
- `<link rel="apple-touch-icon" href="/icons/apple-icon-180.png" sizes="180x180" type="image/png" />`
- `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />`

## Files Changed

| File | Action | Notes |
|------|--------|-------|
| `src/app/manifest.ts` | CREATED | Next.js 15 metadata API |
| `public/sw.js` | CREATED | 素 SW（precache + network-first / SWR） |
| `public/icons/icon_pwa.png` | CREATED | 運営者提供のロゴ（赤円 + 白三角 + "ALL IN" 文字、912×1146、source）|
| `public/icons/icon-192.png` | CREATED | 192×192、icon_pwa から生成（透明背景の円） |
| `public/icons/icon-512.png` | CREATED | 512×512、同上 |
| `public/icons/icon-512-maskable.png` | CREATED | 512×512、icon_pwa を 80% 縮小 + 白背景（赤円との境界がはっきり見えるよう）|
| `public/icons/apple-icon-180.png` | CREATED | 180×180、白背景（iOS は透過不可・自動角丸化、赤円が明確に分離）|
| `scripts/generate-pwa-icons.mjs` | CREATED | sharp で `icon_pwa.png` を trim → 円形マスク → 4 サイズへ書き出し |
| `src/components/pwa/ServiceWorkerRegistration.tsx` | CREATED | production gate + feature detection |
| `src/components/pwa/IOsInstallHint.tsx` | CREATED | iOS UA + 非 standalone で表示 |
| `src/components/pwa/IOsInstallHint.test.tsx` | CREATED | 4 ケース |
| `src/app/layout.tsx` | UPDATED | metadata 拡張 + viewport export + 2 component mount |
| `next.config.ts` | UPDATED | `headers()` で `/sw.js` の Cache-Control + Content-Type |
| `README.md` | UPDATED | 「PWA 動作確認」セクション追加 |

## Deviations from Plan

1. **`public/sw.js` の precache 戦略**: plan の `cache.addAll(SHELL_URLS)` を `Promise.all(SHELL_URLS.map(url => cache.add(url).catch(() => {})))` に変更した。理由は deploy 直後に `/login` が一時的に 404 等となっても icon の precache を成功させたいため（addAll は 1 件失敗で全体 reject）。
2. **アイコン素材の生成手段**: plan は「Figma / AI で手動作成」を提案していたが、運営者から source ロゴ（`public/icons/icon_pwa.png` — 赤円 + 白三角 + "ALL IN" 文字）の提供を受けたため、`scripts/generate-pwa-icons.mjs` で sharp ベースの自動変換に切替。trim → 円形マスク（dest-in 合成で四隅の白を透明化）→ 4 サイズ書き出し。ロゴ差し替え時は source を更新して再実行するだけで済む。当初プランの "AT" monogram は採用せず。
3. **`vitest.config.ts` の更新**: plan の Task 9 通り、`coverage.include` が `src/lib/**/*.ts` 限定で `src/components/pwa/*` は元から対象外のため変更不要（plan の GOTCHA に明記済み）。

## Issues Encountered

なし。typecheck / lint / test / build 全 first-pass green、HTTP 整合性も初回確認 OK。

## Tests Written

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `src/components/pwa/IOsInstallHint.test.tsx` | 4 | non-iOS / iPhone non-standalone / iPhone standalone / iPad fallback |

`ServiceWorkerRegistration` は `navigator.serviceWorker.register` の jsdom 再現が複雑かつ価値低のため unit test 対象外。手動 / Lighthouse / 実機で検証。

## Next Steps

- [ ] 実機 iOS Safari + Android Chrome で「ホーム画面に追加」→ standalone 起動確認（Vercel preview / 本番 deploy 後）
- [ ] Chrome DevTools Lighthouse → PWA: Installable + Service Worker = green の visual 検証
- [ ] Phase B（auto-advance fallback）の plan 起こし（`/prp-plan` を Phase B 用に走らせる）
- [ ] PRD の Implementation Phases 表で Phase A を `in-progress` → `complete` に更新
- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`

## 実機検証ログ（TODO — 担当者が記入）

Vercel preview / 本番 deploy 後に以下を実機で確認し、結果を本セクションに追記する。
レビュー（`local-phase-a-c-pwa-review.md`）で「Suggested Next Steps 4」として依頼している項目。
README の「PWA 動作確認（Phase A 以降）」セクションの手順に従う。

### Lighthouse PWA スコア（Chromium 系で実測）

| 端末 / 環境 | 実施日 | Installable | Service Worker | 備考 |
| --- | --- | --- | --- | --- |
| デスクトップ Chrome（Lighthouse mobile preset） | _未実施_ | _Pass / Fail_ | _Pass / Fail_ | 警告 0 件であること |
| Android Chrome 実機 | _未実施_ | _Pass / Fail_ | _Pass / Fail_ | 「ホーム画面に追加」プロンプトが出る |

### iOS Safari 16.4+ 実機

| 確認項目 | 結果 |
| --- | --- |
| 共有 → ホーム画面に追加 で apple-touch-icon が表示される | _未実施_ |
| 起動アイコンタップで standalone 起動（URL バー / タブが消える） | _未実施_ |
| `IOsInstallHint` が Safari タブ閲覧時に表示され、standalone 起動後は非表示 | _未実施_ |
| Phase C: 横向き固定 / 画面消灯防止が working（running 中） | _未実施。Wake Lock は iOS 16.4+ 必須_ |

### DevTools Application パネル（手元の Chromium で）

| 確認項目 | 結果 |
| --- | --- |
| Application → Manifest が green（警告 0 件、`Add to homescreen` ボタン active） | _未実施_ |
| Application → Service Workers に `sw.js` が `activated and is running` | _未実施_ |
| Application → Cache Storage に `allin-shell-v1` / `allin-runtime-v1` が表示 | _未実施_ |
| Network タブで `Offline` チェック後の navigation が cache hit でシェル表示される | _未実施_ |
