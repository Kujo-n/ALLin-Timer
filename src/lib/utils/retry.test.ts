import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { deleteWithRetry } from "./retry";

describe("deleteWithRetry", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("1 回目で成功 → fn は 1 回、onFinalFailure は呼ばれない", async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const onFinalFailure = vi.fn();
    await deleteWithRetry(fn, {
      attempts: 3,
      backoffMs: [200, 600],
      onFinalFailure,
    });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it("3 回目で成功 → fn は 3 回、sleep は 200ms + 600ms 経過", async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("x1"))
      .mockRejectedValueOnce(new Error("x2"))
      .mockResolvedValueOnce(undefined);
    const onFinalFailure = vi.fn();
    const promise = deleteWithRetry(fn, {
      attempts: 3,
      backoffMs: [200, 600],
      onFinalFailure,
    });
    // 1st try fails synchronously → sleeps 200ms → 2nd try fails → sleeps 600ms → 3rd try succeeds.
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(600);
    await promise;
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it("全 attempts 失敗 → onFinalFailure が最後の error で呼ばれる", async () => {
    const finalErr = new Error("final-error");
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockRejectedValueOnce(finalErr);
    const onFinalFailure = vi.fn();
    const promise = deleteWithRetry(fn, {
      attempts: 3,
      backoffMs: [200, 600],
      onFinalFailure,
    });
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(600);
    await promise;
    expect(fn).toHaveBeenCalledTimes(3);
    expect(onFinalFailure).toHaveBeenCalledTimes(1);
    expect(onFinalFailure).toHaveBeenCalledWith(finalErr);
  });

  it("AbortSignal が pre-aborted なら fn は呼ばれない", async () => {
    const controller = new AbortController();
    controller.abort();
    const fn = vi.fn().mockResolvedValue(undefined);
    const onFinalFailure = vi.fn();
    await deleteWithRetry(fn, {
      attempts: 3,
      backoffMs: [200, 600],
      onFinalFailure,
      signal: controller.signal,
    });
    expect(fn).not.toHaveBeenCalled();
    expect(onFinalFailure).not.toHaveBeenCalled();
  });

  it("backoffMs の不足は ?? 0 で補完される（attempts=3 / backoffMs=[]）", async () => {
    vi.useRealTimers();
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error("e1"))
      .mockRejectedValueOnce(new Error("e2"))
      .mockResolvedValueOnce(undefined);
    await deleteWithRetry(fn, {
      attempts: 3,
      backoffMs: [],
    });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
