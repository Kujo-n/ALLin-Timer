# Local Code Review: Phase 4.6 — Member Role Split

**Reviewed**: 2026-04-22
**Branch**: `feat/phase-4.6-member-role-split`
**Scope**: 23 modified + 4 new files（schema / repository / service / rules / UI / docs / scripts / tests）
**Decision**: APPROVE — after in-review fix

## Summary

Phase 4.6 はスキーマ・rules・service・UI の 5 層を 3 階層ロールに整合させる大規模変更。レビューで **HIGH 1 件（rule のロジック穴）** を発見し、その場で修正。残課題は **MEDIUM 1 件・LOW 2 件** で、いずれもマージブロッカーではない。typecheck / lint / test / build すべて green。

## Findings

### CRITICAL

None.

### HIGH

#### H1. `firestore.rules` self-leave path allowed organizers to silently demote other organizers — **fixed in this review**

**Location**: [firestore.rules:70-83](firestore.rules#L70-L83) (修正前のコード)

**Issue**: self-leave 条件は `resource.data.organizerUids.hasAll(request.resource.data.organizerUids)`（新 ⊆ 旧）と `!(auth.uid in request.resource.data.organizerUids)`（自分が新に含まれない）のみを課していたため、organizer が自己脱退を装って他の organizer も同時に organizerUids から除外することが可能だった。`organizerUids` の size 変化に制約がなく、任意のサイズの新配列が通ってしまう。

**攻撃シナリオ**:
- A, B が共に organizer（`organizerUids = [A, B]`）。
- A が self-leave 時に `memberUids: arrayRemove(A)`（正規）+ `organizerUids: []`（A と B を除外）を書込。
- 旧ルールでは `[A, B].hasAll([])` = true、`!(A in [])` = true、`ownerUids` 不変 → 許可されてしまう。
- 結果: A は脱退、B は黙って一般メンバーに降格（Owner による昇降格 UI を経由せずに権限剥奪）。

**Fix**: organizerUids に対して「自分が含まれていたちょうど 1 要素減少 + new ⊆ old」もしくは「自分が含まれていなかった → 厳密に不変」を enforce する分岐を追加。

```rules
&& (
  (request.auth.uid in resource.data.organizerUids
   && request.resource.data.organizerUids.size() == resource.data.organizerUids.size() - 1
   && resource.data.organizerUids.hasAll(request.resource.data.organizerUids))
  ||
  (!(request.auth.uid in resource.data.organizerUids)
   && request.resource.data.organizerUids == resource.data.organizerUids)
)
```

**Status**: ✅ 本 review 内で修正済み。typecheck / tests 再確認 green。

### MEDIUM

#### M1. owner update path が invariant を enforce しない（自己サボタージュのみ）

**Location**: [firestore.rules:51-56](firestore.rules#L51-L56)

**Issue**: owner が自由に name / ロール配列を書き換えられる設計だが、`ownerUids ⊆ organizerUids ⊆ memberUids` や `organizerUids.size() >= 1` / `memberUids.size() >= 1` の invariant は rule 側では enforce されない。owner が不整合な状態を書き込むと、zod schema refine（`fromFirestore` 側）で `firestore/invalid-data` が出てドキュメントが事実上読めなくなる（group がブリックされる）。

**Severity 理由**: owner のみが到達できる破壊経路なので「自己サボタージュ」に留まる。他メンバーへの権限侵害には繋がらない。

**Mitigation（将来対応）**: Phase 5 でルール側に以下を追加する余地あり:
```rules
&& request.resource.data.organizerUids.hasAll(request.resource.data.ownerUids)
&& request.resource.data.memberUids.hasAll(request.resource.data.organizerUids)
&& request.resource.data.memberUids.size() >= 1
&& request.resource.data.organizerUids.size() >= 1
```

ただし rule の評価コスト（list 操作）が嵩むので、service 層で更新前検証する案と比較検討すべき。

**判断**: Phase 4.6 ではブロックしない。Phase 5 の rule 堅牢化タスクに送る。

#### M2. 昇降格 service 関数群は transaction を使わない（last-writer-wins）

**Location**: [src/lib/services/group.ts:255-328](src/lib/services/group.ts#L255-L328) — `promoteToOrganizer` / `demoteToMember` / `promoteToOwner` / `demoteOwner`

**Issue**: すべて `getGroup` → `updateGroupRoles` の 2 ステップ non-atomic 構造。2 名の owner が同時にロール操作を行うと last-writer-wins になる（例: A が demote T、B が promote T → どちらか 1 つが残る）。

**Severity 理由**: 最後のオーナー保護は rule 側でも `ownerUids.size() >= 1` で enforce されているため、最悪でも「一時的にロールが戻らない」程度。セキュリティ境界は壊れない。

**Mitigation**: Phase 2.5 の `consumeJoinCode` と同様に transaction 化する余地あり。20 人規模の運用では問題化しないため Phase 5+ まで遅延可。

### LOW

#### L1. `debug-fs-client.tsx` に残る独自 `ownerUid` schema

**Location**: [src/app/debug/fs/debug-fs-client.tsx:14-19](src/app/debug/fs/debug-fs-client.tsx#L14-L19)

Phase 5 で削除予定のデバッグページが、独自に `tournaments` collection に `ownerUid` フィールドを書こうとしている。新 rules では失敗するが、`/debug/fs` は `NEXT_PUBLIC_ENABLE_DEBUG` ガード付きで production には届かないので実害なし。Phase 5 の削除時に合わせて除去で OK。

#### L2. Dashboard リダイレクトの flash

**Location**: [src/app/tournaments/[tid]/dashboard-client.tsx:184-189](src/app/tournaments/[tid]/dashboard-client.tsx#L184-L189)

一般メンバーが `/tournaments/[tid]` を直打ちしたとき、data ロード完了 → groups ロード完了の順で useEffect が動くため、一瞬「読込中…」表示を挟む。rule 側の二重防御があるので機能的には問題なし。Plan の Notes section で「flash が見える可能性あり」と明記済み。

## Validation Results

| Check      | Result  | Notes                                         |
| ---------- | ------- | --------------------------------------------- |
| Type check | ✅ Pass | `npm run typecheck` — zero errors             |
| Lint       | ✅ Pass | `npm run lint` — no warnings                  |
| Tests      | ✅ Pass | 315 tests pass（修正後も再確認 green）        |
| Build      | ✅ Pass | `npm run build` — 13 pages generated          |

## Files Reviewed (重点確認)

| File                                                    | 重点 |
| ------------------------------------------------------- | ---- |
| `firestore.rules`                                        | **HIGH finding** — self-leave 穴を修正 |
| `src/lib/firebase/schemas/group.ts`                      | invariant refine の順序 / deriveRole 返り値 |
| `src/lib/firebase/repositories/groups.ts`                | 新 `updateGroupRoles` + `removeMemberSelf` の 3 配列同時更新 |
| `src/lib/services/group.ts`                              | 昇降格 4 関数 / leaveGroup の 2 step / assertOwner |
| `src/lib/services/current-group.tsx`                     | `deriveRole` による role 派生 |
| `src/app/tournaments/[tid]/dashboard-client.tsx`         | role redirect の flash 防止 |
| `src/app/tournaments/[tid]/live/live-client.tsx`         | JoinSelfPanel の canJoin 条件 |
| `src/app/groups/[gid]/group-detail-client.tsx`           | owner 専用ロール変更ボタン / 最後のオーナー保護 UI |
| `firestore.rules` catch-all `{sub=**}`                   | organizer のみ write（tables 等） |
| `scripts/migrate-phase-4.6-roles.ts`                     | 冪等性 / dry-run / deleteField |
| `src/lib/services/group.test.ts`                         | 12 新規 test の edge case |

## Recommendation

- **APPROVE** — HIGH 1 件は本 review 内で修正済み。残 MEDIUM / LOW は Phase 5 以降の堅牢化に繰越可。
- PR マージ前に **本番 Firestore に対して migration script を dry-run → 本実行** することを強く推奨（README 記載手順）。
- Phase 5 ドライラン時に以下を重点確認:
  1. Owner / Organizer / Member の 3 視点でブラウザ経由の権限境界
  2. Migration の冪等性（dry-run を複数回打って skip されること）
  3. 最後のオーナー保護（service のエラー文言 + rule の `ownerUids.size() >= 1`）

## Notes

- lint で prettier / eslint は既存ルールに準拠
- `AppError` ラップ・`logger` 経由のログ出力・repository 層経由の CRUD は全ファイル遵守
- i18n（日本語エラーメッセージ）はユーザー向け、logger の metadata は英語（既存パターン踏襲）
