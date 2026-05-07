# Local Code Review: Phase 2.5 Group Management

**Reviewed**: 2026-04-19
**Branch**: `feat/phase-2.5-group-management`
**Decision**: APPROVE with comments (no CRITICAL/HIGH; 2 MEDIUM, 4 LOW)

## Summary

Phase 2.5 実装は plan に忠実、規約（AppError / logger / repositories 層 / zodConverter / deny-by-default rules）を満たしている。typecheck / lint / test (59) / build いずれも green。Security Rules と transaction 設計に致命的欠陥なし。CRITICAL/HIGH なし、MEDIUM 2 件・LOW 4 件は merge 後対応で許容範囲。ただし**未関連の tooling 変更（prettier plugin / hooks）が同じ working tree に混在**しており、コミット粒度の整理を推奨。

---

## Findings

### CRITICAL
None.

### HIGH
None.

### MEDIUM

**M1: コミット粒度に Phase 2.5 と無関係な tooling 変更が混入**
- `package.json` / `package-lock.json` / `.prettierrc` / `.prettierignore` / `.eslintrc.json` / `.claude/settings.local.json` / `.claude/hooks/*.py` (3 ファイル)
- これらは prettier-plugin-tailwindcss / hooks の追加であり Phase 2.5 のスコープ外
- **対応**: `git add` で Phase 2.5 関連のみ stage して別コミットに分離するか、明示的に「tooling + Phase 2.5」を 1 コミットにするかを意識して commit する。混在のままだと将来の git revert 範囲が曖昧になる
- **影響**: revert 操作の精度低下、レビュー負荷増。動作には影響なし

**M2: `groupJoinCodes` の `usesCount` を悪意ある第三者が消費可能（[firestore.rules:74-83](firestore.rules#L74-L83)）**
- `allow update` ルールは「`usesCount` を +1 する」更新を、認証済みユーザー全員に許可している。group 加入と紐づいていない
- 攻撃シナリオ: 招待コードがチャット等で漏洩した場合、加入意図のない第三者が `usesCount` だけ繰り返しインクリメント → `maxUses` に到達してコード無効化（DoS）
- **緩和済み事項**: `generateJoinCode` の default は `maxUses: null`（無制限）なので、UI 経由で発行する限り影響なし。`maxUses` を運用側が手動設定したケースのみ顕在化
- **対応案**: rule で `request.resource.data.usesCount == resource.data.usesCount + 1` と同時に「自分が対象 group の memberUids に追加された」ことを transaction 内で検証する形に強化。ただし複数 doc の同期検証は rule では困難で、Cloud Functions 化が現実的
- **判断**: Phase 2.5 のスコープでは `maxUses: null` 既定で許容。Phase 3+ で `maxUses` UI を入れる場合は対策必須。Risks 表に未記載のため追記推奨

### LOW

**L1: `generateCodeString` に modulo bias（[src/lib/firebase/repositories/groupJoinCodes.ts:36-50](src/lib/firebase/repositories/groupJoinCodes.ts#L36-L50)）**
- `bytes[i] % 36` は 256 が 36 で割り切れないため 0-3 の文字（a, b, c, d）が他より約 1.6% 多く出る
- 16 文字 ×～82bit のエントロピーから見て実害はゼロに近い（衝突確率は依然として無視可能）
- **対応案**: rejection sampling（256 を超えるバイトは捨てる）に置換すれば完全均一。ただし規模的に不要

**L2: `loadFor` 内で失敗 gid を逐次 `removeGroupIdFromUser` するため待ち時間長期化リスク（[src/lib/services/current-group.tsx:97-100](src/lib/services/current-group.tsx#L97-L100)）**
- `for...of await` で逐次実行。drift gid が多い場合（典型的には 0〜1 件）は問題ないが、理論的には N×往復遅延
- **対応案**: `Promise.allSettled(failedGids.map(removeGroupIdFromUser))` に並列化。20 人サークル想定では不要

**L3: `JoinGroupClient` の useEffect 依存配列に `setCurrentGroupId` / `refreshGroups` が含まれる（[src/app/groups/join/[code]/join-group-client.tsx:51](src/app/groups/join/[code]/join-group-client.tsx#L51)）**
- どちらも provider 内で `useCallback` で stabilize 済みなので再実行はされない
- ただし将来 provider 実装を変えた際に意図せず loop する罠
- **対応**: `ranRef.current` ガードがあるので冪等性は保たれる。コメントで意図を明示するか、`eslint-disable-next-line react-hooks/exhaustive-deps` を入れて意図を残すのも手

**L4: `services/group.ts` の `consumeJoinCode` が「drift（profile.groupIds に gid 無いが memberUids には居る）」ケースで transaction を失敗させる（[src/lib/services/group.ts:91-116](src/lib/services/group.ts#L91-L116)）**
- 対象 gid が groupIds に未登録のケースで transaction を実行 → 内部で `arrayUnion(uid)` が no-op → `memberUids.size()` 不変 → rule の self-add 分岐が deny → `group/join-failed`
- 同期不整合（drift）に対する自動修復が無い。ユーザーは画面エラーを見て再操作が必要
- **対応案**: 失敗時に「rule denied かつ、再度 `getGroup` で memberUids.includes(uid) を確認できれば既メンバーとして処理」という catch ブランチを足す。スコープが広がるため後続対応で十分

---

## Validation Results

| Check | Result |
|---|---|
| Type check (`npm run typecheck`) | Pass — 0 errors |
| Lint (`npm run lint`) | Pass — 0 warnings/errors |
| Tests (`npm test`) | Pass — 59/59 (24 new for Phase 2.5) |
| Build (`npm run build`) | Pass — 14 routes |

---

## Security Rule 詳細チェック

| 項目 | 結果 | 備考 |
|---|---|---|
| `get()` 呼び出し回数 | 4 箇所、各経路で最大 2 段（10 上限の 20%） | Plan 通り |
| `groups` create rule | 自身の uid のみ memberUids に入る制約 (`size==1` & `hasOnly`) で安全 | OK |
| `groups` self-add 分岐 | `!(uid in resource.data.memberUids)` 前提で size+1 / hasAll / 他フィールド不変を要求 | OK（既メンバーが偽装 update で fields を改ざんできない） |
| `groups` self-leave 分岐 | owner 除外、size-1、自分が新配列に居ないこと、他フィールド不変 | OK |
| `groupJoinCodes` create | `createdByUid==auth.uid` & `usesCount==0` & `isGroupMember(gid)` | OK |
| `groupJoinCodes` update | M2 参照（usesCount+1 のみ／第三者消費可） | MEDIUM |
| `groupJoinCodes` delete | `isGroupOwner(gid)` のみ | OK |
| `structures` 全操作 | `isGroupMember(groupId)` で統一 | OK |
| `tournaments` read | `isSignedIn()` で広く許可（参加者向け） | Phase 2 踏襲。意図通り |
| `tournaments/{tid}/players` rules | self-create / self-update（フィールド固定）/ self-or-group-delete | Phase 2 と整合 |
| `{sub=**}` write | `isGroupMember(get(tournaments/{tid}).groupId)` + `exists()` ガード | OK（Phase 2 から追加された exists ガードあり） |

## コード品質 サマリ

- **AppError 規約**: 全 repository / service で `AppError.from("firestore/...")` 経由 → ✓
- **logger 規約**: `console.*` 直呼び 0 件（lint 確認済み） → ✓
- **zodConverter**: 新 collection 2 つとも適用 → ✓
- **`throw new Error(...)` 直使用**: 0 件 → ✓
- **try/catch swallow**: なし。`catch` の中で必ず logger.warn or rethrow → ✓
- **client-side sort 規約**: `listStructuresByGroup` / `listTournamentsByGroup` で適用 → ✓
- **テストカバレッジ**: 24 新規 / 修正合計 59、Schema・Service・Receipt の整合性を担保 → ✓
- **dead code**: `defaultExpiresAt` import が `services/group.ts` で `void defaultExpiresAt` の形で残置（[src/lib/services/group.ts:154](src/lib/services/group.ts#L154)）。意図不明の no-op、削除推奨 → LOW（次回掃除）

---

## Files Reviewed (Phase 2.5 scope)

### CREATED
- `src/lib/firebase/schemas/group.ts` (24)
- `src/lib/firebase/schemas/groupJoinCode.ts` (28)
- `src/lib/firebase/repositories/groups.ts` (137)
- `src/lib/firebase/repositories/groupJoinCodes.ts` (159)
- `src/lib/services/group.ts` (216)
- `src/lib/services/group.test.ts` (290)
- `src/lib/services/current-group.tsx` (164)
- `src/components/auth/RequireGroup.tsx` (32)
- `src/app/groups/page.tsx` + `groups-client.tsx` (~115)
- `src/app/groups/new/page.tsx` + `group-new-client.tsx` (~95)
- `src/app/groups/[gid]/page.tsx` + `group-detail-client.tsx` (~330)
- `src/app/groups/join/[code]/page.tsx` + `join-group-client.tsx` (~95)
- `firestore.rules` 変更（148）

### MODIFIED
- `src/lib/firebase/schemas/{user,structure,tournament}.ts`
- `src/lib/firebase/repositories/{users,structures,tournaments}.ts`
- `src/lib/firebase/schemas/index.test.ts`
- `src/lib/services/receipt.{ts,test.ts}`
- `src/components/auth/AuthBadge.tsx`
- `src/components/{structure/StructureForm,tournament/TournamentForm}.tsx`
- `src/app/layout.tsx`
- `src/app/page.tsx`
- `src/app/structures/{page,structures-client,new/*,[sid]/edit/*}.tsx`
- `src/app/tournaments/{page,tournaments-client,new/*,[tid]/dashboard-client,[tid]/edit/*}.tsx`
- `README.md` / `CLAUDE.md` / `.claude/PRPs/prds/allin-timer.prd.md`

### OUT OF SCOPE (M1)
- `package.json` / `package-lock.json`
- `.prettierrc` / `.prettierignore` / `.eslintrc.json`
- `.claude/settings.local.json`
- `.claude/hooks/post-edit-track.py` / `pre-write-secret-scan.py` / `stop-format.py`

---

## 推奨アクション

1. **commit 前**: M1 — Phase 2.5 とそれ以外の tooling 変更を分離（`git add` 単位を分ける）
2. **next phase**: M2 — `maxUses` UI を入れる際は rule 強化または Cloud Functions 化を検討。Risks 表に追記
3. **次の cleanup PR**: L4 / dead code の `void defaultExpiresAt` 削除、L2 の並列化、L1 の rejection sampling は時間が空いたら
4. **L3**: `JoinGroupClient` の意図コメント追加で十分

## 結論

Phase 2.5 のコア実装は **production ready**。M2 はスコープ判断で許容。M1 はコミット運用の問題で動作影響なし。`/prp-pr` または `/prp-commit` に進んで良い状態。
