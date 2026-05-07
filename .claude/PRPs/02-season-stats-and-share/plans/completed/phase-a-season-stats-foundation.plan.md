# Plan: Phase A — Season Stats Foundation

## Summary

サークル単位のシーズン戦績（参加・優勝・FT・累計ポイント）を集計する基盤を `groups/{gid}/seasonStats/{uid}` として新設し、`finishTournament` の runTransaction 内で全プレイヤーの順位導出 → ポイント計算 → atomic 増分を行う。シーズン区切りは運営者の手動切替（現在 stats を `seasonHistory/{seasonId}` に snapshot し、`groups/{gid}.seasonStartDate` を更新して stats を空に reset）。ポイント計算式は固定（`base[rank] × sqrt(participants / 8)`、小数 2 桁切捨）で、`src/lib/services/season-points.ts` の純関数に集約する。あわせて `DEFAULT_SEATS_PER_TABLE` を 9 → 8 へ変更し baseline=8 と整合させる。サークル詳細画面に「シーズンを開始する」ボタン（owner / organizer 限定、確認モーダル）と新規シーズンランキング画面（group メンバー全員 read 可）を追加する。

## User Story

As a サークル運営者（owner / organizer）,
I want トーナメントを終了した瞬間に、シーズン累計の参加・優勝・FT・ポイントが各メンバーに自動で加算される,
So that 個別に手集計せず、サークル LINE で「先月の首位は誰だった」「シーズン首位は誰か」をすぐに確認できる。

And as a サークル参加メンバー,
I want シーズンランキング画面で自分・他メンバーの累計戦績を確認できる,
So that 次回開催に向けたモチベーションが維持される。

And as a サークル運営者（owner / organizer）,
I want シーズンの区切りを「シーズンを開始する」ボタンで明示的に切替できる,
So that サークルごとの開催ペース（四半期 / 半期 / 任意）に合わせて柔軟に区切れる。

## Problem → Solution

**Current state**:

- 月 1〜2 回開催のサークルでは、開催間隔が空く中で「次回も参加しよう」という engagement 維持手段がアプリ側に存在しない。
- 終了済みトーナメント数（[group.ts#L76-L80](../../../../src/lib/firebase/schemas/group.ts#L76-L80) の `finishedTournamentCount`）は集計可能だが、誰がどれだけ勝ったかの累計は記録されない。
- 順位データは `players[].bustedAt` から動的計算するしかなく、シーズン跨ぎの累計は個人の記憶頼り。

**Desired state**:

- `finishTournament` 完了で全プレイヤーの `seasonStats/{uid}` が tx 内 atomic に更新される（参加 +1、優勝者は wins +1、FT 内なら finalTables +1、totalPoints += `calcSeasonPoints(rank, participants)`）。
- 運営者がサークル詳細画面で「シーズンを開始する」を押すと、現在 stats が `seasonHistory/{seasonId}` に snapshot され、新シーズンが開始される。
- シーズンランキング画面で全メンバーが累計を閲覧できる（並び順は `totalPoints desc`）。
- Phase B（結果カード）はこの基盤を読んでシーズン首位カードを生成する。

## Metadata

- **Complexity**: Large
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md)
- **PRD Phase**: Phase A — Season Stats Foundation
- **Stage scope**: schema 2 件追加 / repository 2 件追加 / service 2 件追加 / rule branch 4 件追加 / `finishTournament` tx 拡張 / 純関数 1 件 / `DEFAULT_SEATS_PER_TABLE` 9→8 / UI 2 画面（サークル詳細「シーズンを開始する」+ ランキング画面新設）
- **Estimated Files**: 約 22 files（schema 2 / repository 2 / service 2 / rules 1 / `tournaments.ts` 1 / `limits.ts` 1 / 純関数 1 / 純関数 test 1 / repo test 4 / service test 2 / schema test 1 / UI 3 / docs 3）

---

## UX Design

### Before（現状）

```
/groups/[gid]
┌────────────────────────────────────────────┐
│ [サタデーサークル]                         │
│ 開催数: 12 回                              │
│ 1 Table あたりの席数（デフォルト）: 9 席   │
│ メンバー（5 人）                           │
│ 招待コード …                               │
└────────────────────────────────────────────┘

トーナメント終了 → Winner 画面に「Carol 優勝」表示のみ。
シーズン累計はどこにも記録されない。
```

### After

```
/groups/[gid]
┌────────────────────────────────────────────┐
│ [サタデーサークル]                         │
│ 開催数: 12 回                              │
│ 1 Table あたりの席数（デフォルト）: 8 席   │  ← 9→8 に変更
│ メンバー（5 人）                           │
│ シーズン                                   │
│   現在シーズン開始: 2026-04-01             │
│   [シーズンを開始する] (owner/organizer)   │
│   [ランキング画面を開く]                   │
│ 招待コード …                               │
└────────────────────────────────────────────┘

/groups/[gid]/season  （新規ページ）
┌────────────────────────────────────────────┐
│ シーズンランキング — サタデーサークル      │
│ 現在シーズン開始: 2026-04-01               │
│                                            │
│ 順位 表示名     参加 優勝 FT  累計ポイント │
│ 1.   Alice      8    3   5    47.83 pt     │
│ 2.   Bob        6    1   3    28.12 pt     │
│ 3.   Carol      5    1   2    19.66 pt     │
│ 4.   Dave       4    0   1    11.55 pt     │
│ 5.   Eve        2    0   0     5.20 pt     │
│                                            │
│ ※ 過去シーズンの履歴は次フェーズで対応     │
└────────────────────────────────────────────┘

「シーズンを開始する」クリック後（モーダル）:
┌────────────────────────────────────────────┐
│ シーズンを開始しますか？                   │
│ ・現在の戦績は履歴にスナップショットされる │
│ ・新シーズンの開始日: 2026-05-06           │
│ [開始する]  [キャンセル]                   │
└────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `finishTournament()` の write 経路 | runTransaction で tournament.state="finished" + groups.finishedTournamentCount = increment(1) の 2 update | 同 + 参加メンバー全員の `seasonStats/{uid}` を atomic 更新（参加・優勝・FT・ポイント） | tx 1 つで全員分書込。20 人 × 4 フィールド ≈ 80 ops、500 ops 上限内 |
| `/tournaments/new` のデフォルト席数 | 9 (新 group 作成時) | 8 (新 group 作成時) | 既存 group の保存値はそのまま。新 group のみ default 8 |
| `/groups/[gid]` のシーズンカード | 不在 | 「シーズンを開始する」ボタン（owner/organizer 限定）+ 開始日表示 + ランキングへの導線 | 一般メンバーには「ランキングへ」リンクと開始日のみ表示 |
| `/groups/[gid]/season` | ページ未存在 | 新規ページ。`seasonStats` を `totalPoints desc` で並べ、参加・優勝・FT・累計を表示 | 全メンバー read 可（rule で `isGroupMember(gid)`） |
| 旧 group doc の hydrate | `seasonStartDate` 不在 | zod default で `null` に hydrate（最初のシーズン開始操作で初回値が入る） | additive、破壊的 migration なし |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | all | schema / repo / rules の三点同期、`wrap` helper、`tournaments/{tid}` 配下 subcollection 設計原則（wildcard 厳禁）、`affectedKeys` ホワイトリスト |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | `AppError` ラップ、prefix 規約（`firestore/*` / `seating/*` 等）、新規 prefix `season/*` を本 phase で導入 |
| P0 (critical) | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | all | `groups/{gid}` allowed-keys 表に `seasonStartDate` を追加する位置、organizer 権限マトリクス |
| P0 (critical) | [.claude/rules/testing.md](../../../rules/testing.md) | all | UT/E2E の責務分担、mock 境界（helper / repository）、`fakeTournament` factory pattern |
| P0 (critical) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 47-100 | `audioSettings` / `finishedTournamentCount` / `defaultSeatsPerTable` の additive 拡張先例。`seasonStartDate` を同パターンで追加 |
| P0 (critical) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 543-583 | `finishTournament` の `runTransaction` + `loadTournamentInTx` + tx 内 state 再 read + `increment` 既存実装。本 phase で seasonStats 更新を相乗り |
| P0 (critical) | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 243-295 | `updateFinishedTournamentCount` / `updateDefaultSeatsPerTable` の wrap pattern。`updateSeasonStartDate` を同形で追加 |
| P0 (critical) | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 285-337 | `setFinishedTournamentCount` / `setDefaultSeatsPerTable` の owner/organizer assert。本 phase の `startNewSeason` 関数のパターン |
| P0 (critical) | [firestore.rules](../../../../firestore.rules) | 70-225, 311-446 | `groups/{gid}` update branches（6 分岐）と `tournaments/{tid}` 配下 explicit subcollection rule。`seasonStats` / `seasonHistory` を explicit rule で追加 |
| P0 (critical) | [src/lib/firebase/tx-helpers.ts](../../../../src/lib/firebase/tx-helpers.ts) | all | `loadTournamentInTx` 既存 helper。tx 内で player 一覧を取るため新規 helper `listPlayersInTx` を追加 |
| P0 (critical) | [src/lib/firebase/wrap.ts](../../../../src/lib/firebase/wrap.ts) | all | `wrapFirestoreWrite` / `wrapFirestoreRead` 経由が新規 repository の推奨パターン |
| P0 (critical) | [src/lib/firebase/converters.ts](../../../../src/lib/firebase/converters.ts) | all | zodConverter で fromFirestore 失敗時に `firestore/invalid-data` を throw。新コレクションも同経路 |
| P0 (critical) | [src/lib/limits.ts](../../../../src/lib/limits.ts) | all | 数値リミット定数の単一真実源。`DEFAULT_SEATS_PER_TABLE` を 9→8 に変更、`SEASON_POINTS_BASE` / `SEASON_POINTS_BASELINE_PARTICIPANTS` を新設 |
| P0 (critical) | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | 79-90 | `resolveWinner` 既存。本 phase で `resolveRanking` 純関数を timer.ts に追加 |
| P0 (critical) | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | all | `setFinishedTournamentCount` / `setDefaultSeatsPerTable` の inline edit パターン。本 phase で「シーズンを開始する」ボタン + 確認モーダルを追加 |
| P1 (important) | [.claude/PRPs/plans/completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md](../01-allin-timer/completed/phase-4.16-tournament-default-name-from-finished-counter.plan.md) | all | `finishTournament` の runTransaction 拡張先例、organizer-only counter rule branch 追加先例 |
| P1 (important) | [.claude/PRPs/plans/completed/phase-4.17-default-seats-per-table.plan.md](../01-allin-timer/completed/phase-4.17-group-default-seats-per-table.plan.md) | all | group へのフィールド additive 追加と inline edit UI の最直近先例 |
| P1 (important) | [.claude/PRPs/plans/completed/phase-5.4-clone-tournament-with-players.plan.md](../01-allin-timer/completed/phase-5.4-clone-tournament-with-players.plan.md) | all | `tournaments/{tid}` 配下 subcollection に explicit rule を増やすときの設計 |
| P1 (important) | [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | 557-642 | `finishTournament` の tx mock pattern（`mockFinishTransaction`）。seasonStats 拡張に追従 |
| P1 (important) | [src/lib/services/timer.test.ts](../../../../src/lib/services/timer.test.ts) | all | 純関数のテスト構造、`makeTournament` factory（characterization test ファースト規約） |
| P1 (important) | [src/lib/firebase/repositories/groups.test.ts](../../../../src/lib/firebase/repositories/groups.test.ts) | 144-200 | `updateFinishedTournamentCount` / `updateDefaultSeatsPerTable` の test。`updateSeasonStartDate` を同形で追加 |
| P1 (important) | [src/lib/firebase/schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) | 309-594 | `groupBodySchema` の additive フィールド test pattern |
| P1 (important) | [scripts/test-rules-finished-count.mjs](../../../../scripts/test-rules-finished-count.mjs) | all | emulator validator REST 直叩きの先例。`scripts/test-rules-season.mjs` を新設 |
| P1 (important) | [src/components/group/InlineNumberEditCard.tsx](../../../../src/components/group/InlineNumberEditCard.tsx) | all | 既存 inline edit カードの構造。本 phase はボタン + モーダルなので mirror せず別 component |
| P2 (reference) | [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) | 23-49 | `useCurrentGroup` の `groups` payload に新フィールド `seasonStartDate` が追加される伝搬経路 |
| P2 (reference) | [src/components/ui/dialog.tsx](../../../../src/components/ui/dialog.tsx) | all | shadcn dialog（既存 LeaveDeleteDialogs で利用）。確認モーダルで mirror |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firestore runTransaction の ops 上限 | https://firebase.google.com/docs/firestore/manage-data/transactions#limits_to_transactions_and_batched_writes | 1 tx で最大 500 docs まで write。20 人 + 1 tournament + 1 group = 22 ops で十分余裕 |
| Firestore runTransaction の re-read | https://firebase.google.com/docs/firestore/manage-data/transactions#transactions | tx 内の `tx.get(ref)` は同一 tx 内で再評価される（tournament の state 再 read で二重 increment 防止に使う既存パターン） |
| Firestore subcollection rule path | https://firebase.google.com/docs/firestore/security/rules-structure#match_paths | `match /groups/{gid}/seasonStats/{uid}` のように explicit に書く（CLAUDE.md / firebase-patterns.md の wildcard 厳禁規約に従う） |
| Math.sqrt の浮動小数点精度 | IEEE 754 double 仕様 | `sqrt(6/8) ≈ 0.8660254...` を毎回 `Math.round(v * 100) / 100` で 2 桁丸めすれば 1000 回加算しても誤差は累積しない（`8.66 + 8.66 + ...` は丸め後の有限小数の整合加算）。tx 内の保存値も常に 2 桁で固定 |

KEY_INSIGHT: Firestore で複数 doc を 1 tx 内で書くとき、tx を構築する前に `tx.get()` で全員分を読み終えてから `tx.update()` / `tx.set()` を発行する必要がある（read-then-write 順序）。本 phase の `finishTournament` 拡張も「tx 内で `tournaments/{tid}/players` を全件 `tx.get` → 順位導出 → 全員の `seasonStats/{uid}` を `tx.set` で increment」の順序を守る。

GOTCHA: `tx.get(query(...))` は **collection query を tx 経由で実行できない**（Web SDK の制約）。`getDocs(playersRef(tid))` を tx 外で実行すると整合性が落ちる。回避策として `assertCanManage` 後の事前 read で player 一覧を取得し、tx 内では各 player の **doc 個別 `tx.get`** で確認する設計を取る — または「事前 read で順位を確定し、tx 内では tournament state 再 read のみ行う」。本 phase は後者を採用する（tournament が finished 状態を tx 内で再 read で防御 + 事前 read 順位確定で十分。複数端末の同時 finish race は state 再 read で deny される）。

GOTCHA: Web SDK の Firestore は number を IEEE 754 double で保持する。`8.66 + 8.66 + ...` を毎回 `Math.round(v * 100) / 100` で正規化すれば、1000 回加算しても 47.83 のような有限小数で安定する。`base[rank]` を `[10, 7, 5, 3, 1, 1, 1, 1, 1]` の整数に絞っているため、入力側に小数誤差源は無い。

GOTCHA: `seasonStats/{uid}` の `uid` は `auth.uid` ではなく **player の `uid` フィールド**（つまり `players/{pid}.uid`）。pid==uid invariant が rules で強制されているため `pid` をそのまま使ってよい（[firestore.rules#L336-L358](../../../../firestore.rules#L336-L358)）。

---

## Patterns to Mirror

### NAMING_CONVENTION（schema additive 追加）

```typescript
// SOURCE: src/lib/firebase/schemas/group.ts:81-91
defaultSeatsPerTable: z
  .number()
  .int()
  .min(MIN_SEATS_PER_TABLE)
  .max(MAX_SEATS_PER_TABLE)
  .default(DEFAULT_SEATS_PER_TABLE),
```

`seasonStartDate` を同形で additive 追加（`Timestamp.nullable().default(null)`）。

### REPOSITORY_PATTERN（wrap helper）

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:272-295
export async function updateDefaultSeatsPerTable(
  gid: string,
  value: number,
): Promise<void> {
  if (
    !Number.isInteger(value) ||
    value < MIN_SEATS_PER_TABLE ||
    value > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/default-seats-invalid",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "デフォルト席数の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { defaultSeatsPerTable: value });
    },
    { gid },
  );
  logger.info("group defaultSeatsPerTable updated", { gid, value });
}
```

`updateSeasonStartDate(gid, date)` を同パターンで追加。

### SERVICE_PATTERN（assertOrganizer + repository 経由）

```typescript
// SOURCE: src/lib/services/group.ts:289-308
export async function setFinishedTournamentCount({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      "開催数は 0 以上の整数で指定してください",
      "validation/finished-count-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateFinishedTournamentCount(gid, value);
  logger.info("setFinishedTournamentCount ok", { gid, uid, value });
}
```

`startNewSeason({ gid, uid })` は assertOrganizer 後、`runTransaction` 内で snapshot copy + reset + seasonStartDate 更新を atomic に行う（後述）。

### TX_PATTERN（runTransaction + tx 内再 read）

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:550-583
export async function finishTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (isFinished(t)) return;
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "終了処理に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const cur = await loadTournamentInTx(tx, tid, userGroupIds);
        const ref = doc(tournamentsRef, tid);
        if (isFinished(cur)) {
          logger.info("tournament finish skipped (race)", { tid, uid });
          return;
        }
        tx.update(ref, {
          state: "finished",
          finishedAt: serverTimestamp(),
          pausedAt: null,
          updatedAt: serverTimestamp(),
        });
        tx.update(doc(firestore, "groups", cur.groupId), {
          finishedTournamentCount: increment(1),
        });
      });
    },
    { tid },
  );
  logger.info("tournament finish ok", { tid, uid, gid: t.groupId });
}
```

本 phase で `finishTournament` を拡張: **事前 read で player 一覧と順位を確定** → tx 内で state guard + 全員分の `seasonStats/{uid}` を `tx.set({ merge: true })` で増分。

### FIRESTORE_RULE_PATTERN（subcollection explicit）

```firestore-rules
// SOURCE: firestore.rules:440-445
match /tables/{tableId} {
  allow read: if isSignedIn();
  allow write: if isSignedIn()
               && exists(/databases/$(database)/documents/tournaments/$(tid))
               && isOrganizer(get(/databases/$(database)/documents/tournaments/$(tid)).data.groupId);
}
```

本 phase で追加（`groups/{gid}` 配下に subcollection を新設）:

```firestore-rules
// 本 phase: シーズン戦績（読み: メンバー全員 / 書き: organizer のみ、tx 内のみ実体的に発生）
match /groups/{gid}/seasonStats/{uid} {
  allow read: if isGroupMember(gid);
  // organizer の write を許可（finishTournament tx と startNewSeason tx の 2 経路）。
  // 値域 / 型は zod schema に委譲し、rule では affectedKeys 範囲だけ最低限担保する。
  allow create, update, delete: if isOrganizer(gid);
}

match /groups/{gid}/seasonHistory/{seasonId} {
  allow read: if isGroupMember(gid);
  allow create: if isOrganizer(gid);
  // 履歴の書換 / 削除は禁止（improper rollback を塞ぐ）。
  allow update, delete: if false;
}
```

### GROUPS_UPDATE_BRANCH（allowed-keys 拡張）

```firestore-rules
// SOURCE: firestore.rules:207-221（Phase 4.17 で追加された defaultSeatsPerTable branch）
) || (
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['defaultSeatsPerTable'])
  && request.resource.data.defaultSeatsPerTable is int
  && request.resource.data.defaultSeatsPerTable >= 2
  && request.resource.data.defaultSeatsPerTable <= 10
);
```

本 phase で `seasonStartDate` 用 branch を追加（owner branch は既に許可しているので organizer 経路のみ拡張）:

```firestore-rules
) || (
  // 本 phase: organizer による seasonStartDate の単独書換。
  // startNewSeason() の runTransaction で `seasonStartDate = serverTimestamp()` 経由で発火。
  // affectedKeys は 'seasonStartDate' のみに限定。Timestamp 型のみ強制（null は startNewSeason では設定しない）。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['seasonStartDate'])
  && request.resource.data.seasonStartDate is timestamp
)
```

### PURE_FUNCTION_PATTERN（characterization test ファースト）

```typescript
// SOURCE: src/lib/services/timer.ts:79-90
export function resolveWinner(
  tournament: TournamentDoc,
  players: readonly PlayerDoc[],
): PlayerDoc | null {
  const isRunningOrPaused = tournament.state === "running" || tournament.state === "paused";
  const isFinished = tournament.state === "finished";
  if (!isRunningOrPaused && !isFinished) return null;
  if (players.length < 2) return null;
  const active = players.filter((p) => !p.isBusted);
  if (active.length !== 1) return null;
  return active[0];
}
```

本 phase で `resolveRanking(players)` を timer.ts に追加（純関数）:
- 全 player を「未バスト → busted で `bustedAt` desc」の順で並べ、1 位から N 位までの ranking を返す
- 同タイ（`bustedAt` が同 ms）の場合は `entryAt` asc を二次キー
- 戻り値は `{ pid: string; rank: number; uid: string | null; displayName: string }[]`

### REPOSITORY_TEST_MOCK_PATTERN（runTransaction）

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:557-577
function mockFinishTransaction(
  txState: TournamentDoc | null,
  captureUpdate?: (ref: unknown, patch: Record<string, unknown>) => void,
) {
  vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
    const tx = {
      get: vi.fn().mockResolvedValue({
        exists: () => txState !== null,
        id: txState?.id ?? "missing",
        data: () => (txState ? stripId(txState) : undefined),
      }),
      update: vi.fn((ref, patch) =>
        captureUpdate?.(ref, patch as Record<string, unknown>),
      ),
      set: vi.fn(),
      delete: vi.fn(),
    };
    await fn(tx as unknown as Parameters<typeof fn>[0]);
    return undefined as unknown;
  });
}
```

`finishTournament` の seasonStats 拡張テストでは、`tx.set` の呼び出し回数（参加者数 ＋ tournament + group の 2）を assert する。

### TEST_STRUCTURE（純関数 fixture factory）

```typescript
// SOURCE: src/lib/services/timer.test.ts:12-43
function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    /* ... */
    ...overrides,
  };
}
```

本 phase で `makePlayer(overrides)` factory を追加し、`resolveRanking` / `calcSeasonPoints` のテストで再利用する。

### EMULATOR_VALIDATOR_PATTERN

```javascript
// SOURCE: scripts/test-rules-finished-count.mjs
async function expectAllow(label, fn) {
  const r = await fn();
  if (r.ok) results.push({ label, status: "PASS (allow)" });
  else results.push({ label, status: `FAIL (expected allow, got ${r.status}): ...` });
}
async function expectDeny(label, fn) {
  const r = await fn();
  if (r.status === 403) results.push({ label, status: "PASS (deny 403)" });
  else if (r.ok) results.push({ label, status: `FAIL (expected deny, got ${r.status})` });
  else results.push({ label, status: `FAIL (expected 403, got ${r.status}): ...` });
}
```

`scripts/test-rules-season.mjs` を新規追加し、`seasonStats` / `seasonHistory` / `groups.seasonStartDate` の 3 領域を REST 直叩きで検証する。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/lib/limits.ts](../../../../src/lib/limits.ts) | UPDATE | `DEFAULT_SEATS_PER_TABLE` を 9→8 へ。`SEASON_POINTS_BASE` (= `[10,7,5,3,1,1,1,1,1]`) と `SEASON_POINTS_BASELINE_PARTICIPANTS` (= 8) と `SEASON_FINAL_TABLE_THRESHOLD` (= 9) を新設 |
| [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | UPDATE | `seasonStartDate: z.instanceof(Timestamp).nullable().default(null)` を additive 追加 |
| [src/lib/firebase/schemas/seasonStats.ts](../../../../src/lib/firebase/schemas/seasonStats.ts) | CREATE | `seasonStatsBodySchema`（`participations` / `wins` / `finalTables` / `totalPoints` / `displayName` / `lastUpdatedAt`）+ `SeasonStatsDoc` 型 |
| [src/lib/firebase/schemas/seasonHistory.ts](../../../../src/lib/firebase/schemas/seasonHistory.ts) | CREATE | `seasonHistoryBodySchema`（`startedAt` / `endedAt` / `entries: { uid, displayName, participations, wins, finalTables, totalPoints }[]`）+ `SeasonHistoryDoc` 型 |
| [src/lib/services/season-points.ts](../../../../src/lib/services/season-points.ts) | CREATE | 純関数 `calcSeasonPoints(rank, totalParticipants)`、`isFinalTable(rank)`、`SEASON_POINTS_BASE` import |
| [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | UPDATE | `resolveRanking(players)` 純関数を追加（既存 `resolveWinner` の隣に） |
| [src/lib/firebase/repositories/seasonStats.ts](../../../../src/lib/firebase/repositories/seasonStats.ts) | CREATE | `subscribeSeasonStats(gid, onNext, onError)` / `listSeasonStats(gid)` / `seasonStatsRef(gid)` / `seasonStatsDocRef(gid, uid)` |
| [src/lib/firebase/repositories/seasonHistory.ts](../../../../src/lib/firebase/repositories/seasonHistory.ts) | CREATE | `listSeasonHistory(gid)` / `seasonHistoryRef(gid)` |
| [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | UPDATE | `updateSeasonStartDate(gid, date)` を追加（rule branch で組織者のみ書換可、Timestamp 型のみ） |
| [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | UPDATE | `finishTournament` を拡張: 事前 read で順位確定 → tx 内で全員の `seasonStats/{uid}` を `tx.set({merge:true})` で増分（小数 加算は事前計算済みの値を直接 set） |
| [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | UPDATE | `startNewSeason({ gid, uid })` を新設（assertOrganizer + runTransaction で stats → history snapshot + stats reset + seasonStartDate 更新） |
| [firestore.rules](../../../../firestore.rules) | UPDATE | (1) `seasonStartDate` 単独書換 branch を groups update に追加、(2) `match /groups/{gid}/seasonStats/{uid}` explicit rule、(3) `match /groups/{gid}/seasonHistory/{seasonId}` explicit rule |
| [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | UPDATE | 「シーズン」カード追加: 開始日表示 + ランキングへの導線（全メンバー）+ 「シーズンを開始する」ボタン + 確認モーダル（owner / organizer のみ） |
| [src/app/groups/[gid]/_components/SeasonCard.tsx](../../../../src/app/groups/%5Bgid%5D/_components/SeasonCard.tsx) | CREATE | シーズン管理カード本体 component（GroupDetailClient から切り出し） |
| [src/app/groups/[gid]/_components/StartSeasonDialog.tsx](../../../../src/app/groups/%5Bgid%5D/_components/StartSeasonDialog.tsx) | CREATE | シーズン開始確認モーダル（既存 LeaveDeleteDialogs と同形 shadcn Dialog） |
| [src/app/groups/[gid]/season/page.tsx](../../../../src/app/groups/%5Bgid%5D/season/page.tsx) | CREATE | シーズンランキング画面 entry（server component → client wrap） |
| [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/%5Bgid%5D/season/season-ranking-client.tsx) | CREATE | `subscribeSeasonStats` を呼び `totalPoints desc` で並べたランキング表 |
| [src/lib/firebase/schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) | UPDATE | `groupBodySchema` の `defaultSeatsPerTable` default 期待値を 9→8 に変更。`seasonStartDate` の additive default null + Timestamp 受容ケース 3 件追加 |
| [src/lib/firebase/repositories/seasonStats.test.ts](../../../../src/lib/firebase/repositories/seasonStats.test.ts) | CREATE | `subscribeSeasonStats` / `listSeasonStats` の SDK mock test |
| [src/lib/firebase/repositories/seasonHistory.test.ts](../../../../src/lib/firebase/repositories/seasonHistory.test.ts) | CREATE | `listSeasonHistory` の test |
| [src/lib/firebase/repositories/groups.test.ts](../../../../src/lib/firebase/repositories/groups.test.ts) | UPDATE | `updateSeasonStartDate` の happy / 型エラー / wrap test を追加 |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | UPDATE | `finishTournament` の seasonStats 拡張: tx.set が「参加者数」回呼ばれること、空参加・全員バストパターンの境界を assert |
| [src/lib/services/season-points.test.ts](../../../../src/lib/services/season-points.test.ts) | CREATE | 6 / 8 / 16 / 20 人参加の各順位での `calcSeasonPoints` 期待値、累積誤差チェック（1000 回加算） |
| [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | UPDATE | `startNewSeason` の owner / organizer / member 3 ケース + tx mock |
| [src/lib/services/timer.test.ts](../../../../src/lib/services/timer.test.ts) | UPDATE | `resolveRanking` の 6 ケース（全員 active / 1 人勝ち / 全員バスト / 同 ms タイ / 単独参加 / 5 人ランダム） |
| [scripts/test-rules-season.mjs](../../../../scripts/test-rules-season.mjs) | CREATE | emulator 検証 — seasonStats CRUD、seasonHistory append-only、seasonStartDate organizer-only、affectedKeys 違反 deny |
| [scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs) | UPDATE | `DEFAULT_SEATS_PER_TABLE` の expected を 9→8、`SEASON_POINTS_BASELINE_PARTICIPANTS` の checks を追加（drift 検知） |
| [package.json](../../../../package.json) | UPDATE | `scripts.test:rules-season` を追加（`firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e "node scripts/test-rules-season.mjs"`） |
| [.claude/rules/group-membership.md](../../../rules/group-membership.md) | UPDATE | データモデル節に `seasonStartDate` を追記、allowed-keys 表に追加、権限マトリクスに「シーズン開始（owner / organizer）/ 戦績参照（全員）」を追加 |
| [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | UPDATE | `seasonStats` / `seasonHistory` の rule 設計（explicit subcollection rule の追加例として記載） |
| [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md) | UPDATE | Phase A の status を `pending` → `in-progress` に、PRP Plan 列に本ファイルへのリンクを追加 |

## NOT Building

- **過去開催分の backfill（自動）** — 既存の終了済み tournaments から遡って seasonStats を再計算しない。運営者が必要なら「シーズンを開始する」前に手動で seasonStats doc を直接編集できる将来 UI（次フェーズ）で対応
- **ポイント計算式のサークル別カスタマイズ** — `base[]` 配列と baseline=8 はハードコード。`groups/{gid}.seasonPointsRule` の自由化は次フェーズ
- **シーズン跨ぎの個人 all-time 集計** — 現在シーズン + `seasonHistory` の閲覧で十分。`users/{uid}.allTimeStats` のような集約は次フェーズ
- **シーズン履歴の保持上限・自動削除** — Open Question 化したまま無制限保持。MVP は seasonHistory に doc を append し続ける（20 人 × 月 1 シーズンで Firestore コスト無視可能）
- **シーズン履歴一覧 UI** — Phase D で polish 対象。本 Phase A では `seasonHistory/{seasonId}` を保存するだけで閲覧 UI は作らない
- **`seasonStartDate` の手動編集 UI** — 運営者が任意の過去日に書き換える機能は提供しない（誤操作で history と stats の整合が崩れるため）。`startNewSeason` 経由の serverTimestamp() のみで更新
- **同卓内の同 ms バスト時の rank 厳密一意化** — `entryAt` を tiebreak に使うが、それも同 ms なら pid asc で安定化。MVP では LINE 上の順位告知が ±1 位ずれることを許容
- **PD（playing dealer）への加点ロジック** — 順位判定のみ。PD ボーナスは別 phase
- **観戦モードからの seasonStats 閲覧** — read rule は `isGroupMember(gid)` のため非メンバーは閲覧不可。観戦モード自体が未実装
- **`finishTournament` の倒立 race ガード（finish と startNewSeason の同時実行）** — startNewSeason 中の同時 finish は「seasonStats reset 直後に新シーズンの初回更新が乗る」だけで整合性は保たれる。整合崩れケースは tournament 終了 + シーズン切替の人手の同時操作で確率的に低い

---

## Step-by-Step Tasks

### Task 1: 純関数 `calcSeasonPoints` + テスト先行投入

- **ACTION**: [src/lib/services/season-points.ts](../../../../src/lib/services/season-points.ts) を新規作成し、[src/lib/services/season-points.test.ts](../../../../src/lib/services/season-points.test.ts) を先に書いて green を確認する（characterization test ファースト）
- **IMPLEMENT**:
  ```typescript
  // src/lib/limits.ts に追加
  export const SEASON_POINTS_BASE: readonly number[] = [10, 7, 5, 3, 1, 1, 1, 1, 1];
  export const SEASON_POINTS_BASELINE_PARTICIPANTS = 8;
  /** 順位 N 位までを「ファイナルテーブル進出」と見なす上限。9 人卓 NLH で 9 位以内。 */
  export const SEASON_FINAL_TABLE_THRESHOLD = 9;

  // src/lib/services/season-points.ts
  import {
    SEASON_POINTS_BASE,
    SEASON_POINTS_BASELINE_PARTICIPANTS,
    SEASON_FINAL_TABLE_THRESHOLD,
  } from "@/lib/limits";

  /**
   * 順位 + 参加人数からシーズンポイントを算出する純関数。
   * 式: base[rank-1] × sqrt(participants / baseline)
   * - rank は 1-based。SEASON_POINTS_BASE.length (= 9) を超える順位は 0pt。
   * - 戻り値は小数 2 桁で丸める（毎回保存値と表示値を 2 桁に揃え、累積誤差を抑制）。
   */
  export function calcSeasonPoints(rank: number, totalParticipants: number): number {
    if (!Number.isInteger(rank) || rank < 1) return 0;
    if (!Number.isInteger(totalParticipants) || totalParticipants < 1) return 0;
    if (rank > SEASON_POINTS_BASE.length) return 0;
    const base = SEASON_POINTS_BASE[rank - 1];
    const factor = Math.sqrt(totalParticipants / SEASON_POINTS_BASELINE_PARTICIPANTS);
    return Math.round(base * factor * 100) / 100;
  }

  /** rank が「ファイナルテーブル」内かを判定する pure helper。 */
  export function isFinalTable(rank: number): boolean {
    return Number.isInteger(rank) && rank >= 1 && rank <= SEASON_FINAL_TABLE_THRESHOLD;
  }
  ```
- **MIRROR**: PURE_FUNCTION_PATTERN（`resolveWinner` の隣に配置する純関数構造）
- **IMPORTS**: `SEASON_POINTS_BASE` / `SEASON_POINTS_BASELINE_PARTICIPANTS` / `SEASON_FINAL_TABLE_THRESHOLD` を `@/lib/limits` から
- **GOTCHA**:
  - `Math.round(v * 100) / 100` は 2 桁丸めで切り捨てではなく **四捨五入**。PRD では「小数 2 桁固定」だが切捨か四捨五入か未確定なので **四捨五入** を採用（一般的かつ累計加算で誤差が両側に分散する）。`6 人 1 位 = 10 × sqrt(6/8) = 8.6602...` が `8.66` になることを test で固定
  - `participants < 1` は通常起こらないが、`finishTournament` を 0 人参加で呼ばれた場合の防衛で 0pt を返す（rank 不在）
  - `base[]` を `as const` 配列にせず `readonly number[]` でエクスポートしている理由は、`limits.ts` に他の `MAX_*` 定数と並列で置くため
- **VALIDATE**:
  - `npm test season-points.test.ts` で 6 / 8 / 16 / 20 人 × 1〜10 位の手計算値と一致
  - 1000 回 `8.66` を加算しても `8660.00` のまま（誤差累積なし）
  - `npm run typecheck` で型エラーなし

### Task 2: `resolveRanking` 純関数を timer.ts に追加 + テスト

- **ACTION**: [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) の `resolveWinner` の隣に追加。[src/lib/services/timer.test.ts](../../../../src/lib/services/timer.test.ts) に 6 ケース追加
- **IMPLEMENT**:
  ```typescript
  // src/lib/services/timer.ts に追加
  /**
   * 全 player から最終順位を導出する純関数。
   *
   * 順位ルール:
   *   1) 未バスト（active）プレイヤーが先頭。残り 1 人なら 1 位。複数残っているケース（途中状態）は
   *      呼出側が finished 後にしか呼ばないため通常起こらないが、防衛的に entryAt asc で安定化。
   *   2) バスト済みは bustedAt **降順**（後にバストした人ほど上位）。
   *   3) 同 ms タイは entryAt asc → pid asc を tiebreak とする（決定論的）。
   *
   * 戻り値は { pid, rank, uid, displayName }[]（1-based rank）。
   */
  export function resolveRanking(
    players: readonly PlayerDoc[],
  ): Array<{ pid: string; rank: number; uid: string | null; displayName: string }> {
    const sorted = [...players].sort((a, b) => {
      // 未バストを優先
      if (a.isBusted !== b.isBusted) return a.isBusted ? 1 : -1;
      // 両方未バスト: entryAt asc
      if (!a.isBusted && !b.isBusted) {
        return a.entryAt.toMillis() - b.entryAt.toMillis();
      }
      // 両方バスト: bustedAt desc（null は最後）
      const aBust = a.bustedAt?.toMillis() ?? 0;
      const bBust = b.bustedAt?.toMillis() ?? 0;
      if (aBust !== bBust) return bBust - aBust;
      // 同 ms タイ: entryAt asc
      const aEntry = a.entryAt.toMillis();
      const bEntry = b.entryAt.toMillis();
      if (aEntry !== bEntry) return aEntry - bEntry;
      // 最終 tiebreak: pid 文字列 asc
      return a.id.localeCompare(b.id);
    });
    return sorted.map((p, i) => ({
      pid: p.id,
      rank: i + 1,
      uid: p.uid,
      displayName: p.displayName,
    }));
  }
  ```
- **MIRROR**: `resolveWinner` の純関数シグネチャ + `players: readonly PlayerDoc[]` 引数型
- **IMPORTS**: 既存 `PlayerDoc` import で十分
- **GOTCHA**:
  - 同 ms タイは Firestore Timestamp の精度（ms 単位）に依存する。1 ms 内に 2 人バストしても tiebreak で安定化されるためテスト容易
  - `bustedAt: null` の active player は (`?? 0`) で最低位になるが、`a.isBusted !== b.isBusted` 分岐で先に弾かれるため到達しない
- **VALIDATE**:
  - timer.test.ts に追加した 6 ケース pass
  - 全員 active の場合は entryAt asc で並ぶ（途中状態の防衛）
  - 同 entryAt + 同 bustedAt + 同 pid prefix のときも順序が決定論的

### Task 3: schema 追加 — `seasonStartDate` を group に additive、`SeasonStats` / `SeasonHistory` を新設

- **ACTION**: 3 ファイル更新/新設
- **IMPLEMENT**:
  ```typescript
  // src/lib/firebase/schemas/group.ts に追加（defaultSeatsPerTable の隣）
  /**
   * Phase A: 現在シーズンの開始時刻。`startNewSeason()` の runTransaction で
   *   `seasonStartDate = serverTimestamp()` 経由で更新される。
   *   旧 doc（フィールド未保有）は default(null) で受容され、初回シーズン開始まで null。
   *   UI は null のとき「未設定」表示。
   */
  seasonStartDate: z.instanceof(Timestamp).nullable().default(null),
  ```

  ```typescript
  // src/lib/firebase/schemas/seasonStats.ts（新規）
  import { Timestamp } from "firebase/firestore";
  import { z } from "zod";

  import { DISPLAY_NAME_MAX_LENGTH } from "./group";

  /**
   * Phase A: `groups/{gid}/seasonStats/{uid}` のスキーマ。
   *   doc id は player の uid（== `players/{pid}.uid`、pid==uid invariant）。
   *   `totalPoints` は小数 2 桁で保持（calcSeasonPoints の戻り値と同精度）。
   */
  export const seasonStatsBodySchema = z.object({
    /** uid は doc id と冗長だが、subscribe 時の集計とフィルタ用途で保持する。 */
    uid: z.string().min(1),
    /** 集計対象トーナメント終了時点の表示名 snapshot（rename 追従はしない）。 */
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    /** 参加トーナメント数。finishTournament tx で +1 増分される。 */
    participations: z.number().int().nonnegative(),
    /** 優勝（rank == 1）回数。 */
    wins: z.number().int().nonnegative(),
    /** ファイナルテーブル進出（rank <= SEASON_FINAL_TABLE_THRESHOLD）回数。 */
    finalTables: z.number().int().nonnegative(),
    /** 累計ポイント（小数 2 桁）。 */
    totalPoints: z.number().nonnegative(),
    /** 直近の更新時刻（最新の終了 tournament の finishedAt）。 */
    lastUpdatedAt: z.instanceof(Timestamp),
  });
  type SeasonStatsBody = z.infer<typeof seasonStatsBodySchema>;
  export type SeasonStatsDoc = SeasonStatsBody & { id: string };
  ```

  ```typescript
  // src/lib/firebase/schemas/seasonHistory.ts（新規）
  import { Timestamp } from "firebase/firestore";
  import { z } from "zod";

  import { DISPLAY_NAME_MAX_LENGTH } from "./group";

  /**
   * Phase A: `groups/{gid}/seasonHistory/{seasonId}` のスキーマ。
   *   `startNewSeason()` の runTransaction で「現在 seasonStats 全件 + seasonStartDate」を
   *   1 doc に snapshot して append する。doc id は `seasonStartDate` の ISO string か
   *   `crypto.randomUUID()`（service 側で確定）。
   */
  export const seasonHistoryEntrySchema = z.object({
    uid: z.string().min(1),
    displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
    participations: z.number().int().nonnegative(),
    wins: z.number().int().nonnegative(),
    finalTables: z.number().int().nonnegative(),
    totalPoints: z.number().nonnegative(),
  });
  export const seasonHistoryBodySchema = z.object({
    /** 当該シーズンの開始時刻（snapshot 時点の groups.seasonStartDate）。 */
    startedAt: z.instanceof(Timestamp).nullable(),
    /** snapshot を作成した時刻（= 新シーズン開始時刻）。 */
    endedAt: z.instanceof(Timestamp),
    /** 全参加メンバーの最終 stats。totalPoints desc で並べる際は read 側で sort。 */
    entries: z.array(seasonHistoryEntrySchema),
  });
  type SeasonHistoryBody = z.infer<typeof seasonHistoryBodySchema>;
  export type SeasonHistoryDoc = SeasonHistoryBody & { id: string };
  ```
- **MIRROR**: NAMING_CONVENTION（`audioSettings` / `defaultSeatsPerTable` の additive default パターン）
- **IMPORTS**: `Timestamp` を `firebase/firestore` から、`z` を `zod` から、`DISPLAY_NAME_MAX_LENGTH` を `./group` から
- **GOTCHA**:
  - `groupBodySchema` には既に `.refine(...)` が 2 段あるが、`seasonStartDate` は invariant 制約と無関係なので追加 refine は不要
  - `entries` array に max 制約を付けない（メンバー数 = `groups.memberUids.length` で実質的に上限。20 人規模なら問題なし）
  - `displayName` の長さ上限は `DISPLAY_NAME_MAX_LENGTH = 15` に揃える（rename 後でも snapshot 時点の値を保持するので長さ違反は起きない設計）
- **VALIDATE**:
  - `groupBodySchema.parse(legacyDoc)` が `seasonStartDate: null` で成功（schema test）
  - `seasonStatsBodySchema.parse(...)` が `participations: -1` で fail
  - `npm run typecheck` 完了

### Task 4: `DEFAULT_SEATS_PER_TABLE` を 9 → 8 に変更

- **ACTION**: [src/lib/limits.ts](../../../../src/lib/limits.ts) の定数値を変更。schema test 期待値も連動更新
- **IMPLEMENT**:
  ```typescript
  // src/lib/limits.ts:27 を変更
  /** 新規作成画面の `seatsPerTable` 既定値。Phase A: シーズンポイント baseline=8 と一致。 */
  export const DEFAULT_SEATS_PER_TABLE = 8;
  ```
- **MIRROR**: 既存定数とコメントスタイルを維持
- **IMPORTS**: なし
- **GOTCHA**:
  - 既存 group の保存値は影響なし（zod default は新規 hydrate 時のみ適用）
  - `firestore.rules` の `defaultSeatsPerTable >= 2 && <= 10` は値域なので変更不要
  - schema test [src/lib/firebase/schemas/index.test.ts:544](../../../../src/lib/firebase/schemas/index.test.ts#L544) の `expect(parsed.defaultSeatsPerTable).toBe(9)` を `8` に変更
  - `groups.test.ts` で `createGroup` が `defaultSeatsPerTable: 9` を addDoc に渡しているケースは存在しないか確認（リポジトリ側は `DEFAULT_SEATS_PER_TABLE` 定数経由なので自動追従）
  - ⚠ DRIFT WARNING: PRD の `firebase-patterns.md` で `defaultSeatsPerTable` の上限・下限を `firestore.rules` と連動するよう要求。本変更は default 値のみで rule 側は不変
- **VALIDATE**:
  - `npm test schemas/index.test.ts` で `defaults defaultSeatsPerTable to 8` の expectation pass
  - `npm run test:rules-limits` で drift なし
  - 手動: 新規 group 作成 → `/tournaments/new` の席数初期値が 8

### Task 5: `groups.repositories` に `updateSeasonStartDate` を追加

- **ACTION**: [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) に追加
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase A: groups/{gid}.seasonStartDate を Timestamp で上書きする。
   *   - `startNewSeason()` の runTransaction 内では `tx.update(ref, { seasonStartDate: serverTimestamp() })`
   *     を直接書くため、本関数は標準フローでは使われない（テスト・運用補正用の保険）。
   *   - rule は organizer 以上で `affectedKeys().hasOnly(['seasonStartDate'])` + `is timestamp` を強制。
   */
  export async function updateSeasonStartDate(
    gid: string,
    date: Timestamp,
  ): Promise<void> {
    if (!(date instanceof Timestamp)) {
      throw new AppError(
        "seasonStartDate は Timestamp で指定してください",
        "validation/season-start-invalid",
      );
    }
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "シーズン開始日の更新に失敗しました",
      async () => {
        await updateDoc(groupDocRef(gid), { seasonStartDate: date });
      },
      { gid },
    );
    logger.info("group seasonStartDate updated", { gid });
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN（`updateFinishedTournamentCount` / `updateDefaultSeatsPerTable`）
- **IMPORTS**: `Timestamp` を `firebase/firestore` から（既存 import に追加）
- **GOTCHA**: 通常経路は `startNewSeason` の tx 内で `serverTimestamp()` を使うため、本関数の使用箇所は test mock とリカバリ系のみ
- **VALIDATE**: `groups.test.ts` に追加テスト 3 件（happy path / non-Timestamp 拒否 / wrap）pass

### Task 6: `seasonStats` / `seasonHistory` repository を新設

- **ACTION**: 2 ファイル新規作成
- **IMPLEMENT**:
  ```typescript
  // src/lib/firebase/repositories/seasonStats.ts
  import {
    collection,
    doc,
    onSnapshot,
    orderBy,
    query,
  } from "firebase/firestore";

  import { AppError } from "@/lib/errors";
  import { firestore } from "@/lib/firebase/client";
  import { zodConverter } from "@/lib/firebase/converters";
  import {
    seasonStatsBodySchema,
    type SeasonStatsDoc,
  } from "@/lib/firebase/schemas/seasonStats";
  import { wrapFirestoreRead } from "@/lib/firebase/wrap";

  export function seasonStatsRef(gid: string) {
    return collection(firestore, "groups", gid, "seasonStats").withConverter(
      zodConverter(seasonStatsBodySchema, `groups/${gid}/seasonStats`),
    );
  }

  export function seasonStatsDocRef(gid: string, uid: string) {
    return doc(seasonStatsRef(gid), uid);
  }

  /**
   * 一覧取得。`totalPoints desc + lastUpdatedAt desc` の複合 index 回避のため
   * read 側で sort する（小規模サークルなら数十件で十分）。
   */
  export async function listSeasonStats(gid: string): Promise<SeasonStatsDoc[]> {
    return wrapFirestoreRead(
      "firestore/read_failed",
      "シーズン戦績取得に失敗しました",
      async () => {
        const { getDocs } = await import("firebase/firestore");
        const snap = await getDocs(seasonStatsRef(gid));
        const items: SeasonStatsDoc[] = [];
        for (const d of snap.docs) {
          try {
            items.push({ id: d.id, ...d.data() });
          } catch (e) {
            // 旧スキーマ doc 等は skip（listTournamentsByGroup と同方針）
            const wrapped = AppError.from(e, "firestore/invalid-data", "不正なデータ");
            // logger は import 済み前提
            const { logger } = await import("@/lib/logger");
            logger.warn("seasonStats list skipped invalid doc", {
              gid,
              uid: d.id,
              code: wrapped.code,
            });
          }
        }
        items.sort((a, b) => b.totalPoints - a.totalPoints);
        return items;
      },
      { gid },
    );
  }

  /**
   * onSnapshot で realtime 購読。orderBy は付けず client 側 sort（複合 index 回避）。
   */
  export function subscribeSeasonStats(
    gid: string,
    onNext: (items: SeasonStatsDoc[]) => void,
    onError: (err: AppError) => void,
  ): () => void {
    return onSnapshot(
      seasonStatsRef(gid),
      (snap) => {
        try {
          const items: SeasonStatsDoc[] = [];
          for (const d of snap.docs) {
            try {
              items.push({ id: d.id, ...d.data() });
            } catch {
              // skip invalid
            }
          }
          items.sort((a, b) => b.totalPoints - a.totalPoints);
          onNext(items);
        } catch (e) {
          onError(AppError.from(e, "firestore/invalid-data", "シーズン戦績データが不正です"));
        }
      },
      (err) => onError(AppError.from(err, "firestore/subscribe_failed", "シーズン戦績購読エラー")),
    );
  }
  // 注: orderBy import は使わないが API 互換のため保持
  void [orderBy, query];
  ```

  ```typescript
  // src/lib/firebase/repositories/seasonHistory.ts
  import {
    collection,
    doc,
    getDocs,
  } from "firebase/firestore";

  import { AppError } from "@/lib/errors";
  import { firestore } from "@/lib/firebase/client";
  import { zodConverter } from "@/lib/firebase/converters";
  import {
    seasonHistoryBodySchema,
    type SeasonHistoryDoc,
  } from "@/lib/firebase/schemas/seasonHistory";
  import { wrapFirestoreRead } from "@/lib/firebase/wrap";
  import { logger } from "@/lib/logger";

  export function seasonHistoryRef(gid: string) {
    return collection(firestore, "groups", gid, "seasonHistory").withConverter(
      zodConverter(seasonHistoryBodySchema, `groups/${gid}/seasonHistory`),
    );
  }

  export function seasonHistoryDocRef(gid: string, seasonId: string) {
    return doc(seasonHistoryRef(gid), seasonId);
  }

  /**
   * 過去シーズンの履歴一覧。`endedAt desc` で client 側 sort。
   * 個別 doc が schema validate に失敗しても全体を落とさず該当 doc のみ skip。
   */
  export async function listSeasonHistory(gid: string): Promise<SeasonHistoryDoc[]> {
    return wrapFirestoreRead(
      "firestore/read_failed",
      "シーズン履歴取得に失敗しました",
      async () => {
        const snap = await getDocs(seasonHistoryRef(gid));
        const items: SeasonHistoryDoc[] = [];
        for (const d of snap.docs) {
          try {
            items.push({ id: d.id, ...d.data() });
          } catch (e) {
            const wrapped = AppError.from(e, "firestore/invalid-data", "不正なデータ");
            logger.warn("seasonHistory list skipped invalid doc", {
              gid,
              seasonId: d.id,
              code: wrapped.code,
            });
          }
        }
        items.sort((a, b) => b.endedAt.toMillis() - a.endedAt.toMillis());
        return items;
      },
      { gid },
    );
  }
  ```
- **MIRROR**: REPOSITORY_PATTERN（[tables.ts](../../../../src/lib/firebase/repositories/tables.ts) の `tablesRef` / `subscribeTables`、[tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) の `listTournamentsByGroup` の skip-invalid-doc パターン）
- **IMPORTS**: `wrapFirestoreRead` を `@/lib/firebase/wrap` から
- **GOTCHA**:
  - `seasonStats` の write 経路は `finishTournament` tx と `startNewSeason` tx の **2 つしかない**ため、本 repository に `setSeasonStats` 等は追加しない。tx 内で `tx.set(seasonStatsDocRef(gid, uid), {...})` を直接書く
  - `subscribeSeasonStats` は `onSnapshot` の onNext callback 内 try/catch で個別 doc skip するパターン（[tournaments.ts#L633-L664](../../../../src/lib/firebase/repositories/tournaments.ts#L633-L664) と同形）
  - dynamic import (`await import(...)`) は本 phase では使わず、上部 import に揃える（既存スタイル一貫性）
- **VALIDATE**:
  - `seasonStats.test.ts` / `seasonHistory.test.ts` の SDK mock テスト pass
  - `npm run typecheck` 完了

### Task 7: Firestore Rules を拡張（4 ブランチ追加）

- **ACTION**: [firestore.rules](../../../../firestore.rules) を更新
- **IMPLEMENT**:
  ```firestore-rules
  // (1) groups/{gid} update に `seasonStartDate` 単独書換 branch を追加
  //     既存の defaultSeatsPerTable branch（L207-221）の後に OR で追加。最終 `;` の付替に注意。
  ) || (
    // Phase A: organizer による seasonStartDate の単独書換。
    //   startNewSeason() の runTransaction で `seasonStartDate = serverTimestamp()` 経由で発火。
    //   affectedKeys は 'seasonStartDate' のみ。Timestamp 型のみ強制（null は startNewSeason では設定しない）。
    isOrganizer(gid)
    && request.resource.data.diff(resource.data).affectedKeys()
         .hasOnly(['seasonStartDate'])
    && request.resource.data.seasonStartDate is timestamp
  );

  // (2) groups/{gid} の閉じ } の直前（L225 の delete の後）に subcollection rule を追加
  // groups/{gid}/seasonStats/{uid}: 読みは group メンバー、書きは organizer のみ。
  //   write 経路は finishTournament tx と startNewSeason tx の 2 つだけだが、rule は経路を区別しない。
  //   invariants（>= 0 / int / displayName 長さ等）は zod schema に委譲し、rule では型チェックのみ最低限。
  match /groups/{gid}/seasonStats/{uid} {
    allow read: if isGroupMember(gid);
    allow create, update: if isOrganizer(gid)
                          && request.resource.data.uid == uid
                          && request.resource.data.participations is int
                          && request.resource.data.participations >= 0
                          && request.resource.data.wins is int
                          && request.resource.data.wins >= 0
                          && request.resource.data.finalTables is int
                          && request.resource.data.finalTables >= 0
                          && request.resource.data.totalPoints is number
                          && request.resource.data.totalPoints >= 0
                          && request.resource.data.displayName is string
                          && request.resource.data.displayName.size() >= 1
                          && request.resource.data.displayName.size() <= 15;
    allow delete: if isOrganizer(gid);  // startNewSeason の reset 経路
  }

  // groups/{gid}/seasonHistory/{seasonId}: append-only（update / delete 禁止）。
  match /groups/{gid}/seasonHistory/{seasonId} {
    allow read: if isGroupMember(gid);
    allow create: if isOrganizer(gid)
                  && request.resource.data.endedAt is timestamp
                  && request.resource.data.entries is list;
    allow update, delete: if false;
  }
  ```
- **MIRROR**: FIRESTORE_RULE_PATTERN（既存 `match /tables/{tableId}` の explicit rule + 既存 organizer-only branch の affectedKeys.hasOnly パターン）
- **IMPORTS**: rule helper `isGroupMember(gid)` / `isOrganizer(gid)` は既に定義済み
- **GOTCHA**:
  - **wildcard 復活厳禁**: `match /groups/{gid}/{sub=**}` は使わない。各 subcollection に explicit rule を書く（[firebase-patterns.md](../../../rules/firebase-patterns.md) の subcollection 設計原則準拠）
  - `seasonHistory` の `update / delete: if false` は履歴改竄を rule 側で deny（`structureTemplates` の templateAdmins と同方針）
  - `seasonStats` の `delete` は `startNewSeason` の reset 経路で必要なので organizer に許可。rule で範囲制限は rule 言語の制約上 `affectedKeys` に頼れず、service 層で「全件削除しか発火させない」設計を担保する
  - `seasonStartDate` を null にする経路（owner が手動で「シーズンを取り消す」等）は本 phase では作らない。owner branch（フリーパス）でしか到達できない
  - rule 変更後は **必ず** `firebase emulators:exec` で `scripts/test-rules-season.mjs` を走らせて allow / deny 期待値を確認
- **VALIDATE**:
  - emulator: organizer が `update(groups/g1, { seasonStartDate: <Timestamp> })` allow
  - emulator: member が同じ書込 deny
  - emulator: organizer が `update(groups/g1, { seasonStartDate: <Timestamp>, name: "x" })` deny（affectedKeys 違反）
  - emulator: organizer が `seasonStats/{uid}` を invariant 違反（participations: -1）で create deny
  - emulator: member が `seasonHistory/{seasonId}` を read allow、create deny
  - emulator: organizer が `seasonHistory/{seasonId}` の既存 doc を update / delete deny

### Task 8: `finishTournament` を seasonStats 増分に拡張

- **ACTION**: [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) の `finishTournament` を更新
- **IMPLEMENT**:
  ```typescript
  // 既存 import に追加
  import { Timestamp } from "firebase/firestore";
  import { resolveRanking } from "@/lib/services/timer";
  import { calcSeasonPoints, isFinalTable } from "@/lib/services/season-points";
  import { listPlayers } from "@/lib/firebase/repositories/players"; // 後述（Task 8b）
  import { seasonStatsDocRef } from "@/lib/firebase/repositories/seasonStats";
  import { groupDocRef } from "@/lib/firebase/repositories/groups";

  export async function finishTournament(
    tid: string,
    uid: string,
    userGroupIds: string[],
  ): Promise<void> {
    const t = await assertCanManage(tid, userGroupIds);
    if (isFinished(t)) return;

    // 事前 read で参加者と順位を確定（tx 内で query は使えないため）。
    // tx 内では各 seasonStats doc を tx.get で個別取得して既存値に増分する。
    const players = await listPlayers(tid);
    const ranking = resolveRanking(players);
    const totalParticipants = ranking.length;
    const finishedAtClient = Timestamp.now(); // seasonStats.lastUpdatedAt 用（serverTimestamp は tx 内 set で使えない場合あり）

    await wrapFirestoreWrite(
      "firestore/write_failed",
      "終了処理に失敗しました",
      async () => {
        await runTransaction(firestore, async (tx) => {
          const cur = await loadTournamentInTx(tx, tid, userGroupIds);
          const ref = doc(tournamentsRef, tid);
          if (isFinished(cur)) {
            logger.info("tournament finish skipped (race)", { tid, uid });
            return;
          }

          // (A) 全 player の seasonStats/{uid} を tx 内で個別 read → 増分 set
          //     uid が null の player（Phase 4 以前互換、現状発生しない）は skip
          //     read を全て先に発行し、その後で update を発行する read-then-write 順序を守る。
          const reads: Array<{
            playerUid: string;
            displayName: string;
            rank: number;
            existing: ReturnType<typeof tx.get> extends Promise<infer R> ? R : never;
          }> = [];
          for (const r of ranking) {
            if (r.uid === null) continue;
            const ssRef = seasonStatsDocRef(cur.groupId, r.uid);
            // eslint-disable-next-line no-await-in-loop -- tx の read-then-write 順序のため
            const existing = await tx.get(ssRef);
            reads.push({
              playerUid: r.uid,
              displayName: r.displayName,
              rank: r.rank,
              existing: existing as never,
            });
          }

          // (B) tournament + group + 各 seasonStats を一括 write
          tx.update(ref, {
            state: "finished",
            finishedAt: serverTimestamp(),
            pausedAt: null,
            updatedAt: serverTimestamp(),
          });
          tx.update(groupDocRef(cur.groupId), {
            finishedTournamentCount: increment(1),
          });
          for (const e of reads) {
            const points = calcSeasonPoints(e.rank, totalParticipants);
            const isWin = e.rank === 1 ? 1 : 0;
            const isFT = isFinalTable(e.rank) ? 1 : 0;
            const ssRef = seasonStatsDocRef(cur.groupId, e.playerUid);
            const ex = e.existing as { exists(): boolean; data(): { participations: number; wins: number; finalTables: number; totalPoints: number } | undefined };
            const prev = ex.exists() ? ex.data() : undefined;
            const next = {
              uid: e.playerUid,
              displayName: e.displayName,
              participations: (prev?.participations ?? 0) + 1,
              wins: (prev?.wins ?? 0) + isWin,
              finalTables: (prev?.finalTables ?? 0) + isFT,
              totalPoints:
                Math.round(((prev?.totalPoints ?? 0) + points) * 100) / 100,
              lastUpdatedAt: finishedAtClient,
            };
            tx.set(ssRef, next);
          }
        });
      },
      { tid },
    );
    logger.info("tournament finish ok", {
      tid,
      uid,
      gid: t.groupId,
      participants: totalParticipants,
    });
  }
  ```
- **MIRROR**: TX_PATTERN（既存 `finishTournament` の runTransaction + tx 内 state 再 read + increment）+ tx 内 read-then-write 順序
- **IMPORTS**: 上記の追加 imports
- **GOTCHA**:
  - **read-then-write 順序**: Firestore tx は **すべての read を update / set の前に発行する必要がある**。`for` loop 内で `await tx.get` を呼んでから write する設計を守ること
  - `Timestamp.now()` を `lastUpdatedAt` に使うのは、`serverTimestamp()` を `tx.set` で使うと一部の環境で sentinel が pending となるリスクがあるため。クライアント時計の精度劣化は秒単位で許容される（ランキング画面の `lastUpdatedAt` 表示用途のみ）
  - `displayName` は player snapshot 時点を記録（rename 追従はしない）。同じ uid が次回参加で `displayName` を更新したら最新値が seasonStats に反映される
  - `r.uid === null` の player は skip。Phase 4 以前のデータでは `uid: null` の player が存在しうるが Phase 4.7 以降では作成されない。skip するだけで tx は失敗させない
  - **二重 increment 防止**: tx 内で state を再 read し finished なら早期 return（既存パターン継続）。複数端末同時 finish は片方だけ通る
  - **小数加算の累積誤差**: `Math.round((prev + points) * 100) / 100` で毎回 2 桁正規化。`points` は `calcSeasonPoints` 内で既に 2 桁丸め済み
  - listPlayers は **tx 外で事前 read**（query は tx 内で使えない）。tx 内の state 再 read で finished 判定するため、複数端末同時 finish では片方の事前 read 結果が古くなる可能性があるが、**先に tx を成立させた端末の write のみ permanent** で、後続端末は state="finished" 観測で早期 return する。古い ranking が書かれることはない
- **VALIDATE**:
  - `tournaments.test.ts` の `finishTournament` describe を seasonStats 拡張に追従し、tx.set 呼出回数 = 参加者数（uid != null 数）になる
  - 0 人参加でも tx は成立（seasonStats 書込 0 件、tournament + group のみ）
  - 同 ms タイ 2 人で資格的に同点扱い（rank の差はゼロサム）
  - emulator E2E（後述）で 5 人参加時に seasonStats 5 件が atomic に作成される

### Task 8b: `listPlayers` repository helper を追加

- **ACTION**: [src/lib/firebase/repositories/players.ts](../../../../src/lib/firebase/repositories/players.ts) に追加
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase A: 事前 read 用の player 一覧取得。
   *   `finishTournament` の seasonStats 拡張で「tx 起動前に順位確定」のため使う。
   *   tx 内の query は Web SDK 制約で使えないため、tx 外で 1 回 getDocs する。
   *   subscribePlayers と異なり orderBy は entryAt asc 固定（resolveRanking 内で再 sort される前提）。
   */
  export async function listPlayers(tid: string): Promise<PlayerDoc[]> {
    return wrapFirestoreRead(
      "firestore/read_failed",
      "参加者一覧取得に失敗しました",
      async () => {
        const snap = await getDocs(query(playersRef(tid), orderBy("entryAt", "asc")));
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      { tid },
    );
  }
  ```
- **MIRROR**: 既存 `listTables` / `subscribePlayers` のクエリパターン
- **IMPORTS**: `getDocs` / `orderBy` / `query` を `firebase/firestore` から（既存 import に含まれているか確認、なければ追加）
- **GOTCHA**: `entryAt asc` は `resolveRanking` 内で active player 同士の tiebreak に用いる前提
- **VALIDATE**: `players.test.ts` に `listPlayers` の SDK mock test 追加

### Task 9: `startNewSeason` service 関数を追加

- **ACTION**: [src/lib/services/group.ts](../../../../src/lib/services/group.ts) に追加
- **IMPLEMENT**:
  ```typescript
  // 既存 import に追加
  import { collection, doc, getDocs, runTransaction, serverTimestamp, Timestamp } from "firebase/firestore";
  import { firestore } from "@/lib/firebase/client";
  import {
    seasonStatsRef,
  } from "@/lib/firebase/repositories/seasonStats";
  import {
    seasonHistoryDocRef,
  } from "@/lib/firebase/repositories/seasonHistory";

  /**
   * Phase A: シーズンを開始する（手動切替）。owner / organizer 限定。
   *   1. 現在 seasonStats 全件を tx 外で事前 read（snapshot 用 entries を構築）
   *   2. tx 内で:
   *      a. seasonHistory/{newSeasonId} に snapshot を append（startedAt: 旧 seasonStartDate, endedAt: serverTimestamp）
   *      b. seasonStats/{uid} を全件 delete
   *      c. groups/{gid}.seasonStartDate を serverTimestamp に更新
   *   newSeasonId は `crypto.randomUUID()` で生成（Web SDK 標準、Node 18+ も互換）。
   *
   *   旧シーズンに参加者 0 件のとき: history は entries=[] で append（運営者の操作意図が記録に残る）。
   *   旧 seasonStartDate が null（未設定 = 初回）のとき: startedAt は null のまま記録。
   */
  export async function startNewSeason({
    gid,
    uid,
  }: {
    gid: string;
    uid: string;
  }): Promise<{ seasonId: string }> {
    const group = await getGroup(gid);
    assertOrganizer(group, uid);
    const seasonId = (typeof crypto !== "undefined" && "randomUUID" in crypto)
      ? crypto.randomUUID()
      : `season-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    // 事前 read: 旧 seasonStats 全件
    const statsSnap = await getDocs(seasonStatsRef(gid));
    const entries = statsSnap.docs.map((d) => {
      const data = d.data();
      return {
        uid: data.uid,
        displayName: data.displayName,
        participations: data.participations,
        wins: data.wins,
        finalTables: data.finalTables,
        totalPoints: data.totalPoints,
      };
    });

    await wrapFirestoreWrite(
      "firestore/write_failed",
      "シーズン開始に失敗しました",
      async () => {
        await runTransaction(firestore, async (tx) => {
          // (A) 全 seasonStats を delete
          for (const d of statsSnap.docs) {
            tx.delete(d.ref);
          }
          // (B) seasonHistory/{seasonId} を append
          tx.set(seasonHistoryDocRef(gid, seasonId), {
            startedAt: group.seasonStartDate ?? null,
            endedAt: serverTimestamp(),
            entries,
          });
          // (C) groups/{gid}.seasonStartDate を更新
          tx.update(groupDocRef(gid), {
            seasonStartDate: serverTimestamp(),
          });
        });
      },
      { gid, uid, seasonId, count: entries.length },
    );
    logger.info("startNewSeason ok", { gid, uid, seasonId, count: entries.length });
    return { seasonId };
  }
  ```
- **MIRROR**: SERVICE_PATTERN（`renameGroup` の owner-only assert）+ TX_PATTERN（事前 read + tx 内 write）
- **IMPORTS**: `crypto.randomUUID` は Node 18+ / Web 標準。`@/lib/firebase/wrap` の `wrapFirestoreWrite` を import 済み
- **GOTCHA**:
  - 事前 read で取った statsSnap.docs.ref を tx.delete に渡す。tx 内で再度 getDocs はしない（query 不可）
  - **中間状態の整合性**: tx 中に新たな `finishTournament` が走っても、その tx は seasonStats を別 path に upsert するため矛盾しない（先勝ちの finishTournament が old seasonStats に書込 → startNewSeason の delete で消える、または逆順）。完全な race-free にするには tournaments の状態を tx 内で監視する必要があるがスコープ外
  - `seasonId` 衝突は `randomUUID` で実質ゼロ。フォールバックとして `season-{timestamp}-{rand}` を持っているが正常系では使われない
  - `entries` 配列が空（メンバー全員参加 0 件）でも history には append する（操作の事実を記録）
  - rule の `seasonHistory create` で `entries is list` を要求しているため空配列もパス
- **VALIDATE**:
  - `group.test.ts` に追加: owner / organizer / member 各ケース、tx mock で 「delete N + set 1 + update 1」 を assert
  - emulator E2E: 「シーズンを開始する」操作後、seasonStats が空、seasonHistory に 1 件 append、`groups.seasonStartDate` が新時刻

### Task 10: サークル詳細画面に「シーズン」カードを追加

- **ACTION**:
  - [src/app/groups/[gid]/_components/SeasonCard.tsx](../../../../src/app/groups/%5Bgid%5D/_components/SeasonCard.tsx) を新規作成
  - [src/app/groups/[gid]/_components/StartSeasonDialog.tsx](../../../../src/app/groups/%5Bgid%5D/_components/StartSeasonDialog.tsx) を新規作成
  - [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) に組み込む
- **IMPLEMENT**:
  ```typescript
  // src/app/groups/[gid]/_components/SeasonCard.tsx
  "use client";

  import Link from "next/link";
  import type { Timestamp } from "firebase/firestore";

  import { Button } from "@/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "@/components/ui/card";

  function formatDateOrNull(ts: Timestamp | null | undefined): string {
    if (!ts) return "未設定";
    return ts.toDate().toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
  }

  export function SeasonCard({
    gid,
    seasonStartDate,
    isOrganizer,
    onRequestStartSeason,
    working,
  }: {
    gid: string;
    seasonStartDate: Timestamp | null | undefined;
    isOrganizer: boolean;
    onRequestStartSeason: () => void;
    working: boolean;
  }) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>シーズン</CardTitle>
          <CardDescription>
            シーズン累計の参加・優勝・FT・ポイントを集計します。
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-center gap-3">
          <p className="text-sm">
            現在シーズン開始: <span className="font-semibold">{formatDateOrNull(seasonStartDate)}</span>
          </p>
          <Link href={`/groups/${gid}/season`}>
            <Button variant="outline" size="sm">ランキングを見る</Button>
          </Link>
          {isOrganizer ? (
            <Button
              type="button"
              size="sm"
              onClick={onRequestStartSeason}
              disabled={working}
            >
              シーズンを開始する
            </Button>
          ) : null}
        </CardContent>
      </Card>
    );
  }
  ```

  ```typescript
  // src/app/groups/[gid]/_components/StartSeasonDialog.tsx
  "use client";

  import { Button } from "@/components/ui/button";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "@/components/ui/dialog";

  export function StartSeasonDialog({
    open,
    onOpenChange,
    onConfirm,
    working,
  }: {
    open: boolean;
    onOpenChange: (next: boolean) => void;
    onConfirm: () => void;
    working: boolean;
  }) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>シーズンを開始しますか？</DialogTitle>
            <DialogDescription>
              現在の戦績は履歴にスナップショットされ、新しいシーズンが開始されます。
              この操作は取り消せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={working}>
              キャンセル
            </Button>
            <Button onClick={onConfirm} disabled={working}>
              {working ? "開始中…" : "開始する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }
  ```

  GroupDetailClient への組み込み:
  ```typescript
  // src/app/groups/[gid]/group-detail-client.tsx に追加
  import { SeasonCard } from "./_components/SeasonCard";
  import { StartSeasonDialog } from "./_components/StartSeasonDialog";
  import { startNewSeason } from "@/lib/services/group";

  // state 追加
  const [confirmStartSeasonOpen, setConfirmStartSeasonOpen] = useState(false);

  async function onStartSeason() {
    if (!user) return;
    setWorking(true);
    setError(null);
    try {
      await startNewSeason({ gid, uid: user.uid });
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "season/start-failed", "シーズン開始に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setConfirmStartSeasonOpen(false);
      setWorking(false);
    }
  }

  // JSX 内、InlineNumberEditCard 群の隣に追加:
  <SeasonCard
    gid={gid}
    seasonStartDate={group.seasonStartDate}
    isOrganizer={isOrganizer}
    onRequestStartSeason={() => setConfirmStartSeasonOpen(true)}
    working={working}
  />
  <StartSeasonDialog
    open={confirmStartSeasonOpen}
    onOpenChange={setConfirmStartSeasonOpen}
    onConfirm={() => void onStartSeason()}
    working={working}
  />
  ```
- **MIRROR**: `LeaveDeleteDialogs` の Dialog 構造、`InlineNumberEditCard` の Card レイアウト
- **IMPORTS**: 上記
- **GOTCHA**:
  - `seasonStartDate` 表示は `toLocaleDateString("ja-JP")` で日本語ロケール固定
  - 確認モーダルは `LeaveDeleteDialogs` と同じ shadcn Dialog（既存 import 済み）
  - 実行中は `working` で disable
- **VALIDATE**:
  - 手動: owner で開いて「シーズンを開始する」が表示される
  - 手動: 一般メンバーで開いて「シーズンを開始する」が非表示、「ランキングを見る」リンクは表示
  - 手動: 「シーズンを開始する」 → モーダル → 「開始する」で seasonStartDate が更新

### Task 11: シーズンランキング画面を新設

- **ACTION**:
  - [src/app/groups/[gid]/season/page.tsx](../../../../src/app/groups/%5Bgid%5D/season/page.tsx) を新規作成
  - [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/%5Bgid%5D/season/season-ranking-client.tsx) を新規作成
- **IMPLEMENT**:
  ```typescript
  // src/app/groups/[gid]/season/page.tsx
  import { SeasonRankingClient } from "./season-ranking-client";

  export default async function SeasonPage({
    params,
  }: {
    params: Promise<{ gid: string }>;
  }) {
    const { gid } = await params;
    return <SeasonRankingClient gid={gid} />;
  }
  ```

  ```typescript
  // src/app/groups/[gid]/season/season-ranking-client.tsx
  "use client";

  import Link from "next/link";
  import { useEffect, useState } from "react";

  import { Button } from "@/components/ui/button";
  import { AppError } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { getGroup } from "@/lib/firebase/repositories/groups";
  import { subscribeSeasonStats } from "@/lib/firebase/repositories/seasonStats";
  import type { GroupDoc } from "@/lib/firebase/schemas/group";
  import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";
  import { logger } from "@/lib/logger";

  export function SeasonRankingClient({ gid }: { gid: string }) {
    const { user } = useAuthUser();
    const [group, setGroup] = useState<GroupDoc | null>(null);
    const [stats, setStats] = useState<SeasonStatsDoc[]>([]);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!user) return;
      let canceled = false;
      void (async () => {
        try {
          const g = await getGroup(gid);
          if (!canceled) setGroup(g);
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得失敗");
          logger.warn(wrapped.message, { code: wrapped.code, gid });
          if (!canceled) setError(`${wrapped.code}: ${wrapped.message}`);
        }
      })();
      return () => {
        canceled = true;
      };
    }, [gid, user]);

    useEffect(() => {
      if (!user) return;
      const unsub = subscribeSeasonStats(
        gid,
        (items) => setStats(items),
        (err) => setError(`${err.code}: ${err.message}`),
      );
      return unsub;
    }, [gid, user]);

    if (!user) return null;
    if (error) {
      return (
        <main className="mx-auto max-w-3xl space-y-4 p-8">
          <p className="text-sm text-destructive" role="alert">{error}</p>
          <Link href={`/groups/${gid}`}><Button variant="outline">サークル詳細へ</Button></Link>
        </main>
      );
    }
    if (!group) {
      return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">読込中…</main>;
    }

    const startDate = group.seasonStartDate
      ? group.seasonStartDate.toDate().toLocaleDateString("ja-JP")
      : "未設定";

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">シーズンランキング</h1>
            <p className="text-sm text-muted-foreground">{group.name}</p>
            <p className="text-xs text-muted-foreground">現在シーズン開始: {startDate}</p>
          </div>
          <Link href={`/groups/${gid}`}><Button variant="outline" size="sm">サークル詳細</Button></Link>
        </div>

        {stats.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            このシーズンの戦績はまだありません。トーナメントが終了すると自動的に記録されます。
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-2 text-left">順位</th>
                <th className="py-2 text-left">表示名</th>
                <th className="py-2 text-right">参加</th>
                <th className="py-2 text-right">優勝</th>
                <th className="py-2 text-right">FT</th>
                <th className="py-2 text-right">累計ポイント</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((s, i) => (
                <tr key={s.id} className="border-b">
                  <td className="py-2">{i + 1}</td>
                  <td className="py-2">{s.displayName}</td>
                  <td className="py-2 text-right">{s.participations}</td>
                  <td className="py-2 text-right">{s.wins}</td>
                  <td className="py-2 text-right">{s.finalTables}</td>
                  <td className="py-2 text-right font-semibold">
                    {s.totalPoints.toFixed(2)} pt
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    );
  }
  ```
- **MIRROR**: `group-detail-client.tsx` の `useState + useEffect + useAuthUser` パターン、`subscribeTournament` 等の購読パターン
- **IMPORTS**: 上記
- **GOTCHA**:
  - `subscribeSeasonStats` は client side でのみ動く（onSnapshot）。`useEffect` 内で購読し cleanup で unsub
  - 表示は `totalPoints.toFixed(2)` で UI 側で 2 桁固定（保存値も 2 桁だが表示丸めは UI 責務、PRD の決定事項）
  - 順位は配列 index ベース（`subscribeSeasonStats` 側で totalPoints desc に sort 済み）。同点タイの厳密処理は MVP スコープ外
  - rule で `read: isGroupMember(gid)` のため非メンバーは `permission-denied` で error 表示
- **VALIDATE**:
  - 手動: 5 人参加 1 トーナメント終了 → ランキングに 5 行表示、totalPoints desc
  - 手動: 別 ブラウザでも realtime 反映（onSnapshot）
  - 手動: 非メンバーが URL 直叩きで permission error 表示

### Task 12: emulator validator script を新設

- **ACTION**: [scripts/test-rules-season.mjs](../../../../scripts/test-rules-season.mjs) を新規作成し、`package.json` に script 追加
- **IMPLEMENT**:
  ```javascript
  /**
   * Phase A Firestore Rules emulator validation for seasonStats / seasonHistory / seasonStartDate.
   *
   * 起動方法:
   *   firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \
   *     "node scripts/test-rules-season.mjs"
   *
   * 検証ケース:
   *   1. organizer が groups/{gid}.seasonStartDate を Timestamp で書換 → allow
   *   2. organizer が name + seasonStartDate を同時書換 → deny（affectedKeys 違反）
   *   3. member が seasonStartDate を書換 → deny
   *   4. organizer が seasonStats/{uid} を valid 値で create → allow
   *   5. organizer が seasonStats/{uid} を invariant 違反（participations: -1）で create → deny
   *   6. member が seasonStats/{uid} を read → allow
   *   7. 非メンバーが seasonStats/{uid} を read → deny
   *   8. organizer が seasonStats/{uid} の uid フィールド != docId で create → deny
   *   9. organizer が seasonHistory/{seasonId} を valid 値で create → allow
   *  10. organizer が seasonHistory/{seasonId} の既存 doc を update → deny
   *  11. organizer が seasonHistory/{seasonId} を delete → deny
   *  12. organizer が seasonStats/{uid} を delete → allow（reset 経路）
   */
  // ... test-rules-finished-count.mjs と同じ skeleton（signUp / patchDoc / createDoc / expectAllow / expectDeny）...
  ```
  ```json
  // package.json scripts 追加
  "test:rules-season": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-season.mjs\"",
  ```
- **MIRROR**: EMULATOR_VALIDATOR_PATTERN（[scripts/test-rules-finished-count.mjs](../../../../scripts/test-rules-finished-count.mjs) の REST 直叩き構造）
- **IMPORTS**: なし（独立 Node script）
- **GOTCHA**:
  - REST API で `Authorization: Bearer <idToken>` を渡す。SDK は使わない（楽観 Promise 問題回避）
  - `seasonStats` の docId と `uid` フィールドの一致チェックは、攻撃者が他人の seasonStats を上書きする経路を塞ぐ重要 invariant
- **VALIDATE**:
  - `npm run test:rules-season` で 12/12 PASS
  - `firestore-debug.log` に PERMISSION_DENIED の場合のみ stack が記録されることを確認

### Task 13: schema test 更新

- **ACTION**: [src/lib/firebase/schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) を更新
- **IMPLEMENT**:
  ```typescript
  // L544 の defaults defaultSeatsPerTable expectation を 9 → 8 に変更
  expect(parsed.defaultSeatsPerTable).toBe(8);

  // groupBodySchema describe 末尾に追加（Phase A: seasonStartDate）
  it("defaults seasonStartDate to null for legacy docs without the field", () => {
    const parsed = groupBodySchema.parse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(parsed.seasonStartDate).toBeNull();
  });

  it("preserves explicit seasonStartDate", () => {
    const t = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));
    const parsed = groupBodySchema.parse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
      seasonStartDate: t,
    });
    expect(parsed.seasonStartDate).toEqual(t);
  });

  // 新規 describe を追加: seasonStatsBodySchema / seasonHistoryBodySchema
  describe("seasonStatsBodySchema", () => {
    it("parses a valid stats doc", () => {
      const r = seasonStatsBodySchema.safeParse({
        uid: "u1",
        displayName: "Alice",
        participations: 5,
        wins: 1,
        finalTables: 3,
        totalPoints: 28.12,
        lastUpdatedAt: now,
      });
      expect(r.success).toBe(true);
    });

    it("rejects negative participations", () => {
      const r = seasonStatsBodySchema.safeParse({
        uid: "u1",
        displayName: "Alice",
        participations: -1,
        wins: 0,
        finalTables: 0,
        totalPoints: 0,
        lastUpdatedAt: now,
      });
      expect(r.success).toBe(false);
    });

    it("rejects displayName > 15 chars", () => {
      const r = seasonStatsBodySchema.safeParse({
        uid: "u1",
        displayName: "1234567890123456",
        participations: 0,
        wins: 0,
        finalTables: 0,
        totalPoints: 0,
        lastUpdatedAt: now,
      });
      expect(r.success).toBe(false);
    });

    it("accepts decimal totalPoints", () => {
      const r = seasonStatsBodySchema.safeParse({
        uid: "u1",
        displayName: "A",
        participations: 1,
        wins: 0,
        finalTables: 0,
        totalPoints: 8.66,
        lastUpdatedAt: now,
      });
      expect(r.success).toBe(true);
    });
  });

  describe("seasonHistoryBodySchema", () => {
    it("parses a valid history doc with empty entries", () => {
      const r = seasonHistoryBodySchema.safeParse({
        startedAt: null,
        endedAt: now,
        entries: [],
      });
      expect(r.success).toBe(true);
    });

    it("parses a valid history doc with entries", () => {
      const r = seasonHistoryBodySchema.safeParse({
        startedAt: now,
        endedAt: now,
        entries: [
          { uid: "u1", displayName: "A", participations: 5, wins: 1, finalTables: 2, totalPoints: 23.10 },
        ],
      });
      expect(r.success).toBe(true);
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE（既存 `defaultSeatsPerTable` / `audioSettings` の additive テストパターン）
- **IMPORTS**: `seasonStatsBodySchema` / `seasonHistoryBodySchema` を追加 import
- **VALIDATE**: `npm test schemas/index.test.ts` で全 PASS

### Task 14: docs を更新

- **ACTION**: 3 ファイル更新
- **IMPLEMENT**:
  - [.claude/rules/group-membership.md](../../../rules/group-membership.md): データモデル節に `seasonStartDate` を追記、allowed-keys 表に追加（organizer ブランチに `seasonStartDate`）、権限マトリクスに「シーズン開始（owner / organizer）/ 戦績参照（全員）/ 戦績更新（finishTournament tx 経由のみ）」を追加。サブセクション「Phase A: シーズン管理」を新設し、本 phase の rule branch / 経路を記述
  - [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md): 「`tournaments/{tid}` 配下 subcollection の rule 設計原則」を **「`groups/{gid}` 配下 subcollection も同原則」** に拡張。`seasonStats` / `seasonHistory` を explicit rule 例として追記
  - [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md): Phase A の status を `pending` → `in-progress` に、PRP Plan 列に `[phase-a-season-stats-foundation.plan.md](../../plans/02-season-stats-and-share/phase-a-season-stats-foundation.plan.md)` リンク追加
- **MIRROR**: 既存 Phase 4.16 / 4.17 の docs 更新差分（[firestore.rules#L195-L221](../../../../firestore.rules#L195-L221) のコメントスタイル）
- **IMPORTS**: なし（markdown）
- **VALIDATE**: 手動 review、PRD の Phase 進捗表が機械可読のまま

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `calcSeasonPoints(1, 8)` | rank=1, participants=8 | `10.00` | 標準ケース |
| `calcSeasonPoints(1, 6)` | rank=1, participants=6 | `8.66`（10 × √(6/8)） | 平方根スケール |
| `calcSeasonPoints(1, 24)` | rank=1, participants=24 | `17.32` | 大規模 |
| `calcSeasonPoints(10, 8)` | rank=10（base 配列外） | `0` | rank 上限超過 |
| `calcSeasonPoints(0, 8)` | rank=0（不正） | `0` | 防衛 |
| `calcSeasonPoints(-1, 8)` | rank 負（不正） | `0` | 防衛 |
| `calcSeasonPoints(1.5, 8)` | rank 非整数 | `0` | 防衛 |
| `calcSeasonPoints(1, 0)` | participants=0 | `0` | 防衛 |
| 1000 回 `8.66` を `Math.round((sum + 8.66) * 100) / 100` で加算 | — | `8660.00` | 累積誤差なし |
| `isFinalTable(9)` | rank=9 | `true` | 境界 |
| `isFinalTable(10)` | rank=10 | `false` | 境界 |
| `resolveRanking([5 人 mix])` | active 1 + busted 4 | rank 1〜5、active が 1 位 | 標準 |
| `resolveRanking([全員 active])` | active 5 | entryAt asc | 途中状態防衛 |
| `resolveRanking([])` | 空 | `[]` | 0 人 |
| `resolveRanking([同 ms タイ])` | 2 人同 ms バスト | entryAt asc → pid asc で安定化 | tiebreak |
| `groupBodySchema.parse({...legacy})` | seasonStartDate 不在 | `seasonStartDate: null` | additive default |
| `seasonStatsBodySchema.parse({...invalid})` | participations=-1 | safeParse fail | 範囲制約 |
| `updateSeasonStartDate("g1", <Timestamp>)` | valid | updateDoc 1 回呼ばれる | happy |
| `updateSeasonStartDate("g1", "2026-01-01")` | string | AppError 拒否 | 型違反 |
| `finishTournament` happy（5 人参加） | running tournament + 5 players | tx.set 5 回 + tx.update 2 回 + commit | 拡張 |
| `finishTournament` 0 人参加 | running tournament + 0 players | tx.set 0 回 + tx.update 2 回 | 境界 |
| `finishTournament` 既に finished | finished tournament | tx 不発火 | race guard |
| `finishTournament` uid==null player 含む | mixed | uid==null は skip | 防衛 |
| `startNewSeason` happy（owner） | seasonStats 5 件 | tx.delete 5 + tx.set 1 (history) + tx.update 1 (group) | 標準 |
| `startNewSeason` 空 | seasonStats 0 件 | tx.set 1 (history entries=[]) + tx.update 1 | 境界 |
| `startNewSeason` member | — | AppError `group/not-organizer` | 権限 |

### Edge Cases Checklist

- [x] 0 人参加トーナメントの finish（seasonStats 書込なし）
- [x] uid==null player を含む participants（skip）
- [x] 旧 group doc（`seasonStartDate` 不在）の hydrate（zod default null）
- [x] 同 ms タイの 2 人バスト（`entryAt` → `pid` で安定化）
- [x] 1000 回累積加算の誤差（毎回 2 桁丸めで安定）
- [x] base[] 配列外の順位（10 位以下は 0pt）
- [x] 複数端末同時 finish（tx 内 state 再 read で deny）
- [x] startNewSeason 中の同時 finishTournament（先勝ちで整合性維持）
- [x] 非メンバーによる seasonStats read（rule deny）
- [x] organizer による seasonHistory update（rule deny、append-only）

### emulator E2E（rules-validator）

- [x] organizer が seasonStartDate を Timestamp で書換 → allow
- [x] member が seasonStartDate を書換 → deny
- [x] organizer が seasonStartDate + name 同時書換 → deny（affectedKeys 違反）
- [x] organizer が seasonStats/{uid} を valid 値で create → allow
- [x] organizer が seasonStats/{uid} を participations=-1 で create → deny
- [x] organizer が seasonStats/{uid} の uid フィールド != docId で create → deny
- [x] member が seasonStats/{uid} を read → allow
- [x] 非メンバーが seasonStats/{uid} を read → deny
- [x] organizer が seasonStats/{uid} を delete → allow（reset 経路）
- [x] organizer が seasonHistory/{seasonId} を valid 値で create → allow
- [x] organizer が seasonHistory/{seasonId} update → deny
- [x] organizer が seasonHistory/{seasonId} delete → deny

### Manual Browser Validation

- [x] 新規 group 作成 → `/tournaments/new` の席数初期値が 8
- [x] 既存 group（`defaultSeatsPerTable` 不在）→ 9 のまま
- [x] サークル詳細画面に「シーズン」カードが表示、開始日「未設定」
- [x] owner / organizer のみ「シーズンを開始する」ボタンが見える
- [x] 「シーズンを開始する」 → モーダル → 「開始する」で開始日が更新、ランキング画面で空表示
- [x] 5 人参加トーナメント終了 → ランキング画面で 5 行表示、totalPoints desc
- [x] 同じセッションで複数端末 → realtime 反映
- [x] 非メンバーが `/groups/[gid]/season` 直叩き → permission error 表示

---

## Validation Commands

### Static Analysis

```bash
# 型チェック
npm run typecheck
```

EXPECT: Zero type errors

### Unit Tests

```bash
# 該当ファイルだけ
npm test -- season-points.test.ts seasonStats.test.ts seasonHistory.test.ts groups.test.ts tournaments.test.ts group.test.ts timer.test.ts schemas/index.test.ts

# フル
npm test
```

EXPECT: All tests pass

### Lint

```bash
npm run lint
```

EXPECT: No errors

### Build

```bash
npm run build
```

EXPECT: Next.js production build success

### Database Validation

```bash
# limits.ts と firestore.rules の drift 検証
npm run test:rules-limits

# Phase A の rule emulator 検証
npm run test:rules-season
```

EXPECT: 全 PASS

### Browser Validation

```bash
# emulator 起動（別ターミナル）
npm run emulator

# dev server 起動
npm run dev
```

サークルを 1 つ作成 → 5 人受付 → 席決め → トーナメント開始 → 4 人バスト → 自動 finish → サークル詳細画面 → 「シーズン」カードで開始日確認 → 「ランキングを見る」 → 5 人分のランキング表示確認 → 「シーズンを開始する」 → モーダル → 「開始する」 → ランキング空表示、開始日更新

EXPECT: 全フロー成功

---

## Acceptance Criteria

- [ ] 全 Task 完了
- [ ] Validation コマンドが全 PASS（typecheck / test / lint / build / test:rules-* ）
- [ ] PRD（[season-stats-and-share.prd.md](../../prds/02-season-stats-and-share.prd.md)）の Phase A status が `in-progress` に更新済み（実装完了で `complete`）
- [ ] 6 / 8 / 16 / 20 人参加の `calcSeasonPoints` 出力が手計算値と一致
- [ ] `finishTournament` 拡張で 1 tx 内に `tournament.update + group.update + N × seasonStats.set` が atomic に発火
- [ ] emulator validator が rule の allow / deny を全 12 ケース通過
- [ ] サークル詳細画面と新ランキング画面の手動テストで UX が PRD と一致
- [ ] `DEFAULT_SEATS_PER_TABLE = 8` の change がレビューで明示的に注意喚起される（README / PRD で behavioral change ノート）

## Completion Checklist

- [ ] schema → repository → rule → service → UI の 5 層が同期
- [ ] エラーは `AppError` でラップし、`firestore/*` / `validation/*` / `season/*` prefix を持つ
- [ ] logger 経由のログのみ（`console.*` の直書きなし）
- [ ] 既存テストが green のまま（特に `defaultSeatsPerTable` の expectation 変更で他テスト落ちないこと）
- [ ] characterization test を `season-points.test.ts` / `timer.test.ts` の `resolveRanking` に先行投入
- [ ] fixture factory（`makePlayer` / `makeTournament`）で重複 object literal を回避
- [ ] PRD の Phase A status / PRP Plan 列を更新
- [ ] 新規 prefix `season/*` を error-logging.md に追加（または既存規約で許容範囲か明記）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `finishTournament` tx に seasonStats 全プレイヤー更新を相乗りすると ops が膨張し失敗率上昇 | M | 中 | 20 人 + 1 tournament + 1 group = 22 ops、500 ops 上限内で十分。E2E で 20 人ケースを実測してベンチマーク |
| `Math.round((prev + points) * 100) / 100` で浮動小数点誤差が複数シーズン跨ぎで累積 | L | 低 | `season-points.test.ts` で 1000 回連続加算しても誤差ゼロを確認。Firestore は IEEE 754 double で number 保持、毎回 2 桁丸めで安定 |
| `DEFAULT_SEATS_PER_TABLE` 既定値変更で既存テストが落ちる | M | 低 | `git grep "defaultSeatsPerTable"` で expectation を grep し、9 → 8 に一括更新。`schemas/index.test.ts` 1 箇所のみ実害あり想定 |
| `startNewSeason` 中に finishTournament が同時走行 → 整合崩れ | L | 中 | 双方 runTransaction だが path が異なるため atomic 競合は起きず、先勝ちの reset / write が確定。完全な race-free は Cloud Functions 化で後続フェーズ対応 |
| `subscribeSeasonStats` が onSnapshot で大量 doc を re-fetch | L | 低 | 20 人規模なら毎回 20 doc 程度。orderBy なしの client-sort で複合 index 不要 |
| rule で `affectedKeys().hasOnly(['seasonStartDate'])` の括り漏れで他フィールド改竄経路成立 | L | 高 | emulator validator のケース「seasonStartDate + name 同時書換 → deny」を必ず実行。Phase 4.16 の self-* 分岐穴と同型バグを再発させない |
| `seasonStats/{uid}` の docId と uid フィールド不一致を rule で塞がないと、他人の uid で攻撃 | M | 中 | rule の create / update branch で `request.resource.data.uid == uid` を強制。emulator で「uid != docId → deny」を検証 |
| 同 ms タイ tiebreak が決定論的でないと UI で順位ぶれ | L | 低 | `resolveRanking` の最終 tiebreak を `pid.localeCompare(...)` で決定論化。timer.test.ts で順序固定を assert |

## Notes

- 本 phase の実装後、Phase B（結果カード）は `subscribeSeasonStats(gid)` を読んで「シーズン首位カード」を描画できる。Phase B の `@vercel/og` route から SSR で読みに行くケースは Firebase Admin SDK が必要なので、別途 service account credentials 設計が必要（Phase B の plan で詳細化）
- `seasonId` を `crypto.randomUUID()` にしているが、運営者が「2026-Q1」のような人間可読 ID を後付けで欲しがる可能性あり。MVP は UUID で固定、命名 UI は次フェーズの Open Question
- `finalTables` の閾値（`SEASON_FINAL_TABLE_THRESHOLD = 9`）は NLH 9 人卓基準。リミット卓 10 人での運用が混じる場合は次フェーズで `groups/{gid}.finalTableThreshold` 化する候補
- `lastUpdatedAt` を `Timestamp.now()`（client）にしているが、tx 内 `set` に `serverTimestamp()` を渡すと sentinel が pending 状態のまま zod parse で `null` 互換に倒れるリスクあり。secure な実装は Cloud Functions 化で後続 phase で対応
- 本 phase で導入する `season/*` error code prefix は既存 `error-logging.md` の prefix リストに追加が必要。drift にならないよう docs 更新タスクで反映
