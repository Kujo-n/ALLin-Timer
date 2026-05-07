# Plan: Phase D Improvement — Past Season Detail View

## Summary

Phase D で着地した [`SeasonHistoryList`](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx) は accordion 展開で **top3 までしか表示できない**。`/groups/[gid]/season/history/[seasonId]` という専用詳細ページを additive に追加し、過去シーズンの完全ランキング（参加 / 優勝 / FT / 累計ポイントの全列）を現在シーズンと同じ table 形式で表示する。`SeasonHistoryList` の各行は accordion 開閉から **「詳細を見る」リンク** に切替え、深掘り動線を navigation で完結させる。`/api/og/season/[gid]` route はパラメータ非依存なので、過去シーズンの top3 から組み立てた query で**そのまま再利用** して PNG 共有 / ダウンロードボタンも詳細ページに並べる。schema / rule / `finishTournament` / `startNewSeason` には一切触らない（Phase A の subcollection 設計が既に「group メンバー全員 read」を満たしているため）。

## User Story

As a サークル member（owner / organizer / member、認証済み）,
I want `/groups/[gid]/season` の「過去シーズン」リストから 1 シーズンを選び、その完全ランキング（top3 だけでなく全員分の参加・優勝・FT・累計ポイント）を 1 ページで確認できる,
So that 「先月のあのプレイヤーは結局何位だったのか」「自分のシーズン最終順位」を 3 タップ以下で確認でき、運営者の告知や参加者の振り返りが accordion + top3 の制約を超えて成立する。

And as a 同 member,
I want 過去シーズンの首位カード PNG を現在シーズンと同じボタン配置で取得・シェアできる,
So that 「先月の首位は誰だった」を後から SNS / LINE に貼る運用が時間軸を跨いで成立する。

## Problem → Solution

**Current state**

- `/groups/[gid]/season` 画面下部に [`SeasonHistoryList`](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx) が並ぶ。各行は `Button variant="ghost"` の inline accordion で、開くと top3 だけ `<ol>` で表示される（top4 以下は表示できない）
- `listSeasonHistory(gid)` で全 season 履歴 doc を 1 度に fetch 済（[repositories/seasonHistory.ts:29](../../../../src/lib/firebase/repositories/seasonHistory.ts#L29)）
- `seasonHistoryDocRef(gid, seasonId)` は単一 doc ref を返すヘルパーとして既に存在するが、**呼出側は `service/group.ts` の `startNewSeason` の write 経路だけで、read 経路は未使用**
- `/api/og/season/[gid]` は `groupName / seasonStartDateLabel / top1〜3 (Name + Points)` を query で受け取り PNG を返す純粋な SSR route。**過去シーズン用に分岐は不要**で、呼出側が history snapshot を query にマップすればそのまま機能する
- 「過去 N シーズン」というスコープなのに「top3 までしか」しか見れない gap が存在し、PRD の "シーズン履歴閲覧 UI 拡充" を完全には満たしていない

**Desired state**

- `/groups/[gid]/season/history/[seasonId]` を additive に新設。group メンバーであれば閲覧可能（rule は既存 `seasonHistory` `allow read: if isGroupMember(gid)` を流用）
- `SeasonHistoryDetailClient` は現在シーズンと **同じ列構成**（順位 / 表示名 / 参加 / 優勝 / FT / 累計ポイント）の table を表示し、`endedAt` / `startedAt` をヘッダに添える
- 「現在シーズンに戻る」リンクと「サークル詳細」リンクを top action に並べ、戻り動線を 1 タップで担保する
- `SeasonHistoryList` は accordion を廃し、各 entry の主要表示（期間 + 首位）の右に **「詳細を見る」 Link button** を置く。`expanded: Set<string>` state は丸ごと削除
- 詳細ページに「シーズン首位カードを保存」ボタン + Web Share API 対応端末では `ShareCardButton` を additive 配置。既存の `buildSeasonShareInputs` / `formatSeasonShareText` をそのまま再利用し、`group.seasonStartDate` の代わりに history doc の `startedAt`（null 可）を渡す
- 0 件 / fetch 失敗 / 該当 seasonId 不在の 3 ケースは個別 UI で扱う（404 風メッセージ + 戻りリンク）。schema / rule / firestore.rules には触らない

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md)
- **PRD Phase**: Phase D — Web Share API & Polish（improvement: シーズン履歴閲覧 UI 拡充の続き）
- **Stage scope**: 単一 doc 取得 repository 追加 / detail page と client / SeasonHistoryList の link 化 / past season 用 share+download ボタン配線 / docs（README + 業務仕様書）軽微更新
- **Estimated Files**: 約 9 files（CREATE 5 / UPDATE 4）

---

## UX Design

### Before（Phase D 現状）

```
/groups/[gid]/season
┌─────────────────────────────────────────────────────┐
│ シーズンランキング — サタデーサークル              │
│ 現在シーズン開始: 2026-04-01                        │
│   [首位をシェア] [シーズン首位カードを保存]         │
│ ──────────── 現在シーズン table ──────────────── │
│ 1. Alice  ... 47.83 pt                              │
│ 2. Bob    ... 28.12 pt                              │
│                                                     │
│ ─── 過去シーズン履歴 ─────────────────────────── │
│ ▾ 2026-01-01 〜 2026-04-01 — 首位: Alice 35.20 pt   │
│   1. Alice 35.20 pt （参加 12 / 優勝 4）            │
│   2. Bob   28.10 pt （参加 10 / 優勝 2）            │
│   3. Carol 19.66 pt （参加  8 / 優勝 1）            │
│   ↑ top3 までしか表示できない                       │
│ ▸ 2025-10-01 〜 2026-01-01 — 首位: Bob 42.50 pt     │
└─────────────────────────────────────────────────────┘
```

### After（Improvement 後）

```
/groups/[gid]/season
┌─────────────────────────────────────────────────────┐
│ ─── 過去シーズン履歴 ─────────────────────────── │
│ • 2026-01-01 〜 2026-04-01 — 首位: Alice 35.20 pt   │
│                              [詳細を見る ▸]         │
│ • 2025-10-01 〜 2026-01-01 — 首位: Bob 42.50 pt     │
│                              [詳細を見る ▸]         │
│   ↑ accordion なし、各行に Link button のみ        │
└─────────────────────────────────────────────────────┘
        ↓ [詳細を見る] クリック
/groups/[gid]/season/history/[seasonId]
┌─────────────────────────────────────────────────────┐
│ シーズン履歴 — サタデーサークル                     │
│ 期間: 2026-01-01 〜 2026-04-01                      │
│      [現在シーズンへ] [サークル詳細]                │
│      [首位をシェア] [シーズン首位カードを保存]      │
│ ─── 全プレイヤー（totalPoints desc）─────────────── │
│ 順位 │ 表示名 │ 参加 │ 優勝 │ FT │ 累計ポイント   │
│  1   │ Alice  │  12  │  4   │  6 │ 35.20 pt       │
│  2   │ Bob    │  10  │  2   │  4 │ 28.10 pt       │
│  3   │ Carol  │   8  │  1   │  3 │ 19.66 pt       │
│  4   │ Dave   │   5  │  0   │  1 │  6.40 pt       │
│  5   │ Eve    │   3  │  0   │  0 │  2.10 pt       │
│  ...（全員分。entries.length 行）                   │
└─────────────────────────────────────────────────────┘

# 該当 seasonId が存在しないとき / 不正アクセス時
┌─────────────────────────────────────────────────────┐
│ シーズン履歴 — 見つかりません                       │
│ 指定された seasonId は存在しないか権限がありません  │
│      [現在シーズンへ戻る]                           │
└─────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| --- | --- | --- | --- |
| `SeasonHistoryList` 個別行 | accordion ボタン（▾/▸ で開閉、開くと top3 表示） | 行の右側に `[詳細を見る ▸]` Link button | `expanded: Set<string>` state を完全削除し、`<Link href={...}>` で navigation に倒す |
| 過去シーズンの top4 以下 | 表示不能 | 詳細ページで全員分 table 表示 | history.entries を `totalPoints desc` で client sort（現在シーズンと同方針） |
| 過去シーズンの首位カード | （取得手段なし） | 詳細ページに `[首位をシェア]` + `[シーズン首位カードを保存]` 並列 | `buildSeasonShareInputs(gid, { name, seasonStartDate: history.startedAt }, entriesAsStats)` で既存 helper を再利用 |
| URL 共有 | accordion 状態は URL に乗らない（戻ると閉じる） | `seasonId` が path にあるため、URL 共有で同じ詳細を直接開ける | サークル LINE で「これ見て: /groups/g1/season/history/s-uuid」が成立 |
| 該当 seasonId 不在 | （N/A — UI 上発生しない） | 専用「見つかりません」UI + 戻りリンク | rule で permission-denied のときも同じ UI に倒す（code を区別表示） |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| --- | --- | --- | --- |
| P0 (critical) | [src/lib/firebase/repositories/seasonHistory.ts](../../../../src/lib/firebase/repositories/seasonHistory.ts) | 全文 | 既存 `seasonHistoryDocRef` / `listSeasonHistory` の構造、wrapFirestoreRead + zodConverter パターン。新規 `getSeasonHistory(gid, seasonId)` はここに追加 |
| P0 (critical) | [src/lib/firebase/schemas/seasonHistory.ts](../../../../src/lib/firebase/schemas/seasonHistory.ts) | 全文 | `SeasonHistoryDoc` の構造（startedAt 可 null / endedAt / entries[]）。entries の各 field と DISPLAY_NAME_MAX_LENGTH 上限 |
| P0 (critical) | [src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx) | 全文 | accordion 廃止 + Link 化の対象。`unwrapOrFrom` / `logger.debug` での error 取扱方針はそのまま温存 |
| P0 (critical) | [src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx) | 全文 | 既存 5 件のテストで「展開で top3 を出す」「複数件の順序維持」等を assert している。Link 化に伴う再構成 |
| P0 (critical) | [src/app/groups/[gid]/season/season-ranking-client.tsx](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) | 全文 | 現在シーズン table の列構成 / share + download ボタンの並び方。詳細ページ実装の MIRROR 元 |
| P1 (important) | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 80-100 | `getGroup(gid)` の単一 doc fetch + wrapFirestoreRead + `firestore/not-found` の throw パターン。新規 `getSeasonHistory` の MIRROR 元 |
| P1 (important) | [src/components/group/SeasonTopCardDownloadButton.tsx](../../../../src/components/group/SeasonTopCardDownloadButton.tsx) | 全文 | `Pick<GroupDoc, "name" \| "seasonStartDate">` を受ける構造。past season 用に「`seasonStartDate` の代わりに history.startedAt を入れた duck-typed object」を渡せる |
| P1 (important) | [src/components/share/_share-button/ShareCardButton.tsx](../../../../src/components/share/_share-button/ShareCardButton.tsx) | 全文 | share button の API（url / filenameStem / shareText / kind / label / dataTestId）。`kind="season"` で再利用、ラベルだけ「過去シーズン首位をシェア」に差し替え |
| P1 (important) | [src/app/api/og/_lib/og-payload.ts](../../../../src/app/api/og/_lib/og-payload.ts) | 全文 | `buildSeasonShareInputs` の引数型 narrow（`SeasonShareInputsGroup` / `SeasonShareInputsStats`）。past season では entries を SeasonShareInputsStats 互換に map して渡す |
| P1 (important) | [src/app/groups/[gid]/audio-settings/page.tsx](../../../../src/app/groups/[gid]/audio-settings/page.tsx) | 全文 | groups 配下の Server Component → Client Component の page convention（`RequireAuth` ラップ + params Promise unwrap） |
| P2 (reference) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | 全文 | wrap helper / subcollection rule 設計原則 / single-fetch repository の現行ルール |
| P2 (reference) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | 全文 | `unwrapOrFrom` 使い分け（内側 wrap 済 AppError の二重 warn 回避） |
| P2 (reference) | [.claude/rules/testing.md](../../../rules/testing.md) | 全文 | mock 境界（repository module を vi.mock）と fixture factory の規約 |

## External Documentation

なし — 既存パターンの拡張のみで完結する。新規 npm 依存もなく、Firestore SDK / Next.js / Tailwind / shadcn/ui の既存利用に閉じる。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/app/groups/[gid]/audio-settings/page.tsx
// SOURCE: src/app/tournaments/[tid]/clone/page.tsx
import { RequireAuth } from "@/components/auth/RequireAuth";

import { AudioSettingsClient } from "./audio-settings-client";

export default async function AudioSettingsPage({
  params,
}: {
  params: Promise<{ gid: string }>;
}) {
  const { gid } = await params;
  return (
    <RequireAuth>
      <AudioSettingsClient gid={gid} />
    </RequireAuth>
  );
}
```

→ 新規ページ `/groups/[gid]/season/history/[seasonId]/page.tsx` も同形。`{ gid, seasonId }` を `await params` で 1 度に展開する。

### REPOSITORY_PATTERN（単一 doc fetch）

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:82-95
export async function getGroup(gid: string): Promise<GroupDoc> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "サークル取得に失敗しました",
    async () => {
      const snap = await getDoc(groupDocRef(gid));
      if (!snap.exists()) {
        throw new AppError(`group not found: ${gid}`, "firestore/not-found");
      }
      return { id: snap.id, ...snap.data() };
    },
    { gid },
  );
}
```

→ 新規 `getSeasonHistory(gid, seasonId)` は同形。doc が存在しなければ `firestore/not-found` を throw。

### ERROR_HANDLING（UI 側で内側 wrap を尊重）

```tsx
// SOURCE: src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx:30-52
try {
  const list = await listSeasonHistory(gid);
  // ...
} catch (e) {
  const wrapped = unwrapOrFrom(
    e,
    "firestore/read_failed",
    "シーズン履歴の取得に失敗しました",
  );
  // 内側で既に warn 済みのため、UI 側では debug ログのみ。
  logger.debug("season history fetch failed at UI", {
    code: wrapped.code,
    gid,
  });
  if (!canceled) {
    setError(`${wrapped.code}: ${wrapped.message}`);
    setLoading(false);
  }
}
```

→ 詳細ページでも同じ形を流用。`firestore/not-found` のときは「見つかりません」UI に分岐表示する。

### LOGGING_PATTERN

```ts
// SOURCE: src/components/group/SeasonTopCardDownloadButton.tsx:44-50
onClick={() =>
  logger.debug("share-card click", {
    kind: "season",
    action: "download",
    success: true,
  })
}
```

→ past season 用ボタンも `kind: "season"` のまま流用。`seasonId` は PII ではないが telemetry にも乗せない（既存 button と同じ粒度）。

### TEST_STRUCTURE（fixture factory + mock 境界）

```ts
// SOURCE: src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx:11-29
vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({
  listSeasonHistory: vi.fn(),
}));

const startTs = Timestamp.fromDate(new Date("2026-01-01T00:00:00Z"));
const endTs = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));

function makeHistory(
  overrides: Partial<SeasonHistoryDoc> = {},
): SeasonHistoryDoc {
  return {
    id: "season-1",
    startedAt: startTs,
    endedAt: endTs,
    entries: [],
    ...overrides,
  };
}
```

→ 詳細 client のテストも同形。`getSeasonHistory` を vi.mock し、`makeHistory` factory を共有 helper として括り出す（test file 内 local で十分、shared util までは作らない）。

### SHARE BUTTON 並列配置

```tsx
// SOURCE: src/app/groups/[gid]/season/season-ranking-client.tsx:110-135
<div className="flex flex-wrap items-center justify-end gap-2">
  {(() => {
    const shareInputs = buildSeasonShareInputs(gid, group, stats);
    if (!shareInputs) return null;
    const top1 = stats[0];
    const shareText = formatSeasonShareText({
      groupName: group.name,
      top1Name: top1.displayName,
      top1Points: top1.totalPoints,
    });
    return (
      <ShareCardButton
        url={shareInputs.url}
        filenameStem={shareInputs.filenameStem}
        shareText={shareText}
        kind="season"
        label="首位をシェア"
        dataTestId="season-top-card-share"
      />
    );
  })()}
  <SeasonTopCardDownloadButton gid={gid} group={group} stats={stats} />
</div>
```

→ 詳細ページの share / download エリアも同形。`group` は **`{ name: <currentGroupName>, seasonStartDate: <history.startedAt> }`** の duck-typed object を組み立てて渡す。`stats` は `history.entries` を `SeasonStatsDoc` 互換 shape にマップした派生配列を渡す。

---

## Files to Change

| File | Action | Justification |
| --- | --- | --- |
| `src/lib/firebase/repositories/seasonHistory.ts` | UPDATE | 単一 doc fetch helper `getSeasonHistory(gid, seasonId)` を additive に追加。listSeasonHistory / seasonHistoryDocRef は無変更 |
| `src/lib/firebase/repositories/seasonHistory.test.ts` | UPDATE | `getSeasonHistory` の unit test を 3 ケース追加（success / not-found / read failure） |
| `src/app/groups/[gid]/season/history/[seasonId]/page.tsx` | CREATE | 新規 Server Component。`{ gid, seasonId }` を `await params` で展開し `RequireAuth` 内に client を mount |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` | CREATE | `getGroup` + `getSeasonHistory` を 1 度ずつ fetch、ranking table をレンダ。share + download ボタン並列。「現在シーズンへ」「サークル詳細」の戻りリンク |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` | CREATE | 主要 4 ケース（loading → 成功 / entries=[] / 該当なし / fetch fail）を render 検証 |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx` | UPDATE | accordion 廃止し各 entry を `<Link href={...}>` 化。`expanded: Set<string>` state 削除。1 行表示は維持し「詳細を見る」 button を Link asChild で右寄せ追加 |
| `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx` | UPDATE | accordion 系の assert（toggle / expand 後 top3 表示）を Link href の assert に置換。「複数件 endedAt desc 維持」と「entries=[] のとき『戦績なし』表示」は維持 |
| `README.md` | UPDATE | ディレクトリツリーに `season/history/[seasonId]/` を追記。Phase D improvement の 1 行注記 |
| `docs/specification/08-season-stats.spec.md` | UPDATE | 「過去シーズン履歴」節に詳細ページへの遷移と全員分表示を追記。`/groups/[gid]/season/history/[seasonId]` の URL 構造を明記 |

## NOT Building

- `seasonHistory` の **append 経路 / 改竄不可 invariants の変更** — `startNewSeason` の tx も rule（`allow update, delete: if false`）も無変更。本 plan は read 経路のみ拡張
- **新規 OG image route** — `/api/og/season/[gid]` の query は groupName / seasonStartDateLabel / top1〜3 の Name+Points だけで構成され、過去シーズンの値も同 schema で表現できるため新規 route は作らない（Phase B の決定にも準拠）
- **history doc の pagination / 件数制限** — 現状 `listSeasonHistory` は全件 fetch、20 人 × 月 1〜2 回開催で年 12 シーズン程度なら問題なし。retention / pagination は PRD の Open Question として持ち越し
- **all-time（シーズン跨ぎ）累計** — PRD で明示的に Won't、本 improvement でも対象外
- **詳細ページの編集機能** — history snapshot は append-only。edit は rule で deny されており本 plan でも触らない
- **Phase D 親 plan の telemetry 拡張** — share / download click ログは現行の `logger.debug("share-card click", ...)` と同 spec を継承し、過去シーズンと現在シーズンの区別フィールドは追加しない（PII ではないが telemetry 粒度を Phase D と揃えるため）
- **rule の修正** — `seasonHistory` `allow read: if isGroupMember(gid)` は既に group メンバー全員を許可。`groups` の `allow read` も既メンバー全員許可。新規ページは追加 read のみで rule 無変更
- **`firestore.indexes.json` の更新** — 全件 `getDocs` + client sort で複合 index は不要

---

## Step-by-Step Tasks

### Task 1: `getSeasonHistory(gid, seasonId)` を repository に追加

- **ACTION**: 単一 doc fetch helper を `src/lib/firebase/repositories/seasonHistory.ts` に additive に追加。既存 `seasonHistoryDocRef` を `getDoc` に渡し、`wrapFirestoreRead` でラップ
- **IMPLEMENT**:
  ```ts
  import { getDoc } from "firebase/firestore";
  // ...

  export async function getSeasonHistory(
    gid: string,
    seasonId: string,
  ): Promise<SeasonHistoryDoc> {
    return wrapFirestoreRead(
      "firestore/read_failed",
      "シーズン履歴の取得に失敗しました",
      async () => {
        const snap = await getDoc(seasonHistoryDocRef(gid, seasonId));
        if (!snap.exists()) {
          throw new AppError(
            `seasonHistory not found: ${gid}/${seasonId}`,
            "firestore/not-found",
          );
        }
        return { id: snap.id, ...snap.data() };
      },
      { gid, seasonId },
    );
  }
  ```
- **MIRROR**: `getGroup` in `repositories/groups.ts:82-95`
- **IMPORTS**: 既存 import に `getDoc` を追加。`AppError` は既に top of file で import 済
- **GOTCHA**: `seasonHistoryDocRef` は `seasonHistoryRef(gid).withConverter(zodConverter(...))` 経由で converter 付き ref を返すため、`snap.data()` は schema 適用済の `SeasonHistoryBody` を返す。生 ref を作り直す必要はない
- **VALIDATE**: `npm test -- --run seasonHistory` で新規 3 ケースが green

### Task 2: `getSeasonHistory` の unit test を追加

- **ACTION**: `src/lib/firebase/repositories/seasonHistory.test.ts` に 3 ケース追加（success / not-found / read failure）
- **IMPLEMENT**:
  ```ts
  describe("getSeasonHistory", () => {
    it("returns the history doc when exists", async () => {
      vi.mocked(getDoc).mockResolvedValueOnce({
        exists: () => true,
        id: "season-uuid-1",
        data: () => ({
          startedAt: t1,
          endedAt: t2,
          entries: [],
        }),
      } as never);
      const h = await getSeasonHistory("g1", "season-uuid-1");
      expect(h.id).toBe("season-uuid-1");
      expect(h.endedAt.toMillis()).toBe(t2.toMillis());
    });

    it("throws AppError(firestore/not-found) when missing", async () => {
      vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false } as never);
      await expect(getSeasonHistory("g1", "missing")).rejects.toMatchObject({
        code: "firestore/not-found",
      });
    });

    it("wraps unknown errors with firestore/read_failed", async () => {
      vi.mocked(getDoc).mockRejectedValueOnce(new Error("offline"));
      await expect(getSeasonHistory("g1", "x")).rejects.toMatchObject({
        code: "firestore/read_failed",
      });
    });
  });
  ```
- **MIRROR**: `describe("listSeasonHistory")` block (lines 41-119) and `describe("seasonHistoryDocRef")` block (lines 122-128) in same file
- **IMPORTS**: 既存の `getDoc` mock と `t1` / `t2` Timestamp を再利用。`getSeasonHistory` を import に追加
- **GOTCHA**: 既存 `vi.mock("firebase/firestore", ...)` は `getDoc` を mock 対象に含めていない（Phase A 時点では list だけだったため）。**`getDoc: vi.fn()` を mock factory に追加する必要あり**。追加し忘れると `getSeasonHistory` 内の `await getDoc(...)` が実 SDK を叩いて test がハング
- **VALIDATE**: `npm test -- --run seasonHistory` 全件 green

### Task 3: 詳細ページの Server Component を作成

- **ACTION**: `src/app/groups/[gid]/season/history/[seasonId]/page.tsx` を新規作成。`{ gid, seasonId }` を `await params` で受け、`RequireAuth` 内に client を mount
- **IMPLEMENT**:
  ```tsx
  import { RequireAuth } from "@/components/auth/RequireAuth";

  import { SeasonHistoryDetailClient } from "./season-history-detail-client";

  export default async function SeasonHistoryDetailPage({
    params,
  }: {
    params: Promise<{ gid: string; seasonId: string }>;
  }) {
    const { gid, seasonId } = await params;
    return (
      <RequireAuth>
        <SeasonHistoryDetailClient gid={gid} seasonId={seasonId} />
      </RequireAuth>
    );
  }
  ```
- **MIRROR**: `src/app/groups/[gid]/audio-settings/page.tsx` および `src/app/tournaments/[tid]/clone/page.tsx`
- **IMPORTS**: `RequireAuth` は既に project 共通。`allowAnonymous` は省略（default = true）。`/groups/[gid]/season` 親も省略しているため整合
- **GOTCHA**: Next.js 15 の `params` は `Promise` 型。`await params` 必須。`await` 漏れは type error で検出される
- **VALIDATE**: `npm run typecheck` で型 OK / `npm run build` で route summary に `/groups/[gid]/season/history/[seasonId]` が増える

### Task 4: 詳細 client 本体を作成

- **ACTION**: `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx` を新規作成。`getGroup(gid)` と `getSeasonHistory(gid, seasonId)` を mount 時に並列 fetch、エラー / 該当なし / 0 件 / 成功の 4 状態を扱う
- **IMPLEMENT**: 概形は以下（実装時は import を整理し、shareInputs 派生は IIFE で render gating）:
  ```tsx
  "use client";

  import Link from "next/link";
  import { useEffect, useState } from "react";

  import { SeasonTopCardDownloadButton } from "@/components/group/SeasonTopCardDownloadButton";
  import { ShareCardButton } from "@/components/share/_share-button/ShareCardButton";
  import { formatSeasonShareText } from "@/components/share/_share-button/share-text";
  import { buildSeasonShareInputs } from "@/app/api/og/_lib/og-payload";
  import { Button } from "@/components/ui/button";
  import { unwrapOrFrom } from "@/lib/errors";
  import { useAuthUser } from "@/lib/firebase/AuthProvider";
  import { getGroup } from "@/lib/firebase/repositories/groups";
  import { getSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
  import type { GroupDoc } from "@/lib/firebase/schemas/group";
  import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";
  import { logger } from "@/lib/logger";

  export function SeasonHistoryDetailClient({
    gid,
    seasonId,
  }: {
    gid: string;
    seasonId: string;
  }) {
    const { user } = useAuthUser();
    const [group, setGroup] = useState<GroupDoc | null>(null);
    const [history, setHistory] = useState<SeasonHistoryDoc | null>(null);
    const [loading, setLoading] = useState(true);
    const [errorCode, setErrorCode] = useState<string | null>(null);

    useEffect(() => {
      if (!user) return;
      let canceled = false;
      void (async () => {
        try {
          const [g, h] = await Promise.all([
            getGroup(gid),
            getSeasonHistory(gid, seasonId),
          ]);
          if (canceled) return;
          setGroup(g);
          setHistory(h);
          setLoading(false);
        } catch (e) {
          const wrapped = unwrapOrFrom(
            e,
            "firestore/read_failed",
            "シーズン履歴の取得に失敗しました",
          );
          logger.debug("season history detail fetch failed", {
            code: wrapped.code,
            gid,
            seasonId,
          });
          if (!canceled) {
            setErrorCode(wrapped.code);
            setLoading(false);
          }
        }
      })();
      return () => {
        canceled = true;
      };
    }, [gid, seasonId, user]);

    if (!user) return null;
    if (loading) {
      return (
        <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">
          読込中…
        </main>
      );
    }
    if (errorCode === "firestore/not-found") {
      return <NotFound gid={gid} />;
    }
    if (errorCode || !group || !history) {
      return (
        <main className="mx-auto max-w-3xl space-y-4 p-8">
          <p className="text-sm text-destructive" role="alert">
            {errorCode ?? "firestore/read_failed"}: シーズン履歴の取得に失敗しました
          </p>
          <Link href={`/groups/${gid}/season`}>
            <Button variant="outline">現在シーズンへ戻る</Button>
          </Link>
        </main>
      );
    }

    const sortedEntries = [...history.entries].sort(
      (a, b) => b.totalPoints - a.totalPoints,
    );
    const startedAtLabel = history.startedAt
      ? history.startedAt.toDate().toLocaleDateString("ja-JP")
      : "未設定";
    const endedAtLabel = history.endedAt.toDate().toLocaleDateString("ja-JP");

    return (
      <main className="mx-auto max-w-3xl space-y-6 p-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">シーズン履歴</h1>
            <p className="text-sm text-muted-foreground">{group.name}</p>
            <p className="text-xs text-muted-foreground">
              期間: {startedAtLabel} 〜 {endedAtLabel}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href={`/groups/${gid}/season`}>
              <Button variant="outline" size="sm">現在シーズンへ</Button>
            </Link>
            <Link href={`/groups/${gid}`}>
              <Button variant="outline" size="sm">サークル詳細</Button>
            </Link>
          </div>
        </div>

        {sortedEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            このシーズンの記録はありません。
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center justify-end gap-2">
              {(() => {
                const groupForShare = {
                  name: group.name,
                  seasonStartDate: history.startedAt,
                };
                // entries は totalPoints + displayName のみ buildSeasonShareInputs から
                // 参照される（SeasonShareInputsStats 互換）。そのまま渡す。
                const shareInputs = buildSeasonShareInputs(
                  gid,
                  groupForShare,
                  sortedEntries,
                );
                if (!shareInputs) return null;
                const top1 = sortedEntries[0];
                const shareText = formatSeasonShareText({
                  groupName: group.name,
                  top1Name: top1.displayName,
                  top1Points: top1.totalPoints,
                });
                return (
                  <ShareCardButton
                    url={shareInputs.url}
                    filenameStem={shareInputs.filenameStem}
                    shareText={shareText}
                    kind="season"
                    label="過去シーズン首位をシェア"
                    dataTestId="past-season-top-card-share"
                  />
                );
              })()}
              <SeasonTopCardDownloadButton
                gid={gid}
                group={{ name: group.name, seasonStartDate: history.startedAt }}
                stats={sortedEntries.map((e) => ({
                  // SeasonStatsDoc shape に合わせて id / lastUpdatedAt は dummy で OK。
                  // buildSeasonShareInputs は displayName / totalPoints しか読まない。
                  ...e,
                  id: e.uid,
                  lastUpdatedAt: history.endedAt,
                }))}
              />
            </div>
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
                {sortedEntries.map((e, i) => (
                  <tr key={e.uid} className="border-b">
                    <td className="py-2">{i + 1}</td>
                    <td className="py-2">{e.displayName}</td>
                    <td className="py-2 text-right">{e.participations}</td>
                    <td className="py-2 text-right">{e.wins}</td>
                    <td className="py-2 text-right">{e.finalTables}</td>
                    <td className="py-2 text-right font-semibold">
                      {e.totalPoints.toFixed(2)} pt
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </main>
    );
  }

  function NotFound({ gid }: { gid: string }) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-bold">シーズン履歴 — 見つかりません</h1>
        <p className="text-sm text-muted-foreground">
          指定されたシーズン ID は存在しないか、閲覧権限がありません。
        </p>
        <Link href={`/groups/${gid}/season`}>
          <Button variant="outline">現在シーズンへ戻る</Button>
        </Link>
      </main>
    );
  }
  ```
- **MIRROR**: `src/app/groups/[gid]/season/season-ranking-client.tsx` のヘッダ / ボタン / table 構造、`SeasonHistoryList` の `unwrapOrFrom + logger.debug` 取扱
- **IMPORTS**: 上記コードの import で完結。`buildSeasonShareInputs` の引数 `SeasonShareInputsGroup` / `SeasonShareInputsStats` は **structural typing** のため duck-typed object を渡せる（[og-payload.ts:185-194](../../../../src/app/api/og/_lib/og-payload.ts#L185-L194) 参照）
- **GOTCHA**:
  - `Promise.all([getGroup, getSeasonHistory])` は **どちらか 1 件でも reject すると catch 入り**。group は permission-denied、history は not-found のどちらでも `unwrapOrFrom` 経由で `errorCode` に拾われる。`firestore/not-found` は専用 UI に分岐（permission-denied は同 UI で良い — 認可エラーを leak しない）
  - `SeasonTopCardDownloadButton` の `stats` 型は `readonly SeasonStatsDoc[]`。entries を直接渡すには `id` / `lastUpdatedAt` の付与が必要。これらは内部 helper で参照されないが TypeScript の構造的型一致のため shape を揃える
  - `seasonStartDate` を `history.startedAt`（Timestamp \| null）に差し替えるが、`buildSeasonShareInputs` は `null` を「未設定」として label を URL から省く分岐を持つため、初回切替前の history（startedAt=null）でも安全
  - `useAuthUser` は `null` を返すまで「読込中…」にする — `RequireAuth` がガード済だが、auth provider の初期化中は `user === null` が短時間出るため UI 上は loading フォールバックが入る
- **VALIDATE**: `npm run typecheck` で型 OK / `npm run build` でエラーなし / 開発サーバ起動して該当ページを目視

### Task 5: 詳細 client の test を追加

- **ACTION**: `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` を新規作成
- **IMPLEMENT**: 4 ケースを軸に組む（fixture factory は test 内 local）:
  1. **正常系（entries 5 件）**: ranking table が 5 行表示され、totalPoints desc で並ぶ。share button + download button が出る
  2. **entries=[] のとき**: 「このシーズンの記録はありません」が出て share / download は出ない
  3. **`firestore/not-found` のとき**: 「見つかりません」UI が出て、戻りリンクが render される
  4. **fetch 失敗（getGroup reject）のとき**: role=alert でエラーコードが出て、戻りリンクが render される

  mock 境界:
  ```ts
  vi.mock("@/lib/firebase/repositories/groups", () => ({
    getGroup: vi.fn(),
  }));
  vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({
    getSeasonHistory: vi.fn(),
  }));
  vi.mock("@/lib/firebase/AuthProvider", () => ({
    useAuthUser: () => ({ user: { uid: "u-1" } }),
  }));
  // ShareCardButton は canShare 判定で render しないため、test では無 stub で OK。
  // SeasonTopCardDownloadButton は <a download> を返すだけなので無 stub で OK。
  ```
- **MIRROR**: [`SeasonHistoryList.test.tsx`](../../../../src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx) の構造（vi.mock + Timestamp factory + waitFor + role assertion）
- **IMPORTS**: `@testing-library/react` / `vitest` / `Timestamp` / `AppError` / `SeasonHistoryDoc` / `GroupDoc`
- **GOTCHA**: `useAuthUser` を mock で固定値返却にしないと、provider 不在で `user === null` → 「読込中…」のまま finite な期間で待つことになる。`vi.mock("@/lib/firebase/AuthProvider")` は file 全体に効くので test 全件で `user` を固定化
- **VALIDATE**: `npm test -- --run season-history-detail-client` 4 ケース green

### Task 6: `SeasonHistoryList` を Link 化

- **ACTION**: `src/app/groups/[gid]/season/_components/SeasonHistoryList.tsx` の accordion を廃止し、各 entry を「期間 + 首位」表示 + 右側の `<Link href={...}>` に置換
- **IMPLEMENT**:
  - `useState<Set<string>>` の `expanded` を完全削除
  - `<Button variant="ghost">` の onClick handler を削除し、内側 `<ChevronDown> / <ChevronRight>` も削除
  - 各 `<li>` の構造を「左: 期間 + 首位 1 行 / 右: `<Button asChild variant="outline" size="sm"><Link href={`/groups/${gid}/season/history/${h.id}`}>詳細を見る</Link></Button>`」の flex layout に変更
  - 既存 `data-testid="season-history-section"` / `season-history-item-${h.id}` は維持（以下のテストで参照）
  - 新規 `data-testid="season-history-detail-link-${h.id}"` を `<Link>` 側に追加
  - top3 の `<ol>` rendering と `formatRange` helper は不要になるため削除（formatRange は header 行の inline format に統合）
- **MIRROR**: [`season-ranking-client.tsx`](../../../../src/app/groups/[gid]/season/season-ranking-client.tsx) の Link + Button asChild パターン（line 67-70 等）
- **IMPORTS**:
  - `Link` from `next/link` を追加
  - `ChevronDown` / `ChevronRight` の lucide-react import を削除
  - `unwrapOrFrom` / `listSeasonHistory` / `logger` / `Button` は維持
- **GOTCHA**:
  - 1 行表示は今まで通り `formatRange + 首位 displayName + totalPoints` を残す。情報量を減らさないため
  - link href は `/groups/${gid}/season/history/${encodeURIComponent(h.id)}` で URI safe を担保。`h.id` は UUID v4 なので encode は実質 no-op だが防衛的に通す
- **VALIDATE**: `npm run typecheck` / `npm run lint` / 修正後のテストファイルが green

### Task 7: `SeasonHistoryList` のテストを再構成

- **ACTION**: `src/app/groups/[gid]/season/_components/SeasonHistoryList.test.tsx` の accordion 系 assert を Link 化に合わせて書き換え
- **IMPLEMENT**:
  - 残すケース:
    1. 「履歴 0 件のとき section ごと render しない」（無変更）
    2. 「履歴 1 件 / entries=[] のとき『戦績なし』表示」（accordion なしで首位行に出る）
    3. 「複数件 endedAt desc 維持 / startedAt null は『未設定』表示」（無変更）
  - 置換するケース:
    - 旧: 「履歴 1 件 / entries=3 件 のとき首位を表示し、展開で top3 を出す」 → 新: 「履歴 1 件 / entries=3 件 のとき首位を表示し、`href` が `/groups/${gid}/season/history/${id}` の Link が render される」
  - 削除するアサーション: `fireEvent.click(season-history-toggle-...)` / 展開後の `Bob — 28.12 pt` 等の textContent 検証（top3 表示は詳細ページ側に移動）
  - 残すケース: 「fetch 失敗時は role=alert でエラー表示」（無変更）
- **MIRROR**: 既存 test 構造を温存し、最小差分で Link href を `expect(link).toHaveAttribute("href", expected)` に置換
- **IMPORTS**: 既存。`fireEvent` は accordion toggle の削除に伴い未使用になる場合は import を削除（lint に従う）
- **GOTCHA**: テスト数は 5 → 5（あるいは 4）に整える。「accordion 機能の喪失」は仕様変更なので、削除したテストは plan の Acceptance Criteria に明記する
- **VALIDATE**: `npm test -- --run SeasonHistoryList` 全件 green

### Task 8: README + 業務仕様書を更新

- **ACTION**:
  - `README.md` のディレクトリツリー記載に `season/history/[seasonId]/` を 1 行追加（既存 `season/` ブロック内）
  - `docs/specification/08-season-stats.spec.md` の「過去シーズン履歴」節（Phase D で追記済）に詳細ページ遷移と全員分表示の説明を追記し、URL 構造を例示
- **IMPLEMENT**: 既存節に箇条書きを 2-3 行追加するのみ。新規節は作らない
- **MIRROR**: Phase D の README / 仕様書追記スタイル（[Phase D 実装レポート](../reports/phase-d-web-share-and-polish-report.md) の Files Changed 内訳参照）
- **IMPORTS**: N/A（doc only）
- **GOTCHA**: 業務仕様書は **非エンジニア読者向け**（CLAUDE.md / spec-writer skill 規約）。実装詳細（route handler / repository 名）は書かず、「過去シーズンの詳細ページに遷移できる」「現在シーズンと同じ列で全員分が見える」「首位カードは詳細ページからも保存・シェアできる」レベルの平易な日本語に留める
- **VALIDATE**: 目視 + `git diff` で他節を壊していないか確認

### Task 9: PRD Phase D 行に improvement の plan link を追記

- **ACTION**: `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` の Phase D 行（line 179）の `PRP Plan` セルに improvement plan へのリンクを追記。「シーズン履歴閲覧 UI 拡充」が improvement で完成した旨を 1 行注記
- **IMPLEMENT**: 既存テーブルの該当 cell を以下のように改訂:
  ```
  | D   | Web Share API & Polish      | ...                                      | in-progress | -        | B, C    | [phase-d-web-share-and-polish.plan.md](../plans/completed/phase-d-web-share-and-polish.plan.md) — [report](../reports/phase-d-web-share-and-polish-report.md) — [improvement: past-season-detail](../plans/phase-d-past-season-detail-view.plan.md) |
  ```
- **MIRROR**: Phase C 行の `[02-02 improvement report](../reports/phase-c-improvement-02-02-report.md)` 追記スタイル
- **IMPORTS**: N/A
- **GOTCHA**: `Status` セルは引き続き `in-progress` のまま据え置く。Phase D 全体の完了判定（Manual validation 等）は本 improvement の出来とは独立に運用者が下すため
- **VALIDATE**: 目視

### Task 10: 仕上げ — typecheck / lint / テスト全件 / build / emulator validation

- **ACTION**: 以下を順に走らせて全 PASS を確認
  - `npm run typecheck`
  - `npm run lint`
  - `npm test`（既存 1030 件 + 本 plan 追加 ~7 件 が全部 green）
  - `npm run build`（route summary に `/groups/[gid]/season/history/[seasonId]` Dynamic が増える）
  - `npm run test:rules-season`（rule 変更なしのため drift 検出のみ。12/12 で PASS 維持）
- **IMPLEMENT**: スクリプト走行のみ。失敗があれば本番 plan の修正
- **MIRROR**: Phase D 実装レポートの Validation Results セクション
- **IMPORTS**: N/A
- **GOTCHA**:
  - **glob パスの `[gid]` / `[seasonId]` 文字** は npm test で escape 不能。テスト名指定（例 `npm test -- --run season-history-detail-client`）で回避（Phase D 実装レポートで報告された既知の罠）
  - rule 変更なしのため `firebase deploy --only firestore:rules` は不要。本 plan ではコマンドを案内しない
- **VALIDATE**: 全 5 スクリプト PASS

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| --- | --- | --- | --- |
| `getSeasonHistory` success | `(gid, seasonId)` で doc 存在 | `{ id, startedAt, endedAt, entries }` を返す | No |
| `getSeasonHistory` not-found | doc 不在 | `AppError(code="firestore/not-found")` を throw | Yes |
| `getSeasonHistory` SDK 失敗 | `getDoc` reject | `AppError(code="firestore/read_failed")` を throw | Yes |
| `SeasonHistoryDetailClient` 正常系 | entries 5 件 / startedAt 有 | 5 行 table が `totalPoints desc`、share + download ボタン render | No |
| `SeasonHistoryDetailClient` entries=[] | 0 件 | 「記録はありません」 / share button 不在 / download button 不在 | Yes |
| `SeasonHistoryDetailClient` not-found | `firestore/not-found` 投げ込み | 「見つかりません」UI / 戻りリンク | Yes |
| `SeasonHistoryDetailClient` fetch fail | `firestore/read_failed` 投げ込み | role=alert でエラーコード表示 / 戻りリンク | Yes |
| `SeasonHistoryList` Link 化 | history 1 件 / entries 3 件 | 「詳細を見る」 link が `/groups/${gid}/season/history/${id}` を href に持つ | No |

### Edge Cases Checklist

- [x] `entries=[]` の history（`startNewSeason` 直後の空シーズン）— share / download は非表示、table は「記録はありません」
- [x] `startedAt=null` の history（最初の切替時）— ヘッダで「未設定 〜 endedAt」と表示。`buildSeasonShareInputs` 側も `seasonStartDate=null` を許容済
- [x] `entries.length` が大きい（例 30 人）— scroll で全行見える。Tailwind table は overflow-x-auto を入れる必要あれば追加
- [x] 不在 seasonId への直アクセス（URL を手で叩いた / コードを誤コピー）— 404 風 UI で戻りリンクを提示
- [x] permission-denied（group メンバーでない uid）— 同 UI に倒す（`firestore/permission-denied` は表示せず not-found UI に統合 — 認可情報の漏洩防止）
- [x] history doc の schema validate 失敗（converter が throw）— `getSeasonHistory` は `firestore/invalid-data` を throw、UI は role=alert で表示
- [x] 非常に長い displayName（DISPLAY_NAME_MAX_LENGTH=15 を超えるレガシー doc）— schema が validate するため到達せず。万一通った場合は table cell の text-overflow に依存

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: `tsc --noEmit` が exit 0、エラー 0 件

```bash
npm run lint
```

EXPECT: `next lint` warnings 0 / errors 0

### Unit Tests

```bash
# 新規 / 変更ファイルだけを対象にした smoke run
npm test -- --run seasonHistory
npm test -- --run SeasonHistoryList
npm test -- --run season-history-detail-client
```

EXPECT: 全 ケース green、新規 7 ケース追加（getSeasonHistory 3 + DetailClient 4）+ SeasonHistoryList の更新 1〜2 ケース

### Full Test Suite

```bash
npm test
```

EXPECT: baseline 1030 件 + 本 plan 追加 ~7 件 = 1037 件前後がすべて green。回帰なし

### Build

```bash
npm run build
```

EXPECT: route summary に `/groups/[gid]/season/history/[seasonId]` Dynamic が追加されるのみ。既存 route の挙動 / バンドルサイズに有意な変化なし

### Emulator Validation（rule 変更なしのため drift 検出のみ）

```bash
npm run test:rules-season
```

EXPECT: 12/12 PASS（既存 case の drift がないことを確認）

### Manual Validation

- [ ] 開発サーバ起動（`npm run dev` — ※既存 build / lint と同時並行起動禁止、CLAUDE.md skill 知見）
- [ ] グループに 1 シーズン以上の `seasonHistory` doc が存在する状態で `/groups/[gid]/season` を開く
- [ ] 過去シーズンセクションの行右にある「詳細を見る」リンクをクリック
- [ ] `/groups/[gid]/season/history/[seasonId]` で全員分の ranking が `totalPoints desc` で表示されることを確認
- [ ] 「現在シーズンへ」「サークル詳細」リンクで戻れることを確認
- [ ] 「シーズン首位カードを保存」ボタンをクリックし、PNG が DL されることを確認（端末 TZ で開始日が描画される）
- [ ] iOS Safari / Android Chrome で `[過去シーズン首位をシェア]` ボタンが追加され、押下で OS シェアシートが開くことを確認
- [ ] 不在 seasonId（URL を手書き）で「見つかりません」UI に倒れることを確認

---

## Acceptance Criteria

- [ ] `getSeasonHistory(gid, seasonId)` repository 関数が追加され、success / not-found / failure の 3 経路がテストされている
- [ ] `/groups/[gid]/season/history/[seasonId]` ページが新設され、group メンバーは閲覧可能、非メンバーは「見つかりません」UI に倒れる
- [ ] 詳細ページの ranking table が 6 列（順位 / 表示名 / 参加 / 優勝 / FT / 累計ポイント）で `totalPoints desc` に sort されている
- [ ] 詳細ページに「シーズン首位カードを保存」+ Web Share 対応端末では「過去シーズン首位をシェア」が並列配置されている
- [ ] `SeasonHistoryList` の各 entry 右側に「詳細を見る」 Link が出る。accordion / `expanded` state / top3 の `<ol>` 描画は完全に削除されている
- [ ] PRD Phase D 行の `PRP Plan` セルに本 improvement plan へのリンクが追記されている
- [ ] `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run test:rules-season` が全 PASS
- [ ] firestore.rules / firestore.indexes.json / schemas / `finishTournament` / `startNewSeason` には一切変更がない（diff で確認）

## Completion Checklist

- [ ] 新規 page / client が既存 audio-settings / clone のページ規約に従っている
- [ ] エラー処理は `unwrapOrFrom` + `logger.debug` で `[error-logging.md](../../../rules/error-logging.md)` の二重 warn 回避方針に沿う
- [ ] `getSeasonHistory` は `wrapFirestoreRead` 経由で AppError ラップ済（手書き try/catch + logger.warn を新規導入していない）
- [ ] 詳細ページのテストが mock 境界 = repository module の vi.mock で組まれており、内部 SDK call の assert に依存していない
- [ ] テスト fixture は test file 内 local の factory で組まれている（共有 util を invent していない）
- [ ] 新規 export / 関数に冗長な doc コメントを書いていない（CLAUDE.md「default to writing no comments」）
- [ ] `SeasonHistoryList` のテストから削除した accordion 系 assert は plan / commit message で明記する
- [ ] README / 業務仕様書の追記が新規ページの URL と挙動を一行で要約している（過剰説明にしない）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- |
| `getDoc` を `firebase/firestore` mock に追加し忘れて test がハング | M | M | Task 2 の GOTCHA に明記、`getDoc: vi.fn()` の追加を最優先 step として走らせる |
| `SeasonTopCardDownloadButton` に渡す `stats` に `id` / `lastUpdatedAt` を付与する型合わせが冗長で読みづらい | L | L | コメント 1 行で「buildSeasonShareInputs は displayName / totalPoints のみ参照」と明記し、refactor は次回 architect-refactor に持ち越す |
| `SeasonHistoryList` の accordion 廃止で「top3 概要を見るのに 1 タップ余計に必要になる」と感じる UX 後退 | M | L | 行ヘッダで「首位 + 累計ポイント」までは即見える。top3 概要は「詳細ページが 1 タップで開ける」UX 改善でカバー。受け入れたうえで PRD Open Question に追記 |
| 不在 seasonId / permission-denied を同じ UI に統合することで debug 時に区別が付かない | L | L | `logger.debug` には `code` / `seasonId` / `gid` が出るため、開発時は console で区別可能。本番 UI では認可情報を leak しない方針を維持 |
| `Promise.all([getGroup, getSeasonHistory])` でどちらかが reject すると両方の取得失敗扱いになる | L | L | err.code を保持して UI 分岐するため、permission/not-found のメッセージは正しく出る。group は通常メンバーなら read 可なので実用上 history 側の reject が支配的 |
| `useAuthUser` mock の固定化が他テストに leak する | L | L | test file 単位の `vi.mock` は file スコープ。Vitest の standard 振る舞いで隣接 test に影響なし |
| Phase A / Phase D で書いた他テストへの回帰 | L | M | 全件 1030 → 1037 程度の増分のみ、変更したのは `SeasonHistoryList` の 1 ファイルのみ。`npm test` 全件で確認 |

## Notes

- **`buildSeasonShareInputs` の引数 narrow** は `SeasonShareInputsGroup` / `SeasonShareInputsStats` で structural typing 化されている（[og-payload.ts:185-194](../../../../src/app/api/og/_lib/og-payload.ts#L185-L194)）。これにより、past season から `{ name, seasonStartDate: history.startedAt }` および `entries` を渡すだけで、helper 修正不要に reuse できる
- **future work**: `SeasonHistoryDoc.entries` は schema 上 `displayName + uid + 4 数値` のみ。表示時の avatar / 補助情報を将来追加するなら schema additive が必要。本 plan のスコープ外
- **future work**: 詳細ページに「このシーズンに開催されたトーナメント一覧」を出したい欲求があり得るが、現状 schema は `entries` のみ snapshot、トーナメント一覧の link を持たない。実現するなら history doc に `tournamentIds[]` を append する schema 拡張が必要 → 別 PRD / 別 phase の話
- **future work**: pagination / retention（history doc の保持期間）は PRD の Open Question として残る。20 人 × 月 1〜2 回開催なら数年規模で問題ないが、3 年以降は要再検討
- **dev server / build 競合**: `architect-refactor` skill の運用知見（[コミット cdfb939](https://example.com/) で記録）に従い、本 plan の Manual Validation 中は build / lint / test の同時並行起動を避ける。dev server を立てる前に typecheck + unit test を済ませる順序で進める
