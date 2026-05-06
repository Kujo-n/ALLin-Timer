# Local Review: Structure Templates 導線追加 & 呼称リネーム

**Reviewed**: 2026-04-24
**Scope**: 現在 working tree の uncommitted changes（branch: `develop`）
**Decision**: APPROVE

## Summary

`/structures` ヘッダ右上に `Structure Templates` ボタン（organizer-only）を追加して `/templates` への導線を提供。同時に UI／live docs／コード内コメントから「テンプレート図書館」呼称を `Structure Templates` に統一した。履歴ファイル（`.claude/PRPs/plans/completed`, `reports`, `reviews`）は意図的に残置。実装レポート（`structure-templates-nav-link-report.md`）で理由を明文化済み。

追加で E2E テスト 2 ケース（organizer positive / member negative）を追加し、L3 指摘を解消済み。

機能変更は 1 箇所（JSX Fragment 追加 + Link/Button 2 個）のみで、残りはすべて文字列のリネームまたはコメントのみ。セキュリティ影響なし、全バリデーション pass（typecheck / lint / test 411 pass / build / playwright --list 7 tests）。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

None.

### LOW

#### L1: 匿名 organizer が理論上ボタンをクリックして弾かれるエッジケース

- **Location**: [src/app/structures/structures-client.tsx:82-91](../../../src/app/structures/structures-client.tsx#L82-L91)
- **Issue**: ボタンの表示条件は `isOrganizer` のみ。`/templates` は `RequireAuth(allowAnonymous=false)` gate があるため、万一「匿名 & organizer」のユーザーが発生すると、ボタンは見えるがクリック時にリダイレクトされる（`/login` へ）。
- **実害**:
  - 現状の運用では匿名ユーザーは招待コード経由で `member` として参加するのみで、owner による promote 経路は rule 上は禁止されていないものの運用上発生しない
  - 発生しても UX が「クリック → ログイン要求」になるだけで、データ漏洩や権限昇格にはつながらない
- **Suggested fix**（採用任意）:
  ```tsx
  {isOrganizer && !user?.isAnonymous ? (
  ```
  ただし `useCurrentGroup` 側の `isOrganizer` に `!user.isAnonymous` を織り込む方が根本的。現状は放置で OK。
- **Severity justification**: 実発生しない想定・実害なし・改修コストが低くない → LOW

#### L2: 新規ボタンの a11y 確認は未実施

- **Location**: 同上
- **Issue**: `<Button variant="outline">Structure Templates</Button>` は shadcn/ui のデフォルト a11y に依存。英日混在 UI での screen reader 読上げや `aria-label` の要否は未検証。
- **Suggested fix**: 必要に応じて `aria-label="Structure Templates テンプレート一覧へ"` など日本語補完。ただし shadcn の `Button` は label を直接 accessible name として使うため、現状でも "Structure Templates" と読上げられる。
- **Severity justification**: 標準 component 使用・機能への影響なし → LOW

#### L3: 新ボタンの表示条件に対する unit/E2E test がない [RESOLVED]

- **Location**: [src/app/structures/structures-client.tsx](../../../src/app/structures/structures-client.tsx)
- **Issue**: `isOrganizer` gate のregressionを機械的に検知する test は未追加。既存 `tests/e2e/structure-templates.spec.ts` は `/templates` 側のフローを検証しているが、`/structures` からの導線は未カバーだった。
- **Resolution**: [tests/e2e/structure-templates.spec.ts](../../../tests/e2e/structure-templates.spec.ts) に新 describe `Structure Templates nav from /structures` を追加し、以下 2 ケースを実装:
  - organizer: `/structures` で `Structure Templates` ボタンが表示され、クリックで `/templates` に遷移
  - 一般メンバー: `/structures` で `Structure Templates` / `新規作成` いずれのボタンも表示されない
  - `npx playwright test --list` で 2 ケースが正しく検出されることを確認済み。実行自体は `npm run test:e2e` 側（Firebase Emulator 必須）で担保。

## Other Observations（non-findings）

- **英日混在 UI**: `<h1>Structure Templates</h1>` の下に日本語 description、ボタンも英語ラベル。**ユーザー明示のリネーム指示**に基づく変更のため指摘対象外。
- **セキュリティ**: `/templates` は `RequireAuth(allowAnonymous=false)` と Firestore Rules の `isSignedInNotAnon()` で二重防御済み（Phase 4.8 で確立）。本改修はクライアント側の導線追加のみで rule には触れていない。
- **Fragment wrap**: `isOrganizer ?` 分岐の中で `<>...</>` で 2 個の Link をまとめる形は React idiom 通り。
- **履歴ファイルの rename スキップ判断**: `.claude/PRPs/plans/completed/**` / `reports/**` / `reviews/**` の「図書館」残置は、完了済み成果物の audit trail を保つための正しい判断。実装レポートにも明記済み。

## Validation Results

| Check      | Result  | Notes |
| ---------- | ------- | ----- |
| Type check | Pass    | `npx tsc --noEmit` 0 errors |
| Lint       | Pass    | `next lint` — No ESLint warnings or errors |
| Unit Tests | Pass    | 411/411（24 files）、回帰なし |
| Build      | Pass    | `npm run build` 成功、`/templates` / `/structures` ルートサイズ変化なし |
| E2E（静的） | Pass    | `npx playwright test structure-templates.spec.ts --list` で 7 ケース（新規 2 ケース含む）を認識 |
| E2E（実行） | Skipped | Firebase Emulator 必須のため本 review では未実行。`npm run test:e2e` のフル実行で担保 |

## Files Reviewed

| File | Change Type | Notes |
| --- | --- | --- |
| [src/app/structures/structures-client.tsx](../../../src/app/structures/structures-client.tsx) | Modified | `Structure Templates` ボタン追加（organizer-only） |
| [src/app/templates/templates-client.tsx](../../../src/app/templates/templates-client.tsx) | Modified | h1 リネーム |
| [firestore.rules](../../../firestore.rules) | Modified | `isSignedInNotAnon()` のコメント文言のみ |
| [src/lib/firebase/schemas/index.test.ts](../../../src/lib/firebase/schemas/index.test.ts) | Modified | `describe` 上部のコメントのみ |
| [tests/e2e/structure-templates.spec.ts](../../../tests/e2e/structure-templates.spec.ts) | Modified | 新 describe `Structure Templates nav from /structures` に organizer/member 2 ケース追加（L3 解消） |
| [README.md](../../../README.md) | Modified | §5.5 冒頭文のリネーム |
| [.claude/rules/security.md](../../rules/security.md) | Modified | section 見出しのリネーム |
| [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) | Modified | Phase 4.8 表説明 + Phase 4.7/4.8 Goal 本文のリネーム |
| [.claude/PRPs/reports/structure-templates-nav-link-report.md](../reports/structure-templates-nav-link-report.md) | Added | 実装レポート（理由・代替案・変更ファイル一覧） |

## Decision Rationale

- CRITICAL/HIGH/MEDIUM いずれも 0
- 全 validation pass（typecheck / lint / 411 tests / build）
- 機能変更は小さく（nav link 1 個）、セキュリティ面は既存二重防御で担保済み
- LOW 3 件はいずれも実害がなく任意対応

→ **APPROVE**。commit 可。Follow-up として E2E 1 ケース追加を Phase 5 ドライラン前に検討推奨。
