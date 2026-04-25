import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    collection: vi.fn(() => ({
      __ref: "collection",
      withConverter: vi.fn(function (this: unknown) {
        return this;
      }),
    })),
    doc: vi.fn((_ref, id?: string) => ({ __ref: "doc", id: id ?? "auto" })),
    query: vi.fn((...args) => ({ __ref: "query", args })),
    orderBy: vi.fn((...args) => ({ __ref: "orderBy", args })),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
    runTransaction: vi.fn(),
    writeBatch: vi.fn(),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

vi.mock("@/lib/firebase/repositories/players", () => ({
  bustPlayer: vi.fn(),
  unbustPlayer: vi.fn(),
}));

import { runTransaction, updateDoc } from "firebase/firestore";

import {
  bustPlayer as bustPlayerWrite,
  unbustPlayer as unbustPlayerWrite,
} from "@/lib/firebase/repositories/players";

import {
  applyBalancingOnce,
  autoSeatLateEntry,
  bustPlayer,
  commitInitialSeating,
  unbustPlayer,
} from "./orchestrator";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

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

function player(p: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    id: p.id,
    displayName: p.displayName ?? p.id,
    uid: p.uid ?? p.id,
    entryAt: p.entryAt ?? ts,
    isBusted: p.isBusted ?? false,
    bustedAt: p.bustedAt ?? null,
    tableNum: p.tableNum ?? null,
    seatNum: p.seatNum ?? null,
    lastMovedAt: p.lastMovedAt ?? null,
  };
}

/**
 * runTransaction の mock 実装ヘルパ。
 * `txReads` は `tx.get` の返却値を順に生成する関数配列（各 doc ref 毎に別の doc snapshot を返す）。
 * `onUpdate` は tx.update 呼出しを、`onSet` は tx.set 呼出しを捕捉するコールバック。
 */
function mockTransaction(
  txReads: Array<() => { exists: () => boolean; id?: string; data?: () => unknown }>,
  onUpdate?: (ref: unknown, patch: unknown) => void,
  onSet?: (ref: unknown, patch: unknown) => void,
) {
  let readIdx = 0;
  vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
    const tx = {
      get: vi.fn(async () => {
        const f = txReads[readIdx++];
        if (!f) throw new Error(`mockTransaction: txReads exhausted at index ${readIdx - 1}`);
        return f();
      }),
      update: vi.fn((ref, patch) => onUpdate?.(ref, patch)),
      set: vi.fn((ref, patch) => onSet?.(ref, patch)),
      delete: vi.fn(),
    };
    // M4 fix: orchestrator が tx.return 値を受け取るパターンに対応するため、
    // 内部 fn の戻り値をそのまま返す。
    const result = await fn(tx as unknown as Parameters<typeof fn>[0]);
    return result as unknown;
  });
}

beforeEach(() => {
  vi.mocked(runTransaction).mockReset();
  vi.mocked(updateDoc).mockReset().mockResolvedValue(undefined);
  vi.mocked(bustPlayerWrite).mockReset().mockResolvedValue(undefined);
  vi.mocked(unbustPlayerWrite).mockReset().mockResolvedValue(undefined);
});

describe("commitInitialSeating", () => {
  it("rejects non-member at tx boundary", async () => {
    const t = makeTournament({ state: "setup", groupId: "g1" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      commitInitialSeating("t1", "u1", ["g-other"], [], Date.now()),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  it("rejects when state is running", async () => {
    const t = makeTournament({ state: "running" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      commitInitialSeating("t1", "u1", ["g1"], [], Date.now()),
    ).rejects.toMatchObject({ code: "tournament/invalid-state" });
  });

  it("writes seat assignments and tables when valid (setup→seating)", async () => {
    const t = makeTournament({ state: "setup" });
    const players = [player({ id: "p1" }), player({ id: "p2" })];
    const updateCalls: Array<{ ref: unknown; patch: Record<string, unknown> }> = [];
    const setCalls: Array<{ ref: unknown; patch: Record<string, unknown> }> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        ...players.map((p) => () => ({
          exists: () => true,
          id: p.id,
          data: () => stripId(p),
        })),
      ],
      (ref, patch) => {
        updateCalls.push({ ref, patch: patch as Record<string, unknown> });
      },
      (ref, patch) => {
        setCalls.push({ ref, patch: patch as Record<string, unknown> });
      },
    );

    await commitInitialSeating("t1", "u1", ["g1"], players, 42);

    // 2 player updates + 1 tournament state update = 3
    expect(updateCalls).toHaveLength(3);
    const tournamentPatch = updateCalls[updateCalls.length - 1].patch;
    expect(tournamentPatch.state).toBe("seating");
    // M-3.1 fix: tables are written inside the tx via tx.set, not a separate batch.
    // 2 players × 1 seat/player at seatsPerTable=9 → 1 table, so 1 set call.
    expect(setCalls).toHaveLength(1);
    expect(setCalls[0].patch).toMatchObject({ tableNum: 1, isBroken: false });
  });

  it("wraps engine too-many-tables as seating/too-many-tables", async () => {
    const t = makeTournament({ state: "setup", seatsPerTable: 1 });
    // 7 players × 1 seat = 7 tables → exceeds MAX_TABLES = 6
    const players = Array.from({ length: 7 }, (_, i) => player({ id: `p${i + 1}` }));
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      ...players.map((p) => () => ({
        exists: () => true,
        id: p.id,
        data: () => stripId(p),
      })),
    ]);
    await expect(
      commitInitialSeating("t1", "u1", ["g1"], players, 1),
    ).rejects.toMatchObject({ code: "seating/too-many-tables" });
  });
});

describe("autoSeatLateEntry", () => {
  it("no-ops when engine finds no available seat", async () => {
    // full seat: 1 table 1 seat, and that seat is occupied → no room for a newcomer
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      1,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("no-seat");
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("skips with reason=already-seated when player has seat in tx", async () => {
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "new",
        data: () =>
          stripId(player({ id: "new", tableNum: 1, seatNum: 2 })),
      }),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("already-seated");
  });

  it("skips with reason=race when lastMovedAt ms differs", async () => {
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    const movedTs = Timestamp.fromMillis(123_000);
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "new",
        data: () =>
          stripId(player({ id: "new", lastMovedAt: movedTs })),
      }),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null, // expected = null, actual = 123000 → mismatch
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("race");
  });

  it("commits seat when all guards pass", async () => {
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    const captured: unknown[] = [];
    // tx.get は: tournament → 対象 player → 対象卓の既存プレイヤー (H2 再検証) の順。
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "new",
          data: () => stripId(player({ id: "new", lastMovedAt: null })),
        }),
        () => ({
          exists: () => true,
          id: "a",
          data: () => stripId(player({ id: "a", tableNum: 1, seatNum: 1 })),
        }),
      ],
      (_ref, patch) => captured.push(patch),
    );
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(true);
    expect(captured).toHaveLength(1);
    const patch = captured[0] as Record<string, unknown>;
    expect(patch.tableNum).toBe(1);
    expect(patch.seatNum).toBe(2);
  });

  it("skips with reason=seat-taken when target seat is occupied at tx (H2 fix)", async () => {
    // seatedPlayers では seat 1-1 だけ埋まり 1-2 は空に見える。
    // しかし tx 内で再 read すると別端末が seat 1-2 を新規プレイヤーへ割当て済み。
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "new",
        data: () => stripId(player({ id: "new", lastMovedAt: null })),
      }),
      // 再 read で "a" が seat 2 を取っていることを返す（race 結果）。
      () => ({
        exists: () => true,
        id: "a",
        data: () => stripId(player({ id: "a", tableNum: 1, seatNum: 2 })),
      }),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("seat-taken");
  });
});

describe("applyBalancingOnce", () => {
  it("returns applied=false when no balancing needed (no table-break, diff < 2)", async () => {
    // 両卓 9 人ずつ満席 → table break 不可 (18 > (2-1)*9=9)、差 0 → balancing 不要
    const seated = [
      ...Array.from({ length: 9 }, (_, i) =>
        player({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        player({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts },
    ];
    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);
    expect(result.applied).toBe(false);
    expect(result.description).toBeNull();
    expect(runTransaction).not.toHaveBeenCalled();
  });
});

// TG1: applySingleMove は applyBalancingOnce 経由でしか到達できないが、
// バランシング 1 件 fixture（差 2）で transaction の commit / race / seat-taken 各経路を網羅する。
describe("applyBalancingOnce → applySingleMove (TG1)", () => {
  function balancingFixture() {
    // 卓1: 7人、卓2: 5人 → 差 2 → balancing 1 件
    const seated = [
      ...Array.from({ length: 7 }, (_, i) =>
        player({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        player({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts },
    ];
    return { seated, tables };
  }

  it("commits move with race-guarded seat re-verification (happy path)", async () => {
    const { seated, tables } = balancingFixture();
    // engine: maxTable=1 → 移動対象は a1 (seatNum=1 最小)、移動先は卓2 seat 6
    // tx.get 順序: tournament → a1 → 移動先卓 (=2) の既存メンバー [b1..b5] = 7 reads
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a1",
          data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 1 })),
        }),
        ...["b1", "b2", "b3", "b4", "b5"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () =>
            stripId(player({ id, tableNum: 2, seatNum: i + 1 })),
        })),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(true);
    expect(result.description).toBe("Table 1 / 席 1 → Table 2 / 席 6");
    expect(captured).toHaveLength(1);
    expect(captured[0].tableNum).toBe(2);
    expect(captured[0].seatNum).toBe(6);
  });

  it("skips with skipReason=moved when subscribe snapshot is stale (race)", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: unknown[] = [];
    // tx 内で a1 が既に別卓へ移動済みと観測される → moved skip
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a1",
          data: () =>
            stripId(player({ id: "a1", tableNum: 2, seatNum: 6 })),
        }),
      ],
      (_ref, patch) => captured.push(patch),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(false);
    expect(result.description).toBeNull();
    expect(captured).toHaveLength(0);
  });

  it("skips with skipReason=seat-taken when destination seat occupied at tx (H2)", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: unknown[] = [];
    // a1 自身は from に居る、しかし b1 が想定 destination (2卓6席) を取っている
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a1",
          data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 1 })),
        }),
        // b1 が seat 6 を占有
        () => ({
          exists: () => true,
          id: "b1",
          data: () => stripId(player({ id: "b1", tableNum: 2, seatNum: 6 })),
        }),
        ...["b2", "b3", "b4", "b5"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () =>
            stripId(player({ id, tableNum: 2, seatNum: i + 2 })),
        })),
      ],
      (_ref, patch) => captured.push(patch),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it("rejects non-member at tx boundary", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1, groupId: "g1" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      applyBalancingOnce("t1", "u1", ["g-other"], seated, tables, 9),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });
});

// TG2: applyTableBreak の commit パス + race + markTableBroken が同一 tx 内で
// 走ることを保証する（H1 fix の検証も兼ねる）。
describe("applyBalancingOnce → applyTableBreak (TG2)", () => {
  function tableBreakFixture() {
    // 卓1: 1人, 卓2: 1人, 卓3: 2人 (合計 4) → (3-1)*9=18 ≥ 4 → break 可
    // 同数最少なら tableNum 最大優先で卓2 を閉鎖、b1 を survivors の最少卓 (1, 1人) seat 2 へ
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1 }),
      player({ id: "b1", tableNum: 2, seatNum: 1 }),
      player({ id: "c1", tableNum: 3, seatNum: 1 }),
      player({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts },
      { id: "3", tableNum: 3, isBroken: false, createdAt: ts },
    ];
    return { seated, tables };
  }

  it("commits all moves + markTableBroken in same transaction (H1 fix)", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // tx.get 順序:
    //   1) tournament
    //   2) 各 move 対象 player を再 read = [b1] (1 件)
    //   3) L2 fix: survivors 卓 (=t1) の既存プレイヤー = [a1] (1 件)
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "b1",
          data: () => stripId(player({ id: "b1", tableNum: 2, seatNum: 1 })),
        }),
        () => ({
          exists: () => true,
          id: "a1",
          data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 1 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(true);
    expect(result.break).toBe(true);
    expect(result.description).toContain("Table 2 を閉鎖");
    // 1 player update + 1 markTableBroken (isBroken: true) = 2 updates
    expect(captured).toHaveLength(2);
    const playerPatch = captured[0];
    const tablePatch = captured[1];
    expect(playerPatch.tableNum).toBe(1);
    expect(playerPatch.seatNum).toBe(2);
    expect(tablePatch.isBroken).toBe(true);
  });

  it("skips with seat-taken when survivor seat occupied at tx (L2 fix)", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: unknown[] = [];
    // L2: a1 が tx 内で seat 2 を取っている → b1 を t1 seat 2 へ動かせない → skip
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "b1",
          data: () => stripId(player({ id: "b1", tableNum: 2, seatNum: 1 })),
        }),
        // race: a1 が seat 1 から seat 2 に移った（lastMovedAt は省略）
        () => ({
          exists: () => true,
          id: "a1",
          data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 2 })),
        }),
      ],
      (_ref, patch) => captured.push(patch),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(false);
    expect(result.break).toBeUndefined();
    // L2 ガードで早期 return するため updates は 0 件
    expect(captured).toHaveLength(0);
  });

  it("skips when target player race-detected (moved)", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: unknown[] = [];
    // b1 が既に別席へ動いている
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "b1",
          data: () => stripId(player({ id: "b1", tableNum: 1, seatNum: 2 })),
        }),
      ],
      (_ref, patch) => captured.push(patch),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(false);
    expect(result.break).toBeUndefined();
    expect(captured).toHaveLength(0);
  });

  it("rejects non-member at tx boundary", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1, groupId: "g1" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      applyBalancingOnce("t1", "u1", ["g-other"], seated, tables, 9),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  it("skips with reason=busted when fresh player snapshot shows isBusted", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: unknown[] = [];
    // b1 が tx 内で isBusted=true を観測 → skipReason=busted で早期 return
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "b1",
          data: () =>
            stripId(
              player({
                id: "b1",
                tableNum: 2,
                seatNum: 1,
                isBusted: true,
                bustedAt: ts,
              }),
            ),
        }),
      ],
      (_ref, patch) => captured.push(patch),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it("skips with reason=missing when target player doc vanishes in tx", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({ exists: () => false }),
    ]);

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);

    expect(result.applied).toBe(false);
  });

  it("skips with reason=race when target player lastMovedAt differs in tx", async () => {
    const { seated, tables } = tableBreakFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const movedTs = Timestamp.fromMillis(999_000);
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "b1",
        data: () =>
          stripId(
            player({
              id: "b1",
              tableNum: 2,
              seatNum: 1,
              // 期待値は null（fixture に lastMovedAt 未設定）だが fresh 側は 999_000
              lastMovedAt: movedTs,
            }),
          ),
      }),
    ]);

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);
    expect(result.applied).toBe(false);
  });
});

describe("autoSeatLateEntry — additional skip reasons", () => {
  it("skips with reason=state when tournament is still in setup", async () => {
    const t = makeTournament({ state: "setup" });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("state");
  });

  it("skips with reason=missing when player doc does not exist in tx", async () => {
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({ exists: () => false }),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("missing");
  });

  it("skips with reason=busted when player is already busted", async () => {
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "new",
        data: () =>
          stripId(
            player({ id: "new", isBusted: true, bustedAt: ts }),
          ),
      }),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seated,
      [],
      9,
    );
    expect(result.applied).toBe(false);
    expect(result.reason).toBe("busted");
  });

  it("wraps unexpected tx errors with firestore/write_failed", async () => {
    vi.mocked(runTransaction).mockRejectedValueOnce(new Error("network"));
    const seated = [player({ id: "a", tableNum: 1, seatNum: 1 })];
    await expect(
      autoSeatLateEntry("t1", "u1", ["g1"], "new", null, seated, [], 9),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("applyBalancingOnce → applySingleMove — additional skip reasons", () => {
  function balancingFixture() {
    const seated = [
      ...Array.from({ length: 7 }, (_, i) =>
        player({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        player({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts },
    ];
    return { seated, tables };
  }

  it("skips with reason=missing when mover doc vanishes in tx", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({ exists: () => false }),
    ]);
    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);
    expect(result.applied).toBe(false);
  });

  it("skips with reason=busted when mover is busted at tx", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "a1",
        data: () =>
          stripId(
            player({
              id: "a1",
              tableNum: 1,
              seatNum: 1,
              isBusted: true,
              bustedAt: ts,
            }),
          ),
      }),
    ]);
    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);
    expect(result.applied).toBe(false);
  });

  it("skips with reason=race when mover lastMovedAt differs in tx", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const movedTs = Timestamp.fromMillis(555_000);
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "a1",
        data: () =>
          stripId(
            player({
              id: "a1",
              tableNum: 1,
              seatNum: 1,
              lastMovedAt: movedTs,
            }),
          ),
      }),
    ]);
    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);
    expect(result.applied).toBe(false);
  });
});

describe("commitInitialSeating — additional branches", () => {
  it("wraps invalid-seats-per-table errors from engine", async () => {
    const t = makeTournament({ state: "setup" });
    const players = [player({ id: "p1" })];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({ exists: () => true, id: "p1", data: () => stripId(players[0]) }),
    ]);
    // seatsPerTable=0 は engine 側で InvalidSeatsPerTableError を発火
    await expect(
      commitInitialSeating("t1", "u1", ["g1"], players, 1, 0),
    ).rejects.toMatchObject({ code: "seating/invalid-seats-per-table" });
  });

  it("throws firestore/not-found when tournament doc does not exist", async () => {
    mockTransaction([() => ({ exists: () => false })]);
    await expect(
      commitInitialSeating("t1", "u1", ["g1"], [], Date.now()),
    ).rejects.toMatchObject({ code: "firestore/not-found" });
  });

  it("skips busted players during tx.get re-read", async () => {
    const t = makeTournament({ state: "setup" });
    // p1 は busted 状態で tx が返す → 除外 → p2 のみ席割当
    const p1 = player({ id: "p1" });
    const p2 = player({ id: "p2" });
    const updateCalls: Array<Record<string, unknown>> = [];
    const setCalls: Array<Record<string, unknown>> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "p1",
          data: () =>
            stripId(player({ id: "p1", isBusted: true, bustedAt: ts })),
        }),
        () => ({ exists: () => true, id: "p2", data: () => stripId(p2) }),
      ],
      (_ref, patch) => updateCalls.push(patch as Record<string, unknown>),
      (_ref, patch) => setCalls.push(patch as Record<string, unknown>),
    );

    await commitInitialSeating("t1", "u1", ["g1"], [p1, p2], 42);

    // p2 だけ席割当 + 1 tournament state update = 2 updates, 1 tables.set
    expect(updateCalls).toHaveLength(2);
    expect(setCalls).toHaveLength(1);
  });

  it("skips tx.get returns missing (non-existing) players", async () => {
    const t = makeTournament({ state: "setup" });
    const p1 = player({ id: "p1" });
    const p2 = player({ id: "p2" });
    const updateCalls: Array<Record<string, unknown>> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({ exists: () => false }),
        () => ({ exists: () => true, id: "p2", data: () => stripId(p2) }),
      ],
      (_ref, patch) => updateCalls.push(patch as Record<string, unknown>),
    );

    await commitInitialSeating("t1", "u1", ["g1"], [p1, p2], 42);
    // p2 だけ割当 + tournament = 2 updates
    expect(updateCalls).toHaveLength(2);
  });
});

describe("bustPlayer / unbustPlayer wrappers", () => {
  it("bustPlayer delegates to players.bustPlayer", async () => {
    await bustPlayer("t1", "p1");
    expect(bustPlayerWrite).toHaveBeenCalledWith("t1", "p1");
  });

  it("unbustPlayer delegates to players.unbustPlayer", async () => {
    await unbustPlayer("t1", "p1");
    expect(unbustPlayerWrite).toHaveBeenCalledWith("t1", "p1");
  });

  it("bustPlayer propagates underlying errors", async () => {
    vi.mocked(bustPlayerWrite).mockRejectedValueOnce(new Error("network"));
    await expect(bustPlayer("t1", "p1")).rejects.toThrow("network");
  });
});
