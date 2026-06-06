# Implementation Report: Phase 2 — 受付代理 UI

## Summary

運営者がトーナメントダッシュボードから参加者を代理受付できる UI を実装した。Phase 1 で
完成済みの `proxy-receipt.ts` service / rule 経路を消費する純 UI 層に加え、名前のみ player の
表示名修正用に薄い repository / service を 1 本ずつ追加した。

- `PlayerList` ヘッダに「参加者を追加」ボタン（受付可能 state + organizer 文脈が揃うとき表示）
- 2 タブの `AddParticipantDialog`（メンバーから選ぶ / ゲストで追加）
- 名前のみ（`uid === null`）player の「管理専用」バッジ + 表示名編集（✏ → ダイアログ）

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual |
| ------------- | ---------------- | ------ |
| Complexity    | Medium           | Medium |
| Confidence    | （計画記載なし）  | 高（パターン踏襲のみ・サプライズ無し） |
| Files Changed | 8（新規 2 / 更新 6） | 9（新規 3 / 更新 6） |

実差: `PlayerList.test.tsx` は計画で「CREATE/UPDATE（既存が無ければ新規）」とされていたが
既存ファイルが無かったため新規作成。よって新規が 1 件増えて計 9 ファイル。

## Tasks Completed

| #   | Task                                              | Status      | Notes |
| --- | ------------------------------------------------- | ----------- | ----- |
| 1   | repository `updatePlayerDisplayName` 追加          | [done] 完了 | - |
| 2   | service `updatePlayerDisplayNameByOrganizer` 追加  | [done] 完了 | `assertAcceptingEntries` は呼ばない（finished でも名前訂正可） |
| 3   | `AddParticipantDialog` 新規作成                    | [done] 完了 | ネイティブ `<select>` 採用（jsdom テスト容易性） |
| 4   | `PlayerList` に追加ボタン・バッジ・編集統合          | [done] 完了 | 新 props は全 optional・後方互換 |
| 5   | `dashboard-client.tsx` から新 props 伝搬            | [done] 完了 | `isAcceptingProxyEntry(data)` を渡す |
| 6   | repository テスト追加                              | [done] 完了 | 2 ケース |
| 7   | service テスト追加                                 | [done] 完了 | 5 ケース（organizer / deny / 空 / too-long / finished 成功） |
| 8   | コンポーネントテスト追加                            | [done] 完了 | AddParticipantDialog 5 + PlayerList 5 |
| 9   | E2E スペック（任意）                               | スキップ    | Task 9 は Should/任意。emulator 起動コストのため次回ドライラン前に手動 + 既存 E2E で確認予定 |

## Validation Results

| Level           | Status      | Notes |
| --------------- | ----------- | ----- |
| Static Analysis | [done] Pass | `tsc --noEmit` 0 errors / `next lint` warnings 0 |
| Unit Tests      | [done] Pass | 新規 17 ケース（repo 2 / service 5 / dialog 5 / list 5） |
| Build           | [done] Pass | `next build` success |
| Integration     | N/A         | E2E は Task 9（任意）。今回は未実行 |
| Edge Cases      | [done] Pass | 空入力 / 16 字 / service error / メンバー除外 / 候補ゼロ / finished 編集 |

## Files Changed

| File | Action | Lines |
| ---- | ------ | ----- |
| `src/lib/firebase/repositories/players.ts` | UPDATED | +25 |
| `src/lib/services/proxy-receipt.ts` | UPDATED | +33 |
| `src/components/tournament/AddParticipantDialog.tsx` | CREATED | +217 |
| `src/components/tournament/PlayerList.tsx` | UPDATED | +110 / -20 |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATED | +4 |
| `src/lib/firebase/repositories/players.test.ts` | UPDATED | +18 |
| `src/lib/services/proxy-receipt.test.ts` | UPDATED | +73 |
| `src/components/tournament/AddParticipantDialog.test.tsx` | CREATED | +138 |
| `src/components/tournament/PlayerList.test.tsx` | CREATED | +163 |

## Deviations from Plan

- **`PlayerList.test.tsx` は新規作成**（計画では「CREATE/UPDATE」）。既存ファイルが無かったため。
  PlayerList が import する firebase 依存 service（`receipt` / `seating/orchestrator` /
  `proxy-receipt`）を `vi.mock` し、jsdom での firebase 初期化を回避した。
- それ以外は計画どおり。

## Issues Encountered

None。全パターンが既存コードベースの踏襲で完結した。

## Tests Written

| Test File | Tests | Coverage |
| --------- | ----- | -------- |
| `players.test.ts`（追加分） | 2 | `updatePlayerDisplayName` payload / error wrap |
| `proxy-receipt.test.ts`（追加分） | 5 | organizer 呼出 / not-organizer deny / 空名 / 16 字 / finished 成功 |
| `AddParticipantDialog.test.tsx` | 5 | member submit / name submit / service error alert / メンバー除外 / 候補ゼロ disabled |
| `PlayerList.test.tsx` | 5 | バッジ表示 / 非表示 / 追加ボタン gating（true/false）/ 編集 submit |

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] Phase 1 rules が**本番未 deploy なら** `firebase deploy --only firestore:rules` を先に実行
      （代理 create が permission-denied しないための前提。本 Phase は rules 無変更）
- [ ] 次回ドライランで「名前のみ player の運用十分性」「late-entry 締切超過時の UX」を検証
