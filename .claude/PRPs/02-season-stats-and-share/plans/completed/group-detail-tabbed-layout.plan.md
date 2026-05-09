# Plan: サークル詳細画面のタブ化 + サウンド設定統合 + ヘッダ重なり修正

## Summary

サークル詳細画面 [`/groups/[gid]`](../../../../src/app/groups/[gid]/group-detail-client.tsx) を 3 タブ（**メンバー** / **シーズン** / **設定**）に分割し、PRD 02（Phase A〜E）で増殖した 6 枚の Card による縦長スクロールを解消する。同時に **独立ページ [`/groups/[gid]/audio-settings`](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx) を「設定」タブ内の `AudioSettingsCard` に統合**し、`GroupHeaderCard` の「サウンド設定」リンクボタンを削除する（旧 URL は thin redirect で互換性維持）。さらに `GroupHeaderCard` のレイアウトを縦 2 段（タイトル行 + アクション行）に変更し、サークル名編集中の「保存 / キャンセル」と「一覧へ / 削除」ボタン群がモバイル端末で重なる UX 不具合を解消する。

## User Story

As a サークル運営者（owner / organizer）またはメンバー,
I want サークル詳細画面で「メンバー操作」「シーズン管理」「サークル設定（サウンド含む）」を別タブで切り替えながら閲覧でき、サークル名を編集中も保存ボタンが他のボタンと重ならない,
So that スマホ片手操作で目的の操作セクションに最短で到達でき、サウンド設定のために別ページに遷移する手間も無くなり、サークル名のリネーム時も誤タップによる別操作の発火が起きない。

## Problem → Solution

**Current state**:

- [group-detail-client.tsx:330-461](../../../../src/app/groups/[gid]/group-detail-client.tsx#L330-L461) は単一 `<main>` 内に 6 枚の Card を縦に積んでいる（GroupHeaderCard / 開催数 / デフォルト席数 / Table 名デフォルト / SeasonCard / SeasonPointsRuleCard / MemberRoleList / InviteCodeCard）。スクロールが長く、メンバー一覧と設定が混在しているため目的のセクションを探しにくい。
- [GroupHeaderCard.tsx:97-173](../../../../src/app/groups/[gid]/_components/GroupHeaderCard.tsx#L97-L173) はルート要素が `<header className="flex items-start justify-between gap-4">` で、タイトル列と「一覧へ / サウンド設定 / 削除」ボタン列を **横並び固定**にしている。owner がサークル名 inline edit に入ると `<form>` が「Input + 保存 + キャンセル」を横並びで描画するが、画面幅が狭い（375px〜）と form と右側ボタン群が同じ flex container 内で `flex-wrap` するため、保存ボタンと右ボタン群が垂直に重なって誤タップしやすい。
- **サウンド設定**は独立ページ [`/groups/[gid]/audio-settings`](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx)（242 行）に分離されており、サークル詳細から「サウンド設定」リンクボタン → 別画面遷移 → 保存 → サークル詳細に戻る、というフローでアクセスする。`GroupHeaderCard` の「サウンド設定」リンクボタンが mobile での header 過密の一因にもなっている。

**Desired state**:

- `GroupDetailClient` 上部に 3 タブの tablist を新設（**メンバー** / **シーズン** / **設定**）。Card 群を以下に振り分ける:
  - **メンバー**: `InviteCodeCard`（organizer / owner のみ表示・上段）+ `MemberRoleList`（下段）
  - **シーズン**: `SeasonCard` + `SeasonPointsRuleCard`
  - **設定**: 開催数 + デフォルト席数 + Table 名デフォルト + **`AudioSettingsCard`（新設、organizer / owner のみ表示）**
- 選択中タブは `?tab=members|season|settings` でクエリ保存し、ブラウザ戻る / リロード / E2E 直リンクで復元可能。default は `members`。
- `GroupHeaderCard` のルートを `<header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">` に変更し、ボタン群を `<div className="flex flex-wrap gap-2 self-start sm:self-auto">` でラップ。**「サウンド設定」リンクボタンは削除**（タブに集約）。モバイルでは「タイトル → ボタン群」と縦に並び、編集 form が独自の行を占有することで右ボタン群との重なりを構造的に解消する。
- 旧 URL `/groups/[gid]/audio-settings` は **thin redirect**（`redirect("/groups/[gid]?tab=settings&from=...&tid=...")`）に置き換える。`?from=tournament&tid=` / `?from=live&tid=` クエリは保存され、設定タブ側の `AudioSettingsCard` が解釈して保存後の戻り先を決める。
- サイドバーの「サウンド設定」リンク（[nav-items.ts:36](../../../../src/components/nav/nav-items.ts#L36)）は `/groups/{gid}?tab=settings` に書き換える。
- 削除 / 脱退 confirm dialog（`LeaveDeleteDialogs`）と「シーズンを開始しますか？」dialog（`StartSeasonDialog`）は Radix Portal で body 直下に描画されるため、タブ外に置いても自然に動く。

## Metadata

- **Complexity**: Medium-Large（UI 配置の入れ替え + 簡易 tablist 追加 + ヘッダレイアウト調整 + サウンド設定ページのタブ内 Card 化 + 旧 URL の redirect 化。schema・rule・repository・service 変更なし）
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md) — 直接フェーズ対応はしない（全 Phase A〜E 完了後の polish）。PRD 02 で `_components/` 配下に Card を増設したため、本 plan は PRD 02 の work-stream に帰属。
- **PRD Phase**: 該当なし（post-Phase-E polish）
- **Estimated Files**:
  - 修正: 5 件（`group-detail-client.tsx` / `_components/GroupHeaderCard.tsx` / `audio-settings/page.tsx`（thin redirect 化）/ `nav-items.ts`（href 書換）/ POM 系統）
  - 新設: 2 件（`_components/GroupDetailTabs.tsx` — tablist + tabpanel ラッパ / `_components/AudioSettingsCard.tsx` — `audio-settings-client.tsx` のロジックを Card 化）
  - 削除: 2 件（`audio-settings/audio-settings-client.tsx` — 中身は AudioSettingsCard に移植 / `tests/e2e/pages/AudioSettingsPage.ts` — Card 内 locator は `GroupDetailPage` に折込）
  - E2E ページオブジェクト追記: 1 件（`tests/e2e/pages/GroupsPage.ts` の `GroupDetailPage` にタブ操作 + サウンド設定 Card 操作 helper）
  - E2E spec 新設: 1 件（`tests/e2e/group-detail-tabs.spec.ts` — タブ切替 / クエリ保存 / 既存セクション可視性 / サウンド設定タブ内動作確認）
  - 既存 E2E への影響確認:
    - `phase-d-share-and-history.spec.ts` / `table-label-and-color.spec.ts` / `note-screenshots.spec.ts` — タブ default が `members` になり対象 Card が hidden になる箇所（軽微）
    - `audio-settings.spec.ts`（7 テスト全件）— サウンド設定の URL / heading / navigation 全更新（重）
    - `nav-and-sound-toggle.spec.ts` — サイドバーの「サウンド設定」リンクの href 期待値変更（軽微）

---

## UX Design

### Before（モバイル幅 375px、サークル名 inline edit 中）

```
┌─────────────────────────────────────────┐
│ [Input: サークル名 = ...]  [保存][キャンセル]│  ← タイトル列が flex-wrap
│ [一覧へ][サウンド設定][削除]                │  ← 右ボタン列が下段に折り返り
│                                         │     保存と「一覧へ」が縦に重なって誤タップしやすい
│ メンバー X 人 / オーナー Y 人 / あなたは… │
├─────────────────────────────────────────┤
│ Card: 開催数                            │
├─────────────────────────────────────────┤
│ Card: デフォルト席数                    │
├─────────────────────────────────────────┤
│ Card: Table 名デフォルト                │
├─────────────────────────────────────────┤
│ Card: シーズン                          │
├─────────────────────────────────────────┤
│ Card: シーズンポイント計算ルール        │  ← 6 Card 縦長スクロール
├─────────────────────────────────────────┤
│ Card: メンバー（昇降格 UI）             │
├─────────────────────────────────────────┤
│ Card: 招待コード（QR + URL）            │
└─────────────────────────────────────────┘
   ＋ 別画面: /groups/[gid]/audio-settings  ← サウンド設定は独立ページ
```

### After（モバイル幅 375px、サークル名 inline edit 中）

```
┌─────────────────────────────────────────┐
│ [Input: サークル名 = ...]  [保存][キャンセル]│  ← form が独自行を占有
│ メンバー X 人 / オーナー Y 人 / あなたは… │
│ [一覧へ][削除]                           │  ← サウンド設定ボタン削除（タブに集約）
├─────────────────────────────────────────┤
│ ┌──────┬──────┬──────┐                  │
│ │メンバー│シーズン│ 設定 │                │  ← tablist (default: メンバー)
│ └──────┴──────┴──────┘                  │
├─────────────────────────────────────────┤
│ Card: 招待コード（QR + URL）            │  ← organizer 限定で上段に配置
├─────────────────────────────────────────┤
│ Card: メンバー（昇降格 UI）             │
└─────────────────────────────────────────┘
```

タブ「シーズン」を押すと `?tab=season`:

```
│ ┌──────┬──────┬──────┐                  │
│ │メンバー│シーズン│ 設定 │  ← active     │
│ └──────┴──────┴──────┘                  │
├─────────────────────────────────────────┤
│ Card: シーズン                          │
├─────────────────────────────────────────┤
│ Card: シーズンポイント計算ルール        │
└─────────────────────────────────────────┘
```

タブ「設定」(`?tab=settings`):

```
│ ┌──────┬──────┬──────┐                  │
│ │メンバー│シーズン│ 設定 │  ← active     │
│ └──────┴──────┴──────┘                  │
├─────────────────────────────────────────┤
│ Card: 開催数                            │
├─────────────────────────────────────────┤
│ Card: デフォルト席数                    │
├─────────────────────────────────────────┤
│ Card: Table 名デフォルト                │
├─────────────────────────────────────────┤
│ Card: サウンド設定（organizer 限定）    │  ← AudioSettingsCard（旧独立ページの内容）
│   ・通知音 enabled トグル                │
│   ・ブラインド変更時 / 優勝確定時 sound │
│   ・音量 range / 試聴ボタン              │
│   ・[保存] ボタン                        │
└─────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| ヘッダの「一覧へ / サウンド設定 / 削除」ボタン群 | タイトルと同じ flex 行で右寄せ。狭幅で wrap し form と重なる | 「一覧へ / 削除」のみに簡略化、タイトル + role 説明の下に独立行で配置 | サウンド設定リンクは廃止（タブ集約）。`flex-col gap-3 sm:flex-row sm:items-start sm:justify-between` で `sm` 以上は従来通り横並び |
| サークル名 rename inline edit | Input + 保存 + キャンセル が右ボタン群と同じ flex container にあり混在 | タイトル列が独立 → form が他ボタンと衝突しない | 編集中に右ボタン群を `disabled={working}` で無効化する既存挙動は変更なし |
| サウンド設定への到達 | ヘッダの「サウンド設定」リンクボタン → 別ページ遷移 → 保存 → サークル詳細に戻る | 「設定」タブ内の `AudioSettingsCard` で同一画面内編集 | サイドバーのリンクは `/groups/{gid}?tab=settings` に書換。旧 URL `/groups/[gid]/audio-settings` は thin redirect で互換性維持 |
| 開催数 / デフォルト席数 / Table 名デフォルト / サウンド設定 | 設定 4 種が独立した場所（前 3 つは詳細画面中段、サウンドは別ページ）に分散 | 「設定」タブで集約表示 | 初回訪問は `members` タブが既定 |
| メンバー一覧 / 招待コード | 下段にスクロール必要 | 「メンバー」タブ初期表示で即見える | members は default tab |
| シーズン操作 / ポイントルール | 中段にスクロール必要 | 「シーズン」タブで集約表示 | E2E（[phase-d-share-and-history.spec.ts:181-188](../../../../tests/e2e/phase-d-share-and-history.spec.ts#L181-L188)）は `?tab=season` 直リンクに切替 |
| サウンド設定保存後の navigation | `router.push(backHref)` で `/tournaments/[tid]` / `/tournaments/[tid]/live` / `/groups/[gid]` のいずれかに遷移 | `?from=` クエリ無し: 同一画面に留まり「保存しました」フィードバック表示 / `?from=tournament` または `?from=live`: 従来通り `router.push(backHref)` で遷移 | 「サークルから来た」場合は無遷移が自然（既に居る画面）。tournament / live から来た場合は契約維持で遷移 |
| ブラウザ「戻る」 | URL 変化なし | タブ切替が `?tab=` で履歴に残るため戻ると前タブに戻る | `router.replace` ではなく `router.push` で履歴を残すか、状態保存だけなら `replace` が良いか実装で確定 |

---

## Mandatory Reading

実装前に必ず読むファイル:

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/[gid]/group-detail-client.tsx) | 全件 | 改修対象。Card 8 枚 + 新設サウンド Card を 3 タブに振り分ける |
| P0 | [src/app/groups/[gid]/_components/GroupHeaderCard.tsx](../../../../src/app/groups/[gid]/_components/GroupHeaderCard.tsx) | 全件 | header layout 改修 + 「サウンド設定」リンク削除 |
| P0 | [src/app/groups/[gid]/audio-settings/audio-settings-client.tsx](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx) | 全件 | **タブ内 Card に移植する元コード**。`useAudioPlayer` 取り回し・`?from` 解釈・保存後 navigation を全て理解する必要あり |
| P0 | [src/app/groups/[gid]/audio-settings/page.tsx](../../../../src/app/groups/[gid]/audio-settings/page.tsx) | 全件 | thin redirect への置換対象 |
| P0 | [src/components/nav/nav-items.ts](../../../../src/components/nav/nav-items.ts) | 35-41 | サイドバー「サウンド設定」リンクの href 書換対象 |
| P0 | [src/app/login/login-client.tsx:220-241](../../../../src/app/login/login-client.tsx#L220-L241) | 220-241 | 既存の simple ARIA tablist 実装パターン（mirror 元） |
| P0 | [src/app/join/[tid]/join-client.tsx:266-290](../../../../src/app/join/[tid]/join-client.tsx#L266-L290) | 266-290 | 同上の 2 例目（パターン一貫性確認） |
| P1 | [src/lib/hooks/useAudioPlayer.ts](../../../../src/lib/hooks/useAudioPlayer.ts) | 1-100 | `tournament: null, group, players: [], role` 初期化のセマンティクス確認。タブ内 Card でも同初期化で動く |
| P1 | [.claude/rules/error-logging.md](../../../../.claude/rules/error-logging.md) | 全件 | `console.*` 禁止 / `AppError` ラップ / logger 経由のログ規約。`onSave` の `AppError.from` パターンは維持 |
| P1 | [.claude/rules/testing.md](../../../../.claude/rules/testing.md) | 「mock の境界」「characterization test ファースト」「禁止事項」セクション | 既存 E2E を更新する際の skip 禁止 / 観測可能な振る舞いベースで書き直す |
| P2 | [tests/e2e/pages/GroupsPage.ts:47-113](../../../../tests/e2e/pages/GroupsPage.ts#L47-L113) | 47-113 | `GroupDetailPage` ページオブジェクトの拡張先。タブ操作 + サウンド Card 内 locator を取り込む |
| P2 | [tests/e2e/pages/AudioSettingsPage.ts](../../../../tests/e2e/pages/AudioSettingsPage.ts) | 全件 | 廃止候補。Card 内 locator 群（enabledCheckbox / volumeRange / saveButton 等）を `GroupDetailPage` の audio settings サブセットに移植 |
| P2 | [tests/e2e/audio-settings.spec.ts](../../../../tests/e2e/audio-settings.spec.ts) | 全件 | URL 期待値・heading locator・navigation 確認 7 テスト全件更新対象（特に line 100-104, 138-178, 180-238, 264-289） |
| P2 | [tests/e2e/nav-and-sound-toggle.spec.ts:108-113](../../../../tests/e2e/nav-and-sound-toggle.spec.ts#L108-L113) | 108-113 | サイドバー「サウンド設定」リンクの href 期待値 `/groups/{gid}/audio-settings` → `/groups/{gid}?tab=settings` |
| P2 | [tests/e2e/phase-d-share-and-history.spec.ts:181-203](../../../../tests/e2e/phase-d-share-and-history.spec.ts#L181-L203) | 181-203 | `「シーズンを開始する」` ボタン押下フローが「シーズン」タブで隠れるため修正対象 |
| P2 | [tests/e2e/table-label-and-color.spec.ts:192-201](../../../../tests/e2e/table-label-and-color.spec.ts#L192-L201) | 192-201 | `Table 名デフォルト` カードを member 視点で確認するロケータ。「設定」タブで隠れるため修正対象 |
| P2 | [tests/e2e/note-screenshots.spec.ts:60-75](../../../../tests/e2e/note-screenshots.spec.ts#L60-L75) | 60-75 | `招待コードを発行` ボタン可視性の確認（メンバータブで OK だが念のため） |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| WAI-ARIA Tabs Pattern | https://www.w3.org/WAI/ARIA/apg/patterns/tabs/ | `role="tablist"` / `role="tab"` / `role="tabpanel"` + `aria-controls` / `aria-selected` / 矢印キー操作。本 plan ではキーボード操作は最小限（`tab` キーで focus 移動 + Enter / Space で選択）に留める |
| Next.js App Router useSearchParams | https://nextjs.org/docs/app/api-reference/functions/use-search-params | `useSearchParams()` は Suspense boundary 内で使う必要があるが、本ファイルは既に `RequireAuth` + `"use client"` 配下のため再 wrap 不要 |

新規外部ライブラリ追加なし（依存追加 ask モード回避）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```tsx
// SOURCE: src/app/groups/[gid]/_components/SeasonCard.tsx:30
export function SeasonCard({
  gid,
  seasonStartDate,
  isOrganizer,
  ...
}: { ... }) {
  return (...);
}
```

`_components/` 配下の component は `Pascal Case` でファイル名と export 名を一致させる。Props は inline interface か `: { ... }` 直書きの両方が混在しているが、`MemberRoleList` / `GroupHeaderCard` は `interface XxxProps` 派なので新設の `GroupDetailTabs` も同形を採用。

### TAB_LIST_PATTERN（既存パターンを mirror）

```tsx
// SOURCE: src/app/login/login-client.tsx:220-241
<div role="tablist" className="flex gap-1 border-b text-sm">
  {(
    [
      ["login", "ログイン"],
      ["register", "新規登録"],
    ] as [Mode, string][]
  ).map(([value, label]) => (
    <button
      key={value}
      role="tab"
      aria-selected={mode === value}
      onClick={() => changeMode(value)}
      className={`border-b-2 px-3 py-2 ${
        mode === value
          ? "border-primary font-medium"
          : "border-transparent text-muted-foreground"
      }`}
    >
      {label}
    </button>
  ))}
</div>
```

本 plan の差分:
- `aria-controls` / `id` / `tabpanel` は既存パターンが付与していないが、本 plan では a11y を一段強化するため `tabpanel` ロールを panel 側に付与し、`aria-controls` で紐付ける（既存パターンへの厳密 mirror より a11y 規約 [.claude/rules](../../../../.claude/rules/) 配下に直接 ARIA 規約は無いが、トーナメント運営という public-facing ツールとして強化が望ましい）。
- 横スクロール対策で tablist には `flex` ではなく `grid grid-cols-3` を使い、3 タブ等幅で並べる（モバイル幅でも崩れない）。

### URL_QUERY_STATE_PATTERN

```tsx
// SOURCE: src/app/groups/[gid]/audio-settings/audio-settings-client.tsx:32-59
const searchParams = useSearchParams();

const { backHref, backLabel } = useMemo(() => {
  const from = searchParams.get("from");
  ...
}, [searchParams, gid]);
```

`useSearchParams` を `useMemo` で読み出す既存パターン。本 plan では:

```tsx
// 派生読出し
const tabParam = searchParams.get("tab");
const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "members";

// 切替（履歴に残さず replace で URL 同期）
const router = useRouter();
const pathname = usePathname();  // /groups/[gid]
const onChangeTab = (next: TabKey) => {
  const sp = new URLSearchParams(searchParams);
  sp.set("tab", next);
  router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
};
```

`router.push` ではなく `router.replace` を採用（同一画面内のタブ切替を「戻る」で辿らせない方が UX 自然）。`scroll: false` でタブ切替時のスクロール位置を保つ。

### ERROR_HANDLING（既存維持）

タブ切替自体に AppError ラップ対象の async 操作は無い。既存の `onRename` / `onIssueCode` / `onLeave` / `onDelete` / `onStartSeason` / `onSaveSeasonPointsRule` / `onResetSeasonPointsRule` / `runRoleAction` の `unwrapOrFrom` パターン（[group-detail-client.tsx:131-329](../../../../src/app/groups/[gid]/group-detail-client.tsx#L131-L329)）はそのまま維持し、エラー表示の `setError` 呼び出しはタブの外（main 直下）に残す。

```tsx
// SOURCE: src/app/groups/[gid]/group-detail-client.tsx:177-188
if (error) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
      <Link href="/groups">
        <Button variant="outline">サークル一覧へ</Button>
      </Link>
    </main>
  );
}
```

### LOGGING_PATTERN（既存維持）

タブ切替に新規ログ追加なし。既存の `logger.debug("self-backfill skipped", ...)` / `logger.warn("clipboard copy failed", ...)` 等はそのまま。

### COMPONENT_SPLIT_PATTERN（Phase 4 architect-refactor 以降の慣例）

```tsx
// SOURCE: src/app/groups/[gid]/_components/MemberRoleList.tsx:50
/**
 * サークル詳細画面のメンバー一覧（3 階層ロール操作付き）。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` から分離。
 * ...
 */
export function MemberRoleList({ ... }: MemberRoleListProps) {
```

新設 `GroupDetailTabs.tsx` も同形 JSDoc を付ける（「Phase 02 polish (タブ化) で `group-detail-client.tsx` から分離」）。

### TEST_STRUCTURE（E2E）

```ts
// SOURCE: tests/e2e/groups-navigation.spec.ts:20-40
test.describe("/groups/[gid] からの画面遷移", () => {
  test("group detail page では sidebar の group サブ項目が現在の gid を指す", async ({
    page,
  }) => {
    const organizer = randomOrganizer("nav");
    await registerOrganizer(page, organizer);
    const gid = await createGroup(page, "E2E Navigation");
    await expect(page).toHaveURL(new RegExp(`/groups/${gid}$`));
    ...
  });
});
```

既存 fixture（`registerOrganizer` / `createGroup` / `consumeInviteUrl` / `issueInviteUrl`）を流用してタブ切替の振る舞いを観測可能 UI で検証。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | Card 8 枚 + サウンド Card を 3 タブ panel に振り分け、`useSearchParams` でアクティブタブを駆動。`error` / dialogs / `GroupHeaderCard` はタブ外に残す |
| `src/app/groups/[gid]/_components/GroupHeaderCard.tsx` | UPDATE | ルート `<header>` を `flex-col gap-3 sm:flex-row sm:items-start sm:justify-between` に変更し、ボタン列を独立した子要素に。**「サウンド設定」リンクボタンと `isOrganizer` prop を削除** |
| `src/app/groups/[gid]/_components/GroupDetailTabs.tsx` | CREATE | tablist + tabpanel ラッパ。`activeTab: TabKey` と `onChange` を props で受け取る presentational component。子要素は `tabs` map（`{ members: ReactNode, season: ReactNode, settings: ReactNode }`）として受ける |
| `src/app/groups/[gid]/_components/AudioSettingsCard.tsx` | CREATE | `audio-settings-client.tsx` のロジック（enabled / sound id 2 種 / volume / preview / 保存）を Card 化。`?from` `?tid` クエリ解釈と保存後 navigation を維持。organizer 限定（呼出側で gating） |
| `src/app/groups/[gid]/audio-settings/page.tsx` | UPDATE | `RequireAuth` + `AudioSettingsClient` を `redirect()` に置換。`?from=` `?tid=` クエリは保存して `/groups/[gid]?tab=settings&from=...&tid=...` に転送 |
| `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx` | DELETE | ロジックは `AudioSettingsCard.tsx` に完全移植 |
| `src/components/nav/nav-items.ts` | UPDATE | サイドバー「サウンド設定」リンクの href を `/groups/{currentGroupId}?tab=settings` に書換 |
| `tests/e2e/pages/GroupsPage.ts` | UPDATE | `GroupDetailPage` に `tabButton(key)` / `selectTab(key)` + audio settings 用 locator（`audioEnabledCheckbox` / `audioVolumeRange` / `audioSaveButton` 等）を追加 |
| `tests/e2e/pages/AudioSettingsPage.ts` | DELETE | locator 群を `GroupDetailPage` のサブセットに統合 |
| `tests/e2e/group-detail-tabs.spec.ts` | CREATE | 新規 E2E（タブ切替 / 既定 = members / `?tab=season` 直リンク復元 / 各タブで対応 Card のみ可視 / ヘッダ rename 中も削除ボタンが押せる == 重なってない事を観測） |
| `tests/e2e/audio-settings.spec.ts` | UPDATE | URL 期待値・heading locator・navigation を全 7 テストで全更新（詳細は Task 9-10）|
| `tests/e2e/nav-and-sound-toggle.spec.ts` | UPDATE | サイドバー「サウンド設定」リンクの href 期待値 1 行更新 |
| `tests/e2e/phase-d-share-and-history.spec.ts` | UPDATE | 「シーズンを開始する」ボタン押下前に `?tab=season` 直リンクに変更 |
| `tests/e2e/table-label-and-color.spec.ts` | UPDATE | member 視点で `Table 名デフォルト` を確認する箇所で `?tab=settings` 直リンクに変更 |

## NOT Building

- **`@radix-ui/react-tabs` の追加導入** — 既存 ARIA tablist パターンが 2 か所で動作確認済のため、依存追加 ask モードと package size 増を避ける。将来全プロダクトで shadcn Tabs が必要になったタイミングで一括移行する。
- **タブ切替のキーボード矢印操作** — WAI-ARIA APG では tablist 内で left/right arrow による focus 移動を要求するが、既存 [`login-client.tsx`](../../../../src/app/login/login-client.tsx) / [`join-client.tsx`](../../../../src/app/join/[tid]/join-client.tsx) も実装していないため一貫性優先で skip。Tab + Enter / Space の標準 button focus 動作のみで運用。
- **モバイル用 BottomNav / セレクタ UI** — 3 タブが等幅 grid で十分収まる（375px で各タブ約 119px）。視覚的に窮屈になった場合のみ別途検討。
- **タブ ごとのデータプリフェッチ最適化** — 全 Card は親で取得済みの `group` / `members` を read するだけで、タブ切替で fetch は走らない。プリフェッチ不要。
- **scroll-restoration の細工** — `router.replace(..., { scroll: false })` で十分。タブ切替で scroll top に戻る挙動は不要。
- **PRD への反映 / Phase 番号付与** — 本 plan は Phase A〜E 完了後の polish であり、PRD 02 の「Implementation Phases」テーブルへの新規行追加は不要（report 執筆時に PRD 内 Decisions Log に「タブ化 polish 実施 + サウンド設定統合」を 1 行加筆する程度）。
- **schema / rule / repository / service 層の変更** — UI のみの polish。`groups/{gid}` の field・rule・write 経路（`updateAudioSettings` / `audioSettings` map）は一切変えない。drift check や emulator validator も追加不要。
- **`useAudioPlayer` の signature 変更** — タブ Card 側でも `tournament: null, group, players: [], role` で初期化。hook 自体は touch しない（[useAudioPlayer.ts:59](../../../../src/lib/hooks/useAudioPlayer.ts#L59) の「audio-settings 経由」コメントのみ更新）。
- **旧 URL `/groups/[gid]/audio-settings` の完全削除** — thin redirect で残すため 404 にはしない。古いブックマーク・サイドバーキャッシュ・`?from=live&tid=` URL 直リンクが破綻するのを避ける。1〜2 リリース後に redirect ページごと削除する別 plan を切り出す可能性は残す。
- **`AudioSettingsCard` 内での「キャンセル」ボタン** — 旧独立ページでは保存せず戻るための「キャンセル」リンクが必要だったが、タブ内 Card では「保存しない = そのまま他タブへ移動 / ページを閉じる」で済むため非搭載。`?from=tournament` / `?from=live` から来た場合の「戻る」リンクのみ Card 内 header に表示（既存の `← トーナメント受付へ戻る` / `← 全画面表示へ戻る` を踏襲）。

---

## Step-by-Step Tasks

### Task 1: TabKey 型と URL 同期 helper を group-detail-client.tsx に追加

- **ACTION**: `group-detail-client.tsx` に `TabKey` union type と `isTabKey` type guard を追加し、`useSearchParams` / `useRouter` / `usePathname` で active tab を駆動する。
- **IMPLEMENT**:
  ```tsx
  import { usePathname, useRouter, useSearchParams } from "next/navigation";
  ...
  type TabKey = "members" | "season" | "settings";
  const TAB_KEYS = ["members", "season", "settings"] as const;
  function isTabKey(s: string | null): s is TabKey {
    return s !== null && (TAB_KEYS as readonly string[]).includes(s);
  }
  ...
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const tabParam = searchParams.get("tab");
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : "members";
  const onChangeTab = useCallback(
    (next: TabKey) => {
      const sp = new URLSearchParams(searchParams.toString());
      sp.set("tab", next);
      router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  ```
- **MIRROR**: `URL_QUERY_STATE_PATTERN`（[audio-settings-client.tsx:32-59](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx#L32-L59)）。
- **IMPORTS**: `usePathname` を `next/navigation` から既存 import に追加（既に `useRouter` が import されているので並べる）。
- **GOTCHA**:
  - `useSearchParams` は client component 限定。本 file は既に `"use client"` のため OK。
  - `router.replace` で `scroll: false` を指定しないと、タブ切替で `<main>` の top に jump する可能性がある（特にタブ panel の高さが切替で変わるとき）。
  - 既存 `useRouter` の import を再利用すること（同一 hook を 2 度呼ばない）。
- **VALIDATE**:
  - `npm run typecheck` で `TabKey` / `isTabKey` の型エラーが無い。
  - DevTools Console で `?tab=foo` を貼ったとき `activeTab === "members"` にフォールバックすることを確認。

### Task 2: GroupDetailTabs.tsx を新設

- **ACTION**: `_components/GroupDetailTabs.tsx` を作成し、tablist UI と tabpanel slot を提供する presentational component を export する。
- **IMPLEMENT**:
  ```tsx
  "use client";

  import { cn } from "@/lib/utils";

  export type TabKey = "members" | "season" | "settings";

  interface TabDef {
    key: TabKey;
    label: string;
  }

  const TABS: readonly TabDef[] = [
    { key: "members", label: "メンバー" },
    { key: "season", label: "シーズン" },
    { key: "settings", label: "設定" },
  ];

  interface GroupDetailTabsProps {
    activeTab: TabKey;
    onChange: (next: TabKey) => void;
    children: { [K in TabKey]: React.ReactNode };
  }

  /**
   * サークル詳細画面の 3 タブ切替ラッパ。
   *
   * PRD 02 polish (タブ化) で `group-detail-client.tsx` から分離。
   * 既存の `role="tablist"` パターン（login-client.tsx / join-client.tsx）を
   * mirror しつつ、3 タブ等幅 grid + tabpanel ロール付与で a11y を強化。
   * children は `{ members, season, settings }` の map で受け取り、
   * 非アクティブ panel は `hidden` 属性で DOM から外す（render は維持され state 保持）。
   */
  export function GroupDetailTabs({
    activeTab,
    onChange,
    children,
  }: GroupDetailTabsProps) {
    return (
      <div className="space-y-4">
        <div role="tablist" aria-label="サークル詳細" className="grid grid-cols-3 gap-1 border-b text-sm">
          {TABS.map(({ key, label }) => {
            const selected = activeTab === key;
            return (
              <button
                key={key}
                id={`group-detail-tab-${key}`}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={`group-detail-panel-${key}`}
                onClick={() => onChange(key)}
                className={cn(
                  "border-b-2 px-3 py-2 transition-colors",
                  selected
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            );
          })}
        </div>
        {TABS.map(({ key }) => (
          <div
            key={key}
            id={`group-detail-panel-${key}`}
            role="tabpanel"
            aria-labelledby={`group-detail-tab-${key}`}
            hidden={activeTab !== key}
            className="space-y-6"
          >
            {children[key]}
          </div>
        ))}
      </div>
    );
  }
  ```
- **MIRROR**: `TAB_LIST_PATTERN`（[login-client.tsx:220-241](../../../../src/app/login/login-client.tsx#L220-L241)）+ a11y 強化（`aria-controls` / `aria-labelledby` / `role="tabpanel"` 追加）。コメント形式は [`MemberRoleList.tsx:50`](../../../../src/app/groups/[gid]/_components/MemberRoleList.tsx#L50) に倣う。
- **IMPORTS**: `cn` from `@/lib/utils`。React は `"use client"` 配下なら自動。
- **GOTCHA**:
  - `hidden` 属性で非アクティブ panel を非表示にする（CSS `display: none`）。`{activeTab === key && children[key]}` のような conditional render にすると、Card 内の inline edit state が unmount で破棄される。今回は破棄して問題無いが、`hidden` の方が UX 的にはタブ切替の往復が速い。
  - `space-y-6` は元の `<main>` と同じ縦間隔を維持。
  - `aria-label="サークル詳細"` は tablist の説明（screen reader 向け）。
- **VALIDATE**:
  - `npm run typecheck` で `children: { [K in TabKey]: React.ReactNode }` の制約が機能していることを確認（`children.members` 等が必須）。
  - DevTools の Accessibility tree で各タブが `tab` ロール、各 panel が `tabpanel` ロールで認識されていることを確認。

### Task 3: GroupHeaderCard を 縦 2 段レイアウトに変更 + 「サウンド設定」リンク削除

- **ACTION**: `GroupHeaderCard.tsx` のルート `<header>` の className と子要素配置を変更し、`isOrganizer` prop と「サウンド設定」`<Link>` を削除。
- **IMPLEMENT**:
  ```tsx
  // BEFORE: src/app/groups/[gid]/_components/GroupHeaderCard.tsx:97-173
  <header className="flex items-start justify-between gap-4">
    <div className="min-w-0 flex-1">
      {/* タイトル + edit form */}
      ...
      <p className="mt-1 text-sm text-muted-foreground">メンバー X 人 ...</p>
    </div>
    <div className="flex flex-wrap gap-2">
      <Link href="/groups"><Button>一覧へ</Button></Link>
      {isOrganizer ? (
        <Link href={`/groups/${group.id}/audio-settings`}>
          <Button>サウンド設定</Button>
        </Link>
      ) : null}
      {isOwner ? (
        <Button variant="destructive" onClick={onRequestDelete}>削除</Button>
      ) : (
        <Button variant="destructive" onClick={onRequestLeave}>脱退</Button>
      )}
    </div>
  </header>

  // AFTER:
  <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
    <div className="min-w-0 flex-1">
      {/* タイトル + edit form（変更なし） */}
      ...
      <p className="mt-1 text-sm text-muted-foreground">メンバー X 人 ...</p>
    </div>
    <div className="flex flex-wrap gap-2 self-start sm:self-auto">
      <Link href="/groups"><Button>一覧へ</Button></Link>
      {/* サウンド設定リンクは削除（タブに集約） */}
      {isOwner ? (
        <Button variant="destructive" onClick={onRequestDelete}>削除</Button>
      ) : (
        <Button variant="destructive" onClick={onRequestLeave}>脱退</Button>
      )}
    </div>
  </header>
  ```
- **PROPS 削減**: `GroupHeaderCardProps` から `isOrganizer: boolean` を削除（サウンド設定リンクの gate 用途のみだったため）。`group-detail-client.tsx` の `<GroupHeaderCard>` 呼出側も対応 prop を削除。
- **MIRROR**: tailwind の breakpoint 切替パターンは [groups-client.tsx:29](../../../../src/app/groups/groups-client.tsx#L29) の `flex items-center justify-between` と整合させつつ、モバイル列方向に変更。
- **IMPORTS**: 変更なし（`Link` は「一覧へ」で引き続き使う）。
- **GOTCHA**:
  - `sm:` ブレイクポイントは tailwind 既定で 640px。本プロジェクトは tailwind 既定値を使用。`tailwind.config.ts` の `screens` を Read して確認すること。
  - `flex-wrap` は維持（owner で「削除」「一覧へ」 2 ボタン + 細幅 sm 端末で wrap が起きる可能性は低いが、safety として維持）。
  - inline edit form 自身は `<form className="flex items-center gap-2">` のまま（form 内の Input + 保存 + キャンセルは横並びを保つ）。これがヘッダの flex-col 化により独自の行を占有するため、右ボタン群と重ならない。
  - `self-start` をボタン列に付与してモバイルで左寄せに保つ（タイトル左寄せと整合）。
  - `isOrganizer` は `group-detail-client.tsx` 側でも引き続き他の Card（`InviteCodeCard` / `AudioSettingsCard` 等）の gate に使うため、変数自体は削除しないこと。`<GroupHeaderCard>` への prop 渡しだけ削除する。
- **VALIDATE**:
  - `npm run dev` で Chrome DevTools mobile mode（375px）に切替、サークル名の Pencil をクリックし inline edit に入る。「保存 / キャンセル」ボタンと「一覧へ / 削除」ボタンが**別の行に並び、サウンド設定ボタンが消えている**ことを目視確認。
  - 同じ操作を `sm` 以上（768px）で行い、従来通り横並びになることを確認。
  - `npm run typecheck` で `GroupHeaderCardProps` から `isOrganizer` 削除後の呼出側型エラーが無いこと。

### Task 4: AudioSettingsCard.tsx を新設（audio-settings-client.tsx のロジック移植）

- **ACTION**: `_components/AudioSettingsCard.tsx` を作成し、現在 `audio-settings-client.tsx` が担っているサウンド設定 UI / 保存ロジック / `?from=` 戻り先制御を Card 化する。
- **IMPLEMENT**:
  ```tsx
  "use client";

  import Link from "next/link";
  import { useRouter, useSearchParams } from "next/navigation";
  import { useCallback, useMemo, useState } from "react";

  import { Button } from "@/components/ui/button";
  import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
  } from "@/components/ui/card";
  import { Input } from "@/components/ui/input";
  import { listAvailableSounds } from "@/lib/audio/sound-catalog";
  import { AppError } from "@/lib/errors";
  import { updateAudioSettings } from "@/lib/firebase/repositories/groups";
  import {
    DEFAULT_AUDIO_SETTINGS,
    type AudioSettings,
    type GroupDoc,
    type MemberRole,
  } from "@/lib/firebase/schemas/group";
  import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";

  interface AudioSettingsCardProps {
    /** タブ呼出側で fetch 済みの group。null の間は親が render しない前提（呼出側で gating）。 */
    group: GroupDoc;
    /** 現在ユーザの role。`useAudioPlayer` 経由で audio operator 判定に使う。 */
    role: MemberRole | null;
    /** 保存成功時のリロード（親の reload + refreshGroups を再走させる）。 */
    onSaved: () => Promise<void>;
    /** 保存失敗時のエラー通知（親の setError と接続）。 */
    onError: (message: string) => void;
  }

  /**
   * Phase 02 polish (タブ化) で `audio-settings/audio-settings-client.tsx` から
   * Card 化したサウンド設定エディタ。organizer / owner のみ表示する想定（呼出側で gating）。
   *
   * - `?from=tournament&tid=...` / `?from=live&tid=...` の戻り先契約は維持し、
   *   保存成功後に `router.push(backHref)` で当該画面へ遷移する。
   * - `?from=` 無し（サークル詳細から開いた場合）は遷移せず、Card 内に保存完了
   *   フィードバックを表示して同一画面に留まる。
   */
  export function AudioSettingsCard({
    group,
    role,
    onSaved,
    onError,
  }: AudioSettingsCardProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const [settings, setSettings] = useState<AudioSettings>(
      group.audioSettings ?? DEFAULT_AUDIO_SETTINGS,
    );
    const [working, setWorking] = useState(false);
    const [savedFlash, setSavedFlash] = useState(false);

    // backHref / backLabel は audio-settings-client.tsx と同形を維持。
    // `?from=` 無しのときは null を返し、保存後に遷移しない。
    const back = useMemo(() => {
      const from = searchParams.get("from");
      const tid = searchParams.get("tid");
      const tidValid = !!tid && /^[A-Za-z0-9_-]+$/.test(tid);
      if (tidValid) {
        if (from === "tournament") {
          return { href: `/tournaments/${tid}`, label: "← トーナメント受付へ戻る" };
        }
        if (from === "live") {
          return { href: `/tournaments/${tid}/live`, label: "← 全画面表示へ戻る" };
        }
      }
      return null;
    }, [searchParams]);

    const player = useAudioPlayer({
      tournament: null,
      group,
      players: [],
      role,
    });

    const onSave = useCallback(async () => {
      setWorking(true);
      setSavedFlash(false);
      try {
        await updateAudioSettings(group.id, settings);
        await onSaved();
        if (back) {
          router.push(back.href);
        } else {
          setSavedFlash(true);
          setTimeout(() => setSavedFlash(false), 2000);
        }
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "firestore/write_failed",
          "サウンド設定の更新に失敗しました",
        );
        onError(`${wrapped.code}: ${wrapped.message}`);
      } finally {
        setWorking(false);
      }
    }, [group.id, settings, router, back, onSaved, onError]);

    const sounds = listAvailableSounds();

    return (
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle>サウンド設定</CardTitle>
              <CardDescription>
                ブラインド変更／優勝確定で音を鳴らします。設定はサークル全体に反映されます。
              </CardDescription>
            </div>
            {back ? (
              <Link href={back.href} className="text-sm text-muted-foreground">
                {back.label}
              </Link>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 旧 audio-settings-client.tsx 内 ::CardContent の中身を踏襲 */}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={(e) =>
                setSettings((s) => ({ ...s, enabled: e.target.checked }))
              }
            />
            <span>通知音を有効にする</span>
          </label>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <span>ブラインド変更時:</span>
                <select
                  value={settings.levelUpSoundId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, levelUpSoundId: e.target.value }))
                  }
                  className="rounded border px-2 py-1"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void player.preview(settings.levelUpSoundId)}
              >
                試聴
              </Button>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-sm">
              <label className="flex items-center gap-2">
                <span>優勝確定時:</span>
                <select
                  value={settings.winnerSoundId}
                  onChange={(e) =>
                    setSettings((s) => ({ ...s, winnerSoundId: e.target.value }))
                  }
                  className="rounded border px-2 py-1"
                >
                  {sounds.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void player.preview(settings.winnerSoundId)}
              >
                試聴
              </Button>
            </div>
          </div>

          <label className="block space-y-1 text-sm">
            <span>音量: {Math.round(settings.volume * 100)}%</span>
            <Input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.volume}
              onChange={(e) =>
                setSettings((s) => ({ ...s, volume: Number(e.target.value) }))
              }
            />
          </label>

          <div className="flex items-center justify-end gap-2">
            {savedFlash ? (
              <span className="text-sm text-emerald-700" role="status">
                保存しました
              </span>
            ) : null}
            <Button onClick={() => void onSave()} disabled={working}>
              {working ? "保存中…" : "保存"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }
  ```
- **MIRROR**:
  - **`?from=` 解釈**は [audio-settings-client.tsx:38-59](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx#L38-L59) を移植。
  - **`useAudioPlayer` 初期化**は [audio-settings-client.tsx:84-89](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx#L84-L89) を移植。
  - **保存ハンドラ**は [audio-settings-client.tsx:91-107](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx#L91-L107) を移植 + `back` null 分岐の追加。
  - **JSDoc コメント形式**は [`MemberRoleList.tsx:50`](../../../../src/app/groups/[gid]/_components/MemberRoleList.tsx#L50) に倣う。
- **IMPORTS**: 上記 import 群（既に audio-settings-client.tsx で使われているもの + `Card` 系）。
- **GOTCHA**:
  - **`useEffect` での group fetch / role 判定は移植しない**。本 Card は親 `group-detail-client.tsx` で fetch 済みの `group` を props で受け取り、role gate も親で行う（`isOrganizer ? <AudioSettingsCard ... /> : null`）。member 視点では `<AudioSettingsCard>` 自体が render されないため、内部で `router.replace("/groups/[gid]")` する必要なし。
  - **`error` state は親と統合**。Card 内の保存失敗は `onError` callback で親に通知し、親の `setError` 経由で main 直下のエラーバナーに表示する（既存 pattern 維持）。
  - **保存後 `router.push(back.href)`** は `back !== null` のときのみ。`back` null 時は同一画面に留まり、`savedFlash` の 2 秒間表示でフィードバック。
  - **`onSaved` callback** は親の `reload` + `refreshGroups` を呼ぶ（タブ Card は永続化された値を再 fetch する責任を持たない）。
  - `<Card>` の `CardHeader` 内に `<Link>` を入れる場合、CardTitle と back link が同じ行に並ぶ（`flex items-start justify-between gap-2`）。
- **VALIDATE**:
  - `npm run typecheck` で type error 無し。
  - `npm run dev` で「設定」タブを開き、organizer 視点で AudioSettingsCard が render されることを確認。
  - `?from=tournament&tid=xxx` でクエリを付けて `/groups/[gid]?tab=settings&from=tournament&tid=xxx` を直接開き、Card header に「← トーナメント受付へ戻る」が出ることを確認。

### Task 5: audio-settings/page.tsx を thin redirect に置換

- **ACTION**: `app/groups/[gid]/audio-settings/page.tsx` の中身を `redirect()` に置換し、`?from=` `?tid=` クエリを保持して `/groups/[gid]?tab=settings` に転送する。
- **IMPLEMENT**:
  ```tsx
  // BEFORE: src/app/groups/[gid]/audio-settings/page.tsx (full)
  import { RequireAuth } from "@/components/auth/RequireAuth";
  import { AudioSettingsClient } from "./audio-settings-client";

  export default async function AudioSettingsPage({
    params,
  }: {
    params: Promise<{ gid: string }>;
  }) {
    const { gid } = await params;
    return (
      <RequireAuth allowAnonymous={false}>
        <AudioSettingsClient gid={gid} />
      </RequireAuth>
    );
  }

  // AFTER:
  import { redirect } from "next/navigation";

  export default async function AudioSettingsPage({
    params,
    searchParams,
  }: {
    params: Promise<{ gid: string }>;
    searchParams: Promise<Record<string, string | string[] | undefined>>;
  }) {
    const { gid } = await params;
    const sp = await searchParams;
    const query = new URLSearchParams();
    query.set("tab", "settings");
    const from = sp.from;
    const tid = sp.tid;
    if (typeof from === "string") query.set("from", from);
    if (typeof tid === "string" && /^[A-Za-z0-9_-]+$/.test(tid)) {
      query.set("tid", tid);
    }
    redirect(`/groups/${gid}?${query.toString()}`);
  }
  ```
- **MIRROR**: Next.js App Router の `redirect()` を server component で使う標準パターン。
- **IMPORTS**: `redirect` from `next/navigation`。`RequireAuth` / `AudioSettingsClient` の import は削除。
- **GOTCHA**:
  - **`RequireAuth` を使わない理由**: redirect は auth 状態より先に行いたい。redirect 先のページ側 `RequireAuth(allowAnonymous=false)` 設定（[group-detail/page.tsx](../../../../src/app/groups/[gid]/page.tsx) を要確認）で auth gate が効くため、redirect ページで再 gate しない。anonymous user が redirect 先で再 redirect されるが、これは anonymous でも `audio-settings` を踏める従来挙動と非互換。要確認: 現状の `RequireAuth allowAnonymous={false}` は anonymous を `/login` に redirect していたため、anonymous → `/groups/[gid]?tab=settings` → group-detail で再 RequireAuth → `/login` の **2 段 redirect**になる。実装時に group-detail の `RequireAuth` 設定が anonymous をどう扱うかを確認し、必要なら `audio-settings/page.tsx` 側でも `RequireAuth` を残す案に切替（その場合 `redirect` を `client component` 内で行う必要が出るため、`audio-settings-client.tsx` を thin redirect client にする選択肢もある）。
  - **`tid` バリデーション**は `audio-settings-client.tsx` の既存 `^[A-Za-z0-9_-]+$` を踏襲する（不正値は drop）。
  - `searchParams` を Next.js 15 では Promise として受け取る（既存 `params` 同様）。
- **VALIDATE**:
  - `npm run dev` で `/groups/[gid]/audio-settings` にアクセスし、`/groups/[gid]?tab=settings` に redirect されることを確認。
  - `/groups/[gid]/audio-settings?from=live&tid=t-1` で `/groups/[gid]?tab=settings&from=live&tid=t-1` に redirect されることを確認。
  - `/groups/[gid]/audio-settings?tid=invalid space` のような不正 tid で tid が drop された URL に redirect されることを確認。
  - anonymous user で同 URL を踏み、最終的に `/login` に到達することを確認（多段 redirect の挙動確認）。

### Task 6: audio-settings-client.tsx を削除

- **ACTION**: `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx` を **完全削除**。
- **IMPLEMENT**: `git rm src/app/groups/[gid]/audio-settings/audio-settings-client.tsx`
- **MIRROR**: 該当なし（削除のみ）。
- **IMPORTS**: 該当なし。
- **GOTCHA**:
  - 削除前に grep で `from .*audio-settings-client` / `import.*AudioSettingsClient` が他に無いことを確認。Task 5 で `page.tsx` から import を削除済のはず。
  - `useAudioPlayer.ts:59` のコメント `// （dashboard / live / audio-settings）で unlock 状態を共有する必要がある。` を `// （dashboard / live / 設定タブ）で unlock 状態を共有する必要がある。` に更新（コメントのみ修正、コードは無変更）。
- **VALIDATE**:
  - `npm run typecheck` / `npm run build` で broken import が無いこと。
  - `git status` で削除が正しく反映されていること。

### Task 7: nav-items.ts のサウンド設定リンク href を `?tab=settings` に書換

- **ACTION**: `src/components/nav/nav-items.ts` の「サウンド設定」エントリの `href` resolver を更新。
- **IMPLEMENT**:
  ```ts
  // BEFORE: src/components/nav/nav-items.ts:35-41
  {
    href: (ctx) => (ctx.currentGroupId ? `/groups/${ctx.currentGroupId}/audio-settings` : null),
    label: "サウンド設定",
    icon: Volume2,
    authOnly: true,
    visible: (ctx) => !!ctx.currentGroupId && ctx.isOrganizer,
  },

  // AFTER:
  {
    href: (ctx) =>
      ctx.currentGroupId ? `/groups/${ctx.currentGroupId}?tab=settings` : null,
    label: "サウンド設定",
    icon: Volume2,
    authOnly: true,
    visible: (ctx) => !!ctx.currentGroupId && ctx.isOrganizer,
  },
  ```
- **MIRROR**: 同 file の他エントリは触らない。
- **IMPORTS**: 変更なし。
- **GOTCHA**:
  - `?tab=settings` クエリ付き path で aria-current 判定が問題ないか確認（PrimaryNav の active path 判定が pathname のみで query を見ないなら OK。query を含む比較になっているなら `currentGroupId` のサブ link との重複に注意）。
  - サイドバーの label「サウンド設定」は変えない（運営者の認知が変わらないように）。
- **VALIDATE**:
  - `npm run dev` でサイドバーの「サウンド設定」をクリックし `/groups/{gid}?tab=settings` に遷移することを確認。
  - サークル選択中 + organizer のみリンクが visible であることを確認。

### Task 8: group-detail-client.tsx の Card 群を 3 タブ panel に振り分け（AudioSettingsCard 含む）

- **ACTION**: `<main>` 配下の Card を 3 タブに割り当て、`<GroupDetailTabs>` で wrap。`AudioSettingsCard` を「設定」タブに追加。
- **IMPLEMENT**:
  ```tsx
  // 既存のフック / handler / GroupHeaderCard / dialogs はそのまま維持。
  // 末尾の return ( <main>...</main> ) を以下に置換。

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <GroupHeaderCard ... />  {/* isOrganizer prop を削除 */}

      <GroupDetailTabs activeTab={activeTab} onChange={onChangeTab}>
        {{
          members: (
            <>
              {isOrganizer ? <InviteCodeCard ... /> : null}
              <MemberRoleList ... />
            </>
          ),
          season: (
            <>
              <SeasonCard ... />
              <SeasonPointsRuleCard ... />
            </>
          ),
          settings: (
            <>
              <InlineNumberEditCard
                title="開催数"
                ...
              />
              <InlineNumberEditCard
                title="1 Table あたりの席数（デフォルト）"
                ...
              />
              <GroupDefaultTableLabelsCard ... />
              {isOrganizer ? (
                <AudioSettingsCard
                  group={group}
                  role={myRole}
                  onSaved={async () => {
                    await reload();
                    await refreshGroups();
                  }}
                  onError={setError}
                />
              ) : null}
            </>
          ),
        }}
      </GroupDetailTabs>

      <LeaveDeleteDialogs ... />
      <StartSeasonDialog ... />
    </main>
  );
  ```
- **MIRROR**: 設定タブは元の Card 並び順を保つ + サウンド Card を「設定」タブの末尾に追加（他の設定 Card より optional 度が高いため最下段）。**メンバータブは招待コードを上段、メンバー一覧を下段に配置**（organizer が新メンバー追加 → 一覧で確認の流れに沿わせ、招待コード発行ボタン / QR が画面上部にあると CTA としても見やすい）。
- **IMPORTS**: `GroupDetailTabs` / `AudioSettingsCard` を `./_components/` から import。`TabKey` も同 file から import（または再定義）。
- **GOTCHA**:
  - `children` を object literal `{{ members: ..., season: ..., settings: ... }}` で渡すため、外側 `{}` が JSX expression、内側 `{}` が object literal の二重波括弧。
  - dialog 系（`LeaveDeleteDialogs` / `StartSeasonDialog`）はタブの**外**に残す。Radix Portal で body 直下に描画されるため位置はどこでも良いが、タブと state を分離する意味で main 直下が適切。
  - `error` 表示の early return（main 直下の `<p role="alert">`）は変更しない。`AudioSettingsCard` の `onError` callback から呼ばれた `setError` も同じバナーに集約される。
  - `!group` 時の loading 表示も変更しない。
  - `AudioSettingsCard` は member には render されない（`isOrganizer` gate）。member visit で `?tab=settings` 直リンクを踏んでも、開催数 / デフォルト席数 / Table 名デフォルトは read-only 表示されるが、サウンド Card は完全に非表示。
- **VALIDATE**:
  - `npm run dev` で各タブを切替、各 Card が想定タブにのみ表示されることを目視確認。
  - URL bar が `?tab=season` 等に同期することを確認。
  - 「設定」タブで AudioSettingsCard が見え、保存ボタンで保存 → savedFlash「保存しました」が 2 秒表示されることを確認。
  - ブラウザ戻るボタンでタブが履歴を辿らない（`router.replace` で同一履歴 entry を上書き）ことを確認。

### Task 9: GroupsPage.ts に tab helper + サウンド Card locator を追加

- **ACTION**: `tests/e2e/pages/GroupsPage.ts` の `GroupDetailPage` クラスに `selectTab` / `tabButton` + サウンド設定 Card 用 locator 群を追加。
- **IMPLEMENT**:
  ```ts
  // 既存メソッドの末尾に追加:
  tabButton(key: "members" | "season" | "settings"): Locator {
    return this.page.getByRole("tab", { name: this.tabLabel(key) });
  }

  private tabLabel(key: "members" | "season" | "settings"): string {
    if (key === "members") return "メンバー";
    if (key === "season") return "シーズン";
    return "設定";
  }

  /** 指定タブをクリックし、対応 panel が visible になるまで待つ。 */
  async selectTab(key: "members" | "season" | "settings"): Promise<void> {
    await this.tabButton(key).click();
    // tabpanel の id 属性で待つ（hidden 属性切替を Playwright が `visible` 判定する）
    await expect(this.page.locator(`#group-detail-panel-${key}`)).toBeVisible();
  }

  // === サウンド設定 Card 内 locator（旧 AudioSettingsPage.ts から移行） ===
  // 「設定」タブ内に配置されるため、ロケータは tabpanel scope に限定する。
  private get audioCardScope(): Locator {
    return this.page.locator("#group-detail-panel-settings");
  }
  readonly audioCardTitle: Locator = this.audioCardScope.getByRole("heading", {
    name: "サウンド設定",
  });
  readonly audioEnabledCheckbox: Locator = this.audioCardScope.getByRole("checkbox", {
    name: /通知音を有効にする/,
  });
  readonly audioVolumeRange: Locator = this.audioCardScope.getByLabel(/音量:/);
  readonly audioSaveButton: Locator = this.audioCardScope.getByRole("button", {
    name: /^保存$/,
  });
  readonly audioSavedFlash: Locator = this.audioCardScope.getByRole("status").filter({
    hasText: "保存しました",
  });
  ```
- **MIRROR**: 既存の `defaultTableLabelsCard` / `setDefaultTableLabels` の locator 命名スタイル（[GroupsPage.ts:71-112](../../../../tests/e2e/pages/GroupsPage.ts#L71-L112)）。サウンド Card 用 locator は旧 [AudioSettingsPage.ts:25-33](../../../../tests/e2e/pages/AudioSettingsPage.ts#L25-L33) を移植。
- **IMPORTS**: 既に import 済の `expect` / `Locator` を流用。
- **GOTCHA**:
  - Playwright の `getByRole("tab", { name })` は `aria-selected` 状態に関わらず name 一致でマッチする。クリック後は `aria-selected` が更新されるが、selectTab の post-condition は panel の visibility。
  - `expectLoaded` は `getByText("メンバー", { exact: true })` で「メンバー」カード見出しを検出していたが、タブ化後はタブのラベルにも「メンバー」が出るため、`getByRole("heading", { name: "メンバー" })` か `getByRole("tabpanel", { name: "メンバー" })` 経由に絞ると安全。本タスクで `expectLoaded` も合わせて修正。
  - `audioCardScope` を private getter にして、locator が定義時に評価されないようにする（class field 初期化順序の罠を回避）。
  - `audioSaveButton` は同タブ内の `defaultTableLabelsSaveButton`（Table 名デフォルトの保存ボタン）と name regex `^保存$` で衝突するため、scope を tabpanel 全体ではなく `audioCardScope` 内の Card により絞る必要がある場合は `audioCardScope.locator('[aria-label="audio-settings-card"]')` のように Card 自体に aria-label を付ける改修も検討。**実装時に編集モードのテーブルラベル保存ボタンと衝突するケースを `setDefaultTableLabels` テスト内で確認し、衝突するなら `AudioSettingsCard` のルート `<Card>` に `aria-label="audio-settings-card"` を付与してさらに絞る**。
- **VALIDATE**:
  - `npx playwright test --grep "groups-navigation"` 等の既存 spec が壊れていないこと。
  - 新 helper を Task 10〜12 から呼び出して動作確認。

### Task 10: 旧 AudioSettingsPage.ts を削除

- **ACTION**: `tests/e2e/pages/AudioSettingsPage.ts` を削除し、`fixtures/test-context.ts` の export と全 spec の import / fixture 参照を削除する。
- **IMPLEMENT**:
  - `git rm tests/e2e/pages/AudioSettingsPage.ts`
  - `fixtures/test-context.ts` から `import { GroupAudioSettingsPage } from "../pages/AudioSettingsPage"` と `groupAudioSettingsPage` fixture を削除（要該当 file を Read で確認）
  - 全 spec で `groupAudioSettingsPage` を使っている箇所（[audio-settings.spec.ts](../../../../tests/e2e/audio-settings.spec.ts) で多用）を `groupDetailPage(gid)` 経由に置換（Task 11 で audio-settings.spec.ts を修正するときに合わせて行う）。
- **MIRROR**: 該当なし（削除）。
- **IMPORTS**: 削除のみ。
- **GOTCHA**:
  - `groupAudioSettingsPage` を import している全 spec を grep で網羅する: `grep -rn "groupAudioSettingsPage" tests/`
  - 順序: Task 11 で audio-settings.spec.ts 内の利用を全て `groupDetailPage` に置換 → Task 10 の削除が安全。**Task 10 と 11 を merge して 1 commit にする**。
- **VALIDATE**:
  - `npx playwright test --list` で全 spec が parse 段階でエラーにならないこと。

### Task 11: audio-settings.spec.ts を全面書換（タブ前提に変更）

- **ACTION**: 旧独立ページ前提で書かれた 7 テスト全件を「設定タブ内のサウンド Card」前提に書き換える。テストの目的（Firestore 反映 / member redirect / dashboard 連動 / `?from=live` 戻り先 / etc.）は維持する。
- **IMPLEMENT**:
  ```ts
  // テスト 1: organizer は設定を変更して保存でき、Firestore に反映される
  // BEFORE: GroupHeaderCard の「サウンド設定」リンクから別ページへ遷移して保存
  // AFTER: サークル詳細「設定」タブを開いて Card 内で保存

  await page.goto(`/groups/${gid}?tab=settings`);
  const detail = groupDetailPage(gid);
  await expect(detail.audioCardTitle).toBeVisible({ timeout: 15_000 });
  await detail.audioEnabledCheckbox.uncheck();
  await detail.audioVolumeRange.fill("0.5");
  await detail.audioSaveButton.click();
  // 保存後は同一画面に留まり、savedFlash が出る
  await expect(detail.audioSavedFlash).toBeVisible({ timeout: 10_000 });
  // Firestore 反映確認は変更なし
  ...

  // テスト 2: 一般メンバーは /groups/[gid]/audio-settings から /groups/[gid] にリダイレクトされる
  // BEFORE: audio-settings-client.tsx の useEffect で role 判定 → router.replace
  // AFTER: page.tsx の redirect で /groups/[gid]?tab=settings に遷移、設定タブが開く
  //        → タブ内で AudioSettingsCard が hidden（member は親で gating）
  await memberPage.goto(`/groups/${gid}/audio-settings`);
  await memberPage.waitForURL(`**/groups/${gid}?tab=settings`, { timeout: 15_000 });
  // 設定タブが開いていることを確認
  await expect(memberPage.locator("#group-detail-panel-settings")).toBeVisible();
  // サウンド設定見出しは render されない（member には gate）
  await expect(memberPage.getByRole("heading", { name: "サウンド設定" })).toHaveCount(0);
  // 他の設定 Card（開催数 / デフォルト席数）は read-only で見える
  await expect(memberPage.getByText("開催数")).toBeVisible();

  // テスト 3: dashboard の SoundToggleButton と連動
  // BEFORE: groupAudioSettingsPage.goto() で別ページに遷移 → uncheck → save
  // AFTER: detail.goto() → selectTab("settings") → audioEnabledCheckbox.uncheck → audioSaveButton.click
  //        savedFlash 確認後、dashboard に再訪して SoundToggleButton OFF を確認
  await detail.goto();
  await detail.selectTab("settings");
  await detail.audioEnabledCheckbox.uncheck();
  await detail.audioSaveButton.click();
  await expect(detail.audioSavedFlash).toBeVisible();
  ...

  // テスト 4: /live で SoundUnlockBanner には『設定』リンクが無い
  // → 変更不要（このテストは settings ページへの遷移ではなく、リンクが「無い」ことの確認）

  // テスト 5: ?from=live&tid= を直接渡すと「全画面表示へ戻る」が出る + 保存後 /live に遷移
  // BEFORE: /groups/${gid}/audio-settings?from=live&tid=${tid}
  // AFTER: 同 URL を踏むと redirect で /groups/${gid}?tab=settings&from=live&tid=${tid} になる
  //        → AudioSettingsCard 内に「← 全画面表示へ戻る」リンクが visible
  //        → 保存ボタンクリックで /tournaments/${tid}/live に遷移（`back` がある場合は router.push）

  await page.goto(`/groups/${gid}/audio-settings?from=live&tid=${tid}`);
  // redirect されて /groups/${gid}?tab=settings&from=live&tid=${tid} に着地
  await page.waitForURL(/\/groups\/[^/]+\?tab=settings&from=live&tid=/, {
    timeout: 15_000,
  });
  await expect(page.getByRole("link", { name: /全画面表示へ戻る/ })).toBeVisible();

  await Promise.all([
    page.waitForURL(`**/tournaments/${tid}/live`, { timeout: 15_000 }),
    detail.audioSaveButton.click(),
  ]);

  // テスト 6 / 7: /live の back ボタン / member の banner 非表示
  // → サウンド設定とは別経路のため変更不要
  ```
- **MIRROR**: 既存 [audio-settings.spec.ts:76-363](../../../../tests/e2e/audio-settings.spec.ts) の検証目的・readAudioSettings helper・getDocument 連動はそのまま流用。UI 操作のみタブ前提に書き換える。
- **IMPORTS**:
  - `groupAudioSettingsPage` fixture の参照を全削除し、`groupDetailPage` を使う。
  - `tests/e2e/pages/GroupsPage` から `GroupDetailPage` を import 済（fixture 経由）なので追加不要。
- **GOTCHA**:
  - **テスト 1 で saveButton click 後の `waitForURL` を削除**: 旧実装は保存後に `/groups/[gid]` へ遷移していたが、新実装は同一画面に留まるため `audioSavedFlash` の visibility で代替。
  - **テスト 3 の保存後挙動**も同様に `audioSavedFlash` で代替。dashboard 再訪は新規 `dash.goto()` で。
  - **テスト 5 のみ** 保存後遷移を維持（`from=live` のため `back !== null` で `router.push(back.href)` が走る）。
  - **redirect の URL 期待値**を `?tab=settings&from=live&tid=...` の順序まで厳密にマッチさせるかは余地あり。`URLSearchParams.toString()` の serialization 順序は実装依存のため、regex で `?.*tab=settings.*from=live.*tid=` のように緩いマッチに留める。
- **VALIDATE**:
  - `npx playwright test tests/e2e/audio-settings.spec.ts` で 7 テスト全件 green。

### Task 12: nav-and-sound-toggle.spec.ts のサイドバーリンク href 期待値を更新

- **ACTION**: [nav-and-sound-toggle.spec.ts:111-112](../../../../tests/e2e/nav-and-sound-toggle.spec.ts#L111-L112) のサイドバー「サウンド設定」リンクの href 検証を `/groups/{gid}?tab=settings` に変更。
- **IMPLEMENT**:
  ```ts
  // BEFORE
  const audioLink = sidebar.getByRole("link", { name: "サウンド設定" });
  await expect(audioLink).toHaveAttribute("href", `/groups/${gid}/audio-settings`);

  // AFTER
  const audioLink = sidebar.getByRole("link", { name: "サウンド設定" });
  await expect(audioLink).toHaveAttribute("href", `/groups/${gid}?tab=settings`);
  ```
- **MIRROR**: 該当なし（1 行修正）。
- **IMPORTS**: 変更なし。
- **GOTCHA**: クリック後の遷移先確認を含むテストではない（href 検証のみ）。
- **VALIDATE**:
  - `npx playwright test tests/e2e/nav-and-sound-toggle.spec.ts` で全件 green。

### Task 13: 新規 E2E `group-detail-tabs.spec.ts` を追加

- **ACTION**: 「タブ default」「タブ切替」「`?tab=` 直リンク」「rename 中のボタン重なり無し（観測可能形）」を検証する spec を新設。
- **IMPLEMENT**:
  ```ts
  import { test, expect } from "./fixtures/test-context";
  import { createGroup, randomOrganizer, registerOrganizer } from "./fixtures/flows";

  test.describe("サークル詳細画面のタブ", () => {
    test("default で『メンバー』タブが選択され、メンバーカードが見える", async ({ page, groupDetailPage }) => {
      const owner = randomOrganizer("tab-default");
      await registerOrganizer(page, owner);
      const gid = await createGroup(page, "Tab Default Group");
      const detail = groupDetailPage(gid);
      await detail.goto();

      await expect(detail.tabButton("members")).toHaveAttribute("aria-selected", "true");
      await expect(page.locator("#group-detail-panel-members")).toBeVisible();
      await expect(page.locator("#group-detail-panel-season")).toBeHidden();
      await expect(page.locator("#group-detail-panel-settings")).toBeHidden();
      // owner は招待コードカードもメンバータブで見える
      await expect(page.getByRole("button", { name: "招待コードを発行" })).toBeVisible();
    });

    test("『シーズン』タブをクリックすると ?tab=season になり、SeasonCard が見える", async ({ page, groupDetailPage }) => {
      const owner = randomOrganizer("tab-season");
      await registerOrganizer(page, owner);
      const gid = await createGroup(page, "Tab Season Group");
      const detail = groupDetailPage(gid);
      await detail.goto();

      await detail.selectTab("season");
      await expect(page).toHaveURL(/[?&]tab=season(&|$)/);
      await expect(page.getByRole("button", { name: /^シーズンを開始する$/ })).toBeVisible();
      // 設定タブ配下のカードはこのタブでは見えない
      await expect(page.getByText("Table 名デフォルト")).toBeHidden();
    });

    test("?tab=settings で直リンクすると設定タブが復元される", async ({ page, groupDetailPage }) => {
      const owner = randomOrganizer("tab-deep");
      await registerOrganizer(page, owner);
      const gid = await createGroup(page, "Tab Deep Group");
      await page.goto(`/groups/${gid}?tab=settings`);

      await expect(page.locator("#group-detail-panel-settings")).toBeVisible();
      await expect(page.getByText("Table 名デフォルト")).toBeVisible();
      await expect(page.getByText("開催数")).toBeVisible();
    });

    test("ヘッダ rename inline edit 中も削除ボタンが click できる（重なり無しの観測）", async ({ page, groupDetailPage }) => {
      const owner = randomOrganizer("tab-overlap");
      await registerOrganizer(page, owner);
      const gid = await createGroup(page, "Header Overlap Group");
      const detail = groupDetailPage(gid);
      await detail.goto();

      // モバイル幅にしてレイアウトの崩れを再現
      await page.setViewportSize({ width: 375, height: 667 });

      // サークル名の Pencil クリックで inline edit
      await page.getByRole("button", { name: /^サークル名「.+」を編集$/ }).click();
      const renameInput = page.getByLabel("サークル名");
      await expect(renameInput).toBeVisible();

      // 削除ボタンが visible かつ Playwright の actionability チェックで click 可能
      const deleteBtn = page.getByRole("button", { name: "削除" });
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // 削除 dialog が開いた = 重なって誤タップしてないことの観測可能な振る舞い
      await expect(page.getByRole("dialog").getByText("サークルを削除")).toBeVisible();
    });
  });
  ```
- **MIRROR**: [`groups-navigation.spec.ts:20-40`](../../../../tests/e2e/groups-navigation.spec.ts#L20-L40) の `randomOrganizer` + `registerOrganizer` + `createGroup` の通常のセットアップ。
- **IMPORTS**: 既存の `fixtures/flows` / `fixtures/test-context` を流用。
- **GOTCHA**:
  - `rename` ボタンの aria-label は `\`サークル名「${group.name}」を編集\``（[GroupHeaderCard.tsx:134](../../../../src/app/groups/[gid]/_components/GroupHeaderCard.tsx#L134)）。regex で部分一致させる。
  - `expect(page.getByText("Table 名デフォルト")).toBeHidden()` は `hidden` 属性のおかげで panel 全体が `display: none` になり、内部テキストも hidden 判定される。`toHaveCount(0)` ではなく `toBeHidden()` を使うこと（DOM には残っているため）。
  - `setViewportSize` を使うのは「観測可能な振る舞い」テストのため。CI で別 viewport を指定している場合は test 内で明示的に切替。
  - 「重なってない事の観測」は「rename 中に削除ボタンを `click()` できる = Playwright の actionability チェックを通る」で代替する（Playwright は overlapping element 検出を内蔵）。
- **VALIDATE**:
  - `npx playwright test tests/e2e/group-detail-tabs.spec.ts` で新 spec 全件 green。

### Task 14: 既存 E2E spec を選択タブ前提に更新

- **ACTION**: タブ化により非可視となる Card への参照を持つ既存 spec を更新する。
- **IMPLEMENT**:
  - **`tests/e2e/phase-d-share-and-history.spec.ts:181-188`** — `「シーズンを開始する」` ボタン押下前に `await detail.selectTab("season")` または直 URL `?tab=season` を挟む。簡潔さのため:
    ```ts
    // BEFORE:
    await page.goto(`/groups/${gid}`);
    const startSeasonButton = page.getByRole("button", { name: /^シーズンを開始する$/ });

    // AFTER:
    await page.goto(`/groups/${gid}?tab=season`);
    const startSeasonButton = page.getByRole("button", { name: /^シーズンを開始する$/ });
    ```
  - **`tests/e2e/table-label-and-color.spec.ts:192-201`** — member 視点で `Table 名デフォルト` を確認する箇所:
    ```ts
    // BEFORE:
    await memberPage.goto(`/groups/${gid}`);
    await expect(memberPage.getByText("Table 名デフォルト")).toBeVisible(...);

    // AFTER:
    await memberPage.goto(`/groups/${gid}?tab=settings`);
    await expect(memberPage.getByText("Table 名デフォルト")).toBeVisible(...);
    ```
    既存の `defaultTableLabelsCard` ロケータ（編集ボタンの非存在確認）はそのまま動作する（panel の中の Card を locator で参照する）。
  - **`tests/e2e/note-screenshots.spec.ts:73`** — `招待コードを発行` ボタンは default = members タブで visible のため変更不要だが、screenshot 安定化のため `await page.goto(`/groups/${gid}?tab=members`)` に統一。
  - **`tests/e2e/audio-settings.spec.ts`** は Task 11 で全面書換済のため、本タスクからは除外。
- **MIRROR**: 各 spec 内の既存 setup フローはそのまま。差し込みは `goto` に query を追加する最小修正。
- **IMPORTS**: 変更なし。
- **GOTCHA**:
  - `displayname-propagation.spec.ts` 等で `await page.goto(`/groups/${gid}`)` の後に何も探していない（setup 用に goto しているだけ）箇所はそのままで動く（default タブが members なら影響なし）。grep で「`groups/${gid}`」直後に Card heading を探す箇所が他に無いか走査すること。
  - `account-self-delete.spec.ts:91` は member の昇格ボタンを使う（[member-role-split.spec.ts:91-95](../../../../tests/e2e/member-role-split.spec.ts#L91-L95) も同じ）。これは default = members タブで visible のため変更不要。
- **VALIDATE**:
  - `npx playwright test tests/e2e/phase-d-share-and-history.spec.ts tests/e2e/table-label-and-color.spec.ts tests/e2e/note-screenshots.spec.ts tests/e2e/audio-settings.spec.ts` で全件 green。

### Task 15: GroupDetailPage.expectLoaded を更新

- **ACTION**: `expectLoaded` が Card heading「メンバー」を見ていたところを、タブ化後の世界で安定する待機条件に変更。
- **IMPLEMENT**:
  ```ts
  // BEFORE: tests/e2e/pages/GroupsPage.ts:60-63
  async expectLoaded() {
    await expect(this.page.getByText("メンバー", { exact: true })).toBeVisible();
  }

  // AFTER:
  async expectLoaded() {
    // タブのラベルが render された時点で client-side fetch + render 完了とみなす
    await expect(this.tabButton("members")).toBeVisible();
  }
  ```
- **MIRROR**: locator-by-role の使い回し。
- **IMPORTS**: 変更なし。
- **GOTCHA**:
  - 既存の getByText("メンバー", { exact: true }) は タブのラベルでも MemberRoleList の CardTitle でも両方ヒットする。Playwright の strict mode で 2 件ヒット → エラーになる可能性があるため必ず修正。
- **VALIDATE**:
  - `expectLoaded` を使っている既存 spec 全件 green を確認。

---

## Testing Strategy

### Unit Tests

UI 層のみの変更で、純関数や repository/service ロジックの追加は無い。`GroupDetailTabs` は presentational component で内部 state を持たない（`activeTab` / `onChange` は props 経由）ため、unit test は **追加しない**（[testing.md](../../../../.claude/rules/testing.md) 「同じ振る舞いを E2E と unit の両方で重複検証はしない」「render 判定 / 条件分岐 / aria 属性」は E2E 側でカバー）。

新規 unit test なし。

### E2E Tests（追加）

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| default tab is members | サークル詳細を `?tab=` 無しで開く | members panel visible / season・settings panel hidden / 招待コードを発行ボタン visible | No |
| switch to season | members タブで「シーズン」クリック | URL に `?tab=season` / season panel visible / シーズンを開始するボタン visible / Table 名デフォルト hidden | No |
| deep link to settings | `?tab=settings` で直アクセス | settings panel visible / 開催数 + Table 名デフォルト visible | Yes（直リンク復元） |
| header rename does not overlap delete | mobile viewport（375px）で rename inline edit に入る → 削除ボタン click | 削除 dialog が開く（actionability チェック合格 = 重なってない） | Yes（モバイル衝突回避の核心） |
| invalid `?tab=foo` falls back to members | `?tab=invalid` で開く | members panel visible（`isTabKey` で fallback） | Yes（型ガード） |

### Edge Cases Checklist

- [ ] `?tab=` 値が type guard を通らないとき → `members` にフォールバック
- [ ] members タブで organizer 視点（招待コードカード visible）/ general member 視点（招待コードカード hidden）の両方確認
- [ ] mobile viewport（375px）で 3 タブが等幅に並ぶ
- [ ] desktop viewport（1024px+）で 3 タブが上端に並び、ヘッダボタンが横並びに戻る
- [ ] サークル名 inline edit を開いた状態で Esc キー → cancel 後にタブ位置が変わらない
- [ ] タブ切替時に scroll top に jump しない（`{ scroll: false }` の効果）
- [ ] 設定タブで `InlineNumberEditCard` の inline edit を開く → メンバータブに切替 → 設定タブに戻ると編集 state は消えている（`hidden` 属性ではなく内部 state は親側 `useInlineNumberEdit` で管理されているが、タブ切替で unmount されないため state は保持される。意図的に保持で OK か、それとも cancel 扱いで OK か → 本 plan は **保持** で進める）

### 既存 E2E への regression 確認チェックリスト

- [ ] `groups-navigation.spec.ts` — 全件 green
- [ ] `phase-d-share-and-history.spec.ts` — `?tab=season` 修正後に全件 green
- [ ] `table-label-and-color.spec.ts` — `?tab=settings` 修正後に全件 green
- [ ] `note-screenshots.spec.ts` — screenshot artifact が新レイアウトに更新される（screenshot 比較は無いので差分のみ確認）
- [ ] `audio-settings.spec.ts` — member redirect 後の確認 locator 修正後に全件 green
- [ ] `account-self-delete.spec.ts` / `member-role-split.spec.ts` / `displayname-propagation.spec.ts` / `clone-tournament-with-players.spec.ts` — default = members タブで動くため修正不要だが run して確認

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors. 特に `GroupDetailTabs` の `children: { [K in TabKey]: React.ReactNode }` 型と `isTabKey` type guard が正しく機能していること。

```bash
npm run lint
```

EXPECT: Zero lint errors. `console.*` 直呼びゼロ（[error-logging.md](../../../../.claude/rules/error-logging.md) 規約）。

### Unit Tests

```bash
npm run test
```

EXPECT: 既存 unit test 全件 green。新規 unit test は追加しない（理由は Testing Strategy 参照）。

### E2E（影響範囲最小セット）

```bash
# 新規 spec
npx playwright test tests/e2e/group-detail-tabs.spec.ts

# 修正した既存 spec（重）
npx playwright test \
  tests/e2e/audio-settings.spec.ts \
  tests/e2e/nav-and-sound-toggle.spec.ts

# 修正した既存 spec（軽微）
npx playwright test \
  tests/e2e/phase-d-share-and-history.spec.ts \
  tests/e2e/table-label-and-color.spec.ts \
  tests/e2e/note-screenshots.spec.ts

# 影響を受けない既存 spec の sanity check
npx playwright test \
  tests/e2e/groups-navigation.spec.ts \
  tests/e2e/account-self-delete.spec.ts \
  tests/e2e/member-role-split.spec.ts \
  tests/e2e/displayname-propagation.spec.ts \
  tests/e2e/clone-tournament-with-players.spec.ts
```

EXPECT: 全件 green。

### Build

```bash
npm run build
```

EXPECT: Next.js production build が成功し、`/groups/[gid]` ページが client-side rendering で生成される。

### Manual Validation

- [ ] DevTools mobile mode（iPhone SE = 375px）でサークル詳細を開く
- [ ] サークル名横の Pencil ボタンをクリック → inline edit に入る → 「保存」「キャンセル」ボタンが「一覧へ / 削除」と**重ならない**ことを目視確認
- [ ] **ヘッダから「サウンド設定」リンクボタンが消えている**ことを目視確認
- [ ] 「メンバー」タブが initial で選択されていることを確認
- [ ] 「シーズン」タブをクリック → URL bar が `?tab=season` に切替・SeasonCard が表示
- [ ] 「設定」タブをクリック → Table 名デフォルト / 開催数 / デフォルト席数 / **AudioSettingsCard** の 4 Card（organizer のみ）が表示
- [ ] AudioSettingsCard で enabled を toggle → 保存 → **savedFlash「保存しました」が表示**され、画面遷移しないことを確認
- [ ] サイドバーの「サウンド設定」をクリック → `/groups/{gid}?tab=settings` に遷移し AudioSettingsCard が即見える
- [ ] `/groups/[gid]/audio-settings` を直リンクで踏む → `/groups/{gid}?tab=settings` に redirect される
- [ ] `/groups/[gid]/audio-settings?from=live&tid=xxx` を直リンクで踏む → `/groups/{gid}?tab=settings&from=live&tid=xxx` に redirect され、Card 内に「← 全画面表示へ戻る」リンクが表示される
- [ ] `?from=live&tid=xxx` 経由で AudioSettingsCard 保存ボタン押下 → `/tournaments/xxx/live` に遷移
- [ ] ブラウザ「戻る」 → `/groups/[gid]` のままで（`router.replace` のため）戻らない
- [ ] desktop（1280px）に切替 → ヘッダが横並びに戻る・タブは横並び等幅のまま
- [ ] member（招待コードで加入したユーザ）視点で開く → 招待コード Card が hidden、「シーズンを開始する」ボタンが hidden、設定タブで AudioSettingsCard / 各 Card の「編集」ボタンが hidden
- [ ] member 視点で `/groups/[gid]/audio-settings` 直リンク → `?tab=settings` に redirect され、AudioSettingsCard 自体が render されない（読取専用の他 Card のみ visible）
- [ ] `/groups/[gid]?tab=settings` 直リンクで設定タブが復元
- [ ] `/groups/[gid]?tab=foo` 不正値で members に fallback

---

## Acceptance Criteria

- [ ] 3 タブ（メンバー / シーズン / 設定）が render され、`role="tab"` / `role="tabpanel"` / `aria-controls` / `aria-selected` が正しく付与される
- [ ] default tab が `members`、`?tab=` クエリで初期タブが復元される
- [ ] タブ切替で URL の `tab` パラメータが `router.replace` で同期し、scroll position が保たれる
- [ ] `GroupHeaderCard` がモバイル（< 640px）で縦 2 段、desktop（>= 640px）で従来通り横並び
- [ ] **`GroupHeaderCard` から「サウンド設定」リンクボタンが削除されている**
- [ ] サークル名 inline edit 中に「保存 / キャンセル」と「一覧へ / 削除」が**同一行で重ならない**
- [ ] **`AudioSettingsCard` が「設定」タブ内に organizer 限定で表示**され、enabled / sound / volume / 試聴 / 保存が動作する
- [ ] **旧 URL `/groups/[gid]/audio-settings` が `/groups/[gid]?tab=settings` に redirect される**（`?from=` `?tid=` クエリ保持）
- [ ] **サイドバーの「サウンド設定」リンクが `/groups/{gid}?tab=settings` を指す**
- [ ] **`?from=tournament` / `?from=live` 経由で開いた場合、Card 内に「← 戻る」リンクが visible で、保存後に元画面へ遷移する**
- [ ] **`?from=` 無しで保存した場合は同一画面に留まり、「保存しました」フィードバックが 2 秒表示される**
- [ ] member / organizer / owner それぞれの可視 Card 集合は従来と同じ（タブ振り分けで隠蔽するだけで、アクセス制御は変更なし）
- [ ] member 視点で `/groups/[gid]/audio-settings` 直リンク → `?tab=settings` に redirect され、`AudioSettingsCard` は render されない
- [ ] `npm run typecheck` / `npm run lint` / `npm run test` が green
- [ ] 新規 spec `group-detail-tabs.spec.ts` が green
- [ ] 修正対象の既存 spec 5 件（audio-settings / nav-and-sound-toggle / phase-d-share-and-history / table-label-and-color / note-screenshots）が green
- [ ] schema / rule / repository / service の変更が**ない**ことを git diff で確認
- [ ] `audio-settings-client.tsx` / `AudioSettingsPage.ts` の削除が `git status` で反映されている

## Completion Checklist

- [ ] Code follows discovered patterns（`role="tablist"` 簡易タブ + `useSearchParams` + `_components/` 配下分離）
- [ ] Error handling: 既存 `unwrapOrFrom` / `setError` パターンを維持、新規 try/catch 追加なし
- [ ] Logging: 新規 logger 呼び出しなし（タブ切替は副作用ない pure UI 操作）
- [ ] Tests: 観測可能な振る舞いベースの E2E（タブ可視性 / URL / actionability）
- [ ] No hardcoded values: TabKey 配列 `TAB_KEYS` を `as const` で抽出、type guard `isTabKey` で参照
- [ ] Documentation: `GroupDetailTabs.tsx` の JSDoc コメントに「PRD 02 polish (タブ化)」由来を明記
- [ ] No unnecessary scope additions: schema / rule / service / repository / `audio-settings` 統合は scope 外
- [ ] Self-contained: 実装中にコードベースを再 grep する必要が無いだけの patterns を本 plan に記載

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 既存 E2E 7 件以上で `getByText("メンバー")` 等のラベルが二重マッチして strict mode 違反 | M | M | Task 15 で `expectLoaded` を `tabButton("members")` ベースに変更。grep で `"メンバー"` / `"Table 名デフォルト"` / `"招待コードを発行"` / `"シーズンを開始する"` の使用箇所を全 spec で確認 |
| **`audio-settings/page.tsx` redirect で anonymous user が多段 redirect する** | M | M | `redirect` 処理は auth gate より先に走るため、anonymous → `/groups/[gid]?tab=settings` → group-detail の RequireAuth → `/login` の 2 段になる。Task 5 の VALIDATE で動作確認し、UX 上問題があれば `audio-settings-client.tsx` を thin redirect client component（`useRouter().replace` で client-side redirect）に置換する代替案に切替 |
| **`audioSaveButton` (`name=/^保存$/`) と Table 名デフォルト編集モードの保存ボタンが同一 tabpanel 内で衝突** | M | M | Task 9 の GOTCHA 通り、編集モード突入時の衝突を確認。衝突するなら `AudioSettingsCard` のルート `<Card>` に `aria-label="audio-settings-card"` を付与して locator を絞る（`GroupDefaultTableLabelsCard` の前例と同パターン） |
| **`AudioSettingsCard` の `useAudioPlayer` 初期化が group fetch 完了前に走り audio が unlock されない** | L | L | 親 `group-detail-client.tsx` で `if (!group) return loading` の early return 後にのみ render されるため、Card 内では `group: GroupDoc`（non-null）が保証される。`useAudioPlayer` の `tournament: null` での初期化は audio-settings-client.tsx で実証済 |
| **`?from=live&tid=` 経由で開いた状態で AudioSettingsCard 以外のタブをクリックすると `?from=` `?tid=` が消える** | L | L | Task 1 の `onChangeTab` で `URLSearchParams(searchParams.toString())` を base にしてから `tab` だけ書換える実装にしているため、`from` `tid` は保持される。実装時に re-confirm |
| **`router.push(back.href)` で外部画面に遷移後、サークル詳細に戻ると `?tab=settings&from=...&tid=...` クエリが残る** | L | L | これは仕様（戻るボタンで前の状態を復元する自然な挙動）。気になるなら `router.replace` で来歴を残さない手もあるが、`?from=` 経路は一時的な状態のため `push` のままが自然 |
| `useSearchParams` を Suspense boundary 内で読まないと Next.js 15 で warning | L | L | 本 file は既に `RequireAuth` + `"use client"` 配下で動作している（[audio-settings-client.tsx:32](../../../../src/app/groups/[gid]/audio-settings/audio-settings-client.tsx#L32) で実証済）。同じ階層で動かす |
| `hidden` 属性で panel を非表示にしているが、内部 Card の inline edit state が切替で持続して UX が混乱 | L | L | Task 13 の Edge Cases Checklist に「state 保持で OK か」を入れて目視確認。問題なら `{activeTab === key && children[key]}` の conditional render に切替（unmount で state リセット）。本 plan の default は **保持** |
| デスクトップ表示で `sm:` 以上の breakpoint がローカル tailwind 設定と整合しない | L | L | `tailwind.config.ts` を Read して `screens` 設定が tailwind 既定（sm = 640px）と同じか確認 |
| `note-screenshots.spec.ts` の 既存 PNG キャプチャが新レイアウトに合わなくなる | L | L | 視覚回帰テストではなく screenshot artifact の生成のみ（CI の比較なし）。新レイアウトで生成し直すだけで OK |
| **AudioSettingsCard が「設定」タブの末尾に置かれることで、organizer のスクロール量が増える** | L | L | 設定タブ内 4 Card の優先順位は「使用頻度の高い順」を意識。実装時に「サウンド設定 → 開催数 → デフォルト席数 → Table 名デフォルト」の並び順案も検討余地あり（運営者ヒアリングで決定） |

## Notes

- **PRD 02 への report 追記**: 本 plan 完了時に [.claude/PRPs/02-season-stats-and-share/reports/](../reports/) 配下に `group-detail-tabbed-layout-report.md` を新設（PRD 内 phase 表への新規行追加は不要）。Decisions Log に「サークル詳細画面のタブ化（メンバー / シーズン / 設定）を polish として実施。サウンド設定を独立ページから設定タブ内 Card に統合」を 1 行追記。
- **将来拡張**:
  - 1〜2 リリース後、`/groups/[gid]/audio-settings` redirect ページごと完全削除する追跡 plan を切り出し（旧 URL のブックマーク参照が枯れたタイミング）。
  - サイドバー「サウンド設定」リンクを廃止して「設定タブを開く」のみに集約する案。サイドバーから直接サウンドにアクセスしたい運営者の声を観測してから判断。
- **i18n**: タブラベル「メンバー / シーズン / 設定」は CLAUDE.md の「ユーザーとのやり取りは日本語で」方針に従う。技術スタック名（Firestore 等）は出さない（[memory: feedback_no_tech_stack_in_user_messages.md] 準拠）。
- **既存パターン強化検討**: `login-client.tsx` / `join-client.tsx` の既存 tablist は `role="tabpanel"` を持っていない。本 plan で導入する `GroupDetailTabs` の改良パターンが評判良ければ、フォロー up でこれら 2 件にも展開（独立 plan として別途）。
- **deploy 影響なし**: schema / rule の変更が無いため、`firebase deploy --only firestore:rules` は不要。Vercel 側の Next.js build deploy のみで反映される（[memory: feedback_firestore_rules_deploy.md] の対象外）。
