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
  listPlayers: vi.fn(),
  deletePlayer: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/users", () => ({
  upsertUserProfile: vi.fn(),
  getUserProfile: vi.fn(),
}));
vi.mock("@/lib/services/auth-actions", () => ({
  signInAsGuest: vi.fn(),
  loginWithEmail: vi.fn(),
  sendEmailLinkForJoin: vi.fn(),
  completeEmailLink: vi.fn(),
}));

import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { getPlayer, upsertPlayer } from "@/lib/firebase/repositories/players";
import { getUserProfile, upsertUserProfile } from "@/lib/firebase/repositories/users";
import { signInAsGuest } from "@/lib/services/auth-actions";

import { joinAsCurrentUser, joinAsGuest } from "./receipt";

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
      lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 }],
    },
    state: "setup",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
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

    expect(result).toBe("created");
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
    });
    vi.mocked(upsertUserProfile).mockResolvedValue(undefined);
    vi.mocked(upsertPlayer).mockResolvedValue(undefined);

    const result = await joinAsGuest({ tid: "t1", displayName: "Alice" });
    expect(result).toBe("already-joined");
  });
});

describe("resolveDisplayName (via joinAsCurrentUser)", () => {
  beforeEach(() => {
    vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
    vi.mocked(getPlayer).mockReset().mockResolvedValue(null);
    vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
    vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
    vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
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
