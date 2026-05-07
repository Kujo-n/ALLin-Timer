# Phase 2: Tournament Setup & Receipt

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: トーナメントを設定し、参加者を集められる状態を作る
- **Scope**:
  - ストラクチャ編集 UI（ブラインド構造・初期スタック・レイトエントリー締切レベル）
  - ストラクチャのプリセット保存
  - トーナメント作成／編集／削除
  - 参加者受付画面（URL/QR 発行）
  - 参加者 3 択フロー実装:
    - (a) ログイン（既存 Firebase Auth ユーザー）
    - (b) ゲスト参加（匿名 Auth + 表示名入力）
    - (c) アカウント登録（Email Link でマジックリンク認証・そのまま参加完了）
- **Success signal**: 運営者がサンプルトーナメントを作成し、参加者役の端末から 3 ルート全てで受付完了できる
