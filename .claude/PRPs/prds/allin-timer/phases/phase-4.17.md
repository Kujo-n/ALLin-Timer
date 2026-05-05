# Phase 4.17: Group Default Seats Per Table

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: トーナメント新規作成時の「1 Table あたりの席数」初期値をサークル単位で永続化し、毎回手動で書き換える運用ペインを解消する。`/tournaments/new` のフォーム初期値として自動適用されるが、運営者は引き続き任意の値で上書き可能
- **背景**: 6 人卓運用のサークルでは現状 `DEFAULT_SEATS_PER_TABLE = 9` がフォームに固定で出るため、トーナメントを作るたびに `9 → 6` に直す手間が発生。サークル単位で標準席数が決まっている運営実態に合わせ、`groups/{gid}` 側でデフォルト値を保存できるようにする
- **Scope**:
  - **データモデル**: `groups/{gid}.defaultSeatsPerTable` フィールド追加（schema additive）
    - `z.number().int().min(2).max(10).default(9)`（`tournament.ts` の `seatsPerTable.min(2).max(10)` と完全一致）
    - 既存 group docs は zod default で 9 として hydrate（破壊的 migration なし）
  - **新規作成画面**: `/tournaments/new` で `useCurrentGroup().groups` から `defaultSeatsPerTable` を派生し、`<TournamentForm initialSeatsPerTable=...>` に流し込む。Phase 4.16 の `defaultName` 派生と同じ `useMemo` パターン。`undefined` 時は TournamentForm 側の `DEFAULT_SEATS_PER_TABLE = 9` にフォールバック
  - **編集 UI**: サークル詳細画面（`/groups/[gid]`）に「1 Table あたりの席数（デフォルト）」カードを追加。Phase 4.16「開催数」カードの inline edit パターン（`Pencil` アイコン + Input + 保存/キャンセル + Esc キャンセル + 同値 noop close）を mirror。owner / organizer のみ編集可、参照は全メンバー
  - **service / repository**: `setDefaultSeatsPerTable({ gid, uid, value })`（service） → `updateDefaultSeatsPerTable(gid, value)`（repository）の 2 層。範囲チェック（2..10 / 整数）は service / repository の両方で実施し、`AppError("validation/default-seats-invalid")` でラップ
  - **Firestore Rules**: `groups/{gid}` update に organizer-only `defaultSeatsPerTable` 単独書換 branch を 1 件 OR 追加（`isOrganizer(gid)` + `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + `>= 2 && <= 10`）。owner はフル update branch でカバー済み
  - **テスト**: schema additive（5 ケース：default / explicit / min-1 / max+1 / 非整数）、repository（happy path / 範囲外 / Firestore reject）、service（owner / organizer / member / 範囲外）、rules emulator（9 ケース：境界値 / member 拒否 / affectedKeys 拒否 / legacy doc / owner full update）
  - **DRIFT WARNING**: schema 上限 10 は `firestore.rules` の `players seatNum <= 10` および `tournament.seatsPerTable.max(10)` と連動。同時に変更する制約をコメントで明記
- **Success signal**:
  - サークル A（`defaultSeatsPerTable: 6`）で `/tournaments/new` を開くと席数欄に `6` がプリセット、サークル B（未設定）では `9` がプリセット
  - サークル詳細画面で owner / organizer が inline edit で値を変更できる、member は値表示のみ（編集ボタン非表示）
  - 範囲外値（`1` / `11`）が service / rule の両層で deny される
  - 既存 `/tournaments/[tid]/edit` 画面は変更なし（regression なし）
  - typecheck / lint / test / build / rules emulator が green
