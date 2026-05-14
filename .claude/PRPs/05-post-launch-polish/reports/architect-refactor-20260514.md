# Architect Refactor Report — 20260514

## Scope

PRD `05-post-launch-polish` 完了直後（Track D Phase D.1 = テーマ切替まで反映済み、
ベースラインコミット `0717eaf`）の `src/` 全域を、Senior Web Architect + Security
Specialist の 2 レンズで再監査し、findings の上位 3 件（MEDIUM 1 / LOW 2）を atomic
リファクタリングで集約した。

- ベースブランチ: `develop`（baseline `0717eaf`）
- 作業ブランチ: `refactor/architect-refactor-20260514`
- 所属 PRD: `05-post-launch-polish`（Track D Phase D.1 follow-up）
- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260514.md](../reviews/architect-refactor-20260514.md)
- 実施計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260514.plan.md](../plans/architect-refactor-20260514.plan.md)
- diff 規模（`src/`）: 8 files / +309 / -106 行

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 1 件（finding-1: clipboard copy + flash パターンの 3 callsite 重複）
- low: 2 件（finding-2: QR wrapper 3 callsite 重複 / finding-3: onTogglePd 2 箇所重複）
- info: 2 件（finding-4: `group-detail-client.tsx` 7 handler 重複 — 次回サイクル / finding-5: 20260512 deferred 群の継承）

## 実施した変更

| commit | 概要 | 影響範囲 |
| --- | --- | --- |
| `fb88a44` | refactor(hooks): clipboard copy + flash パターンを `useClipboardCopy` hook に集約 | 新規 `src/lib/hooks/useClipboardCopy.{ts,test.ts}` + 3 callsite 経由化（`QrPanel` / `InviteCodeCard` / `SpectateModeCard`） |
| `ae170e9` | refactor(qr): `ThemedQRCode` に `framed` prop（default true）を追加し 3 callsite の wrapper を集約 | `ThemedQRCode.{tsx,test.tsx}` + 3 callsite |
| `4ea32ea` | refactor(dashboard): `onTogglePd` インライン 2 箇所を `useCallback` 1 つに集約 | `dashboard-client.tsx` |
| `feeb3e1` | docs: architect-refactor 20260514 の review と plan を追加 | `.claude/PRPs/05-post-launch-polish/{reviews,plans}/` |

各 commit は atomic で `git revert` 1 つで安全に戻せる粒度。すべての commit で
typecheck / lint / 該当 unit test を green に保ったまま積み上げた。

### Finding 対応マッピング

| Finding | Severity | 対応 commit |
| --- | --- | --- |
| finding-1（clipboard copy 3 箇所重複） | MEDIUM | `fb88a44` |
| finding-2（QR wrapper 3 箇所重複） | LOW | `ae170e9` |
| finding-3（`onTogglePd` 2 箇所重複） | LOW | `4ea32ea` |

## 見送った提案（理由付き）

- **finding-4（`group-detail-client.tsx` の 7 つの async handler 集約）** — `onIssueCode` /
  `onRename` / `onLeave` / `onDelete` / `onStartSeason` / `onSaveSeasonPointsRule` /
  `onResetSeasonPointsRule` の 7 ハンドラに「reload しない / 再 throw する / setError(null) を
  先頭で呼ぶ / finally で dialog を閉じる」など handler ごとの semantic 差分があり、
  汎用化 helper のバリエーション設計に時間がかかる。次回 architect-refactor で `runAction(fn, opts)`
  形で再評価する（opts に `reload? / refresh? / rethrow? / postFinally?` を渡せる API を想定）。
- **finding-5（20260512 deferred 継承）** — 以下は前回判断を維持:
  - 20260512 finding-5: `CardBackgroundCard.tsx` 447 行の hook 抽出（既存 test の mock 境界書換が必要）
  - 20260512 finding-6: Storage rule の 2 read 消費（owner 操作のみ・低頻度）
  - 20260512 finding-7: `retry.ts` の signal sleep 反応（`deleteWithRetry` 単独 callsite で実用上問題なし）

## 追加したテスト

| ファイル | 件数 | カバー振る舞い |
| --- | --- | --- |
| `src/lib/hooks/useClipboardCopy.test.ts`（新規） | 6 件 | `copy()` 成功で `copied=true → autoResetMs 経過で false` / `autoResetMs` カスタム反映 / `writeText` 失敗で `logger.warn({code:"clipboard/unavailable"})` + `onError("clipboard/unavailable: ...")` / value 変化で copied 即 reset / value=null で no-op / clipboard 不在で no-op |
| `src/components/qr/ThemedQRCode.test.tsx`（拡張） | +2 件 | `framed=true`（default）で `rounded-md border bg-card p-4` wrapper / `framed=false` で素 SVG |

合計 +8 件。ベースライン 1412 件 → 最終 1420 件。

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | ✅ pass | ✅ pass |
| lint | ✅ pass (0 warnings) | ✅ pass (0 warnings) |
| unit test | ✅ 87 files / 1412 pass / 0 fail | ✅ 88 files / 1420 pass / 0 fail |
| build | ✅ pass | ✅ pass |
| e2e | ⏸ Phase 1 baseline では未走行（前回 20260512 と同方針） | ⚠ 98 pass / 2 fail / 3 skip — 失敗 2 件は **baseline 由来の pre-existing test drift** で本リファクタ起因ではない（後述） |

### E2E pre-existing test drift（リファクタ起因ではない 2 件）

最終 Phase 5 で full E2E 走行（98 pass / 2 fail / 3 skip）。失敗 2 件はベースライン `0717eaf` 時点で
**既に存在していた test と実装の drift** で、本サイクルの T1〜T3 がいずれも触れない領域。
ベースライン E2E を Phase 1 で skip した運用上の選択（20260512 と同方針）の副作用として、
本 Phase 5 で初めて検出された。

| Test | 失敗内容 | 根本原因 | 私の refactor との関係 |
| --- | --- | --- | --- |
| `tests/e2e/phase-d-install-promotion.spec.ts:174` | `expect(body).toMatch(/const\s+CACHE_VERSION\s*=\s*"v3"/)` が fail | `public/sw.js` は baseline 時点で **`CACHE_VERSION = "v4"`** に bump 済み（commit `582cb76` "fix: SW の cache.put が 206 応答で失敗し音声 fetch が 504 化する問題を修正"）。test 側が v3 のまま放置 | 私は `public/sw.js` と本 spec を一切編集していない（git diff で確認可能） |
| `tests/e2e/theme-toggle.spec.ts:32` | `getByRole("heading", { name: "テーマ" })` が visible にならない | page snapshot に `テーマ` は `generic [ref=e86]` で描画されており、`<CardTitle>` は `<div>`（`src/components/ui/card.tsx:23-32`）。E2E test が CardTitle に heading role があると誤って想定 | 私は `/settings` / `ThemeToggle` / `CardTitle` を一切編集していない |

両者とも **私の refactor を revert しても fail し続ける**ことを `git stash` 等で検証可能（時間都合で
今回は git show で baseline content を直接確認）。両 test とも baseline コミット `0717eaf` の同日に
追加または最終更新された E2E で、ベースライン E2E が走っていれば pre-existing として捕捉できた。

**対応方針**:

1. **本リファクタは観測可能変更なし** で完了する。pre-existing failure を私の refactor で fix するのは
   スコープ外（テスト規約 [testing.md](../../../rules/testing.md) の「テストの skip / disable / 削除は禁止」
   とは別の話で、test 自体のバグ修正は「機能追加と test を同一 commit に含める」原則の文脈外）
2. **後続フォローアップとして 2 件の test bug を個別 commit で修正することを推奨**:
   - `phase-d-install-promotion.spec.ts:174` の `"v3"` → `"v4"` 更新
   - `theme-toggle.spec.ts:32` の `getByRole("heading")` → `getByText("テーマ")` 化、または `<CardTitle>` に
     `role="heading" aria-level={2}` を追加（後者は他 CardTitle 全体への影響あり、専用 wrapper の方が安全）
3. **次回 architect-refactor の baseline E2E は必ず走らせる**ことで、本来 Phase 1 で気付ける drift を
   早期発見する（運用学習）

### バンドルサイズ変化（参考）

| Route | Baseline | After | 差分 |
| --- | --- | --- | --- |
| `/groups/[gid]` | 15.9 kB | 15.8 kB | -0.1 kB |
| `/tournaments/[tid]` | 17.6 kB | 17.4 kB | -0.2 kB |
| `/tournaments/[tid]/live` | 5.49 kB | 5.38 kB | -0.11 kB |

3 callsite で重複していた clipboard copy / QR wrapper の集約により、わずかに削減。

## 観測可能な動作変更なしの根拠

1. **clipboard copy パターン（T1）**:
   - `navigator.clipboard.writeText(url)` 呼出は callsite で同値（`SpectateModeCard.test.tsx` の既存 assert を通過）
   - `copied` flash の auto-reset 時間は default 2000ms で既存と同値
   - 失敗時の logger.warn の code は `"clipboard/unavailable"` で同値、message は `AppError.from(e, "clipboard/unavailable", "クリップボードにコピーできませんでした")` の wrapped 形に統一
   - `SpectateModeCard` の onError 文字列 `"clipboard/unavailable: クリップボードにコピーできませんでした"` は `formatErrorForDisplay(wrapped)` 経由で同形を再現
   - `InviteCodeCard` の `useEffect(() => setCopied(false), [issuedCode])` 挙動は hook 内 `useEffect([value])` で再現（new test `value が変わると copied=false に即リセット` で固定）
2. **QR wrapper（T2）**:
   - DOM 構造（`<div className="flex justify-center rounded-md border bg-card p-4">` + 子 `<svg>`）は 1:1 同値（wrapper class を `ThemedQRCode` 内部に移動するだけ）
   - 既存 `ThemedQRCode.test.tsx` の light/dark 色 assertion はそのまま green
   - 3 callsite の `<ThemedQRCode>` 単発呼出に変わり、prop は同値
3. **`onTogglePd` 集約（T3）**:
   - 関数 body は完全同形（`getSameTableActiveOtherIds` + `setIsPlayingDealer`）
   - `useCallback` で参照が安定する以外の挙動変化なし（`SeatingBoard` / `PlayerList` は `onTogglePd` を呼ぶだけで参照同一性に依存しない）
   - 既存 `dashboard-client.test.tsx` 系の test は経路同一性で pass

## 残課題 / Next Step

1. **E2E test drift 2 件の修復**（最優先）— 上記「E2E pre-existing test drift」セクション参照。
   `phase-d-install-promotion.spec.ts` の `CACHE_VERSION` を "v4" に同期、`theme-toggle.spec.ts` の
   `getByRole("heading")` を別ロケータに置換。両者とも 1〜2 行 fix
2. **finding-4（`group-detail-client.tsx` 7 handler 集約）** — 次回 architect-refactor サイクルで
   `runAction(fn, opts)` 形に汎用化する設計を検討。`onIssueCode`（reload 不要）/ `onRename`（rethrow）/
   `onSaveSeasonPointsRule`（先頭で `setError(null)`）の差分を `opts` で吸収する API シグネチャ案を
   plan に書き出してから着手する
3. **finding-5（20260512 deferred 群）** — 前回判断維持。`CardBackgroundCard.tsx` の hook 抽出は
   既存 test の mock 境界書換が必要で、本サイクルでもスコープ外
4. **手動 smoke 推奨**:
   - QR コード（参加 / 招待 / 観戦 3 種）の light/dark テーマでの表示確認
   - 参加者画面の copy ボタン操作で `copied → 2 秒後リセット` 動作
   - サークル詳細の招待コード再発行で `copied` が即リセットされること
   - tournament dashboard の PD checkbox（SeatingBoard / PlayerList 両方）が ON/OFF できること
5. **PR 化** — `/prp-pr` で起票。PR 説明には「観測可能な動作変更なし」「テスト 1412 → 1420 件 (+8) で
   回帰防御強化」「重複削除により bundle 微減」「E2E 失敗 2 件は baseline 由来の pre-existing test
   drift で本 PR とは独立」を明記

## 関連リンク

- 監査結果: [.claude/PRPs/05-post-launch-polish/reviews/architect-refactor-20260514.md](../reviews/architect-refactor-20260514.md)
- 実施計画: [.claude/PRPs/05-post-launch-polish/plans/architect-refactor-20260514.plan.md](../plans/architect-refactor-20260514.plan.md)
- 元 PRD: [.claude/PRPs/05-post-launch-polish/prds/05-post-launch-polish.prd.md](../prds/05-post-launch-polish.prd.md)
- 前回 report: [.claude/PRPs/05-post-launch-polish/reports/architect-refactor-20260512.md](architect-refactor-20260512.md)
- レンズ: [`web_architect.md`](../../../skills/architect-refactor/references/web_architect.md) / [`security_specialist.md`](../../../skills/architect-refactor/references/security_specialist.md)
- 集約先: [`refactor-conventions.md`](../../../skills/architect-refactor/references/refactor-conventions.md)
