# Architect Refactor Review — 20260509

## Scope

src/ 全体を対象に、03-pwa-app-shell Phase D（Install Promotion / Service Worker / iOS hint）
の着地と、02-season-stats-and-share の polish（サークル詳細タブ化）の積み上がり以降に
増えた構造を、Senior Web Architect + Security Specialist の 2 レンズで監査。

ベースブランチ: `develop`（直近コミット `638ffb9`）
作業ブランチ: `refactor/whole-codebase-20260509`
所属 PRD: `03-pwa-app-shell`（finding-1 が PWA 領域 / Phase D 直後の自然な集約タイミング）

前回までの architect-refactor で捌かれた領域（同領域は今回スコープ外）:
- 2026-04-30: Phase 4 完了直後の orchestrator wrap helper / tournament-state 純関数化 等
- 2026-05-06: 02-season-stats-and-share Phase A〜C 直後の characterization test 整備
- 2026-05-07: 02 Phase D follow-up — ShareCard URL/filename helper 集約 / client 二重 warn
  解消 T4 / orchestrator の wrap 化 T5

## Baseline 状態

| 項目 | 結果 |
| --- | --- |
| typecheck | ✅ pass（ベースライン red 2 件は phase-d-install-promotion spec の `Page` 型未 re-export と implicit any。`7325f6d` で修復後 pass） |
| lint | ✅ pass（No warnings or errors） |
| unit test | ✅ 1210 passed / 0 failed (69 files, 9.83s) |
| e2e test | ✅ 87 passed / 0 failed / 3 skipped (7.9 min, note-screenshots は意図的 skip) |
| build | ✅ pass (16 routes, /tournaments/[tid] 30.7 kB / 361 kB First Load) |

## Findings

### finding-1: PWA dismiss state helper が PwaInstallPromotion / IOsInstallHint で重複

- Lens: architect（DRY） + security（storage key drift）
- Severity: **medium**
- 場所:
  - [src/components/pwa/PwaInstallPromotion.tsx:29-67](../../../../src/components/pwa/PwaInstallPromotion.tsx#L29-L67)
  - [src/components/pwa/IOsInstallHint.tsx:23-56](../../../../src/components/pwa/IOsInstallHint.tsx#L23-L56)
- 観察事実: 以下 5 シンボルが両 file に同じ実装で存在する。
  - `STORAGE_KEY = "allinpt.pwaInstallDismissedAt"` 定数
  - `THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000` 定数
  - `readDismissedAt(): number | null` 関数（try/catch + AppError.from "pwa/storage-failed"）
  - `persistDismissedAt(ts: number): void` 関数（try/catch + AppError.from "pwa/storage-failed"）
  - `isWithinDismissTtl(at)`（PwaInstallPromotion 側のみ展開済み、IOsInstallHint 側は inline 比較）
- 影響: 30 日 TTL の値変更 / error code 変更 / storage key 変更を片方だけ反映すると、
  「Android Chrome で dismiss → iOS Safari でも 30 日 hide される」連動が破綻する。
  両 component が「同 storage key を共有することで mount 点が違っても 1 セッション中に
  二重表示しない」という設計意図を持っているため、storage key drift は機能崩壊につながる。
- 案:
  1. `src/components/pwa/install-dismiss-storage.ts`（新設）に 5 シンボルを集約し、
     両 component が import する。location が `_components/` でなく
     `src/components/pwa/` 直下なのは「PWA component 群が共通で使う」スコープのため
     （`InlineNumberEditCard` と同じ昇格パターン）。
  2. install-dismiss-storage は SSR-safe（`typeof window === "undefined"` ガード）を維持。
- テスト保護:
  - 既存 unit `PwaInstallPromotion.test.tsx`（9 ケース）— private mode / 5d / 31d 等
    storage 経路の振る舞いを網羅
  - `IOsInstallHint.test.tsx`（7 ケース）— UA / standalone / iPad / dismiss / 5d / 31d
  - E2E `phase-d-install-promotion.spec.ts`（5 ケース）— 「30 日 TTL に乗る」I/O を black-box
  - 抽出後も storage I/O のシーケンス・key・error code を変えなければ振る舞い同一
- リスク: 低い。symbol 名 / I/O 順序を保ち、import path のみ変更。

### finding-2: Table 色プリセット radiogroup が 2 component で重複

- Lens: architect（DRY / 再利用性）
- Severity: **medium**
- 場所:
  - [src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx:193-232](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx#L193-L232)
  - [src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx:144-185](../../../../src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx#L144-L185)
- 観察事実: 「色なし」button + `TABLE_COLOR_PRESETS.map` の radiogroup を両 file が
  別実装で持っている。共通点:
  - role="radiogroup"`、各 button `role="radio"` + `aria-checked` + `disabled` パターン
  - 「色なし」button は border + hover:bg-accent、preset button は backgroundColor 直書き
  - 選択時は `ring-2 ring-ring ring-offset-1`（Card 側）と `ring-offset-2`（Popover 側）
    で offset 値だけ異なる
  - aria-label 規約が違う（Card: `default-table-${idx + 1}-color-${preset.name}` /
    Popover: `色：${preset.name}`）— E2E から拘束あり
- 影響:
  - プリセット追加 / radio aria 仕様変更 / 「色なし」button の disabled UX 変更を 2 所反映
  - `ring-offset-*` の不一致のような cosmetic drift が積み上がりやすい
- 案:
  1. `src/components/tournament/_table-label-edit/TableColorPresetRadioGroup.tsx`（新設）に
     抽出。props で `value: string | null` / `onChange(next)` / `disabled` /
     `ringOffset?: 1 | 2` /  `ariaLabelPrefix: string` /  `ariaLabelStyle: "verbose" | "compact"` を
     受ける（aria-label 規約 2 系統を維持するため）。
  2. ariaLabelStyle により以下を切替:
     - "compact": `${ariaLabelPrefix}-color-${preset.name}` / `${ariaLabelPrefix}-color-none`
       （Card 側: `default-table-${idx + 1}` / E2E と互換）
     - "verbose": `色：${preset.name}` / `色：なし`（Popover 側 / 既存 a11y 文言）
  3. ring-offset は 1 と 2 の bool ではなく、`size: "sm" | "md"` で wrapper クラス全体を
     切り替える方が拡張性が高い。今は ring-offset の差のみだが、将来 button サイズも
     違ってくる可能性を吸収する設計にしておく。
- テスト保護:
  - E2E `table-label-and-color.spec.ts`（4 ケース）— aria-label 文字列を assert するため、
    抽出後に文字列が drift すると即発覚
  - GroupDefaultTableLabelsCard / TableLabelEditPopover に対する unit test は **無い**
  - 抽出に先立って GroupDefaultTableLabelsCard 用の characterization test を追加する
    （editing mode で preset click → onSave に正しい color が渡る、を 1 ケース）
- リスク: 中程度。aria-label 規約 2 系統を保つ設計が必要。E2E が文字列 drift を即検出するので
  最終 green 確認で安全側に倒せる。

### finding-3: client / component 側の二重 warn が残っている

- Lens: architect（[error-logging.md](../../../rules/error-logging.md) の禁止事項違反）
- Severity: **low**
- 場所（5 件、いずれも repository / service が `wrapFirestoreWrite` 等で wrap 済みの関数を
  呼んでいる UI 側 catch）:
  1. [src/components/tournament/BustButton.tsx:51-54](../../../../src/components/tournament/BustButton.tsx#L51-L54) —
     `bustPlayer` / `unbustPlayer` (`repositories/players.ts:152-189` で wrap 済み)
  2. [src/components/tournament/PlayerList.tsx:63-66](../../../../src/components/tournament/PlayerList.tsx#L63-L66) —
     `cancelPlayerEntry` (`services/receipt.ts:169` 経由 → `deletePlayer` wrap 済み)
  3. [src/components/tournament/PlayerList.tsx:113-125](../../../../src/components/tournament/PlayerList.tsx#L113-L125) —
     `setIsPlayingDealer` (`services/seating/orchestrator.ts:987` で前回 T5 で wrap 済み)
  4. [src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx:131-138](../../../../src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx#L131-L138) —
     `setDefaultTableSettings` (`services/group.ts:381` → `repositories/groups.ts:325` で wrap 済み)
  5. [src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx:80-90](../../../../src/components/tournament/_table-label-edit/TableLabelEditPopover.tsx#L80-L90) —
     `updateTableLabel` (`repositories/tables.ts:131` で wrap 済み)
- 観察事実: いずれも UI catch で `AppError.from(e, ...) + logger.warn(...)` を実行。repository /
  service 側で既に `logger.warn` 出力済みのため、本番ログが 1 イベント当たり 2 行 warn される。
- 影響: ログ量増。エラー UX への影響なし。前回 architect-refactor の T4 で「明らかに
  repository / service の AppError を再 wrap している」分は集約したが、5 件取りこぼしている。
- 案: 各箇所を `unwrapOrFrom` に置換し `logger.warn` を削除。`setError` 側の文字列 format
  （`${code}: ${message}` / `setLocalError`）は同形を維持。
- テスト保護:
  - `BustButton`、`PlayerList`、`GroupDefaultTableLabelsCard`、`TableLabelEditPopover` の
    component test は logger.warn の回数を assert していない
  - E2E が「失敗時に role=alert / setError のテキストが表示される」観測点を担保する
- リスク: 極低。差分は本番ログから warn 行が消える点のみ（前回 T4 と同形）。

### finding-4 (見送り推奨): OG image route はクエリ任意テキストを画像化する未認証 endpoint

- Lens: security（最小権限 / インフラ）
- Severity: **low**
- 場所:
  - [src/app/api/og/winner/[tid]/route.tsx](../../../../src/app/api/og/winner/[tid]/route.tsx)
  - [src/app/api/og/season/[gid]/route.tsx](../../../../src/app/api/og/season/[gid]/route.tsx)
- 観察事実: `[tid]` / `[gid]` の path 値は実在性チェックを行わず、query を
  `WINNER_CARD_QUERY_SCHEMA` / `SEASON_CARD_QUERY_SCHEMA` の zod 制約（min/max length /
  number range）のみで検証して画像を生成する。認証も rate limit も無い。
- 影響:
  - 攻撃者が app の brand を借りて任意テキストの「優勝カード」「シーズンカード」を
    画像化可能（meme generator 化）
  - 1 リクエスト = 1 ImageResponse 生成（fonts ロード + 1200×630 SVG → PNG）= 数百 ms /
    数百 KB のサーバ計算。Vercel Hobby の concurrent limit を不正に消費する DoS 余地
  - キャッシュは `s-maxage=86400 + stale-while-revalidate=604800` で同 URL 再請求は
    edge cache に hit するが、URL を変えれば毎回再生成
- 案（今回は **見送り**、将来 phase で再評価）:
  - HMAC 署名 URL — 環境変数 `OG_SIGNING_SECRET` で `(tid, qs)` の HMAC を計算し
    `&sig=...` を付ける。route 側で再計算して照合。Web Share API は URL を fetch するだけ
    なので互換性あり。クライアントは server action か `/api/og/sign` 経由で署名を発行
  - レート制限 — Vercel Edge Middleware で IP 単位 N req/min。Hobby plan は edge functions
    の制限あり、検討時は plan 確認
  - 認証 gating — Web Share API / `<a download>` で Authorization ヘッダ付与不可のため
    cookie ベース auth が必要。実装コスト大
- 判定: 20 人サークル × 月 1〜2 回開催の規模では brand abuse / DoS は顕在化しない。
  default の Web Share / 直 download UX を温存しつつ将来 phase で signed URL 化を検討。

### finding-5 (見送り推奨): 大型ファイル

- Lens: architect（ファイル分割閾値）
- Severity: **low**
- 観察事実:
  - `src/lib/services/seating/orchestrator.ts` 1110 行
  - `src/lib/firebase/repositories/tournaments.ts` 939 行
  - `src/lib/services/group.ts` 741 行
- 判定: 前回 architect-refactor 20260507 と同じく「ドメイン凝集度高い」「縦に切ると依存
  関係が unclear になる」ため見送る。`SeasonPointsRuleCard.tsx` 373 行 /
  `GroupDefaultTableLabelsCard.tsx` 326 行 / `TableLabelEditPopover.tsx` 240 行は
  feature 単位の凝集が高くこのままで良い（複数ページから使われていない）。

### finding-6 (見送り推奨): SeasonPointsRuleCard の inline validation が schema / repository と重複

- Lens: architect（DRY / SoC）
- Severity: **medium**
- 場所: [src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx:108-130](../../../../src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx#L108-L130)
- 観察事実: `handleSave` 内で `base.length 1〜SEASON_POINTS_BASE_MAX_LENGTH` /
  `base[i] >= 0` / `baseline integer 2..10` の 3 制約を独立に書いている。
  schema (`schemas/group.ts`) / service (`updateSeasonPointsRule`) で同一制約を持つ。
- 判定: **見送り**。理由 — UI の `draftRule` (line 91-106) はリアルタイムプレビュー表 (line
  175 / 275) のために draft 値を「invalid なら effective にフォールバック」する責務を持って
  おり、これは inline validation とほぼ等価のロジック。schema/service throw を待って表示する
  と、preview 表が「保存ボタン押下まで invalid 値で空白」になる UX 退化。inline validation を
  純関数化（`validateSeasonPointsRuleDraft`）して両所で参照する方向は将来余地としてあるが、
  本 refactor のスコープ外。

### finding-7 (見送り推奨): group-detail-client の handler 重複

- Lens: architect（DRY）
- Severity: **low**
- 場所: [src/app/groups/[gid]/group-detail-client.tsx:217-347](../../../../src/app/groups/[gid]/group-detail-client.tsx#L217-L347)
- 観察事実: `onIssueCode` / `onLeave` / `onDelete` / `onStartSeason` /
  `onSaveSeasonPointsRule` / `onResetSeasonPointsRule` の 6 handler が同じ
  `try { setError(null); ... } catch { unwrapOrFrom; setError } finally { setWorking(false) }`
  パターンを持つ。`runRoleAction` は role 系 4 操作で既に集約済み。
- 判定: **見送り**。各 handler は post-action（`router.push` / `setIssuedCode` /
  `setConfirmStartSeasonOpen(false)` / 各種 reload）が異なるため、完全集約は callback の
  bag を増やして可読性を落とす。`runRoleAction` 同様の helper を「reload + refreshGroups
  + 後始末 callback」を引数化する形に拡張する余地はあるが、これは KISS を侵害しないか要判断。
  本 refactor では別任意。

## Findings 集計

- critical: 0 件
- high: 0 件
- medium: 3 件（finding-1 / finding-2 / finding-6 — finding-6 は見送り）
- low: 4 件（finding-3 / finding-4 / finding-5 / finding-7 — finding-4/5/7 は見送り）

実施候補: **finding-1 / finding-2 / finding-3** の 3 件

## 次フェーズ（Phase 3）への引継ぎ

3 件をそれぞれ atomic commit として:
- T1: PWA install dismiss helper の集約（finding-1）
- T2: TableColorPresetRadioGroup 共通化（finding-2、characterization test 先行追加付き）
- T3: 残存 client 二重 warn の unwrapOrFrom 化（finding-3、5 ファイル）

順序は依存度順に T1 → T2 → T3。T1 は他に影響しない自閉型。T2 は E2E aria-label 規約に
拘束されるため characterization test を先行投入。T3 は最小差分で他依存無し。
