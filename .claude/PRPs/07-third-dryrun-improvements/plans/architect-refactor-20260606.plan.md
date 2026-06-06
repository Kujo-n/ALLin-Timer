# Architect Refactor Plan — 20260606

## 所属

- PRD: `07-third-dryrun-improvements`（受付代理 Phase 1〜2 安定後のリファクタ）
- 監査結果: [.claude/PRPs/07-third-dryrun-improvements/reviews/architect-refactor-20260606.md](../reviews/architect-refactor-20260606.md)
- 作業ブランチ: `feat/phase-1-proxy-receipt-data-layer`（現ブランチ上で続行）
- スコープ: 受付代理＋直近変更領域中心

## 不変条件

1. 全テスト（typecheck / lint / unit / build / **E2E**）を本サイクル完了時点で green に戻す
2. 観測可能な動作変更は **0**（純粋な内部リファクタ・コメント修正のみ）
3. プロジェクト規約（`.claude/rules/*`）優先
4. 1 commit = 1 atomic タスク（revert 1 つで安全に戻せる粒度）

## 対象 finding（ユーザー選択済み）

finding-1 / finding-2 / finding-3 / finding-4。finding-5（rule ブランチ重複）は defer。

## 安全網（既存テスト・新規 characterization 不要）

| finding | 安全網 |
| --- | --- |
| finding-1 | `players.test.ts`（upsertPlayer / createNamedOnlyPlayer / clonePlayersFromTournament の create 形を `setDoc` 引数で assert） |
| finding-2 | `proxy-receipt.test.ts`（getTournament→getGroup mock + 非 organizer / 非 member / finished / late-entry の throw を assert） |
| finding-3 | `PlayerList.test.tsx`（編集導線 aria-label / `表示名` input / submit → service 呼出 / role=alert）＋ `proxy-receipt.spec.ts` E2E |
| finding-4 | コメントのみ（typecheck / lint で回帰検出） |

いずれも既存テストが観測点を固定済み。新規 characterization test は不要。

---

## タスク（依存方向 上流→下流：repository → service → component → comment）

### T1 — finding-1: players.ts に `newPlayerBody` factory を集約

**対象**: `src/lib/firebase/repositories/players.ts`

**変更内容**:
- pure helper を追加（module-private）:
  ```ts
  function newPlayerBody({ displayName, uid }: { displayName: string; uid: string | null }) {
    return {
      displayName,
      uid,
      entryAt: serverTimestamp(),
      isBusted: false,
      bustedAt: null,
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
      isPlayingDealer: false,
    };
  }
  ```
- 3 経路の create literal を置換:
  - `upsertPlayer` の **create 分岐のみ**（merge 分岐 `{ displayName }, { merge: true }` は据え置き）→ `newPlayerBody({ displayName: input.displayName, uid })`
  - `createNamedOnlyPlayer` → `newPlayerBody({ displayName, uid: null })`
  - `clonePlayersFromTournament` の `batch.set` → `newPlayerBody({ displayName: body.displayName, uid: body.uid })`

**観測同値の根拠**: 書き込む 9 フィールドの値が完全一致。`serverTimestamp()` は各書込で 1 回呼ばれる点も不変。merge 分岐は触らないため `players.test.ts:224`（merge は tableNum を含まない）も維持。

**commit**: `refactor(players): 新規 player doc 生成を newPlayerBody factory に集約`

---

### T2 — finding-2: proxy-receipt.ts に `resolveOrganizerContext` を集約

**対象**: `src/lib/services/proxy-receipt.ts`

**変更内容**:
- type import 追加: `TournamentDoc`（`@/lib/firebase/schemas/tournament`）/ `GroupDoc`（`@/lib/firebase/schemas/group`）
- helper を追加（module-private、ゼロトラスト不変条件の単一真実源）:
  ```ts
  async function resolveOrganizerContext(
    tid: string,
    organizerUid: string,
  ): Promise<{ tournament: TournamentDoc; group: GroupDoc }> {
    const tournament = await getTournament(tid);
    const group = await getGroup(tournament.groupId);
    assertOrganizer(group, organizerUid);
    return { tournament, group };
  }
  ```
- 3 経路の `getTournament → getGroup → assertOrganizer` preamble を置換:
  - `addMemberPlayerByOrganizer`: `const { tournament: t, group } = await resolveOrganizerContext(tid, organizerUid);` → 以降 `group.memberUids` / `assertAcceptingEntries(t)` / `t.groupId` をそのまま使用
  - `addNamedOnlyPlayerByOrganizer`: `const { tournament: t } = await resolveOrganizerContext(...)` → `assertAcceptingEntries(t)` / `t.groupId`
  - `updatePlayerDisplayNameByOrganizer`: `const { tournament: t } = await resolveOrganizerContext(...)` → `t.groupId`（`assertAcceptingEntries` は呼ばない差異を維持）
- `assertNonEmptyString` / `parseDisplayName` の入力検証は helper の **前** に残す（既存順序維持）

**観測同値の根拠**: read 順序（getTournament → getGroup）と assertOrganizer 呼出が保たれる。`proxy-receipt.test.ts` は mock 呼出順と throw code を assert しており、helper 経由でも同一。read 回数も不変。

**commit**: `refactor(proxy-receipt): organizer 再認可を resolveOrganizerContext に集約`

---

### T3 — finding-3: PlayerList から `EditPlayerNameDialog` を抽出

**対象**:
- 新規: `src/components/tournament/EditPlayerNameDialog.tsx`
- 編集: `src/components/tournament/PlayerList.tsx`

**変更内容**:
- `EditPlayerNameDialog.tsx`（domain co-location。page 跨ぎではなく tournament domain 共通の置き場）:
  - Props: `{ open: boolean; onOpenChange: (open: boolean) => void; tid: string; organizerUid: string; target: PlayerDoc | null }`
  - 内部 state: `editName` / `editError` / `editSaving`（PlayerList から移管）
  - `target` が変わった/open した時に `editName = target.displayName` / `editError = null` で初期化
  - submit → `updatePlayerDisplayNameByOrganizer({ tid, organizerUid, pid: target.id, displayName: editName })`、成功で `onOpenChange(false)`、失敗で `unwrapOrFrom` → `formatErrorForDisplay` を role=alert 表示・ダイアログ維持
  - DOM 面を完全保持: `表示名` ラベル input（`aria-label="表示名"` / `required` / `maxLength={DISPLAY_NAME_MAX_LENGTH}`）/ role=alert / 「保存」「保存中…」ボタン
- `PlayerList.tsx`:
  - 削除: `editName` / `editError` / `editSaving` state、`onConfirmEdit` / `openEdit`、編集ダイアログ JSX、`updatePlayerDisplayNameByOrganizer` import、（編集ダイアログ専用の）`Input` / `Label` import
  - 維持: `editTarget: PlayerDoc | null` state、Pencil ボタン（aria-label `${p.displayName} の表示名を編集` で `setEditTarget(p)`）
  - 末尾に `<EditPlayerNameDialog open={editTarget !== null} onOpenChange={(o)=>{ if(!o) setEditTarget(null); }} tid={tid} organizerUid={organizerUid!} target={editTarget} />` を配置（`organizerUid` は Pencil ボタン表示条件 `canManage && p.uid === null && organizerUid` で担保済み）

**観測同値の根拠**: PlayerList.test.tsx は `<PlayerList>` を render し、Pencil クリック → `表示名` input → submit → mock 呼出 / role=alert を検証。編集ダイアログが子 component でも同 DOM・同 service 呼出なら全テスト無改変で pass（`vi.mock("@/lib/services/proxy-receipt")` は module 単位のため抽出先 import も mock される）。

**リスク**: props 結線ミスで編集導線が動かない → PlayerList.test.tsx 5 件 + E2E で検出。

**commit**: `refactor(player-list): 表示名編集ダイアログを EditPlayerNameDialog に抽出`

---

### T4 — finding-4: tournament-state.ts の stale コメント修正

**対象**: `src/lib/services/tournament-state.ts:205`

**変更内容**:
- `late entry deadline 超過の扱いは service 側（proxy-receipt の \`assertAcceptingProxyEntry\`）。`
  → `late entry deadline 超過の扱いは service 側（entry-guards の \`assertAcceptingEntries\`）。`

**観測同値の根拠**: コメントのみ。

**commit**: `docs(tournament-state): 存在しない関数参照を assertAcceptingEntries に修正`

---

## Phase 4 検証ループ（各タスク）

```
1. 変更を実装
2. npm run typecheck
3. npm run lint
4. npm test
5. npm run build（dev server 停止確認後）
6. green なら git add -p で意図ファイルのみ stage → 日本語 commit
7. red なら revert 検討 → 原因分析 → 再分割 or 計画除外
```

- T1 / T2 / T4 は unit + typecheck + lint + build で代替（E2E 不要）
- T3 は component 抽出のため、Phase 5 で E2E（proxy-receipt.spec.ts）を必ず走らせる

## Phase 5 最終検証順序（ローカル E2E/build 競合回避）

1. `npm run typecheck` / `npm run lint` / `npm test`
2. dev server / emulator 停止確認 → `npm run build`
3. `npm run test:e2e -- proxy-receipt.spec.ts clone-tournament-with-players.spec.ts playing-dealer.spec.ts`（scope 関連 spec を最終確認）

## 期待される成果

- finding-1: players.ts の create literal 3 重複 → 1 factory（drift WARNING の単一真実源化）
- finding-2: proxy-receipt.ts の organizer 再認可 3 重複 → 1 helper（セキュリティ不変条件の単一真実源化）
- finding-3: PlayerList -約40 行 / -3 useState、編集ダイアログを domain component 化
- finding-4: コメント正確化
- 観測可能な動作変更: 0 / 全テスト green 維持
