# Phase 4.13: Nav Shell 刷新 + サウンド設定導線整理

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 4.12 まで各画面ヘッダに散在していたナビゲーションボタンとサウンド設定リンクを、グローバルなサイドバー / モバイル Sheet に集約する。**schema / Firestore Rules / repository 完全不変**で純 UI / a11y / 導線整理に閉じる
- **背景**: Phase 4.12 までは画面ごとに「サークル」「トーナメント」「ストラクチャ」ボタンや `audio-settings` への戻り link を散在配置していたため、(a) ページ間のナビが一貫せず迷子になりやすい、(b) 同じリンクが複数箇所に重複、(c) `/groups/[gid]` の名前変更が Dialog 起動で操作 1 段重い、などのペインが運営者から挙がっていた。Phase 4.14 のサブナビ追加に先立ち、まずナビ shell を整える
- **Scope**:
  - **AppShell + PrimaryNav 新設**（[src/components/nav/](../../../../../src/components/nav/)）:
    - `AppShell.tsx`: layout root から呼ばれる shell。`md+` で固定幅 `<aside id="primary-nav-sidebar">` を表示、`md` 未満は hamburger（`HeaderMenuButton`）+ Radix `Sheet` で expand
    - `PrimaryNav.tsx`: nav 項目を role / signedIn ベースで gate（`resolveNavItems`）。aria-current=`page` で active 状態を表現
    - `nav-items.ts`: ホーム / サークル / トーナメント / ストラクチャ / テンプレート / サウンド設定 / アカウント設定 を集中管理（`authOnly` / `requireOrganizer` / `requireGroup` の 3 種フラグで gate）
    - `nav-state.tsx`: モバイル Sheet open/close を React context で共有
    - shadcn `Sheet` primitive（[src/components/ui/sheet.tsx](../../../../../src/components/ui/sheet.tsx)）追加
  - **fullscreen pattern**: `/^\/tournaments\/[^/]+\/live\/?$/` のときのみ `<aside>` 自体を描画しない（参加者用 `/live` を会場プロジェクター投影中に sidebar が映らないように）
  - **ページ内 nav ボタン撤去**: `tournaments-client.tsx` / `structures-client.tsx` / `groups-detail-client.tsx` / `dashboard-client.tsx` などのヘッダから「サークル」「トーナメント」「ストラクチャ」リンクを削除しサイドバーに集約
  - **`SoundUnlockBanner` / `SoundToggleButton` から `settingsHref` 廃止**: 詳細設定はサイドバー「サウンド設定」へ。`audio-settings` ページ自体は維持しつつ、戻り link は `?from=live&tid=` クエリで条件付き表示（`/live` から開いたときのみ「全画面表示へ戻る」を出す URL 契約）
  - **`/groups/[gid]` のサークル名変更を Dialog → インライン編集**: ペン icon クリックで text input に切替、`requestAnimationFrame` 後に focus + select、Esc / 同名 / 空文字で自動キャンセル、Enter / blur で確定。optimistic UI 風挙動だが Firestore 書込み完了まで edit 状態を維持して整合
  - **`AuthBadge` をゲスト表示に縮退**: 通常ユーザーの認証状態 / displayName / サークル切替はサイドバーフッター（user プロファイル link）が担うため `AuthBadge` は匿名ゲスト時のみ表示するよう簡素化。サークル切替（旧ヘッダ右上）は撤去（複数 group 所属時のフローはサイドバー「サークル一覧」配下のサブリンクで代替）
  - **a11y**: skip link `<a href="#main">`、`<main id="main" tabIndex={-1}>` でフォーカス到達確保、Sheet には `SheetTitle "メニュー"` で accessible name を付与（Radix Dialog の aria-labelledby 経路）
- **既知の所見**（local review より）:
  - M1: `aria-controls` が desktop / mobile で参照先 ID が異なる（`primary-nav-sidebar` vs `primary-nav`）。SR 利用者向けの細かい改善余地あり、Phase 4.14 以降で fix 候補
  - M2: `aria-current="page"` が親「サークル」と「サブリンク（group 名）」で重複付与される — Phase 4.14 で `isGroups && groupSubActive` 分岐により解消済み（PrimaryNav の active 解除ロジック追加）
- **Success signal**:
  - desktop（md+）でサイドバー、`md` 未満で hamburger + Sheet が描画され、ナビ選択で Sheet が自動クローズ
  - `/live` でサイドバーが非表示になり会場投影が崩れない
  - `aria-current=page` / focus 移動 / skip link が WCAG 2.2 AA 相当で機能
  - `/groups/[gid]` のサークル名変更がインライン編集で 1 操作完結
  - typecheck / lint / 479 unit tests / E2E（`nav-and-sound-toggle.spec.ts` 追加）すべて green
