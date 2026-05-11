import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroup: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  getTournament: vi.fn(),
  updateSpectateEnabled: vi.fn(),
}));

import { getGroup } from "@/lib/firebase/repositories/groups";
import {
  getTournament,
  updateSpectateEnabled,
} from "@/lib/firebase/repositories/tournaments";

import { setSpectateEnabled } from "./tournament";

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g1",
    name: "Test",
    ownerUids: ["uOwner"],
    organizerUids: ["uOwner"],
    memberUids: ["uOwner"],
    memberDisplayNames: { uOwner: "Owner" },
    audioSettings: {
      enabled: false,
      levelUpSoundId: "default",
      winnerSoundId: "default",
      volume: 0.5,
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
    winnerCardBackground: null,
    seasonCardBackground: null,
    joinCodeId: null,
    createdAt: Timestamp.fromDate(new Date("2026-04-01T00:00:00Z")),
    ...overrides,
  } as GroupDoc;
}

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  const ts = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "uOwner",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: ts,
    levelStartedAt: ts,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 8,
    spectateEnabled: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(getGroup).mockReset();
  vi.mocked(getTournament).mockReset();
  vi.mocked(updateSpectateEnabled).mockReset();
});

describe("setSpectateEnabled", () => {
  it("allows owner (also organizer) to toggle ON", async () => {
    vi.mocked(getTournament).mockResolvedValue(makeTournament());
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner"],
      }),
    );
    vi.mocked(updateSpectateEnabled).mockResolvedValue();

    await setSpectateEnabled({ tid: "t1", uid: "uOwner", value: true });

    expect(updateSpectateEnabled).toHaveBeenCalledWith("t1", true);
  });

  it("allows organizer (non-owner) to toggle ON / OFF", async () => {
    vi.mocked(getTournament).mockResolvedValue(
      makeTournament({ spectateEnabled: true }),
    );
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner", "uOrg"],
        memberUids: ["uOwner", "uOrg"],
      }),
    );
    vi.mocked(updateSpectateEnabled).mockResolvedValue();

    await setSpectateEnabled({ tid: "t1", uid: "uOrg", value: false });

    expect(updateSpectateEnabled).toHaveBeenCalledWith("t1", false);
  });

  it("rejects member with group/not-organizer (no write attempted)", async () => {
    vi.mocked(getTournament).mockResolvedValue(makeTournament());
    vi.mocked(getGroup).mockResolvedValue(
      makeGroup({
        ownerUids: ["uOwner"],
        organizerUids: ["uOwner"],
        memberUids: ["uOwner", "uMember"],
      }),
    );

    await expect(
      setSpectateEnabled({ tid: "t1", uid: "uMember", value: true }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(updateSpectateEnabled).not.toHaveBeenCalled();
  });

  it("propagates firestore/not-found when tournament missing", async () => {
    const { AppError } = await import("@/lib/errors");
    vi.mocked(getTournament).mockRejectedValue(
      new AppError("missing", "firestore/not-found"),
    );

    await expect(
      setSpectateEnabled({ tid: "missing", uid: "uOwner", value: true }),
    ).rejects.toMatchObject({ code: "firestore/not-found" });
    expect(getGroup).not.toHaveBeenCalled();
    expect(updateSpectateEnabled).not.toHaveBeenCalled();
  });

  it.each([
    ["string", "true"],
    ["null", null],
    ["undefined", undefined],
  ] as const)(
    "rejects non-boolean value (%s) without reading tournament",
    async (_label, bad) => {
      await expect(
        setSpectateEnabled({
          tid: "t1",
          uid: "uOwner",
          value: bad as unknown as boolean,
        }),
      ).rejects.toMatchObject({ code: "validation/spectate-enabled-invalid" });
      expect(getTournament).not.toHaveBeenCalled();
      expect(getGroup).not.toHaveBeenCalled();
      expect(updateSpectateEnabled).not.toHaveBeenCalled();
    },
  );
});
