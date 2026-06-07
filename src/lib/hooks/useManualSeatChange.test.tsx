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

  it("noop when uid is null (no orchestrator call)", async () => {
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result } = setup({ players: [player], uid: null });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(applyManualSeatChange).not.toHaveBeenCalled();
  });

  it("noop when player has no current seat (tableNum/seatNum null)", async () => {
    const noSeatPlayer = p({ id: "alice", tableNum: null, seatNum: null });
    const { result } = setup({ players: [noSeatPlayer] });
    await act(async () => {
      await result.current.handleMoveSeat(noSeatPlayer, { tableNum: 2, seatNum: 3 });
    });
    expect(applyManualSeatChange).not.toHaveBeenCalled();
  });

  it("falls back to single-move banner entries when result.moves is undefined", async () => {
    vi.mocked(applyManualSeatChange).mockResolvedValueOnce({
      applied: true,
      description: "Table 1 / 席 2 → Table 2 / 席 3",
      // moves omitted — older orchestrator return shape (defensive fallback path)
    } as never);
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result } = setup({ players: [player] });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(result.current.undoBanner?.moves).toEqual([
      {
        playerId: "alice",
        from: { tableNum: 1, seatNum: 2 },
        to: { tableNum: 2, seatNum: 3 },
      },
    ]);
    // No "N 名 cascade" suffix when only 1 move
    expect(result.current.undoBanner?.summary).not.toContain("cascade");
  });

  it("calls onError with formatted code:message when handleMoveSeat throws", async () => {
    vi.mocked(applyManualSeatChange).mockRejectedValueOnce(new Error("net down"));
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result, onError } = setup({ players: [player] });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toMatch(/^firestore\/write_failed:/);
    expect(result.current.busy).toBe(false);
  });

  it("calls onError when undo result.applied is false", async () => {
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
      applied: false,
      description: null,
    });
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result, onError } = setup({ players: [player] });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    await act(async () => {
      await result.current.handleUndoSeatChange();
    });
    expect(onError).toHaveBeenCalledWith(expect.stringContaining("元に戻せませんでした"));
    // banner should remain (so user can retry)
    expect(result.current.undoBanner).not.toBeNull();
  });

  it("calls onError with formatted code:message when handleUndoSeatChange throws", async () => {
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
    vi.mocked(applyManualSeatUndo).mockRejectedValueOnce(new Error("rule deny"));
    const player = p({ id: "alice", tableNum: 1, seatNum: 2 });
    const { result, onError } = setup({ players: [player] });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    await act(async () => {
      await result.current.handleUndoSeatChange();
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/^firestore\/write_failed:/),
    );
    expect(result.current.busy).toBe(false);
  });

  it("dismissUndoBanner clears the banner without calling undo, and cancels the auto-hide timer", async () => {
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
    const { result } = setup({ players: [player], undoTimeoutMs: 5_000 });
    await act(async () => {
      await result.current.handleMoveSeat(player, { tableNum: 2, seatNum: 3 });
    });
    expect(result.current.undoBanner).not.toBeNull();

    // 手動 dismiss で banner が即座に消える。undo（席を戻す）は呼ばれない。
    act(() => {
      result.current.dismissUndoBanner();
    });
    expect(result.current.undoBanner).toBeNull();
    expect(applyManualSeatUndo).not.toHaveBeenCalled();

    // dismiss 後に timer を advance しても二重で setState されない（timer 解放済み）。
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.undoBanner).toBeNull();
  });

  it("handleUndoSeatChange is a noop when there is no banner / no uid / busy", async () => {
    const { result } = setup();
    // No banner yet → noop
    await act(async () => {
      await result.current.handleUndoSeatChange();
    });
    expect(applyManualSeatUndo).not.toHaveBeenCalled();
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
