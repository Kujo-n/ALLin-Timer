# Phase 4.12: Dashboard Top-Row Equal-Height & "卓 → Table" Rename

> [allin-timer.prd.md](../../allin-timer.prd.md) の Phase Details から分離。状態 / 依存関係 / PRP Plan link は主 PRD の Implementation Phases 表が真実源。

- **Goal**: Phase 4.11 後の運営者フィードバックを反映し、Dashboard 上段 3 セット（QR / Timer+Controls / 統計 3 カード）を**同じ高さに揃える**ことと、UI 全体の **「卓 → Table」用語統一**を完了させる。schema / Firestore Rules / hook を一切触らない純 UI / ラベル変更
- **背景**: Phase 4.11 で 3 カラムレイアウトを導入したが `lg:self-start` で各列が `align-items: stretch` をオプトアウトしているため高さが揃わず、会場プロジェクター投影時に視線が上下に飛ぶ。また `/live` 側は既に `Table` ラベル化済みだが Dashboard / SeatingBoard / TournamentForm / orchestrator description などに `卓` が残存しており、用語混在が運営者から指摘された
- **Scope**:
  - **Dashboard 上段の等高化**: 既存 grid を「等高 3 列の上段」と「下段（中央列の残り）」に分割。`lg:items-stretch` + 各列 `h-full` で QR を基準に他 2 列が伸びる。`lg:sticky lg:top-4 lg:self-start` を廃止
  - **state による右列縮退**: state=`setup` / `seating` で 3 統計カードがすべて null を返すケースで右 aside ごと非表示にし grid を `lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]` の 2 列に切替
  - **TimerDisplay フォント拡大**: 残時間 `lg:text-[10rem] lg:leading-none`、SB/BB/Ante `lg:text-5xl`、BREAK `lg:text-4xl`
  - **統計 3 カードのスタイル更新**: タイトル → `text-base md:text-lg font-semibold text-foreground`（OKLCH トークンでライト時黒・ダーク時白）、値テキストは 1 段拡大（NextBreak `md:text-4xl` / AvgStack `md:text-5xl` / Players active `md:text-5xl`）
  - **QrPanel に className prop 追加**: `h-full` を呼び出し側から注入
  - **WinnerBanner / SeatingBoard / PlayerList / Structure を上段 grid 外**に分離: 中央列の縦伸長で等高 grid が乱れるのを防ぐ
  - **「卓 → Table」一括リネーム**（user-facing 文字列のみ・コメント / docstring は日本語維持）:
    - `dashboard-client.tsx`: `1 卓 N 席` → `1 Table N 席`、`<CardTitle>卓 / 席</CardTitle>` → `<CardTitle>Table List</CardTitle>`
    - `SeatingBoard.tsx`: `卓 N（M 人）` → `Table N（M 人）`
    - `BalancingInstructionCard.tsx` / `orchestrator.ts`: `卓 N を閉鎖（M 名移動）` → `Table N を閉鎖（M 名移動）`
    - `orchestrator.ts` move description: `${X}卓${Y}席 → ${P}卓${Q}席` → `Table X / 席 Y → Table P / 席 Q`
    - `TournamentForm.tsx`: バリデーションエラー / Label / 補足の `卓` → `Table`
    - `orchestrator.ts` errors: `テーブル数の上限（N 卓）` → `（N Tables）`、`1 卓あたり席数の値が不正です` → `1 Table あたり席数の値が不正です`
    - `orchestrator.test.ts` description assertion 2 件を新フォーマットに更新
  - **schema フィールド名 / collection 名 / AppError ドメインコードは不変**（`tableNum` / `tables` / `tournament/seating-too-many-tables` 等はすべて維持）
  - **`/live` ページは無変更**（既に Table 表記）
- **Success signal**:
  - Dashboard `lg+` で上段 3 列の `offsetHeight` がピクセル単位で一致
  - state=`setup`/`seating`/`finished` での右列出し入れが破綻なく動作
  - 統計 3 カードのタイトルがライト=黒 / ダーク=白で大きく表示
  - user-facing 文字列の "卓" が完全に "Table" になり、orchestrator description テストが新フォーマットで pass
  - typecheck / lint / test / build が green、`/live` 差分ゼロ
