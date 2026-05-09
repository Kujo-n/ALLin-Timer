# Plan: Phase 2 — `/spectate/[tid]` Read-only Page（観戦モード）

## Summary

`tournaments/{tid}.spectateEnabled === true` の tournament を **完全 unauthenticated** で閲覧できる新規ルート `/spectate/[tid]` を `page.tsx` + `spectate-client.tsx` の 2 ファイル構成で実装する。`useTournamentTimer(tid)` / `subscribePlayers(tid)` / `subscribeTables(tid)` の既存購読 API をそのまま再利用し、**タイマー / ブラインド / 残人数 / 席表 / レイトレジ受付状況 banner** を read-only で描画する。観戦公開外（spectateEnabled が `false` / 不在）と toggle OFF 後の `permission-denied` を区別したうえで、それぞれ「観戦が公開されていません」「観戦が終了しました」に倒す graceful handling を入れる。

`/live` の DOM / ロジックには触らない（独立進化）。`RequireAuth` / `useAuthUser` / `useCurrentGroup` / `useGroupRole` 等 auth コンテキストは spectate-client から一切読まない。

## User Story

As a 会場の予備モニタを操作する運営者 / 開始時刻に間に合わない遅刻参加者, I want `/spectate/{tid}` URL を開くだけで現在のタイマー・ブラインド・残人数・席表・レイトレジ受付状況を確認できる, so that ログイン操作なしに「投影できる」「急ぐべきか判断できる」「家族や来訪者に状況を共有できる」状態を得られる。

## Problem → Solution

**Current state**: Phase 1 で `spectateEnabled` field と Firestore Rules 4 経路の anon read 拡張が完了しており、unauthenticated でも `tournaments/{tid}` / 配下 `players` / `tables` を read できる土台はある。しかし anon read を消費する **画面が存在しない**ため、運営者・遅刻参加者ともに価値を享受できない。

**Desired state**: `/spectate/[tid]` で `spectateEnabled === true` の tournament を read-only 表示。toggle OFF / 未設定 / 不存在のいずれも graceful にハンドリング（「観戦が終了しました」「観戦が公開されていません」）し、white screen / unhandled error にならない。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md)
- **PRD Phase**: Phase 2 — `/spectate/[tid]` Read-only Page
- **Estimated Files**: 4 ファイル（page 1 / client 1 / client test 1 / 規約 docs 1）

---

## UX Design

### Before

N/A — `/spectate/[tid]` はまだ存在しない。Phase 1 で rule / schema は仕込み済みだが、anon read を消費する画面はゼロ。

### After

**運営者フロー（予備モニタ）** — 既に Phase 3 で toggle ON した tournament を想定:

```
[予備モニタ browser]
  ↓ URL https://allin-pokertimer.example/spectate/{tid} を開く
┌────────────────────────────────────────────────────────────────┐
│ ALLin-PokerTimer                       [ログイン]               │ ← root header（Phase 2 では非干渉）
├────────────────────────────────────────────────────────────────┤
│  ⚠ 通信が一時切れています  / ⏳ 同期中…  （状況により表示）     │
│                                                                │
│   <tournament.name>                          ●  hh:mm:ss        │ ← ConnectionBadge
│                                                                │
│  [Lv 4]  [進行中]                                               │
│                                                                │
│            ┌──────────────────────────────────┐                │
│            │       08:42                      │  ← TimerDisplay │
│            │  SB 100 / BB 200 / Ante 25      │                  │
│            │  Next: Lv 5 (200 / 400)         │                  │
│            └──────────────────────────────────┘                │
│                                                                │
│  [📢 レイトレジ Lv 6 まで受付中]   ← Phase 2 新規 banner       │
│                                                                │
│  ┌─Players──┐ ┌─Average Stack──┐ ┌─Next Break In──┐            │
│  │ 14 / 18  │ │  21,400         │ │ 18:30 (Lv 7)   │            │
│  └──────────┘ └────────────────┘ └───────────────┘            │
│                                                                │
│  ┌─SeatingBoard（read-only）────────────────────────┐          │
│  │ ┌Table 1┐ ┌Table 2┐ ┌Table 3┐                   │          │
│  │ │ 1: …  │ │ 1: …  │ │ 1: …  │                   │          │
│  │ │ 2: …  │ │ 2: …  │ │ 2: …  │                   │          │
│  │ │ ...   │ │ ...   │ │ ...   │                   │          │
│  │ └───────┘ └───────┘ └───────┘                   │          │
│  └────────────────────────────────────────────────────┘          │
│                                                                │
│  ┌─ストラクチャ snapshot────────────────────────┐               │
│  │ Lv | SB  | BB  | Ante | 分                  │               │
│  │ 1  | 25  | 50  | 0    | 10                  │               │
│  │ ...                                         │               │
│  └─────────────────────────────────────────────┘               │
└────────────────────────────────────────────────────────────────┘
```

**遅刻参加者フロー** — 共有された URL を開く:

```
[スマホ browser]
  ↓ /spectate/{tid}
┌──────────────────────┐
│ <tournament.name>     │
├──────────────────────┤
│ Lv 2  進行中         │
│   ┌──────────────┐    │
│   │   06:12       │    │
│   │ SB 50 / BB 100│    │
│   └──────────────┘    │
│                      │
│ [📢 レイトレジ        │
│   Lv 3 まで受付中]   │ ← 「急ぐべきか判断」の核
│                      │
│ Players: 16 / 18      │
│                      │
│ ┌─SeatingBoard─┐     │
│ │ Table 1      │     │
│ │ 1: 太郎      │     │
│ │ ...          │     │
│ └──────────────┘     │
└──────────────────────┘
```

**toggle OFF 後の graceful handling**:

```
┌──────────────────────────────────┐
│ ALLin-PokerTimer    [ログイン]   │
├──────────────────────────────────┤
│                                  │
│   観戦が終了しました              │
│   この tournament の観戦モードは │
│   既に OFF にされています。       │
│   主催者にお問い合わせください。  │
│                                  │
└──────────────────────────────────┘
```

**spectateEnabled === false / 不在 / tid 不存在の guard**:

```
┌──────────────────────────────────┐
│   観戦が公開されていません        │
│   URL を再確認するか、主催者に   │
│   観戦モードの公開状態を         │
│   確認してください。              │
└──────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `/spectate/{tid}` を anon が開く | 404 / route 不在 | 公開中 → タイマー画面、非公開 → 「観戦が公開されていません」 | Phase 1 の anon read を消費する初の経路 |
| 公開中に toggle OFF された瞬間（Phase 3 後の操作） | （N/A） | onSnapshot error → 「観戦が終了しました」に画面遷移 | 単独 Phase 2 では Phase 3 toggle 不在のため emulator REST で擬似検証 |
| 既存 `/live` 動作 | login 必須 | 不変 | `/live` の DOM / ロジックには触らない |
| 既存 sidebar / header chrome | 表示 | 表示（kiosk 完全抑制は本 Phase scope 外） | Phase 1 review の defense-in-depth 議論と整合 |

---

## Mandatory Reading

実装前に必ず読むべきファイル。

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md) | all | 全 Decisions Log / MoSCoW / Phase 2 詳細 / Won't 項目（uid 完全隠蔽 / 賞金構造 / spectateCode 等） |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/plans/completed/phase-1-schema-rule-emulator.plan.md](completed/phase-1-schema-rule-emulator.plan.md) | all | Phase 1 で固めた schema / rule / validator の最終形。spectateEnabled の rule 経路 4 つの正確な動作を理解する |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/reports/phase-1-schema-rule-emulator-report.md](../reports/phase-1-schema-rule-emulator-report.md) | all | 想定外: zod default が型上 non-optional になり fixture 14 件改修が必要だった先例。Phase 2 で同型イベントが起きるか事前確認 |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/reviews/local-phase-1-review.md](../reviews/local-phase-1-review.md) | all | MEDIUM（既に対応済 `allow get/list` 分割）と LOW-3（観戦経路 read コストの docs 追記タスク）を Phase 2 で消化 |
| P0 (critical) | [src/app/tournaments/[tid]/live/page.tsx](../../../../src/app/tournaments/[tid]/live/page.tsx) | 1-19 | mirror 元の Server Component。`Viewport` export と `params: Promise<{tid}>` 取り出しの 2 行構成 |
| P0 (critical) | [src/app/tournaments/[tid]/live/live-client.tsx](../../../../src/app/tournaments/[tid]/live/live-client.tsx) | 1-396 | mirror 元の Client Component。subscribe / hook 呼出順 / TimerDisplay 等の組合せをそのまま流用するが、auth 周辺・joinSelfPanel・winner 系は丸ごと除外 |
| P0 (critical) | [src/app/tournaments/[tid]/live/live-client.test.tsx](../../../../src/app/tournaments/[tid]/live/live-client.test.tsx) | 1-110 | mock 構造（useTournamentTimer / subscribePlayers / subscribeTables）。fixture factory `makeTournament(overrides)` の形を完全踏襲 |
| P0 (critical) | [src/lib/hooks/useTournamentTimer.ts](../../../../src/lib/hooks/useTournamentTimer.ts) | 1-143 | hook が `useAuthUser` を読まない（auto-advance なし時）ことを確認。本 plan では `autoAdvance` を渡さない |
| P0 (critical) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 820-854 | `subscribeTournament` は内部で `useAuthUser` を読まない。FirebaseError は `firestore/subscribe_failed` で wrap される（cause に元 FirebaseError） |
| P0 (critical) | [src/lib/firebase/repositories/players.ts](../../../../src/lib/firebase/repositories/players.ts) | 60-82 | `subscribePlayers` のエラー wrap 形（`firestore/subscribe_failed`）。anon でも spectate read rule が通ってさえいれば動く |
| P0 (critical) | [src/lib/firebase/repositories/tables.ts](../../../../src/lib/firebase/repositories/tables.ts) | 41-57 | `subscribeTables` 同上 |
| P0 (critical) | [src/lib/errors.ts](../../../../src/lib/errors.ts) | 1-58 | `AppError.from` の cause 保持 / `getErrorCode(err.cause)` で元 FirebaseError code を取り出す pattern |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | `spectate/*` prefix（Phase 1 で追加済）の使い方。Phase 2 で初めて実コードに `spectate/permission-denied` が出現する |
| P1 (important) | [src/components/tournament/TimerDisplay.tsx](../../../../src/components/tournament/TimerDisplay.tsx) | 1-136 | 受け取る props 型（tournament / remainingMs / levelInfo）。pure component のため auth 不要 |
| P1 (important) | [src/components/tournament/PlayersCard.tsx](../../../../src/components/tournament/PlayersCard.tsx) | 1-35 | players=空 のとき null を返す（render skip）。spectate でも同挙動 |
| P1 (important) | [src/components/tournament/AverageStackCard.tsx](../../../../src/components/tournament/AverageStackCard.tsx) | 1-50 | tournament + players。auth 不要 |
| P1 (important) | [src/components/tournament/NextBreakCard.tsx](../../../../src/components/tournament/NextBreakCard.tsx) | 1-102 | tournament + remainingMs。auth 不要 |
| P1 (important) | [src/components/tournament/StructureSnapshotCard.tsx](../../../../src/components/tournament/StructureSnapshotCard.tsx) | 1-181 | `canEdit` / `onUpdateDurationSec` を渡さなければ純 read-only モードになる |
| P1 (important) | [src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) | 1-273 | `canManage=false` / `onMoveSeat=undefined` / `canEditTableLabel=false` / `currentUid=null` で完全 read-only。enableDnd は false に倒れる |
| P1 (important) | [src/components/tournament/OfflineBanner.tsx](../../../../src/components/tournament/OfflineBanner.tsx) | 1-52 | fromCache / hasPendingWrites の 2 状態のみ。auth 不要 |
| P1 (important) | [src/components/tournament/ConnectionBadge.tsx](../../../../src/components/tournament/ConnectionBadge.tsx) | 1-58 | `lastSyncAt: number \| null` を受ける。auth 不要 |
| P1 (important) | [src/lib/services/timer.ts](../../../../src/lib/services/timer.ts) | 1-202 | `getLevelInfo` / `getRemainingMs` / `getNextBreakInfo` / `resolveWinner` 等の純関数 |
| P1 (important) | [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | 1-191 | `isBeforeStart` / `isInProgress` / `isFinished` 等の純関数。late entry banner 判定で利用 |
| P2 (reference) | [src/lib/firebase/schemas/tournament.ts](../../../../src/lib/firebase/schemas/tournament.ts) | 1-78 | `lateEntryDeadlineLevel` / `currentLevel` / `state` の型を確認 |
| P2 (reference) | [src/lib/firebase/schemas/player.ts](../../../../src/lib/firebase/schemas/player.ts) | 1-39 | `displayName` / `tableNum` / `seatNum` / `isBusted` / `isPlayingDealer` |
| P2 (reference) | [src/lib/firebase/schemas/table.ts](../../../../src/lib/firebase/schemas/table.ts) | 1-30 | `label` / `color` の null 許容、`formatTableLabel` フォールバック |
| P2 (reference) | [src/lib/services/format-table-label.ts](../../../../src/lib/services/format-table-label.ts) | 1-19 | `Table N` フォールバック純関数 |
| P2 (reference) | [src/lib/firebase/AuthProvider.tsx](../../../../src/lib/firebase/AuthProvider.tsx) | 1-77 | spectate-client が読まないことを確認するための negative reading（auth コンテキスト侵入禁止） |
| P2 (reference) | [src/components/auth/RequireAuth.tsx](../../../../src/components/auth/RequireAuth.tsx) | 1-31 | spectate page では使わないことを確認するための negative reading |
| P2 (reference) | [src/components/nav/AppShell.tsx](../../../../src/components/nav/AppShell.tsx) | 1-84 | sidebar 表示判定のロジック。spectate でも `user === null` 経由で sidebar が出るが、Phase 2 ではそのまま受容（kiosk 抑制は scope 外） |
| P2 (reference) | [src/app/layout.tsx](../../../../src/app/layout.tsx) | 1-89 | root layout に AuthProvider / GroupProvider / 共通 header が居る。spectate でも mount される（spectate-client から read しないだけ） |

## External Documentation

外部ドキュメント参照は不要。すべて内部 codebase の確立済みパターンの組合せで完結する。

> 注: Next.js 15 App Router の `params: Promise<{...}>` async unwrapping は [src/app/tournaments/[tid]/live/page.tsx:12](../../../../src/app/tournaments/[tid]/live/page.tsx#L12) の先例で確認できる。Phase 2 でも同型を踏襲する。

---

## Patterns to Mirror

### SERVER_COMPONENT_PAGE_SHELL（page.tsx の最小構成）

```ts
// SOURCE: src/app/tournaments/[tid]/live/page.tsx:1-19
import type { Viewport } from "next";

import { RequireAuth } from "@/components/auth/RequireAuth";

import { LiveClient } from "./live-client";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function LivePage({ params }: { params: Promise<{ tid: string }> }) {
  const { tid } = await params;
  return (
    <RequireAuth allowAnonymous>
      <LiveClient tid={tid} />
    </RequireAuth>
  );
}
```

**spectate 版の差分**: `RequireAuth` を **完全除去**して `<SpectateClient tid={tid} />` 単独を返す。これが PRD「RequireAuth は使わず、useAuthUser も読まない（純粋 unauthenticated）」の機械的な起点。

### CLIENT_SUBSCRIBE_LAYOUT（subscribe 3 種 + tick の組合せ）

```ts
// SOURCE: src/app/tournaments/[tid]/live/live-client.tsx:44-95
const { tournament, remainingMs, fromCache, hasPendingWrites, lastSyncAt, error } =
  useTournamentTimer(tid);
// ↑ /spectate でも同じく autoAdvance なしで呼ぶ（rule で書込不可 + auth nil のため）

const [players, setPlayers] = useState<PlayerDoc[]>([]);
const [tables, setTables] = useState<TableDoc[]>([]);

useEffect(() => {
  // /live は user 判定後に subscribe するが、/spectate は auth 不要のため無条件購読
  const unsub = subscribePlayers(
    tid,
    (list) => setPlayers(list),
    (err) => onSubscribeError(err, "players"),
  );
  return unsub;
}, [tid]);

useEffect(() => {
  const unsub = subscribeTables(
    tid,
    (list) => setTables(list),
    (err) => onSubscribeError(err, "tables"),
  );
  return unsub;
}, [tid]);
```

**spectate 版の差分**: `useAuthUser` を呼ばず、subscribe useEffect の deps から `user` を外して **purely tid だけで駆動**。

### SUBSCRIBE_ERROR_GRACEFUL_DETECTION（permission-denied → 観戦終了）

```ts
// SOURCE: 新規パターン（Phase 1 review LOW-3 に対応する補強として導入）
// 既存の subscribe 系は AppError.from(err, "firestore/subscribe_failed", "...") で wrap し
// 元 FirebaseError を `cause` に保持する（src/lib/errors.ts:11-15）。
// permission-denied を見分けるには getErrorCode(err.cause) を使う。
import { getErrorCode } from "@/lib/errors";

function classifySubscribeError(err: AppError): "spectate-ended" | "other" {
  const inner = getErrorCode(err.cause);
  return inner === "permission-denied" ? "spectate-ended" : "other";
}
```

`getErrorCode` は AppError / object with code / FirebaseError 全てを統一的に扱える（[src/lib/errors.ts:47-58](../../../../src/lib/errors.ts#L47-L58)）。

### TOURNAMENT_GUARD_LADDER（読込中 / 不存在 / 未公開 / 観戦終了 の分岐）

```ts
// SOURCE: 新規パターン
// /live は user 判定（authLoading / isAnonymous）が前置で、tournament は loaded after user。
// /spectate は user を全く読まないため guard ladder の段数が単純化する:
//
//   1. spectate ended (subscribe error code === permission-denied) → 「観戦が終了しました」
//   2. tournament null (まだ subscribe が fire していない) → 「読込中…」
//   3. tournament.spectateEnabled !== true (rule で初回 read は通ったが値が false) → 「観戦が公開されていません」
//   4. それ以外 → 通常の view を render
//
// note: rule は spectateEnabled === true の doc しか read を allow しないため、
// (3) は厳密には起きにくいが、安全網として残す（rule とアプリの defense-in-depth）。
```

### LATE_ENTRY_BANNER（spectate 専用の新規 component / inline ブロック）

```ts
// SOURCE: src/app/tournaments/[tid]/live/live-client.tsx:160-161 の lateEntryClosed 計算を再利用
const lateEntryClosed = tournament.currentLevel > tournament.lateEntryDeadlineLevel;

// banner ロジック:
// - state === "setup" / "seating": "受付準備中"（Lv 1 開始前なので closed === false）
// - state === "running" / "paused" && !lateEntryClosed: "📢 レイトレジ Lv N まで受付中"
// - state === "running" / "paused" && lateEntryClosed: "受付終了"
// - state === "finished": "終了"
//
// PRD は「Lv X まで受付中」「受付終了」の 2 文言を Must とする。
// "受付準備中" / "終了" は補助文言（明示要求はないが空白避けで埋める）。
```

### READONLY_SEATING_BOARD（既存 component を read-only モードで利用）

```ts
// SOURCE: src/components/tournament/SeatingBoard.tsx:85-97 の prop 既定値
<SeatingBoard
  players={players}
  tables={tables}
  seatsPerTable={tournament.seatsPerTable}
  // currentUid を null にすると ★ marker が付かない（観戦者は当事者ではない）
  currentUid={null}
  // canManage=false で PD checkbox / D&D / 卓 label edit が完全に無効化される
  canManage={false}
  // onTogglePd / onMoveSeat / onSaveTableLabel は渡さない → undefined → 該当 affordance 非描画
/>
```

`SeatingBoard` 側の `enableDnd = canManage && !!onMoveSeat` が false に確定し、`<DndContext>` 自体が回避される（[SeatingBoard.tsx:127, 262](../../../../src/components/tournament/SeatingBoard.tsx#L127)）。

### TEST_MOCK_BOUNDARY（live-client.test.tsx の構造を spectate 用に縮約）

```ts
// SOURCE: src/app/tournaments/[tid]/live/live-client.test.tsx:8-50
vi.mock("next/navigation", () => ({ useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() })) }));
vi.mock("@/lib/hooks/useTournamentTimer", () => ({ useTournamentTimer: vi.fn() }));
vi.mock("@/lib/firebase/repositories/players", () => ({ subscribePlayers: vi.fn() }));
vi.mock("@/lib/firebase/repositories/tables", () => ({ subscribeTables: vi.fn(() => () => {}) }));
// /spectate は useAuthUser / current-group / receipt / auth-actions を全く呼ばないため
// mock 自体を削除する。これが「auth コンテキスト不読」の機械検証になる。
```

`fakeTournament(overrides)` factory は live-client.test.tsx の `makeTournament` をそのまま流用。`spectateEnabled: true` を default に倒す（spectate 表示の通常 case）。

### NAMING_CONVENTION（Phase 1 のコメント慣習踏襲）

```ts
// Phase 2 (04-spectate-mode): /spectate/[tid] の Client Component。
//   /live と独立進化（auth 周辺は丸ごと除外）。subscribe API の onError から
//   permission-denied を検知して「観戦が終了しました」graceful 表示に倒す。
```

ファイル先頭 docblock で **Phase 番号 (04-spectate-mode 接頭辞)** + **scope 要約** を明記する（Phase 1 schema コメントと整合）。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/app/spectate/[tid]/page.tsx](../../../../src/app/spectate/[tid]/page.tsx) | CREATE | Server Component。`params: Promise<{tid}>` 受領 + viewport export + `<SpectateClient tid={tid} />` のみ。RequireAuth は使わない |
| [src/app/spectate/[tid]/spectate-client.tsx](../../../../src/app/spectate/[tid]/spectate-client.tsx) | CREATE | Client Component。`useTournamentTimer` / `subscribePlayers` / `subscribeTables` 購読 + 4 段 guard ladder + read-only render |
| [src/app/spectate/[tid]/spectate-client.test.tsx](../../../../src/app/spectate/[tid]/spectate-client.test.tsx) | CREATE | mock 4 関数（next/navigation / useTournamentTimer / subscribePlayers / subscribeTables）+ 6〜8 ケース（読込中 / 不存在 / 未公開 / 通常 / late entry / 観戦終了） |
| [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | UPDATE | Phase 1 review LOW-3 の消化。「Phase 2.5 以降の注意: `get()` による参照は rule read を消費」セクションに観戦経路（`/spectate/[tid]` の `subscribePlayers(tid)` 20 件 listen × `exists() + get()`）を 1〜2 行追記 |

## NOT Building

Phase 2 のスコープ外（Phase 3 / 4 で実装、または PRD「Won't」で明示永久対象外）:

- **`tournaments/{tid}.spectateEnabled` toggle UI**（dashboard / SpectateModeCard） — Phase 3 のスコープ
- **`setSpectateEnabled` service / `updateSpectateEnabled` repository** — Phase 3 のスコープ
- **URL コピー button / QR code 表示** — Phase 3 のスコープ
- **tournament 一覧 badge（観戦公開中 indicator）** — Phase 3 のスコープ
- **PWA cache の `/spectate` allowlist 追加** — Phase 4 のスコープ。本 Phase は SW 設定を触らない
- **kiosk-style chrome 抑制**（root header の AuthBadge / AppShell sidebar の path-aware 非表示） — 本 Phase scope 外。Phase 2 は **データ + 主要 UX に集中**し、global layout には触らない（変更影響範囲が広く、`/live` 等他経路への副作用が大きいため）。将来 polish が必要なら追加 PRP で別 phase 化
- **uid 完全隠蔽**（PRD Won't 永久対象外。`pid == uid` invariant が rule に depth integrated）
- **賞金構造（prizeStructure）の表示**（PRD Won't 永久対象外。schema に存在しない）
- **チップ量（chip count）の表示**（PRD Won't 永久対象外）
- **観戦者向けインタラクション**（chat / reaction / chip up 通知）（PRD Won't 永久対象外）
- **`/spectate` から「参加する」導線**（PRD Won't 永久対象外。受付は既存 `/join/[tid]` に集約）
- **WinnerBanner / Winner card 共有 button** — `/live` で運営者・参加者向けに既に実装済。観戦者は read-only 観点で「優勝者の displayName 表示」までは players 一覧 + isBusted から導出可能なので、本 Phase では追加せず、`/spectate` には banner を出さない（必要なら Phase 4 polish で追加検討）
- **Wake Lock API / Screen Orientation Lock** — `/live` でも未適用（Phase C device-controls の対象は `/live` 以外の dashboard 系）。観戦者用には別 PRD で扱う
- **OG card / OGP 対応** — public URL なので OGP 設定の余地はあるが、Phase 2 scope 外

---

## Step-by-Step Tasks

### Task 1: Server Component 作成（`page.tsx`）

- **ACTION**: [src/app/spectate/[tid]/page.tsx](../../../../src/app/spectate/[tid]/page.tsx) を新規作成
- **IMPLEMENT**:
  ```ts
  import type { Viewport } from "next";

  import { SpectateClient } from "./spectate-client";

  export const viewport: Viewport = {
    width: "device-width",
    initialScale: 1,
  };

  /**
   * Phase 2 (04-spectate-mode): 観戦モード公開された tournament の read-only ページ。
   *   - RequireAuth は使わない（PRD 設計）。spectate-client も useAuthUser を読まない。
   *   - 完全 unauthenticated 経路。tournaments/{tid}.spectateEnabled === true のときのみ
   *     subscribe が成立する（rule 側で OR 拡張済 — Phase 1）。
   *   - tournament が存在しない / spectateEnabled=false / toggle OFF（permission-denied）は
   *     spectate-client 側の guard ladder で graceful にハンドリング。
   */
  export default async function SpectatePage({
    params,
  }: {
    params: Promise<{ tid: string }>;
  }) {
    const { tid } = await params;
    return <SpectateClient tid={tid} />;
  }
  ```
- **MIRROR**: SERVER_COMPONENT_PAGE_SHELL（[src/app/tournaments/[tid]/live/page.tsx:1-19](../../../../src/app/tournaments/[tid]/live/page.tsx#L1-L19)）。差分は `RequireAuth` 除去 1 点
- **IMPORTS**: `import type { Viewport } from "next";` と新規作成する `./spectate-client` の `SpectateClient`
- **GOTCHA**:
  - `RequireAuth` を import する誘惑があるが**絶対に使わない**。PRD「RequireAuth は使わず、useAuthUser も読まない」を機械的に enforce
  - `params: Promise<{tid: string}>` は Next.js 15 の async params API（既存 [/live/page.tsx](../../../../src/app/tournaments/[tid]/live/page.tsx) と同型）
  - root layout は引き続き `<AuthProvider>` / `<GroupProvider>` / `<AppShell>` を mount するが、spectate-client がそれらを **read しない**ことで auth 経路と分離する
- **VALIDATE**:
  - `npm run typecheck` → 0 errors
  - `npm run build` → `/spectate/[tid]` が dynamic route として登録される

### Task 2: Client Component 作成（`spectate-client.tsx`）— skeleton + subscribe

- **ACTION**: [src/app/spectate/[tid]/spectate-client.tsx](../../../../src/app/spectate/[tid]/spectate-client.tsx) を新規作成。最初に subscribe + state 管理 + guard ladder の skeleton を書く（次 Task で render 部を肉付け）
- **IMPLEMENT**:
  ```ts
  "use client";

  import { useEffect, useState } from "react";

  import { AppError, getErrorCode } from "@/lib/errors";
  import { subscribePlayers } from "@/lib/firebase/repositories/players";
  import { subscribeTables } from "@/lib/firebase/repositories/tables";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TableDoc } from "@/lib/firebase/schemas/table";
  import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
  import { logger } from "@/lib/logger";

  /**
   * Phase 2 (04-spectate-mode): 観戦モード公開中の tournament を unauthenticated で表示する。
   *
   * - useAuthUser / useCurrentGroup / useGroupRole は **一切読まない**（PRD 設計）。
   * - useTournamentTimer は autoAdvance を渡さず read-only 用途で利用。
   * - subscribePlayers / subscribeTables は anon でも spectateEnabled=true の rule 経路で通る。
   * - guard ladder（4 段）: spectate ended → 読込中 → 未公開 → 通常 view。
   */
  export function SpectateClient({ tid }: { tid: string }) {
    const { tournament, remainingMs, fromCache, hasPendingWrites, lastSyncAt, error: timerError } =
      useTournamentTimer(tid);
    const [players, setPlayers] = useState<PlayerDoc[]>([]);
    const [tables, setTables] = useState<TableDoc[]>([]);

    // spectateEnabled OFF → 既存 listener が permission-denied を吐く。これを「観戦が終了しました」
    // graceful な状態に倒すための flag。一度 true になったら subscribe 系の他エラーで上書きしない。
    const [spectateEnded, setSpectateEnded] = useState(false);

    function handleSubscribeError(err: AppError, scope: "tournament" | "players" | "tables"): void {
      // err は AppError ラップ済（firestore/subscribe_failed）。元の FirebaseError code を
      // err.cause から取り出して permission-denied かどうかを判定する。
      const innerCode = getErrorCode(err.cause);
      logger.warn("spectate subscribe error", {
        code: err.code,
        innerCode,
        scope,
        tid,
      });
      if (innerCode === "permission-denied") {
        setSpectateEnded(true);
      }
    }

    // useTournamentTimer 自体の error も同経路でハンドリング。
    useEffect(() => {
      if (timerError) handleSubscribeError(timerError, "tournament");
      // tid を含めない (timerError 変化のみ trigger): handleSubscribeError は内部で tid 参照
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [timerError]);

    useEffect(() => {
      const unsub = subscribePlayers(
        tid,
        (list) => setPlayers(list),
        (err) => handleSubscribeError(err, "players"),
      );
      return unsub;
    }, [tid]);

    useEffect(() => {
      const unsub = subscribeTables(
        tid,
        (list) => setTables(list),
        (err) => handleSubscribeError(err, "tables"),
      );
      return unsub;
    }, [tid]);

    // ────────────────────────────────────────────────────────────
    // Guard ladder
    if (spectateEnded) {
      return (
        <main className="mx-auto max-w-md p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold">観戦が終了しました</h1>
          <p className="text-sm text-muted-foreground">
            この tournament の観戦モードは既に OFF にされています。主催者にお問い合わせください。
          </p>
        </main>
      );
    }

    if (!tournament) {
      return (
        <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">
          読込中…
        </main>
      );
    }

    if (tournament.spectateEnabled !== true) {
      return (
        <main className="mx-auto max-w-md p-6 text-center">
          <h1 className="mb-2 text-lg font-semibold">観戦が公開されていません</h1>
          <p className="text-sm text-muted-foreground">
            URL を再確認するか、主催者に観戦モードの公開状態を確認してください。
          </p>
        </main>
      );
    }

    // 通常 view は Task 3 / 4 / 5 で肉付け。
    return null;  // ← 一旦 placeholder
  }
  ```
- **MIRROR**: CLIENT_SUBSCRIBE_LAYOUT / SUBSCRIBE_ERROR_GRACEFUL_DETECTION / TOURNAMENT_GUARD_LADDER
- **IMPORTS**: 既存 codebase に存在する import のみ。新規 dependency なし
- **GOTCHA**:
  - `getErrorCode(err.cause)` は AppError / FirebaseError / object with `code` を統一的に扱える。型ガード手書き禁止（[error-logging.md](../../../rules/error-logging.md) の「禁止パターン」参照）
  - `setSpectateEnded(true)` は idempotent なので重複呼出 OK。複数 listener が同時に permission-denied を吐いても問題なし
  - `useTournamentTimer` の error は内部で `firestore/subscribe_failed` wrap 済（src/lib/firebase/repositories/tournaments.ts:852）。同型で `cause` に元 FirebaseError を保持
  - `handleSubscribeError` は `tid` を closure で参照。effect deps に `tid` を入れる必要はないが、unsub 経路で `tid` 切替時には effect 再実行で新 listener が立ち上がる
  - **`logger.info` を `console.log` に置換しない**（[error-logging.md](../../../rules/error-logging.md) の `console.*` 禁止規約）
- **VALIDATE**:
  - `npm run typecheck` → 0 errors
  - 一旦 render が `null` placeholder のため、UI 単体は意味のある描画をしない（次 Task で完成）

### Task 3: Client Component — header / 通信状態 banner / TimerDisplay 配置

- **ACTION**: Task 2 の placeholder `return null;` を、tournament name / OfflineBanner / ConnectionBadge / TimerDisplay / late entry banner の 5 要素を縦に並べた最初の render に置換
- **IMPLEMENT**:
  ```ts
  // 既存 import に追加:
  // import { OfflineBanner } from "@/components/tournament/OfflineBanner";
  // import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
  // import { TimerDisplay } from "@/components/tournament/TimerDisplay";
  // import { getLevelInfo } from "@/lib/services/timer";

  const levelInfo = getLevelInfo(tournament);
  const lateEntryClosed = tournament.currentLevel > tournament.lateEntryDeadlineLevel;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 pt-6">
      <OfflineBanner fromCache={fromCache} hasPendingWrites={hasPendingWrites} />

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold md:text-xl">{tournament.name}</h1>
        <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
      </header>

      <TimerDisplay
        tournament={tournament}
        remainingMs={remainingMs}
        levelInfo={levelInfo}
      />

      <SpectateLateEntryBanner
        tournament={tournament}
        lateEntryClosed={lateEntryClosed}
      />

      {/* Players / AverageStack / NextBreak / SeatingBoard / StructureSnapshot は Task 4 で追加 */}
    </main>
  );
  ```
  追加の inner component（同 file 末尾、export しない）:
  ```ts
  /**
   * Phase 2 (04-spectate-mode): 観戦者向けレイトレジ受付状況 banner。
   *
   * - state === "setup" / "seating": 「受付準備中」（trying to register が常に有効）
   * - state === "running" / "paused" && !lateEntryClosed: "📢 レイトレジ Lv N まで受付中"
   * - state === "running" / "paused" && lateEntryClosed: "受付終了"
   * - state === "finished": "終了"
   *
   * PRD Must: "Lv X まで受付中" / "受付終了" の 2 文言は必須。"受付準備中" / "終了" は補助。
   * 配色は PlayersCard と整合（amber=注意、muted=平常、emerald=受付中）。
   */
  function SpectateLateEntryBanner({
    tournament,
    lateEntryClosed,
  }: {
    tournament: TournamentDoc;
    lateEntryClosed: boolean;
  }) {
    if (tournament.state === "finished") {
      return (
        <section
          role="status"
          className="mx-auto w-full rounded-md border bg-muted px-3 py-2 text-center text-sm"
        >
          このトーナメントは終了しました
        </section>
      );
    }
    if (tournament.state === "setup" || tournament.state === "seating") {
      return (
        <section
          role="status"
          className="mx-auto w-full rounded-md border bg-muted/40 px-3 py-2 text-center text-sm text-muted-foreground"
        >
          受付準備中（開始前）
        </section>
      );
    }
    // running / paused
    if (lateEntryClosed) {
      return (
        <section
          role="status"
          aria-live="polite"
          className="mx-auto w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm dark:border-amber-700 dark:bg-amber-900/20"
          data-testid="spectate-late-entry-closed"
        >
          ⛔ レイトレジ受付終了（Lv {tournament.lateEntryDeadlineLevel} まで）
        </section>
      );
    }
    return (
      <section
        role="status"
        aria-live="polite"
        className="mx-auto w-full rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-sm dark:border-emerald-700 dark:bg-emerald-900/20"
        data-testid="spectate-late-entry-open"
      >
        📢 レイトレジ Lv {tournament.lateEntryDeadlineLevel} まで受付中（現在 Lv {tournament.currentLevel}）
      </section>
    );
  }
  ```
  `TournamentDoc` の import を file 上部に追加: `import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";`
- **MIRROR**: LATE_ENTRY_BANNER / live-client.tsx の `<header>` + `<OfflineBanner>` の組合せ
- **IMPORTS**: `OfflineBanner` / `ConnectionBadge` / `TimerDisplay` / `getLevelInfo` / `TournamentDoc` を追加
- **GOTCHA**:
  - `aria-live="polite"` を付けると SR が level 切替時に読み上げる。観戦経路は SR 用途は薄いが、live-client.tsx の OfflineBanner も同 attr を使っているため整合させる
  - `data-testid` は unit test の selector として使う。PRD「reading のみ」の方針上 test-id を付与せず getByRole で済ませても良いが、`role="status"` の重複（OfflineBanner / ConnectionBadge も status）で曖昧化するため明示する
  - `tournament.lateEntryDeadlineLevel` は schema で `z.number().int().positive()` のため undefined にならない。null チェック不要
- **VALIDATE**:
  - typecheck pass
  - 手動: emulator で seedOrganizerTournament + spectateEnabled=true seed → ブラウザで `/spectate/{tid}` を開き、tournament name / TimerDisplay / Late entry banner が表示される

### Task 4: Client Component — Players / AverageStack / NextBreak / StructureSnapshot 追加

- **ACTION**: Task 3 の `<main>` 内、`<SpectateLateEntryBanner />` の後ろに 4 カードを配置する
- **IMPLEMENT**:
  ```ts
  // 追加 imports:
  // import { AverageStackCard } from "@/components/tournament/AverageStackCard";
  // import { NextBreakCard } from "@/components/tournament/NextBreakCard";
  // import { PlayersCard } from "@/components/tournament/PlayersCard";
  // import { StructureSnapshotCard } from "@/components/tournament/StructureSnapshotCard";

  // <SpectateLateEntryBanner /> の後ろに追加:
  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
    <PlayersCard players={players} />
    <AverageStackCard tournament={tournament} players={players} />
    <NextBreakCard tournament={tournament} remainingMs={remainingMs} />
  </div>

  <StructureSnapshotCard
    snapshot={tournament.structureSnapshot}
    currentLevel={tournament.currentLevel}
    showDescription={false}
  />
  ```
  注: PlayersCard / AverageStackCard は `players.length === 0 → null` で render skip するため、開幕直後の subscribe 未 fire 状態でも grid が空セルになるだけで white screen にはならない。
- **MIRROR**: live-client.tsx の `<aside>` 内 3 カード（PlayersCard / AverageStackCard / NextBreakCard）の組合せ + `<StructureSnapshotCard>` を append
- **IMPORTS**: 上記 4 component を import 追加
- **GOTCHA**:
  - `StructureSnapshotCard` は `canEdit` / `onUpdateDurationSec` / `onAppendLevel` を渡さなければ純 read-only モード（[StructureSnapshotCard.tsx:62-80](../../../../src/components/tournament/StructureSnapshotCard.tsx#L62-L80)）。spectate でも安全に使える
  - `showDescription={false}` で「以降の structures 側の編集はこのトーナメントには影響しません」の運営向け説明を非表示にする（観戦者には不要）
  - `<NextBreakCard remainingMs={remainingMs} />` の `remainingMs` は `useTournamentTimer` 由来の number | null。state===setup/seating で null だが card 側で beforeStart 分岐するため OK
  - `AverageStackCard` も `players.length === 0 → null` 同様 graceful
- **VALIDATE**:
  - typecheck pass
  - 手動 ブラウザ: 4 カードが状態遷移（setup → seating → running → finished）で意図通り render される（live-client と同じ動き）

### Task 5: Client Component — SeatingBoard（read-only）追加

- **ACTION**: Task 4 の StructureSnapshotCard の **前**に SeatingBoard を配置する（live-client.tsx は dashboard 側に SeatingBoard、live 側は表示しないが、PRD で観戦は「席表」を Must とする）
- **IMPLEMENT**:
  ```ts
  // 追加 import:
  // import { SeatingBoard } from "@/components/tournament/SeatingBoard";

  // grid + StructureSnapshot の間に挿入:
  <SeatingBoard
    players={players}
    tables={tables}
    seatsPerTable={tournament.seatsPerTable}
    currentUid={null}
    canManage={false}
  />
  ```
- **MIRROR**: READONLY_SEATING_BOARD（[src/components/tournament/SeatingBoard.tsx](../../../../src/components/tournament/SeatingBoard.tsx) の prop 既定値で完全 read-only 化）
- **IMPORTS**: `SeatingBoard` を import 追加
- **GOTCHA**:
  - `currentUid={null}` で ★ marker 抑制（観戦者は当事者ではない）
  - `canManage={false}` で **PD checkbox / D&D / 卓 label edit が完全無効**
  - `tables.length === 0`（subscribe 未 fire）のとき SeatingBoard は「テーブルがまだありません（席決め前）。」を render する（[SeatingBoard.tsx:165-171](../../../../src/components/tournament/SeatingBoard.tsx#L165-L171)）。setup 中はこれが表示される正常 path
  - players が空でも tables だけは subscribe で取れる（rule 上独立）。各卓の `tableSeated` が空配列で「— 」表示される
  - `tournament.seatsPerTable` は schema `z.number().int().min(2).max(10)` で必ず integer
- **VALIDATE**:
  - typecheck pass
  - 手動 ブラウザ: seating commit 済 tournament を観戦すると、各 Table card に displayName が席に並ぶ。PD checkbox / D&D handle 不在を目視確認

### Task 6: Unit Tests — `spectate-client.test.tsx`

- **ACTION**: [src/app/spectate/[tid]/spectate-client.test.tsx](../../../../src/app/spectate/[tid]/spectate-client.test.tsx) を新規作成
- **IMPLEMENT**: live-client.test.tsx の構造を縮約し、auth 関連 mock を全削除する。
  ```ts
  import { act, render, screen, waitFor } from "@testing-library/react";
  import { Timestamp } from "firebase/firestore";
  import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

  import { AppError } from "@/lib/errors";
  import type { PlayerDoc } from "@/lib/firebase/schemas/player";
  import type { TableDoc } from "@/lib/firebase/schemas/table";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

  vi.mock("next/navigation", () => ({
    useRouter: vi.fn(() => ({ replace: vi.fn(), push: vi.fn(), back: vi.fn() })),
  }));
  vi.mock("@/lib/hooks/useTournamentTimer", () => ({
    useTournamentTimer: vi.fn(),
  }));
  vi.mock("@/lib/firebase/repositories/players", () => ({
    subscribePlayers: vi.fn(),
  }));
  vi.mock("@/lib/firebase/repositories/tables", () => ({
    subscribeTables: vi.fn(() => () => {}),
  }));

  // /spectate は useAuthUser / useCurrentGroup / receipt / auth-actions を呼ばないため
  // mock 不要。これが「auth コンテキスト不読」の機械検証 (negative test)。

  import { subscribePlayers } from "@/lib/firebase/repositories/players";
  import { subscribeTables } from "@/lib/firebase/repositories/tables";
  import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";

  import { SpectateClient } from "./spectate-client";

  const ts = Timestamp.fromDate(new Date("2026-05-09T10:00:00Z"));

  function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
    return {
      id: "t1",
      groupId: "g1",
      createdByUid: "u1",
      name: "Spectate Tournament",
      structureSnapshot: {
        name: "Default",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 3,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
          { level: 4, sb: 100, bb: 200, ante: 25, durationSec: 600, isBreak: false },
        ],
      },
      state: "running",
      startedAt: ts,
      levelStartedAt: ts,
      pausedAt: null,
      pausedAccumMs: 0,
      finishedAt: null,
      currentLevel: 2,
      lateEntryDeadlineLevel: 3,
      seatsPerTable: 9,
      spectateEnabled: true,  // spectate 通常 case の default を true に倒す
      createdAt: ts,
      updatedAt: ts,
      ...overrides,
    };
  }

  function setTimerMock(payload: {
    tournament: TournamentDoc | null;
    error?: AppError | null;
  }): void {
    vi.mocked(useTournamentTimer).mockReturnValue({
      tournament: payload.tournament,
      remainingMs: payload.tournament ? 300_000 : null,
      fromCache: false,
      hasPendingWrites: false,
      lastSyncAt: payload.tournament ? Date.now() : null,
      error: payload.error ?? null,
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // subscribePlayers / subscribeTables は default で空リスト + cleanup を返す
    vi.mocked(subscribePlayers).mockImplementation((_tid, onNext) => {
      onNext([]);
      return () => {};
    });
    vi.mocked(subscribeTables).mockImplementation((_tid, onNext) => {
      onNext([]);
      return () => {};
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("SpectateClient", () => {
    it("tournament が null のとき『読込中…』を表示する", () => {
      setTimerMock({ tournament: null });
      render(<SpectateClient tid="t1" />);
      expect(screen.getByText("読込中…")).toBeInTheDocument();
    });

    it("spectateEnabled=false のとき『観戦が公開されていません』を表示する", () => {
      setTimerMock({ tournament: makeTournament({ spectateEnabled: false }) });
      render(<SpectateClient tid="t1" />);
      expect(screen.getByText("観戦が公開されていません")).toBeInTheDocument();
    });

    it("spectateEnabled=true / running のときタイマー + late entry banner を表示する", () => {
      setTimerMock({ tournament: makeTournament({ currentLevel: 2 }) });
      render(<SpectateClient tid="t1" />);
      expect(screen.getByText("Spectate Tournament")).toBeInTheDocument();
      // TimerDisplay の Lv badge
      expect(screen.getByText(/Lv\s*2/)).toBeInTheDocument();
      // late entry open banner
      expect(screen.getByTestId("spectate-late-entry-open")).toBeInTheDocument();
    });

    it("currentLevel > lateEntryDeadlineLevel のとき『受付終了』banner を表示する", () => {
      setTimerMock({ tournament: makeTournament({ currentLevel: 4 }) });
      render(<SpectateClient tid="t1" />);
      expect(screen.getByTestId("spectate-late-entry-closed")).toBeInTheDocument();
    });

    it("state=finished のとき『終了しました』banner を表示する", () => {
      setTimerMock({ tournament: makeTournament({ state: "finished" }) });
      render(<SpectateClient tid="t1" />);
      expect(screen.getByText(/終了しました/)).toBeInTheDocument();
    });

    it("subscribePlayers が permission-denied で onError 発火 → 『観戦が終了しました』に遷移する", async () => {
      setTimerMock({ tournament: makeTournament() });
      // subscribePlayers が登録される瞬間に anon 経由で permission-denied を発火させる
      vi.mocked(subscribePlayers).mockImplementation((_tid, _onNext, onError) => {
        // FirebaseError 風（code を持つ object）を AppError でラップして渡す
        const inner = Object.assign(new Error("PERMISSION_DENIED"), {
          code: "permission-denied",
        });
        onError(AppError.from(inner, "firestore/subscribe_failed", "参加者購読エラー"));
        return () => {};
      });
      render(<SpectateClient tid="t1" />);
      await waitFor(() =>
        expect(screen.getByText("観戦が終了しました")).toBeInTheDocument(),
      );
    });

    it("useTournamentTimer の error が permission-denied のとき 『観戦が終了しました』に遷移する", async () => {
      const inner = Object.assign(new Error("PERMISSION_DENIED"), {
        code: "permission-denied",
      });
      setTimerMock({
        tournament: null,
        error: AppError.from(inner, "firestore/subscribe_failed", "購読エラー"),
      });
      render(<SpectateClient tid="t1" />);
      await waitFor(() =>
        expect(screen.getByText("観戦が終了しました")).toBeInTheDocument(),
      );
    });

    it("permission-denied 以外の subscribe error は『観戦が終了しました』に遷移しない（『読込中』を維持）", async () => {
      setTimerMock({ tournament: null });
      vi.mocked(subscribePlayers).mockImplementation((_tid, _onNext, onError) => {
        // unavailable 等は spectate-OFF とは無関係なので無視（loading 継続）
        const inner = Object.assign(new Error("UNAVAILABLE"), { code: "unavailable" });
        onError(AppError.from(inner, "firestore/subscribe_failed", "参加者購読エラー"));
        return () => {};
      });
      render(<SpectateClient tid="t1" />);
      // 一定時間待っても spectateEnded に遷移しないことを確認
      expect(screen.getByText("読込中…")).toBeInTheDocument();
      await new Promise((r) => setTimeout(r, 0));
      expect(screen.queryByText("観戦が終了しました")).not.toBeInTheDocument();
    });
  });
  ```
- **MIRROR**: TEST_MOCK_BOUNDARY（[src/app/tournaments/[tid]/live/live-client.test.tsx:1-110](../../../../src/app/tournaments/[tid]/live/live-client.test.tsx#L1-L110)）。差分は auth 系 mock の全削除（4 個 → 4 個）と spectate 固有 case の追加
- **IMPORTS**: vitest / RTL / `AppError` / 各 schema 型 / spectate-client
- **GOTCHA**:
  - `AppError.from(inner, ...)` の `inner` が `code` プロパティを持つ object だと `getErrorCode(err.cause)` がそれを返す（[src/lib/errors.ts:47-58](../../../../src/lib/errors.ts#L47-L58)）。FirebaseError を直接 import せず Object.assign でも OK
  - 他 component（TimerDisplay / PlayersCard 等）は **mock せず実 component を render**する。これにより render 経路全体（aria-label / data-testid / 文言）が integrated に検証される
  - `useTournamentTimer` mock は object 全フィールド（tournament / remainingMs / fromCache / hasPendingWrites / lastSyncAt / error）を必ず返す。fromCache / hasPendingWrites を default false にすると OfflineBanner が render されない（無害）
  - subscribePlayers の signature は `(tid, onNext, onError) => unsub`。mockImplementation で 3 引数すべて受ける
  - 既存 `live-client.test.tsx` は `useAuthUser` を mock して isAnonymous を false に倒すが、spectate-client は読まないため mock 自体不要。**もし誤って `useAuthUser` を呼ぶ実装に regression したら test 環境で AuthProvider が無いため throw → red になる**。これが negative test として効く
  - `spectateEnabled: true` を fixture default に置くことで「通常 case で 1 行 override 不要」になる
- **VALIDATE**:
  - `npm run test -- spectate-client` で全 8 ケース pass
  - `npm run test` 全体で regression なし

### Task 7: 規約ドキュメント更新（Phase 1 review LOW-3 消化）

- **ACTION**: [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) の「Phase 2.5 以降の注意: `get()` による参照は rule read を消費」セクション末尾に観戦経路の rule read コストを 1〜2 行追記
- **IMPLEMENT**:
  ```md
  ## Phase 2.5 以降の注意: `get()` による参照は rule read を消費
  ...（既存）...

  ### Phase 2 (04-spectate-mode): 観戦経路の rule read 消費

  `/spectate/[tid]` の `subscribePlayers(tid)` / `subscribeTables(tid)` は anon でも通すために、
  各 doc の rule 評価で `exists() + get()` で親 tournament の `spectateEnabled` を毎回参照する。
  20 人 × 6 卓規模では、初回 listen 時に players 20 件 + tables 6 件 = 26 件の rule 評価が走り、
  各 1 read（同一 rule 評価内では Firebase が path をキャッシュ）。snapshot 更新のたびに同様の
  cost が発生する。会場規模では無視できるが、不特定多数公開を想定する将来 PRD では再評価する。
  ```
- **MIRROR**: 既存の Phase 2.5 注意セクションの追記スタイル
- **GOTCHA**:
  - 完全な数字（"26 件"）は repo の MoSCoW（6 テーブル / 20 人）に揃える。将来上限変更時は drift 候補なので参考値として書く
  - rule 自体の改修は **Phase 1 で完了済**。本 Phase は docs 補強のみ
- **VALIDATE**: 規約ドキュメント差分のレビューで「観戦経路の rule read コストが 1 段落追記されている」を確認

### Task 8: Phase 1 review LOW-1 / LOW-2 への確認 / TODO 引継ぎ

- **ACTION**: 本 plan を実装する前に [.claude/PRPs/04-spectate-mode/reviews/local-phase-1-review.md](../reviews/local-phase-1-review.md) の LOW-1（rule 経路 A 包含）/ LOW-2（owner-delete validator 追加）を確認し、Phase 2 で対応するか / Phase 3 / 4 に積むかを実装着手時に判断する
- **IMPLEMENT**: 判断結果を Phase 2 報告（reports/phase-2-...-report.md）の「Code Review 反映」節に記録する
  - LOW-1（経路 B が経路 A に包含）: Phase 3 で `setSpectateEnabled` service が確定すれば「経路 A を狭める」検討が可能になる。Phase 2 では **対応しない**（service 不在で意味がない）
  - LOW-2（owner-delete validator）: rule 動作確認の純改善。Phase 2 / 3 / 4 のいずれでも 1 ケース追加するだけのため**任意**。Phase 2 では **対応しない**（spectate 表示の本筋から外れる）
  - LOW-3（観戦経路 read コスト docs）: **Task 7 で対応**
- **MIRROR**: Phase 1 report の「Code Review 反映」節の構造
- **GOTCHA**: review 記録は immutable（PRD の Decisions Log と同様）。Phase 2 着手時点で未対応 LOW を放置するなら必ず後続 Phase に積む（review に明記済み）
- **VALIDATE**: Phase 2 完了時の report に LOW-3 のみ消化、LOW-1 / LOW-2 は Phase 3 / 4 引継ぎを記録

---

## Testing Strategy

### Unit Tests（Task 6 で投入）

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| 読込中表示 | `tournament=null` | "読込中…" 表示 | initial subscribe 未 fire |
| 未公開表示 | `tournament.spectateEnabled=false` | "観戦が公開されていません" | rule defense-in-depth（rule で deny されるが安全網） |
| 通常表示 + late entry open | `currentLevel <= deadline` | tournament name / TimerDisplay / `[spectate-late-entry-open]` 全部表示 | running の典型 case |
| late entry closed | `currentLevel > deadline` | `[spectate-late-entry-closed]` banner | レイトレジ締切超過の境界 |
| state=finished | `state="finished"` | "終了しました" banner | finished UX |
| subscribe permission-denied | `onError(AppError(cause: { code: "permission-denied" }))` | "観戦が終了しました" に遷移 | spectate OFF 観測の最重要 case |
| timer error permission-denied | `useTournamentTimer.error` が permission-denied | "観戦が終了しました" に遷移 | timer 経路でも graceful 化 |
| 他の subscribe error | `code: "unavailable"` | "観戦が終了しました" に遷移**しない**（loading 維持） | false positive 防止 |

### Edge Cases Checklist

- [x] **tournament null（subscribe 未 fire）** — Task 2 guard で「読込中…」
- [x] **spectateEnabled=false / 不在** — Task 2 guard で「観戦が公開されていません」（rule + UI 二重防御）
- [x] **subscribe permission-denied** — Task 2 graceful handling で「観戦が終了しました」
- [x] **state ごとの late entry banner** — Task 3 で 4 分岐すべて
- [x] **players 空（subscribe fire 直後）** — PlayersCard / AverageStackCard が render skip（既存実装の挙動）
- [x] **tables 空（setup 中）** — SeatingBoard が「テーブルがまだありません（席決め前）。」を表示（既存挙動）
- [x] **既存 `/live` への副作用なし** — Task 全体で `/live` の DOM / ロジックを編集しない
- [ ] **完全 unauthenticated 状態のブラウザ実機** — Manual Validation で Vercel preview / 実機検証（後述）
- [ ] **Phase 3 の toggle UI と統合した E2E** — **本 Phase scope 外**。Phase 2+3 マージ後に PRP plan を別途作成（または Phase 3 plan に E2E spec を含める）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: 0 type errors。`spectate-client.tsx` は既存型のみ使用、新規 type 定義なし。

```bash
npm run lint
```

EXPECT: 0 lint errors / warnings。`console.*` 直呼び禁止規約に該当する記述は無し（`logger.warn` 経由）。

### Unit Tests

```bash
npm run test -- spectate-client
```

EXPECT: 8 ケース pass（Task 6 で定義）

```bash
npm run test
```

EXPECT: 既存全 unit test が green（spectate-client 追加分のみ増、live-client.test.tsx 等への影響なし）。

### Build Validation

```bash
npm run build
```

EXPECT: Next.js build が `/spectate/[tid]` を **dynamic route** として登録し通過する。Server Component の async params が正しく処理される。

### Emulator Rule Validation（回帰確認）

```bash
npm run test:rules-spectate
```

EXPECT: Phase 1 で投入した 16 ケースが引き続き green。本 Phase は rule を触らないため変化しない（回帰検出のため必ず実行）。

```bash
npm run test:rules-limits
npm run test:rules-clone-players
npm run test:rules-season
npm run test:rules-season-points-rule
npm run test:rules-table-labels
```

EXPECT: 全 green（回帰確認）。

### Manual Validation（Vercel preview / ローカル emulator）

ローカル emulator を使う場合（実装中）:

```bash
# terminal A
firebase emulators:start --only auth,firestore

# terminal B
npm run dev
```

1. `npm run dev` 起動済 + emulator 起動済 + `tests/e2e/fixtures/flows.ts` の `seedOrganizerTournament` を手動実行（または既存 organizer アカウントで dashboard から作成）
2. organizer 経由で Firestore Console / `firebase emulators:exec --only firestore "node -e '...'"` 等で `tournaments/{tid}.spectateEnabled = true` を直接 set（**Phase 3 の toggle UI が未実装のため**）
3. **新たな incognito window**（auth 不持ち）で `/spectate/{tid}` を開く
4. 確認:
   - [ ] tournament name が header に表示される
   - [ ] TimerDisplay が描画される（Lv badge / 残時間 / SB / BB / Ante）
   - [ ] late entry banner が currentLevel に応じて green / amber / muted 切替する
   - [ ] PlayersCard / AverageStackCard / NextBreakCard / StructureSnapshotCard 全部表示される
   - [ ] SeatingBoard が read-only で描画される（PD checkbox / D&D handle / ✎ ボタン全部不在）
   - [ ] **DevTools Console に permission-denied error が出ない**（rule が通っている確認）
   - [ ] 別 incognito で organizer がログイン → toggle OFF（Phase 3 未実装なら REST 直叩き）→ 観戦タブが「観戦が終了しました」に遷移する
   - [ ] state を finished に遷移させ、「終了しました」banner が表示される

Vercel preview deploy を使う場合（PR 作成後）:

1. PR 番号の preview URL を確認
2. 実機（iPad / Android スマホ）で完全ログアウト状態で `/spectate/{tid}` を開く
3. 上記チェック項目を再検証
4. PWA 対応は **Phase 4 で別途**実装するため、Phase 2 単体ではオフライン機能は対象外（オンライン状態で動作確認のみ）

> ⚠ 重要: 本 Phase 単体では **toggle UI が未実装**のため、E2E spec を投入しない判断（Testing Strategy 参照）。Phase 3 着手時に `/spectate` E2E spec を Phase 3 plan / 統合 PR に含める想定。

---

## Acceptance Criteria

- [ ] [src/app/spectate/[tid]/page.tsx](../../../../src/app/spectate/[tid]/page.tsx) が新規作成され、`RequireAuth` を使わず `<SpectateClient tid={tid} />` のみ返す
- [ ] [src/app/spectate/[tid]/spectate-client.tsx](../../../../src/app/spectate/[tid]/spectate-client.tsx) が新規作成され、`useAuthUser` / `useCurrentGroup` / `useGroupRole` / `RequireAuth` のいずれも import / 呼出していない
- [ ] guard ladder の 4 段（spectate ended / loading / not-public / 通常）が全 unit test ケースで観測される
- [ ] tournament name / OfflineBanner / ConnectionBadge / TimerDisplay / late entry banner / PlayersCard / AverageStackCard / NextBreakCard / StructureSnapshotCard / SeatingBoard の全 9 要素が render される
- [ ] late entry banner の 4 文言（受付準備中 / 受付中 / 受付終了 / 終了しました）が state + currentLevel + lateEntryDeadlineLevel に応じて切替する
- [ ] subscribe error の `permission-denied`（cause 経由）を検知して「観戦が終了しました」に倒す
- [ ] `permission-denied` 以外の subscribe error は graceful handling せず loading を維持する（false positive 防止）
- [ ] [src/app/spectate/[tid]/spectate-client.test.tsx](../../../../src/app/spectate/[tid]/spectate-client.test.tsx) が 8 ケース全 green
- [ ] `npm run typecheck` / `npm run lint` / `npm run test` / `npm run build` すべて 0 errors
- [ ] 既存 `test:rules-spectate` 含む全 emulator validator が引き続き green
- [ ] [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) に観戦経路の rule read 消費に関する 1 段落追記
- [ ] 既存 `/live` の DOM / ロジック / test を一切変更していない（diff で確認）
- [ ] Manual Validation チェックリスト（Vercel preview / ローカル emulator）の全項目を完了

## Completion Checklist

- [ ] `console.*` を直接呼んでいない（`logger.warn` 経由）
- [ ] `try { ... } catch (e) { /* swallow */ }` を書いていない（[error-logging.md](../../../rules/error-logging.md) 規約）
- [ ] AppError ラップは新規導入しない（subscribe API が既に wrap 済。`getErrorCode(err.cause)` で内側 code を取り出すのみ）
- [ ] `e instanceof Error && "code" in e` の手書き型ガード禁止（[error-logging.md](../../../rules/error-logging.md) 「禁止パターン」）— `getErrorCode` を使う
- [ ] PRD Phase ラベル付きの docblock コメントを各新規ファイル先頭に配置（"Phase 2 (04-spectate-mode):" prefix）
- [ ] 規約 docs（firebase-patterns.md）の追記が Phase 1 review LOW-3 の文言と整合
- [ ] Phase 3 / 4 が本 plan に依存する **API surface（`SpectateClient(tid)` の prop）が確定**している（pure ファイルパス参照のみで他 phase からの import なし）
- [ ] 自己完結 — Phase 3 / 4 着手者がさらなる質問なしに parallel 着手できる

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `useTournamentTimer` 内部が `useAuthUser` を呼ぶ regression を将来入れる | L | H | Mandatory Reading で確認済（[useTournamentTimer.ts:1-143](../../../../src/lib/hooks/useTournamentTimer.ts#L1-L143)）。spectate-client.test.tsx で `useAuthUser` mock を**敢えて削除**することで auth provider 不在環境を作り、もし呼んだら test 環境で throw → red になる negative test として機能 |
| `permission-denied` 以外の error も spectateEnded に倒してしまう false positive | M | M | unit test で「unavailable などは loading 維持」を assert（Task 6 の最後ケース）。`getErrorCode(err.cause) === "permission-denied"` の strict 一致のみ |
| spectate-client が GroupProvider の context を読まずとも、AppShell 経由で side effect を起こす（subscribeTournamentsByGroup が anon で fail） | L | L | PrimaryNav は `currentGroupId !== null` のときのみ subscribe。anon ユーザーは `groups=[]` / `currentGroupId=null` で空配信されるため subscribe しない（[src/lib/services/current-group.tsx:138-148](../../../../src/lib/services/current-group.tsx#L138-L148)） |
| Phase 3 toggle 不在で E2E spec を Phase 2 単独投入できない | M | L | Phase 2 では unit + manual validation で代替。E2E は Phase 3 plan / 統合 PR で扱う旨を Testing Strategy に明記 |
| TimerDisplay / PlayersCard 等の既存 component が auth context を期待する hidden coupling | L | M | Mandatory Reading で全 component が pure（auth 非依存）であることを確認。`AuthProvider` は root layout で mount されるため、もし内部で `useAuthUser` を呼んでも throw しない（user=null/loading=true 経路） |
| Vercel preview で `/spectate/{tid}` が anon で 401 / permission-denied となる（rule deploy 漏れ） | M | H | **Phase 1 完了報告で `firebase deploy --only firestore:rules` 必須化済**（メモリ規約）。本 Phase 着手前に rule deploy 完了を確認 |
| `tournament.lateEntryDeadlineLevel` が 0 / null（schema 違反 doc） | L | L | schema は `z.number().int().positive()` で 1+ を強制。converter で reject される。banner の `>` 比較も整数前提 |
| AppShell sidebar が anon ユーザーで render されると noisy（kiosk UX の劣化） | M | L | Phase 2 scope 外と PRD で確認済（NOT Building）。観戦経路は機能優先で chrome 抑制は将来 polish に積む |
| 同一 tournament の `/live` と `/spectate` を平行で開いた運営者でタイマー表示が乖離する | L | L | 両 page とも同一 `subscribeTournament` 経由で `onSnapshot` 駆動。fromCache / hasPendingWrites の状態は別 client で独立だが、payload 自体は同一 doc のため値の乖離は起きない |
| 大量の tables / players（将来上限緩和） | L | L | 現在の MoSCoW（20 人 / 6 卓）では SeatingBoard が `grid-cols-3` で問題なく描画される。20+ 卓のケースは別 PRD の課題 |

## Notes

- **Phase 2 / 3 / 4 は parallel 設計**だが、graceful handling テストは Phase 3 toggle UI に依存するため E2E は **Phase 2+3 統合**で扱う（Risk 表参照）。Phase 2 単体では unit test + manual validation で必要十分
- **`/live` 不変原則**: Phase 2 で `/live` の DOM / ロジック / test を**一切編集しない**。spectate と live は独立進化。共通 component（TimerDisplay / SeatingBoard 等）は read-only で再利用するのみ
- **規約 docs 追記**は Phase 1 review LOW-3 の消化を兼ねる。LOW-1（rule 経路 B 包含）/ LOW-2（owner-delete validator）は Phase 3 / 4 で対応する旨を Phase 2 report に記録（Task 8）
- **kiosk-style chrome 抑制**は **本 Phase scope 外**（NOT Building 参照）。AppShell sidebar / root header の path-aware 非表示は将来 polish
- **Web Share API / OG image / Wake Lock**: いずれも本 Phase scope 外。Web Share は `02-season-stats-and-share` Phase D で確立済の `ShareCardButton` パターンが流用可能だが、観戦 URL は `share` ではなく `copy` 想定（Phase 3 のスコープ）
- **PRD Phase 進捗表 (#2)** は本 plan link を埋めて `pending` → `in-progress` に遷移させる（Output 節参照）
- **本 plan の所要時間目安**: 4 ファイル × 平均 100 行 = ~400 行の新規コード。実装 + テスト + 手動検証で **6〜10 時間**規模（Medium 妥当）
