# Phase 3: Timer & Realtime & Viewer

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: 全端末で同期されたタイマー表示を実現する
- **Scope**:
  - サーバ時刻基準のタイマーロジック、レベル自動繰り上げ
  - Firestore `onSnapshot` によるトーナメント状態購読
  - 運営者用コントロール（開始／一時停止／再開／手動レベル変更）
  - 参加者閲覧画面（モバイル最適化、ブラインド・残り時間・自席表示）
  - 接続切断検知 UI（最終時刻＋「接続切れ」表示、Firestore オフライン永続化＋再接続時の状態再取得）
- **Success signal**: 3 台以上の異なる端末でタイマーが 1 秒以内のズレで同期表示される
