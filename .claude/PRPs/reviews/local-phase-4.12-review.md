# Local Review: Phase 4.12 — Dashboard Top-Row Equal-Height & "卓 → Table" Rename

**Reviewed**: 2026-04-25
**Branch**: develop（uncommitted）
**Scope**: 11 source files + 1 plan move + 1 report 追加
**Decision**: APPROVE（軽微な指摘のみ）

## Summary

Phase 4.12 計画通り、Dashboard 上段 3 列の等高化、TimerDisplay / 統計 3 カードのフォント拡大、ユーザー向け「卓 → Table」リネームを UI / 文言レイヤだけで実装。schema / Firestore Rules / 認証 / 副作用ロジックは無変更。typecheck / lint / 全 479 tests / build がすべて green。重大な不具合は見当たらない。

## Findings

### CRITICAL

なし。

### HIGH

なし。

### MEDIUM

なし。

### LOW

**L1. Balancing 関連の表記が 3 系統に分かれている（user-facing 1 つ・ログ/テスト 1 つ・live 1 つ）**

- 場所:
  - [src/components/tournament/BalancingInstructionCard.tsx:65](src/components/tournament/BalancingInstructionCard.tsx#L65) — `Table:1, No.1` 形式（プレイヤー移動指示。本 PR では未変更）
  - [src/lib/services/seating/orchestrator.ts:397](src/lib/services/seating/orchestrator.ts#L397) — `Table 1 / 席 1 → Table 2 / 席 6` 形式（logger.info `desc` 用。本 PR で更新）
  - [src/app/tournaments/[tid]/live/live-client.tsx:219](src/app/tournaments/[tid]/live/live-client.tsx#L219) — `Table` / `No.` 形式（参加者ビュー）
- 問題: orchestrator の `desc` は logger と test 専用で UI には出ないため実害なし。ただし plan 文（README にも引用）では「`Table 1 / 席 1 → Table 2 / 席 6` は live の `Table / No.` と同じ語感」と書かれているが、実際の live は `Table` / `No.`、本 PR の orchestrator は `Table` / `席`、UI 表示の Balancing カードは `Table:1, No.1` と 3 通り。
- 修正案:
  - 揃えたいなら orchestrator の `desc` を `Table 1 / No. 1 → Table 2 / No. 6`（数値前の半角スペース付き）に変更し、テスト 2 件を更新。
  - もしくは BalancingInstructionCard 側の `Table:1, No.1` を `Table 1 / No. 1` 系に揃える（ただし本 PR スコープ外なので別 Phase で扱う方が無難）。
- 重要度: LOW（user-facing バグなし）。

**L2. 右列の `grid-rows-[repeat(3,minmax(0,1fr))]` は子の出現状態に依存しない explicit 3 行**

- 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:314](src/app/tournaments/[tid]/dashboard-client.tsx#L314)
- ロジック: `showRightColumn = state === "running" | "paused"`。3 つの統計カードはそれぞれ:
  - `NextBreakCard`: state guard だけで return null → showRightColumn 内では必ず render
  - `AverageStackCard`: state + `players.length === 0` + `active.length === 0` でも null
  - `PlayersCard`: state + `players.length === 0` で null
- 結果: 「state=running なのに players が一人も登録されていない」というあり得ない状態が発生すると、3 行 grid のうち NextBreakCard 1 つしか描画されず、下 2/3 が空白として残る（h-full と組み合わさり、見た目が破綻し得る）。
- 実際の発生条件: running 状態は最低 1 人プレイヤーがいる前提のため、UI 操作上は到達不能。一方、Firestore の手書き編集や restore からの異常状態では起こり得る。
- 修正案: `grid-rows-3` ではなく `flex flex-col` に切替えて子要素分だけ伸ばす、もしくは null 戻りの代わりに「データなし」プレースホルダーを返して 3 行を埋める。今回は plan 上想定外のエッジケースであり、対応は次 Phase で十分。
- 重要度: LOW（実運用では起こらない）。

**L3. `showRightColumn` を満たす state="running"/"paused" でも、winner 確定〜auto finish の 2 秒間は右列が表示されたまま**

- 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:219-222](src/app/tournaments/[tid]/dashboard-client.tsx#L219-L222) と [L322](src/app/tournaments/[tid]/dashboard-client.tsx#L322)
- 動作: WinnerBanner は grid 外に出されたが、winner 確定中も `data.state` は依然 running/paused のため、右列の `Average Stack` などは表示され続ける（active=1 で表示）。これは仕様通り（plan 想定）だが、AVG カードの「初期 N」表示と Players 「1 / 20」が banner と並ぶのは情報過多気味。
- 重要度: LOW（仕様確認のみ。今回の PR で変えない）。

**L4. ヘッダー「1 Table {seatsPerTable} 席」は語順が英日混在で違和感がある**

- 場所: [src/app/tournaments/[tid]/dashboard-client.tsx:235](src/app/tournaments/[tid]/dashboard-client.tsx#L235)
- 表示例: `現在 Lv1 / 締切 Lv6 / 18 レベル / 1 Table 9 席`
- 語感: 日本語ヘッダーに `1 Table` だけ突然英語が混ざるため、`1 Table あたり 9 席` 等にした方が読みやすい。
- 修正案（任意）: `${data.structureSnapshot.levels.length} レベル / 1 Table あたり ${data.seatsPerTable} 席`
- 重要度: LOW（ユーザー指摘待ち。plan の意図に従っているので今回はスルー可）。

## Validation Results

| Check                         | Result | Notes |
| ----------------------------- | ------ | ----- |
| `npm run typecheck`（tsc -p） | Pass   | 0 errors |
| `npm run lint`（next lint）   | Pass   | 0 warnings / 0 errors |
| `npm test`                    | Pass   | 479 / 479 tests pass（orchestrator description assertion 2 件 update を含む） |
| `npm run build`               | Pass   | Next.js 15 生成成功、ページサイズに想定外の増加なし |

UI 目視は未実施（無人セッション）。`npm run dev` での `lg+` 幅レイアウト確認は実装者の TODO に残っている。

## Files Reviewed

| File | Status | Notes |
| ---- | ------ | ----- |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | Modified | 上段 grid 再構成（左右 sticky 廃止、`lg:items-stretch`、`showRightColumn` 分岐、`gridColsClass`、WinnerBanner を grid 外へ） |
| `src/components/qr/QrPanel.tsx` | Modified | `className?: string` prop 追加（Card forward） |
| `src/components/tournament/AverageStackCard.tsx` | Modified | タイトル `text-base md:text-lg font-semibold text-foreground`、値 `text-4xl md:text-5xl` |
| `src/components/tournament/NextBreakCard.tsx` | Modified | 同上＋ Break 中 `text-3xl md:text-4xl` |
| `src/components/tournament/PlayersCard.tsx` | Modified | 同上＋ 数値 `text-4xl md:text-5xl`、`/` `text-2xl md:text-3xl` |
| `src/components/tournament/TimerDisplay.tsx` | Modified | 残時間 `lg:text-[10rem] lg:leading-none`、SB/BB/Ante `lg:text-5xl`、BREAK `lg:text-4xl` |
| `src/components/tournament/SeatingBoard.tsx` | Modified | `卓 N` → `Table N` |
| `src/components/tournament/BalancingInstructionCard.tsx` | Modified | break description の `卓 N` → `Table N`（move description は元から `Table:N, No.M` で未変更） |
| `src/components/tournament/TournamentForm.tsx` | Modified | `1 卓` × 3 箇所を `1 Table` 系に置換 |
| `src/lib/services/seating/orchestrator.ts` | Modified | error msg / log desc 計 4 箇所 |
| `src/lib/services/seating/orchestrator.test.ts` | Modified | description assertion 2 件 update |
| `.claude/PRPs/plans/phase-4.12-...plan.md` | Moved → `completed/` | plan 完了に伴う移動 |
| `.claude/PRPs/reports/phase-4.12-...report.md` | Added | 実装レポート |

## Notes

- schema / Firestore Rules / Repository / Hook / Service ロジック は無変更。CLAUDE.md の Firebase / error-logging / security / group-membership ルールはいずれも参照不要範囲。
- `tableNum` / `seatNum` などの **DB フィールド名 / collection 名 / AppError ドメインコード** は据え置き — 後方互換性維持。
- 残存「卓」は `engine.ts` の TDA 解説 docstring と `engine.test.ts` の `it()` ケース名のみ。plan で対象外と明記済み（保守用日本語維持）。

## Next Steps

- [ ] 実機 `lg+` 幅で 3 列 `offsetHeight` 一致を目視確認
- [ ] 統計 3 カードの黒字タイトルがダーク／ライト両モードで読めるか確認
- [ ] `state=setup`/`seating` で右列が消え grid が 2 列に縮退することを確認
- [ ] `/prp-commit` で 1 commit にまとめる
- [ ] `/prp-pr` で PR 作成
