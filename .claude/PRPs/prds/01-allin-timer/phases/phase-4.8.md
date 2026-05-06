# Phase 4.8: Structure Template Library

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: サークル横断でストラクチャのひな形を共有できる Structure Templates を提供。memo item 2 の初心者ペイン（SB/BB 設計に悩む）と「出先でスマホから追加できる運用」を両立する
- **背景**: Phase 4.7 で基礎的な UX 改善は完了。初心者運営者が他サークルのベストプラクティスを再利用できる仕組みが未実装のため、テンプレート共有コレクションを新設する
- **Scope**:
  - **`structureTemplates/{tid}` コレクション新設**: サインイン済み全員が read・create 可、edit は本人のみ、delete は本人または管理者
  - **`templateAdmins/{uid}` コレクション新設**: doc 存在 = テンプレート管理者。作成者脱会後のテンプレを削除する権限。bootstrap は Firestore Console で最初の 1 人を手動 seed
  - 作成者名を template doc に `createdByDisplayName` として snapshot 保存（`users/{uid}` の self-only read 制約回避）
  - `/templates` 一覧 / `/templates/new` / `/templates/{tid}/edit` の 3 ページ追加
  - `/structures/new` の `StructureTemplatePicker` は `listStructureTemplates()` 経由で Firestore から取得し、選択でフォームに一括反映（Phase 4.7 時点では未実装）
  - `firestore.rules` に `isTemplateAdmin()` helper と 2 match ブロック追加、本番デプロイ + README への管理者 seed 手順追記
  - Phase 4.7 の `levelSchema.isBreak` / `rebuyStack` / `addOnStack` を re-use（schema drift 防止）
- **Success signal**:
  - Owner / 他人 / 管理者の 3 視点でブラウザ検証がすべて通る（編集・削除ボタンの表示／非表示、実操作の成功）
  - Firestore Rules デプロイ後、最初の管理者が Console で seed 済み
  - `/structures/new` で Firestore から取得したテンプレが適用できる
