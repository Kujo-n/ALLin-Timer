# Implementation Report: トップ画面 note 記事 2 本リンク（環境変数方式）

## Summary

トップ画面 `/` に、note 公開記事 2 本（アプリ紹介 / 運営ガイド）への外部リンクを追加した。
URL は `NEXT_PUBLIC_NOTE_INTRO_ARTICLE_URL` / `NEXT_PUBLIC_NOTE_OPERATING_GUIDE_URL` の
環境変数から注入し、コード内には URL リテラルを一切残さない。env 未設定時はリンク自体を
非表示にして fork 直後でも UI が破綻しないフォールバックを持つ。

PRD `05-post-launch-polish` の Track B（Top Page Promotion）Phase B.1 として実装。

## Assessment vs Reality

| Metric        | Predicted (Plan)                                  | Actual                                |
| ------------- | ------------------------------------------------- | ------------------------------------- |
| Complexity    | Small（1 ファイル中心 + env サンプル + 周辺）     | Small（4 ファイル更新、新規 0）       |
| Confidence    | High（既存パターン踏襲）                          | High                                  |
| Files Changed | 4 件修正 + 1 件新規（`.env.local.example`）       | 4 件修正、新規 0（既存 `env.local.example` に追記） |

## Tasks Completed

| #   | Task                                            | Status          | Notes |
| --- | ----------------------------------------------- | --------------- | ----- |
| 1   | env テンプレートに NOTE_* 追記                  | [done] Complete | 既存 `env.local.example` に追記（plan Task 1 GOTCHA に従い `.env.local.example` 新規作成は行わず） |
| 2   | `.env.local` / Vercel への確定 URL 設定         | [done] Complete | 運用作業（`.env.local` はユーザー側で設定済み） |
| 3   | page.tsx で env を読み ExternalLink import      | [done] Complete |       |
| 4   | note リンクセクションを env 条件付きで追加      | [done] Complete |       |
| 5   | TopPage PageObject に link locator 追加         | [done] Complete | `expectSignedOutLayout` / `expectSignedInLayout` 双方に visible assert 追加 |
| 6   | playwright.config.ts の env 注入                | [done] Complete | `example.test` ドメインの dummy URL 採用（plan の `note.com/example/...` ではなく実 note ユーザに衝突しない方式） |
| 7   | README に env 設定手順追記                      | [done] Complete | 既存 env 一覧表に 2 行追加 + 補足注記 |

## Validation Results

| Level           | Status      | Notes                                    |
| --------------- | ----------- | ---------------------------------------- |
| Static Analysis | [done] Pass | typecheck / lint いずれも 0 errors       |
| Unit Tests      | [done] Pass | 既存 75 ファイル / 1274 tests 全 green、本 plan で追加なし（plan Testing Strategy 準拠） |
| Build           | [done] Pass | Next.js build green、`/` ルート 5.46 kB（追加 ≈ 2 kB） |
| Integration     | N/A         | E2E 実走行はユーザー側で実施（emulator + Playwright 環境） |
| Edge Cases      | [done] Pass | env 両方未設定時セクション非表示 / 片方のみで該当リンクのみ表示 / `target=_blank` + `rel=noopener noreferrer` / `aria-label`（新しいタブで開く）はコード上で確認 |

## Files Changed

| File                              | Action  | Lines   |
| --------------------------------- | ------- | ------- |
| `env.local.example`               | UPDATED | +8      |
| `src/app/page.tsx`                | UPDATED | +50 / -1 |
| `tests/e2e/pages/TopPage.ts`      | UPDATED | +10     |
| `playwright.config.ts`            | UPDATED | +5      |
| `README.md`                       | UPDATED | +4      |

## Deviations from Plan

| Item                                | Plan                                              | Actual                                            | Why |
| ----------------------------------- | ------------------------------------------------- | ------------------------------------------------- | --- |
| env テンプレートファイル            | `.env.local.example` を新規作成                   | 既存 `env.local.example` に追記                   | リポジトリに既存の同等命名ファイルあり、plan Task 1 GOTCHA「既存命名がある場合はそちらに追記」に従った |
| e2e dummy URL のドメイン            | `https://note.com/example/...`                    | `https://example.test/note-...`                   | plan Task 6 GOTCHA「note.com 配下にしない」に従い、実 note ユーザへの偶然衝突を完全回避（既存テストでも `example.test` ドメインを使用しており一貫） |

いずれも plan 内の GOTCHA / 推奨に沿った合理的な選択で、設計意図には反していない。

## Issues Encountered

なし。

## Tests Written

| Test File | Tests | Coverage |
| --------- | ----- | -------- |
| -         | -     | unit test 追加なし（plan Testing Strategy で省略を明示）。e2e は既存 PageObject 拡張のみ |

## Next Steps

- [ ] ローカル `npm run dev` で sign-out / sign-in 両状態の目視確認（ユーザー側）
- [ ] `npm run test:e2e`（emulator 起動が必要）で TopPage 経由の既存 spec が green であること
- [ ] Vercel Project Settings に Production / Preview の env 登録
- [ ] `/code-review` で変更レビュー
- [ ] `/prp-pr` で PR 作成
