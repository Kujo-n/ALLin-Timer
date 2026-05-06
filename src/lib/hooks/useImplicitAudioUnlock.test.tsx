import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

vi.mock("@/lib/audio/audio-context", () => ({
  resumeAudioContext: vi.fn(),
}));

import { resumeAudioContext } from "@/lib/audio/audio-context";

import { useImplicitAudioUnlock } from "./useImplicitAudioUnlock";

beforeEach(() => {
  vi.mocked(resumeAudioContext).mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("useImplicitAudioUnlock", () => {
  it("registers a once+capture pointerdown listener on window", () => {
    const addSpy = vi.spyOn(window, "addEventListener");
    renderHook(() => useImplicitAudioUnlock());
    const call = addSpy.mock.calls.find(([event]) => event === "pointerdown");
    expect(call).toBeDefined();
    const opts = call?.[2];
    expect(opts).toEqual({ capture: true, once: true });
  });

  it("calls resumeAudioContext when pointerdown fires", async () => {
    vi.mocked(resumeAudioContext).mockResolvedValueOnce(null);
    renderHook(() => useImplicitAudioUnlock());
    window.dispatchEvent(new Event("pointerdown"));
    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
  });

  it("warns via logger when resumeAudioContext rejects (no throw)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(resumeAudioContext).mockRejectedValueOnce(new Error("autoplay blocked"));
    renderHook(() => useImplicitAudioUnlock());
    window.dispatchEvent(new Event("pointerdown"));
    // .catch() runs as a microtask
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "audio/implicit-unlock-failed" }),
    );
  });

  it("removes the pointerdown listener on unmount", () => {
    const removeSpy = vi.spyOn(window, "removeEventListener");
    const { unmount } = renderHook(() => useImplicitAudioUnlock());
    unmount();
    const call = removeSpy.mock.calls.find(([event]) => event === "pointerdown");
    expect(call).toBeDefined();
    expect(call?.[2]).toEqual({ capture: true });
  });
});
