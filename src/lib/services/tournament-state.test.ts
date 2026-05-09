import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type {
  TournamentDoc,
  TournamentState,
} from "@/lib/firebase/schemas/tournament";

import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";

import {
  canAdvanceLevel,
  canAppendLevel,
  canBeginSeating,
  canClone,
  canCommitInitialSeating,
  canConfirmSeating,
  canDelete,
  canEdit,
  canEditLevelDurations,
  canFinish,
  canPause,
  canResume,
  canRevertLevel,
  isBeforeStart,
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
    spectateEnabled: false,
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

  it.each(ALL_STATES)(
    "isBeforeStart is true only for setup or seating (state=%s)",
    (state) => {
      expect(isBeforeStart(tournament({ state }))).toBe(
        state === "setup" || state === "seating",
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

describe("canEditLevelDurations", () => {
  // levels.length === 3, currentLevel は overrides で設定する。

  it("setup 中は全レベル編集可", () => {
    const t = tournament({ state: "setup", currentLevel: 0 });
    expect(canEditLevelDurations(t, 0)).toBe(true);
    expect(canEditLevelDurations(t, 1)).toBe(true);
    expect(canEditLevelDurations(t, 2)).toBe(true);
  });

  it("seating 中（currentLevel=0）は全レベル編集可", () => {
    const t = tournament({ state: "seating", currentLevel: 0 });
    expect(canEditLevelDurations(t, 0)).toBe(true);
    expect(canEditLevelDurations(t, 1)).toBe(true);
    expect(canEditLevelDurations(t, 2)).toBe(true);
  });

  it("running 中の過去レベルは編集不可", () => {
    const t = tournament({ state: "running", currentLevel: 3 });
    expect(canEditLevelDurations(t, 0)).toBe(false);
    expect(canEditLevelDurations(t, 1)).toBe(false);
  });

  it("running 中の現在レベル（levelIndex === currentLevel - 1）は編集可", () => {
    const t = tournament({ state: "running", currentLevel: 3 });
    expect(canEditLevelDurations(t, 2)).toBe(true);
  });

  it("paused 中の未来レベルは編集可", () => {
    // levels.length=5 にしないと未来 lvl 比較できないので拡張
    const t = tournament({
      state: "paused",
      currentLevel: 3,
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
          { level: 4, sb: 100, bb: 200, ante: 0, durationSec: 600, isBreak: false },
          { level: 5, sb: 150, bb: 300, ante: 0, durationSec: 600, isBreak: false },
        ],
      },
    });
    expect(canEditLevelDurations(t, 3)).toBe(true);
    expect(canEditLevelDurations(t, 4)).toBe(true);
  });

  it("finished では全レベル編集不可", () => {
    const t = tournament({ state: "finished", currentLevel: 3 });
    expect(canEditLevelDurations(t, 0)).toBe(false);
    expect(canEditLevelDurations(t, 1)).toBe(false);
    expect(canEditLevelDurations(t, 2)).toBe(false);
  });

  it("levelIndex が負なら false", () => {
    const t = tournament({ state: "running", currentLevel: 3 });
    expect(canEditLevelDurations(t, -1)).toBe(false);
  });

  it("levelIndex が levels.length 以上なら false", () => {
    const t = tournament({ state: "running", currentLevel: 3 });
    expect(canEditLevelDurations(t, 3)).toBe(false);
    expect(canEditLevelDurations(t, 100)).toBe(false);
  });

  it("levelIndex が非整数（1.5）なら false", () => {
    const t = tournament({ state: "running", currentLevel: 3 });
    expect(canEditLevelDurations(t, 1.5)).toBe(false);
  });
});

describe("canAppendLevel", () => {
  function makeNLevelLevels(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      level: i + 1,
      sb: 25,
      bb: 50,
      ante: 0,
      durationSec: 600,
      isBreak: false,
    }));
  }

  function tournamentWithLevels(
    state: TournamentDoc["state"],
    levelCount: number,
  ): TournamentDoc {
    return tournament({
      state,
      structureSnapshot: {
        name: "Default",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: makeNLevelLevels(levelCount),
      },
    });
  }

  it.each(["setup", "seating", "running", "paused"] as const)(
    "state=%s かつ levels.length < MAX なら true",
    (state) => {
      expect(canAppendLevel(tournamentWithLevels(state, 3))).toBe(true);
    },
  );

  it("state=finished では levels.length に関わらず false", () => {
    expect(canAppendLevel(tournamentWithLevels("finished", 3))).toBe(false);
  });

  it("levels.length === MAX_LEVELS_PER_TOURNAMENT で false（上限到達）", () => {
    expect(
      canAppendLevel(tournamentWithLevels("running", MAX_LEVELS_PER_TOURNAMENT)),
    ).toBe(false);
  });

  it("levels.length === MAX_LEVELS_PER_TOURNAMENT - 1 で true（上限未到達）", () => {
    expect(
      canAppendLevel(tournamentWithLevels("running", MAX_LEVELS_PER_TOURNAMENT - 1)),
    ).toBe(true);
  });
});

describe("canClone", () => {
  it.each(ALL_STATES)("state=%s で finished のときのみ true", (state) => {
    expect(canClone(tournament({ state }))).toBe(state === "finished");
  });
});
