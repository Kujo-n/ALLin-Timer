# Implementation Report: Phase 4 — メンバー除外 UI

## Summary

オーナーがサークル詳細画面のメンバー一覧から他メンバーを除外できるようにした。
`groups/{gid}` の owner-update 経路（`memberUids` を含むフル update を許可済み）にそのまま乗るため、
**`firestore.rules` / zod schema には一切差分がない**。追加したのは repository 1 関数 +
service 1 関数 + UI（行ごとの「除外」ボタン ＋ 確認ダイアログ）＋ 配線のみ。

自動所属（Phase 1〜3）で入った誤参加者・一見さんを事後回収する手段であり、PRD の Q7
「後で削除できれば問題なし」という許容条件を満たす。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual                            |
| ------------- | ---------------- | --------------------------------- |
| Complexity    | Small〜Medium    | Small〜Medium（想定どおり）       |
| Confidence    | High             | High — 想定外の障害なし           |
| Files Changed | 9（新規 3 / 更新 6）| 10（新規 3 / 更新 7）※PRD 含む |

## Tasks Completed

| #   | Task                                                | Status   | Notes                                                              |
| --- | --------------------------------------------------- | -------- | ------------------------------------------------------------------ |
| 1   | `repositories/groups.ts` に `removeOtherMember`      | Complete | 計画どおり。`removeMemberSelf` の直後に追加                        |
| 2   | `services/group.ts` に `removeMemberByOwner`         | Complete | 計画どおり。`demoteOwner` の直後（ファイル末尾）に追加             |
| 3   | `group.test.ts` に unit test 7 ケース                | Complete | 計画のスタブを全て実装。last-owner ケースは矛盾 fixture で固定     |
| 4   | `MemberRoleList.tsx` に「除外」ボタン                | Complete | 計画どおり。`aria-label` は `${displayName} を除外`                |
| 5   | `MemberRoleList.test.tsx` 新規（4 ケース）           | Complete | `joinedViaTournamentId: null` を fixture に追加（計画から補完）    |
| 6   | `RemoveMemberDialog.tsx` 新規                        | Complete | 計画どおり                                                          |
| 7   | `group-detail-client.tsx` に state / handler / dialog | Complete | 計画どおり。`runReloadRefreshAction` 経由                          |
| 8   | `GroupsPage.ts`（POM）に locator / helper            | Complete | 計画どおり                                                          |
| 9   | `tests/e2e/member-removal.spec.ts` 新規（3 ケース）  | Complete | 再加入ケースの待機を emulator REST poll に変更（下記 Deviations）  |
| 10  | `.claude/rules/group-membership.md` 更新             | Complete | 権限マトリクス 1 行 ＋ 新節                                        |
| 11  | PRD の Phase 進捗更新                                | Complete | 着手時点で既に `in-progress` + plan リンク済み → `complete` に更新 |

## Validation Results

| Level                     | Status | Notes                                                              |
| ------------------------- | ------ | ------------------------------------------------------------------ |
| Static Analysis           | Pass   | `npm run typecheck` / `npm run lint` ともに 0 エラー               |
| Unit Tests                | Pass   | `npm test` 1667 passed / 106 files（新規 11 ケース含む）           |
| Build                     | Pass   | `npm run build` 成功                                                |
| Firestore Rules validator | Pass   | `npm run test:rules-limits` 14/14 ALL GREEN                        |
| E2E                       | Pass   | 新規 spec 3/3 pass（全件走行の結果は下記「E2E 全件」参照）         |
| Edge Cases                | Pass   | 計画の Edge Cases Checklist を unit / component / E2E で全て被覆   |

**rule 非変更の確認**: `git diff --stat -- firestore.rules src/lib/firebase/schemas/group.ts` が空。
`firebase deploy --only firestore:rules` は**不要**。

## Files Changed

| File                                                     | Action  | Lines     |
| -------------------------------------------------------- | ------- | --------- |
| `src/lib/firebase/repositories/groups.ts`                 | UPDATED | +36 / -0  |
| `src/lib/services/group.ts`                               | UPDATED | +53 / -1  |
| `src/lib/services/group.test.ts`                          | UPDATED | +121 / -0 |
| `src/app/groups/[gid]/_components/MemberRoleList.tsx`     | UPDATED | +25 / -1  |
| `src/app/groups/[gid]/_components/MemberRoleList.test.tsx`| CREATED | +97       |
| `src/app/groups/[gid]/_components/RemoveMemberDialog.tsx` | CREATED | +57       |
| `src/app/groups/[gid]/group-detail-client.tsx`            | UPDATED | +37 / -0  |
| `tests/e2e/pages/GroupsPage.ts`                           | UPDATED | +27 / -0  |
| `tests/e2e/member-removal.spec.ts`                        | CREATED | +149      |
| `.claude/rules/group-membership.md`                       | UPDATED | +33 / -0  |

## Deviations from Plan

1. **E2E 再加入ケースの待機方法** — 計画では「member 側で `/groups` を開いて自己修復を走らせてから
   再加入する」とだけ書かれていたが、`GroupProvider` の `removeGroupIdFromUser` 完了は DOM から
   観測できない（`groups` state は成功した gid のみを保持するため、除外直後から対象サークルは
   一覧に出ない＝ heal 前後で DOM が変わらない）。時間依存の flaky を避けるため、
   emulator REST（`getDocument` + `listUsers`）で `users/{uid}.groupIds` から gid が消えるまで
   `expect.poll` する形にした。既存 `account-self-delete.spec.ts` / `append-blind-level.spec.ts` の
   poll パターンを踏襲。

2. **`MemberRoleList.test.tsx` の fixture** — 計画の `makeGroup` に `joinedViaTournamentId` が
   無かった（Phase 1 で `GroupDoc` に追加済みのフィールド）。型エラーになるため `: null` を追加。

3. **Task 11 の内容** — 計画では「`pending` → `in-progress` に変更」だったが、着手時点で
   既に `in-progress` + plan リンク済みだった（`/prp-plan` 実行時に更新済み）。実装完了に伴い
   `complete` + 実装レポートリンクに更新した。

## Issues Encountered

- **`group/last-owner` 分岐が整合 fixture では到達不能** — actor ≠ target（ガード 1）かつ
  両者が `ownerUids` に含まれるなら `ownerUids.length >= 2` が必ず成立するため、正しい
  データでは 4 番目のガードに入れない。計画の指示どおり「`length` は 1 のまま `includes` だけ
  両者に true を返す」矛盾 fixture でガードの存在のみを固定し、テスト内コメントで
  「到達不能だが防御として維持」と明記した。

## Tests Written

| Test File                                                  | Tests   | Coverage                                                       |
| ---------------------------------------------------------- | ------- | -------------------------------------------------------------- |
| `src/lib/services/group.test.ts`                            | 7 tests | 正常系 2 / 自己除外 / 非 owner / last-owner / 冪等 / 空文字     |
| `src/app/groups/[gid]/_components/MemberRoleList.test.tsx`  | 4 tests | ボタン表示条件（他人行 / 自分行 / 非 owner / working disabled） |
| `tests/e2e/member-removal.spec.ts`                          | 3 tests | 除外 → 消える / 再加入 / 自己除外ガード                        |

## Next Steps

- [ ] Code review via `/code-review`
- [ ] Create PR via `/prp-pr`
