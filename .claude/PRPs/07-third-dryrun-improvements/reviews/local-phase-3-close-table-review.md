# ローカルレビュー: Phase 3 「卓を空けて閉じる」（手動卓閉鎖）

**レビュー日**: 2026-06-07
**対象**: 未コミットのローカル変更（develop ブランチ）
**PRD**: 07-third-dryrun-improvements / Phase 3
**判定**: APPROVE（コメント付き）— CRITICAL / HIGH なし。MEDIUM 1 / LOW 3 を**全件対応済み**（下記「対応状況」）

## サマリ

運営者が指定卓を手動で閉じ、残卓へ定員 `MAX_SEATS_PER_TABLE`(=10) を上限に再配置する機能。
engine の純関数 `planManualTableClose` → orchestrator `applyManualTableClose`（既存 private
`applyTableBreak` を再利用）→ hook `useTableClose` → `CloseTableConfirmDialog` / `SeatingBoard`
までレイヤ分離が明快で、各層に unit / component / E2E test が揃っている。既存の race guard・PD reset・
tx 原子性をそのまま継承し、新たな Firestore rule 追加なしで成立している点が良い。型・lint・全 unit
（1544 件）・build すべて green。

## Findings

### CRITICAL

なし

### HIGH

なし

### MEDIUM

**M-1. 空だが未閉鎖（isBroken=false / active 0）の卓が再配置先として不可視 → 偽 overflow の可能性**
[engine.ts](../../../../src/lib/services/seating/engine.ts) `planManualTableClose`

`liveTableNums` を **`tables` コレクションではなく active プレイヤーの `tableNum` から導出**している
（既存 `planTableBreak` と同一モデルの踏襲）。このため「全員バストしたが未閉鎖の卓」は生存卓集合に
現れず、再配置先候補から除外される。

再現条件（`seatsPerTable=10` 例）: 卓1=10 名 / 卓2=0 名（live・未閉鎖） / 卓3=5 名。卓3 を閉じると
`survivingTables=[1]` で `capacity=10 < needed=15` → overflow 警告。実際には卓2 が空で 5 名を収容できるのに
「先に脱落者をバストさせてください」と誤案内する。`only-one-table` 判定でも同様に、空 live 卓が
カウントされず「最後の 1 卓」と誤判定し得る。

- `planTableBreak`（自動）はエンジン側が閉鎖卓を選ぶため空 live 卓を無視しても保守側に倒れるだけだが、
  手動閉鎖は運営者が target を指定するぶん、この差分がユーザー可視の誤メッセージとして表面化しやすい。
- 状態自体は一過性（auto-orchestration で空卓は consolidate されがち）で頻度は低いが、論理ギャップとしては実在。
- 対処案: orchestrator は既に `tables` を保持しているため、生存卓集合を `tables.filter(t => !t.isBroken)`
  由来で engine に渡す（空 live 卓も destination 候補に含める）と、capacity 計算と destination 探索の両方が
  実テーブル集合と一致する。`planTableBreak` 側も同根のため、共通化するなら両者まとめて検討。

### LOW

**L-1. overflow メッセージ文字列が dialog と orchestrator に重複（DRY）**
[CloseTableConfirmDialog.tsx:68-70](../../../../src/components/tournament/CloseTableConfirmDialog.tsx#L68-L70) /
[orchestrator.ts](../../../../src/lib/services/seating/orchestrator.ts) `applyManualTableClose`

「残卓に収まりません（最大 N 名/卓 × M 卓 = … 名、配置必要 … 名）」のテンプレートが 2 か所に同一実装で存在。
dialog 側が overflow 時に confirm を disable するため orchestrator の throw は防御的フォールバックで実害は薄いが、
将来の文言変更時の drift 源。`formatTableCloseOverflow(capacity, needed)` 等の helper に集約すると単一書換点になる。

**L-2. 存在しない卓番号を渡すと空卓 close 分岐で未存在 doc を `isBroken=true` 更新 → write_failed**
[engine.ts](../../../../src/lib/services/seating/engine.ts) `planManualTableClose` の not-found 判定

target が `liveTableNums` に無く、`brokenTableNums` にも無く、かつ他に生存卓があると「空卓の閉鎖（moves:[]）」
として `ok:true` を返す。これは「全員バストした実在卓を閉じる」正規ケースを満たすための分岐だが、
`tables` に**実在しない**卓番号でも同じ分岐に入り、orchestrator が `tx.update(tables/{n})` を未存在 doc に
発行して `firestore/write_failed` になる。UI は描画中の生存卓にしか「閉じる」を出さないため到達不能だが、
M-1 の対処（生存卓を `tables` 由来にする）を入れれば「実在しない卓 → not-found」も自然に区別できる。

**L-3. ボタンの aria-label がマシン識別子で可視テキスト「閉じる」を上書き（WCAG 2.5.3 Label in Name）**
[SeatingBoard.tsx:263](../../../../src/components/tournament/SeatingBoard.tsx#L263) /
[CloseTableConfirmDialog.tsx:100](../../../../src/components/tournament/CloseTableConfirmDialog.tsx#L100)

`aria-label="close-table-1"` / `"close-table-confirm"` が visible text「閉じる」を accessible name として
上書きするため、スクリーンリーダ / 音声操作で可視ラベルと不一致になる。ただし本コードベースは
`table-${n}` / `pd-${name}` / `cancel-${name}` 等のマシン形式 aria-label を test hook として広く採用しており、
**既存規約に整合**している。新規ぶんだけ厳密化するなら、test 選択子は `data-testid` に寄せ、aria-label は
`` `${label} を閉じる` `` のような日本語にすると Label in Name を満たす（任意・既存との一貫性とトレードオフ）。

## 良かった点

- `applyManualTableClose` が既存 `applyTableBreak` を再利用し、seat-taken / lastMovedAt race guard・PD reset・
  moves と `isBroken` の同一 tx commit をそのまま継承。新規 rule 不要（organizer の players/tables 更新は既存許可）。
- overflow / only-one-table を **tx 発行前に engine で弾いて throw**（rule deny でトーナメントを止めない）、
  not-found は `applied:false` で静かに返す、の 3 系統の出口設計が明確。
- 二重 warn 回避が徹底（orchestrator/`wrapFirestoreWrite` で warn 済み → hook は `unwrapOrFrom` + `formatErrorForDisplay`
  で表示のみ）。error-logging.md の規約に準拠。
- 定員一時引き上げ（最大 10）を `renderSeatCount = max(seatsPerTable, maxOccupiedSeat)` で UI 可視化し、
  seatNum ≤ MAX_SEATS_PER_TABLE が rule の seatNum≤10 と整合することをコメントで明示。
- E2E が「閉じる → ダイアログ → Firestore 再配置」の往復と overflow ブロック（mutation 不発）を観測点で固定。

## 対応状況（レビュー後の修正）

全 findings をレビュー直後に修正し、型 / lint / 全 unit（1545 件・M-1 検証 +1）/ build を再 green 化した。

| ID | 対応内容 |
| --- | --- |
| **M-1** | `planManualTableClose` の生存卓集合を **active 由来から `tables` 由来の `liveTableNums`（実在・未閉鎖）に変更**。空 live 卓も再配置先候補・capacity 計算に含まれるようになり偽 overflow / 偽 only-one-table を解消。orchestrator / dialog は `tables.filter(t => !t.isBroken)` を engine に渡す。検証: engine.test に「空 live 卓も再配置先になり偽 overflow を出さない」を追加 |
| **L-1** | overflow 文言を engine の `formatTableCloseOverflow(capacity, needed)` に集約。orchestrator の throw と dialog の確認文が同一定義を共有（drift 源を解消） |
| **L-2** | M-1 と同時解消。生存卓を `tables` 由来にしたため「実在しない卓番号 → not-found」が `liveSet.has()` 判定で自然に区別され、未存在 doc への `isBroken=true` 書込経路が消滅 |
| **L-3** | close ボタン / confirm ボタンを **`data-testid`（test hook）+ 日本語 `aria-label`（`` `${label} を閉じる` ``）** に変更。可視テキスト「閉じる」を含む accessible name となり WCAG 2.5.3 Label in Name を満たす。unit / component / E2E のセレクタを `getByTestId` に追従 |

> 注: 旧 2nd 引数 `brokenTableNums` → `liveTableNums` のシグネチャ変更は `planManualTableClose` のみ。
> `planTableBreak` / `diagnoseBalancingNeed` 等の他 engine 関数は既存契約のまま（本 finding の対象外）。

## 検証結果

| Check      | Result |
| ---------- | ------ |
| Type check | Pass（`tsc --noEmit`） |
| Lint       | Pass（`next lint` — 警告 0） |
| Tests      | Pass（vitest 98 files / 1545 tests。修正後も全 green。対象 5 files は 131 tests = M-1 検証 +1） |
| Build      | Pass（`next build`） |

> 注: Firestore rules / indexes の変更はないため `firebase deploy --only firestore:rules` は不要
> （手動閉鎖は既存 organizer の players/tables 更新経路を再利用）。

## レビュー対象ファイル

- Modified: `next.config.ts`（`allowedDevOrigins` 追加・dev 専用） / `src/app/tournaments/[tid]/dashboard-client.tsx` /
  `src/components/tournament/SeatingBoard.tsx` / `src/lib/services/seating/engine.ts` /
  `src/lib/services/seating/orchestrator.ts` / `engine.test.ts` / `orchestrator.test.ts` /
  `.claude/rules/error-logging.md`（seating エラーコード追記） / PRD 進捗表
- Added: `src/lib/hooks/useTableClose.ts`(+test) / `src/components/tournament/CloseTableConfirmDialog.tsx`(+test) /
  `src/components/tournament/SeatingBoard.test.tsx` / `tests/e2e/manual-table-close.spec.ts` /
  Phase 3 plan・report（completed/）
