# Phase 4.5: Pre-Phase 5 Improvements

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 5 のドライラン前に、Phase 4 完了時点で洗い出された UX / 運用の摩擦を一括整理する
- **背景**: 受付・席管理・バランシングは Phase 4 で完結したが、`/groups` 画面からの導線不足・ヘッダーの email 表示・Winner 演出の欠如・匿名アカウントの蓄積・未使用の Email Link 方式など、実投入前に潰しておきたい 7 件の改善要望が発生
- **Scope**:
  - 運営者ダッシュボード（setup）に「自分も参加する」ワンクリック導線追加
  - `/groups/[gid]` からトーナメント / ストラクチャへの直接遷移ボタン追加
  - ヘッダーのユーザー表示を `displayName` 優先に変更（email はフォールバック）
  - 未ログイン時のトップ画面を「ログイン/新規登録」1 ボタンに簡素化
  - 残り 1 人を検知した時点で Winner バナー表示 → 2 秒後に `finishTournament` を運営者端末から自動呼出
  - トーナメント終了 / ログアウト / 参加取消時、匿名ユーザーの Firebase Auth + `users/{uid}` を client-side best-effort で自己削除
  - Email Link サインイン方式の完全撤廃（ルート・UI タブ・auth-actions・receipt・localStorage・テストすべて削除）
- **Success signal**: 7 件すべての挙動を手動確認し、typecheck / lint / test / build が green、Phase 5 のドライラン準備が整う
