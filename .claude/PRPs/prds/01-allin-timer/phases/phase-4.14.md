# Phase 4.14: Dashboard 受付画面 + サイドバー UX Polish

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 4.13 ナビ刷新後に運営者から挙がった 8 件の UX 摩擦（受付画面の grid 跳ね・サウンドトグルのリアクティブ反映漏れ・終了済みトーナメント削除導線・全画面遷移の重複・サイドバー文言と開催中トーナメントへの直接導線）を一括解消する。**schema / Firestore Rules / hook / repository の破壊的変更なし**で純 UI / 既存 service 層の組合せ調整に閉じる
- **背景**: Phase 4.13 のナビ刷新と同時に運営者から `tmp/` 経由で改善要望が出揃った。Phase 4.13 でサイドバー骨格は完成したが (a) サイドバー文言が「サークル」「トーナメント」のみで「一覧」が欠ける、(b) 開催中トーナメントへの直接導線が無い、(c) 受付画面の grid が状態遷移で跳ねる、(d) 削除可能 state が setup のみで履歴整理ができない、(e) 「全画面表示」が `/live` への画面遷移であり同 dashboard を投影中の運営者には不便、などのペインが残存していた
- **Scope**:
  - **受付画面の右列恒常化（dashboard）**: `showRightColumn` フラグを撤去し `lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]` で 3 列固定。`NextBreakCard` / `AverageStackCard` / `PlayersCard` の `state in {setup, seating}` ガードを緩め、各カード内部で「開始前プレビュー」（NextBreak は Lv 1 起点で最初の break level までのレベル数 / Average は受付済み × 初期スタック / Players は受付済み件数）を表示
  - **サウンドトグルのリアクティブ反映**: `dashboard-client.tsx` の `onToggleEnabled` で `updateAudioSettings()` 成功後に `useCurrentGroup().refreshGroups()` を await。GroupProvider の `groups` を再フェッチし、リロードなしで `tournamentGroup.audioSettings.enabled` を即時反映。GroupProvider の onSnapshot 化は **NOT building**（最少差分維持）
  - **終了済みトーナメント削除（破壊的 API rename）**: `deleteTournamentIfSetup` を `deleteTournament` に rename（互換 alias は作らない、Phase 2.5 先例）。`setup` または `finished` を許容、players / tables sub-collection を `writeBatch` で cascade 削除（参加者 ≤20 + tables ≤6 = 1 batch 内に収まる）。dashboard ヘッダの「削除」ボタンは `canDelete = state==="setup" || state==="finished"`、confirm dialog の文言は state で分岐（「開始前なので安全に削除」/ 「終了済みのため履歴ごと削除」）
  - **ヘッダ整理**: 「一覧へ戻る」ボタン削除（サイドバー「トーナメント一覧」で代替）。トーナメント名横の raw state バッジ（`<span>{data.state}</span>`）を削除（TimerDisplay 内の日本語ラベル「開始前 / 進行中 / 一時停止中 / 終了」が真実源）。`ConnectionBadge` は維持
  - **Fullscreen API トグル**: 「全画面表示」ボタンを `/tournaments/[tid]/live` への `<Link>` から `document.documentElement.requestFullscreen()` / `document.exitFullscreen()` のページ内トグルに置換。`fullscreenchange` を購読してアイコンを `Maximize` ↔ `Minimize` に同期（`webkit*` プレフィックスも保険で OR 登録）。失敗時は新ドメインコード `ui/fullscreen-failed` で `logger.warn` 握り。`/live` ページは無変更（参加者用フローと既存 E2E 依存のため）
  - **サイドバー label rename**: `nav-items.ts` の「サークル」→「サークル一覧」、「トーナメント」→「トーナメント一覧」
  - **サイドバー「トーナメント一覧」配下に開催中サブナビ追加**: `tournaments.ts` に `subscribeTournamentsByGroup` を新設（`tables.ts` の subscribe パターン mirror、複合 index 不要のため client 側ソート）。`PrimaryNav.tsx` で `currentGroupId` 配下の `seating` / `running` / `paused` トーナメントを realtime にサブリンクとして並べる。state 別のドット色分け（running=emerald / paused=amber / seating=slate）。`/tournaments/{tid}/edit` 等の派生ルートでも `pathname.startsWith` で active 判定
  - **テスト**: 新規 unit（`deleteTournament` 5 ケース cascade + `subscribeTournamentsByGroup` smoke + 各カード setup 描画）+ E2E（サブナビ realtime 表示 + クリック遷移 + aria-current、受付画面の右列 / 全画面トグル / 終了済み削除フロー）
- **破壊的変更ではないが要注意**:
  - `deleteTournamentIfSetup` の rename は API 名のみ破壊的。callsite は `dashboard-client.tsx` 1 箇所のみで完結
  - `state バッジ` 削除に伴い E2E 5 spec の `dash.stateBadge` selector を `region[name=タイマー]` 内の日本語ラベルに repoint（page object と spec の連鎖修正が必要）
- **Success signal**:
  - 受付画面の grid が `setup → seating → running → paused → finished` の状態遷移で列数を変えず、TimerDisplay フォントサイズが揺らがない
  - サウンドトグルクリックでボタン色が即時切り替わる（リロード不要）
  - 終了済みトーナメントを dashboard から削除でき、Firestore 上で sub-collection（players / tables）も同時に消える
  - 「全画面表示」ボタンで同 dashboard が画面全体に拡張、再押下 / `Esc` で復帰してアイコンが Maximize に戻る
  - サイドバーの文言が「サークル一覧」「トーナメント一覧」となり、開催中トーナメント作成 → 約 1 秒以内にサブリンクが realtime 表示・ステート遷移で消失
  - typecheck / lint / test / build が green、E2E 全 spec pass
