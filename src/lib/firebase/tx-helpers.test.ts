import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>(
    "firebase/firestore",
  );
  return {
    ...actual,
    collection: vi.fn(() => ({
      __ref: "collection",
      withConverter: vi.fn(function (this: unknown) {
        return this;
      }),
    })),
    doc: vi.fn((_ref, id?: string) => ({ __ref: "doc", id: id ?? "auto" })),
    runTransaction: vi.fn(),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { runTransaction } from "firebase/firestore";

import { loadTournamentInTx, playerFromSnap } from "./tx-helpers";

const ts = Timestamp.fromDate(new Date("2026-05-06T10:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
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
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function stripId<T extends { id: string }>(x: T): Omit<T, "id"> {
  const { id: _id, ...rest } = x;
  void _id;
  return rest;
}

interface FakeSnap {
  id: string;
  exists: () => boolean;
  data: () => unknown;
}

function mockTxOnce(reads: Array<() => FakeSnap>) {
  let i = 0;
  vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
    const tx = {
      get: vi.fn(async () => {
        const f = reads[i++];
        if (!f) throw new Error(`mockTxOnce: exhausted at ${i - 1}`);
        return f();
      }),
      update: vi.fn(),
      set: vi.fn(),
      delete: vi.fn(),
    };
    return (await fn(tx as unknown as Parameters<typeof fn>[0])) as unknown;
  });
}

beforeEach(() => {
  vi.mocked(runTransaction).mockReset();
});

describe("loadTournamentInTx", () => {
  it("returns the TournamentDoc when tournament exists and userGroupIds includes its groupId", async () => {
    const t = makeTournament({ groupId: "g1" });
    mockTxOnce([
      () => ({ id: t.id, exists: () => true, data: () => stripId(t) }),
    ]);
    let captured: TournamentDoc | null = null;
    await runTransaction({} as never, async (tx) => {
      captured = await loadTournamentInTx(tx, "t1", ["g1"]);
    });
    expect(captured).not.toBeNull();
    expect(captured!.id).toBe("t1");
    expect(captured!.groupId).toBe("g1");
  });

  it("throws firestore/not-found when tournament doc does not exist", async () => {
    mockTxOnce([
      () => ({ id: "t1", exists: () => false, data: () => ({}) }),
    ]);
    await expect(
      runTransaction({} as never, async (tx) => {
        await loadTournamentInTx(tx, "t1", ["g1"]);
      }),
    ).rejects.toMatchObject({ code: "firestore/not-found" });
  });

  it("throws firestore/permission-denied when userGroupIds does not include the tournament's groupId", async () => {
    const t = makeTournament({ groupId: "g1" });
    mockTxOnce([
      () => ({ id: t.id, exists: () => true, data: () => stripId(t) }),
    ]);
    await expect(
      runTransaction({} as never, async (tx) => {
        await loadTournamentInTx(tx, "t1", ["g-other"]);
      }),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  it("throws firestore/permission-denied when userGroupIds is empty", async () => {
    const t = makeTournament({ groupId: "g1" });
    mockTxOnce([
      () => ({ id: t.id, exists: () => true, data: () => stripId(t) }),
    ]);
    await expect(
      runTransaction({} as never, async (tx) => {
        await loadTournamentInTx(tx, "t1", []);
      }),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });
});

describe("playerFromSnap", () => {
  function makePlayer(over: Partial<PlayerDoc> = {}): PlayerDoc {
    return {
      id: "p1",
      displayName: "Alice",
      uid: "u-alice",
      entryAt: ts,
      isBusted: false,
      bustedAt: null,
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
      isPlayingDealer: false,
      ...over,
    };
  }

  it("returns { id, ...data } when snap exists", () => {
    const p = makePlayer({ tableNum: 2, seatNum: 5 });
    const snap = {
      id: "p1",
      exists: () => true,
      data: () => stripId(p),
    } as unknown as Parameters<typeof playerFromSnap>[0];
    expect(playerFromSnap(snap)).toEqual(p);
  });

  it("returns null when snap does not exist", () => {
    const snap = {
      id: "p1",
      exists: () => false,
      data: () => ({}),
    } as unknown as Parameters<typeof playerFromSnap>[0];
    expect(playerFromSnap(snap)).toBeNull();
  });
});
