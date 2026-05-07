# Local Review: Phase 4.13 ナビ刷新 + サウンド設定導線整理

**Reviewed**: 2026-04-26
**Branch**: develop（uncommitted）
**Decision**: APPROVE with comments

## Summary

サイドバー / モバイル Sheet ナビ（`src/components/nav/`）と shadcn `Sheet` の追加、
`SoundUnlockBanner` / `SoundToggleButton` から `settingsHref` を廃止して詳細設定をサイドバー
（「サウンド設定」）に集約する変更、`/groups/[gid]` の名前変更を Dialog からインライン編集に置換、
および各画面のページ内 nav ボタン（「サークル」「トーナメント」「ストラクチャ」）削除。
セキュリティ上の問題なし、validation（typecheck / lint / 479 tests）すべて pass。
前回 review（2026-04-25）の M1〜M3 / L1 は全件 fix 済み。新規 MEDIUM 2 件・LOW 3 件。

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M1. `aria-controls` が desktop 時に存在しない要素を指す**

[src/components/nav/HeaderMenuButton.tsx:25](src/components/nav/HeaderMenuButton.tsx#L25) +
[src/components/nav/AppShell.tsx:45,60](src/components/nav/AppShell.tsx#L45-L60)

`HeaderMenuButton` は常に `aria-controls="primary-nav"` を指しているが、ID `primary-nav` は
Sheet 側（`SheetContent`）に付与されており、desktop（md+）では描画されない。一方
desktop 用の `<aside>` は `id="primary-nav-sidebar"` で別 ID。結果として:

- desktop で `desktopCollapsed=true`：トグルしても `aria-controls` は存在しない要素を参照
- desktop で `desktopCollapsed=false`：`aria-controls` は存在しない（Sheet は閉じている）
- mobile：`aria-controls` は Sheet 開放時のみ存在

スクリーンリーダーが trigger → target ジャンプする際に target 不在となるため、a11y ラベリング
として不正確。`aria-controls` の参照先が動的に変わる構造なら、参照先 ID を `isDesktop` で
出し分けるか、両方のパネルに同じ ID（または ID リスト）を付与する。

**Fix 例**:

```tsx
// HeaderMenuButton.tsx
const targetId = isDesktop ? "primary-nav-sidebar" : "primary-nav";
<button aria-controls={targetId} ...>
```

または `<aside id="primary-nav primary-nav-sidebar">` のように共通 ID を割当て、
HeaderMenuButton は単に `aria-controls="primary-nav"` のままにする（DOM の ID は半角スペース
区切りで複数指定不可なので、両方の要素に同じ ID を別属性で持たせるのが現実解）。

**M2. `aria-current="page"` が親子 link で重複付与される**

[src/components/nav/PrimaryNav.tsx:52-58](src/components/nav/PrimaryNav.tsx#L52-L58)

`active` 判定は `pathname?.startsWith(item.href)` で `/groups` を `/groups/abc` でも true 評価する。
そのため pathname が `/groups/{gid}` のとき、親「サークル」リンクと、その直下の group 名サブ
リンクの **両方が同時に `aria-current="page"`** になる。WCAG / ARIA の慣行ではナビ landmark 内
に current location は 1 つが望ましく、AT 利用者へ重複アナウンスが入る。

`tests/e2e/nav-and-sound-toggle.spec.ts:96-97` は意図的にこの挙動を期待しているが、UX として
サブリンクが active なら親は active 解除する方が自然。

**Fix 例**:

```ts
const isGroups = item.href === "/groups";
const subActive = isGroups && currentGroup &&
  !!pathname?.startsWith(`/groups/${currentGroup.id}`);
const active =
  item.href === "/" ? pathname === "/" :
  isGroups ? (pathname === "/groups" || pathname?.startsWith("/groups") && !subActive) :
  (pathname?.startsWith(item.href) ?? false);
```

テスト側も合わせて、`/groups/{gid}` 訪問時はサブリンクのみ aria-current を持つ仕様に整える。

### LOW

**L1. dashboard-client.tsx で `CardDescription` が未使用（lint warning）**

[src/app/tournaments/[tid]/dashboard-client.tsx:20](src/app/tournaments/%5Btid%5D/dashboard-client.tsx#L20)

```text
20:29  Warning: 'CardDescription' is defined but never used.  @typescript-eslint/no-unused-vars
```

HEAD 時点から残存している pre-existing warning（本ブランチ起因ではない）が、CI 警告ノイズに
なる。import から `CardDescription` を削除して掃除推奨。

**L2. `aria-hidden` と `display:none` の二重指定**

[src/components/nav/AppShell.tsx:46-52](src/components/nav/AppShell.tsx#L46-L52)

`<aside>` は `desktopCollapsed=true` のとき className が `hidden ...`（`md:block` 無し）に
なり全 viewport で `display:none`。`display:none` は a11y tree から除外されるため
`aria-hidden={desktopCollapsed ? true : undefined}` は冗長。害はないが意図がぼやけるため
削除推奨。

**L3. AppShell の `useEffect(() => setMobileOpen(false), [pathname])` が初回 mount でも発火**

[src/components/nav/AppShell.tsx:27](src/components/nav/AppShell.tsx#L27)

初期 state は `mobileOpen=false` のため初回 mount の no-op は実害なし。`if (mobileOpen)` ガード
を入れると意図が明示できる、というレベル。任意改善。

## Validation Results

| Check      | Result                                           |
| ---------- | ------------------------------------------------ |
| Type check | Pass（`npx tsc --noEmit`）                       |
| Lint       | Pass（warnings のみ — L1 が該当）                |
| Tests      | Pass（29 files / 479 tests）                     |
| Build      | Skipped（dev のみ）                              |

## Files Reviewed

| Type     | Path                                                       |
| -------- | ---------------------------------------------------------- |
| Modified | .gitignore                                                 |
| Modified | src/app/globals.css                                        |
| Modified | src/app/groups/[gid]/group-detail-client.tsx               |
| Modified | src/app/layout.tsx                                         |
| Modified | src/app/structures/structures-client.tsx                   |
| Modified | src/app/tournaments/[tid]/dashboard-client.tsx             |
| Modified | src/app/tournaments/[tid]/live/live-client.tsx             |
| Modified | src/app/tournaments/tournaments-client.tsx                 |
| Modified | src/components/audio/SoundUnlockBanner.tsx                 |
| Modified | src/components/auth/AuthBadge.tsx                          |
| Modified | src/components/tournament/SoundToggleButton.tsx            |
| Modified | src/components/tournament/TimerControls.tsx                |
| Added    | src/components/nav/AppShell.tsx                            |
| Added    | src/components/nav/HeaderMenuButton.tsx                    |
| Added    | src/components/nav/PrimaryNav.tsx                          |
| Added    | src/components/nav/nav-items.ts                            |
| Added    | src/components/nav/nav-state.tsx                           |
| Added    | src/components/ui/sheet.tsx                                |
| Modified | tests/e2e/audio-settings.spec.ts                           |
| Modified | tests/e2e/fixtures/flows.ts                                |
| Modified | tests/e2e/groups-navigation.spec.ts                        |
| Modified | tests/e2e/member-role-split.spec.ts                        |
| Modified | tests/e2e/pages/GroupsPage.ts                              |
| Modified | tests/e2e/pages/TournamentsPage.ts                         |
| Modified | tests/e2e/winner-banner-and-auto-finish.spec.ts            |
| Added    | tests/e2e/nav-and-sound-toggle.spec.ts                     |

## 前回 review（2026-04-25）の所見の再確認

| ID  | 内容                                                         | 現状      |
| --- | ------------------------------------------------------------ | --------- |
| M1  | dashboard の `updateAudioSettings` catch で二重 warn ログ    | Fixed（dashboard-client.tsx:312-321 でロガー出力を削除済）|
| M2  | PrimaryNav.tsx の `nav-items` 重複 import                    | Fixed（PrimaryNav.tsx:15 に集約）|
| M3  | モバイルでトップバーが二段重なる                             | Fixed（AppShell から brand 表示を撤去）|
| L1  | `.claude/scheduled_tasks.lock` が untracked                  | Fixed（.gitignore:56-57）|

## Notes（指摘ではない確認事項）

- **権限ガード OK**: dashboard で SoundToggle が表示されるのは `myRole === "owner" || "organizer"`
  で早期 return している経路の先（[dashboard-client.tsx:207-209](src/app/tournaments/%5Btid%5D/dashboard-client.tsx#L207-L209)）。
  `audio` props が渡るのは organizer 以上のみで、Firestore Rule（`isOrganizer(gid)` 必須）と整合。
- **Skip link / reduced-motion / aria-current / aria-expanded**: WCAG 2.2 ベースの a11y 配慮が
  一通り入っている。`<main id="main" tabIndex={-1}>` でフォーカス先も確保。
- **fullscreen pattern**: `/^\/tournaments\/[^/]+\/live\/?$/` で `/live` のみサイドバー非表示。
  layout の sticky header は引き続き表示されるが既存挙動の延長で OK。
- **Sheet の z-index**: overlay/content `z-50`、layout header `z-20`、skip-link `z-50` で順序整合。
- **インライン rename UX**: Esc / 同名 / 空文字での自動キャンセル分岐が明示的に書かれており、
  optimistic UI として安全。`requestAnimationFrame` 後の focus + select も適切。
- **e2e テスト追加**: `tests/e2e/nav-and-sound-toggle.spec.ts` で signed-out / organizer /
  member / fullscreen / mobile / SoundToggle 反転書込みを網羅。Phase 4.13 のリグレッション
  ガードとして十分。
- **flows.ts / TournamentsPage.ts のラベル変更**: `"1 卓あたりの席数"` → `"1 Table あたりの席数"`
  は `c0907b7 refactor: user-facing 文言の「卓」を「Table」に統一` と整合する追従修正。
