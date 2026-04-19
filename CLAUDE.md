# ALLin-Timer

## 言語設定

- **ユーザーとのやり取りは日本語で行うこと。**
- 質問・要約・提案・確認・エラーメッセージを含め、すべて日本語で出力する。
- コード内のコメント・識別子・コミットメッセージは英語で構わない（プロジェクト規約に従う）。
- `.claude/PRPs/` 配下に生成するドキュメント（PRD・実装計画など）は**日本語で記述する**。

## プロジェクト概要

- **ALLin-Timer** — NLH（ノーリミットテキサスホールデム）小規模サークル向けトーナメント進行支援 Web アプリ
- 核心価値: **熟練者不在でも TDA ルール通りに回せる**（席決め・テーブルバランシングをアプリが自動指示）
- 対象規模: 6 テーブル以下、20 人前後のサークル（月 1〜2 回開催）
- 配布: MIT ライセンスで GitHub 公開。サークル固有情報は Firestore にのみ保存

### スタック（確定）

| 層 | 採用 |
|---|---|
| フロントエンド | Next.js 15（App Router / TypeScript） |
| UI | Tailwind CSS + shadcn/ui |
| DB / 認証 | Firebase Firestore + Firebase Authentication（匿名／メール＋PW／Email Link の 3 方式） |
| リアルタイム同期 | Firestore `onSnapshot` |
| デプロイ | Vercel Hobby（GitHub 連携） |

詳細は [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) を参照。

## ドキュメント構成

- **PRD**: [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md)（要件・Implementation Phases）
- **実装計画**: [.claude/PRPs/plans/](.claude/PRPs/plans/) 配下に Phase 単位で生成
  - Phase 1（Foundation）: [phase-1-foundation.plan.md](.claude/PRPs/plans/phase-1-foundation.plan.md) — `in-progress`

## ワークフロー

要件定義〜実装は PRP フローを使用:

1. `/prp-prd` — 要件定義（Q&A で PRD 生成）
2. `/prp-plan <prd>` — フェーズ別の実装計画を `.claude/PRPs/plans/` に生成し、PRD のフェーズを `in-progress` に更新
3. `/prp-implement <plan>` — 実装
4. `/prp-pr` / `/prp-commit` — PR 作成・コミット

## 実装規約

Phase 1 で確立した規約を以下に分離。

| 対象領域 | ルールファイル | 内容 |
|---|---|---|
| Firebase / Firestore | [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) | 初期化 singleton、`useAuthUser` 経由の認証購読、`converter<T>()`、deny-by-default セキュリティルール |
| エラー / ログ | [.claude/rules/error-logging.md](.claude/rules/error-logging.md) | `AppError` ラップ、ドメインコード付与、`logger` 経由出力 |
| セキュリティ / 機密情報 | [.claude/rules/security.md](.claude/rules/security.md) | `.env.local` 管理、サークル固有情報の Firestore 限定保存、公開リポジトリ運用 |

### ルール参照の義務

以下のトリガに該当するコード変更・新規作成を行う前に、**該当するルールファイルを必ず Read してから作業を開始すること**（記憶に頼らず毎回読む）:

- `src/lib/firebase/**` / Firestore 関連ファイル / `firestore.rules` / `firestore.indexes.json` の編集
  → [firebase-patterns.md](.claude/rules/firebase-patterns.md)
- `try`/`catch`・エラークラス・ログ出力を含むコードの追加・編集
  → [error-logging.md](.claude/rules/error-logging.md)
- `.env*` / 環境変数参照 / 認証情報 / Firebase 設定値を扱うコードの追加・編集
  → [security.md](.claude/rules/security.md)
- 上記に該当するかユーザーから指定のルールを参照するよう指示があった場合

複数領域にまたがる変更は該当するすべてのルールを読むこと。ルールと PRD の実装方針が矛盾する場合は作業を止めてユーザーに確認する。
