import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { useClipboardCopy } from "./useClipboardCopy";

beforeEach(() => {
  Object.defineProperty(global.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useClipboardCopy", () => {
  it("copy() で writeText が呼ばれ、copied=true になり、autoResetMs 経過で false に戻る", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useClipboardCopy("https://example.test/x"));

    await act(async () => {
      await result.current.copy();
    });

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://example.test/x",
    );
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.copied).toBe(false);
  });

  it("autoResetMs を指定するとそのタイムアウトで copied=false に戻る", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useClipboardCopy("https://example.test/x", { autoResetMs: 500 }),
    );

    await act(async () => {
      await result.current.copy();
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(result.current.copied).toBe(true);

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.copied).toBe(false);
  });

  it("writeText 失敗時は logger.warn と onError({code}: {message}) が呼ばれ、copied=false", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(navigator.clipboard.writeText).mockRejectedValueOnce(
      new Error("Document not focused"),
    );

    const onError = vi.fn();
    const { result } = renderHook(() =>
      useClipboardCopy("https://example.test/x", { onError }),
    );

    await act(async () => {
      await result.current.copy();
    });

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalled();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "clipboard/unavailable" }),
    );
    expect(onError).toHaveBeenCalledWith(
      "clipboard/unavailable: クリップボードにコピーできませんでした",
    );
    expect(result.current.copied).toBe(false);
  });

  it("value が変わると copied=false に即座にリセットされる（タイマー経過を待たない）", async () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(
      ({ url }: { url: string | null }) => useClipboardCopy(url),
      { initialProps: { url: "https://example.test/a" } },
    );

    await act(async () => {
      await result.current.copy();
    });
    expect(result.current.copied).toBe(true);

    rerender({ url: "https://example.test/b" });
    expect(result.current.copied).toBe(false);
  });

  it("value が null のとき copy() は no-op（writeText 呼ばず）", async () => {
    const { result } = renderHook(() => useClipboardCopy(null));

    await act(async () => {
      await result.current.copy();
    });

    expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
    expect(result.current.copied).toBe(false);
  });

  it("navigator.clipboard が undefined のとき copy() は no-op（throw しない）", async () => {
    // jsdom には clipboard が無いのでこの test 中だけ削除する。
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: undefined,
    });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useClipboardCopy("https://example.test/x"));

    await act(async () => {
      await result.current.copy();
    });

    expect(result.current.copied).toBe(false);
    // clipboard 不在は API として常に発生する状況ではなく invariant ではないので
    // warn 呼出は許容（必須でもない）。ここでは throw しないことを保証する。
    void warnSpy;
  });
});
