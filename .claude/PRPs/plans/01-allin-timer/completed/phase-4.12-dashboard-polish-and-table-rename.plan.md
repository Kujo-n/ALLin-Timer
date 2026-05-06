# Plan: Phase 4.12 — Dashboard Top-Row Equal-Height & "卓 → Table" Rename

## Summary

Phase 4.11（Timer Layout & Control Polish）後の運営者フィードバックに基づくフォローアップ。**(A) Dashboard 上段 3 セット（QrPanel / TimerDisplay+TimerControls / 統計 3 カード）の等高化**、**(B) ユーザー向け文言 "卓" を一律 "Table" にリネーム**、**(C) 統計 3 カードのタイトル拡大＋本文色化**を 1 Phase で実施する。schema / Firestore Rules / hook / repository / service ロジックは無変更（純粋に UI とラベル文字列のみ）。テストは orchestrator description のスナップショット文字列 2 件のみ更新。Phase 4.10（Custom Audio Upload, optional）とは独立で並行可能。

## User Story

As a サークル運営者,
I want
1. Dashboard 上段の 3 セットが**同じ高さに揃って並ぶ**こと（一番背の高い QR を基準）,
2. 統計 3 カード（Next Break In / Average Stack / Players）の **タイトル文字が大きく・黒字（本文色）** で会場後方や投影越しでも読めること,
3. UI 全体の **"卓" 表記を一律 "Table" に統一** すること（運営者が already 開始している方針に揃える）,

So that 視認性が向上し、英語/日本語混在 UI でも Table 用語の一貫性が保たれ、Phase 5 のドライランで会場の見やすさペインを残さずに投入できる。

## Problem → Solution

**Current state（Phase 4.11 完了 + 本 Plan 着手前）**:

1. **高さバラバラ**: [dashboard-client.tsx:271-308](src/app/tournaments/[tid]/dashboard-client.tsx#L271-L308) の 3 カラム grid は左右 `aside` に `lg:self-start` が付いており `align-items: stretch` がオプトアウトされ、QR ≈400px / Timer+Controls ≈330px / 統計 3 カード ≈300px と高さが揃わない。
2. **統計カードのタイトルが小さくグレー**: NextBreakCard / AverageStackCard / PlayersCard のタイトル div は `text-xs uppercase tracking-wide text-muted-foreground` で、会場後方や 1080p プロジェクター越しでは判読しにくい。値テキストも 2xl/3xl で控えめ。
3. **"卓 / Table" 用語混在**: ユーザーが既に [dashboard-client.tsx:325](src/app/tournaments/[tid]/dashboard-client.tsx#L325) で `<CardTitle>卓 / 席</CardTitle>` → `<CardTitle>Table List</CardTitle>` へ unstaged 変更を入れている（`git diff HEAD` 確認済み）が、他箇所には "卓" が残っており**用語が一貫していない**:
   - [dashboard-client.tsx:231](src/app/tournaments/[tid]/dashboard-client.tsx#L231): `1 卓 {seatsPerTable} 席`（ヘッダー説明）
   - [SeatingBoard.tsx:68](src/components/tournament/SeatingBoard.tsx#L68): `卓 {tableNum}（{N} 人）`（卓カードの見出し）
   - [BalancingInstructionCard.tsx:56](src/components/tournament/BalancingInstructionCard.tsx#L56): `卓 ${brokenTableNum} を閉鎖`（バランシング指示）
   - [TournamentForm.tsx:111,162,173](src/components/tournament/TournamentForm.tsx#L111): `1 卓あたりの席数` / `最大 6 卓 × ...` / バリデーションエラー
   - [seating/orchestrator.ts:148,157,397,517](src/lib/services/seating/orchestrator.ts#L148): エラーメッセージ + `${X}卓${Y}席 → ${P}卓${Q}席` description + `卓 N を閉鎖`
   - 一方、参加者向け [live-client.tsx:219](src/app/tournaments/[tid]/live/live-client.tsx#L219) は既に `<dt>Table</dt>` で英語化済み → ここに合わせるのが自然

**Desired state（Phase 4.12 完了時点）**:

1. Dashboard 上段の 3 列が `lg+` で**同じ高さに揃う**（QR を基準に他 2 列が伸びる）。`/live` は対象外（要件 #2「再生ボタン群」が存在しない）。
2. 統計 3 カードのタイトルが **`text-base md:text-lg font-semibold text-foreground`**（ライト時に黒、ダーク時に白）に拡大、値テキストも 1 段拡大。
3. **ユーザー向け文字列の "卓" を一律 "Table" にリネーム**（コード内コメント / 内部 docstring / engine の TDA 解説等の "卓" は対象外、保守用として日本語維持）。description フォーマットは `1卓1席 → 2卓6席` を `Table 1 / 席 1 → Table 2 / 席 6` に変更（"席" は日本語維持で混在 OK、live の `Table` / `No.` 並びと同じ語感）。
4. PRD の Implementation Phases 表に **Phase 4.12 行を追加**（status: `in-progress`）し、本 Plan へリンクする。

## Metadata

- **Complexity**: Small（UI とラベル置換のみ・hook / schema / rule 不変）
- **Source PRD**: [.claude/PRPs/prds/allin-timer.prd.md](../prds/allin-timer.prd.md)（Phase 4.11 の follow-up・本 Plan 適用と同時に Phase 4.12 行を新設）
- **PRD Phase**: **Phase 4.12 — Dashboard Top-Row Equal-Height & "卓 → Table" Rename**（depends: 4.11 / parallel: 4.10）
- **Estimated Files**: 8 files（編集 7・テスト修正 1）
- **対象ページ**: `/tournaments/[tid]`（Dashboard）+ Tournament 作成フォーム + Balancing 指示カード + SeatingBoard + Seating orchestrator description / errors。`/live` は無変更。
- **想定工数**: 1〜2 時間（テスト修正含む）

---

## UX Design

### Before（Phase 4.11 完了時点）

```
┌──────── lg+ Dashboard ──────────────────────────────────┐
│ ┌──────┐ ┌──────────────────┐ ┌──────────┐              │
│ │QR    │ │  Lv N · 進行中    │ │NEXT BREAK│  ← 高さバラバラ│
│ │ █▀▀█ │ │   12:34           │ │  03:21   │     タイトル小 │
│ │ ▄▄▄▄ │ │  SB BB Ante      │ │AVG STACK │     灰色      │
│ │ URL  │ │ ◀ ▶ ⏯ ⏭ ⏹      │ │  10,000  │              │
│ │[Copy]│ └──────────────────┘ │PLAYERS   │              │
│ └──────┘                      │  5/20    │              │
│  (≈400)        (≈330)         │ (≈300)   │              │
│                                                         │
│ Card: 卓 / 席                                            │
│  ├── 卓 1（5 人） … ★は運営兼任                         │
│  └── 卓 2（5 人）                                        │
│ Card: バランシング指示「卓 1 を閉鎖（3 名移動）」       │
│ Card: PlayerList                                        │
│ Card: ストラクチャ snapshot                              │
└─────────────────────────────────────────────────────────┘
```

### After（Phase 4.12 完了時点）

```
┌──────── lg+ Dashboard 上段（等高）──────────────────────┐
│ ┌──────┐ ┌──────────────────┐ ┌────────────┐            │
│ │QR    │ │                  │ │Next Break In│ ← タイトル │
│ │ █▀▀█ │ │     Lv N · 進行中 │ │   03:21    │   大・黒字  │
│ │ ▄▄▄▄ │ │      12:34       │ ├────────────┤            │
│ │      │ │   (lg:10rem)     │ │Average Stack│            │
│ │ URL  │ │                  │ │  10,000    │            │
│ │[Copy]│ │ SB BB Ante (5xl) │ ├────────────┤            │
│ └──────┘ │ ◀ ▶ ⏯ ⏭ ⏹       │ │Players      │            │
│          └──────────────────┘ │   5/20     │            │
│ (h-full)   (h-full・center)   │ (rows-3)   │            │
│  ↑ いずれも QR 基準の同じ高さに揃う                     │
│                                                         │
│ Card: Table List ← (既に rename 済 / unstaged)          │
│  ├── Table 1（5 人） ★：運営兼任                       │
│  └── Table 2（5 人）                                    │
│ Card: バランシング指示「Table 1 を閉鎖（3 名移動）」    │
│ Card: PlayerList                                        │
│ Card: ストラクチャ snapshot                              │
└─────────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| 上段 3 列の高さ | バラバラ | 等高（QR 基準） | `lg:items-stretch` + 各列 `h-full` |
| sticky 挙動 | 左右 `aside` が `lg:sticky lg:top-4` | sticky 廃止 | 等高化と両立しないため。Phase 4.11 で確立した「投影前提・スクロールしない」運用なら問題なし |
| TimerDisplay 残時間 | `lg:text-9xl` (8rem) | `lg:text-[10rem] lg:leading-none` (10rem) | 等高で生まれた余白の埋め用 |
| TimerDisplay SB/BB/Ante | `md:text-4xl` | `md:text-4xl lg:text-5xl` | 同上 |
| TimerDisplay BREAK | `md:text-3xl` | `md:text-3xl lg:text-4xl` | 同上 |
| NextBreakCard タイトル | `text-xs uppercase tracking-wide text-muted-foreground` | `text-base md:text-lg font-semibold text-foreground` | 「黒字」要件 → `text-foreground`（OKLCH トークン）でテーマ追従 |
| NextBreakCard 値 | `text-2xl` | `text-3xl md:text-4xl` | 等高で余白を持つため拡大 |
| AverageStackCard タイトル | 同上の muted 系 | `text-base md:text-lg font-semibold text-foreground` | 同上 |
| AverageStackCard 値 | `text-3xl` | `text-4xl md:text-5xl` | 同上 |
| PlayersCard タイトル | 同上の muted 系 | `text-base md:text-lg font-semibold text-foreground` | 同上 |
| PlayersCard 値 | active `text-3xl` / total `text-xl` | active `text-4xl md:text-5xl` / total `text-2xl md:text-3xl` | "/" 区切りは muted 維持 |
| Dashboard 中央列の Winner / Structure / SeatingBoard 等 | 上段 grid 内 | 上段 grid の**外**（下段セクションへ移動） | 中央列の縦伸長を断ち切り、等高 grid を綺麗に保つ |
| 中央列が空（`isMember=false`）時 | `<TimerDisplay />` のみ | 同左 + `flex-1 justify-center` で上下中央 | 一般メンバー視点でも上下対称に表示 |
| state=`setup` / `seating` 時の右列 | 3 カードがすべて `null` 返却で空 aside | 右列 aside ごと条件付き非表示 + grid を 2 列に縮退 | 空セルが QR 高で stretch されて間延びするのを防ぐ |
| `卓` 表示（user-facing） | 全箇所 | 全箇所 `Table` に統一（コード内コメントは日本語維持） | 後述 "卓 → Table マッピング表" 参照 |
| description: `${N}卓${M}席 → ${P}卓${Q}席` | `1卓1席 → 2卓6席` | `Table 1 / 席 1 → Table 2 / 席 6` | "席" は維持（live の `Table` / `No.` レイアウトと整合） |
| `/live` ページ | 変更なし | 変更なし | 範囲外。live は既に Table 表記 |

### "卓 → Table" マッピング表

| 箇所 | Before | After |
| ---- | ------ | ----- |
| [dashboard-client.tsx:231](src/app/tournaments/[tid]/dashboard-client.tsx#L231)（既存ヘッダー説明） | `... / 1 卓 {seatsPerTable} 席` | `... / 1 Table {seatsPerTable} 席` |
| [dashboard-client.tsx:325](src/app/tournaments/[tid]/dashboard-client.tsx#L325)（CardTitle） | `卓 / 席` | `Table List` ✓ **既に unstaged で変更済み**（Plan は本変更を「保持」する） |
| [SeatingBoard.tsx:68](src/components/tournament/SeatingBoard.tsx#L68) | `卓 {table.tableNum}（{N} 人）` | `Table {table.tableNum}（{N} 人）` |
| [BalancingInstructionCard.tsx:56](src/components/tournament/BalancingInstructionCard.tsx#L56) | `卓 ${brokenTableNum} を閉鎖（${N} 名移動）` | `Table ${brokenTableNum} を閉鎖（${N} 名移動）` |
| [TournamentForm.tsx:111](src/components/tournament/TournamentForm.tsx#L111)（バリデーションエラー） | `validation/seats: 1 卓あたりの席数は 2〜10 で入力してください` | `validation/seats: 1 Table あたりの席数は 2〜10 で入力してください` |
| [TournamentForm.tsx:162](src/components/tournament/TournamentForm.tsx#L162)（Label） | `1 卓あたりの席数` | `1 Table あたりの席数` |
| [TournamentForm.tsx:173](src/components/tournament/TournamentForm.tsx#L173)（補足説明） | `NLH 標準は 9 席。最大 6 卓 × {N} 席 = {M} 人まで対応します。` | `NLH 標準は 9 席。最大 6 Tables × {N} 席 = {M} 人まで対応します。` |
| [orchestrator.ts:148](src/lib/services/seating/orchestrator.ts#L148)（エラー: テーブル数超過） | `テーブル数の上限（${e.max} 卓）を超えました...` | `テーブル数の上限（${e.max} Tables）を超えました...` |
| [orchestrator.ts:157](src/lib/services/seating/orchestrator.ts#L157)（エラー: 席数不正） | `1 卓あたり席数の値が不正です: ${e.seatsPerTable}` | `1 Table あたり席数の値が不正です: ${e.seatsPerTable}` |
| [orchestrator.ts:397](src/lib/services/seating/orchestrator.ts#L397)（移動 description） | `${move.from.tableNum}卓${move.from.seatNum}席 → ${move.to.tableNum}卓${move.to.seatNum}席` | `Table ${move.from.tableNum} / 席 ${move.from.seatNum} → Table ${move.to.tableNum} / 席 ${move.to.seatNum}` |
| [orchestrator.ts:517](src/lib/services/seating/orchestrator.ts#L517)（閉鎖 description） | `卓 ${plan.brokenTableNum} を閉鎖（${plan.moves.length} 名移動）` | `Table ${plan.brokenTableNum} を閉鎖（${plan.moves.length} 名移動）` |
| [orchestrator.test.ts:432](src/lib/services/seating/orchestrator.test.ts#L432)（テスト assertion） | `expect(result.description).toBe("1卓1席 → 2卓6席");` | `expect(result.description).toBe("Table 1 / 席 1 → Table 2 / 席 6");` |
| [orchestrator.test.ts:559](src/lib/services/seating/orchestrator.test.ts#L559)（テスト assertion） | `expect(result.description).toContain("卓 2 を閉鎖");` | `expect(result.description).toContain("Table 2 を閉鎖");` |

**コメント / 内部 docstring の "卓" は対象外**（[engine.ts](src/lib/services/seating/engine.ts) の TDA ルール解説、[engine.test.ts](src/lib/services/seating/engine.test.ts) の `it("18 人 × 9 席 = 2 卓に均等配置", ...)` などの test name、[repositories/tables.ts](src/lib/firebase/repositories/tables.ts) の docstring、[repositories/players.ts:178](src/lib/firebase/repositories/players.ts#L178)、[SeatingBoard.tsx:19-23](src/components/tournament/SeatingBoard.tsx#L19-L23) の component docstring 等）。理由:
- ユーザー要望は **UI（画面に出る文字）** の用語統一であり、内部メモまで英語化すると保守者の読み下しコストが増える
- TDA のルール本体は日本語フォーラム由来の語彙が多く、コメント上の "卓" は意味検索の手がかりになっている
- engine.test.ts の `it()` 文字列を変えると差分が膨れ、レビューコストが値しない

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [src/app/tournaments/[tid]/dashboard-client.tsx](src/app/tournaments/[tid]/dashboard-client.tsx) | 220-378 | 上段 grid 再構成のメイン + ヘッダー文言修正 |
| P0 | [src/components/qr/QrPanel.tsx](src/components/qr/QrPanel.tsx) | 全 | className prop 追加（h-full 注入用） |
| P0 | [src/components/tournament/TimerDisplay.tsx](src/components/tournament/TimerDisplay.tsx) | 全 | フォントサイズ拡大（残時間 / SB/BB/Ante / BREAK） |
| P0 | [src/components/tournament/NextBreakCard.tsx](src/components/tournament/NextBreakCard.tsx) | 全 | タイトル / 値スタイル更新 |
| P0 | [src/components/tournament/AverageStackCard.tsx](src/components/tournament/AverageStackCard.tsx) | 全 | タイトル / 値スタイル更新 |
| P0 | [src/components/tournament/PlayersCard.tsx](src/components/tournament/PlayersCard.tsx) | 全 | タイトル / 値スタイル更新 |
| P0 | [src/components/tournament/SeatingBoard.tsx](src/components/tournament/SeatingBoard.tsx) | 60-75 | 卓 → Table の `<CardTitle>` 文言置換 |
| P0 | [src/components/tournament/BalancingInstructionCard.tsx](src/components/tournament/BalancingInstructionCard.tsx) | 50-65 | description 内の `卓` → `Table` 置換（**注**: 同箇所は orchestrator から渡される description を再構築している。orchestrator 側の rename と整合させる） |
| P0 | [src/components/tournament/TournamentForm.tsx](src/components/tournament/TournamentForm.tsx) | 105-180 | エラー / Label / 補足の "卓" → "Table" |
| P0 | [src/lib/services/seating/orchestrator.ts](src/lib/services/seating/orchestrator.ts) | 145-160, 390-525 | description / エラー文言の rename + テストとの整合 |
| P0 | [src/lib/services/seating/orchestrator.test.ts](src/lib/services/seating/orchestrator.test.ts) | 425-435, 555-565 | description assertion 2 件の更新 |
| P1 | [src/components/ui/card.tsx](src/components/ui/card.tsx) | 全 | `Card` の className マージ確認（既に対応済み） |
| P1 | [src/components/tournament/TimerControls.tsx](src/components/tournament/TimerControls.tsx) | 184-289 | 中央列の最下端配置確認・サイズは変えない |
| P1 | [src/app/tournaments/[tid]/live/live-client.tsx](src/app/tournaments/[tid]/live/live-client.tsx) | 217-235 | 既に `<dt>Table</dt>` を使用していることを確認（Dashboard rename の参考） |
| P2 | [src/components/tournament/AverageStackCard.test.tsx](src/components/tournament/AverageStackCard.test.tsx) | 全 | ラベル文字列維持（"Average Stack" は変更なし） |
| P2 | [src/components/tournament/NextBreakCard.test.tsx](src/components/tournament/NextBreakCard.test.tsx) | 全 | ラベル文字列維持（"Next Break In" は変更なし） |
| P2 | [src/components/tournament/PlayersCard.test.tsx](src/components/tournament/PlayersCard.test.tsx) | 全 | ラベル文字列維持（"Players" は変更なし） |
| P2 | [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) | 200-230 | Implementation Phases 表に Phase 4.12 を追加（本 Plan 完了時の更新対象） |
| P2 | [.claude/rules/firebase-patterns.md](.claude/rules/firebase-patterns.md) | 全 | 変更影響なし（schema / rules 不変）であることを確認 |
| P2 | [.claude/rules/error-logging.md](.claude/rules/error-logging.md) | 全 | エラー文言の文言変更のみ。`AppError` 構造は不変であることを確認 |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Tailwind 任意値フォントサイズ | [Tailwind: Font Size > Arbitrary values](https://tailwindcss.com/docs/font-size#arbitrary-values) | `text-[10rem]` で `text-9xl`（8rem）超のサイズが指定可能。`leading-none` も併記推奨 |
| CSS Grid `align-items: stretch` | [MDN: align-items](https://developer.mozilla.org/en-US/docs/Web/CSS/align-items) | grid の子に対して既定 `stretch`。明示するときは `items-stretch`。`self-start` を子側に書くとオプトアウト |
| Tailwind theme tokens（OKLCH） | [Tailwind v4: Theme variables](https://tailwindcss.com/docs/theme) | `text-foreground` はライトテーマで黒に近いトークン、ダークテーマで白に近いトークンに自動解決 |

---

## Patterns to Mirror

### NAMING_CONVENTION

```tsx
// SOURCE: src/components/tournament/AverageStackCard.tsx:1-7
"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
```

### CLASSNAME_MERGE_WITH_DEFAULT

```tsx
// SOURCE: src/components/tournament/TimerDisplay.tsx:55-62
<section
  aria-label="タイマー"
  className={cn(
    "flex flex-col items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground",
    className,
  )}
>
```

呼び出し側から `flex-1 justify-center` を注入する経路がこの形で確保される。

### TABLE_RENAME_SCHEMA_PRESERVE

```ts
// SOURCE: src/lib/firebase/schemas/table.ts (現状)
// → スキーマフィールド名は tableNum / seatNum のまま（英語）。
//   表示文字列のみ Table と書く。型・schema 名は触らない。
```

スキーマ識別子（`tableNum` / `seatNum` / `tables` collection 名）は英語のため**変更不要**。あくまで「画面に出る文字列」のみ rename。

### ERROR_HANDLING（変更なし）

```ts
// SOURCE: src/lib/services/seating/orchestrator.ts:144-160
} catch (e) {
  if (e instanceof MaxTablesExceededError) {
    throw new AppError(
      "tournament/seating-too-many-tables",
      `テーブル数の上限（${e.max} 卓）を超えました。seatsPerTable を増やして再度お試しください。`,
    );
  }
  ...
}
```

`AppError` のドメインコード（`tournament/seating-too-many-tables`）は不変。message 内の "卓" のみを "Tables" に置換。[error-logging.md](.claude/rules/error-logging.md) の規約は維持。

### TEST_STRUCTURE

```ts
// SOURCE: src/lib/services/seating/orchestrator.test.ts:432
expect(result.description).toBe("1卓1席 → 2卓6席");
// → 本 Plan で "Table 1 / 席 1 → Table 2 / 席 6" に更新
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/app/tournaments/[tid]/dashboard-client.tsx](src/app/tournaments/[tid]/dashboard-client.tsx) | UPDATE | 上段 grid 再構成 + ヘッダー説明 "1 卓" → "1 Table" |
| [src/components/qr/QrPanel.tsx](src/components/qr/QrPanel.tsx) | UPDATE | className prop を受け取り Card に渡す |
| [src/components/tournament/TimerDisplay.tsx](src/components/tournament/TimerDisplay.tsx) | UPDATE | 残時間 / SB・BB・Ante / BREAK のフォントサイズ拡大 |
| [src/components/tournament/NextBreakCard.tsx](src/components/tournament/NextBreakCard.tsx) | UPDATE | タイトル / 値スタイル更新 |
| [src/components/tournament/AverageStackCard.tsx](src/components/tournament/AverageStackCard.tsx) | UPDATE | タイトル / 値スタイル更新 |
| [src/components/tournament/PlayersCard.tsx](src/components/tournament/PlayersCard.tsx) | UPDATE | タイトル / 値スタイル更新 |
| [src/components/tournament/SeatingBoard.tsx](src/components/tournament/SeatingBoard.tsx) | UPDATE | `卓 {tableNum}` → `Table {tableNum}` |
| [src/components/tournament/BalancingInstructionCard.tsx](src/components/tournament/BalancingInstructionCard.tsx) | UPDATE | description 中の `卓` → `Table` |
| [src/components/tournament/TournamentForm.tsx](src/components/tournament/TournamentForm.tsx) | UPDATE | バリデーションエラー / Label / 補足の `卓` → `Table` |
| [src/lib/services/seating/orchestrator.ts](src/lib/services/seating/orchestrator.ts) | UPDATE | description / エラー文言の `卓` → `Table` |
| [src/lib/services/seating/orchestrator.test.ts](src/lib/services/seating/orchestrator.test.ts) | UPDATE | description assertion 2 件を新フォーマットに |
| [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) | UPDATE | Implementation Phases 表に Phase 4.12 行を追加（status: in-progress、本 Plan へリンク） |

## NOT Building

- **`/live` ページのレイアウト変更**: 要件 #2 の「再生ボタン群」が `/live` に存在しないため対象外。
- **モバイル（`lg` 未満）の等高化**: 縦 1 カラム積み上げ維持。フォントサイズ変更のみ反映。
- **sticky 追従の代替実装**: 等高化との両立は CSS 上不自然なため捨てる判断（前述）。
- **コード内コメント / 内部 docstring の "卓" 置換**: engine.ts / engine.test.ts の TDA 解説、repositories の docstring、SeatingBoard の component docstring 等は日本語維持（保守用語の意味検索性を優先）。
- **schema / Firestore Rules / repository 関数シグネチャ変更**: ゼロ。`tableNum` / `tables` collection 名・`AppError` ドメインコードはすべて不変。
- **新規 hook / service / repository 追加**: ゼロ。
- **Card 全般のヘッダー追加**: 統計 3 カードは既存どおり `CardHeader` 不使用（`CardContent` 内の div をタイトル相当として使う）。
- **タイトル翻訳変更**: "Next Break In" / "Average Stack" / "Players" は Phase 4.11 で確定済み。本 Plan ではサイズ・色のみ調整。
- **ダーク / ライトテーマ token 拡張**: `text-foreground` の OKLCH 値そのものは触らない。

---

## Step-by-Step Tasks

### Task 1: PRD に Phase 4.12 を追加

- **ACTION**: [.claude/PRPs/prds/allin-timer.prd.md](.claude/PRPs/prds/allin-timer.prd.md) の Implementation Phases 表に Phase 4.12 行を挿入し、Phase Details セクションに詳細を追記、Parallelism Notes も更新
- **IMPLEMENT**:
  - 表に 1 行追加（4.11 と 5 の間）:
    ```
    | 4.12 | Dashboard Top-Row Equal-Height & Table Rename | Phase 4.11 後の追加フォローアップ。Dashboard 上段 3 セット（QR / Timer+Controls / 統計 3 カード）の等高化、統計カードのタイトル拡大＋本文色化、user-facing 文言「卓 → Table」一括リネーム。schema / Firestore Rules / hook 不変 | in-progress | with 4.10 | 4.11 | [phase-4.12-dashboard-polish-and-table-rename.plan.md](../plans/phase-4.12-dashboard-polish-and-table-rename.plan.md) |
    ```
  - Phase Details に "Phase 4.12: Dashboard Top-Row Equal-Height & Table Rename" の節を追加（Goal / 背景 / Scope / Success signal）
  - Phase 5 行の Depends を `3, 4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.11, 4.12` に更新
  - Parallelism Notes に「Phase 4.12 は Phase 4.11 完了後に単独実施。schema / rule 不変。Phase 4.10 とは独立で並行可能」を追加
- **MIRROR**: PRD 既存表記（Phase 4.11 行）
- **VALIDATE**: PRD diff で Phase 4.12 行が追加され、表が markdown table として valid に保たれること

### Task 2: QrPanel に className prop を追加

- **ACTION**: `QrPanel` が外部から className を受け取り `Card` に渡せるようにする
- **IMPLEMENT**:
  ```tsx
  // src/components/qr/QrPanel.tsx
  export function QrPanel({ tid, className }: { tid: string; className?: string }) {
    ...
    return (
      <Card className={className}>
        ...
      </Card>
    );
  }
  ```
- **MIRROR**: [StructureSnapshotCard.tsx:26-28](src/components/tournament/StructureSnapshotCard.tsx#L26-L28) の className passthrough
- **GOTCHA**: Card 内部で既に `cn(...)` でユーザー className を後置きマージしているため呼び出し側はそのまま渡すだけで OK
- **VALIDATE**: `<QrPanel tid="t1" className="h-full" />` で DevTools 上 Card に `h-full` が乗ること

### Task 3: 統計 3 カード（Next Break / Avg Stack / Players）のタイトル＆値スタイル更新

- **ACTION**: 3 カードでタイトル div と値 div のクラスを次のとおりに置換（既に className prop は受領済みのため Card 自体は変更不要）
- **IMPLEMENT**（NextBreakCard 例）:
  ```tsx
  // 変更前
  <div className="text-xs uppercase tracking-wide text-muted-foreground">
    Next Break In
  </div>
  ...
  <div className="font-mono text-2xl font-bold tabular-nums text-foreground">
    {formatEta(info.etaMs)}
  </div>

  // 変更後
  <div className="text-base md:text-lg font-semibold text-foreground">
    Next Break In
  </div>
  ...
  <div className="font-mono text-3xl md:text-4xl font-bold tabular-nums text-foreground">
    {formatEta(info.etaMs)}
  </div>
  ```
- **IMPLEMENT**（AverageStackCard）: タイトル同パターン。値 → `text-4xl md:text-5xl`。
- **IMPLEMENT**（PlayersCard）: タイトル同パターン。active 値 → `text-4xl md:text-5xl`。"/" と total → `text-2xl md:text-3xl`。
- **MIRROR**: RESPONSIVE_FONT_SIZE（TimerDisplay.tsx:73-74）
- **GOTCHA**: 「黒字」要件は `text-foreground`（OKLCH トークン）で実現。`text-black` 直指定はダークモードを壊すため避ける（[Tailwind v4: Theme variables](https://tailwindcss.com/docs/theme)）。NextBreakCard の Break 中表示（amber 系）は維持。
- **VALIDATE**: `pnpm vitest run src/components/tournament/{NextBreakCard,AverageStackCard,PlayersCard}.test.tsx` で既存テスト pass

### Task 4: TimerDisplay のフォントサイズ拡大

- **ACTION**: 残時間 / SB/BB/Ante / BREAK の `lg:` ブレイクポイントを 1 段大きく
- **IMPLEMENT**:
  ```tsx
  // 残時間 (line 73-75)
  className="font-mono text-7xl font-bold tabular-nums md:text-8xl lg:text-[10rem] lg:leading-none"

  // SB/BB/Ante (line 89-91)
  className="flex flex-wrap items-baseline justify-center gap-x-4 gap-y-1 text-3xl font-bold tabular-nums text-sky-700 dark:text-sky-300 md:text-4xl lg:text-5xl"

  // BREAK (line 84)
  className="flex items-center gap-2 text-2xl font-bold text-amber-700 dark:text-amber-400 md:text-3xl lg:text-4xl"
  ```
- **MIRROR**: 既存 RESPONSIVE_FONT_SIZE
- **GOTCHA**: `text-[10rem]` の line-height 既定が変動するリスクがあるため `lg:leading-none` を併記して 1.0 を明示
- **VALIDATE**: `pnpm vitest run src/components/tournament/TimerDisplay.test.tsx` pass。`pnpm dev` で `lg+` ブレイクポイントの表示確認

### Task 5: dashboard-client.tsx の上段 grid 再構成

- **ACTION**: 既存 grid を「等高 3 列の上段」と「下段（中央列の残り）」に分割。state による右列出し分けも入れる
- **IMPLEMENT**:
  ```tsx
  // 変更前 (line 271-308) は丸ごと差し替え

  const showRightColumn = data.state === "running" || data.state === "paused";
  const gridColsClass = showRightColumn
    ? "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]"
    : "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]";

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-8 lg:max-w-7xl">
      {/* ... header / error 部分は既存維持 ... */}

      {/*
        上段 — 等高 3 列。lg+ で QR / タイマー+操作 / 統計 3 カードを同じ高さに揃える。
        最も背の高い QrPanel を基準に他 2 列が伸びる。
        sticky は等高化と両立しないため廃止（Phase 4.11 までは sticky だった）。
        state=setup/seating では右列を非表示にし grid を 2 列に縮退する。
        trace: phase-4.12-dashboard-polish-and-table-rename.plan.md
      */}
      <div className={`grid grid-cols-1 gap-4 ${gridColsClass} lg:items-stretch`}>
        <aside className="order-3 lg:order-1">
          <QrPanel tid={tid} className="h-full" />
        </aside>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <TimerDisplay
            tournament={data}
            remainingMs={remainingMs}
            levelInfo={levelInfo}
            className="flex-1 justify-center"
          />
          {isMember ? (
            <TimerControls
              tid={tid}
              uid={user.uid}
              userGroupIds={groupIds}
              tournament={data}
              players={players}
              audio={
                tournamentGroup
                  ? {
                      enabled: tournamentGroup.audioSettings.enabled,
                      unlocked: audioPlayer.unlocked,
                      onUnlock: audioPlayer.unlock,
                      settingsHref: `/groups/${tournamentGroup.id}/audio-settings?from=tournament&tid=${tid}`,
                    }
                  : undefined
              }
              onError={setError}
            />
          ) : null}
        </div>

        {showRightColumn ? (
          <aside className="order-2 grid grid-rows-[repeat(3,minmax(0,1fr))] gap-3 lg:order-3">
            <NextBreakCard tournament={data} remainingMs={remainingMs} className="h-full" />
            <AverageStackCard tournament={data} players={players} className="h-full" />
            <PlayersCard tournament={data} players={players} className="h-full" />
          </aside>
        ) : null}
      </div>

      {/* 下段 — 上段から外したコンテンツ。等高 grid の高さに影響しない。 */}
      {winner ? <WinnerBanner winner={winner} /> : null}

      {/* ... 既存の {showBalancing ? ... } / {showSeatingBoard ? ... } / PlayerList / StructureSnapshotCard / Dialog はそのまま下に並べる ... */}
    </main>
  );
  ```
  - **ヘッダー説明**（line 230-232）の `1 卓 {data.seatsPerTable} 席` も `1 Table {data.seatsPerTable} 席` に置換
- **MIRROR**: 既存 grid 命名（`order-N` / `lg:order-N` / `gap-3` / `gap-4`）
- **GOTCHA**:
  - 右 `aside` から `lg:sticky lg:top-4 lg:self-start` を**削除**。`self-start` を残すと `align-items: stretch` がオプトアウトされる
  - 右 `aside` を `flex flex-col` ではなく **`grid grid-rows-[repeat(3,minmax(0,1fr))]`** に変更。Flex `flex-1` だと内容極小時に親高に対して 1/3 に揃わないケースが出る
  - WinnerBanner を grid 外に移すと中央列幅 → `<main>` 全幅に変わる。視覚的には優勝演出として違和感なし。気になる場合は `mx-auto max-w-2xl` 追加検討（本 Plan のスコープ外）
  - `setup` / `seating` 時の右列ガード忘れに注意（3 カードは個別に null を返すが、aside だけが残ると空セルになる）
- **VALIDATE**:
  - `pnpm dev` → `/tournaments/{tid}` を開き、`lg` 幅で 3 列の `offsetHeight` 一致を DevTools で確認
  - `state=setup` / `running` / `paused` / `finished` 各状態で右列の表示・非表示・grid-cols 切替を目視確認
  - モバイル（375px / 768px）で 1 カラム積み上げ + `order-1/2/3` の順で表示

### Task 6: SeatingBoard.tsx の "卓" → "Table" 置換

- **ACTION**: [SeatingBoard.tsx:68](src/components/tournament/SeatingBoard.tsx#L68) の表示文字列のみ置換
- **IMPLEMENT**:
  ```tsx
  // 変更前
  卓 {table.tableNum}（{tableSeated.length} 人）
  // 変更後
  Table {table.tableNum}（{tableSeated.length} 人）
  ```
- **MIRROR**: マッピング表
- **GOTCHA**: ファイル先頭の component docstring（line 19-23）は日本語維持
- **VALIDATE**: `pnpm vitest run` で SeatingBoard 関連テストが通ること（テストが文字列依存なら `data-testid` で吸収）

### Task 7: BalancingInstructionCard.tsx の "卓" → "Table" 置換

- **ACTION**: [BalancingInstructionCard.tsx:56](src/components/tournament/BalancingInstructionCard.tsx#L56) の description 表示部分の置換
- **IMPLEMENT**:
  ```tsx
  // 変更前
  description: `卓 ${breakPlan.brokenTableNum} を閉鎖（${breakPlan.moves.length} 名移動）`,
  // 変更後
  description: `Table ${breakPlan.brokenTableNum} を閉鎖（${breakPlan.moves.length} 名移動）`,
  ```
- **GOTCHA**: 同コンポーネントは orchestrator から渡される description を再構築する経路と独自構築する経路が混在している可能性あり。両方の文字列を一致させる
- **VALIDATE**: 関連テストがあれば pass、なければ `pnpm dev` で目視確認

### Task 8: TournamentForm.tsx の "卓" → "Table" 置換

- **ACTION**: 3 箇所（バリデーションエラー / Label / 補足）の置換
- **IMPLEMENT**:
  ```tsx
  // line 111 (error)
  setError("validation/seats: 1 Table あたりの席数は 2〜10 で入力してください");

  // line 162 (label)
  <Label htmlFor="t-seats">1 Table あたりの席数</Label>

  // line 173 (description)
  NLH 標準は 9 席。最大 6 Tables × {seatsPerTable} 席 = {6 * seatsPerTable} 人まで対応します。
  ```
- **GOTCHA**: バリデーションエラーは AppError ドメインコード（`validation/seats:` プレフィックス）は維持。"卓" の置換のみ
- **VALIDATE**: `pnpm dev` でフォームを開き、Label と補足説明、エラーメッセージ（席数 1 や 11 を入力）が新表記になっていること

### Task 9: orchestrator.ts の description / エラー文言の置換 + テスト更新

- **ACTION**: [orchestrator.ts](src/lib/services/seating/orchestrator.ts) の 4 箇所と test 2 箇所を一括更新
- **IMPLEMENT**:
  ```ts
  // line 148 (error: too many tables)
  `テーブル数の上限（${e.max} Tables）を超えました。seatsPerTable を増やして再度お試しください。`

  // line 157 (error: invalid seatsPerTable)
  `1 Table あたり席数の値が不正です: ${e.seatsPerTable}`

  // line 397 (move description)
  const desc = `Table ${move.from.tableNum} / 席 ${move.from.seatNum} → Table ${move.to.tableNum} / 席 ${move.to.seatNum}`;

  // line 517 (break description)
  const desc = `Table ${plan.brokenTableNum} を閉鎖（${plan.moves.length} 名移動）`;
  ```
  ```ts
  // orchestrator.test.ts:432
  expect(result.description).toBe("Table 1 / 席 1 → Table 2 / 席 6");

  // orchestrator.test.ts:559
  expect(result.description).toContain("Table 2 を閉鎖");
  ```
- **MIRROR**: TEST_STRUCTURE
- **GOTCHA**:
  - description フォーマットが `${X}卓${Y}席` から `Table X / 席 Y` に変わる。**スペースの有無を含めてテストと完全一致**させる
  - `AppError` ドメインコードは不変（`tournament/seating-too-many-tables` 等）。文言のみ
  - 既存ログ出力（`logger.info` / `logger.warn`）の format string も "卓" を含む場合は同期して更新（`grep -n "卓" src/lib/services/seating/` で残存確認）
- **VALIDATE**:
  - `pnpm vitest run src/lib/services/seating/` で orchestrator + engine のテスト suite が完全 green
  - `grep` で seating/ 配下の user-facing 文字列に "卓" が残らないことを確認（コメント・engine.ts の TDA 解説は許容）

### Task 10: dashboard-client.tsx ヘッダー説明 "1 卓" → "1 Table" 置換

- **ACTION**: [dashboard-client.tsx:230-232](src/app/tournaments/[tid]/dashboard-client.tsx#L230-L232) の header description を置換
- **IMPLEMENT**:
  ```tsx
  // 変更前
  現在 Lv{data.currentLevel} / 締切 Lv{data.lateEntryDeadlineLevel} /{" "}
  {data.structureSnapshot.levels.length} レベル / 1 卓 {data.seatsPerTable} 席

  // 変更後
  現在 Lv{data.currentLevel} / 締切 Lv{data.lateEntryDeadlineLevel} /{" "}
  {data.structureSnapshot.levels.length} レベル / 1 Table {data.seatsPerTable} 席
  ```
- **GOTCHA**: 既に line 325 の `<CardTitle>Table List</CardTitle>` が unstaged で変更済みのため、本 Task で新たな差分を入れた際に**両方を 1 commit に含める**ようにする
- **VALIDATE**: `pnpm dev` で Dashboard ヘッダー表示が新表記であること

### Task 11: 検証 / 残存 "卓" の確認

- **ACTION**: 全変更後に `Grep` で user-facing 文字列の "卓" 残存をチェック
- **IMPLEMENT**:
  ```bash
  # コメント/docstring 以外の "卓" を検出（user-facing 候補）
  pnpm grep -- '"[^"]*卓[^"]*"' src/components src/app
  pnpm grep -- "'[^']*卓[^']*'" src/components src/app
  pnpm grep -- '`[^`]*卓[^`]*`' src/components src/app src/lib/services
  ```
- **EXPECT**: マッチが 0 件、または engine.ts / engine.test.ts / repositories / seating の docstring（コメント）部分のみ
- **VALIDATE**: 上記が確認できれば、内部コメントの "卓" は意図的な維持として記録（本 Plan の NOT Building に該当）

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| NextBreakCard ラベル | running tournament | `getByText("Next Break In")` ヒット | No（既存維持）|
| NextBreakCard 値（数値レベル） | running, levelsAhead=2 | `formatEta` 値が描画 | No |
| AverageStackCard 値 | 20 entries / 5 active / 10000 stack | `getByText("40,000")` | No |
| PlayersCard 値 | 5 active / 20 total | active=5 / total=20 が描画 | No |
| TimerDisplay 残時間 | remainingMs=125000 | `02:05` が描画 | No |
| TimerDisplay BREAK | current.isBreak=true | `BREAK` テキスト + ☕ icon | No |
| QrPanel className | `<QrPanel tid="t1" className="h-full" />` | Card root に `h-full` クラスが乗る | Yes（新規 prop）|
| orchestrator: balance move desc | a1 を移動 | `description` が `Table 1 / 席 1 → Table 2 / 席 6` | Yes（フォーマット変更）|
| orchestrator: break desc | 卓 2 閉鎖 | `description` が `Table 2 を閉鎖（...）` を含む | Yes（フォーマット変更）|

### Edge Cases Checklist

- [ ] `lg` 未満（モバイル）で 1 カラム表示が崩れない（順序 / `gap-4` 維持）
- [ ] `lg` 以上で 3 列高さ完全一致（state=running/paused）
- [ ] `state=setup` / `seating` で右列 aside が非表示、grid が 2 列に縮退
- [ ] `state=finished` でも 2 列レイアウト + 終了済みバナー
- [ ] `winner` が出現しても上段 grid 高さが変動しない（下段 WinnerBanner で表示）
- [ ] `isMember=false`（一般メンバー）で TimerControls 非表示でも中央列が等高に伸びる
- [ ] ライト / ダーク両テーマで右カードのタイトルが正しい色（ライト=黒、ダーク=白）で描画
- [ ] orchestrator description / error 文字列の "卓" がすべて "Table" になり、テスト assertion と完全一致
- [ ] BalancingInstructionCard の表示が "Table N を閉鎖" になる
- [ ] SeatingBoard の卓カードヘッダーが "Table N（M 人）" になる

---

## Validation Commands

### Static Analysis

```bash
pnpm typecheck
```
EXPECT: 0 errors

```bash
pnpm lint
```
EXPECT: 0 errors / 0 warnings

### Unit Tests

```bash
pnpm vitest run
```
EXPECT: 既存テスト全件 pass。orchestrator description テスト 2 件が新フォーマットで pass。QrPanel className テスト（新規追加 1 件）が pass。

### Browser Validation

```bash
pnpm dev
```
- [ ] Dashboard `lg` 幅: 上段 3 列の `offsetHeight` がピクセル単位で一致
- [ ] state 切替（setup → seating → running → paused → finished）で右列の出し入れと grid-cols 切替が動作
- [ ] モバイル幅 (375px / 768px) で 1 カラム積み上げ
- [ ] 統計 3 カードのタイトルが `text-base/lg`、`text-foreground`（黒/白）
- [ ] `/tournaments/new` フォームで Label / 補足 / バリデーションエラーが "Table" 表記
- [ ] バランシング発動時の指示カードが "Table N を閉鎖（M 名移動）" / "Table P / 席 Q → Table R / 席 S"
- [ ] SeatingBoard の卓カードヘッダーが "Table N（M 人）"
- [ ] `/live` ページが**変更なし**（diff なし）であることを目視確認

### Manual Validation

- [ ] sticky 廃止後のスクロール挙動が「投影前提」運用と整合（QR が画面外に流れることへの違和感確認）
- [ ] orchestrator から throw される `AppError` のメッセージが UI に出ても "Tables" 表記
- [ ] PRD の Implementation Phases 表に Phase 4.12 行が追加され、Phase 5 の Depends に 4.12 が含まれる

---

## Acceptance Criteria

- [ ] `/tournaments/{tid}` の上段 3 列が `lg` で同じ高さに揃う（QR 基準）
- [ ] state による右列の出し入れ + grid-cols 切替が機能
- [ ] TimerDisplay の残時間 / SB・BB・Ante / BREAK が拡大
- [ ] NextBreakCard / AverageStackCard / PlayersCard のタイトルが大きく / `text-foreground`、値テキストも 1 段拡大
- [ ] user-facing 文字列の "卓" がすべて "Table" にリネーム済み（コメント・docstring は除外）
- [ ] orchestrator description / error 文字列のテスト assertion と実装が完全一致
- [ ] 既存 unit テスト全件 pass + 新規 1 件（QrPanel className）pass
- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm test` がすべて green
- [ ] PRD Implementation Phases 表に Phase 4.12 行が追加され、Phase Details / Parallelism Notes も更新
- [ ] `/live` ページは無変更（diff なし）

## Completion Checklist

- [ ] 既存パターン（CLASSNAME_MERGE / RESPONSIVE_FONT_SIZE / TABLE_RENAME_SCHEMA_PRESERVE）に忠実
- [ ] [error-logging.md](.claude/rules/error-logging.md) / [firebase-patterns.md](.claude/rules/firebase-patterns.md) の規約に違反なし
- [ ] hook / Effect / state の追加なし
- [ ] schema / Firestore Rules / repository 関数シグネチャ不変
- [ ] AppError ドメインコード不変（文言のみ変更）
- [ ] PRD Implementation Phases 表 / Phase Details / Parallelism Notes 更新済み
- [ ] CLAUDE.md / `.claude/rules/*` への変更不要を確認

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `lg:text-[10rem]` の line-height 計算が崩れる | Low | Medium | `lg:leading-none` 併記 |
| state=`setup`/`seating` で右列が空の grid セル | Medium | Medium | `showRightColumn` 分岐 + `grid-cols` 動的切替で 2 列に縮退（Task 5） |
| sticky 廃止で運用上の不満（参加者向け QR が見切れる） | Medium | Low | Phase 4.11 で投影前提（スクロールしない）の運用が確立済み。問題が出たら sticky 復活 / 等高化を諦める判断 |
| orchestrator description のフォーマット差異がテスト未捕捉で UI に出る | Low | Medium | `pnpm vitest run src/lib/services/seating/` で description 系テストを最初に確実に通す |
| WinnerBanner が下段全幅に伸びて意図と違う見た目になる | Low | Low | 必要なら `mx-auto max-w-2xl` 追加（Plan 外） |
| 等高化で TimerDisplay が間延びして見える | Low | Low | `flex-1 justify-center` で上下中央寄せ + フォントサイズ 1 段拡大 |
| 内部コメントの "卓" 残存をユーザーが「全置換漏れ」と誤解 | Medium | Low | NOT Building セクションに明記。実装後の commit message にも「user-facing only」と書く |
| BalancingInstructionCard の独自構築 description と orchestrator description のフォーマット不一致 | Low | Medium | Task 7 / 9 で両方の出力箇所を grep で網羅し、フォーマット完全一致を確認 |
| ダークモードで `text-foreground` が想定外色に | Low | Low | OKLCH トークンで安定。手動目視確認 |

## Notes

- **Phase 番号の根拠**: PRD 既存 Phase は 1 → 2 → 2.5 → 3 → 4 → 4.5 → 4.6 → 4.7 → 4.8 → 4.9 → 4.10（pending・optional）→ 4.11（complete）→ 5。本変更は Phase 4.11 の純粋な follow-up であり、schema 変更を伴わないため Phase 4.12 として小さく追加するのが整合的。Phase 4.10（Custom Audio Upload, optional）とは独立で並行可能（互いに別領域）。
- **PRD 更新の自動化**: `/prp-plan` ワークフローでは「PRD 入力時に該当 Phase を pending → in-progress に更新」と規定されているが、本 Plan は **新規 Phase の追加**となる。Task 1 で表行を新設する形で対応。
- **「黒字」要件の解釈**: 厳密な `text-black` ではなく `text-foreground`（OKLCH トークン経由でテーマ追従）を採用。ライトモードで実質黒、ダークモードで実質白に解決される。`text-black` 直指定だとダーク背景に黒文字となり読めなくなる。
- **「一番大会ものに合わせて」の解釈**: 「一番**大き**いものに合わせて」と推測解釈し、最も背の高い QrPanel を等高基準とする。実装後にフィードバックがあれば QR 高ではなくタイマー高基準に切り替える選択肢もある。
- **commit 戦略**: 1 commit に下記をまとめる:
  - 上段 grid 再構成 + フォントサイズ拡大 + statistics card style update
  - "卓 → Table" rename（dashboard-client.tsx の unstaged 変更も同 commit に取り込む）
  - PRD Phase 4.12 追加
  - orchestrator test 更新
- 本 Plan 完了後は `/prp-implement <plan>` の流れで実装、その後 `.claude/PRPs/plans/completed/` 移動 + `.claude/PRPs/reports/phase-4.12-...-report.md` 作成。
