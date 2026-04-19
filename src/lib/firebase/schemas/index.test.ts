import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import { playerBodySchema } from "./player";
import { structureBodySchema } from "./structure";
import { tournamentBodySchema } from "./tournament";
import { userProfileBodySchema } from "./user";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));

const baseStructure = {
  ownerUid: "u1",
  name: "Default",
  initialStack: 10000,
  lateEntryDeadlineLevel: 6,
  levels: [
    { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 },
    { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600 },
  ],
  createdAt: now,
};

const baseTournament = {
  ownerUid: "u1",
  name: "Monthly",
  structureSnapshot: {
    name: "Default",
    initialStack: 10000,
    lateEntryDeadlineLevel: 6,
    levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 }],
  },
  state: "setup" as const,
  startedAt: null,
  currentLevel: 0,
  lateEntryDeadlineLevel: 6,
  createdAt: now,
  updatedAt: now,
};

describe("structureBodySchema", () => {
  it("parses a valid structure", () => {
    expect(structureBodySchema.parse(baseStructure).name).toBe("Default");
  });

  it("rejects empty levels", () => {
    const result = structureBodySchema.safeParse({ ...baseStructure, levels: [] });
    expect(result.success).toBe(false);
  });

  it("rejects negative sb", () => {
    const result = structureBodySchema.safeParse({
      ...baseStructure,
      levels: [{ level: 1, sb: -1, bb: 50, ante: 0, durationSec: 600 }],
    });
    expect(result.success).toBe(false);
  });
});

describe("tournamentBodySchema", () => {
  it("parses a valid tournament", () => {
    expect(tournamentBodySchema.parse(baseTournament).name).toBe("Monthly");
  });

  it("rejects an unknown state", () => {
    const result = tournamentBodySchema.safeParse({
      ...baseTournament,
      state: "unknown",
    });
    expect(result.success).toBe(false);
  });
});

describe("playerBodySchema", () => {
  it("accepts null uid (guest player)", () => {
    const result = playerBodySchema.safeParse({
      displayName: "Alice",
      uid: null,
      entryAt: now,
      isBusted: false,
      bustedAt: null,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty displayName", () => {
    const result = playerBodySchema.safeParse({
      displayName: "",
      uid: null,
      entryAt: now,
      isBusted: false,
      bustedAt: null,
    });
    expect(result.success).toBe(false);
  });
});

describe("userProfileBodySchema", () => {
  it("parses a valid profile", () => {
    const result = userProfileBodySchema.safeParse({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = userProfileBodySchema.safeParse({
      uid: "u1",
      displayName: "Alice",
      email: "not-an-email",
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });
});
