# Phase 4.15: Header Slot 機構 + Timer Controls 統合 (Post-4.14 Polish)

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 4.14 後のフォローアップ。グローバルヘッダにページ固有タイトル / 操作 slot を提供する仕組みを導入し、dashboard 上段の重複表示と独自ヘッダ実装を整理する。同時に Phase 4.14 で dashboard ヘッダに置いた Fullscreen トグル・接続状態バッジを `TimerControls` 内に統合してタイマー周辺の操作集約を完成させる。**schema / Firestore Rules / repository / hook 完全不変**で純 UI / レイアウト改善に閉じる
- **背景**: Phase 4.13（AppShell + サイドバー）+ Phase 4.14（受付画面 grid・Fullscreen API・サブナビ）でナビと dashboard 機能は揃ったが、(1) グローバルヘッダの中央領域が空のままで dashboard 側にトーナメント名を別途配置していた、(2) Fullscreen ボタン / 同期中バッジが TimerControls とは別位置に散在し視線移動が大きい、(3) `ConnectionBadge` が横長で領域を圧迫、(4) 受付運用時にレイトレジスト締切 Lv が QR 周りから一目で読み取れない、というレビュー所見が出揃った
- **Scope**:
  - **グローバルヘッダ Page Title Slot 機構**: [src/components/nav/page-title.tsx](../../../../../src/components/nav/page-title.tsx) を新設。`PageTitleProvider` / `usePageTitle(title)` hook / `PageTitleSlot` の 3 構成で、各ページが mount 中に呼ぶだけでヘッダ中央にタイトルを表示、unmount 時に自動クリア。`setTitle` 参照は `useCallback` で安定化し消費側 `useEffect` の deps に乗せても再実行を起こさない
  - **layout.tsx でのヘッダ slot 化**: 既存 `<header>` 内に `<PageTitleSlot />` を中央配置、`PageTitleProvider` を `AppShell` 配下にラップ
  - **dashboard でのトーナメント名ヘッダ表示**: `dashboard-client.tsx` から `usePageTitle(tournament.name)` を呼んで dashboard 内ヘッダのトーナメント名表記を撤去、ヘッダ中央に集約
  - **TimerControls 統合**: Phase 4.14 で dashboard ヘッダに置いた Fullscreen トグル（`requestFullscreen` / `exitFullscreen` + `fullscreenchange` listener）と `ConnectionBadge` を `TimerControls` 右側に移動し、タイマー操作・同期状態・全画面切替を 1 行に集約
  - **ConnectionBadge 縦組み variant**: 縦組み（compact）レイアウト指定を追加し、TimerControls 右端の限られた横幅でも文言が可読に収まるようにする
  - **QrPanel レイトレジスト Lv 表示**: `QrPanel` に「Late Registration: Lv N まで」（`structureSnapshot.lateRegistrationLevel` 参照）の補助情報を追加。受付運用時に締切が QR と同じカード内で確認できる
  - **E2E Page Object 追従**: 全画面トグル位置変更（dashboard ヘッダ → TimerControls 内）を `tests/e2e/pages/TournamentsPage.ts` および `tests/e2e/dashboard-polish.spec.ts` の selector に反映
  - **schema / Firestore Rules / repository / hook / AppError ドメインコード完全不変**（`ui/fullscreen-failed` は Phase 4.14 で導入済み、追加なし）
- **Success signal**:
  - dashboard 上段の視線移動が「ヘッダ（トーナメント名 + ナビ）→ TimerControls 集約コントロール → QR / 統計カード」の縦 1 列で完結
  - 任意のページから `usePageTitle()` を呼ぶだけでヘッダ中央 slot を利用可能（ページ間遷移で残留しない）
  - Fullscreen トグル / `ConnectionBadge` が TimerControls 右側に統合され、E2E spec が新位置の selector で pass
  - QR カードからレイトレジスト締切 Lv が一目で読み取れる
  - typecheck / lint / test / build が green
