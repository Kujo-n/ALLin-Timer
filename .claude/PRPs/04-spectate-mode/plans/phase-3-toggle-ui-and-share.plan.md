# Plan: Phase 3 — Toggle UI + 共有導線（dashboard）

## Summary

Phase 1 で確立した `tournaments/{tid}.spectateEnabled` 基盤の上に、owner / organizer 限定の **opt-in toggle UI**（確認 dialog 付き） / 観戦 URL コピー / QR コード表示を **SpectateModeCard** として dashboard に追加し、tournament 一覧に「観戦公開中」 badge を出す。書込経路は Phase 1 で空けてある broad organizer update 経路を使い、新規に `setSpectateEnabled` service と `updateSpectateEnabled` repository を追加して Phase 1 と同じ二重防御（rule + service）を成立させる。Phase 2（`/spectate/[tid]` ページ）は本 plan の SCOPE 外で並列着手可能。

## User Story

As a **owner / organizer ロールのサークル運営者**, I want **dashboard で観戦モードを 1 操作で ON / OFF でき、URL とコピーボタンと QR コードがその場で見える**, so that **会場の予備モニタへの投影と遅刻参加者へのリンク共有が、ダッシュボードを離れずに完結する**。

副次的に、tournament 一覧で「観戦公開中」 badge を一目で確認できることで、**過去 tournament を ON のまま放置している誤公開リスクを検知**できる。

## Problem → Solution

**Current state**: Phase 1 完了で `tournaments/{tid}.spectateEnabled` のスキーマと rule は揃っているが、**書込経路が UI から開いていない**。`updateTournament` の broad organizer 経路で技術的には書けるが、確認 dialog / role gating / 観戦 URL の生成と共有導線が一切無く、運営者は「観戦モードを ON にする方法が無い」状態。tournament 一覧でも公開中かどうかを判別できない。

**Desired state**: dashboard に **SpectateModeCard** が常駐し、owner / organizer のみ toggle が見える。toggle ON 時には「URL を知る人は誰でも閲覧可能になります」を含む確認 dialog が必ず挟まる。確認後の ON 状態では **観戦 URL の フル URL 表示 + URL コピーボタン + QR コード** が即座に見える。tournament 一覧では `spectateEnabled === true` の tournament に「観戦公開中」badge が出る。書込は新規 `setSpectateEnabled` service → `updateSpectateEnabled` repository → `wrapFirestoreWrite` 経由で行い、Firestore Rules + service 層の二重防御で member の書込を deny する。

## Metadata

- **Complexity**: **Medium**
- **Source PRD**: [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md)
- **PRD Phase**: Phase 3 — Toggle UI + 共有導線（dashboard）
- **Estimated Files**: 8 ファイル（service / repository / 既存 service test / 既存 repository test / 新規 component / 新規 component test / dashboard-client UPDATE / tournaments-client UPDATE / qr 共通 helper UPDATE）

---

## UX Design

### Before

```
┌── /tournaments/{tid} (dashboard) ───────────────────────────┐
│ [name header]                                              │
│ ┌──────┐ ┌────────────┐ ┌──────────┐                       │
│ │ QR   │ │  Timer     │ │ Stats×3  │                       │
│ │ panel│ │  Controls  │ │ cards    │                       │
│ └──────┘ └────────────┘ └──────────┘                       │
│ ┌─ BalancingInstruction ─┐ ┌─ SeatingBoard ─┐              │
│ └────────────────────────┘ └─────────────────┘             │
│ ┌─ PlayerList ─┐ ┌─ StructureSnapshotCard ─┐               │
│ └──────────────┘ └─────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
（観戦モードを ON にする UI が一切無い。spectateEnabled は schema 上の死蔵 field）

┌── /tournaments （一覧） ──────────────────────────────────────┐
│ Card: 月例 — [進行中] / 締切 Lv 6                            │
│ Card: 先月分 — [終了]                                         │
└─────────────────────────────────────────────────────────────┘
（公開中の tournament を見分ける手段が無い）
```

### After

```
┌── /tournaments/{tid} (dashboard) ───────────────────────────┐
│ [name header]                                              │
│ ┌──────┐ ┌────────────┐ ┌──────────┐                       │
│ │ QR   │ │  Timer     │ │ Stats×3  │                       │
│ └──────┘ └────────────┘ └──────────┘                       │
│ ┌── SpectateModeCard (owner/organizer only) ───────────┐    │
│ │ 観戦モード               [Toggle: OFF]                │    │
│ │ URL を知る人は誰でも閲覧できます。member には toggle │    │
│ │ 自体が見えません。                                    │    │
│ │                                                      │    │
│ │ ─ ON 時のみ ─                                         │    │
│ │ https://allin-timer.example/spectate/{tid}            │    │
│ │ [URL をコピー] [QR コードを表示] ←開閉                │    │
│ │   ┌───────────┐                                       │    │
│ │   │  ▩ ▩ ▩ ▩  │ (QR 224×224, value=spectate URL)     │    │
│ │   │  ▩ ▩ ▩ ▩  │                                       │    │
│ │   └───────────┘                                       │    │
│ └──────────────────────────────────────────────────────┘    │
│ ┌─ Balancing ─┐ ┌─ SeatingBoard ─┐ ...                     │
└─────────────────────────────────────────────────────────────┘

[Toggle ON クリック時]
┌── Dialog ────────────────────────────────────────┐
│ 観戦モードを ON にしますか？                       │
│                                                 │
│ URL を知る人は誰でも、ログイン無しで              │
│ タイマー・席表・残人数・displayName を閲覧        │
│ できるようになります。                            │
│                                                 │
│ 過去の対戦履歴 / メールアドレスは公開されません。 │
│                                                 │
│           [キャンセル] [ON にする]                │
└─────────────────────────────────────────────────┘

┌── /tournaments （一覧） ──────────────────────────────────────┐
│ Card: 月例 — [進行中] [観戦公開中] / 締切 Lv 6              │
│ Card: 先月分 — [終了] [観戦公開中]                            │
│ Card: その前 — [終了]                                         │
└─────────────────────────────────────────────────────────────┘
（public な tournament を一目で識別できる。誤公開放置の検知に利く）
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| dashboard / `tournaments/[tid]` | 観戦モード関連 UI なし | `SpectateModeCard` 常駐（owner/organizer のみ表示） | member には card 自体を render しない |
| toggle ON クリック | 該当する操作なし | 確認 dialog → Confirm で `setSpectateEnabled` 呼出 → 成功 toast | role gate + 確認 dialog で誤公開防止 |
| toggle OFF クリック | 該当する操作なし | 確認 dialog **なし**で即 OFF | OFF は誤操作してもダメージ無し（誤公開のリスクが生じない方向） |
| ON 中の UI | — | フル URL 表示 + コピーボタン + QR コード | 既存 `QrPanel` のパターンを踏襲 |
| `/tournaments`（一覧） | 状態 badge 1 つのみ | `spectateEnabled === true` のとき「観戦公開中」 badge を additive 追加 | 既存の `toneForState` を壊さず、独立 badge を後ろに連結 |
| member のロール挙動 | — | toggle UI 自体が見えない（rule deny + UI gate の二重防御） | 既存 `useGroupRole` で gate |

---

## Mandatory Reading

実装前に必ず読むべきファイル。`Patterns to Mirror` で具体コード snippet を示しているため、ここはなぜ読むかの why に集約。

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/prds/04-spectate-mode.prd.md](../prds/04-spectate-mode.prd.md) | all | Phase 3 の MVP scope（toggle / 確認 dialog / URL コピー / QR / 一覧 badge / role gate）と Won't 項目 |
| P0 (critical) | [.claude/PRPs/04-spectate-mode/plans/completed/phase-1-schema-rule-emulator.plan.md](completed/phase-1-schema-rule-emulator.plan.md) | all | Phase 1 で確立した rule / schema の前提。「broad organizer update 経路で書ける（経路 A）」「単独書換経路 B も用意済み」の前提を理解する |
| P0 (critical) | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | 権限マトリクス + Phase 1 (04-spectate-mode) 節 | role gate（owner / organizer）を正しく作るための真実源 |
| P0 (critical) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | repository wrap helper / 数値リミット / 単独フィールド rule | `wrapFirestoreWrite` 経由 / `tournaments` schema の DRIFT WARNING 順守 |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | エラー prefix `spectate/*` / `unwrapOrFrom` の使い分け | Phase 1 で登録済の prefix を Phase 3 で初使用する |
| P0 (critical) | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 313-366（`setFinishedTournamentCount` / `setDefaultSeatsPerTable`） | service 層の単独フィールド書換パターン。`setSpectateEnabled` の母型 |
| P0 (critical) | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 252-312（`updateFinishedTournamentCount` / `updateDefaultSeatsPerTable`） | repository 層の `wrapFirestoreWrite` パターン。`updateSpectateEnabled` の母型 |
| P0 (critical) | [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) | 全体（特に 36-69 / 161-223 / 290-561） | SpectateModeCard を挿入する場所、`useGroupRole` / `unwrapOrFrom` の既存使い回し |
| P0 (critical) | [src/app/tournaments/tournaments-client.tsx](../../../../src/app/tournaments/tournaments-client.tsx) | 全体 | 一覧 badge を追加する場所、`toneForState` の既存パターン |
| P1 (important) | [src/components/qr/QrPanel.tsx](../../../../src/components/qr/QrPanel.tsx) | 全体 | 観戦 URL コピー + QR の既存実装。`SpectateModeCard` で同パターンを使う |
| P1 (important) | [src/app/groups/[gid]/_components/InviteCodeCard.tsx](../../../../src/app/groups/[gid]/_components/InviteCodeCard.tsx) | 全体 | clipboard fail 時の `onCopyError` callback パターン |
| P1 (important) | [src/app/groups/[gid]/_components/StartSeasonDialog.tsx](../../../../src/app/groups/[gid]/_components/StartSeasonDialog.tsx) | 全体 | 確認 dialog の「open / onOpenChange / onConfirm / working」パターン |
| P1 (important) | [src/lib/services/qr.ts](../../../../src/lib/services/qr.ts) | 全体（3 行） | `buildJoinUrl` の対称として `buildSpectateUrl` をここに追加する |
| P1 (important) | [src/lib/firebase/repositories/groups.test.ts](../../../../src/lib/firebase/repositories/groups.test.ts) | 171-205（`updateDefaultSeatsPerTable` 群） | repository test の SDK mock 形式 |
| P1 (important) | [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | 454-573（`setFinishedTournamentCount` / `setDefaultSeatsPerTable` 群） | service test で `assertOrganizer` を mock する形式 |
| P1 (important) | [src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx) | 全体 | RTL + characterization test の既存パターン（aria-label 規約 / fireEvent / act） |
| P2 (reference) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 1-50 / 145-175 / 226-239 | tournaments repository の collection ref / `wrapFirestoreWrite` 経由のパターン。`updateSpectateEnabled` を tournaments repository に置く |
| P2 (reference) | [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | 1-135 | tournaments repository test の SDK mock 形 + `makeTournament` factory（spectateEnabled 既に含まれる） |
| P2 (reference) | [src/lib/hooks/useGroupRole.ts](../../../../src/lib/hooks/useGroupRole.ts) | 全体（41 行） | dashboard / tournaments-client から role gate を引く正解パス |

## External Documentation

外部ドキュメント参照は不要。`qrcode.react@4.2.0` は package.json:42 で既に依存に入っており、`QRCodeSVG` の使い方は [src/components/qr/QrPanel.tsx](../../../../src/components/qr/QrPanel.tsx) と [src/app/groups/[gid]/_components/InviteCodeCard.tsx](../../../../src/app/groups/[gid]/_components/InviteCodeCard.tsx) に既存先例あり。Web Clipboard API（`navigator.clipboard.writeText`）の例外ハンドリングも同 2 ファイルにパターンあり。新規ライブラリ追加は **不要**。

> **No external research needed** — feature uses established internal patterns (`wrapFirestoreWrite` / `useGroupRole` / `QRCodeSVG` / Dialog primitives）.

---

## Patterns to Mirror

### NAMING_CONVENTION（service / repository の対称命名）

```ts
// SOURCE: src/lib/services/group.ts:343-366
export async function setDefaultSeatsPerTable({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  // ...validate...
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultSeatsPerTable(gid, value);
  logger.info("setDefaultSeatsPerTable ok", { gid, uid, value });
}
```

`setSpectateEnabled` も完全同型: 引数 `{ tid, uid, gid, value }`、返り値 `Promise<void>`、内部で role check → repository 呼出 → `logger.info`。`gid` は引数で受けるが、二重防御として `getTournament(tid).groupId` を fetch して **rule とまったく同じ判定**（`isOrganizer(tournament.groupId)`）を行う。引数 `gid` を信頼せず tournament doc 経由で再評価することで、UI が誤った gid を渡しても弾く。

### NAMING_CONVENTION（repository — single-field update）

```ts
// SOURCE: src/lib/firebase/repositories/groups.ts:289-312
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

`updateSpectateEnabled` も同型。違い:
- 第 1 引数は `tid: string`（`groupDocRef` ではなく `doc(tournamentsRef, tid)`）
- 値は `boolean`（`typeof value === "boolean"` で検証）
- patch には `updatedAt: serverTimestamp()` を含める（Phase 1 rule の経路 B が `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt'])` で `updatedAt` を許可キーに含めているため、慣習に揃える）

### REPOSITORY_PATTERN（tournaments の wrap）

```ts
// SOURCE: src/lib/firebase/repositories/tournaments.ts:226-239
export async function updateTournament(tid: string, patch: UpdateTournamentInput): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "トーナメント更新に失敗しました",
    async () => {
      await updateDoc(doc(tournamentsRef, tid), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    },
    { tid },
  );
  logger.info("tournament update ok", { tid });
}
```

`updateSpectateEnabled` はこれの「単独 boolean field 版」。patch shape は `{ spectateEnabled: value, updatedAt: serverTimestamp() }`。`tournamentsRef` は同 file 67-69 で既に converter 付きで宣言済みのため再利用。

### ERROR_HANDLING（service 層 — assertOrganizer 経由）

```ts
// SOURCE: src/lib/services/group.ts:214-218
function assertOrganizer(group: GroupDoc, uid: string): void {
  if (!group.organizerUids.includes(uid)) {
    throw new AppError("運営のみ実行できます", "group/not-organizer");
  }
}
```

Phase 3 では tournament 経由なので新たに `assertTournamentOrganizer(tournament, group, uid)` を作るのではなく、**既存 `assertOrganizer` の引数に tournament の groupId 経由で取得した group を渡す**形で再利用する（新規 helper を増やさない方針）。

### COMPONENT_PATTERN（クリップボード copy + QR の card 構造）

```tsx
// SOURCE: src/components/qr/QrPanel.tsx:30-77
async function onCopy() {
  if (!url) return;
  try {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  } catch (e) {
    logger.warn("clipboard copy failed", {
      code: "clipboard/unavailable",
      message: e instanceof Error ? e.message : String(e),
    });
  }
}

return (
  <Card className={className}>
    <CardHeader>
      <CardTitle>参加者向け受付 URL</CardTitle>
    </CardHeader>
    <CardContent className="space-y-4">
      {url ? (
        <>
          <div className="flex justify-center rounded-md border bg-white p-4">
            <QRCodeSVG value={url} size={224} />
          </div>
          <div className="space-y-2">
            <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{url}</p>
            <Button variant="outline" size="sm" onClick={onCopy}>
              {copied ? "コピーしました" : "URL をコピー"}
            </Button>
          </div>
        </>
      ) : null}
    </CardContent>
  </Card>
);
```

`SpectateModeCard` の ON 状態の UI はこれの完全踏襲。違いは:
- toggle ON / OFF を切り替える `<input type="checkbox">` または `<Button>` を `CardHeader` の右側に配置
- ON 時のみ URL / コピー / QR を render
- `aria-label="観戦 URL の QR コード"`（InviteCodeCard と同方針）

### DIALOG_PATTERN（確認 dialog）

```tsx
// SOURCE: src/app/groups/[gid]/_components/StartSeasonDialog.tsx:19-55
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

`SpectateModeCard` 内部に `<Dialog>` を直接インライン配置する（`StartSeasonDialog` のような独立 export は不要 — 1 箇所からしか使わないため）。

### ROLE_GATE_PATTERN

```tsx
// SOURCE: src/app/tournaments/[tid]/dashboard-client.tsx:163, 256-258
const { group: tournamentGroup, role: myRole } = useGroupRole(data?.groupId);
// ...
const isOrganizer = isOrganizerRole(myRole);
if (groupsLoading || !isOrganizer) {
  return <main ...>読込中…</main>;
}
```

Phase 3 では dashboard 自体が既に organizer-only に redirect されている前提があるため、`SpectateModeCard` は常に organizer 以上の context で render される。それでも防御として card 内部で `if (!isOrganizerRole(role)) return null` を最終ラインに置く（Phase 4.6 の二重防御原則踏襲）。

tournament 一覧 (`tournaments-client.tsx`) は member ロールでも開けるため、badge は **role に関わらず表示**する（観戦公開中という事実は member にも見せる仕様）。

### LIST_BADGE_PATTERN

```tsx
// SOURCE: src/app/tournaments/tournaments-client.tsx:24-63, 146-160
function toneForState(state: TournamentState): StateTone {
  switch (state) {
    case "running": return { ...badge: "bg-emerald-500/10 ...", label: "進行中", ... };
    // ...
  }
}

<CardDescription>
  <span className={cn("mr-2 rounded px-2 py-0.5 text-xs font-medium", tone.badge)}>
    {tone.label}
  </span>
  {/* ... */}
</CardDescription>
```

「観戦公開中」 badge は `toneForState` を壊さない方針で、`tone.label` の **隣に独立 span を additive 追加**する。色は青系（`bg-sky-500/10 text-sky-700 dark:text-sky-300`）で state badge と被らない。

### TEST_STRUCTURE（service / repository の vitest mock）

```ts
// SOURCE: src/lib/firebase/repositories/groups.test.ts (updateDefaultSeatsPerTable 群)
describe("updateDefaultSeatsPerTable", () => {
  it("calls updateDoc with { defaultSeatsPerTable: value } for valid integers in [2,10]", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateDefaultSeatsPerTable("g1", 6);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ defaultSeatsPerTable: 6 });
  });
  // boundary / invalid / firestore reject の各ケース
});
```

`updateSpectateEnabled` の test も同型: `updateDoc` を mock し、patch に `{ spectateEnabled: ..., updatedAt: ... }` が入ることを assert（`updatedAt` は `serverTimestamp()` の戻り値 sentinel `{ __op: "serverTimestamp" }` で expect）。

```ts
// SOURCE: src/lib/services/group.test.ts:454-513 (setFinishedTournamentCount 群)
it("rejects general member with group/not-organizer", async () => {
  vi.mocked(getGroup).mockResolvedValue(makeGroup({ ... }));
  await expect(setFinishedTournamentCount({ ..., uid: "uMember", value: 5 }))
    .rejects.toMatchObject({ code: "group/not-organizer" });
  expect(updateFinishedTournamentCount).not.toHaveBeenCalled();
});
```

`setSpectateEnabled` も同型 + 「`getTournament` も mock し `tournament.groupId` 経由で `getGroup` が呼ばれる」点を test で固定化する。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/lib/services/qr.ts](../../../../src/lib/services/qr.ts) | UPDATE | `buildSpectateUrl(tid)` を `buildJoinUrl` の隣に additive 追加（origin 取得ロジックの重複回避） |
| [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | UPDATE | `updateSpectateEnabled(tid, value)` を `updateTournament` の隣に additive 追加 |
| [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | UPDATE | `updateSpectateEnabled` 用の describe ブロックを追加 |
| [src/lib/services/tournament.ts](../../../../src/lib/services/tournament.ts) | CREATE | 新規 `setSpectateEnabled({ tid, uid, value })` service を新設。tournament 関連の service が今まで `tournament-clone.ts` / `tournament-state.ts` に分散していたため、本 phase で `tournament.ts` を作って `setSpectateEnabled` をそこに置く |
| [src/lib/services/tournament.test.ts](../../../../src/lib/services/tournament.test.ts) | CREATE | 新規 service の unit test |
| [src/components/tournament/SpectateModeCard.tsx](../../../../src/components/tournament/SpectateModeCard.tsx) | CREATE | 観戦モード toggle / 確認 dialog / URL コピー / QR を内包する Card |
| [src/components/tournament/SpectateModeCard.test.tsx](../../../../src/components/tournament/SpectateModeCard.test.tsx) | CREATE | RTL によるカード挙動の characterization test |
| [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) | UPDATE | `<SpectateModeCard tid={tid} ... />` を `StructureSnapshotCard` の前後に追加 |
| [src/app/tournaments/tournaments-client.tsx](../../../../src/app/tournaments/tournaments-client.tsx) | UPDATE | tournament カードに「観戦公開中」 badge を additive 追加 |

## NOT Building

Phase 3 のスコープ外（他 Phase / 別 PRD で実装）:

- **`/spectate/[tid]` page 本体** — Phase 2 のスコープ
- **PWA cache `/spectate` allowlist** — Phase 4 のスコープ
- **graceful handling（onSnapshot error）** — Phase 2 の `/spectate/[tid]` 内
- **`spectateCode`（短命 / revocable token）** — PRD「Won't」項目
- **uid 完全隠蔽** — PRD「Won't」項目
- **賞金構造表示** — PRD「Won't」項目
- **member 向け toggle 権限の解放** — PRD「Won't」項目（誤公開防止のため owner / organizer のみ）
- **`/spectate` からの参加導線 / 「参加する」 CTA** — PRD「Won't」項目（受付は既存 `/join/[tid]` に集約）
- **toggle 操作のテレメトリ送信** — Success Metrics は手動集計が前提（PRD § Success Metrics）
- **`structureTemplates` 経由の「次回も自動で観戦 ON にする」サークル設定** — Phase 3 では tournament 単位の opt-in に閉じる
- **rule 側の経路 A 狭め** — Phase 1 review LOW-1 で「将来検討」と記録済。Phase 3 では rule に手を入れない
- **`SpectateModeCard` を tournament-state（finished など）で disable** — toggle 自体は state を問わず可能とする（finished tournament でも観戦公開を続けたい運用がある）

---

## Step-by-Step Tasks

### Task 1: `buildSpectateUrl` を qr.ts に追加

- **ACTION**: [src/lib/services/qr.ts](../../../../src/lib/services/qr.ts) に `buildSpectateUrl(tid: string): string` を additive 追加
- **IMPLEMENT**:
  ```ts
  // 既存 buildJoinUrl の直下に置く。origin 取得ロジックは共通化のためローカル変数 + 関数で抽出。
  function safeOrigin(): string {
    return typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  }

  export function buildJoinUrl(tid: string): string {
    return new URL(`/join/${tid}`, safeOrigin()).toString();
  }

  export function buildSpectateUrl(tid: string): string {
    return new URL(`/spectate/${tid}`, safeOrigin()).toString();
  }
  ```
- **MIRROR**: NAMING_CONVENTION（既存 `buildJoinUrl` のシグネチャをそのまま）
- **IMPORTS**: なし（純粋 string 操作）
- **GOTCHA**:
  - `window.location.origin` は SSR で undefined のため、`typeof window !== "undefined"` の guard が必須（既存 `buildJoinUrl` の実装そのまま）
  - origin 取得の共通化により、Phase 2 の `/spectate/[tid]` ページが「絶対 URL を必要とする SEO meta / OG image」を生成する場合にも再利用できる
  - **`/spectate` path は Phase 2 の page route と完全一致**（`src/app/spectate/[tid]/page.tsx` を Phase 2 で作成予定）。Phase 3 時点では route 不在だが URL 文字列としては正しい
- **VALIDATE**:
  - `npm run typecheck` → 0 errors
  - 既存 `QrPanel` の `buildJoinUrl` 利用は壊れない（呼出 signature 変更なし）

### Task 2: `updateSpectateEnabled` repository を tournaments.ts に追加

- **ACTION**: [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) に `updateSpectateEnabled(tid, value)` を `updateTournament` の直下に additive 追加
- **IMPLEMENT**:
  ```ts
  /**
   * Phase 3 (04-spectate-mode): tournaments/{tid}.spectateEnabled を toggle する単独書換経路。
   *
   *   - rule は Phase 1 で 2 経路（broad organizer A / 単独書換 B）が組まれている。本関数は経路 B に対応。
   *     `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` を満たす patch のみ送る。
   *   - 値の型は本関数の事前チェックと firestore.rules の `is bool` で二重防御。
   *   - service 層 (setSpectateEnabled) で role check (assertOrganizer) を行うため、本関数は型のみ enforce。
   *   - logger.info は wrapFirestoreWrite の外（成功時のみ）。warn は wrap helper が出力する。
   */
  export async function updateSpectateEnabled(tid: string, value: boolean): Promise<void> {
    if (typeof value !== "boolean") {
      throw new AppError(
        "観戦モードフラグは boolean で指定してください",
        "validation/spectate-enabled-invalid",
      );
    }
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "観戦モード設定の更新に失敗しました",
      async () => {
        await updateDoc(doc(tournamentsRef, tid), {
          spectateEnabled: value,
          updatedAt: serverTimestamp(),
        });
      },
      { tid },
    );
    logger.info("tournament spectateEnabled updated", { tid, value });
  }
  ```
- **MIRROR**: NAMING_CONVENTION（repository — single-field update）+ REPOSITORY_PATTERN
- **IMPORTS**: 既存の `doc, updateDoc, serverTimestamp`, `AppError`, `wrapFirestoreWrite`, `logger` で十分（同 file 1-50 行で既に import 済み）
- **GOTCHA**:
  - `tournamentsRef` (line 67-69) は zodConverter 付き。`updateDoc` は part-write で converter を通さないが、updatedAt の Timestamp 型は Firestore SDK 側で正しく扱われる
  - `typeof value !== "boolean"` の事前チェックは過剰防衛だが、TypeScript 型穴（`as never` 等）に対する最終ライン防御として残す（既存 `updateDefaultSeatsPerTable` の Number.isInteger 検査と同方針）
  - **`updatedAt` を必ず含める**: rule 経路 B の `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt'])` と整合させる。**経路 A も `updatedAt` を含めると emulator validator (case 9) と完全に一致する**
- **VALIDATE**:
  - Task 4 の repository test で `updateDoc` の patch 形を assert
  - `npm run typecheck` 0 errors

### Task 3: `setSpectateEnabled` service を新規作成（`src/lib/services/tournament.ts`）

- **ACTION**: [src/lib/services/tournament.ts](../../../../src/lib/services/tournament.ts) を新規作成し、`setSpectateEnabled({ tid, uid, value })` を export
- **IMPLEMENT**:
  ```ts
  import { AppError } from "@/lib/errors";
  import { getGroup } from "@/lib/firebase/repositories/groups";
  import {
    getTournament,
    updateSpectateEnabled,
  } from "@/lib/firebase/repositories/tournaments";
  import { logger } from "@/lib/logger";

  /**
   * Phase 3 (04-spectate-mode): owner / organizer が tournament 単位で観戦モードを toggle する。
   *
   *   - role check は **tournament の groupId 経由で再評価**する。UI から渡された gid を信頼せず、
   *     getTournament(tid) で正準の groupId を取得してから assertOrganizer する（rule と同じ判定形）。
   *   - rule + service の二重防御で member の write を deny する。
   *   - 失敗時の AppError code は以下:
   *     - `validation/spectate-enabled-invalid`: 引数 value が boolean でない（型穴ガード、事実上発火しない）
   *     - `firestore/not-found`: tournament が存在しない（getTournament 経由）
   *     - `group/not-organizer`: 呼出 uid が tournament.groupId の organizer ではない
   *     - `firestore/write_failed`: Firestore reject（rule deny / network failure 等）
   *     - `spectate/permission-denied`: 上記いずれにも該当しないが、rule 側で deny された場合の専用 code
   *       （permission-denied を spectate/* prefix に格上げする経路。一旦は firestore/write_failed のままで OK）
   */
  export async function setSpectateEnabled({
    tid,
    uid,
    value,
  }: {
    tid: string;
    uid: string;
    value: boolean;
  }): Promise<void> {
    if (typeof value !== "boolean") {
      throw new AppError(
        "観戦モードフラグは boolean で指定してください",
        "validation/spectate-enabled-invalid",
      );
    }
    const tournament = await getTournament(tid);
    const group = await getGroup(tournament.groupId);
    if (!group.organizerUids.includes(uid)) {
      throw new AppError("運営のみ実行できます", "group/not-organizer");
    }
    await updateSpectateEnabled(tid, value);
    logger.info("setSpectateEnabled ok", { tid, uid, value, gid: tournament.groupId });
  }
  ```
- **MIRROR**: NAMING_CONVENTION（service / repository の対称命名）+ ERROR_HANDLING（assertOrganizer 経由）
- **IMPORTS**: 既存 4 module（errors / repositories/groups / repositories/tournaments / logger）
- **GOTCHA**:
  - **assertOrganizer は file-private**（`src/lib/services/group.ts` 内 function）なので import できない。本 file 内で **手書き判定**を再現する（`group.organizerUids.includes(uid)`）。`assertOrganizer` を group.ts から export し直すと余計な diff が出るため、callsite を増やしすぎない方針で局所コピー
  - `getTournament` は `firestore/not-found` を throw する（[repositories/tournaments.ts:177-190](../../../../src/lib/firebase/repositories/tournaments.ts#L177-L190)）。tid が存在しない場合は service レベルで素通しでよい
  - `value` が現状値と同じでも書込は走る（idempotent）。冪等性は rule + Firestore 側で問題なし。「現在 ON のときに ON ボタンを連打しても問題ない」UX を維持
  - `gid` 引数は受け取らない（重複防御を狙うと API 設計が冗長になり、実害は無い。tid 起点で正準 groupId を取れる）
- **VALIDATE**: Task 5 の service test で role / not-found / boolean 型の各ケースを assert

### Task 4: `updateSpectateEnabled` repository test を追加

- **ACTION**: [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) に describe ブロックを追加
- **IMPLEMENT**:
  ```ts
  // 既存 updateTournament の describe の隣に追加。
  // import に updateSpectateEnabled を追加し、(line 56-73 の import block 末尾)。

  describe("updateSpectateEnabled", () => {
    it("calls updateDoc with { spectateEnabled: true, updatedAt: serverTimestamp() }", async () => {
      vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
      await updateSpectateEnabled("t1", true);
      const [, patch] = vi.mocked(updateDoc).mock.calls[0];
      expect(patch).toEqual({
        spectateEnabled: true,
        updatedAt: { __op: "serverTimestamp" },
      });
    });

    it("calls updateDoc with { spectateEnabled: false, updatedAt: serverTimestamp() }", async () => {
      vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
      await updateSpectateEnabled("t1", false);
      const [, patch] = vi.mocked(updateDoc).mock.calls[0];
      expect(patch).toEqual({
        spectateEnabled: false,
        updatedAt: { __op: "serverTimestamp" },
      });
    });

    it.each([
      ["string", "true"],
      ["number", 1],
      ["null", null],
      ["undefined", undefined],
    ] as const)("rejects %s value with validation/spectate-enabled-invalid", async (_label, bad) => {
      await expect(
        updateSpectateEnabled("t1", bad as unknown as boolean),
      ).rejects.toMatchObject({ code: "validation/spectate-enabled-invalid" });
      expect(updateDoc).not.toHaveBeenCalled();
    });

    it("wraps Firestore reject as firestore/write_failed", async () => {
      vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm") as never);
      await expect(updateSpectateEnabled("t1", true)).rejects.toMatchObject({
        code: "firestore/write_failed",
      });
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE（`updateDefaultSeatsPerTable` の test スイート構造）
- **IMPORTS**: import block (line 56-73) に `updateSpectateEnabled` を追加
- **GOTCHA**:
  - `serverTimestamp` の戻り値 sentinel は `{ __op: "serverTimestamp" }`（同 file line 31 で mock 化済）
  - validation の it.each で `as const` を使う際、型ヘルプが必要（`as unknown as boolean` で TS を黙らせる）
  - 既存の `vi.mocked(updateDoc).mockReset().mockResolvedValue(undefined)` が beforeEach にあるため、各 it で `mockResolvedValueOnce` / `mockRejectedValueOnce` で上書き
- **VALIDATE**: `npm run test -- src/lib/firebase/repositories/tournaments.test.ts` で新規 describe ブロックが pass

### Task 5: `setSpectateEnabled` service test を新規作成

- **ACTION**: [src/lib/services/tournament.test.ts](../../../../src/lib/services/tournament.test.ts) を新規作成
- **IMPLEMENT**:
  ```ts
  import { Timestamp } from "firebase/firestore";
  import { beforeEach, describe, expect, it, vi } from "vitest";

  import type { GroupDoc } from "@/lib/firebase/schemas/group";
  import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

  vi.mock("@/lib/firebase/repositories/groups", () => ({
    getGroup: vi.fn(),
  }));

  vi.mock("@/lib/firebase/repositories/tournaments", () => ({
    getTournament: vi.fn(),
    updateSpectateEnabled: vi.fn(),
  }));

  import { getGroup } from "@/lib/firebase/repositories/groups";
  import {
    getTournament,
    updateSpectateEnabled,
  } from "@/lib/firebase/repositories/tournaments";

  import { setSpectateEnabled } from "./tournament";

  function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
    return {
      id: "g1",
      name: "Test",
      ownerUids: ["uOwner"],
      organizerUids: ["uOwner"],
      memberUids: ["uOwner"],
      memberDisplayNames: { uOwner: "Owner" },
      audioSettings: {
        enabled: false,
        levelUpSoundId: "default",
        winnerSoundId: "default",
        volume: 0.5,
      },
      finishedTournamentCount: 0,
      defaultSeatsPerTable: 8,
      seasonStartDate: null,
      defaultTableLabels: [],
      defaultTableColors: [],
      seasonPointsRule: null,
      joinCodeId: null,
      createdAt: Timestamp.fromDate(new Date("2026-04-01T00:00:00Z")),
      ...overrides,
    } as GroupDoc;
  }

  function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
    const ts = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));
    return {
      id: "t1",
      groupId: "g1",
      createdByUid: "uOwner",
      name: "Monthly",
      structureSnapshot: {
        name: "Default",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
      },
      state: "running",
      startedAt: ts,
      levelStartedAt: ts,
      pausedAt: null,
      pausedAccumMs: 0,
      finishedAt: null,
      currentLevel: 1,
      lateEntryDeadlineLevel: 6,
      seatsPerTable: 8,
      spectateEnabled: false,
      createdAt: ts,
      updatedAt: ts,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.mocked(getGroup).mockReset();
    vi.mocked(getTournament).mockReset();
    vi.mocked(updateSpectateEnabled).mockReset();
  });

  describe("setSpectateEnabled", () => {
    it("allows owner (also organizer) to toggle ON", async () => {
      vi.mocked(getTournament).mockResolvedValue(makeTournament());
      vi.mocked(getGroup).mockResolvedValue(makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }));
      vi.mocked(updateSpectateEnabled).mockResolvedValue();

      await setSpectateEnabled({ tid: "t1", uid: "uOwner", value: true });

      expect(updateSpectateEnabled).toHaveBeenCalledWith("t1", true);
    });

    it("allows organizer (non-owner) to toggle ON / OFF", async () => {
      vi.mocked(getTournament).mockResolvedValue(makeTournament({ spectateEnabled: true }));
      vi.mocked(getGroup).mockResolvedValue(makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      }));
      vi.mocked(updateSpectateEnabled).mockResolvedValue();

      await setSpectateEnabled({ tid: "t1", uid: "uOrg", value: false });

      expect(updateSpectateEnabled).toHaveBeenCalledWith("t1", false);
    });

    it("rejects member with group/not-organizer (no write attempted)", async () => {
      vi.mocked(getTournament).mockResolvedValue(makeTournament());
      vi.mocked(getGroup).mockResolvedValue(makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      }));

      await expect(
        setSpectateEnabled({ tid: "t1", uid: "uMember", value: true }),
      ).rejects.toMatchObject({ code: "group/not-organizer" });
      expect(updateSpectateEnabled).not.toHaveBeenCalled();
    });

    it("propagates firestore/not-found when tournament missing", async () => {
      // getTournament が AppError("firestore/not-found") を投げる場合、
      // 上位層で wrap せずに伝播する（service の責務は role check のみ）。
      const { AppError } = await import("@/lib/errors");
      vi.mocked(getTournament).mockRejectedValue(
        new AppError("missing", "firestore/not-found"),
      );

      await expect(
        setSpectateEnabled({ tid: "missing", uid: "uOwner", value: true }),
      ).rejects.toMatchObject({ code: "firestore/not-found" });
      expect(getGroup).not.toHaveBeenCalled();
      expect(updateSpectateEnabled).not.toHaveBeenCalled();
    });

    it.each([
      ["string", "true"],
      ["null", null],
      ["undefined", undefined],
    ] as const)("rejects non-boolean value (%s) without reading tournament", async (_label, bad) => {
      await expect(
        setSpectateEnabled({
          tid: "t1",
          uid: "uOwner",
          value: bad as unknown as boolean,
        }),
      ).rejects.toMatchObject({ code: "validation/spectate-enabled-invalid" });
      expect(getTournament).not.toHaveBeenCalled();
      expect(getGroup).not.toHaveBeenCalled();
      expect(updateSpectateEnabled).not.toHaveBeenCalled();
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE（`setFinishedTournamentCount` の test スイート構造）
- **IMPORTS**: vitest / module 単位の `vi.mock`
- **GOTCHA**:
  - `makeGroup` factory は test 内に閉じ込める（既存 `src/lib/services/group.test.ts` の `makeGroup` を再利用するために `import` するとテスト ファイル間の結合度が上がるため、本ファイルにローカルコピー）
  - `makeTournament` の `spectateEnabled: false` を default にするのは Phase 1 schema additive 後の既存 fixture（`tournaments.test.ts:104` 等）と整合
  - boolean 型ガード it.each は **`getTournament` を呼ばない**ことを assert（Number.isInteger と同方針）
- **VALIDATE**: `npm run test -- src/lib/services/tournament.test.ts` で 6 テスト全 pass

### Task 6: `SpectateModeCard` component を新規作成

- **ACTION**: [src/components/tournament/SpectateModeCard.tsx](../../../../src/components/tournament/SpectateModeCard.tsx) を新規作成
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { QRCodeSVG } from "qrcode.react";
  import { useEffect, useState } from "react";

  import { Button } from "@/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "@/components/ui/card";
  import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
  } from "@/components/ui/dialog";
  import { unwrapOrFrom } from "@/lib/errors";
  import { logger } from "@/lib/logger";
  import { buildSpectateUrl } from "@/lib/services/qr";
  import { setSpectateEnabled } from "@/lib/services/tournament";

  interface SpectateModeCardProps {
    /** 対象トーナメント id（URL 構築 + 書込先）。 */
    tid: string;
    /** 現在の `tournament.spectateEnabled` 値。toggle UI の checked 制御に使う。 */
    enabled: boolean;
    /** 現在のユーザー uid。書込時の role check に使う。 */
    uid: string;
    /** 上位の error 表示と接続する callback（dashboard-client.tsx の setError）。 */
    onError: (message: string) => void;
  }

  /**
   * Phase 3 (04-spectate-mode): 観戦モード toggle / URL 共有 / QR 表示の運営者用カード。
   *
   *   - role gate は呼出側 (`dashboard-client.tsx`) で organizer-only に絞る。本 card は防御として
   *     呼ばれたら描画する設計（component 単体では role を検査しない）。
   *   - toggle ON 時のみ確認 dialog を挟む（OFF にする方向は誤操作のダメージが少ないため即時）。
   *   - 書込中（toggling=true）は toggle と確認ボタンを disabled にして二重 click を防ぐ。
   *   - 同期は dashboard 側の useTournamentTimer (subscribeTournament) で onSnapshot 経由。本 card 内で
   *     最新値を fetch しない（props.enabled が真実源）。
   *   - QR はデフォルト折りたたみ（`showQr=false`）で Card 高さを抑え、ON 時に「QR を表示」ボタンで開閉。
   */
  export function SpectateModeCard({ tid, enabled, uid, onError }: SpectateModeCardProps) {
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [toggling, setToggling] = useState(false);
    const [copied, setCopied] = useState(false);
    const [showQr, setShowQr] = useState(false);
    const [url, setUrl] = useState<string | null>(null);

    useEffect(() => {
      setUrl(buildSpectateUrl(tid));
    }, [tid]);

    // toggle 切替: ON にする方向のみ確認 dialog を経由。OFF は即時。
    function onToggleClick() {
      if (toggling) return;
      if (enabled) {
        // OFF にする: 確認なし
        void apply(false);
      } else {
        // ON にする: 確認 dialog を開く
        setConfirmOpen(true);
      }
    }

    async function apply(next: boolean) {
      setToggling(true);
      try {
        await setSpectateEnabled({ tid, uid, value: next });
        // 成功時の onSnapshot 反映は呼出側で済む。ここでは dialog を閉じるだけ。
        setConfirmOpen(false);
      } catch (e) {
        const wrapped = unwrapOrFrom(e, "firestore/write_failed", "観戦モード設定の更新に失敗しました");
        onError(`${wrapped.code}: ${wrapped.message}`);
        // dialog は閉じない（再試行可能な状態を残す）
      } finally {
        setToggling(false);
      }
    }

    async function onCopy() {
      if (!url) return;
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } catch (e) {
        logger.warn("clipboard copy failed", {
          code: "clipboard/unavailable",
          message: e instanceof Error ? e.message : String(e),
        });
        onError("clipboard/unavailable: クリップボードにコピーできませんでした");
      }
    }

    return (
      <Card aria-label="spectate-mode-card">
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>観戦モード</CardTitle>
              <CardDescription>
                URL を知る人は誰でも、ログイン無しでタイマー・席表・残人数を閲覧できます。
                メールアドレスや過去の戦績は公開されません。
              </CardDescription>
            </div>
            <label className="flex shrink-0 items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="switch"
                aria-label="観戦モードを切り替え"
                checked={enabled}
                disabled={toggling}
                onChange={onToggleClick}
              />
              <span aria-hidden>{enabled ? "ON" : "OFF"}</span>
            </label>
          </div>
        </CardHeader>
        {enabled && url ? (
          <CardContent className="space-y-3">
            <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{url}</p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void onCopy()} aria-label="観戦 URL をコピー">
                {copied ? "コピーしました" : "URL をコピー"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowQr((v) => !v)}
                aria-label={showQr ? "QR コードを隠す" : "QR コードを表示"}
              >
                {showQr ? "QR を隠す" : "QR を表示"}
              </Button>
            </div>
            {showQr ? (
              <div className="flex justify-center rounded-md border bg-white p-4">
                <QRCodeSVG value={url} size={224} aria-label="観戦 URL の QR コード" />
              </div>
            ) : null}
          </CardContent>
        ) : null}

        {/* ON 確認 dialog: OFF → ON への遷移時のみ */}
        <Dialog open={confirmOpen} onOpenChange={(o) => !toggling && setConfirmOpen(o)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>観戦モードを ON にしますか？</DialogTitle>
              <DialogDescription>
                URL を知る人は誰でも、ログイン無しでタイマー・席表・残人数・displayName を閲覧できる
                ようになります。メールアドレスや過去の対戦履歴は公開されません。
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                onClick={() => setConfirmOpen(false)}
                disabled={toggling}
              >
                キャンセル
              </Button>
              <Button onClick={() => void apply(true)} disabled={toggling}>
                {toggling ? "設定中…" : "ON にする"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    );
  }
  ```
- **MIRROR**: COMPONENT_PATTERN（QrPanel）+ DIALOG_PATTERN（StartSeasonDialog）
- **IMPORTS**: 新規 `QRCodeSVG`, `Dialog*`, `unwrapOrFrom`, `logger`, `buildSpectateUrl`, `setSpectateEnabled`
- **GOTCHA**:
  - **`role="switch"` の checkbox**: a11y 対応。Phase 1 規約は WCAG 2.2 AA（プロジェクト規約から）。aria-label を付ける
  - **OFF 方向は確認 dialog なし**: 誤操作で OFF になっても URL 共有が止まるだけで個人情報が漏れる方向ではない。UX 摩擦を減らすため即時実行
  - **dialog は toggling 中の onOpenChange を block**: `(o) => !toggling && setConfirmOpen(o)` でレース回避
  - **失敗時に dialog を閉じない**: `apply` の catch 内で `setConfirmOpen(false)` を呼ばない。「失敗 → 再試行」の UX を残す
  - **QR コードは折りたたみ**: dashboard が縦に長いため、observer 用途以外では QR を非表示にして Card 高さを抑える。InviteCodeCard は QR が常時表示だが、こちらは toggle ON 中の常駐表示になるため折りたたみが望ましい
  - **`url` を useEffect で setState する理由**: SSR で `window.location.origin` が undefined → クライアント hydrate 後に確定するため。`useState` の初期値を `null` にして hydration mismatch を回避（既存 `QrPanel` と同方針）
- **VALIDATE**: Task 7 のテストで挙動を assert + manual verification（Vercel preview / dev server）

### Task 7: `SpectateModeCard` の characterization test を新規作成

- **ACTION**: [src/components/tournament/SpectateModeCard.test.tsx](../../../../src/components/tournament/SpectateModeCard.test.tsx) を新規作成
- **IMPLEMENT**:
  ```tsx
  import { act, fireEvent, render, screen } from "@testing-library/react";
  import { beforeEach, describe, expect, it, vi } from "vitest";

  vi.mock("@/lib/services/tournament", () => ({
    setSpectateEnabled: vi.fn(),
  }));

  vi.mock("@/lib/services/qr", () => ({
    buildSpectateUrl: vi.fn(
      (tid: string) => `https://example.test/spectate/${tid}`,
    ),
  }));

  // navigator.clipboard を test 環境で stub
  beforeEach(() => {
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  import { setSpectateEnabled } from "@/lib/services/tournament";

  import { SpectateModeCard } from "./SpectateModeCard";

  describe("SpectateModeCard", () => {
    beforeEach(() => {
      vi.mocked(setSpectateEnabled).mockReset().mockResolvedValue();
    });

    it("OFF 状態では URL / コピー / QR を表示しない", () => {
      render(<SpectateModeCard tid="t1" enabled={false} uid="u1" onError={vi.fn()} />);
      expect(screen.queryByText("URL をコピー")).not.toBeInTheDocument();
      expect(screen.queryByLabelText("観戦 URL の QR コード")).not.toBeInTheDocument();
    });

    it("ON 状態では URL とコピーボタンを表示し、QR は折りたたみ", () => {
      render(<SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />);
      expect(screen.getByText(/spectate\/t1/)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "観戦 URL をコピー" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "QR コードを表示" })).toBeInTheDocument();
      expect(screen.queryByLabelText("観戦 URL の QR コード")).not.toBeInTheDocument();
    });

    it("ON 状態で「QR コードを表示」をクリックすると QR が描画される", () => {
      render(<SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />);
      fireEvent.click(screen.getByRole("button", { name: "QR コードを表示" }));
      expect(screen.getByLabelText("観戦 URL の QR コード")).toBeInTheDocument();
    });

    it("OFF 状態で switch を ON すると確認 dialog が開く（即時 setSpectateEnabled は呼ばれない）", () => {
      render(<SpectateModeCard tid="t1" enabled={false} uid="u1" onError={vi.fn()} />);
      fireEvent.click(screen.getByRole("switch", { name: "観戦モードを切り替え" }));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByText("観戦モードを ON にしますか？")).toBeInTheDocument();
      expect(setSpectateEnabled).not.toHaveBeenCalled();
    });

    it("確認 dialog の「ON にする」で setSpectateEnabled(t1, u1, true) が呼ばれる", async () => {
      render(<SpectateModeCard tid="t1" enabled={false} uid="u1" onError={vi.fn()} />);
      fireEvent.click(screen.getByRole("switch", { name: "観戦モードを切り替え" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "ON にする" }));
      });
      expect(setSpectateEnabled).toHaveBeenCalledWith({ tid: "t1", uid: "u1", value: true });
    });

    it("ON 状態で switch を OFF すると確認 dialog なしで setSpectateEnabled(false) が呼ばれる", async () => {
      render(<SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("switch", { name: "観戦モードを切り替え" }));
      });
      expect(setSpectateEnabled).toHaveBeenCalledWith({ tid: "t1", uid: "u1", value: false });
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    it("setSpectateEnabled が reject すると onError に code:message が渡る（dialog は開いたまま）", async () => {
      const { AppError } = await import("@/lib/errors");
      vi.mocked(setSpectateEnabled).mockRejectedValueOnce(
        new AppError("反映できません", "firestore/write_failed"),
      );
      const onError = vi.fn();
      render(<SpectateModeCard tid="t1" enabled={false} uid="u1" onError={onError} />);
      fireEvent.click(screen.getByRole("switch", { name: "観戦モードを切り替え" }));
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "ON にする" }));
      });
      expect(onError).toHaveBeenCalledWith(expect.stringMatching(/^firestore\/write_failed: /));
      expect(screen.getByRole("dialog")).toBeInTheDocument();
    });

    it("コピーボタンで navigator.clipboard.writeText が URL とともに呼ばれる", async () => {
      render(<SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "観戦 URL をコピー" }));
      });
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        "https://example.test/spectate/t1",
      );
    });
  });
  ```
- **MIRROR**: TEST_STRUCTURE（`GroupDefaultTableLabelsCard.test.tsx`）
- **IMPORTS**: testing-library / vitest
- **GOTCHA**:
  - `navigator.clipboard` は jsdom にデフォルトで存在しないため `Object.defineProperty` で stub
  - `role="switch"` の click は `fireEvent.click` で OK（onChange ハンドラは onClick として登録した onToggleClick が拾う）
  - **dialog は Radix UI の `<Dialog>` を使うため `role="dialog"` で検索可能**（既存 `LeaveDeleteDialogs` のテストパターンが流用可。プロジェクト内に dialog test の先例が無い場合は本テストが先例になる）
  - エラー時の dialog 持続テストは「failure 後の再試行 UX」を保証する重要 case
- **VALIDATE**: `npm run test -- src/components/tournament/SpectateModeCard.test.tsx` で 8 テスト全 pass

### Task 8: dashboard-client.tsx に `<SpectateModeCard>` を統合（**ページ最下部**に配置）

- **ACTION**: [src/app/tournaments/[tid]/dashboard-client.tsx](../../../../src/app/tournaments/[tid]/dashboard-client.tsx) の **`<main>` ブロックの最下部**（visible な Card 群の最後）に SpectateModeCard を追加
- **IMPLEMENT**:
  - 6 行目あたりに新規 import: `import { SpectateModeCard } from "@/components/tournament/SpectateModeCard";`
  - **挿入位置**: 既存 `<StructureSnapshotCard>`（line 520-534）の閉じタグ直下、かつ `<Dialog open={confirmOpen} ...>`（line 537、削除確認モーダル）の直前。
    - **`<Dialog>` はモーダルで通常時は描画されないため、SpectateModeCard が `<main>` 内の visible な最後の要素になる**（=「ページ最下部に表示される Card」が SpectateModeCard で確定）
    - タイマー上段 grid（QR / Timer / Stats）/ BalancingInstructionCard / SeatingBoard / PlayerList / StructureSnapshotCard より**すべて下**
  - 配置形:
    ```tsx
    <StructureSnapshotCard ... />

    {/* Phase 3 (04-spectate-mode): 観戦モード toggle / URL コピー / QR。
        ユーザー指定でページ最下部に配置（運営の core UX を阻害せず、観戦は補助機能の位置付け）。
        dashboard 自体が organizer-only redirect 済み（line 167-174 / 256-258）の前提。
        防御として SpectateModeCard 内部でも role を検査せず、props.enabled が真実源。
        後続に <Dialog>（削除確認モーダル）が来るが、モーダルは通常非描画のため
        本 Card が <main> 内の最終 visible 要素になる。 */}
    <SpectateModeCard
      tid={tid}
      enabled={data.spectateEnabled}
      uid={user.uid}
      onError={setError}
    />

    <Dialog open={confirmOpen} ... />
    ```
  - **追加の改修不要**: `useTournamentTimer` 経由の `subscribeTournament` で `data.spectateEnabled` は最新値で onSnapshot 反映される。dashboard 側で別 subscribe / refresh を追加する必要なし
- **MIRROR**: 既存の `<StructureSnapshotCard>` / `<PlayerList>` の挿入パターン
- **IMPORTS**: 1 行 import 追加のみ
- **GOTCHA**:
  - **role gate の二重防御**: dashboard は line 167-174 で member ロールを `/live` に redirect、line 256-258 で `if (!isOrganizer) return <main>読込中…</main>` で blocking する。`SpectateModeCard` が描画される段階では organizer 確定。card 内部で重ねて role check する必要はないが、防御として `props.uid` を必須にしておく
  - **挿入位置の意図**: 上段 grid (タイマー操作 core) / 中段 (Seating / Player 運用) / 下段 (Structure 設定参照) の階層を保ったまま、観戦モードは「補助・共有」の位置付けで**最下部**に分離する。タイマー上段 grid には入れない（観戦は進行中の core UX ではない）
  - **「最下部」の確認**: WinnerBanner / ShareCardButton が `winner` 確定時のみ条件描画される箇所は **`<main>` の上半分**（line 381-）にあり、SpectateModeCard より上。そのため winner 表示状態でも SpectateModeCard が最下位置に来る不変条件は維持される
  - **member への配慮**: 既に dashboard 自体が member redirect なので不要。一応「`SpectateModeCard` が member ロールに対して null を return する」防御コメントを追加
- **VALIDATE**:
  - `npm run typecheck` 0 errors
  - dev server で organizer ログイン → dashboard 開いて Card がページ最下部に表示される（StructureSnapshotCard の真下にあること、winner 確定時でも最下位置を維持していることを目視）
  - dev server で member ログイン → `/live` に redirect されて Card は見えない（既存挙動）

### Task 9: tournaments-client.tsx に「観戦公開中」 badge を追加

- **ACTION**: [src/app/tournaments/tournaments-client.tsx](../../../../src/app/tournaments/tournaments-client.tsx) に `spectateEnabled === true` のとき badge を additive 表示
- **IMPLEMENT**:
  - 既存の `<CardDescription>` 内、`{tone.label}` の隣に独立 span を追加:
    ```tsx
    <CardDescription>
      <span className={cn("mr-2 rounded px-2 py-0.5 text-xs font-medium", tone.badge)}>
        {tone.label}
      </span>
      {/* Phase 3 (04-spectate-mode): 観戦モード ON 中の tournament を一目で識別。
          color は state badge と被らない sky 系（情報系）。member にも見せて誤公開放置の検知に使う。 */}
      {t.spectateEnabled ? (
        <span
          className="mr-2 rounded bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300"
          aria-label="観戦モード公開中"
        >
          観戦公開中
        </span>
      ) : null}
      {t.structureSnapshot.levels.length} レベル / 初期{" "}
      {t.structureSnapshot.initialStack}
    </CardDescription>
    ```
  - `aria-label` を card 全体の `role="group"` に追加するなら `${tone.label}${t.spectateEnabled ? "・観戦公開中" : ""}` の形で連結（既存 line 139 の `aria-label={`${t.name}（${tone.label}）`}` を更新）
- **MIRROR**: LIST_BADGE_PATTERN（既存 `tone.label` の span パターン）
- **IMPORTS**: 不要（既存 `cn` で十分）
- **GOTCHA**:
  - **member ロールでも badge は表示**: 公開中という事実は member にも見せる仕様（自分が参加中のサークルで公開中の tournament がどれか分かる）
  - **state badge と並列**: `[進行中] [観戦公開中]` のように 2 つ並ぶケースを許容。dim 状態 (finished) でも観戦中なら badge は出る
  - **opacity-70 の継承**: 親 Card の `tone.dim` で opacity が 0.7 になるが、内部 badge も連動して薄くなる（CSS 的に inherits）。視認性は acceptable
- **VALIDATE**:
  - dev server で 一覧画面を開く
  - 1 件 toggle ON してから一覧に戻る → 「観戦公開中」 badge が出る
  - aria-label に「観戦公開中」が含まれる（`getByRole("group", { name: /観戦公開中/ })` でテスト書ける状態）

---

## Testing Strategy

### Unit Tests（新規追加）

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `updateSpectateEnabled.test`: valid bool | `(tid, true)` / `(tid, false)` | `updateDoc` patch shape `{ spectateEnabled, updatedAt }` | boundary |
| `updateSpectateEnabled.test`: invalid type | `(tid, "true")` etc | rejects `validation/spectate-enabled-invalid`, no updateDoc | type穴ガード |
| `updateSpectateEnabled.test`: firestore reject | mocked reject | rejects `firestore/write_failed` | wrap helper 経由 |
| `setSpectateEnabled.test`: owner allow | mock organizer membership | `updateSpectateEnabled` called | role gate happy path |
| `setSpectateEnabled.test`: organizer non-owner allow | mock organizer membership | `updateSpectateEnabled` called | role gate happy path |
| `setSpectateEnabled.test`: member reject | uid not in organizerUids | `group/not-organizer`, no write | role gate negative |
| `setSpectateEnabled.test`: tournament not-found | mocked `firestore/not-found` | propagates, no `getGroup` call | early return |
| `setSpectateEnabled.test`: type穴 | `value: "true"` | `validation/spectate-enabled-invalid` before fetch | early validation |
| `SpectateModeCard.test`: OFF state | `enabled=false` | URL / コピー / QR 不在 | display gating |
| `SpectateModeCard.test`: ON state | `enabled=true` | URL / コピー / QR ボタン表示 / QR は折りたたみ | display gating |
| `SpectateModeCard.test`: QR toggle | click QR show button | QR が描画 | UI state |
| `SpectateModeCard.test`: OFF→ON dialog | click switch from OFF | dialog 開く / setSpectateEnabled 呼ばれない | confirmation flow |
| `SpectateModeCard.test`: dialog confirm | click "ON にする" | setSpectateEnabled(t1, u1, true) | confirmation flow |
| `SpectateModeCard.test`: ON→OFF | click switch from ON | dialog 不要 / setSpectateEnabled(false) | confirmation flow (asymmetric) |
| `SpectateModeCard.test`: error path | setSpectateEnabled reject | onError 呼出 / dialog 開いたまま | error UX |
| `SpectateModeCard.test`: clipboard | click "URL をコピー" | navigator.clipboard.writeText(url) | side-effect |

### Edge Cases Checklist

- [x] **member の write deny** — service test (Task 5) で `group/not-organizer` を assert。rule 側は Phase 1 の emulator validator (case 10) で既に検証済
- [x] **anon の write deny** — Phase 1 の emulator validator (case 11) で検証済。Phase 3 では UI 経路を新設するだけで rule に手を入れないため再検証不要
- [x] **boolean 型穴** — service / repository 両方で type guard、test で it.each
- [x] **tournament 不在** — service test で `firestore/not-found` を propagate
- [x] **clipboard unavailable** — component test で `writeText` reject 経路（既存 InviteCodeCard と同方針）
- [x] **OFF 方向の確認 dialog 不要** — 仕様として確定。テストで「ON 中の switch click は dialog 経由しない」を assert
- [x] **連続クリック / レース** — `toggling` state で disabled 制御、test で `await act` 経由で覆う
- [ ] **`group` doc が deleted の race** — `getGroup` が `firestore/not-found` を返す場合、`firestore/not-found` がそのまま伝播。UI 表示は `firestore/not-found: ...` で acceptable（実運用上ほぼ起きない）
- [ ] **QR スキャン → `/spectate/[tid]` 開く** — Phase 2 が実装される後の E2E 検証。Phase 3 単体では route 不在のため 404 が返る（仕様）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: 0 type errors（schema は Phase 1 で完了済、Phase 3 では新規 export を 1 component / 1 service / 1 repository / 1 url helper で追加）

```bash
npm run lint
```

EXPECT: 0 lint errors / 0 warnings

### Unit Tests

```bash
npm run test -- src/lib/services/tournament.test.ts
npm run test -- src/lib/firebase/repositories/tournaments.test.ts
npm run test -- src/components/tournament/SpectateModeCard.test.tsx
```

EXPECT: 全 pass（service 6 / repository describe 1 ブロック / component 8）

### 全体 Unit Tests（回帰）

```bash
npm run test
```

EXPECT: 既存 1213+ tests + 新規 ~17 tests が全 pass。Phase 1 で additive 変更した 14 fixture は影響しない（schema 上 `spectateEnabled: false` 既定で hydrate されるため）

### Emulator Rule Validator（回帰のみ）

Phase 3 では rule に手を入れないため、既存の emulator validator が green のままであることだけ確認:

```bash
npm run test:rules-spectate
```

EXPECT: Phase 1 の 14 ケース全 pass（Phase 3 では rule に変更を加えないため、再走行で green 確認のみ）

### Build Validation

```bash
npm run build
```

EXPECT: Next.js build 通過（新規 component の Tree-shake / SSR 互換性確認）

### Manual Validation

- [ ] dev server (`npm run dev`) で organizer ログイン → 任意 tournament の dashboard を開く
- [ ] `SpectateModeCard` が StructureSnapshotCard の下に表示される
- [ ] switch を OFF→ON にクリック → 確認 dialog が出る
- [ ] dialog の「ON にする」をクリック → switch が ON / URL とコピーボタンが見える
- [ ] 「URL をコピー」 → クリップボードに `https://<host>/spectate/<tid>` が入る
- [ ] 「QR コードを表示」 → QR が出る（モバイルでスキャンするとリンクとして開く、Phase 3 時点では `/spectate/[tid]` route 不在のため 404 だが URL 文字列としては正しい）
- [ ] switch を OFF にクリック → 確認 dialog なしで即時 OFF / URL とコピーボタンが消える
- [ ] `/tournaments`（一覧画面）に戻ると、ON 中の tournament に「観戦公開中」 badge が出る
- [ ] member ロール（別アカウント）で同じ tournament の dashboard URL を直接開く → `/live` に redirect される（既存挙動）→ SpectateModeCard は見えない
- [ ] member ロールでも `/tournaments` 一覧では「観戦公開中」 badge は見える

---

## Acceptance Criteria

- [ ] `src/lib/services/qr.ts` に `buildSpectateUrl(tid)` が export されている
- [ ] `src/lib/firebase/repositories/tournaments.ts` に `updateSpectateEnabled(tid, value)` が export され、`wrapFirestoreWrite` 経由で `{ spectateEnabled, updatedAt: serverTimestamp() }` を patch する
- [ ] `src/lib/services/tournament.ts` が新規作成され、`setSpectateEnabled({ tid, uid, value })` が export されている
- [ ] `setSpectateEnabled` は `getTournament(tid).groupId` 経由で `assertOrganizer` 相当の判定を行い、member には `group/not-organizer` を throw する
- [ ] `src/components/tournament/SpectateModeCard.tsx` が新規作成され、role gate / 確認 dialog / URL コピー / QR を内包している
- [ ] dashboard-client.tsx に `<SpectateModeCard>` が統合され、`StructureSnapshotCard` の直下に表示される
- [ ] tournaments-client.tsx の Card に `t.spectateEnabled === true` のとき「観戦公開中」 badge が出る
- [ ] 新規 unit test 約 17 件がすべて pass
- [ ] 既存 unit test 1213+ 件すべて pass（回帰なし）
- [ ] 既存 `npm run test:rules-spectate` が引き続き 14/14 green
- [ ] `npm run typecheck` / `npm run lint` / `npm run build` すべて 0 errors

## Completion Checklist

- [ ] role gate は `dashboard` 既存 redirect + `setSpectateEnabled` 内 `assertOrganizer` 相当の **二重防御**
- [ ] OFF→ON は確認 dialog 必須 / ON→OFF は即時（仕様の対称性ではなく UX の摩擦に応じて非対称設計）
- [ ] エラーは `unwrapOrFrom` で既存 wrap を尊重し、UI に `{code}: {message}` 形式で表示（既存 dashboard `setError` の慣習）
- [ ] clipboard 失敗は `logger.warn` + `onError` callback の双方で扱う（既存 `InviteCodeCard` と同方針）
- [ ] 新規 component / service / repository すべて[error-logging.md](../../../rules/error-logging.md) 規約に準拠（`AppError` ラップ / `console.*` 不使用 / `unwrapOrFrom` 使い分け）
- [ ] PRD で「Won't」とされた項目は plan / 実装に含めていない
- [ ] テストは「helper / service / repository の API 境界で mock」（[testing.md](../../../rules/testing.md) 準拠）
- [ ] 自己完結 — Phase 3 着手者がさらなる質問なしに着手できる

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `setSpectateEnabled` が tournament の groupId を信頼する設計のため、tournament doc が削除済みだと race | L | M | `getTournament` が `firestore/not-found` を throw → service は素通しで UI に code 表示。実運用上は dashboard を開いた状態で tournament が削除されるケースがほぼ無い |
| Phase 1 の rule 経路 A（broad organizer）が経路 B を完全包含しているため、ホ Phase 3 で `updatedAt` を含めない patch 形を誤って書くと「経路 A だけで通る」状態になる | L | L | repository test で patch shape を厳密 assert / Phase 1 emulator validator (case 9) も `{ spectateEnabled, updatedAt }` で書込テスト済み |
| QR コード折りたたみが UX 上分かりにくい（運営者が QR ボタンを見落とす） | M | L | InviteCodeCard との挙動の違いだが、観戦モードは「会場で QR を見せる」より「URL をチャットで送る」が主用途のため折りたたみ default が妥当。manual validation で確認 |
| `navigator.clipboard` が iOS Safari の HTTP 接続で undefined → コピーが silently 失敗 | L | L | dev server も Vercel preview も HTTPS 想定。失敗時は `logger.warn` + onError で UI に表示するため silent ではない |
| `tournaments-client.tsx` 一覧の `aria-label` を変更すると既存 a11y test が回帰 | L | L | 既存 test は `tournaments-client.test.tsx` が無いため回帰の対象 test 無し。a11y は manual で確認 |
| `tournament.ts` service file が他の関連 service（tournament-clone / tournament-state）と同居せず独立しているため将来的に統廃合の議論が起きる | L | L | architect-refactor の対象になりうるが、本 phase の scope ではない。新規 file が小さい（~50 行）ため違和感は限定的 |
| Phase 2 完成前のリリースで「ON にしたが `/spectate/[tid]` が 404」状態になる | M | M | Phase 2 / 3 / 4 を 1 リリースに含める PRD MVP scope に従う（Implementation Phases）。並列実装後にまとめて merge する運用 |

## Notes

- **Phase 2 と並列実装可能**: SpectateModeCard が出力する URL `/spectate/[tid]` の page を Phase 2 が実装する。Phase 3 単体ではリンク先が 404 になるが、本 plan では Phase 2 の page 実装を前提としない（PRD の Parallelism Notes に従い 1 リリースで全 Phase まとめ）
- **Phase 4 の PWA cache とも独立**: 本 plan は SW に手を入れない
- **assertOrganizer の export 化見送り**: `src/lib/services/group.ts` の `assertOrganizer` を export して再利用する選択肢もあるが、call site が group.ts 内 7 箇所 + tournament.ts 1 箇所と非対称。将来 architect-refactor で統合判断する。本 phase では handwritten で重複コピー
- **Phase 1 review の MEDIUM (allow get/list 分割)** は既に Phase 1 で対応済（[firestore.rules:402-414](../../../../firestore.rules#L402-L414)）。Phase 3 では追加対応不要
- **Phase 1 review の LOW-1（経路 A が経路 B を包含）** は Phase 3 でも狭めない。経路 A で `updatedAt` 含み patch する形で運用し、将来 broad organizer update を狭めるリファクタは別 phase で検討
- **テレメトリ非実装**: PRD の Success Metrics は「手動 Firestore 集計 / 月次レビュー」想定のため、`logger.info("setSpectateEnabled ok", ...)` でログに残るだけで OK。analytics SDK は本 phase で導入しない
- PRD の Phase 進捗表 (#3) は本 plan link を埋めて `pending` → `in-progress` に遷移させる（次 Step）
