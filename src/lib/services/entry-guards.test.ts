import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { TournamentDoc, TournamentState } from "@/lib/firebase/schemas/tournament";

import { assertAcceptingEntries, parseDisplayName } from "./entry-guards";

function fakeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t-1",
    groupId: "g-1",
    createdByUid: "owner-uid",
    name: "Guard Test",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [],
    },
    state: "setup" as TournamentState,
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: Timestamp.fromMillis(0),
    updatedAt: Timestamp.fromMillis(0),
    ...overrides,
  } as TournamentDoc;
}

describe("assertAcceptingEntries", () => {
  it.each(["setup", "seating"] as const)("受付前 state (%s) は通す", (state) => {
    expect(() => assertAcceptingEntries(fakeTournament({ state }))).not.toThrow();
  });

  it("締切以内の running は通す", () => {
    expect(() =>
      assertAcceptingEntries(
        fakeTournament({ state: "running", currentLevel: 3, lateEntryDeadlineLevel: 6 }),
      ),
    ).not.toThrow();
  });

  it("finished は tournament/late-entry-closed を throw", () => {
    expect(() => assertAcceptingEntries(fakeTournament({ state: "finished" }))).toThrowError(
      expect.objectContaining({ code: "tournament/late-entry-closed" }),
    );
  });

  it("running + 締切超過は tournament/late-entry-closed を throw", () => {
    expect(() =>
      assertAcceptingEntries(
        fakeTournament({ state: "running", currentLevel: 7, lateEntryDeadlineLevel: 6 }),
      ),
    ).toThrowError(expect.objectContaining({ code: "tournament/late-entry-closed" }));
  });
});

describe("parseDisplayName", () => {
  it("trim して返す", () => {
    expect(parseDisplayName("  Alice  ")).toBe("Alice");
  });

  it.each([null, undefined, "", "   "])("空 / whitespace (%s) は required throw", (input) => {
    expect(() => parseDisplayName(input)).toThrowError(
      expect.objectContaining({ code: "validation/display-name-required" }),
    );
  });

  it("maxLength 未指定なら長い名前も通す（通常受付経路）", () => {
    expect(parseDisplayName("x".repeat(100))).toBe("x".repeat(100));
  });

  it("maxLength 指定で超過すると too-long throw（代理受付経路）", () => {
    expect(() => parseDisplayName("x".repeat(16), { maxLength: 15 })).toThrowError(
      expect.objectContaining({ code: "validation/display-name-too-long" }),
    );
  });

  it("maxLength 境界（ちょうど）は通す", () => {
    expect(parseDisplayName("x".repeat(15), { maxLength: 15 })).toBe("x".repeat(15));
  });
});
