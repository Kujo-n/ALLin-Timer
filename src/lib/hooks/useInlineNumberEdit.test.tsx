import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

import { useInlineNumberEdit } from "./useInlineNumberEdit";

function setup(overrides: Partial<Parameters<typeof useInlineNumberEdit>[0]> = {}) {
  const onError = vi.fn();
  const onSaved = vi.fn();
  const save = vi.fn(async () => {});
  const validate = vi.fn((): string | null => null);
  const opts = {
    currentValue: 5,
    save,
    validate,
    onSaved,
    onError,
    errorCode: "test/save-failed",
    errorMessage: "テスト保存失敗",
    ...overrides,
  };
  const utils = renderHook((p: typeof opts) => useInlineNumberEdit(p), {
    initialProps: opts,
  });
  return { ...utils, save, validate, onError, onSaved };
}

function fireSubmit(formish: { onSubmit: (e: React.FormEvent) => Promise<void> }) {
  const e = { preventDefault: vi.fn() } as unknown as React.FormEvent;
  return formish.onSubmit(e);
}

describe("useInlineNumberEdit", () => {
  it("starts in non-editing mode with value mirroring currentValue", () => {
    const { result } = setup({ currentValue: 7 });
    expect(result.current.editing).toBe(false);
    expect(result.current.value).toBe("7");
  });

  it("syncs value to new currentValue when not editing", () => {
    const { result, rerender, save } = setup({ currentValue: 5 });
    rerender({
      currentValue: 9,
      save,
      validate: () => null,
      onSaved: vi.fn(),
      onError: vi.fn(),
      errorCode: "x",
      errorMessage: "y",
    });
    expect(result.current.value).toBe("9");
  });

  it("does not sync value while editing", async () => {
    const { result, rerender, save } = setup({ currentValue: 5 });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("42");
    });
    expect(result.current.editing).toBe(true);
    expect(result.current.value).toBe("42");
    rerender({
      currentValue: 100,
      save,
      validate: () => null,
      onSaved: vi.fn(),
      onError: vi.fn(),
      errorCode: "x",
      errorMessage: "y",
    });
    // currentValue が変わってもユーザーが入力中の "42" は保持される。
    expect(result.current.value).toBe("42");
  });

  it("cancel resets value to currentValue and exits editing", async () => {
    const { result } = setup({ currentValue: 5 });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("99");
    });
    await act(async () => {
      result.current.cancel();
    });
    expect(result.current.editing).toBe(false);
    expect(result.current.value).toBe("5");
  });

  it("onSubmit calls save when value differs and validation passes", async () => {
    const { result, save, onSaved } = setup({ currentValue: 5 });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("10");
    });
    await act(async () => {
      await fireSubmit(result.current);
    });
    expect(save).toHaveBeenCalledWith(10);
    expect(onSaved).toHaveBeenCalled();
    await waitFor(() => expect(result.current.editing).toBe(false));
  });

  it("onSubmit no-ops when value equals currentValue", async () => {
    const { result, save } = setup({ currentValue: 5 });
    await act(async () => {
      result.current.start();
    });
    // value は currentValue と同じ "5" のまま。
    await act(async () => {
      await fireSubmit(result.current);
    });
    expect(save).not.toHaveBeenCalled();
    expect(result.current.editing).toBe(false);
  });

  it("onSubmit reports validate error via onError and skips save", async () => {
    const validate = vi.fn(() => "validation/x: invalid");
    const { result, save, onError } = setup({
      currentValue: 5,
      validate,
    });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("999");
    });
    await act(async () => {
      await fireSubmit(result.current);
    });
    expect(onError).toHaveBeenCalledWith("validation/x: invalid");
    expect(save).not.toHaveBeenCalled();
    // editing はキープ（再入力を促す）。
    expect(result.current.editing).toBe(true);
  });

  it("onSubmit reports save AppError via onError using its own code/message", async () => {
    const save = vi.fn(async () => {
      throw new AppError("inner failure", "firestore/write_failed");
    });
    const { result, onError } = setup({ currentValue: 5, save });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("10");
    });
    await act(async () => {
      await fireSubmit(result.current);
    });
    expect(onError).toHaveBeenCalledWith(
      "firestore/write_failed: inner failure",
    );
    // save 失敗時は editing キープ（リトライを許す）。
    expect(result.current.editing).toBe(true);
  });

  it("onSubmit wraps non-AppError throw using fallback errorCode/errorMessage", async () => {
    const save = vi.fn(async () => {
      throw new Error("network");
    });
    const { result, onError } = setup({
      currentValue: 5,
      save,
      errorCode: "test/save-failed",
      errorMessage: "保存失敗",
    });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("10");
    });
    await act(async () => {
      await fireSubmit(result.current);
    });
    expect(onError).toHaveBeenCalledWith("test/save-failed: 保存失敗");
  });

  it("onKeyDown Escape calls cancel", async () => {
    const { result } = setup({ currentValue: 5 });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("99");
    });
    await act(async () => {
      result.current.onKeyDown({
        key: "Escape",
        preventDefault: vi.fn(),
      } as unknown as React.KeyboardEvent<HTMLInputElement>);
    });
    expect(result.current.editing).toBe(false);
    expect(result.current.value).toBe("5");
  });

  it("saving flag toggles around save call", async () => {
    let resolve: (() => void) | null = null;
    const save = vi.fn(
      () =>
        new Promise<void>((r) => {
          resolve = r;
        }),
    );
    const { result } = setup({ currentValue: 5, save });
    await act(async () => {
      result.current.start();
    });
    await act(async () => {
      result.current.onChange("10");
    });
    let submitPromise: Promise<void> | null = null;
    await act(async () => {
      submitPromise = fireSubmit(result.current);
      // submit 開始直後は saving=true（promise pending）。
      await Promise.resolve();
    });
    expect(result.current.saving).toBe(true);
    await act(async () => {
      resolve?.();
      await submitPromise;
    });
    expect(result.current.saving).toBe(false);
  });
});
