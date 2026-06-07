import { act, renderHook } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";

vi.mock("@/lib/services/seating/orchestrator", () => ({
  applyManualTableClose: vi.fn(),
}));

import { applyManualTableClose } from "@/lib/services/seating/orchestrator";

import { useTableClose } from "./useTableClose";

const ts = Timestamp.fromMillis(0);

function fakePlayer(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    displayName: overrides.id,
    uid: overrides.id,
    entryAt: ts,
    isBusted: false,
    bustedAt: null,
    tableNum: 1,
    seatNum: 1,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

function fakeTable(overrides: Partial<TableDoc> & { id: string }): TableDoc {
  return {
    tableNum: Number(overrides.id),
    isBroken: false,
    createdAt: ts,
    label: null,
    color: null,
    ...overrides,
  };
}

function setup(over: Partial<Parameters<typeof useTableClose>[0]> = {}) {
  const onError = vi.fn();
  const opts = {
    tid: "t1",
    uid: "u1" as string | null,
    groupIds: ["g1"],
    players: [fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })],
    tables: [fakeTable({ id: "1" }), fakeTable({ id: "2" })],
    onError,
    ...over,
  };
  const utils = renderHook((args: typeof opts) => useTableClose(args), {
    initialProps: opts,
  });
  return { ...utils, onError, opts };
}

beforeEach(() => {
  vi.mocked(applyManualTableClose).mockReset();
});

describe("useTableClose", () => {
  it("requestClose sets pendingTableNum", () => {
    const { result } = setup();
    act(() => result.current.requestClose(3));
    expect(result.current.pendingTableNum).toBe(3);
  });

  it("cancelClose clears pendingTableNum", () => {
    const { result } = setup();
    act(() => result.current.requestClose(3));
    act(() => result.current.cancelClose());
    expect(result.current.pendingTableNum).toBeNull();
  });

  it("confirmClose calls orchestrator and clears pending on success", async () => {
    vi.mocked(applyManualTableClose).mockResolvedValueOnce({
      applied: true,
      description: "Table 3 を閉鎖（2 名移動）",
      break: true,
    });
    const { result, opts } = setup();
    act(() => result.current.requestClose(3));
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(applyManualTableClose).toHaveBeenCalledWith(
      "t1",
      "u1",
      ["g1"],
      3,
      opts.players,
      opts.tables,
    );
    expect(result.current.pendingTableNum).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it("confirmClose surfaces overflow error and keeps the dialog open", async () => {
    vi.mocked(applyManualTableClose).mockRejectedValueOnce(
      new AppError("残卓に収まりません", "seating/table-close-overflow"),
    );
    const { result, onError } = setup();
    act(() => result.current.requestClose(3));
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("seating/table-close-overflow"),
    );
    // ダイアログは開いたまま（再操作可能）。
    expect(result.current.pendingTableNum).toBe(3);
    expect(result.current.busy).toBe(false);
  });

  it("confirmClose surfaces applied=false with a retry message", async () => {
    vi.mocked(applyManualTableClose).mockResolvedValueOnce({
      applied: false,
      description: null,
    });
    const { result, onError } = setup();
    act(() => result.current.requestClose(2));
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("再度ご確認ください"),
    );
    expect(result.current.pendingTableNum).toBe(2);
  });

  it("confirmClose is a noop when uid is null", async () => {
    const { result } = setup({ uid: null });
    act(() => result.current.requestClose(3));
    await act(async () => {
      await result.current.confirmClose();
    });
    expect(applyManualTableClose).not.toHaveBeenCalled();
  });
});
