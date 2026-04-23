# Plan: ストラクチャフォームに「SB を BB の半額で自動入力」トグル追加

## Summary

ストラクチャ作成 / 編集フォーム（[LevelTable](../../../src/components/structure/LevelTable.tsx)）に
**「SB を BB の半額で自動入力」チェックボックス**（デフォルト ON）を追加する。ON のときは
SB 入力欄を `disabled` にし、BB 入力が変更されたタイミングで SB を `Math.floor(bb / 2)` に
自動追従させる。OFF のときは従来通り SB を手動編集できる。

業界標準（WSOP / PokerStars）に沿って**列順は `SB → BB → Ante → 分 → BREAK` のまま**とする。
BB→SB 列反転は行わない（前回ユーザーとの調査で業界慣習優先と合意）。

## User Story

As a サークル運営者,
I want BB を決めたら SB が自動で半額に埋まるモードを ON/OFF できるフォーム,
So that TDA 標準の NLH 運用では BB だけ入力して SB を自動化でき、変則ブラインド
（SB ≠ BB/2）を設定する場合は OFF に切り替えて手動入力できる。

## Problem → Solution

- **現状**: 列順は `SB → BB → Ante → 分 → BREAK`。BB を変える度に SB も手で半額に打ち直す
  必要があり、ヒューマンエラーの温床になっている。
- **目標**: 列順は維持しつつ「SB 自動入力 ON」チェックボックスを追加する。ON がデフォルトで、
  BB を変更すると SB が自動で `Math.floor(bb / 2)` になる。SB 入力欄は ON 時に disabled となり、
  「いま自動モード」が視覚的に一目で分かる。変則運用したい運営者は OFF にできる。

## Metadata

- **Complexity**: Small
- **Source PRD**: N/A（standalone UX 改善）
- **PRD Phase**: N/A
- **Estimated Files**: 1 変更 + 1 新規テスト

---

## UX Design

### Before

```
┌── ブラインド構造 ──────────────────────────────────────────┐
│ Lv │   SB   │   BB   │  Ante  │   分   │ BREAK │   ×   │
│  1 │  [25]  │  [50]  │   [0]  │  [10]  │  □    │  🗑    │
│  2 │  [50]  │  [100] │   [0]  │  [10]  │  □    │  🗑    │
└────────────────────────────────────────────────────────────┘
            [レベルを追加]

BB を 100 → 200 に変えたあと、SB も手で 50 → 100 に打ち直す必要がある。
```

### After

```
┌── ブラインド構造 ──────────────────────────────────────────┐
│ [✓] SB を BB の半額で自動入力                              │
│                                                            │
│ Lv │   SB   │   BB   │  Ante  │   分   │ BREAK │   ×   │
│  1 │ ⟨25⟩   │  [50]  │   [0]  │  [10]  │  □    │  🗑    │
│  2 │ ⟨50⟩   │  [100] │   [0]  │  [10]  │  □    │  🗑    │
└────────────────────────────────────────────────────────────┘
            [レベルを追加]

⟨⟩ は disabled 表示。BB を 100 → 200 に変えた瞬間、同じ行の SB が自動で
100 に更新される。チェックを外すと SB が編集可能になり、手動で任意値を
入れられる（変則ブラインド運用）。
```

### Interaction Changes

| Touchpoint | Before | After | Notes |
| ---------- | ------ | ----- | ----- |
| テーブル上部 | チェックボックスなし | 「SB を BB の半額で自動入力」チェック | 新規作成時はデフォルト ON |
| 編集画面の起動時 | — | 既存 levels の全プレイレベルで `sb === Math.floor(bb / 2)` を満たせば ON、1 行でも外れていれば OFF | 既存データが変則ブラインドの場合に誤って上書きしないため |
| SB Input | 常に編集可 | **ON 時は `disabled`**、OFF 時は編集可 | 「自動モード」の視覚フィードバック |
| BB Input の onChange（ON 時） | 当該行の `bb` のみ更新 | 当該行の `bb` と `sb` を同時更新（`sb = Math.floor(bb / 2)`） | 奇数 BB は切り下げ（BB=101 → SB=50） |
| BB Input の onChange（OFF 時） | 当該行の `bb` のみ更新 | 同左（従来通り） | OFF は完全に従来挙動 |
| チェック ON→OFF | — | 何も変更しない。SB は現在値を保持したまま編集可に | ユーザーが変則 SB を入れ始める経路 |
| チェック OFF→ON | — | **全プレイレベルの SB を `Math.floor(bb/2)` に一括再計算** | 「ON の意味 = SB は常に BB/2」をモデルとして明確化。手動 SB は失われる |
| 列順 | `SB → BB → Ante → 分 → BREAK` | **同左（変更なし）** | WSOP / PokerStars の業界慣習を踏襲 |
| BREAK チェック | sb/bb/ante=0 にリセット | 同左 | 変更なし |
| BREAK 解除 | `bb = max(1, bb)` に復帰 | 同左 | 変更なし（SB は 0 のまま。ON モードなら次に BB を変えた瞬間に半額へ追従、OFF なら手入力） |
| レベル追加ボタン | last.sb\*2, last.bb\*2 で追加 | 同左 | 既存ロジック維持。BB=SB\*2 の関係を保つためどちらのモードでも自然 |

---

## Mandatory Reading

| Priority | File | Lines | Why |
| -------- | ---- | ----- | --- |
| P0 | [src/components/structure/LevelTable.tsx](../../../src/components/structure/LevelTable.tsx) | 全行 | 唯一の変更対象コンポーネント。列順・`updateChip`・BREAK toggle の既存挙動を把握 |
| P0 | [src/lib/firebase/schemas/structure.ts](../../../src/lib/firebase/schemas/structure.ts) | 12-25 | `levelSchema` の制約。`sb.nonnegative()` / `bb.nonnegative()` / `!isBreak ⇒ bb>0` refine。SB=0 は valid、BB=0 はプレイレベルで invalid |
| P1 | [src/components/structure/StructureForm.tsx](../../../src/components/structure/StructureForm.tsx) | 63-67, 99, 240 | `DEFAULT_INITIAL.levels` の初期値（SB=25 / BB=50）と LevelTable の呼び出し。本プランでは触らない |
| P1 | [src/components/ui/input.tsx](../../../src/components/ui/input.tsx) | 全行 | `disabled` 時のスタイリング確認（既存の opacity-50 / cursor-not-allowed が自動モードの視覚ヒントになる） |
| P2 | [src/components/structure/StructureTemplateCard.test.tsx](../../../src/components/structure/StructureTemplateCard.test.tsx) | 1-50 | vitest + @testing-library/react の使い方リファレンス |
| P2 | [.claude/rules/error-logging.md](../../rules/error-logging.md) | 全行 | UI コンポーネント内で try/catch を足さない方針（本プランは純 UI なので例外ハンドリング不要） |

## External Documentation

No external research needed — feature uses established internal patterns（React state + vitest + Testing Library + shadcn/ui の Input/Label）.

---

## Patterns to Mirror

### CHECKBOX_PATTERN（既存の break トグル）

```tsx
// SOURCE: src/components/structure/LevelTable.tsx:131-137
<input
  type="checkbox"
  checked={l.isBreak}
  onChange={(e) => toggleBreak(i, e.target.checked)}
  aria-label={`level-${l.level}-is-break`}
/>
```

→ 自動入力チェックも同じ素の `<input type="checkbox">` を使う。shadcn 追加コンポーネントは不要。
  ラベルは `<label>` でラップし、クリック領域を広げる。aria-label は `auto-sb-half` 固定。

### STATE_UPDATE_PATTERN（`levels.map(...)` で immutable に更新）

```ts
// SOURCE: src/components/structure/LevelTable.tsx:26-30
function updateChip(index: number, field: ChipField, value: string) {
  const n = parseIntSafe(value);
  const next = levels.map((l, i) => (i === index ? { ...l, [field]: n } : l));
  onChange(next);
}
```

→ ON 時の BB 分岐で `{ ...l, bb: n, sb: Math.floor(n / 2) }` の形で 2 フィールド同時更新。
  OFF 時は従来通り `{ ...l, [field]: n }`。SB フィールドは ON 時に disabled なので onChange が
  そもそも発火しないが、防御的にロジック側でも `field === "sb" && autoSbHalf` は無視する。

### NAMING_CONVENTION

```ts
// SOURCE: src/components/structure/LevelTable.tsx:14-23
type ChipField = "sb" | "bb" | "ante";

function parseIntSafe(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}
```

→ 新規 util は追加しない。`parseIntSafe` を再利用。

### BREAK_TOGGLE_PATTERN（refine 通過のための 0 リセット／1 復帰）

```ts
// SOURCE: src/components/structure/LevelTable.tsx:39-50
function toggleBreak(index: number, checked: boolean) {
  const next = levels.map((l, i) => {
    if (i !== index) return l;
    if (checked) return { ...l, isBreak: true, sb: 0, bb: 0, ante: 0 };
    return { ...l, isBreak: false, bb: Math.max(1, l.bb) };
  });
  onChange(next);
}
```

→ 触らない。autoSbHalf の状態は break トグルと独立。break 解除直後は bb=1/sb=0 の状態から始まるが、
  ON モードならユーザーが BB を再入力した瞬間に SB が半額に追従する。

### TEST_STRUCTURE（vitest + Testing Library）

```tsx
// SOURCE: src/components/structure/StructureTemplateCard.test.tsx:1-45
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
```

→ [src/components/structure/LevelTable.test.tsx](../../../src/components/structure/LevelTable.test.tsx)
  新規作成。`fireEvent.click(screen.getByLabelText("auto-sb-half"))` でチェック切替、
  `fireEvent.change(screen.getByLabelText("level-1-bb"), {...})` で入力。

---

## Files to Change

| File | Action | Justification |
| ---- | ------ | ------------- |
| [src/components/structure/LevelTable.tsx](../../../src/components/structure/LevelTable.tsx) | UPDATE | `autoSbHalf` ローカル state 追加、初期値推定関数、`updateChip` の BB 分岐、SB Input の disabled、OFF→ON 切替時の一括再計算 |
| [src/components/structure/LevelTable.test.tsx](../../../src/components/structure/LevelTable.test.tsx) | CREATE | チェックボックスの初期値推定／ON 時の BB→SB 追従／OFF 時の従来挙動／ON↔OFF 切替の単体テスト |
| （参考）[src/components/structure/StructureForm.tsx](../../../src/components/structure/StructureForm.tsx) | NO-OP | 列順・初期値は本プランで触らない。`DEFAULT_INITIAL.levels` は SB=BB/2 を満たすため新規作成時 ON でも整合 |

## NOT Building

- **列順の反転（BB→SB）**: 業界標準（WSOP / PokerStars）は SB→BB のため維持。ユーザーとの調査合意に基づく
- **`autoSbHalf` の Firestore 永続化**: 状態は UI ローカルのみ。次回の編集画面起動時は levels の値を
  見て自動推定する（保存不要）
- **OFF→ON 切替時の確認ダイアログ**: 手動 SB を保護する UX は見送る。変則運用は OFF のままにしておけば守られる。
  ON を選ぶ = 「SB は常に BB/2 でいい」という意思表示として扱う
- **行ごとのチェックボックス**: 全行共通の 1 トグルで十分（NLH 運用では通常全レベル統一のため）
- **schema 側の `sb = bb/2` 強制 refine**: 運営によっては変則 SB を使うので schema 上は `sb: nonnegative` のまま維持
- **既存 Firestore doc のマイグレーション**: スキーマ不変のため不要
- **`addRow` の初期値変更**: `last.sb * 2 / last.bb * 2` は既に BB=SB\*2 の関係を保つため不変
- **E2E テストの追加**: 単体テストで十分。Playwright 側では aria-label が維持されるため既存
  [tests/e2e/structure-templates.spec.ts](../../../tests/e2e/structure-templates.spec.ts) は影響なし

---

## Step-by-Step Tasks

### Task 1: 初期値推定 util `inferAutoSbHalfFromLevels` を追加

- **ACTION**: [src/components/structure/LevelTable.tsx](../../../src/components/structure/LevelTable.tsx) 冒頭の util 群に追加
- **IMPLEMENT**:
  ```ts
  function inferAutoSbHalfFromLevels(levels: Level[]): boolean {
    // プレイレベル（!isBreak）すべてで sb === floor(bb/2) を満たせば ON 推定。
    // プレイレベルが 1 つも無い（= 全 break）場合は新規扱いで ON。
    const playLevels = levels.filter((l) => !l.isBreak);
    if (playLevels.length === 0) return true;
    return playLevels.every((l) => l.sb === Math.floor(l.bb / 2));
  }
  ```
- **MIRROR**: `NAMING_CONVENTION`（`secToMin` / `parseIntSafe` と同じトップレベル純粋関数）
- **IMPORTS**: 変更不要
- **GOTCHA**:
  - break 行は BB=0 / SB=0 で `floor(0/2)=0` を満たすが、無視しても結論は同じ。明示的に
    フィルタしてロジックを理解しやすくする
  - プレイレベル 0 件（= 全 break の変則）は通常起きないが、防御的に ON 扱いに倒す
- **VALIDATE**: Task 5 のユニットテストで初期推定の 3 ケース（全行 SB=BB/2 / 1 行ずれ / 全 break）を assert

### Task 2: `useState<boolean>(inferAutoSbHalfFromLevels(initialValue.levels))` を追加

- **ACTION**: `LevelTable` の関数本体冒頭に state 追加
- **IMPLEMENT**:
  ```ts
  const [autoSbHalf, setAutoSbHalf] = useState<boolean>(() =>
    inferAutoSbHalfFromLevels(levels),
  );
  ```
- **MIRROR**: `useState` の lazy initializer は StructureForm.tsx:91-99 で既に使われているパターン
- **IMPORTS**: `useState` は既に import 済み（[L3 `import { useState } from "react"`](../../../src/components/structure/LevelTable.tsx) ではなく、ここは現状未 import。`"react"` から追加する）
- **GOTCHA**:
  - **現状 LevelTable は useState を import していない**。L3 付近に `import { useState } from "react";` を追加する
  - 初期値は lazy initializer（`() => ...`）で評価するとレンダ毎再計算を防げる
  - props の `levels` は親（StructureForm）の state なので、親で levels が差し替わっても
    `autoSbHalf` を強制同期する必要は無い（編集画面は一度マウントされたら初期値で固定）
- **VALIDATE**: Task 5 のユニットテストで「SB=BB/2 の初期 levels → checked、1 行ずれた levels → unchecked」を確認

### Task 3: チェックボックス UI を `<table>` の直前に追加

- **ACTION**: `return (...)` の `<div className="space-y-2">` 内、`<div className="overflow-x-auto">` の上に配置
- **IMPLEMENT**:
  ```tsx
  <label className="flex items-center gap-2 text-sm">
    <input
      type="checkbox"
      checked={autoSbHalf}
      onChange={(e) => handleAutoSbHalfToggle(e.target.checked)}
      aria-label="auto-sb-half"
    />
    <span>SB を BB の半額で自動入力</span>
  </label>
  ```
- **MIRROR**: `CHECKBOX_PATTERN`（既存 break トグルと同じ素の `<input type="checkbox">`）
- **IMPORTS**: 変更不要
- **GOTCHA**:
  - shadcn の Checkbox コンポーネントは導入されていないため、プロジェクト慣習（素の input）に合わせる
  - aria-label は `"auto-sb-half"` 固定（level-指定ではなくフォーム全体の 1 個）
  - `<label>` でラップすることでチェックボックス + 文言のどちらをクリックしても切替できる
- **VALIDATE**: `screen.getByLabelText("auto-sb-half")` でアクセスできる

### Task 4: `handleAutoSbHalfToggle` と `updateChip` のロジック拡張

- **ACTION**: LevelTable.tsx 内に `handleAutoSbHalfToggle` を追加し、`updateChip` の BB 分岐を条件付きに
- **IMPLEMENT**:
  ```ts
  function handleAutoSbHalfToggle(checked: boolean) {
    setAutoSbHalf(checked);
    if (!checked) return; // ON→OFF は何もしない
    // OFF→ON: プレイレベルの SB を一括で floor(bb/2) に再計算
    const next = levels.map((l) =>
      l.isBreak ? l : { ...l, sb: Math.floor(l.bb / 2) },
    );
    onChange(next);
  }

  function updateChip(index: number, field: ChipField, value: string) {
    const n = parseIntSafe(value);
    const next = levels.map((l, i) => {
      if (i !== index) return l;
      if (field === "bb" && autoSbHalf) {
        return { ...l, bb: n, sb: Math.floor(n / 2) };
      }
      return { ...l, [field]: n };
    });
    onChange(next);
  }
  ```
- **MIRROR**: `STATE_UPDATE_PATTERN`（`levels.map(...)` で immutable 更新）
- **IMPORTS**: 変更不要
- **GOTCHA**:
  - `Math.floor(bb / 2)` を使う。`Math.round` は BB=3→SB=2 となり「半額」の直感から外れる
  - BB=1 のとき SB=0。`levelSchema` の `sb: nonnegative()` と refine（`bb>0`）を両方通るので valid
  - BREAK 行は input が `disabled` のため `updateChip` が呼ばれない + `handleAutoSbHalfToggle` では
    明示的に `l.isBreak` をスキップ
  - ON→OFF 時に手動 SB を復元する機能は提供しない（NOT Building 節で宣言済み）
- **VALIDATE**: Task 5 のユニットテストで「ON 時 BB=200 → SB=100」「OFF 時 BB=200 → SB は変わらず」
  「OFF→ON 切替で全 SB が一括再計算される」を検証

### Task 5: SB Input に `disabled={l.isBreak || autoSbHalf}` を追加

- **ACTION**: tbody 内の SB 列の `<Input>` の disabled 条件を拡張
- **IMPLEMENT**:
  ```tsx
  <Input
    type="number"
    min={0}
    value={l.sb}
    disabled={l.isBreak || autoSbHalf}
    onChange={(e) => updateChip(i, "sb", e.target.value)}
    aria-label={`level-${l.level}-sb`}
  />
  ```
- **MIRROR**: 既存の `disabled={l.isBreak}` パターン（BB / Ante 列と同形）
- **IMPORTS**: 変更不要
- **GOTCHA**:
  - BB / Ante / 分 の input は触らない。BB は常に編集可
  - `disabled` な input でも `value={l.sb}` は表示されるので「自動計算結果が見える」状態になる
  - shadcn の Input は `disabled` 時に `opacity-50` / `cursor-not-allowed` が入り、視覚的に
    「読み取り専用」と分かる
- **VALIDATE**: Task 6 のユニットテストで「ON 時 SB input が disabled」「OFF 時 SB input が enabled」を検証

### Task 6: `LevelTable.test.tsx` を新規作成

- **ACTION**: [src/components/structure/LevelTable.test.tsx](../../../src/components/structure/LevelTable.test.tsx) を新規作成
- **IMPLEMENT**:
  ```tsx
  import { fireEvent, render, screen } from "@testing-library/react";
  import { describe, expect, it, vi } from "vitest";

  import type { Level } from "@/lib/firebase/schemas/structure";

  import { LevelTable } from "./LevelTable";

  function makeLevels(): Level[] {
    return [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
    ];
  }

  describe("LevelTable — 自動入力トグル", () => {
    it("初期レベルが全行 SB=BB/2 を満たすならチェックは ON（checked）", () => {
      render(<LevelTable levels={makeLevels()} onChange={vi.fn()} />);
      expect(screen.getByLabelText<HTMLInputElement>("auto-sb-half").checked).toBe(true);
    });

    it("初期レベルが 1 行でも SB=BB/2 を満たさないならチェックは OFF", () => {
      const variant: Level[] = [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 80, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      ];
      render(<LevelTable levels={variant} onChange={vi.fn()} />);
      expect(screen.getByLabelText<HTMLInputElement>("auto-sb-half").checked).toBe(false);
    });

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

    it("ON 時、奇数 BB は floor で SB を計算する（BB=101 → SB=50）", () => {
      const onChange = vi.fn();
      render(<LevelTable levels={makeLevels()} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("level-1-bb"), { target: { value: "101" } });
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ level: 1, bb: 101, sb: 50 }),
        expect.anything(),
      ]);
    });

    it("ON 時、BB=1 のとき SB=0（schema の sb.nonnegative() に適合）", () => {
      const onChange = vi.fn();
      render(<LevelTable levels={makeLevels()} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("level-1-bb"), { target: { value: "1" } });
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ level: 1, bb: 1, sb: 0 }),
        expect.anything(),
      ]);
    });

    it("OFF に切り替えると SB input が enabled になり、BB 変更で SB が変わらない", () => {
      const onChange = vi.fn();
      render(<LevelTable levels={makeLevels()} onChange={onChange} />);
      fireEvent.click(screen.getByLabelText("auto-sb-half")); // ON → OFF
      onChange.mockClear();

      expect(screen.getByLabelText<HTMLInputElement>("level-1-sb").disabled).toBe(false);

      fireEvent.change(screen.getByLabelText("level-1-bb"), { target: { value: "200" } });
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ level: 1, bb: 200, sb: 25 }), // SB は元の 25 のまま
        expect.anything(),
      ]);
    });

    it("OFF 状態で SB を手動変更できる", () => {
      const onChange = vi.fn();
      // 初期が SB≠BB/2 なので OFF で起動
      const variant: Level[] = [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 80, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      ];
      render(<LevelTable levels={variant} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("level-2-sb"), { target: { value: "77" } });
      expect(onChange).toHaveBeenCalledWith([
        expect.anything(),
        expect.objectContaining({ level: 2, sb: 77, bb: 100 }),
      ]);
    });

    it("OFF → ON に切り替えると全プレイレベルの SB が一括で floor(bb/2) に再計算される", () => {
      const onChange = vi.fn();
      const variant: Level[] = [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 80, bb: 100, ante: 0, durationSec: 600, isBreak: false }, // 変則
        { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 600, isBreak: true }, // break は触らない
      ];
      render(<LevelTable levels={variant} onChange={onChange} />);
      // OFF で起動している前提（1 行ずれているため）
      expect(screen.getByLabelText<HTMLInputElement>("auto-sb-half").checked).toBe(false);

      fireEvent.click(screen.getByLabelText("auto-sb-half")); // OFF → ON
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ level: 1, sb: 25, bb: 50 }),
        expect.objectContaining({ level: 2, sb: 50, bb: 100 }), // 80 → 50 に再計算
        expect.objectContaining({ level: 3, sb: 0, bb: 0, isBreak: true }), // break 行は不変
      ]);
    });

    it("列順は SB → BB → Ante → 分 → BREAK（業界慣習通り、変更なし）", () => {
      render(<LevelTable levels={makeLevels()} onChange={vi.fn()} />);
      const headers = screen
        .getAllByRole("columnheader")
        .map((th) => th.textContent?.trim() ?? "");
      expect(headers.slice(0, 6)).toEqual(["Lv", "SB", "BB", "Ante", "分", "BREAK"]);
    });

    it("Ante 変更は BB/SB に影響しない", () => {
      const onChange = vi.fn();
      render(<LevelTable levels={makeLevels()} onChange={onChange} />);
      fireEvent.change(screen.getByLabelText("level-1-ante"), { target: { value: "10" } });
      expect(onChange).toHaveBeenCalledWith([
        expect.objectContaining({ level: 1, sb: 25, bb: 50, ante: 10 }),
        expect.anything(),
      ]);
    });
  });
  ```
- **MIRROR**: `TEST_STRUCTURE`（[src/components/structure/StructureTemplateCard.test.tsx](../../../src/components/structure/StructureTemplateCard.test.tsx)）
- **IMPORTS**: `@testing-library/react` / `vitest` / `Level` 型 / `LevelTable`
- **GOTCHA**:
  - `getByLabelText<HTMLInputElement>("auto-sb-half").checked` のように generics で型を絞ると `.checked` / `.disabled` にアクセスできる
  - `fireEvent.click` で素の checkbox を切り替えできる（shadcn Checkbox は使っていないため）
  - `onChange.mockClear()` を使って「トグル以降の呼び出しだけ」を検証するテストケースがある
  - break 行のテストでは `isBreak: true, bb: 0, sb: 0` を明示
- **VALIDATE**: `npx vitest run src/components/structure/LevelTable.test.tsx` が全 10 ケース green

### Task 7: ビルド／型／Lint の最終確認

- **ACTION**: プロジェクトのチェックを全回し
- **IMPLEMENT**: コマンド実行のみ（コード変更なし）
- **MIRROR**: n/a
- **IMPORTS**: n/a
- **GOTCHA**:
  - StructureTemplateCard.test.tsx が隣接しているので全体 vitest で回帰がないか確認
  - Next.js の lint は `--fix` せず、警告 0 を確認
- **VALIDATE**:
  ```bash
  npm run typecheck
  npm run lint
  npm run test
  ```

---

## Testing Strategy

### Unit Tests

| Test | Input | Expected Output | Edge Case? |
| ---- | ----- | --------------- | ---------- |
| 初期 ON 推定 | 全行 SB=BB/2 の levels | checkbox checked | no |
| 初期 OFF 推定 | 1 行だけ SB≠BB/2 | checkbox unchecked | yes |
| ON 時 SB disabled | ON + 通常 levels | `level-1-sb` input の disabled=true | no |
| ON 時 BB 通常変更 | row1.bb に "200" | onChange で row1 = {bb:200, sb:100} | no |
| ON 時 BB 奇数 | row1.bb に "101" | row1 = {bb:101, sb:50} (floor) | yes |
| ON 時 BB=1 | row1.bb に "1" | row1 = {bb:1, sb:0} | yes |
| OFF 切替で enabled | トグル click | `level-1-sb` の disabled=false | no |
| OFF 時 BB 変更で SB 不変 | OFF 後に row1.bb="200" | row1 = {bb:200, sb:25}（SB 元のまま） | yes |
| OFF 時 SB 手動変更 | 初期 OFF で row2.sb="77" | row2 = {sb:77, bb:100} | no |
| OFF→ON 一括再計算 | 変則 levels で toggle | プレイレベル全行で SB=floor(bb/2)、break 行不変 | yes |
| 列順 thead | 2 行の levels | `["Lv","SB","BB","Ante","分","BREAK"]` | no |
| Ante 変更 | row1.ante="10" | row1 = {sb:25, bb:50, ante:10} | no |

### Edge Cases Checklist

- [x] BB=1（SB=0 境界）
- [x] BB に非数値文字列（`parseIntSafe` で 0 に丸め → SB=0）
- [x] BB=奇数（`Math.floor` で半端切り捨て）
- [x] 既存データが変則 SB（SB≠BB/2）の編集画面で誤って再計算しない → OFF で起動
- [x] OFF 中に SB 手動編集した値が ON→OFF のラウンドトリップで保持される（ON→OFF 時は無変更）
- [x] break 行は ON↔OFF 切替でも SB=0 のまま
- [x] BREAK 時は input 自体 disabled で到達しない
- [ ] 並行アクセス（該当なし — ローカル state のみ）
- [ ] ネットワーク失敗（該当なし — 永続化層を触らない）

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

EXPECT: No warnings or errors

### Unit Tests

```bash
npx vitest run src/components/structure/LevelTable.test.tsx
```

EXPECT: 10 / 10 passing

### Full Test Suite

```bash
npm run test
```

EXPECT: 全既存スイート + 新規 LevelTable.test.tsx green。回帰なし

### Browser Validation

```bash
npm run dev
```

- `/structures/new` に遷移
- テーブル上部に「SB を BB の半額で自動入力」チェックが表示され、**デフォルト ON**
- Level 1 の SB input が **disabled（グレーアウト）** になっている
- Level 1 の BB input を 50 → 200 に変更すると、同じ行の SB が 25 → 100 に自動で変わる
- チェックを外すと SB input が **enabled** に戻り、手動編集できる
- 手動で SB=80 に変更した後に BB を 100 → 200 に変更しても SB は 80 のまま維持される
- チェックを再度 ON にすると全プレイレベルの SB が BB/2 に戻る
- BREAK チェックを入れると BB / SB / Ante の 3 列すべて disabled になり 0 表示になる
- `/templates/new` でも同じ挙動
- 既存ストラクチャの編集画面 `/structures/{sid}/edit` で、保存済みの levels が SB=BB/2 を満たしていれば
  チェックが **自動 ON**、変則 SB が含まれていれば **自動 OFF** で起動する

### Manual Validation

- [ ] `/structures/new`: デフォルト ON、BB→SB 自動追従を目視確認
- [ ] `/templates/new`: 同じ挙動
- [ ] `/structures/{sid}/edit`: 既存の標準データ（SB=BB/2）→ 自動 ON で起動
- [ ] 変則ブラインドのストラクチャを 1 個手動で作り（OFF → SB 手入力 → 保存）、再度編集画面を
  開いたときに **自動 OFF で起動すること**を確認
- [ ] BB=1 を入力して submit すると zod バリデーションが通る（`sb=0` / `bb=1` で refine 通過）
- [ ] BREAK ON → OFF 切替で input が再度 enabled になり、ON モードなら BB 再入力で SB=BB/2 が適用される
- [ ] ON → OFF → ON のラウンドトリップで、中間で手動変更した SB が最後の ON で上書きされる
  （意図した挙動）

---

## Acceptance Criteria

- [ ] Task 1-7 すべて完了
- [ ] `npm run typecheck` / `npm run lint` / `npm run test` すべて green
- [ ] `LevelTable.test.tsx` 新規 10 ケース pass
- [ ] 手動で `/structures/new` / `/templates/new` / `/structures/{sid}/edit` の 3 経路で UX が一致
- [ ] 既存テスト（`StructureTemplateCard.test.tsx` 等）に回帰なし
- [ ] 列順は SB → BB → Ante → 分 → BREAK（変更していない）

## Completion Checklist

- [ ] `updateChip` の BB 分岐で `Math.floor(bb/2)` を使用（`Math.round` / 小数除算にしない）
- [ ] `autoSbHalf` state のデフォルトは `inferAutoSbHalfFromLevels(levels)` で推定
- [ ] SB Input の disabled は `l.isBreak || autoSbHalf`
- [ ] OFF→ON 切替でプレイレベルのみ再計算、break 行は触らない
- [ ] `aria-label="auto-sb-half"` / `aria-label="level-{lv}-sb"` 等の既存 a11y ラベルを維持
- [ ] error-logging / firebase-patterns ルールに抵触しない（UI のみの変更で repository / schema に手を入れない）
- [ ] Self-contained — 実装時にフォーム外の他ファイルを再探索する必要がない

## Risks

| Risk | Likelihood | Impact | Mitigation |
| ---- | ---------- | ------ | ---------- |
| OFF→ON 切替で手動 SB が失われたことに気付かずにユーザーが驚く | Low | Low | disabled 時の visual feedback（opacity-50）と disabled 挙動の組合せで「自動計算中＝手動値は上書きされる」モデルは直感的。将来必要なら確認 Dialog を追加 |
| 既存ストラクチャの編集画面で推定が外れる（標準データなのに OFF で起動） | Very Low | Low | `inferAutoSbHalfFromLevels` は全プレイレベル厳密一致なので、保存済みデータが整合していれば必ず ON になる。もしずれるなら既存データ側が変則 |
| BB=奇数時の SB=floor 値（例 BB=51 → SB=25）を意図と違うと感じるユーザー | Low | Low | `Math.floor` は NLH 標準（ブラインドは偶数運用が既定）。OFF にして手動入力可能 |
| テンプレと本体フォームで挙動が食い違うリスク | Very Low | Medium | 両画面とも同じ `LevelTable` を使うため、コンポーネント単位の修正で同時に解決 |

## Notes

- `Math.floor(bb / 2)` を採用した理由: `Math.round` だと BB=3 → SB=2 になり「半額」の直感から外れる。
  また BB=1 → SB=0 を許容するのも schema の `sb.nonnegative()` に合致
- チェックボックス 1 個をフォーム全体に置く理由: NLH の通常運用では全レベル統一（SB=BB/2）が前提で、
  行ごとの設定は過剰。変則ブラインドを混在させたい運営者は OFF にして手動制御する
- OFF→ON 時に確認ダイアログを出さない理由: 確認 UI は複雑度に見合う価値が乏しい。
  「ON の意味 = SB は常に BB/2」というモデルを明確化し、逆方向の安全装置は不要とする
- 将来「手動 SB の stickiness を保持したい」需要が出た場合は、行ごとに `sbTouched: boolean` を
  useRef で持ち、ON モードでも touched 行はスキップする実装に差し替えられる。今回のスコープ外
- 業界慣習（WSOP / PokerStars は SB→BB）に沿って列順は維持する意思決定は、ユーザーとの調査ログに残している
