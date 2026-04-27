# Implementation Report: Phase 4.16 — Tournament Default Name (Finished Counter) + Group 詳細での確認・修正

## Summary

`/tournaments/new` のトーナメント名フィールドを `[<サークル名>]トーナメント-<X>`（X = 終了したトーナメント数 + 1）でプリセットする機能と、サークル詳細画面（`/groups/[gid]`）からその開催数を運営者（owner / organizer）が手動で確認・修正できる UI を追加した。永続化は `groups/{gid}.finishedTournamentCount`（additive zod 拡張、default 0）。`finishTournament()` を `writeBatch` 化して tournament の状態更新と counter インクリメントを atomic に行うよう変更し、Firestore Rules に organizer-only の `finishedTournamentCount` 単独書換 branch を 1 件追加した（自動 +1 と手動補正の両経路をカバー）。

## Assessment vs Reality

| Metric        | Predicted (Plan) | Actual         |
| ------------- | ---------------- | -------------- |
| Complexity    | Medium           | Medium         |
| Confidence    | High             | High           |
| Files Changed | ~12              | 13             |

## Tasks Completed

| #   | Task                                                            | Status      | Notes                                                                                                                                                                                                                  |
| --- | --------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | schema 拡張 — `finishedTournamentCount` を additive 追加        | [done] Complete | `audioSettings` と同列で `z.number().int().nonnegative().default(0)` を追加                                                                                                                                            |
| 2   | `finishTournament` を writeBatch 化                              | [done] Complete | 早期 return → `writeBatch.update` 2 件 → `commit` の構造へ。`increment` を import                                                                                                                                      |
| 3   | Firestore Rules に counter update branch を追加                  | [done] Complete | `audioSettings` branch の直後に OR 追加。`+1 限定` ではなく `>= 0 の int` まで広げて手動修正経路もカバー                                                                                                               |
| 4   | 新規作成画面でデフォルト名を流し込む                             | [done] Complete | `useCurrentGroup().groups` から派生。追加 fetch なし                                                                                                                                                                   |
| 5   | schema test を 3 ケース追加                                      | [done] Complete | legacy default 0 / explicit 7 / negative 拒否                                                                                                                                                                          |
| 6   | `finishTournament` の repository test を更新                     | [done] Complete | `mockBatch` ヘルパーを describe 内に複製。`increment` mock を追加。3 ケース（already-finished / batch update 2 + commit / commit error wrap）                                                                          |
| 7   | repository に `updateFinishedTournamentCount(gid, value)` を追加 | [done] Complete | `updateAudioSettings` パターンに準拠、validation を repository / service の両層で二重防御                                                                                                                              |
| 8   | service に `setFinishedTournamentCount` を追加                  | [done] Complete | 既存の `assertOwner` の隣に `assertOrganizer` ヘルパーを新設                                                                                                                                                            |
| 9   | サークル詳細画面に「開催数」カードを追加                          | [done] Complete | `renameGroup` の inline edit パターンを mirror（`requestAnimationFrame` focus + select / Esc キャンセル / 同値スキップ）                                                                                                |
| 10  | groups repository test に `updateFinishedTournamentCount` ケース追加 | [done] Complete | 4 ケース（happy / 負値 / 小数 / write エラー wrap）                                                                                                                                                                    |
| 11  | service test に `setFinishedTournamentCount` ケース追加          | [done] Complete | 5 ケース（owner / organizer / member / 負値 / 小数）                                                                                                                                                                   |
| 12  | ドキュメント更新（rules / PRD）                                  | [done] Complete | `firebase-patterns.md` と `group-membership.md` に finishedTournamentCount の書込経路・権限マトリクス・既知のセキュリティリスクを追記。PRD は phase 4.16 を complete に更新                                            |

## Validation Results

| Level           | Status      | Notes                                                                                            |
| --------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| Static Analysis | [done] Pass | `npx tsc --noEmit` ゼロエラー                                                                    |
| Lint            | [done] Pass | `npx next lint` 警告なし                                                                         |
| Unit Tests      | [done] Pass | 全 499 件 pass（schema 3 + tournaments 5 + groups 4 + service 5 = 計 17 ケース新規追加）         |
| Build           | [done] Pass | `npx next build` 成功（全ルート bundle 出力あり）                                                |
| Rules Emulator  | [done] Pass | `scripts/test-rules-finished-count.mjs` 経由 8/8 ケース pass（[OK] 自動 +1 / 手動補正 / 一般 member deny / 負値 deny / 同時フィールド変更 deny / owner allow / legacy doc 互換 / self-key 漏洩 deny）。検証中に発見した self-* 分岐の `affectedKeys` 抜けは同 phase で修復 |
| Edge Cases      | [done] Pass | legacy doc default / 二重 finish 防止 / 権限境界 / 負値 / 小数 を全てユニット + rules emulator でカバー |

## Files Changed

| File                                                                              | Action  | 概要                                                                                                              |
| --------------------------------------------------------------------------------- | ------- | ----------------------------------------------------------------------------------------------------------------- |
| `src/lib/firebase/schemas/group.ts`                                               | UPDATED | `finishedTournamentCount` フィールド追加                                                                          |
| `src/lib/firebase/repositories/tournaments.ts`                                    | UPDATED | `finishTournament` を writeBatch + increment 化                                                                   |
| `src/lib/firebase/repositories/groups.ts`                                         | UPDATED | `createGroup` payload に `finishedTournamentCount: 0`、`updateFinishedTournamentCount` を新設                     |
| `src/lib/services/group.ts`                                                       | UPDATED | `assertOrganizer` ヘルパー新設、`setFinishedTournamentCount` を新設                                               |
| `firestore.rules`                                                                 | UPDATED | `groups/{gid}` update に organizer-only `finishedTournamentCount` 単独書換 branch を追加                          |
| `src/app/tournaments/new/tournament-new-client.tsx`                               | UPDATED | `useCurrentGroup().groups` から default name 派生、`<TournamentForm initialName={...} />`                         |
| `src/app/groups/[gid]/group-detail-client.tsx`                                    | UPDATED | 「開催数」Card と inline edit を追加                                                                              |
| `src/lib/firebase/schemas/index.test.ts`                                          | UPDATED | finishedTournamentCount の 3 ケース追加 + `deriveRole` baseGroup fixture を補完                                   |
| `src/lib/firebase/repositories/tournaments.test.ts`                               | UPDATED | `increment` mock 追加、`finishTournament` describe を batch ベースに刷新                                          |
| `src/lib/firebase/repositories/groups.test.ts`                                    | UPDATED | `updateFinishedTournamentCount` の 4 ケース追加                                                                   |
| `src/lib/services/group.test.ts`                                                  | UPDATED | `setFinishedTournamentCount` の 5 ケース追加 + `makeGroup` fixture / repository mock を補完                       |
| `src/lib/hooks/useAudioPlayer.test.tsx`                                           | UPDATED | `makeGroup` fixture に `finishedTournamentCount: 0` を補完                                                        |
| `.claude/rules/firebase-patterns.md`                                              | UPDATED | 「単一フィールドの書込経路を限定するルール」節を追加                                                              |
| `.claude/rules/group-membership.md`                                               | UPDATED | データモデル節 / 権限マトリクス / 既知のセキュリティリスクに `finishedTournamentCount` を追記                     |
| `.claude/PRPs/prds/allin-timer.prd.md`                                            | UPDATED | Phase 4.16 を complete に変更し、レポートへのリンクを追加                                                         |

## Deviations from Plan

- **Estimated Files の差分**: 計画は約 12 ファイルだったが実際は 15 ファイル。差分は (a) `src/lib/hooks/useAudioPlayer.test.tsx`（schema 拡張で `GroupDoc.finishedTournamentCount` が必須プロパティになったため fixture を補完）、(b) `scripts/test-rules-finished-count.mjs`（emulator validation のため新規追加）、(c) `firestore.rules` の self-* 分岐への security patch（下記参照）。
- **groups repo test の payload 取り出し方**: 計画では `mock.calls[0][1] as Record<string, unknown>` の形だったが、`updateDoc` の overload 型推論でキャストエラーになるため、既存 `updateAudioSettings` テストと同じ `const [, patch] = vi.mocked(updateDoc).mock.calls[0]` のパターンに揃えた（同等以上の検証）。
- **`finishTournament` の atomicity 戦略**: 計画では `writeBatch` を採用していたが、複数端末同時呼び出し時の二重 increment race を防ぐため最終的に `runTransaction` に変更。tx 内で `state !== "finished"` を再 read することで、片方の端末だけが increment する。テストもこれに合わせて更新（race guard ケース 1 件追加）。
- **self-* 分岐の `affectedKeys` 補強**（emulator validation で発見した security 修復）: 計画では `groups/{gid}` の update に新 branch を 1 件 OR 追加する想定のみだったが、エミュレータ検証で **self-key memberDisplayNames update / self-add / self-leave 分岐がドキュメント全体の `affectedKeys` を制約していない**ことが発覚し、任意 member が `audioSettings` / `finishedTournamentCount` を改竄できる経路を確認した（map diff の `hasOnly([uid])` は空集合に対して true となるため）。Phase 4.16 のスコープ内で修復し、3 分岐すべてに `request.resource.data.diff(resource.data).affectedKeys().hasOnly([...])` を追加。修復後にエミュレータで全 8 ケース green を確認。詳細は [.claude/rules/group-membership.md](../../rules/group-membership.md) の「Phase 4.16 で修復: self-* update 分岐の `affectedKeys` 抜けによる任意フィールド改竄」節。

## Issues Encountered

- **schema 拡張の cascade**: `groupBodySchema.finishedTournamentCount` を `default(0)` で追加したことで、`GroupBody` / `GroupDoc` の出力型では非 optional になり、(a) `createGroup` の addDoc payload、(b) 4 つの test fixture に同フィールド未設定で TypeScript エラーが出た。すべて `finishedTournamentCount: 0` を補完して解消。
- **`updateDoc` の引数型キャスト**: vitest mock からの payload 取り出し時、`mock.calls[0][1]` を直接 `Record<string, unknown>` にキャストすると Firebase の overload 型 (`string | FieldPath | UpdateData<T>`) で TS2352 が出る。既存の `updateAudioSettings` テストの destructure パターン `const [, patch] = vi.mocked(updateDoc).mock.calls[0]` を踏襲して解決。
- **firebase web SDK の楽観 update**: rules emulator 検証の最初の試みで `firebase` web SDK + `connectFirestoreEmulator` の `updateDoc` を使ったところ、サーバが PERMISSION_DENIED を返しても Promise が resolve されてしまうケースが発生した（denied は firestore-debug.log にのみ出力）。確実に HTTP ステータスで判定するため、検証スクリプトを Auth emulator REST + Firestore emulator REST API（`fetch` ベース）で書き直して解決。
- **rules emulator 検証で発覚した self-* 分岐の漏洩**: 検証ケース (4) member set / (5) organizer 負値 set が両方 200 で通過した。原因は self-key memberDisplayNames update 分岐が `memberDisplayNames` map の差分しか限定していなかったため、map 自体を no-op で送る限り他フィールドは自由に書けるという pre-existing 設計欠陥（Phase 4.7 由来。Phase 4.9 で `audioSettings` が、Phase 4.16 で `finishedTournamentCount` が追加されたが、self-* 分岐の不変フィールド列挙には追記されていなかった）。3 分岐に `affectedKeys.hasOnly([...])` を加えて修復。修復後に 8/8 全ケース green。

## Tests Written

| Test File                                              | Tests                                                                                          | Coverage                                                          |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `src/lib/firebase/schemas/index.test.ts`               | 3                                                                                              | legacy default / explicit value / 負値拒否                        |
| `src/lib/firebase/repositories/tournaments.test.ts`    | 3（既存 3 ケースを batch 化に書き直し）                                                          | 二重 finish 早期 return / batch.update 2 回 + increment / wrap    |
| `src/lib/firebase/repositories/groups.test.ts`         | 4                                                                                              | happy / 負値 / 小数 / write エラー wrap                           |
| `src/lib/services/group.test.ts`                       | 5                                                                                              | owner allow / organizer allow / member deny / 負値 / 小数         |

## Next Steps

- [x] **Firestore Rules のエミュレータ検証** — `scripts/test-rules-finished-count.mjs` 経由 8/8 ケース green（self-* 分岐の漏洩を修復後）
- [ ] Code review via `/code-review`
- [ ] 手動ブラウザ検証（新規作成画面のプリセット連番、開催数カードの inline edit、ロール別表示差）
- [ ] `firebase deploy --only firestore:rules` でルールをデプロイ（self-* 分岐の affectedKeys 修復もデプロイ対象）
- [ ] Create PR via `/prp-pr`
