# Implementation Report: Phase 4.12 — Dashboard Top-Row Equal-Height & "卓 → Table" Rename

## Summary

Phase 4.11（Timer Layout & Control Polish）完了後の運営者フィードバックをまとめて反映。

1. **Dashboard 上段の等高化**: QR / Timer+Controls / 統計 3 カード を `lg:items-stretch` で同じ高さに揃え、左右 aside の `lg:sticky lg:top-4 lg:self-start` を廃止。state=`setup`/`seating`/`finished` 時は `showRightColumn` 分岐で右列を非表示にし grid を 2 列に縮退
2. **TimerDisplay フォント拡大**: 残時間 `lg:text-[10rem] lg:leading-none` / SB・BB・Ante `lg:text-5xl` / BREAK `lg:text-4xl`
3. **統計 3 カード（NextBreak / AverageStack / Players）スタイル更新**: タイトル `text-base md:text-lg font-semibold text-foreground`、値テキストを 1 段拡大
4. **WinnerBanner を上段 grid 外**へ分離（中央列の縦伸長で等高 grid が乱れるのを防ぐ）
5. **user-facing 文言「卓 → Table」一括リネーム**: dashboard-client.tsx ヘッダー説明 / SeatingBoard / BalancingInstructionCard / TournamentForm / orchestrator description / orchestrator AppError メッセージ / orchestrator.test.ts assertion 2 件
6. **schema フィールド名 / collection 名 / AppError ドメインコードは不変**（`tableNum` / `tables` / `tournament/seating-too-many-tables` 等はすべて維持）
7. **`/live` ページは無変更**（既に Table 表記、diff ゼロ）

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Small            | Small          |
| Confidence    | n/a              | High           |
| Files Changed | 8 編集 + 1 テスト = 9 | 9（PRD 含むと 10 だが PRD は前 commit で更新済み） |

## Tasks Completed

| #   | Task                                                              | Status      | Notes                                     |
| --- | ----------------------------------------------------------------- | ----------- | ----------------------------------------- |
| 1   | PRD に Phase 4.12 を追加                                          | Complete    | Plan commit (6c7f06c) で既に反映済み      |
| 2   | QrPanel に className prop を追加                                  | Complete    |                                           |
| 3   | 統計 3 カードのタイトル＆値スタイル更新                           | Complete    |                                           |
| 4   | TimerDisplay のフォントサイズ拡大                                 | Complete    |                                           |
| 5   | dashboard-client.tsx の上段 grid 再構成 + 右列の state 分岐       | Complete    | WinnerBanner も上段から下段へ移動         |
| 6   | SeatingBoard.tsx の "卓" → "Table" 置換                           | Complete    | docstring の "卓" は維持                  |
| 7   | BalancingInstructionCard.tsx の "卓" → "Table" 置換               | Complete    |                                           |
| 8   | TournamentForm.tsx の "卓" → "Table" 置換                         | Complete    | 3 箇所（バリデーションエラー / Label / 補足） |
| 9   | orchestrator.ts の description / エラー文言の置換 + テスト更新     | Complete    | 計 4 箇所 + テスト 2 箇所                 |
| 10  | dashboard-client.tsx ヘッダー説明 "1 卓" → "1 Table" 置換          | Complete    |                                           |
| 11  | 検証 / 残存 "卓" の確認                                           | Complete    | docstring と engine.test.ts の `it()` 名のみ残存（plan で許容） |

## Validation Results

| Level           | Status   | Notes                                  |
| --------------- | -------- | -------------------------------------- |
| Static Analysis | Pass     | `npm run typecheck` / `npm run lint` 共に 0 エラー |
| Unit Tests      | Pass     | 479 / 479 tests pass（既存テスト維持 + orchestrator description assertion を新フォーマットに更新） |
| Build           | Pass     | `npm run build` 成功（Next.js 15.5.15） |
| Integration     | N/A      | UI / ラベル変更のみのため省略         |
| Edge Cases      | Verified | 残存 "卓" はコメント / docstring / test name のみ |

## Files Changed

| File                                                                | Action  | Lines (approx) |
| ------------------------------------------------------------------- | ------- | -------------- |
| `src/components/qr/QrPanel.tsx`                                     | UPDATE  | +1 / -1        |
| `src/components/tournament/NextBreakCard.tsx`                       | UPDATE  | +3 / -3        |
| `src/components/tournament/AverageStackCard.tsx`                    | UPDATE  | +2 / -2        |
| `src/components/tournament/PlayersCard.tsx`                         | UPDATE  | +4 / -4        |
| `src/components/tournament/TimerDisplay.tsx`                        | UPDATE  | +3 / -3        |
| `src/components/tournament/SeatingBoard.tsx`                        | UPDATE  | +1 / -1        |
| `src/components/tournament/BalancingInstructionCard.tsx`            | UPDATE  | +1 / -1        |
| `src/components/tournament/TournamentForm.tsx`                      | UPDATE  | +3 / -3        |
| `src/lib/services/seating/orchestrator.ts`                          | UPDATE  | +4 / -4        |
| `src/lib/services/seating/orchestrator.test.ts`                     | UPDATE  | +2 / -2        |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                    | UPDATE  | 上段 grid 再構成（約 50 行）+ ヘッダー文言 1 行 |

PRD（`.claude/PRPs/prds/allin-timer.prd.md`）への Phase 4.12 行 / Phase Details / Parallelism Notes 追加は Plan commit (6c7f06c) で先行反映済み。

## Deviations from Plan

**追加修正**: Plan では `showRightColumn = state === "running" || "paused"` と定義されていたが、運営者フィードバック「優勝者決定後も Next Break In などの要素を消さない」を反映し、`finished` 状態も含むように変更:

- `dashboard-client.tsx`: `showRightColumn` に `finished` を追加（右列 aside を `running` / `paused` / `finished` の 3 状態で表示）
- `NextBreakCard.tsx` / `AverageStackCard.tsx` / `PlayersCard.tsx`: 各カードの state guard も `finished` を許可するよう拡張
- 関連する 3 つの「does not render when state is finished」テストを「renders in finished state so the right column stays visible after winner」に書き換え（finished 状態でも要素が描画されることを assert）

**Why**: 優勝者決定 → `finishTournament` で state=finished に遷移しても、運営者は最終的な平均スタック・残り人数を WinnerBanner と並べて確認したい。Plan は `setup` / `seating` で右列が空になる問題（QR 高で stretch されて間延び）の対策として `showRightColumn` を導入したが、`finished` は WinnerBanner 表示の文脈でカードが意味を持つため除外対象から外した。

## Issues Encountered

なし。typecheck / lint / test / build がすべて green。残存の "卓" は plan で明記された除外対象（コメント / docstring / test name）のみ。

## Tests Written

新規テスト追加なし（既存テスト 2 件 を新 description フォーマットに更新）。

| Test File                                                          | Tests                          |
| ------------------------------------------------------------------ | ------------------------------ |
| `src/lib/services/seating/orchestrator.test.ts`                    | description assertion 2 件 update |

`QrPanel className` の単体テストは、当初 plan で「新規 1 件」と記載があったが、QrPanel は既存テストファイルが無く、props passthrough は型と Card のリグレッションテスト（Card 内部の `cn(...)` マージは ui/card のテストでカバー済み）で担保される最小行数の差分（`className?: string` の追加と Card への単純 forward）であるため、テスト追加せず。

## Next Steps

- [ ] `/code-review` でローカルレビュー
- [ ] `/prp-commit` で 1 commit にまとめる
- [ ] `/prp-pr` で PR 作成
- [ ] ブラウザ目視確認: `npm run dev` で `/tournaments/{tid}` を開き、`lg+` 幅で 3 列 `offsetHeight` 一致 / state 切替時の右列出し入れ / 統計 3 カードの黒字タイトル を確認
