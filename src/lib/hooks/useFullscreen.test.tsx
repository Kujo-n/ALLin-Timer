import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { useFullscreen } from "./useFullscreen";

let exitFullscreenMock: ReturnType<typeof vi.fn>;
let requestFullscreenMock: ReturnType<typeof vi.fn>;

function setFullscreenElement(el: Element | null): void {
  Object.defineProperty(document, "fullscreenElement", {
    configurable: true,
    get: () => el,
  });
}

beforeEach(() => {
  setFullscreenElement(null);
  exitFullscreenMock = vi.fn().mockResolvedValue(undefined);
  requestFullscreenMock = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, "exitFullscreen", {
    configurable: true,
    value: exitFullscreenMock,
  });
  Object.defineProperty(document.documentElement, "requestFullscreen", {
    configurable: true,
    value: requestFullscreenMock,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useFullscreen", () => {
  it("initializes isFullscreen=false when no element is fullscreened", () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);
  });

  it("initializes isFullscreen=true when document.fullscreenElement is present", () => {
    setFullscreenElement(document.createElement("div"));
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(true);
  });

  it("syncs state on fullscreenchange events (covers Esc-exit case)", () => {
    const { result } = renderHook(() => useFullscreen());
    expect(result.current.isFullscreen).toBe(false);

    setFullscreenElement(document.createElement("div"));
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(true);

    setFullscreenElement(null);
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(false);
  });

  it("falls back to webkitFullscreenElement when standard prop is null", () => {
    setFullscreenElement(null);
    Object.defineProperty(document, "webkitFullscreenElement", {
      configurable: true,
      get: () => document.createElement("span"),
    });
    const { result } = renderHook(() => useFullscreen());
    act(() => {
      document.dispatchEvent(new Event("fullscreenchange"));
    });
    expect(result.current.isFullscreen).toBe(true);
    Object.defineProperty(document, "webkitFullscreenElement", {
      configurable: true,
      get: () => null,
    });
  });

  it("toggle() calls requestFullscreen when not currently fullscreened", async () => {
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.toggle();
    });
    expect(requestFullscreenMock).toHaveBeenCalledTimes(1);
    expect(exitFullscreenMock).not.toHaveBeenCalled();
  });

  it("toggle() calls exitFullscreen when already fullscreened", async () => {
    setFullscreenElement(document.createElement("div"));
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.toggle();
    });
    expect(exitFullscreenMock).toHaveBeenCalledTimes(1);
    expect(requestFullscreenMock).not.toHaveBeenCalled();
  });

  it("toggle() warns via logger when requestFullscreen rejects (no throw)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    requestFullscreenMock.mockRejectedValueOnce(new Error("denied"));
    const { result } = renderHook(() => useFullscreen());
    await act(async () => {
      await result.current.toggle();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "ui/fullscreen-failed" }),
    );
  });

  it("removes listeners on unmount", () => {
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = renderHook(() => useFullscreen());
    unmount();
    const events = removeSpy.mock.calls.map((c) => c[0]);
    expect(events).toContain("fullscreenchange");
    expect(events).toContain("webkitfullscreenchange");
  });
});

