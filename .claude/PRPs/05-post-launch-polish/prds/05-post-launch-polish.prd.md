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

将来的な追加 Track 候補（着手は別途判断）:

- Track C: ダッシュボード入場後の onboarding hint（初回 owner 向け tooltip）
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

- URL 定数の external-links.ts への切り出し（YAGNI）
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
| Should | Storage 差し替え時に **旧 asset を best-effort で削除** | コスト抑制 |
| Could | テキストテーマに **auto モード**（画像平均輝度ベース） | UX 向上だが MVP 不要 |

Track B:

| Priority | Capability | Rationale |
| --- | --- | --- |
| Must | トップ画面 `/` に note 記事 2 本（アプリ紹介 / 運営チートシート）へのリンクを常時表示 | コア機能 |
| Must | リンクは新しいタブで開く（`target="_blank"` + `rel="noopener noreferrer"`）| 外部遷移の標準 |
| Must | a11y: 「新しいタブで開く」を SR に通知（aria-label） | WCAG 2.4.4 / 3.2.5 |
| Must | sign-in / sign-out / loading 全状態で表示 | ログイン前にもアプリ概要が見える |
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
  新 asset upload → groups doc update → 旧 asset を best-effort delete
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
- **URL 定数**: `page.tsx` 冒頭に const で閉じる。external-links.ts ファイル新設は YAGNI
- **a11y**: `aria-label` に「新しいタブで開く」を含め WCAG 2.4.4 / 3.2.5 に準拠
- **e2e**: `tests/e2e/pages/TopPage.ts` PageObject に link locator を追加し、
  `expectSignedOutLayout` / `expectSignedInLayout` で visible 検証

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| 実装時に URL が確定せず placeholder のまま commit される | M | plan の Task 1 GOTCHA で明示。実装直前にユーザに最終 URL を確認 |
| `Button asChild` の Slot エラー（複数子要素を並べる）で build fail | L | plan の Task 3 GOTCHA に明示。`<a>` を単一子要素として、その内側にテキスト + アイコンを並べる |
| PWA standalone モードでの target="_blank" 挙動が iOS / Android / Desktop で異なる | L | OS デフォルト動作で十分（仕様として「外部記事は外部ブラウザで開く」が自然） |
| note 記事が将来削除・URL 変更されたときにリンク切れ | L | URL 定数を `page.tsx` 冒頭に集約しているため、URL 変更時の修正点が 1 ファイルに閉じる |
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
| A.1   | Track A: Storage Foundation                 | Firebase Storage 初期化、Blaze プラン移行手順、firebase.json / storage.rules / SDK singleton 追加、emulator 統合、`groups/{gid}` schema 拡張、repository / service / rules ブランチ、emulator validator | pending     | with B.1 | -       | -                                                                                              |
| A.2   | Track A: Background Image UI & SSR          | サークル詳細画面に WinnerCardBackgroundCard / SeasonCardBackgroundCard を追加（ファイル選択 / クライアント圧縮 / プレビュー / 保存 / 解除）、Storage upload + 旧 asset 削除、OG route 拡張（bgImageUrl 受取 + fetch + Satori 画像表示） | pending     | -        | A.1     | -                                                                                              |
| A.3   | Track A: Layout Polish & Readability        | 上下黒グラデーションスクリム + テキストグループ rgba 背景 box overlay、ライト / ダーク テキストテーマトグル、テキスト位置の最終調整、E2E + visual regression、ドキュメント整備 | pending     | -        | A.2     | -                                                                                              |
| B.1   | Track B: Top Page Promotion (note 記事リンク)   | トップ画面 `/` に note 公開記事 2 本（アプリ紹介 / 運営チートシート）への外部リンクを常時表示。`Button asChild` + `<a>` パターンで描画、a11y / e2e PageObject 対応 | in-progress | with A.1 | -       | [note-articles-link-on-top-page.plan.md](../plans/note-articles-link-on-top-page.plan.md) |

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

**Phase B.1: Track B: Top Page Promotion (note 記事リンク)**

- **Goal**: トップ画面 `/` に note 公開記事 2 本（アプリ紹介 / 運営チートシート）への外部リンクを
  常時表示し、未導入者 / 既存運営者双方の記事到達動線を確保する
- **Scope**:
  - `src/app/page.tsx` 冒頭に note 記事 URL 定数 2 件を追加（`<NOTE_INTRO_URL>` / `<NOTE_GUIDE_URL>`、
    実装直前にユーザから確定 URL を受領）
  - `lucide-react` から `ExternalLink` icon を import
  - 既存の sign-in / sign-out CTA `<div>` の直下に、外部リンク 2 件のセクションを常時表示で追加
    （`<Button asChild variant="link" size="sm">` + `<a target="_blank" rel="noopener noreferrer">`）
  - `aria-label` で「新しいタブで開く」を SR に通知
  - `tests/e2e/pages/TopPage.ts` に `noteIntroLink` / `noteOperatingGuideLink` の Locator を追加し、
    `expectSignedOutLayout` / `expectSignedInLayout` で visible 検証
- **Success signal**:
  - sign-out / sign-in / loading 全状態で 2 リンクが visible
  - 両リンクが新タブで note 記事を開き、`rel="noopener noreferrer"` / `aria-label` が付与されている
  - `npm run typecheck` / `npm run lint` / `npm run build` / `npx playwright test` 全 green
  - 既存 e2e の `getByRole("button")` が新リンクで汚染されていない

### Parallelism Notes

- **A.1 と B.1 は並列可能**。Track A は Storage / Firestore / OG route 系の変更で、Track B は
  トップ画面の static リンク追加のみ。両者の touch ファイルは重ならない
- **Track A 内**: A.1 → A.2 → A.3 は厳密直列（A.1 が完了しないと Storage 書込不可、
  A.2 が完了しないと OG route が背景画像を読まない）
- **将来追加 Track**: Track C 以降が立ち上がる場合、原則として既存 Track と並列。Track 間で共通
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
| Track A 可読性デフォルト | 上下黒グラデーションスクリム + テキストグループ rgba 半透明 box | 全画面 50% 黒 overlay / カード型 rounded box overlay | 全画面 overlay は背景画像を冷重金化、カード型は装飾的すぎる。スクリム + テキスト box が背景を活かしつつ局所可読性確保 |
| Track A readability 実装 | rgba 半透明 div + linear-gradient overlay | textShadow / drop-shadow filter | Satori は `textShadow` / `filter: drop-shadow()` 未対応 |
| Track A 旧 asset の扱い | best-effort 削除 | 物理削除を tx 化 / 永続保持 | Storage delete は別 SDK 呼び出しで Firestore tx に組み込めない。失敗時は孤児になるが Storage コスト的に無視可能 |
| Track A クライアント画像処理 | canvas API で 1200×630 jpg quality 0.8 | Web Worker 化 / 外部ライブラリ | 月 1〜2 回利用で worker は overkill。canvas API は標準で依存追加なし |
| Track A Storage 上限 | 1 ファイル 1MB | 500KB / 5MB | 1200×630 jpg quality 0.8 が typical 150-250KB なので 1MB は十分余裕 |
| Track B URL 定数の置き場所 | `page.tsx` 冒頭に const で閉じる | `src/lib/external-links.ts` 新設 | URL 2 件のみで早すぎる抽象。CLAUDE.md「3 行類似ロジックは早すぎる抽象より具体」方針 |
| Track B リンク表示の出し分け | sign-in / sign-out / loading 全状態で常時表示 | 未ログインなら紹介 / ログイン済みなら運営ガイド | 両方常時表示で「未導入の人がトップを見たときに即座に何のアプリか分かる」かつ「既存運営者がいつでも操作リファレンスに飛べる」両方を成立 |
| Track B Button のラッピング | `Button asChild` + 子 `<a>` | `<a>` 内に `<Button>` をネスト / 素の `<a>` + Button class 直接適用 | role を "link" にして既存 `getByRole("button")` e2e を汚染しない。Button styling 維持 |
| Track B e2e の扱い | PageObject に locator 追加のみ、新規 spec は作らない | 専用 spec 新設 | testing.md 規約「観測可能な振る舞い」を既存 spec 経由で検証可能 |
| Track B a11y | aria-label に「新しいタブで開く」を含める | 視覚的なアイコンのみ / sr-only span 別出し | WCAG 2.4.4 / 3.2.5 を最小コードで担保 |
| 旧 PRD `05-result-card-image-bg` のリネーム | フォルダ + PRD ファイル両方を `05-post-launch-polish` にリネーム | フォルダ番号変更 / 旧 PRD を complete 化して新 PRD（06）を起こす | git mv でリネームし内容を Track A として包含。番号 05 を維持することで既存の plan ファイル参照や Implementation Phases の番号空間を破壊しない |

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
_Status: DRAFT - Track A pending / Track B in-progress_
