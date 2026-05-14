# Architect Refactor Plan — 20260514-2

## 所属

- PRD: `05-post-launch-polish`（前サイクル 20260514 の follow-up）
- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260514-2.md](../reviews/architect-refactor-20260514-2.md)
- 前サイクル: [completed/architect-refactor-20260514.plan.md](completed/architect-refactor-20260514.plan.md) / [report](../reports/architect-refactor-20260514.md)
- 作業ブランチ: `refactor/architect-refactor-20260514-2`

## 不変条件

1. 全テスト（typecheck / lint / unit / build / **E2E**）を **本サイクル完了時点で green** に
2. 観測可能な動作変更は 0
3. プロジェクト規約優先
4. 1 commit = 1 atomic

特に本サイクルは **E2E baseline 不整合の修復が目的の一つ** であるため、最終 Phase 5 で E2E
green を確認することは前サイクルより重要。

## タスク

### Phase 0: E2E test drift 修復（safety net 回復）

| ID | finding | 対象 | 変更内容 |
| --- | --- | --- | --- |
| T0-1 | drift-1 | `tests/e2e/phase-d-install-promotion.spec.ts:174` | assertion 期待値 `"v3"` → `"v4"` 更新 + test 名 / コメント同期 |
| T0-2 | drift-2 | `tests/e2e/theme-toggle.spec.ts:32` | `getByRole("heading")` → `getByText("テーマ", { exact: true })` 置換 + コメント追加 |

両者とも 1〜2 行変更。各 1 commit で atomic。`public/sw.js` / `<CardTitle>` 本体は無変更。

### Phase 2-3-4: finding-4 集約

| ID | finding | 対象 | 変更内容 |
| --- | --- | --- | --- |
| T4 | finding-4 | `src/app/groups/[gid]/group-detail-client.tsx` | `runReloadRefreshAction(fn, options)` helper を新設し、7 callsite を経由化 |

#### T4 詳細

**helper の API**:

```ts
async function runReloadRefreshAction(
  fn: () => Promise<unknown>,
  options: {
    errorCode: string;
    errorMessage: string;
    closeDialog?: () => void;
  },
): Promise<void>
```

**経由化する 7 callsite**:

1. `runRoleAction`（既存 helper、4 callsite を内部で持つ） → 薄い wrapper 化（`errorCode: "group/role-change-failed"` 固定）
2. `onStartSeason` — `closeDialog: () => setConfirmStartSeasonOpen(false)`
3. `onSaveSeasonPointsRule`
4. `onResetSeasonPointsRule`

**inline 維持する 4 callsite**:

| Handler | 維持理由 |
| --- | --- |
| `onIssueCode` | reload せず `setIssuedCode(code)` を try 内で実行 |
| `onRename` | rethrow + `setError(null)` 呼ばない（HeaderCard が error 表示） |
| `onLeave` | `router.push` + `setCurrentGroupId(null)` + reload 不要 |
| `onDelete` | 同上（delete 後の navigation） |

**観測可能変更なしの根拠**:

1. helper 内の処理順序は既存 4 handler と完全同一（`setWorking(true) → setError(null) →
   await fn → await reload → await refreshGroups → catch → setError → finally → closeDialog?
   + setWorking(false)`）
2. `errorCode` / `errorMessage` は callsite から渡すため既存と同じ値
3. `closeDialog` は省略可で、未指定なら呼ばない（既存 onSaveSeasonPointsRule /
   onResetSeasonPointsRule の挙動と同値）
4. `fn` の戻り値型を `Promise<void>` から `Promise<unknown>` に拡げる必要があるのは
   `startNewSeason` の戻り値（`Promise<{ seasonId }>`）対応のためで、戻り値を捨てる動作は
   既存と同値（既存も await の戻り値を使っていない）

## 検証順序

1. Phase 0 完了直後に T0-1 / T0-2 の修復対象 spec を **個別に** 再走行（`npm run test:e2e -- <spec>`）して drift fix の効果を確認
2. T4 完了後に `npm run typecheck` / `npm run lint` / `npm test`
3. **Phase 5b 最終**: dev server / emulator 停止確認 → `npm run build` → `npm run test:e2e`（full）

## 期待される成果

- Phase 0: E2E baseline が完全 green に復帰（100 pass / 0 fail / 3 skip 見込み）
- T4: `group-detail-client.tsx` の 7 callsite 集約、helper 新設で +33 / -49 行程度
- 観測可能変更: 0
- 次回 architect-refactor の前提条件（baseline E2E green）が整う

## ユーザー承認方針

前サイクルと同じく「stop without clarifying questions」要求のため、本計画は **承認待ちなしで
Phase 0 → Phase 4 → Phase 5 まで実装**。途中で計画違いが判明したら停止して redirect を求める。
