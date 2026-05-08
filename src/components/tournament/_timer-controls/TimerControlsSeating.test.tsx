import { fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import { TimerControlsSeating } from "./TimerControlsSeating";

// Phase C: confirmSeating click 経路で resumeAudioContext が confirmSeating より先に呼ばれることを担保する。
vi.mock("@/lib/audio/audio-context", () => ({
  resumeAudioContext: vi.fn().mockResolvedValue("running"),
}));

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  confirmSeating: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/services/seating/orchestrator", () => ({
  commitInitialSeating: vi.fn().mockResolvedValue(undefined),
}));

const entryAt = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));

function makePlayer(overrides: Partial<PlayerDoc> = {}): PlayerDoc {
  return {
    id: "p1",
    displayName: "Alice",
    uid: "u1",
    entryAt,
    isBusted: false,
    bustedAt: null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("TimerControlsSeating — confirm-seating audio unlock (L2)", () => {
  it("トーナメント開始押下で resumeAudioContext → confirmSeating の順に呼ばれる", async () => {
    const { resumeAudioContext } = await import("@/lib/audio/audio-context");
    const { confirmSeating } = await import("@/lib/firebase/repositories/tournaments");

    const run = vi.fn(async (_op, fn: () => Promise<void>) => {
      await fn();
    });

    render(
      <TimerControlsSeating
        tid="t1"
        uid="u1"
        userGroupIds={["g1"]}
        players={[makePlayer()]}
        busy={null}
        run={run}
        connectionBadge={null}
        fullscreenButton={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "トーナメント開始" }));
    await vi.waitFor(() => {
      expect(confirmSeating).toHaveBeenCalledTimes(1);
    });

    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
    expect(confirmSeating).toHaveBeenCalledWith("t1", "u1", ["g1"]);

    const audioOrder = vi.mocked(resumeAudioContext).mock.invocationCallOrder[0];
    const confirmOrder = vi.mocked(confirmSeating).mock.invocationCallOrder[0];
    expect(audioOrder).toBeLessThan(confirmOrder);
  });

  it("resumeAudioContext が reject しても confirmSeating は呼ばれる", async () => {
    const { resumeAudioContext } = await import("@/lib/audio/audio-context");
    const { confirmSeating } = await import("@/lib/firebase/repositories/tournaments");
    vi.mocked(resumeAudioContext).mockRejectedValueOnce(new Error("NotAllowedError"));

    const run = vi.fn(async (_op, fn: () => Promise<void>) => {
      await fn();
    });

    render(
      <TimerControlsSeating
        tid="t1"
        uid="u1"
        userGroupIds={["g1"]}
        players={[makePlayer()]}
        busy={null}
        run={run}
        connectionBadge={null}
        fullscreenButton={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "トーナメント開始" }));
    await vi.waitFor(() => {
      expect(confirmSeating).toHaveBeenCalledTimes(1);
    });
    expect(resumeAudioContext).toHaveBeenCalledTimes(1);
  });

  it("「席を再決定」では resumeAudioContext は呼ばれない（ユーザ gesture 起点ではあるが audio unlock 不要のため）", async () => {
    const { resumeAudioContext } = await import("@/lib/audio/audio-context");
    const { commitInitialSeating } = await import("@/lib/services/seating/orchestrator");

    const run = vi.fn(async (_op, fn: () => Promise<void>) => {
      await fn();
    });

    render(
      <TimerControlsSeating
        tid="t1"
        uid="u1"
        userGroupIds={["g1"]}
        players={[makePlayer()]}
        busy={null}
        run={run}
        connectionBadge={null}
        fullscreenButton={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "席を再決定" }));
    await vi.waitFor(() => {
      expect(commitInitialSeating).toHaveBeenCalledTimes(1);
    });
    expect(resumeAudioContext).not.toHaveBeenCalled();
  });
});
