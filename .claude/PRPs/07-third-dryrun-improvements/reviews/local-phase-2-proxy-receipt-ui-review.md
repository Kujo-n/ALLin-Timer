# ローカルレビュー: Phase 2 受付代理 UI（07-third-dryrun-improvements）

**レビュー日**: 2026-06-06
**対象**: ワークツリーの未コミット変更（受付代理ダイアログ + 表示名編集 UI）
**ブランチ**: feat/phase-1-proxy-receipt-data-layer
**判定**: APPROVE（コメント付き）

## サマリ

Phase 1（データ層）の上に、運営者が参加者を代理受付する UI（`AddParticipantDialog`）と、名前のみ player の表示名編集（`PlayerList` 内ダイアログ + service/repository）を追加する変更。CRITICAL / HIGH の指摘はなく、型・lint・全 1512 unit test・build はすべて green。`AddParticipantDialog` のフォーム初期化 effect が realtime 更新でリセットされる MEDIUM のロジック欠陥が 1 件、ほか軽微な指摘あり。

## 指摘

### CRITICAL

なし

### HIGH

なし

### MEDIUM（いずれもレビュー後に修正済み）

> 2026-06-06 追記: 下記 2 件は本レビュー後に修正し、回帰テストを追加した（`AddParticipantDialog.test.tsx` に realtime 再 render テスト / uid 丸めテストを追加）。型・lint・全 unit test・build 再確認済み。

- **【修正済み】`AddParticipantDialog` の初期化 effect が realtime 更新のたびに発火しフォーム入力を破棄する**
  [AddParticipantDialog.tsx:64-77](src/components/tournament/AddParticipantDialog.tsx#L64-L77)
  - `existingPlayerUids` は親 `PlayerList` の render で `players.filter().map()` により**毎回新しい配列参照**として渡される（[PlayerList.tsx:269-271](src/components/tournament/PlayerList.tsx#L269-L271)）。
  - そのため `candidates` の `useMemo`（deps に `existingPlayerUids`）は親 render ごとに再計算され**新しい参照**になり、`useEffect(..., [open, candidates])` がダイアログを開いている間も親 render ごとに発火する。
  - dashboard は players / tables / tournament の snapshot 更新で再 render するため、**受付中に別端末から参加者が登録される**と effect が走り、`setTab("member")` / `setDisplayName("")` で「ゲストで追加」タブの入力中テキストとタブ選択が破棄される。受付代理ダイアログは「受付中＝他端末が同時に join しうる」状況で使う機能のため、実運用で再現しやすい。
  - 入力（ローカル state 更新）単体では親が再 render しないため effect は発火しない（＝同時更新がないと顕在化しない）ので MEDIUM に留めるが、対象ワークフロー上は早期に修正することを推奨。
  - **修正案**: リセット effect の依存を `[open]` のみにし（ダイアログを開いた立ち上がり時のみ初期化）、select の選択値は render 時に candidates から導出して有効性を保つ。
    ```ts
    useEffect(() => {
      if (!open) return;
      setTab("member");
      setDisplayName("");
      setError(null);
    }, [open]);
    // value は candidates から都度導出（candidates 縮小時も有効値を維持）
    const selected = candidates.includes(selectedUid) ? selectedUid : candidates[0] ?? "";
    ```
    あるいは親 `PlayerList` 側で `existingPlayerUids` を `useMemo` して参照を安定化する。
  - **対応**: リセット effect の deps を `[open]` のみに変更し、select の選択値は `selected = candidates.includes(selectedUid) ? selectedUid : candidates[0] ?? ""` として render 時に candidates から導出する形に修正。

- **【修正済み】memberDisplayName 未設定メンバーをメンバータブから追加できない（紛らわしいエラー）**
  [AddParticipantDialog.tsx:79-81, 97](src/components/tournament/AddParticipantDialog.tsx#L79-L81)
  - `memberDisplayName(uid)` は `group.memberDisplayNames[uid] ?? uid` で、未設定時に **28 文字の Firebase uid** にフォールバックする。
  - これを `addMemberPlayerByOrganizer(... displayName: <uid> ...)` に渡すと service の `parseDisplayName(maxLength: 15)` が `validation/display-name-too-long` を throw する（[proxy-receipt.ts:55](src/lib/services/proxy-receipt.ts#L55)）。
  - 通常は招待コード加入時に `memberDisplayNames` が必ず書かれるため稀だが、旧データ等で欠落していると当該メンバーをメンバータブから追加できず、エラー文言からも原因が分かりにくい。
  - **対応**: `memberDisplayName` の uid フォールバックを `uid.slice(0, DISPLAY_NAME_MAX_LENGTH)` に変更し、欠落データでも service の too-long throw で追加不能にならないようにした（正常データ＝招待コード加入時に ≤15 文字の memberDisplayName が書かれるケースには影響なし）。

### LOW（いずれもレビュー後に修正済み）

> 2026-06-06 追記: 下記 2 件も修正し、回帰テストを追加した（service の uid=null ガード 2 ケース / a11y aria-label 更新）。

- **【修正済み】`updatePlayerDisplayName` の用途コメントと実装が不一致**
  [players.ts:163-184](src/lib/firebase/repositories/players.ts#L163-L184) / [proxy-receipt.ts:112-132](src/lib/services/proxy-receipt.ts#L112-L132)
  - コメントは「名前のみ（uid=null・合成 pid）player の入力ミス救済」と限定しているが、service / repository とも対象 player の `uid===null` を強制していなかった。
  - **対応**: `updatePlayerDisplayNameByOrganizer` に `getPlayer(tid, pid)` を追加し、`!player || player.uid !== null` のとき `validation/not-named-only-player` を throw するガードを追加。メンバー（uid 紐づけ）player の displayName は本人の self-update が所有者であり、運営者がこの経路で上書きするのは UI 上も非対応のため service でも防ぐ。member 紐づけ player / 不在 player の reject テストを追加。repository 側コメントも「uid=null 検証は service の責務」と明確化。

- **【修正済み】タブ UI の a11y 補強余地**
  [AddParticipantDialog.tsx](src/components/tournament/AddParticipantDialog.tsx) / [PlayerList.tsx](src/components/tournament/PlayerList.tsx)
  - **対応**: `GroupDetailTabs` の確立パターンに合わせ、各タブに `id` + `aria-controls` を付け、各パネルを `role="tabpanel"` + `aria-labelledby` + `hidden` で常時 render する形に変更（`aria-label="受付方法"` も付与）。表示名 input の `required` は `tab==="name"` のときのみ付与し、hidden パネルでの制約検証を回避。`PlayerList` の edit ボタン aria-label を `edit-${name}` → `${name} の表示名を編集` に変更（テストも追従）。

## 検証結果

| チェック   | 結果   |
| ---------- | ------ |
| Type check | Pass   |
| Lint       | Pass（No ESLint warnings or errors） |
| Tests      | Pass（95 files / 1516 tests。受付代理 UI 関連 52 件含む。MEDIUM/LOW 修正後に再確認） |
| Build      | Pass   |

## レビュー対象ファイル

- `src/components/tournament/AddParticipantDialog.tsx`（新規）
- `src/components/tournament/AddParticipantDialog.test.tsx`（新規）
- `src/components/tournament/PlayerList.tsx`（変更: 追加ボタン / 管理専用バッジ / 表示名編集ダイアログ）
- `src/components/tournament/PlayerList.test.tsx`（新規）
- `src/app/tournaments/[tid]/dashboard-client.tsx`（変更: PlayerList へ group / organizerUid / canAddParticipant を配線）
- `src/lib/services/proxy-receipt.ts`（変更: `updatePlayerDisplayNameByOrganizer` 追加）
- `src/lib/services/proxy-receipt.test.ts`（変更: update 系テスト追加）
- `src/lib/firebase/repositories/players.ts`（変更: `updatePlayerDisplayName` 追加）
- `src/lib/firebase/repositories/players.test.ts`（変更: update 系テスト追加）
- `.claude/PRPs/07-third-dryrun-improvements/prds/...prd.md` / `plans/completed/...` / `reports/...`（ドキュメント）

## 補足（良い点）

- service 層が `getTournament → getGroup → assertOrganizer` で role を tournament の groupId 経由で再評価し、UI から渡された値を信頼しない設計が一貫している。
- 表示名検証 / 受付可能 state 判定を共有 `entry-guards.ts` 経由にしており、通常受付との semantics drift を防いでいる。表示名編集が `assertAcceptingEntries` を**呼ばない**判断（finished 後の名前訂正を許す）もコメントで明示されテストで固定されている。
- dashboard 全体が `isOrganizer` で early-return ガードされているため、`canManage={isMember}` 経由でも「参加者を追加」ボタンは実質 organizer 限定。plain member に空振りボタンを見せる UX 問題はない。
- 新規機能と test が同一変更セットに含まれ、mock は service 境界で割られておりテスト規約に沿う。
