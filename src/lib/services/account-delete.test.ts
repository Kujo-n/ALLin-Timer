import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { GroupDoc } from "@/lib/firebase/schemas/group";

vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: { currentUser: null },
  firestore: {},
}));

vi.mock("@/lib/firebase/repositories/users", () => ({
  getUserProfile: vi.fn(),
  deleteUserProfile: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/groups", () => ({
  listMyGroups: vi.fn(),
}));

vi.mock("@/lib/services/group", () => ({
  leaveGroup: vi.fn(),
}));

import { listMyGroups } from "@/lib/firebase/repositories/groups";
import {
  deleteUserProfile,
  getUserProfile,
} from "@/lib/firebase/repositories/users";
import { leaveGroup } from "@/lib/services/group";

import {
  AccountDeleteSoleOwnerBlocked,
  deleteAccount,
} from "./account-delete";

const now = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    isAnonymous: false,
    providerData: [{ providerId: "password" }],
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g1",
    name: "Saturday Circle",
    ownerUids: ["u1"],
    organizerUids: ["u1"],
    memberUids: ["u1"],
    memberDisplayNames: { u1: "Alice" },
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
    createdAt: now,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
  vi.mocked(deleteUserProfile).mockReset().mockResolvedValue(undefined);
  vi.mocked(listMyGroups)
    .mockReset()
    .mockResolvedValue({ groups: [], failedGids: [] });
  vi.mocked(leaveGroup).mockReset().mockResolvedValue(undefined);
});

describe("deleteAccount", () => {
  it("rejects anonymous user with auth/account-delete-anon-not-supported", async () => {
    const user = makeUser({ isAnonymous: true });

    await expect(deleteAccount({ user: user as never })).rejects.toMatchObject({
      code: "auth/account-delete-anon-not-supported",
    });
    expect(user.delete).not.toHaveBeenCalled();
  });

  it("throws AccountDeleteSoleOwnerBlocked when uid is the sole owner of one group", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      groupIds: ["g1"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [makeGroup()],
      failedGids: [],
    });
    const user = makeUser();

    const promise = deleteAccount({ user: user as never });

    await expect(promise).rejects.toBeInstanceOf(AccountDeleteSoleOwnerBlocked);
    await expect(promise).rejects.toMatchObject({
      code: "auth/account-delete-blocked-sole-owner",
    });
    try {
      await promise;
    } catch (e) {
      expect(e).toBeInstanceOf(AccountDeleteSoleOwnerBlocked);
      const blocked = e as AccountDeleteSoleOwnerBlocked;
      expect(blocked.soleOwnerGroups).toEqual([{ id: "g1", name: "Saturday Circle" }]);
    }
    expect(leaveGroup).not.toHaveBeenCalled();
    expect(deleteUserProfile).not.toHaveBeenCalled();
    expect(user.delete).not.toHaveBeenCalled();
  });

  it("collects multiple sole-owner groups in the blocked error", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "a@b.com",
      groupIds: ["g1", "g2", "g3"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [
        makeGroup({ id: "g1", name: "Saturday" }),
        makeGroup({
          id: "g2",
          name: "Co-owned",
          ownerUids: ["u1", "u2"],
          organizerUids: ["u1", "u2"],
          memberUids: ["u1", "u2"],
        }),
        makeGroup({ id: "g3", name: "Thursday" }),
      ],
      failedGids: [],
    });
    const user = makeUser();

    try {
      await deleteAccount({ user: user as never });
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(AccountDeleteSoleOwnerBlocked);
      const blocked = e as AccountDeleteSoleOwnerBlocked;
      expect(blocked.soleOwnerGroups.map((g) => g.id)).toEqual(["g1", "g3"]);
    }
  });

  it("proceeds to user.delete when user has 0 groups", async () => {
    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(listMyGroups).mockResolvedValue({ groups: [], failedGids: [] });
    const user = makeUser();

    const result = await deleteAccount({ user: user as never });

    expect(result).toEqual({
      deleted: true,
      leftGroupIds: [],
      failedGroupIds: [],
      needsReauth: false,
      cancelled: false,
    });
    expect(leaveGroup).not.toHaveBeenCalled();
    expect(deleteUserProfile).toHaveBeenCalledWith("u1");
    expect(user.delete).toHaveBeenCalled();
  });

  it("leaves co-owner group then proceeds to delete user", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "a@b.com",
      groupIds: ["g1"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [
        makeGroup({
          id: "g1",
          ownerUids: ["u1", "u2"],
          organizerUids: ["u1", "u2"],
          memberUids: ["u1", "u2"],
        }),
      ],
      failedGids: [],
    });
    const user = makeUser();

    const result = await deleteAccount({ user: user as never });

    expect(leaveGroup).toHaveBeenCalledWith({ gid: "g1", uid: "u1" });
    expect(deleteUserProfile).toHaveBeenCalledWith("u1");
    expect(user.delete).toHaveBeenCalled();
    expect(result).toEqual({
      deleted: true,
      leftGroupIds: ["g1"],
      failedGroupIds: [],
      needsReauth: false,
      cancelled: false,
    });
  });

  it("returns needsReauth: true when user.delete throws auth/requires-recent-login", async () => {
    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(listMyGroups).mockResolvedValue({ groups: [], failedGids: [] });
    const user = makeUser({
      delete: vi.fn().mockRejectedValue(
        Object.assign(new Error("recent login required"), {
          code: "auth/requires-recent-login",
        }),
      ),
    });

    const result = await deleteAccount({ user: user as never });

    expect(result).toEqual({
      deleted: false,
      leftGroupIds: [],
      failedGroupIds: [],
      needsReauth: true,
      cancelled: false,
    });
  });

  it("wraps other user.delete failures as auth/account-delete-failed", async () => {
    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(listMyGroups).mockResolvedValue({ groups: [], failedGids: [] });
    const user = makeUser({
      delete: vi.fn().mockRejectedValue(
        Object.assign(new Error("network"), {
          code: "auth/network-request-failed",
        }),
      ),
    });

    await expect(deleteAccount({ user: user as never })).rejects.toMatchObject({
      code: "auth/account-delete-failed",
    });
  });

  it("collects per-group leave failures (best-effort) and still calls user.delete", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "a@b.com",
      groupIds: ["g1", "g2", "g3"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [
        makeGroup({
          id: "g1",
          ownerUids: ["u1", "u2"],
          organizerUids: ["u1", "u2"],
          memberUids: ["u1", "u2"],
        }),
        makeGroup({
          id: "g2",
          ownerUids: ["u2"],
          organizerUids: ["u2"],
          memberUids: ["u1", "u2"],
        }),
        makeGroup({
          id: "g3",
          ownerUids: ["u2"],
          organizerUids: ["u2"],
          memberUids: ["u1", "u2"],
        }),
      ],
      failedGids: [],
    });
    vi.mocked(leaveGroup).mockImplementation(async ({ gid }) => {
      if (gid === "g2") throw new AppError("boom", "firestore/write_failed");
    });
    const user = makeUser();

    const result = await deleteAccount({ user: user as never });

    expect(result.failedGroupIds).toEqual(["g2"]);
    expect(result.leftGroupIds.sort()).toEqual(["g1", "g3"]);
    expect(deleteUserProfile).toHaveBeenCalledWith("u1");
    expect(user.delete).toHaveBeenCalled();
    expect(result.deleted).toBe(true);
  });

  it("still proceeds when deleteUserProfile fails (best-effort)", async () => {
    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(listMyGroups).mockResolvedValue({ groups: [], failedGids: [] });
    vi.mocked(deleteUserProfile).mockRejectedValue(
      new AppError("read failed", "firestore/write_failed"),
    );
    const user = makeUser();

    const result = await deleteAccount({ user: user as never });

    expect(result.deleted).toBe(true);
    expect(user.delete).toHaveBeenCalled();
  });

  it("treats null user profile as 0 groups and proceeds", async () => {
    vi.mocked(getUserProfile).mockResolvedValue(null);
    vi.mocked(listMyGroups).mockResolvedValue({ groups: [], failedGids: [] });
    const user = makeUser();

    const result = await deleteAccount({ user: user as never });

    expect(listMyGroups).toHaveBeenCalledWith([]);
    expect(result).toEqual({
      deleted: true,
      leftGroupIds: [],
      failedGroupIds: [],
      needsReauth: false,
      cancelled: false,
    });
  });

  it("invokes confirmPartialFailure with failed group details and proceeds when callback returns true", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "a@b.com",
      groupIds: ["g1", "g2"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [
        makeGroup({
          id: "g1",
          name: "OK Group",
          ownerUids: ["u1", "u2"],
          organizerUids: ["u1", "u2"],
          memberUids: ["u1", "u2"],
        }),
        makeGroup({
          id: "g2",
          name: "Failing Group",
          ownerUids: ["u2"],
          organizerUids: ["u2"],
          memberUids: ["u1", "u2"],
        }),
      ],
      failedGids: [],
    });
    vi.mocked(leaveGroup).mockImplementation(async ({ gid }) => {
      if (gid === "g2") throw new AppError("boom", "firestore/write_failed");
    });
    const confirmPartialFailure = vi.fn().mockResolvedValue(true);
    const user = makeUser();

    const result = await deleteAccount({
      user: user as never,
      confirmPartialFailure,
    });

    expect(confirmPartialFailure).toHaveBeenCalledTimes(1);
    expect(confirmPartialFailure).toHaveBeenCalledWith([
      { id: "g2", name: "Failing Group" },
    ]);
    expect(deleteUserProfile).toHaveBeenCalledWith("u1");
    expect(user.delete).toHaveBeenCalled();
    expect(result.deleted).toBe(true);
    expect(result.cancelled).toBe(false);
    expect(result.failedGroupIds).toEqual(["g2"]);
  });

  it("returns cancelled: true and skips user.delete when confirmPartialFailure returns false", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "a@b.com",
      groupIds: ["g1"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [
        makeGroup({
          id: "g1",
          name: "Failing Group",
          ownerUids: ["u2"],
          organizerUids: ["u2"],
          memberUids: ["u1", "u2"],
        }),
      ],
      failedGids: [],
    });
    vi.mocked(leaveGroup).mockRejectedValue(
      new AppError("boom", "firestore/write_failed"),
    );
    const confirmPartialFailure = vi.fn().mockResolvedValue(false);
    const user = makeUser();

    const result = await deleteAccount({
      user: user as never,
      confirmPartialFailure,
    });

    expect(confirmPartialFailure).toHaveBeenCalledWith([
      { id: "g1", name: "Failing Group" },
    ]);
    expect(deleteUserProfile).not.toHaveBeenCalled();
    expect(user.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      deleted: false,
      leftGroupIds: [],
      failedGroupIds: ["g1"],
      needsReauth: false,
      cancelled: true,
    });
  });

  it("does not invoke confirmPartialFailure when there are no failed leaves", async () => {
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Alice",
      email: "a@b.com",
      groupIds: ["g1"],
      createdAt: now,
    });
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [
        makeGroup({
          id: "g1",
          ownerUids: ["u1", "u2"],
          organizerUids: ["u1", "u2"],
          memberUids: ["u1", "u2"],
        }),
      ],
      failedGids: [],
    });
    const confirmPartialFailure = vi.fn().mockResolvedValue(false);
    const user = makeUser();

    const result = await deleteAccount({
      user: user as never,
      confirmPartialFailure,
    });

    expect(confirmPartialFailure).not.toHaveBeenCalled();
    expect(user.delete).toHaveBeenCalled();
    expect(result.deleted).toBe(true);
    expect(result.cancelled).toBe(false);
  });
});
