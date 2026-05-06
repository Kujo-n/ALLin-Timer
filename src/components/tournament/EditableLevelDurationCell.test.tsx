import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

import { EditableLevelDurationCell } from "./EditableLevelDurationCell";

function setup(overrides: Partial<Parameters<typeof EditableLevelDurationCell>[0]> = {}) {
  const onSave = vi.fn(async () => {});
  const onError = vi.fn();
  const props = {
    levelIndex: 2,
    durationSec: 720, // 12 分
    canEdit: true,
    onSave,
    onError,
    ...overrides,
  };
  const utils = render(<EditableLevelDurationCell {...props} />);
  return { ...utils, onSave, onError, props };
}

describe("EditableLevelDurationCell", () => {
  it("renders only the minute count when canEdit is false (no Pencil)", () => {
    setup({ canEdit: false });
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /時間を変更/ }),
    ).not.toBeInTheDocument();
  });

  it("renders a Pencil button with aria-label when canEdit is true", () => {
    setup({ canEdit: true, levelIndex: 3 });
    expect(
      screen.getByRole("button", { name: "Lv 4 の時間を変更" }),
    ).toBeInTheDocument();
  });

  it("enters edit mode when the Pencil button is clicked", () => {
    setup();
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    expect(
      screen.getByRole("spinbutton", { name: /Lv 3 の時間/ }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "保存" })).toBeInTheDocument();
  });

  it("calls onSave with durationSec = minutes * 60 on submit", async () => {
    const { onSave } = setup({ levelIndex: 1, durationSec: 720 });
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", {
      name: /Lv 2 の時間/,
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "17" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    expect(onSave).toHaveBeenCalledWith(1, 17 * 60);
  });

  it("Escape key cancels edit mode without calling onSave", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", { name: /Lv 3 の時間/ });
    fireEvent.change(input, { target: { value: "20" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onSave).not.toHaveBeenCalled();
    // 編集モード解除後は再び Pencil ボタンが見える
    expect(
      screen.getByRole("button", { name: /時間を変更/ }),
    ).toBeInTheDocument();
  });

  it("× button cancels edit mode", () => {
    const { onSave } = setup();
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    fireEvent.change(
      screen.getByRole("spinbutton", { name: /Lv 3 の時間/ }),
      { target: { value: "20" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /時間を変更/ }),
    ).toBeInTheDocument();
  });

  it("reports onError with validation/level-duration-invalid for value 0", () => {
    const { onSave, onError } = setup();
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", { name: /Lv 3 の時間/ });
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("validation/level-duration-invalid"),
    );
  });

  it("reports onError for non-integer value (1.5)", () => {
    const { onSave, onError } = setup();
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", { name: /Lv 3 の時間/ });
    fireEvent.change(input, { target: { value: "1.5" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("validation/level-duration-invalid"),
    );
  });

  it("reports onError for value above MAX_LEVEL_DURATION_MIN (= 1440)", () => {
    const { onSave, onError } = setup();
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", { name: /Lv 3 の時間/ });
    fireEvent.change(input, { target: { value: "1441" } });
    fireEvent.submit(input.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("validation/level-duration-invalid"),
    );
  });

  it("submitting same value (no-op) exits edit mode without calling onSave", () => {
    const { onSave } = setup({ durationSec: 720 });
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", { name: /Lv 3 の時間/ });
    // value は currentValue と同じ "12" のまま
    fireEvent.submit(input.closest("form")!);
    expect(onSave).not.toHaveBeenCalled();
    expect(
      screen.getByRole("button", { name: /時間を変更/ }),
    ).toBeInTheDocument();
  });

  it("propagates onSave AppError to onError preserving inner code", async () => {
    const onSave = vi.fn(async () => {
      throw new AppError("write failed", "firestore/write_failed");
    });
    const onError = vi.fn();
    render(
      <EditableLevelDurationCell
        levelIndex={2}
        durationSec={720}
        canEdit
        onSave={onSave}
        onError={onError}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /時間を変更/ }));
    const input = screen.getByRole("spinbutton", { name: /Lv 3 の時間/ });
    fireEvent.change(input, { target: { value: "17" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    await waitFor(() => {
      expect(onError).toHaveBeenCalledWith(
        expect.stringContaining("firestore/write_failed"),
      );
    });
  });
});
