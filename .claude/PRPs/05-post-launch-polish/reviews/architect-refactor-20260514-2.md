# Architect Refactor Audit — 20260514-2

## Scope

前サイクル `20260514` の直後に user-invoked で再起動された 2 nd サイクル。
前サイクル Phase 5 で flagged された **baseline 由来の E2E test drift 2 件** を最優先で
修復し、次に前サイクルで「次回サイクル送り」とした **finding-4（`group-detail-client.tsx`
の 7 handler 集約）** を再評価して着手する。

- ベースブランチ: `refactor/architect-refactor-20260514`（前サイクル末 `8a1276d`）
- 作業ブランチ: `refactor/architect-refactor-20260514-2`
- 所属 PRD: `05-post-launch-polish`
- 前サイクル report: [architect-refactor-20260514.md](../reports/architect-refactor-20260514.md)
- 前サイクル plan（完了済み）: [completed/architect-refactor-20260514.plan.md](../plans/completed/architect-refactor-20260514.plan.md)

## ベースライン（前サイクル末を継承）

| 項目 | 状態 |
| --- | --- |
| typecheck | ✅ pass |
| lint | ✅ pass |
| unit test | ✅ 88 files / 1420 pass |
| build | ✅ pass |
| e2e | ⚠ 98 pass / 2 fail / 3 skip — **本サイクル Phase 0 で修復対象** |

## Phase 0: E2E test drift 修復

前サイクル Phase 5 で baseline 由来と特定済みの 2 件:

### drift-1: `phase-d-install-promotion.spec.ts:174` の CACHE_VERSION 期待値ズレ

- 場所: `tests/e2e/phase-d-install-promotion.spec.ts:174`
- 観察事実: `expect(body).toMatch(/const\s+CACHE_VERSION\s*=\s*"v3"/)` が fail
- 根本原因: `public/sw.js` は baseline 時点で commit `582cb76`（"fix: SW の cache.put が
  206 応答で失敗し音声 fetch が 504 化する問題を修正"）により `CACHE_VERSION = "v4"` に
  bump 済み。test 側が v3 のまま取り残されていた
- 修復方針: test 名・assertion・コメントを v4 に同期（test 本体は無変更で済む）

### drift-2: `theme-toggle.spec.ts:32` の `getByRole("heading")` 期待

- 場所: `tests/e2e/theme-toggle.spec.ts:32`
- 観察事実: `getByRole("heading", { name: "テーマ" })` が timeout
- 根本原因: shadcn `<CardTitle>`（[src/components/ui/card.tsx:23-32](../../../../src/components/ui/card.tsx#L23-L32)）は
  素の `<div>` で `role` 設定が無い。test は `<CardTitle>テーマ</CardTitle>` が heading role
  を持つと誤って想定。page snapshot で `generic [ref=e86]: テーマ` として描画されることを
  確認済み
- 修復方針: `getByText("テーマ", { exact: true })` に変更（CardTitle 側に `role="heading"`
  を追加する案は他 Card 全箇所への波及があり見送り）

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 0 件
- low: 1 件（finding-4: `group-detail-client.tsx` の 7 callsite handler 集約）
- info: 1 件（finding-5: 20260512 deferred 群の継続据え置き）

### finding-4: `runRoleAction` を一般化して 7 callsite を集約（LOW・本サイクルで対応）

- Lens: architect (DRY / KISS)
- Severity: low（前サイクル INFO → 本サイクルで設計確定したため LOW に格上げ）
- 場所: [src/app/groups/[gid]/group-detail-client.tsx:219-349](../../../../src/app/groups/[gid]/group-detail-client.tsx#L219-L349)
- 観察事実: 7 handler が以下のパターンを共有:
  1. `setWorking(true) + setError(null)`
  2. `try { await fn(); await reload(); await refreshGroups(); }`
  3. `catch { unwrapOrFrom + setError(formatErrorForDisplay) }`
  4. `finally { closeDialog?(); setWorking(false); }`

  対象 7 callsite:
  - 既存 4 role actions（`runRoleAction` 経由）
  - `onStartSeason`（closeDialog 付き）
  - `onSaveSeasonPointsRule`
  - `onResetSeasonPointsRule`

- 見送り（inline 維持）4 callsite — semantic 差分が大きいため:
  - `onIssueCode`: `reload` せず `setIssuedCode(code)` を try 内で実行
  - `onRename`: rethrow + `setError(null)` 呼ばない（HeaderCard inline edit が error 表示を担当）
  - `onLeave` / `onDelete`: `router.push` + `setCurrentGroupId(null)` の navigation side effect + `reload` 不要

  これらを helper 経由化すると `setError(null)` の有無で observable 差分が発生する（前サイクル
  report で flagged 済み）ため inline 維持。

- 影響: working / error の state 管理 contract を変更すると 7 箇所同期。pre-existing
  inconsistency（4 handler が `setError(null)` あり vs 4 handler が無し）の半分を統一できる

- 案: `runReloadRefreshAction(fn: () => Promise<unknown>, options: { errorCode; errorMessage;
  closeDialog?: () => void }): Promise<void>` を helper として導入。既存 `runRoleAction` は
  薄い wrapper として保持（既存 callsite が 4 つあり、`errorCode` が常に `"group/role-change-failed"`
  なので呼出側を簡潔に保つため）

- テスト保護: 既存 group / season / role 系の **unit test**（runRoleAction 経路は
  `group-detail-client.test.tsx` が存在しないが `repositories/groups.test.ts` /
  `services/group.test.ts` で末端 SDK 呼出形を検証済み）+ **E2E**（season UI / role 操作 /
  reload 経路）。動作同値性は build / typecheck で構造的に担保

- リスク: `fn` の戻り値型を `Promise<void>` から `Promise<unknown>` に拡げる必要あり
  （`startNewSeason` が `Promise<{ seasonId: string }>` を返すため）。これにより内部で
  戻り値を捨てる動作になるが、既存呼出も await の戻り値を受け取っていなかったため等価

### finding-5: 前サイクルおよび 20260512 の Deferred 継承（INFO・据え置き）

| Source | 据え置き理由 |
| --- | --- |
| 20260512 finding-5（`CardBackgroundCard.tsx` 447 行 hook 抽出） | 既存 test の mock 境界書換が必要 |
| 20260512 finding-6（Storage rule 2 read） | owner 操作のみ・低頻度 |
| 20260512 finding-7（`retry.ts` signal sleep） | `deleteWithRetry` 単独 callsite |
| 20260514 finding-4 の据え置き 4 callsite | semantic 差分が観測可能変更になり得る（本 review で詳述） |

## 採用 findings の優先順位

1. **Phase 0: drift-1 + drift-2** — E2E baseline safety net 回復（最優先）
2. **finding-4** — `runReloadRefreshAction` で 7 callsite 集約

## 関連リンク

- 計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260514-2.plan.md](../plans/architect-refactor-20260514-2.plan.md)
- 前サイクル review: [architect-refactor-20260514.md](architect-refactor-20260514.md)
- 前サイクル report: [../reports/architect-refactor-20260514.md](../reports/architect-refactor-20260514.md)
