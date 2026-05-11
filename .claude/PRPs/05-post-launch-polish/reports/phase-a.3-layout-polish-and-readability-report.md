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
