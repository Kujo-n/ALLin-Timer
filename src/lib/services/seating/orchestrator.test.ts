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
  applyManualBalancingMove,
  applyManualSeatChange,
  applyManualSeatUndo,
  applyManualTableClose,
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
    isPlayingDealer: p.isPlayingDealer ?? false,
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
        // Phase C: group doc read（defaultTableLabels 引込）。空配列で fallback。
        () => ({ exists: () => true, id: "g1", data: () => ({ defaultTableLabels: [] }) }),
        // Phase C: 既存 tables/{1} doc read（新規 commit のため非存在）。
        () => ({ exists: () => false }),
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
    expect(setCalls[0].patch).toMatchObject({
      tableNum: 1,
      isBroken: false,
      label: null,
      color: null,
    });
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

  it("commits seat when all guards pass (Phase 5.1: seat is random in [2..9])", async () => {
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
    // Phase 5.1: planLateEntrySeat は空席 [2..9] からランダム選択。具体的な seat は seed 依存。
    expect(typeof patch.seatNum).toBe("number");
    expect(patch.seatNum as number).toBeGreaterThanOrEqual(2);
    expect(patch.seatNum as number).toBeLessThanOrEqual(9);
  });

  it("skips with reason=seat-taken when target seat is occupied at tx (H2 fix)", async () => {
    // Phase 5.1: 卓 1 に 8 人 (seat 1, 3..9) 配席 → 空席 = {2} のみ → plan は必ず seat 2。
    // tx 内で別 player (a) が seat 2 を取っていれば race を検出する（deterministic）。
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const seatedFull = [
      player({ id: "a", tableNum: 1, seatNum: 1 }),
      player({ id: "c", tableNum: 1, seatNum: 3 }),
      player({ id: "d", tableNum: 1, seatNum: 4 }),
      player({ id: "e", tableNum: 1, seatNum: 5 }),
      player({ id: "f", tableNum: 1, seatNum: 6 }),
      player({ id: "g", tableNum: 1, seatNum: 7 }),
      player({ id: "h", tableNum: 1, seatNum: 8 }),
      player({ id: "i", tableNum: 1, seatNum: 9 }),
    ];
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
      () => ({
        exists: () => true,
        id: "new",
        data: () => stripId(player({ id: "new", lastMovedAt: null })),
      }),
      // 再 read: "a" が seat 1 → 2 へ動いた race 結果（seat 2 を別 player が占有）。
      () => ({
        exists: () => true,
        id: "a",
        data: () => stripId(player({ id: "a", tableNum: 1, seatNum: 2 })),
      }),
      ...["c", "d", "e", "f", "g", "h", "i"].map((id, idx) => () => ({
        exists: () => true,
        id,
        data: () => stripId(player({ id, tableNum: 1, seatNum: idx + 3 })),
      })),
    ]);
    const result = await autoSeatLateEntry(
      "t1",
      "u1",
      ["g1"],
      "new",
      null,
      seatedFull,
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
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
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
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
    ];
    return { seated, tables };
  }

  it("commits move with race-guarded seat re-verification (happy path)", async () => {
    const { seated, tables } = balancingFixture();
    // engine: maxTable=1 → 移動対象は a1 (seatNum=1 最小)、移動先は卓2 seat 6
    // tx.get 順序:
    //   1) tournament
    //   2) a1 (mover)
    //   3) 移動先卓 (=2) の既存メンバー [b1..b5] (seat-taken & destActive 集計)
    //   4) Phase 5.x: 移動元卓 (=1) の既存メンバー [a2..a7] (sourceActive 集計)
    // 計 1 + 1 + 5 + 6 = 13 reads
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
        ...["a2", "a3", "a4", "a5", "a6", "a7"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () =>
            stripId(player({ id, tableNum: 1, seatNum: i + 2 })),
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
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "3", tableNum: 3, isBroken: false, createdAt: ts, label: null, color: null },
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

// Phase 3 (07): applyManualTableClose は engine.planManualTableClose で plan を作り
// 既存 applyTableBreak を再利用する。overflow / only-one-table は engine が早期に弾くため
// tx 未発行で throw する（= rule deny でトーナメントを止めない）ことを assert する。
describe("applyManualTableClose (Phase 3)", () => {
  function tables3() {
    return [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "3", tableNum: 3, isBroken: false, createdAt: ts, label: null, color: null },
    ];
  }

  it("commits move + isBroken in same tx (target=2, running)", async () => {
    // 卓1:1(a1), 卓2:1(b1), 卓3:2(c1,c2)、target=2 → b1 を卓1 seat2 へ、卓2 を閉鎖。
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1 }),
      player({ id: "b1", tableNum: 2, seatNum: 1 }),
      player({ id: "c1", tableNum: 3, seatNum: 1 }),
      player({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const tables = tables3();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // tx.get 順: 1) tournament, 2) move 対象 b1, 3) survivors 卓1 の既存 a1
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

    const result = await applyManualTableClose("t1", "u1", ["g1"], 2, seated, tables);

    expect(result.applied).toBe(true);
    expect(result.break).toBe(true);
    expect(result.description).toContain("Table 2 を閉鎖");
    // 1 player update + 1 markTableBroken = 2 updates
    expect(captured).toHaveLength(2);
    const playerPatch = captured[0];
    expect(playerPatch.tableNum).toBe(1);
    expect(playerPatch.seatNum).toBe(2);
    // 移動 player は PD reset される（applyTableBreak の挙動を継承）。
    expect(playerPatch.isPlayingDealer).toBe(false);
    expect(captured[captured.length - 1].isBroken).toBe(true);
  });

  it("throws table-close-overflow without issuing tx", async () => {
    // 卓1:10, 卓2:10, 卓3:2、target=3 → capacity=20 < needed=22 → overflow。
    const seated = [
      ...Array.from({ length: 10 }, (_, i) =>
        player({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        player({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
      player({ id: "c1", tableNum: 3, seatNum: 1 }),
      player({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    await expect(
      applyManualTableClose("t1", "u1", ["g1"], 3, seated, tables3()),
    ).rejects.toMatchObject({ code: "seating/table-close-overflow" });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("throws table-close-last without issuing tx", async () => {
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1 }),
      player({ id: "a2", tableNum: 1, seatNum: 2 }),
      player({ id: "a3", tableNum: 1, seatNum: 3 }),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
    ];
    await expect(
      applyManualTableClose("t1", "u1", ["g1"], 1, seated, tables),
    ).rejects.toMatchObject({ code: "seating/table-close-last" });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("returns applied=false (no tx) for already-broken target (not-found)", async () => {
    // 卓3 は既に isBroken。target=3 → not-found → 静かに applied=false。
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1 }),
      player({ id: "b1", tableNum: 2, seatNum: 1 }),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "3", tableNum: 3, isBroken: true, createdAt: ts, label: null, color: null },
    ];
    const result = await applyManualTableClose("t1", "u1", ["g1"], 3, seated, tables);
    expect(result.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("rejects non-member at tx boundary", async () => {
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1 }),
      player({ id: "b1", tableNum: 2, seatNum: 1 }),
      player({ id: "c1", tableNum: 3, seatNum: 1 }),
      player({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const t = makeTournament({ state: "running", currentLevel: 1, groupId: "g1" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      applyManualTableClose("t1", "u1", ["g-other"], 2, seated, tables3()),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
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
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
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

  // Phase 5.x: snapshot 取得後・tx commit 前に source 卓で他 player のバストが
  // commit されると diff < 2 となり move が逆効果になる。tx 内 source/dest 再カウントで
  // diff-resolved を検出して skip することを確認。
  it("skips with reason=diff-resolved when another source player busted between snapshot and tx", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // source 卓 (=1) の a2 が tx 時点で busted となり active count が変わる
    //   source: 1 (a1 mover) + a3..a7 = 6（a2 が busted）
    //   dest: b1..b5 = 5
    //   diff = 6 - 5 = 1 < 2 → diff-resolved
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        // mover a1 — まだ source 卓席 1 に居て非 busted
        () => ({
          exists: () => true,
          id: "a1",
          data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 1 })),
        }),
        // dest 卓 b1..b5 — seat 6 は空（destActive=5）
        ...["b1", "b2", "b3", "b4", "b5"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () =>
            stripId(player({ id, tableNum: 2, seatNum: i + 1 })),
        })),
        // source 卓 (mover 除外) — a2 だけ busted、他 active
        () => ({
          exists: () => true,
          id: "a2",
          data: () =>
            stripId(
              player({
                id: "a2",
                tableNum: 1,
                seatNum: 2,
                isBusted: true,
                bustedAt: ts,
              }),
            ),
        }),
        ...["a3", "a4", "a5", "a6", "a7"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () => stripId(player({ id, tableNum: 1, seatNum: i + 3 })),
        })),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyBalancingOnce("t1", "u1", ["g1"], seated, tables, 9);
    expect(result.applied).toBe(false);
    expect(captured).toHaveLength(0);
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
        // Phase C: group + 1 既存 table read
        () => ({ exists: () => true, id: "g1", data: () => ({ defaultTableLabels: [] }) }),
        () => ({ exists: () => false }),
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
        // Phase C: group + 1 既存 table read
        () => ({ exists: () => true, id: "g1", data: () => ({ defaultTableLabels: [] }) }),
        () => ({ exists: () => false }),
      ],
      (_ref, patch) => updateCalls.push(patch as Record<string, unknown>),
    );

    await commitInitialSeating("t1", "u1", ["g1"], [p1, p2], 42);
    // p2 だけ割当 + tournament = 2 updates
    expect(updateCalls).toHaveLength(2);
  });

  it("auto-fills default table labels by index for new tables", async () => {
    const t = makeTournament({ state: "setup", seatsPerTable: 1 });
    // 3 players × 1 seat → 3 tables
    const players = [
      player({ id: "p1" }),
      player({ id: "p2" }),
      player({ id: "p3" }),
    ];
    const setCalls: Array<{ patch: Record<string, unknown> }> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        ...players.map((p) => () => ({
          exists: () => true,
          id: p.id,
          data: () => stripId(p),
        })),
        // Phase C: group doc に defaultTableLabels=['赤卓','青卓']（3 件目は不足）
        () => ({
          exists: () => true,
          id: "g1",
          data: () => ({ defaultTableLabels: ["赤卓", "青卓"] }),
        }),
        // 3 既存 table reads（全て non-existing → tx.set で create）
        () => ({ exists: () => false }),
        () => ({ exists: () => false }),
        () => ({ exists: () => false }),
      ],
      undefined,
      (_ref, patch) => setCalls.push({ patch: patch as Record<string, unknown> }),
    );

    await commitInitialSeating("t1", "u1", ["g1"], players, 42, 1);

    expect(setCalls).toHaveLength(3);
    expect(setCalls[0].patch).toMatchObject({ tableNum: 1, label: "赤卓" });
    expect(setCalls[1].patch).toMatchObject({ tableNum: 2, label: "青卓" });
    // 3 番目は defaultLabels から index 不足 → null
    expect(setCalls[2].patch).toMatchObject({ tableNum: 3, label: null });
  });

  it("preserves existing manual table label on re-commit", async () => {
    const t = makeTournament({ state: "seating" });
    const players = [player({ id: "p1" }), player({ id: "p2" })];
    const updateCalls: Array<{ patch: Record<string, unknown> }> = [];
    const setCalls: Array<{ patch: Record<string, unknown> }> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        ...players.map((p) => () => ({
          exists: () => true,
          id: p.id,
          data: () => stripId(p),
        })),
        () => ({
          exists: () => true,
          id: "g1",
          data: () => ({ defaultTableLabels: ["赤卓"] }),
        }),
        // 既存 table 1: 手動 edit 済みで label='緑卓' → 維持されるべき
        () => ({
          exists: () => true,
          id: "1",
          data: () => ({ label: "緑卓", color: null }),
        }),
      ],
      (_ref, patch) => updateCalls.push({ patch: patch as Record<string, unknown> }),
      (_ref, patch) => setCalls.push({ patch: patch as Record<string, unknown> }),
    );

    await commitInitialSeating("t1", "u1", ["g1"], players, 42);

    // 既存 label が non-null なので tx.update / tx.set のいずれも label を上書きしない
    const tableUpdates = updateCalls.filter((c) => "label" in c.patch);
    expect(tableUpdates).toHaveLength(0);
    expect(setCalls).toHaveLength(0);
  });

  it("backfills label on existing table when label is null and default is provided", async () => {
    const t = makeTournament({ state: "seating" });
    const players = [player({ id: "p1" }), player({ id: "p2" })];
    const updateCalls: Array<{ patch: Record<string, unknown> }> = [];
    const setCalls: Array<{ patch: Record<string, unknown> }> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        ...players.map((p) => () => ({
          exists: () => true,
          id: p.id,
          data: () => stripId(p),
        })),
        () => ({
          exists: () => true,
          id: "g1",
          data: () => ({ defaultTableLabels: ["赤卓"] }),
        }),
        // 既存 table 1: label=null（旧 doc / 未設定）→ 補完される
        () => ({
          exists: () => true,
          id: "1",
          data: () => ({ label: null, color: null }),
        }),
      ],
      (_ref, patch) => updateCalls.push({ patch: patch as Record<string, unknown> }),
      (_ref, patch) => setCalls.push({ patch: patch as Record<string, unknown> }),
    );

    await commitInitialSeating("t1", "u1", ["g1"], players, 42);

    const labelUpdates = updateCalls.filter((c) => "label" in c.patch);
    expect(labelUpdates).toHaveLength(1);
    expect(labelUpdates[0].patch).toMatchObject({ label: "赤卓" });
  });
});

describe("bustPlayer / unbustPlayer wrappers", () => {
  it("bustPlayer delegates to players.bustPlayer with default empty same-table list", async () => {
    await bustPlayer("t1", "p1");
    expect(bustPlayerWrite).toHaveBeenCalledWith("t1", "p1", []);
  });

  it("bustPlayer forwards same-table player IDs (Phase 5.1)", async () => {
    await bustPlayer("t1", "p1", ["p2", "p3"]);
    expect(bustPlayerWrite).toHaveBeenCalledWith("t1", "p1", ["p2", "p3"]);
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

// Phase 5.x: TDA 準拠の運営者選択バランシング。diagnose を呼んで source/dest を
// 算出し、運営者が選んだ player を applySingleMove と同じ tx 経路で commit する。
describe("applyManualBalancingMove", () => {
  function balancingFixture() {
    // 卓1: 7人（席 1 が PD）, 卓2: 5人 → 差 2 → diag.source=1 / dest=2 / dest_seat=6
    // candidates: a2..a7（PD の a1 は除外、seatNum 昇順）
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      ...Array.from({ length: 6 }, (_, i) =>
        player({ id: `a${i + 2}`, tableNum: 1, seatNum: i + 2 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        player({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
    ];
    return { seated, tables };
  }

  it("applied=false when balancing not needed (no diag)", async () => {
    const seated = [
      ...Array.from({ length: 6 }, (_, i) =>
        player({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        player({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const tables = [
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
      { id: "2", tableNum: 2, isBroken: false, createdAt: ts, label: null, color: null },
    ];
    const result = await applyManualBalancingMove(
      "t1",
      "u1",
      ["g1"],
      "a1",
      seated,
      tables,
      9,
    );
    expect(result.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("throws seating/manual-pd-not-movable when operator picks a PD player", async () => {
    const { seated, tables } = balancingFixture();
    await expect(
      applyManualBalancingMove("t1", "u1", ["g1"], "a1", seated, tables, 9),
    ).rejects.toMatchObject({ code: "seating/manual-pd-not-movable" });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("applied=false when operator picks a player on the wrong table", async () => {
    const { seated, tables } = balancingFixture();
    // b1 は dest 卓 (=卓 2) のため source 卓ではない → 早期 reject
    const result = await applyManualBalancingMove(
      "t1",
      "u1",
      ["g1"],
      "b1",
      seated,
      tables,
      9,
    );
    expect(result.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("applied=false when player not found / busted / no seat", async () => {
    const { seated, tables } = balancingFixture();
    // unknown id
    const r1 = await applyManualBalancingMove(
      "t1",
      "u1",
      ["g1"],
      "ghost",
      seated,
      tables,
      9,
    );
    expect(r1.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("commits move with operator-picked non-PD player (a4 → 卓2 seat 6)", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // tx.get 順序:
    //   1) tournament
    //   2) a4 (mover)
    //   3) 移動先卓 (=2) の既存 [b1..b5]
    //   4) Phase 5.x: 移動元卓 (=1) の既存 (mover 除外) [a1, a2, a3, a5, a6, a7]
    // 計 1 + 1 + 5 + 6 = 13 reads
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a4",
          data: () => stripId(player({ id: "a4", tableNum: 1, seatNum: 4 })),
        }),
        ...["b1", "b2", "b3", "b4", "b5"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () =>
            stripId(player({ id, tableNum: 2, seatNum: i + 1 })),
        })),
        // a1 は PD だが active なので source カウントには 1 として算入される
        () => ({
          exists: () => true,
          id: "a1",
          data: () =>
            stripId(player({ id: "a1", tableNum: 1, seatNum: 1, isPlayingDealer: true })),
        }),
        ...["a2", "a3"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () => stripId(player({ id, tableNum: 1, seatNum: i + 2 })),
        })),
        ...["a5", "a6", "a7"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () => stripId(player({ id, tableNum: 1, seatNum: i + 5 })),
        })),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualBalancingMove(
      "t1",
      "u1",
      ["g1"],
      "a4",
      seated,
      tables,
      9,
    );
    expect(result.applied).toBe(true);
    expect(result.description).toBe("Table 1 / 席 4 → Table 2 / 席 6");
    expect(captured).toHaveLength(1);
    expect(captured[0].tableNum).toBe(2);
    expect(captured[0].seatNum).toBe(6);
  });

  it("rejects non-member at tx boundary", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1, groupId: "g1" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      applyManualBalancingMove(
        "t1",
        "u1",
        ["g-other"],
        "a4",
        seated,
        tables,
        9,
      ),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  // Phase 5.x: ユーザーがクリックする寸前に source 卓の別 player がバスト → snapshot
  // 反映前の click 経路。tx 内 source/dest 再カウントで diff-resolved を検出して skip。
  it("skips with diff-resolved when another source player busted between click and tx", async () => {
    const { seated, tables } = balancingFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // mover a4 を運営者がクリック。tx 内では a3 が busted となり source active=6, dest=5 → diff=1
    // mover 除外 source = [a1(PD), a2, a3, a5, a6, a7]
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a4",
          data: () => stripId(player({ id: "a4", tableNum: 1, seatNum: 4 })),
        }),
        // dest 卓 b1..b5 (destActive=5、seat 6 は空)
        ...["b1", "b2", "b3", "b4", "b5"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () =>
            stripId(player({ id, tableNum: 2, seatNum: i + 1 })),
        })),
        // source 卓 (mover 除外) — a1 PD active, a2 active, a3 busted, a5/a6/a7 active
        () => ({
          exists: () => true,
          id: "a1",
          data: () =>
            stripId(player({ id: "a1", tableNum: 1, seatNum: 1, isPlayingDealer: true })),
        }),
        () => ({
          exists: () => true,
          id: "a2",
          data: () => stripId(player({ id: "a2", tableNum: 1, seatNum: 2 })),
        }),
        () => ({
          exists: () => true,
          id: "a3",
          data: () =>
            stripId(
              player({
                id: "a3",
                tableNum: 1,
                seatNum: 3,
                isBusted: true,
                bustedAt: ts,
              }),
            ),
        }),
        ...["a5", "a6", "a7"].map((id, i) => () => ({
          exists: () => true,
          id,
          data: () => stripId(player({ id, tableNum: 1, seatNum: i + 5 })),
        })),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualBalancingMove(
      "t1",
      "u1",
      ["g1"],
      "a4",
      seated,
      tables,
      9,
    );
    expect(result.applied).toBe(false);
    expect(captured).toHaveLength(0);
  });
});

// Phase 5.x: 運営者の D&D 手動席移動。balancing 由来でない自由移動のため
// diff-resolved guard は通らず（verifyBalancingDiff=false）、source 側 re-read も発生しない。
describe("applyManualSeatChange", () => {
  function fixture() {
    // 卓 1: 3 人 (a1=PD, a2, a3), 卓 2: 2 人 (b1, b2)
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      player({ id: "a2", tableNum: 1, seatNum: 2 }),
      player({ id: "a3", tableNum: 1, seatNum: 3 }),
      player({ id: "b1", tableNum: 2, seatNum: 1 }),
      player({ id: "b2", tableNum: 2, seatNum: 2 }),
    ];
    return { seated };
  }

  it("throws seating/manual-pd-not-movable when target player is PD", async () => {
    const { seated } = fixture();
    await expect(
      applyManualSeatChange(
        "t1",
        "u1",
        ["g1"],
        "a1",
        { tableNum: 2, seatNum: 5 },
        seated,
      ),
    ).rejects.toMatchObject({ code: "seating/manual-pd-not-movable" });
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("applied=false when player is unknown", async () => {
    const { seated } = fixture();
    const r = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "ghost",
      { tableNum: 1, seatNum: 4 },
      seated,
    );
    expect(r.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("no-op when from === to (same seat drop)", async () => {
    const { seated } = fixture();
    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a2",
      { tableNum: 1, seatNum: 2 },
      seated,
    );
    expect(result.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("commits same-table move (a2: 1-2 → 1-5) without diff-resolved skip", async () => {
    // verifyBalancingDiff=false のため、source 側 re-read が走らずに commit される。
    // tx.get 順序: tournament → a2 (mover) → 同卓 dest existing [a1, a3]
    const { seated } = fixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a2",
          data: () => stripId(player({ id: "a2", tableNum: 1, seatNum: 2 })),
        }),
        () => ({
          exists: () => true,
          id: "a1",
          data: () =>
            stripId(
              player({ id: "a1", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
            ),
        }),
        () => ({
          exists: () => true,
          id: "a3",
          data: () => stripId(player({ id: "a3", tableNum: 1, seatNum: 3 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a2",
      { tableNum: 1, seatNum: 5 },
      seated,
    );
    expect(result.applied).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].tableNum).toBe(1);
    expect(captured[0].seatNum).toBe(5);
  });

  it("commits cross-table move (a2: 1-2 → 2-5) without diff-resolved skip", async () => {
    // 卓 1 → 卓 2 の手動移動。差は 3 vs 2 = 1 で diff-resolved guard では skip 対象だが、
    // verifyBalancingDiff=false で commit される。
    const { seated } = fixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a2",
          data: () => stripId(player({ id: "a2", tableNum: 1, seatNum: 2 })),
        }),
        () => ({
          exists: () => true,
          id: "b1",
          data: () => stripId(player({ id: "b1", tableNum: 2, seatNum: 1 })),
        }),
        () => ({
          exists: () => true,
          id: "b2",
          data: () => stripId(player({ id: "b2", tableNum: 2, seatNum: 2 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a2",
      { tableNum: 2, seatNum: 5 },
      seated,
    );
    expect(result.applied).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].tableNum).toBe(2);
    expect(captured[0].seatNum).toBe(5);
  });

  it("skips with seat-taken when destination seat occupied at tx (race)", async () => {
    const { seated } = fixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // a2 を 卓 2 / 席 1 (b1 が居る) へ drop。tx 内 b1 が占有 → seat-taken。
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a2",
          data: () => stripId(player({ id: "a2", tableNum: 1, seatNum: 2 })),
        }),
        () => ({
          exists: () => true,
          id: "b1",
          data: () => stripId(player({ id: "b1", tableNum: 2, seatNum: 1 })),
        }),
        () => ({
          exists: () => true,
          id: "b2",
          data: () => stripId(player({ id: "b2", tableNum: 2, seatNum: 2 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a2",
      { tableNum: 2, seatNum: 1 },
      seated,
    );
    expect(result.applied).toBe(false);
    expect(captured).toHaveLength(0);
  });

  it("rejects non-member at tx boundary", async () => {
    const { seated } = fixture();
    const t = makeTournament({ state: "running", currentLevel: 1, groupId: "g1" });
    mockTransaction([
      () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
    ]);
    await expect(
      applyManualSeatChange(
        "t1",
        "u1",
        ["g-other"],
        "a2",
        { tableNum: 2, seatNum: 5 },
        seated,
      ),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });
});

// Phase 5.x: 同卓 D&D で drop 先が占有席だった場合の cascade 適用。
// engine.planManualSeatCascade の結果を受けて applyCascadeMoves 経由で N 件 atomic commit。
describe("applyManualSeatChange — same-table cascade", () => {
  function cascadeFixture() {
    // 卓 1: 1, 2, 3, 5, 6 占有 / 4 空。dragged=a5 → target seat 2 で cascade を狙う。
    // expected cascade: a2 (席2→3), a3 (席3→4), a5 (席5→2)
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1 }),
      player({ id: "a2", tableNum: 1, seatNum: 2 }),
      player({ id: "a3", tableNum: 1, seatNum: 3 }),
      player({ id: "a5", tableNum: 1, seatNum: 5 }),
      player({ id: "a6", tableNum: 1, seatNum: 6 }),
    ];
    return { seated };
  }

  it("commits 3-move cascade atomically (a5 → seat 2 with shift)", async () => {
    const { seated } = cascadeFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // tx.get 順序:
    //   1) tournament
    //   2) cascade 各 player re-read [a2, a3, a5]（順序: planManualSeatCascade の moves 順）
    //   3) newly-occupied seat の他 player 占有検証 [a1, a6]
    // 計 1 + 3 + 2 = 6 reads
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a2",
          data: () => stripId(player({ id: "a2", tableNum: 1, seatNum: 2 })),
        }),
        () => ({
          exists: () => true,
          id: "a3",
          data: () => stripId(player({ id: "a3", tableNum: 1, seatNum: 3 })),
        }),
        () => ({
          exists: () => true,
          id: "a5",
          data: () => stripId(player({ id: "a5", tableNum: 1, seatNum: 5 })),
        }),
        () => ({
          exists: () => true,
          id: "a1",
          data: () => stripId(player({ id: "a1", tableNum: 1, seatNum: 1 })),
        }),
        () => ({
          exists: () => true,
          id: "a6",
          data: () => stripId(player({ id: "a6", tableNum: 1, seatNum: 6 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a5",
      { tableNum: 1, seatNum: 2 },
      seated,
    );
    expect(result.applied).toBe(true);
    expect(result.moves).toHaveLength(3);
    expect(captured).toHaveLength(3);
    // captured 順: a2→3, a3→4, a5→2
    expect(captured[0]).toMatchObject({ tableNum: 1, seatNum: 3 });
    expect(captured[1]).toMatchObject({ tableNum: 1, seatNum: 4 });
    expect(captured[2]).toMatchObject({ tableNum: 1, seatNum: 2 });
  });

  it("rejects when PD is in cascade range (engine returns null)", async () => {
    // 卓 1: a1(PD), a2, a3, a4 全部占有。a4 → seat 1 だと cascade 経路に PD がいる
    const seated = [
      player({ id: "a1", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      player({ id: "a2", tableNum: 1, seatNum: 2 }),
      player({ id: "a3", tableNum: 1, seatNum: 3 }),
      player({ id: "a4", tableNum: 1, seatNum: 4 }),
    ];
    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a4",
      { tableNum: 1, seatNum: 1 },
      seated,
    );
    expect(result.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("skips with race when one cascade player has lastMovedAt mismatch at tx", async () => {
    const { seated } = cascadeFixture();
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const movedTs = Timestamp.fromMillis(999_000);
    const captured: Array<Record<string, unknown>> = [];
    // applyCascadeMoves は cascade reads を Promise.all で同時 dispatch するため、
    // race を 1 件混ぜても全件 read が完了する。最後の guard チェックで race detect。
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a2",
          data: () => stripId(player({ id: "a2", tableNum: 1, seatNum: 2 })),
        }),
        () => ({
          exists: () => true,
          id: "a3",
          data: () =>
            stripId(
              player({ id: "a3", tableNum: 1, seatNum: 3, lastMovedAt: movedTs }),
            ),
        }),
        () => ({
          exists: () => true,
          id: "a5",
          data: () => stripId(player({ id: "a5", tableNum: 1, seatNum: 5 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualSeatChange(
      "t1",
      "u1",
      ["g1"],
      "a5",
      { tableNum: 1, seatNum: 2 },
      seated,
    );
    expect(result.applied).toBe(false);
    expect(captured).toHaveLength(0);
  });
});

// Phase 5.x: 直前の手動席移動を reverse 適用して元に戻す。
describe("applyManualSeatUndo", () => {
  it("applied=false on empty move list", async () => {
    const result = await applyManualSeatUndo("t1", "u1", ["g1"], [], []);
    expect(result.applied).toBe(false);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("reverses single-move via applySingleMove path", async () => {
    // 元 move: a (1-2) → (2-5)。undo で a を 2-5 → 1-2 に戻す。
    const seated = [player({ id: "a", tableNum: 2, seatNum: 5 })];
    const t = makeTournament({ state: "running", currentLevel: 1 });
    const captured: Array<Record<string, unknown>> = [];
    // applySingleMove 経路: tournament → mover → dest卓 existing(なし、卓1 空)
    mockTransaction(
      [
        () => ({ exists: () => true, id: t.id, data: () => stripId(t) }),
        () => ({
          exists: () => true,
          id: "a",
          data: () => stripId(player({ id: "a", tableNum: 2, seatNum: 5 })),
        }),
      ],
      (_ref, patch) => captured.push(patch as Record<string, unknown>),
    );

    const result = await applyManualSeatUndo(
      "t1",
      "u1",
      ["g1"],
      [
        {
          playerId: "a",
          from: { tableNum: 1, seatNum: 2 },
          to: { tableNum: 2, seatNum: 5 },
        },
      ],
      seated,
    );
    expect(result.applied).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0]).toMatchObject({ tableNum: 1, seatNum: 2 });
  });
});

