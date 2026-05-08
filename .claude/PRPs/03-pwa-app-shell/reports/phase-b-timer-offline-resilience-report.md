# Implementation Report: Phase B — Timer Offline Resilience

## Summary

`advanceLevel(auto)` の `runTransaction` 経路に **「tx 試行 → tx 失敗時は updateDoc fallback」の二段構え**を導入し、一時通信障害で auto-advance が即時失敗する現状を解消した。同時に `tournaments/[tid]` ダッシュボードと `/live` 画面の最上段に **`<OfflineBanner />`** を追加し、`fromCache=true`（接続切れ）/ `hasPendingWrites=true`（書込キュー存在）の状態を 1 つの帯で可視化する。multi-tab 警告 UI は Could 扱いとして本 Phase の対象外（Phase D 移送）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | 8/10             | 8/10（手戻りなし） |
| Files Changed | 約 9 files       | 8 files（5 新規 + 3 更新。NO-OP 想定の useTournamentTimer は実際変更なし） |

## Tasks Completed

| #   | Task                                                      | Status          | Notes |
| --- | --------------------------------------------------------- | --------------- | ----- |
| 1   | `firestore-offline.ts` 純関数 helper                      | ✅ Complete     |       |
| 2   | `firestore-offline.test.ts` characterization              | ✅ Complete     | 13 tests |
| 3   | `advanceLevel(auto)` に try/catch + updateDoc fallback    | ✅ Complete     |       |
| 4   | `tournaments.test.ts` Phase B 5 ケース追加                | ✅ Complete     | 既存 5 + 新規 5 = auto 分岐 10 件全 pass |
| 5   | `OfflineBanner.tsx` 新規作成                              | ✅ Complete     |       |
| 6   | `OfflineBanner.test.tsx` 4 ケース                         | ✅ Complete     | 4 tests |
| 7   | `dashboard-client.tsx` に OfflineBanner mount             | ✅ Complete     | `<main>` の最初の子 |
| 8   | `live-client.tsx` に OfflineBanner mount                  | ✅ Complete     | `<main>` の最初の子 |
| 9   | PRD Phase B status を `in-progress` に更新                | ✅ Complete     | plan 作成時に既に反映済み |

## Validation Results

| Level           | Status      | Notes                                 |
| --------------- | ----------- | ------------------------------------- |
| Static Analysis | ✅ Pass     | `tsc --noEmit` zero error             |
| Lint            | ✅ Pass     | `next lint` zero warnings/errors      |
| Unit Tests      | ✅ Pass     | 1182 tests / 68 files all green       |
| Build           | ✅ Pass     | Next.js production build clean        |
| Edge Cases      | ✅ Pass     | offline / non-offline / AppError 素通し / 二重失敗を全網羅 |

## Files Changed

| File                                                                | Action  | Notes |
| ------------------------------------------------------------------- | ------- | ----- |
| `src/lib/services/firestore-offline.ts`                             | CREATE  | OFFLINE_FIRESTORE_ERROR_CODES + isOfflineFirestoreErrorCode |
| `src/lib/services/firestore-offline.test.ts`                        | CREATE  | 13 ケースの characterization |
| `src/lib/firebase/repositories/tournaments.ts`                      | UPDATE  | auto 分岐に try/catch + updateDoc fallback、import に getErrorCode + isOfflineFirestoreErrorCode 追加 |
| `src/lib/firebase/repositories/tournaments.test.ts`                 | UPDATE  | Phase B 用 describe を 1 つ追加（5 ケース） |
| `src/components/tournament/OfflineBanner.tsx`                       | CREATE  | 3 状態（disconnected / syncing / null）を 1 帯で出し分け |
| `src/components/tournament/OfflineBanner.test.tsx`                  | CREATE  | 4 ケース（disconnected 優先 UX を含む） |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                    | UPDATE  | `hasPendingWrites` destructure 追加、`<main>` 直下に banner mount |
| `src/app/tournaments/[tid]/live/live-client.tsx`                    | UPDATE  | 同上 |
| `.claude/PRPs/03-pwa-app-shell/prds/03-pwa-app-shell.prd.md`        | UPDATE  | Phase B status を `pending` → `in-progress`、PRP Plan 列にリンク（plan 生成時に既に反映済み） |

## Deviations from Plan

None — 計画通り実装。`useTournamentTimer.ts` は plan で「NO-OP（既に hasPendingWrites を return 済み）」とされており、実際にも変更不要だったため触っていない。

## Issues Encountered

- 初回 `npx tsc --noEmit` を打ったところユーザーから「`npx` ではなく `npm` を使うこと」と指摘された。プロジェクトの `.claude/settings.json` で `npx*` は ask リスト、`npm run*` / `tsc` 等の bare 呼び出しは allow リストになっているため、以降は `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` に切り替えた（既存メモリの feedback 通り）。

## Tests Written

| Test File                                                | Tests   | Coverage |
| -------------------------------------------------------- | ------- | -------- |
| `src/lib/services/firestore-offline.test.ts`             | 13      | OFFLINE_FIRESTORE_ERROR_CODES 各 / non-offline / firestore/ prefix 形 / 不明 code |
| `src/components/tournament/OfflineBanner.test.tsx`       | 4       | online no-pending / online pending / offline / 両 true 時の disconnected 優先 |
| `src/lib/firebase/repositories/tournaments.test.ts`      | +5      | offline-unavailable fallback / deadline-exceeded / AppError 素通し / non-offline 再 throw / 二重失敗 |

合計: 22 件の新規テスト（既存は全件 green を維持、リグレッションなし）。

## Next Steps

- [ ] Code review via `/code-review`
- [ ] DevTools Network → Offline の **手動検証**（実機で「ブラインドが進む / amber バナーが出る / online 復帰で blue → 消える」を目視確認）
- [ ] Vercel preview で同上を実機検証
- [ ] Create PR via `/prp-pr`
