# Plan: Phase 4.14 — トーナメント受付画面 + サイドバー UX 改善

## Summary

トーナメント受付（dashboard）画面のレイアウト跳ねや状態表示の重複、サウンドトグルのリアクティブ反映漏れ、終了済みトーナメントの削除導線、全画面化方式（別画面遷移→same-page Fullscreen API）を改善する。あわせてサイドバーの文言整理と「開催中トーナメント」サブナビ追加を行う。

すべて UI／既存 service 層の組合せ調整で完結し、Firestore schema / rules には変更を入れない（rule 側は既に organizer による finished 削除を許可済み）。

## User Story

As a サークル運営者,
I want 受付画面とサイドバーの UX 上のノイズを取り除きたい,
So that 開催中・終了後の運営オペレーションをページ遷移なし・状態反映の遅延なしで実行できる。

## Problem → Solution

| # | Current | Desired |
| --- | --- | --- |
| 1-1 | 右列カード（Next Break / Average / Players）が `running/paused/finished` でしか描画されず、状態遷移時に grid が 2 列⇄3 列に跳ねる | `setup/seating` でも 3 列 grid を維持し、各カードは「開始前プレビュー」を表示する |
| 1-2 | サウンド On/Off アイコンを押すと Firestore は更新されるがボタンが切り替わらない（リロード必須） | クリック後に group の最新値で再描画される（write 後に GroupProvider を refresh） |
| 1-3 | `state==="setup"` のときしか削除できない（finished の履歴が一覧に残り続ける） | `setup` または `finished` のとき削除可能。サブコレクション（players/tables）も batch でクリーンアップ |
| 1-4 | 受付画面ヘッダの「一覧へ戻る」ボタン（サイドバー /トップヘッダで代替できる） | 削除 |
| 1-5 | 完了済み（手動で対応済み — 計画外） | — |
| 1-6 | トーナメント名横に `data.state` の生バッジが残っており TimerDisplay 内のラベルと重複 | 削除（ConnectionBadge は残す） |
| 1-7 | 「全画面表示」ボタンを押すと `/tournaments/[tid]/live` に遷移する | 同じ画面のまま Fullscreen API でブラウザ全画面化／解除をトグル |
| 2-1 | サイドバー label が「サークル」「トーナメント」 | 「サークル一覧」「トーナメント一覧」 |
| 2-2 | 開催中トーナメントへ行くにはトーナメント一覧から遷移が必要 | サイドバーの「トーナメント一覧」配下に開催中（`seating`/`running`/`paused`）のサブリンクを並べ、クリックで直接遷移 |

## Metadata

- **Complexity**: Medium
- **Source PRD**: 自由記述（CLAUDE 経由で受領した改善メモ）
- **PRD Phase**: N/A（PRD 未更新の単発改善。完了後に PRD の "Implementation Phases" に Phase 4.14 を追記する）
- **Estimated Files**: 9 ファイル（新規 0 / 編集 8 / テスト追従 1〜複数）

---

## UX Design

### Before

```
┌───────────────────────────────────────────────────────────────┐
│ {name} [setup] [接続OK]            [一覧へ戻る][全画面表示][編集][削除]
│ レイトレジスト Lv...
├──────────────┬──────────────────────────────┐
│ QR           │ TimerDisplay (大)            │  ← state=setup では 2 列のみ
│              │ TimerControls                │     右列なし
│              │                              │
└──────────────┴──────────────────────────────┘
                  │
   state running に遷移した瞬間 ↓ grid が 3 列に拡張、TimerDisplay が一気に縮む
                  ▼
┌──────────────┬──────────────────┬──────────────┐
│ QR           │ TimerDisplay     │ NextBreak    │
│              │ TimerControls    │ AverageStack │
│              │                  │ Players      │
└──────────────┴──────────────────┴──────────────┘
```

サウンドトグル: 押下 → Firestore は更新される → UI は変化しない（再読込で初めて反映）。

サイドバー:
```
[ホーム]
[サークル]    ← 「一覧」がない
  └ {現在のサークル名}
[トーナメント]  ← 「一覧」がない／配下に開催中なし
[ストラクチャ]
[テンプレート]
[サウンド設定]
[アカウント設定]
```

### After

```
┌───────────────────────────────────────────────────────────────┐
│ {name} [接続OK]                       [全画面表示][編集][削除]
├──────────────┬──────────────────┬──────────────┐
│ QR           │ TimerDisplay     │ NextBreak    │ ← 受付（setup）から
│              │ TimerControls    │ AverageStack │   ３列で固定
│              │                  │ Players      │   各カードは "開始前" 表示
└──────────────┴──────────────────┴──────────────┘
                  │
   state 遷移しても grid 列数とタイマーサイズは不変（カード中身だけ更新）
```

サウンドトグル: 押下 → Firestore 更新 → `refreshGroups()` → ボタンが緑/赤に同期切替。

「全画面表示」: ボタン押下 → `document.documentElement.requestFullscreen()` → 同じ dashboard が画面全体に拡張。再押下で `exitFullscreen()`。`fullscreenchange` を購読してアイコンを Maximize ↔ Minimize に切替。

サイドバー:
```
[ホーム]
[サークル一覧]
  └ {現在のサークル名}
[トーナメント一覧]
  ├ 🟢 {進行中トーナメント A}    ← state=running
  ├ 🟡 {一時停止トーナメント B}  ← state=paused
  └ ⚪ {席決め中 C}              ← state=seating
[ストラクチャ]
[テンプレート]
[サウンド設定]
[アカウント設定]
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| 受付画面 grid | state でカラム数が変わる | 常に 3 列（lg+） | TimerDisplay の文字サイズ揺らぎを排除 |
| 右列カード（setup/seating） | 非表示 | 開始前プレビューを表示 | 「Lv1 で break まで N レベル」「初期スタック」「受付済み {N}」 |
| サウンドトグル | リロード必須 | 即時反映 | `useCurrentGroup().refreshGroups()` を success 後に呼ぶ |
| 削除 | setup のみ | setup または finished | confirm dialog の文言を分岐（"開始前なので消せます" / "終了済みなので履歴ごと消します"） |
| 「一覧へ戻る」 | 受付画面ヘッダに表示 | 削除 | サイドバー「トーナメント一覧」で代替 |
| state badge（ヘッダ） | 表示 | 削除 | TimerDisplay 内のラベル（開始前 / 進行中 / 一時停止中 / 終了）が真実源 |
| 「全画面表示」 | `/live` へ Link 遷移 | Fullscreen API トグル | 既存 `/live` ページは別経路（参加者用）として残す |
| サイドバー label | サークル / トーナメント | サークル一覧 / トーナメント一覧 | aria-current 動作は変更なし |
| サブナビ（トーナメント） | なし | 開催中トーナメントを onSnapshot で表示 | クリックで `/tournaments/{tid}` へ（dashboard）、member は内部 redirect で `/live` |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 全文 | 1-1 / 1-2 / 1-3 / 1-4 / 1-6 / 1-7 の主たる編集対象 |
| P0 | [src/components/nav/nav-items.ts](../../../src/components/nav/nav-items.ts) | 全文 | 2-1（label rename） |
| P0 | [src/components/nav/PrimaryNav.tsx](../../../src/components/nav/PrimaryNav.tsx) | 全文 | 2-2（サブナビ追加先）。既存「サークル」配下の `currentGroup` サブ link 実装が完全な mirror 対象 |
| P0 | [src/lib/services/current-group.tsx](../../../src/lib/services/current-group.tsx) | 1-178 | `refreshGroups()` の挙動と `groups` state の lifecycle（1-2 修正の中心） |
| P0 | [src/lib/firebase/repositories/tournaments.ts](../../../src/lib/firebase/repositories/tournaments.ts) | 80-105, 384-435 | `listTournamentsByGroup` / `subscribeTournament` / `deleteTournamentIfSetup` — 1-3 / 2-2 で参考 |
| P1 | [src/lib/firebase/repositories/tables.ts](../../../src/lib/firebase/repositories/tables.ts) | 60-75 | `writeBatch` 使用例（1-3 で sub-collection 削除に流用） |
| P1 | [src/components/tournament/NextBreakCard.tsx](../../../src/components/tournament/NextBreakCard.tsx) | 全文 | 1-1（早期 return を緩和して setup/seating でも描画） |
| P1 | [src/components/tournament/AverageStackCard.tsx](../../../src/components/tournament/AverageStackCard.tsx) | 全文 | 1-1 |
| P1 | [src/components/tournament/PlayersCard.tsx](../../../src/components/tournament/PlayersCard.tsx) | 全文 | 1-1 |
| P1 | [src/components/tournament/SoundToggleButton.tsx](../../../src/components/tournament/SoundToggleButton.tsx) | 全文 | 1-2（state は親から props 経由で受け取るため、本体は無改修。親 dashboard 側の更新が課題） |
| P1 | [src/components/tournament/TimerDisplay.tsx](../../../src/components/tournament/TimerDisplay.tsx) | 全文 | 1-6（setup/seating の "開始前" バッジが既に内部で出ている） |
| P2 | [src/lib/firebase/repositories/tournaments.test.ts](../../../src/lib/firebase/repositories/tournaments.test.ts) | 647-675 | `deleteTournamentIfSetup` テスト — 1-3 で finished ケースを追加 |
| P2 | [src/lib/firebase/repositories/tables.ts](../../../src/lib/firebase/repositories/tables.ts) | 60-75 | `writeBatch` 構造をそのまま流用 |
| P2 | [tests/e2e/nav-and-sound-toggle.spec.ts](../../../tests/e2e/nav-and-sound-toggle.spec.ts) | 全文 | 2-1 / 2-2（ナビ label rename + サブナビ assertion） |
| P2 | [firestore.rules](../../../firestore.rules) | 270-355 | `update, delete: isOrganizer(...)` が finished にも効くこと、sub-collection delete の権限を再確認 |
| Always | [.claude/rules/firebase-patterns.md](../../rules/firebase-patterns.md) | 全文 | repository 経由 / zodConverter / AppError ラップ |
| Always | [.claude/rules/error-logging.md](../../rules/error-logging.md) | 全文 | `AppError.from(...)` + `logger.warn` |
| Always | [.claude/rules/group-membership.md](../../rules/group-membership.md) | 全文 | 削除可否 / organizer 権限 |

## External Documentation

| Topic | Source | Key Takeaway |
| --- | --- | --- |
| Fullscreen API | MDN `Element.requestFullscreen` / `Document.exitFullscreen` / `fullscreenchange` | (1) ユーザー gesture 内で同期的に呼ぶこと（Promise を返す）。(2) Safari / 古い iOS は `webkitRequestFullscreen` / `webkitExitFullscreen` の prefix を使う場合がある — 現時点の対応 PC ブラウザはすべて prefixed 不要だが、`document.fullscreenElement` 取得時のみ `webkitFullscreenElement` の OR 評価でフォールバックする。(3) iOS Safari は `<video>` 以外の要素 fullscreen をサポートしないが、本機能は PC 想定（運営者 dashboard）なので一次対応は document-level のみ。 |
| Firestore batch delete サブコレクション | Firebase SDK docs | クライアント SDK には cascade 削除が無いため、明示的に sub-collection を `getDocs` → `writeBatch.delete` する。tournaments の sub-collection は `players` / `tables` の 2 種のみ（firestore.rules の `match /{sub=**}` は他に存在しない）。1 batch あたり最大 500 ops の制限内に収まる（参加者 20 人 + 卓 6 ＝ 26 ops）。 |

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:415-435
export async function deleteTournamentIfSetup(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await getTournament(tid);
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError("既に開始済みのトーナメントは削除できません", "tournament/already-started");
  }
  try {
    await deleteDoc(doc(tournamentsRef, tid));
    logger.info("tournament delete ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
```

### ERROR_HANDLING

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:208-235
try {
  await updateDoc(groupDocRef(gid), { audioSettings: parsed.data });
  logger.info("group audio settings updated", { gid, ... });
} catch (e) {
  const wrapped = AppError.from(e, "firestore/write_failed", "サウンド設定の更新に失敗しました");
  logger.warn(wrapped.message, { code: wrapped.code, gid });
  throw wrapped;
}
```

### LOGGING_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:50, 365
logger.info("tournament create ok", { tid: ref.id, gid: input.groupId });
logger.info("tournament finish ok", { tid, uid });
```

### REPOSITORY_PATTERN（バッチ削除）

```ts
// SOURCE: src/lib/firebase/repositories/tables.ts:61-75
export async function upsertTables(tid: string, tableNums: number[]): Promise<void> {
  try {
    const batch = writeBatch(firestore);
    for (const n of tableNums) {
      const ref = doc(tablesRef(tid), String(n));
      batch.set(ref, { tableNum: n, isBroken: false, createdAt: serverTimestamp() });
    }
    await batch.commit();
    logger.info("tables upsert ok", { tid, count: tableNums.length });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "テーブル登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}
```

### SUBSCRIBE_PATTERN

```ts
// SOURCE: src/lib/firebase/repositories/tables.ts:38-54
export function subscribeTables(
  tid: string,
  onNext: (tables: TableDoc[]) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    query(tablesRef(tid), orderBy("tableNum", "asc")),
    (snap) => {
      try {
        onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "テーブルデータが不正です"));
      }
    },
    (err) => onError(AppError.from(err, "firestore/subscribe_failed", "テーブル購読エラー")),
  );
}
```

### SIDEBAR_SUB_LINK_PATTERN

```tsx
// SOURCE: src/components/nav/PrimaryNav.tsx:65-101
const isGroups = item.href === "/groups";
const groupSubHref = currentGroup ? `/groups/${currentGroup.id}` : null;
const groupSubActive = !!(groupSubHref && pathname?.startsWith(groupSubHref));
const rawActive =
  item.href === "/" ? pathname === "/" : (pathname?.startsWith(item.href) ?? false);
const active = isGroups && groupSubActive ? false : rawActive;
return (
  <Fragment key={item.label}>
    <li>
      <Link href={item.href} aria-current={active ? "page" : undefined} ...>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span>{item.label}</span>
      </Link>
    </li>
    {isGroups && currentGroup && groupSubHref ? (
      <li>
        <Link
          href={groupSubHref}
          aria-current={groupSubActive ? "page" : undefined}
          title={currentGroup.name}
          className={cn(
            "ml-7 flex h-9 items-center gap-2 truncate rounded-md border-l-2 border-transparent px-3 text-xs",
            "hover:bg-accent hover:text-accent-foreground",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            groupSubActive && "border-l-primary bg-accent font-semibold text-accent-foreground",
          )}
        >
          <span className="truncate">{currentGroup.name}</span>
        </Link>
      </li>
    ) : null}
  </Fragment>
);
```

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.test.ts:647-675
describe("deleteTournamentIfSetup", () => {
  it("rejects non-member", async () => {
    mockGetTournament(makeTournament());
    await expect(deleteTournamentIfSetup("t1", "u1", ["g-other"])).rejects.toMatchObject({
      code: "firestore/permission-denied",
    });
  });
  it("rejects when state is not setup", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    await expect(deleteTournamentIfSetup("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/already-started",
    });
  });
  // ...
});
```

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/app/tournaments/[tid]/dashboard-client.tsx` | UPDATE | 1-1 / 1-2 / 1-3 / 1-4 / 1-6 / 1-7 の主編集 |
| `src/components/tournament/NextBreakCard.tsx` | UPDATE | 1-1: setup/seating で開始前プレビューを描画 |
| `src/components/tournament/AverageStackCard.tsx` | UPDATE | 1-1: 同上 |
| `src/components/tournament/PlayersCard.tsx` | UPDATE | 1-1: 同上（受付済み件数を表示） |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | 1-3: `deleteTournamentIfSetup` を `deleteTournament` に拡張（setup or finished、sub-collection batch 削除）。新規 `subscribeTournamentsByGroup` を追加 |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATE | 1-3: 既存テストを `deleteTournament` 名に追従＋ finished 削除ケース追加。`subscribeTournamentsByGroup` の minimal smoke テスト |
| `src/components/nav/nav-items.ts` | UPDATE | 2-1: label rename |
| `src/components/nav/PrimaryNav.tsx` | UPDATE | 2-2: 「トーナメント一覧」配下に開催中トーナメントのサブリンク追加（onSnapshot 購読） |
| `tests/e2e/nav-and-sound-toggle.spec.ts` | UPDATE | 2-1 / 2-2: 旧 label `サークル` / `トーナメント` を新 label に追従、サブナビ assertion 追加（最低 1 件は describe レベルで skip 可） |
| `src/app/tournaments/tournaments-client.tsx` | （任意・スコープ外候補）| 1-3 のついでに list 画面でも削除導線を出す案。本 plan では NOT building 扱い |

## NOT Building

- `/live`（参加者用全画面ページ）の削除や統合 — 既存の参加者フローと E2E test（`anonymous-self-delete.spec.ts` / `audio-settings.spec.ts` など）が依存しているため触らない。
- `tournaments-client.tsx`（`/tournaments` 一覧）の終了済み削除ボタン追加 — 本要望は受付画面側のみの言及。dashboard で操作完結する。
- GroupProvider を `onSnapshot` 化する全面改修 — 1-2 は `refreshGroups()` 呼び出しで十分（最少差分）。
- サウンドトグルの楽観更新（optimistic UI） — `refreshGroups()` の遅延（数百 ms）は許容できる程度であり、楽観更新は roll-back ロジックを増やすため見送る。
- iOS Safari の Fullscreen 対応 — 1-7 は運営者 PC を主想定。`requestFullscreen` 失敗は `logger.warn` で握る。
- セキュリティルールの変更 — `tournaments/{tid}` の `update, delete: if isOrganizer(resource.data.groupId)` は state ガードを持たないため、既に finished の delete は rule で許容済み。
- 「ストラクチャ一覧」「テンプレート一覧」など他 nav item の label rename — ユーザー指定外。
- サイドバーのサブナビに `setup` 状態のトーナメントを含めるか — 「開催中」≒ in-progress と解釈し、`seating` / `running` / `paused` の 3 状態のみ表示する。`setup` は受付準備中であり開催中ではない。`finished` は履歴。

---

## Step-by-Step Tasks

### Task 1: 受付画面の右列を恒常化（1-1）

- **ACTION**: `dashboard-client.tsx` の `showRightColumn` フラグと `gridColsClass` 動的切替を撤去し、grid を常に 3 列にする。右列カード 3 種は `running/paused/finished` 専用ガードを `setup/seating` も含む形に緩める。
- **IMPLEMENT**:
  - `dashboard-client.tsx:220-224` の `showRightColumn` / `gridColsClass` を削除し、`gridColsClass` を `"lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]"` で固定。
  - `dashboard-client.tsx:329-335` の `{showRightColumn ? ... : null}` 三項演算子を撤去し、常に `<aside>` を描画。
  - `NextBreakCard.tsx:31-37`: 早期 return を削除（または `setup/seating` も許容）。`info === null` を従来どおり「予定なし」表示に流用しつつ、`setup/seating` のときは初期値 `Lv 1 で break まであと N レベル / ETA: —`（`structureSnapshot.levels` から最初の break level を線形検索して該当しなければ「予定なし」）を出す。実装方針: `NextBreakCard` 内に `previewBreakInfo(tournament)` を追加し、`state in {setup, seating}` の場合に Level 1 起点で `levelsAhead` を計算（ETA は `null`）。
  - `AverageStackCard.tsx:23-31`: 早期 return から `setup/seating` を除外。`setup/seating` のときは `players.length === 0` ガードのみ（受付済み 0 のときは描画しない）にし、`average = initialStack`（受付済みは未バストとして `active = players.length`）を表示。subtitle を「受付中」と切替。
  - `PlayersCard.tsx:20-25`: 早期 return から `setup/seating` を除外。受付済みが `0` の場合のみ描画スキップ。`active = players.length`（busted フィールドは setup では常に false）でも実害なし — 既存 `players.filter((p) => !p.isBusted)` のままでよい。
- **MIRROR**: `TimerDisplay.tsx:38-46`（setup/seating で `previewLevel` を表示する既存パターン）。
- **IMPORTS**: 変更なし（`Level` 型は既に `structureSnapshot.levels` 経由で参照可能）。
- **GOTCHA**:
  - 右列カードを常時表示にすると `players.length === 0`（誰も受付していない瞬間）の見た目が空っぽになるため、各カードで `players.length === 0` のときは描画スキップ → grid のセルが空のまま列幅は維持される。
  - `gridColsClass` を const にしても `cn(...)` は使わず文字列リテラルで書いていることに注意（既存コードと同じ）。
  - `lg:items-stretch` は維持（カード等高化）。
- **VALIDATE**:
  - `npm run dev` → `/tournaments/{tid}` で setup → seating → running と進めても TimerDisplay の `text-7xl/8xl/[10rem]` が同じレイアウトのまま。
  - `npm test -- NextBreakCard PlayersCard AverageStackCard` がグリーン。

### Task 2: サウンドトグルのリアクティブ反映（1-2）

- **ACTION**: `dashboard-client.tsx` の `onToggleEnabled` で `updateAudioSettings` 成功後に `refreshGroups()` を呼び、GroupProvider の `groups` を再フェッチして `tournamentGroup.audioSettings.enabled` を即時反映する。
- **IMPLEMENT**:
  - `useCurrentGroup()` から `refreshGroups` を追加で取得。
  - `dashboard-client.tsx` 内 `audio={...}` の `onToggleEnabled` 関数を:
    ```ts
    onToggleEnabled: async (next: boolean) => {
      try {
        await updateAudioSettings(tournamentGroup.id, {
          ...tournamentGroup.audioSettings,
          enabled: next,
        });
        await refreshGroups();
      } catch (e) { ... 既存 wrap ... }
    }
    ```
- **MIRROR**: `current-group.tsx:131-134` の `refreshGroups` 公開 API。`SoundToggleButton` 自体は無改修で props 経由の `enabled` を信頼。
- **IMPORTS**: 既存 `useCurrentGroup` の戻り値に追加プロパティを取るのみ。
- **GOTCHA**:
  - `refreshGroups()` 内部で `setLoading(true)` が走り `useCurrentGroup().loading` が true になるため、dashboard 上の他 hook が「読込中…」分岐に飛ばないよう、本 dashboard では `loading` を render gate に使っていないことを確認（既存実装は `groupsLoading` を別 flag として参照しているため OK）。
  - `await refreshGroups()` は失敗してもユーザーに見える形のリカバリは不要（次回 mount で復旧）。失敗ログは provider 内で warn 済み。dashboard 側で再 throw しない。
  - 本 fix で `audio-settings` ページからの遷移後の即時反映も改善されるが、副作用として GroupProvider が full reload するため画面ちらつきの懸念がある — 既存 `loading` 制御は `currentGroup.tsx` 内部で完結しており、dashboard は `groupsLoading` を再利用するだけなので問題なし。
- **VALIDATE**:
  - `/tournaments/{tid}` で running 状態にし、サウンドトグル（緑/赤）をクリック → ボタン色がリロードなしで切り替わる。
  - `npm test -- dashboard` 既存テスト（あれば）緑。

### Task 3: 終了済みトーナメントの削除導線（1-3）

- **ACTION**: `deleteTournamentIfSetup` を **`deleteTournament`** にリネーム（破壊的 — Phase 2.5 先例どおり互換 alias を作らない）し、`setup` または `finished` を許容、sub-collection（players / tables）を `writeBatch` で cascade 削除する。dashboard で `state==="setup" || state==="finished"` のとき削除ボタンを出す。
- **IMPLEMENT**:
  - `tournaments.ts:415` の関数を以下に置換:
    ```ts
    export async function deleteTournament(
      tid: string,
      uid: string,
      userGroupIds: string[],
    ): Promise<void> {
      const t = await getTournament(tid);
      if (!t.groupId || !userGroupIds.includes(t.groupId)) {
        throw new AppError("not allowed", "firestore/permission-denied");
      }
      if (t.state !== "setup" && t.state !== "finished") {
        throw new AppError(
          "進行中のトーナメントは削除できません（先に終了してください）",
          "tournament/in-progress",
        );
      }
      try {
        // sub-collection を batch で先に削除（max 500 ops / batch、1 トーナメント
        // あたり participants 20 + tables 6 = 26 程度なので 1 batch で収まる）
        const batch = writeBatch(firestore);
        const playersSnap = await getDocs(
          collection(firestore, "tournaments", tid, "players"),
        );
        playersSnap.forEach((d) => batch.delete(d.ref));
        const tablesSnap = await getDocs(
          collection(firestore, "tournaments", tid, "tables"),
        );
        tablesSnap.forEach((d) => batch.delete(d.ref));
        batch.delete(doc(tournamentsRef, tid));
        await batch.commit();
        logger.info("tournament delete ok", {
          tid,
          uid,
          state: t.state,
          players: playersSnap.size,
          tables: tablesSnap.size,
        });
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント削除に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code });
        throw wrapped;
      }
    }
    ```
  - `dashboard-client.tsx:178-189` `onDelete` の関数名・error wrap は維持しつつ、`deleteTournamentIfSetup` を `deleteTournament` に差し替え。
  - `dashboard-client.tsx:213` の `canEdit` は `setup` の編集可否に閉じる。新規に `canDelete = isMember && (data.state === "setup" || data.state === "finished")` を導出し、削除ボタンの条件に使う。`canEdit` は引き続き「編集」ボタンの条件として使用。
  - `dashboard-client.tsx:250-261` のボタン群を以下に再構成:
    - `canEdit` のとき → `[編集]`（旧どおり）
    - `canDelete` のとき → `[削除]`（旧どおり）
    - 両者は独立（finished は編集不可・削除可）
  - Dialog（confirm）の文言を分岐:
    ```tsx
    {data.state === "setup"
      ? "「{name}」を削除します。state が `setup` のトーナメントを削除します。"
      : "「{name}」を削除します。終了済みのため履歴ごと削除されます。参加者・卓情報も同時に消去されます。"}
    ```
- **MIRROR**: `tables.ts:61-75`（writeBatch パターン）／既存 `deleteTournamentIfSetup` の error wrap。
- **IMPORTS**:
  - `tournaments.ts`: `getDocs` / `writeBatch` / `collection` を追加（`getDocs` は本ファイル既存の `import` 行に未掲載 — 確認後に追加）。
  - `dashboard-client.tsx`: `deleteTournamentIfSetup` を `deleteTournament` に差し替え。
- **GOTCHA**:
  - **互換レイヤを作らない**: 関数 rename は破壊的（旧名は残さない）。テストファイル（`tournaments.test.ts`）も rename 必須。grep で他に呼び出しがないことを確認済み（`dashboard-client.tsx:35,181` のみ）。
  - Firestore rules: `tournaments/{tid}` の delete は `isOrganizer(resource.data.groupId)` で OK、sub-collection の `match /{sub=**}` の `allow write` は `exists(/tournaments/{tid}) && isOrganizer(...)` で OK — つまり **親 doc を最後に delete しないと sub-collection の権限評価で `exists` が失敗する**。`writeBatch` は単一トランザクションなので、batch 内の操作が同 request 内で評価される際、`exists()` 評価は **書込前のスナップショット**を見る ＝ 親 doc がまだ生きている状態で sub の delete を許可する。Firebase の rule 評価は `request.resource` / `resource` を中心としつつ、`exists()` は当該 request 開始時点の DB を参照するため安全。**この前提が崩れた場合は分割（先に sub-collection delete をコミット → 親 doc delete を別 commit）にフォールバック**する。
  - `getDocs` でサブコレクション全件を読むのは organizer 権限で許可される（既存 `subscribePlayers` / `listTables` と同じ）。
  - `tournament/in-progress` という新コードを導入するため、`error-logging.md` の domain code prefix 規約（`tournament/*`）に準拠している。既存に類似コードがないことを `grep -n "tournament/" src/` で確認すること。
- **VALIDATE**:
  - 新規テスト: `deleteTournament` が `state=running` で `tournament/in-progress` を throw / `state=finished` で batch.commit を呼び players, tables, tournament の 3 種を delete する。
  - 既存テスト: `state=setup` の happy path / non-member rejection が引き続き通る。
  - 手動: 終了済みトーナメントの dashboard で削除ボタンを押下 → 一覧から消える。Firestore Console（または Emulator）で sub-collection が残っていないこと。

### Task 4: 「一覧へ戻る」ボタン削除（1-4）

- **ACTION**: `dashboard-client.tsx:240-244` の `<Link href="/tournaments"><Button>一覧へ戻る</Button></Link>` を削除。
- **IMPLEMENT**: 該当ブロックのみを削除。`Link` import が他で使われていれば残す（fullscreen 化により `next/link` import の削除可否は task 6 の結果次第）。
- **MIRROR**: 単純削除のため mirror 不要。
- **IMPORTS**: `Link` の import が他で使われない場合は削除、使われていれば維持。
- **GOTCHA**: E2E（`audio-settings.spec.ts` 等）が「一覧へ戻る」ボタンを参照していないことを `grep -rn "一覧へ戻る" tests/` で確認（事前確認では tests/ 配下に該当無し）。
- **VALIDATE**: `npm run dev` → ヘッダのボタン群から「一覧へ戻る」が消えていること。

### Task 5: トーナメント名横の state バッジ削除（1-6）

- **ACTION**: `dashboard-client.tsx:232` の `<span className="rounded bg-muted px-2 py-0.5 text-xs">{data.state}</span>` を削除。`ConnectionBadge` は維持。
- **IMPLEMENT**: 該当 1 行（または `{data.name}` と `<ConnectionBadge>` の間の `<span>`）のみ削除。
- **MIRROR**: なし。
- **GOTCHA**: 表示の真実源は `TimerDisplay` 内の `stateBadge.label`（`tournament.state` ベース）。`ConnectionBadge` は別の概念（接続状態）なので残す。
- **VALIDATE**: 受付画面のトーナメント名横に raw `setup` / `running` 等の英語ラベルが出ていないこと。`TimerDisplay` 内の日本語バッジ（開始前 / 進行中 / 一時停止中 / 終了）は変更なし。

### Task 6: 「全画面表示」を Fullscreen API トグルに置換（1-7）

- **ACTION**: `dashboard-client.tsx:245-249` の `<Link href="/tournaments/${tid}/live"><Button>全画面表示</Button></Link>` を、現ページのまま `document.documentElement.requestFullscreen()` をトグルする `Button` に置換。`fullscreenchange` イベントを購読してアイコンを Maximize ↔ Minimize に切替。
- **IMPLEMENT**:
  - 新規 `useState<boolean>` で `isFullscreen` を管理。
  - `useEffect` で `document.addEventListener("fullscreenchange", () => setIsFullscreen(!!document.fullscreenElement))` を登録。`webkitfullscreenchange` を OR 登録。cleanup で removeEventListener。
  - クリックハンドラ:
    ```ts
    async function toggleFullscreen() {
      try {
        if (document.fullscreenElement) {
          await document.exitFullscreen();
        } else {
          await document.documentElement.requestFullscreen();
        }
      } catch (e) {
        const wrapped = AppError.from(e, "ui/fullscreen-failed", "全画面化に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code });
      }
    }
    ```
  - ボタン UI:
    ```tsx
    <Button
      variant="outline"
      size="sm"
      aria-label={isFullscreen ? "全画面表示を解除" : "全画面表示"}
      onClick={() => void toggleFullscreen()}
    >
      {isFullscreen ? <Minimize aria-hidden className="h-4 w-4" /> : <Maximize aria-hidden className="h-4 w-4" />}
      <span className="ml-1">全画面表示</span>
    </Button>
    ```
- **MIRROR**: `useEffect` cleanup パターンは既存 hooks 多数（例: `dashboard-client.tsx:76-87` の subscribePlayers）。
- **IMPORTS**:
  - `lucide-react` の `Maximize`, `Minimize`。
  - `AppError`, `logger` は既に import 済み。
- **GOTCHA**:
  - `requestFullscreen` は user gesture 内で同期的に呼ぶ必要があるが、`onClick` 直下の `await` は許容される（ブラウザの Fullscreen API ガイドラインに準拠）。
  - 既存の `/tournaments/{tid}/live` 経由の参加者用全画面ページは触らない（E2E 依存）。dashboard の全画面化はあくまで「同じページのまま視野を最大化する」だけ。
  - **新ドメインコード `ui/fullscreen-failed`** を導入する点は `error-logging.md` で `tournament/* / firestore/* / auth/*` 例示のみだが「ドメインコード（prefix）を必ず付与」とあり、`ui/*` prefix を新設して問題ない。代替として `dashboard/fullscreen-failed` でもよい。本 plan では `ui/fullscreen-failed` を採用。
  - SSR 安全性: `document` は client component（`"use client"`）内 + イベントハンドラ内なので OK。`useEffect` も client side。
  - `webkit` prefix: `document.fullscreenElement` は modern browsers でサポート。Safari 15.4+ は unprefixed もサポート。古い Safari 対応は本 plan のスコープ外（NOT building）だが、`fullscreenchange` 登録時に `webkitfullscreenchange` を try-add しておけば軽い保険になる — 採用してよい。
  - サイドバーは fullscreen 中も表示される（`AppShell.tsx` の `FULLSCREEN_PATTERN` には dashboard URL は含まれない）。「全画面化」=ブラウザ chrome を非表示にする UI であり、内部 layout は変更しない（要件どおり）。
- **VALIDATE**:
  - `npm run dev` で dashboard を開き「全画面表示」を押下 → ブラウザ chrome が消えて dashboard が画面全体に。再押下で復帰。Esc で復帰してもアイコンが Maximize に戻る（fullscreenchange listener）。
  - 既存の `/tournaments/{tid}/live` ページが引き続き動作することを E2E で確認。

### Task 7: サイドバー label rename（2-1）

- **ACTION**: `nav-items.ts` の 2 件の label を変更。
- **IMPLEMENT**:
  ```ts
  // SOURCE: src/components/nav/nav-items.ts:31-32
  { href: "/groups", label: "サークル一覧", icon: Users, authOnly: true },
  { href: "/tournaments", label: "トーナメント一覧", icon: CalendarClock, authOnly: true },
  ```
- **MIRROR**: 変更なし。
- **IMPORTS**: なし。
- **GOTCHA**:
  - E2E（`tests/e2e/nav-and-sound-toggle.spec.ts:63-86` 周辺）が `getByRole("link", { name: "サークル" })` / `"トーナメント"` を **完全一致**で参照している。`nav-and-sound-toggle.spec.ts` を新 label に追従させる必要がある（Task 9 で対応）。
  - Sheet 側の selector も `"トーナメント"`（line 189）参照のため同様に追従。
- **VALIDATE**:
  - `npm run dev` でサイドバーに「サークル一覧」「トーナメント一覧」と表示されること。
  - `npm run test:e2e` の nav 系 spec がパス（Task 9 完了後）。

### Task 8: サイドバー「トーナメント一覧」配下に開催中サブナビ追加（2-2）

- **ACTION**: `PrimaryNav.tsx` で `item.href === "/tournaments"` のとき、現在 group の開催中（`seating` / `running` / `paused`）トーナメント一覧をサブリンクとして並べる。クリックで `/tournaments/{tid}` へ遷移（dashboard、member は内部で `/live` に redirect される既存挙動を活用）。
- **IMPLEMENT**:
  - `tournaments.ts` に `subscribeTournamentsByGroup` を追加（`tables.ts:38-54` パターンを mirror）:
    ```ts
    export function subscribeTournamentsByGroup(
      groupId: string,
      onNext: (items: TournamentDoc[]) => void,
      onError: (err: AppError) => void,
    ): () => void {
      // listTournamentsByGroup と同じく orderBy は付けず client 側ソート
      // （複合 index を避けるため）
      return onSnapshot(
        query(tournamentsRef, where("groupId", "==", groupId)),
        (snap) => {
          try {
            const items: TournamentDoc[] = [];
            for (const d of snap.docs) {
              try {
                items.push({ id: d.id, ...d.data() });
              } catch (e) {
                logger.warn("subscribe skipped invalid tournament", { tid: d.id });
              }
            }
            items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
            onNext(items);
          } catch (e) {
            onError(AppError.from(e, "firestore/invalid-data", "トーナメント一覧データが不正です"));
          }
        },
        (err) => onError(AppError.from(err, "firestore/subscribe_failed", "一覧購読エラー")),
      );
    }
    ```
  - `PrimaryNav.tsx` の `useCurrentGroup()` 呼び出しに加え、`useState<TournamentDoc[]>` と `useEffect` で `subscribeTournamentsByGroup(currentGroupId, ...)` を呼ぶ。`currentGroupId === null` のときは購読しない。
  - 「トーナメント一覧」アイテムを描画するブロックで、`item.href === "/tournaments"` のときだけ追加 `<li>` を `Fragment` 内で展開し、開催中（`["seating","running","paused"].includes(t.state)`）なものを `ml-7 ...` のサブリンクスタイルでリストする。各サブリンクは:
    ```tsx
    <Link
      href={`/tournaments/${t.id}`}
      aria-current={pathname === `/tournaments/${t.id}` ? "page" : undefined}
      onClick={onNavigate}
      title={t.name}
      className={cn(
        "ml-7 flex h-9 items-center gap-2 truncate rounded-md border-l-2 border-transparent px-3 text-xs",
        "hover:bg-accent hover:text-accent-foreground",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active && "border-l-primary bg-accent font-semibold text-accent-foreground",
      )}
    >
      <span aria-hidden className={dotClassFor(t.state)}>●</span>
      <span className="truncate">{t.name}</span>
    </Link>
    ```
    - `dotClassFor(state)` は同コンポーネント内のローカル関数:
      - `running` → `text-emerald-500`
      - `paused` → `text-amber-500`
      - `seating` → `text-slate-400`
  - `tournaments.test.ts` に `subscribeTournamentsByGroup` の minimal テスト（unsubscribe を返すことだけ確認）を追加。
- **MIRROR**:
  - 購読: `tables.ts:38-54`
  - サブリンクスタイル: `PrimaryNav.tsx:82-100`（`isGroups && currentGroup` の現在ブロック）
- **IMPORTS**:
  - `PrimaryNav.tsx`: `subscribeTournamentsByGroup`, `TournamentDoc` 型を追加。
  - `tournaments.ts`: 既存の `onSnapshot` / `query` / `where` を流用。
- **GOTCHA**:
  - サイドバー内で onSnapshot を張ることは少なくとも 1 query 増えるが、20 人 × 月 1〜2 回スケールなら無問題（[firebase-patterns.md](../../rules/firebase-patterns.md) 参照）。
  - クリック先は `/tournaments/{tid}` 一本に統一（dashboard）。一般メンバーは dashboard 内の useEffect で `/live` に replace される（[dashboard-client.tsx:152-161](../../../src/app/tournaments/[tid]/dashboard-client.tsx#L152-L161)）ため、ロール別に href を分ける必要はない。
  - active 判定: `pathname === ` 完全一致は `/tournaments/{tid}/edit` 等の派生ルートでは false になる。`pathname?.startsWith(`/tournaments/${t.id}`)` を採用すること。親「トーナメント一覧」link 側は既存ロジックどおり active 評価し、サブリンクが active のときは親 link の active を解除（`isGroups` 同様の `isTournaments && tournamentSubActive` 分岐）。
  - currentGroupId 切替時に subscribe を確実に切替えるため `useEffect` deps に `currentGroupId` を入れる。
  - SSR / hydration: 初回 render 時は `tournaments=[]` で start し、subscribe で埋める。サブリンクが後から表示される程度のズレは UX 的に許容。
- **VALIDATE**:
  - `npm run dev` で開催中トーナメントを 1 件作成 → サイドバーの「トーナメント一覧」直下にサブリンクとして表示。クリックで dashboard へ。
  - state を finished にすると約 1 秒以内にサブリンクが消える（onSnapshot リアルタイム反映）。
  - `npm test -- tournaments.repository` で `subscribeTournamentsByGroup` smoke テスト緑。

### Task 9: E2E テスト追従（2-1 / 2-2）

- **ACTION**: `tests/e2e/nav-and-sound-toggle.spec.ts` の selector を新 label に追従し、サブナビ表示 spec を 1 件追加。
- **IMPLEMENT**:
  - `getByRole("link", { name: "サークル" })` → `name: "サークル一覧"` に置換（PR 作業時は `replace_all`）。同様に `"トーナメント"` → `"トーナメント一覧"`。
  - 新規 test: organizer で running トーナメントを 1 件作成 → サイドバー内に当該 `t.name` のサブリンクが見え、クリックで `/tournaments/{tid}` に遷移する。
- **MIRROR**: 同 spec ファイル内の既存 organizer setup ヘルパ（`randomOrganizer` 等）。
- **IMPORTS**: 既存 helper のみ。
- **GOTCHA**:
  - サブリンクは `running/paused/seating` の 3 状態で出るので、test fixture でいずれかの状態に持っていく必要がある。最小実装: setup → seating（席を決定）まで進めて確認。
  - サブナビは onSnapshot 経由なので `await expect(...).toBeVisible({ timeout: 10000 })` 等で realtime 待ち合わせ。
- **VALIDATE**: `npm run test:e2e -- nav-and-sound-toggle` がグリーン。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `deleteTournament` rejects non-member | t1 / uid:u1 / userGroupIds:["g-other"] | throw `firestore/permission-denied` | ✓ |
| `deleteTournament` rejects in-progress | state=running, member | throw `tournament/in-progress` | ✓ |
| `deleteTournament` happy: setup | state=setup, member, players=0, tables=0 | batch.commit invoked、deleteDoc(parent) 含む 1 回 | basic |
| `deleteTournament` happy: finished with subdocs | state=finished, players=20, tables=6 | batch.delete を 27 回（players 20 + tables 6 + parent 1）→ commit | edge case |
| `deleteTournament` wraps batch errors | commit throws | re-throws as `firestore/write_failed` | ✓ |
| `subscribeTournamentsByGroup` returns unsubscribe | mock `onSnapshot` to return fn | result === fn | smoke |
| `NextBreakCard` renders preview in setup | state=setup, levels に break あり | "Lv N で break まで M レベル" 表示 | new |
| `NextBreakCard` renders 予定なし in setup w/o break | state=setup, levels に break なし | "予定なし" 表示 | edge |
| `AverageStackCard` renders in setup w/ players | state=setup, players=3, initialStack=10000 | "10,000" 表示 | new |
| `AverageStackCard` skips in setup w/o players | state=setup, players=0 | null | edge |
| `PlayersCard` renders in setup | state=setup, players=3 | "3 / 3" 表示 | new |

### Edge Cases Checklist

- [x] state=setup でカードが表示される / されない（players 0 件）
- [x] state=running ↔ paused 遷移で grid 列数が不変
- [x] サウンドトグル: 連続クリック（debounce は既存 `busy` で抑止 — `SoundToggleButton.tsx:30-37` で `busy` flag）
- [x] 削除 confirm dialog: setup / finished で文言が分岐
- [x] sub-collection 削除中に rule 失敗（exists() 評価が batch 内で反転）→ batch atomically rolled back（Firestore の保証）
- [x] Fullscreen API: 未対応ブラウザで `requestFullscreen` が undefined → `try/catch` でログのみ
- [x] Fullscreen 中に `Esc` キー押下 → `fullscreenchange` で listener が発火しアイコンが戻る
- [x] サイドバーサブナビ: currentGroupId が null のとき購読しない／空表示
- [x] サブナビ active 判定: `/tournaments/{tid}/edit` ページでも当該サブが active

---

## Validation Commands

### Static Analysis

```bash
npm run lint
npm run typecheck
```

EXPECT: Zero errors.

### Unit Tests

```bash
npm test -- tournaments.test
npm test -- NextBreakCard PlayersCard AverageStackCard
```

EXPECT: All green.

### Full Test Suite

```bash
npm test
```

EXPECT: No regressions.

### E2E

```bash
npm run test:e2e -- nav-and-sound-toggle audio-settings
```

EXPECT: Pass after Task 9.

### Manual Browser Validation

```bash
npm run dev
```

- [ ] 受付画面の右列カードが setup / seating / running / paused / finished で常に同じ列数を保つ
- [ ] サウンドトグルをクリック → ボタン色が即時切り替わる
- [ ] 「全画面表示」ボタン → 同じページがブラウザ全画面化、再押下で解除
- [ ] 終了済みトーナメントの dashboard で「削除」可能、Firestore 上で sub-collection も消える
- [ ] 受付画面ヘッダから「一覧へ戻る」と raw state バッジが消えている
- [ ] サイドバーが「サークル一覧」「トーナメント一覧」表記に変わっている
- [ ] 開催中トーナメント作成後、サイドバー「トーナメント一覧」配下にサブリンクが realtime に表示・消失する
- [ ] サブリンクをクリックすると当該トーナメント dashboard に遷移する

---

## Acceptance Criteria

- [ ] 1-1: 受付画面の grid が状態遷移で跳ねない
- [ ] 1-2: サウンドトグルクリックで UI が即時更新される（リロード不要）
- [ ] 1-3: 終了済みトーナメントを dashboard から削除できる（players / tables も同時に消える）
- [ ] 1-4: 受付画面ヘッダから「一覧へ戻る」が消える
- [ ] 1-6: トーナメント名横の raw state バッジが消える
- [ ] 1-7: 「全画面表示」が同ページの Fullscreen API トグルで動作する
- [ ] 2-1: サイドバー label が「サークル一覧」「トーナメント一覧」
- [ ] 2-2: 「トーナメント一覧」配下に開催中トーナメントが realtime で表示され、クリックで遷移できる
- [ ] All validation commands pass
- [ ] No regressions in `/live` 参加者ページ系 E2E

## Completion Checklist

- [ ] Code follows `firebase-patterns.md`（repository 経由・zodConverter・AppError ラップ）
- [ ] エラー処理は `error-logging.md` どおり（`AppError.from(...)` + `logger.warn`、`console.*` なし）
- [ ] Sub-collection 削除は `writeBatch` で atomic
- [ ] Tests follow existing pattern（`describe` / `it` / `mockGetTournament` 等）
- [ ] No hardcoded UI strings outside `dashboard-client.tsx` / `nav-items.ts`
- [ ] No 互換 alias for `deleteTournament`（旧 `deleteTournamentIfSetup` は完全削除）
- [ ] PRD（`.claude/PRPs/prds/allin-timer.prd.md`）に Phase 4.14 として追記（completion 時）
- [ ] Self-contained — no questions needed during implementation

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| sub-collection batch delete が rule の `exists()` 評価で reject される | Low | High（削除が常に失敗） | 失敗時は「先に sub-collection を delete commit → 親 doc を別 commit」の 2 段階に切替（Task 3 GOTCHA 参照）。最初のテスト時に Emulator で必ず検証する |
| Fullscreen API がブラウザ依存で挙動が割れる | Low | Low | `try/catch` + `logger.warn` で握り、UI ボタンは「見えるが効かない」状態を許容。iOS Safari は本 plan のスコープ外として明示 |
| `refreshGroups()` が GroupProvider 全体を re-fetch するため余分な Firestore read | Low | Low | サークル数は実運用でも 1 桁。月 1〜2 回開催のトグル頻度は低く、影響は無視できる |
| サイドバー subscribe による read 量増加 | Low | Low | 1 group あたり tournaments は 月数件オーダー。`/tournaments` ページ滞在中も同種 query を fetch しているため二重 query にはなるが許容 |
| nav E2E spec の漏れ追従で CI red | Medium | Medium | Task 9 で `getByRole("link", { name: "サークル" })` の grep を全 spec に対し実施し、確実に rename する |

## Notes

- Phase 4.14 とした命名は仮（PRD に Phase 4.14 が確保済みでない場合は実装計画の completion 時に PRD「Implementation Phases」表に Phase 4.14 を追記する）。
- 1-5 はユーザー側で手動修正済みのため本 plan のスコープ外。本 plan で再修正しない（誤って rollback しないよう、`dashboard-client.tsx:228-238` のヘッダ部 description テキストには触れない — `flex items-center gap-2` の中身のみ削除）。
- 本 plan の信頼スコア: **8/10**（最大の不確実性は Task 3 の rule `exists()` 評価が batch 内でどう評価されるかで、Emulator 検証で即収束予定）。
