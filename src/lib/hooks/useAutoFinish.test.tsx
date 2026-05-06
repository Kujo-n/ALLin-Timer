import { act, renderHook } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  finishTournament: vi.fn(),
}));

import { finishTournament } from "@/lib/firebase/repositories/tournaments";

import { useAutoFinish } from "./useAutoFinish";

const ts = Timestamp.fromMillis(0);

function makeTournament(over: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t-1",
    groupId: "g-1",
    createdByUid: "u-org",
    name: "T",
    structureSnapshot: {
      name: "S",
      initialStack: 5000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 4,
      levels: [{ levelNum: 1, smallBlind: 25, bigBlind: 50, ante: 0, durationMin: 20 }],
    },
    state: "running",
    startedAt: ts,
    levelStartedAt: ts,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    seatsPerTable: 8,
    currentLevelIndex: 0,
    ...over,
  } as unknown as TournamentDoc;
}

function setup(over: Partial<Parameters<typeof useAutoFinish>[0]> = {}) {
  const opts: Parameters<typeof useAutoFinish>[0] = {
    tournament: makeTournament(),
    winnerId: "u-winner",
    uid: "u-org",
    groupIds: ["g-1"],
    delayMs: 1_000,
    ...over,
  };
  const utils = renderHook(
    (a: typeof opts) => useAutoFinish(a),
    { initialProps: opts },
  );
  return { ...utils, opts };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(finishTournament).mockReset();
  vi.mocked(finishTournament).mockResolvedValue(undefined as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useAutoFinish", () => {
  it("calls finishTournament after delayMs when conditions satisfied (running + winner + group member)", async () => {
    setup();
    expect(finishTournament).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(finishTournament).toHaveBeenCalledWith("t-1", "u-org", ["g-1"]);
  });

  it("triggers in paused state too (paused → resolveWinner can still observe last-survivor)", async () => {
    setup({ tournament: makeTournament({ state: "paused" }) });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
    });
    expect(finishTournament).toHaveBeenCalledTimes(1);
  });

  it("does not call finishTournament when winnerId is null", async () => {
    setup({ winnerId: null });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("does not call finishTournament when uid is undefined", async () => {
    setup({ uid: undefined });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("does not call finishTournament when tournament is null", async () => {
    setup({ tournament: null });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("does not call finishTournament when user is not a member of tournament group", async () => {
    setup({ groupIds: ["g-other"] });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("does not call finishTournament for setup / seating / finished states", async () => {
    for (const state of ["setup", "seating", "finished"] as const) {
      vi.mocked(finishTournament).mockClear();
      const { unmount } = setup({ tournament: makeTournament({ state }) });
      await act(async () => {
        vi.advanceTimersByTime(5_000);
        await Promise.resolve();
      });
      expect(finishTournament).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("clears the timer on unmount before it fires (no auto finish)", async () => {
    const { unmount } = setup();
    unmount();
    await act(async () => {
      vi.advanceTimersByTime(5_000);
      await Promise.resolve();
    });
    expect(finishTournament).not.toHaveBeenCalled();
  });

  it("logs warn with code when finishTournament rejects with AppError", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(finishTournament).mockRejectedValueOnce(
      new AppError("既に終了済み", "tournament/already-finished"),
    );
    setup();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      // promise chain: setTimeout → finishTournament reject → .catch(...) runs
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "auto finish failed",
      expect.objectContaining({ code: "tournament/already-finished", tid: "t-1" }),
    );
  });

  it("logs warn with getErrorCode fallback when reject is a plain Error", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(finishTournament).mockRejectedValueOnce(new Error("boom"));
    setup();
    await act(async () => {
      vi.advanceTimersByTime(1_000);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(warnSpy).toHaveBeenCalledWith(
      "auto finish failed",
      expect.objectContaining({ tid: "t-1" }),
    );
  });
});
