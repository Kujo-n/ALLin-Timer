# Implementation Report: Phase A.2 — Background Image UI & SSR

## Summary

Phase A.1 で確立した Storage 基盤と `groups/{gid}.{winnerCardBackground, seasonCardBackground}` Firestore pointer の上に、**owner がサークル詳細画面の設定タブから背景画像をアップロード・差し替え・解除**できる UI を組み、OG SSR route (`/api/og/winner/[tid]` / `/api/og/season/[gid]`) で背景画像 + 半透明 scrim を表示する一連の機能を実装した。

主な追加・変更:

- 画像クライアント圧縮（canvas API 1200×630 jpeg 0.8）
- 指数 backoff retry helper（旧 asset 確実削除）
- Storage 入出力 repository（path: `groups/{gid}/bgImages/{assetId}`）
- card-background service（upload + Firestore 更新 + 旧 asset retry 削除のオーケストレーション）
- `WinnerCardBackgroundCard` / `SeasonCardBackgroundCard` 共通基底 + thin wrapper
- OG payload schema 拡張（`bgImageUrl` / `bgTextTheme` optional query）
- OG SSR route で fetch + base64 data URI → Satori `<img>` 背景 + 半透明 scrim + theme で foreground 反転
- 下流 4 callsite（dashboard / live / season ランキング / 過去シーズン詳細）に `cardBackground` prop を伝搬

本 phase では Firestore / Storage rules には変更を加えず、A.1 で完成済の rule の上で SDK + UI を組むのみ。

## Assessment vs Reality

| Metric        | Predicted (Plan)                    | Actual                          |
| ------------- | ----------------------------------- | ------------------------------- |
| Complexity    | Large (15〜18 ファイル、500〜800 行) | Large (23 ファイル、約 1500 行) |
| Confidence    | 高（A.1 で基盤が確立済）             | 高                              |
| Files Changed | 15〜18                              | 23（新規 11 / 更新 12）         |

## Tasks Completed

| #   | Task                                          | Status      | Notes                                       |
| --- | --------------------------------------------- | ----------- | ------------------------------------------- |
| 1   | retry.ts                                      | Complete    | YAGNI 通り `() => Promise<void>` 専用形    |
| 2   | image-resize.ts                               | Complete    | OG_WIDTH / OG_HEIGHT を import で drift 防止 |
| 3   | cardBackgroundStorage.ts (repository)         | Complete    | object-not-found を冪等扱い                |
| 4   | card-background.ts (service)                  | Complete    | upload / clear / theme-only 6 関数を export |
| 5   | CardBackgroundCard (共通基底)                  | Complete    | 9 件の test で characterization              |
| 6   | Winner/Season wrapper                          | Complete    | thin wrapper 各 30 行未満                    |
| 7   | group-detail-client.tsx 設定タブ拡張           | Complete    | `isOwner` で 2 カード conditional render    |
| 8   | og-payload schema 拡張                         | Complete    | `cardBackgroundQueryFields` helper を追加   |
| 9   | og-image-fetch.ts                              | Complete    | 4 件 test (200 / 404 / network error / mime fallback) |
| 10  | og-card-styles dark theme 色追加               | Complete    | additive のみ、既存 light theme 値は維持   |
| 11  | winner OG route                                | Complete    | bgImageUrl 未指定時は既存挙動完全維持        |
| 12  | season OG route                                | Complete    | 同上                                       |
| 13  | callsites 4 箇所更新                          | Complete    | dashboard / live / ranking / history すべて |
| 14  | 既存テスト追従                                 | Complete    | 全 80 test files / 1331 件 pass             |
| 15  | 全体検証ループ                                 | Complete    | typecheck / lint / test / build / 各 rule emulator regression |

## Validation Results

| Level                          | Status | Notes                                                                         |
| ------------------------------ | ------ | ----------------------------------------------------------------------------- |
| Static Analysis (typecheck)    | Pass   | `tsc --noEmit` 0 errors                                                       |
| Static Analysis (lint)         | Pass   | `next lint` warnings 0 / errors 0                                             |
| Unit Tests                     | Pass   | 80 files / 1331 tests（A.2 で +33 件追加: retry 5 / image-resize 5 / card-background 10 / og-image-fetch 4 / og-payload 9 / CardBackgroundCard 9） |
| Build                          | Pass   | `next build` 成功。OG route の SSR 評価で `fetchAsDataUri` / Storage SDK 参照に起因するエラーなし |
| Emulator rules (regression)    | Pass   | test:rules-limits 14/14 / test:rules-card-background 11/11 / test:storage-rules 10/10 |

## Files Changed

新規:

| File                                                                                | Action  |
| ----------------------------------------------------------------------------------- | ------- |
| `src/lib/utils/retry.ts`                                                            | CREATE  |
| `src/lib/utils/retry.test.ts`                                                       | CREATE  |
| `src/lib/utils/image-resize.ts`                                                     | CREATE  |
| `src/lib/utils/image-resize.test.ts`                                                | CREATE  |
| `src/lib/firebase/repositories/cardBackgroundStorage.ts`                            | CREATE  |
| `src/lib/services/card-background.ts`                                               | CREATE  |
| `src/lib/services/card-background.test.ts`                                          | CREATE  |
| `src/app/groups/[gid]/_components/CardBackgroundCard.tsx`                           | CREATE  |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`                      | CREATE  |
| `src/app/groups/[gid]/_components/WinnerCardBackgroundCard.tsx`                     | CREATE  |
| `src/app/groups/[gid]/_components/SeasonCardBackgroundCard.tsx`                     | CREATE  |
| `src/app/api/og/_lib/og-image-fetch.ts`                                             | CREATE  |
| `src/app/api/og/_lib/og-image-fetch.test.ts`                                        | CREATE  |

更新:

| File                                                                                 | Action  |
| ------------------------------------------------------------------------------------ | ------- |
| `src/app/groups/[gid]/group-detail-client.tsx`                                        | UPDATE  |
| `src/app/api/og/_lib/og-card-styles.ts`                                              | UPDATE  |
| `src/app/api/og/_lib/og-payload.ts`                                                  | UPDATE  |
| `src/app/api/og/_lib/og-payload.test.ts`                                             | UPDATE  |
| `src/app/api/og/winner/[tid]/route.tsx`                                              | UPDATE  |
| `src/app/api/og/season/[gid]/route.tsx`                                              | UPDATE  |
| `src/components/tournament/WinnerCardDownloadButton.tsx`                             | UPDATE  |
| `src/components/group/SeasonTopCardDownloadButton.tsx`                               | UPDATE  |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                                     | UPDATE  |
| `src/app/tournaments/[tid]/live/live-client.tsx`                                     | UPDATE  |
| `src/app/groups/[gid]/season/season-ranking-client.tsx`                              | UPDATE  |
| `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.tsx`    | UPDATE  |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md`               | UPDATE  |

## Deviations from Plan

1. **`CardBackgroundCard` の gid 注入方法**: Plan では「kind による service 分岐」を主軸に書いたが、共通基底の責務をシンプルにするため `gid` を Props で明示的に渡す設計に変えた（最初に書いた "context shim" は不要と判断して破棄）。結果として wrapper は薄くなり、テストでも gid を明示できるようになった。
2. **`live-client.tsx` の URL 組立**: Plan では `buildWinnerShareInputs` 経由に集約とあったが、既存コードは `buildWinnerCardUrl` をその場で呼ぶ手書きパスを使っていたため、最小差分で `bgImageUrl` / `bgTextTheme` を spread で注入する形に留めた（既存挙動を完全維持）。
3. **`updateCardBackgroundTextTheme` の責務分離**: Plan では 1 関数だったが、winner / season 対称性を保つため `updateWinnerCardBackgroundTextTheme` / `updateSeasonCardBackgroundTextTheme` の 2 関数に分けた（kind dispatch を component 側で行う設計に合わせた）。

## Issues Encountered

1. **vitest の `vi.restoreAllMocks` で `mockResolvedValue` が消える**: `CardBackgroundCard.test.tsx` で `afterEach(vi.restoreAllMocks)` を入れていたところ、後続テストで `resizeImageToCardSize` mock が undefined を返すようになった。`beforeEach` で `mockReset().mockResolvedValue(...)` で明示再 stub する形に修正。
2. **jsdom が `URL.createObjectURL` / `revokeObjectURL` を提供しない**: 画像 helper / カード component の test で `vi.spyOn(URL, "createObjectURL")` が `does not exist` で失敗。`beforeEach` で method 自体を生やしてから spyOn する形にした。
3. **`fireEvent.change` の async onChange が同期完了しない**: file input の change イベントで `void onFileChange(e)` を fire-and-forget で起動するため `await act` だけでは preview state まで待てなかった。`waitFor` で「保存」ボタンの enabled 状態を待つことで安定化。
4. **`retry.test.ts` の `backoffMs=[] / attempts=3` 時の fakeTimers でタイムアウト**: `setTimeout(resolve, 0)` を `vi.advanceTimersByTimeAsync(0)` で進めても microtask の完了を捕捉できないケースがあったため、当該テスト 1 件は `vi.useRealTimers()` に倒して 0ms sleep でも即進む形にした。

## Tests Written

| Test File                                                              | Tests   | Coverage                                                         |
| ---------------------------------------------------------------------- | ------- | ---------------------------------------------------------------- |
| `src/lib/utils/retry.test.ts`                                          | 5 tests | success / final-failure / abort / backoffMs 不足                  |
| `src/lib/utils/image-resize.test.ts`                                   | 5 tests | landscape / portrait / canvas null / toBlob null / Image error    |
| `src/lib/services/card-background.test.ts`                             | 10 tests | upload / clear / theme-only / orphan warn / 全 6 関数              |
| `src/app/api/og/_lib/og-image-fetch.test.ts`                          | 4 tests | 200 / content-type fallback / 404 / fetch reject                   |
| `src/app/api/og/_lib/og-payload.test.ts`                              | +9 tests | bg query 受信 / build* に cardBackground 引数 / null 時の互換性 |
| `src/app/groups/[gid]/_components/CardBackgroundCard.test.tsx`         | 9 tests | canEdit / size limit / mime / save success / save fail / clear / theme |

## Next Steps

- [ ] `/code-review` で本 phase の差分を一通り通す（Codex review）
- [ ] `/prp-pr` で PR 作成、A.1 のドライランと合わせて手動 UI 検証を実施
- [ ] Phase A.3（Layout Polish & Readability）プランの作成（依存 A.2）

## Notes

- 本 phase は **Firestore / Storage rules を一切変更していない**ため、本番 deploy は不要（A.1 マージ後の deploy が済んでいる前提）。
- `npm run test:e2e` は本 phase の UI を検証しないため、手動検証（plan の検証チェックリスト 9 項目）を PR 確認時に追加で行う必要がある。
- 過去シーズン詳細画面 (`season-history-detail-client.tsx`) では PRD MVP 方針通り、**現在の `group.seasonCardBackground` を流用**して背景画像を表示する（シーズンスナップショット背景は別 phase で）。
