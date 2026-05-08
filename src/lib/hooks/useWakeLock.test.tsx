import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { useWakeLock } from "./useWakeLock";

const realNavigator = globalThis.navigator;

interface FakeSentinel {
  release: ReturnType<typeof vi.fn>;
  released: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  /** test 内で OS 起因の暗黙 release を simulate するためのトリガ。 */
  fireRelease: () => void;
}

function makeSentinel(): FakeSentinel {
  const listeners: Array<() => void> = [];
  const sentinel: FakeSentinel = {
    release: vi.fn().mockResolvedValue(undefined),
    released: false,
    addEventListener: vi.fn((event: string, cb: () => void) => {
      if (event === "release") listeners.push(cb);
    }),
    removeEventListener: vi.fn(),
    fireRelease: () => {
      sentinel.released = true;
      listeners.forEach((cb) => cb());
    },
  };
  return sentinel;
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.spyOn(logger, "warn").mockImplementation(() => {});
  setVisibility("visible");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (globalThis.navigator !== realNavigator) {
    Object.defineProperty(globalThis, "navigator", {
      value: realNavigator,
      configurable: true,
      writable: true,
    });
  }
});

describe("useWakeLock", () => {
  it("Wake Lock API 未対応の UA では supported=false で何も呼ばない", async () => {
    // 既存の navigator から wakeLock を除いた object を stub
    vi.stubGlobal("navigator", { ...realNavigator });
    const { result } = renderHook(() => useWakeLock(true));
    // 初期 effect 実行を待つ
    await waitFor(() => {
      expect(result.current.supported).toBe(false);
    });
    expect(result.current.held).toBe(false);
    expect(result.current.lastError).toBeNull();
  });

  it("active=true で mount すると request('screen') が呼ばれ held=true になる", async () => {
    const sentinel = makeSentinel();
    const requestMock = vi.fn().mockResolvedValue(sentinel);
    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });

    const { result } = renderHook(() => useWakeLock(true));

    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });
    expect(requestMock).toHaveBeenCalledTimes(1);
    expect(requestMock).toHaveBeenCalledWith("screen");
    expect(result.current.supported).toBe(true);
  });

  it("active=true → false に切替えると sentinel.release が呼ばれ held=false になる", async () => {
    const sentinel = makeSentinel();
    const requestMock = vi.fn().mockResolvedValue(sentinel);
    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useWakeLock(active),
      { initialProps: { active: true } },
    );

    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });

    rerender({ active: false });

    await waitFor(() => {
      expect(result.current.held).toBe(false);
    });
    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("sentinel が外部 release されたら held=false に切替わり、visible 復帰で再 request する", async () => {
    const firstSentinel = makeSentinel();
    const secondSentinel = makeSentinel();
    const requestMock = vi
      .fn()
      .mockResolvedValueOnce(firstSentinel)
      .mockResolvedValueOnce(secondSentinel);
    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });

    const { result } = renderHook(() => useWakeLock(true));
    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });
    expect(requestMock).toHaveBeenCalledTimes(1);

    // OS が画面消灯等で暗黙的に release した状況を simulate
    act(() => {
      firstSentinel.fireRelease();
    });
    expect(result.current.held).toBe(false);

    // visibility が visible 復帰で再取得
    setVisibility("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });
    expect(requestMock).toHaveBeenCalledTimes(2);
  });

  it("request が reject したら logger.warn で device/wake-lock-failed を warn し held=false で throw しない", async () => {
    const requestMock = vi.fn().mockRejectedValue(new Error("NotAllowedError"));
    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const { result } = renderHook(() => useWakeLock(true));

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: "device/wake-lock-failed" }),
      );
    });
    expect(result.current.held).toBe(false);
    expect(result.current.lastError).not.toBeNull();
    expect(result.current.lastError?.code).toBe("device/wake-lock-failed");
  });

  it("active=true→false→true の急 toggle 中に initial request が in-flight でも、最終的に sentinel が取得される（M1 race）", async () => {
    // initial の request を await のまま保留にして、active を toggle する
    let resolveFirst: ((s: FakeSentinel) => void) | undefined;
    const firstPromise = new Promise<FakeSentinel>((res) => {
      resolveFirst = res;
    });
    const firstSentinel = makeSentinel();

    let resolveSecond: ((s: FakeSentinel) => void) | undefined;
    const secondPromise = new Promise<FakeSentinel>((res) => {
      resolveSecond = res;
    });
    const secondSentinel = makeSentinel();

    const requestMock = vi
      .fn()
      .mockImplementationOnce(() => firstPromise)
      .mockImplementationOnce(() => secondPromise);

    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useWakeLock(active),
      { initialProps: { active: true } },
    );

    // initial request 解決前に false → true に急 toggle
    rerender({ active: false });
    rerender({ active: true });

    // 旧実装ではここで requestMock が 1 回しか呼ばれず、initial 解決後の release だけで終わって
    // 再取得されない bug があった。新実装では effect 3 mount 時点で 2 回目の request が走る。
    expect(requestMock).toHaveBeenCalledTimes(2);

    // 1 回目の sentinel が遅延解決 → cancelled パスで即 release されるはず
    await act(async () => {
      resolveFirst?.(firstSentinel);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(firstSentinel.release).toHaveBeenCalledTimes(1);
    });
    // この時点で sentinel は未保持（2 回目はまだ pending）
    expect(result.current.held).toBe(false);

    // 2 回目の sentinel が解決すると最新の effect が引き取って held=true
    await act(async () => {
      resolveSecond?.(secondSentinel);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });
    // 2 回目は active=true で生存中なので release されない
    expect(secondSentinel.release).not.toHaveBeenCalled();
  });

  it("active=true で取得済みの状態から unmount すると release が 1 回呼ばれる", async () => {
    const sentinel = makeSentinel();
    const requestMock = vi.fn().mockResolvedValue(sentinel);
    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });

    const { result, unmount } = renderHook(() => useWakeLock(true));
    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });

    unmount();

    await waitFor(() => {
      expect(sentinel.release).toHaveBeenCalledTimes(1);
    });
  });

  it("releaseSentinel 中に release() が reject しても logger.warn で device/wake-lock-release-failed を warn し throw しない", async () => {
    const sentinel = makeSentinel();
    sentinel.release = vi.fn().mockRejectedValue(new Error("AbortError"));
    const requestMock = vi.fn().mockResolvedValue(sentinel);
    vi.stubGlobal("navigator", {
      ...realNavigator,
      wakeLock: { request: requestMock },
    });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const { result, rerender } = renderHook(
      ({ active }: { active: boolean }) => useWakeLock(active),
      { initialProps: { active: true } },
    );

    await waitFor(() => {
      expect(result.current.held).toBe(true);
    });

    // active=false に倒すと releaseSentinel 経由で release() が reject 経路に入る
    rerender({ active: false });

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: "device/wake-lock-release-failed" }),
      );
    });
    // held は確実に false になる（race の余韻吸収）
    expect(result.current.held).toBe(false);
  });
});
