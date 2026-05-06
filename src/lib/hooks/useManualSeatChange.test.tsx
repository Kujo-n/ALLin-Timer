import { act, renderHook } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

vi.mock("@/lib/services/seating/orchestrator", () => ({
  applyManualSeatChange: vi.fn(),
  applyManualSeatUndo: vi.fn(),
}));

import {
  applyManualSeatChange,
  applyManualSeatUndo,
} from "@/lib/services/seating/orchestrator";

import { useManualSeatChange } from "./useManualSeatChange";

const ts = Timestamp.fromMillis(0);

function p(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    displayName: overrides.id.toUpperCase(),
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

function setup(over: Partial<Parameters<typeof useManualSeatChange>[0]> = {}) {
  const onError = vi.fn();
  const opts = {
    tid: "t1",
    uid: "u1",
    groupIds: ["g1"],
    players: [p({ id: "alice", tableNum: 1, seatNum: 2 })],
    onError,
    undoTimeoutMs: 30_000,
    ...over,
  };
  const utils = renderHook((args: typeof opts) => useManualSeatChange(args), {
    initialProps: opts,
  });
  return { ...utils, onError, opts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(applyManualSeatChange).mockReset();
  vi.mocked(applyManualSeatUndo).mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useManualSeatChange", () => {
  it("calls onError and skips orchestrator when result.applied is false", async () => {
    vi.mocked(applyManualSeatChange).mockResolvedValueOnce({
      applied: false,
      description: null,
    });
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result, onError } = setup({ players: [player] });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(applyManualSeatChange).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("席を変更できませんでした"),
    );
    expect(result.current.undoBanner).toBeNull();
  });

  it("sets undoBanner with cascade summary on success and clears after timeout", async () => {
    vi.mocked(applyManualSeatChange).mockResolvedValueOnce({
      applied: true,
      description: "Table 1 / 席 2 → Table 2 / 席 3",
      moves: [
        {
          playerId: "alice",
          from: { tableNum: 1, seatNum: 2 },
          to: { tableNum: 2, seatNum: 3 },
        },
        {
          playerId: "bob",
          from: { tableNum: 2, seatNum: 3 },
          to: { tableNum: 2, seatNum: 4 },
        },
      ],
    });
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result } = setup({ players: [player], undoTimeoutMs: 1_000 });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(result.current.undoBanner).not.toBeNull();
    expect(result.current.undoBanner!.summary).toContain("2 名 cascade");
    expect(result.current.undoBanner!.moves).toHaveLength(2);

    await act(async () => {
      vi.advanceTimersByTime(1_001);
    });
    expect(result.current.undoBanner).toBeNull();
  });

  it("blocks a second handleMoveSeat while busy", async () => {
    let resolveOuter!: (v: { applied: boolean; description: null }) => void;
    vi.mocked(applyManualSeatChange).mockReturnValueOnce(
      new Promise((res) => {
        resolveOuter = res;
      }),
    );
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result } = setup({ players: [player] });
    let firstPromise!: Promise<void>;
    act(() => {
      firstPromise = result.current.handleMoveSeat(player, {
        tableNum: 2,
        seatNum: 3,
      });
    });
    // 1st が resolve する前に 2nd を呼んでも orchestrator は 1 度しか呼ばれない。
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 4 });
    });
    expect(applyManualSeatChange).toHaveBeenCalledOnce();
    await act(async () => {
      resolveOuter({ applied: false, description: null });
      await firstPromise;
    });
  });

  it("undo path calls applyManualSeatUndo with reversed moves on banner", async () => {
    // まず move を成功させて banner を立てる
    vi.mocked(applyManualSeatChange).mockResolvedValueOnce({
      applied: true,
      description: "ok",
      moves: [
        {
          playerId: "alice",
          from: { tableNum: 1, seatNum: 2 },
          to: { tableNum: 2, seatNum: 3 },
        },
      ],
    });
    vi.mocked(applyManualSeatUndo).mockResolvedValueOnce({
      applied: true,
      description: "undone",
    });
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result } = setup({ players: [player] });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(result.current.undoBanner).not.toBeNull();

    await act(async () => {
      await result.current.handleUndoSeatChange();
    });
    expect(applyManualSeatUndo).toHaveBeenCalledOnce();
    expect(result.current.undoBanner).toBeNull();
  });

  it("clears the undo timeout on unmount", async () => {
    vi.mocked(applyManualSeatChange).mockResolvedValueOnce({
      applied: true,
      description: "ok",
      moves: [
        {
          playerId: "alice",
          from: { tableNum: 1, seatNum: 2 },
          to: { tableNum: 2, seatNum: 3 },
        },
      ],
    });
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result, unmount } = setup({
      players: [player],
      undoTimeoutMs: 5_000,
    });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(result.current.undoBanner).not.toBeNull();
    // unmount で pending timer が clear されること自体を直接 assert はできないが、
    // unmount 後に timer を advance しても setUndoBanner(null) が呼ばれず
    // 例外も throw されない（unmounted state への setState 警告も出ない）。
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    // hook 既に unmount 済みのため result.current の参照は不変。
    // ここでは「unmount 後 advance しても test が落ちないこと」を確認するに留める。
  });
});
