# Plan: シーズンタブ順位インライン表示（要望②）

## Summary

サークル詳細画面の「シーズン」タブを開くだけで今シーズンの順位表が見えるようにする。現在 3 箇所（現シーズンランキング画面 / 過去シーズン詳細 / 本機能のインライン）で重複している順位表 `<table>` を共有コンポーネント `SeasonRankingTable` に集約し、タブ内に `subscribeSeasonStats` 購読パネルをインライン埋め込みする。既存 `/groups/[gid]/season` ページは share ボタン・過去シーズン履歴の導線としてそのまま維持する。

## User Story

As a サークルメンバー,
I want シーズンタブを開いた瞬間に今シーズンの順位表を見たい,
So that 「ランキングを見る」をクリックして別ページに遷移する手間なく戦績を確認できる。

## Problem → Solution

**現状**: シーズンタブには `SeasonCard`（開始日 + 「ランキングを見る」リンク）と `SeasonPointsRuleCard` だけが並び、順位表を見るには `/groups/[gid]/season` へ追加クリック遷移が必要。
**desired**: シーズンタブを選択するだけで順位表がインライン表示される（追加クリック不要）。`/season` ページは引き続き動作し、share・過去シーズン履歴の置き場として残る。

## Metadata

- **Complexity**: Small〜Medium
- **Source PRD**: [.claude/PRPs/06-second-dryrun-improvements/prds/06-second-dryrun-improvements.prd.md](../prds/06-second-dryrun-improvements.prd.md)
- **PRD Phase**: Phase 2 — シーズンタブ順位インライン（要望②）
- **Estimated Files**: 8（CREATE 4 / UPDATE 4）

---

## UX Design

### Before

```
サークル詳細 > [メンバー][シーズン][設定]
┌─ シーズン タブ ────────────────────────┐
│ ┌ シーズン (Card) ──────────────────┐  │
│ │ 現在シーズン開始: 2026/04/01       │  │
│ │ [ランキングを見る] [シーズンを開始] │  │  ← 順位を見るには遷移が必要
│ └───────────────────────────────────┘  │
│ ┌ ポイント計算ルール (Card) ────────┐  │
│ └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
        ↓ 「ランキングを見る」クリックで /groups/[gid]/season へ
```

### After

```
サークル詳細 > [メンバー][シーズン][設定]
┌─ シーズン タブ ────────────────────────┐
│ ┌ シーズン (Card) ──────────────────┐  │
│ │ 現在シーズン開始: 2026/04/01       │  │
│ │ [ランキングを見る] [シーズンを開始] │  │
│ └───────────────────────────────────┘  │
│ ┌ 順位表 (インライン) ───────────────┐  │  ← タブ選択だけで表示
│ │ 順位 表示名 参加 優勝 FT 累計pt    │  │
│ │  1   Alice   5   2   3  47.83 pt   │  │
│ │  2   Bob     3   1   2  28.12 pt   │  │
│ └───────────────────────────────────┘  │
│ ┌ ポイント計算ルール (Card) ────────┐  │
│ └───────────────────────────────────┘  │
└─────────────────────────────────────────┘
（戦績 0 件のときは「このシーズンの戦績はまだありません…」メッセージ）
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| シーズンタブ表示 | SeasonCard + PointsRuleCard のみ | + 順位表インライン | `subscribeSeasonStats` realtime |
| 順位確認 | 「ランキングを見る」で `/season` へ遷移 | タブ内で即確認 | `/season` は維持（share / 履歴導線） |
| SeasonCard の「ランキングを見る」リンク | 順位表ページへ | 据え置き（share + 過去シーズン履歴の置き場として継続） | ラベル不変・挙動不変 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) | 全行 | 抽出元の順位表 `<table>`（143-168）と subscribe パターン（51-59） |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx) | 354-430 | season タブの children map 構造。ここに panel を追加 |
| P0 | [src/lib/firebase/repositories/seasonStats.ts](../../../../src/lib/firebase/repositories/seasonStats.ts) | 74-116 | `subscribeSeasonStats(gid, onNext, onError)` の契約（unsubscribe を返す） |
| P1 | [src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx](../../../../src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx) | 104-208 | もう 1 つの重複 `<table>`（183-208）。共有化の 2 つ目の callsite |
| P1 | [src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx) | 全行 | gid だけ受け取り内部で fetch + loading/error/empty を出す自己完結 panel の先例 |
| P1 | [src/lib/firebase/schemas/seasonStats.ts](../../../../src/lib/firebase/schemas/seasonStats.ts) | 全行 | `SeasonStatsDoc` の field 形（id / displayName / participations / wins / finalTables / totalPoints） |
| P2 | [src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx) | 全行 | repository を `vi.mock` する component test の mirror |
| P2 | [tests/e2e/group-detail-tabs.spec.ts](../../../../tests/e2e/group-detail-tabs.spec.ts) | 38-56 | season タブ E2E の mirror（`detail.selectTab("season")`） |
| P2 | [tests/e2e/phase-d-share-and-history.spec.ts](../../../../tests/e2e/phase-d-share-and-history.spec.ts) | 155-253 | 終了 → seasonStats 更新 → `?tab=season` の既存フロー（インライン assert 追加先） |
| P2 | [tests/e2e/pages/GroupsPage.ts](../../../../tests/e2e/pages/GroupsPage.ts) | 47-82 | `GroupDetailPage`（`selectTab` / `tabButton` / `expectLoaded`）。新 locator 追加先 |

## External Documentation

No external research needed — feature uses established internal patterns（Firestore subscribe / shadcn table markup / React `useEffect` cleanup）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```tsx
// SOURCE: src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx:22
// gid だけ受け取り内部で購読/fetch する自己完結 panel。PascalCase component。
export function SeasonHistoryList({ gid }: { gid: string }) { ... }
```

### SUBSCRIBE_PATTERN

```tsx
// SOURCE: src/app/groups/[gid]/season/season-ranking-client.tsx:51-59
useEffect(() => {
  if (!user) return;
  const unsub = subscribeSeasonStats(
    gid,
    (items) => setStats(items),
    (err) => setError(formatErrorForDisplay(err)),
  );
  return unsub;            // cleanup で unsubscribe
}, [gid, user]);
```

### ERROR_HANDLING

```tsx
// SOURCE: src/app/groups/[gid]/season/season-ranking-client.tsx:62-73
if (error) {
  return (
    <p className="text-sm text-destructive" role="alert">
      {error}
    </p>
  );
}
// onError には formatErrorForDisplay(AppError) 済みの文字列を渡す
```

### TABLE_MARKUP（抽出対象 — 3 箇所で同一）

```tsx
// SOURCE: src/app/groups/[gid]/season/season-ranking-client.tsx:143-168
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
        <td className="py-2 text-right font-semibold">{s.totalPoints.toFixed(2)} pt</td>
      </tr>
    ))}
  </tbody>
</table>
```

### LOADING_STATE

```tsx
// SOURCE: src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx:58-72
if (loading) return <p className="text-sm text-muted-foreground">読込中…</p>;
if (error) return <p className="text-sm text-destructive" role="alert">{error}</p>;
if (items.length === 0) return null;  // ← 本機能では空メッセージを出す（差分注意）
```

### TEST_STRUCTURE

```tsx
// SOURCE: src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx:11-37
vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({
  listSeasonHistory: vi.fn(),
}));
function makeHistory(overrides: Partial<SeasonHistoryDoc> = {}): SeasonHistoryDoc {
  return { id: "season-1", startedAt: startTs, endedAt: endTs, entries: [], ...overrides };
}
beforeEach(() => vi.mocked(listSeasonHistory).mockReset());
afterEach(() => vi.restoreAllMocks());
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/components/group/SeasonRankingTable.tsx` | CREATE | 順位表 `<table>` の共有 presentational component（3 callsite を集約） |
| `src/components/group/SeasonRankingTable.test.tsx` | CREATE | 行描画・順位採番・0.00 pt / toFixed(2) の characterization |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.tsx` | CREATE | gid を受け取り `subscribeSeasonStats` で購読 → SeasonRankingTable を描画する自己完結 panel |
| `src/app/groups/[gid]/_components/SeasonRankingPanel.test.tsx` | CREATE | loading / empty / error / rows 描画の振る舞い |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | season タブ children に `<SeasonRankingPanel gid={gid} />` を追加 |
| `src/app/groups/[gid]/season/season-ranking-client.tsx` | UPDATE | inline `<table>` を `<SeasonRankingTable rows={stats} />` に置換 |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` | UPDATE | inline `<table>` を `<SeasonRankingTable rows={...} />` に置換（entries の uid→id map） |
| `tests/e2e/group-detail-tabs.spec.ts` または `tests/e2e/phase-d-share-and-history.spec.ts` | UPDATE | season タブにインライン順位表が出ることを E2E で検証（空 + 実データ） |
| `tests/e2e/pages/GroupsPage.ts` | UPDATE（任意） | `seasonRankingInline` locator helper を追加 |

## NOT Building

- **share ボタン / SeasonTopCardDownloadButton をインラインパネルに載せること** — share は `/season` ページに据え置く。インラインは順位表のみ（要望②の趣旨は導線短縮であって share の重複配置ではない）
- **`/groups/[gid]/season` ページの廃止 / リダイレクト** — Decisions Log で「履歴詳細用に維持」と確定済み
- **schema / repository / firestore.rules の変更** — `subscribeSeasonStats` は既存。read 権限（group メンバー全員）も既存で十分
- **SeasonCard の「ランキングを見る」リンク削除** — 据え置き（share + 過去シーズン履歴の置き場として継続。挙動変更すると既存 E2E / UX に影響）
- **ポイント計算ロジック・並び順の変更** — `totalPoints desc` は repository 側で sort 済み（client 側）

---

## Step-by-Step Tasks

### Task 1: 共有コンポーネント `SeasonRankingTable` を作成

- **ACTION**: `src/components/group/SeasonRankingTable.tsx` を新規作成
- **IMPLEMENT**:
  ```tsx
  "use client";

  /** 順位表 1 行分の最小形。SeasonStatsDoc / seasonHistory entry の双方が構造的に充足する。 */
  export interface SeasonRankingRow {
    id: string;
    displayName: string;
    participations: number;
    wins: number;
    finalTables: number;
    totalPoints: number;
  }

  /**
   * シーズン順位表（presentational）。
   *
   * 現シーズンランキング画面 / 過去シーズン詳細 / サークル詳細シーズンタブの
   * 3 箇所で同一だった `<table>` を集約。並び順は呼出側で確定済みの前提
   * （`totalPoints desc`）。順位は配列 index + 1。
   */
  export function SeasonRankingTable({ rows }: { rows: SeasonRankingRow[] }) {
    return (
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
          {rows.map((r, i) => (
            <tr key={r.id} className="border-b">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{r.displayName}</td>
              <td className="py-2 text-right">{r.participations}</td>
              <td className="py-2 text-right">{r.wins}</td>
              <td className="py-2 text-right">{r.finalTables}</td>
              <td className="py-2 text-right font-semibold">{r.totalPoints.toFixed(2)} pt</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }
  ```
- **MIRROR**: TABLE_MARKUP（season-ranking-client.tsx:143-168）をそのまま移植
- **IMPORTS**: なし（純 presentational。`"use client"` は親が client component のため必須ではないが既存ファイル慣習に合わせ付与）
- **GOTCHA**: `key` を `id` に統一する。history entry は `uid` を持つため呼出側で `id: e.uid` に map する（Task 4）。`totalPoints.toFixed(2)` の挙動（0 → "0.00"）を変えないこと
- **VALIDATE**: `npx tsc --noEmit` で型エラー 0

### Task 2: `SeasonRankingTable` の characterization test

- **ACTION**: `src/components/group/SeasonRankingTable.test.tsx` を作成
- **IMPLEMENT**: render して (1) 6 列ヘッダが出る (2) 行が渡した順序で並ぶ・順位は 1 始まり (3) `totalPoints` が `toFixed(2)`（例 47.8 → "47.80"、0 → "0.00"）で表示される を assert。fixture factory `makeRow(overrides)` を用意
- **MIRROR**: SeasonHistoryList.test.tsx の `makeHistory` factory パターン（fixture factory 規約 [testing.md](../../../rules/testing.md)）
- **IMPORTS**: `import { render, screen } from "@testing-library/react";` `import { describe, expect, it } from "vitest";`
- **GOTCHA**: presentational なので mock 不要。`screen.getAllByRole("row")` で行数 = rows.length + 1（ヘッダ）を確認
- **VALIDATE**: `npm test -- SeasonRankingTable`

### Task 3: 現シーズンランキング画面を共有コンポーネントに切替

- **ACTION**: `season-ranking-client.tsx` の inline `<table>`（143-168）を `<SeasonRankingTable rows={stats} />` に置換
- **IMPLEMENT**: import 追加 `import { SeasonRankingTable } from "@/components/group/SeasonRankingTable";`。`<table>...</table>` ブロックを `<SeasonRankingTable rows={stats} />` に置換。share ボタンブロック（110-142）と `SeasonHistoryList`（169）は据え置き
- **MIRROR**: SUBSCRIBE_PATTERN は既存のまま（変更不要）
- **IMPORTS**: 上記 1 行追加。`SeasonStatsDoc[]` は `SeasonRankingRow[]` に構造的代入可（余剰 field `uid`/`lastUpdatedAt` は無害）
- **GOTCHA**: 観測可能挙動を変えないこと（列・並び・表示は同一）。E2E `phase-d` 詳細ページ table assert（247-250）が壊れないよう markup を維持
- **VALIDATE**: `npx tsc --noEmit`、既存 E2E（phase-d）が緑

### Task 4: 過去シーズン詳細画面を共有コンポーネントに切替

- **ACTION**: `season-history-detail-client.tsx` の inline `<table>`（183-208）を `<SeasonRankingTable rows={...} />` に置換
- **IMPLEMENT**:
  ```tsx
  <SeasonRankingTable
    rows={sortedEntries.map((e) => ({
      id: e.uid,
      displayName: e.displayName,
      participations: e.participations,
      wins: e.wins,
      finalTables: e.finalTables,
      totalPoints: e.totalPoints,
    }))}
  />
  ```
  share ボタンブロック（142-182）は据え置き
- **MIRROR**: Task 3 と同じ置換
- **IMPORTS**: `import { SeasonRankingTable } from "@/components/group/SeasonRankingTable";`
- **GOTCHA**: history entry は `uid` のみ（`id` なし）なので必ず `id: e.uid` を付与。`sortedEntries` の並びは既に `totalPoints desc`
- **VALIDATE**: `npx tsc --noEmit`、E2E phase-d の詳細ページ table assert（Alice/Bob 両方表示）が緑

### Task 5: インライン購読パネル `SeasonRankingPanel` を作成

- **ACTION**: `src/app/groups/[gid]/_components/SeasonRankingPanel.tsx` を作成
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { useEffect, useState } from "react";

  import { SeasonRankingTable } from "@/components/group/SeasonRankingTable";
  import { formatErrorForDisplay } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { subscribeSeasonStats } from "@/lib/firebase/repositories/seasonStats";
  import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";

  /**
   * Phase 2 (06): サークル詳細「シーズン」タブにインライン表示する順位表 panel。
   *
   *  - `subscribeSeasonStats` で realtime 購読（season-ranking-client と同契約）
   *  - 初回 snapshot まで「読込中…」、0 件は案内文、>0 件で SeasonRankingTable
   *  - 自己完結（gid のみ受け取り内部で useAuthUser）。SeasonHistoryList と同方針
   *  - share / 履歴は `/groups/[gid]/season` に据え置き、本 panel は順位表のみ
   */
  export function SeasonRankingPanel({ gid }: { gid: string }) {
    const { user } = useAuthUser();
    const [stats, setStats] = useState<SeasonStatsDoc[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
      if (!user) return;
      const unsub = subscribeSeasonStats(
        gid,
        (items) => {
          setStats(items);
          setLoading(false);
        },
        (err) => {
          setError(formatErrorForDisplay(err));
          setLoading(false);
        },
      );
      return unsub;
    }, [gid, user]);

    if (!user) return null;
    if (error) {
      return (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      );
    }
    if (loading) {
      return <p className="text-sm text-muted-foreground">順位を読込中…</p>;
    }
    if (stats.length === 0) {
      return (
        <p className="text-sm text-muted-foreground">
          このシーズンの戦績はまだありません。トーナメントが終了すると自動的に記録されます。
        </p>
      );
    }
    return (
      <section className="space-y-2" data-testid="season-ranking-inline">
        <h2 className="text-lg font-semibold">今シーズンの順位</h2>
        <SeasonRankingTable rows={stats} />
      </section>
    );
  }
  ```
- **MIRROR**: SUBSCRIBE_PATTERN（season-ranking-client:51-59）+ LOADING_STATE（SeasonHistoryList:58-72）。空メッセージ文言は season-ranking-client:103-105 を流用
- **IMPORTS**: 上記の通り
- **GOTCHA**: `subscribeSeasonStats` の onError は AppError を渡すので `formatErrorForDisplay` で文字列化してから set（season-ranking-client と同じ）。`return unsub` で必ず unsubscribe（メモリリーク防止）。`data-testid="season-ranking-inline"` を E2E scope 用に付与
- **VALIDATE**: `npx tsc --noEmit`

### Task 6: `SeasonRankingPanel` の振る舞いテスト

- **ACTION**: `src/app/groups/[gid]/_components/SeasonRankingPanel.test.tsx` を作成
- **IMPLEMENT**: `subscribeSeasonStats` と `useAuthUser` を mock。検証:
  1. 購読前は「順位を読込中…」
  2. onNext([]) で空メッセージ表示・table 非表示
  3. onNext([2 件]) で `season-ranking-inline` + 行 2 件が出る
  4. onError(AppError) で `role="alert"` にエラーコード文字列
  5. unmount で unsubscribe 関数が呼ばれる
  - mock は onNext/onError を手動 capture する形（`let captured; subscribeSeasonStats.mockImplementation((g,n,e)=>{captured={n,e};return unsub})`）
- **MIRROR**: SeasonHistoryList.test.tsx の `vi.mock` + factory。`useAuthUser` mock は既存テスト（例: グループ系 component test）の形を踏襲
- **IMPORTS**: `import { render, screen, act } from "@testing-library/react";` `vi.mock("@/lib/firebase/repositories/seasonStats", ...)` `vi.mock("@/lib/firebase/AuthProvider", ...)`
- **GOTCHA**: onNext を呼ぶ際は `act(() => captured.n([...]))` で wrap。fixture factory `makeStat(overrides)` で `SeasonStatsDoc` を生成（`lastUpdatedAt: Timestamp.now()` 相当はテスト固定 Timestamp で）
- **VALIDATE**: `npm test -- SeasonRankingPanel`

### Task 7: group-detail-client のシーズンタブに panel を追加

- **ACTION**: `group-detail-client.tsx` の season タブ children（413-430）に `<SeasonRankingPanel gid={gid} />` を追加
- **IMPLEMENT**: import `import { SeasonRankingPanel } from "./_components/SeasonRankingPanel";` を追加（44-54 の import 群に整列挿入）。season children を:
  ```tsx
  season: (
    <>
      <SeasonCard ... />
      <SeasonRankingPanel gid={gid} />
      <SeasonPointsRuleCard ... />
    </>
  ),
  ```
  に変更（SeasonCard の直後・PointsRuleCard の前に配置）
- **MIRROR**: 既存 children map の構造そのまま
- **IMPORTS**: 上記 1 行
- **GOTCHA**: `GroupDetailTabs` は非アクティブ panel を `hidden` 属性で DOM 維持（render 継続）するため、panel の `subscribeSeasonStats` はタブ非表示時も購読し続ける。20 人規模では許容（[firebase-patterns.md](../../../rules/firebase-patterns.md) の rule read コスト方針に沿う）。気になる場合のみ「season タブ active 時のみ subscribe」を後続検討（本 Phase では YAGNI）
- **VALIDATE**: `npm run dev` で `?tab=season` を開き順位表がインライン表示される

### Task 8: E2E でインライン表示を検証

- **ACTION**: 既存 E2E にインライン順位表の assert を追加
- **IMPLEMENT**:
  - **空状態**（`group-detail-tabs.spec.ts` の season タブ test 38-56 に追記、または新規 test）: 戦績 0 件のサークルで season タブ選択 → `season-ranking-inline` は出ず「このシーズンの戦績はまだありません」が見える
  - **実データ**（`phase-d-share-and-history.spec.ts` の 183-205 区間に追記）: finish 後 `?tab=season` を開いた時点で `[data-testid="season-ranking-inline"] table` に首位 Bob が見える（`/season` への遷移前に確認できることが要望②の本質）
  - 任意: `tests/e2e/pages/GroupsPage.ts` に `get seasonRankingInline(): Locator { return this.page.locator('[data-testid="season-ranking-inline"]'); }` を追加
- **MIRROR**: group-detail-tabs.spec.ts:49-55（`detail.selectTab("season")` → panel visible）
- **IMPORTS**: 既存 fixture（`createGroup` / `registerOrganizer` / `randomOrganizer` / `seedOrganizerTournament` / `joinAsGuest`）
- **GOTCHA**: realtime 反映待ちは `toBeVisible({ timeout: 15_000 })` を使う（既存 season 系 assert と同じ）。空状態 test は finished tournament を作らない素のサークルで実施
- **VALIDATE**: `npm run test:e2e -- group-detail-tabs` および `phase-d-share-and-history`

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| SeasonRankingTable: ヘッダ | rows=[] | 6 列ヘッダのみ・data 行 0 | yes（空） |
| SeasonRankingTable: 行描画 | rows=2 件 | 順位 1,2 / 各列値 / toFixed(2) | - |
| SeasonRankingTable: 端数 | totalPoints=0, 47.8 | "0.00", "47.80" | yes |
| Panel: 初期 | 購読未発火 | 「順位を読込中…」 | yes |
| Panel: 空 | onNext([]) | 案内文・table なし | yes |
| Panel: データ | onNext([2]) | `season-ranking-inline` + 2 行 | - |
| Panel: エラー | onError(AppError) | role=alert + code 文字列 | yes |
| Panel: cleanup | unmount | unsubscribe 呼出 | yes |

### Edge Cases Checklist

- [x] 空入力（戦績 0 件）→ 案内文
- [x] エラー（permission-denied 等）→ role=alert
- [ ] Maximum size input — 20 人規模では client sort で十分（大規模は対象外）
- [x] 並び順（`totalPoints desc`）は repository 側で確定、panel/table は非ソート
- [x] Concurrent access — realtime onSnapshot で自動反映
- [x] Permission denied — onError 経路

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```

EXPECT: 型エラー 0

### Lint

```bash
npm run lint
```

EXPECT: lint エラー 0（`console.*` 直呼び・swallow なし）

### Unit Tests（対象範囲）

```bash
npm test -- SeasonRankingTable SeasonRankingPanel
```

EXPECT: 全 pass

### Full Test Suite

```bash
npm test
```

EXPECT: 回帰なし（既存 SeasonHistoryList.test 等も緑）

### Browser Validation

```bash
npm run dev
# /groups/[gid]?tab=season を開く
```

EXPECT: シーズンタブ選択だけで順位表がインライン表示。`/groups/[gid]/season` も従来通り動作

### E2E

```bash
npm run test:e2e -- group-detail-tabs phase-d-share-and-history
```

EXPECT: インライン順位表の空/実データ assert が pass、既存 season フロー回帰なし

### Manual Validation

- [ ] シーズンタブを開く → 順位表がクリックなしで見える
- [ ] 戦績 0 件のサークル → 案内文が出る（table は出ない）
- [ ] `/groups/[gid]/season` に遷移 → 同じ順位表 + share + 過去シーズン履歴が従来通り
- [ ] 過去シーズン詳細ページ → 順位表が従来通り（Alice/Bob 表示）

---

## Acceptance Criteria

- [ ] シーズンタブ選択のみで順位表がインライン表示される（要望②の Success signal）
- [ ] 既存 `/groups/[gid]/season` ページが引き続き動作する
- [ ] 過去シーズン詳細ページが引き続き動作する
- [ ] 順位表 markup が 1 つの共有コンポーネントに集約された（3 → 1）
- [ ] 全 validation コマンド pass・型/ lint エラー 0
- [ ] unit + E2E が緑

## Completion Checklist

- [ ] discovered patterns（subscribe / table / loading）に準拠
- [ ] error handling は `formatErrorForDisplay(AppError)` 経路（[error-logging.md](../../../rules/error-logging.md)）
- [ ] logging — 本機能は新規 log 追加なし（subscribe の warn は repository 側で済）
- [ ] tests は fixture factory + helper 境界 mock（[testing.md](../../../rules/testing.md)）
- [ ] hardcode 値なし（文言は既存流用）
- [ ] schema / repository / rules 変更なし（不要）
- [ ] スコープ追加なし（share のインライン化等はしない）
- [ ] 実装 + test を同一 commit にペア（[testing.md](../../../rules/testing.md) commit セット規約）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 共有コンポーネント化で `/season` / 履歴詳細の markup が微妙に変わり E2E（phase-d）が落ちる | Low | Med | markup を 1 文字も変えずに移植。Task 3/4 後に phase-d E2E を必ず再走 |
| `hidden` panel でも subscribe が走り続け read コスト増 | Low | Low | 20 人規模では許容（firebase-patterns.md 方針）。必要なら後続で active-tab 時 subscribe に最適化 |
| `SeasonStatsDoc` → `SeasonRankingRow` の構造的代入が余剰 field で型エラー | Low | Low | interface を最小 field で定義し代入可能性を確認（Task 1 の tsc で検出） |
| インライン表示と SeasonCard「ランキングを見る」リンクの導線重複で UX 混乱 | Low | Low | リンクは share/履歴の置き場として残す旨を panel 文脈で許容。混乱なら後続でラベル調整 |

## Notes

- **重複の実態**: 順位表 `<table>`（順位/表示名/参加/優勝/FT/累計ポイント の 6 列）は `season-ranking-client.tsx:143-168` と `season-history-detail-client.tsx:183-208` に完全同一で存在。本 Phase のインライン追加で 3 箇所目になるため、共有コンポーネント化は DRY 上も妥当。
- **share ボタンは抽出しない**: ラベル / data-testid / 渡す stats が callsite ごとに異なる（"首位をシェア" / "過去シーズン首位をシェア"）ため、共有化対象は `<table>` のみに限定。
- **panel の配置先**: `src/components/group/`（共有 table）と `src/app/groups/[gid]/_components/`（インライン panel）に分離。前者は `/season` 等のページ横断で使うため neutral な `components/group` に、後者はサークル詳細専用なので route-local `_components` に置く（既存の `SeasonTopCardDownloadButton`=components/group、`SeasonCard`=route-local の配置慣習に一致）。
- **シーズン開始日表示**: インライン panel には開始日を出さない（SeasonCard が既に表示済み・重複回避）。
