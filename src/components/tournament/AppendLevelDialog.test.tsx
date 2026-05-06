import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { Level } from "@/lib/firebase/schemas/structure";

import { AppendLevelDialog } from "./AppendLevelDialog";

function level(overrides: Partial<Level> = {}): Level {
  return {
    level: 1,
    sb: 25,
    bb: 50,
    ante: 0,
    durationSec: 600,
    isBreak: false,
    ...overrides,
  };
}

describe("AppendLevelDialog", () => {
  it("does not render content when open=false", () => {
    render(
      <AppendLevelDialog
        open={false}
        onOpenChange={vi.fn()}
        existingLevels={[level()]}
        onAppend={vi.fn()}
      />,
    );
    expect(
      screen.queryByText(/レベル \d+ を末尾に追加/),
    ).not.toBeInTheDocument();
  });

  it("shows title 'レベル N を末尾に追加' where N = existingLevels.length + 1", () => {
    const levels: Level[] = Array.from({ length: 12 }, (_, i) =>
      level({ level: i + 1 }),
    );
    render(
      <AppendLevelDialog
        open
        onOpenChange={vi.fn()}
        existingLevels={levels}
        onAppend={vi.fn()}
      />,
    );
    expect(screen.getByText("レベル 13 を末尾に追加")).toBeInTheDocument();
  });

  it("hydrates defaults from the last play level (sb*2 / bb*2 / ante / durationMin)", () => {
    render(
      <AppendLevelDialog
        open
        onOpenChange={vi.fn()}
        existingLevels={[
          level({ level: 1, sb: 100, bb: 200, ante: 25, durationSec: 600 }),
        ]}
        onAppend={vi.fn()}
      />,
    );
    expect(
      (screen.getByLabelText("SB") as HTMLInputElement).value,
    ).toBe("200");
    expect(
      (screen.getByLabelText("BB") as HTMLInputElement).value,
    ).toBe("400");
    expect(
      (screen.getByLabelText("Ante") as HTMLInputElement).value,
    ).toBe("25");
    expect(
      (screen.getByLabelText("分") as HTMLInputElement).value,
    ).toBe("10");
  });

  it("uses fixed defaults (25/50/0/10) when all existing levels are breaks", () => {
    render(
      <AppendLevelDialog
        open
        onOpenChange={vi.fn()}
        existingLevels={[
          level({ level: 1, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true }),
        ]}
        onAppend={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("SB") as HTMLInputElement).value).toBe("25");
    expect((screen.getByLabelText("BB") as HTMLInputElement).value).toBe("50");
    expect((screen.getByLabelText("Ante") as HTMLInputElement).value).toBe("0");
    expect((screen.getByLabelText("分") as HTMLInputElement).value).toBe("10");
  });

  it("disables SB/BB/Ante inputs and zeroes them when isBreak is checked", () => {
    render(
      <AppendLevelDialog
        open
        onOpenChange={vi.fn()}
        existingLevels={[level({ level: 1, sb: 100, bb: 200, ante: 25 })]}
        onAppend={vi.fn()}
      />,
    );
    const breakCheckbox = screen.getByLabelText("ブレイクとして追加");
    fireEvent.click(breakCheckbox);

    const sb = screen.getByLabelText("SB") as HTMLInputElement;
    const bb = screen.getByLabelText("BB") as HTMLInputElement;
    const ante = screen.getByLabelText("Ante") as HTMLInputElement;

    expect(sb).toBeDisabled();
    expect(bb).toBeDisabled();
    expect(ante).toBeDisabled();
    expect(sb.value).toBe("0");
    expect(bb.value).toBe("0");
    expect(ante.value).toBe("0");
  });

  it("submits onAppend with { sb, bb, ante, durationSec=durationMin*60, isBreak }", async () => {
    const onAppend = vi.fn(async () => {});
    const onOpenChange = vi.fn();
    render(
      <AppendLevelDialog
        open
        onOpenChange={onOpenChange}
        existingLevels={[
          level({ level: 1, sb: 100, bb: 200, ante: 25, durationSec: 600 }),
        ]}
        onAppend={onAppend}
      />,
    );
    await act(async () => {
      fireEvent.submit(
        (screen.getByLabelText("SB") as HTMLInputElement).closest("form")!,
      );
    });
    expect(onAppend).toHaveBeenCalledWith({
      sb: 200,
      bb: 400,
      ante: 25,
      durationSec: 600, // 10 分 * 60
      isBreak: false,
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("displays AppError code:message in role=alert when onAppend rejects, keeps dialog open", async () => {
    const onAppend = vi.fn(async () => {
      throw new AppError("レベル数の上限です", "tournament/levels-limit-exceeded");
    });
    const onOpenChange = vi.fn();
    render(
      <AppendLevelDialog
        open
        onOpenChange={onOpenChange}
        existingLevels={[level()]}
        onAppend={onAppend}
      />,
    );
    await act(async () => {
      fireEvent.submit(
        (screen.getByLabelText("SB") as HTMLInputElement).closest("form")!,
      );
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("tournament/levels-limit-exceeded");
    expect(alert.textContent).toContain("レベル数の上限です");
    // dialog は閉じない
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("calls onOpenChange(false) and does not call onAppend when cancel is clicked", () => {
    const onAppend = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AppendLevelDialog
        open
        onOpenChange={onOpenChange}
        existingLevels={[level()]}
        onAppend={onAppend}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onAppend).not.toHaveBeenCalled();
  });

  it("re-hydrates defaults when reopened (open=true → false → true does not keep prior input)", () => {
    const initial = [level({ level: 1, sb: 100, bb: 200, ante: 25, durationSec: 600 })];
    const { rerender } = render(
      <AppendLevelDialog
        open
        onOpenChange={vi.fn()}
        existingLevels={initial}
        onAppend={vi.fn()}
      />,
    );

    // ユーザーが値を変えて閉じる。
    const sb = screen.getByLabelText("SB") as HTMLInputElement;
    fireEvent.change(sb, { target: { value: "999" } });
    expect(sb.value).toBe("999");

    rerender(
      <AppendLevelDialog
        open={false}
        onOpenChange={vi.fn()}
        existingLevels={initial}
        onAppend={vi.fn()}
      />,
    );

    // 再度開くと defaults に戻る。
    rerender(
      <AppendLevelDialog
        open
        onOpenChange={vi.fn()}
        existingLevels={initial}
        onAppend={vi.fn()}
      />,
    );
    expect((screen.getByLabelText("SB") as HTMLInputElement).value).toBe("200");
  });
});
