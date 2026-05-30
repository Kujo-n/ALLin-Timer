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
      expect.objectContaining({ level: 1, bb: 200, sb: 25 }),
      expect.anything(),
    ]);
  });

  it("OFF 状態で SB を手動変更できる", () => {
    const onChange = vi.fn();
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
      { level: 2, sb: 80, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 600, isBreak: true },
    ];
    render(<LevelTable levels={variant} onChange={onChange} />);
    expect(screen.getByLabelText<HTMLInputElement>("auto-sb-half").checked).toBe(false);

    fireEvent.click(screen.getByLabelText("auto-sb-half")); // OFF → ON
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ level: 1, sb: 25, bb: 50 }),
      expect.objectContaining({ level: 2, sb: 50, bb: 100 }),
      expect.objectContaining({ level: 3, sb: 0, bb: 0, isBreak: true }),
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

describe("LevelTable — 一括時間設定", () => {
  function makeMixedLevels(): Level[] {
    return [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 1200, isBreak: false },
      { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 600, isBreak: true },
    ];
  }

  it("既定は個別モード（individual が checked / 一括入力は非表示 / 行の分入力は enabled）", () => {
    render(<LevelTable levels={makeLevels()} onChange={vi.fn()} />);
    expect(
      screen.getByLabelText<HTMLInputElement>("duration-mode-individual").checked,
    ).toBe(true);
    expect(screen.getByLabelText<HTMLInputElement>("duration-mode-bulk").checked).toBe(
      false,
    );
    expect(screen.queryByLabelText("bulk-duration-min")).toBeNull();
    expect(
      screen.getByLabelText<HTMLInputElement>("level-1-duration-min").disabled,
    ).toBe(false);
  });

  it("一括に切替えると一括入力が表示され、行ごとの分入力が disabled になる", () => {
    render(<LevelTable levels={makeLevels()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("duration-mode-bulk"));
    expect(screen.getByLabelText("bulk-duration-min")).not.toBeNull();
    expect(
      screen.getByLabelText<HTMLInputElement>("level-1-duration-min").disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText<HTMLInputElement>("level-2-duration-min").disabled,
    ).toBe(true);
  });

  it("一括分入力を 15 に変更すると onChange が全行（break 含む）durationSec=900 で呼ばれる", () => {
    const onChange = vi.fn();
    render(<LevelTable levels={makeMixedLevels()} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("duration-mode-bulk"));
    onChange.mockClear();

    fireEvent.change(screen.getByLabelText("bulk-duration-min"), {
      target: { value: "15" },
    });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ level: 1, durationSec: 900 }),
      expect.objectContaining({ level: 2, durationSec: 900 }),
      expect.objectContaining({ level: 3, durationSec: 900, isBreak: true }),
    ]);
  });

  it("個別→一括の切替時、不揃いな duration が先頭行値で unify されて onChange が呼ばれる", () => {
    const onChange = vi.fn();
    render(<LevelTable levels={makeMixedLevels()} onChange={onChange} />);
    // 先頭行 600 秒 = 10 分で全行 unify
    fireEvent.click(screen.getByLabelText("duration-mode-bulk"));
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ level: 1, durationSec: 600 }),
      expect.objectContaining({ level: 2, durationSec: 600 }),
      expect.objectContaining({ level: 3, durationSec: 600, isBreak: true }),
    ]);
  });

  it("一括→個別に戻すと行の分入力が再び enabled になる", () => {
    render(<LevelTable levels={makeLevels()} onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("duration-mode-bulk"));
    expect(
      screen.getByLabelText<HTMLInputElement>("level-1-duration-min").disabled,
    ).toBe(true);

    fireEvent.click(screen.getByLabelText("duration-mode-individual"));
    expect(
      screen.getByLabelText<HTMLInputElement>("level-1-duration-min").disabled,
    ).toBe(false);
    expect(screen.queryByLabelText("bulk-duration-min")).toBeNull();
  });
});
