# Phase 4.7: Onboarding Polish & Structure Enhancements

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 5 のドライラン前に、運用で挙がった **7 件の UX / 機能ペイン**（memo-08 の 5 件 + memo-09 の 2 件）を一括解消する。Structure Templates は Phase 4.8 に分離
- **背景**: 運営者側からの改善要望（`tmp/08_Phase4.6_memo.md` + `tmp/09_pahse4.7_memo.md`）で、サークル SNS ニックネーム前提の運用・平均スタック把握要求・ブレイク運用・サークルメンバー識別（UID → displayName）・トーナメント一覧の状態視認性が出揃った
- **Scope**:
  - Google 新規ログイン時の `DisplayNameDialog` 強制表示（`additionalUserInfo.isNewUser` 判定）、既存ユーザーは skip
  - `AuthProvider.refreshUser()` を公開し、`signInAsGuest` / `registerWithEmail` / `updateDisplayName` 直後に呼び出してヘッダ displayName を即反映（useReducer bump で強制再描画）
  - `structures.{rebuyStack, addOnStack}` と `structureSnapshot.{rebuyStack, addOnStack}` を nullable number として追加（schema additive、旧 doc は zod default で null）
  - `AverageStackCard` を dashboard / live の TimerDisplay 枠外に独立カードとして配置（計算式: `totalEntries × initialStack ÷ activePlayers`）
  - `Level.isBreak: boolean` 追加、LevelTable にチェックボックス、TimerDisplay は "☕ BREAK" 表示に切替
  - **`groups/{gid}.memberDisplayNames` snapshot 追加**（`/groups/{gid}` で UID ではなく displayName 表示）。`consumeJoinCode` 時の書込と `updateDisplayName` 時の best-effort 伝播。rule は self-key 書込条件を追加（`diff().affectedKeys().hasOnly([auth.uid])`）
  - **`/tournaments` 一覧カードの状態別色分け**: setup/seating=slate、running/paused=emerald、finished=muted 半透明。日本語ラベル化（進行中 / 未開催 / 終了）
  - 既存 schema は additive、Firestore Rules は groups update に 1 条件追加、破壊的 migration 不要
- **Success signal**: 7 件すべての挙動を手動ブラウザで確認し、typecheck / lint / test / build が green
