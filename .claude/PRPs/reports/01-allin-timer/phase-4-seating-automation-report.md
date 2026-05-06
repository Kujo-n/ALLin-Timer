# Implementation Report: Phase 4 — Seating Automation

## Summary

運営者トリガーによる初回席決め、バストボタン、TDA 2015 準拠のテーブルバランシング（最大 6 卓）、進行中レイトエントリーの自動配席を実装。

- 席情報を `players/{pid}` に `tableNum` / `seatNum` / `lastMovedAt` として持たせる schema 拡張
- テーブルの開閉状態を `tournaments/{tid}/tables/{tableNum}` サブコレクションで管理
- 純粋関数の **seating engine**（`src/lib/services/seating/engine.ts`）と Firestore 副作用の
  **seating orchestrator**（`src/lib/services/seating/orchestrator.ts`）に分離
- 状態遷移を `setup → seating → running` の 3 段に拡張し、`startTournament` を `beginSeating` /
  `confirmSeating` に分割。orchestrator が `commitInitialSeating` で席割当を一括書き込み
- 運営者ダッシュボードに `BalancingInstructionCard` / `SeatingBoard` / `BustButton` を追加
- 参加者 `/live` に「あなたの席（卓 N 席 M）」と移動 30 秒以内のバナー表示を追加
- `firestore.rules` の `players/{pid}` `update` を「self: displayName のみ」と
  「group メンバー: bust/seat/lastMovedAt」に分岐

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                                         |
| ------------- | ---------------- | ---------------------------------------------- |
| Complexity    | Large            | Large（想定通り）                              |
| Confidence    | -                | High（全 220 テスト pass、build / typecheck / lint clean） |
| Files Changed | 約 18 files      | 24 files（新規 12 / 編集 12、テスト同期含む）    |

## Tasks Completed

| #   | Task                                              | Status   | Notes                                                                |
| --- | ------------------------------------------------- | -------- | -------------------------------------------------------------------- |
| 1   | player schema に `tableNum`/`seatNum`/`lastMovedAt` 追加 | Complete |                                                                      |
| 2   | tournament schema に `seatsPerTable` 追加         | Complete | range 2〜10、既存テスト fixture も同期更新                           |
| 3   | tables schema + repository 新設                   | Complete | `upsertTables` (batch) / `markTableBroken` / `subscribeTables`       |
| 4   | players repo に `bustPlayer` / `unbustPlayer` / `assignSeat` / `clearSeat` を追加 | Complete | repository 関数は `userGroupIds` を引数に取らない（GOTCHA に従い permission は rules に委ねる）— **plan 記載のシグネチャから deviation** |
| 5   | seating engine（`planInitialSeating` / `planLateEntrySeat` / `planBalancingMove` / `planTableBreak`） | Complete | mulberry32 PRNG を `prng.ts` に分離                                  |
| 6   | seating orchestrator（runTransaction + race guard）| Complete | `commitInitialSeating` / `autoSeatLateEntry` / `applyBalancingOnce` / `bustPlayer` / `unbustPlayer` を export |
| 7   | `useSeatingAutoOrchestrator` hook                 | Complete | inflight ref で多重発火防止                                          |
| 8   | tournaments repo に `beginSeating` / `confirmSeating` を追加し `startTournament` を削除 | Complete | tournaments.test.ts も同期更新                                       |
| 9   | firestore.rules の `players/{pid}` `update` を OR 分岐 | Complete | 運営者は `bust` / `seat` / `lastMovedAt` 変更可、本人は `displayName` のみ |
| 10  | TournamentForm に `seatsPerTable` 入力欄を追加    | Complete | default 9、range 2〜10                                               |
| 11  | TimerControls + Dashboard を seating フェーズ対応 | Complete | dashboard で `players` / `tables` を 1 度 subscribe して各子に伝搬   |
| 12  | BustButton + PlayerList 統合                      | Complete | running / paused のみで表示                                          |
| 13  | BalancingInstructionCard                          | Complete | engine で table-break 優先、なければ balancing move 1 件             |
| 14  | SeatingBoard                                      | Complete | currentUid 一致席に ★、isBroken は薄く表示                           |
| 15  | /live に自席表示 + 30 秒「移動しました」バナー    | Complete |                                                                      |
| 16  | receipt service の late entry hook                | Complete | 締切超過時の `tournament/late-entry-closed` を `running`/`paused` でも throw |
| 17  | engine / orchestrator / players / tables / tournaments テスト | Complete | engine は TDA ルール 18 ケース網羅、orchestrator は state guard / race / engine 例外を網羅 |
| 18  | Firebase Emulator rules テスト                    | **Skipped** | Emulator セットアップが本プロジェクトに未導入。手動シナリオを下記に列挙し、本番反映時に Firestore Rules Playground で確認する運用とする |

## Validation Results

| Level           | Status      | Notes                                                                  |
| --------------- | ----------- | ---------------------------------------------------------------------- |
| Static Analysis | Pass        | `npm run typecheck` でゼロエラー                                       |
| Lint            | Pass        | `npm run lint` で warning ゼロ                                         |
| Unit Tests      | Pass        | `npm test` で **220 tests** 全 pass（うち 36 tests が Phase 4 新規）   |
| Build           | Pass        | `next build` が `✓ Compiled successfully` で完走                       |
| Integration     | N/A         | Phase 4 は外部 service 連携なし                                        |
| Edge Cases      | Pass        | engine.test.ts に MAX_TABLES 超過 / 0 人 / バスト除外 / table break 同数 tableNum 最大 / late entry broken 卓スキップ 等を網羅 |
| rules Emulator  | **Manual**  | Phase 5 でセットアップ予定。下記「Manual Validation Required」参照     |

## Files Changed

| File                                                     | Action  | Lines        |
| -------------------------------------------------------- | ------- | ------------ |
| `src/lib/firebase/schemas/player.ts`                     | UPDATE  | +5 / -0      |
| `src/lib/firebase/schemas/tournament.ts`                 | UPDATE  | +6 / -0      |
| `src/lib/firebase/schemas/table.ts`                      | CREATE  | +16          |
| `src/lib/firebase/repositories/tables.ts`                | CREATE  | +103         |
| `src/lib/firebase/repositories/tables.test.ts`           | CREATE  | +156         |
| `src/lib/firebase/repositories/players.ts`               | UPDATE  | +85 / -1     |
| `src/lib/firebase/repositories/players.test.ts`          | CREATE  | +147         |
| `src/lib/firebase/repositories/tournaments.ts`           | UPDATE  | +39 / -8     |
| `src/lib/firebase/repositories/tournaments.test.ts`      | UPDATE  | +56 / -33    |
| `src/lib/services/seating/prng.ts`                       | CREATE  | +27          |
| `src/lib/services/seating/engine.ts`                     | CREATE  | +220         |
| `src/lib/services/seating/engine.test.ts`                | CREATE  | +217         |
| `src/lib/services/seating/orchestrator.ts`               | CREATE  | +362         |
| `src/lib/services/seating/orchestrator.test.ts`          | CREATE  | +275         |
| `src/lib/hooks/useSeatingAutoOrchestrator.ts`            | CREATE  | +73          |
| `src/components/tournament/SeatingBoard.tsx`             | CREATE  | +90          |
| `src/components/tournament/BalancingInstructionCard.tsx` | CREATE  | +98          |
| `src/components/tournament/BustButton.tsx`               | CREATE  | +51          |
| `src/components/tournament/PlayerList.tsx`               | UPDATE  | +28 / -22    |
| `src/components/tournament/TimerControls.tsx`            | UPDATE  | +85 / -12    |
| `src/components/tournament/TournamentForm.tsx`           | UPDATE  | +38 / -3     |
| `src/app/tournaments/[tid]/dashboard-client.tsx`         | UPDATE  | +97 / -8     |
| `src/app/tournaments/[tid]/live/live-client.tsx`         | UPDATE  | +93 / -10    |
| `src/app/tournaments/[tid]/edit/tournament-edit-client.tsx` | UPDATE | +6 / -2     |
| `src/app/tournaments/new/tournament-new-client.tsx`      | UPDATE  | +2 / -1      |
| `src/lib/services/receipt.ts`                            | UPDATE  | +11 / -0     |
| `src/lib/services/receipt.test.ts`                       | UPDATE  | +4 / -0      |
| `src/lib/services/timer.test.ts`                         | UPDATE  | +1 / -0      |
| `src/lib/firebase/schemas/index.test.ts`                 | UPDATE  | +20 / -0     |
| `firestore.rules`                                        | UPDATE  | +27 / -7     |

## Deviations from Plan

1. **`bustPlayer` / `unbustPlayer` / `assignSeat` の signature**:
   plan は `(tid, pid, userGroupIds)` を提案していたが、同 task の GOTCHA に
   「permission は Firestore rules で最終防衛、repository はシンプルな write ラッパに留める」
   と明記されており、こちらに従い `userGroupIds` 引数を削除した。group チェックは
   orchestrator / component 層で実施し、repository は薄い write ラッパとして実装。
2. **orchestrator が `bustPlayer` / `unbustPlayer` を re-export**:
   plan は明示していないが、UI 層が `players` 直 import と `orchestrator` 経由 import で
   分かれると依存導線が読みづらくなるため、orchestrator から再 export して UI からは
   orchestrator のみを使うパターンに統一した。
3. **`commitInitialSeating` が transaction 内で `Promise.all(tx.get(...))` を実行**:
   plan の「subscribe 済み snapshot を渡す」方針に加え、tx 内でも各 player を再 read して
   `isBusted` の race を吸収するロジックを追加した。Firestore transaction の制約上、
   collection scan は不可だが個別 doc の `tx.get` は可能なため安全。
4. **`commitInitialSeating` の `seatsPerTable` 引数を optional に**:
   呼出し時に `tournament.seatsPerTable` を上書き指定できる柔軟性のため。default は tournament doc の値を採用。
5. **`autoSeatLateEntry` の signature 拡張**:
   plan の `(tid, uid, groupIds, playerId, expectedLastMovedAtMs)` に加え、engine で席計算するため
   `seatedPlayers` / `brokenTableNums` / `seatsPerTable` を追加。これにより orchestrator は
   subscribe 済みの最新 snapshot を直接受け取って計画 → tx 反映できる。
6. **Task 18（rules Emulator）はスキップ**: 本プロジェクトに `@firebase/rules-unit-testing` の
   セットアップが未導入。Phase 5 で導入予定。本 Phase は手動シナリオ（下記）で代替。

## Issues Encountered

1. **`tournaments.test.ts` で `startTournament` 削除後の test 残骸**:
   import / `describe` ブロックを `beginSeating` / `confirmSeating` に置換することで解消。
2. **`receipt.test.ts` / `timer.test.ts` / `schemas/index.test.ts` で fixture が古い**:
   `seatsPerTable` / `tableNum` / `seatNum` / `lastMovedAt` フィールドが zod required になったため、
   既存 fixture と mock 値を更新。既存 schema test に新規 schema フィールドを追加するパターン。
3. **`TimerControls` / `PlayerList` の責務分離**:
   従来 `PlayerList` 自身で `subscribePlayers` していたが、Phase 4 では dashboard で 1 度 subscribe して
   `TimerControls`（席決め時に渡す）/ `BalancingInstructionCard` / `SeatingBoard` / `PlayerList` に
   配る形にリファクタ。Props を増やしたが subscribe 重複を排除。
4. **engine の table-break 判定で「同数最少なら tableNum 最大を閉じる」を破壊しないテスト**:
   2/2/5 のケースで卓 2 が閉じる挙動を test で固定化。
5. **orchestrator の `applyBalancingOnce` test「no-op ケース」で table-break 条件を意図せず満たす**:
   3/3 だと total=6 ≤ (2-1)*9=9 で table break が走ってしまうため、9/9 に変更（満席なので break 不可）。

## Tests Written

| Test File                                                | Tests        | Coverage                                                        |
| -------------------------------------------------------- | ------------ | --------------------------------------------------------------- |
| `src/lib/services/seating/engine.test.ts`                | 18 tests     | TDA ルール網羅（initial seating / late entry / balancing / table break） |
| `src/lib/services/seating/orchestrator.test.ts`          | 7 tests      | state guard / engine 例外ラップ / race / no-balancing-needed     |
| `src/lib/firebase/repositories/tables.test.ts`           | 7 tests      | listTables / upsertTables(batch) / upsertTable / markTableBroken / subscribeTables |
| `src/lib/firebase/repositories/players.test.ts`          | 8 tests      | upsertPlayer (create/merge) / bustPlayer / unbustPlayer / assignSeat / clearSeat |
| `src/lib/firebase/repositories/tournaments.test.ts`      | +8 tests     | beginSeating / confirmSeating の state guard、createTournament の seatsPerTable |
| `src/lib/firebase/schemas/index.test.ts`                 | +1 test      | 着席 player（tableNum/seatNum/lastMovedAt）の zod parse           |

合計 **+36 tests**（既存 184 → 220 tests pass）。

## Manual Validation Required

`firestore.rules` 変更（`players/{pid}` `update` の OR 分岐）について、Firebase Emulator が
未セットアップのため、本番デプロイ前に **Firestore Rules Playground** で以下を手動確認:

1. 非 group メンバーが他人の `player.isBusted` を変更 → **拒否**
2. 本人が自分の `player.isBusted` を `true` に変更 → **拒否**（self-update は immutable 制約）
3. 本人が自分の `player.displayName` を変更 → **許可**
4. group メンバーが他人の `player.tableNum` / `seatNum` / `lastMovedAt` を変更 → **許可**
5. group メンバーが他人の `player.uid` を変更しようとする → **拒否**

ブラウザ上でのシナリオ検証も推奨:

- **シナリオ A: 初回席決め** — 3 人参加 → setup で「席を決定」→ seating で 1 卓 3 席に着座 →「トーナメント開始」で running
- **シナリオ B: レイトエントリー自動配席** — 卓に空席があれば level 1〜6 の参加者が自動着席
- **シナリオ C: バスト + バランシング** — 7/5 でバスト → 5/5 で diff 0 / 7/5 で diff 2 のバランシング指示
- **シナリオ D: テーブル閉鎖** — 18 人 × 2 卓で 10 人バスト → 1 卓閉鎖の指示が連続表示

## Known Limitations / Follow-ups

1. **既存データ migration なし**: Phase 2.5 と同じく破壊的変更（`tableNum` / `seatNum` / `lastMovedAt` /
   `seatsPerTable` の追加）。運用中 tournament は zod validate に失敗するため、本番反映前に手動削除推奨。
2. **late entry 締切判定が client 側のみ**: bypass 可能。Phase 5 で rule 側の `currentLevel` 参照を検討。
3. **「指示完了」UI は 1 件ずつ**: 連続して大量バストが発生した場合、運営者は複数回ボタンを押す必要あり。
   表示は自動更新されるが、「全部適用」ボタンは未実装（運営者の確認 UX を維持するため意図的に 1 件ずつ）。
4. **ボタン位置トラッキングなし**: BB 次の判定は「席番号最小」で代替（PRD 合意済み）。
5. **rules Emulator setup は Phase 5 へ持ち越し**: Phase 4 の rules 変更は手動 Playground 確認で代替。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] `firebase deploy --only firestore:rules` で本番反映（手動シナリオ確認後）
- [ ] PR 作成 via `/prp-pr`
- [ ] Phase 5 の planning（rules Emulator セットアップ・賞金計算・/live の操作 UI 改善 等）
