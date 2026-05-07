# Local Code Review: Phase C — Table Label & Color

**Reviewed**: 2026-05-07
**Branch**: develop（uncommitted changes）
**Scope**: Phase C 「テーブル呼称カスタム」 — schema 2 件 / repo 2 件 / service 1 件 + orchestrator 1 件 / rule 2 ブランチ / UI 5 ファイル / drift + emulator validator
**Decision**: APPROVE with comments

## Summary

Phase C は要件どおり additive で table 呼称 / 色を導入し、`defaultTableLabels` の auto-fill、organizer 限定 inline edit、rule の 2 経路分割（`affectedKeys` で他フィールド汚染を deny）、drift / emulator validator まで一貫して整備されている。schema → service → rule → fixture → e2e の更新フローが揃っており、CRITICAL / HIGH 級の問題は検出されなかった。MEDIUM は rule 設計のトレードオフ 1 件、LOW は UI 周りの軽微な改善余地が数件。validation は typecheck / lint / unit (1003) / drift / emulator validator (14) すべて green、本番 deploy が完了済みである旨も report に記載されている。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

- **[firestore.rules:514-542](../../../../firestore.rules#L514-L542) — `tables/{tableId}` `allow update` 経路 A の許容範囲が広い**
  経路 A（`!affectedKeys.hasAny(['label','color'])`）は `label`/`color` 以外なら何でも許可するため、organizer は `tableNum=999` / `createdAt` を任意改変可能。実際の呼出元（`commitInitialSeating` の `tx.set` は create branch、`markTableBroken` は `isBroken` 単独）では問題ないが、信頼境界の縮約として `affectedKeys.hasOnly(['isBroken'])` 等に絞るほうが drift 耐性が高い。plan の risk 表でも将来 cleanup として言及されているとおり、Phase D 以降で機械可読なホワイトリストへ寄せる選択肢を検討推奨。`finishedTournamentCount` / `defaultSeatsPerTable` の信頼ロール論と同じトレードオフのため、今 Phase でブロッカーにはしない。

### LOW

- **[live-client.tsx:258-270](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L258-L270) — Table 表示の IIFE に文字列等価判定が混入**
  `formatTableLabel(myTable) === \`Table ${me.tableNum}\`` で「fallback だったら数値、それ以外は label」を判定しているが、ユーザーが label に文字列 `Table 1` をそのまま設定するとカスタム呼称扱いされない（視覚的差異はないものの将来 i18n 等で fragile）。`myTable?.label?.trim() ? formatTableLabel(myTable) : me.tableNum` の方が意図的かつ簡潔。aria/test 互換維持の理由は report に書かれているとおり妥当だが、判定の表現は素直化できる。

- **[TableLabelEditPopover.tsx:42-54](../../../../src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx#L42-L54) — Dialog 開閉時の prop ↔ state 同期が close 側に寄っている**
  `useState(table.label ?? "")` は初回マウントの prop を捕まえ、`reset()` は close 時のみ実行。close 後に subscribe が prop を更新した場合、次回 open 時に古い state が表示される（保存後の同 tab では `setOpen(false)` 直接で reset を経由しないため整合する）。`if (next) reset()` に倒すか、`useEffect(() => { if (!open) reset(); }, [table.label, table.color])` で都度同期するのが堅い。実害は「他端末が更新した直後の僅かな window」のみ。

- **[GroupDefaultTableLabelsCard.tsx:83-104](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx#L83-L104) — 保存時の空行 silent drop**
  `cleaned = draft.map(trim).filter(s => s.length > 0)` は空行を黙って除外する。ユーザーが「あとで埋めるつもりで `[+ 追加]` を 4 件押した」場合、保存後に件数が縮む UX。validation エラーで止めるか、保存前に inline 警告（「空行は除外されます」）を出すと迷いが減る。

- **[SeatingBoard.tsx:188](../../../../src/components/tournament/SeatingBoard.tsx#L188) — aria-label と可視ラベルの不一致（既知）**
  `aria-label="table-${tableNum}"` を維持したまま可視タイトルだけ `formatTableLabel(table)` に変えており、スクリーンリーダーが「table-1」と読み上げる一方で sighted は「赤卓」と見る。plan / report で test 互換のためと明示されているため認識済みだが、Phase D 以降でアクセシブルな読み替え（`aria-label={`table-${tableNum} ${formatTableLabel(table)}`}` 等）も検討できる。

- **[orchestrator.ts:149-173](../../../../src/lib/services/seating/orchestrator.ts#L149-L173) — re-commit 時の merge 設計のドキュメント密度**
  「既存 doc あり + label 既設定 = no-op」「label 未設定 + default 非 null = patch」「default null = no-op」の 3 分岐は意図どおりだが、`color` を `existing.data().color ?? null` で書き戻す経路（label patch ブランチ）では `color` が「変化しないが書込みされる」 → rule 側で `affectedKeys` に含まれるかどうかは Firestore の同値判定次第。emulator validator は label の変更を観測しているが、color 同値書込み時の affectedKeys 挙動を 1 ケース直接 assert しておくと再発防止になる（現状緑なので blocker ではない）。

- **[live-client.tsx:75-85](../../../../src/app/tournaments/[tid]/live/live-client.tsx#L75-L85) — `subscribeTables` 失敗時に UI フィードバックなし**
  warn ログのみで onError パスが未配線。plan 通り「Live は壊さない」設計だが、organizer が `/live` を会場ディスプレイに投影中、tables だけ subscribe 失敗（rule drift 等）した場合、表示は数値 fallback でも「気付ける」手段がない。Phase A の `seasonStats` subscribe と同様、ConnectionBadge 系で expose する余地あり（Phase D の polish 候補）。

## Validation Results

| Check                           | Result   | Notes                                                                |
| ------------------------------- | -------- | -------------------------------------------------------------------- |
| Type check (`npm run typecheck`)| Pass     | Zero errors                                                          |
| Lint (`npm run lint`)           | Pass     | No ESLint warnings or errors                                         |
| Unit tests (`npm test`)         | Pass     | 1003 / 1003（format-table-label 6 件 + commit auto-fill 系 4 件 含む） |
| Drift (`npm run test:rules-limits`) | Pass | 11/11（`TABLE_LABEL_MAX_LENGTH` / `defaultTableLabels` の 2 行追加分含む） |
| Emulator validator (Phase C)    | Pass*    | report 上 14/14（再走未実施。`firebase emulators:exec` 環境はローカル外） |
| Build (`npm run build`)         | Skipped  | report で pass 済み記載あり、本レビューでは未再走                    |

(*) emulator validator は本レビュー実行環境に Firebase CLI セッションがなかったため再走していないが、`scripts/test-rules-table-labels.mjs` の 14 ケース構造は plan の最低 10 ケースを満たし、allow / deny / `affectedKeys` / size / regex を網羅している。

## Files Reviewed

### CREATE
- `src/lib/services/format-table-label.ts` — 純関数 + 6 ケースの test
- `src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx` — inline edit Dialog（`@radix-ui/react-dialog` 既存依存を再利用）
- `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx` — サークル詳細画面の inline 配列 edit
- `scripts/test-rules-table-labels.mjs` — REST 直叩き emulator validator（14 ケース）
- `tests/e2e/table-label-and-color.spec.ts` — 4 件の Playwright user-observable spec

### UPDATE（schema / rule 同期点）
- `src/lib/limits.ts` — `TABLE_LABEL_MAX_LENGTH = 10` 追加
- `src/lib/firebase/schemas/table.ts` — `label` / `color` を `nullable().default(null)` で additive
- `src/lib/firebase/schemas/group.ts` — `defaultTableLabels: array().max(MAX_TABLES).default([])` を additive
- `firestore.rules` — groups update 8 ブランチ目（`defaultTableLabels`）+ tables を `allow create / update / delete` に分割（`affectedKeys.hasOnly(['label','color'])` + size + regex 強制）
- `scripts/test-rules-limits.mjs` — drift 検査に 2 行追加

### UPDATE（書込経路 / view）
- `src/lib/firebase/repositories/groups.ts` — `createGroup` 初期値 + `updateDefaultTableLabels`
- `src/lib/firebase/repositories/tables.ts` — `updateTableLabel` 新設 / `upsertTables` の null 初期化
- `src/lib/services/group.ts` — `setDefaultTableLabels`
- `src/lib/services/seating/orchestrator.ts` — `commitInitialSeating` の tx を group/table 事前 read + create/部分 update 分岐に変更
- `src/components/tournament/SeatingBoard.tsx` — `formatTableLabel` 表示 + `color` 帯 + edit popover 配置
- `src/components/tournament/BalancingInstructionCard.tsx` — 「Table N」3 か所を `formatTableLabel` 経由に
- `src/app/tournaments/[tid]/live/live-client.tsx` — `subscribeTables` 追加 + Table 表示 fallback
- `src/app/tournaments/[tid]/dashboard-client.tsx` — `canEditTableLabel` / `onSaveTableLabel` を SeatingBoard へ伝搬
- `src/app/groups/[gid]/group-detail-client.tsx` — `GroupDefaultTableLabelsCard` を SeasonCard 前に積む

### UPDATE（test fixture 同期）
- `src/lib/services/seating/orchestrator.test.ts` — tx mock の reads 追加 + 既存 fixture に label/color 補完 + 新規 4 ケース
- `src/lib/hooks/useSeatingAutoOrchestrator.test.ts` — table fixture に label/color 補完
- `src/lib/services/group.test.ts` / `src/lib/hooks/useAudioPlayer.test.tsx` / `src/lib/firebase/schemas/index.test.ts` — group fixture に `defaultTableLabels: []` 補完
- `src/app/tournaments/[tid]/live/live-client.test.tsx` — `subscribeTables` の軽量 mock 追加
- `tests/e2e/pages/GroupsPage.ts` / `tests/e2e/pages/TournamentsPage.ts` — Page Object に Phase C 用 locator / helper 追加

### UPDATE（ドキュメント）
- `package.json` — `test:rules-table-labels` script 追加
- `.claude/rules/firebase-patterns.md` — groups update 表 +1 / tables 経路の Phase C 注記
- `.claude/rules/group-membership.md` — 権限マトリクスに 4 行追加
- `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` — Phase C 進捗

## Architectural / Pattern Compliance

- **`AppError` の prefix**: `validation/default-table-labels-invalid` / `validation/table-label-invalid` / `validation/table-color-invalid` / `firestore/write_failed` がいずれも既存規約（`error-logging.md` / `firebase-patterns.md`）に整合。
- **wrap helper**: `updateDefaultTableLabels` / `updateTableLabel` が `wrapFirestoreWrite` 経由。`logger.info` は wrap 外の成功時のみ。✓
- **subcollection 設計原則**: `tables/{tableId}` は explicit、`/{path=**}` wildcard 復活なし。`firebase-patterns.md` の Phase 5.4 原則に整合。
- **drift WARNING**: `TABLE_LABEL_MAX_LENGTH` の rule リテラル `<= 10` と `MAX_TABLES` の `<= 6` を `test-rules-limits.mjs` に追加し、limits.ts と機械検査連動。✓
- **`groups/{gid}` allowed-keys 表**: `firebase-patterns.md` に Phase C 行追加で 8 ブランチに更新。✓
- **テスト fixture 集約**: schema additive 変更に伴う 4 ファイルの fixture object literal 追記が漏れなく実施。`testing.md` の factory 規約に整合（plan 通りの追加対応）。
- **rule deploy 案内**: report の Next Steps に `firebase deploy --only firestore:rules` チェック項目あり（feedback memory `feedback_firestore_rules_deploy.md` に整合）。✓

## Recommended follow-ups (non-blocking)

1. `tables/{tableId}` `allow update` 経路 A を `affectedKeys.hasOnly(['isBroken'])` に絞る（MEDIUM）
2. `live-client.tsx` の Table 表示 IIFE を `myTable?.label?.trim()` 判定に書き換える（LOW）
3. `TableLabelEditPopover` の prop ↔ state 同期を open 時にも実行する（LOW）
4. `GroupDefaultTableLabelsCard` の保存時に空行 drop を inline ヒントで明示する（LOW）
5. emulator validator に「`color` 同値書込み時の affectedKeys 挙動」1 ケース追加（LOW）
6. Phase D で `subscribeTables` 失敗時の UI feedback を検討（LOW）

これらは Phase D（color picker / 並び替え / Web Share API）と並行 polish の候補であり、Phase C のマージブロッカーではない。
