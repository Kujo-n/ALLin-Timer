# Local Review: dryrun-feedback-batch-1（Phase C.1）

**Reviewed**: 2026-05-13
**Author**: Kujo-n
**Branch**: `feat/dryrun-feedback-batch-1` (uncommitted local changes)
**Decision**: APPROVE with comments — HIGH-1 は事実誤認（cleanup-orphan-firestore.ts step 5 が expired joinCodes を処理する）と判明したため downgrade。MEDIUM 2 件は本レビュー中に修正済み

## Summary

ドライランフィードバック 4 件（トーナメント名簡潔化 / 参加済み表示 / 招待コード自動整理 / 観戦自動 OFF）の polish bundle。独立レビュー（code-reviewer agent）の指摘を再評価し、actionable な 2 件（rule の empty string 拒否 / useEffect deps の uid 抽出）を本レビュー中に修正。HIGH-1 は前提が誤りで comment 補強のみで対応。1383 unit test / 9 emulator validator green。

## Findings

### CRITICAL

None.

### HIGH

**HIGH-1（DOWNGRADED）: `generateJoinCode` step 3 失敗時の orphan code 残留**
- **指摘**: `createJoinCode` が成功して "new" を返した後 `updateLatestJoinCodeId` が失敗すると、pointer は古い値のまま orphan code "new" が Firestore に残る。次回再発行時の delete 対象に含まれないため orphan が `expiresAt` まで有効
- **再評価**: `scripts/cleanup-orphan-firestore.ts:217-234, 425-429` は **step 5 で `expiresAt < now` の groupJoinCodes を delete** する。orphan は意図通り `expiresAt`（default 7 日）経由で最終整理される。reviewer の「cleanup-orphan-firestore はこのケースをカバーしない」という前提は誤り
- **影響**: orphan の使用可能期間は最大 7 日（default expiry）。再発行操作のユーザー期待（即時無効化）とは異なる挙動だが、step 3 失敗自体が稀（単一フィールド update のみ）かつ orphan は bounded
- **Action**: severity を MEDIUM 相当に downgrade。コメントを補強して挙動を明示（[src/lib/services/group.ts:283-297](../../../src/lib/services/group.ts#L283-L297)）

### MEDIUM

**MEDIUM-1 ✅ FIXED: rule が空文字列 `latestJoinCodeId` を許可していた**
- **問題**: `firestore.rules` の `latestJoinCodeId` ブランチが `is string` のみで、`schemas/group.ts` の `z.string().min(1)` と不整合。直接 SDK 呼出で `""` 書込可能
- **Fix**: `&& request.resource.data.latestJoinCodeId.size() >= 1` を追加（[firestore.rules:348-352](../../../firestore.rules#L348-L352)）。emulator validator にケース (4b) を追加（9/9 green）

**MEDIUM-2 ✅ FIXED: useEffect deps に `user` object 全体を含めていた**
- **問題**: `AuthProvider` の `refreshUser()` で user 参照が変わるたび、`/tournaments` の参加済み判定が全 row 分再 read していた（最大 6 tournament × 1 read）
- **Fix**: `const userId = user?.uid ?? null;` で uid を抽出し deps を `[currentGroupId, isOrganizer, userId]` に変更（[src/app/tournaments/tournaments-client.tsx:69-76, 122](../../../src/app/tournaments/tournaments-client.tsx#L69-L76)）

**MEDIUM-3（DEFERRED）: cleanup script の対象プロジェクト確認 ガードがない**
- **問題**: `--execute` 指定時に誤った service-account.json を読んでも abort しない
- **Action**: `cleanup-orphan-firestore.ts` / `cleanup-test-auth-users.ts` と同パターンで保留。README に「実行前に `project=` 出力を確認」の運用注意を別途追加（本 PR 範囲外）

### LOW

**LOW-1（DEFERRED）: emulator validator に self-add ペイロード混入の deny ケースなし**
- 既存 self-add `affectedKeys.hasOnly([...])` で deny されることは Phase 4.16 で検証済み。冗長性が高いためスキップ

**LOW-2（不対応）: コメントの「衝突 retry edge」表現**
- 129bit ランダムで偶然衝突は事実上発生しないという指摘は正しいが、防御コードとしての意図はコメントに残しておく価値あり

**LOW-3（不対応）: 招待コード文字列の info ログ平文出力**
- `createJoinCode` の既存パターンと同方針。プロジェクトのコード機密性ポリシー変更時に併せて再評価

## Validation Results

| Check | Result |
| ----- | ------ |
| Type check (`npm run typecheck`) | Pass |
| Lint (`npm run lint`) | Pass (0 warnings) |
| Tests (`npm run test`) | Pass (1383 / 1383 across 83 files) |
| Build (`npm run build`) | Pass |
| Rules drift (`npm run test:rules-limits`) | Pass (14/14) |
| Rules emulator (`npm run test:rules-latest-join-code`) | Pass (9/9 — 新規 4b case 追加後も全 green) |
| Cleanup script smoke | Pass (env-missing で正しく早期 exit) |

## Files Reviewed

### 実装本体（高重要度）

| File | Change |
| ---- | ------ |
| `src/lib/services/group.ts` | Modified — generateJoinCode 4 ステップ化 + comment 補強 |
| `src/lib/firebase/repositories/tournaments.ts` | Modified — finishTournament tx で spectateEnabled: false |
| `src/lib/firebase/repositories/groups.ts` | Modified — updateLatestJoinCodeId 追加 |
| `src/lib/firebase/repositories/groupJoinCodes.ts` | Modified — deleteJoinCode 追加 |
| `src/lib/firebase/schemas/group.ts` | Modified — latestJoinCodeId schema additive 追加 |
| `firestore.rules` | Modified — latestJoinCodeId 単独書換 branch + delete widening + size() >= 1 制約 |
| `scripts/cleanup-old-anonymous-users.ts` | Added — 匿名 Auth + users/{uid} の 7 日 cutoff cleanup |
| `src/app/tournaments/tournaments-client.tsx` | Modified — 参加済み判定 + userId deps fix |
| `src/app/tournaments/new/tournament-new-client.tsx` | Modified — Tournament-No.X デフォルト |
| `src/app/tournaments/[tid]/clone/clone-client.tsx` | Modified — clone のデフォルトも同型 |

### Test / Validator

| File | Change |
| ---- | ------ |
| `scripts/test-rules-latest-join-code.mjs` | Added — 9 case emulator validator |
| `src/lib/firebase/repositories/groupJoinCodes.test.ts` | Added |
| `src/app/tournaments/tournaments-client.test.tsx` | Modified — useAuthUser mock + 参加済み 5 case |
| `src/lib/firebase/repositories/groups.test.ts` | Modified — updateLatestJoinCodeId 3 case |
| `src/lib/firebase/repositories/tournaments.test.ts` | Modified — auto-disable spectateEnabled 1 case |
| `src/lib/services/group.test.ts` | Modified — generateJoinCode 6 case 再構築 |
| `src/lib/firebase/schemas/index.test.ts` ほか 3 件 | Modified — GroupDoc fixture に `latestJoinCodeId: null` 追加 |

### Docs / Config

| File | Change |
| ---- | ------ |
| `package.json` | Modified — cleanup:old-anonymous-users / test:rules-latest-join-code |
| `.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md` | Modified — Decisions Log 追加 / Phase C.1 complete |
| `.claude/rules/firebase-patterns.md` | Modified — allowed-keys 表に latestJoinCodeId |
| `.claude/rules/group-membership.md` | Modified — データモデル節 + 招待コード設計原則 |
| `docs/specification/02-circles-and-membership.spec.md` / `04-tournaments.spec.md` | Modified — `Tournament-No.X` 表記更新 |

## Good points（独立レビューより）

- **4 ステップ化のロジック順序**は適切（ポインタ整合を最優先、step 3 失敗時は throw）
- **`firestore.rules` の単独書換 branch 設計**は Phase 4.16 / 4.17 / Phase A / E と同パターンで整合
- **`deleteJoinCode` の wrapFirestoreWrite + logger.info 外出し**は firebase-patterns.md 規約に完全準拠
- **delete widening (owner→organizer)** は権限マトリクスの create / delete 対称性を回復
- **cleanup script の匿名判定 (`providerData.length === 0`)** は Firebase Auth 仕様に正確
- **Promise.allSettled の fail-safe + logger.warn** は error-logging.md 規約準拠
- **finishTournament tx の spectateEnabled additive 追加** は冪等で既存 broad organizer rule で許可済み

## Decision

**APPROVE** — 修正後の状態でマージ可能。残課題:

1. ⚠️ `firebase deploy --only firestore:rules` を必ず実行（emulator green でも本番 deploy 忘れで permission-denied する罠 — memory 規則）
2. `cleanup:old-anonymous-users` の運用ガイド（README）を別途追加（MEDIUM-3）
