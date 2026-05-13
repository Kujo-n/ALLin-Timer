# Post-Launch Polish（リリース後の小規模 UX 改善・プロモーション集約 PRD）

## Problem Statement

PRD 01〜04（Foundation / シーズン戦績 / PWA / 観戦モード）が完了しドライラン投入直前のフェーズに
入った時点で、コア機能の追加開発は概ね一段落している。一方で、ドライラン参加サークルからのフィードバック
や運営者ヒアリングを通じて、**「PRD として独立させるほど大きくはないが、ドライラン投入の効果を
左右する小〜中粒度の UX 改善 / プロモーション動線追加」**が継続的に発生する見込み。

これらを毎回新規 PRD として立てるのは粒度が合わず、かといって完了済み PRD（01〜04）に追記すると
[完了済み PRD への plan 後追い禁止](memory: feedback_no_plan_in_completed_prd) に抵触する。
そこで本 PRD は「リリース後の小規模 UX 改善 / プロモーション施策の集約コンテナ」として位置付け、
複数の独立 Track（カード装飾・公開記事リンク・将来の小改善 ...）を並列に持つ親 PRD とする。

## Evidence

- ドライラン由来の声（Foundation 質問の回答）:
  - 「結果カードに個性が無く SNS シェアしたくならない」
  - 「note 記事を書いたが、アプリのトップから記事への動線が無い」
- 観察:
  - 結果カード SSR は全サークル同一の amber/navy グラデーション固定
    （`src/app/api/og/_lib/og-card-styles.ts:11-21`）
  - トップ画面 `/`（`src/app/page.tsx`）はログイン CTA と一覧 CTA のみ。アプリ概要や運営チートシートへの
    動線ゼロ
  - PRD 01〜04 はいずれも `plans/` 直下が空（completed のみ）= immutable アーカイブ状態
- 仮説検証手段:
  - 各 Track 完了後にドライラン参加サークル代表からの定性フィードバック
  - 結果カード装飾は「使いたくなる / 使いたくない」「次回も使う」
  - 記事リンクは「アプリ説明をしやすくなった / 当日参照しやすくなった」

## Proposed Solution

リリース後の polish を **Track 単位**に分けて並列に進める。各 Track は独立にデプロイ可能で、
単一の Implementation Phase 群を持つ。Track 自体の追加（新 Track 起こし）は本 PRD の Decisions Log に
追記し、新規 plan を `.claude/PRPs/05-post-launch-polish/plans/` 配下に sequential に追加する形で運用する。

現時点で確定している Track:

- **Track A: Result Card Background Image**（結果カード背景画像カスタマイズ）
  - 旧 PRD `05-result-card-image-bg` の全内容を内包。Phase 1〜3 の構成は維持
- **Track B: Top Page Promotion**（トップ画面プロモーション動線）
  - note 公開記事 2 本（アプリ紹介 / 運営チートシート）へのリンク追加から開始
- **Track C: Dryrun Feedback Bundle**（ドライラン直後のフィードバック集約）
  - ドライラン投入直後に挙がった改善要望を「単発 PRD として独立させるほどの大きさはないが
    放置するとユーザー体験 / データ衛生に影響する」粒度で 1 phase = 複数改善の bundle として扱う
  - Phase C.1（本 batch）: トーナメントデフォルト名 + 一覧の参加済み表示 + 招待コード自動整理 + 匿名 Auth クリーンアップ script

将来的な追加 Track 候補（着手は別途判断）:

- Track D: 結果カードのテキストスタイル選択肢拡張
- Track E: 共有 URL 短縮 / カスタム OG image preset
- 他、ドライラン中に発生する小〜中規模の polish

## Key Hypothesis

**リリース直後の polish を「単一の集約 PRD」に束ねて段階的にリリースすれば**、ドライラン参加サークル
からの「使いたくなる / 次回も使う」シグナルが早期に集まり、コア機能開発の中断なく改善ループを
回せる。**仮説検証**: 本 PRD の Track A / Track B 完了後 1〜2 ヶ月で、初期サークル代表 3 名以上から
「ドライラン継続したい」「他サークルにも勧めたい」のポジティブフィードバックが得られる。

## What We're NOT Building

PRD 全体共通の非対象:

- **新規コア機能（席決めアルゴリズム / シーズン戦績 / PWA / 観戦モード等の本質的拡張）** —
  これらは独立 PRD として立てる
- **PRD 01〜04 で deferred 済みの大型機能** — 該当 PRD で reactivate するか新 PRD を立てる
- **ドライラン投入後 6 ヶ月以上経過しても採用シグナルが出ない場合のリブランド / 再設計** —
  別判断
- **本 PRD 内の Track をまたぐ機能横断ロジック** — 各 Track は独立性を保つ。横断的な共通 helper が
  必要になった時点で `src/lib/**` への抽出を別 plan で行う

Track A の非対象（旧 PRD から継承）:

- トーナメント単位の個別背景設定 / コラボ画像エディタ / シーズンごとに異なる背景 /
  owner 以外の設定権限拡張 / 画像タイル・クロップ UI / 複数画像ストック /
  シーズンスナップショット背景 / per-card text-theme override / AI 画像生成・テンプレート提供

Track B の非対象（plan ファイル参照）:

- URL を `src/app/page.tsx` 内に **ハードコードする**設計（MIT 公開リポジトリで個人 note アカウントが
  特定されるのを避けるため、環境変数化が必須）
- URL 定数の `src/lib/external-links.ts` への切り出し（env 化により定数集約は不要 / YAGNI）
- 新規 e2e spec 作成（PageObject の locator 追加で十分）
- ログイン状態によるリンク出し分け（両方常時表示）
- PWA manifest / install promotion への変更

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| Track A: 設定サークル数 | ドライラン後 1〜2 ヶ月以内に 3 サークル以上が `winnerCardBackground.imageUrl != null` | Firestore コンソールで `groups` collection の手動カウント |
| Track A: 定性フィードバック | サークル代表 3 名以上から「使いたくなる」「次回も使う」 | ドライラン後ヒアリング・Issue / Discord での声 |
| Track A: regression | カード生成 SSR の p95 latency が +200ms 以内、CDN cache hit rate 維持 | Vercel Analytics |
| Track B: 記事到達率 | リンク追加後 1 ヶ月で、note 記事の参照経由（リファラ allin-pokertimer.app）からの記事閲覧が月 10 回以上 | note アクセス解析（リファラ別） |
| Track B: 定性フィードバック | サークル代表から「アプリ説明がしやすくなった」または「当日参照しやすい」のポジティブ声 | ドライラン後ヒアリング |
| 全 Track 共通: 既存機能 regression | コア機能（タイマー / 席決め / シーズン戦績 / 観戦）のテスト全 green、E2E 全 green | `npm run test` / `npx playwright test` |

## Open Questions

- [ ] Track A: 画像クライアント圧縮の上限値 / storage.rules の content-type / size 制約 / テキストテーマ
      auto モード提供有無 / Storage 旧 asset の物理削除 vs 孤児放置 — Track A 各 Phase 実装計画で確定
- [ ] Track B: note 記事 URL の最終確定（実装直前にユーザ確認） / PWA standalone モードでの target="_blank" 挙動
      の OS 別差異の許容範囲 — Track B Phase 1 plan の Validation で確認
- [ ] 追加 Track（C 以降）の優先順位 — ドライラン投入後のフィードバック収集後に判断

---

## Users & Context

**Primary User**

- **Who**: サークル代表（owner）+ サークル運営担当（organizer）+ サークル参加者（member）。
  Track ごとに primary user が異なる
- **Track A primary**: サークル代表（owner） — ブランディング / 新規勧誘の文脈
- **Track B primary**: サークル代表 + 一般運営者 — 「アプリ何だっけ?」「操作どこだっけ?」の文脈

**Job to Be Done**

- Track A: When サークルのトーナメント / シーズン結果を SNS / サークル内チャットで共有するとき、
  I want カードに自分のサークルらしさを反映したい
- Track B: When 新規メンバーにアプリを紹介するとき / 当日操作を素早く確認したいとき、
  I want アプリのトップから記事に直接飛びたい

**Non-Users**

- Track A: organizer / member（v1 では設定不可、閲覧のみ）
- Track B: 全員に有効（出し分けなし）

---

## Solution Detail

### Core Capabilities (MoSCoW)

Track A:

| Priority | Capability | Rationale |
| --- | --- | --- |
| Must | owner がサークル詳細画面で **画像アップロード → 即時 Storage upload → groups doc update** | コア機能 |
| Must | owner が **背景画像を解除（null に戻す）** できる | 失敗時のリカバリ |
| Must | owner が **「ライト / ダーク」テキストテーマ**を選べる | 任意画像の可読性確保 |
| Must | OG SSR route が **背景画像 URL を query param で受け取り、fetch + data URI で Satori に渡す** | PNG への背景反映 |
| Must | OG SSR route で **テキスト可読性を担保する readability layer** | 任意の画像で文字が読める保証 |
| Must | サークル詳細の編集カードで **保存前にプレビュー表示** | UX 必須 |
| Must | 既存 group（背景未設定）の **カード生成挙動が完全に同一** | regression ゼロ |
| Should | アップロード時の **クライアント側自動リサイズ + 圧縮**（1200×630 jpg quality 0.8 → ≤ 1MB） | egress / latency 対応 |
| Must | Storage 差し替え時に **旧 asset を確実削除**（最大 3 回 retry / 指数 backoff） | orphan 残留防止・Storage コスト抑制・サークルあたり保持画像数を winner / season カード分の最大 2 枚に収束 |
| Could | テキストテーマに **auto モード**（画像平均輝度ベース） | UX 向上だが MVP 不要 |

Track B:

| Priority | Capability | Rationale |
| --- | --- | --- |
| Must | URL を環境変数（`NEXT_PUBLIC_NOTE_INTRO_ARTICLE_URL` / `NEXT_PUBLIC_NOTE_OPERATING_GUIDE_URL`）で管理し、リポジトリには値をハードコードしない | MIT 公開で運営者個人の note アカウント特定を防ぐ |
| Must | env 未設定時はリンクを非表示（fork 直後のデフォルト挙動を安全に） | 第三者 fork 時に意図せぬ個人 URL 露出を避ける |
| Must | トップ画面 `/` に note 記事 2 本（アプリ紹介 / 運営チートシート）へのリンクを常時表示（env 設定済み時） | コア機能 |
| Must | リンクは新しいタブで開く（`target="_blank"` + `rel="noopener noreferrer"`）| 外部遷移の標準 |
| Must | a11y: 「新しいタブで開く」を SR に通知（aria-label） | WCAG 2.4.4 / 3.2.5 |
| Must | sign-in / sign-out / loading 全状態で表示 | ログイン前にもアプリ概要が見える |
| Must | `.env.local.example` をリポジトリに追加し fork 者にセットアップ手順を提示 | OSS としての導線整備 |
| Should | 外部リンクアイコン（lucide `ExternalLink`）でビジュアル明示 | UX 向上 |
| Could | 出し分け（未ログインなら紹介、ログイン済みなら運営ガイド） | YAGNI: 両方常時表示で十分 |

### MVP Scope

v1 リリース時点で含めるもの:

- Track A: Phase 1〜3 完了（旧 PRD と同じスコープ）
- Track B: Phase 1 完了（note 記事 2 本のリンク追加）

v1 では含めないが将来的に検討:

- Track C 以降の polish 系 Track
- Track A の auto テキストテーマ / 複数画像ストック / シーズンスナップショット背景 / organizer 権限拡張

### User Flow

各 Track の User Flow は Track 詳細セクションを参照。

---

## Track A: Result Card Background Image

### Track A Overview

旧 PRD `05-result-card-image-bg` の全内容を本 Track に内包。Problem Statement / Proposed Solution /
Technical Approach / Implementation Phases は旧 PRD のまま維持する。

### Track A: Technical Approach

**Feasibility**: HIGH

既存パターン（Phase 4.16 / 4.17 / Phase A / Phase C / Phase E の `groups/{gid}` 単独フィールド additive 追加）と
Phase B の OG route の組み合わせで成立。新規導入要素は (1) Firebase Storage 初期化 / Blaze プラン、
(2) クライアント側画像処理（canvas API）の 2 つのみ。

**Architecture Notes**

- **データ構造**: `groups/{gid}.winnerCardBackground` / `groups/{gid}.seasonCardBackground` を
  `{ imageUrl: string | null, storageAssetId: string | null, textTheme: "light" | "dark" }` で
  additive 追加。`null` 互換のため schema は `.default(null)` で legacy doc を hydrate
- **Storage path**: `groups/{gid}/bgImages/{assetId}`。`assetId` は `crypto.randomUUID()`。差し替え時は
  以下の順序で **atomic な orchestration** を行う（[Phase A.2 plan](../plans/) で実装、A.1 では foundation のみ）:
  1. 新 asset upload（成功するまで Firestore pointer は触らない）
  2. `groups/{gid}.{winnerCardBackground,seasonCardBackground}.storageAssetId` を Firestore で
     新 assetId に更新（ここで失敗したら新 asset を delete してロールバック）
  3. 旧 asset を **`deleteObject` + 最大 3 回 retry**（指数 backoff: 200ms / 600ms / 1.8s）で削除。
     3 回とも失敗したら `logger.warn("orphan card background asset", { gid, assetId })` で記録し、
     アップロード自体は成功扱いとする（orphan 残留は次回上書きでは自動 retry されない既知制約）
  4. サークルあたり保持画像数は **winner / season カードで最大 2 枚** に収束する設計
     （rule では 1 ファイル ≤ 1MB / image content-type のみ enforce、枚数 cap は持たない）
- **Storage rules**: deny-by-default。`groups/{gid}/bgImages/{assetId}` のみ public read（OG SSR route
  の Vercel Node から fetch するため）。write は authenticated user + クライアント / Firestore rules 側で
  「owner のみが groups doc を更新できる」二重防御
- **OG route 拡張**: `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` に `bgImageUrl` /
  `bgTextTheme` を additive 追加。route 内で `bgImageUrl` を fetch → ArrayBuffer → base64 data URI に変換し、
  Satori `<img src={dataUri}>` で root 背景に重ねる。fetch 失敗時はフォールバック（既存グラデーション
  背景にフォールバック + warn ログ）
- **Readability layer**: 上下黒グラデーションスクリム + テキストグループ rgba 半透明 box overlay の
  二段重ね。`textShadow` / `filter` 未対応の Satori 制約をスクリム + box overlay で代替
- **CDN キャッシュ**: 既存の `s-maxage=86400` を維持。`bgImageUrl` が query param に入るため、
  画像差し替え時は URL も変わる（assetId が UUID で変わる）→ 自動的に cache invalidation が成立
- **クライアント画像処理**: canvas API で `drawImage(img, 0, 0, 1200, 630)` →
  `canvas.toBlob(blob, "image/jpeg", 0.8)`。Blob を Storage に直接 upload

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Blaze プラン移行をユーザー（プロジェクト所有者）が忘れて Storage が動かない | M | README + Phase A.1 plan に「Blaze 移行が前提」を明記。`storageBucket` 接続失敗時の error handling を OG route に入れる |
| 任意の画像で readability が破綻する（白文字 + 白背景画像など） | H | 上下黒グラデーションスクリム + テキストグループ背景 rgba block + テキストテーマ切替の三段構え |
| Storage 公開 read で誤って機密画像を upload してしまう | L | UI に「公開 URL になります」「メンバー / 観戦者全員に見えます」の注意文を表示 |
| OG route の画像 fetch 失敗（Storage 障害 / token 期限切れ） | L | route 内で try/catch、失敗時は背景なしでフォールバック + `logger.warn` |
| クライアント画像処理が大きい画像（10MB+）で UI フリーズ | M | upload 前に file.size でチェック → 5MB 超は事前 reject |
| Storage egress が予想を超える | L | Vercel CDN cache（`s-maxage=86400`）でほぼ初回 fetch のみ |
| Firebase Storage の SDK 更新で破壊的変更 | L | `firebase` SDK は package.json で固定 version 管理 |

---

## Track B: Top Page Promotion

### Track B Overview

note 公開記事 2 本（アプリ紹介 / 運営チートシート）へのリンクをトップ画面 `/` に追加し、
未導入者 / 既存運営者の双方に対する記事到達動線を確保する。今後の小〜中規模 UX 改善（onboarding
hint / 共有動線追加 / 一覧画面の polish 等）も本 Track 配下に plan を追加する形で扱う。

### Track B: Technical Approach

**Feasibility**: HIGH

既存パターン（`src/app/page.tsx` の `<Link><Button>` ラッピング / `lucide-react` アイコン使用 /
shadcn `Button asChild`）の組み合わせのみで完結。Storage / Firestore / 認証への依存ゼロ。

**Architecture Notes**

- **トップ画面修正**: `src/app/page.tsx` に外部リンクセクションを追加。既存の sign-in / sign-out
  分岐の **外側**（常時表示）に配置
- **外部リンクパターン**: `<Button asChild variant="link" size="sm">` + 子 `<a target="_blank"
  rel="noopener noreferrer" aria-label="...">` で role を `"link"` として描画。既存の
  `getByRole("button", ...)` e2e は汚染しない
- **URL の env 化**: `NEXT_PUBLIC_NOTE_INTRO_ARTICLE_URL` / `NEXT_PUBLIC_NOTE_OPERATING_GUIDE_URL`
  の 2 つの環境変数で管理。**リポジトリには URL を一切ハードコードしない**（MIT 公開リポジトリで
  運営者個人の note アカウントが GitHub commit history から特定されるのを防ぐ）。
  `.env.local`（gitignore 済み）+ Vercel 環境変数の両方で管理し、`.env.local.example` を
  リポジトリに追加して fork 者がセットアップ手順を辿れるようにする
- **未設定時のフォールバック**: いずれの env も未設定なら **リンクセクション全体を非表示**にする
  （fork した第三者がデフォルトで個人 URL を露出させない）。env 単位で個別判定し、片方だけ
  設定されている場合は設定された側のリンクのみ表示
- **a11y**: `aria-label` に「新しいタブで開く」を含め WCAG 2.4.4 / 3.2.5 に準拠
- **e2e**: `tests/e2e/pages/TopPage.ts` PageObject に link locator を追加し、
  `expectSignedOutLayout` / `expectSignedInLayout` で visible 検証。テスト環境では
  `playwright.config.ts` の `webServer.env` または `tests/e2e/setup.ts` で env を注入

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| 環境変数 (`NEXT_PUBLIC_NOTE_*`) が production の Vercel に未設定でリンクが出ない | M | デプロイ手順に env 設定を必須として明記。env 未設定時は dev で警告ログ（`logger.warn`）+ UI 上は静かに非表示 |
| `NEXT_PUBLIC_*` プレフィックスがクライアントバンドルに含まれることへの懸念 | L | 公開 URL（note.com への外部リンク）が前提。秘匿対象ではないため `NEXT_PUBLIC_*` で正しい。security-env.md と整合 |
| e2e テストが env 注入失敗で fail | L | `playwright.config.ts` の `webServer.env` または `globalSetup` で固定 dummy URL を注入。本番 URL に依存しないテスト構成 |
| `Button asChild` の Slot エラー（複数子要素を並べる）で build fail | L | plan の Task GOTCHA に明示。`<a>` を単一子要素として、その内側にテキスト + アイコンを並べる |
| PWA standalone モードでの target="_blank" 挙動が iOS / Android / Desktop で異なる | L | OS デフォルト動作で十分（仕様として「外部記事は外部ブラウザで開く」が自然） |
| note 記事が将来削除・URL 変更されたときにリンク切れ | L | env 値を Vercel コンソールから差し替えるだけで対応可能。code change / redeploy 不要 |
| 新リンクが既存 e2e の `getByRole("button")` を汚染する | L | `Button asChild` + `<a>` で role は "link" になるため "button" には混ざらない |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with N" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| #     | Phase                                       | Description                                                                                                                                          | Status      | Parallel | Depends | PRP Plan                                                                                       |
| ----- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- | -------- | ------- | ---------------------------------------------------------------------------------------------- |
| A.1   | Track A: Storage Foundation                 | Firebase Storage 初期化、Blaze プラン移行手順、firebase.json / storage.rules / SDK singleton 追加、emulator 統合、`groups/{gid}` schema 拡張、repository / service / rules ブランチ、emulator validator | complete    | with B.1 | -       | [phase-a.1-storage-foundation.plan.md](../plans/completed/phase-a.1-storage-foundation.plan.md) — Report: [phase-a.1-storage-foundation-report.md](../reports/phase-a.1-storage-foundation-report.md) |
| A.2   | Track A: Background Image UI & SSR          | サークル詳細画面に WinnerCardBackgroundCard / SeasonCardBackgroundCard を追加（ファイル選択 / クライアント圧縮 / プレビュー / 保存 / 解除）、Storage upload + 旧 asset 削除、OG route 拡張（bgImageUrl 受取 + fetch + Satori 画像表示） | complete    | -        | A.1     | [phase-a.2-background-image-ui-and-ssr.plan.md](../plans/completed/phase-a.2-background-image-ui-and-ssr.plan.md) — Report: [phase-a.2-background-image-ui-and-ssr-report.md](../reports/phase-a.2-background-image-ui-and-ssr-report.md) |
| A.3   | Track A: Layout Polish & Readability        | 初版: 上下スクリム + テキストグループ rgba box overlay。Post-merge polish で 2 段転換: ①box 全廃 + scrim 弱化 + text-shadow ②winner レイアウト確定（最上部中央 / 真ん中 / 最下部中央寄せ footer-box 4 要素 + 縦線区切り）+ `groupName` クエリ追加 + Satori `textShadow:undefined` クラッシュ対策。詳細は plan/report の Post-merge follow-up セクション | complete    | -        | A.2     | [phase-a.3-layout-polish-and-readability.plan.md](../plans/completed/phase-a.3-layout-polish-and-readability.plan.md) — Report: [phase-a.3-layout-polish-and-readability-report.md](../reports/phase-a.3-layout-polish-and-readability-report.md) |
| B.1   | Track B: Top Page Promotion (note 記事リンク)   | トップ画面 `/` に note 公開記事 2 本（アプリ紹介 / 運営チートシート）への外部リンクを常時表示。`Button asChild` + `<a>` パターンで描画、a11y / e2e PageObject 対応 | complete    | with A.1 | -       | [note-articles-link-on-top-page.plan.md](../plans/completed/note-articles-link-on-top-page.plan.md) — Report: [note-articles-link-on-top-page-report.md](../reports/note-articles-link-on-top-page-report.md) |
| C.1   | Track C: Dryrun Feedback Batch 1                | (1) トーナメントデフォルト名を `Tournament-No.X` に簡潔化 / (2) 一覧で member の参加済み tournament を「参加済み」ボタンで明示 / (3a) 招待コード再発行時に旧コードを `latestJoinCodeId` 経由で best-effort delete + `groupJoinCodes` delete rule を organizer に widening / (3b) 7 日以上経過した匿名 Auth ユーザーを admin script `cleanup-old-anonymous-users` で bulk 削除 / (4) `finishTournament` tx で `spectateEnabled=false` を additive 書込し終了済み tournament の anon 公開放置を防止 | complete | -        | -       | [dryrun-feedback-batch-1.plan.md](../plans/completed/dryrun-feedback-batch-1.plan.md) — Report: [dryrun-feedback-batch-1-report.md](../reports/dryrun-feedback-batch-1-report.md) |

### Phase Details

**Phase A.1: Track A: Storage Foundation**

- **Goal**: Firebase Storage を repository に組み込み、`groups/{gid}` の背景画像メタデータフィールド
  （imageUrl / storageAssetId / textTheme）をクライアント / Firestore rules / Storage rules すべて経由で
  書き込み・読み出しできる状態にする。UI / OG route 変更は本 phase では行わない
- **Scope**:
  - Blaze プラン移行手順を README に追加（実プロジェクト切替はユーザー作業）
  - `src/lib/firebase/client.ts` に `firebaseStorage` singleton と emulator connect を追加
  - `firebase.json` に `"storage": { "rules": "storage.rules" }` と `emulators.storage.port = 9199` を追加
  - `storage.rules` を新規作成（deny-by-default + `groups/{gid}/bgImages/{assetId}` のみ public read +
    authenticated write）
  - `src/lib/firebase/schemas/group.ts` に `winnerCardBackground` / `seasonCardBackground` を additive 追加
  - `src/lib/firebase/repositories/groups.ts` に `updateWinnerCardBackground` /
    `updateSeasonCardBackground` を `wrapFirestoreWrite` 経由で追加
  - `src/lib/services/group.ts` に `setWinnerCardBackground` / `setSeasonCardBackground` を
    `assertOwner` ロールゲート付きで追加
  - `firestore.rules` の `groups/{gid}` `allow update` に owner-only
    `affectedKeys.hasOnly(['winnerCardBackground'])` / `'seasonCardBackground'` ブランチを追加
  - `scripts/test-rules-card-background.mjs` emulator validator を新規作成
  - `scripts/test-storage-rules.mjs` emulator validator を新規作成
  - `package.json` に `test:rules-card-background` / `test:storage-rules` script を追加
- **Success signal**:
  - `npm run test:rules-card-background` および `npm run test:storage-rules` が green
  - emulator で owner として upload + groups doc update が成功し、anon で read できる
  - 既存テストすべて green、`npm run typecheck` と `npm run lint` が clean
  - 既存 group doc が `winnerCardBackground == null` で hydrate される（破壊的 migration なし）

**Phase A.2: Track A: Background Image UI & SSR**

- **Goal**: owner がサークル詳細画面から背景画像をアップロード・差し替え・解除でき、その画像が
  OG SSR route で出力される状態にする。読みやすさ調整は最低限の textTheme 切替まで
  （本格的なレイアウト polish は Phase A.3）
- **Scope**:
  - サークル詳細画面に `WinnerCardBackgroundCard` / `SeasonCardBackgroundCard` を追加
  - ファイル選択 → canvas API で 1200×630 jpg quality 0.8 にリサイズ・圧縮
    （共通 helper `src/lib/utils/image-resize.ts` を新規作成）
  - upload 前にクライアントでファイルサイズ check（5MB 超は reject）
  - プレビュー表示（圧縮後の Blob を `URL.createObjectURL` で `<img>` 表示）
  - 保存ボタン押下で Storage upload → groups doc update → 旧 asset を best-effort delete
  - 解除ボタン押下で groups doc を null に戻し、Storage asset を削除
  - `src/app/api/og/_lib/og-payload.ts` の query schema に `bgImageUrl` / `bgTextTheme` を additive 追加
  - `buildWinnerShareInputs` / `buildSeasonShareInputs` で `groups/{gid}` の背景設定を読んで query に流す
  - OG route で `bgImageUrl` 指定時は fetch → ArrayBuffer → data URI 変換 → Satori `<img>` で背景レンダリング
  - fetch 失敗時は背景なしでフォールバック + `logger.warn`
  - 単体テスト（repository / service / OG route のキャラクタリゼーション）
- **Success signal**:
  - owner がアップロード → 即座にプレビュー → 保存後にダッシュボードからカード DL すると新背景で出力
  - 既存 group（背景未設定）のカード PNG が完全に同一（visual diff なし）
  - 旧 asset 削除が best-effort で動作（失敗してもメイン flow は止まらず warn のみ）
  - 単体テスト・既存 E2E 全 green

**Phase A.3: Track A: Layout Polish & Readability**

- **Goal**: 任意の画像が背景に来てもテキストが読める状態にする。スクリム + box overlay + テキストテーマ
  トグルの三段構えで readability を担保し、ドライランで「実用に耐える」状態に仕上げる
- **Scope**:
  - 上下黒グラデーションスクリム overlay を OG route に追加
  - テキストグループ（タイトル / 中央 WINNER 名 / footer）それぞれに rgba 半透明 box overlay 追加
  - `bgTextTheme === "light"` で foreground 白系、`"dark"` で foreground 黒系に切替
  - テキスト位置の最終調整（フォントサイズ / padding 調整）
  - サークル詳細編集カードに「テキストテーマ ライト / ダーク」の切替トグルとプレビュー反映
  - 編集カードのプレビューが OG route と同じ readability layer を反映
  - E2E（Playwright）でアップロード → 保存 → ダウンロード → 画像内容アサート
  - visual regression（手動）+ ドライラン用ドキュメント
- **Success signal**:
  - 明るい画像 + dark theme / 暗い画像 + light theme / 中間画像 + 両 theme で文字が読める
  - 既存 group（背景未設定）のカード PNG が完全に同一（regression ゼロ）
  - ドライラン投入準備完了（README / 運営ガイドへの記載完了、Codex review 通過）
- **Post-merge polish (2026-05-12 / 2 段)**: 上記 Scope の「テキストグループ rgba box overlay」は
  owner からの「画像を塗りつぶす範囲が大きくデザインが損なわれる」フィードバックで撤回し、以下に転換:
  1. **box overlay 全廃** + scrim 弱化（上 15% / 下 12% / 透明度 0.3〜0.35）+ text-shadow（light/dark
     テーマで外側ブロックに outer glow）
  2. winner OG レイアウトを「最上部中央のトーナメント名 / 上下左右中央の優勝者名（WINNER ラベルは
     真上に absolute 配置）/ 最下部中央寄せの footer-box（サークル名・開催日・参加人数・アプリ名の 4
     要素を縦線で区切り、テーマ連動の半透明背景で局所的にのみ box 復活）」に確定。
     `WINNER_CARD_QUERY_SCHEMA` に `groupName` を optional で additive 追加。Satori が
     `textShadow: undefined` を `.toString()` するクラッシュ対策で全 textShadow を条件 spread に統一
  - 詳細・差分・検証結果は [plan](../plans/completed/phase-a.3-layout-polish-and-readability.plan.md)
    末尾の "Post-merge follow-up" / "Post-merge follow-up 2" セクション、および
    [report](../reports/phase-a.3-layout-polish-and-readability-report.md) の同名セクションを参照

**Phase B.1: Track B: Top Page Promotion (note 記事リンク)**

- **Goal**: トップ画面 `/` に note 公開記事 2 本（アプリ紹介 / 運営チートシート）への外部リンクを
  常時表示し、未導入者 / 既存運営者双方の記事到達動線を確保する。URL はリポジトリにハードコードせず
  環境変数経由で読み込む
- **Scope**:
  - `.env.local.example` を新規作成し、`NEXT_PUBLIC_NOTE_INTRO_ARTICLE_URL` /
    `NEXT_PUBLIC_NOTE_OPERATING_GUIDE_URL` のテンプレートを記載
  - 開発者の `.env.local` および Vercel 環境変数に上記 2 つを設定（実値は code には残さない）
  - `src/app/page.tsx` で `process.env.NEXT_PUBLIC_NOTE_*` を参照し、空文字フォールバック →
    値がある側のリンクのみ render（両方未設定ならセクション全体非表示）
  - `lucide-react` から `ExternalLink` icon を import
  - 既存の sign-in / sign-out CTA `<div>` の **外側** に、env 設定済み時のみ表示するリンクセクションを追加
    （`<Button asChild variant="link" size="sm">` + `<a target="_blank" rel="noopener noreferrer">`）
  - `aria-label` で「新しいタブで開く」を SR に通知
  - `tests/e2e/pages/TopPage.ts` に `noteIntroLink` / `noteOperatingGuideLink` の Locator を追加し、
    `expectSignedOutLayout` / `expectSignedInLayout` で visible 検証
  - `playwright.config.ts` の `webServer.env` に dummy URL（`https://note.com/dummy/intro` 等）を
    注入し、本番 URL 非依存で e2e が動く構成にする
  - README に「note 記事リンクを有効化する手順（`.env.local` への記載 + Vercel 環境変数設定）」を追記
- **Success signal**:
  - env 設定済みの local / production で sign-out / sign-in / loading 全状態で 2 リンクが visible
  - env 未設定の dev サーバ起動時はセクション全体が非表示で、UI が破綻しない
  - 両リンクが新タブで note 記事を開き、`rel="noopener noreferrer"` / `aria-label` が付与されている
  - `npm run typecheck` / `npm run lint` / `npm run build` / `npx playwright test` 全 green
  - 既存 e2e の `getByRole("button")` が新リンクで汚染されていない
  - リポジトリの code / commit history に note URL が一切残っていない

**Phase C.1: Track C: Dryrun Feedback Batch 1**

- **Goal**: ドライラン投入直後に上がった「すぐ直してほしい」フィードバック 3 件を 1 PR に bundle
  して片付ける。トーナメント名のデフォルト変更（簡潔化）／一覧での参加済み明示（二重登録不安の解消）／
  招待コード・匿名 Auth のゴミデータ整理を 1 phase でまとめて完結させる
- **Scope**:
  - **改善 1: トーナメントデフォルト名** — `src/app/tournaments/new/tournament-new-client.tsx:32` の
    `[サークル名]トーナメント-X` を `Tournament-No.X` に変更（サークル名非依存・短い）
  - **改善 2: 一覧の参加済み明示** — `src/app/tournaments/tournaments-client.tsx` で member 視点の
    list fetch 完了後に `getPlayer(tid, uid)` を Promise.allSettled で並列取得し、参加済み row の
    Button を `variant="outline"` + label "参加済み" に切替。link 自体は `/live` のまま維持し
    受付確認 UX に到達できる動線を保つ
  - **改善 3a: 招待コード自動整理** —
    - `groups/{gid}.latestJoinCodeId: string \| null` を additive 追加（zod schema + 既存 doc は default null）
    - repository `updateLatestJoinCodeId` / `deleteJoinCode` を新規追加
    - service `generateJoinCode` を 4 ステップ化（read prev → create new → update pointer → best-effort delete prev）
    - `firestore.rules`: `groupJoinCodes` delete を `isOwner` → `isOrganizer` に widening（issue 経路と
      delete 経路の権限を揃える）+ `groups/{gid}` update に `latestJoinCodeId` 単独書換ブランチを
      additive 追加（Phase 4.16 / 4.17 と同パターン）
    - `scripts/test-rules-latest-join-code.mjs` emulator validator を新規追加
  - **改善 3b: 匿名 Auth + `users/{uid}` クリーンアップ script** —
    - `scripts/cleanup-old-anonymous-users.ts` を新規追加（`cleanup-orphan-firestore.ts` + `cleanup-test-auth-users.ts` を mirror）
    - `admin.auth().listUsers()` paging で全 user を走査 → `providerData.length === 0 && metadata.creationTime < now - 7 days`
      の uid を抽出 → 各 uid について以下 2 ステップで削除:
      1. `users/{uid}` doc を delete
      2. `admin.auth().deleteUsers([...uids])` で Auth を 1000 件 chunk batch 削除
    - **意図的に保持**（参照価値があるため）:
      - `tournaments/{tid}/players/{uid}` — 過去トーナメント参照時の参加者一覧 / WinnerBanner /
        結果シェアカード / OG image / PlayersCard / AverageStackCard は player の `displayName` snapshot に
        依存しており、player を消すと**過去トーナメントの優勝者表示・参加者一覧・結果カード生成が壊れる**
      - `groups/{gid}/seasonStats/{uid}` — シーズンランキング基礎、displayName は doc 内 snapshot 済み
      - `groups/{gid}/seasonHistory/{seasonId}.entries[]` — append-only / 改竄禁止 rule
    - **そもそも対象外**: `groups/{gid}.memberUids` / `memberDisplayNames`（匿名ユーザーは招待コード経路を通らないため元々含まれない）
    - 既存 `attemptAnonymousSelfDelete`（finish/cancel/logout 経路）と削除対象を完全一致させ、
      即時 vs 遅延の「タイミング非対称」に留める（即時には残るのに 1 週間経つと消えるという UX 非対称を回避）
    - dry-run / `--execute` / `--days=N` の CLI フラグを既存 script と同型で実装
    - `package.json` に `cleanup:old-anonymous-users` npm script 追加
  - **改善 4: 観戦 URL 自動 OFF** — `finishTournament` の tx 内 `tx.update(ref, {...})` に
    `spectateEnabled: false` を additive 追加。rule は既存 broad organizer update で許可済みのため
    変更不要。終了済み tournament の anon read 経路を**運営者の toggle 忘れ**に依存しない設計に倒す。
    手動 toggle（`setSpectateEnabled` service）は据え置きで、終了後の再 ON も自由
  - **規約ファイル更新**: `.claude/rules/firebase-patterns.md`（allowed-keys 表）と
    `.claude/rules/group-membership.md`（データモデル + 招待コード設計原則）を同 PR で更新
- **Success signal**:
  - `npm run typecheck` / `npm run lint` / `npm run build` グリーン
  - vitest 全 green（新規 `generateJoinCode` / `deleteJoinCode` / `tournaments-client` のテスト追加）
  - `npm run test:rules-latest-join-code` および `npm run test:rules-limits` グリーン
  - `npx playwright test` 全 green（改善 1 の旧文字列依存 spec があれば更新済み）
  - 手動: 新規作成画面で `Tournament-No.X` プリフィル、member 一覧で参加済み row が「参加済み」表示、
    再発行後に旧 QR の URL が無効化、`cleanup:old-anonymous-users` dry-run で想定数の匿名 user を列挙
  - `firebase deploy --only firestore:rules` 完了
  - PRD 05 / 関連 rule ファイルが同 PR で更新済み

### Parallelism Notes

- **A.1 と B.1 は並列可能**。Track A は Storage / Firestore / OG route 系の変更で、Track B は
  トップ画面の static リンク追加のみ。両者の touch ファイルは重ならない
- **Track A 内**: A.1 → A.2 → A.3 は厳密直列（A.1 が完了しないと Storage 書込不可、
  A.2 が完了しないと OG route が背景画像を読まない）
- **Track C は Track A / B と独立**で並列可能。touch ファイルは Tournament 一覧 / 招待コード / cleanup script
  系のみで Track A / B とは重ならない
- **将来追加 Track**: Track D 以降が立ち上がる場合、原則として既存 Track と並列。Track 間で共通
  helper / lib に touch する場合は別 plan で抽出を分離

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| PRD 構成 | 「リリース後の polish 集約 PRD」として Track 単位で並列運用 | 各 Track を独立 PRD（06 / 07 / ...）として立てる / 完了済み PRD に追記 | Track 単位の粒度が小〜中で独立 PRD は粒度過剰。完了済み PRD への追記は memory 規則違反。集約 PRD で各 Track を Phase 群として持つ運用が現状の最適解 |
| Track A データ構造 | `groups/{gid}.{winnerCardBackground, seasonCardBackground}` を別フィールド additive 追加 | 1 フィールドにネスト / `cardBackground` map で統合 | rules `affectedKeys` ブランチが対称的にシンプル。UI / service / repository も同様 |
| Track A 設定者ロール | owner only | owner + organizer / member 自身 | 「サークル代表のブランディング表現」が主目的。複数人が変えるとブランド一貫性が崩れる |
| Track A 画像配信方式 | Firebase Storage 導入 + Blaze プラン移行 | リポジトリ同梱プリセット / URL 直接入力 / Firestore data URI | サークル独自画像の自由度が必須。他案は自由度・スケール・UX で劣る |
| Track A Storage path | `groups/{gid}/bgImages/{assetId}` | サブコレクション + Storage / Firestore メタデータ管理 | Phase 4.10 の `audioAssets` 設計を踏襲。シンプルなライフサイクル |
| Track A Storage 公開設定 | `bgImages` path のみ public read | signed URL / Cloud Functions 経由 | OG SSR route から fetch する必要があり、signed URL は Cloud Functions / Admin SDK が必要で複雑度大。装飾目的で個人情報を含まない前提 |
| Track A OG データ取得 | クライアントが query param で bgImageUrl を渡す | OG route が SSR で `getDoc(groups/{gid})` | 既存の CDN キャッシュ（`s-maxage=86400`）が「同一 query = 決定的に同じ PNG」を前提。query param 経由なら自動的に cache 無効化が成立 |
| Track A Phase 分割 | 3 phases（Storage 基盤 → UI / OG → Layout polish） | 2 phases / 4 phases | 各 phase が独立 deploy / dogfood 可能、PR サイズが適度 |
| Track A 可読性デフォルト（A.3 初版） | 上下黒グラデーションスクリム + テキストグループ rgba 半透明 box | 全画面 50% 黒 overlay / カード型 rounded box overlay | 全画面 overlay は背景画像を冷重金化、カード型は装飾的すぎる。スクリム + テキスト box が背景を活かしつつ局所可読性確保 |
| Track A readability 実装（A.3 初版） | rgba 半透明 div + linear-gradient overlay | textShadow / drop-shadow filter | （当時の認識）Satori は textShadow 未対応。**※ 実は Satori は `textShadow` をサポートしており、A.3 polish で前提が覆った。後述「Track A 可読性 polish (2026-05-12)」参照** |
| Track A 可読性 polish (2026-05-12 / A.3 初版を撤回) | scrim 大幅弱化 + 文字 outer glow text-shadow + footer のみ局所 box（テーマ連動 + 4 要素縦線区切り） | 元設計（テキストグループ全てに box overlay）維持 / box 完全廃止して text-shadow のみ | ドライラン直前の owner フィードバック「画像を塗りつぶす範囲が大きくデザインが損なわれる」を踏まえ box を全廃 → text-shadow に切替。さらに footer の情報量（サークル名 / 日付 / 人数 / アプリ名）を読みやすくするため owner 明示要望で footer のみ box を再導入（背景の部分隠れは許容）。Satori は `textShadow` を実際にはサポートしていることが本 polish で確認された |
| Track A winner レイアウト (A.3 polish 2) | 最上部中央 トーナメント名 / 上下左右中央 優勝者名（WINNER ラベルは真上に absolute 配置）/ 最下部中央寄せ footer-box | 中央寄せでない asymmetric layout を維持 / WINNER ラベルを優勝者名と同じブロックで縦中央計算 | owner 要望に直接合わせる。WINNER ラベル absolute 配置により「優勝者名そのもの」が画面中央になる構造を実現 |
| Track A `groupName` クエリ | `WINNER_CARD_QUERY_SCHEMA` に optional で additive 追加 | required 化 / 別 endpoint 化 | optional のため旧クライアントが発行した URL は互換維持。新規発行 URL は常に含める方向 |
| Track A Satori `textShadow: undefined` 対策 | 全 textShadow を条件 spread で渡す（`{ textShadow }` または `{}` をスプレッド） | `"none"` フォールバック / 受け側で `?? undefined` 維持 | `textShadow: undefined` を Satori が内部で `.toString()` してクラッシュ（`failed to pipe response`）するため CSS プロパティ値として undefined を渡さないルールを採用。winner / season 両 route に防御的展開 |
| Track A 旧 asset の扱い | **3 回 retry 付き確実削除**（最終失敗時のみ warn ログ + orphan 残留） | best-effort（1 回のみ）/ 物理削除を tx 化 / 永続保持 | Storage delete は別 SDK 呼び出しで Firestore tx に組み込めず厳密な atomic は不可。retry でほぼ orphan ゼロを実現しつつ、3 回失敗時は UX を阻害しない設計。サークルあたり保持画像数を winner / season カード分の最大 2 枚に収束させたいという要件（2026-05-10 ユーザー確認）を満たす |
| Track A クライアント画像処理 | canvas API で 1200×630 jpg quality 0.8 | Web Worker 化 / 外部ライブラリ | 月 1〜2 回利用で worker は overkill。canvas API は標準で依存追加なし |
| Track A Storage 上限 | 1 ファイル 1MB | 500KB / 5MB | 1200×630 jpg quality 0.8 が typical 150-250KB なので 1MB は十分余裕 |
| Track B URL の管理方式 | 環境変数（`NEXT_PUBLIC_NOTE_*`）+ `.env.local` / Vercel + `.env.local.example` リポジトリ同梱 | `page.tsx` 冒頭の const ハードコード / `src/lib/external-links.ts` 新設 | MIT 公開リポジトリで運営者個人の note アカウント URL が GitHub commit history から特定されるのを防ぐ。security-env.md の `NEXT_PUBLIC_*` プレフィックス規約に従う（公開可能な URL のみ） |
| Track B env 未設定時の挙動 | リンクセクション全体を非表示 | エラーで build fail / placeholder URL を表示 | fork した第三者がデフォルトでも UI が破綻せず、かつ意図せぬ個人 URL 露出を起こさない |
| Track B リンク表示の出し分け | sign-in / sign-out / loading 全状態で常時表示 | 未ログインなら紹介 / ログイン済みなら運営ガイド | 両方常時表示で「未導入の人がトップを見たときに即座に何のアプリか分かる」かつ「既存運営者がいつでも操作リファレンスに飛べる」両方を成立 |
| Track B Button のラッピング | `Button asChild` + 子 `<a>` | `<a>` 内に `<Button>` をネスト / 素の `<a>` + Button class 直接適用 | role を "link" にして既存 `getByRole("button")` e2e を汚染しない。Button styling 維持 |
| Track B e2e の扱い | PageObject に locator 追加のみ、新規 spec は作らない | 専用 spec 新設 | testing.md 規約「観測可能な振る舞い」を既存 spec 経由で検証可能 |
| Track B a11y | aria-label に「新しいタブで開く」を含める | 視覚的なアイコンのみ / sr-only span 別出し | WCAG 2.4.4 / 3.2.5 を最小コードで担保 |
| 旧 PRD `05-result-card-image-bg` のリネーム | フォルダ + PRD ファイル両方を `05-post-launch-polish` にリネーム | フォルダ番号変更 / 旧 PRD を complete 化して新 PRD（06）を起こす | git mv でリネームし内容を Track A として包含。番号 05 を維持することで既存の plan ファイル参照や Implementation Phases の番号空間を破壊しない |
| Track C を独立 Track 化 | ドライラン直後の小規模フィードバック集約を新規 Track C として追加し、各 Phase = 複数改善の bundle として運用 | 各改善を独立 PRD として起こす / 既存 Track A / B に追記 / 完了済み PRD 01〜04 に追記 | 1 件あたりの粒度が小さく独立 PRD は過剰。Track A / B はテーマが固定（カード装飾・トップ動線）のため文脈が合わない。完了済み PRD への追記は memory 規則違反。「ドライラン由来の polish 集約」専用 Track が PRD 全体方針と整合 |
| 改善 1: トーナメントデフォルト名を `Tournament-No.X` 形式に変更 | サークル名を含まないシンプルな英語連番にする | `[サークル名]トーナメント-X` のままで一部のサークルだけ短縮 / 完全カスタム可能な template field | サークル名が長いと表示崩れする問題のドライラン報告に対し最小変更で対応。「サークル名抜きシンプル英語連番」は国際標準的で table 名 / 観戦リンク URL とも親和性が高い。設定可能化は YAGNI。`finishedTournamentCount` 連番は既存のまま引き継ぐ |
| 改善 2: 一覧での参加済み表示 | member 視点で list fetch 完了後に `getPlayer(tid, uid)` を Promise.allSettled で並列取得し、参加済み row のボタンを `variant="outline"` + label "参加済み" に切替 | 新規 batch read API を追加 / 「観戦」「結果」等の別動線ボタンを追加 / `/live` ではなく専用 confirm 画面に遷移 | UI は単なる label / variant 切替に留め、`/live` link は維持して受付確認 UX を集約済みの設計を維持。`getPlayer` の個別 read 量はサークル規模が 6 卓・月 1〜2 回スケールで無視可能。`Promise.allSettled` で個別 row の failure（permission-denied / network）が他 row を巻き込まない |
| Track C Phase C.1 を 1 plan で bundle | 3 件の改善を 1 plan ファイル / 1 phase / 1 PR で扱う | 改善ごとに plan / phase を分割 | 3 件とも「ドライラン直後の小規模 polish」というテーマで束ねられ、touch ファイルは独立で衝突しない。実装順序が明示できれば PR を分けても良いが、レビュー時の文脈統一を優先 |
| 改善 3a: 旧コード処理を `latestJoinCodeId` 追跡で実装 | `groups/{gid}.latestJoinCodeId` を additive 追加して service 層で「new create → pointer update → prev delete (best-effort)」を実装 | `cleanup-orphan-firestore.ts --only=joinCodes` の定期実行のみで expired を清掃 / Cloud Functions で trigger 化 / UI 側に「旧コード削除」ボタンを別追加 | ユーザー要望が **「作成時に削除する」** 明示。`groupJoinCodes` collection は `allow list: if false` で query 不可のため、外部 pointer（`latestJoinCodeId`）が現実的。CF 不採用は project 全体方針と整合 |
| 改善 3a: `groupJoinCodes` delete を organizer に widening | rule の delete 条件を `isOwner` → `isOrganizer` に拡大 | owner-only のまま維持（その場合 organizer が再発行しても旧コードを消せない） | 既に organizer が `allow create` を持っているため「発行はできるが削除はできない」非対称が不自然。組織者は元々 group 内の全 CRUD を持つ信頼ロールであり、widening の信頼境界外露出はない。権限マトリクスは `.claude/rules/group-membership.md` で更新 |
| 改善 3b: 匿名 Auth クリーンアップを admin script で実装 | `scripts/cleanup-old-anonymous-users.ts` を新規追加し、手動 / GitHub Actions cron で運用 | Cloud Functions + Cloud Scheduler で daily 自動実行 / Vercel Cron で実装 / 既存 `cleanup-orphan-firestore.ts` に統合 | プロジェクトに Cloud Functions の既存事例ゼロで導入コストが大きい。既存 admin script パターンが確立済みで、ドライラン規模では週次手動実行で十分。`orphan-firestore` との統合は責務分離（orphan 検知 vs. 古い匿名検知）の観点で避ける |
| 改善 3b: 1 週間 cutoff を維持 | `--days=7` を default、CLI で override 可能 | 即時削除 / 1 日 cutoff / 1 ヶ月 cutoff | ドライラン中の会場での参加セッションが当日中に完結する前提で、1 週間あれば「翌週末のリプレイ参加」などのエッジケースも吸収できる。CLI override で運用調整可能 |
| 改善 3b: 削除対象は Auth + `users/{uid}` のみ | `players` / `seasonStats` / `seasonHistory` は意図的に保持 | player も collectionGroup で列挙して完全消去 / seasonStats も一緒に消す | **過去トーナメント参照時の参加者一覧 / WinnerBanner / 結果シェアカード / OG image はすべて `players` collection と `displayName` snapshot に依存**しているため、player を消すと「終了済みトーナメントを開いたら優勝者が表示されない」「過去 SNS シェア URL が描画できない」事態を招く。`displayName` snapshot 経路で表示維持される `seasonStats` も同方針で残す。匿名 Auth + orphan `users/{uid}` だけ消せば運用上の「Firebase Auth 総アカウント数肥大化」要望は満たせる |
| 改善 3b: 即時 self-delete と bulk cleanup の削除対象を一致 | 両経路とも `users/{uid}` + Auth user のみ削除、`players` / `seasonStats` は残す | bulk のみ player も消す（非対称） | 即時には残るのに 1 週間経つと消える、という UX 非対称を回避。両経路を「同じデータセットをタイミング違い」にすることで一貫性を保つ |
| 改善 4: 観戦 URL を `finishTournament` tx で自動 OFF | `tx.update(ref, {...})` に `spectateEnabled: false` を additive 追加 | 別の自動化（schedule task / `setSpectateEnabled` service の自動呼出）/ rule で「終了済み tournament の spectate read を deny」/ 手動 OFF を運営者に依頼するドキュメント追記のみ | 終了処理と同一 tx に同梱することで「終了したのに観戦 ON のまま」状態を生じさせない。rule 変更不要（broad organizer update が既に許可済み）。終了済み + 再 ON の運用自由度は維持（運営者が手動で再 ON できる UX を阻害しない） |
| 改善 4: 旧 doc の遡及 backfill は行わない | 過去の `state=finished` tournament の `spectateEnabled` は据え置き | migration script で全 finished tournament を spectateEnabled=false に遡及 | 既存運営者は手動で OFF にできる UI を既に持っており、データ衛生として急務ではない。週次 `cleanup-orphan-firestore.ts` で同類の衛生課題は別途扱う方針と整合 |

---

## Research Summary

**Market Context**

- 同種の参考実装を探索した範囲では、ポーカートーナメント管理 OSS で「優勝者カード SSR 生成 +
  サークル別背景」を提供している例は限定的。本機能はサークル内部 SNS / LINE 共有で差別化要素を提供
- Twitter / X / Instagram など SNS 投稿用 OG カード生成は Notion / Linear / Vercel 自体が広く実装。
  テンプレート背景 + ロゴ重ねが標準
- ポーカー業界の WSOP / Hendon Mob などのプロ向け統計サイトは公式テンプレートのみ。本 PRD の
  「サークル単位カスタマイズ」はアマ向けトーナメント管理 OSS のニッチを攻める設計
- note 記事を「アプリ説明資産」として活用し、トップから直リンクするパターンは個人開発系 OSS で
  一般的（Next.js / Remix / Astro など）

**Technical Context**

- 既存 PRD 02 Phase B が `next/og` ImageResponse + Noto Sans JP self-host + client-pass-data + CDN cache
  のパターンを確立。Track A はその上に「クエリで bgImageUrl を渡す」だけの additive 拡張
- Firebase Storage 導入は Phase 4.10 で deferred されていた話題。実装規模はそれほど大きくないが、
  Blaze プラン移行（プロジェクト所有者の Firebase コンソール作業）が一度きりの前提
- Satori（next/og の rendering engine）は `textShadow` / `filter` 未対応。代わりに `opacity` /
  `linear-gradient` / `rgba()` / 半透明 div overlay を使う readability layer 設計が固定パターン
- クライアント側画像処理（canvas + toBlob）の先行事例が repo にゼロ。Track A で
  `src/lib/utils/image-resize.ts` を新規作成し、将来の avatar / thumbnail 機能などで再利用可能な
  helper として育てる
- Track B の外部リンクパターン（`Button asChild` + `<a target="_blank" rel="noopener noreferrer">`）は
  shadcn/ui のドキュメントで推奨されるパターン。既存 repo に外部リンクの先行事例ゼロ（src 配下に
  `target="_blank"` 検索結果ゼロ）のため、本 Track が初の外部リンクパターン導入

---

_Originally generated as `05-result-card-image-bg.prd.md`: 2026-05-10_
_Renamed and re-scoped to `05-post-launch-polish.prd.md`: 2026-05-10_
_Track C added: 2026-05-13_
_Status: DRAFT - Track A complete (A.1 / A.2 / A.3) / Track B Phase B.1 complete / Track C Phase C.1 complete_
