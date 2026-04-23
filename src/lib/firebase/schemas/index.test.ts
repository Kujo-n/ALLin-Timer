import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import { deriveRole, groupBodySchema, type GroupBody } from "./group";
import { groupJoinCodeBodySchema } from "./groupJoinCode";
import { playerBodySchema } from "./player";
import { levelSchema, structureBodySchema } from "./structure";
import { structureTemplateBodySchema } from "./structureTemplate";
import { templateAdminBodySchema } from "./templateAdmin";
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
  seatsPerTable: 9,
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

  // Phase 4.7: rebuy/addOn は optional で旧 doc は default null で受容される
  it("defaults rebuyStack / addOnStack to null when omitted", () => {
    const parsed = structureBodySchema.parse(baseStructure);
    expect(parsed.rebuyStack).toBeNull();
    expect(parsed.addOnStack).toBeNull();
  });

  it("accepts positive rebuyStack / addOnStack", () => {
    const parsed = structureBodySchema.parse({
      ...baseStructure,
      rebuyStack: 10000,
      addOnStack: 15000,
    });
    expect(parsed.rebuyStack).toBe(10000);
    expect(parsed.addOnStack).toBe(15000);
  });

  it("rejects zero or negative rebuyStack", () => {
    const result = structureBodySchema.safeParse({
      ...baseStructure,
      rebuyStack: 0,
    });
    expect(result.success).toBe(false);
  });
});

// Phase 4.7: levelSchema に isBreak を追加
describe("levelSchema", () => {
  it("defaults isBreak to false when omitted (legacy doc)", () => {
    const parsed = levelSchema.parse({
      level: 1,
      sb: 25,
      bb: 50,
      ante: 0,
      durationSec: 600,
    });
    expect(parsed.isBreak).toBe(false);
  });

  it("accepts break level with sb/bb/ante=0", () => {
    const parsed = levelSchema.parse({
      level: 5,
      sb: 0,
      bb: 0,
      ante: 0,
      durationSec: 300,
      isBreak: true,
    });
    expect(parsed.isBreak).toBe(true);
    expect(parsed.bb).toBe(0);
  });

  it("rejects play level with bb=0", () => {
    const result = levelSchema.safeParse({
      level: 2,
      sb: 0,
      bb: 0,
      ante: 0,
      durationSec: 300,
      isBreak: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts play level with bb>0", () => {
    const parsed = levelSchema.parse({
      level: 2,
      sb: 25,
      bb: 50,
      ante: 0,
      durationSec: 600,
      isBreak: false,
    });
    expect(parsed.bb).toBe(50);
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
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
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
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
    });
    expect(result.success).toBe(false);
  });

  it("accepts seated player with tableNum/seatNum/lastMovedAt", () => {
    const result = playerBodySchema.safeParse({
      displayName: "Alice",
      uid: "u1",
      entryAt: now,
      isBusted: false,
      bustedAt: null,
      tableNum: 1,
      seatNum: 3,
      lastMovedAt: now,
    });
    expect(result.success).toBe(true);
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
  it("parses a valid group with all 3 role arrays", () => {
    const result = groupBodySchema.safeParse({
      name: "Saturday Circle",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("accepts multi-owner groups", () => {
    const result = groupBodySchema.safeParse({
      name: "Big Circle",
      ownerUids: ["u1", "u2"],
      organizerUids: ["u1", "u2", "u3"],
      memberUids: ["u1", "u2", "u3", "u4"],
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty memberUids", () => {
    const result = groupBodySchema.safeParse({
      name: "X",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: [],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty ownerUids", () => {
    const result = groupBodySchema.safeParse({
      name: "X",
      ownerUids: [],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty name", () => {
    const result = groupBodySchema.safeParse({
      name: "",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects owners that are not organizers (invariant)", () => {
    const result = groupBodySchema.safeParse({
      name: "X",
      ownerUids: ["u1"],
      organizerUids: ["u2"],
      memberUids: ["u1", "u2"],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects organizers that are not members (invariant)", () => {
    const result = groupBodySchema.safeParse({
      name: "X",
      ownerUids: ["u1"],
      organizerUids: ["u1", "u9"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  // Phase 4.7: memberDisplayNames の値制約 — 1〜15 文字
  it("accepts memberDisplayNames with 1〜15 char values", () => {
    const result = groupBodySchema.safeParse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1", "u2"],
      memberDisplayNames: { u1: "A", u2: "123456789012345" },
      createdAt: now,
    });
    expect(result.success).toBe(true);
  });

  it("rejects memberDisplayNames with empty-string value", () => {
    const result = groupBodySchema.safeParse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      memberDisplayNames: { u1: "" },
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("rejects memberDisplayNames with >15 char value", () => {
    const result = groupBodySchema.safeParse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      memberDisplayNames: { u1: "1234567890123456" }, // 16 chars
      createdAt: now,
    });
    expect(result.success).toBe(false);
  });

  it("defaults memberDisplayNames to {} for legacy docs without the field", () => {
    const parsed = groupBodySchema.parse({
      name: "G",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      createdAt: now,
    });
    expect(parsed.memberDisplayNames).toEqual({});
  });
});

describe("deriveRole", () => {
  const baseGroup: GroupBody = {
    name: "G",
    ownerUids: ["u-owner"],
    organizerUids: ["u-owner", "u-org"],
    memberUids: ["u-owner", "u-org", "u-mem"],
    memberDisplayNames: {},
    createdAt: now,
  };

  it("returns 'owner' when uid is in ownerUids", () => {
    expect(deriveRole(baseGroup, "u-owner")).toBe("owner");
  });

  it("returns 'organizer' when uid is organizer-only", () => {
    expect(deriveRole(baseGroup, "u-org")).toBe("organizer");
  });

  it("returns 'member' when uid is member-only", () => {
    expect(deriveRole(baseGroup, "u-mem")).toBe("member");
  });

  it("returns null when uid is not in the group at all", () => {
    expect(deriveRole(baseGroup, "u-stranger")).toBeNull();
  });
});

// Phase 4.8: structureTemplates — サークル横断の Structure Templates
describe("structureTemplateBodySchema", () => {
  const baseTemplate = {
    name: "Standard 20min",
    description: "平均的な進行",
    initialStack: 10000,
    lateEntryDeadlineLevel: 6,
    levels: [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600 },
    ],
    createdByUid: "u1",
    createdByDisplayName: "たろう",
    createdAt: now,
  };

  it("parses a valid template", () => {
    const result = structureTemplateBodySchema.safeParse(baseTemplate);
    expect(result.success).toBe(true);
  });

  it("defaults description to '' when omitted (legacy doc)", () => {
    const { description: _omit, ...rest } = baseTemplate;
    void _omit;
    const parsed = structureTemplateBodySchema.parse(rest);
    expect(parsed.description).toBe("");
  });

  it("rejects empty createdByDisplayName", () => {
    const result = structureTemplateBodySchema.safeParse({
      ...baseTemplate,
      createdByDisplayName: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects createdByDisplayName over DISPLAY_NAME_MAX_LENGTH (15) chars", () => {
    // firestore.rules の createdByDisplayName.size() <= 15 と同期（L-1 対応）。
    const result = structureTemplateBodySchema.safeParse({
      ...baseTemplate,
      createdByDisplayName: "a".repeat(16),
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty createdByUid", () => {
    const result = structureTemplateBodySchema.safeParse({
      ...baseTemplate,
      createdByUid: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects description over 200 chars", () => {
    const result = structureTemplateBodySchema.safeParse({
      ...baseTemplate,
      description: "a".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("rejects name over 60 chars", () => {
    const result = structureTemplateBodySchema.safeParse({
      ...baseTemplate,
      name: "a".repeat(61),
    });
    expect(result.success).toBe(false);
  });

  it("defaults rebuyStack / addOnStack to null when omitted", () => {
    const parsed = structureTemplateBodySchema.parse(baseTemplate);
    expect(parsed.rebuyStack).toBeNull();
    expect(parsed.addOnStack).toBeNull();
  });

  it("rejects empty levels", () => {
    const result = structureTemplateBodySchema.safeParse({ ...baseTemplate, levels: [] });
    expect(result.success).toBe(false);
  });
});

describe("templateAdminBodySchema", () => {
  it("parses a valid admin marker (createdAt only)", () => {
    const result = templateAdminBodySchema.safeParse({ createdAt: now });
    expect(result.success).toBe(true);
  });

  it("rejects non-Timestamp createdAt", () => {
    const result = templateAdminBodySchema.safeParse({ createdAt: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("rejects missing createdAt", () => {
    const result = templateAdminBodySchema.safeParse({});
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
