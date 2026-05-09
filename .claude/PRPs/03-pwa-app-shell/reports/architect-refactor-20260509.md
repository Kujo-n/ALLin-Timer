# Architect Refactor Report — 20260509

## Scope

src/ 全体を対象に、03-pwa-app-shell Phase D（Install Promotion / Service Worker /
iOS hint）の着地と、02-season-stats-and-share の polish（サークル詳細タブ化）の
積み上がり以降に増えた構造を、Senior Web Architect + Security Specialist の 2 レンズで監査。

ベースブランチ: `develop`（直近コミット `638ffb9`）
作業ブランチ: `refactor/whole-codebase-20260509`
所属 PRD: `03-pwa-app-shell`（finding-1 が PWA 領域 / Phase D 直後の自然な集約タイミング）

## Findings 概要

- critical: 0 件
- high: 0 件
- medium: 3 件（finding-1 / finding-2 / finding-6 — finding-6 は見送り）
- low: 4 件（finding-3 / finding-4 / finding-5 / finding-7 — finding-4/5/7 は見送り）
- 詳細監査結果: [.claude/PRPs/03-pwa-app-shell/reviews/architect-refactor-20260509.md](../reviews/architect-refactor-20260509.md)

## 実施した変更

### 0: `test: phase-d install promotion spec の typecheck red を修復`

- commit: `7325f6d`
- 影響: `tests/e2e/fixtures/test-context.ts` / `tests/e2e/phase-d-install-promotion.spec.ts`
- 内容: Baseline 取得時に発覚した既存 typecheck red 2 件（`Page` 型未 re-export と
  `page.evaluate` callback の implicit any）を修復。develop 由来の pre-existing で
  本 refactor のスコープ外だが、Baseline green を確立するために最初に修復。
  test-context.ts に `export type { Page } from "@playwright/test"` を追加し、
  phase-d spec の destructured arg に明示型を付与。

### T1: `refactor(pwa): install dismiss state helper を install-dismiss-storage.ts に集約`

- commit: `07f417e`
- 影響: `src/components/pwa/install-dismiss-storage.ts`（新設）/
  `src/components/pwa/PwaInstallPromotion.tsx` / `src/components/pwa/IOsInstallHint.tsx`
- 内容: `PwaInstallPromotion` / `IOsInstallHint` で重複していた storage 5 シンボル
  （`STORAGE_KEY` / `THIRTY_DAYS_MS` / `readDismissedAt` / `persistDismissedAt` /
  `isWithinDismissTtl`）を 1 module に統合。両 component が同 storage key を
  共有することで「Android Chrome で dismiss → iOS Safari hint も 30 日 hide」される
  連動を担保する設計意図を、構造的に drift を防ぐ形で維持。差分 +80 / -85。
  finding-1 完了。

### T2-a: `test(group): GroupDefaultTableLabelsCard の preset 選択 → onSave に渡る color を characterize`

- commit: `459c7db`
- 影響: `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx`（新設）
- 内容: 続く T2-b で TableColorPresetRadioGroup を抽出する前段の characterization test。
  3 ケース追加（onSave 引数の (label, color) 形 / 「色なし」radio click で null /
  aria-label 規約 `default-table-${idx}-color-${name}` の安定性）。差分 +106 / -0。

### T2-b: `refactor(tables): 卓色プリセット radiogroup を TableColorPresetRadioGroup に共通化`

- commit: `23ccdd6`
- 影響: `src/components/tournament/_table-label-edit/TableColorPresetRadioGroup.tsx`（新設）/
  `TableLabelEditPopover.tsx` / `GroupDefaultTableLabelsCard.tsx`
- 内容: `GroupDefaultTableLabelsCard` / `TableLabelEditPopover` で重複していた
  「色なし button + TABLE_COLOR_PRESETS map の radiogroup」を 1 component に集約。
  `ariaLabelStyle` (compact / verbose) と `size` (sm / md) で 2 callsite の差を
  吸収する設計。
  - compact: `${prefix}-color-${preset.name}` / `${prefix}-color-none`（Card 側、E2E と互換）
  - verbose: `色：${preset.name}` / `色：なし`（Popover 側、人間可読 a11y 文言）
  - sm: h-7 w-7 / ring-offset-1（Card inline 編集）
  - md: h-9 w-9 / ring-offset-2（Dialog 編集）

  T2-a の characterization test 3 件と E2E `table-label-and-color.spec.ts` (4 件) が
  aria-label 規約の不変性を担保する safety net として機能。差分 +141 / -87。
  finding-2 完了。

### T3: `refactor(errors): 残存する client 二重 warn 5 箇所を unwrapOrFrom に集約`

- commit: `ba1668f`
- 影響: 4 ファイル（`BustButton.tsx` / `PlayerList.tsx` の 2 箇所 /
  `GroupDefaultTableLabelsCard.tsx` / `TableLabelEditPopover.tsx`）
- 内容: repository / service 側で `wrapFirestoreWrite` 等 wrap 済みの関数を呼ぶ UI
  catch から `AppError.from` + `logger.warn` を削除し `unwrapOrFrom` に置換。
  本番ログから二重 warn 行 1 件 / 操作 を除去。
  setError / setLocalError の文字列 format（`${code}: ${message}`）は同形維持。
  不要になった `logger` / `AppError` import を削除。差分 +14 / -25。
  finding-3 完了。

## 見送った提案（理由付き）

- **finding-4: OG image route の brand abuse / DoS** — `/api/og/winner/[tid]` /
  `/api/og/season/[gid]` は `[tid]` / `[gid]` の実在性チェックなしでクエリ任意テキストを
  画像化する未認証 endpoint。攻撃者が app brand を借りた meme generator として悪用可能で、
  Vercel concurrent limit を消費する DoS 余地もある。ただし 20 人 × 月 1〜2 回開催の規模では
  顕在化せず、対策（HMAC 署名 URL / IP rate limit / Cloud Functions 化）はいずれも実装コストが
  大きい。本 refactor のスコープ外、将来 phase で再評価。
- **finding-5: 大型ファイル分割** — `orchestrator.ts` 1110 行、`tournaments.ts` 939 行、
  `group.ts` 741 行は前回（20260507）と同じく「ドメイン凝集度高い」「縦に切ると依存関係が
  unclear になる」ため見送り。`SeasonPointsRuleCard.tsx` 373 行 /
  `GroupDefaultTableLabelsCard.tsx` 326 行 / `TableLabelEditPopover.tsx` 240 行は
  feature 単位の凝集が高く複数ページ間共有もないため現状で良い。
- **finding-6: SeasonPointsRuleCard の inline validation** — `handleSave` 内で
  `base.length 1〜SEASON_POINTS_BASE_MAX_LENGTH` / `base[i] >= 0` /
  `baseline integer 2..10` の 3 制約を独立に書いているが、`draftRule` (line 91-106) が
  リアルタイムプレビュー表 (PreviewTable) のために draft 値を「invalid なら effective に
  フォールバック」する責務を持ち、これは inline validation とほぼ等価のロジック。
  schema/service throw を待つと preview が「保存ボタン押下まで invalid 値で空白」になる
  UX 退化。見送り。
- **finding-7: group-detail-client の handler 重複** — 6 handler が同じ
  `try → unwrapOrFrom → setError / finally setWorking` パターンを持つが、各 handler の
  post-action（`router.push` / `setIssuedCode` / dialog close など）が異なるため、完全
  集約は callback bag を増やして可読性を落とす。`runRoleAction` を一般化する余地は
  あるが、KISS 観点で見送り。

## 追加したテスト

- `src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.test.tsx` — 3 件追加
  - `onSave に label と color が同じ index で渡る`
  - `「色なし」radio click で onSave の color に null が渡る`
  - `preset radio の aria-label 規約 default-table-${idx}-color-${name} が安定`

既存テスト 1210 → 新規 3 = 1213 件、すべて green を維持。

## ベースライン vs 最終

| 項目 | Baseline | After |
| --- | --- | --- |
| typecheck | ✅ pass（baseline fix `7325f6d` 後） | ✅ pass |
| lint | ✅ pass (No warnings or errors) | ✅ pass (No warnings or errors) |
| unit test | ✅ 1210 passed / 0 failed (69 files, 9.83s) | ✅ 1213 passed / 0 failed (70 files, 9.36s) |
| e2e test | ✅ 87 passed / 0 failed / 3 skipped (7.9 min) | ✅ 87 passed / 0 failed / 3 skipped (7.5 min) |
| build | ✅ pass (16 routes, /tournaments/[tid] 30.7 kB / 361 kB) | ✅ pass (16 routes, /tournaments/[tid] 30.7 kB / 361 kB) |

bundle サイズ: 完全に同一。T1 / T2 / T3 はいずれも内部 helper / component の集約のみで、
コード総量は微減（重複削除）するが import 経路が増えるため tree-shaking 後の bundle 影響は
ほぼ 0。

## 観測可能な動作変更が無いことの根拠

1. unit / e2e の全数 green を維持（旧 1210 → 新 1213 unit / 87 → 87 e2e）
2. 公開 API（URL クエリパラメータ / Firestore スキーマ / 環境変数 / 永続化フォーマット）の
   変更なし
3. T1 は storage key / TTL ms / SSR ガード / error code / I/O 順序を完全維持。差分は
   import path のみ。`PwaInstallPromotion.test.tsx`（10 ケース）/ `IOsInstallHint.test.tsx`
   （7 ケース）が storage 経路の bit-for-bit 同一性を担保
4. T2-b は aria-label 規約 / button サイズ / ring offset を 2 系統 props 経由で完全保持。
   T2-a の characterization test 3 件 + E2E `table-label-and-color.spec.ts` 4 件が
   aria-label 文字列の drift を即検出
5. T3 は setError 文字列 format / aria-label / button label 同一。差分は本番ログから
   warn 行 1 件 / 操作 が消える点のみ

ロジック以外で変わった点:
- 本番ログの warn 行数: T3 で 5 イベント分（bust / 取消 / PD toggle / Table 名デフォルト
  保存 / Table 名 popover 保存）の二重 warn が消える
- bundle サイズ: 完全同一（内部経路の集約のみ）
- ユニットテスト件数: +3（T2-a で characterization）

## 残課題 / Next Step

- **OG route の brand abuse / DoS（finding-4）**: 規模拡大 or 公開度上昇のタイミングで
  HMAC 署名 URL / IP rate limit / Cloud Functions 化を検討。本 refactor で見送り
- **SeasonPointsRule の draft validation 純関数化（finding-6 派生）**:
  inline validation を `validateSeasonPointsRuleDraft(base, baseline): { ok, errors }` の
  純関数に切り出し、schema / service / UI で参照する形は将来余地。preview の draftRule
  fallback 仕様と合わせて再設計が必要なため次回課題
- **group-detail-client の handler 集約（finding-7 派生）**: `runRoleAction` を
  「reload + refreshGroups + 後始末 callback」を引数化する形に拡張する余地あり。
  本 refactor では KISS で見送り
- **大型ファイル分割（finding-5）**: 引き続き分割不適。新機能追加で凝集度が崩れた時点で
  再評価
