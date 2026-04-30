import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type {
  TournamentDoc,
  TournamentState,
} from "@/lib/firebase/schemas/tournament";

import {
  canAdvanceLevel,
  canBeginSeating,
  canCommitInitialSeating,
  canConfirmSeating,
  canDelete,
  canEdit,
  canFinish,
  canPause,
  canResume,
  canRevertLevel,
  isFinished,
  isInProgress,
  isPaused,
  isRunning,
  isSeating,
  isSetup,
  showSeatingBoard,
} from "./tournament-state";

const ALL_STATES: readonly TournamentState[] = [
  "setup",
  "seating",
  "running",
  "paused",
  "finished",
];

function ts(): Timestamp {
  return Timestamp.fromMillis(0);
}

function tournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t-1",
    groupId: "g-1",
    createdByUid: "u-1",
    name: "Test Tournament",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        { level: 3, sb: 75, bb: 150, ante: 0, durationSec: 600, isBreak: false },
      ],
    },
    state: "setup",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: ts(),
    updatedAt: ts(),
    ...overrides,
  };
}

describe("tournament-state — state predicates", () => {
  it.each(ALL_STATES)("isSetup is true only for state=setup (state=%s)", (state) => {
    expect(isSetup(tournament({ state }))).toBe(state === "setup");
  });

  it.each(ALL_STATES)("isSeating is true only for state=seating (state=%s)", (state) => {
    expect(isSeating(tournament({ state }))).toBe(state === "seating");
  });

  it.each(ALL_STATES)("isRunning is true only for state=running (state=%s)", (state) => {
    expect(isRunning(tournament({ state }))).toBe(state === "running");
  });

  it.each(ALL_STATES)("isPaused is true only for state=paused (state=%s)", (state) => {
    expect(isPaused(tournament({ state }))).toBe(state === "paused");
  });

  it.each(ALL_STATES)("isFinished is true only for state=finished (state=%s)", (state) => {
    expect(isFinished(tournament({ state }))).toBe(state === "finished");
  });

  it.each(ALL_STATES)(
    "isInProgress is true only for running or paused (state=%s)",
    (state) => {
      expect(isInProgress(tournament({ state }))).toBe(
        state === "running" || state === "paused",
      );
    },
  );
});

describe("tournament-state — operation guards", () => {
  it.each(ALL_STATES)("canEdit allows only setup (state=%s)", (state) => {
    expect(canEdit(tournament({ state }))).toBe(state === "setup");
  });

  it.each(ALL_STATES)("canDelete allows setup or finished (state=%s)", (state) => {
    expect(canDelete(tournament({ state }))).toBe(
      state === "setup" || state === "finished",
    );
  });

  it.each(ALL_STATES)("canBeginSeating allows only setup (state=%s)", (state) => {
    expect(canBeginSeating(tournament({ state }))).toBe(state === "setup");
  });

  it.each(ALL_STATES)("canConfirmSeating allows only seating (state=%s)", (state) => {
    expect(canConfirmSeating(tournament({ state }))).toBe(state === "seating");
  });

  it.each(ALL_STATES)(
    "canCommitInitialSeating allows setup or seating (state=%s)",
    (state) => {
      expect(canCommitInitialSeating(tournament({ state }))).toBe(
        state === "setup" || state === "seating",
      );
    },
  );

  it.each(ALL_STATES)("canPause allows only running (state=%s)", (state) => {
    expect(canPause(tournament({ state }))).toBe(state === "running");
  });

  it.each(ALL_STATES)("canResume allows only paused (state=%s)", (state) => {
    expect(canResume(tournament({ state }))).toBe(state === "paused");
  });

  it.each(ALL_STATES)("canFinish allows running or paused (state=%s)", (state) => {
    expect(canFinish(tournament({ state }))).toBe(
      state === "running" || state === "paused",
    );
  });
});

describe("tournament-state — level boundary guards", () => {
  describe("canAdvanceLevel", () => {
    it("returns true while currentLevel < levels.length", () => {
      expect(canAdvanceLevel(tournament({ currentLevel: 0 }))).toBe(true);
      expect(canAdvanceLevel(tournament({ currentLevel: 1 }))).toBe(true);
      expect(canAdvanceLevel(tournament({ currentLevel: 2 }))).toBe(true);
    });

    it("returns false at currentLevel === levels.length", () => {
      expect(canAdvanceLevel(tournament({ currentLevel: 3 }))).toBe(false);
    });

    it("returns false past the last level", () => {
      expect(canAdvanceLevel(tournament({ currentLevel: 4 }))).toBe(false);
    });
  });

  describe("canRevertLevel", () => {
    it("returns false when currentLevel <= 1", () => {
      expect(canRevertLevel(tournament({ currentLevel: 0 }))).toBe(false);
      expect(canRevertLevel(tournament({ currentLevel: 1 }))).toBe(false);
    });

    it("returns true when currentLevel > 1", () => {
      expect(canRevertLevel(tournament({ currentLevel: 2 }))).toBe(true);
      expect(canRevertLevel(tournament({ currentLevel: 100 }))).toBe(true);
    });
  });
});

describe("tournament-state — UI visibility helpers", () => {
  it.each(ALL_STATES)(
    "showSeatingBoard is true for seating, running, paused (state=%s)",
    (state) => {
      expect(showSeatingBoard(tournament({ state }))).toBe(
        state === "seating" || state === "running" || state === "paused",
      );
    },
  );
});
