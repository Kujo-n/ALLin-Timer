# Plan: ストラクチャ時間の一括設定モード（Phase 1）

## Summary

ストラクチャ編集 UI（`LevelTable`）に「一括設定 / 個別設定」のトグルを追加し、一括モードでは 1 つの分数入力で**全レベル（ブレイク含む）の `durationSec` を一律代入**できるようにする。個別モードは従来の行ごと入力を完全に維持する。schema / repository は不変。全行一律代入のロジックは純関数として切り出し characterization test で固定する。

## User Story

As a 小規模ポーカーサークルの運営者（owner / organizer）,
I want トーナメント準備時に全レベルの時間を 1 操作でまとめて設定したい,
So that レベルごとに 1 行ずつ分数を入力する手間を省き、熟練者がいなくても素早くストラクチャを組める。

## Problem → Solution

**現状**: `LevelTable` は各レベルの分数を行ごとに 1 つずつ入力するしかない（[LevelTable.tsx:159-167](../../../../src/components/structure/LevelTable.tsx#L159-L167)）。15 レベルなら 15 回入力が必要。
**目標**: 「一括/個別」トグルで一括モードに切り替え、1 つの分数入力で全レベルの `durationSec` を一律設定。個別モードは従来通り。

## Metadata

- **Complexity**: Small
- **Source PRD**: [.claude/PRPs/06-second-dryrun-improvements/prds/06-second-dryrun-improvements.prd.md](../prds/06-second-dryrun-improvements.prd.md)
- **PRD Phase**: Phase 1 — ストラクチャ一括設定（要望①）
- **Estimated Files**: 4（新規 2 / 更新 2）

---

## UX Design

### Before

```
┌─ ブラインド構造 ─────────────────────────────┐
│ ☑ SB を BB の半額で自動入力                  │
│ Lv | SB | BB | Ante | 分  | BREAK |  🗑       │
│  1 | 25 | 50 |   0  | [10]|  ☐    |          │
│  2 | 50 |100 |   0  | [10]|  ☐    |          │  ← 分は行ごとに個別入力
│  3 | 100|200 |   0  | [10]|  ☐    |          │
│ ...（15 レベルなら 15 回入力）                 │
│ [レベルを追加]                                │
└──────────────────────────────────────────────┘
```

### After

```
┌─ ブラインド構造 ─────────────────────────────┐
│ ☑ SB を BB の半額で自動入力                  │
│ ◉ 個別設定  ○ 一括設定                       │  ← 新規トグル（既定: 個別）
│                                              │
│ ── 一括設定を選ぶと ──                        │
│ 全レベルの時間（分）: [10]  ← 1 入力で全行反映 │
│ Lv | SB | BB | Ante | 分     | BREAK |  🗑    │
│  1 | 25 | 50 |   0  |[10]🔒  |  ☐    |        │  ← 分入力は disabled
│  2 | 50 |100 |   0  |[10]🔒  |  ☐    |        │
│  3 | 100|200 |   0  |[10]🔒  |  ☐    |        │
│ [レベルを追加]                                │
└──────────────────────────────────────────────┘
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| 時間入力方式 | 行ごとの分入力のみ | 個別 / 一括をトグルで選択 | 既定は個別（従来挙動を温存） |
| 一括分入力 | なし | 全レベル共通の分入力 1 個 | 変更で全行 `durationSec` に一律代入 |
| 行ごとの分入力 | 常時有効 | 一括モード時は disabled | `autoSbHalf` での SB disabled と同じ作法 |
| 一括 ON 切替時 | — | 全行を推定値（先頭行 or 共通値）で unify | `autoSbHalf` OFF→ON の一括再計算と同じ作法 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 (critical) | [src/components/structure/LevelTable.tsx](../../../../src/components/structure/LevelTable.tsx) | 全体 | 改修対象。`autoSbHalf` トグル（35-47）と `updateDurationMin`（61-66）が一括モードの直接の mirror |
| P0 (critical) | [src/components/structure/LevelTable.test.tsx](../../../../src/components/structure/LevelTable.test.tsx) | 全体 | テスト追加先。`fireEvent` + `aria-label` getter + `onChange` assert の作法を踏襲 |
| P1 (important) | [src/lib/services/tournament-state.ts](../../../../src/lib/services/tournament-state.ts) | 1-40 | 純関数を切り出す配置・命名・JSDoc の precedent |
| P1 (important) | [src/lib/services/tournament-state.test.ts](../../../../src/lib/services/tournament-state.test.ts) | 1-40 | 純関数の characterization test の作法（factory + 仕様列挙） |
| P1 (important) | [src/lib/firebase/schemas/structure.ts](../../../../src/lib/firebase/schemas/structure.ts) | 12-25 | `levelSchema` の invariant（`durationSec` は positive int、break 行は sb/bb/ante=0） |
| P2 (reference) | [src/components/structure/StructureForm.tsx](../../../../src/components/structure/StructureForm.tsx) | 238-241 | `LevelTable` の唯一の consumer。`levels` / `onChange={setLevels}` で接続。変更不要なことの確認用 |
| P2 (reference) | [src/app/structures/new/structure-new-client.tsx](../../../../src/app/structures/new/structure-new-client.tsx) | 76-90 | 新規作成画面。`StructureForm` 経由で `LevelTable` を使う（変更不要） |
| P2 (reference) | [src/app/structures/[sid]/edit/structure-edit-client.tsx](../../../../src/app/structures/%5Bsid%5D/edit/structure-edit-client.tsx) | 93-105 | 編集画面。同上（変更不要） |

## External Documentation

No external research needed — feature uses established internal patterns（`autoSbHalf` トグル / `tournament-state` 純関数）。

---

## Patterns to Mirror

### NAMING_CONVENTION

```ts
// SOURCE: src/components/structure/LevelTable.tsx:17-24
function secToMin(sec: number): number {
  return Math.max(1, Math.round(sec / 60));
}
function parseIntSafe(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}
```

純関数はファイル内 helper（camelCase）。切り出す共有純関数は `src/lib/services/*.ts` に `export function` で配置（tournament-state パターン）。

### TOGGLE_STATE_PATTERN（一括モードの直接の mirror）

```ts
// SOURCE: src/components/structure/LevelTable.tsx:26-47
function inferAutoSbHalfFromLevels(levels: Level[]): boolean {
  const playLevels = levels.filter((l) => !l.isBreak);
  if (playLevels.length === 0) return true;
  return playLevels.every((l) => l.sb === Math.floor(l.bb / 2));
}

const [autoSbHalf, setAutoSbHalf] = useState<boolean>(() =>
  inferAutoSbHalfFromLevels(levels),
);

function handleAutoSbHalfToggle(checked: boolean) {
  setAutoSbHalf(checked);
  if (!checked) return;
  // OFF→ON: 一括で再計算して onChange
  const next = levels.map((l) =>
    l.isBreak ? l : { ...l, sb: Math.floor(l.bb / 2) },
  );
  onChange(next);
}
```

### DURATION_WRITE_PATTERN（分→秒変換）

```ts
// SOURCE: src/components/structure/LevelTable.tsx:61-66
function updateDurationMin(index: number, value: string) {
  const minutes = parseIntSafe(value);
  const durationSec = Math.max(1, minutes) * 60; // schema: durationSec positive int
  const next = levels.map((l, i) => (i === index ? { ...l, durationSec } : l));
  onChange(next);
}
```

一括版は `i === index` 条件を外して全行に適用するだけ。

### INPUT_DISABLED_PATTERN

```tsx
// SOURCE: src/components/structure/LevelTable.tsx:130-137
<Input
  type="number"
  min={0}
  value={l.sb}
  disabled={l.isBreak || autoSbHalf}  // ← トグル ON で disabled
  onChange={(e) => updateChip(i, "sb", e.target.value)}
  aria-label={`level-${l.level}-sb`}
/>
```

分入力は `disabled={bulkMode}` を追加する。

### TEST_STRUCTURE

```tsx
// SOURCE: src/components/structure/LevelTable.test.tsx:30-40
it("ON 時は SB input が disabled で、BB 変更で SB が半額に追従する", () => {
  const onChange = vi.fn();
  render(<LevelTable levels={makeLevels()} onChange={onChange} />);
  expect(screen.getByLabelText<HTMLInputElement>("level-1-sb").disabled).toBe(true);
  fireEvent.change(screen.getByLabelText("level-1-bb"), { target: { value: "200" } });
  expect(onChange).toHaveBeenCalledWith([
    expect.objectContaining({ level: 1, bb: 200, sb: 100 }),
    expect.objectContaining({ level: 2, bb: 100, sb: 50 }),
  ]);
});
```

### PURE_FUNCTION_TEST（tournament-state precedent）

```ts
// SOURCE: src/lib/services/tournament-state.test.ts（作法）
// factory で fixture を生成し、純関数の入出力契約のみを検証する
function level(overrides: Partial<Level> = {}): Level {
  return { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false, ...overrides };
}
```

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| `src/lib/services/structure-levels.ts` | CREATE | 全行一律代入 `applyBulkDurationMin` と推定 `inferBulkDurationMin` を純関数として切り出し |
| `src/lib/services/structure-levels.test.ts` | CREATE | 純関数の characterization test（一律代入・分→秒・break 含む・空入力） |
| `src/components/structure/LevelTable.tsx` | UPDATE | 一括/個別トグル UI + 一括分入力 + 行ごと分入力の disabled 化 |
| `src/components/structure/LevelTable.test.tsx` | UPDATE | トグル UI の振る舞い（既定個別 / 一括反映 / disabled / 切替時 unify）を追加 |

## NOT Building

- ストラクチャレベルの並べ替え（D&D）— PRD「What We're NOT Building」。
- 一括/個別トグル状態の永続化（localStorage 等）— PRD MoSCoW で **Could**。本 plan では画面を開くたびに **既定: 個別モード**（Open Question の決定に従い永続化しない）。
- schema / repository / Firestore rules の変更 — `durationSec` への一律代入のみで invariant 不変。
- プレイ行とブレイク行で別々の一括値 — 決定ログ「全レベル一律同じ分数」によりブレイク含め一律。

---

## Step-by-Step Tasks

### Task 1: 純関数を切り出す（`structure-levels.ts`）

- **ACTION**: `src/lib/services/structure-levels.ts` を新規作成。
- **IMPLEMENT**:
  ```ts
  import type { Level } from "@/lib/firebase/schemas/structure";

  /** 分入力を durationSec（正の整数秒）に変換。schema の durationSec.positive() を満たすため最低 60 秒。 */
  export function minToDurationSec(minutes: number): number {
    return Math.max(1, minutes) * 60;
  }

  /** 全レベル（ブレイク含む）の durationSec を一律 minutes 分に代入した新配列を返す（純関数）。 */
  export function applyBulkDurationMin(levels: Level[], minutes: number): Level[] {
    const durationSec = minToDurationSec(minutes);
    return levels.map((l) => ({ ...l, durationSec }));
  }

  /** 一括モード初期表示用の分値。全行が同一 durationSec ならその分、不揃い/空なら先頭行 or 既定 10。 */
  export function inferBulkDurationMin(levels: Level[]): number {
    if (levels.length === 0) return 10;
    const first = Math.max(1, Math.round(levels[0].durationSec / 60));
    const uniform = levels.every((l) => l.durationSec === levels[0].durationSec);
    return uniform ? first : first;
  }
  ```
  （`uniform` 判定は将来「不揃い時の挙動」を変える余地のため明示。現状は両分岐とも先頭行値を返す。）
- **MIRROR**: DURATION_WRITE_PATTERN（`Math.max(1, minutes) * 60`）/ TOGGLE_STATE_PATTERN（`inferAutoSbHalfFromLevels`）。
- **IMPORTS**: `import type { Level } from "@/lib/firebase/schemas/structure";`
- **GOTCHA**: `durationSec` は zod `positive()`。`minutes <= 0` でも `Math.max(1, ...)` で 60 秒を下回らせない（既存 `updateDurationMin` と完全一致させる）。break 行も対象に含める（決定ログ準拠）。
- **VALIDATE**: `npx tsc --noEmit` で型エラーなし。

### Task 2: 純関数の characterization test（`structure-levels.test.ts`）

- **ACTION**: `src/lib/services/structure-levels.test.ts` を新規作成。
- **IMPLEMENT**: factory `level(overrides)` を定義し、以下を検証:
  - `applyBulkDurationMin` が全行（play + break 混在）の `durationSec` を一律 `minutes*60` に揃える
  - 他フィールド（level / sb / bb / ante / isBreak）は不変
  - `minToDurationSec(0)` → `60`、`minToDurationSec(10)` → `600`、負値 → `60`
  - `inferBulkDurationMin`: 全行 600 秒 → `10`、空配列 → `10`、不揃い → 先頭行の分
- **MIRROR**: PURE_FUNCTION_TEST（factory + 入出力契約）/ TEST_STRUCTURE（`describe` / `it` / `expect.objectContaining`）。
- **IMPORTS**: `import { describe, expect, it } from "vitest";` + 対象関数 + `type { Level }`。
- **GOTCHA**: time 依存・Firestore 依存なし。pure な配列変換のみ。
- **VALIDATE**: `npm test -- structure-levels` が green。

### Task 3: `LevelTable` に一括/個別トグルと一括入力を追加

- **ACTION**: [LevelTable.tsx](../../../../src/components/structure/LevelTable.tsx) を改修。
- **IMPLEMENT**:
  1. import: `import { applyBulkDurationMin, inferBulkDurationMin } from "@/lib/services/structure-levels";`
  2. state を 2 つ追加（`autoSbHalf` の直後）:
     ```ts
     const [bulkMode, setBulkMode] = useState<boolean>(false); // 既定: 個別（永続化しない）
     const [bulkMin, setBulkMin] = useState<number>(() => inferBulkDurationMin(levels));
     ```
  3. ハンドラ追加:
     ```ts
     function handleBulkModeToggle(enabled: boolean) {
       setBulkMode(enabled);
       if (!enabled) return;
       // 個別→一括: 現在の推定分で全行を unify（autoSbHalf OFF→ON と同じ作法）
       const min = inferBulkDurationMin(levels);
       setBulkMin(min);
       onChange(applyBulkDurationMin(levels, min));
     }
     function handleBulkMinChange(value: string) {
       const minutes = parseIntSafe(value);
       setBulkMin(minutes);
       onChange(applyBulkDurationMin(levels, minutes));
     }
     ```
  4. `autoSbHalf` チェックボックス（103-111 のラベル）の直後にトグル UI を追加（radio もしくは checkbox）:
     ```tsx
     <div className="flex items-center gap-4 text-sm" role="radiogroup" aria-label="duration-mode">
       <label className="flex items-center gap-1">
         <input type="radio" name="duration-mode" checked={!bulkMode}
           onChange={() => handleBulkModeToggle(false)} aria-label="duration-mode-individual" />
         <span>個別設定</span>
       </label>
       <label className="flex items-center gap-1">
         <input type="radio" name="duration-mode" checked={bulkMode}
           onChange={() => handleBulkModeToggle(true)} aria-label="duration-mode-bulk" />
         <span>一括設定</span>
       </label>
     </div>
     {bulkMode ? (
       <label className="flex items-center gap-2 text-sm">
         <span>全レベルの時間（分）</span>
         <Input type="number" min={1} value={bulkMin}
           onChange={(e) => handleBulkMinChange(e.target.value)}
           aria-label="bulk-duration-min" className="w-24" />
       </label>
     ) : null}
     ```
  5. 行ごとの分 `Input`（159-167）に `disabled={bulkMode}` を追加。
- **MIRROR**: TOGGLE_STATE_PATTERN / INPUT_DISABLED_PATTERN / DURATION_WRITE_PATTERN。
- **IMPORTS**: 上記 1 の純関数 import を追加（`Input` / `Button` は既存）。
- **GOTCHA**:
  - `addRow`（86-99）は一括モード中でも `last.durationSec` をコピーするため、unify 済みなら新行も同分で揃う（追加対応不要）。ただし一括モード中に行追加した場合、新行は揃った値を引き継ぐので一貫する。
  - `bulkMin` の表示は `value={bulkMin}`（数値 state）で、空文字許容は不要（`parseIntSafe` が NaN→0 を吸収、`Math.max(1,...)` が 0→60 秒に倒す）。既存 `updateDurationMin` と同じ寛容さ。
  - 永続化しない（既定 `false`）— Open Question の決定どおり画面再オープンで個別に戻る。
- **VALIDATE**: `npx tsc --noEmit` + `npm run lint` でエラーなし。

### Task 4: `LevelTable.test.tsx` にトグルの振る舞いテストを追加

- **ACTION**: [LevelTable.test.tsx](../../../../src/components/structure/LevelTable.test.tsx) に `describe("LevelTable — 一括時間設定", ...)` を追加。
- **IMPLEMENT**: 以下のケース:
  - 既定では個別モード（`duration-mode-individual` が checked / `bulk-duration-min` 入力が非表示 / 行の分入力が enabled）
  - 一括に切替えると `bulk-duration-min` が表示され、行ごとの分入力が `disabled`
  - 一括分入力を `15` に変更すると `onChange` が全行 `durationSec: 900`（break 行含む）で呼ばれる
  - 個別→一括の切替時、不揃いな duration が先頭行値で unify されて `onChange` が呼ばれる
  - 一括→個別に戻すと行の分入力が再び enabled（`onChange` で値は破壊しない）
- **MIRROR**: TEST_STRUCTURE（`getByLabelText` + `.disabled` / `fireEvent.change` + `onChange` の `expect.objectContaining`）。
- **IMPORTS**: 既存 import（`fireEvent` / `render` / `screen` / `vi`）で充足。break 行を含む fixture を local に追加。
- **GOTCHA**: radio の切替は `fireEvent.click(screen.getByLabelText("duration-mode-bulk"))`。複数行の `onChange` 検証は配列全体を `expect.objectContaining` 並べる既存作法に合わせる。
- **VALIDATE**: `npm test -- LevelTable` が全件 green（既存 12 件 + 新規）。

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| `applyBulkDurationMin` 全行一律 | 3 行（play×2 + break×1）, min=15 | 全行 `durationSec=900`、他フィールド不変 | break 含む |
| `applyBulkDurationMin` 他フィールド保持 | sb/bb/ante/isBreak 各種 | level/sb/bb/ante/isBreak 不変 | — |
| `minToDurationSec` 下限 | `0` / `-5` | `60` | ゼロ・負値 |
| `minToDurationSec` 通常 | `10` | `600` | — |
| `inferBulkDurationMin` 揃い | 全行 600 秒 | `10` | — |
| `inferBulkDurationMin` 空 | `[]` | `10` | 空配列 |
| `inferBulkDurationMin` 不揃い | 600/1200 秒 | 先頭行の分（10） | 不揃い |
| トグル既定 | render 直後 | 個別 checked / 行入力 enabled | — |
| 一括切替で disabled | bulk 選択 | 行の分入力 `disabled=true` | — |
| 一括入力で全行反映 | `bulk-duration-min`=15 | `onChange` 全行 `durationSec=900` | break 含む |
| 個別→一括で unify | 不揃い fixture | `onChange` 全行が先頭値で揃う | — |

### Edge Cases Checklist

- [x] Empty input（`bulk-duration-min` 空 → NaN→0→60 秒に倒す）
- [x] Maximum size input（大きな分値でも秒変換のみ、上限制約は schema になし）
- [x] Invalid types（`parseIntSafe` が NaN を 0 に吸収）
- [ ] Concurrent access（N/A — ローカル UI state のみ）
- [ ] Network failure（N/A — repository / Firestore に触れない）
- [ ] Permission denied（N/A — 既存 organizer gate を変更しない）
- [x] break 行を含む一律代入（全行に適用）

---

## Validation Commands

### Static Analysis

```bash
npx tsc --noEmit
```

EXPECT: Zero type errors

### Unit Tests（該当領域）

```bash
npm test -- structure-levels
npm test -- LevelTable
```

EXPECT: All tests pass（純関数 + トグル UI）

### Lint

```bash
npm run lint
```

EXPECT: No lint errors（`console.*` 残置なし / import 整列）

### Full Test Suite

```bash
npm test
```

EXPECT: No regressions（既存 LevelTable 12 件含む全件 green）

### Browser Validation

```bash
npm run dev
```

EXPECT: `/structures/new` と `/structures/[sid]/edit` で「個別/一括」トグルが表示され、一括選択 → 1 入力で全行の分が揃い、保存できる。

### Manual Validation

- [ ] `/structures/new` を開く（organizer で）。既定が個別モードであることを確認
- [ ] 一括に切替 → 分を 1 つ入力 → 全レベル（ブレイク含む）の分が揃う
- [ ] 個別に戻す → 行ごとに編集でき、一括で揃えた値が破壊されていない
- [ ] そのまま「作成」→ `/structures` 一覧に保存される
- [ ] `/structures/[sid]/edit` でも同じトグルが機能し、保存できる

---

## Acceptance Criteria

- [ ] 全タスク完了
- [ ] 全 validation コマンド pass
- [ ] テスト作成・green（純関数 + トグル UI）
- [ ] 型エラーなし
- [ ] lint エラーなし
- [ ] UX デザイン（個別/一括トグル）に一致

## Completion Checklist

- [ ] `autoSbHalf` パターンに沿ったトグル実装
- [ ] error/log 規約（[error-logging.md](../../../../.claude/rules/error-logging.md)）— 本変更は例外処理を持たない純 UI / 純関数のため `AppError` / logger は不要（repository 層に触れない）
- [ ] テストは [testing.md](../../../../.claude/rules/testing.md) の純関数 characterization + component 振る舞い検証の作法に従う
- [ ] ハードコード値なし（分→秒は `minToDurationSec` に集約）
- [ ] schema / repository / rules 不変（不要なスコープ追加なし）
- [ ] 実装と test を同一 commit にペアで含める（testing.md「新規機能と test の commit セット」）

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| 一括 ON 切替で意図せず既存の不揃い duration を上書き | M | L | UX 上「一括設定」を能動選択した時のみ unify。`autoSbHalf` OFF→ON と同じ既知作法で挙動を統一。個別に戻せば再編集可能 |
| break 行も一律代入されるのが想定外 | L | L | 決定ログ「全レベル一律同じ分数」に明記。test で break 含む代入を固定 |
| 既存 LevelTable test の回帰 | L | M | 既存 12 件は触らず追加のみ。`npm test -- LevelTable` で全件確認 |
| 永続化なしで毎回個別に戻るのが不便 | L | L | Open Question の決定（永続化は Could / 今回未実装）。将来 localStorage 化は別 plan |

## Notes

- **配置判断**: 純関数を `src/lib/services/structure-levels.ts` に置くのは、[testing.md](../../../../.claude/rules/testing.md) が precedent として挙げる `tournament-state.ts`（純関数 + characterization test）に倣ったもの。component から service を import する向きは既存の依存方向と一致。
- **schema 不変の根拠**: [structure.ts:18](../../../../src/lib/firebase/schemas/structure.ts#L18) の `durationSec: z.number().int().positive()` を `minToDurationSec` が常に満たす（最低 60 秒）。`levelSchema` の break refine（`isBreak || bb > 0`）にも一括代入は影響しない（`durationSec` のみ変更）。
- **consumer 不変の根拠**: `LevelTable` の props 契約（`levels` / `onChange`）は変えないため、[StructureForm.tsx:240](../../../../src/components/structure/StructureForm.tsx#L240) と新規/編集クライアントは無変更。
- **E2E 不要の判断**: 本機能はローカル UI state のみで Firestore rule / 複数端末同期に関与しない。[testing.md](../../../../.claude/rules/testing.md)「E2E と unit の分担」に従い unit（純関数 + component 振る舞い）で十分。保存自体の E2E は既存 structure-templates の picker フローで担保済み。
