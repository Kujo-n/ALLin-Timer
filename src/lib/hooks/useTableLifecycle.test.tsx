import { act, renderHook } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { TableDoc } from "@/lib/firebase/schemas/table";

// mock 境界 = repository（helper 境界で割る。内部の Firestore は触らない）。
// engine.planAddTable は pure なので本物を通し、nextTableNum の実挙動を検証する。
vi.mock("@/lib/firebase/repositories/tables", () => ({
  upsertTable: vi.fn(),
  reopenTable: vi.fn(),
}));

import { reopenTable, upsertTable } from "@/lib/firebase/repositories/tables";

import { useTableLifecycle } from "./useTableLifecycle";

const ts = Timestamp.fromMillis(0);

function fakeTable(overrides: Partial<TableDoc> & { tableNum: number }): TableDoc {
  return {
    id: String(overrides.tableNum),
    isBroken: false,
    createdAt: ts,
    label: null,
    color: null,
    ...overrides,
  };
}

function tablesFromNums(nums: number[]): TableDoc[] {
  return nums.map((n) => fakeTable({ tableNum: n }));
}

function setup(over: Partial<Parameters<typeof useTableLifecycle>[0]> = {}) {
  const onError = vi.fn();
  const opts = {
    tid: "t1",
    uid: "u1" as string | null,
    tables: tablesFromNums([1, 2]),
    onError,
    ...over,
  };
  const utils = renderHook((args: typeof opts) => useTableLifecycle(args), {
    initialProps: opts,
  });
  return { ...utils, onError, opts };
}

beforeEach(() => {
  vi.mocked(upsertTable).mockReset().mockResolvedValue(undefined);
  vi.mocked(reopenTable).mockReset().mockResolvedValue(undefined);
});

describe("useTableLifecycle", () => {
  it("addTable upserts the next free tableNum and clears busy", async () => {
    const { result } = setup({ tables: tablesFromNums([1, 2]) });
    expect(result.current.nextTableNum).toBe(3);
    await act(async () => {
      await result.current.addTable();
    });
    expect(upsertTable).toHaveBeenCalledWith("t1", 3);
    expect(result.current.addBusy).toBe(false);
  });

  it("addTable is a noop with onError when MAX_TABLES is reached", async () => {
    const { result, onError } = setup({ tables: tablesFromNums([1, 2, 3, 4, 5, 6]) });
    expect(result.current.nextTableNum).toBeNull();
    await act(async () => {
      await result.current.addTable();
    });
    expect(upsertTable).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("上限"));
  });

  it("reopenTable calls the repository with (tid, tableNum)", async () => {
    const { result } = setup({
      tables: [fakeTable({ tableNum: 3, isBroken: true })],
    });
    await act(async () => {
      await result.current.reopenTable(3);
    });
    expect(reopenTable).toHaveBeenCalledWith("t1", 3);
    expect(result.current.reopenBusy).toBe(false);
  });

  it("addTable surfaces repository errors via onError and resets busy", async () => {
    vi.mocked(upsertTable).mockRejectedValueOnce(
      new AppError("卓の追加に失敗しました", "firestore/write_failed"),
    );
    const { result, onError } = setup({ tables: tablesFromNums([1, 2]) });
    await act(async () => {
      await result.current.addTable();
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("firestore/write_failed"),
    );
    expect(result.current.addBusy).toBe(false);
  });

  it("addTable / reopenTable are noops when uid is null", async () => {
    const { result } = setup({
      uid: null,
      tables: [fakeTable({ tableNum: 3, isBroken: true }), fakeTable({ tableNum: 1 })],
    });
    await act(async () => {
      await result.current.addTable();
    });
    await act(async () => {
      await result.current.reopenTable(3);
    });
    expect(upsertTable).not.toHaveBeenCalled();
    expect(reopenTable).not.toHaveBeenCalled();
  });
});
