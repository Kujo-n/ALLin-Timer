import { fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

import { TimerControlsRunningPaused } from "./TimerControlsRunningPaused";

// Phase C: resume click 経路で resumeAudioContext が resumeTournament より先に呼ばれることを担保する。
// audio-context.ts は AudioContext singleton を内部で持つため module レベルで mock する。
vi.mock("@/lib/audio/audio-context", () => ({
  resumeAudioContext: vi.fn().mockResolvedValue("running"),
}));

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  pauseTournament: vi.fn().mockResolvedValue(undefined),
  resumeTournament: vi.fn().mockResolvedValue(undefined),
  advanceLevel: vi.fn().mockResolvedValue(undefined),
  revertLevel: vi.fn().mockResolvedValue(undefined),
}));

const baseCreatedAt = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));

function makePausedTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      ],
    },
    state: "paused",
    startedAt: baseCreatedAt,
    levelStartedAt: baseCreatedAt,
    pausedAt: baseCreatedAt,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("TimerControlsRunningPaused — resume button audio unlock (L2)", () => {
  it("再開ボタン押下で resumeAudioContext → resumeTournament の順に呼ばれる", async () => {
    const { resumeAudioContext } = await import("@/lib/audio/audio-context");
    const { resumeTournament } = await import("@/lib/firebase/repositories/tournaments");

    const run = vi.fn(async (_op, fn: () => Promise<void>) => {
      await fn();
    });

    render(
      <TimerControlsRunningPaused
        tid="t1"
        uid="u1"
        userGroupIds={["g1"]}
        tournament={makePausedTournament()}
        busy={null}
        run={run}
        setFinishConfirmOpen={vi.fn()}
        connectionBadge={null}
        fullscreenButton={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "再開" }));
    await vi.waitFor(() => {
      expect(resumeTournament).toHaveBeenCalledTimes(1);
    });

    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
    expect(resumeTournament).toHaveBeenCalledWith("t1", "u1", ["g1"]);

    // call order: resumeAudioContext が resumeTournament より先
    const audioOrder = vi.mocked(resumeAudioContext).mock.invocationCallOrder[0];
    const resumeOrder = vi.mocked(resumeTournament).mock.invocationCallOrder[0];
    expect(audioOrder).toBeLessThan(resumeOrder);
  });

  it("resumeAudioContext が reject しても resumeTournament は呼ばれる", async () => {
    const { resumeAudioContext } = await import("@/lib/audio/audio-context");
    const { resumeTournament } = await import("@/lib/firebase/repositories/tournaments");
    vi.mocked(resumeAudioContext).mockRejectedValueOnce(new Error("NotAllowedError"));

    const run = vi.fn(async (_op, fn: () => Promise<void>) => {
      await fn();
    });

    render(
      <TimerControlsRunningPaused
        tid="t1"
        uid="u1"
        userGroupIds={["g1"]}
        tournament={makePausedTournament()}
        busy={null}
        run={run}
        setFinishConfirmOpen={vi.fn()}
        connectionBadge={null}
        fullscreenButton={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "再開" }));
    await vi.waitFor(() => {
      expect(resumeTournament).toHaveBeenCalledTimes(1);
    });
    // resumeAudioContext の reject は握り潰され、再開フロー自体は継続する
    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
  });
});
