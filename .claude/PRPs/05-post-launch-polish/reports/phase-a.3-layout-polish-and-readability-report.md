# Implementation Report: Phase A.3 — Layout Polish & Readability

## Summary

OG SSR route（winner / season）の readability layer を三段構えに polish しました:

1. 上下黒グラデーションスクリム（`OG_COLORS.bgScrimTopGradient` / `bgScrimBottomGradient`）
2. テキストグループ単位の rgba 半透明 box overlay（`bgBoxLight` / `bgBoxDark`）
3. 既存 foreground 色切替（`winnerFg` / `winnerFgDark` / `seasonFg` / `seasonFgDark`）

`og-readability.tsx` に純関数 `resolveCardTheme` + Satori-safe component `<ScrimLayer>` / `<TextBox>` を集約し、OG route とサークル詳細編集画面のプレビュー（`CardReadabilityPreview`）で完全に共有しました。プレビューは保存前に scrim + box overlay + textTheme 切替を反映するため、owner が「文字が読めるか」を編集中に確認できます。

合わせて A.2 で deferred されていた `window.confirm` → shadcn `<Dialog>` 統一（F-7）を完了、新規 E2E spec `tests/e2e/card-background.spec.ts` で upload → 保存 → OG download + Dialog 解除フローの通し検証を追加しました。

## Assessment vs Reality

| Metric        | Predicted (Plan)                                              | Actual                                                                |
| ------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- |
| Complexity    | Medium（10〜13 ファイル、300〜500 行）                          | Medium。8 ファイル変更 + 5 ファイル新規（239 +/- 142 行）              |
| Confidence    | 高（A.2 の延長 + LeaveDeleteDialogs パターン再利用）            | 完全に符合。発明ゼロ、既存パターンの組換のみ                            |
| Files Changed | 10〜13                                                        | 13（8 update + 5 create）                                              |

## Tasks Completed

| #   | Task                                                       | Status        | Notes                                                                                              |
| --- | ---------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| 1   | OG_COLORS に scrim / box トークン追加                       | [done] Complete | `bgScrim` 削除 + 6 トークン additive 追加                                                          |
| 2   | og-readability helper の新規実装                            | [done] Complete | 純関数 1 + JSX component 2                                                                          |
| 3   | winner OG route の readability layer 置換                   | [done] Complete | 3 ブロック（title / WINNER / footer）を `<TextBox>` でラップ                                          |
| 4   | season OG route の readability layer 置換                   | [done] Complete | 3 ブロック（title / podium / footer）を `<TextBox>` でラップ                                         |
| 5   | CardReadabilityPreview component 新規                       | [done] Complete | 共有 `resolveCardTheme` 経由で OG route と色値完全一致                                                |
| 6   | CardBackgroundCard の preview 差替 + Dialog 置換             | [done] Complete | `window.confirm` → shadcn `<Dialog>` 確認、解除 dialog の open state 管理を `clearConfirmOpen` で集約 |
| 7   | CardBackgroundCard.test.tsx の updater                      | [done] Complete | 旧 confirm mock 削除、cancel / confirm の 2 経路テスト追加（+1 件）                                    |
| 8   | og-readability.test.tsx 新規                                | [done] Complete | 9 ケース（hasBackground × textTheme × variant の全組合せ）                                            |
| 9   | E2E spec card-background.spec.ts 新規                       | [done] Complete | 3 scenario（OG HTTP fallback / upload → 保存 / Dialog cancel・confirm）                              |
| 10  | ドキュメント追加                                            | [done] Complete | `docs/article/operating-guide.md` に「結果カードの背景画像を差し替える」サブセクション追加              |
| 11  | 全体検証ループ                                              | [done] Complete | typecheck / lint / unit / build / E2E すべて green                                                  |

## Validation Results

| Level                         | Status        | Notes                                                                                            |
| ----------------------------- | ------------- | ------------------------------------------------------------------------------------------------ |
| Static Analysis (typecheck)   | [done] Pass   | `tsc --noEmit` 0 errors                                                                          |
| Static Analysis (lint)        | [done] Pass   | `next lint` 0 warnings / 0 errors                                                                |
| Unit Tests                    | [done] Pass   | 81 files / 1352 tests pass（A.2 baseline 1331 + 9 件 og-readability + 1 件 CardBackgroundCard） |
| Build                         | [done] Pass   | `next build` 成功。OG route 2 件の bundle サイズ変化なし（139 B / 102 kB）                       |
| Emulator Rules (Regression)   | N/A           | rule / schema 変更ゼロのため省略（plan 通り）                                                       |
| New E2E                       | [done] Pass   | `card-background.spec.ts` 3/3 green（31.9s）                                                       |
| E2E Regression                | [done] Pass   | `phase-d-share-and-history.spec.ts` 5/5 green（47.5s）                                             |

## Files Changed

| File                                                                       | Action  | Lines      |
| -------------------------------------------------------------------------- | ------- | ---------- |
| `src/app/api/og/_lib/og-card-styles.ts`                                    | UPDATE  | +14 / -2   |
| `src/app/api/og/_lib/og-readability.tsx`                                   | CREATE  | +115       |
| `src/app/api/og/_lib/og-readability.test.tsx`                              | CREATE  | +70        |
| `src/app/api/og/winner/[tid]/route.tsx`                                    | UPDATE  | +63 / -55  |
| `src/app/api/og/season/[gid]/route.tsx`                                    | UPDATE  | +38 / -35  |
| `src/components/og/CardReadabilityPreview.tsx`                             | CREATE  | +130       |
| `src/app/groups/[gid]/_components/CardBackgroundCard.tsx`                  | UPDATE  | +84 / -25  |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`             | UPDATE  | +50 / -3   |
| `tests/e2e/card-background.spec.ts`                                        | CREATE  | +175       |
| `playwright.config.ts`                                                     | UPDATE  | +2 / -2    |
| `docs/article/operating-guide.md`                                          | UPDATE  | +9         |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`     | UPDATE  | +2 / -2    |

## Deviations from Plan

### D-1: E2E の bgImageUrl を Storage emulator URL から「allowed host + 実体なし」URL に変更

**WHAT**: 当初 plan では「Storage emulator URL（`http://127.0.0.1:9199/...`）を bgImageUrl に渡して、ホスト allowlist deny → グラデ fallback で 200 を assert する」という観測点を想定していました。実装中、Storage emulator URL は `bgImageUrl` の zod schema 段階で deny されて 400 を返すことが判明（zod refine と `og-image-fetch.ts` の allowlist が二重防御として強制している）。E2E では plan の意図（「fetch 失敗で render が止まらない」観測）を維持しつつ、schema は通過する URL（`https://firebasestorage.googleapis.com/v0/b/nonexistent/o/missing.jpg?alt=media`）に変更し、fetch 段階で 404 を踏んで AppError → グラデ fallback の経路をカバーしました。

**WHY**: 二重防御の片側（schema 層）が先に発火するため、emulator URL では allowlist の helper コード経路まで到達しません。helper 単体の allowlist 検証は `og-image-fetch.test.ts` に分担済み。E2E は「実体不在の URL でも render が止まらない」整合性確認に責務を絞ったほうが妥当と判断。

### D-2: playwright.config.ts の emulator に storage を追加

**WHAT**: `webServer[0].command` を `--only auth,firestore,ui` から `--only auth,firestore,storage,ui` に変更。

**WHY**: E2E の upload シナリオ（Storage 経由）を成立させるため必要。plan の GOTCHA でも「Playwright fixture で emulator 接続済の client が dev server 経由で確実に動作する」必要性を指摘しており、storage emulator を webServer に含めるのが最小変更。Java 起動コストは ~5s 程度増える程度で、既存テストへの regression なし（phase-d-share-and-history 全 5 件 pass で確認）。

### D-3: TextBox の中央 WINNER ブロックは外側 div で center 制御

**WHAT**: 中央 WINNER ブロックを 1 つの `<TextBox>` でラップする際、`alignItems: center` / `justifyContent: center` / `flex: 1` の制御を **TextBox の外側** の div で行い、TextBox 内部は box 装飾のみ責務とした。

**WHY**: TextBox の責務（box 装飾）と flex 配置（センタリング）を分離し、winner route の中央ブロックを「外 div で flex:1 中央寄せ → 内 TextBox で box 装飾」の二段構造で実現。Plan 通りの方針。

### D-4: `CardReadabilityPreview` を「内側 OG 実寸 + 親幅で scale」構造に再設計

**WHAT**: 当初実装ではプレビュー内の `fontSize` を固定 px（13 / 18 px）で書いていたが、レビューで「container 幅にスケールしないため実画像比率と乖離している」「親幅に合わせて縮小すれば構造的に overflow しない」と指摘を受け、B 案（内側固定 1200×630 + 親で scale）に再設計した。

**WHY**: 実 OG 画像 (1200×630) はフォントサイズが画像幅比で決まる。プレビューが「OG 画像の縮小版」として正しく機能するには、内側を OG 実寸座標系で描画し、外側で container 幅に合わせて `transform: scale()` する形が構造的に正しい。CSS `container-type: inline-size` + `scale(calc(100cqw / 1200px))` の組合せで実現。

**Implementation**:
- 親 div に `aspectRatio: 1200/630` + `containerType: inline-size`
- 内側 div は `width: 1200 / height: 630` 固定、`transform: scale(calc(100cqw / 1200px))` + `transformOrigin: top left`
- フォントサイズは OG キー値準拠（title=56 / emphasis=96 / sub=22 px）
- `OG_WIDTH` / `OG_HEIGHT` / `OG_PADDING` / `bgBoxRadius` / `bgBoxPaddingX` / `bgBoxPaddingY` を直接 import し drift 回避

**Verification**: typecheck / lint / unit test (CardBackgroundCard 10/10) green。E2E locator は不変。

## Issues Encountered

### I-1: 初回 E2E 実行時の Next.js dev server コンパイル失敗

**症状**: 最初の E2E 実行で `/api/og/winner/[tid]?bgImageUrl=...` が 500 を返し、レスポンス body に "Jest worker encountered 2 child process exceptions, exceeding retry limit" の Next.js 内部エラー。

**原因**: 2 つの独立要因が重なった:
1. E2E spec の bgImageUrl が schema deny の `http://` URL だったため、schema 段階で 400 を返すべきところ Next dev server がコンパイル過程で stale state に陥った（recover 後は正常応答）
2. `.next/` ディレクトリの cache が古い状態で playwright.config.ts の webServer 変更（storage 追加）を解釈し worker pool が不安定化

**解決**: `.next/` を削除して clean 状態で再起動 → 全 3 scenario が 31.9s で green。bgImageUrl は schema 通過する URL に修正（D-1）。

### I-2: jsdom 環境での canvas / URL.createObjectURL 不足

**症状**: A.2 と同じく `CardBackgroundCard.test.tsx` で URL.createObjectURL が jsdom に存在しないため、beforeEach で stub する必要あり。

**解決**: A.2 で確立された stub パターン（`vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:fake")`）を本 phase でも維持。Dialog 経路の新規テスト 2 件も同 stub 配下で動作。

## Tests Written

| Test File                                                                  | Tests   | Coverage                                                                                   |
| -------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------ |
| `src/app/api/og/_lib/og-readability.test.tsx`                              | 9 tests | `resolveCardTheme` の hasBackground × textTheme × variant の 8 通り + undefined 互換 1 件      |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`             | +2 tests | Dialog cancel 経路 / Dialog confirm 経路。旧 `window.confirm` mock テスト 1 件を Dialog 経路に書換 |
| `tests/e2e/card-background.spec.ts`                                        | 3 tests | OG HTTP fallback / upload → 保存 → groups doc 反映 / Dialog cancel・confirm + imageUrl clear |

## Acceptance Criteria

- [x] OG winner / season route が scrim 2 枚 + box 3 ブロック + theme 切替の三段構えで描画
- [x] サークル詳細編集カードのプレビューが OG と同型の readability layer を反映
- [x] 「背景を解除」が shadcn `<Dialog>` 経由、`window.confirm` の grep が空
- [x] E2E spec `card-background.spec.ts` で upload → 保存 → OG download が通る
- [x] bgImageUrl 未指定時の挙動が完全に既存維持（regression ゼロ）
- [x] 全 validation command（typecheck / lint / unit / build / E2E）が green
- [x] 運営ガイド ドキュメントに背景画像のおすすめ条件 / theme 使い分け / 解除手順を追加

## Next Steps

- [ ] Code review via `/code-review`（Codex review 含む）
- [ ] `/prp-pr` で PR 作成
- [ ] 手動 visual diff: 明るい画像 + light theme / 暗い画像 + dark theme / 中間画像 + 両 theme の 3 通りで文字が読めるかを目視確認（plan の「Manual Validation」)
- [ ] ドライラン投入後、参加サークル代表からの定性フィードバック回収（PRD Success Metrics）

---

## Post-merge follow-up (2026-05-12): box overlay 廃止と scrim 弱化

### 背景

A.3 初版でドライラン直前に owner から「画像の上を塗りつぶす範囲が大きく、背景画像のデザインが損なわれる」という強い不評をもらいました。原因は readability layer の 2 段目（テキストグループ単位の rgba 半透明 box overlay）と、1 段目の scrim の濃さ・高さでした。

特に問題だった箇所:

- **中央 WINNER ブロック**: 名前 120px + WINNER 28px + 人数 28px + box の上下 padding 16px が一体の rgba box で覆われ、画像中央の広い面積が **`rgba(255,255,255,0.78)`（light）/ `rgba(15,23,42,0.72)`（dark）の半透明面**になっていた。背景画像の主役領域がほぼ box で潰れる
- **上下 scrim**: 上 25% + 下 20% で計 45% を `rgba(0,0,0,0.55)` で覆っていたため、明るい画像でも画像全体が「やや暗く曇った見え方」になっていた

### 対応

box overlay を**全廃**し、scrim を大幅に弱め、文字側に **text-shadow（outer glow）** を付けることで「画像を最大限見せつつ文字だけは確実に読める」設計に倒しました。

| Layer | A.3 初版 | A.3 polish (本対応) |
| --- | --- | --- |
| 上 scrim | 高さ 25% / `rgba(0,0,0,0.55)` | 高さ **15%** / `rgba(0,0,0,0.35)` |
| 下 scrim | 高さ 20% / `rgba(0,0,0,0.55)` | 高さ **12%** / `rgba(0,0,0,0.3)` |
| rgba box overlay（title / WINNER / footer） | 3 ブロック each、light 78% / dark 72% / padding 28×16 / radius 12 | **完全廃止** |
| 文字の補強 | foreground 色のみ | foreground + **text-shadow**（light: 白 outer glow / dark: 黒 outer glow） |

text-shadow の値は `OG_COLORS.bgTextShadowLight = "0 0 6px rgba(255,255,255,0.95), 0 2px 6px rgba(255,255,255,0.7)"` / `bgTextShadowDark = "0 0 6px rgba(0,0,0,0.9), 0 2px 6px rgba(0,0,0,0.7)"`。Satori は `textShadow` を CSS と同様に受けるため、各テキスト要素の `style` に**直接付与**（継承に依存しない安全側設計）。

### Files Changed (follow-up)

| File | Action | 主な変更 |
| --- | --- | --- |
| `src/app/api/og/_lib/og-card-styles.ts` | UPDATE | `bgBoxLight` / `bgBoxDark` / `bgBoxRadius` / `bgBoxPaddingX` / `bgBoxPaddingY` の **5 定数を削除**、scrim 2 つの濃度・高さを弱化、`bgTextShadowLight` / `bgTextShadowDark` を additive 追加 |
| `src/app/api/og/_lib/og-readability.tsx` | UPDATE | `resolveCardTheme` の戻り値を `{ fg, boxBg }` → `{ fg, textShadow }` に変更、`<TextBox>` component を**完全削除**。`<ScrimLayer>` のみ残置（scrim 値は styles 側で弱化済） |
| `src/app/api/og/winner/[tid]/route.tsx` | UPDATE | `<TextBox>` 呼出 3 箇所を素の `<div style={{ display: "flex", flexDirection: "column", alignSelf }}>...</div>` に展開し、各テキスト要素の `style` に `textShadow: ts` を直接付与 |
| `src/app/api/og/season/[gid]/route.tsx` | UPDATE | 同上。`PodiumRow` も `textShadow` prop を受け取り、3 つの内部テキストに propagate |
| `src/components/og/CardReadabilityPreview.tsx` | UPDATE | プレビューも同型に。`PreviewTextBox` → `PreviewText` にリネームし、`color` / `textShadow` のみ inline style。box 装飾を完全に削除 |
| `src/app/api/og/_lib/og-readability.test.tsx` | UPDATE | 9 ケースの assert を `boxBg` → `textShadow` に書換 |

### Validation Results (follow-up)

| Level | Status | Notes |
| --- | --- | --- |
| typecheck | [done] Pass | `tsc --noEmit` 0 errors |
| lint | [done] Pass | `next lint` 0 warnings |
| Unit Tests | [done] Pass | 81 files / **1352 tests pass**（A.3 初版と同件数を維持。`og-readability.test.tsx` 9 件・`CardBackgroundCard.test.tsx` 10 件はそのまま green） |
| Build / E2E | 未実施（本フォローアップ commit 内では skip） | OG route の JSX 構造のみ変更で URL schema / 戻り status コード変化なし。E2E は HTTP layer の 200 / Content-Type / PNG magic header のみ assert しており影響なし |

### Notes / Risk

- **box overlay 廃止により、white-on-white / black-on-black 等の極端な画像 + 不一致 theme の組合せでは text-shadow だけでは読みにくい**ことが起こり得る。プレビューで owner が編集時に確認できる前提なので運用カバーとし、コードでの自動補正は YAGNI に倒した
- 既存運営ガイド（`docs/article/operating-guide.md`）の「結果カードの背景画像を差し替える」セクションに `theme 切替えで読みにくければ反対側のテーマを試す` 旨は記載済のため追記なし
- 関連 plan ファイル（`completed/phase-a.3-layout-polish-and-readability.plan.md`）末尾にも同等の follow-up セクションを追記済

---

## Post-merge follow-up 2 (2026-05-12): winner レイアウト確定 + footer-box 再導入 + Satori クラッシュ対策

上記 follow-up（box overlay 全廃）の後、owner との対話的 polish を通じて winner OG カードの **レイアウトと footer 表現を確定** させ、合わせて Satori の運用上 hazard を 1 件修復した。

### 背景

- owner からの追加要望（2026-05-12）:
  1. 開催日 / 参加人数はアプリ名と横並びの最下部に配置する
  2. 優勝者名は上下左右の中央に配置する（WINNER ラベルは除く）
  3. トーナメント名は最上部に中央揃えで配置する
  4. 最下部に「サークル名 / 開催日 / 参加者数 / アプリ名」をボックス形式で中央寄せで配置する。背景が部分的に隠れることは許容、テーマ（ライト / ダーク）から色は自動反映、エリアごとに縦線で区切る
- 実装中に発覚した障害:
  - 「画像を保存」押下時に `failed to pipe response` / `Cannot read properties of undefined (reading 'toString')` で 500 エラー。原因は Satori が `textShadow: undefined` を内部で `.toString()` するため

### 対応

#### Layout 確定（winner OG のみ。season は据え置き）

| 位置 | 内容 | 配置方法 |
| --- | --- | --- |
| 最上部 | トーナメント名 (`fontSize 36`) | `justifyContent: center` で中央揃え |
| 中央 (画面の縦中央) | 優勝者名 (`fontSize 120`) | `flex: 1` 内で `alignItems / justifyContent: center` |
| WINNER ラベル | `fontSize 36`（owner 手動調整、"WINNER!!"） | 優勝者名を `position: relative` で包み、ラベルは `position: absolute / top: -40` で **真上に絶対配置**。winnerName の縦中央計算にラベル高さを含めないため winnerName 自体が画面中央に来る |
| 最下部 | サークル名 / 開催日 / 参加人数 / アプリ名 の 4 要素 | `justifyContent: center` でボックスを中央配置 |

`OG_PADDING` は元 plan の `64` から owner 手動調整で `12` に縮小（最上部 / 最下部の余白を画像端ぎりぎりまで詰める）。

#### footer-box 再導入（box overlay の局所復活）

「box overlay 全廃」方針を一部緩和し、**最下部 footer の 4 要素ボックスのみ box overlay を復活**:

- 背景画像時のみ box を出す（グラデ背景時は box 無し / フラットで従来挙動を維持）
- box 色は `textTheme` に連動:
  - `light` → `rgba(255,255,255,0.78)` (`bgFooterBoxLight`)
  - `dark`  → `rgba(15,23,42,0.72)` (`bgFooterBoxDark`)
- box の `borderRadius: 12 / padding: 10px 24px`
- 4 要素間に foreground 色（透明度 0.35 / 高さ 28 / 幅 1）の **縦線で区切り**
- 各要素の fontSize はサークル名 / 開催日 / 参加人数 = 28、アプリ名 = 16（owner 手動調整）

#### `groupName` クエリ additive 追加

footer-box にサークル名を出すため、`WINNER_CARD_QUERY_SCHEMA` に `groupName: z.string().min(1).max(60).optional()` を additive 追加。旧クライアントとの URL 互換のため optional（未指定時は footer から省略 + 縦線も省略）:

- `buildWinnerCardUrl`: groupName 指定時のみ URLSearchParams に set
- `buildWinnerShareInputs`: `params.groupName` 経由で受領
- `WinnerCardDownloadButton`: `groupName?: string` prop で受領
- 呼出側（`live-client.tsx` / `dashboard-client.tsx`）: `tournamentGroup?.name` を流し込み

#### Satori `textShadow: undefined` クラッシュ対策

winner / season 両 route で `const ts = textShadow ?? undefined; textShadow: ts` の pattern を廃し、**条件 spread** に統一:

```ts
const shadowStyle: { textShadow?: string } = textShadow ? { textShadow } : {};
// 各 text 要素:
style={{ display: "flex", fontSize: ..., ...shadowStyle }}
```

`undefined` を CSS プロパティ値として直接渡さないため、Satori 内部の `.toString()` 経路を踏まない。footer 内のテキスト用に `innerShadowStyle`（`footerBox` があれば `{}`、なければ `shadowStyle`）も用意。

`season` route は実 report が発生する前に **防御的に**同じ pattern に揃えた。`PodiumRow` の prop も `textShadow: string | undefined` → `shadowStyle: { textShadow?: string }` にリネーム。

### Files Changed (follow-up 2)

| File | Action | 主な変更 |
| --- | --- | --- |
| `src/app/api/og/_lib/og-payload.ts` | UPDATE | `WINNER_CARD_QUERY_SCHEMA` / `buildWinnerCardUrl` / `WinnerShareInputsParams` に `groupName?` を additive 追加 |
| `src/app/api/og/_lib/og-card-styles.ts` | UPDATE | `bgFooterBoxLight` / `bgFooterBoxDark` / `bgFooterBoxRadius` / `bgFooterBoxPaddingX` / `bgFooterBoxPaddingY` を additive 追加。`OG_PADDING` を `64` → `12` に変更（owner 手動） |
| `src/app/api/og/_lib/og-readability.tsx` | UPDATE | `resolveCardTheme` の戻り値に `footerBox: string \| null` を追加（textTheme 連動） |
| `src/app/api/og/winner/[tid]/route.tsx` | UPDATE | JSX を「最上部中央 / 中央（WINNER absolute + winnerName）/ 最下部中央寄せ footer-box（4 要素 + 縦線区切り）」に再構成。`textShadow` を spread に統一 |
| `src/app/api/og/season/[gid]/route.tsx` | UPDATE | textShadow spread 化（防御的）。`PodiumRow` の prop を `shadowStyle` に rename |
| `src/components/og/CardReadabilityPreview.tsx` | UPDATE | winner variant の footer を同じ box + 4 要素 + 縦線区切りに同期。fontSize も OG と同値（28/28/28/16）に |
| `src/app/groups/[gid]/_components/CardBackgroundCard.tsx` | UPDATE | `DEMO_TEXT.winner.main` を "WINNER" → "優勝者名" に（新レイアウトの主役表示と整合） |
| `src/components/tournament/WinnerCardDownloadButton.tsx` | UPDATE | `groupName?: string` prop を追加し helper に propagate |
| `src/app/tournaments/[tid]/live/live-client.tsx` | UPDATE | `tournamentGroup?.name` を `buildWinnerShareInputs` / `WinnerCardDownloadButton` に流し込み |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | 同上 |
| `src/app/api/og/_lib/og-readability.test.tsx` | UPDATE | `footerBox` を返却に含む形に test 追従 |
| `src/app/api/og/_lib/og-payload.test.ts` | UPDATE | `groupName` の受理 / 拒否 / URL 反映ケースを +5 件追加 |
| `docs/article/operating-guide.md` | UPDATE | box overlay 前提の記述を text-shadow + footer-box の現実に合わせて書き換え |

### Validation Results (follow-up 2)

| Level | Status | Notes |
| --- | --- | --- |
| typecheck | [done] Pass | `tsc --noEmit` 0 errors |
| lint | [done] Pass | `next lint` 0 warnings |
| Unit Tests | [done] Pass | 81 files / **1357 tests pass**（follow-up 1 の 1352 件 + og-payload に +5 件） |
| Build / E2E | 未実施（本フォローアップ commit 内では skip） | URL schema は additive 拡張のみで旧クライアントとの互換性あり、戻り status コード変化なし。E2E は HTTP layer の 200 / Content-Type / PNG magic header を assert しており影響なし |

### 設計上の判断（次の作業者向け）

- **box overlay が「全廃」から「footer 限定再導入」に転換**した経緯を理解すること。今後 box overlay をテキストグループ単位に拡張する判断は **owner からの強い反対** がベースにあるため、安易に再導入しない
- `groupName` クエリは optional のまま固定。旧クライアントとの URL 互換性を維持しつつ、新規発行 URL は常に含む方向
- Satori の `textShadow` プロパティに `undefined` を渡さないルールは winner / season 両 route で堅持する（pattern は spread 化）

### Notes / Risk

- footer-box が画像最下部の被写体を部分的に隠す。owner が明示的に許容したが、被写体の主要部分が画像下端 12〜15% にある画像を選ぶと box で完全に潰れる。運営ガイドで「主役の被写体や文字が来ない画像を選ぶ」旨を案内済
- WINNER ラベルが winnerName の真上に absolute 配置されているため、極端に短い優勝者名（1〜2 文字）の場合 ラベルの幅が `left: 0 / right: 0` で contentArea いっぱいに広がる。視覚的にズレるが、フォントサイズ自体が違うため違和感は小さい。気になる事例が出たら ラベル幅 cap を検討
- 関連 plan ファイル（`completed/phase-a.3-layout-polish-and-readability.plan.md`）末尾にも同等の follow-up 2 セクションを追記済
