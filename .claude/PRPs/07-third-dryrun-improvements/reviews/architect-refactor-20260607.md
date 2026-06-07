# Architect Refactor 監査 — 20260607

## 所属

- PRD: `07-third-dryrun-improvements`（Phase 3 手動卓閉鎖・Phase 4 卓追加／再開 の安定後リファクタ）
- 作業ブランチ: `feature/phase3-4`（現ブランチ上で続行）
- スコープ: **Phase 3〜4 中心 ＋ ブランチ全体軽 scan**。受付代理 Phase 1〜2 は
  [architect-refactor-20260606](architect-refactor-20260606.md) で finding 1〜4 対応済みのため回帰確認のみ

## レンズ

- Lens A: Senior Web Architect（SoC / DRY / KISS / YAGNI / a11y / perf / testability）
- Lens B: Security Specialist（zero-trust / least-privilege / defense-in-depth / OWASP）

## Baseline（Phase 1 確認済み）

| チェック | 結果 |
| --- | --- |
| typecheck | ✓ green |
| lint | ✓ No ESLint warnings or errors |
| unit (vitest) | ✓ 100 files / 1569 tests |
| build | ✓ 成功 |
| E2E（影響 spec: manual-table-close / table-add-reopen / playing-dealer / proxy-receipt） | ✓ 10 passed |

## 監査対象ファイル（`main..HEAD` の Phase 3〜4 src 変更 + 直接依存）

- `src/lib/services/seating/engine.ts`（`planManualTableClose` / `planAddTable` / `formatTableCloseOverflow` 追加）
- `src/lib/services/seating/orchestrator.ts`（`applyManualTableClose` 追加。既存 private `applyTableBreak` を再利用）
- `src/lib/firebase/repositories/tables.ts`（`reopenTable` / `upsertTable` 追加）
- `src/lib/hooks/useTableClose.ts`（新規。`useManualSeatChange` 規範）
- `src/lib/hooks/useTableLifecycle.ts`（新規。`useTableClose` 規範）
- `src/components/tournament/CloseTableConfirmDialog.tsx`（新規）
- `src/components/tournament/UnseatedPlayersGuide.tsx`（新規）
- `src/components/tournament/SeatingBoard.tsx`（close / reopen ボタン追加）
- `src/app/tournaments/[tid]/dashboard-client.tsx`（卓閉鎖／追加／再開 UI 配線）

---

## 総評

Phase 3〜4 のコードは `refactor-conventions.md` の集約先（engine 純関数 / hook 抽出 /
`_components` co-location）と `.claude/rules/*`（error wrap helper / 二重 warn 回避 /
rule deny-by-default / 数値リミット単一真実源）に**最初から沿って実装**されており、
構造的負債は少ない。`critical` / `high` はなし（卓管理は organizer gate の早期 return ＋
Firestore rules ＋ engine の容量検証で多層防御済み）。残る所見は medium 1 件・low 4 件で、
うち DRY 系 2 件が「将来 drift する」リスクを持つため本サイクルで対応推奨。

---

## 所見リスト

### finding-1: engine の greedy 詰め込みロジックが planTableBreak / planManualTableClose で重複
- Lens: architect（DRY / drift 予防）
- Severity: medium
- 場所: `src/lib/services/seating/engine.ts:349-378`（planTableBreak）/ `:433-476`（planManualTableClose）
- 観察事実: 両関数は「閉鎖卓 player を seatNum 昇順で取り出し、生存卓の占有最少（同数なら
  tableNum 昇順）へ・各卓は seat 1 から最初の空席へ詰める」greedy アルゴリズムを逐語複製
  している。差分は **収容定員のみ**（planTableBreak=`seatsPerTable` / planManualTableClose=
  `maxSeatsPerTable`）。`occupiedBySurvivor` の構築（生存卓ごとの占有 seat 集合）と move 生成
  ループが約 25 行ずつ重なる。
- 影響: TDA 詰め込み規則（tie-break・空席探索順）が 2 箇所に散る。将来「同数のとき tableNum
  降順で詰める」等のルール変更が入ると、自動バランシング閉鎖（planTableBreak）と手動閉鎖
  （planManualTableClose）で**非対称な席割り**が静かに発生する。両者は同じ詰め込み規則である
  ことが仕様上の要請（手動閉鎖 doc comment が「planTableBreak と同じ詰め込みを踏襲し定員のみ
  差し替え」と明記）であり、コードでも単一真実源にすべき。
- 案: engine.ts に internal pure helper
  `packIntoSurvivingTables(active, brokenTableNum, survivingTables, capacity): BalancingMove[] | null`
  を追加し、両関数の詰め込み部を委譲。`from.tableNum` は両者とも brokenTableNum 固定で等価。
  planTableBreak の「どの卓を閉じるか」決定（最少人数・tie-break tableNum 最大）と
  planManualTableClose の target 指定／overflow 判定は helper の**外**に残すため、各関数固有の
  契約は不変。
- テスト保護: `engine.test.ts` の `describe("planTableBreak")`（5 ケース）/
  `describe("planManualTableClose")`（8 ケース）が両 API の入出力を characterization。helper は
  internal のため公開 API 経由で透過検証。抽出後も同 assert が green なら観測同値。
- リスク: 観測可能な動作変更なし（内部抽出）。`from.tableNum` を `brokenTableNum` param 由来に
  揃えるが、brokenPlayers は当該卓 filter 済みのため値は同一。

### finding-2: `liveTableNums(tables)` 導出が 3 箇所に重複（preview/commit drift 予防）
- Lens: both（architect DRY ＋ 整合性）
- Severity: low
- 場所: `src/lib/services/seating/orchestrator.ts:415` / `src/components/tournament/CloseTableConfirmDialog.tsx:57` /
  `src/components/tournament/SeatingBoard.tsx:141`
- 観察事実: `tables.filter((t) => !t.isBroken)` から生存卓を導く式が 3 箇所に散る
  （orchestrator と dialog は `.map((t) => t.tableNum)`、SeatingBoard は `.length`）。
- 影響: **CloseTableConfirmDialog の overflow preview と orchestrator の commit は、同じ
  `liveTableNums` 導出を `planManualTableClose` に渡すことで「プレビュー表示と実際の閉鎖可否が
  一致する」ことを暗黙の不変条件としている**。導出が別々だと、片方だけ条件（例: 空卓の扱い）を
  変えたときに「プレビューは成立なのに commit で overflow」等の不整合が静かに入る。
- 案: engine.ts に pure selector `liveTableNums(tables: TableDoc[]): number[]` を export し、
  orchestrator / dialog の `.map` 2 箇所をこれに統一。SeatingBoard の count も
  `liveTableNums(tables).length` に寄せて 3 箇所を単一真実源化。engine は seating ドメインの
  純関数ハブで、両 consumer は既に engine から import 済み（新規 import 追加は SeatingBoard のみ）。
- テスト保護: `engine.test.ts` に selector の 1〜2 assert を追加（broken 混在で未閉鎖のみ返す）。
  consumer 側は既存 unit（`CloseTableConfirmDialog.test.tsx` / `SeatingBoard.test.tsx`）＋ E2E
  （manual-table-close）で観測同値を担保。
- リスク: 観測可能な動作変更なし。selector は既存式と同義。

### finding-3: SeatingBoard `canCloseTable` prop が close + reopen 両用に意味拡張され名称が陳腐化
- Lens: architect（naming / readability）
- Severity: low
- 場所: `src/components/tournament/SeatingBoard.tsx:73`（prop 定義）/ `:269` `:285`（close / reopen 両分岐で参照）/
  `src/app/tournaments/[tid]/dashboard-client.tsx:565`
- 観察事実: Phase 4 で `canCloseTable` が「卓管理（close / reopen）権限の共通軸」へ実質拡張された
  が（doc comment が明記）、prop 名は「閉じる」だけを示すまま。author は「churn 最小化で据え置き」と
  意図的に判断している。
- 影響: 名称と実体の乖離。reopen ボタンが `canCloseTable` で出る理由を読み手が追う必要がある。
  動作影響なし。
- 案: `canCloseTable` → `canManageTable` にリネーム（SeatingBoard.tsx ＋ dashboard-client.tsx ＋
  `SeatingBoard.test.tsx` の 3 点）。architect-refactor は「厳密なルールで命名を揃える」局面のため
  対応候補だが、author の deliberate 判断を覆すため**ユーザー承認時に採否を確認**する。
- テスト保護: `SeatingBoard.test.tsx`（close / reopen ボタンの存在・aria-label）。リネームは
  prop key 変更のみで render 不変。
- リスク: prop 結線の付け替え漏れ → unit + E2E で担保。観測可能な動作変更 0。

### finding-4: SeatingBoard.tsx 629 行（TableCard 抽出余地）— defer 推奨
- Lens: architect（ファイル分割閾値）
- Severity: low
- 場所: `src/components/tournament/SeatingBoard.tsx`（全体 629 行 / 卓カード render が `:207-324` の
  インライン `.map`）
- 観察事実: `refactor-conventions.md` の 300 行閾値を超過。ただし大半は **Phase 5.x の
  D&D / PD / cascade ロジック（SeatRow / DnDSeat / PlainSeat / PdCheckbox）で pre-existing**。
  Phase 3〜4 の追加はカードヘッダの close / reopen ボタン約 30 行のみ。
- 影響: 単体では肥大だが、Phase 3〜4 由来の増分は小さい。
- 案: 卓カードを `_seating-board/TableCard.tsx` へ co-location 抽出する余地はあるが、D&D の
  draggable/droppable 状態（`activeDragId` / `draggedPlayer`）と密結合で、**抽出は pre-existing の
  intricate なロジックに踏み込むため本サイクルでは defer**。次に SeatingBoard を大きく触る Phase に
  合わせて再評価する。useState 数は閾値（5）未満で緊急性は低い。
- テスト保護: `SeatingBoard.test.tsx`（239 行）。
- リスク: D&D 抽出は drag listener / hooks rules（空席でも useDraggable 呼出）の取り回しが繊細で、
  本サイクルのスコープ・リスク対効果に見合わない。

### finding-5: dashboard `isMember` が organizer 限定操作の gate に流用されている — defer（pre-existing）
- Lens: both（security readability）
- Severity: low
- 場所: `src/app/tournaments/[tid]/dashboard-client.tsx:324`（`isMember = groupIds.includes(...)`）/
  `:553` `:565` `:588`（`canManage` / `canCloseTable` / PlayerList に流用）
- 観察事実: 卓閉鎖／追加／再開・PD・D&D は権限マトリクス上 organizer 以上限定。dashboard は
  `:319-322` で `isOrganizer` 早期 return guard を通すため、`isMember` に到達する時点で
  organizer 確定（コメントも `isOrganizer (= isMember)` と明記）。**動作は正しい**が、
  organizer 限定操作を `isMember` 名の変数で gate するのは読み手に誤解を与える。
- 影響: セキュリティ上の実害なし（早期 return ＋ rule の二重防御）。命名の readability のみ。
- 案: `isMember` の用途を分け、organizer 限定 gate には `isOrganizer` を直接渡す等の整理余地は
  あるが、**Phase 3〜4 で新規導入されたものではなく pre-existing**（既存の PD / D&D gate を
  そのまま流用）。本サイクルのタイトスコープ外として記録に留め、次に dashboard の権限導出を
  触る機会にまとめて整理する。
- テスト保護: dashboard-polish / playing-dealer / table-add-reopen 等の E2E。
- リスク: 流用箇所が多く（4 箇所 + 既存 PD/D&D 経路）、本サイクルで触ると Phase 3〜4 と無関係な
  回帰面が広がる。

---

## Severity サマリ

| finding | Lens | Severity | 本サイクル対応 |
| --- | --- | --- | --- |
| finding-1: engine 詰め込みロジック重複 | architect | medium | 対応推奨 |
| finding-2: liveTableNums 導出 3 重複 | both | low | 対応推奨（preview/commit drift 予防） |
| finding-3: canCloseTable 名称陳腐化 | architect | low | 任意（author の deliberate 判断のため要確認） |
| finding-4: SeatingBoard 肥大 | architect | low | defer（pre-existing・リスク対効果） |
| finding-5: isMember 流用 | both | low | defer（pre-existing・スコープ外） |

`critical` / `high` はなし。
