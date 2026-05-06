# Plan: Phase 5.4 — 同メンバーで次のトーナメントを Clone（Clone Tournament With Players）

## Summary

終了済みトーナメントの dashboard から「同じ参加者で次のトーナメントを開始」を 1 操作で実行できるようにする。
専用ページ `/tournaments/[tid]/clone` を新設し、`TournamentForm` を再利用してストラクチャ・名前・席数を
編集可能にする（**コピー元のストラクチャを初期選択**、サークルの `structures/{sid}` ライブラリから別ストラクチャに
swap 可能）。`players[]` のうち運営者がチェックボックスで選択した人だけを `setup` 状態の新 tournament の
`players` サブコレクションへ `writeBatch` でコピーする。

利用施設の利用時間制限で 2 回目を短縮ストラクチャに切り替えたい運用ニーズに応えるため、ストラクチャの再選択は
必須。`TournamentForm` は既に `initialSnapshot` prop と `Select` ベースの structures 一覧ピッカーを持つため、
これをそのまま流用する。

実装の核となる制約は **Firestore Rules の `players/{pid}` create 条件**で、現状は `pid == auth.uid` で
self-create のみを許可している。これを additive ブランチで `setup` 中の組織者代理 create に拡張し、
`pid == uid` invariant・`isBusted=false`・`tableNum/seatNum=null`・`isPlayingDealer=false` の安全 invariant は
既存 self ブランチと同じく保つ。

schema 変更なし、Cloud Functions 不使用。新規 service `cloneTournamentWithPlayers` で
`createTournament` → `clonePlayersFromTournament` を順次呼び、最後に `/tournaments/{newTid}` へ遷移する。

## User Story

As a サークル運営者（owner / organizer）,
I want 終了したトーナメントの結果画面から「同じ参加者でもう 1 試合」を 1 操作で開始でき、
帰宅した人だけチェックを外しつつ、必要なら**ストラクチャだけ短縮版に差し替えて**新 tournament を作れる
（前回ストラクチャは初期選択済みで、変更不要なら触らずそのまま使える）,
So that 利用施設の時間制限で 2 回目は短いストラクチャに切り替えたいケースにも対応でき、かつ
サークルでの連戦の度に「受付 QR を開き直す → 各自再 join」を強制せず、運営者の摩擦を消した上で
参加者にも「QR をもう一度読む」手間を負わせない。

And as a サークル一般メンバー / 参加者,
I want クローン操作は organizer 専用で、誤って自分以外の権限で実行されない,
So that `/live` から見ているメンバーには結果画面に余計なボタンが現れず、UI が単純なまま保たれる。

## Problem → Solution

**Current state**:

- 終了直後に「もう 1 戦やろう」となった場合、運営者は (1) `/tournaments/new` で新規作成 →
  (2) ストラクチャを選び直し → (3) 受付 QR を再共有 → (4) 各参加者にスマホで `/join/{newTid}` を
  個別に踏ませる、という連続操作が必要。20 人サークルで 5 分以上かかる。
- 旧 tournament の `players[]` を流用する経路は皆無（Firestore Rules の
  `tournaments/{tid}/players/{pid}` `create` は `pid == request.auth.uid` の自己作成のみ）。
- [`createTournament`](../../src/lib/firebase/repositories/tournaments.ts#L48-L75) は
  返り値で新 tid を返す既存設計のため、orchestrator 側で続けて player を書く経路を作るのは容易。
- `state === "finished"` の dashboard では現状 [WinnerBanner](../../src/components/tournament/WinnerBanner.tsx)
  と「削除」ボタンしかなく、次アクションのフックが無い。

**Desired state**:

- `state === "finished"` かつ運営者ロール時、dashboard（WinnerBanner 直下を想定）に
  **「同じ参加者で次のトーナメントを作成」** リンクボタンを表示。
- クリック → `/tournaments/[srcTid]/clone` ページに遷移。`/tournaments/new` と
  `/tournaments/[tid]/edit` と同じ全画面フォーム形式で、`TournamentForm` を再利用:
  - 既定名: `[サークル名]トーナメント-{finishedCount + 1}`（`/tournaments/new` と同じ規則）
  - **`initialSnapshot` = src tournament の `structureSnapshot`** を渡し、フォーム下の preview に
    そのまま反映。Select ピッカーには group の `structures/{sid}` 一覧が並び、別ストラクチャに
    swap 可能（短縮ストラクチャを採用するケースを想定）。何も触らなければコピー元の snapshot のまま
  - `initialSeatsPerTable` も src tournament から継承（編集可）
- フォームの上または下に **`ClonePlayersChecklist`** を配置:
  - src tournament の `players[]` を表示（**全員初期 ON**、ただし `isBusted` の人は **初期 OFF**）
- 「作成」（`TournamentForm` の submit ボタン） → orchestrator `cloneTournamentWithPlayers`:
  1. `createTournament(input)` で新 tid を取る
  2. `clonePlayersFromTournament(srcTid, newTid, selectedUids)` を `writeBatch` で 1 回 commit
  3. 完了したら `router.push(/tournaments/{newTid})` で新 dashboard へ遷移
- 新 tournament は `state === "setup"` で着地。運営者は通常通り「席を決定」 → 開始の流れに進む。
  すでに `players` が登録済みなので追加の受付配信は不要（QR は希望者の追加 join 用に従来通り表示される）。
- `/live`（参加者ビュー）は非表示。Phase 5.3 完了時点と完全一致（regression 0）。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md) — Implementation Phases 表に
  Phase 5.4 行を新設（本 plan の生成と同時に `pending` で投入）
- **Source proposal**: [tmp/14_運営者向け追加機能提案.md](../../../tmp/14_運営者向け追加機能提案.md) #10
  「同メンバーでもう 1 試合」即時 clone（**優先度高**）
- **Stage scope**: Firestore Rules に players create の organizer-clone ブランチを 1 つ additive 追加 /
  repository 1 関数追加（players bulk create）/ orchestrator 1 関数追加（create + clone）/
  `tournament-state` に `canClone` 純関数を 1 つ追加 / `limits.ts` に `MAX_CLONE_PLAYERS` 定数 1 つ追加 /
  新規ページ `/tournaments/[tid]/clone` (page.tsx + clone-client.tsx) + 新規コンポーネント
  `ClonePlayersChecklist` + dashboard 配線（リンクボタン）/ emulator validation script 1 本 / tests
- **Estimated Files**: 約 13 files（rules 1 / repository 1 / orchestrator 1 / tournament-state 1 / limits 1 /
  page 1 + clone-client 1 / Checklist 1 + dashboard 1 / emulator script 1 / tests 4 + plan 1）

---

## UX Design

### Before（運営者 dashboard・state === "finished"）

```
┌── ALLin-PokerTimer  [サークル名]トーナメント-3 ─── (削除) ──┐
│                                                              │
│  🏆 winner-display-name                                      │
│                                                              │
│  Table List (全卓 0 人)                                       │
│  StructureSnapshot ...                                        │
└──────────────────────────────────────────────────────────────┘

「もう 1 試合？」「ただし時間が押してるからストラクチャ短くしたい」
  → /tournaments/new で新規作成 → ストラクチャ選び直し → 受付 QR 共有 → 全員再 join
```

### After（運営者 dashboard・state === "finished"・organizer のみ）

```
┌── ALLin-PokerTimer  [サークル名]トーナメント-3 ─ (削除) ──┐
│                                                              │
│  🏆 winner-display-name                                      │
│                                                              │
│  ┌──────────────────────────────────────────────┐            │
│  │ [ 同じ参加者で次のトーナメントを作成 ] ← 追加 │            │
│  └──────────────────────────────────────────────┘            │
│                                                              │
│  Table List (全卓 0 人)                                       │
│  StructureSnapshot ...                                        │
└──────────────────────────────────────────────────────────────┘

リンクボタン → /tournaments/[srcTid]/clone ページに遷移:
┌─── 同じ参加者で次のトーナメントを作成 ──────────────┐
│                                                       │
│  参加者                                               │
│   ☑ player-A   ☑ player-B   ☐ player-C (busted)      │
│   ☑ player-D   ☑ player-E   ...                       │
│   （5 / 6 名選択）                                    │
│                                                       │
│  ─────────────────────────────────────────────────    │
│                                                       │
│  トーナメント名: [ [サークル名]トーナメント-4 ]       │
│                                                       │
│  ストラクチャ: [ Select ▾ 元と同じ：[name]            │
│                          ・短縮版 90min               │
│                          ・通常版 120min              │
│                          ・長尺版 180min  ]           │
│   → 選んだストラクチャの levels が下にプレビュー      │
│                                                       │
│  1 Table あたりの席数: [ 9 ]                          │
│                                                       │
│             [ キャンセル ] [ 作成 ]          │
└───────────────────────────────────────────────────────┘

「作成」 → /tournaments/{newTid}（state="setup"・選択 player 既登録・選択ストラクチャの snapshot）
  → タイマーは停止状態のまま（startedAt=null / levelStartedAt=null）
  → 運営者が任意のタイミングで「席を決定」→「開始」を手動でクリックして初めてタイマーが動き出す
```

### After（一般メンバー / `/live` 視聴者）

「同じ参加者で次のトーナメントを作成」ボタンは描画されず、表示は Phase 5.3 完了時点と完全一致（regression 0）。

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| 終了済み dashboard ヘッダ | 「削除」ボタンのみ | 「削除」ボタンのみ（不変） | 連戦動線はメインカラムに置く |
| WinnerBanner 直下 | 何もない | 「同じ参加者で次のトーナメントを作成」リンクボタン | organizer かつ `state==="finished"` のみ |
| 新規ページ | なし | `/tournaments/[tid]/clone`（TournamentForm 再利用 + ClonePlayersChecklist） | コピー元のストラクチャが初期選択、必要なら別ストラクチャに swap 可能 |
| 新トーナメント着地時 | `/tournaments/new` から空の setup | 選択済み players が既登録の setup（structure は再選択結果） | 受付 URL を再共有しなくても運営者「席を決定」で進める |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [`src/lib/firebase/repositories/tournaments.ts`](../../src/lib/firebase/repositories/tournaments.ts) | 48-75, 690-736 | `createTournament` の returns / 初期 state / `deleteTournament` の writeBatch + cascade パターン（players bulk write のミラー） |
| P0 | [`src/lib/firebase/repositories/players.ts`](../../src/lib/firebase/repositories/players.ts) | 70-100, 131-163 | `upsertPlayer` の self-only シグネチャと `bustPlayer` の writeBatch 利用例 |
| P0 | [`firestore.rules`](../../firestore.rules) | 318-399 | `players/{pid}` の `create` 条件（self-only）。本 plan で organizer-clone ブランチを additive 追加する位置 |
| P0 | [`src/lib/firebase/schemas/player.ts`](../../src/lib/firebase/schemas/player.ts) | 1-21 | `playerBodySchema` の必須フィールドと `isPlayingDealer` default(false) |
| P1 | [`src/lib/services/tournament-state.ts`](../../src/lib/services/tournament-state.ts) | 1-170 | 純関数集約。`canClone` を末尾に追加するパターンのリファレンス |
| P0 | [`src/components/tournament/TournamentForm.tsx`](../../src/components/tournament/TournamentForm.tsx) | 1-204 | `initialSnapshot` prop / `Select` ベース structures ピッカー / `snapshotFromStructure` / submit shape — clone ページで完全再利用する核 |
| P0 | [`src/lib/firebase/repositories/structures.ts`](../../src/lib/firebase/repositories/structures.ts) | 70 周辺 | `listStructuresByGroup` — clone ページから直接呼ばないが `TournamentForm` 内部で fetch される依存関係を理解 |
| P1 | [`src/app/tournaments/[tid]/dashboard-client.tsx`](../../src/app/tournaments/[tid]/dashboard-client.tsx) | 30-200, 304-466 | `isOrganizer` 導出 / WinnerBanner レンダリング / Link + Dialog 利用パターン |
| P1 | [`src/app/tournaments/new/tournament-new-client.tsx`](../../src/app/tournaments/new/tournament-new-client.tsx) | 24-72 | `defaultName` / `defaultSeatsPerTable` の取り出しと `TournamentForm + createTournament + router.push` の流れ — clone-client もこの構造を mirror |
| P1 | [`src/app/tournaments/[tid]/edit/tournament-edit-client.tsx`](../../src/app/tournaments/[tid]/edit/tournament-edit-client.tsx) | all | `[tid]` 配下の edit 専用 client コンポーネントの組み方（`subscribeTournament` で src を読む / role gate / `<TournamentForm initialSnapshot=...>`）— clone-client が最も近い構造的兄弟 |
| P1 | [`src/lib/limits.ts`](../../src/lib/limits.ts) | 1-52 | 数値リミット集約規約 + ⚠ DRIFT WARNING の書き方（`MAX_CLONE_PLAYERS` を末尾に追加） |
| P1 | [`scripts/test-rules-pd.mjs`](../../scripts/test-rules-pd.mjs) | 1-60 | Firestore Rules emulator validator の構造（REST API でケース投入）。本 plan の `test-rules-clone-players.mjs` の雛形 |
| P2 | [`src/components/tournament/WinnerBanner.tsx`](../../src/components/tournament/WinnerBanner.tsx) | 1-32 | 終了画面で隣接配置するため見た目の相場感 |
| P2 | [`src/components/tournament/PlayerList.tsx`](../../src/components/tournament/PlayerList.tsx) | all | チェックリスト UI の trim 対象（DialogContent 内に置く版を新規作る） |
| P2 | [`src/lib/firebase/repositories/players.test.ts`](../../src/lib/firebase/repositories/players.test.ts) | 1-50 | repository unit test の vi.mock パターン（`writeBatch` mock 含む） |
| P2 | [`.claude/PRPs/plans/completed/phase-5.3-append-blind-level.plan.md`](completed/phase-5.3-append-blind-level.plan.md) | all | 同 phase シリーズの plan 体裁、`MAX_LEVELS_PER_TOURNAMENT` 追加・runTransaction パターンの参考 |
| P2 | [`.claude/rules/group-membership.md`](../../rules/group-membership.md) | all | 「既知のセキュリティリスク」セクションへ Phase 5.4 の rule 緩和ノートを追記する位置の確認 |
| P2 | [`.claude/rules/firebase-patterns.md`](../../rules/firebase-patterns.md) | all | repository wrap helper / collection 操作規約 |

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| Firestore writeBatch 制約 | Firebase 公式 | 1 batch 最大 500 ops。クローン対象を `MAX_CLONE_PLAYERS=50` に絞ることで上限の 1/10 で収まる |
| Cloud Firestore Security Rules `get()` cost | Firebase 公式 | 同一 rule 評価内の同一 path への `get()` は cache される。本 plan の clone ブランチは `tournaments/{tid}` を 1 回 `get()` するのみ |

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:699-736 (deleteTournament)
//   - repository 関数: 動詞 + 対象 (camelCase)
//   - Phase prefix は付けない。phase 由来コメントでフィールドや関数の追加経緯を残す
export async function deleteTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> { /* ... */ }
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:599-606 (finishTournament の wrap)
//   - すべての Firestore 書込みは wrapFirestoreWrite 経由
//   - エラードメインコードを必ず付与（firestore/* / tournament/* / seating/* など）
await wrapFirestoreWrite(
  "firestore/write_failed",
  "クローンに失敗しました",
  async () => {
    /* batch.commit() 等 */
  },
  { srcTid, destTid },
);
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:73, 606
//   - 成功時のみ logger.info（wrap の外）
//   - 失敗時の warn は wrapFirestoreWrite 内で集約
logger.info("clone players ok", { srcTid, destTid, copied: count });
```

### REPOSITORY_PATTERN (writeBatch + bulk write)

```ts
// SOURCE: src/lib/firebase/repositories/players.ts:131-163 (bustPlayer)
//   - writeBatch で複数 doc 操作を 1 commit
//   - converter 経由（zodConverter）の collection ref を使う
//   - 操作対象 ID は呼出側で pre-filter する（不要 write を増やさない）
const batch = writeBatch(firestore);
batch.update(doc(playersRef(tid), pid), { isBusted: true /* ... */ });
for (const otherId of sameTablePlayerIds) {
  if (otherId === pid) continue;
  batch.update(doc(playersRef(tid), otherId), { isPlayingDealer: false });
}
await batch.commit();
```

### REPOSITORY_PATTERN (read-then-batch-write across collections)

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:714-728 (deleteTournament の cascade 部)
//   - getDocs でサブコレクションを read
//   - writeBatch で操作を積み上げ最後に commit
//   - 戻り値で件数を返す（logger / UI 反映用）
const counts = await wrapFirestoreWrite("...", "...", async () => {
  const batch = writeBatch(firestore);
  const playersSnap = await getDocs(collection(firestore, "tournaments", tid, "players"));
  playersSnap.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  return { players: playersSnap.size };
});
```

### SERVICE_PATTERN (orchestrator: 複数 repository を順番に呼ぶ)

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts (commitInitialSeating など)
//   - service 層で「複数 repository を組合せて 1 つの business action を実現」
//   - エラー時は AppError を再 throw、UI 側で setError へ
//   - service の単体テストは repository を mock せず orchestrator 動作の事実だけを assert
export async function cloneTournamentWithPlayers(
  args: {
    srcTid: string;
    uid: string;
    userGroupIds: string[];
    selectedPlayerIds: string[];
    name: string;
    structureSnapshot: StructureSnapshot;
    seatsPerTable: number;
    groupId: string;
    createdByUid: string;
  },
): Promise<{ newTid: string; cloned: number }> { /* ... */ }
```

### TEST_STRUCTURE (repository unit test)

```ts
// SOURCE: src/lib/firebase/repositories/players.test.ts:1-50
//   - vi.mock で firebase/firestore を hoist
//   - writeBatch / setDoc / getDocs を vi.fn で観察
//   - assert は呼ばれた引数の shape（"firestore に何を書いたか" を契約として固定）
vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return { ...actual, writeBatch: vi.fn(), getDocs: vi.fn() /* ... */ };
});
```

### TEST_STRUCTURE (純関数 characterization)

```ts
// SOURCE: src/lib/services/tournament-state.test.ts (Phase 5.2 / 5.3 で増設したパターン)
//   - fixture factory `tournament(overrides)` で全フィールド埋めの doc を組成
//   - state 5 種 × 各分岐を網羅
function tournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc { /* ... */ }
expect(canClone(tournament({ state: "finished" }))).toBe(true);
expect(canClone(tournament({ state: "running" }))).toBe(false);
```

### Firestore Rules pattern (additive create branch)

```python
// SOURCE: firestore.rules:328-334 (現在の self-create) と 363-388 (organizer-update の get/exists 形)
//   - 既存ブランチを残し、|| で organizer 経路を追加
//   - parent doc の state / groupId を get() で参照
//   - field-level invariant は self ブランチと同じものをコピー（isBusted=false 等）
allow create: if isSignedIn()
              && (
                ( /* self-create existing */ )
                || (
                  exists(/databases/$(database)/documents/tournaments/$(tid))
                  && isOrganizer(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
                  && get(/databases/$(database)/documents/tournaments/$(tid)).data.state == "setup"
                  && pid == request.resource.data.uid
                  && request.resource.data.uid is string
                  && request.resource.data.isBusted == false
                  && request.resource.data.tableNum == null
                  && request.resource.data.seatNum == null
                  && request.resource.data.get('isPlayingDealer', false) == false
                )
              );
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `firestore.rules` | UPDATE | `players/{pid}` `create` に organizer-clone ブランチを additive で追加（既存 self ブランチは不変） |
| `src/lib/limits.ts` | UPDATE | `MAX_CLONE_PLAYERS = 50` を末尾に追加（暴走防止 + writeBatch 500 ops 上限の余裕確認） |
| `src/lib/services/tournament-state.ts` | UPDATE | 純関数 `canClone(t)` を末尾に追加（`isFinished(t)` を委譲）。membership/role check は呼出側 |
| `src/lib/services/tournament-state.test.ts` | UPDATE | `canClone` の 5 state characterization テスト追加 |
| `src/lib/firebase/repositories/players.ts` | UPDATE | `clonePlayersFromTournament(srcTid, destTid, selectedPlayerIds)` を追加（getDocs + writeBatch） |
| `src/lib/firebase/repositories/players.test.ts` | UPDATE | `clonePlayersFromTournament` の happy / 部分選択 / 上限超過 / busted skip / uid===null skip の 5 ケース |
| `src/lib/services/tournament-clone.ts` | CREATE | orchestrator `cloneTournamentWithPlayers`（createTournament → clonePlayersFromTournament） |
| `src/lib/services/tournament-clone.test.ts` | CREATE | orchestrator の正常系 / clone 失敗時の挙動の 3 ケース |
| `src/app/tournaments/[tid]/clone/page.tsx` | CREATE | Next.js App Router の page。`<CloneClient tid={params.tid} />` を render するだけ |
| `src/app/tournaments/[tid]/clone/clone-client.tsx` | CREATE | src tournament 購読 / role gate / `ClonePlayersChecklist` + `TournamentForm`（initialSnapshot=src.structureSnapshot で初期選択） / orchestrator 結線 / 成功時 `router.push(/tournaments/{newTid})` |
| `src/components/tournament/ClonePlayersChecklist.tsx` | CREATE | players の checkbox 一覧。busted 初期 OFF / uid===null skip / 「全選択 / 全解除」ボタン / 選択件数 badge |
| `src/components/tournament/ClonePlayersChecklist.test.tsx` | CREATE | render / busted default OFF / 全選択ボタン / 個別 toggle / 選択件数表示 の 5 ケース |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | finished 時に WinnerBanner 直下へ `<Link href="/tournaments/{tid}/clone">` でリンクボタンを配置（`isOrganizer && canClone(data)` ガード） |
| `scripts/test-rules-clone-players.mjs` | CREATE | emulator REST validator: organizer in setup → allow / non-organizer → deny / state≠setup → deny / pid≠uid → deny / isBusted=true → deny |
| `package.json` | UPDATE | `scripts.test:rules-clone-players` を追加（既存 `test:rules-pd` と並列） |
| `.claude/rules/firebase-patterns.md` | UPDATE | 「players の rule 経路」セクションに Phase 5.4 organizer-clone ブランチの説明を追加（drift warning 含む） |
| `.claude/rules/group-membership.md` | UPDATE | 「既知のセキュリティリスク」末尾に Phase 5.4 の組織者代理 create 緩和の影響範囲ノートを追加（信頼ロール限定 / setup 限定 / invariant 不変） |
| `.claude/PRPs/prds/allin-timer.prd.md` | UPDATE | Implementation Phases 表に Phase 5.4 行を追加し `pending` で投入。Parallelism Notes も追記 |

## NOT Building

- **clone ページ内でのストラクチャ levels の inline edit**: `TournamentForm` のピッカーで別ストラクチャを
  選び直すか、コピー元のまま使うかの 2 択のみ。levels の duration を一時的にいじりたい場合は新 dashboard
  到着後に Phase 5.2 の `EditableLevelDurationCell` を使う。clone ページに levels editor を載せると scope が
  一気に広がるため scope 外。
- **複数の旧 tournament から merge**: 単一の src tournament からのみ clone。merge は YAGNI。
- **「再 join」自動メール / 通知**: 既存 player の `uid` でレコードを直接作るため、参加者側のスマホでは
  `/live` を開けば次の tournament が見える。能動的な notification は Phase 6 以降の PWA / push 検討時に。
- **Cloud Functions 化**: rule 緩和で実現可能なため不要。Firebase Spark プラン（無料）のままで動く。
- **clone した tournament への参照 link**: `clonedFromTid: string` のような back-reference フィールドは
  追加しない（schema additive 不要 / 嗜好的な情報で running ロジックには使わない）。
- **clone 履歴 UI**: dashboard / 一覧で「これは clone された tournament」のバッジ表示はしない。
- **bulk delete vs clone のキャンセル**: clone 失敗時に新規 tournament を自動 rollback しない。
  `state==="setup"` なので運営者は通常の「削除」ボタンで消せる（既存 cascade delete を流用）。
- **`isPlayingDealer` の引き継ぎ**: 仕様としてリセット（`false` で書く）。元 tournament で PD だった人を
  そのまま新 tournament の PD にする運用は混乱の元（卓数が変わる可能性 / setup 時には卓未確定）。
  Phase 5.1 の rule の create invariant とも整合する。

---

## Step-by-Step Tasks

### Task 1: `tournament-state.canClone` 純関数 + characterization test

- **ACTION**: `src/lib/services/tournament-state.ts` 末尾に `canClone(t: TournamentDoc): boolean` を追加。
  実装は `isFinished(t)` を返すだけの 1 行。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.4: 「同じ参加者で次のトーナメントを作成」操作の許可判定。
   *  - state === "finished" のみ true。
   *  - membership / role の判定は呼出側（dashboard 側で `isOrganizer` と AND する）。
   */
  export function canClone(t: TournamentDoc): boolean {
    return isFinished(t);
  }
  ```
- **MIRROR**: TEST_STRUCTURE (純関数 characterization)。Phase 5.2 `canEditLevelDurations` / Phase 5.3
  `canAppendLevel` と同じ trailing 配置。
- **IMPORTS**: なし（同ファイル内 `isFinished` を再利用）。
- **GOTCHA**: 「複数 owner 制約」「最後の人 disable」のような role-side 判定をここに混ぜない。
  本ファイルは state のみを扱う規約（冒頭コメント参照）。
- **VALIDATE**: `tournament-state.test.ts` に 5 state（setup/seating/running/paused/finished）×
  期待値（false×4 + true×1）の 5 ケースを追加。

### Task 2: `MAX_CLONE_PLAYERS` 定数追加

- **ACTION**: `src/lib/limits.ts` 末尾に `MAX_CLONE_PLAYERS = 50` を追加。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.4: 1 回の clone 操作で新 tournament にコピーする player 件数の上限。値: 50。
   *
   * Firestore writeBatch の 500 ops 上限を大きく下回り、20 人 × 6 卓のサークル規模では
   * 通常 20〜30 件で十分。50 は「悪意・誤操作の防衛線」として設定する。
   *
   * 上限到達時は `clonePlayersFromTournament` が `tournament/clone-too-many` を throw し、
   * UI 側で「{N} 件中 {MAX} 件のみ選択してください」エラーを出す。Phase 5.4 では
   * rule 側で件数制約を設けない（writeBatch サイズを rule で表現できないため）。
   */
  export const MAX_CLONE_PLAYERS = 50;
  ```
- **MIRROR**: `MAX_LEVELS_PER_TOURNAMENT` (`limits.ts:51`) と同じコメントスタイル。
- **IMPORTS**: なし。
- **GOTCHA**: rule 側にハードコード対応版が無いため `scripts/test-rules-limits.mjs` の
  `EXPECTED` には追加しない。
- **VALIDATE**: 既存の `npm run test:rules-limits` が引き続き 6/6 green であること（drift 0）。

### Task 3: Firestore Rules に organizer-clone ブランチ追加

- **ACTION**: `firestore.rules` の `match /players/{pid}` 内 `allow create` を、self-create と
  organizer-clone の OR で表現するように書き換える。既存 self ブランチは原文のまま括弧で囲んだ上で
  `||` で組織者ブランチを追加する。
- **IMPLEMENT**:
  ```python
  // Phase 5.4: organizer による「同じ参加者で次のトーナメントを作成」用 clone 経路。
  //   - 親 tournament が exists かつ state==="setup" のときのみ
  //   - groupId の組織者のみ
  //   - pid == uid invariant、isBusted=false / no seat / no PD は self ブランチと同 invariant
  allow create: if isSignedIn()
                && (
                  (
                    pid == request.auth.uid
                    && request.resource.data.uid == request.auth.uid
                    && request.resource.data.isBusted == false
                    && request.resource.data.tableNum == null
                    && request.resource.data.seatNum == null
                    && request.resource.data.get('isPlayingDealer', false) == false
                  )
                  ||
                  (
                    exists(/databases/$(database)/documents/tournaments/$(tid))
                    && isOrganizer(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId)
                    && get(/databases/$(database)/documents/tournaments/$(tid)).data.state == "setup"
                    && pid == request.resource.data.uid
                    && request.resource.data.uid is string
                    && request.resource.data.isBusted == false
                    && request.resource.data.tableNum == null
                    && request.resource.data.seatNum == null
                    && request.resource.data.get('isPlayingDealer', false) == false
                  )
                );
  ```
- **MIRROR**: 既存 `update` 分岐（rules:345-389）の self-OR-organizer 構造に揃える。`get()` を
  parent doc に対して同 path で 2 回呼んでも rule 内 cache で 1 read 課金。
- **IMPORTS**: なし（rules）。
- **GOTCHA**:
  - **新トーナメントの `state` チェックは parent doc の state を見る**こと。`request.resource.data.uid`
    の方を見ると src tournament を見てしまい意味が変わる。
  - `pid == request.resource.data.uid` を強制することで `pid == uid` invariant を維持し、`assignSeat` /
    `bustPlayer` 等の既存 rule（self-key 比較を多用）が破綻しない。
  - 「自分が organizer であるサークルの player を、同じサークルの別 tournament に勝手に作る」攻撃は
    成立するが、影響範囲は「setup 中の自サークル tournament に他人の displayName で player doc を埋める」のみで、
    被害者は `/tournaments/{newTid}` を見れば既登録扱いを確認できる。信頼ロール（organizer）に閉じる
    ため許容（[`group-membership.md`](../../rules/group-membership.md) の他 organizer 緩和と同方針）。
- **VALIDATE**: Task 11 の emulator validator で 6 ケース（happy / non-organizer / state=running の
  parent / pid≠uid / isBusted=true / tableNum != null）すべて期待通り。

### Task 4: `clonePlayersFromTournament` repository 関数

- **ACTION**: `src/lib/firebase/repositories/players.ts` に `clonePlayersFromTournament` を追加。
  src tournament から `getDocs` で player を取得 → `selectedPlayerIds` でフィルタ → `writeBatch` で
  dest tournament に setDoc。
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 5.4: src tournament の player を dest tournament に複製する。
   *  - selectedPlayerIds に含まれる pid だけをコピー
   *  - uid===null の player（理論上発生しないが防衛的に）は skip
   *  - dest 側は `setDoc(doc(playersRef(destTid), uid), {...})` で pid==uid invariant を維持
   *  - isBusted=false / no seat / no PD / entryAt=serverTimestamp() で reset
   *  - 上限 MAX_CLONE_PLAYERS を超えると tournament/clone-too-many で throw
   *
   * 権限の最終防衛は Firestore Rules（Phase 5.4 で追加した organizer-clone create ブランチ）。
   * client 側の組織者チェックは呼出側 orchestrator が行う前提。
   *
   * 戻り値: 実際にコピーされた件数。selectedPlayerIds に含まれていても src に存在しない /
   * uid===null の人は除外されるため selectedPlayerIds.length と一致しないことがある。
   */
  export async function clonePlayersFromTournament(
    srcTid: string,
    destTid: string,
    selectedPlayerIds: string[],
  ): Promise<number> {
    if (selectedPlayerIds.length > MAX_CLONE_PLAYERS) {
      throw new AppError(
        `clone 対象は ${MAX_CLONE_PLAYERS} 件までです`,
        "tournament/clone-too-many",
      );
    }
    const selected = new Set(selectedPlayerIds);
    return wrapFirestoreWrite(
      "firestore/write_failed",
      "参加者の複製に失敗しました",
      async () => {
        const srcSnap = await getDocs(playersRef(srcTid));
        const batch = writeBatch(firestore);
        let count = 0;
        for (const d of srcSnap.docs) {
          if (!selected.has(d.id)) continue;
          const body = d.data();
          if (body.uid === null) continue; // 防衛: schema 上 nullable だが実運用は必ず string
          batch.set(doc(playersRef(destTid), body.uid), {
            displayName: body.displayName,
            uid: body.uid,
            entryAt: serverTimestamp(),
            isBusted: false,
            bustedAt: null,
            tableNum: null,
            seatNum: null,
            lastMovedAt: null,
            isPlayingDealer: false,
          });
          count++;
        }
        if (count === 0) {
          throw new AppError(
            "コピー対象の参加者が見つかりませんでした",
            "tournament/clone-empty",
          );
        }
        await batch.commit();
        logger.info("players clone ok", { srcTid, destTid, copied: count });
        return count;
      },
      { srcTid, destTid },
    );
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN (writeBatch + bulk write) と (read-then-batch-write across collections)。
  特に `bustPlayer` の writeBatch 構造と `deleteTournament` の getDocs + batch 構造の合成。
- **IMPORTS**: 既存の `getDocs` / `writeBatch` / `serverTimestamp` / `doc` / `AppError` /
  `wrapFirestoreWrite` / `logger` に加え `MAX_CLONE_PLAYERS` を `@/lib/limits` から。
- **GOTCHA**:
  - `setDoc` は organizer-clone create ブランチを通る。`{ merge: true }` を付けると update 経路に
    fallback する SDK 動作があるため**指定しない**（dest 側に同 uid の既存 doc が無い前提だが、念のため）。
  - `count === 0` の場合は意図的に throw（UI 側で「対象なし」エラーを出す）。空 batch.commit は no-op で
    成功してしまうため。
  - `playersRef(srcTid)` には `withConverter(zodConverter(...))` が掛かっているため `d.data()` は
    zod-validated `PlayerBody`。`uid` は `string | null`。
- **VALIDATE**: Task 5 の repository unit test で 5 ケース pass。

### Task 5: `clonePlayersFromTournament` repository unit test

- **ACTION**: `src/lib/firebase/repositories/players.test.ts` に `describe("clonePlayersFromTournament")` を追加。
- **IMPLEMENT**: 5 ケース:
  1. **happy**: src 3 player（全 uid 有り） / 全選択 → batch.set が 3 回・count=3
  2. **partial select**: src 3 player / 2 だけ select → batch.set が 2 回・count=2
  3. **busted skip via UI default**: 呼出側で busted を除外する仕様だが repository は受け入れる（ID
     ベースの contract 確認）。busted player を渡しても batch.set は新 doc 用フィールド（isBusted=false）で
     書かれることを assert
  4. **uid===null skip**: src の中に uid===null の player を仕込み、選択しても skip され count に含まれない
  5. **MAX_CLONE_PLAYERS 超過**: selectedPlayerIds.length=51 → AppError("tournament/clone-too-many")
  6. **count===0**: selected が空 → AppError("tournament/clone-empty")
- **MIRROR**: TEST_STRUCTURE (repository unit test)。`vi.mock("firebase/firestore")` の既存セットを流用、
  `writeBatch` mock を `{ set: vi.fn(), commit: vi.fn() }` で組み立てる。
- **IMPORTS**: `vitest` の標準 + 既存テストファイルの mock セット。
- **GOTCHA**: `getDocs` の戻り値は `{ docs: [{ id, data: () => ({...}) }] }` の shape。`d.data()` の戻りは
  `playerBodySchema` 互換オブジェクト（Timestamp など含む）にする必要があるが、本テストでは `{ uid, displayName }` のみ
  チェックするため Timestamp フィールドは undefined のままで動かす（mock 内で型エラーにならない範囲で簡素化）。
- **VALIDATE**: `npm run test -- src/lib/firebase/repositories/players.test.ts` 全 pass。

### Task 6: `cloneTournamentWithPlayers` orchestrator 関数

- **ACTION**: 新規 `src/lib/services/tournament-clone.ts` に orchestrator を作成。`createTournament` →
  `clonePlayersFromTournament` を順次呼ぶ。
- **IMPLEMENT**:
  ```ts
  import { AppError } from "@/lib/errors";
  import { logger } from "@/lib/logger";
  import {
    clonePlayersFromTournament,
  } from "@/lib/firebase/repositories/players";
  import {
    createTournament,
  } from "@/lib/firebase/repositories/tournaments";
  import type { CreateTournamentInput } from "@/lib/firebase/schemas/tournament";

  export interface CloneTournamentArgs {
    srcTid: string;
    selectedPlayerIds: string[];
    /** 新トーナメントの作成用 input。`/tournaments/new` の createTournament 呼出と同じ shape */
    create: CreateTournamentInput;
  }

  export interface CloneTournamentResult {
    newTid: string;
    cloned: number;
  }

  /**
   * Phase 5.4: 「同じ参加者で次のトーナメントを作成」のオーケストレータ。
   *  1. createTournament で setup 状態の新 tournament を作る
   *  2. clonePlayersFromTournament で src の player を選択分だけ複製する
   *
   * clone 失敗時は新 tournament が空 setup として残る。本関数では rollback しない
   * （UI 側で「作成は成功したが参加者複製に失敗、削除して再試行してください」を表示し、
   * 運営者が通常の「削除」ボタンで cascade 削除する）。
   */
  export async function cloneTournamentWithPlayers(
    args: CloneTournamentArgs,
  ): Promise<CloneTournamentResult> {
    const newTid = await createTournament(args.create);
    try {
      const cloned = await clonePlayersFromTournament(
        args.srcTid,
        newTid,
        args.selectedPlayerIds,
      );
      logger.info("clone tournament ok", {
        srcTid: args.srcTid,
        newTid,
        cloned,
      });
      return { newTid, cloned };
    } catch (e) {
      // 新 tournament は残ったまま AppError を呼出側に伝搬。
      // logger.warn は repository 側で wrapFirestoreWrite が出力済み（二重 warn 回避）。
      throw e instanceof AppError
        ? e
        : AppError.from(e, "firestore/write_failed", "クローンに失敗しました");
    }
  }
  ```
- **MIRROR**: SERVICE_PATTERN (orchestrator)。`seating/orchestrator.ts` の commitInitialSeating
  （tx の前後で repository を呼ぶスタイル）を参考。
- **IMPORTS**: 上記コード参照。
- **GOTCHA**: `newTid` 確定後に clone を失敗させた場合、空 setup tournament が残る。これは UI 側で
  認知させる仕様（NOT Building「rollback しない」）。
- **VALIDATE**: Task 7 の orchestrator test で 3 ケース pass。

### Task 7: `cloneTournamentWithPlayers` orchestrator unit test

- **ACTION**: 新規 `src/lib/services/tournament-clone.test.ts` を作成。`createTournament` /
  `clonePlayersFromTournament` を `vi.mock` で差し替えて挙動を検証。
- **IMPLEMENT**: 3 ケース:
  1. **happy**: createTournament が "new-tid-1" を返し clonePlayersFromTournament が 3 を返す →
     結果 `{ newTid: "new-tid-1", cloned: 3 }`、createTournament が args.create で呼ばれていること
  2. **clone 失敗時の伝搬**: clonePlayersFromTournament が AppError("tournament/clone-empty") を throw →
     orchestrator も AppError を throw（rollback されないこと、つまり createTournament は呼び出された後で
     ある事実を mock の call history で確認）
  3. **createTournament 失敗**: createTournament が AppError を throw → orchestrator も即 throw、
     clonePlayersFromTournament が呼ばれないこと
- **MIRROR**: 既存の orchestrator test（`seating/orchestrator.test.ts`）の vi.mock スタイル。
- **IMPORTS**: vitest 標準 + `vi.mock("@/lib/firebase/repositories/tournaments")` /
  `vi.mock("@/lib/firebase/repositories/players")`.
- **GOTCHA**: `vi.mock` は hoisted。orchestrator のテスト内で `mockResolvedValue` を切り替えるため
  `vi.mocked(createTournament)` でアクセスする。
- **VALIDATE**: `npm run test -- src/lib/services/tournament-clone.test.ts` 全 pass。

### Task 8: `ClonePlayersChecklist` UI コンポーネント

- **ACTION**: 新規 `src/components/tournament/ClonePlayersChecklist.tsx`。
  純粋に participants 一覧 + checkbox + 全選択/全解除ボタン + 選択件数 badge を持つ controlled コンポーネント。
  Dialog / form のラッパは持たず、選択状態は親（clone-client）で管理する。
- **IMPLEMENT** スケルトン:
  ```tsx
  "use client";
  import { useMemo } from "react";
  import { Button } from "@/components/ui/button";
  import { Checkbox } from "@/components/ui/checkbox";
  import { Label } from "@/components/ui/label";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";

  interface Props {
    /** src tournament の players（busted 含む） */
    players: PlayerDoc[];
    /** 親が保持する選択 ID 集合 */
    selected: Set<string>;
    onChange: (next: Set<string>) => void;
    disabled?: boolean;
  }

  export function ClonePlayersChecklist({ players, selected, onChange, disabled }: Props) {
    // uid===null の player は skip（理論上発生しないが防衛的）。
    const eligible = useMemo(() => players.filter((p) => p.uid !== null), [players]);
    const allSelected = eligible.length > 0 && eligible.every((p) => selected.has(p.id));
    const noneSelected = eligible.every((p) => !selected.has(p.id));

    function toggle(id: string) {
      const next = new Set(selected);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onChange(next);
    }
    function selectAll() {
      onChange(new Set(eligible.map((p) => p.id)));
    }
    function clearAll() {
      onChange(new Set());
    }

    return (
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <p className="text-sm font-medium">
            参加者（{selected.size} / {eligible.length} 名選択）
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={selectAll}
              disabled={disabled || allSelected}
            >
              全選択
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={clearAll}
              disabled={disabled || noneSelected}
            >
              全解除
            </Button>
          </div>
        </div>
        <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
          {eligible.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <Checkbox
                id={`clone-p-${p.id}`}
                checked={selected.has(p.id)}
                onCheckedChange={() => toggle(p.id)}
                disabled={disabled}
              />
              <Label htmlFor={`clone-p-${p.id}`} className="cursor-pointer">
                {p.displayName}
                {p.isBusted ? <span className="ml-1 text-muted-foreground">（バスト）</span> : null}
              </Label>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /** busted 以外を初期 ON で返す。clone-client の useState 初期化で使う。 */
  export function initialSelectedIdsFromPlayers(players: PlayerDoc[]): Set<string> {
    const init = new Set<string>();
    players.forEach((p) => {
      if (p.uid !== null && !p.isBusted) init.add(p.id);
    });
    return init;
  }
  ```
- **MIRROR**: shadcn/ui の Checkbox 使用例（既存 `PlayerList.tsx` の PD checkbox 周辺）。
- **IMPORTS**: 上記コード参照。
- **GOTCHA**:
  - 純粋に controlled コンポーネント。状態は親で管理（form 全体の disabled 制御や orchestrator 結線が
    別 file で完結するため）。
  - `initialSelectedIdsFromPlayers` も同 file で export し、clone-client / test 双方で再利用する。
  - 「全選択」「全解除」ボタンは `type="button"`（`TournamentForm` 内の submit イベント発火を防ぐ。
    本コンポーネントは form の外に置かれる想定だが、念のため）。
- **VALIDATE**: Task 9 のコンポーネントテストで 5 ケース pass。

### Task 9: `ClonePlayersChecklist` コンポーネントテスト

- **ACTION**: `src/components/tournament/ClonePlayersChecklist.test.tsx` を新規作成。
- **IMPLEMENT**: 5 ケース:
  1. **render**: 全 player（busted 含む）が表示されること。busted には「（バスト）」サフィックスが付くこと
  2. **busted default OFF（initialSelectedIdsFromPlayers）**: ヘルパー関数が busted を含まない Set を返すこと
  3. **個別 toggle**: checkbox click で `onChange` が呼ばれ、新 Set のシェイプが正しいこと
  4. **全選択ボタン**: click で eligible 全 ID を持つ Set が `onChange` される
  5. **全解除ボタン**: click で空 Set が `onChange` される
- **MIRROR**: 既存 component test の `@testing-library/react` 利用パターン。
- **IMPORTS**: `@testing-library/react`, vitest 標準。
- **GOTCHA**: shadcn/ui の Checkbox は radix の button role になるため `getByRole("checkbox", { name: ... })`
  で取れる。`fireEvent.click` で toggle イベントを発火。
- **VALIDATE**: `npm run test -- src/components/tournament/ClonePlayersChecklist.test.tsx` 全 pass。

### Task 10: `/tournaments/[tid]/clone/page.tsx` + `clone-client.tsx`

- **ACTION**: 新規ページを作成。
  - `page.tsx`: Server Component で `params.tid` を受け取り `<CloneClient tid={...} />` を render。
  - `clone-client.tsx`: src tournament を購読 / role gate / `ClonePlayersChecklist` + `TournamentForm`
    を組合せ / orchestrator 呼出 / 成功時 `/tournaments/{newTid}` へ遷移。
- **IMPLEMENT** スケルトン:
  ```tsx
  // page.tsx
  import { CloneClient } from "./clone-client";

  type Params = Promise<{ tid: string }>;
  export default async function Page({ params }: { params: Params }) {
    const { tid } = await params;
    return <CloneClient tid={tid} />;
  }

  // clone-client.tsx
  "use client";
  import Link from "next/link";
  import { useRouter } from "next/navigation";
  import { useEffect, useMemo, useState } from "react";

  import {
    ClonePlayersChecklist,
    initialSelectedIdsFromPlayers,
  } from "@/components/tournament/ClonePlayersChecklist";
  import { TournamentForm } from "@/components/tournament/TournamentForm";
  import { Button } from "@/components/ui/button";
  import { AppError, unwrapOrFrom } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { subscribePlayers } from "@/lib/firebase/repositories/players";
  import { subscribeTournament } from "@/lib/firebase/repositories/tournaments";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
  import { useGroupRole } from "@/lib/hooks/useGroupRole";
  import { logger } from "@/lib/logger";
  import { useCurrentGroup } from "@/lib/services/current-group";
  import { cloneTournamentWithPlayers } from "@/lib/services/tournament-clone";
  import { canClone } from "@/lib/services/tournament-state";

  export function CloneClient({ tid }: { tid: string }) {
    const { user } = useAuthUser();
    const router = useRouter();
    const { groups, loading: groupsLoading } = useCurrentGroup();

    const [src, setSrc] = useState<TournamentDoc | null>(null);
    const [players, setPlayers] = useState<PlayerDoc[]>([]);
    const [selected, setSelected] = useState<Set<string>>(new Set());
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
      const unsub = subscribeTournament(
        tid,
        ({ doc }) => {
          if (!doc) {
            setError("対象トーナメントが見つかりません");
            return;
          }
          setSrc(doc);
        },
        (err) => {
          logger.warn(err.message, { code: err.code });
          setError(`${err.code}: ${err.message}`);
        },
      );
      return unsub;
    }, [tid]);

    useEffect(() => {
      const unsub = subscribePlayers(
        tid,
        (list) => {
          setPlayers(list);
          // 初回 load 時のみ default 集合を構築。以降のユーザー操作を上書きしない。
          setSelected((prev) => (prev.size === 0 ? initialSelectedIdsFromPlayers(list) : prev));
        },
        (err) => {
          logger.warn(err.message, { code: err.code });
        },
      );
      return unsub;
    }, [tid]);

    const { role: myRole } = useGroupRole(src?.groupId);
    const isOrganizer = myRole === "owner" || myRole === "organizer";
    const targetGroup = useMemo(
      () => (src ? groups.find((g) => g.id === src.groupId) ?? null : null),
      [src, groups],
    );
    const defaultName = useMemo(() => {
      if (!targetGroup) return src?.name ?? "";
      return `[${targetGroup.name}]トーナメント-${targetGroup.finishedTournamentCount + 1}`;
    }, [targetGroup, src?.name]);

    // role 確定までの flicker 抑制 + 非 organizer は dashboard 経由で /live に redirect 済みだが
    // 直接 URL 叩きの保険として ここでも 1 件 redirect。
    useEffect(() => {
      if (!user || groupsLoading || !src) return;
      if (!isOrganizer) router.replace(`/tournaments/${tid}`);
    }, [user, groupsLoading, src, isOrganizer, router, tid]);

    if (!src || !user) {
      return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
    }
    if (groupsLoading || !isOrganizer) {
      return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
    }
    if (!canClone(src)) {
      return (
        <main className="mx-auto max-w-2xl space-y-4 p-8">
          <p className="text-sm text-destructive" role="alert">
            このトーナメントは終了していないため複製できません。
          </p>
          <Button asChild variant="outline">
            <Link href={`/tournaments/${tid}`}>戻る</Link>
          </Button>
        </main>
      );
    }

    return (
      <main className="mx-auto max-w-2xl space-y-6 p-8">
        <h1 className="text-2xl font-bold">同じ参加者で次のトーナメントを作成</h1>
        <p className="text-sm text-muted-foreground">
          コピー元のストラクチャが初期選択されています。利用時間に合わせて別ストラクチャに切り替えることもできます。
        </p>
        <ClonePlayersChecklist
          players={players}
          selected={selected}
          onChange={setSelected}
          disabled={submitting}
        />
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <TournamentForm
          groupId={src.groupId}
          initialName={defaultName}
          initialSnapshot={src.structureSnapshot}
          initialSeatsPerTable={src.seatsPerTable}
          submitLabel="作成"
          onSubmit={async ({ name, snapshot, seatsPerTable }) => {
            if (selected.size === 0) {
              throw new AppError("少なくとも 1 人を選択してください", "validation/clone-no-players");
            }
            setSubmitting(true);
            try {
              const { newTid } = await cloneTournamentWithPlayers({
                srcTid: tid,
                selectedPlayerIds: Array.from(selected),
                create: {
                  groupId: src.groupId,
                  createdByUid: user.uid,
                  name,
                  structureSnapshot: snapshot,
                  seatsPerTable,
                },
              });
              router.push(`/tournaments/${newTid}`);
            } catch (e) {
              const wrapped = unwrapOrFrom(e, "firestore/write_failed", "クローンに失敗しました");
              setError(`${wrapped.code}: ${wrapped.message}`);
              throw wrapped; // TournamentForm 側の try/catch で submitting=false に戻す
            } finally {
              setSubmitting(false);
            }
          }}
          onCancel={() => router.push(`/tournaments/${tid}`)}
        />
      </main>
    );
  }
  ```
- **MIRROR**: `tournament-edit-client.tsx` の subscribeTournament + role gate + TournamentForm 構造、
  `tournament-new-client.tsx` の `defaultName` / `initialSeatsPerTable` 算出ロジック。
- **IMPORTS**: 上記コード参照。
- **GOTCHA**:
  - `selected` の初期化は subscribePlayers の onNext 内で 1 度だけ。以降のユーザー toggle 操作を
    上書きしないため `prev.size === 0` ガードを入れる。
  - `TournamentForm` は内部で `listStructuresByGroup(groupId)` を呼ぶため、clone-client から
    structures を別途 fetch する必要なし。
  - `TournamentForm.onSubmit` 内で AppError を throw し直すと `TournamentForm` 側の catch で
    `setSubmitting(false)` に戻る。clone-client 側でも setError を呼んでおき、ユーザーに表示。
  - `canClone(src)` チェックは UI 側にも置く（dashboard リンクから来る前提だが直リンクも防御）。
  - 非 organizer redirect は subscribeTournament 完了後に行う（src null 中は何もしない）。
  - `defaultName` は target group の `finishedTournamentCount` から算出。target group が `groups` に
    いない race 状態は src.name の fallback で許容。
- **VALIDATE**: 手動ブラウザで終了済み tournament の dashboard → 「同じ参加者で次のトーナメントを作成」
  → clone ページ → 一部 uncheck・ストラクチャを別の短縮版に変更 → 「作成」 → 新 dashboard
  着地 → 新 tournament の `state="setup"` で選択 player + 別ストラクチャの snapshot が反映されている。
  Auto モードで手動確認できない場合は typecheck / lint / build / test で代替。

### Task 11: `dashboard-client.tsx` への配線（リンクボタン追加）

- **ACTION**:
  1. `import { canClone, ... } from "@/lib/services/tournament-state"` を追加
  2. WinnerBanner 直下に `<Link href={"/tournaments/${tid}/clone"}>` でリンクボタンを追加
     （`isOrganizer && canClone(data)` ガード）
  3. orchestrator / Dialog の import や state 追加は不要（page 遷移するだけ）
- **IMPLEMENT**:
  ```tsx
  // import 追加（既存 imports に混ぜる）
  import { canClone, /* ... */ } from "@/lib/services/tournament-state";

  // WinnerBanner の直下に追加（既存 line 438 周辺）
  {winner ? <WinnerBanner winner={winner} /> : null}
  {isOrganizer && canClone(data) ? (
    <div className="flex justify-center">
      <Button asChild size="lg">
        <Link href={`/tournaments/${tid}/clone`}>同じ参加者で次のトーナメントを作成</Link>
      </Button>
    </div>
  ) : null}
  ```
- **MIRROR**: dashboard 内の既存 `<Link href="/tournaments/{tid}/edit">` 「編集」ボタン形と同じ
  `<Button asChild>` パターン。
- **IMPORTS**: 上記。
- **GOTCHA**:
  - `<Button asChild>` は radix の Slot を経由して Link に Button のスタイルを当てる。`size="lg"` の
    視認性は WinnerBanner と並んだ際に過大にならない範囲で。
  - dashboard-client 側の state / dialog 周りは触らない（page 遷移パターンに完全切替）。
- **VALIDATE**: dashboard を開いた状態で finished かつ organizer のロールでリンクが見えること、
  クリックで `/tournaments/{tid}/clone` に遷移すること。

### Task 12: Firestore Rules emulator validator

- **ACTION**: `scripts/test-rules-clone-players.mjs` を新規作成。`scripts/test-rules-pd.mjs` の構造を mirror。
- **IMPLEMENT**: 6 ケース:
  1. organizer が src→dest の clone を setup 状態で実行 → 1 件 create allow
  2. 一般 member（同 group の non-organizer）による clone → deny
  3. dest tournament の state="seating" → deny（setup 限定）
  4. `pid != uid` を意図的に投げる → deny（pid==uid invariant）
  5. `isBusted: true` を埋めて create → deny
  6. dest tournament の groupId が違う group → deny
- **MIRROR**: `scripts/test-rules-pd.mjs` の REST API + asserts 構造。`signUpOrIn` / `setDoc` / `assertAllowed`
  / `assertDenied` パターンを再利用。
- **IMPORTS**: なし（node 標準 fetch）。
- **GOTCHA**:
  - emulator 起動方法を冒頭コメントに記載すること（`firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-clone-players.mjs"`）。
  - `package.json` の `scripts` に `test:rules-clone-players` を追加（`firebase emulators:exec` を含む完全コマンド形）。
- **VALIDATE**: `npm run test:rules-clone-players` で全ケース pass（exit code 0）。

### Task 13: ルールドキュメント更新

- **ACTION**: 2 ファイルへ追記。
- **IMPLEMENT**:
  - `.claude/rules/firebase-patterns.md`: 「`players/{pid}` の rule 経路（Phase 5.4 以降）」セクションを
    新設し、create が **self ブランチ + organizer-clone（setup 限定）ブランチ** の 2 系統で OR されている
    ことを明記。⚠ DRIFT WARNING で `players` schema 追加時は両ブランチの invariant を同期更新する旨を記載。
  - `.claude/rules/group-membership.md`: 「既知のセキュリティリスク」末尾に Phase 5.4 organizer-clone の
    影響範囲（信頼ロール限定 / setup 限定 / invariant 不変）を追記。リスクレベルは「organizer は元々
    CRUD 全権を持つ」前提で「実害は無視できる」と既存方針に揃える。
- **MIRROR**: 同 file の Phase 4.16 / 4.17 / 5.1 polish 系セクションのトーン。
- **IMPORTS**: なし。
- **GOTCHA**: 「⚠ DRIFT WARNING」の連動先（schema / rule / repository / UI）を必ず列挙する。Phase 5.1
  PD フィールドの drift warning が良い参考。
- **VALIDATE**: 該当 rule ファイルを Read して整合性確認。

### Task 14: PRD 更新（Phase 5.4 行は本 plan 生成時に追加済み）

- **ACTION**: 本 plan 生成と同時に PRD の Implementation Phases 表に Phase 5.4 行を追加し
  `in-progress` で投入済み。Parallelism Notes にも 1 行追記済み。実装完了時に `complete` へ変更し
  実装レポートへの link を追加する。
- **IMPLEMENT**:
  - Phase 5.4 行の `complete` 化（実装後）
  - 「実装レポート: [phase-5.4-clone-tournament-with-players-report.md](../reports/phase-5.4-clone-tournament-with-players-report.md)」を追記
- **MIRROR**: Phase 5.3 の completion entry スタイル。
- **IMPORTS**: なし。
- **GOTCHA**: 設計を Dialog から専用ページに切り替えたため、Phase 5.4 行の description（既に
  「`CloneTournamentDialog`」と書かれていれば）を「`/tournaments/[tid]/clone` ページ + `ClonePlayersChecklist`」に
  訂正すること（本 plan 生成時に PRD 上の文言は最新化済み）。
- **VALIDATE**: PRD を Read して表が正しく更新されていることを確認。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `canClone(setup)` | `tournament({ state: "setup" })` | `false` | – |
| `canClone(seating)` | `tournament({ state: "seating" })` | `false` | – |
| `canClone(running)` | `tournament({ state: "running" })` | `false` | – |
| `canClone(paused)` | `tournament({ state: "paused" })` | `false` | – |
| `canClone(finished)` | `tournament({ state: "finished" })` | `true` | – |
| `clonePlayersFromTournament` happy | src 3 player / 全選択 | batch.set ×3, count=3 | – |
| `clonePlayersFromTournament` partial | src 3 / 2 選択 | batch.set ×2, count=2 | – |
| `clonePlayersFromTournament` busted included | busted player を選択 | batch.set で `isBusted:false` で書き直し | yes (busted reset) |
| `clonePlayersFromTournament` uid===null skip | 1 player の uid を null | skip され count に含まれない | yes (defensive) |
| `clonePlayersFromTournament` over MAX | 51 件選択 | AppError("tournament/clone-too-many") | yes (limit) |
| `clonePlayersFromTournament` zero | 0 件選択 | AppError("tournament/clone-empty") | yes (empty batch) |
| `cloneTournamentWithPlayers` happy | mocked deps が成功 | `{ newTid, cloned }` を返却 | – |
| `cloneTournamentWithPlayers` clone fail | clone が AppError throw | orchestrator も throw、createTournament は呼ばれている | yes (no rollback) |
| `cloneTournamentWithPlayers` create fail | createTournament throw | orchestrator も即 throw、clone は未呼出 | yes |
| `ClonePlayersChecklist` render | players 4 件（うち 1 busted） | 全件描画 + busted に「（バスト）」サフィックス | – |
| `initialSelectedIdsFromPlayers` busted skip | players 4 件（うち 1 busted） | 返却 Set に busted は含まれず uid===null も含まれない | yes |
| `ClonePlayersChecklist` toggle | 1 件 click | onChange が新 Set で呼ばれ、対象 ID が toggle されている | – |
| `ClonePlayersChecklist` 全選択 | 「全選択」 click | onChange が `new Set(eligible.map(p=>p.id))` で呼ばれる | – |
| `ClonePlayersChecklist` 全解除 | 「全解除」 click | onChange が `new Set()` で呼ばれる | – |

### Edge Cases Checklist

- [x] **空の participant list**: src tournament に player が 0 件 → checklist 空 → orchestrator 呼出時に
      `validation/clone-no-players` で UI エラー
- [x] **全 player が busted**: 初期 selected が空集合 → 何もせず submit すると `validation/clone-no-players`
- [x] **`uid===null` の guest が混じる**: 表示は skip され、`initialSelectedIdsFromPlayers` も含めない /
      repository 側でも skip（多層防御）
- [x] **重複 select**: Set で管理しているため副作用なし
- [x] **MAX_CLONE_PLAYERS 超え**: repository 側で AppError throw、clone-client が catch して setError 表示
- [x] **clone 中に新規 join**: subscribePlayers で realtime 反映されるが、`selected` 集合は初回 load 時のみ
      default で埋めるため、後追い join した player はチェック OFF のまま（運営者が必要なら追加 ON）
- [x] **race: 二重クリック**: `TournamentForm` 側で submit 中 button disable + clone-client の
      `submitting` state で多重 firing を抑止
- [x] **rule 違反**: 一般 member は dashboard から clone リンクが見えない + clone-client の useEffect で
      `/tournaments/{tid}` へ redirect。万一 dev が無理に呼んでも emulator validator で確認した通り rule 側で deny
- [x] **ストラクチャ swap**: `TournamentForm` の Select で別 structures を選ぶと内部 state の `snapshot` が
      入れ替わり、submit 時はその snapshot で `createTournament` される（コピー元 snapshot は捨てられる）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
npm run lint
```

EXPECT: ゼロエラー / ゼロ warning。

### Unit Tests

```bash
npm run test -- src/lib/services/tournament-state.test.ts
npm run test -- src/lib/firebase/repositories/players.test.ts
npm run test -- src/lib/services/tournament-clone.test.ts
npm run test -- src/components/tournament/ClonePlayersChecklist.test.tsx
```

EXPECT: 全 pass。新規追加は約 19 件（state ×5 + repo ×6 + orchestrator ×3 + checklist ×5）。

### Full Test Suite

```bash
npm run test
```

EXPECT: 既存 728 + 19 ≈ 747 件すべて green、regression 0。

### Firestore Rules limits

```bash
npm run test:rules-limits
```

EXPECT: 6/6 green（変更なし）。`MAX_CLONE_PLAYERS` は rule 側転記対象外のため drift 検査追加不要。

### Firestore Rules clone validator (新規)

```bash
firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-clone-players.mjs"
# または package.json の scripts 経由
npm run test:rules-clone-players
```

EXPECT: 全 6 ケース pass（exit code 0）。

### Build

```bash
npm run build
```

EXPECT: `next build` 成功（全ルート生成）。

### Manual Browser

```bash
npm run dev
```

EXPECT 手順:

1. organizer でログインし、参加者 3 人以上の trial tournament を `setup → seating → running → finished` まで通す
2. Winner 確定後、dashboard に「同じ参加者で次のトーナメントを作成」リンクボタンが表示される（owner / organizer のみ）
3. クリック → `/tournaments/[srcTid]/clone` ページに遷移
4. ページ上部に participants checklist（busted は default OFF、他は ON）、「全選択 / 全解除」ボタン動作確認
5. 中段に `TournamentForm` が表示され、name に `[サークル名]トーナメント-{N+1}`、ストラクチャ Select は
   何も選択されていない placeholder 状態だが、下のプレビューには **コピー元の `structureSnapshot` の levels 数 / 初期 stack** が表示されている
   （`initialSnapshot` 経由で working snapshot に反映済み）
6. **ストラクチャ Select で別の structures（例: 短縮版）を選択** → プレビューの数値が新ストラクチャに切り替わる
7. 数名チェック OFF → 「作成」 → 自動で `/tournaments/{newTid}` に遷移
8. 新 dashboard で参加者リストに選択分だけ並んでいる、`isBusted=false` / `tableNum=null` / `seatNum=null` /
   `isPlayingDealer=false` で初期化されている、`structureSnapshot` は **手順 6 で選んだ別ストラクチャ**になっている
9. 通常通り「席を決定」 → 開始でタイマー start 可能
10. 一般 member アカウントでログインし `/tournaments/{finishedTid}/clone` を直接開いた場合は
    `/tournaments/{finishedTid}` へ redirect され、dashboard でもリンクが見えない
11. （Auto モードで上記手動確認が省略される場合は typecheck / lint / test / build / emulator validator で代替）

### 削除リカバリ確認

clone 時に意図的に rule 違反させる方法（例: 削除権限のない他 group に `srcTid` を渡す）で
clonePlayersFromTournament を失敗させ、新 tournament が空 setup として残ること、`削除` ボタンで
通常の cascade 削除が動くことを 1 度確認。

---

## Acceptance Criteria

- [ ] Task 1〜14 すべて完了
- [ ] `npx tsc --noEmit` ゼロエラー
- [ ] `npm run lint` ゼロ warning
- [ ] `npm run test` 既存 728 + 新規 19 件以上が全 green
- [ ] `npm run build` 成功（`/tournaments/[tid]/clone` ルートが生成されること）
- [ ] `npm run test:rules-limits` 6/6 green
- [ ] `npm run test:rules-clone-players` 6/6 green（emulator）
- [ ] 手動ブラウザ E2E 11 ステップ確認（または Auto モード時は省略を明記）
- [ ] `/live` の表示が Phase 5.3 完了時点と完全一致（regression 0、スクリーンショット比較任意）
- [ ] 一般 member は dashboard で clone リンクが見えず、`/tournaments/{tid}/clone` 直リンクは redirect

## Completion Checklist

- [ ] Code follows discovered patterns（writeBatch / wrapFirestoreWrite / serverTimestamp 等）
- [ ] Error handling matches codebase style（AppError + ドメインコード `tournament/clone-*`）
- [ ] Logging follows codebase conventions（成功時 logger.info / 失敗時 wrap helper 内 warn）
- [ ] Tests follow test patterns（vi.mock hoist / `tournament(overrides)` factory）
- [ ] No hardcoded values（`MAX_CLONE_PLAYERS` は `limits.ts` 経由）
- [ ] Documentation updated（`firebase-patterns.md` + `group-membership.md` + PRD）
- [ ] No unnecessary scope additions（NOT Building セクション準拠）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| organizer が他 group の player を巻き添えで複製 | L | M | rule 側で `isOrganizer(get(...).data.groupId)` を必須化、`pid == uid` invariant も維持。emulator validator で deny 確認 |
| clone 失敗時の空 tournament が残る | M | L | UI で削除導線を明示、既存 `deleteTournament` を案内する error message |
| 旧 tournament を別運営者が同時に削除 | L | L | `getDocs` 時点で src が消えていれば空 batch → `tournament/clone-empty` で抜ける |
| `MAX_CLONE_PLAYERS` 50 を超える大規模サークル | L | L | PRD の対象規模（20 人前後）の 2.5 倍。実害確認後に limit 引き上げで対応 |
| organizer-clone ブランチが将来の rule 設計と衝突 | L | M | drift warning を rule / firebase-patterns.md / players.ts コメントに残す。Cloud Functions 化時はこのブランチを廃止 |
| `displayName` の rename が src 反映前に clone される | L | L | snapshot の displayName をそのまま継承（rename 追従なし）。実用上問題なし |
| Phase 4.10（custom audio）と同時 merge で conflict | L | L | 両者は別 collection / 別ファイルを触るため独立並行可能（Parallelism Notes に明記） |

## Notes

- **Cloud Functions 不使用の判断**: Phase 4.10 と同方針で、Firebase Spark プラン（無料）から外れる
  破壊的選択を避ける。代わりに rule の組織者代理 create を **setup 限定 + invariant 維持**で安全化する。
  将来 Cloud Functions 化する場合は本ブランチを廃止し、Callable で `srcTid` / `destTid` を受け取り
  サーバ側で書く方式に移行。drift warning に明記済み。
- **タイマーは自動起動しない（重要）**: clone 完了直後の新 tournament は **`state="setup"`** で着地する。
  `createTournament` は `startedAt=null` / `levelStartedAt=null` / `currentLevel=0` で初期化するため、
  `useTournamentTimer` は `null` を見て何もせずタイマーは動かない。運営者は通常通り
  「席を決定」（`beginSeating` → `seating`）→「開始」（`confirmSeating` → `running`、ここで `startedAt` /
  `levelStartedAt` に serverTimestamp 注入）の **2 操作を手動で踏む** 必要がある。`running` に
  なって以降は TimerControls の play / pause アイコンで完全に手動制御。これは `/tournaments/new`
  経由のフローと完全一致で、clone は「players の事前登録 + structure 引継ぎ」だけを自動化し、
  進行操作は自動化しない設計。
- **submit ボタン文言を「作成」に統一した理由**: 当初「作成して開始」としていたが「開始」が
  「タイマー開始」と誤読される指摘があったため、`/tournaments/new` の既存 `submitLabel="作成"` と統一。
  実際の挙動も「作成 → setup ページに着地（タイマー停止）」であり、文言と一致する。
- **`structureSnapshot` の継承理由 + swap 可能化の判断**: 利用施設の利用時間制限で 2 回目を短縮ストラクチャに
  切り替えたい運用ニーズが提案文書ヒアリング時に追加で挙がったため、`TournamentForm` の Select ピッカーで
  別 structures に swap できる経路を残す。コピー元 snapshot を初期値（プレビューに反映）として渡し、
  運営者が触らなければそのまま継承される。Cancel して `/tournaments/new` を使うパスも残るが、
  participants コピー機能は clone ページ側にしかないため UX 的に clone ページ + structure swap が正解。
- **PD（Playing Dealer）状態のリセット**: Phase 5.1 の rule create invariant `isPlayingDealer == false`
  に従う。新 tournament の卓数が変わる可能性 / setup では卓未確定なため、PD 引き継ぎは混乱の元。
  `setup` 中の PlayerList で organizer が再度 PD ON にする運用で十分。
- **連続 clone の Tower of Hanoi リスク**: 同じ参加者を何度もクローンしても問題ないが、各 tournament は
  別 doc として残るため、`/tournaments` 一覧が長くなる。Phase 4.14 の cascade delete で運営者が任意削除可能。
- **PR 戦略**: 1 PR で 14 task すべてを送ると変更量が大きい（約 13 files）。Phase 5.3 の plan が同規模で
  単一 PR で送られているため同方針で OK。レビューが分割を求めた場合は「rule + repository / orchestrator + UI /
  docs + PRD」の 3 PR 構成も可能（先頭の rule + repository は単独で動作テスト可能）。
- **次の dryrun 観点**: Phase 5.4 投入後の 2 回目ドライランで、運営者が「連戦時のリセット感」がどの程度
  改善したかをヒアリングする。「QR を再共有しなくて良い」「busted の人を外す UX が直感的」の 2 点が
  仮説検証の判定材料。
