# Implementation Report: Dryrun Feedback Batch 1（トーナメント名・参加済み表示・ゴミデータ整理・観戦自動オフ）

## Summary

ドライラン参加サークルから挙がった 4 件の改善要望を 1 polish batch（Phase C.1）として実装:

1. **改善 1** — 新規トーナメント作成画面の name デフォルトを `[サークル名]トーナメント-X` → `Tournament-No.X` に変更（サークル名非依存・簡潔化）。clone 画面のデフォルトも同型に更新
2. **改善 2** — 一覧画面で member 視点の「自分が参加済み tournament」を `getPlayer(tid, uid)` の Promise.allSettled で並列判定し、ボタンを `variant="outline"` + label "参加済み" に切替（link は `/live` のまま、受付確認 UX に到達できる動線を維持）
3. **改善 3a** — `groups/{gid}.latestJoinCodeId: string | null` を additive 追加し、`generateJoinCode` service を 4 ステップ化（read prev → create new → update pointer → best-effort delete prev）。`groupJoinCodes` delete rule を `isOwner` → `isOrganizer` に widening
4. **改善 3b** — `scripts/cleanup-old-anonymous-users.ts` を新規追加。`providerData.length === 0 && metadata.creationTime < now - 7d` の匿名 Auth user + `users/{uid}` doc を bulk delete。`players` / `seasonStats` / `seasonHistory` は意図的に保持（過去トーナメント参照時の displayName snapshot 維持）
5. **改善 4** — `finishTournament` tx の `tx.update(ref, {...})` に `spectateEnabled: false` を additive 追加。終了済み tournament の anon 公開放置を防ぐ（運営者の手動 toggle 自由度は維持）

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium |
| Confidence    | (not stated)     | High（plan に沿って実装、deviation 軽微） |
| Files Changed | 約 14            | 27（test 修正 / GroupDoc fixture 多数で増加） |

## Tasks Completed

| #   | Task        | Status   | Notes               |
| --- | ----------- | -------- | ------------------- |
| 1   | デフォルト名を `Tournament-No.X` に変更 | Complete | clone-client も同型に更新（plan の対象外だったが UX 一貫性のため同時更新） |
| 2   | 旧文字列を assert する test 検索 | Complete | 該当 test ゼロ（spec ファイルのみ更新） |
| 3   | 一覧 component に「参加済み」判定追加 | Complete | `Promise.allSettled` + warn ログでの fail-safe を採用 |
| 4   | vitest で参加済み表示の分岐 | Complete | 5 新規 test 追加（organizer / joined member / unjoined member / partial fail / anon） |
| 5   | `latestJoinCodeId` を schema に additive 追加 | Complete | - |
| 6   | `updateLatestJoinCodeId` / `deleteJoinCode` を repository に追加 | Complete | - |
| 7   | `generateJoinCode` を 4 ステップ化 | Complete | - |
| 8   | Firestore rules（delete widening + latestJoinCodeId branch） | Complete | - |
| 9   | emulator validator `scripts/test-rules-latest-join-code.mjs` | Complete | 8 case 全 green |
| 10  | `generateJoinCode` unit tests | Complete | 6 case（prev null / non-organizer / re-issue / collision retry / best-effort fail / pointer failure） |
| 11  | `deleteJoinCode` unit tests + `updateLatestJoinCodeId` 単独 test | Complete | groupJoinCodes.test.ts 新規 / groups.test.ts に 3 case 追加 |
| 12  | `cleanup-old-anonymous-users.ts` 新規 script | Complete | - |
| 13  | `package.json` npm scripts（`cleanup:old-anonymous-users` + `test:rules-latest-join-code`） | Complete | - |
| 14  | `finishTournament` tx で `spectateEnabled: false` | Complete | - |
| 15  | `finishTournament` の unit test 更新 | Complete | 既存 test を壊さず additive で「auto-disables spectateEnabled on finish」を追加 |
| 16  | PRD 05 — Decisions Log（改善 1 / 改善 2 を追加） | Complete | Track C / Phase C.1 は plan 前に pre-populated 済み |
| 17  | `.claude/rules/firebase-patterns.md` / `group-membership.md` 更新 | Complete | - |

## Validation Results

| Level           | Status | Notes           |
| --------------- | ----- | --------------- |
| Static Analysis (`npm run typecheck`) | Pass | Zero type errors |
| Static Analysis (`npm run lint`)       | Pass | Zero ESLint warnings |
| Unit Tests (`npm run test`)            | Pass | 1383 / 1383 全 green（83 files） |
| Build (`npm run build`)                | Pass | Next.js build 成功 |
| Rules drift (`npm run test:rules-limits`) | Pass | 14 / 14 |
| Rules emulator (`npm run test:rules-latest-join-code`) | Pass | 8 / 8（allow / deny ケース完備） |
| Cleanup script dry-run                 | N/A   | service-account.json 未配置のため smoke のみ（env-missing で正しく早期 exit） |

## Files Changed

### Source (実装)

| File           | Action  | Notes |
| -------------- | ------- | ----- |
| `src/app/tournaments/new/tournament-new-client.tsx` | UPDATE | defaultName を `Tournament-No.X` 形式に変更 |
| `src/app/tournaments/[tid]/clone/clone-client.tsx` | UPDATE | clone 画面の defaultName も同型に揃える |
| `src/app/tournaments/tournaments-client.tsx` | UPDATE | `useAuthUser` / `getPlayer` で member 視点の参加済み判定を追加 |
| `src/lib/firebase/schemas/group.ts` | UPDATE | `latestJoinCodeId: z.string().nullable().default(null)` を additive 追加 |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | `updateLatestJoinCodeId` を追加 / `createGroup` の初期 doc に `latestJoinCodeId: null` |
| `src/lib/firebase/repositories/groupJoinCodes.ts` | UPDATE | `deleteJoinCode(code)` を追加 |
| `src/lib/services/group.ts` | UPDATE | `generateJoinCode` を 4 ステップ化（getGroup → assertOrganizer → createJoinCode → updateLatestJoinCodeId → deleteJoinCode best-effort） |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | `finishTournament` tx の `tx.update(ref, ...)` に `spectateEnabled: false` を additive 追加 |
| `firestore.rules` | UPDATE | `groups/{gid}` update に `latestJoinCodeId` 単独書換 branch additive 追加 / `groupJoinCodes` delete を `isOwner` → `isOrganizer` に widening |

### Scripts / Config

| File           | Action  | Notes |
| -------------- | ------- | ----- |
| `scripts/cleanup-old-anonymous-users.ts` | CREATE | 匿名 Auth + `users/{uid}` doc を 7 日 cutoff で bulk delete |
| `scripts/test-rules-latest-join-code.mjs` | CREATE | emulator validator（REST API + HTTP status 判定）|
| `package.json` | UPDATE | `cleanup:old-anonymous-users` / `test:rules-latest-join-code` npm scripts 追加 |

### Tests

| File           | Action  | Notes |
| -------------- | ------- | ----- |
| `src/app/tournaments/tournaments-client.test.tsx` | UPDATE | useAuthUser / getPlayer mock 追加 + 「参加済み表示」describe 5 新規 |
| `src/lib/firebase/repositories/groupJoinCodes.test.ts` | CREATE | `deleteJoinCode` unit test 2 case |
| `src/lib/firebase/repositories/groups.test.ts` | UPDATE | `updateLatestJoinCodeId` describe 3 case |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATE | 「auto-disables spectateEnabled on finish」test 1 case |
| `src/lib/services/group.test.ts` | UPDATE | `generateJoinCode` describe を 2 → 6 case に拡張 |
| `src/lib/firebase/schemas/index.test.ts` / `src/lib/hooks/useAudioPlayer.test.tsx` / `src/lib/services/account-delete.test.ts` / `src/app/groups/[gid]/season/history/[seasonId]/season-history-detail-client.test.tsx` | UPDATE | GroupDoc fixture に `latestJoinCodeId: null` 追加 |

### Docs

| File           | Action  | Notes |
| -------------- | ------- | ----- |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | UPDATE | Decisions Log に改善 1 / 改善 2 の意思決定を追加 |
| `.claude/rules/firebase-patterns.md` | UPDATE | allowed-keys 表に `latestJoinCodeId update` 行を追加 |
| `.claude/rules/group-membership.md` | UPDATE | データモデル節に `latestJoinCodeId` を追記 / 招待コード設計原則に「再発行時の旧コード処理」を追加 / `Tournament-No.X` 表記に更新 |
| `docs/specification/02-circles-and-membership.spec.md` / `docs/specification/04-tournaments.spec.md` | UPDATE | デフォルト名表記を `Tournament-No.X` に更新 |

## Deviations from Plan

1. **clone-client.tsx も defaultName を変更**（plan 対象外）
   - **Why**: 新規作成画面と clone 画面で異なるデフォルト名形式が混在すると UX が一貫しない。`grep "トーナメント-"` で検出した実コードは新規作成 + clone の 2 箇所のみだったため、同 commit で揃えた
2. **`updateLatestJoinCodeId` の unit test は groupJoinCodes.test.ts 新規ではなく groups.test.ts に追加**
   - **Why**: `updateLatestJoinCodeId` は `repositories/groups.ts` の関数のため、`groups.test.ts` の既存 describe（`updateGroupRoles` / `updateAudioSettings` 等）と並列に置く方が自然。`groupJoinCodes.test.ts` は `deleteJoinCode` 専用で新規作成
3. **`generateJoinCode` 既存テストも書き換え**（plan は「追加」のみだったが）
   - **Why**: 既存の 2 case は `createJoinCode` のみ mock しており、4 ステップ化で必要な `getGroup` / `updateLatestJoinCodeId` mock が抜けていた。同 describe ブロックを 6 case に拡張する形で再構築

## Issues Encountered

- **GroupDoc fixture の `latestJoinCodeId: null` 必須化** — schema が `.nullable().default(null)` のため、z.infer 後の型は `latestJoinCodeId: string | null`（required）になる。`useAudioPlayer.test.tsx` / `account-delete.test.ts` / `group.test.ts` / `season-history-detail-client.test.tsx` / `schemas/index.test.ts` の各 fixture を追加更新。pattern は既存の `joinCodeId: null` / `seasonStartDate: null` 追加と同型
- **`tournaments-client.test.tsx` で Firebase init error** — `useAuthUser` import が `firebaseAuth` を transitively 引っ張る。`vi.mock("@/lib/firebase/AuthProvider", ...)` を追加して mock 境界を整える。既存の `useCurrentGroup` mock と同方針

## Tests Written

| Test File      | Tests   | Coverage       |
| -------------- | ------- | -------------- |
| `src/app/tournaments/tournaments-client.test.tsx` | +5 case | 一覧画面の参加済み表示分岐（organizer / joined / unjoined / partial fail / anon）|
| `src/lib/firebase/repositories/groupJoinCodes.test.ts` | 2 case（新規 file）| `deleteJoinCode` の呼出形 + error wrapping |
| `src/lib/firebase/repositories/groups.test.ts` | +3 case | `updateLatestJoinCodeId`（string / null / error wrap）|
| `src/lib/firebase/repositories/tournaments.test.ts` | +1 case | `finishTournament` tx で `spectateEnabled: false` が書込まれる |
| `src/lib/services/group.test.ts` | +6 case（既存 2 を含めて再構築） | `generateJoinCode` の 4 ステップ化（prev null / non-organizer reject / re-issue / collision / best-effort fail / pointer failure）|

## Next Steps

- [ ] Run `firebase deploy --only firestore:rules`（**完了報告に必須**。emulator green でも本番未 deploy で permission-denied する罠）
- [ ] Code review via `/code-review` または `/ultrareview <PR#>`
- [ ] Create PR via `/prp-pr`
- [ ] 本番運用後の `cleanup:old-anonymous-users` 実行ガイドを README / 運用ドキュメントに追記（plan の NOT Building 範囲外で別途）
