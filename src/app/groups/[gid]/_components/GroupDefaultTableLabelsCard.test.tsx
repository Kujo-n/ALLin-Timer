import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TABLE_COLOR_PRESETS } from "@/components/tournament/_table-label-edit/table-color-presets";

import { GroupDefaultTableLabelsCard } from "./GroupDefaultTableLabelsCard";

/**
 * architect-refactor 20260509 T2-a: Table 色プリセット radiogroup を共通 component に抽出する
 * 前段で、現状の挙動を固定化する characterization test。
 *
 * 主な不変条件:
 *   1. 編集モードで preset を click して保存すると、onSave に
 *      `(["赤卓"], [TABLE_COLOR_PRESETS[0].value])` の形で渡る
 *   2. preset radio の aria-label 規約は `default-table-${idx + 1}-color-${preset.name}`
 *      （E2E `table-label-and-color.spec.ts` と互換）
 *   3. 「色なし」radio の aria-label は `default-table-${idx + 1}-color-none`
 *
 * T2-b の TableColorPresetRadioGroup 抽出後も、これら 3 不変条件が維持されること。
 */
describe("GroupDefaultTableLabelsCard", () => {
  it("編集 → label 入力 + preset 選択 → 保存 で onSave に label と color が同じ index で渡る", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GroupDefaultTableLabelsCard
        labels={[]}
        colors={[]}
        canEdit={true}
        onSave={onSave}
      />,
    );

    // 表示モード: 「未設定」+ 編集ボタン
    expect(screen.getByText("未設定")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "編集" }));

    // 編集モード: + 追加 → 1 行入力
    fireEvent.click(screen.getByRole("button", { name: "+ 追加" }));
    const labelInput = screen.getByLabelText("default-table-label-1");
    fireEvent.change(labelInput, { target: { value: "赤卓" } });

    // 1 行目の preset 1 個目（赤）を選択
    const firstPreset = TABLE_COLOR_PRESETS[0];
    const presetButton = screen.getByLabelText(
      `default-table-1-color-${firstPreset.name}`,
    );
    fireEvent.click(presetButton);

    // 保存ボタン（onSave Promise resolve まで act で待機）
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(["赤卓"], [firstPreset.value]);
  });

  it("「色なし」radio をクリックすると onSave に null が渡る", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <GroupDefaultTableLabelsCard
        labels={[]}
        colors={[]}
        canEdit={true}
        onSave={onSave}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "編集" }));
    fireEvent.click(screen.getByRole("button", { name: "+ 追加" }));
    fireEvent.change(screen.getByLabelText("default-table-label-1"), {
      target: { value: "卓 A" },
    });

    // 既定状態は「色なし」が aria-checked=true。明示 click でも変わらないこと確認用に click。
    fireEvent.click(screen.getByLabelText("default-table-1-color-none"));

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "保存" }));
    });

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith(["卓 A"], [null]);
  });

  it("preset radio の aria-label 規約が default-table-${idx}-color-${name} で安定している", () => {
    render(
      <GroupDefaultTableLabelsCard
        labels={["卓 1"]}
        colors={[TABLE_COLOR_PRESETS[0].value]}
        canEdit={true}
        onSave={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "編集" }));

    // 全プリセット + 「色なし」が aria-label で見つかる
    expect(screen.getByLabelText("default-table-1-color-none")).toBeInTheDocument();
    for (const preset of TABLE_COLOR_PRESETS) {
      expect(
        screen.getByLabelText(`default-table-1-color-${preset.name}`),
      ).toBeInTheDocument();
    }
  });
});
