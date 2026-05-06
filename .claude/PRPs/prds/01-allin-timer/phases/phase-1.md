# Phase 1: Foundation

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: アプリの土台を作り、以降の並列開発を可能にする
- **Scope**:
  - Next.js 15 プロジェクト初期化、Tailwind + shadcn/ui セットアップ
  - Firebase プロジェクト作成、Firestore 初期データモデル定義、セキュリティルール雛形
  - Firebase Authentication 有効化（メール・匿名・Email Link の 3 方式）
  - Vercel デプロイパイプライン（GitHub 連携）
  - MIT ライセンスファイル追加、`.gitignore` で `.env.local` 除外
- **Success signal**: ローカルと Vercel 上で空のトーナメント作成→Firestore 反映が確認できる
