# Architect Refactor Report — 20260512

## Scope

PRD 05 (Post-Launch Polish) Phase A.1〜A.3（結果カード背景画像 / OG SSR readability layer /
footer-box）の 3 段が一本のブランチ `feat/phase-a.2-background-image-ui-and-ssr` にまとまった
状態で、`src/` 全体を Senior Web Architect + Security Specialist の 2 レンズで監査・段階的
リファクタリングを実施。

- **ベースブランチ**: `feat/phase-a.2-background-image-ui-and-ssr`（baseline `b7ab39e`）
- **作業ブランチ**: `refactor/architect-refactor-20260512`
- **所属 PRD**: `05-post-launch-polish`（Phase A.1〜A.3 follow-up）
- **diff 規模**（src/）: 12 files / +427 / -199 行

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 2 件（finding-1: card-background service duplication / finding-3: OG route boilerplate duplication）
- low: 4 件（finding-2 / finding-4 / finding-5 / finding-9）
- info: 4 件（finding-6 / 7 / 8 / 10 — 既知記録）
- **詳細監査結果**: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260512.md](../reviews/architect-refactor-20260512.md)

## 実施した変更

| commit | 概要 | 影響範囲 |
| --- | --- | --- |
| `c28eeea` | refactor(card-bg): service の winner/season 6 関数を kind 駆動の internal helper に集約 | `src/lib/services/card-background.ts` |
| `4497495` | refactor(card-bg): repository の updateWinner/SeasonCardBackground を field 駆動で集約 | `src/lib/firebase/repositories/groups.ts` |
| `0e24c77` | refactor(card-bg): group service の setWinner/SeasonCardBackground を kind 駆動で集約 | `src/lib/services/group.ts` |
| `bb55732` | refactor(og): OG route の bgImage 取得 / response header / error response を純関数 helper に抽出 | `src/app/api/og/_lib/og-image-fetch.ts` + `og-response.ts` (新規) + winner/season route + tests |
| `488cffd` | refactor(state): live / edit client の tournament.state 直接比較を helper 経由化 | `live-client.tsx` / `tournament-edit-client.tsx` |
| `fccc8ab` | refactor(og): og-payload の GROUP_NAME_MAX 集約と MAX_PARTICIPANTS の limits.ts 連動化 | `og-payload.ts` |

各 commit は atomic で、`git revert` 1 つで安全に戻せる粒度。すべての commit で
typecheck / lint / 該当 unit test が green であることを確認済み。

### finding 対応マッピング

| Finding | 対応 commit |
| --- | --- |
| finding-1 (MEDIUM, service 6 関数 duplication) | `c28eeea` |
| finding-2 (LOW, repository / service ペア duplication) | `4497495` + `0e24c77` |
| finding-3 (MEDIUM, OG route boilerplate) | `bb55732` |
| finding-4 (LOW, tournament-state 直接比較 2 箇所) | `488cffd` |
| finding-8 (INFO, MAX_PARTICIPANTS の limits.ts 連動化) | `fccc8ab` |
| finding-9 (LOW, WINNER_GROUP_NAME_MAX 冗長 alias) | `fccc8ab` |

## 見送った提案（理由付き）

- **finding-5** — `CardBackgroundCard.tsx` の 447 行 → hook 抽出 (`useCardBackgroundFilePicker`) +
  `<ClearConfirmDialog>` 分離。
  既存 `CardBackgroundCard.test.tsx`（358 行）の mock 境界が service + UI flow に張られており、
  hook 抽出はテスト書換が必要。今回スコープでは「テスト網を維持しながら集約する」優先で
  duplication 系を全て片付けたあと、次サイクルで再評価する。T1〜T3 が完了したことで
  `if (kind === "winner") { ... }` 分岐は service 表面で吸収されており、行数削減の効果も
  限定的になった。
- **finding-6** — Storage rule の `firestore.exists + firestore.get` で write 1 回あたり 2 read。
  local-branch-phase-a-review.md M-1 で既知の運用上は無視できる項目。owner 操作のみ・低頻度。
  将来 organizer 拡張時に rule helper 化を検討。
- **finding-7** — `retry.ts` の `signal?.aborted` が sleep 中に反応しない。
  `deleteWithRetry` 専用かつ最大 600ms の遅延で実用上問題なし。汎用化要求が出てから対応。
- **finding-10** — `validateCardBackground` の zod safeParse 部分の defense-in-depth。
  TypeScript narrow 済み callsite で実害なし、零コスト。保留。

## 追加したテスト

| ファイル | 件数 | カバー振る舞い |
| --- | --- | --- |
| `src/app/api/og/_lib/og-image-fetch.test.ts` (拡張) | +5 件 | `prepareBgDataUri` の null url / undefined url / 成功 / fetch 失敗 / 非 allowlist URL の 5 ケース |
| `src/app/api/og/_lib/og-response.test.ts` (新規) | 5 件 | `applyOgImageResponseHeaders` の cache-control / content-disposition / OG_IMAGE_CACHE_CONTROL の構造 / `respondWithOgRenderError` の AppError wrap / AppError idempotency / ctx 省略 |

合計 +10 件。ベースライン 1357 件 → 最終 1367 件。

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | ✅ pass | ✅ pass |
| lint | ✅ pass (0 warnings) | ✅ pass (0 warnings) |
| unit test | ✅ 81 files / 1357 pass / 0 fail | ✅ 82 files / 1367 pass / 0 fail |
| e2e (`card-background.spec.ts`) | ⏸ baseline で未走行（emulator） | ✅ 3 pass / 0 fail (40.1s) |
| build | ✅ pass | ✅ pass（bundle size 不変 ± 0.01 kB） |

E2E は最終検証で `card-background.spec.ts` (OG route / upload / clear UI) を実走行。OG route の
helper 抽出後も PNG fallback / upload 後 imageUrl 反映 / clear Dialog が完全に動作することを確認。

## 観測可能な動作変更なしの根拠

1. **API 表面の維持**: card-background service / groups repository / group service の export 関数
   名・引数型は完全互換（thin wrapper 化）。CardBackgroundCard.tsx などの呼出側はゼロ変更
2. **PNG byte-identicality**: OG route の JSX は触らず、helper は inline コードの 1:1 置換
   （`prepareBgDataUri` は `q.bgImageUrl ? fetchAsDataUri(...).catch(...) : null` と同値の純関数）。
   `card-background.spec.ts` の "fetch 失敗 → グラデ fallback" を通過
3. **rule / schema / Firestore 書込形状**: 変更なし
4. **response header**: `OG_IMAGE_CACHE_CONTROL` は元の constant 文字列をそのまま import、
   `content-disposition` の filename フォーマットも `attachment; filename="<stem>.png"` を維持
5. **AppError code**: `og/render-failed` の wrap idempotency は `respondWithOgRenderError` 経由でも
   `AppError.from` を経由するため、既知 AppError は code が透過される（og-response.test.ts で
   characterize）
6. **tournament-state helpers**: `isFinished` / `canEdit` は既存 80+ 件の characterization で
   bool 値同値性が保証済み

## 残課題 / Next Step

1. **finding-5（CardBackgroundCard.tsx の hook 抽出）** — 次回 architect-refactor サイクルで
   再評価。T1〜T3 で kind 分岐が service 表面で吸収されたため、現状でも追加分割の必要性は
   低下している
2. **finding-6（Storage rule の 2 read 消費）** — Firebase rule の cross-service get で
   `getAfter` 等を試して 1 read に削減できないか調査。owner-only / 低頻度なので緊急性低
3. **finding-7（retry signal sleep 反応）** — `Promise.race` で signal を sleep にも繋ぐ
   汎用化案。`deleteWithRetry` 以外の callsite が増えたタイミングで対応
4. **手動 smoke の推奨** — Vercel preview で:
   - 優勝者カード PNG（背景画像あり/なし × light/dark theme）
   - シーズン首位カード PNG（背景画像あり/なし × light/dark theme）
   - サークル設定タブから背景画像 upload / clear
5. **PR 化** — `/prp-pr` で起票時、本レポートの「実施した変更」セクションを PR 本文の出発点に。
   PR 説明に「観測可能な動作変更なし」「テスト 1357 → 1367 件 (+10) で回帰防御強化」を明記

## 関連リンク

- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260512.md](../reviews/architect-refactor-20260512.md)
- 実施計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260512.plan.md](../plans/architect-refactor-20260512.plan.md)
- 元 PRD: [.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md](../prds/05-post-launch-polish.prd.md)
- 元 Phase A レビュー: [.claude/PRPs/05-post-launch-polish/reviews/local-branch-phase-a-review.md](../reviews/local-branch-phase-a-review.md)
