# Plan: Phase E — ポイント計算式の運営者カスタマイズ

## Summary

Phase A で固定パラメータ式（`base[rank-1] × sqrt(totalParticipants / baseline)`）として実装したシーズンポイント計算を、サークル運営者がパラメータ単位でカスタマイズできるようにする。`groups/{gid}.seasonPointsRule`（PRD で予約済の名称）を additive 追加し、`base: number[]`（1〜9 位の素点）と `baseline: number`（係数 1.0 になる参加人数、2〜10）の 2 パラメータのみ可変化する。式の構造（順位 × 平方根スケール）は不変、過去 `seasonStats` への遡及適用もしない。`null` 保存（または未設定）で既定値（`SEASON_POINTS_BASE = [10,7,5,3,1,1,1,1,1]` / `baseline = 8`）にフォールバック。`finishTournament` の runTransaction 内で `groups/{gid}` を tx 内 read してアトミックに rule を解決する。

## User Story

As a サークル運営者（owner / organizer）,
I want シーズンポイントの順位ごとの基本点と「係数 1.0 になる参加人数」を自分のサークルに合わせて変更できる,
So that 6 人開催が常態のサークルと 24 人開催が常態のサークルで、それぞれの感覚に合った重み付けで競える。

And as a サークル参加メンバー,
I want 現在のシーズンポイント計算ルールがランキング画面・サークル詳細から一目で見える,
So that 「なぜこの順位でこの点数なのか」を運営者に問い合わせる必要がない。

## Problem → Solution

**Current state**:

- Phase A 実装で `SEASON_POINTS_BASE = [10, 7, 5, 3, 1, 1, 1, 1, 1]` / `SEASON_POINTS_BASELINE_PARTICIPANTS = 8` が [src/lib/limits.ts:43-51](../../../../src/lib/limits.ts#L43-L51) にハードコード。
- PRD の Open Question に「6 人開催（係数 ≈ 0.87）と 24 人開催（係数 ≈ 1.73）の実感値を比較してパラメータの妥当性を検証する」と明記され、シーズン 1 周目の運営者ヒアリング後にカスタマイズ可能化が予定されていた（PRD line 53）。
- `groups/{gid}.seasonPointsRule` という名称が PRD line 36 と Phase A plan line 470 で「次フェーズ送り」として予約されている。

**Desired state**:

- 運営者がサークル詳細画面の「シーズンポイント計算ルール」カードから `base[1..N 位]`（最大 9 件）と `baseline`（2..10）を編集できる。
- 編集はアトミックに `groups/{gid}.seasonPointsRule` 単独書換で行い、他フィールドに副作用を出さない。
- `finishTournament` の tx 内で `groups/{gid}` を re-read し、保存された rule（または既定値）でポイントを計算する。
- 一般メンバーはルールを read のみ。owner / organizer のみ編集可。
- 「既定値に戻す」操作（`seasonPointsRule = null`）も owner / organizer にのみ許可。

## Metadata

- **Complexity**: Medium
- **Source PRD**: [.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md](../prds/02-season-stats-and-share.prd.md)
- **PRD Phase**: Phase E（PRD 内 Implementation Phases 表に新規追加）
- **Stage scope**: schema 1 件拡張 / repository 1 関数追加 / service 1 関数追加 / rule branch 1 件追加 / `finishTournament` tx 拡張（tx 内 group re-read + rule 取込）/ `calcSeasonPoints` 引数追加 / UI 1 Card 新設 / drift script 1 件追加 / docs 3 件更新
- **Estimated Files**: 約 14 files（schema 1 / repository 1 / service 1 / rules 1 / `tournaments.ts` 1 / `season-points.ts` 1 / 純関数 test 1 / repo test 1 / service test 1 / schema test 1 / UI 1 / drift script 1 / docs 3）

---

## UX Design

### Before（Phase A〜D 完了時点）

```
/groups/[gid]
┌──────────────────────────────────────────────────┐
│ [サタデーサークル]                               │
│ 開催数: 12 回                                    │
│ 1 Table あたりの席数（デフォルト）: 8 席         │
│ Table 名デフォルト: 赤卓 / 青卓 / 緑卓           │
│ シーズン                                         │
│   現在シーズン開始: 2026-04-01                   │
│   [ランキングを見る] [シーズンを開始する]        │
│ メンバー（5 人）                                 │
│ 招待コード …                                     │
└──────────────────────────────────────────────────┘

ポイント計算ルールはコード固定（運営者には不可視）。
6 人開催が常態のサークルでも 1 位が常に 10pt × √(6/8) ≈ 8.66pt で固定。
```

### After

```
/groups/[gid]
┌──────────────────────────────────────────────────────┐
│ [サタデーサークル]                                   │
│ ……                                                   │
│ シーズン                                             │
│   現在シーズン開始: 2026-04-01                       │
│   [ランキングを見る] [シーズンを開始する]            │
│                                                      │
│ シーズンポイント計算ルール                    ← 新規 │
│   ※ 現在は既定値が適用されています                  │
│                                                      │
│   計算式:                                            │
│     付与ポイント = 基本点(順位) × √(参加人数 ÷ 8)    │
│     ※ 参加人数 = 8（baseline）のとき係数 1.00、       │
│       人数が baseline より多いほどポイント増加       │
│                                                      │
│   基本点（順位ごと）:                                │
│     1 位 = 10 / 2 位 = 7 / 3 位 = 5 / 4 位 = 3       │
│     5 位 = 1 / 6 位 = 1 / 7 位 = 1 / 8 位 = 1        │
│     9 位 = 1                                         │
│   baseline（係数 1.0 となる人数）: 8 人              │
│                                                      │
│   参加人数別の付与ポイント目安:                      │
│   ┌──────┬─────┬─────┬──────┬──────┬──────┐        │
│   │ 順位 │ 6 人│ 8 人│ 12 人│ 16 人│ 24 人│        │
│   │      │×0.87│×1.00│×1.22 │×1.41 │×1.73 │        │
│   ├──────┼─────┼─────┼──────┼──────┼──────┤        │
│   │ 1 位 │8.66 │10.00│12.25 │14.14 │17.32 │        │
│   │ 2 位 │6.06 │ 7.00│ 8.57 │ 9.90 │12.12 │        │
│   │ 3 位 │4.33 │ 5.00│ 6.12 │ 7.07 │ 8.66 │        │
│   │ 4 位 │2.60 │ 3.00│ 3.67 │ 4.24 │ 5.20 │        │
│   │ …    │ …   │ …   │ …    │ …    │ …    │        │
│   └──────┴─────┴─────┴──────┴──────┴──────┘        │
│   ※ 同じ「1 位」でも参加人数が違うと付与ポイントが   │
│     変わります。難度が高い大人数開催ほど多く入ります│
│                                                      │
│   [編集する] (owner / organizer のみ)                │
│ メンバー（5 人）                                     │
└──────────────────────────────────────────────────────┘

「編集する」モーダル:
┌──────────────────────────────────────────────────────┐
│ シーズンポイント計算ルール                           │
│                                                      │
│  計算式:                                             │
│    付与ポイント = 基本点(順位) × √(参加人数 ÷ baseline)│
│                                                      │
│  順位 │ 基本点                                       │
│  1 位 │ [ 10 ]                                       │
│  2 位 │ [  7 ]                                       │
│  3 位 │ [  5 ]                                       │
│  4 位 │ [  3 ]                                       │
│  5 位 │ [  1 ]   [行を削除]                          │
│  [行を追加]（最大 9 行）                             │
│                                                      │
│  baseline（係数 1.0 となる人数）: [ 8 ] 人  (2〜10)  │
│                                                      │
│  プレビュー（入力中の値で計算）:                     │
│  ┌──────┬─────┬─────┬──────┬──────┬──────┐        │
│  │ 順位 │ 6 人│ 8 人│ 12 人│ 16 人│ 24 人│        │
│  │      │×0.87│×1.00│×1.22 │×1.41 │×1.73 │        │
│  ├──────┼─────┼─────┼──────┼──────┼──────┤        │
│  │ 1 位 │8.66 │10.00│12.25 │14.14 │17.32 │        │
│  │ …    │ …   │ …   │ …    │ …    │ …    │        │
│  └──────┴─────┴─────┴──────┴──────┴──────┘        │
│  ※ 値を変更するとプレビューが即時更新されます        │
│  ※ 次回終了するトーナメントから新ルールが           │
│    適用されます。過去の累計値（totalPoints）は       │
│    変更されません。                                  │
│                                                      │
│  [既定値に戻す]   [保存]   [キャンセル]              │
└──────────────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| `groups/{gid}` schema | `seasonPointsRule` フィールド不在 | `seasonPointsRule: { base: number[]; baseline: number } \| null`（zod default null） | additive。旧 doc は `null` で hydrate されて既定値にフォールバック |
| `finishTournament()` の write 経路 | tx 内で `calcSeasonPoints(rank, participants)` 固定式 | tx 内で `groups/{gid}` を `tx.get` し、`seasonPointsRule ?? DEFAULT_SEASON_POINTS_RULE` を `calcSeasonPoints(rank, participants, rule)` に渡す | tx 内 read +1（group doc）。20 人 + 1 group + 1 tournament = read 22 / write 22 で 500 ops 上限内 |
| `/groups/[gid]` の 「シーズンポイント計算ルール」カード | 不在 | 全メンバー閲覧、owner / organizer のみ編集ボタン表示 | 「既定値に戻す」で `seasonPointsRule = null` を保存 |
| `seasonHistory/{seasonId}` 内 entries | rule snapshot 無し | **本 phase では追加しない**（Open Question 化） | 過去シーズンの「どんな rule で集計したか」は確認できないが、現時点で要件は出ていない |
| 過去 `seasonStats/{uid}.totalPoints` の値 | 既定 rule で累計 | 変更なし（rule 切替後に finishTournament が走った tournament 分のみ新 rule） | 累計値はシーズン中の整合性が崩れない方針。整合性が必要な運営者は「シーズンを開始する」で reset |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [.claude/rules/firebase-patterns.md](../../../rules/firebase-patterns.md) | all | `groups/{gid}` update の allowed-keys 一覧（8 ブランチ）、wrap helper、subcollection 設計原則。本 phase で 9 ブランチ目を追加 |
| P0 (critical) | [.claude/rules/error-logging.md](../../../rules/error-logging.md) | all | `AppError` ラップ、prefix 規約。本 phase は `validation/season-points-rule-invalid` を新設 |
| P0 (critical) | [.claude/rules/group-membership.md](../../../rules/group-membership.md) | all | 権限マトリクスに「seasonPointsRule の参照／更新」行を追加する位置 |
| P0 (critical) | [.claude/rules/testing.md](../../../rules/testing.md) | all | mock 境界、characterization test ファースト規約。`calcSeasonPoints` への引数追加は characterization test の規約事例 |
| P0 (critical) | [src/lib/limits.ts](../../../../src/lib/limits.ts) | 36-57 | `SEASON_POINTS_BASE` / `SEASON_POINTS_BASELINE_PARTICIPANTS` / `SEASON_FINAL_TABLE_THRESHOLD` の既存定数。本 phase はここを「カスタム rule 不在時の既定値」として参照する |
| P0 (critical) | [src/lib/services/season-points.ts](../../../../src/lib/services/season-points.ts) | all | `calcSeasonPoints(rank, totalParticipants)` の現実装。第 3 引数 `rule?: SeasonPointsRule` を後方互換で追加し、unit test と finishTournament の callsite を移行 |
| P0 (critical) | [src/lib/services/season-points.test.ts](../../../../src/lib/services/season-points.test.ts) | all | 既存 22 件のテスト。第 3 引数追加で signature が変わるため引数なしで既定値が適用される後方互換テストと、カスタム rule のケースを追加 |
| P0 (critical) | [src/lib/firebase/schemas/group.ts](../../../../src/lib/firebase/schemas/group.ts) | 53-131 | `audioSettings` / `defaultSeatsPerTable` / `defaultTableLabels` / `defaultTableColors` の additive 拡張先例。`seasonPointsRule` を同パターンで `nullable().default(null)` 追加 |
| P0 (critical) | [src/lib/firebase/repositories/groups.ts](../../../../src/lib/firebase/repositories/groups.ts) | 248-410 | `updateFinishedTournamentCount` / `updateDefaultSeatsPerTable` / `updateDefaultTableSettings` の wrap pattern。`updateSeasonPointsRule(gid, value)` を同形で追加 |
| P0 (critical) | [src/lib/services/group.ts](../../../../src/lib/services/group.ts) | 309-454 | `setFinishedTournamentCount` / `setDefaultSeatsPerTable` / `setDefaultTableSettings` の `assertOrganizer` 経由 + repository 呼出パターン。本 phase は `setSeasonPointsRule({ gid, uid, value })` を同形で追加 |
| P0 (critical) | [src/lib/firebase/repositories/tournaments.ts](../../../../src/lib/firebase/repositories/tournaments.ts) | 593-695 | `finishTournament` の tx パターン（事前 read で順位確定 → tx 内で seasonStats 個別 read-then-write）。本 phase は tx 内に `tx.get(groupDocRef(cur.groupId))` を追加し、rule を取得して `calcSeasonPoints` に渡す |
| P0 (critical) | [firestore.rules](../../../../firestore.rules) | 70-247 | `groups/{gid}` update の 8 分岐（owner / self-add / self-leave / self-key displayName / audioSettings / finishedTournamentCount / defaultSeatsPerTable / seasonStartDate / defaultTableLabels+Colors）。本 phase で 9 ブランチ目（`seasonPointsRule` 単独書換）を additive 追加 |
| P0 (critical) | [scripts/test-rules-season.mjs](../../../../scripts/test-rules-season.mjs) | all | Phase A の emulator validator。`test-rules-season-points-rule.mjs` を同パターンで新設 |
| P0 (critical) | [scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs) | all | rule 内ハードコード数値の drift 検出。本 phase で `seasonPointsRule.base.size() <= 9` / `baseline >= 2` / `baseline <= 10` の drift 検査を追加 |
| P0 (critical) | [src/app/groups/[gid]/group-detail-client.tsx](../../../../src/app/groups/%5Bgid%5D/group-detail-client.tsx) | all | サークル詳細画面の構成。`<SeasonCard />` 直下（または直後）に `<SeasonPointsRuleCard />` を配置 |
| P0 (critical) | [src/app/groups/[gid]/_components/SeasonCard.tsx](../../../../src/app/groups/%5Bgid%5D/_components/SeasonCard.tsx) | all | カード構造の最小先例。`<SeasonPointsRuleCard />` も `Card` / `CardHeader` / `CardContent` の同構造で実装 |
| P1 (important) | [.claude/PRPs/02-season-stats-and-share/plans/completed/phase-a-season-stats-foundation.plan.md](completed/phase-a-season-stats-foundation.plan.md) | all | Phase A の設計判断（baseline=8 整合性 / 小数 2 桁丸め / tx 内 raw read）。本 phase は同設計を継承 |
| P1 (important) | [.claude/PRPs/02-season-stats-and-share/plans/completed/phase-c-table-label-color.plan.md](completed/phase-c-table-label-color.plan.md) | all | `defaultTableLabels` の additive 追加先例。affectedKeys ブランチ + drift script + UI Card のセット |
| P1 (important) | [src/lib/firebase/repositories/groups.test.ts](../../../../src/lib/firebase/repositories/groups.test.ts) | all | `updateDefaultTableSettings` 等の SDK call shape 検証パターン |
| P1 (important) | [src/lib/services/group.test.ts](../../../../src/lib/services/group.test.ts) | all | `setDefaultTableSettings` の assertOrganizer / 値域検証パターン |
| P1 (important) | [src/lib/firebase/repositories/tournaments.test.ts](../../../../src/lib/firebase/repositories/tournaments.test.ts) | 557-833 | `finishTournament` の tx mock パターン。本 phase で「rule あり / rule null（既定）」の characterization を追加 |
| P1 (important) | [src/lib/firebase/schemas/index.test.ts](../../../../src/lib/firebase/schemas/index.test.ts) | all | `groupBodySchema` additive フィールド test pattern |
| P2 (reference) | [src/components/ui/dialog.tsx](../../../../src/components/ui/dialog.tsx) | all | shadcn dialog（既存 `StartSeasonDialog` / `LeaveDeleteDialogs` で利用）。編集モーダルで mirror |
| P2 (reference) | [src/lib/services/current-group.tsx](../../../../src/lib/services/current-group.tsx) | all | `useCurrentGroup` の `groups` payload に新フィールド `seasonPointsRule` が伝搬する経路（自動。schema additive のため別途変更不要） |

## External Documentation

| Topic | Source | Key Takeaway |
| ----- | ------ | ------------ |
| Firestore runTransaction の read-then-write 順序 | https://firebase.google.com/docs/firestore/manage-data/transactions#transactions | tx 内で `tx.get(ref)` した後でないと `tx.update(ref)` できない。本 phase では `tx.get(groupDocRef)` を seasonStats の read より先に置く |
| Firestore Security Rules で list element の制約 | https://firebase.google.com/docs/reference/rules/rules.List | `list.size()` は表現可能だが「list の各要素が non-negative number」のような element-level 制約は表現困難。本 phase は配列長と全体型のみ rule で強制し、各要素の値域は schema/service 層が enforce |
| Firestore Security Rules の `is map` / `is list` / `is int` / `is number` | https://firebase.google.com/docs/reference/rules/rules.Integer | `is number` は int / float の両方を含む。本 phase の `base` 各要素は `number` (`is number`) を期待するが、上述のとおり element-level は rule で表現せず schema/service に委譲 |
| zod の nullable + default パターン | https://zod.dev/?id=nullable | `z.object({...}).nullable().default(null)` で「未設定時は null として hydrate」を実現する。Phase A の `seasonStartDate` と同形 |

KEY_INSIGHT: `groups/{gid}` の `seasonPointsRule` を tx 内 re-read することで、運営者が tournament 進行中に rule を変更しても、`finishTournament` commit 時点の最新値が確実に適用される。事前 read（tx 外）にすると Phase A の seasonStats と同じ「pre-read 後・tx commit 前の race」が発生しうるが、本 phase は read 1 件追加のみで済むため tx 内取込が無駄なく安全。

GOTCHA: `calcSeasonPoints` の第 3 引数追加は **後方互換が崩れる変更ではない**（引数を省略すると `DEFAULT_SEASON_POINTS_RULE` が使われる）が、既存テストの「既定値が暗黙に適用されている」前提が見えづらくなる。Phase E では既存 22 件のテストはそのまま green を維持しつつ、`describe("calcSeasonPoints with custom rule")` ブロックを別 describe で追加する。

GOTCHA: `seasonPointsRule.base.length` がカスタムで 5 以下になった場合、6〜9 位は 0pt として扱われる（`calcSeasonPoints` は `rank > rule.base.length` で 0 を返す）。一方、`isFinalTable` は `SEASON_FINAL_TABLE_THRESHOLD = 9` で固定（[src/lib/limits.ts:57](../../../../src/lib/limits.ts#L57)）のため、6 位の player は「ポイント 0pt だが FT カウント +1」になる可能性がある。これは仕様としてそのまま残す（FT は「上位 9 人入賞」であり、ポイント計算 base の長さと独立）。Open Question で記録する。

GOTCHA: `seasonHistory/{seasonId}.entries[].totalPoints` には rule snapshot を含めない。過去シーズンの「どの rule で集計されたか」が遡って分からなくなるが、現時点で運営者からの要望は出ていない。Open Question で将来拡張余地を残す。

GOTCHA: `affectedKeys` の検査は `request.resource.data.diff(resource.data).affectedKeys().hasOnly(['seasonPointsRule'])` で `seasonPointsRule` 単独書換のみを許可する。既存 8 ブランチ（owner / self-add / self-leave / self-key displayName / audioSettings / finishedTournamentCount / defaultSeatsPerTable / seasonStartDate / defaultTableLabels+Colors）に対する member 経路でのフィールド汚染（Phase 4.16 で修復した既存欠陥）を踏襲しないよう、追加ブランチでも `affectedKeys.hasOnly` を必ず付ける。

---

## Patterns to Mirror

### NAMING_CONVENTION（schema additive 追加）

```typescript
// SOURCE: src/lib/firebase/schemas/group.ts:99-103
seasonStartDate: z.instanceof(Timestamp).nullable().default(null),
```

`seasonPointsRule` を同形で additive 追加（map nullable）:

```typescript
// 本 phase で追加
seasonPointsRule: seasonPointsRuleSchema, // = z.object({...}).nullable().default(null)
```

### SCHEMA_NULLABLE_OBJECT（nullable + default null）

```typescript
// SOURCE: src/lib/firebase/schemas/group.ts:111-114（defaultTableLabels の array.default([]) に対応する map.nullable().default(null) パターン）
defaultTableLabels: z
  .array(z.string().min(1).max(TABLE_LABEL_MAX_LENGTH))
  .max(MAX_TABLES)
  .default([]),
```

本 phase では「未設定時は null」の方が「未設定時は空 object」より意味が明確（既定値にフォールバックする意図が型に現れる）ため、`nullable().default(null)` を採用する。

### REPOSITORY_PATTERN（wrap helper）

```typescript
// SOURCE: src/lib/firebase/repositories/groups.ts:284-307
export async function updateDefaultSeatsPerTable(
  gid: string,
  value: number,
): Promise<void> {
  if (
    !Number.isInteger(value) ||
    value < MIN_SEATS_PER_TABLE ||
    value > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/default-seats-invalid",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "デフォルト席数の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { defaultSeatsPerTable: value });
    },
    { gid },
  );
  logger.info("group defaultSeatsPerTable updated", { gid, value });
}
```

`updateSeasonPointsRule(gid, value)` を同形で追加。`value` は `SeasonPointsRule | null`（null は既定値リセット）。検証は service 層に集約し、repository は型と nonneg / 配列長 / baseline の最終ライン防御のみ持つ。

### SERVICE_PATTERN（assertOrganizer + 多段検証 + repository 経由）

```typescript
// SOURCE: src/lib/services/group.ts:378-454
export async function setDefaultTableSettings({
  gid,
  uid,
  labels,
  colors,
}: {
  gid: string;
  uid: string;
  labels: string[];
  colors: (string | null)[];
}): Promise<void> {
  if (!Array.isArray(labels)) { /* ... */ }
  if (labels.length > MAX_TABLES) { /* ... */ }
  if (!Array.isArray(colors) || colors.length !== labels.length) { /* ... */ }
  const normalizedLabels: string[] = [];
  for (const label of labels) {
    if (typeof label !== "string") { /* ... */ }
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > TABLE_LABEL_MAX_LENGTH) { /* ... */ }
    normalizedLabels.push(trimmed);
  }
  // ...
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultTableSettings(gid, { labels: normalizedLabels, colors: normalizedColors });
  logger.info("setDefaultTableSettings ok", { /* ... */ });
}
```

`setSeasonPointsRule({ gid, uid, value })` を同形で追加。`value: SeasonPointsRule | null`。null なら repository に `null` を渡してそのまま reset。非 null のとき:

- `Array.isArray(value.base)` を確認、長さ 1〜`SEASON_POINTS_BASE.length` (=9)
- 各要素が `Number.isFinite` かつ `>= 0`（負値拒否）
- `Number.isInteger(value.baseline)` かつ `MIN_SEATS_PER_TABLE <= value.baseline <= MAX_SEATS_PER_TABLE`

すべて検証エラー時は `validation/season-points-rule-invalid` で throw。

### TX_PATTERN（runTransaction + tx 内 group re-read）

```typescript
// SOURCE: src/lib/firebase/repositories/tournaments.ts:611-685（Phase A の finishTournament tx）
await runTransaction(firestore, async (tx) => {
  const cur = await loadTournamentInTx(tx, tid, userGroupIds);
  const ref = doc(tournamentsRef, tid);
  if (isFinished(cur)) return;
  // 全員分 seasonStats を tx.get → tx.set
  for (const r of ranking) {
    if (r.uid === null) continue;
    const existing = await tx.get(seasonStatsRawDocRef(cur.groupId, r.uid));
    reads.push({ ... });
  }
  tx.update(ref, { state: "finished", ... });
  tx.update(groupDocRef(cur.groupId), { finishedTournamentCount: increment(1) });
  for (const e of reads) {
    const points = calcSeasonPoints(e.rank, totalParticipants);
    tx.set(seasonStatsDocRef(cur.groupId, e.playerUid), next);
  }
});
```

本 phase での拡張: tx 内 reads block の **先頭** に `groups/{gid}` の raw read を追加し、`seasonPointsRule` を取得する:

```typescript
// 追加（reads block の先頭）
const groupSnap = await tx.get(groupRawDocRef(cur.groupId));
const rule = parseSeasonPointsRuleFromRawData(groupSnap.data()) ?? DEFAULT_SEASON_POINTS_RULE;
```

その後の `calcSeasonPoints(e.rank, totalParticipants)` を `calcSeasonPoints(e.rank, totalParticipants, rule)` に差し替える。`groupRawDocRef` は seasonStats と同じく **converter 抜き** の DocumentReference を返す（schema mismatch で tx を落とさないため）。`parseSeasonPointsRuleFromRawData` は防御的 number 配列パース helper（[Phase A の `toPrevStats` パターン](../../../../src/lib/firebase/repositories/tournaments.ts#L67-L84)）。

### FIRESTORE_RULE_PATTERN（affectedKeys 単独書換ブランチ）

```firestore-rules
// SOURCE: firestore.rules:221-247（Phase A の seasonStartDate / Phase C の defaultTableLabels+Colors）
) || (
  // Phase A: organizer による seasonStartDate の単独書換。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['seasonStartDate'])
  && request.resource.data.seasonStartDate is timestamp
) || (
  // Phase C / 02-02: organizer による defaultTableLabels + defaultTableColors の atomic 書換。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['defaultTableLabels', 'defaultTableColors'])
  && request.resource.data.defaultTableLabels is list
  && request.resource.data.defaultTableLabels.size() <= 6
  && request.resource.data.defaultTableColors is list
  && request.resource.data.defaultTableColors.size() <= 6
);
```

本 phase で同じ `groups/{gid}` update の OR 末尾に追加:

```firestore-rules
) || (
  // Phase E: organizer による seasonPointsRule の単独書換。
  //   - サークル詳細画面の SeasonPointsRuleCard inline edit から `setSeasonPointsRule` 経由で発火。
  //   - affectedKeys は 'seasonPointsRule' のみに限定。他フィールドは触らせない。
  //   - null セット（既定値リセット）も同 branch で許可。
  //   - 値域: base は list 長 1..9 / baseline は int 2..10。
  //     各要素 (base[i] >= 0 number) は Cloud Firestore Rules で list element の値域を
  //     表現できないため schema / service 層に委譲する（最終ライン防御）。
  //   - organizer は元々サークルの全 CRUD を持つ信頼ロールのため、空値書込のリスクは許容範囲。
  isOrganizer(gid)
  && request.resource.data.diff(resource.data).affectedKeys()
       .hasOnly(['seasonPointsRule'])
  && (
    request.resource.data.seasonPointsRule == null
    || (
      request.resource.data.seasonPointsRule is map
      && request.resource.data.seasonPointsRule.base is list
      && request.resource.data.seasonPointsRule.base.size() >= 1
      && request.resource.data.seasonPointsRule.base.size() <= 9
      && request.resource.data.seasonPointsRule.baseline is int
      && request.resource.data.seasonPointsRule.baseline >= 2
      && request.resource.data.seasonPointsRule.baseline <= 10
    )
  )
);
```

### EMULATOR_VALIDATOR_PATTERN

```javascript
// SOURCE: scripts/test-rules-season.mjs:148-280 の構造
async function main() {
  const owner = await signUpOrIn("season-owner@test.local", "passw0rd");
  const org = await signUpOrIn("season-organizer@test.local", "passw0rd");
  const member = await signUpOrIn("season-member@test.local", "passw0rd");
  // ...
  const seed = await createDoc(owner.idToken, "groups", gid, { /* ... */ });
  // 拡張で organizer / member を追加
  await expectAllow("(1) organizer set seasonStartDate (Timestamp)", () => /* ... */);
  await expectDeny("(2) ...", () => /* ... */);
}
```

`scripts/test-rules-season-points-rule.mjs` を新設し、以下のケースを必ず含める:

1. organizer が valid な `{ base: [10,7,5], baseline: 8 }` を書換 → allow
2. organizer が `null` で reset → allow
3. organizer が `seasonPointsRule + name` を同時書換 → deny（affectedKeys 違反）
4. member が `seasonPointsRule` を書換 → deny
5. organizer が `baseline = 1`（< 2）を書換 → deny
6. organizer が `baseline = 11`（> 10）を書換 → deny
7. organizer が `base = []`（size < 1）を書換 → deny
8. organizer が `base = 10 件 array`（size > 9）を書換 → deny
9. organizer が `seasonPointsRule = "string"`（type != map / null）を書換 → deny
10. outsider（非メンバー）が `seasonPointsRule` を read → deny
11. member が `groups/{gid}` を read して `seasonPointsRule` 含む doc を取得 → allow（rule に変更なしを保証）

### DRIFT_DETECTION_PATTERN

```javascript
// SOURCE: scripts/test-rules-limits.mjs:115-150（既存 displayName / TABLE_LABEL_MAX_LENGTH の drift 検査）
{
  label: "groups.defaultTableLabels upper bound (<= MAX_TABLES)",
  pattern: /defaultTableLabels\.size\(\)\s*<=\s*(\d+)/g,
  expected: EXPECTED.MAX_TABLES,
  minOccurrences: 1,
},
```

本 phase で追加するエントリ（`scripts/test-rules-limits.mjs`）:

```javascript
{
  label: "groups.seasonPointsRule.base upper bound (<= SEASON_POINTS_BASE.length)",
  pattern: /seasonPointsRule\.base\.size\(\)\s*<=\s*(\d+)/g,
  expected: EXPECTED.SEASON_POINTS_BASE_LENGTH, // = 9
  minOccurrences: 1,
},
{
  label: "groups.seasonPointsRule.baseline lower bound (>= MIN_SEATS_PER_TABLE)",
  pattern: /seasonPointsRule\.baseline\s*>=\s*(\d+)/g,
  expected: EXPECTED.MIN_SEATS_PER_TABLE, // = 2
  minOccurrences: 1,
},
{
  label: "groups.seasonPointsRule.baseline upper bound (<= MAX_SEATS_PER_TABLE)",
  pattern: /seasonPointsRule\.baseline\s*<=\s*(\d+)/g,
  expected: EXPECTED.MAX_SEATS_PER_TABLE, // = 10
  minOccurrences: 1,
},
```

`SEASON_POINTS_BASE_LENGTH` は `parseConstFromText` で抽出できないため、`SEASON_POINTS_BASE` 配列リテラルの要素数を抽出する小ヘルパーを `scripts/test-rules-limits.mjs` 内に追加する（または `SEASON_POINTS_BASE_MAX_LENGTH = 9` を `src/lib/limits.ts` に export して `parseConstFromText` で取得）。後者を推奨。

### TEST_STRUCTURE（純関数の引数追加）

```typescript
// SOURCE: src/lib/services/season-points.test.ts:5-102
describe("calcSeasonPoints", () => {
  it("returns 10.00 for rank=1 at baseline (8 participants)", () => {
    expect(calcSeasonPoints(1, 8)).toBe(10);
  });
  // ... 22 件の既定値テスト
});
```

本 phase の追加テスト:

```typescript
describe("calcSeasonPoints with custom rule", () => {
  it("uses default rule when third arg is omitted", () => {
    expect(calcSeasonPoints(1, 8)).toBe(10); // baseline=8, base[0]=10 既定
  });

  it("uses custom base array", () => {
    expect(
      calcSeasonPoints(1, 8, { base: [20, 15, 10], baseline: 8 }),
    ).toBe(20);
  });

  it("uses custom baseline (4 → factor sqrt(8/4)=sqrt(2))", () => {
    // 10 * sqrt(8/4) = 10 * sqrt(2) ≈ 14.14
    expect(
      calcSeasonPoints(1, 8, { base: [10, 7, 5, 3, 1], baseline: 4 }),
    ).toBe(14.14);
  });

  it("returns 0 when rank exceeds custom base length", () => {
    expect(
      calcSeasonPoints(4, 8, { base: [10, 7, 5], baseline: 8 }),
    ).toBe(0);
  });

  // characterization: 既定 rule と explicit DEFAULT_SEASON_POINTS_RULE が同値
  it("equals default rule explicit pass", () => {
    for (let r = 1; r <= 10; r += 1) {
      for (const p of [6, 8, 16, 24]) {
        expect(calcSeasonPoints(r, p)).toBe(
          calcSeasonPoints(r, p, DEFAULT_SEASON_POINTS_RULE),
        );
      }
    }
  });
});
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/limits.ts` | UPDATE | `SEASON_POINTS_BASE_MAX_LENGTH = 9` を `export const` で追加（drift script から `parseConstFromText` で取得するため）。コメント補強で「カスタム rule の `base.length` 上限値の真実源」を明記 |
| `src/lib/services/season-points.ts` | UPDATE | `SeasonPointsRule` 型 + `DEFAULT_SEASON_POINTS_RULE` 定数 export、`calcSeasonPoints(rank, totalParticipants, rule?: SeasonPointsRule)` の第 3 引数追加（後方互換）、コメント更新 |
| `src/lib/services/season-points.test.ts` | UPDATE | `describe("calcSeasonPoints with custom rule")` ブロック追加（既定値の後方互換 + カスタム base / baseline / 範囲外 rank） |
| `src/lib/firebase/schemas/group.ts` | UPDATE | `seasonPointsRuleSchema` 追加（`z.object({ base, baseline }).nullable()`）、`groupBodySchema.seasonPointsRule` フィールド additive 追加（`default(null)`）、export type `SeasonPointsRule = z.infer<...>` 追加 |
| `src/lib/firebase/schemas/index.test.ts` | UPDATE | `groupBodySchema` に対する `seasonPointsRule` の hydrate / null / valid object / invalid（base 0 件・baseline 範囲外・base 各要素負値）の characterization test 追加 |
| `src/lib/firebase/repositories/groups.ts` | UPDATE | `updateSeasonPointsRule(gid, value)` 関数追加（`wrapFirestoreWrite` 経由、`updateDoc({ seasonPointsRule: value })`）。**最終ライン防御**として配列長 / 各要素 nonneg / baseline 範囲を再検証する |
| `src/lib/firebase/repositories/groups.test.ts` | UPDATE | `updateSeasonPointsRule` の SDK call shape 検証（vi.mocked(updateDoc) で `{ seasonPointsRule: { base, baseline } }` または `{ seasonPointsRule: null }` が渡される） |
| `src/lib/services/group.ts` | UPDATE | `setSeasonPointsRule({ gid, uid, value })` 追加（assertOrganizer → 入力正規化 → `updateSeasonPointsRule`）、export 一覧に追加 |
| `src/lib/services/group.test.ts` | UPDATE | `setSeasonPointsRule` の test 追加（assertOrganizer / 値域違反 / null reset / valid 値） |
| `src/lib/firebase/repositories/tournaments.ts` | UPDATE | `finishTournament` の tx 内に `tx.get(groupRawDocRef(cur.groupId))` を追加（reads block の先頭）、`parseSeasonPointsRuleFromRawData` で防御的にパース、`calcSeasonPoints(rank, p, rule)` に第 3 引数を渡す。`groupRawDocRef` も同 file に local helper として追加（converter なしの `doc(firestore, "groups", gid)` を返すだけ） |
| `src/lib/firebase/repositories/tournaments.test.ts` | UPDATE | 既存 `mockFinishTransaction` を「rule あり」「rule null」の 2 パターンで characterize。`tx.get` mock の戻り値に group doc を追加 |
| `firestore.rules` | UPDATE | `groups/{gid}` update の 9 ブランチ目として `seasonPointsRule` 単独書換ブランチを additive 追加。値域は schema-only な `null` 許容 + `is map` + `base.size() 1..9` + `baseline 2..10` |
| `scripts/test-rules-season-points-rule.mjs` | CREATE | emulator validator。上述 11 ケースを REST 直叩きで検証 |
| `scripts/test-rules-limits.mjs` | UPDATE | drift 検査エントリ 3 件追加（`base.size() <= 9` / `baseline >= 2` / `baseline <= 10`）、`SEASON_POINTS_BASE_MAX_LENGTH` 抽出を追加 |
| `package.json` | UPDATE | `"test:rules-season-points-rule": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-season-points-rule.mjs\""` を `scripts` に追加 |
| `src/app/groups/[gid]/_components/SeasonPointsRuleCard.tsx` | CREATE | サークル詳細画面の新規 Card。閲覧（全員）+ 編集モーダル（owner / organizer のみ）+ 「既定値に戻す」ボタン |
| `src/app/groups/[gid]/group-detail-client.tsx` | UPDATE | `<SeasonCard />` 直下に `<SeasonPointsRuleCard />` を配置、ハンドラ `onSaveSeasonPointsRule` / `onResetSeasonPointsRule` を追加 |
| `.claude/rules/firebase-patterns.md` | UPDATE | 「`groups/{gid}` update の allowed-keys 一覧」表に `seasonPointsRule update` ブランチ行を追加 |
| `.claude/rules/group-membership.md` | UPDATE | 権限マトリクスに「seasonPointsRule の参照／更新」行追加、`groups/{gid}` のフィールド説明に `seasonPointsRule` を追加 |
| `.claude/PRPs/02-season-stats-and-share/prds/02-season-stats-and-share.prd.md` | UPDATE | Implementation Phases 表に Phase E 行を `pending → in-progress` で追加、Phase Details セクションに「Phase E」記述を追加、Won't (line 36 / 101) は「Phase E で実装」と注記 |

## NOT Building

- **式の構造変更**（`base × sqrt(participants/baseline)` 以外）— 多項式 / log スケール / TDA EPT 方式等への変更は対象外。次フェーズ送り
- **tournament 単位の `seasonPointsRule` snapshot** — `tournaments/{tid}` schema は変更しない。tournament 進行中に rule を変更すると `finishTournament` で新 rule が適用される（運営者は「次回トーナメントから新 rule」運用を UI 上で誘導）
- **過去 `seasonStats` への遡及適用** — 累計値は変更しない。整合性が必要なら「シーズンを開始する」で reset する運用
- **`seasonHistory/{seasonId}.entries[]` への rule snapshot** — 過去シーズンの rule 履歴は保持しない。Open Question で将来拡張余地を残す
- **`finalTableThreshold` のカスタム化** — `SEASON_FINAL_TABLE_THRESHOLD = 9` は据え置き（ポイント計算 `base.length` と独立。FT は「上位 9 人」の概念）
- **`base[]` の各順位ラベルカスタマイズ** — UI は「1 位 / 2 位 / ...」固定表示、運営者が「優勝 / 準優勝」のような呼称を変える機能は提供しない
- **`groupJoinCode` 経由加入時のデフォルト rule 配布** — 招待コード経由で join したユーザーは現在 group の rule をそのまま read するため、追加実装不要

---

## Step-by-Step Tasks

### Task 1: `season-points.ts` の純関数拡張

- **ACTION**: `calcSeasonPoints` の第 3 引数に `rule?: SeasonPointsRule` を追加し、`SeasonPointsRule` 型と `DEFAULT_SEASON_POINTS_RULE` 定数を export
- **IMPLEMENT**:
  ```typescript
  export interface SeasonPointsRule {
    base: number[];
    baseline: number;
  }

  export const DEFAULT_SEASON_POINTS_RULE: SeasonPointsRule = {
    base: [...SEASON_POINTS_BASE],
    baseline: SEASON_POINTS_BASELINE_PARTICIPANTS,
  };

  export function calcSeasonPoints(
    rank: number,
    totalParticipants: number,
    rule: SeasonPointsRule = DEFAULT_SEASON_POINTS_RULE,
  ): number {
    if (!Number.isInteger(rank) || rank < 1) return 0;
    if (!Number.isInteger(totalParticipants) || totalParticipants < 1) return 0;
    if (rank > rule.base.length) return 0;
    const base = rule.base[rank - 1];
    const factor = Math.sqrt(totalParticipants / rule.baseline);
    return Math.round(base * factor * 100) / 100;
  }
  ```
- **MIRROR**: `SOURCE: src/lib/services/season-points.ts:17-24`（既存 `calcSeasonPoints` 本体をそのまま rule 経由に書き換え）
- **IMPORTS**: `SEASON_POINTS_BASE` / `SEASON_POINTS_BASELINE_PARTICIPANTS` / `SEASON_FINAL_TABLE_THRESHOLD` from `@/lib/limits`
- **GOTCHA**: spread `[...SEASON_POINTS_BASE]` で `readonly number[]` を可変 `number[]` に変換。`DEFAULT_SEASON_POINTS_RULE.base` を直接 `SEASON_POINTS_BASE` 参照にすると消費側で readonly が漏れる
- **VALIDATE**: `npm run typecheck` で型エラーなし、既存 `season-points.test.ts` の 22 件が引数省略で green

### Task 2: `season-points.test.ts` にカスタム rule テスト追加

- **ACTION**: 既存 22 件の最後に `describe("calcSeasonPoints with custom rule")` を追加
- **IMPLEMENT**: 「Patterns to Mirror」セクションの TEST_STRUCTURE のとおり 5+ 件追加
- **MIRROR**: `SOURCE: src/lib/services/season-points.test.ts:87-101`（`it.each` の characterization 形式）
- **IMPORTS**: `DEFAULT_SEASON_POINTS_RULE` を新規 import
- **GOTCHA**: 既存テストはシグネチャ変更しないこと（`expect(calcSeasonPoints(1, 8)).toBe(10)` は既定値で動く後方互換テストとして温存）
- **VALIDATE**: `npm test -- season-points` で全件 green

### Task 3: `schemas/group.ts` に `seasonPointsRule` フィールド追加

- **ACTION**: `seasonPointsRuleSchema` を export し、`groupBodySchema.seasonPointsRule` を additive 追加
- **IMPLEMENT**:
  ```typescript
  // limits から既定値とリミットを import
  import { SEASON_POINTS_BASE_MAX_LENGTH } from "@/lib/limits";

  export const seasonPointsRuleSchema = z
    .object({
      base: z
        .array(z.number().nonnegative())
        .min(1)
        .max(SEASON_POINTS_BASE_MAX_LENGTH),
      baseline: z
        .number()
        .int()
        .min(MIN_SEATS_PER_TABLE)
        .max(MAX_SEATS_PER_TABLE),
    })
    .nullable()
    .default(null);
  export type SeasonPointsRule = z.infer<typeof seasonPointsRuleSchema>;

  // groupBodySchema に追加（defaultTableColors の直後）:
  seasonPointsRule: seasonPointsRuleSchema,
  ```
- **MIRROR**: `SOURCE: src/lib/firebase/schemas/group.ts:99-103`（`seasonStartDate` の `nullable().default(null)`）
- **IMPORTS**: `MIN_SEATS_PER_TABLE` / `MAX_SEATS_PER_TABLE` / `SEASON_POINTS_BASE_MAX_LENGTH` from `@/lib/limits`
- **GOTCHA**: 既存 group doc は `seasonPointsRule` フィールドが無いため、zod default で `null` に hydrate される。`null` の場合は `calcSeasonPoints` 側で `?? DEFAULT_SEASON_POINTS_RULE` のフォールバックを使う規約（schema 側で default を `DEFAULT_SEASON_POINTS_RULE` にしない理由は、null を「未設定（既定値にフォールバック）」のシンボルとして UI で扱うため）
- **VALIDATE**: `npm run typecheck` 通過、`schemas/index.test.ts` の characterization テスト追加で green

### Task 4: `limits.ts` に `SEASON_POINTS_BASE_MAX_LENGTH` を追加

- **ACTION**: `export const SEASON_POINTS_BASE_MAX_LENGTH = 9;` を追加（`SEASON_POINTS_BASE` 直下）。drift script から `parseConstFromText` で抽出可能にする
- **IMPLEMENT**:
  ```typescript
  /**
   * Phase E: シーズンポイント計算の base 配列長の上限。
   *
   * `seasonPointsRule.base` は最大 9 件（1 位〜9 位までを定義可能）。
   * `SEASON_POINTS_BASE.length` と機械的に一致させる（drift script で検査）。
   * `firestore.rules` の `seasonPointsRule.base.size() <= 9` リテラルとも連動。
   * DRIFT WARNING: 値を変更する場合は本ファイル / `firestore.rules` /
   * `scripts/test-rules-limits.mjs` の EXPECTED を同時に更新すること。
   */
  export const SEASON_POINTS_BASE_MAX_LENGTH = 9;
  ```
- **MIRROR**: `SOURCE: src/lib/limits.ts:43-51`（`SEASON_POINTS_BASE` / `SEASON_POINTS_BASELINE_PARTICIPANTS` のドキュメンテーション形式）
- **IMPORTS**: なし
- **GOTCHA**: `SEASON_POINTS_BASE.length` を runtime 評価して `as const` で型化する案もあるが、drift script の正規表現 `export const NAME = (\d+);` が match できないため、リテラル `9` を別 const として明示する
- **VALIDATE**: `npm run typecheck` 通過、grep で他箇所からの参照が schema / drift script のみ

### Task 5: `repositories/groups.ts` に `updateSeasonPointsRule` 追加

- **ACTION**: `wrapFirestoreWrite` 経由の repository 関数を追加。最終ライン防御で配列長 / 各要素 nonneg / baseline 範囲を再検証
- **IMPLEMENT**:
  ```typescript
  export async function updateSeasonPointsRule(
    gid: string,
    value: SeasonPointsRule | null,
  ): Promise<void> {
    if (value !== null) {
      if (!Array.isArray(value.base) || value.base.length < 1 || value.base.length > SEASON_POINTS_BASE_MAX_LENGTH) {
        throw new AppError(
          `base 配列は 1 件以上 ${SEASON_POINTS_BASE_MAX_LENGTH} 件以下で指定してください`,
          "validation/season-points-rule-invalid",
        );
      }
      for (const v of value.base) {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          throw new AppError(
            "base 配列の各要素は 0 以上の数値で指定してください",
            "validation/season-points-rule-invalid",
          );
        }
      }
      if (
        !Number.isInteger(value.baseline) ||
        value.baseline < MIN_SEATS_PER_TABLE ||
        value.baseline > MAX_SEATS_PER_TABLE
      ) {
        throw new AppError(
          `baseline は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
          "validation/season-points-rule-invalid",
        );
      }
    }
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "シーズンポイント計算ルールの更新に失敗しました",
      async () => {
        await updateDoc(groupDocRef(gid), { seasonPointsRule: value });
      },
      { gid },
    );
    logger.info("group seasonPointsRule updated", {
      gid,
      reset: value === null,
      baseLen: value?.base.length,
      baseline: value?.baseline,
    });
  }
  ```
- **MIRROR**: `SOURCE: src/lib/firebase/repositories/groups.ts:284-307`（`updateDefaultSeatsPerTable` の wrap 構造）
- **IMPORTS**: `SeasonPointsRule` from `@/lib/firebase/schemas/group`、`SEASON_POINTS_BASE_MAX_LENGTH` / `MIN_SEATS_PER_TABLE` / `MAX_SEATS_PER_TABLE` from `@/lib/limits`
- **GOTCHA**: `null` 保存は `updateDoc({ seasonPointsRule: null })` で OK（Firestore は null 値を保持）。`deleteField()` を使うと rule 側の `affectedKeys.hasOnly(['seasonPointsRule'])` 判定は通るが、フィールドが消えるため schema の zod default `null` で再 hydrate されて挙動同じ。仕様統一のため `null` セットを採用
- **VALIDATE**: `npm test -- repositories/groups` で SDK call shape が `updateDoc(_, { seasonPointsRule: ... })` で発火することを確認

### Task 6: `services/group.ts` に `setSeasonPointsRule` 追加

- **ACTION**: assertOrganizer + 入力正規化 + repository 呼出
- **IMPLEMENT**:
  ```typescript
  export async function setSeasonPointsRule({
    gid,
    uid,
    value,
  }: {
    gid: string;
    uid: string;
    value: SeasonPointsRule | null;
  }): Promise<void> {
    // 入力正規化（NaN / 文字列誤入力 / float baseline などを弾く）
    let normalized: SeasonPointsRule | null = null;
    if (value !== null) {
      // 検証本体は repository に集約済みだが、ここでも UI 由来の typo を早期に弾く
      if (!Array.isArray(value.base) || value.base.length < 1 || value.base.length > SEASON_POINTS_BASE_MAX_LENGTH) {
        throw new AppError(/* ... */, "validation/season-points-rule-invalid");
      }
      const safeBase: number[] = value.base.map((v) => {
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
          throw new AppError("base 配列の各要素は 0 以上の数値で指定してください", "validation/season-points-rule-invalid");
        }
        // 小数 2 桁丸め（運営者が 8.66 のような表示値を入力した場合の正規化）
        return Math.round(v * 100) / 100;
      });
      if (
        !Number.isInteger(value.baseline) ||
        value.baseline < MIN_SEATS_PER_TABLE ||
        value.baseline > MAX_SEATS_PER_TABLE
      ) {
        throw new AppError(/* ... */, "validation/season-points-rule-invalid");
      }
      normalized = { base: safeBase, baseline: value.baseline };
    }
    const group = await getGroup(gid);
    assertOrganizer(group, uid);
    await updateSeasonPointsRule(gid, normalized);
    logger.info("setSeasonPointsRule ok", { gid, uid, reset: normalized === null });
  }
  ```
- **MIRROR**: `SOURCE: src/lib/services/group.ts:340-363`（`setDefaultSeatsPerTable`）と `SOURCE: src/lib/services/group.ts:378-454`（`setDefaultTableSettings` の入力正規化）
- **IMPORTS**: `SEASON_POINTS_BASE_MAX_LENGTH` / `MIN_SEATS_PER_TABLE` / `MAX_SEATS_PER_TABLE` from `@/lib/limits`、`updateSeasonPointsRule` from repository、`SeasonPointsRule` from schema
- **GOTCHA**: `Math.round(v * 100) / 100` で base 値を 2 桁正規化することで、UI から「8.659999...」のような誤差混入を防ぐ。これは calcSeasonPoints の出力丸めと同方針
- **VALIDATE**: `npm test -- services/group` で assertOrganizer / 値域違反 / valid 値 / null reset の test が green

### Task 7: `firestore.rules` に `seasonPointsRule` 単独書換ブランチ追加

- **ACTION**: `groups/{gid}` の `allow update` 末尾に新ブランチ追加
- **IMPLEMENT**: 「Patterns to Mirror」の FIRESTORE_RULE_PATTERN 通り
- **MIRROR**: `SOURCE: firestore.rules:221-247`（Phase A の seasonStartDate / Phase C の defaultTableLabels+Colors）
- **IMPORTS**: なし（rules は宣言的）
- **GOTCHA**: `null == null` は rule 上で正しく評価される（`request.resource.data.seasonPointsRule == null`）。`request.resource.data.get('seasonPointsRule', null) == null` のような defensive 構文は使わなくて良い（zod schema が hydrate する `null` は Firestore に明示的な null として保存される）
- **VALIDATE**: `npm run test:rules-limits` で drift script が pass、後続 task の emulator validator が all-pass

### Task 8: `scripts/test-rules-season-points-rule.mjs` 新設

- **ACTION**: emulator validator を新規作成。「Patterns to Mirror」の EMULATOR_VALIDATOR_PATTERN にある 11 ケースを REST 直叩きで検証
- **IMPLEMENT**: `scripts/test-rules-season.mjs` を mechanical コピーし、ケースだけ差し替える
- **MIRROR**: `SOURCE: scripts/test-rules-season.mjs:1-300`
- **IMPORTS**: `node:fetch`（標準）
- **GOTCHA**: REST 直叩きの map / list 表現は `tv()` ヘルパーが処理する（既存）。`null` を渡すには `{ nullValue: null }` で行ける
- **VALIDATE**: `npm run test:rules-season-points-rule` で 11/11 pass

### Task 9: `scripts/test-rules-limits.mjs` の drift 検査拡張

- **ACTION**: 「Patterns to Mirror」の DRIFT_DETECTION_PATTERN 通り 3 件追加 + `SEASON_POINTS_BASE_MAX_LENGTH` の `parseConstFromText` 抽出を `EXPECTED` に追加
- **IMPLEMENT**:
  ```javascript
  EXPECTED.SEASON_POINTS_BASE_LENGTH = parseConstFromText(
    limitsText,
    "SEASON_POINTS_BASE_MAX_LENGTH",
    "src/lib/limits.ts",
  );
  // checks 配列に 3 件 push
  ```
- **MIRROR**: `SOURCE: scripts/test-rules-limits.mjs:58-72`（EXPECTED 構築）/ `:115-150`（既存 displayName / TABLE_LABEL_MAX_LENGTH の drift エントリ）
- **IMPORTS**: なし
- **GOTCHA**: `SEASON_POINTS_BASE = [10, 7, 5, 3, 1, 1, 1, 1, 1]` のような配列リテラル要素数を抽出する正規表現は脆い。Task 4 で `SEASON_POINTS_BASE_MAX_LENGTH = 9` を別 const として export することで `parseConstFromText` をそのまま使える
- **VALIDATE**: `npm run test:rules-limits` で 9/9 pass

### Task 10: `package.json` に test script 追加

- **ACTION**: `"test:rules-season-points-rule"` を追加
- **IMPLEMENT**: `"test:rules-season-points-rule": "firebase emulators:exec --only auth,firestore --project allin-pokertimer-e2e \"node scripts/test-rules-season-points-rule.mjs\""`
- **MIRROR**: `SOURCE: package.json:18`（`test:rules-season`）
- **IMPORTS**: なし
- **GOTCHA**: PowerShell でダブルクォートエスケープが必要な場合は backtick で逃がす（既存 `test:rules-season` と同じ書き方なら問題なし）
- **VALIDATE**: `npm run test:rules-season-points-rule` が単独で起動できる

### Task 11: `finishTournament` の tx 内で rule を取込

- **ACTION**: tx 内 reads block の **先頭** に `groups/{gid}` raw read を追加し、rule を取得して `calcSeasonPoints` に渡す
- **IMPLEMENT**:
  ```typescript
  // file: src/lib/firebase/repositories/tournaments.ts

  // ファイル内 helper として追加
  function groupRawDocRef(gid: string) {
    return doc(firestore, "groups", gid);
  }

  function parseSeasonPointsRuleFromRawData(
    data: unknown,
  ): SeasonPointsRule | null {
    const obj = (data ?? {}) as Record<string, unknown>;
    const rule = obj.seasonPointsRule;
    if (rule === null || rule === undefined) return null;
    if (typeof rule !== "object") return null;
    const r = rule as Record<string, unknown>;
    if (!Array.isArray(r.base) || r.base.length < 1 || r.base.length > SEASON_POINTS_BASE_MAX_LENGTH) {
      return null;
    }
    const base: number[] = [];
    for (const v of r.base) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) return null;
      base.push(n);
    }
    const baselineRaw = Number(r.baseline);
    if (
      !Number.isInteger(baselineRaw) ||
      baselineRaw < MIN_SEATS_PER_TABLE ||
      baselineRaw > MAX_SEATS_PER_TABLE
    ) {
      return null;
    }
    return { base, baseline: baselineRaw };
  }

  // finishTournament の tx 内（reads block の先頭）に追加:
  const groupSnap = await tx.get(groupRawDocRef(cur.groupId));
  const rule =
    parseSeasonPointsRuleFromRawData(groupSnap.data()) ??
    DEFAULT_SEASON_POINTS_RULE;
  // ... 後続の `calcSeasonPoints(e.rank, totalParticipants)` を
  //     `calcSeasonPoints(e.rank, totalParticipants, rule)` に差し替え
  ```
- **MIRROR**: `SOURCE: src/lib/firebase/repositories/tournaments.ts:67-84`（`toPrevStats` 防御的パース）/ `:631-654`（reads block）
- **IMPORTS**: `DEFAULT_SEASON_POINTS_RULE` / `SeasonPointsRule` from `@/lib/services/season-points`、`SEASON_POINTS_BASE_MAX_LENGTH` / `MIN_SEATS_PER_TABLE` / `MAX_SEATS_PER_TABLE` from `@/lib/limits`
- **GOTCHA**: tx 内 read を seasonStats より先に置くこと。Firestore の read-then-write 制約は緩いが、「同じ doc を後から書き換える」場合に再 read を要求される。本 phase は groups は read のみ（finishedTournamentCount の `increment(1)` は別途 tx.update なので、`tx.get` が同じ doc に対して先行している必要がある — Phase 4.16 から既に同 doc read+write 構成で動いていることを確認）
- **GOTCHA**: 既に `finishTournament` 内で `tx.update(groupDocRef(cur.groupId), { finishedTournamentCount: increment(1) })` が走っている（line 662）。同じ `groupDocRef` を tx 内で再 read することで、Firestore は read-then-write を保証する（順序: tx.get → tx.update でないとエラー）。このため raw read の追加位置は **必ず seasonStats raw read より前**、かつ **`tx.update(groupDocRef, ...)` より前**
- **VALIDATE**: `npm test -- repositories/tournaments` で「rule あり」「rule null（既定）」両ケースが green、`tx.get` mock の戻り値に group doc を追加した shape で characterization を維持

### Task 12: `repositories/tournaments.test.ts` の test 拡張

- **ACTION**: 既存 `mockFinishTransaction` を「rule あり」「rule null」の 2 パターンで分岐する mock 追加
- **IMPLEMENT**: tx.get mock の引数判定で `groupRawDocRef` への呼出に対し test ごとに rule あり/null の data を返す。期待値として `tx.set(seasonStatsDocRef, { totalPoints: ... })` の `totalPoints` がカスタム rule 適用後の値になっていることを assert
- **MIRROR**: `SOURCE: src/lib/firebase/repositories/tournaments.test.ts:557-833`
- **IMPORTS**: `DEFAULT_SEASON_POINTS_RULE` from `@/lib/services/season-points`
- **GOTCHA**: tx mock の path 比較は string 比較になりがち。既存テストの `tx.get` mock パターンに合わせて、ref オブジェクトの identity 比較で分岐する
- **VALIDATE**: `npm test -- repositories/tournaments` で 全 case green

### Task 13: `SeasonPointsRuleCard.tsx` 新設

- **ACTION**: サークル詳細画面の閲覧/編集 UI Card。**計算式の表示**と**参加人数別の付与ポイントプレビュー**を必須要素として含める
- **REQUIREMENTS**（要件、UX Design セクションと整合）:
  1. **閲覧 UI**:
     - 「現在は既定値 / カスタム値が適用されています」のステータス表示
     - 計算式の文章表示: 「`付与ポイント = 基本点(順位) × √(参加人数 ÷ baseline)`」（数式 + 日本語補足、`baseline` は数値で具体化）
     - 「baseline（= N 人）のとき係数 1.00、人数が多いほどポイント増加」の説明文（PRD の Solution Detail と整合）
     - 順位 → 基本点の単純リスト表示（`base[i] | i+1 位 → N pt`）
     - **参加人数別プレビュー表（Must）**: 列に主要参加人数（6 / 8 / 12 / 16 / 24 人）、行に各順位、セルに `calcSeasonPoints(rank, p, effective)` の結果を 2 桁で表示。列ヘッダに係数（`×0.87` 等）も併記
     - プレビュー表のキャプション「同じ順位でも参加人数で付与ポイントが変わる」を明示文として表示
  2. **編集モーダル**:
     - 計算式と「baseline で係数 1.0」の説明を再掲
     - 順位ごとの `<Input type="number" inputMode="decimal" min={0}>` を 1〜9 行分（行追加・削除ボタン付き）
     - baseline `<Input type="number" inputMode="numeric" min={2} max={10} step={1}>`
     - **入力中ライブプレビュー（Must）**: draft 値で参加人数別プレビュー表を即時再計算し表示。閲覧 UI と同じ表構造で UX 一貫性を保つ
     - 「次回終了するトーナメントから新ルールが適用」「過去の totalPoints は変更されない」の運用注記
     - 「既定値に戻す」「保存」「キャンセル」ボタン
- **IMPLEMENT**:
  ```tsx
  "use client";
  import { useMemo, useState } from "react";
  import { Button } from "@/components/ui/button";
  import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
  import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
  import { Input } from "@/components/ui/input";
  import { Label } from "@/components/ui/label";
  import {
    calcSeasonPoints,
    DEFAULT_SEASON_POINTS_RULE,
    type SeasonPointsRule,
  } from "@/lib/services/season-points";
  import {
    MAX_SEATS_PER_TABLE,
    MIN_SEATS_PER_TABLE,
    SEASON_POINTS_BASE_MAX_LENGTH,
  } from "@/lib/limits";

  /** プレビュー表で表示する参加人数の代表値。MIN..MAX_SEATS_PER_TABLE × 卓数を踏まえた典型値。 */
  const PREVIEW_PARTICIPANTS = [6, 8, 12, 16, 24] as const;

  /** 6.06 → "6.06" の 2 桁固定表示。calcSeasonPoints は 2 桁丸め済み。 */
  function fmt2(n: number): string {
    return n.toFixed(2);
  }

  /** baseline と参加人数から係数 √(p / baseline) を 2 桁で返す表示 helper。 */
  function fmtFactor(participants: number, baseline: number): string {
    if (baseline < 1) return "—";
    return Math.sqrt(participants / baseline).toFixed(2);
  }

  export function SeasonPointsRuleCard({
    rule,
    isOrganizer,
    working,
    onSave,
    onReset,
  }: {
    rule: SeasonPointsRule | null;
    isOrganizer: boolean;
    working: boolean;
    onSave: (next: SeasonPointsRule) => void;
    onReset: () => void;
  }) {
    const effective = rule ?? DEFAULT_SEASON_POINTS_RULE;
    const isCustom = rule !== null;
    const [editing, setEditing] = useState(false);
    const [draftBase, setDraftBase] = useState<string[]>(
      effective.base.map((v) => String(v)),
    );
    const [draftBaseline, setDraftBaseline] = useState(String(effective.baseline));

    /** 編集中の draft を SeasonPointsRule に解釈（不正値は既定値にフォールバックしてプレビュー表は描き続ける）。 */
    const draftRule: SeasonPointsRule = useMemo(() => {
      const base = draftBase.map((s) => Number(s));
      const baseline = Number(draftBaseline);
      const safeBase = base.every((v) => Number.isFinite(v) && v >= 0) && base.length >= 1
        ? base
        : effective.base;
      const safeBaseline = Number.isInteger(baseline) && baseline >= MIN_SEATS_PER_TABLE && baseline <= MAX_SEATS_PER_TABLE
        ? baseline
        : effective.baseline;
      return { base: safeBase, baseline: safeBaseline };
    }, [draftBase, draftBaseline, effective.base, effective.baseline]);

    return (
      <Card>
        <CardHeader>
          <CardTitle>シーズンポイント計算ルール</CardTitle>
          <CardDescription>
            {isCustom
              ? "このサークル独自のルールが適用されています。"
              : "既定値が適用されています。"}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* 計算式（閲覧時は effective を、編集モーダル内では draftRule を使う） */}
          <section className="rounded-md border p-3 text-sm">
            <p className="font-mono">
              付与ポイント = 基本点(順位) × √(参加人数 ÷ {effective.baseline})
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              参加人数が baseline = {effective.baseline} 人のとき係数 1.00。人数が多いほど係数が増え、付与ポイントも大きくなります。
            </p>
          </section>

          {/* 基本点リスト */}
          <section>
            <h3 className="mb-1 text-sm font-semibold">基本点（順位ごと）</h3>
            <ul className="grid grid-cols-3 gap-1 text-sm sm:grid-cols-5">
              {effective.base.map((v, i) => (
                <li key={i} className="rounded bg-muted px-2 py-1">
                  <span className="font-mono">{i + 1} 位</span> = {v} pt
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted-foreground">
              baseline（係数 1.0 となる人数）: {effective.baseline} 人
            </p>
          </section>

          {/* 参加人数別プレビュー（閲覧 UI の核心） */}
          <PreviewTable rule={effective} />

          {/* 編集導線 */}
          {isOrganizer ? (
            <div className="flex justify-end">
              <Button size="sm" onClick={() => setEditing(true)} disabled={working}>
                編集する
              </Button>
            </div>
          ) : null}
        </CardContent>

        {/* 編集モーダル */}
        <Dialog open={editing} onOpenChange={setEditing}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>シーズンポイント計算ルールを編集</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 text-sm">
              <p className="rounded-md border p-3 font-mono">
                付与ポイント = 基本点(順位) × √(参加人数 ÷ baseline)
              </p>
              {/* 基本点 input + 行追加/削除 */}
              {/* baseline input */}
              {/* draft からのライブプレビュー */}
              <PreviewTable rule={draftRule} title="プレビュー（入力中の値で計算）" />
              <p className="text-xs text-muted-foreground">
                次回終了するトーナメントから新ルールが適用されます。過去の累計値（totalPoints）は変更されません。
              </p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={onReset} disabled={working}>
                既定値に戻す
              </Button>
              <Button variant="ghost" onClick={() => setEditing(false)} disabled={working}>
                キャンセル
              </Button>
              <Button
                onClick={() => {
                  // draft を最終 validate して onSave に渡す（service 層が再 validate するため UI は早期 typo のみ弾く）
                  const base = draftBase.map((s) => Number(s));
                  const baseline = Number(draftBaseline);
                  if (base.some((v) => !Number.isFinite(v) || v < 0)) return;
                  if (!Number.isInteger(baseline) || baseline < MIN_SEATS_PER_TABLE || baseline > MAX_SEATS_PER_TABLE) return;
                  onSave({ base, baseline });
                  setEditing(false);
                }}
                disabled={working}
              >
                保存
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Card>
    );
  }

  /** 参加人数別プレビュー表。閲覧時は effective、編集時は draftRule を渡す。 */
  function PreviewTable({ rule, title }: { rule: SeasonPointsRule; title?: string }) {
    return (
      <section>
        <h3 className="mb-1 text-sm font-semibold">
          {title ?? "参加人数別の付与ポイント目安"}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="py-1 text-left">順位</th>
                {PREVIEW_PARTICIPANTS.map((p) => (
                  <th key={p} className="py-1 text-right">
                    <div>{p} 人</div>
                    <div className="text-muted-foreground">×{fmtFactor(p, rule.baseline)}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rule.base.map((_, i) => {
                const rank = i + 1;
                return (
                  <tr key={rank} className="border-b">
                    <td className="py-1">{rank} 位</td>
                    {PREVIEW_PARTICIPANTS.map((p) => (
                      <td key={p} className="py-1 text-right font-mono">
                        {fmt2(calcSeasonPoints(rank, p, rule))}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          ※ 同じ順位でも参加人数が違うと付与ポイントが変わります（人数が多いほど係数が増える）。
        </p>
      </section>
    );
  }
  ```
- **MIRROR**: `SOURCE: src/app/groups/[gid]/_components/SeasonCard.tsx:30-74`（Card 構造）、`SOURCE: src/app/groups/[gid]/_components/StartSeasonDialog.tsx`（Dialog パターン）、`SOURCE: src/app/groups/[gid]/_components/GroupDefaultTableLabelsCard.tsx`（複雑な inline edit パターン）、`SOURCE: src/app/groups/[gid]/season/season-ranking-client.tsx:136-161`（順位×指標の table レンダ）
- **IMPORTS**: 上述
- **GOTCHA**: プレビュー表は `calcSeasonPoints(rank, p, rule)` を直接呼ぶことで、UI で表示される値が finishTournament tx 内で実際に保存される値と **bit-perfect に一致**する（純関数の同一実装を共有）。表示用に独自の式を再実装してはいけない（drift 源）
- **GOTCHA**: 編集モーダルの draft 値が一時的に invalid（例: baseline 入力途中で `1`）でもプレビュー表が壊れないよう、`draftRule` の `useMemo` で「invalid なら effective にフォールバック」する。これによりプレビューが空白にならず UX が安定する。「保存」ボタンは別途 validate して invalid 時は無反応／エラー表示する
- **GOTCHA**: 編集モーダル内の `<Input type="number">` は文字列入力を string state で保持し、保存時に `Number(v)` で変換 + validate する。空文字は「行削除」扱いではなく「保存ボタン押下時に validate エラー」にする（運営者が意図的に 5 位以下を 0pt にしたい場合は `0` を入力して保存。「行削除」操作は別ボタンで `base.length` を縮める）
- **GOTCHA**: `PREVIEW_PARTICIPANTS = [6, 8, 12, 16, 24]` は固定値だが、baseline が 24 を超えるケースは無い（max=10）ので 24 まであれば代表値として十分。将来 baseline 仕様が変わったら本配列も見直す
- **VALIDATE**: 手動で `npm run dev` →
  - サークル詳細画面でカードに「計算式 + 基本点リスト + 参加人数別プレビュー表」が表示される
  - baseline = 8 のとき「8 人」列の係数が `×1.00`、各順位のポイントが基本点と一致
  - 編集モーダルで base[0] を 10 → 20 に変更 → プレビュー表の「1 位」行が即時に倍値に変わる
  - 編集モーダルで baseline を 8 → 4 に変更 → プレビュー表の係数列が再計算される（8 人列で `×1.41`）
  - 「既定値に戻す」 → カード表示が「既定値が適用」に戻り、プレビュー表も既定値ベースに戻る

### Task 14: `group-detail-client.tsx` で `<SeasonPointsRuleCard />` を配置

- **ACTION**: `<SeasonCard />` 直下に `<SeasonPointsRuleCard />` 配置、ハンドラ追加
- **IMPLEMENT**:
  ```tsx
  // group-detail-client.tsx 内
  import { setSeasonPointsRule } from "@/lib/services/group";
  import { SeasonPointsRuleCard } from "./_components/SeasonPointsRuleCard";

  // ハンドラ
  async function onSaveSeasonPointsRule(next: SeasonPointsRule) {
    if (!user) return;
    setWorking(true);
    try {
      await setSeasonPointsRule({ gid, uid: user.uid, value: next });
    } catch (e) {
      const err = unwrapOrFrom(e, "validation/season-points-rule-invalid", "ポイント計算ルールの更新に失敗しました");
      setError(`${err.code}: ${err.message}`);
    } finally {
      setWorking(false);
    }
  }
  async function onResetSeasonPointsRule() { /* setSeasonPointsRule({ value: null }) */ }

  // JSX に追加
  <SeasonPointsRuleCard
    rule={group.seasonPointsRule ?? null}
    isOrganizer={isOrganizer}
    working={working}
    onSave={(next) => void onSaveSeasonPointsRule(next)}
    onReset={() => void onResetSeasonPointsRule()}
  />
  ```
- **MIRROR**: `SOURCE: src/app/groups/[gid]/group-detail-client.tsx:255-267`（`onStartSeason` のハンドラパターン）/ `:343-348`（`<SeasonCard />` の配置）
- **IMPORTS**: 上述
- **GOTCHA**: `group.seasonPointsRule` は schema additive なので **subscribeGroup の onSnapshot 経路でも自動で hydrate** される。GroupProvider 経路の `useCurrentGroup` の payload に追加コードは不要（schema が一元化）
- **VALIDATE**: 手動 dev で sliding な「編集 → 保存」が動作、エラーメッセージが日本語で出る

### Task 15: ドキュメント更新

- **ACTION**: `firebase-patterns.md` / `group-membership.md` / PRD を更新
- **IMPLEMENT**:
  - **firebase-patterns.md**: 「`groups/{gid}` update の allowed-keys 一覧」表に行追加（前述）
  - **group-membership.md**: 権限マトリクスに「`seasonPointsRule` の参照／更新」行追加、データモデル節の `groups/{gid}` 列挙に追記
  - **PRD**: Implementation Phases 表に Phase E 行を `in-progress` ステータスで追加、Won't 一覧（line 36 / line 101）に「Phase E で実装」注記、Phase Details に Phase E 詳細追加、Open Question から「base[rank] / baseline 妥当性」項を「Phase E でカスタマイズ可能化済」に書き換え
- **MIRROR**: `SOURCE: .claude/rules/firebase-patterns.md`（既存 8 ブランチ表）/ `SOURCE: .claude/rules/group-membership.md`（権限マトリクス表）/ `SOURCE: PRD line 165-237`（Phase A〜D の表構造）
- **IMPORTS**: なし
- **GOTCHA**: rules は YAML frontmatter があり applyOnPaths で適用範囲が決まる。新フィールド名 `seasonPointsRule` を `firebase-patterns.md` の applyOnPaths に新規追加する必要はない（既存の `src/lib/firebase/**` でカバー済）
- **VALIDATE**: `git diff` で 3 ファイルが意図通り更新、PRD の表マークダウン構造が崩れていない

### Task 16: 全体 validation

- **ACTION**: 静的検査・テスト・rule 整合性を一括確認
- **IMPLEMENT**: 各 npm script 実行
- **MIRROR**: なし
- **IMPORTS**: なし
- **GOTCHA**: emulator validator は `firebase` CLI が必要。CI 環境で動かす場合は別途設定。手元では Phase A 同様 `firebase emulators:exec` から起動する
- **VALIDATE**:
  - `npm run typecheck` — エラー 0
  - `npm run lint` — エラー 0
  - `npm test` — 全件 pass
  - `npm run test:rules-limits` — drift 検査 全件 pass
  - `npm run test:rules-season-points-rule` — emulator validator 11/11 pass
  - `npm run test:rules-season` — Phase A の emulator 検査 退行なし
  - `npm run build` — Next.js build 成功

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `calcSeasonPoints` 引数省略 | `(1, 8)` | 10 | 後方互換 |
| `calcSeasonPoints` カスタム base | `(1, 8, { base: [20], baseline: 8 })` | 20 | base 値変更 |
| `calcSeasonPoints` カスタム baseline | `(1, 8, { base: [10,7,5,3,1], baseline: 4 })` | 14.14 | baseline 半減 → factor 倍 |
| `calcSeasonPoints` rank > base.length | `(4, 8, { base: [10,7,5], baseline: 8 })` | 0 | カスタム配列短時 |
| `calcSeasonPoints` 既定 vs explicit DEFAULT | 全 rank × 主要 participant | 同値 | 後方互換確認 |
| `setSeasonPointsRule` non-organizer | `(member, valid)` | throw `firestore/permission-denied` | 権限 |
| `setSeasonPointsRule` base 0 件 | `({ base: [], baseline: 8 })` | throw `validation/season-points-rule-invalid` | 配列長違反 |
| `setSeasonPointsRule` base 10 件 | `({ base: [10×10], baseline: 8 })` | throw `validation/season-points-rule-invalid` | 配列長違反 |
| `setSeasonPointsRule` base に負値 | `({ base: [-1], baseline: 8 })` | throw | 値域違反 |
| `setSeasonPointsRule` baseline 1 | `({ base: [10], baseline: 1 })` | throw | 値域違反 |
| `setSeasonPointsRule` baseline 11 | `({ base: [10], baseline: 11 })` | throw | 値域違反 |
| `setSeasonPointsRule` baseline 小数 | `({ base: [10], baseline: 8.5 })` | throw | 整数強制 |
| `setSeasonPointsRule` value=null | `null` | repository に null | reset 経路 |
| `setSeasonPointsRule` valid | `{ base: [10,7,5], baseline: 6 }` | repository 呼出 + logger.info | 正常 |
| `updateSeasonPointsRule` SDK shape | `(gid, valid)` | `updateDoc(_, { seasonPointsRule: { base, baseline } })` | shape 検証 |
| `updateSeasonPointsRule` null | `(gid, null)` | `updateDoc(_, { seasonPointsRule: null })` | reset shape |
| `groupBodySchema` no field | `{ ...other }` | hydrate `seasonPointsRule: null` | additive 互換 |
| `groupBodySchema` valid object | `{ seasonPointsRule: { base: [10], baseline: 8 } }` | parse 通過 | 正常 |
| `groupBodySchema` invalid base length | `{ seasonPointsRule: { base: [], baseline: 8 } }` | parse 失敗 | schema 防御 |
| `finishTournament` rule null | group.seasonPointsRule=null | seasonStats.totalPoints が既定 rule で計算 | 後方互換 |
| `finishTournament` rule custom | group.seasonPointsRule={base:[20],baseline:8} | seasonStats.totalPoints が新 rule で計算 | 正常 |

### Edge Cases Checklist

- [x] 旧 group doc（`seasonPointsRule` フィールド不在）→ zod default で null hydrate → 既定値フォールバック
- [x] base 配列の各要素が 0 の場合（運営者が意図的に「全員 0pt」設定）→ allow（合計値 0pt）
- [x] base 配列が 1 件のみ（1 位だけポイントあり）→ allow、2 位以下は 0pt
- [x] baseline = 2（最小）→ 平方根スケールで 8 人参加時に係数 `sqrt(8/2) = 2.0`
- [x] baseline = 10（最大）→ 8 人参加時に係数 `sqrt(8/10) ≈ 0.894`
- [x] tournament 進行中に rule を変更 → finishTournament 時点の rule が適用される（tx 内 re-read で保証）
- [x] 同時に複数端末で rule 編集 → 後勝ち（Firestore の通常 update セマンティクス）。実用上問題なし
- [x] member が rule を編集しようとする → rule で deny（emulator validator (4)）
- [x] outsider が rule を read しようとする → group read 自体が deny（既存 rule で member のみ read 可）
- [x] `seasonPointsRule + name` 同時書換 → affectedKeys 違反で deny（emulator validator (3)）

---

## Validation Commands

### Static Analysis

```bash
npm run typecheck
```

EXPECT: Zero type errors

```bash
npm run lint
```

EXPECT: Zero lint errors

### Unit Tests

```bash
npm test -- season-points
npm test -- repositories/groups
npm test -- repositories/tournaments
npm test -- services/group
npm test -- schemas/index
```

EXPECT: All affected suites pass

### Full Test Suite

```bash
npm test
```

EXPECT: No regressions

### Rule Drift Detection

```bash
npm run test:rules-limits
```

EXPECT: All drift checks pass（既存 9 件 + 新規 3 件 = 12 件）

### Emulator Validation

```bash
npm run test:rules-season-points-rule
```

EXPECT: 11/11 pass

```bash
npm run test:rules-season
```

EXPECT: 既存 Phase A 検査が退行していない（11/11 pass）

### Build Validation

```bash
npm run build
```

EXPECT: Next.js production build success

### Browser Validation（手動）

```bash
npm run dev
```

EXPECT: 以下のフローが正常動作:

- [ ] サークル詳細画面に「シーズンポイント計算ルール」カードが表示される
- [ ] **カードに計算式（`付与ポイント = 基本点(順位) × √(参加人数 ÷ baseline)`）が常時表示**されている
- [ ] **カードに参加人数別プレビュー表（6/8/12/16/24 人 × 全順位）が表示**されており、各セルが `calcSeasonPoints` の出力と一致する
- [ ] プレビュー表のヘッダに係数（`×0.87` / `×1.00` / `×1.22` / `×1.41` / `×1.73`）が併記され、baseline 列が `×1.00` になっている
- [ ] 一般メンバーは閲覧のみ（編集ボタンが出ない）。**プレビュー表は一般メンバーにも表示される**
- [ ] owner / organizer に「編集する」ボタンが出て、モーダルで base 配列・baseline を変更できる
- [ ] **編集モーダル内のプレビュー表が draft 値で即時再計算される**（base[0] = 10 → 20 でプレビュー 1 位行が即倍に、baseline 8 → 4 で係数列が即再計算）
- [ ] 編集モーダル内でも計算式が再表示されている
- [ ] 「保存」で更新成功 → カード表示が「カスタム値が適用されています」になる
- [ ] 「既定値に戻す」で `null` 保存 → カード表示が「既定値が適用されています」に戻り、プレビュー表も既定値ベースに戻る
- [ ] base 0 件 / 10 件 / 負値 / baseline 1 / baseline 11 / 小数 baseline で UI バリデーションエラーが出る
- [ ] member が直接 SDK call で rule を更新試行 → permission-denied（DevTools console で確認）
- [ ] tournament を新規作成 → 終了 → seasonStats が新 rule で増分される（ランキング画面で totalPoints 確認）
- [ ] **異なる参加人数で複数 tournament を終了 → seasonStats.totalPoints の増分量がプレビュー表のセル値と一致**（参加人数で付与ポイントが変わることを実機確認）

### Manual Validation

- [ ] Firestore rules を本番デプロイ前に `firebase deploy --only firestore:rules` で確実に反映
- [ ] PRD の Open Question から「base[rank] / baseline 妥当性」項を「Phase E で対応済」に書換
- [ ] PR 説明に「rule 変更後、過去 seasonStats は変更されない」「シーズン切替で reset 推奨」のオペレーション注記を含める

---

## Acceptance Criteria

- [ ] 全 Step タスク完了
- [ ] 全 Validation コマンドが pass
- [ ] `firestore.rules` deploy 後、本番環境でも emulator 検査と同じ allow / deny 結果が得られる
- [ ] 一般メンバーが SDK 直叩きで `seasonPointsRule` を変更できない（emulator + 本番）
- [ ] tournament 終了 → カスタム rule で `seasonStats.totalPoints` が増分される（手動確認）
- [ ] 既定値リセット（null 保存）で `calcSeasonPoints` が `DEFAULT_SEASON_POINTS_RULE` を使う
- [ ] **`SeasonPointsRuleCard` の閲覧 UI に計算式 `付与ポイント = 基本点(順位) × √(参加人数 ÷ baseline)` と「baseline = N のとき係数 1.00」の説明文が常時表示される**
- [ ] **`SeasonPointsRuleCard` の閲覧 UI と編集モーダルの両方に参加人数別プレビュー表（行 = 順位、列 = 6/8/12/16/24 人）があり、係数 ×N.NN を列ヘッダに併記する**
- [ ] **プレビュー表のセル値は `calcSeasonPoints(rank, p, rule)` の戻り値と完全一致する**（独自再計算しない）
- [ ] **編集モーダルのプレビュー表が draft 入力に追従して即時再計算される**（draft が一時的 invalid な場合は最後の有効値にフォールバックして空白にしない）

## Completion Checklist

- [ ] 既存パターン（`finishedTournamentCount` / `defaultSeatsPerTable` / `defaultTableLabels+Colors`）を mirror した実装
- [ ] エラー処理が `error-logging.md` 準拠（`AppError` ラップ、`validation/*` / `firestore/*` prefix）
- [ ] ログが `logger.info` / `logger.warn` 経由（`console.*` 不在）
- [ ] テストが `testing.md` 準拠（mock 境界 = service / repository / 純関数の API 境界）
- [ ] 数値リミットが `src/lib/limits.ts` に集約され、drift script が pass
- [ ] ドキュメント更新（PRD Phase 表 / firebase-patterns.md / group-membership.md）
- [ ] 不要なスコープ追加なし（`finalTableThreshold` / tournament snapshot / history rule snapshot 等は将来送り）
- [ ] 自己完結 — 実装中に追加調査が不要

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| `finishTournament` tx の read 数が +1 → 大規模サークル（20 人超）で tx 失敗率が上がる | L | M | tx 内 read は `groups/{gid}` 1 件のみ追加（read 22 → 23 / 500 ops 上限内）。20 人 × 月 1〜2 回スケールで実用上問題なし |
| 運営者が tournament 進行中に rule を変えて、参加者が「思っていた点数と違う」と感じる | M | L | 編集モーダルに「次回終了するトーナメントから新ルールが適用されます」を明示。シーズン途中での rule 変更は **同じシーズン内に新旧 rule で計算された点数が混在する**ため、運営者には「シーズンを開始する」で reset を推奨する旨を Card 説明に追加 |
| カスタム rule で `base.length < 9` のとき、`isFinalTable` の閾値（9）と差異が生じる | L | L | 仕様としてそのまま残し（FT は「上位 9 人」概念で base 長と独立）、Open Question に記録。次フェーズで要望次第で `seasonPointsRule.finalTableThreshold` 追加検討 |
| `seasonHistory/{seasonId}.entries[]` に rule snapshot を持たないため、過去シーズンの「どんな rule で集計されたか」が遡れない | L | L | 現時点で要望なし。Open Question で記録、将来 additive 拡張で対応 |
| schema additive で zod default `null` の挙動が `useCurrentGroup` 等の subscribe 経路で hydrate ミスマッチ | L | M | Phase A の `seasonStartDate` `nullable().default(null)` で実証済。同パターンを踏襲する |
| drift script の正規表現が `seasonPointsRule.base.size() <= 9` リテラルを意図通り抽出できない | L | L | 既存 displayName / TABLE_LABEL_MAX_LENGTH の同形パターンが動作中。手動テストで確認 |
| organizer が悪意で `base = [99999, ...]` のような大値を保存し、`totalPoints` が異常値になる | L | L | organizer は元々全 CRUD を持つ信頼ロール。元値域は schema で `nonnegative` のみ enforce、上限は実用上不要（万 pt 単位は OG 画像の MAX_TOTAL_POINTS = 99999 で別途 cap 済） |

## Notes

- 本 phase は PRD で「次フェーズ送り」として予約されていた最後の Won't 項目（line 36 / line 101）の解消。Phase D 完了 + 02-02 improvement 完了 + past-season-detail-view 完了で PRD 02 の MVP 範囲は閉じており、残りは「カスタマイズ自由化」のみ
- PRD Open Question の「`base[rank]` 値（1/2/3/4/5-9 位）と baseline=8 の妥当性」は本 phase 完了時点で「カスタマイズ可能化したため運営者各自で調整」となり Open Question から落とす
- 将来拡張余地（次々フェーズ）:
  - `seasonHistory/{seasonId}` に rule snapshot を保存
  - `seasonPointsRule.finalTableThreshold` でカスタム化
  - 式の構造変更（多項式 / log / TDA EPT など）
  - tournament 単位の rule snapshot（rule 変更前後で進行中 tournament の整合性を保証）
  - Cloud Functions 化で `setSeasonPointsRule` を Callable 化し、クライアントから直接 `groups.update` を deny
- 同 PRD の architect-refactor が必要になるレベルではない（既存 `defaultTableLabels` / `audioSettings` 等の additive パターン踏襲のみ）
