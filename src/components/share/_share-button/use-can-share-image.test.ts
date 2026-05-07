import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useCanShareImage } from "./use-can-share-image";

const realNavigator = globalThis.navigator;

afterEach(() => {
  vi.unstubAllGlobals();
  // restore navigator if a test stubbed it
  if (globalThis.navigator !== realNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
      writable: true,
    });
  }
});

describe("useCanShareImage", () => {
  it("navigator.canShare が関数として存在しない端末では false を返す", async () => {
    vi.stubGlobal("navigator", { ...realNavigator, canShare: undefined });
    const { result } = renderHook(() => useCanShareImage());
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it("navigator.canShare({ files }) が true を返す端末では true", async () => {
    const canShareMock = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { ...realNavigator, canShare: canShareMock });
    const { result } = renderHook(() => useCanShareImage());
    await waitFor(() => {
      expect(result.current).toBe(true);
    });
    expect(canShareMock).toHaveBeenCalledTimes(1);
    const arg = canShareMock.mock.calls[0][0] as { files: File[] };
    expect(arg.files).toHaveLength(1);
    expect(arg.files[0]).toBeInstanceOf(File);
    expect(arg.files[0].type).toBe("image/png");
  });

  it("navigator.canShare が false を返す端末では false", async () => {
    vi.stubGlobal("navigator", {
      ...realNavigator,
      canShare: vi.fn().mockReturnValue(false),
    });
    const { result } = renderHook(() => useCanShareImage());
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  it("navigator.canShare が throw しても false に倒す（catch silent）", async () => {
    vi.stubGlobal("navigator", {
      ...realNavigator,
      canShare: vi.fn().mockImplementation(() => {
        throw new Error("canShare blew up");
      }),
    });
    const { result } = renderHook(() => useCanShareImage());
    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });
});
