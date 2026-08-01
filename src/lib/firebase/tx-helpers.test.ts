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

import {
  checkPlayerMoveGuard,
  expectedLastMovedAtMs,
  loadTournamentInTx,
  playerFromSnap,
} from "./tx-helpers";

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

/**
 * architect-refactor 20260801 (finding-5): orchestrator の
 * applySingleMove / applyCascadeMoves / applyTableBreak に重複していた
 * 4 段 race guard を集約した pure 関数の直接テスト。
 *
 * 席移動の競合制御は同時操作で席が二重占有され得る最も壊れやすい箇所のため、
 * 判定順序（missing → busted → moved → race）まで含めて仕様を固定する。
 */
describe("checkPlayerMoveGuard", () => {
  const FROM = { tableNum: 1, seatNum: 3 };

  function makePlayer(over: Partial<PlayerDoc> = {}): PlayerDoc {
    return {
      id: "p1",
      displayName: "Alice",
      uid: "u-alice",
      entryAt: ts,
      isBusted: false,
      bustedAt: null,
      tableNum: FROM.tableNum,
      seatNum: FROM.seatNum,
      lastMovedAt: null,
      isPlayingDealer: false,
      ...over,
    };
  }

  function snapOf(p: PlayerDoc | null) {
    return {
      id: "p1",
      exists: () => p !== null,
      data: () => (p ? stripId(p) : {}),
    } as unknown as Parameters<typeof checkPlayerMoveGuard>[0];
  }

  it("変化なしなら ok=true と復元した player を返す", () => {
    const p = makePlayer();
    const result = checkPlayerMoveGuard(snapOf(p), FROM, null);
    expect(result).toEqual({ ok: true, player: p });
  });

  it("lastMovedAt が一致していれば ok=true", () => {
    const moved = Timestamp.fromMillis(555_000);
    const p = makePlayer({ lastMovedAt: moved });
    const result = checkPlayerMoveGuard(snapOf(p), FROM, 555_000);
    expect(result.ok).toBe(true);
  });

  it("doc が存在しなければ reason=missing", () => {
    expect(checkPlayerMoveGuard(snapOf(null), FROM, null)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("bust 済みなら reason=busted", () => {
    const p = makePlayer({ isBusted: true, bustedAt: ts });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, null)).toEqual({
      ok: false,
      reason: "busted",
    });
  });

  it("tableNum が from と違えば reason=moved", () => {
    const p = makePlayer({ tableNum: 2 });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, null)).toEqual({
      ok: false,
      reason: "moved",
    });
  });

  it("seatNum が from と違えば reason=moved", () => {
    const p = makePlayer({ seatNum: 9 });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, null)).toEqual({
      ok: false,
      reason: "moved",
    });
  });

  it("lastMovedAt が期待値と違えば reason=race", () => {
    const p = makePlayer({ lastMovedAt: Timestamp.fromMillis(999_000) });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, 555_000)).toEqual({
      ok: false,
      reason: "race",
    });
  });

  it("期待値が null なのに lastMovedAt が入っていれば reason=race", () => {
    const p = makePlayer({ lastMovedAt: Timestamp.fromMillis(1) });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, null)).toEqual({
      ok: false,
      reason: "race",
    });
  });

  it("判定順序: busted は moved / race より優先される", () => {
    // 席も lastMovedAt も食い違っているが、busted が先に返る。
    const p = makePlayer({
      isBusted: true,
      bustedAt: ts,
      tableNum: 4,
      lastMovedAt: Timestamp.fromMillis(1),
    });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, 555_000)).toEqual({
      ok: false,
      reason: "busted",
    });
  });

  it("判定順序: moved は race より優先される", () => {
    const p = makePlayer({ tableNum: 4, lastMovedAt: Timestamp.fromMillis(1) });
    expect(checkPlayerMoveGuard(snapOf(p), FROM, 555_000)).toEqual({
      ok: false,
      reason: "moved",
    });
  });
});

describe("expectedLastMovedAtMs", () => {
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

  it("該当 player の lastMovedAt を ms で返す", () => {
    const players = [makePlayer({ id: "p1", lastMovedAt: Timestamp.fromMillis(42_000) })];
    expect(expectedLastMovedAtMs(players, "p1")).toBe(42_000);
  });

  it("lastMovedAt が null なら null", () => {
    expect(expectedLastMovedAtMs([makePlayer({ id: "p1" })], "p1")).toBeNull();
  });

  it("player が見つからなければ null（未配席・snapshot 欠落の防御）", () => {
    expect(expectedLastMovedAtMs([makePlayer({ id: "p1" })], "unknown")).toBeNull();
  });
});
