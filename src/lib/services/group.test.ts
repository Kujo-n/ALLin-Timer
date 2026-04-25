import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { GroupJoinCodeDoc } from "@/lib/firebase/schemas/groupJoinCode";

// firestore singleton はテスト中に直接触らないためダミーで mock しておく。
vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    runTransaction: vi.fn(),
    arrayUnion: vi.fn((...args: unknown[]) => ({ __op: "arrayUnion", args })),
    increment: vi.fn((n: number) => ({ __op: "increment", n })),
  };
});

vi.mock("@/lib/firebase/repositories/groups", () => ({
  groupDocRef: vi.fn((gid: string) => ({ __ref: "groups", gid })),
  createGroup: vi.fn(),
  getGroup: vi.fn(),
  listMyGroups: vi.fn(),
  updateGroupName: vi.fn(),
  updateGroupRoles: vi.fn(),
  removeMemberSelf: vi.fn(),
  deleteGroup: vi.fn(),
  setMemberDisplayName: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/groupJoinCodes", () => ({
  joinCodeDocRef: vi.fn((code: string) => ({ __ref: "joinCode", code })),
  createJoinCode: vi.fn(),
  getJoinCode: vi.fn(),
  isJoinCodeUsable: (codeDoc: GroupJoinCodeDoc, now: Date = new Date()): boolean => {
    if (codeDoc.expiresAt.toMillis() <= now.getTime()) return false;
    if (codeDoc.maxUses !== null && codeDoc.usesCount >= codeDoc.maxUses) {
      return false;
    }
    return true;
  },
  defaultExpiresAt: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/users", () => ({
  addGroupIdToUser: vi.fn(),
  removeGroupIdFromUser: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
  upsertUserProfile: vi.fn(),
}));

import { runTransaction } from "firebase/firestore";

import {
  createGroup,
  deleteGroup,
  getGroup,
  removeMemberSelf,
  setMemberDisplayName,
  updateGroupName,
  updateGroupRoles,
} from "@/lib/firebase/repositories/groups";
import { createJoinCode, getJoinCode } from "@/lib/firebase/repositories/groupJoinCodes";
import {
  addGroupIdToUser,
  getUserProfile,
  removeGroupIdFromUser,
} from "@/lib/firebase/repositories/users";

import {
  consumeJoinCode,
  createGroupWithOwner,
  deleteGroupByOwner,
  demoteOwner,
  demoteToMember,
  generateJoinCode,
  leaveGroup,
  promoteToOrganizer,
  promoteToOwner,
  propagateDisplayNameToGroups,
  renameGroup,
} from "./group";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const future = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));
const past = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return {
    id: "g1",
    name: "Saturday",
    ownerUids,
    organizerUids,
    memberUids,
    memberDisplayNames: {},
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    },
    createdAt: now,
    ...overrides,
  };
}

function makeCode(overrides: Partial<GroupJoinCodeDoc> = {}): GroupJoinCodeDoc {
  return {
    id: "code123",
    gid: "g1",
    createdByUid: "u-owner",
    expiresAt: future,
    maxUses: null,
    usesCount: 0,
    createdAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(createGroup).mockReset();
  vi.mocked(getGroup).mockReset();
  vi.mocked(removeMemberSelf).mockReset();
  vi.mocked(deleteGroup).mockReset();
  vi.mocked(updateGroupName).mockReset();
  vi.mocked(updateGroupRoles).mockReset();
  vi.mocked(setMemberDisplayName).mockReset();
  vi.mocked(getJoinCode).mockReset();
  vi.mocked(createJoinCode).mockReset();
  vi.mocked(addGroupIdToUser).mockReset();
  vi.mocked(removeGroupIdFromUser).mockReset();
  vi.mocked(runTransaction).mockReset();
  vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
});

describe("createGroupWithOwner", () => {
  it("creates a group then registers gid into the user's groupIds", async () => {
    vi.mocked(createGroup).mockResolvedValue("g-new");
    vi.mocked(addGroupIdToUser).mockResolvedValue();

    const gid = await createGroupWithOwner({ name: "Saturday", ownerUid: "u1" });

    expect(gid).toBe("g-new");
    // Phase 4.7: createGroup に ownerDisplayName も渡されるようになった
    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Saturday", ownerUid: "u1" }),
    );
    expect(addGroupIdToUser).toHaveBeenCalledWith("u1", "g-new");
  });

  // Phase 4.7 (M2): currentUser に displayName が無い場合、email ではなく uid にフォールバックする
  // （PII 露出を防ぐ）。
  it("falls back to uid instead of email when authUser.displayName is missing", async () => {
    vi.mocked(createGroup).mockResolvedValue("g-new");
    vi.mocked(addGroupIdToUser).mockResolvedValue();

    // firebaseAuth singleton を mock モジュールごと差し替え。ただし既に vi.mock で
    // currentUser: null として登録してあるため、ここでは動的に上書きする。
    const clientMock = await import("@/lib/firebase/client");
    Object.defineProperty(clientMock, "firebaseAuth", {
      configurable: true,
      value: {
        currentUser: { displayName: null, email: "leak@example.com" },
      },
    });

    await createGroupWithOwner({ name: "Saturday", ownerUid: "u1" });

    // email が ownerDisplayName に入らないことを確認
    expect(createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Saturday", ownerUid: "u1", ownerDisplayName: "u1" }),
    );
  });
});

describe("consumeJoinCode", () => {
  it("rejects with group/invalid-code when code does not exist", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(null);
    await expect(consumeJoinCode({ code: "missing", uid: "u-new" })).rejects.toMatchObject({
      code: "group/invalid-code",
    });
  });

  it("rejects expired codes", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(makeCode({ expiresAt: past }));
    await expect(consumeJoinCode({ code: "code123", uid: "u-new" })).rejects.toMatchObject({
      code: "group/invalid-code",
    });
  });

  it("rejects codes that hit maxUses", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(makeCode({ maxUses: 1, usesCount: 1 }));
    await expect(consumeJoinCode({ code: "code123", uid: "u-new" })).rejects.toMatchObject({
      code: "group/invalid-code",
    });
  });

  it("returns alreadyMember without running transaction when user.groupIds already contains gid", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(makeCode());
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u-new",
      displayName: "Bob",
      email: null,
      groupIds: ["g1"],
      createdAt: now,
    });

    const result = await consumeJoinCode({ code: "code123", uid: "u-new" });

    expect(result).toEqual({ gid: "g1", alreadyMember: true });
    expect(runTransaction).not.toHaveBeenCalled();
    expect(getGroup).not.toHaveBeenCalled();
  });

  it("runs transaction and adds groupId to user on happy path", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(makeCode());
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u-new",
      displayName: "Bob",
      email: null,
      groupIds: [],
      createdAt: now,
    });
    const txUpdate = vi.fn();
    vi.mocked(runTransaction).mockImplementation(async (_db, fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          id: "code123",
          data: () => makeCode(),
        }),
        update: txUpdate,
        set: vi.fn(),
        delete: vi.fn(),
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
    vi.mocked(addGroupIdToUser).mockResolvedValue();

    const result = await consumeJoinCode({ code: "code123", uid: "u-new" });

    expect(result).toEqual({ gid: "g1", alreadyMember: false });
    expect(runTransaction).toHaveBeenCalledTimes(1);
    expect(addGroupIdToUser).toHaveBeenCalledWith("u-new", "g1");

    // code doc は usesCount を +1、group doc は memberUids + joinCodeId を同 transaction で書く
    // （rule 側 self-add は joinCodeId を consumption proof として検証する）。
    const groupUpdateCall = txUpdate.mock.calls.find(
      ([ref]) => (ref as { __ref?: string }).__ref === "groups",
    );
    expect(groupUpdateCall).toBeDefined();
    expect(groupUpdateCall?.[1]).toMatchObject({ joinCodeId: "code123" });
  });

  it("wraps transaction failures as group/join-failed and does not add groupId to user", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(makeCode());
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u-new",
      displayName: "Bob",
      email: null,
      groupIds: [],
      createdAt: now,
    });
    vi.mocked(runTransaction).mockRejectedValue(new Error("firestore write aborted"));

    await expect(consumeJoinCode({ code: "code123", uid: "u-new" })).rejects.toMatchObject({
      code: "group/join-failed",
    });
    expect(addGroupIdToUser).not.toHaveBeenCalled();
  });
});

describe("leaveGroup", () => {
  it("rejects when uid is the last owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ ownerUids: ["u1"], organizerUids: ["u1"], memberUids: ["u1"] }),
    );
    await expect(leaveGroup({ gid: "g1", uid: "u1" })).rejects.toMatchObject({
      code: "group/last-owner-cannot-leave",
    });
    expect(removeMemberSelf).not.toHaveBeenCalled();
  });

  it("allows owner to leave when another owner remains", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u1", "u2"],
        organizerUids: ["u1", "u2"],
        memberUids: ["u1", "u2"],
      }),
    );
    vi.mocked(updateGroupRoles).mockResolvedValue();
    vi.mocked(removeMemberSelf).mockResolvedValue();
    vi.mocked(removeGroupIdFromUser).mockResolvedValue();

    await leaveGroup({ gid: "g1", uid: "u1" });

    expect(updateGroupRoles).toHaveBeenCalledWith("g1", { ownerUids: ["u2"] });
    expect(removeMemberSelf).toHaveBeenCalledWith("g1", "u1");
    expect(removeGroupIdFromUser).toHaveBeenCalledWith("u1", "g1");
  });

  it("removes member and updates user groupIds for non-owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner"],
        memberUids: ["u-owner", "u-new"],
      }),
    );
    vi.mocked(removeMemberSelf).mockResolvedValue();
    vi.mocked(removeGroupIdFromUser).mockResolvedValue();

    await leaveGroup({ gid: "g1", uid: "u-new" });

    expect(removeMemberSelf).toHaveBeenCalledWith("g1", "u-new");
    expect(removeGroupIdFromUser).toHaveBeenCalledWith("u-new", "g1");
    expect(updateGroupRoles).not.toHaveBeenCalled();
  });

  it("is idempotent when uid is not currently a member", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ memberUids: ["u-owner"] }));
    vi.mocked(removeGroupIdFromUser).mockResolvedValue();

    await expect(leaveGroup({ gid: "g1", uid: "u-new" })).resolves.toBeUndefined();
    expect(removeMemberSelf).not.toHaveBeenCalled();
  });
});

describe("generateJoinCode", () => {
  it("calls createJoinCode with default 7-day expiry and null maxUses", async () => {
    vi.mocked(createJoinCode).mockResolvedValue("abc123");

    const code = await generateJoinCode({ gid: "g1", createdByUid: "u-owner" });

    expect(code).toBe("abc123");
    expect(createJoinCode).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createJoinCode).mock.calls[0][0];
    expect(arg.gid).toBe("g1");
    expect(arg.createdByUid).toBe("u-owner");
    expect(arg.maxUses).toBeNull();
    expect(arg.expiresAt).toBeInstanceOf(Timestamp);
  });

  it("rejects non-positive expiresInDays", async () => {
    await expect(
      generateJoinCode({ gid: "g1", createdByUid: "u1", expiresInDays: 0 }),
    ).rejects.toBeInstanceOf(AppError);
  });
});

describe("deleteGroupByOwner", () => {
  it("rejects non-owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUids: ["u-owner"] }));
    await expect(deleteGroupByOwner({ gid: "g1", uid: "u-other" })).rejects.toMatchObject({
      code: "group/not-owner",
    });
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("deletes group and removes own groupIds", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUids: ["u-owner"] }));
    vi.mocked(deleteGroup).mockResolvedValue();
    vi.mocked(removeGroupIdFromUser).mockResolvedValue();

    await deleteGroupByOwner({ gid: "g1", uid: "u-owner" });

    expect(deleteGroup).toHaveBeenCalledWith("g1");
    expect(removeGroupIdFromUser).toHaveBeenCalledWith("u-owner", "g1");
  });
});

describe("renameGroup", () => {
  it("rejects when name is blank", async () => {
    await expect(renameGroup({ gid: "g1", uid: "u-owner", name: "   " })).rejects.toMatchObject({
      code: "validation/invalid-input",
    });
    expect(updateGroupName).not.toHaveBeenCalled();
  });

  it("rejects non-owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUids: ["u-owner"] }));
    await expect(renameGroup({ gid: "g1", uid: "u-other", name: "New" })).rejects.toMatchObject({
      code: "group/not-owner",
    });
    expect(updateGroupName).not.toHaveBeenCalled();
  });

  it("trims name and calls updateGroupName when owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUids: ["u-owner"] }));
    vi.mocked(updateGroupName).mockResolvedValue();

    await renameGroup({ gid: "g1", uid: "u-owner", name: "  New name  " });

    expect(updateGroupName).toHaveBeenCalledWith("g1", "New name");
  });
});

describe("promoteToOrganizer", () => {
  it("adds target to organizerUids when actor is owner and target is a plain member", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    vi.mocked(updateGroupRoles).mockResolvedValue();

    await promoteToOrganizer({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).toHaveBeenCalledWith("g1", {
      organizerUids: ["u-owner", "u-target"],
    });
  });

  it("throws group/not-owner when actor is not an owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner", "u-actor"],
        memberUids: ["u-owner", "u-actor", "u-target"],
      }),
    );
    await expect(
      promoteToOrganizer({ gid: "g1", actorUid: "u-actor", targetUid: "u-target" }),
    ).rejects.toMatchObject({ code: "group/not-owner" });
    expect(updateGroupRoles).not.toHaveBeenCalled();
  });

  it("throws group/not-member when target is not in memberUids", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUids: ["u-owner"] }));
    await expect(
      promoteToOrganizer({ gid: "g1", actorUid: "u-owner", targetUid: "u-stranger" }),
    ).rejects.toMatchObject({ code: "group/not-member" });
  });

  it("is idempotent when target is already an organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );

    await promoteToOrganizer({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).not.toHaveBeenCalled();
  });
});

describe("demoteToMember", () => {
  it("removes target from organizerUids", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    vi.mocked(updateGroupRoles).mockResolvedValue();

    await demoteToMember({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).toHaveBeenCalledWith("g1", { organizerUids: ["u-owner"] });
  });

  it("throws group/target-is-owner when target is also an owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner", "u-target"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    await expect(
      demoteToMember({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" }),
    ).rejects.toMatchObject({ code: "group/target-is-owner" });
    expect(updateGroupRoles).not.toHaveBeenCalled();
  });

  it("is idempotent when target is already a plain member", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner"],
        memberUids: ["u-owner", "u-target"],
      }),
    );

    await demoteToMember({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).not.toHaveBeenCalled();
  });
});

describe("promoteToOwner", () => {
  it("adds target to ownerUids when target is already an organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    vi.mocked(updateGroupRoles).mockResolvedValue();

    await promoteToOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).toHaveBeenCalledWith("g1", {
      ownerUids: ["u-owner", "u-target"],
    });
  });

  it("throws group/target-not-organizer when target is not organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    await expect(
      promoteToOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" }),
    ).rejects.toMatchObject({ code: "group/target-not-organizer" });
    expect(updateGroupRoles).not.toHaveBeenCalled();
  });

  it("is idempotent when target is already an owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner", "u-target"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );

    await promoteToOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).not.toHaveBeenCalled();
  });
});

describe("demoteOwner", () => {
  it("removes one of multiple owners", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner", "u-target"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );
    vi.mocked(updateGroupRoles).mockResolvedValue();

    await demoteOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).toHaveBeenCalledWith("g1", { ownerUids: ["u-owner"] });
  });

  it("throws group/last-owner when demoting the only owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner"],
        memberUids: ["u-owner"],
      }),
    );
    await expect(
      demoteOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-owner" }),
    ).rejects.toMatchObject({ code: "group/last-owner" });
    expect(updateGroupRoles).not.toHaveBeenCalled();
  });

  it("is idempotent when target is not an owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["u-owner"],
        organizerUids: ["u-owner", "u-target"],
        memberUids: ["u-owner", "u-target"],
      }),
    );

    await demoteOwner({ gid: "g1", actorUid: "u-owner", targetUid: "u-target" });

    expect(updateGroupRoles).not.toHaveBeenCalled();
  });
});

describe("propagateDisplayNameToGroups", () => {
  it("no-ops for blank displayName", async () => {
    await propagateDisplayNameToGroups("u1", ["g1", "g2"], "   ");
    expect(setMemberDisplayName).not.toHaveBeenCalled();
  });

  it("no-ops for empty groupIds", async () => {
    await propagateDisplayNameToGroups("u1", [], "Alice");
    expect(setMemberDisplayName).not.toHaveBeenCalled();
  });

  it("trims displayName and writes to each group", async () => {
    vi.mocked(setMemberDisplayName).mockResolvedValue();
    await propagateDisplayNameToGroups("u1", ["g1", "g2"], "  Alice  ");
    expect(setMemberDisplayName).toHaveBeenCalledTimes(2);
    expect(setMemberDisplayName).toHaveBeenNthCalledWith(1, "g1", "u1", "Alice");
    expect(setMemberDisplayName).toHaveBeenNthCalledWith(2, "g2", "u1", "Alice");
  });

  it("continues on per-group failure and does not throw (best-effort)", async () => {
    vi.mocked(setMemberDisplayName).mockImplementation(async (gid: string) => {
      if (gid === "g1") throw new AppError("denied", "firestore/permission-denied");
    });
    await expect(
      propagateDisplayNameToGroups("u1", ["g1", "g2"], "Alice"),
    ).resolves.toBeUndefined();
    expect(setMemberDisplayName).toHaveBeenCalledTimes(2);
  });

  it("handles non-AppError rejection reasons (falls back to unknown code)", async () => {
    vi.mocked(setMemberDisplayName).mockImplementation(async (gid: string) => {
      if (gid === "g1") throw "string thrown"; // non-object
    });
    await expect(
      propagateDisplayNameToGroups("u1", ["g1", "g2"], "Alice"),
    ).resolves.toBeUndefined();
    expect(setMemberDisplayName).toHaveBeenCalledTimes(2);
  });
});
