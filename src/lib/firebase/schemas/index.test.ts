import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import { groupBodySchema } from "./group";
import { groupJoinCodeBodySchema } from "./groupJoinCode";
import { playerBodySchema } from "./player";
import { structureBodySchema } from "./structure";
import { tournamentBodySchema } from "./tournament";
import { userProfileBodySchema } from "./user";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const future = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));

const baseStructure = {
  groupId: "g1",
  createdByUid: "u1",
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
  groupId: "g1",
  createdByUid: "u1",
  name: "Monthly",
  structureSnapshot: {
    name: "Default",
    initialStack: 10000,
    lateEntryDeadlineLevel: 6,
    levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 }],
  },
  state: "setup" as const,
  startedAt: null,
  levelStartedAt: null,
  pausedAt: null,
  pausedAccumMs: 0,
  finishedAt: null,
  currentLevel: 0,
  lateEntryDeadlineLevel: 6,
  createdAt: now,
  updatedAt: now,
};

describe("structureBodySchema", () => {
  it("parses a valid structure", () => {
    expect(structureBodySchema.parse(baseStructure).name).toBe("Default");
  });

  it("requires groupId", () => {
    const { groupId: _omit, ...rest } = baseStructure;
    void _omit;
    const result = structureBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("requires createdByUid", () => {
    const { createdByUid: _omit, ...rest } = baseStructure;
    void _omit;
    const result = structureBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
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

  it("requires groupId", () => {
    const { groupId: _omit, ...rest } = baseTournament;
    void _omit;
    const result = tournamentBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown state", () => {
    const result = tournamentBodySchema.safeParse({
      ...baseTournament,
      state: "unknown",
    });
    expect(result.success).toBe(false);
  });

  it("parses a valid tournament with timer fields populated", () => {
    const result = tournamentBodySchema.safeParse({
      ...baseTournament,
      state: "running" as const,
      startedAt: now,
      levelStartedAt: now,
      pausedAt: null,
      pausedAccumMs: 0,
      finishedAt: null,
      currentLevel: 1,
    });
    expect(result.success).toBe(true);
  });

  it("requires pausedAccumMs", () => {
    const { pausedAccumMs: _omit, ...rest } = baseTournament;
    void _omit;
    const result = tournamentBodySchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects negative pausedAccumMs", () => {
    const result = tournamentBodySchema.safeParse({
      ...baseTournament,
      pausedAccumMs: -1,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-Timestamp pausedAt", () => {
    const result = tournamentBodySchema.safeParse({
      ...baseTournament,
      pausedAt: "invalid",
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
  it("parses a valid profile (groupIds explicit)", () => {
    const result = userProfileBodySchema.safeParse({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      groupIds: ["g1", "g2"],
      createdAt: now,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupIds).toEqual(["g1", "g2"]);
    }
  });

  it("defaults groupIds to [] when omitted", () => {
    const result = userProfileBodySchema.safeParse({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      createdAt: now,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.groupIds).toEqual([]);
    }
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

describe("groupBodySchema", () => {
  it("parses a valid group", () => {
    const result = groupBodySchema.safeParse({
      name: "Saturday Circle",
      ownerUid: "u1",
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty memberUids", () => {
    const result = groupBodySchema.safeParse({
      name: "X",
      ownerUid: "u1",
      memberUids: [],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = groupBodySchema.safeParse({
      name: "",
      ownerUid: "u1",
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });
});

describe("groupJoinCodeBodySchema", () => {
  it("parses a valid code (maxUses null)", () => {
    const result = groupJoinCodeBodySchema.safeParse({
      gid: "g1",
      createdByUid: "u1",
      expiresAt: future,
      maxUses: null,
      usesCount: 0,
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("rejects negative usesCount", () => {
    const result = groupJoinCodeBodySchema.safeParse({
      gid: "g1",
      createdByUid: "u1",
      expiresAt: future,
      maxUses: 5,
      usesCount: -1,
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects zero or negative maxUses (must be positive when set)", () => {
    const result = groupJoinCodeBodySchema.safeParse({
      gid: "g1",
      createdByUid: "u1",
      expiresAt: future,
      maxUses: 0,
      usesCount: 0,
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });
});
