# Result Card Background Image（優勝・シーズン首位カード 背景画像カスタマイズ）

## Problem Statement

Phase B（02-season-stats-and-share）で `@vercel/og` ベースの優勝カード / シーズン首位カードの SSR 生成が完成し、Web Share API（Phase D）まで揃ったが、すべてのサークルが同じ amber/navy グラデーション背景なため、カードを SNS シェアしても「どのサークルも同じに見える」「サークルの個性が出ない」状態。サークル代表が新規メンバー勧誘・既存メンバーの帰属意識醸成に活用しづらい。

## Evidence

- 観察: 現状の `WINNER_CARD_STYLE.background = "linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)"` (`src/app/api/og/_lib/og-card-styles.ts:11-21`) は全サークル共通固定。サークル名・トーナメント名以外に視覚的差別化要素なし
- ドライラン由来の声: 「他サークルとの差別化要素が薄い」「もっと盛り上がる絵にしたい」（Foundation 質問の回答 — 「見た目が単調で SNS シェアしたくならない」「カードを保存・シェアしても上手く記念にならない」）
- 仮説検証手段: ドライラン参加サークル / 初期サークル代表からの「使いたくなる / 使いたくない」フィードバック（Foundation 回答 — 主成功シグナル）

## Proposed Solution

`groups/{gid}` に `winnerCardBackground` / `seasonCardBackground` の 2 フィールドを additive 追加し、owner が **サークル詳細画面**から背景画像をアップロード・差し替え・解除できるようにする。画像は **Firebase Storage**（`groups/{gid}/bgImages/{assetId}`）で管理し、OG SSR route が公開 URL を fetch → data URI 変換 → Satori `<img>` で root 背景にレンダリング。背景画像が入った状態でも文字が読めるよう、上下に黒グラデーションスクリムとテキストグループ背景に rgba 半透明 block を重ねる readability layer を導入。owner は「ライト / ダーク」テキストテーマも選択可。

代替案として検討した「リポジトリ同梱プリセット (A)」「URL 直接入力 (D)」「Firestore data URI (E)」は、サークル独自画像の自由度・UX・スケーラビリティで Storage 方式に劣ると判断。Phase 4.10 で deferred されていた Firebase Storage / Blaze プラン移行を本 PRD で先行導入する（owner のみ書込・公開 read のシンプル設計で複雑度を抑える）。

## Key Hypothesis

**サークル独自の背景画像でカードに個性を持たせれば**、トーナメント終了後の優勝カード / シーズン首位カードが SNS シェア・サークル内 LINE / Discord 共有のモチベーションを生み、**サークル代表・参加者から「使いたくなる」フィードバックが得られる**。
**仮説検証**: ドライラン投入後 1〜2 ヶ月以内に、初期サークル代表 3 名以上が背景画像を設定し、設定したサークル内で「次回も使いたい」「他サークルにも勧めたい」の定性フィードバックが得られる。

## What We're NOT Building

- **トーナメント単位の個別背景設定** - サークル単位の 1 枚で十分。`tournaments/{tid}` に背景フィールドは追加しない
- **コラボ画像・ロゴ重ね・ステッカー装飾などのデザインエディタ** - 1 枚画像をそのまま使うのみ。owner が外部ツールで事前加工する
- **シーズンごとに異なる背景** - `startNewSeason` 時の背景アーカイブはしない。シーズンを跨いで同じ背景が継続
- **owner 以外の設定・画像アップロード** - organizer / member は閲覧のみ。owner だけが書込権限を持つ
- **画像タイル / クロップ / 位置調整 のエディタ機能** - 1200×630 への cover/contain フィットのみ。位置調整 UI は出さない
- **複数の背景画像のストック・切替** - サークル × カード種別あたり 1 枚のシンプルリプレースモデル。複数保持・選択拡張は将来対応
- **シーズンスナップショット (シーズン切替時の背景アーカイブ)** - `seasonHistory/{seasonId}` に背景 URL は snapshot しない。過去シーズン詳細は現在の背景で表示
- **テキスト色・レイアウトの per-card override (画像とセット)** - 画像ごとの text-theme プリセット保存はしない。owner は画像交換時に都度テーマ選択
- **背景画像の AI 生成・テンプレート提供** - 画像はあくまで owner が自前で用意

## Success Metrics

| Metric | Target | How Measured |
| --- | --- | --- |
| 設定サークル数 | ドライラン後 1〜2 ヶ月以内に 3 サークル以上が `winnerCardBackground.imageUrl != null` | Firestore コンソールで `groups` collection の手動カウント（v1 では analytics 計測なし） |
| 定性フィードバック（主シグナル） | サークル代表 3 名以上から「使いたくなる」「次回も使う」のポジティブフィードバック | ドライラン後ヒアリング・Issue / Discord での声 |
| 既存機能の regression | カード生成 SSR の p95 latency が +200ms 以内、CDN cache hit rate 維持 | Vercel Analytics / `cache-control: s-maxage=86400` の挙動確認 |
| 背景画像なしの既存挙動互換 | 既存 group（`winnerCardBackground == null`）のカード PNG が完全に同一 | Visual regression（手動比較）+ E2E スナップショット |

## Open Questions

- [ ] 画像クライアント圧縮の上限値（quality 0.8 / 1200×630 jpg で typical 150-250KB は問題ないが、上限 1MB を超える場合は弾くか自動再圧縮するか）— Phase 1 実装計画で確定
- [ ] storage.rules の content-type / size 制約をどこまで厳格に書くか（emulator validator のテストケース粒度）— Phase 1 実装計画で確定
- [ ] テキストテーマ「ライト / ダーク」だけで足りるか、それとも auto（背景平均輝度から自動判定）も提供するか — Phase 3 実装計画で UX 検証
- [ ] Storage の bgImages 旧バージョン（差し替え後の前画像）は **物理削除する** か **孤児として放置** するか — Phase 2 実装計画で確定（current active のみ参照、孤児削除を 1 ファイル単位で best-effort 実行が現実解）

---

## Users & Context

**Primary User**

- **Who**: サークル代表（owner）。20 人前後のサークルを運営し、月 1〜2 回トーナメントを主催。Phase B のカードを既に Twitter/X や LINE グループで共有している
- **Current behavior**: トーナメント終了時にダッシュボードから「カードをダウンロード」「シェア」を 1 回押し、保存または共有。ただし「他サークルとの差別化を意識して保存・共有する」段階には至っていない
- **Trigger**: 新規メンバー勧誘投稿を作るとき / シーズン首位カードを月例まとめでサークル LINE に流すとき
- **Success state**: 「あ、これうちのサークルだ」と一目で分かり、保存・スクショ・シェアが自然に増える状態

**Job to Be Done**
When サークルのトーナメント / シーズンの結果を SNS / サークル内チャットで共有するとき、I want カードに自分のサークルらしさ（会場写真・チームロゴ・象徴的なポーカーシーン等）を反映したい、so I can 既存メンバーの帰属意識を高め、新規メンバー勧誘の説得力を増せる。

**Non-Users**

- organizer / member（v1 では設定不可、閲覧のみ）
- 個人プレイヤー（サークル所属していないユーザー）
- 「カードのデザインに凝りたいデザイナー」（編集機能は提供しないため、外部ツール前提）

---

## Solution Detail

### Core Capabilities (MoSCoW)

| Priority | Capability | Rationale |
| --- | --- | --- |
| Must | owner がサークル詳細画面で **画像アップロード → 即時 Storage upload → groups doc update** | コア機能。これが無いと PRD 自体が成立しない |
| Must | owner が **背景画像を解除（null に戻す）** できる | 失敗時のリカバリ・テスト時に必須 |
| Must | owner が **「ライト / ダーク」テキストテーマ**を選べる | 背景画像の輝度に応じてテキスト色を切り替えないと可読性ゼロになる |
| Must | OG SSR route が **背景画像 URL を query param で受け取り、fetch + data URI で Satori に渡す** | これが無いと PNG に背景が乗らない |
| Must | OG SSR route で **テキスト可読性を担保する readability layer**（上下黒グラデーションスクリム + テキストグループ背景に rgba 半透明 block） | 任意の画像が来ても文字が読める保証 |
| Must | サークル詳細の編集カードで **保存前にプレビュー表示** | 「保存したけど想像と違う」を防ぐ最低限の UX |
| Must | 既存 group（背景未設定）の **カード生成挙動が完全に同一** | 既存サークルへの regression ゼロ |
| Should | アップロード時の **クライアント側自動リサイズ + 圧縮**（1200×630 jpg quality 0.8 → ≤ 1MB） | Storage egress / latency / 1MB ハード上限への耐性 |
| Should | Storage 差し替え時に **旧 asset を best-effort で削除** | 孤児を防ぎ Storage コストを抑える |
| Could | テキストテーマに **auto モード** （画像平均輝度ベースで自動判定） | UX 向上だが MVP には不要 |
| Won't | 画像エディタ / クロップ UI / タイル / 位置調整 | 編集は外部ツール前提 |
| Won't | 複数画像ストック / 履歴 / シーズン別アーカイブ | 1 枚 active のみのシンプルモデル |
| Won't | organizer / member への upload 権限拡張 | owner-only でブランド一貫性確保 |
| Won't | トーナメント単位の個別背景 / per-card override | サークル単位で十分 |

### MVP Scope

- v1 リリース時点で含めるもの
  - Firebase Storage 初期導入（SDK / firebase.json / storage.rules / Blaze プラン移行）
  - `groups/{gid}.winnerCardBackground` / `groups/{gid}.seasonCardBackground` の additive 追加
  - サークル詳細画面に編集カード × 2（優勝・シーズン首位用）。ファイル選択 / プレビュー / 保存 / 解除 / テキストテーマ切替
  - OG SSR route（winner / season 両方）への背景画像レンダリング + readability layer
  - クライアント側画像リサイズ + 圧縮
  - 既存挙動の regression なし

- v1 では含めないが将来的に検討
  - auto テキストテーマ
  - 複数画像ストック / プリセット同梱
  - シーズンスナップショットへの背景アーカイブ
  - organizer 以上への権限拡張
  - 画像クロップ / タイル UI

### User Flow

```
1. owner がサークル詳細画面 (/groups/[gid]) を開く
2. 「優勝カード背景」カードの「画像を選択」ボタンを押す → ファイルピッカー
3. クライアントが画像をリサイズ・圧縮（1200×630 jpg quality 0.8）
4. プレビュー表示（圧縮後の画像をその場で <img> 表示、テキストテーマも切替可能）
5. 「保存」を押す → Storage upload → groups doc update（imageUrl + storageAssetId + textTheme）
6. 旧 asset があれば best-effort で削除
7. ダッシュボードから「カードダウンロード / シェア」 → OG route が新背景でレンダリング
8. （シーズン首位カードも同様に別カードで設定）
9. （解除したい場合）「解除」を押す → groups doc を null に戻し、Storage asset も削除
```

---

## Technical Approach

**Feasibility**: HIGH

既存パターン（Phase 4.16 / 4.17 / Phase A / Phase C / Phase E の `groups/{gid}` 単独フィールド additive 追加）と Phase B の OG route の組み合わせで成立。新規導入要素は (1) Firebase Storage 初期化 / Blaze プラン、(2) クライアント側画像処理（canvas API）の 2 つのみ。

**Architecture Notes**

- **データ構造**: `groups/{gid}.winnerCardBackground` / `groups/{gid}.seasonCardBackground` を `{ imageUrl: string | null, storageAssetId: string | null, textTheme: "light" | "dark" }` で additive 追加。`null` 互換のため schema は `.default(null)` で legacy doc を hydrate
- **Storage path**: `groups/{gid}/bgImages/{assetId}`。`assetId` は `crypto.randomUUID()`。差し替え時は新 asset upload → groups doc update → 旧 asset を best-effort delete
- **Storage rules**: deny-by-default。`groups/{gid}/bgImages/{assetId}` のみ public read（OG SSR route の Vercel Node から fetch するため）。write は owner のみ（Storage rules の `request.auth.token` で `groups/{gid}.ownerUids` 参照は不可なため、Storage rules は「authenticated user の write」+ クライアント / Firestore rules 側で「owner のみが groups doc を更新できる」二重防御）
- **OG route 拡張**: `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` に `bgImageUrl` / `bgTextTheme` を additive 追加。route 内で `bgImageUrl` を fetch → ArrayBuffer → base64 data URI に変換し、Satori `<img src={dataUri}>` で root 背景に重ねる。fetch 失敗時はフォールバック（既存グラデーション背景にフォールバック + warn ログ）
- **Readability layer**: `<div style={{ position: ..., background: "linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.5) 100%)" }}>` を画像の上に重ねる。テキストグループ自体にも `background: "rgba(0,0,0,0.4)"` の rounded box overlay を入れる。Satori 制約の `textShadow` 未対応はこのスクリム + box overlay で代替
- **CDN キャッシュ**: 既存の `s-maxage=86400` を維持。`bgImageUrl` が query param に入るため、画像差し替え時は URL も変わる（assetId が UUID で変わる）→ 自動的に cache invalidation が成立
- **クライアント画像処理**: canvas API で `drawImage(img, 0, 0, 1200, 630)` → `canvas.toBlob(blob, "image/jpeg", 0.8)`。Blob を Storage に直接 upload

**Technical Risks**

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Blaze プラン移行をユーザー（プロジェクト所有者）が忘れて Storage が動かない | M | README + Phase 1 plan に「Blaze 移行が前提」を明記。`storageBucket` 接続失敗時の error handling を OG route に入れる（背景なしフォールバック） |
| 任意の画像で readability が破綻する（白文字 + 白背景画像など） | H | 上下黒グラデーションスクリム + テキストグループ背景 rgba block + テキストテーマ切替の三段構え。最悪でも owner が theme を切り替えれば読める |
| Storage 公開 read で誤って機密画像を upload してしまう（画像内に個人情報など） | L | UI に「公開 URL になります」「メンバー / 観戦者全員に見えます」の注意文を表示 |
| OG route の画像 fetch 失敗（Storage 障害 / token 期限切れ） | L | route 内で try/catch、失敗時は背景なしでフォールバック + `logger.warn`。CDN キャッシュは新規 fetch のみ影響 |
| クライアント画像処理が大きい画像（10MB+）で UI フリーズ | M | upload 前に file.size でチェック → 5MB 超は事前 reject。canvas resize は worker 化までは v1 では不要 |
| Storage egress が予想を超える | L | Vercel CDN cache（`s-maxage=86400`）でほぼ初回 fetch のみ。20 人 × 月 1〜2 回サークルでは月 1MB 以下、Spark 無料枠（1GB/日）の遥か内側 |
| Firebase Storage の SDK 更新で破壊的変更 | L | `firebase` SDK は package.json で固定 version 管理。Phase 1 で動作確認 |

---

## Implementation Phases

<!--
  STATUS: pending | in-progress | complete
  PARALLEL: phases that can run concurrently (e.g., "with 3" or "-")
  DEPENDS: phases that must complete first (e.g., "1, 2" or "-")
  PRP: link to generated plan file once created
-->

| #   | Phase                       | Description                                                                                  | Status  | Parallel | Depends | PRP Plan |
| --- | --------------------------- | -------------------------------------------------------------------------------------------- | ------- | -------- | ------- | -------- |
| 1   | Storage Foundation          | Firebase Storage 初期化、Blaze プラン移行手順、firebase.json / storage.rules / SDK singleton 追加、emulator 統合、`groups/{gid}` schema 拡張、repository / service / rules ブランチ、emulator validator | pending | -        | -       | -        |
| 2   | Background Image UI & SSR   | サークル詳細画面に WinnerCardBackgroundCard / SeasonCardBackgroundCard を追加（ファイル選択 / クライアント圧縮 / プレビュー / 保存 / 解除）、Storage upload + 旧 asset 削除、OG route 拡張（bgImageUrl 受取 + fetch + Satori 画像表示） | pending | -        | 1       | -        |
| 3   | Layout Polish & Readability | 上下黒グラデーションスクリム + テキストグループ rgba 背景 box overlay、ライト / ダーク テキストテーマトグル、テキスト位置の最終調整、E2E + visual regression、ドキュメント整備 | pending | -        | 2       | -        |

### Phase Details

**Phase 1: Storage Foundation**

- **Goal**: Firebase Storage を repository に組み込み、`groups/{gid}` の背景画像メタデータフィールド（imageUrl / storageAssetId / textTheme）をクライアント / Firestore rules / Storage rules すべて経由で書き込み・読み出しできる状態にする。UI / OG route 変更は本 phase では行わない
- **Scope**:
  - Blaze プラン移行手順を README に追加（実プロジェクト切替はユーザー作業）
  - `src/lib/firebase/client.ts` に `firebaseStorage` singleton と emulator connect を追加
  - `firebase.json` に `"storage": { "rules": "storage.rules" }` と `emulators.storage.port = 9199` を追加
  - `storage.rules` を新規作成（deny-by-default + `groups/{gid}/bgImages/{assetId}` のみ public read + authenticated write）
  - `src/lib/firebase/schemas/group.ts` に `winnerCardBackground` / `seasonCardBackground` を additive 追加（zod schema 定義）
  - `src/lib/firebase/repositories/groups.ts` に `updateWinnerCardBackground` / `updateSeasonCardBackground` を `wrapFirestoreWrite` 経由で追加
  - `src/lib/services/group.ts` に `setWinnerCardBackground` / `setSeasonCardBackground` を `assertOwner` ロールゲート付きで追加
  - `firestore.rules` の `groups/{gid}` `allow update` に owner-only `affectedKeys.hasOnly(['winnerCardBackground'])` / `'seasonCardBackground'` ブランチを追加
  - `scripts/test-rules-card-background.mjs` emulator validator を新規作成（owner 書込 OK / organizer 拒否 / member 拒否 / shape 不正拒否）
  - `scripts/test-storage-rules.mjs` emulator validator を新規作成（authenticated upload OK / unauth upload deny / 公開 read OK）
  - `package.json` に `test:rules-card-background` / `test:storage-rules` script を追加
- **Success signal**:
  - `npm run test:rules-card-background` および `npm run test:storage-rules` が green
  - emulator で owner として upload + groups doc update が成功し、anon で read できる
  - 既存テストすべて green、`npm run typecheck` と `npm run lint` が clean
  - 既存 group doc が `winnerCardBackground == null` で hydrate される（破壊的 migration なし）

**Phase 2: Background Image UI & SSR**

- **Goal**: owner がサークル詳細画面から背景画像をアップロード・差し替え・解除でき、その画像が OG SSR route で出力される状態にする。読みやすさ調整は最低限の textTheme 切替まで（本格的なレイアウト polish は Phase 3）
- **Scope**:
  - サークル詳細画面に `WinnerCardBackgroundCard` / `SeasonCardBackgroundCard` を追加
  - ファイル選択 → canvas API で 1200×630 jpg quality 0.8 にリサイズ・圧縮（共通 helper `src/lib/utils/image-resize.ts` を新規作成）
  - upload 前にクライアントでファイルサイズ check（5MB 超は reject、reject 後の error 表示）
  - プレビュー表示（圧縮後の Blob を `URL.createObjectURL` で `<img>` 表示、対応する OG レイアウトのモック）
  - 保存ボタン押下で Storage upload（`uploadBytes` 経由）→ groups doc update → 旧 asset を best-effort delete（`deleteObject`）
  - 解除ボタン押下で groups doc を null に戻し、Storage asset を削除
  - `src/app/api/og/_lib/og-payload.ts` の `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` に `bgImageUrl: z.string().url().optional()` と `bgTextTheme: z.enum(['light', 'dark']).optional()` を追加
  - `buildWinnerShareInputs` / `buildSeasonShareInputs` で `groups/{gid}` の背景設定を読んで query param に流す
  - OG route で `bgImageUrl` 指定時は fetch → ArrayBuffer → `data:image/jpeg;base64,...` 変換 → Satori `<img>` で背景レンダリング
  - fetch 失敗時は背景なしでフォールバック + `logger.warn`
  - 単体テスト（repository / service / OG route のキャラクタリゼーション）
- **Success signal**:
  - owner がアップロード → 画像が即座にプレビューで見える → 保存後にダッシュボードからカード DL すると新背景で出力される
  - 既存 group（背景未設定）のカード PNG が完全に同一（visual diff なし）
  - 旧 asset 削除が best-effort で動作（失敗してもメイン flow は止まらず warn のみ）
  - 単体テスト・既存 E2E 全 green

**Phase 3: Layout Polish & Readability**

- **Goal**: 任意の画像が背景に来てもテキストが読める状態にする。上下スクリム + テキストグループ背景 box overlay + テキストテーマトグルの三段構えで readability を担保し、ドライランで「実用に耐える」状態に仕上げる
- **Scope**:
  - 上下黒グラデーションスクリム overlay を OG route に追加（`linear-gradient(180deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0) 30%, rgba(0,0,0,0) 70%, rgba(0,0,0,0.5) 100%)`）
  - テキストグループ（タイトル / 中央 WINNER 名 / footer）それぞれに `background: rgba(0,0,0,0.4)` + `borderRadius` の box overlay を追加（背景画像を活かしつつ局所的に文字背景を確保）
  - `bgTextTheme === "light"` で foreground を白系（`#ffffff` / `#fde68a`）、`"dark"` で foreground を黒系（既存 `#451a03` / `#1e3a8a`）に切替
  - テキスト位置の最終調整（中央 WINNER 名のフォントサイズが 120 のままで box overlay からはみ出さないか、padding を調整）
  - サークル詳細編集カードに「テキストテーマ ライト / ダーク」の切替トグルとプレビュー反映を追加
  - 編集カードのプレビューが OG route と同じ readability layer を反映するように整合
  - E2E（Playwright）でアップロード → 保存 → ダウンロード → 画像内容アサート（文字が含まれる / 背景画像が含まれる）
  - visual regression（手動）+ ドライラン用ドキュメント（README / `docs/specification/` 該当箇所）
- **Success signal**:
  - 明るい画像 + dark theme / 暗い画像 + light theme / 中間画像 + 両 theme で文字が読める
  - 既存 group（背景未設定）のカード PNG が完全に同一（regression ゼロ）
  - ドライラン投入準備完了（README / 運営ガイドへの記載完了、Codex review 通過）

### Parallelism Notes

Phase 1 → 2 → 3 は厳密に直列依存。Phase 1 が完了しないと Storage への書込ができないため Phase 2 が実装不能、Phase 2 が完了しないと OG route が背景画像を読まないため Phase 3 のレイアウト調整が無意味。各 phase は独立に deploy / dogfood 可能で、Phase 1 完了時点では「設定はできるが見た目に変化なし（OG 未拡張）」、Phase 2 完了時点では「背景は出るが任意画像で文字が読めない可能性あり」、Phase 3 完了時点で v1 完成。

---

## Decisions Log

| Decision | Choice | Alternatives | Rationale |
| --- | --- | --- | --- |
| 画像配信方式 | (C) Firebase Storage 導入 + Blaze プラン移行 | (A) リポジトリ同梱プリセット / (D) URL 直接入力 / (E) Firestore data URI | サークル独自画像の自由度が必須。(A) は自由度ゼロ、(D) は SSRF / 外部依存リスク + UX 悪化、(E) は 1MB doc 上限 + Firestore コスト増。Phase 4.10 で deferred だった Storage 導入を本 PRD で先行実施 |
| 適用範囲 | 優勝カード + シーズン首位カード（別フィールド） | 優勝のみ / 1 フィールドにネスト | サークル代表が両方をブランドに揃えたいケースが想定される。1 フィールドネストは rules `affectedKeys` ブランチが 1 つで済むが、map shape 検証が複雑化。別フィールドの方が `affectedKeys.hasOnly(['winnerCardBackground'])` だけで済み、UI / service / repository も対称的にシンプル |
| 設定者ロール | owner only | owner + organizer / member 自身 | 「サークル代表のブランディング表現」が主目的。複数人が変えるとブランド一貫性が崩れる。Phase 4.6 ロール定義で owner = サークル代表という階層が確立済み |
| ストレージ path | `groups/{gid}/bgImages/{assetId}` | サブコレクション + Storage / Firestore メタデータ管理 | Phase 4.10 の `audioAssets` 設計を踏襲。assetId は `crypto.randomUUID()`。差し替え時は新 upload → groups doc update → 旧削除のシンプルなライフサイクル |
| Storage 公開設定 | `bgImages` path のみ public read | signed URL / Cloud Functions 経由 | OG SSR route（Vercel Node）から fetch する必要があり、signed URL は Cloud Functions / Admin SDK が必要で複雑度大。背景画像は装飾目的で個人情報を含まない前提。UI に「公開 URL になります」を明示 |
| OG route のデータ取得方式 | クライアントが query param で bgImageUrl を渡す（Phase B 設計踏襲） | OG route が SSR で `getDoc(groups/{gid})` | 既存の CDN キャッシュ（`s-maxage=86400`）が「同一 query = 決定的に同じ PNG」を前提。query param 経由なら画像 URL が変わるたびに自動的に cache 無効化。SSR Firestore read だと cache が機能しなくなる |
| Phase 分割 | 3 phases (Storage 基盤 → UI / OG → Layout polish) | 2 phases / 4 phases | 各 phase が独立 deploy / dogfood 可能、PR サイズが適度。2 phases だと Phase 2 が肥大化、4 phases だと細切れすぎて OG 単独 phase の deploy 価値が薄い |
| テキスト可読性デフォルト | 上下黒グラデーションスクリム + テキストグループ背景に rgba 半透明 box | 全画面 50% 黒 overlay / カード型 rounded box overlay | 全画面 overlay は背景画像の雰囲気を冷重金化、カード型は装飾的すぎる。スクリム + テキスト box は背景を活かしつつ局所可読性確保 |
| readability layer の Satori 互換性 | rgba 半透明 div + linear-gradient overlay | textShadow / drop-shadow filter | Satori は `textShadow` / `filter: drop-shadow()` 未対応。`opacity` / `linear-gradient` / `rgba()` は実績あり |
| 旧 asset の扱い | best-effort 削除（deleteObject 失敗してもメイン flow は止めない） | 物理削除を tx 化 / 永続保持 | Storage の delete は別 SDK 呼び出しで Firestore tx に組み込めない。失敗時は孤児になるが Storage コスト的に無視可能（150-250KB × 数枚） |
| クライアント画像処理 | canvas API で 1200×630 jpg quality 0.8 に圧縮 | Web Worker 化 / 外部ライブラリ | 月 1〜2 回の利用頻度で worker は overkill。外部ライブラリは依存追加コスト。canvas API は標準 API、テスト容易 |
| Storage 上限 | 1 ファイル 1MB（Phase 4.10 と同方針） | 500KB / 5MB | 1200×630 jpg quality 0.8 が typical 150-250KB なので 1MB は十分余裕。Storage rules でも `request.resource.size < 1 * 1024 * 1024` で enforce |

---

## Research Summary

**Market Context**

- 同種の参考実装を探索した範囲では、ポーカートーナメント管理 OSS で「優勝者カード SSR 生成 + サークル別背景」を提供している例は限定的（多くは静的テンプレート）。本機能はサークル内部 SNS / LINE 共有で差別化要素を提供する独自路線
- Twitter / X / Instagram など SNS 投稿用 OG カード生成は Notion / Linear / Vercel 自体が広く実装。テンプレート背景 + ロゴ重ねが標準
- ポーカー業界の WSOP / Hendon Mob などのプロ向け統計サイトは 1 サークル単位ではなく公式テンプレートのみ。本 PRD の「サークル単位カスタマイズ」はアマ向けトーナメント管理 OSS のニッチを攻める設計

**Technical Context**

- 既存 PRD 02 Phase B が `next/og` ImageResponse + Noto Sans JP self-host + client-pass-data + CDN cache のパターンを確立。本 PRD はその上に「クエリで bgImageUrl を渡す」だけの additive 拡張
- Firebase Storage 導入は Phase 4.10 で deferred されていた話題。実装規模はそれほど大きくないが、Blaze プラン移行（プロジェクト所有者の Firebase コンソール作業）が一度きりの前提となる
- Satori（next/og の rendering engine）は `textShadow` / `filter` 未対応。代わりに `opacity` / `linear-gradient` / `rgba()` / 半透明 div overlay を使う readability layer 設計が固定パターン
- クライアント側画像処理（canvas + toBlob）の先行事例が repo にゼロ。本 PRD で `src/lib/utils/image-resize.ts` を新規作成し、将来の avatar / thumbnail 機能などで再利用可能な helper として育てる

---

_Generated: 2026-05-10_
_Status: DRAFT - needs validation_
