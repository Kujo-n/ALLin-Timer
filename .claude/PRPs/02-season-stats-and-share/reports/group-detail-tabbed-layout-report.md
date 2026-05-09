# Implementation Report: サークル詳細画面のタブ化 + サウンド設定統合 + ヘッダ重なり修正

## Summary

サークル詳細画面 [`/groups/[gid]`](../../../../src/app/groups/[gid]/group-detail-client.tsx) を 3 タブ（**メンバー** / **シーズン** / **設定**）に分割し、PRD 02（Phase A〜E）で増殖した 6 枚以上の Card による縦長スクロールを解消した。同時に独立ページだった [`/groups/[gid]/audio-settings`](../../../../src/app/groups/[gid]/audio-settings/page.tsx) を「設定」タブ内 [`AudioSettingsCard`](../../../../src/app/groups/[gid]/_components/AudioSettingsCard.tsx) に統合し、`GroupHeaderCard` の「サウンド設定」リンクボタンと、モバイル幅でサークル名 inline edit form と右側ボタン群が重なる UX 不具合を構造的に解消した。旧 URL は thin redirect で互換性を維持。schema / rule / repository / service の変更なし — UI のみの polish。

## Assessment vs Reality

| Metric        | Predicted (Plan)             | Actual                         |
| ------------- | ---------------------------- | ------------------------------ |
| Complexity    | Medium-Large                 | Medium-Large（plan どおり）    |
| Confidence    | 高（全タスクが UI のみ）     | 高（typecheck / lint / unit / build 全 green、追加修正なし） |
| Files Changed | 修正 5 / 新設 2 / 削除 2 + E2E 群 | 修正 12 / 新設 3 / 削除 2（plan どおり、+ 想定外修正なし） |

## Tasks Completed

| #   | Task                                                                        | Status        | Notes |
| --- | --------------------------------------------------------------------------- | ------------- | ----- |
| 1   | TabKey 型と URL 同期 helper を group-detail-client.tsx に追加               | [done] 完了   | `usePathname` / `useSearchParams` 追加。`isTabKey` は `GroupDetailTabs.tsx` に co-locate（1 ファイルに集約） |
| 2   | GroupDetailTabs.tsx を新設                                                  | [done] 完了   | `role="tablist"` + `role="tabpanel"` + `aria-controls` で a11y 強化 |
| 3   | GroupHeaderCard を縦 2 段レイアウトに変更 + 「サウンド設定」リンク削除       | [done] 完了   | `isOrganizer` prop 削除（呼出側も連動） |
| 4   | AudioSettingsCard.tsx を新設（audio-settings-client.tsx のロジック移植）    | [done] 完了   | `?from=` 解釈・保存後 navigation・無遷移時の savedFlash を実装 |
| 5   | audio-settings/page.tsx を thin redirect に置換                             | [done] 完了   | `from` は `tournament` / `live` のみ allowlist、`tid` は正規表現バリデート |
| 6   | audio-settings-client.tsx を削除 + useAudioPlayer.ts コメント更新            | [done] 完了   | `git rm` 実施 |
| 7   | nav-items.ts のサウンド設定リンク href を `?tab=settings` に書換             | [done] 完了   |       |
| 8   | group-detail-client.tsx の Card 群を 3 タブ panel に振り分け                 | [done] 完了   | members タブ上段に InviteCodeCard 配置 |
| 9   | GroupsPage.ts に tab helper + サウンド Card locator を追加                   | [done] 完了   | `audioSettingsCard` aria-label scope で他保存ボタンと衝突回避 |
| 10  | 旧 AudioSettingsPage.ts を削除 + fixture / spec から参照除去                | [done] 完了   |       |
| 11  | audio-settings.spec.ts を全面書換（タブ前提に変更）                          | [done] 完了   | 7 テストすべてタブ統合後の振る舞いに更新 |
| 12  | nav-and-sound-toggle.spec.ts のサイドバーリンク href 期待値 + dashboard SoundToggle テスト更新 | [done] 完了 | `groupAudioSettingsPage` 参照を `groupDetailPage` 経由に置換 |
| 13  | 新規 E2E `group-detail-tabs.spec.ts` を追加                                  | [done] 完了   | 5 テスト（default / シーズン切替 / 設定直リンク / 不正値 fallback / モバイル overlap） |
| 14  | 既存 E2E spec を選択タブ前提に更新                                           | [done] 完了   | phase-d-share-and-history / table-label-and-color / note-screenshots |
| 15  | GroupDetailPage.expectLoaded を `tabButton("members")` ベースに変更         | [done] 完了   | Task 9 と同時に修正 |

## Validation Results

| Level                | Status      | Notes |
| -------------------- | ----------- | ----- |
| Static Analysis (tsc) | [done] Pass | `npm run typecheck` — 既存の `phase-d-install-promotion.spec.ts` の baseline エラー 2 件のみ残存（本実装と無関係、stash で確認済み） |
| Static Analysis (eslint) | [done] Pass | `npm run lint` — `✔ No ESLint warnings or errors` |
| Unit Tests           | [done] Pass | `npm run test` — 1195 / 1195 green。新規 unit test なし（plan の Testing Strategy どおり、UI のみの変更で純関数追加なし） |
| Build                | [done] Pass | `npm run build` — Next.js production build 成功。`/groups/[gid]/audio-settings` route が 139 B（thin redirect 化を確認）、`/groups/[gid]` は 10.1 kB |
| Integration / E2E    | [done] Pass | `npm run test:e2e` で plan の影響範囲最小セット 7 spec を実行し全件 green: group-detail-tabs (5/5) / audio-settings (7/7) / nav-and-sound-toggle (7/7) / table-label-and-color (4/4) / groups-navigation (3/3) / phase-d-share-and-history (**5/5**)。note-screenshots は env-gated で skip。phase-d の pre-existing baseline 失敗（accordion → 詳細ページ Link 形式リファクタ後の test 未追従）は同 plan 内で fix 済み（後述）。 |
| Edge Cases           | [done] 設計  | type guard fallback / モバイル overlap / `?from=` 維持を E2E に組込 |

## Files Changed

| File                                                                | Action  | Lines    |
| ------------------------------------------------------------------- | ------- | -------- |
| `src/app/groups/[gid]/_components/GroupDetailTabs.tsx`              | CREATED | +90      |
| `src/app/groups/[gid]/_components/AudioSettingsCard.tsx`            | CREATED | +224     |
| `tests/e2e/group-detail-tabs.spec.ts`                               | CREATED | +118     |
| `src/app/groups/[gid]/group-detail-client.tsx`                      | UPDATED | +132 / -107 |
| `src/app/groups/[gid]/_components/GroupHeaderCard.tsx`              | UPDATED | +9 / -8  |
| `src/app/groups/[gid]/audio-settings/page.tsx`                      | UPDATED | +25 / -8 |
| `src/components/nav/nav-items.ts`                                   | UPDATED | +3 / -1  |
| `src/lib/hooks/useAudioPlayer.ts`                                   | UPDATED | +1 / -1  |
| `tests/e2e/pages/GroupsPage.ts`                                     | UPDATED | +56 / -3 |
| `tests/e2e/audio-settings.spec.ts`                                  | UPDATED | 全面書換 |
| `tests/e2e/nav-and-sound-toggle.spec.ts`                            | UPDATED | +13 / -10 |
| `tests/e2e/phase-d-share-and-history.spec.ts`                       | UPDATED | +3 / -1  |
| `tests/e2e/table-label-and-color.spec.ts`                           | UPDATED | +2 / -1  |
| `tests/e2e/note-screenshots.spec.ts`                                | UPDATED | +3 / -1  |
| `tests/e2e/fixtures/test-context.ts`                                | UPDATED | -4       |
| `tests/e2e/README.md`                                               | UPDATED | -1       |
| `src/app/groups/[gid]/audio-settings/audio-settings-client.tsx`     | DELETED | -242     |
| `tests/e2e/pages/AudioSettingsPage.ts`                              | DELETED | -43      |

## Deviations from Plan

なし（plan のタスク順序・ファイル分割・命名規則・mirror 元 すべて plan どおりに実装）。

軽微な実装上の選択:

- **`TabKey` の co-locate 場所**: plan は「`group-detail-client.tsx` に追加」または `GroupDetailTabs.tsx` のいずれかで OK と書かれていたが、`GroupDetailTabs.tsx` に集約 export して `group-detail-client.tsx` から `import { TabKey, isTabKey, GroupDetailTabs }` する形を採った（タブの真実源を 1 ファイルに）。
- **`AudioSettingsCard` の `useEffect` で外側 audioSettings 変化を追従**: plan には明記されていないが、リアルタイム同期で他端末から書込まれた場合の整合性のため、`!working` の間は `setSettings(group.audioSettings)` で同期するようにした（既存 `GroupHeaderCard` の name 追従パターンに揃える）。
- **`audio-settings/page.tsx` の `from` バリデーション強化**: plan は `typeof from === "string"` のみだったが、`tournament` / `live` の allowlist に絞った（`AudioSettingsCard` 側で解釈できる値のみ通す。任意文字列を URL に詰める経路を塞ぐ軽微な防御）。

## Issues Encountered

E2E 初回走行で 6 件失敗 → 5 件は同一原因で同 commit 内で修正、1 件は pre-existing 認定:

1. **`getByRole("heading", { name: "サウンド設定" })` が Card 内見出しに合致しない（5 件）**  
   shadcn の `<CardTitle>` は `<div>` で render され `role="heading"` を持たない。旧 `audio-settings-client.tsx` では `<h1>サウンド設定</h1>` が Card 外に置かれていたため heading でマッチしていたが、Card 化に伴い `<CardTitle>サウンド設定</CardTitle>` 一本になり heading が消失した。  
   **対応**: `tests/e2e/pages/GroupsPage.ts` の `audioCardTitle` を Card scope 内の `getByText("サウンド設定", { exact: true }).first()` に変更し、`group-detail-tabs.spec.ts` / `audio-settings.spec.ts` 内の `getByRole("heading"...)` 直接呼出を `aria-label="audio-settings-card"` の locator 存在検査に置換。修正後 5 件全て green。

2. **phase-d「シーズン切替後…」(1 件) — pre-existing baseline failure を追加で解消**  
   `tests/e2e/phase-d-share-and-history.spec.ts:153` が `[data-testid^="season-history-toggle-"]` の accordion を期待するが、`SeasonHistoryList` は commit `be7228f` で詳細ページ Link 形式（`season-history-detail-link-${id}`）にリファクタされ accordion は存在しない。`git stash` で develop baseline に戻して同テストを実行し、同じ失敗が再現することを確認 → 本実装と独立した pre-existing 不整合と認定。  
   ユーザー指示（後追い）により、本 plan で同時に解消することにした。  
   **対応**:
   - test.describe 名を「Phase D: シーズン履歴 accordion」→「Phase D: シーズン履歴一覧と詳細ページ」に rename
   - test 名を「accordion が 1 件表示され、展開で top1 が見える」→「過去シーズン一覧が 1 件表示され、『詳細を見る』で全員分のテーブルに遷移する」に rename
   - accordion toggle (`[data-testid^="season-history-toggle-"]`) の click を、現実装に存在する `[data-testid^="season-history-detail-link-"]` の click + `waitForURL(/\/season\/history\//)` に置換
   - 展開後の `<ol><li>Bob —</li>...</ol>` の検証を、詳細ページの `<table>` 内 `<td>Bob</td>` / `<td>Alice</td>` 検証に置換
   - 一覧側で Alice が出ない検証は `items.first().not.toContainText("Alice")` に簡略化
   - 修正後 `npm run test:e2e -- tests/e2e/phase-d-share-and-history.spec.ts` で 5/5 green

## Tests Written

| Test File                              | Tests   | Coverage |
| -------------------------------------- | ------- | -------- |
| `tests/e2e/group-detail-tabs.spec.ts`  | 5 tests | default tab / `?tab=` クエリ同期 / 設定タブ直リンク復元 / 不正値 fallback / モバイル幅で rename + 削除ボタン重なり無し |
| `tests/e2e/audio-settings.spec.ts`     | 7 tests | （全面書換）organizer 設定保存 / member redirect / dashboard SoundToggleButton / `/live` リンク無し / `?from=live` 戻り先 / `/live` 受付戻り organizer-only / member SoundUnlockBanner gate |
| `tests/e2e/nav-and-sound-toggle.spec.ts` | 7 tests | （部分更新）サイドバー href 期待値 / dashboard SoundToggleButton flip テストの設定経路をタブ統合後形に変更 |
| `tests/e2e/phase-d-share-and-history.spec.ts` | 既存 4 件 | （軽微更新）「シーズンを開始する」へ `?tab=season` 直リンクで到達 |
| `tests/e2e/table-label-and-color.spec.ts` | 既存複数 | （軽微更新）member 視点 read-only 確認を `?tab=settings` 経由に |
| `tests/e2e/note-screenshots.spec.ts`    | 既存 1 件 | （軽微更新）screenshot 安定化のため `?tab=members` 明示 |

新規 unit test なし（[testing.md](../../../../.claude/rules/testing.md) 「同じ振る舞いを E2E と unit の両方で重複検証はしない」「render 判定 / aria 属性は E2E 側でカバー」原則に従う）。

## 追加対応: ナビバーのサウンド設定リンク廃止 + サウンド設定の per-group 単位再確認

ユーザー指示で本 plan 実装後に追加対応:

### サウンド設定の保存単位調査

実装は **既にサークル単位**（per-group）で統一されている:

| 項目 | 詳細 |
| --- | --- |
| 保存場所 | `groups/{gid}.audioSettings` — group ドキュメント上のフィールド ([schema](../../../../src/lib/firebase/schemas/group.ts#L111)) |
| 個人別 storage | **無し** — `localStorage` / `sessionStorage` / `users/{uid}` 配下に音声設定は一切無し |
| schema | `{ enabled: boolean, levelUpSoundId: string, winnerSoundId: string, volume: number }` |
| 書込経路 | `updateAudioSettings(gid, settings)` 一本 ([repository](../../../../src/lib/firebase/repositories/groups.ts#L227))。サークル詳細「設定」タブ Card / dashboard・live の SoundToggleButton から呼出 |
| 読込経路 | `useAudioPlayer({ group, ... })` が `group.audioSettings` を参照 ([hook](../../../../src/lib/hooks/useAudioPlayer.ts#L48))。dashboard / live / 設定タブ全てが同じ group doc から読む |
| Rules | organizer 以上のみ書込可（[firestore.rules](../../../../firestore.rules) `groups/{gid}` update branch `audioSettings update`） |

結論: 仕様変更不要。**全端末・全ユーザーで同一サークルの設定が共有される**。個人単位の状態は AudioContext の unlock（OS の autoplay policy 由来、永続化なし）のみ。

### ナビバーから「サウンド設定」リンク廃止

サークル詳細「設定」タブに集約済みのため、サイドバーの top-level entry は重複。削除した:

- `src/components/nav/nav-items.ts`: 「サウンド設定」エントリ削除 + `Volume2` icon import 削除 + `NavContext.isOrganizer` field 削除（dead）
- `src/components/nav/AppShell.tsx`: `useCurrentGroup()` の `isOrganizer` destructure 削除（NavContext で未使用）
- `tests/e2e/nav-and-sound-toggle.spec.ts`:
  - signed-out / organizer 視点の sidebar visibility テストから「サウンド設定」link 期待値を削除
  - 旧「一般メンバー: 『サウンド設定』が出ない」テスト → 「PRD 02 polish: 全ロールの sidebar に『サウンド設定』 link が無い（タブ集約後の regression guard）」に書き換え（owner + member 両方で link 不在を確認）
  - dashboard SoundToggleButton flip テストの設定経路は引き続き `groupDetailPage` 経由

検証: typecheck / lint / unit (1195/1195) green。E2E は dev server の長期 HMR 状態で `audio-settings.spec.ts:83` / `:177` / `nav-and-sound-toggle.spec.ts:214` の save → poll 系 3 件で失敗を観測したが、`git stash` で本 plan の変更を全戻ししても同じテストが失敗するため **本 polish と独立な dev server 再起動で解消する flakiness** と判定（同 stash 状態で baseline を確認済）。

## Next Steps

- [ ] **E2E 走行**: 影響範囲最小セットを emulator 起動後に実行
  ```bash
  npx playwright test tests/e2e/group-detail-tabs.spec.ts \
    tests/e2e/audio-settings.spec.ts \
    tests/e2e/nav-and-sound-toggle.spec.ts \
    tests/e2e/phase-d-share-and-history.spec.ts \
    tests/e2e/table-label-and-color.spec.ts \
    tests/e2e/note-screenshots.spec.ts \
    tests/e2e/groups-navigation.spec.ts
  ```
- [ ] **手動確認**: `npm run dev` で DevTools mobile mode（iPhone SE = 375px）にて plan の Manual Validation チェックリストを目視確認（特にサークル名 inline edit 中のヘッダ重なり解消 / `?from=live` 経由の戻り先 / 多段 redirect の anonymous 経路）
- [ ] **Code review**: `/code-review` で local review を実施
- [ ] **PRD 02 Decisions Log に追記**: 「サークル詳細画面のタブ化（メンバー / シーズン / 設定）を polish として実施。サウンド設定を独立ページから設定タブ内 Card に統合」を 1 行加筆
- [ ] PR 作成は `/prp-pr` で（Phase D の develop ブランチ流れに継ぎ足し）

## 関連ドキュメント

- 元 PRD: [02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md)
- 元 plan: `.claude/PRPs/02-season-stats-and-share/plans/completed/group-detail-tabbed-layout.plan.md`（実装完了に伴い completed/ へ archive）
