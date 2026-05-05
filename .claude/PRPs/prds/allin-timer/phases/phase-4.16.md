# Phase 4.16: Tournament Default Name (Finished Counter)

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: 新規トーナメント作成画面のトーナメント名フィールドが空欄のまま提示される UX を改善し、`[サークル名]トーナメント-X`（X = サークルで終了したトーナメント数 + 1）のフォーマットで自動プリセットする。サークル詳細画面では運営者（owner / organizer）が開催数を確認・手動補正でき、一般メンバーは値の閲覧のみ可能にする
- **背景**: Phase 4.15 までの `/tournaments/new` は `<TournamentForm initialName="">` で空欄スタートだったため、運営者は毎回手で「Saturday 月例 #3」のような名前を入力していた。サークル単位で「何回目のトーナメント」を機械可読に持っておけば、命名の手間と認知負荷を同時に減らせる。同時に、実装前から運用していたサークルの実績数や、誤操作で counter がズレた場合に備えて、手動で値を補正できる導線が必要
- **Scope**:
  - **データモデル**: `groups/{gid}.finishedTournamentCount` フィールド追加（schema additive）
    - `z.number().int().nonnegative().default(0)`（旧 doc は 0 で hydrate、破壊的 migration なし）
  - **自動 +1 経路**: `finishTournament()` を `runTransaction` 化し、tournament の状態更新（`state: "finished"` / `finishedAt` / `pausedAt: null`）と `groups/{gid}.finishedTournamentCount` の `increment(1)` を atomic に実行。tx 内で `state !== "finished"` を再 read することで、複数端末同時呼び出し時の二重 increment race を防止
  - **手動補正経路**: `setFinishedTournamentCount({ gid, uid, value })`（service） → `updateFinishedTournamentCount(gid, value)`（repository）。owner / organizer 限定で任意の非負整数値を書込可能。値域チェック（>= 0 / 整数）は service / repository / rule の三層で防御
  - **新規作成画面**: `/tournaments/new` で `useCurrentGroup().groups` から `defaultName` を `useMemo` 派生して `<TournamentForm initialName=...>` に流し込む。追加 fetch なし
  - **サークル詳細画面**: `/groups/[gid]` に「開催数」カードを追加。全メンバーが現在値を確認でき、owner / organizer は inline edit（`Pencil` アイコン + Input + 保存/キャンセル + Esc キャンセル + 同値 noop close）で値を補正可能
  - **Firestore Rules**: `groups/{gid}` update に organizer-only `finishedTournamentCount` 単独書換 branch を 1 件 OR 追加（`isOrganizer(gid)` + `affectedKeys().hasOnly(['finishedTournamentCount'])` + `is int` + `>= 0`）。自動 +1 と手動補正の両経路を同 branch でカバー
  - **self-* 分岐の security patch**（emulator 検証で発覚した既存欠陥の修復）: `groups/{gid}` update の self-add / self-leave / self-key memberDisplayNames 3 分岐に `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` を追加し、map diff の `hasOnly([uid])` が空集合で true になる性質を悪用した audioSettings / finishedTournamentCount の任意 member 改竄経路を deny
  - **テスト**: schema additive（3 ケース）、`finishTournament` の runTransaction 化（race guard 含む）、repository（happy / 負値 / 小数 / write エラー）、service（owner / organizer / member / 負値 / 小数）、rules emulator スクリプト（`scripts/test-rules-finished-count.mjs`、8 ケース全 pass）
- **Success signal**:
  - Owner / Organizer / Member の 3 視点でブラウザ検証: 開催数カードの表示は全員、編集ボタンは owner / organizer のみ
  - `finishTournament()` 完了で対応する group の `finishedTournamentCount` が +1 され、`/tournaments/new` の連番が繰り上がる
  - サークル詳細画面の inline edit で任意の非負整数値に補正でき、その値が次回作成時のデフォルト名に反映される
  - rule + service の二重防御で範囲外値（負値・小数）が deny される
  - rules emulator 8 ケースが全 pass、self-* 分岐の affectedKeys 漏洩も修復後に green
  - typecheck / lint / test / build が green
