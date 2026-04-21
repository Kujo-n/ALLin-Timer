# ALLin-PokerTimer

## 言語設定

- **ユーザーとのやり取りは日本語で行うこと。**
- 質問・要約・提案・確認・エラーメッセージを含め、すべて日本語で出力する。
- コード内のコメント・識別子は英語を基本とする（プロジェクト規約に従う）。
- **コミットメッセージは日本語で記述する**（`feat` / `fix` / `docs` 等の type prefix のみ英語）。詳細ルールは [.claude/commands/prp-commit.md](.claude/commands/prp-commit.md) 参照。
- `.claude/PRPs/` 配下に生成するドキュメント（PRD・実装計画など）は**日本語で記述する**。

## プロジェクト概要

- **ALLin-PokerTimer** — NLH（ノーリミットテキサスホールデム）小規模サークル向けトーナメント進行支援 Web アプリ
- 核心価値: **熟練者不在でも TDA ルール通りに回せる**（席決め・テーブルバランシングをアプリが自動指示）
- 対象規模: 6 テーブル以下、20 人前後のサークル（月 1〜2 回開催）
- 配布: MIT ライセンスで GitHub 公開。サークル固有情報は Firestore にのみ保存

### スタック（確定）

| 層               | 採用                                                                                           |
| ---------------- | ---------------------------------------------------------------------------------------------- |
| フロントエンド   | Next.js 15（App Router / TypeScript）                                                          |
| UI               | Tailwind CSS + shadcn/ui                                                                       |
| DB / 認証        | Firebase Firestore + Firebase Authentication（匿名／メール＋PW／Google の 3 方式）             |
| リアルタイム同期 | Firestore `onSnapshot`                                                                         |
| デプロイ         | Vercel Hobby（GitHub 連携）                                                                    |

詳細は [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) を参照。

## ドキュメント構成

- **PRD**: [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md)（要件・Implementation Phases）
- **実装計画**: [.claude/PRPs/plans/](.claude/PRPs/plans/) 配下に Phase 単位で生成
  - 進行中の計画は `.claude/PRPs/plans/` 直下、完了した計画は `.claude/PRPs/plans/completed/` に移動
  - Phase 1（Foundation）: [completed/phase-1-foundation.plan.md](.claude/PRPs/plans/completed/phase-1-foundation.plan.md) — `complete`
  - Phase 2（Tournament Setup & Receipt）: [completed/phase-2-tournament-setup-receipt.plan.md](.claude/PRPs/plans/completed/phase-2-tournament-setup-receipt.plan.md) — `complete`
  - Phase 2.5（Group Management）: [completed/phase-2.5-group-management.plan.md](.claude/PRPs/plans/completed/phase-2.5-group-management.plan.md) — `complete` — group ベース所有権モデルへ破壊的移行
  - Phase 3（Timer & Realtime & Viewer）: [completed/phase-3-timer-realtime-viewer.plan.md](.claude/PRPs/plans/completed/phase-3-timer-realtime-viewer.plan.md) — `complete` — タイマー駆動と onSnapshot 同期、`/tournaments/[tid]/live` ページ、Firestore オフライン永続化
  - Phase 4（Seating Automation）: [completed/phase-4-seating-automation.plan.md](.claude/PRPs/plans/completed/phase-4-seating-automation.plan.md) — `complete` — 初回席決め／バスト／TDA 準拠バランシング／レイトエントリー自動配席、`tournaments/{tid}/tables` サブコレクション追加、seating engine と orchestrator を分離
- **実装レポート**: [.claude/PRPs/reports/](.claude/PRPs/reports/) に Phase 完了毎に生成
- **PRD 内の Phase 進捗表**が最新状況の真実源。個別リンクは PRD を参照

## ワークフロー

要件定義〜実装は PRP フローを使用:

1. `/prp-prd` — 要件定義（Q&A で PRD 生成）
2. `/prp-plan <prd>` — フェーズ別の実装計画を `.claude/PRPs/plans/` に生成し、PRD のフェーズを `in-progress` に更新
3. `/prp-implement <plan>` — 実装
4. `/prp-pr` / `/prp-commit` — PR 作成・コミット

## 実装規約

Phase 1 で確立した規約を以下に分離。

| 対象領域                            | ルールファイル                                                           | 内容                                                                                                                                                     |
| ----------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firebase / Firestore                | [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) | 初期化 singleton、`useAuthUser` 経由の認証購読、`zodConverter` による runtime validation、repositories 層経由の CRUD、deny-by-default セキュリティルール |
| エラー / ログ                       | [.claude/rules/error-logging.md](.claude/rules/error-logging.md)         | `AppError` ラップ、ドメインコード付与、`logger` 経由出力                                                                                                 |
| セキュリティ / 機密情報             | [.claude/rules/security.md](.claude/rules/security.md)                   | `.env.local` 管理、サークル固有情報の Firestore 限定保存、公開リポジトリ運用、招待コード設計原則                                                         |
| Group メンバーシップ（Phase 2.5〜） | [.claude/rules/group-membership.md](.claude/rules/group-membership.md)   | group ベース所有権モデル、招待コード、権限設計。Phase 2.5 完了済み・Phase 3 以降はここを参照                                                             |

### ルール参照の義務

以下のトリガに該当するコード変更・新規作成を行う前に、**該当するルールファイルを必ず Read してから作業を開始すること**（記憶に頼らず毎回読む）:

- `src/lib/firebase/**` / Firestore 関連ファイル / `firestore.rules` / `firestore.indexes.json` の編集
  → [firebase-patterns.md](.claude/rules/firebase-patterns.md)
- `try`/`catch`・エラークラス・ログ出力を含むコードの追加・編集
  → [error-logging.md](.claude/rules/error-logging.md)
- `.env*` / 環境変数参照 / 認証情報 / Firebase 設定値 / 招待コード関連の追加・編集
  → [security.md](.claude/rules/security.md)
- `groups/` / `groupJoinCodes/` コレクション、`groupId` / `memberUids` / `createdByUid` フィールド、group コンテキスト hook の追加・編集（Phase 2.5 以降）
  → [group-membership.md](.claude/rules/group-membership.md)
- 上記に該当するかユーザーから指定のルールを参照するよう指示があった場合

複数領域にまたがる変更は該当するすべてのルールを読むこと。ルールと PRD の実装方針が矛盾する場合は作業を止めてユーザーに確認する。

# 注意事項

- 作成された成果物は Codex によってレビューされます。
