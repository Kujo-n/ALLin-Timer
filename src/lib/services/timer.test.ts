import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

import { getLevelInfo, getNextBreakInfo, getRemainingMs, shouldAutoAdvance } from "./timer";

const baseCreatedAt = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const t0 = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));
const t0Ms = t0.toMillis();

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
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
        { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: t0,
    levelStartedAt: t0,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
    ...overrides,
  };
}

describe("getLevelInfo", () => {
  it("returns current and next when in middle level", () => {
    const t = makeTournament({ currentLevel: 2 });
    const info = getLevelInfo(t);
    expect(info?.current.level).toBe(2);
    expect(info?.next?.level).toBe(3);
    expect(info?.levelIndex).toBe(1);
  });

  it("returns null when currentLevel is 0 (setup)", () => {
    const t = makeTournament({ state: "setup", currentLevel: 0 });
    expect(getLevelInfo(t)).toBeNull();
  });

  it("returns null when currentLevel exceeds levels count", () => {
    const t = makeTournament({ currentLevel: 99 });
    expect(getLevelInfo(t)).toBeNull();
  });

  it("returns null next when on the final level", () => {
    const t = makeTournament({ currentLevel: 3 });
    const info = getLevelInfo(t);
    expect(info?.current.level).toBe(3);
    expect(info?.next).toBeNull();
  });
});

describe("getRemainingMs", () => {
  it("returns null when state is setup", () => {
    const t = makeTournament({ state: "setup", currentLevel: 0 });
    expect(getRemainingMs(t, t0Ms)).toBeNull();
  });

  it("returns null when levelStartedAt is null (pending-write)", () => {
    const t = makeTournament({ levelStartedAt: null });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBeNull();
  });

  it("returns 0 when state is finished and finishedAt is null", () => {
    // finishedAt 未確定（pending write 等）の防衛的フォールバック
    const t = makeTournament({ state: "finished", finishedAt: null });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBe(0);
  });

  it("freezes remaining at finishedAt when finished (pause-style behavior)", () => {
    // 5 秒経過時点で finish した場合、残り 595s で表示が固定される
    const finishedAt = Timestamp.fromMillis(t0Ms + 5_000);
    const t = makeTournament({ state: "finished", finishedAt });
    expect(getRemainingMs(t, t0Ms + 60_000)).toBe(600_000 - 5_000);
    expect(getRemainingMs(t, t0Ms + 999_999)).toBe(600_000 - 5_000);
  });

  it("returns duration - elapsed when running", () => {
    const t = makeTournament();
    expect(getRemainingMs(t, t0Ms + 5_000)).toBe(600_000 - 5_000);
  });

  it("adds back pausedAccumMs to remaining when running (treats paused time as not elapsed)", () => {
    const t = makeTournament({ pausedAccumMs: 30_000 });
    // elapsed = 5s - 30s = -25s, duration - elapsed = 600 - (-25) = 625s
    expect(getRemainingMs(t, t0Ms + 5_000)).toBe(625_000);
  });

  it("returns 0 (clamped) when elapsed exceeds duration", () => {
    const t = makeTournament();
    expect(getRemainingMs(t, t0Ms + 700_000)).toBe(0);
  });

  it("freezes remaining at pausedAt when paused", () => {
    const pausedAt = Timestamp.fromMillis(t0Ms + 100_000);
    const t = makeTournament({ state: "paused", pausedAt });
    // remaining at pause is 600s - 100s = 500s
    // nowMs advance shouldn't change it
    expect(getRemainingMs(t, t0Ms + 200_000)).toBe(500_000);
    expect(getRemainingMs(t, t0Ms + 999_999)).toBe(500_000);
  });

  it("returns null when paused but pausedAt is missing", () => {
    const t = makeTournament({ state: "paused", pausedAt: null });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBeNull();
  });

  it("returns null when level info missing (currentLevel out of range)", () => {
    const t = makeTournament({ currentLevel: 99 });
    expect(getRemainingMs(t, t0Ms + 5_000)).toBeNull();
  });
});

describe("getNextBreakInfo", () => {
  function withBreak() {
    return makeTournament({
      currentLevel: 1,
      structureSnapshot: {
        name: "with break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
          { level: 4, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
        ],
      },
    });
  }

  it("returns null when no break level remains", () => {
    const t = makeTournament();
    expect(getNextBreakInfo(t, 600_000)).toBeNull();
  });

  it("returns null when state is setup / seating / finished", () => {
    const t = withBreak();
    expect(getNextBreakInfo({ ...t, state: "setup" }, 600_000)).toBeNull();
    expect(getNextBreakInfo({ ...t, state: "seating" }, 600_000)).toBeNull();
    expect(getNextBreakInfo({ ...t, state: "finished" }, 600_000)).toBeNull();
  });

  it("computes etaMs as remainingMs + sum(durationSec) of intermediate levels", () => {
    const t = withBreak();
    // current=Lv1 (remaining 500s) + Lv2 (600s) → break at Lv3, eta=1100s
    const info = getNextBreakInfo(t, 500_000);
    expect(info?.level.level).toBe(3);
    expect(info?.levelsAhead).toBe(2);
    expect(info?.etaMs).toBe(500_000 + 600_000);
  });

  it("returns levelsAhead=0 when current level itself is a break", () => {
    const t = makeTournament({
      currentLevel: 3,
      structureSnapshot: {
        name: "now break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
        ],
      },
    });
    const info = getNextBreakInfo(t, 120_000);
    expect(info?.levelsAhead).toBe(0);
    expect(info?.etaMs).toBe(120_000);
  });

  it("falls back to current.durationSec when remainingMs is null", () => {
    const t = withBreak();
    const info = getNextBreakInfo(t, null);
    expect(info?.etaMs).toBe(600_000 + 600_000); // current full + Lv2 full
  });
});

describe("shouldAutoAdvance", () => {
  it("returns true when running, remaining is 0 and not on final level", () => {
    const t = makeTournament({ currentLevel: 1 });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(true);
  });

  it("returns false when remaining > 0", () => {
    const t = makeTournament({ currentLevel: 1 });
    expect(shouldAutoAdvance(t, t0Ms + 5_000)).toBe(false);
  });

  it("returns false on final level even if remaining is 0", () => {
    const t = makeTournament({ currentLevel: 3 });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(false);
  });

  it("returns false when paused", () => {
    const pausedAt = Timestamp.fromMillis(t0Ms + 700_000);
    const t = makeTournament({ state: "paused", pausedAt });
    expect(shouldAutoAdvance(t, t0Ms + 999_999)).toBe(false);
  });

  it("returns false when finished", () => {
    const t = makeTournament({ state: "finished" });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(false);
  });

  it("returns false when levelStartedAt is null", () => {
    const t = makeTournament({ levelStartedAt: null });
    expect(shouldAutoAdvance(t, t0Ms + 700_000)).toBe(false);
  });
});
