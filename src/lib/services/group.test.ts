import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import { MAX_TABLES, TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
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
    getDocs: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
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
  updateFinishedTournamentCount: vi.fn(),
  updateDefaultSeatsPerTable: vi.fn(),
  updateDefaultTableSettings: vi.fn(),
  updateLatestJoinCodeId: vi.fn(),
  updateSeasonPointsRule: vi.fn(),
  updateWinnerCardBackground: vi.fn(),
  updateSeasonCardBackground: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/groupJoinCodes", () => ({
  joinCodeDocRef: vi.fn((code: string) => ({ __ref: "joinCode", code })),
  createJoinCode: vi.fn(),
  deleteJoinCode: vi.fn(),
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

vi.mock("@/lib/firebase/repositories/seasonStats", () => ({
  seasonStatsRef: vi.fn((gid: string) => ({ __ref: "seasonStats", gid })),
  seasonStatsDocRef: vi.fn((gid: string, uid: string) => ({
    __ref: "seasonStatsDoc",
    gid,
    uid,
  })),
}));

vi.mock("@/lib/firebase/repositories/seasonHistory", () => ({
  seasonHistoryRef: vi.fn((gid: string) => ({ __ref: "seasonHistory", gid })),
  seasonHistoryDocRef: vi.fn((gid: string, seasonId: string) => ({
    __ref: "seasonHistoryDoc",
    gid,
    seasonId,
  })),
}));

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  listTournamentsByGroup: vi.fn().mockResolvedValue([]),
}));

import { getDocs, runTransaction } from "firebase/firestore";

import {
  createGroup,
  deleteGroup,
  getGroup,
  removeMemberSelf,
  setMemberDisplayName,
  updateDefaultSeatsPerTable,
  updateDefaultTableSettings,
  updateFinishedTournamentCount,
  updateGroupName,
  updateGroupRoles,
  updateLatestJoinCodeId,
  updateSeasonCardBackground,
  updateSeasonPointsRule,
  updateWinnerCardBackground,
} from "@/lib/firebase/repositories/groups";
import {
  createJoinCode,
  deleteJoinCode,
  getJoinCode,
} from "@/lib/firebase/repositories/groupJoinCodes";
import { listTournamentsByGroup } from "@/lib/firebase/repositories/tournaments";
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
  setDefaultSeatsPerTable,
  setDefaultTableSettings,
  setFinishedTournamentCount,
  setSeasonCardBackground,
  setSeasonPointsRule,
  setWinnerCardBackground,
  startNewSeason,
} from "./group";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const future = Timestamp.fromDate(new Date("2030-05-01T00:00:00Z"));
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
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
    winnerCardBackground: null,
    seasonCardBackground: null,
    latestJoinCodeId: null,
    joinedViaTournamentId: null,
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
  vi.mocked(updateFinishedTournamentCount).mockReset();
  vi.mocked(updateDefaultSeatsPerTable).mockReset();
  vi.mocked(updateDefaultTableSettings).mockReset();
  vi.mocked(updateSeasonPointsRule).mockReset();
  vi.mocked(updateWinnerCardBackground).mockReset();
  vi.mocked(updateSeasonCardBackground).mockReset();
  vi.mocked(getJoinCode).mockReset();
  vi.mocked(createJoinCode).mockReset();
  vi.mocked(deleteJoinCode).mockReset();
  vi.mocked(updateLatestJoinCodeId).mockReset();
  vi.mocked(addGroupIdToUser).mockReset();
  vi.mocked(removeGroupIdFromUser).mockReset();
  vi.mocked(runTransaction).mockReset();
  vi.mocked(getDocs).mockReset();
  vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
  vi.mocked(listTournamentsByGroup).mockReset().mockResolvedValue([]);
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
  it("calls createJoinCode with default 7-day expiry and null maxUses (prev null)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ organizerUids: ["u-owner"], latestJoinCodeId: null }),
    );
    vi.mocked(createJoinCode).mockResolvedValue("abc123");
    vi.mocked(updateLatestJoinCodeId).mockResolvedValue(undefined);

    const code = await generateJoinCode({ gid: "g1", createdByUid: "u-owner" });

    expect(code).toBe("abc123");
    expect(createJoinCode).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(createJoinCode).mock.calls[0][0];
    expect(arg.gid).toBe("g1");
    expect(arg.createdByUid).toBe("u-owner");
    expect(arg.maxUses).toBeNull();
    expect(arg.expiresAt).toBeInstanceOf(Timestamp);
    expect(updateLatestJoinCodeId).toHaveBeenCalledWith("g1", "abc123");
    // prev is null → deleteJoinCode は呼ばれない
    expect(deleteJoinCode).not.toHaveBeenCalled();
  });

  it("rejects non-positive expiresInDays", async () => {
    await expect(
      generateJoinCode({ gid: "g1", createdByUid: "u1", expiresInDays: 0 }),
    ).rejects.toBeInstanceOf(AppError);
  });

  it("rejects when caller is not organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        organizerUids: ["u-owner"],
        memberUids: ["u-owner", "u-mem"],
      }),
    );
    await expect(generateJoinCode({ gid: "g1", createdByUid: "u-mem" })).rejects.toMatchObject({
      code: "group/not-organizer",
    });
    expect(createJoinCode).not.toHaveBeenCalled();
    expect(updateLatestJoinCodeId).not.toHaveBeenCalled();
    expect(deleteJoinCode).not.toHaveBeenCalled();
  });

  it("deletes previous join code on re-issue", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ organizerUids: ["u-owner"], latestJoinCodeId: "old123" }),
    );
    vi.mocked(createJoinCode).mockResolvedValue("new456");
    vi.mocked(updateLatestJoinCodeId).mockResolvedValue(undefined);
    vi.mocked(deleteJoinCode).mockResolvedValue(undefined);

    const code = await generateJoinCode({ gid: "g1", createdByUid: "u-owner" });

    expect(code).toBe("new456");
    expect(updateLatestJoinCodeId).toHaveBeenCalledWith("g1", "new456");
    expect(deleteJoinCode).toHaveBeenCalledWith("old123");
  });

  it("does not delete when prev === new (collision retry edge)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ organizerUids: ["u-owner"], latestJoinCodeId: "same" }),
    );
    vi.mocked(createJoinCode).mockResolvedValue("same");
    vi.mocked(updateLatestJoinCodeId).mockResolvedValue(undefined);

    const code = await generateJoinCode({ gid: "g1", createdByUid: "u-owner" });

    expect(code).toBe("same");
    expect(deleteJoinCode).not.toHaveBeenCalled();
  });

  it("succeeds even when deleteJoinCode rejects (best-effort)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ organizerUids: ["u-owner"], latestJoinCodeId: "old" }),
    );
    vi.mocked(createJoinCode).mockResolvedValue("new");
    vi.mocked(updateLatestJoinCodeId).mockResolvedValue(undefined);
    vi.mocked(deleteJoinCode).mockRejectedValue(
      new AppError("perm-denied", "firestore/permission-denied"),
    );

    const code = await generateJoinCode({ gid: "g1", createdByUid: "u-owner" });

    expect(code).toBe("new");
    expect(deleteJoinCode).toHaveBeenCalledWith("old");
    // updateLatestJoinCodeId は成功扱いとして pointer は new に進む（旧 doc が残るが
    //   cleanup-orphan-firestore で最終整理される設計）
    expect(updateLatestJoinCodeId).toHaveBeenCalledWith("g1", "new");
  });

  it("propagates failure when updateLatestJoinCodeId rejects", async () => {
    // pointer の整合性を最優先するため、updateLatestJoinCodeId 失敗時は throw する。
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({ organizerUids: ["u-owner"], latestJoinCodeId: null }),
    );
    vi.mocked(createJoinCode).mockResolvedValue("new");
    vi.mocked(updateLatestJoinCodeId).mockRejectedValue(
      new AppError("write fail", "firestore/write_failed"),
    );

    await expect(generateJoinCode({ gid: "g1", createdByUid: "u-owner" })).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
    // 既に new code は作成済みなので revert はしない（cleanup-orphan-firestore に委譲）
    expect(createJoinCode).toHaveBeenCalled();
    expect(deleteJoinCode).not.toHaveBeenCalled();
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

describe("setFinishedTournamentCount", () => {
  it("allows owner to set value", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(updateFinishedTournamentCount).mockResolvedValue();

    await setFinishedTournamentCount({ gid: "g1", uid: "uOwner", value: 8 });

    expect(updateFinishedTournamentCount).toHaveBeenCalledWith("g1", 8);
  });

  it("allows organizer to set value", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      }),
    );
    vi.mocked(updateFinishedTournamentCount).mockResolvedValue();

    await setFinishedTournamentCount({ gid: "g1", uid: "uOrg", value: 3 });

    expect(updateFinishedTournamentCount).toHaveBeenCalledWith("g1", 3);
  });

  it("rejects general member with group/not-organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      }),
    );
    await expect(
      setFinishedTournamentCount({ gid: "g1", uid: "uMember", value: 5 }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(updateFinishedTournamentCount).not.toHaveBeenCalled();
  });

  it("rejects negative value with validation code (without reading group)", async () => {
    await expect(
      setFinishedTournamentCount({ gid: "g1", uid: "uOwner", value: -1 }),
    ).rejects.toMatchObject({ code: "validation/finished-count-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateFinishedTournamentCount).not.toHaveBeenCalled();
  });

  it("rejects non-integer with validation code (without reading group)", async () => {
    await expect(
      setFinishedTournamentCount({ gid: "g1", uid: "uOwner", value: 1.5 }),
    ).rejects.toMatchObject({ code: "validation/finished-count-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateFinishedTournamentCount).not.toHaveBeenCalled();
  });
});

describe("setDefaultSeatsPerTable", () => {
  it("allows owner to set value", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(updateDefaultSeatsPerTable).mockResolvedValue();

    await setDefaultSeatsPerTable({ gid: "g1", uid: "uOwner", value: 6 });

    expect(updateDefaultSeatsPerTable).toHaveBeenCalledWith("g1", 6);
  });

  it("allows organizer (non-owner) to set value", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      }),
    );
    vi.mocked(updateDefaultSeatsPerTable).mockResolvedValue();

    await setDefaultSeatsPerTable({ gid: "g1", uid: "uOrg", value: 8 });

    expect(updateDefaultSeatsPerTable).toHaveBeenCalledWith("g1", 8);
  });

  it("rejects general member with group/not-organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      }),
    );
    await expect(
      setDefaultSeatsPerTable({ gid: "g1", uid: "uMember", value: 6 }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(updateDefaultSeatsPerTable).not.toHaveBeenCalled();
  });

  it.each([1, 11, 5.5, -1, 0])(
    "rejects out-of-range value %p before fetching group",
    async (bad) => {
      await expect(
        setDefaultSeatsPerTable({ gid: "g1", uid: "uOwner", value: bad as number }),
      ).rejects.toMatchObject({
        code: "validation/default-seats-invalid",
      });
      expect(getGroup).not.toHaveBeenCalled();
      expect(updateDefaultSeatsPerTable).not.toHaveBeenCalled();
    },
  );
});

/**
 * Phase C / 02-02: Table 名 / 色デフォルトの一括更新。
 *
 * この service が **唯一の防御ライン**である点が重要。rule 側は
 * `affectedKeys.hasOnly(['defaultTableLabels','defaultTableColors'])` + `is list` +
 * `size() <= 6` までしか強制できず、**各要素の文字数と hex 形式は Cloud Firestore
 * Rules の言語仕様で表現できない**。したがって以下を仕様として固定する:
 *
 *   1. labels は trim 正規化して repository へ渡す（前後空白の混入を保存しない）
 *   2. colors は labels と同数必須。空文字 / undefined は null に正規化
 *   3. 文字数（1〜10）・hex 形式（`#RRGGBB`）・件数（≤6）の逸脱は throw
 *   4. **検証は getGroup より前**（無駄な read を消費しないフェイルファスト）
 *   5. 権限は organizer 以上
 */
describe("setDefaultTableSettings (Phase C / 02-02)", () => {
  function organizerGroup() {
    return makeGroup({
      ownerUids: ["uOwner"],
      organizerUids: ["uOwner", "uOrg"],
      memberUids: ["uOwner", "uOrg", "uMember"],
    });
  }

  it("trims labels and forwards labels / colors as one atomic patch", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    await setDefaultTableSettings({
      gid: "g1",
      uid: "uOwner",
      labels: ["  Main ", "Feature"],
      colors: ["#ff0000", null],
    });

    expect(updateDefaultTableSettings).toHaveBeenCalledTimes(1);
    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", {
      labels: ["Main", "Feature"],
      colors: ["#ff0000", null],
    });
  });

  it("allows organizer (non-owner)", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    await setDefaultTableSettings({
      gid: "g1",
      uid: "uOrg",
      labels: ["A"],
      colors: [null],
    });

    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", {
      labels: ["A"],
      colors: [null],
    });
  });

  it("accepts empty arrays (clearing all defaults)", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    await setDefaultTableSettings({ gid: "g1", uid: "uOwner", labels: [], colors: [] });

    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", { labels: [], colors: [] });
  });

  it("accepts exactly MAX_TABLES entries (boundary)", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    const labels = Array.from({ length: MAX_TABLES }, (_, i) => `T${i + 1}`);
    await setDefaultTableSettings({
      gid: "g1",
      uid: "uOwner",
      labels,
      colors: labels.map(() => null),
    });

    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", {
      labels,
      colors: labels.map(() => null),
    });
  });

  it("accepts a label of exactly TABLE_LABEL_MAX_LENGTH chars (boundary)", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    const label = "x".repeat(TABLE_LABEL_MAX_LENGTH);
    await setDefaultTableSettings({ gid: "g1", uid: "uOwner", labels: [label], colors: [null] });

    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", {
      labels: [label],
      colors: [null],
    });
  });

  it("normalizes blank / undefined colors to null", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    await setDefaultTableSettings({
      gid: "g1",
      uid: "uOwner",
      labels: ["A", "B", "C"],
      // 空文字は UI の「色なし」入力、undefined は疎な配列由来。どちらも null 保存に倒す。
      colors: ["   ", undefined as unknown as string | null, "#ABCDEF"],
    });

    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", {
      labels: ["A", "B", "C"],
      colors: [null, null, "#ABCDEF"],
    });
  });

  it("accepts uppercase and lowercase hex alike", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());
    vi.mocked(updateDefaultTableSettings).mockResolvedValue();

    await setDefaultTableSettings({
      gid: "g1",
      uid: "uOwner",
      labels: ["A", "B"],
      colors: ["#AbCdEf", " #123456 "],
    });

    expect(updateDefaultTableSettings).toHaveBeenCalledWith("g1", {
      labels: ["A", "B"],
      // hex も trim してから保存する。
      colors: ["#AbCdEf", "#123456"],
    });
  });

  it("rejects more than MAX_TABLES labels before reading group", async () => {
    const labels = Array.from({ length: MAX_TABLES + 1 }, (_, i) => `T${i + 1}`);

    await expect(
      setDefaultTableSettings({
        gid: "g1",
        uid: "uOwner",
        labels,
        colors: labels.map(() => null),
      }),
    ).rejects.toMatchObject({ code: "validation/default-table-labels-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateDefaultTableSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-array labels argument", async () => {
    await expect(
      setDefaultTableSettings({
        gid: "g1",
        uid: "uOwner",
        labels: "Main" as unknown as string[],
        colors: [],
      }),
    ).rejects.toMatchObject({ code: "validation/default-table-labels-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it.each([
    ["blank after trim", "   "],
    ["over TABLE_LABEL_MAX_LENGTH", "x".repeat(TABLE_LABEL_MAX_LENGTH + 1)],
  ])("rejects a label that is %s", async (_desc, bad) => {
    await expect(
      setDefaultTableSettings({ gid: "g1", uid: "uOwner", labels: [bad], colors: [null] }),
    ).rejects.toMatchObject({ code: "validation/default-table-labels-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateDefaultTableSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-string label element", async () => {
    await expect(
      setDefaultTableSettings({
        gid: "g1",
        uid: "uOwner",
        labels: [42 as unknown as string],
        colors: [null],
      }),
    ).rejects.toMatchObject({ code: "validation/default-table-labels-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it("rejects a colors array whose length differs from labels", async () => {
    await expect(
      setDefaultTableSettings({ gid: "g1", uid: "uOwner", labels: ["A", "B"], colors: [null] }),
    ).rejects.toMatchObject({ code: "validation/default-table-colors-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateDefaultTableSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-array colors argument", async () => {
    await expect(
      setDefaultTableSettings({
        gid: "g1",
        uid: "uOwner",
        labels: [],
        colors: null as unknown as (string | null)[],
      }),
    ).rejects.toMatchObject({ code: "validation/default-table-colors-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it.each([
    ["3-digit shorthand", "#abc"],
    ["missing hash", "ff0000"],
    ["non-hex chars", "#gggggg"],
    ["too long", "#1234567"],
  ])("rejects a color that is %s", async (_desc, bad) => {
    await expect(
      setDefaultTableSettings({ gid: "g1", uid: "uOwner", labels: ["A"], colors: [bad] }),
    ).rejects.toMatchObject({ code: "validation/default-table-colors-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateDefaultTableSettings).not.toHaveBeenCalled();
  });

  it("rejects a non-string color element", async () => {
    await expect(
      setDefaultTableSettings({
        gid: "g1",
        uid: "uOwner",
        labels: ["A"],
        colors: [123 as unknown as string],
      }),
    ).rejects.toMatchObject({ code: "validation/default-table-colors-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it("rejects a general member with group/not-organizer after validation passes", async () => {
    vi.mocked(getGroup).mockResolvedValue(organizerGroup());

    await expect(
      setDefaultTableSettings({
        gid: "g1",
        uid: "uMember",
        labels: ["A"],
        colors: [null],
      }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(updateDefaultTableSettings).not.toHaveBeenCalled();
  });
});

describe("setSeasonPointsRule (Phase E)", () => {
  it("allows owner to set a valid custom rule", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(updateSeasonPointsRule).mockResolvedValue();

    await setSeasonPointsRule({
      gid: "g1",
      uid: "uOwner",
      value: { base: [10, 7, 5], baseline: 8 },
    });

    expect(updateSeasonPointsRule).toHaveBeenCalledWith("g1", {
      base: [10, 7, 5],
      baseline: 8,
    });
  });

  it("allows organizer (non-owner) to set value", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      }),
    );
    vi.mocked(updateSeasonPointsRule).mockResolvedValue();

    await setSeasonPointsRule({
      gid: "g1",
      uid: "uOrg",
      value: { base: [20], baseline: 6 },
    });

    expect(updateSeasonPointsRule).toHaveBeenCalledWith("g1", {
      base: [20],
      baseline: 6,
    });
  });

  it("forwards null (reset to default) to repository", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(updateSeasonPointsRule).mockResolvedValue();

    await setSeasonPointsRule({ gid: "g1", uid: "uOwner", value: null });

    expect(updateSeasonPointsRule).toHaveBeenCalledWith("g1", null);
  });

  it("rejects general member with group/not-organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      }),
    );
    await expect(
      setSeasonPointsRule({
        gid: "g1",
        uid: "uMember",
        value: { base: [10], baseline: 8 },
      }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(updateSeasonPointsRule).not.toHaveBeenCalled();
  });

  it("rejects empty base before reading group (early validation)", async () => {
    await expect(
      setSeasonPointsRule({
        gid: "g1",
        uid: "uOwner",
        value: { base: [], baseline: 8 },
      }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateSeasonPointsRule).not.toHaveBeenCalled();
  });

  it("rejects base over 9 elements", async () => {
    await expect(
      setSeasonPointsRule({
        gid: "g1",
        uid: "uOwner",
        value: { base: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], baseline: 8 },
      }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it("rejects negative base element", async () => {
    await expect(
      setSeasonPointsRule({
        gid: "g1",
        uid: "uOwner",
        value: { base: [10, -1, 5], baseline: 8 },
      }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it.each([1, 11, 8.5])("rejects out-of-range or non-int baseline %p", async (bad) => {
    await expect(
      setSeasonPointsRule({
        gid: "g1",
        uid: "uOwner",
        value: { base: [10], baseline: bad as number },
      }),
    ).rejects.toMatchObject({
      code: "validation/season-points-rule-invalid",
    });
    expect(getGroup).not.toHaveBeenCalled();
  });

  it("normalizes base values to 2 decimal places (defensive against UI float artifacts)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(updateSeasonPointsRule).mockResolvedValue();

    // 8.659999999... のような UI 由来の誤差を 8.66 に丸める
    await setSeasonPointsRule({
      gid: "g1",
      uid: "uOwner",
      value: { base: [8.659999999, 7.014], baseline: 8 },
    });

    const call = vi.mocked(updateSeasonPointsRule).mock.calls[0];
    expect(call[1]).toEqual({ base: [8.66, 7.01], baseline: 8 });
  });
});

/**
 * Phase A.1 (05-post-launch-polish Track A): 結果カード背景メタデータの設定・解除。
 *
 * winner / season は共通 internal helper (`setCardBackground`) の kind 違いでしかない
 * ため、**両者が対称であること**（同じ権限判定・同じ pass-through・互いの repository を
 * 呼ばないこと）を仕様として固定する。kind の取り違えはコンパイルで捕まらず、
 * 「優勝カードを設定したらシーズンカードが変わる」形で表面化するため。
 *
 * 値の invariant（imageUrl と storageAssetId は同時に null か同時に string）は
 * repository の `validateCardBackground` が持つ責務なので、ここでは service が値を
 * **加工せず素通しする**ことだけを確認する。
 */
describe("setWinnerCardBackground / setSeasonCardBackground (Phase A.1)", () => {
  const bg = {
    imageUrl: "https://example.test/bg.png",
    storageAssetId: "groups/g1/winner/asset-1",
    textTheme: "dark" as const,
  };

  function ownerGroup() {
    return makeGroup({
      ownerUids: ["uOwner"],
      organizerUids: ["uOwner", "uOrg"],
      memberUids: ["uOwner", "uOrg", "uMember"],
    });
  }

  it.each([
    ["winner", setWinnerCardBackground],
    ["season", setSeasonCardBackground],
  ] as const)("%s: forwards the value to its own repository unchanged", async (kind, setter) => {
    vi.mocked(getGroup).mockResolvedValue(ownerGroup());
    vi.mocked(updateWinnerCardBackground).mockResolvedValue();
    vi.mocked(updateSeasonCardBackground).mockResolvedValue();

    await setter({ gid: "g1", uid: "uOwner", value: bg });

    const [called, notCalled] =
      kind === "winner"
        ? [updateWinnerCardBackground, updateSeasonCardBackground]
        : [updateSeasonCardBackground, updateWinnerCardBackground];
    expect(called).toHaveBeenCalledTimes(1);
    expect(called).toHaveBeenCalledWith("g1", bg);
    // kind の取り違えで相手側を書き換えないこと。
    expect(notCalled).not.toHaveBeenCalled();
  });

  it.each([
    ["winner", setWinnerCardBackground],
    ["season", setSeasonCardBackground],
  ] as const)("%s: forwards null (clear) to its own repository", async (kind, setter) => {
    vi.mocked(getGroup).mockResolvedValue(ownerGroup());
    vi.mocked(updateWinnerCardBackground).mockResolvedValue();
    vi.mocked(updateSeasonCardBackground).mockResolvedValue();

    await setter({ gid: "g1", uid: "uOwner", value: null });

    const called = kind === "winner" ? updateWinnerCardBackground : updateSeasonCardBackground;
    expect(called).toHaveBeenCalledWith("g1", null);
  });

  it.each([
    ["winner", setWinnerCardBackground],
    ["season", setSeasonCardBackground],
  ] as const)("%s: rejects organizer (non-owner) with group/not-owner", async (_kind, setter) => {
    vi.mocked(getGroup).mockResolvedValue(ownerGroup());

    // カード背景は owner 限定。organizer は他の group 設定を触れても不可。
    await expect(setter({ gid: "g1", uid: "uOrg", value: bg })).rejects.toMatchObject({
      code: "group/not-owner",
    });
    expect(updateWinnerCardBackground).not.toHaveBeenCalled();
    expect(updateSeasonCardBackground).not.toHaveBeenCalled();
  });

  it.each([
    ["winner", setWinnerCardBackground],
    ["season", setSeasonCardBackground],
  ] as const)("%s: rejects a general member with group/not-owner", async (_kind, setter) => {
    vi.mocked(getGroup).mockResolvedValue(ownerGroup());

    await expect(setter({ gid: "g1", uid: "uMember", value: bg })).rejects.toMatchObject({
      code: "group/not-owner",
    });
    expect(updateWinnerCardBackground).not.toHaveBeenCalled();
    expect(updateSeasonCardBackground).not.toHaveBeenCalled();
  });

  it("propagates repository failures instead of swallowing them", async () => {
    vi.mocked(getGroup).mockResolvedValue(ownerGroup());
    vi.mocked(updateWinnerCardBackground).mockRejectedValue(
      new AppError("背景画像の更新に失敗しました", "firestore/write_failed"),
    );

    await expect(
      setWinnerCardBackground({ gid: "g1", uid: "uOwner", value: bg }),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("startNewSeason (Phase A)", () => {
  /** stats snapshot を tx 内で受け取る共通 helper。tx.delete / tx.set / tx.update の呼出を記録する。 */
  function captureTxOps(stats: Array<{ id: string; data: Record<string, unknown> }> = []) {
    const setCalls: Array<[unknown, Record<string, unknown>]> = [];
    const deleteCalls: unknown[] = [];
    const updateCalls: Array<[unknown, Record<string, unknown>]> = [];
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: stats.map((s) => ({
        id: s.id,
        data: () => s.data,
        ref: { __ref: "doc", id: s.id },
      })),
    } as never);
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const tx = {
        get: vi.fn(),
        set: vi.fn((ref, data) => setCalls.push([ref, data as Record<string, unknown>])),
        delete: vi.fn((ref) => deleteCalls.push(ref)),
        update: vi.fn((ref, patch) => updateCalls.push([ref, patch as Record<string, unknown>])),
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
    return { setCalls, deleteCalls, updateCalls };
  }

  it("snapshots current stats to seasonHistory + deletes old stats + updates seasonStartDate (owner)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    const ops = captureTxOps([
      {
        id: "u1",
        data: {
          uid: "u1",
          displayName: "A",
          participations: 5,
          wins: 1,
          finalTables: 2,
          totalPoints: 25.0,
        },
      },
      {
        id: "u2",
        data: {
          uid: "u2",
          displayName: "B",
          participations: 3,
          wins: 0,
          finalTables: 1,
          totalPoints: 15.0,
        },
      },
    ]);

    const result = await startNewSeason({ gid: "g1", uid: "uOwner" });

    expect(result.seasonId).toBeTruthy();
    expect(typeof result.seasonId).toBe("string");
    // history append: 1 件
    expect(ops.setCalls).toHaveLength(1);
    const [, historyData] = ops.setCalls[0];
    expect((historyData.entries as unknown[]).length).toBe(2);
    expect(historyData.endedAt).toEqual({ __op: "serverTimestamp" });
    // 旧 stats 全件 delete
    expect(ops.deleteCalls).toHaveLength(2);
    // group.seasonStartDate 更新: 1 件
    expect(ops.updateCalls).toHaveLength(1);
    const [, groupPatch] = ops.updateCalls[0];
    expect(groupPatch.seasonStartDate).toEqual({ __op: "serverTimestamp" });
  });

  it("succeeds with empty entries when no participants exist (initial season)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    const ops = captureTxOps([]);

    await startNewSeason({ gid: "g1", uid: "uOwner" });

    expect(ops.deleteCalls).toHaveLength(0);
    expect(ops.setCalls).toHaveLength(1); // history append（entries:[]）
    const [, historyData] = ops.setCalls[0];
    expect(historyData.entries).toEqual([]);
    expect(ops.updateCalls).toHaveLength(1);
  });

  it("allows organizer (non-owner) to start a new season", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      }),
    );
    const ops = captureTxOps([]);

    await startNewSeason({ gid: "g1", uid: "uOrg" });

    expect(ops.updateCalls).toHaveLength(1);
  });

  it("rejects general member with group/not-organizer", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      }),
    );
    await expect(startNewSeason({ gid: "g1", uid: "uMember" })).rejects.toMatchObject({
      code: "group/not-organizer",
    });
    // tx は呼ばれない
    expect(runTransaction).not.toHaveBeenCalled();
    expect(getDocs).not.toHaveBeenCalled();
  });

  it("preserves prior seasonStartDate as startedAt in the history doc", async () => {
    const prior = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
        seasonStartDate: prior,
      }),
    );
    const ops = captureTxOps([]);

    await startNewSeason({ gid: "g1", uid: "uOwner" });

    expect(ops.setCalls).toHaveLength(1);
    const [, historyData] = ops.setCalls[0];
    expect(historyData.startedAt).toEqual(prior);
  });

  /**
   * H-1: 旧 stats の displayName が 15 字超過のときも history snapshot で 15 字に切り詰める
   * （seasonHistoryEntry rule / schema deny を防ぎ tx 全体失敗を防ぐ最終ライン防御）。
   */
  it("truncates displayName to 15 chars when copying to history entries (Phase A H-1 defense)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    const long = "1234567890ABCDEFGHIJ"; // 20 文字
    const ops = captureTxOps([
      {
        id: "u1",
        data: {
          uid: "u1",
          displayName: long,
          participations: 3,
          wins: 1,
          finalTables: 1,
          totalPoints: 12.0,
        },
      },
    ]);

    await startNewSeason({ gid: "g1", uid: "uOwner" });

    expect(ops.setCalls).toHaveLength(1);
    const [, historyData] = ops.setCalls[0];
    const entries = historyData.entries as Array<{ displayName: string }>;
    expect(entries).toHaveLength(1);
    expect(entries[0].displayName.length).toBe(15);
    expect(entries[0].displayName).toBe(long.slice(0, 15));
  });

  /**
   * M-2: 進行中 tournament が当該 group にあれば pre-check で early throw、tx は起動しない。
   */
  it("rejects with season/in-progress-tournament when running tournament exists", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(listTournamentsByGroup).mockResolvedValueOnce([
      // running tournament を 1 件返す。最低限のフィールドのみ（isInProgress は state のみ参照）
      {
        id: "t-running",
        groupId: "g1",
        name: "Saturday Night",
        state: "running",
        // isInProgress / isSeating は state しか見ないため他フィールドは未指定で OK
      } as never,
    ]);

    await expect(startNewSeason({ gid: "g1", uid: "uOwner" })).rejects.toMatchObject({
      code: "season/in-progress-tournament",
    });

    expect(runTransaction).not.toHaveBeenCalled();
    expect(getDocs).not.toHaveBeenCalled();
  });

  it("rejects when seating-state tournament exists (Phase 4 配席中も block する)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(listTournamentsByGroup).mockResolvedValueOnce([
      { id: "t-seat", groupId: "g1", name: "Seating", state: "seating" } as never,
    ]);

    await expect(startNewSeason({ gid: "g1", uid: "uOwner" })).rejects.toMatchObject({
      code: "season/in-progress-tournament",
    });
  });

  it("allows when only setup / finished tournaments exist (no race risk)", async () => {
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(listTournamentsByGroup).mockResolvedValueOnce([
      { id: "t-setup", groupId: "g1", name: "S", state: "setup" } as never,
      { id: "t-fin", groupId: "g1", name: "F", state: "finished" } as never,
    ]);
    const ops = captureTxOps([]);

    await startNewSeason({ gid: "g1", uid: "uOwner" });

    expect(ops.updateCalls).toHaveLength(1);
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
