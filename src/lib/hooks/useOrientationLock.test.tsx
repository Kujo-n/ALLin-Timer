import { renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { useOrientationLock } from "./useOrientationLock";

const realScreen = window.screen;
const realMatchMedia = window.matchMedia;

interface StubOrientation {
  lock?: ReturnType<typeof vi.fn>;
}

function setMatchMedia(matches: boolean): void {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: vi.fn().mockReturnValue({
      matches,
      media: "(display-mode: standalone)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }),
  });
}

function setOrientation(orientation: StubOrientation | null): void {
  Object.defineProperty(window, "screen", {
    configurable: true,
    value: orientation
      ? { ...realScreen, orientation }
      : { ...realScreen, orientation: undefined },
  });
}

beforeEach(() => {
  vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  Object.defineProperty(window, "screen", {
    configurable: true,
    value: realScreen,
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: realMatchMedia,
  });
  vi.restoreAllMocks();
});

describe("useOrientationLock", () => {
  it("display-mode が standalone でない場合は lock を呼ばず supported=false", async () => {
    setMatchMedia(false);
    const lockMock = vi.fn().mockResolvedValue(undefined);
    setOrientation({ lock: lockMock });

    const { result } = renderHook(() => useOrientationLock("landscape"));
    // effect 実行後の安定状態を待つ
    await Promise.resolve();
    expect(result.current.supported).toBe(false);
    expect(result.current.locked).toBe(false);
    expect(lockMock).not.toHaveBeenCalled();
  });

  it("screen.orientation.lock が関数でない端末では supported=false", async () => {
    setMatchMedia(true);
    setOrientation({}); // lock メソッドなし

    const { result } = renderHook(() => useOrientationLock("landscape"));
    await Promise.resolve();
    expect(result.current.supported).toBe(false);
    expect(result.current.locked).toBe(false);
  });

  it("window.screen 自体が未提供の環境では supported=false", async () => {
    setMatchMedia(true);
    // window.screen を null に差し替え（古い WebView や jsdom 拡張に近い状態）
    Object.defineProperty(window, "screen", {
      configurable: true,
      value: null,
    });

    const { result } = renderHook(() => useOrientationLock("landscape"));
    await Promise.resolve();
    expect(result.current.supported).toBe(false);
    expect(result.current.locked).toBe(false);
  });

  it("screen.orientation 自体が未提供の環境では supported=false", async () => {
    setMatchMedia(true);
    setOrientation(null); // orientation = undefined を流し込む

    const { result } = renderHook(() => useOrientationLock("landscape"));
    await Promise.resolve();
    expect(result.current.supported).toBe(false);
    expect(result.current.locked).toBe(false);
  });

  it("standalone=true + lock 成功で locked=true / lock('landscape') が 1 回", async () => {
    setMatchMedia(true);
    const lockMock = vi.fn().mockResolvedValue(undefined);
    setOrientation({ lock: lockMock });

    const { result } = renderHook(() => useOrientationLock("landscape"));

    await waitFor(() => {
      expect(result.current.locked).toBe(true);
    });
    expect(result.current.supported).toBe(true);
    expect(lockMock).toHaveBeenCalledTimes(1);
    expect(lockMock).toHaveBeenCalledWith("landscape");
  });

  it("lock が reject したら logger.warn で device/orientation-lock-failed を warn し throw しない", async () => {
    setMatchMedia(true);
    const lockMock = vi.fn().mockRejectedValue(new Error("NotSupportedError"));
    setOrientation({ lock: lockMock });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useOrientationLock("landscape"));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: "device/orientation-lock-failed" }),
      );
    });
    expect(result.current.locked).toBe(false);
    expect(result.current.supported).toBe(true);
  });

  it("lock 解決前に unmount された場合は locked=true に遷移しない（cancelled パス）", async () => {
    setMatchMedia(true);
    let resolveLock: (() => void) | undefined;
    const lockMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((res) => {
          resolveLock = () => res();
        }),
    );
    setOrientation({ lock: lockMock });

    const { result, unmount } = renderHook(() => useOrientationLock("landscape"));
    // lock pending のうちに unmount → cancelled=true
    unmount();
    resolveLock?.();
    // microtask を flush しても locked は false のまま
    await Promise.resolve();
    await Promise.resolve();
    expect(result.current.locked).toBe(false);
  });

  it("lock 解決前に unmount され reject した場合も logger.warn は走るが setLocked(false) は cancelled で抑止", async () => {
    setMatchMedia(true);
    let rejectLock: ((e: Error) => void) | undefined;
    const lockMock = vi.fn().mockImplementation(
      () =>
        new Promise<void>((_res, rej) => {
          rejectLock = rej;
        }),
    );
    setOrientation({ lock: lockMock });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const { unmount } = renderHook(() => useOrientationLock("landscape"));
    unmount();
    rejectLock?.(new Error("NotSupportedError"));
    await Promise.resolve();
    await Promise.resolve();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "device/orientation-lock-failed" }),
    );
  });
});
