# Implementation Report: Phase 2.5 — Group (サークル) Management

## Summary

サークル（group）を第一級エンティティとして導入し、`structures` / `tournaments` を `ownerUid` 個人所有モデルから `groupId` + `createdByUid` 共有所有モデルへ破壊的に移行した。`/groups`・`/groups/new`・`/groups/[gid]`・`/groups/join/[code]` の 4 ページを追加し、招待コードで運営者を相互招待できるフローを構築。Firestore Security Rules も group メンバーシップ判定（`isGroupMember`/`isGroupOwner` helper）に置き換えた。

## Assessment vs Reality

| Metric | Predicted (Plan) | Actual |
|---|---|---|
| Complexity | Large | Large（破壊的変更 + UI 全面追加で想定通り） |
| Confidence | High | High（既存 Phase 2 パターンの踏襲で迷いは少なかった） |
| Files Changed | 30〜40 | 28（新規 17 + 更新 11） |

## Tasks Completed

| # | Task | Status | Notes |
|---|---|---|---|
| 1 | group / groupJoinCode schemas 追加 | Complete | |
| 2 | userProfileBodySchema に groupIds 追加 | Complete | `default([])` |
| 3 | structure / tournament schemas を groupId+createdByUid に移行 | Complete | 破壊的変更（互換層なし） |
| 4 | repositories/groups.ts 追加 | Complete | `listMyGroups` は逆引き＋ allSettled で drift 対応 |
| 5 | repositories/groupJoinCodes.ts 追加 | Complete | code は base36 ベース 16 文字 |
| 6 | repositories/users.ts に groupIds ヘルパ追加 | Complete | arrayUnion / arrayRemove |
| 7 | repositories/structures.ts を groupId ベースに | Complete | client-side sort 維持 |
| 8 | repositories/tournaments.ts を groupId ベースに | Complete | `startTournament` / `deleteTournamentIfSetup` に `userGroupIds` 引数追加 |
| 9 | services/group.ts 追加 | Complete | `runTransaction` で usesCount++ と memberUids 追加を atomic |
| 10 | services/current-group.tsx Provider 追加 | Complete | localStorage 永続化＋ drift 修復 |
| 11 | layout.tsx に GroupProvider 追加 | Complete | AuthProvider の内側 |
| 12 | RequireGroup ガード追加 | Complete | groupIds 0 → `/groups?empty=1` |
| 13 | /groups 一覧ページ | Complete | 切替ボタン + empty 状態 onboarding |
| 14 | /groups/new 作成ページ | Complete | 作成後 setCurrentGroupId + refresh |
| 15 | /groups/[gid] 詳細ページ | Complete | メンバー一覧 / 招待コード発行 / 名前変更 / 脱退 / 削除 |
| 16 | /groups/join/[code] 加入ページ | Complete | 自動 consumeJoinCode + リダイレクト |
| 17 | /tournaments を group コンテキストに | Complete | RequireGroup + listTournamentsByGroup |
| 18 | /structures を group コンテキストに | Complete | RequireGroup + listStructuresByGroup |
| 19 | StructureForm / TournamentForm の props 変更 | Complete | TournamentForm は createdByUid prop を最終的に削除（caller 側のみで保持。記述削減） |
| 20 | AuthBadge に group 切替 UI 追加 | Complete | 1 group は Link、複数は `<Select>`、未所属は警告 Badge |
| 21 | firestore.rules を group メンバーシップに刷新 | Complete | helper 関数 + groups の self-add/leave update rule |
| 22 | receipt.ts のコメント整合化 | Complete | API 不変、コメントのみ更新 |
| 23 | テスト追加／更新 | Complete | schemas/index.test.ts に group/groupJoinCode 追加、services/group.test.ts 新規 |
| 24 | README 更新 | Complete | サークル運用セクション + Phase 2.5 移行手順を追加 |

## Validation Results

| Level | Status | Notes |
|---|---|---|
| Static Analysis (`npm run typecheck`) | Pass | 0 errors |
| Lint (`npm run lint`) | Pass | 0 warnings/errors |
| Unit Tests (`npm test`) | Pass | 59 tests / 6 files（うち新規 8 group + 5 schema） |
| Build (`npm run build`) | Pass | 14 pages（うち新規 4 group routes） |
| Integration | N/A | 手動 E2E は Task 25 として未実行（運用者判断） |
| Edge Cases | Partial | unit 側で代表ケースをカバー。実機 2 アカウントのフルシナリオは未実施 |

## Files Changed

| File | Action | Notes |
|---|---|---|
| `src/lib/firebase/schemas/group.ts` | CREATED | groupBodySchema / GroupDoc / createGroupInputSchema |
| `src/lib/firebase/schemas/groupJoinCode.ts` | CREATED | maxUses は nullable（無制限） |
| `src/lib/firebase/schemas/user.ts` | UPDATED | `groupIds: z.array(z.string()).default([])` |
| `src/lib/firebase/schemas/structure.ts` | UPDATED | ownerUid 削除、groupId/createdByUid 追加 |
| `src/lib/firebase/schemas/tournament.ts` | UPDATED | 同上 |
| `src/lib/firebase/schemas/index.test.ts` | UPDATED | 新 schema fixture / parse test 追加 |
| `src/lib/firebase/repositories/groups.ts` | CREATED | get/list/create/rename/addMember/removeMember/delete |
| `src/lib/firebase/repositories/groupJoinCodes.ts` | CREATED | crypto.getRandomValues ベースのコード生成 |
| `src/lib/firebase/repositories/users.ts` | UPDATED | addGroupIdToUser / removeGroupIdFromUser、初回作成時 `groupIds: []` 明示 |
| `src/lib/firebase/repositories/structures.ts` | UPDATED | listMyStructures → listStructuresByGroup |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATED | listMy → listTournamentsByGroup、start/delete に userGroupIds 引数 |
| `src/lib/services/group.ts` | CREATED | createGroupWithOwner / consumeJoinCode (transaction) / leaveGroup / generateJoinCode / deleteGroupByOwner / renameGroup |
| `src/lib/services/group.test.ts` | CREATED | 16 tests |
| `src/lib/services/current-group.tsx` | CREATED | GroupProvider + useCurrentGroup（localStorage + drift 修復） |
| `src/lib/services/receipt.ts` | UPDATED | コメントのみ |
| `src/lib/services/receipt.test.ts` | UPDATED | makeTournament fixture / userProfile に groupIds: [] 付与 |
| `src/components/auth/RequireGroup.tsx` | CREATED | groupIds 0 → /groups?empty=1 |
| `src/components/auth/AuthBadge.tsx` | UPDATED | group 名表示 + Select 切替 |
| `src/components/structure/StructureForm.tsx` | UPDATED | groupId / createdByUid props |
| `src/components/tournament/TournamentForm.tsx` | UPDATED | groupId props（createdByUid は caller のみ） |
| `src/app/layout.tsx` | UPDATED | GroupProvider 追加 |
| `src/app/page.tsx` | UPDATED | 「サークル一覧へ」リンク追加 |
| `src/app/groups/page.tsx` + `groups-client.tsx` | CREATED | 一覧 + 切替 |
| `src/app/groups/new/page.tsx` + `group-new-client.tsx` | CREATED | 作成フォーム |
| `src/app/groups/[gid]/page.tsx` + `group-detail-client.tsx` | CREATED | 詳細 + 招待コード発行 + 削除/脱退/名前変更 |
| `src/app/groups/join/[code]/page.tsx` + `join-group-client.tsx` | CREATED | 自動 consume |
| `src/app/structures/page.tsx` / `structures-client.tsx` / `new/structure-new-client.tsx` / `[sid]/edit/*` | UPDATED | RequireGroup + group context |
| `src/app/tournaments/page.tsx` / `tournaments-client.tsx` / `new/tournament-new-client.tsx` / `[tid]/dashboard-client.tsx` / `[tid]/edit/tournament-edit-client.tsx` | UPDATED | RequireGroup + group context、`canManage = groupIds.includes(data.groupId)` |
| `firestore.rules` | UPDATED | groups / groupJoinCodes 追加、structures/tournaments を isGroupMember 判定に |
| `README.md` | UPDATED | Phase 2.5 サークル運用 + 破壊的移行手順 |

## Deviations from Plan

- **TournamentForm の `createdByUid` prop を最終的に削除**：plan では「ownerUid → groupId+createdByUid を受ける」と記載があったが、TournamentForm は createdByUid を内部で使わない（caller が `createTournament` 呼出時に付与する）ため、不要な prop を増やすより削除する方が簡潔だった。StructureForm 側は `createStructureInputSchema` に groupId/createdByUid 両方が要求されるため、props として両方受ける plan 通りの設計を維持。
- **`current-group.tsx` で `useRequireGroup` hook は提供せず**、代わりに `RequireGroup` コンポーネントだけを `src/components/auth/` に置いた。plan で言及された hook 名は `RequireGroup` コンポーネントで代替できるため重複を避けた。
- **手動 E2E（Task 25）は未実施**：自動化対象外、本番 Firestore に対する 2 アカウント検証は運用者判断。本実装は型検査・lint・unit test・build の 4 段で green。

## Issues Encountered

- 初回 typecheck で `userProfile` mock fixture（receipt.test.ts）と TournamentDoc fixture が `groupIds: []` / `groupId+createdByUid` 不足でエラー → fixture を更新して解決。
- group.test.ts で `runTransaction` の引数型が複雑なため簡易 `tx` mock に対して `as unknown as Parameters<typeof fn>[0]` でキャスト。
- ESLint 初回失敗は `Label` 未使用のみ（group-detail-client）。import 削除で解決。

## Tests Written

| Test File | Tests | Coverage |
|---|---|---|
| `src/lib/firebase/schemas/index.test.ts` | +8（group / groupJoinCode / structure groupId 必須 / userProfile groupIds default） | schema 層 |
| `src/lib/services/group.test.ts` | +16 | services/group.ts 全 5 関数（createGroupWithOwner / consumeJoinCode の 5 ケース / leaveGroup の 3 ケース / generateJoinCode / deleteGroupByOwner / renameGroup） |
| `src/lib/services/receipt.test.ts` | 0 新規（fixture 更新のみ） | 既存 8 tests を新スキーマ対応 |

合計 6 ファイル / 59 tests green。

## Next Steps

- [ ] Firebase Console から旧 `structures` / `tournaments` コレクションを手動削除（README 記載手順）
- [ ] `firebase deploy --only firestore:rules` で新ルールをデプロイ
- [ ] 本番／プレビューで 2 アカウント手動 E2E（README「サークル運用」フロー）
- [ ] PRD の Phase 2.5 を `complete` に更新
- [ ] `/code-review` または `/prp-pr` でレビュー / PR 作成
