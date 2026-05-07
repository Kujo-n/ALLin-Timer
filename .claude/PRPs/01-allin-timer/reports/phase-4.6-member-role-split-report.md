# Implementation Report: Phase 4.6 — Member Role Split

## Summary

サークル所属を 3 階層ロール（owner / organizer / general member）に拡張した。`groups/{gid}.ownerUid: string` を `ownerUids: string[]` に、`organizerUids: string[]` を新設する破壊的スキーマ変更を伴い、Firestore Security Rules を全面書換。既存メンバーは migration で全員 organizer に昇格する想定。一般メンバーは `/tournaments` 一覧を閲覧してワンタップで参加できる（`/live` の「参加する」ボタン）。ロール昇降格はオーナー専用で、最後のオーナー降格 / 脱退は service + rule で二重ガード。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Large            | Large          |
| Confidence    | -                | High           |
| Files Changed | ~22              | 20             |

## Tasks Completed

| #   | Task                                       | Status     | Notes                                                |
| --- | ------------------------------------------ | ---------- | ---------------------------------------------------- |
| 1   | zod schema extension                       | [done]     | `ownerUids` / `organizerUids` 追加、invariant refine |
| 2   | repository field updates + updateGroupRoles | [done]    |                                                      |
| 3   | Firestore Security Rules rewrite           | [done]     | `isOrganizer` / `isOwner` 追加、structures/tournaments の write を `isOrganizer` に強化 |
| 4   | group service role promotion/demotion      | [done]     | `promoteToOrganizer` / `demoteToMember` / `promoteToOwner` / `demoteOwner` + 最後のオーナー保護 |
| 5   | useCurrentGroup role context               | [done]     | `currentGroupRole` / `isOrganizer` / `isOwner` 派生 |
| 6   | UI role gates                              | [done]     | tournaments / structures / dashboard / group-detail / tournament-new / structure-new / edit 画面を gate |
| 7   | consumeJoinCode 変更不要の確認             | [done]     | memberUids のみ arrayUnion、rule で不変条件を強制 |
| 8   | migration script                           | [done]     | `scripts/migrate-phase-4.6-roles.ts`（dry-run 対応・冪等）|
| 9   | group-membership.md 更新                   | [done]     | 3 階層ロール / 権限マトリクス / 遷移 |
| 10  | README migration 手順追記                  | [done]     | Phase 4.6 section を追加 |
| 11  | tests                                      | [done]     | 315 tests passed（service 12 件・repository 3 件・schema 3 件追加）|
| 12  | PRD 更新                                   | [done]     | Phase 4.6 を complete、report リンク追記 |

## Validation Results

| Level           | Status      | Notes           |
| --------------- | ----------- | --------------- |
| Static Analysis | [done] Pass | `npm run typecheck` — zero errors（scripts/ は tsconfig exclude に追加）|
| Lint            | [done] Pass | `npm run lint` — No warnings |
| Unit Tests      | [done] Pass | `npm test -- --run` — 315 tests pass |
| Build           | [done] Pass | `npm run build` — all 13 static pages generated |
| Integration     | N/A         | E2E は scope 外（Phase 5 ドライランで検証） |
| Edge Cases      | [done] Pass | 最後のオーナー降格 / idempotent 昇格 / target-not-organizer / invariant 違反などを unit test で cover |

## Files Changed

| File                                                                | Action  |
| ------------------------------------------------------------------- | ------- |
| `src/lib/firebase/schemas/group.ts`                                  | UPDATE  |
| `src/lib/firebase/repositories/groups.ts`                            | UPDATE  |
| `src/lib/services/group.ts`                                          | UPDATE  |
| `src/lib/services/current-group.tsx`                                 | UPDATE  |
| `firestore.rules`                                                    | UPDATE  |
| `src/app/groups/[gid]/group-detail-client.tsx`                       | UPDATE  |
| `src/app/groups/groups-client.tsx`                                   | UPDATE  |
| `src/app/groups/join/[code]/join-group-client.tsx`                   | UPDATE  |
| `src/app/tournaments/tournaments-client.tsx`                         | UPDATE  |
| `src/app/tournaments/new/tournament-new-client.tsx`                  | UPDATE  |
| `src/app/tournaments/[tid]/dashboard-client.tsx`                     | UPDATE  |
| `src/app/tournaments/[tid]/edit/tournament-edit-client.tsx`          | UPDATE  |
| `src/app/tournaments/[tid]/live/live-client.tsx`                     | UPDATE  |
| `src/app/tournaments/[tid]/live/live-client.test.tsx`                | UPDATE  |
| `src/app/structures/structures-client.tsx`                           | UPDATE  |
| `src/app/structures/new/structure-new-client.tsx`                    | UPDATE  |
| `src/app/structures/[sid]/edit/structure-edit-client.tsx`            | UPDATE  |
| `src/lib/firebase/schemas/index.test.ts`                             | UPDATE  |
| `src/lib/services/group.test.ts`                                     | UPDATE  |
| `src/lib/firebase/repositories/groups.test.ts`                       | CREATE  |
| `scripts/migrate-phase-4.6-roles.ts`                                 | CREATE  |
| `tsconfig.json`                                                      | UPDATE  |
| `README.md`                                                          | UPDATE  |
| `.claude/rules/group-membership.md`                                  | UPDATE  |
| `.claude/PRPs/prds/allin-timer.prd.md`                               | UPDATE  |

## Deviations from Plan

- **`tsconfig.json` の exclude に `scripts` を追加**: migration スクリプトが `firebase-admin` を import するが、本体 app は未使用のため package.json に追加せずスクリプト単体で `npx tsx` 実行前提。tsc noEmit 時に未解決モジュール扱いで fail するため exclude で回避。
- **`page.tsx` は既に Client Component 化済みだが「ストラクチャ」ボタンを持たない**: Plan Task 6-6 は不要。対象外として扱い変更なし。
- **`src/app/debug/fs/debug-fs-client.tsx`** は独自のローカル schema で `ownerUid` を使っており、Phase 5 で削除予定のデバッグページのため放置。
- **AuthBadge の role 併記（Plan P1 optional）**: 本 Phase では対象外。/groups 一覧側で role 表示を行うことで代替。

## Issues Encountered

- `live-client.test.tsx` が `joinAsCurrentUser` 追加により `@/lib/services/receipt` 経由で `firebase/client` を読み込み、env 未設定エラーで失敗 → 軽量 mock を追加して解決。
- Firestore rule の self-leave 条件で organizer 配列の不正操作を防ぐため、`resource.data.organizerUids.hasAll(request.resource.data.organizerUids)`（new ⊆ old）チェックを追加。プランの rule 記述より厳しく締めた。

## Tests Written

| Test File                                           | Tests added | Coverage                                              |
| --------------------------------------------------- | ----------- | ----------------------------------------------------- |
| `src/lib/services/group.test.ts`                    | 12 new      | 昇降格 4 関数 × 2-3 path + leaveGroup の owner-2 path |
| `src/lib/firebase/repositories/groups.test.ts`      | 3           | createGroup 3 配列セット / updateGroupRoles / removeMemberSelf |
| `src/lib/firebase/schemas/index.test.ts`            | 4 new       | 3 階層 invariant refine と valid パターン               |

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
- [ ] **本番 Firestore に migration 適用前**: `npx tsx scripts/migrate-phase-4.6-roles.ts --dry-run` → 本実行 → `firebase deploy --only firestore:rules`（README 参照）
- [ ] （任意）emulator rules test の追加 — 本 Phase は unit test のみで service 層をカバー、emulator レベルの rule テストは Phase 5 ドライランで実施
