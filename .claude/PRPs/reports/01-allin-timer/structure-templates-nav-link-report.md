# Implementation Report: Structure Templates への導線追加 & "テンプレート図書館" リネーム

## Summary

Phase 4.8 で `/templates` ページを実装したが、アプリ内からのナビゲーション導線が存在せず **URL 直打ちしかユーザーに提供されていなかった**。本改修で `/structures` のヘッダ右上に `Structure Templates` ボタンを追加し、同時に UI / live docs から「図書館」呼称を `Structure Templates` に統一した。

## Rationale（実装理由）

- **導線**: テンプレートを参照する動機はストラクチャの作成・編集時（ユーザー発言）。従って **`/structures` 一覧がテンプレ図書館への最短導線**として自然。ホーム (`/`) への追加は「テンプレは日常的に開くものではない」「Phase 5 以降で本格運用したらヘッダ導線を再検討」の判断でスキップ。
- **organizer gate**: 既存の「新規作成」ボタンと同じ `isOrganizer` 条件に揃えた。一般メンバー (`member`) は `/structures/new` に進めないためテンプレ閲覧しても次のアクションがなく、UI ノイズになる。
- **呼称統一**: "図書館" は語感としてアプリ UI から浮く／意味が広すぎる、との指摘を受けて `Structure Templates`（Phase 名と一致）にリネーム。Phase テーブルの英名 "Structure Template Library" はそのまま（履歴整合）、UI / 本文中の和名は `Structure Templates` に寄せた。

## 検討したが採用しなかった案

| 案 | 理由 |
| --- | --- |
| ホーム (`/`) にリンク追加 | 日常導線でなく「ストラクチャ作成時の脇道」として提供するのが自然 |
| グローバルヘッダに追加 | 現状グローバルヘッダに 2 次ナビゲーションがないため、スコープ過剰 |
| `StructureTemplatePicker` に "図書館を開く" ボタン追加 | `/structures/new` からの導線はピッカー経由で既に自然。追加すると冗長 |
| 完了済み plan / report / review の "図書館" 文字列を一括置換 | 履歴改変になるため意図的に保留（当時の呼称で記録されている方が audit trail として正しい） |

## Files Changed

### UI
- [src/app/structures/structures-client.tsx](../../../src/app/structures/structures-client.tsx) — organizer 向けヘッダに `Structure Templates` ボタン追加（既存「新規作成」の左隣、`variant="outline"`）
- [src/app/templates/templates-client.tsx](../../../src/app/templates/templates-client.tsx) — h1 を `Structure Templates` にリネーム

### E2E テスト
- [tests/e2e/structure-templates.spec.ts](../../../tests/e2e/structure-templates.spec.ts) — 新 describe "Structure Templates nav from /structures" に 2 ケース追加
  - organizer: `/structures` → `Structure Templates` ボタン表示 → クリックで `/templates` に遷移
  - member: `/structures` で `Structure Templates` / `新規作成` いずれのボタンも非表示（isOrganizer gate の negative）

### コード内コメント
- [firestore.rules](../../../firestore.rules) — `isSignedInNotAnon()` のコメント
- [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) — `describe("structureTemplateBodySchema")` 上のコメント

### Live ドキュメント
- [README.md](../../../README.md) — §5.5 冒頭文
- [.claude/rules/security.md](../../rules/security.md) — section 見出し
- [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) — Phase 4.8 行説明文 / Phase 4.7 Goal 文中クロスリファレンス / Phase 4.8 Goal

### 意図的に変更しなかったファイル（履歴記録）
- `.claude/PRPs/plans/completed/phase-4.7-onboarding-polish-structure-enhancements.plan.md`
- `.claude/PRPs/plans/completed/phase-4.8-structure-template-library.plan.md`
- `.claude/PRPs/reports/phase-4.8-structure-template-library-report.md`
- `.claude/PRPs/reviews/local-phase-4.8-review.md`

## Validation

- `npx tsc --noEmit` — pass（0 errors）
- `npm run lint` — pass（No ESLint warnings or errors）
- `npm test -- --run` — pass（411/411、24 files）
- `npm run build` — pass
- `npx playwright test tests/e2e/structure-templates.spec.ts --list` — pass（全 7 ケース認識、新規 2 ケース含む）
- E2E 実行自体（Firebase Emulator 起動含む）は未実施。Phase 5 の `npm run test:e2e` フル実行時に通常走らせる想定
- UI 挙動のブラウザ手動確認は未実施（E2E でカバーしたため省略可）

## Follow-up 候補

- ホーム (`/`) にも `Structure Templates` リンクを追加するか、Phase 5 以降のドライラン後に再評価
- `/structures/new` / `/structures/[sid]/edit` の `StructureTemplatePicker` に「テンプレを編集する」リンクを足すかは利用頻度を見てから判断
- Phase 4.8 の Phase 名 "Structure Template Library" を "Structure Templates" に揃えるかは、Phase 4.8 を `complete` にする際にまとめて検討
- ~~`/structures` からの導線の E2E ケース追加~~ → 本改修で対応済み（`Structure Templates nav from /structures` describe、organizer/member の 2 ケース）
