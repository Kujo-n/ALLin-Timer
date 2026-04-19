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
  const actual =
    await vi.importActual<typeof import("firebase/firestore")>(
      "firebase/firestore",
    );
  return {
    ...actual,
    runTransaction: vi.fn(),
    arrayUnion: vi.fn((...args: unknown[]) => ({ __op: "arrayUnion", args })),
    increment: vi.fn((n: number) => ({ __op: "increment", n })),
  };
});

vi.mock("@/lib/firebase/repositories/groups", () => ({
  groupsRef: {},
  groupDocRef: vi.fn((gid: string) => ({ __ref: "groups", gid })),
  createGroup: vi.fn(),
  getGroup: vi.fn(),
  listMyGroups: vi.fn(),
  updateGroupName: vi.fn(),
  addMemberSelf: vi.fn(),
  removeMemberSelf: vi.fn(),
  deleteGroup: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/groupJoinCodes", () => ({
  groupJoinCodesRef: {},
  joinCodeDocRef: vi.fn((code: string) => ({ __ref: "joinCode", code })),
  createJoinCode: vi.fn(),
  getJoinCode: vi.fn(),
  incrementUsesCount: vi.fn(),
  deleteJoinCode: vi.fn(),
  generateCodeString: vi.fn(),
  isJoinCodeUsable: (
    codeDoc: GroupJoinCodeDoc,
    now: Date = new Date(),
  ): boolean => {
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
  addMemberSelf,
  createGroup,
  deleteGroup,
  getGroup,
  removeMemberSelf,
  updateGroupName,
} from "@/lib/firebase/repositories/groups";
import {
  createJoinCode,
  getJoinCode,
} from "@/lib/firebase/repositories/groupJoinCodes";
import {
  addGroupIdToUser,
  getUserProfile,
  removeGroupIdFromUser,
} from "@/lib/firebase/repositories/users";

import {
  consumeJoinCode,
  createGroupWithOwner,
  deleteGroupByOwner,
  generateJoinCode,
  leaveGroup,
  renameGroup,
} from "./group";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const future = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));
const past = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g1",
    name: "Saturday",
    ownerUid: "u-owner",
    memberUids: ["u-owner"],
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
  vi.mocked(addMemberSelf).mockReset();
  vi.mocked(removeMemberSelf).mockReset();
  vi.mocked(deleteGroup).mockReset();
  vi.mocked(updateGroupName).mockReset();
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
    expect(createGroup).toHaveBeenCalledWith({ name: "Saturday", ownerUid: "u1" });
    expect(addGroupIdToUser).toHaveBeenCalledWith("u1", "g-new");
  });
});

describe("consumeJoinCode", () => {
  it("rejects with group/invalid-code when code does not exist", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(null);
    await expect(
      consumeJoinCode({ code: "missing", uid: "u-new" }),
    ).rejects.toMatchObject({ code: "group/invalid-code" });
  });

  it("rejects expired codes", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(makeCode({ expiresAt: past }));
    await expect(
      consumeJoinCode({ code: "code123", uid: "u-new" }),
    ).rejects.toMatchObject({ code: "group/invalid-code" });
  });

  it("rejects codes that hit maxUses", async () => {
    vi.mocked(getJoinCode).mockResolvedValue(
      makeCode({ maxUses: 1, usesCount: 1 }),
    );
    await expect(
      consumeJoinCode({ code: "code123", uid: "u-new" }),
    ).rejects.toMatchObject({ code: "group/invalid-code" });
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
    // user has no groups yet → not already a member
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u-new",
      displayName: "Bob",
      email: null,
      groupIds: [],
      createdAt: now,
    });
    vi.mocked(runTransaction).mockImplementation(async (_db, fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => true,
          id: "code123",
          data: () => makeCode(),
        }),
        update: vi.fn(),
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
  });
});

describe("leaveGroup", () => {
  it("rejects when uid is the owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUid: "u1", memberUids: ["u1"] }));
    await expect(
      leaveGroup({ gid: "g1", uid: "u1" }),
    ).rejects.toMatchObject({ code: "group/owner-cannot-leave" });
    expect(removeMemberSelf).not.toHaveBeenCalled();
  });

  it("removes member and updates user groupIds for non-owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ ownerUid: "u-owner", memberUids: ["u-owner", "u-new"] }),
    );
    vi.mocked(removeMemberSelf).mockResolvedValue();
    vi.mocked(removeGroupIdFromUser).mockResolvedValue();

    await leaveGroup({ gid: "g1", uid: "u-new" });

    expect(removeMemberSelf).toHaveBeenCalledWith("g1", "u-new");
    expect(removeGroupIdFromUser).toHaveBeenCalledWith("u-new", "g1");
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
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUid: "u-owner" }));
    await expect(
      deleteGroupByOwner({ gid: "g1", uid: "u-other" }),
    ).rejects.toMatchObject({ code: "group/not-owner" });
    expect(deleteGroup).not.toHaveBeenCalled();
  });

  it("deletes group and removes own groupIds", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUid: "u-owner" }));
    vi.mocked(deleteGroup).mockResolvedValue();
    vi.mocked(removeGroupIdFromUser).mockResolvedValue();

    await deleteGroupByOwner({ gid: "g1", uid: "u-owner" });

    expect(deleteGroup).toHaveBeenCalledWith("g1");
    expect(removeGroupIdFromUser).toHaveBeenCalledWith("u-owner", "g1");
  });
});

describe("renameGroup", () => {
  it("rejects when name is blank", async () => {
    await expect(
      renameGroup({ gid: "g1", uid: "u-owner", name: "   " }),
    ).rejects.toMatchObject({ code: "validation/invalid-input" });
    expect(updateGroupName).not.toHaveBeenCalled();
  });

  it("rejects non-owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUid: "u-owner" }));
    await expect(
      renameGroup({ gid: "g1", uid: "u-other", name: "New" }),
    ).rejects.toMatchObject({ code: "group/not-owner" });
    expect(updateGroupName).not.toHaveBeenCalled();
  });

  it("trims name and calls updateGroupName when owner", async () => {
    vi.mocked(getGroup).mockResolvedValue(makeGroup({ ownerUid: "u-owner" }));
    vi.mocked(updateGroupName).mockResolvedValue();

    await renameGroup({ gid: "g1", uid: "u-owner", name: "  New name  " });

    expect(updateGroupName).toHaveBeenCalledWith("g1", "New name");
  });
});
