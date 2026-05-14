# Architect Refactor Report — 20260514-2

## Scope

前サイクル `20260514` の直後に user-invoked で再起動された 2 nd サイクル。**前サイクル
Phase 5 で flagged された baseline 由来の E2E test drift 2 件を最優先で修復**し、続いて
前サイクルで「次回送り」とした **finding-4（`group-detail-client.tsx` の 7 handler 集約）**
を実装した。

- ベースブランチ: `refactor/architect-refactor-20260514` (`8a1276d`)
- 作業ブランチ: `refactor/architect-refactor-20260514-2`
- 所属 PRD: `05-post-launch-polish`
- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260514-2.md](../reviews/architect-refactor-20260514-2.md)
- 実施計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260514-2.plan.md](../plans/architect-refactor-20260514-2.plan.md)
- 前サイクル: [completed/architect-refactor-20260514.plan.md](../plans/completed/architect-refactor-20260514.plan.md) / [report](architect-refactor-20260514.md)
- diff 規模: 4 files / +69 / -67 行（src/ + tests/）

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 0 件
- low: 1 件（finding-4: `group-detail-client.tsx` 7 handler 集約）
- info: 1 件（finding-5: 20260512 + 20260514 の deferred 群継承）
- **Phase 0 修復**: E2E test drift 2 件（baseline 由来の bug fix）

## 実施した変更

| commit | 概要 | 影響範囲 |
| --- | --- | --- |
| `8a1276d` | docs: 完了済み architect-refactor-20260514 plan を completed/ に移動 | `.claude/PRPs/05-post-launch-polish/plans/` |
| `a3073f4` | fix(e2e): sw.js CACHE_VERSION 期待値を v3 → v4 に同期 | `tests/e2e/phase-d-install-promotion.spec.ts` |
| `b8c07f7` | fix(e2e): CardTitle は div のため getByRole(heading) → getByText に修正 | `tests/e2e/theme-toggle.spec.ts` |
| `05fb530` | refactor(group-detail): runReloadRefreshAction helper で 7 callsite を集約 | `src/app/groups/[gid]/group-detail-client.tsx` |

すべて atomic commit で、`git revert` 1 つで安全に戻せる粒度。Phase 0 の 2 commit は test bug
fix（実装には触れず）、T4 commit は内部 helper の集約（外部 API 不変）。

### Finding 対応マッピング

| Finding | Severity | 対応 commit |
| --- | --- | --- |
| drift-1（`sw.js` CACHE_VERSION v3 → v4 取り残し） | baseline bug | `a3073f4` |
| drift-2（`CardTitle` は div で heading role なし） | baseline bug | `b8c07f7` |
| finding-4（7 callsite 集約） | LOW | `05fb530` |

## 見送った提案（理由付き）

- **finding-4 の inline 維持 4 callsite**:
  - `onIssueCode` — reload せず `setIssuedCode(code)` を try 内で実行する独自フロー
  - `onRename` — `rethrow + setError(null) 呼ばない`。HeaderCard inline edit 側で error 表示するため、helper 経由化すると HeaderCard の error UX を破壊
  - `onLeave` / `onDelete` — `router.push` + `setCurrentGroupId(null)` の navigation side effect + reload 不要
  - これら 4 つは helper 経由化すると `setError(null)` の有無で観測可能変更が発生する
- **finding-5（20260512 + 20260514 の Deferred 群継承）**:
  - 20260512 finding-5: `CardBackgroundCard.tsx` 447 行 hook 抽出（既存 test の mock 境界書換必要）
  - 20260512 finding-6: Storage rule 2 read（owner 操作のみ・低頻度）
  - 20260512 finding-7: `retry.ts` signal sleep（`deleteWithRetry` 単独 callsite）
  - 20260514 finding-4 の据え置き 4 callsite（本 report 上の 1 つ目）

## 追加したテスト

なし。本サイクルは:

1. Phase 0: 既存テストの drift 修正（assertion 期待値同期 / locator 置換）
2. T4: 既存 handler の内部 helper 集約（外部 API 不変、test 既存）

のため、新規 test は不要。挙動同値性は既存 unit + E2E が担保。

## ベースライン vs 最終

| 項目 | Baseline（前サイクル末 `8a1276d`） | After |
| --- | --- | --- |
| typecheck | ✅ pass | ✅ pass |
| lint | ✅ pass (0 warnings) | ✅ pass (0 warnings) |
| unit test | ✅ 88 files / 1420 pass / 0 fail | ✅ 88 files / 1420 pass / 0 fail |
| build | ✅ pass | ✅ pass |
| **e2e** | ⚠ **98 pass / 2 fail** / 3 skip | ✅ **100 pass / 0 fail / 3 skip** |

**E2E が完全に green に復帰** — Phase 0 修復の主目的が達成された。次回 architect-refactor では
**Phase 1 baseline E2E を skip せず必ず走らせる**ことで、本来初手で気付ける drift を早期発見
できる体制が整った。

## 観測可能な動作変更なしの根拠

### Phase 0（test bug fix）

実装側を一切触らず、E2E spec の assertion / locator のみを実装の現状に合わせた。

- `sw.js` 本体は無変更（baseline 時点で既に `CACHE_VERSION = "v4"`）
- `CardTitle` 本体は無変更（baseline 時点で素の `<div>`）

### T4（finding-4 集約）

`runReloadRefreshAction` の内部処理は経由化前の 7 handler と完全同一順序:

```
setWorking(true)
  → setError(null)
  → await fn()
  → await reload()
  → await refreshGroups()
  catch → unwrapOrFrom + setError
  finally → closeDialog?(); setWorking(false)
```

- `errorCode` / `errorMessage` は callsite から渡すため既存値と同じ
- `closeDialog` 省略時は `?.()` が no-op で既存挙動と同値
- `fn` の戻り値型 `Promise<unknown>` 化は `startNewSeason` の `Promise<{ seasonId }>` を
  受け取れるようにしただけで、既存も await の戻り値を使っていないため等価
- 既存 `runRoleAction` は thin wrapper として保持（`errorCode: "group/role-change-failed"`
  固定）し、4 callsite 側を一切変更しない

inline 維持の 4 callsite（`onIssueCode` / `onRename` / `onLeave` / `onDelete`）は本 commit で
**1 行も触っていない** ため意味論不変。

## 残課題 / Next Step

1. **finding-5（Deferred 群）** — 20260512 / 20260514 を継承。要件:
   - `CardBackgroundCard.tsx` 447 行 hook 抽出 → 既存 test の mock 境界書換が要件
   - Storage rule の 2 read 削減 → owner-only 経路で実害なし
   - `retry.ts` signal sleep 対応 → `deleteWithRetry` の単独 callsite が増えた際に対応
   - `group-detail-client.tsx` の inline 4 callsite → `setError(null)` の取り扱いを正規化するか、
     observable change を許容するか、別タスクとして検討
2. **shadcn `<CardTitle>` の semantic 化** — Phase 0 drift-2 の根本対策として `CardTitle` に
   `<h2>` / `<h3>` を asChild 経由で受けられるようにする選択肢。全 callsite への波及があり
   別タスクで設計
3. **手動 smoke 推奨**:
   - サークル詳細画面で「シーズン開始」「ポイント計算ルール保存」「ポイント計算ルール
     リセット」を順に実行し、`working` flag / error 表示 / Dialog 開閉が前と同じ感覚で
     動作することを確認
   - 4 role 操作（promote/demote × 2）が引き続き動作すること
4. **PR 化** — `/prp-pr` で起票時、本サイクル＋前サイクル `20260514` を 1 つの PR に
   まとめるか、test fix 2 件と refactor 5 件を別 PR に分けるか検討。test fix は緊急性が
   高く、refactor 群は独立にレビューしやすいため **2 つの PR に分割推奨**:
   - PR A: 前サイクル `20260514` の 4 refactor commit (`fb88a44` / `ae170e9` / `4ea32ea` /
     `feeb3e1` + plan move `8a1276d`)
   - PR B: 本サイクル `20260514-2` の test fix 2 件 + finding-4 集約 + docs
     (`a3073f4` / `b8c07f7` / `05fb530` + 本 review/plan/report)

## 関連リンク

- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260514-2.md](../reviews/architect-refactor-20260514-2.md)
- 実施計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260514-2.plan.md](../plans/architect-refactor-20260514-2.plan.md)
- 元 PRD: [.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md](../prds/05-post-launch-polish.prd.md)
- 前サイクル report: [architect-refactor-20260514.md](architect-refactor-20260514.md)
- レンズ: [`web_architect.md`](../../../skills/architect-refactor/references/web_architect.md) / [`security_specialist.md`](../../../skills/architect-refactor/references/security_specialist.md)
- 集約先: [`refactor-conventions.md`](../../../skills/architect-refactor/references/refactor-conventions.md)
