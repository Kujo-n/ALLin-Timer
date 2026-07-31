import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

// firebaseAuth.currentUser はテスト内で書き換えるため mutable にしておく。
// vi.mock は巻き上げられるため vi.hoisted で先行宣言する。
const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));

vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: mockAuthState,
  firestore: {},
}));

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  getTournament: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/players", () => ({
  getPlayer: vi.fn(),
  upsertPlayer: vi.fn(),
  deletePlayer: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/users", () => ({
  upsertUserProfile: vi.fn(),
  getUserProfile: vi.fn(),
}));
vi.mock("@/lib/services/auth-actions", () => ({
  attemptAnonymousSelfDelete: vi.fn(),
  signInAsGuest: vi.fn(),
  loginWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
}));
// 08-auto-group-join-on-entry Phase 2: helper 境界で mock する（testing.md）。
// 素通しすると repositories/groups が実体 import され firestore singleton を触って落ちる。
vi.mock("@/lib/services/auto-group-join", () => ({
  joinGroupViaTournament: vi.fn(),
}));

import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { getPlayer, upsertPlayer, deletePlayer } from "@/lib/firebase/repositories/players";
import { getUserProfile, upsertUserProfile } from "@/lib/firebase/repositories/users";
import { logger } from "@/lib/logger";
import {
  attemptAnonymousSelfDelete,
  loginWithEmail,
  signInAsGuest,
  signInWithGoogle,
} from "@/lib/services/auth-actions";
import { joinGroupViaTournament } from "@/lib/services/auto-group-join";

import {
  cancelOwnEntry,
  cancelPlayerEntry,
  joinAsCurrentUser,
  joinAsExistingUser,
  joinAsGuest,
  joinViaGoogle,
} from "./receipt";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "owner",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
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
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("joinAsGuest", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset();
    vi.mocked(getPlayer).mockReset();
    vi.mocked(upsertPlayer).mockReset();
    vi.mocked(upsertUserProfile).mockReset();
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(signInAsGuest).mockReset();
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
  });

  it("rejects blank displayName with validation/display-name-required", async () => {
    await expect(joinAsGuest({ tid: "t1", displayName: "   " })).rejects.toMatchObject({
      code: "validation/display-name-required",
    });
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("rejects finished tournament with tournament/late-entry-closed", async () => {
    vi.mocked(getTournament).mockResolvedValue(makeTournament({ state: "finished" }));
    await expect(joinAsGuest({ tid: "t1", displayName: "Alice" })).rejects.toBeInstanceOf(AppError);
    await expect(joinAsGuest({ tid: "t1", displayName: "Alice" })).rejects.toMatchObject({
      code: "tournament/late-entry-closed",
    });
  });

  it("creates player and upserts user profile on happy path", async () => {
    vi.mocked(getTournament).mockResolvedValue(makeTournament());
    vi.mocked(signInAsGuest).mockResolvedValue({
      uid: "guest-1",
      email: null,
      displayName: "Alice",
    } as unknown as Awaited<ReturnType<typeof signInAsGuest>>);
    vi.mocked(getPlayer).mockResolvedValue(null);
    vi.mocked(upsertUserProfile).mockResolvedValue(undefined);
    vi.mocked(upsertPlayer).mockResolvedValue(undefined);

    const result = await joinAsGuest({ tid: "t1", displayName: "Alice" });

    expect(result.result).toBe("created");
    expect(signInAsGuest).toHaveBeenCalledWith("Alice");
    expect(upsertUserProfile).toHaveBeenCalledWith({
      uid: "guest-1",
      displayName: "Alice",
      email: null,
    });
    expect(upsertPlayer).toHaveBeenCalledWith("t1", "guest-1", {
      displayName: "Alice",
    });
  });

  it("returns already-joined when player already exists", async () => {
    vi.mocked(getTournament).mockResolvedValue(makeTournament());
    vi.mocked(signInAsGuest).mockResolvedValue({
      uid: "guest-1",
      email: null,
      displayName: "Alice",
    } as unknown as Awaited<ReturnType<typeof signInAsGuest>>);
    vi.mocked(getPlayer).mockResolvedValue({
      id: "guest-1",
      displayName: "Alice",
      uid: "guest-1",
      entryAt: now,
      isBusted: false,
      bustedAt: null,
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
      isPlayingDealer: false,
    });
    vi.mocked(upsertUserProfile).mockResolvedValue(undefined);
    vi.mocked(upsertPlayer).mockResolvedValue(undefined);

    const result = await joinAsGuest({ tid: "t1", displayName: "Alice" });
    expect(result.result).toBe("already-joined");
  });
});

describe("resolveDisplayName (via joinAsCurrentUser)", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
    mockAuthState.currentUser = null;
  });

  it("uses form hint with highest priority (overrides profile and Auth)", async () => {
    mockAuthState.currentUser = {
      uid: "u1",
      email: "alice@example.com",
      displayName: "AuthName",
    };
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "ProfileName",
      email: "alice@example.com",
      groupIds: [],
      createdAt: now,
    });

    await joinAsCurrentUser({ tid: "t1", displayName: "HintName" });

    expect(upsertPlayer).toHaveBeenCalledWith("t1", "u1", {
      displayName: "HintName",
    });
  });

  it("falls back to profile displayName when hint is empty", async () => {
    mockAuthState.currentUser = {
      uid: "u1",
      email: "alice@example.com",
      displayName: null,
    };
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "ProfileName",
      email: "alice@example.com",
      groupIds: [],
      createdAt: now,
    });

    await joinAsCurrentUser({ tid: "t1" });

    expect(upsertPlayer).toHaveBeenCalledWith("t1", "u1", {
      displayName: "ProfileName",
    });
  });

  it("falls back to Firebase Auth displayName when profile missing", async () => {
    mockAuthState.currentUser = {
      uid: "u1",
      email: "alice@example.com",
      displayName: "AuthOnlyName",
    };
    vi.mocked(getUserProfile).mockResolvedValue(null);

    await joinAsCurrentUser({ tid: "t1" });

    expect(upsertPlayer).toHaveBeenCalledWith("t1", "u1", {
      displayName: "AuthOnlyName",
    });
  });

  it("throws validation/display-name-required when all sources are empty", async () => {
    mockAuthState.currentUser = {
      uid: "u1",
      email: "alice@example.com",
      displayName: null,
    };
    vi.mocked(getUserProfile).mockResolvedValue(null);

    await expect(joinAsCurrentUser({ tid: "t1" })).rejects.toMatchObject({
      code: "validation/display-name-required",
    });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });
});

describe("joinAsCurrentUser", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
    mockAuthState.currentUser = null;
  });

  it("rejects when not authenticated, before touching Firestore or auto-join", async () => {
    mockAuthState.currentUser = null;

    await expect(joinAsCurrentUser({ tid: "t1" })).rejects.toMatchObject({
      code: "auth/not-authenticated",
    });

    // ガードは tournament read の「前」に効く必要がある（未認証では rules が read を拒否する）
    expect(getTournament).not.toHaveBeenCalled();
    expect(upsertPlayer).not.toHaveBeenCalled();
    expect(joinGroupViaTournament).not.toHaveBeenCalled();
  });
});

describe("cancelOwnEntry", () => {
  beforeEach(() => {
    vi.mocked(deletePlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(attemptAnonymousSelfDelete)
      .mockReset()
      .mockResolvedValue({ deleted: false });
    mockAuthState.currentUser = null;
  });

  it("rejects when not authenticated", async () => {
    mockAuthState.currentUser = null;
    await expect(cancelOwnEntry("t1")).rejects.toMatchObject({
      code: "auth/not-authenticated",
    });
    expect(deletePlayer).not.toHaveBeenCalled();
    expect(attemptAnonymousSelfDelete).not.toHaveBeenCalled();
  });

  it("deletes player and delegates anonymous cleanup to helper for non-anonymous user", async () => {
    const user = {
      uid: "u1",
      email: "alice@example.com",
      displayName: "Alice",
      isAnonymous: false,
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mockAuthState.currentUser = user;

    await cancelOwnEntry("t1");

    expect(deletePlayer).toHaveBeenCalledWith("t1", "u1");
    // helper は呼ばれるが内部で isAnonymous=false → no-op の契約。
    expect(attemptAnonymousSelfDelete).toHaveBeenCalledWith(user, "cancel");
  });

  it("delegates anonymous cleanup to helper for anonymous user", async () => {
    const user = {
      uid: "guest-1",
      email: null,
      displayName: "Alice",
      isAnonymous: true,
      delete: vi.fn().mockResolvedValue(undefined),
    };
    mockAuthState.currentUser = user;

    await cancelOwnEntry("t1");

    expect(deletePlayer).toHaveBeenCalledWith("t1", "guest-1");
    expect(attemptAnonymousSelfDelete).toHaveBeenCalledWith(user, "cancel");
  });

  it("does not throw when helper is best-effort (rejection is swallowed inside helper)", async () => {
    const user = {
      uid: "guest-1",
      email: null,
      displayName: "Alice",
      isAnonymous: true,
      delete: vi.fn().mockRejectedValue(new Error("requires-recent-login")),
    };
    mockAuthState.currentUser = user;
    // helper の契約: 失敗時も throw せず { deleted: false } で resolve する。
    vi.mocked(attemptAnonymousSelfDelete).mockResolvedValue({ deleted: false });

    await expect(cancelOwnEntry("t1")).resolves.toBeUndefined();
    expect(deletePlayer).toHaveBeenCalledWith("t1", "guest-1");
    expect(attemptAnonymousSelfDelete).toHaveBeenCalledWith(user, "cancel");
  });
});

describe("cancelPlayerEntry", () => {
  beforeEach(() => {
    vi.mocked(deletePlayer).mockReset().mockResolvedValue(undefined);
  });

  it("delegates to deletePlayer with given pid", async () => {
    await cancelPlayerEntry("t1", "p1");
    expect(deletePlayer).toHaveBeenCalledWith("t1", "p1");
  });

  it("propagates deletePlayer errors", async () => {
    vi.mocked(deletePlayer).mockRejectedValue(
      new AppError("permission denied", "firestore/permission-denied"),
    );
    await expect(cancelPlayerEntry("t1", "p1")).rejects.toMatchObject({
      code: "firestore/permission-denied",
    });
  });
});

describe("joinAsExistingUser", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(loginWithEmail).mockReset();
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
  });

  it("logs in and upserts player on happy path", async () => {
    vi.mocked(loginWithEmail).mockResolvedValue({
      uid: "u1",
      email: "alice@example.com",
      displayName: "Alice",
    } as unknown as Awaited<ReturnType<typeof loginWithEmail>>);

    const result = await joinAsExistingUser({
      tid: "t1",
      email: "alice@example.com",
      password: "pw",
    });

    expect(result.result).toBe("created");
    expect(loginWithEmail).toHaveBeenCalledWith("alice@example.com", "pw");
    expect(upsertPlayer).toHaveBeenCalledWith("t1", "u1", { displayName: "Alice" });
  });

  it("returns already-joined when existing player record is found", async () => {
    vi.mocked(loginWithEmail).mockResolvedValue({
      uid: "u1",
      email: "alice@example.com",
      displayName: "Alice",
    } as unknown as Awaited<ReturnType<typeof loginWithEmail>>);
    vi.mocked(getPlayer).mockResolvedValue({
      id: "u1",
      uid: "u1",
      displayName: "Alice",
      entryAt: now,
      isBusted: false,
      bustedAt: null,
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
      isPlayingDealer: false,
    });

    const result = await joinAsExistingUser({
      tid: "t1",
      email: "alice@example.com",
      password: "pw",
    });

    expect(result.result).toBe("already-joined");
  });

  it("propagates loginWithEmail errors", async () => {
    vi.mocked(loginWithEmail).mockRejectedValue(
      new AppError("login failed", "auth/invalid-credentials"),
    );
    await expect(
      joinAsExistingUser({ tid: "t1", email: "alice@example.com", password: "pw" }),
    ).rejects.toMatchObject({ code: "auth/invalid-credentials" });
  });
});

describe("joinViaGoogle", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(signInWithGoogle).mockReset();
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
  });

  it("signs in with google and creates player on happy path", async () => {
    // Phase 4.7: signInWithGoogle は { user, isNewUser } を返すようになった
    vi.mocked(signInWithGoogle).mockResolvedValue({
      user: {
        uid: "u-google",
        email: "alice@example.com",
        displayName: "Alice",
      } as unknown as Awaited<ReturnType<typeof signInWithGoogle>>["user"],
      isNewUser: false,
      needsDisplayNameSetup: false,
    });

    const result = await joinViaGoogle({ tid: "t1" });

    expect(result.result).toBe("created");
    expect(signInWithGoogle).toHaveBeenCalled();
    expect(upsertPlayer).toHaveBeenCalledWith("t1", "u-google", { displayName: "Alice" });
  });

  it("propagates signInWithGoogle errors", async () => {
    vi.mocked(signInWithGoogle).mockRejectedValue(
      new AppError("popup closed", "auth/popup-closed"),
    );
    await expect(joinViaGoogle({ tid: "t1" })).rejects.toMatchObject({
      code: "auth/popup-closed",
    });
  });
});

describe("assertAcceptingEntries (via joinAsGuest)", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset();
    vi.mocked(signInAsGuest).mockReset().mockResolvedValue({
      uid: "guest-1",
      email: null,
      displayName: "Alice",
    } as unknown as Awaited<ReturnType<typeof signInAsGuest>>);
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
  });

  it("rejects when running tournament is past late-entry deadline", async () => {
    vi.mocked(getTournament).mockResolvedValue(
      makeTournament({
        state: "running",
        currentLevel: 7,
        lateEntryDeadlineLevel: 6,
      }),
    );

    await expect(joinAsGuest({ tid: "t1", displayName: "Alice" })).rejects.toMatchObject({
      code: "tournament/late-entry-closed",
    });
  });

  it("rejects when paused tournament is past late-entry deadline", async () => {
    vi.mocked(getTournament).mockResolvedValue(
      makeTournament({
        state: "paused",
        currentLevel: 10,
        lateEntryDeadlineLevel: 6,
      }),
    );

    await expect(joinAsGuest({ tid: "t1", displayName: "Alice" })).rejects.toMatchObject({
      code: "tournament/late-entry-closed",
    });
  });

  it("accepts when running tournament is within late-entry deadline", async () => {
    vi.mocked(getTournament).mockResolvedValue(
      makeTournament({
        state: "running",
        currentLevel: 4,
        lateEntryDeadlineLevel: 6,
      }),
    );

    await expect(joinAsGuest({ tid: "t1", displayName: "Alice" })).resolves.toMatchObject({
      result: "created",
    });
  });
});

describe("auto group join (08 Phase 2)", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
    vi.mocked(loginWithEmail).mockReset();
    vi.mocked(signInWithGoogle).mockReset();
    vi.mocked(signInAsGuest).mockReset();
    vi.mocked(joinGroupViaTournament)
      .mockReset()
      .mockResolvedValue({ gid: "g1", outcome: "joined" });
    mockAuthState.currentUser = null;
  });

  it("joinAsCurrentUser: player 作成後に tournament の groupId で自動所属を呼ぶ", async () => {
    mockAuthState.currentUser = {
      uid: "u1",
      email: "a@example.com",
      displayName: "Alice",
    };

    const outcome = await joinAsCurrentUser({ tid: "t1" });

    expect(outcome).toEqual({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });
    expect(joinGroupViaTournament).toHaveBeenCalledWith({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });
    // 順序: player 作成 → 自動所属（rule の hasTournamentEntryProof の前提）
    expect(vi.mocked(upsertPlayer).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(joinGroupViaTournament).mock.invocationCallOrder[0],
    );
  });

  it("joinViaGoogle: 自動所属を呼ぶ", async () => {
    vi.mocked(signInWithGoogle).mockResolvedValue({
      user: {
        uid: "u-google",
        email: "alice@example.com",
        displayName: "Alice",
      } as unknown as Awaited<ReturnType<typeof signInWithGoogle>>["user"],
      isNewUser: true,
      needsDisplayNameSetup: false,
    });

    const outcome = await joinViaGoogle({ tid: "t1" });

    expect(outcome).toEqual({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });
    expect(joinGroupViaTournament).toHaveBeenCalledWith({
      tid: "t1",
      gid: "g1",
      uid: "u-google",
      displayName: "Alice",
    });
  });

  it("joinAsExistingUser: 自動所属を呼ぶ", async () => {
    vi.mocked(loginWithEmail).mockResolvedValue({
      uid: "u1",
      email: "alice@example.com",
      displayName: "Alice",
    } as unknown as Awaited<ReturnType<typeof loginWithEmail>>);

    const outcome = await joinAsExistingUser({
      tid: "t1",
      email: "alice@example.com",
      password: "pw",
    });

    expect(outcome).toEqual({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });
    expect(joinGroupViaTournament).toHaveBeenCalledWith({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });
  });

  it("joinAsGuest: 自動所属を呼ばず autoJoin=null を返す（匿名除外）", async () => {
    vi.mocked(signInAsGuest).mockResolvedValue({
      uid: "guest-1",
      email: null,
      displayName: "Guest",
    } as unknown as Awaited<ReturnType<typeof signInAsGuest>>);

    const outcome = await joinAsGuest({ tid: "t1", displayName: "Guest" });

    expect(outcome).toEqual({ result: "created", autoJoin: null });
    expect(joinGroupViaTournament).not.toHaveBeenCalled();
  });

  it("already-joined でも自動所属を呼ぶ（取りこぼし回収）", async () => {
    vi.mocked(getPlayer).mockResolvedValue({
      id: "u1",
      uid: "u1",
      displayName: "Alice",
      entryAt: now,
      isBusted: false,
      bustedAt: null,
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
      isPlayingDealer: false,
    });
    mockAuthState.currentUser = { uid: "u1", email: null, displayName: "Alice" };

    const outcome = await joinAsCurrentUser({ tid: "t1" });

    expect(outcome.result).toBe("already-joined");
    expect(joinGroupViaTournament).toHaveBeenCalledTimes(1);
  });

  it("自動所属が失敗しても受付は成功のまま（status=failed + warn 1 本）", async () => {
    mockAuthState.currentUser = { uid: "u1", email: null, displayName: "Alice" };
    vi.mocked(joinGroupViaTournament).mockRejectedValue(
      new AppError("サークルへの自動加入に失敗しました", "group/auto-join-failed"),
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const outcome = await joinAsCurrentUser({ tid: "t1" });

    expect(outcome).toEqual({
      result: "created",
      autoJoin: { gid: "g1", status: "failed" },
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("skipped-anonymous はそのまま status に載る", async () => {
    mockAuthState.currentUser = { uid: "u-anon", email: null, displayName: "Guest" };
    vi.mocked(joinGroupViaTournament).mockResolvedValue({
      gid: "g1",
      outcome: "skipped-anonymous",
    });

    const outcome = await joinAsCurrentUser({ tid: "t1" });

    expect(outcome).toEqual({
      result: "created",
      autoJoin: { gid: "g1", status: "skipped-anonymous" },
    });
  });

  it("already-member はそのまま status に載る", async () => {
    mockAuthState.currentUser = { uid: "u1", email: null, displayName: "Alice" };
    vi.mocked(joinGroupViaTournament).mockResolvedValue({
      gid: "g1",
      outcome: "already-member",
    });

    const outcome = await joinAsCurrentUser({ tid: "t1" });

    expect(outcome).toEqual({
      result: "created",
      autoJoin: { gid: "g1", status: "already-member" },
    });
  });

  it("受付で解決した displayName（プロフィール由来）を自動所属へ渡す", async () => {
    mockAuthState.currentUser = {
      uid: "u1",
      email: "a@example.com",
      displayName: null,
    };
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "ProfileName",
      email: "a@example.com",
      groupIds: [],
      createdAt: now,
    });

    await joinAsCurrentUser({ tid: "t1" });

    expect(joinGroupViaTournament).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: "ProfileName" }),
    );
  });
});
