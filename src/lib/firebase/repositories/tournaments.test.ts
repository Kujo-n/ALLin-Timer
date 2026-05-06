import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

// firebase/firestore は実物の Timestamp を残しつつ、SDK 呼び出しだけ差し替える。
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
    where: vi.fn((...args) => ({ __ref: "where", args })),
    addDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    onSnapshot: vi.fn(),
    runTransaction: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
    writeBatch: vi.fn(),
    increment: vi.fn((n: number) => ({ __op: "increment", n })),
  };
});

// converters は zodConverter を呼ぶだけなので noop で十分。
vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import {
  addDoc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";

import {
  advanceLevel,
  appendLevel,
  beginSeating,
  confirmSeating,
  createTournament,
  deleteTournament,
  finishTournament,
  getTournament,
  listTournamentsByGroup,
  pauseTournament,
  resumeTournament,
  revertLevel,
  setLevelDurationSec,
  subscribeTournament,
  subscribeTournamentsByGroup,
  updateTournament,
} from "./tournaments";

const baseCreatedAt = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const t0 = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

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
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: t0,
    levelStartedAt: t0,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
    ...overrides,
  };
}

function mockGetTournament(t: TournamentDoc | null) {
  vi.mocked(getDoc).mockResolvedValueOnce({
    exists: () => t !== null,
    id: t?.id ?? "missing",
    data: () => (t ? stripId(t) : undefined),
  } as never);
}

function stripId(t: TournamentDoc): Omit<TournamentDoc, "id"> {
  const { id: _id, ...rest } = t;
  void _id;
  return rest;
}

beforeEach(() => {
  vi.mocked(addDoc).mockReset();
  vi.mocked(getDoc).mockReset();
  vi.mocked(getDocs).mockReset();
  vi.mocked(updateDoc).mockReset().mockResolvedValue(undefined);
  vi.mocked(onSnapshot).mockReset();
  vi.mocked(runTransaction).mockReset();
  vi.mocked(serverTimestamp).mockReturnValue({ __op: "serverTimestamp" } as never);
  vi.mocked(writeBatch).mockReset();
  vi.mocked(increment).mockReset().mockImplementation(((n: number) => ({ __op: "increment", n })) as never);
});

describe("createTournament", () => {
  const input = {
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
    seatsPerTable: 9,
  };

  it("calls addDoc with timer fields initialized and returns id", async () => {
    vi.mocked(addDoc).mockResolvedValue({ id: "t-new" } as never);

    const id = await createTournament(input);

    expect(id).toBe("t-new");
    const payload = vi.mocked(addDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("setup");
    expect(payload.levelStartedAt).toBeNull();
    expect(payload.pausedAt).toBeNull();
    expect(payload.pausedAccumMs).toBe(0);
    expect(payload.finishedAt).toBeNull();
    expect(payload.currentLevel).toBe(0);
    expect(payload.seatsPerTable).toBe(9);
  });

  it("wraps addDoc errors with firestore/write_failed", async () => {
    vi.mocked(addDoc).mockRejectedValue(new Error("perm"));
    await expect(createTournament(input)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("getTournament", () => {
  it("returns doc with id when exists", async () => {
    mockGetTournament(makeTournament({ state: "setup", currentLevel: 0 }));
    const result = await getTournament("t1");
    expect(result.id).toBe("t1");
    expect(result.state).toBe("setup");
  });

  it("throws firestore/not-found when missing", async () => {
    mockGetTournament(null);
    await expect(getTournament("missing")).rejects.toMatchObject({
      code: "firestore/not-found",
    });
  });

  it("wraps generic errors as firestore/read_failed", async () => {
    vi.mocked(getDoc).mockRejectedValueOnce(new Error("network"));
    await expect(getTournament("t1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });
});

describe("listTournamentsByGroup", () => {
  it("sorts by createdAt descending", async () => {
    const newer = Timestamp.fromMillis(t0.toMillis() + 10_000);
    const t1 = makeTournament({ id: "old", createdAt: t0 });
    const t2 = makeTournament({ id: "new", createdAt: newer });
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        { id: t1.id, data: () => stripId(t1) },
        { id: t2.id, data: () => stripId(t2) },
      ],
    } as never);

    const list = await listTournamentsByGroup("g1");

    expect(list.map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("wraps errors as firestore/read_failed", async () => {
    vi.mocked(getDocs).mockRejectedValue(new Error("perm"));
    await expect(listTournamentsByGroup("g1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });
});

describe("updateTournament", () => {
  it("calls updateDoc with patch and serverTimestamp", async () => {
    await updateTournament("t1", { name: "Renamed" });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.name).toBe("Renamed");
    expect(payload.updatedAt).toEqual({ __op: "serverTimestamp" });
  });

  it("wraps errors", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(updateTournament("t1", { name: "X" })).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("beginSeating", () => {
  it("rejects non-member", async () => {
    mockGetTournament(makeTournament({ state: "setup" }));
    await expect(beginSeating("t1", "u1", ["g-other"])).rejects.toMatchObject({
      code: "firestore/permission-denied",
    });
  });

  it("rejects when state is not setup", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    await expect(beginSeating("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("transitions setup → seating", async () => {
    mockGetTournament(makeTournament({ state: "setup" }));
    await beginSeating("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("seating");
  });

  it("wraps updateDoc errors", async () => {
    mockGetTournament(makeTournament({ state: "setup" }));
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(beginSeating("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("confirmSeating", () => {
  it("rejects non-member", async () => {
    mockGetTournament(makeTournament({ state: "seating" }));
    await expect(confirmSeating("t1", "u1", ["g-other"])).rejects.toMatchObject({
      code: "firestore/permission-denied",
    });
  });

  it("rejects when state is not seating", async () => {
    mockGetTournament(makeTournament({ state: "setup" }));
    await expect(confirmSeating("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("transitions seating → running with timer fields initialized", async () => {
    mockGetTournament(makeTournament({ state: "seating", currentLevel: 0 }));
    await confirmSeating("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("running");
    expect(payload.currentLevel).toBe(1);
    expect(payload.pausedAt).toBeNull();
    expect(payload.pausedAccumMs).toBe(0);
    expect(payload.finishedAt).toBeNull();
  });

  it("wraps updateDoc errors", async () => {
    mockGetTournament(makeTournament({ state: "seating" }));
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(confirmSeating("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("pauseTournament", () => {
  it("rejects when state is not running", async () => {
    mockGetTournament(makeTournament({ state: "paused" }));
    await expect(pauseTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("rejects non-member", async () => {
    mockGetTournament(makeTournament());
    await expect(pauseTournament("t1", "u1", [])).rejects.toMatchObject({
      code: "firestore/permission-denied",
    });
  });

  it("writes paused state with serverTimestamp pausedAt", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    await pauseTournament("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("paused");
    expect(payload.pausedAt).toEqual({ __op: "serverTimestamp" });
  });

  it("wraps updateDoc errors", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(pauseTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("resumeTournament", () => {
  it("rejects when state is not paused", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    await expect(resumeTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("rejects when pausedAt is missing", async () => {
    mockGetTournament(makeTournament({ state: "paused", pausedAt: null }));
    await expect(resumeTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("computes pausedFor and writes accumulator", async () => {
    const pausedAtMs = Date.now() - 5_000;
    mockGetTournament(
      makeTournament({
        state: "paused",
        pausedAt: Timestamp.fromMillis(pausedAtMs),
        pausedAccumMs: 1_000,
      }),
    );

    await resumeTournament("t1", "u1", ["g1"]);

    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.state).toBe("running");
    expect(payload.pausedAt).toBeNull();
    expect(payload.pausedAccumMs).toBeGreaterThanOrEqual(6_000);
  });

  it("clamps negative pausedFor to 0 (clock skew safe)", async () => {
    const pausedAtMs = Date.now() + 60_000; // future
    mockGetTournament(
      makeTournament({
        state: "paused",
        pausedAt: Timestamp.fromMillis(pausedAtMs),
        pausedAccumMs: 0,
      }),
    );

    await resumeTournament("t1", "u1", ["g1"]);

    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.pausedAccumMs).toBe(0);
  });

  it("wraps updateDoc errors", async () => {
    mockGetTournament(
      makeTournament({
        state: "paused",
        pausedAt: Timestamp.fromMillis(Date.now() - 1_000),
      }),
    );
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(resumeTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("advanceLevel (manual)", () => {
  it("rejects when on final level", async () => {
    mockGetTournament(makeTournament({ currentLevel: 2 }));
    await expect(advanceLevel("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("writes incremented level on happy path", async () => {
    mockGetTournament(makeTournament({ currentLevel: 1 }));
    await advanceLevel("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.currentLevel).toBe(2);
    expect(payload.pausedAccumMs).toBe(0);
    // running 状態で advance → pausedAt は null（非 pause）
    expect(payload.pausedAt).toBeNull();
    // 手動経路は "manual" を記録（useAudioPlayer が音を鳴らさない判定に使う）
    expect(payload.lastLevelChangeKind).toBe("manual");
  });

  it("preserves paused state by re-arming pausedAt at the new level (no invariant violation)", async () => {
    // 旧 level で pause 中に「次レベル」を押すと、
    // state === "paused" && pausedAt === null になり invariant 違反が起きていた回帰テスト。
    mockGetTournament(
      makeTournament({
        state: "paused",
        currentLevel: 1,
        pausedAt: Timestamp.fromMillis(Date.now() - 1_000),
        pausedAccumMs: 5_000,
      }),
    );
    await advanceLevel("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.currentLevel).toBe(2);
    // pause 状態を維持するため新 level の先頭で pausedAt を新規 serverTimestamp に
    expect(payload.pausedAt).toEqual({ __op: "serverTimestamp" });
    expect(payload.pausedAccumMs).toBe(0);
    // state は明示的に書き換えない（"paused" のまま）
    expect(payload.state).toBeUndefined();
  });

  it("wraps updateDoc errors", async () => {
    mockGetTournament(makeTournament({ currentLevel: 1 }));
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(advanceLevel("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("advanceLevel (auto with expectedLevel)", () => {
  function mockTransaction(state: TournamentDoc | null, captureUpdate?: (p: unknown) => void) {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => state !== null,
          id: state?.id ?? "missing",
          data: () => (state ? stripId(state) : undefined),
        }),
        update: vi.fn((_ref, patch) => captureUpdate?.(patch)),
        set: vi.fn(),
        delete: vi.fn(),
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
  }

  it("no-ops when currentLevel != expected (race)", async () => {
    let captured: unknown = null;
    mockTransaction(makeTournament({ currentLevel: 3 }), (p) => (captured = p));
    await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 });
    expect(captured).toBeNull();
  });

  it("no-ops when already on final level", async () => {
    let captured: unknown = null;
    mockTransaction(makeTournament({ currentLevel: 2 }), (p) => (captured = p));
    await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 2 });
    expect(captured).toBeNull();
  });

  it("rejects when tournament not found in tx", async () => {
    mockTransaction(null);
    await expect(
      advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 }),
    ).rejects.toMatchObject({ code: "firestore/not-found" });
  });

  it("rejects when not group member in tx", async () => {
    mockTransaction(makeTournament({ groupId: "g1", currentLevel: 1 }));
    await expect(
      advanceLevel("t1", "u1", ["g-other"], { expectedLevel: 1 }),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  it("commits update when expected matches and not on final level", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeTournament({ currentLevel: 1 }), (p) => {
      captured = p as Record<string, unknown>;
    });
    await advanceLevel("t1", "u1", ["g1"], { expectedLevel: 1 });
    expect(captured).not.toBeNull();
    expect(captured!.currentLevel).toBe(2);
    // auto-advance 経路は "auto" を記録（useAudioPlayer がブラインドアップ音を鳴らす判定に使う）
    expect(captured!.lastLevelChangeKind).toBe("auto");
  });
});

describe("revertLevel", () => {
  it("rejects when currentLevel is 1", async () => {
    mockGetTournament(makeTournament({ currentLevel: 1 }));
    await expect(revertLevel("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/invalid-state",
    });
  });

  it("decrements level on happy path", async () => {
    mockGetTournament(makeTournament({ currentLevel: 2 }));
    await revertLevel("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.currentLevel).toBe(1);
    // running 状態で revert → pausedAt は null
    expect(payload.pausedAt).toBeNull();
    expect(payload.pausedAccumMs).toBe(0);
    expect(payload.lastLevelChangeKind).toBe("manual");
  });

  it("preserves paused state by re-arming pausedAt at the new level (no invariant violation)", async () => {
    // 旧 level で pause 中に「前レベル」を押すと、
    // state === "paused" && pausedAt === null になり「再開」時に invariant 違反が起きていた回帰テスト。
    mockGetTournament(
      makeTournament({
        state: "paused",
        currentLevel: 2,
        pausedAt: Timestamp.fromMillis(Date.now() - 1_000),
        pausedAccumMs: 5_000,
      }),
    );
    await revertLevel("t1", "u1", ["g1"]);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.currentLevel).toBe(1);
    expect(payload.pausedAt).toEqual({ __op: "serverTimestamp" });
    expect(payload.pausedAccumMs).toBe(0);
    expect(payload.state).toBeUndefined();
  });

  it("wraps updateDoc errors", async () => {
    mockGetTournament(makeTournament({ currentLevel: 2 }));
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(revertLevel("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("finishTournament", () => {
  /**
   * Phase A: `finishTournament` は tx 起動前に `listPlayers(tid)` で参加者一覧を 1 回 read する。
   * 既存の race guard / write_failed 等のテストは players=空で十分なので default で空を返す。
   * seasonStats 拡張テスト（後段）では明示的に players を渡す。
   */
  function mockListPlayers(players: Array<{ id: string; data: Record<string, unknown> }> = []) {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: players.map((p) => ({ id: p.id, data: () => p.data, ref: { __ref: "doc", id: p.id } })),
    } as never);
  }

  /**
   * Phase A: tx 内で `tx.get(seasonStatsDocRef(...))` を逐次呼ぶため、
   * 期待 read 件数分の snapshot を順番に返す mock を構築する。
   */
  function mockFinishTransaction(
    txState: TournamentDoc | null,
    options: {
      captureUpdate?: (ref: unknown, patch: Record<string, unknown>) => void;
      captureSet?: (ref: unknown, data: Record<string, unknown>) => void;
      seasonStatsReads?: Array<Record<string, unknown> | null>;
    } = {},
  ) {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const reads = options.seasonStatsReads ?? [];
      let readIdx = 0;
      const txGetCalled = { tournamentReadDone: false };
      const tx = {
        get: vi.fn().mockImplementation(() => {
          // 1 回目は loadTournamentInTx の tournament read。以降は seasonStats read。
          if (!txGetCalled.tournamentReadDone) {
            txGetCalled.tournamentReadDone = true;
            return Promise.resolve({
              exists: () => txState !== null,
              id: txState?.id ?? "missing",
              data: () => (txState ? stripId(txState) : undefined),
            });
          }
          const r = reads[readIdx];
          readIdx += 1;
          return Promise.resolve({
            exists: () => r !== null && r !== undefined,
            data: () => r ?? undefined,
          });
        }),
        update: vi.fn((ref, patch) =>
          options.captureUpdate?.(ref, patch as Record<string, unknown>),
        ),
        set: vi.fn((ref, data) =>
          options.captureSet?.(ref, data as Record<string, unknown>),
        ),
        delete: vi.fn(),
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
  }

  it("returns silently when already finished (no transaction issued)", async () => {
    mockGetTournament(makeTournament({ state: "finished" }));
    await finishTournament("t1", "u1", ["g1"]);
    expect(runTransaction).not.toHaveBeenCalled();
  });

  it("writes finished state and increments group counter atomically via runTransaction", async () => {
    mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
    mockListPlayers();
    const updates: Array<[unknown, Record<string, unknown>]> = [];
    mockFinishTransaction(makeTournament({ state: "running", groupId: "g1" }), {
      captureUpdate: (ref, patch) => updates.push([ref, patch]),
    });

    await finishTournament("t1", "u1", ["g1"]);

    expect(updates).toHaveLength(2);

    // 1st update: tournaments/{tid}
    const tournamentPayload = updates[0][1];
    expect(tournamentPayload.state).toBe("finished");
    expect(tournamentPayload.finishedAt).toEqual({ __op: "serverTimestamp" });
    expect(tournamentPayload.pausedAt).toBeNull();

    // 2nd update: groups/{gid}.finishedTournamentCount = increment(1)
    const groupPayload = updates[1][1];
    expect(groupPayload.finishedTournamentCount).toEqual({ __op: "increment", n: 1 });
  });

  it("re-reads inside tx and skips increment when another client already finished (race guard)", async () => {
    // 事前 read（assertCanManage）では running だが、tx 内 read で finished を観測するケース。
    // 二重 increment を防ぐため update は呼ばれない。
    mockGetTournament(makeTournament({ state: "running" }));
    mockListPlayers();
    const txUpdate = vi.fn();
    mockFinishTransaction(makeTournament({ state: "finished" }), {
      captureUpdate: (_ref, patch) => txUpdate(patch),
    });

    await finishTournament("t1", "u1", ["g1"]);

    expect(txUpdate).not.toHaveBeenCalled();
  });

  it("rejects when tournament document disappears between assertCanManage and tx", async () => {
    // tx 内で `snap.exists() === false` を観測したケース。tx 内 throw した AppError は
    // 既存 code を保持したまま外側に伝播する（AppError.from は AppError 引数を上書きしない）。
    mockGetTournament(makeTournament({ state: "running" }));
    mockListPlayers();
    mockFinishTransaction(null);

    await expect(finishTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/not-found",
    });
  });

  it("wraps runTransaction errors as firestore/write_failed", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    mockListPlayers();
    vi.mocked(runTransaction).mockRejectedValueOnce(new Error("perm"));

    await expect(finishTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });

  /**
   * Phase A: 全参加者の seasonStats を atomic に増分する拡張のテスト。
   *
   *   - tx.set 呼出回数 = uid != null の participant 数
   *   - 順位導出は resolveRanking（active → busted desc）で確定
   *   - uid==null の player は skip（通常発生しないが防衛的に）
   */
  it("writes seasonStats for all participants (uid!=null) with rank-based points", async () => {
    mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
    // 5 人参加: p1 active(=rank 1) + p5 bust last(=rank 2) + p4 + p3 + p2
    const baseEntry = t0.toMillis();
    mockListPlayers([
      {
        id: "p1",
        data: {
          displayName: "Alice",
          uid: "u1",
          entryAt: Timestamp.fromMillis(baseEntry),
          isBusted: false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
      {
        id: "p2",
        data: {
          displayName: "Bob",
          uid: "u2",
          entryAt: Timestamp.fromMillis(baseEntry + 100),
          isBusted: true,
          bustedAt: Timestamp.fromMillis(baseEntry + 5_000),
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
      {
        id: "p3",
        data: {
          displayName: "Carol",
          uid: "u3",
          entryAt: Timestamp.fromMillis(baseEntry + 200),
          isBusted: true,
          bustedAt: Timestamp.fromMillis(baseEntry + 10_000),
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
      {
        id: "p4",
        data: {
          displayName: "Dave",
          uid: "u4",
          entryAt: Timestamp.fromMillis(baseEntry + 300),
          isBusted: true,
          bustedAt: Timestamp.fromMillis(baseEntry + 20_000),
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
      {
        id: "p5",
        data: {
          displayName: "Eve",
          uid: "u5",
          entryAt: Timestamp.fromMillis(baseEntry + 400),
          isBusted: true,
          bustedAt: Timestamp.fromMillis(baseEntry + 30_000),
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
    ]);
    const sets: Array<[unknown, Record<string, unknown>]> = [];
    mockFinishTransaction(makeTournament({ state: "running", groupId: "g1" }), {
      captureSet: (ref, data) => sets.push([ref, data]),
      seasonStatsReads: [null, null, null, null, null], // 既存 stats なし（=新規 create）
    });

    await finishTournament("t1", "u1", ["g1"]);

    // 5 人分の tx.set が呼ばれる
    expect(sets).toHaveLength(5);
    // すべて participations=1, finalTables=1（全員 FT 内）, totalPoints は順位ごとに分布
    const ranks = sets.map((s) => s[1]);
    // resolveRanking: rank 1 = active(p1), 2..5 = busted desc(p5, p4, p3, p2)
    // base[]=[10,7,5,3,1,...], baseline 8 人, 5 人なら factor = sqrt(5/8) ≈ 0.7906...
    // rank 1 = 10 * 0.7906... ≈ 7.91
    // rank 2 = 7 * 0.7906... ≈ 5.53
    // rank 3 = 5 * 0.7906... ≈ 3.95
    // rank 4 = 3 * 0.7906... ≈ 2.37
    // rank 5 = 1 * 0.7906... ≈ 0.79
    const u1 = ranks.find((r) => (r as { uid: string }).uid === "u1") as Record<string, unknown>;
    expect(u1.participations).toBe(1);
    expect(u1.wins).toBe(1);
    expect(u1.finalTables).toBe(1);
    expect(u1.totalPoints).toBe(7.91);
  });

  it("accumulates seasonStats from existing values (atomic increment in tx)", async () => {
    mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
    mockListPlayers([
      {
        id: "p1",
        data: {
          displayName: "Alice",
          uid: "u1",
          entryAt: t0,
          isBusted: false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
    ]);
    const sets: Array<[unknown, Record<string, unknown>]> = [];
    mockFinishTransaction(makeTournament({ state: "running", groupId: "g1" }), {
      captureSet: (ref, data) => sets.push([ref, data]),
      // 既存 stats 1 件（過去 5 戦・優勝 1 回・累計 35.50pt）
      seasonStatsReads: [
        {
          uid: "u1",
          displayName: "Alice",
          participations: 5,
          wins: 1,
          finalTables: 3,
          totalPoints: 35.5,
          lastUpdatedAt: t0,
        },
      ],
    });

    await finishTournament("t1", "u1", ["g1"]);

    expect(sets).toHaveLength(1);
    const next = sets[0][1] as Record<string, unknown>;
    expect(next.participations).toBe(6); // 5 + 1
    expect(next.wins).toBe(2); // 1 + 1（rank 1 単独参加なので wins）
    expect(next.finalTables).toBe(4); // 3 + 1
    // totalPoints = 35.5 + calcSeasonPoints(1, 1) = 35.5 + 10 * sqrt(1/8) = 35.5 + 3.54 = 39.04
    expect(next.totalPoints).toBe(39.04);
  });

  /**
   * H-1: player.displayName が 15 字超でも seasonStats に書く時点で 15 字に切り詰める。
   * 旧 doc / Google 本名等で 15 字超過したケースで rule deny が tx 全体を落とすのを防ぐ最終ライン防御。
   */
  it("truncates player displayName to 15 chars when writing seasonStats (Phase A H-1 defense)", async () => {
    mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
    const long = "1234567890ABCDEFGHIJ"; // 20 文字
    mockListPlayers([
      {
        id: "p-long",
        data: {
          displayName: long,
          uid: "u-long",
          entryAt: t0,
          isBusted: false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
    ]);
    const sets: Array<[unknown, Record<string, unknown>]> = [];
    mockFinishTransaction(makeTournament({ state: "running", groupId: "g1" }), {
      captureSet: (ref, data) => sets.push([ref, data]),
    });

    await finishTournament("t1", "u1", ["g1"]);

    expect(sets).toHaveLength(1);
    const next = sets[0][1] as Record<string, unknown>;
    expect((next.displayName as string).length).toBe(15);
    expect(next.displayName).toBe(long.slice(0, 15));
  });

  /**
   * M-1: tx.get で読んだ raw seasonStats data が schema mismatch（型不正・field 欠損）でも
   * tx 全体を落とさず 0 として扱い増分を継続する（converter 抜き読み + Number 防御）。
   */
  it("treats corrupt prev seasonStats as zeros and continues atomic increment (Phase A M-1 defense)", async () => {
    mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
    mockListPlayers([
      {
        id: "p1",
        data: {
          displayName: "Alice",
          uid: "u1",
          entryAt: t0,
          isBusted: false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
    ]);
    const sets: Array<[unknown, Record<string, unknown>]> = [];
    mockFinishTransaction(makeTournament({ state: "running", groupId: "g1" }), {
      captureSet: (ref, data) => sets.push([ref, data]),
      // 旧 stats の数値フィールドが文字列・null・undefined・NaN・負値で混入したケース。
      // schema-validate していたら invalid_type / nonneg 違反で落ちる。
      seasonStatsReads: [
        {
          uid: "u1",
          displayName: "Alice",
          participations: "broken" as unknown as number,
          wins: null as unknown as number,
          finalTables: undefined as unknown as number,
          totalPoints: -999 as unknown as number,
        },
      ],
    });

    await finishTournament("t1", "u1", ["g1"]);

    expect(sets).toHaveLength(1);
    const next = sets[0][1] as Record<string, unknown>;
    // 全て 0 ベースで再計算。1 人参加 rank 1 なので participations=1 / wins=1 / finalTables=1。
    expect(next.participations).toBe(1);
    expect(next.wins).toBe(1);
    expect(next.finalTables).toBe(1);
    // points: 10 * sqrt(1/8) ≈ 3.54
    expect(next.totalPoints).toBe(3.54);
  });

  it("skips uid==null players (Phase 4 以前互換)", async () => {
    mockGetTournament(makeTournament({ state: "running", groupId: "g1" }));
    mockListPlayers([
      {
        id: "p1",
        data: {
          displayName: "Anonymous",
          uid: null,
          entryAt: t0,
          isBusted: false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        },
      },
    ]);
    const sets: Array<[unknown, Record<string, unknown>]> = [];
    mockFinishTransaction(makeTournament({ state: "running", groupId: "g1" }), {
      captureSet: (ref, data) => sets.push([ref, data]),
    });

    await finishTournament("t1", "u1", ["g1"]);

    expect(sets).toHaveLength(0); // uid==null は skip
  });
});

describe("setLevelDurationSec", () => {
  function makeFiveLevelTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
    return makeTournament({
      structureSnapshot: {
        name: "Default",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 75, bb: 150, ante: 0, durationSec: 720, isBreak: false },
          { level: 4, sb: 100, bb: 200, ante: 0, durationSec: 600, isBreak: false },
          { level: 5, sb: 150, bb: 300, ante: 0, durationSec: 600, isBreak: false },
        ],
      },
      state: "running",
      currentLevel: 3,
      ...overrides,
    });
  }

  function mockTransaction(
    state: TournamentDoc | null,
    captureUpdate?: (ref: unknown, patch: Record<string, unknown>) => void,
  ) {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => state !== null,
          id: state?.id ?? "missing",
          data: () => (state ? stripId(state) : undefined),
        }),
        update: vi.fn((ref, patch) =>
          captureUpdate?.(ref, patch as Record<string, unknown>),
        ),
        set: vi.fn(),
        delete: vi.fn(),
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
  }

  it("happy path: replaces only the targeted levelIndex via dot-path update", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await setLevelDurationSec("t1", "u1", ["g1"], 3, 1020);

    expect(captured).not.toBeNull();
    const newLevels = captured!["structureSnapshot.levels"] as Array<{
      level: number;
      durationSec: number;
    }>;
    expect(Array.isArray(newLevels)).toBe(true);
    expect(newLevels[3].durationSec).toBe(1020);
    expect(captured!.updatedAt).toEqual({ __op: "serverTimestamp" });
  });

  it("preserves other levels (sb / bb / ante / durationSec) unchanged", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await setLevelDurationSec("t1", "u1", ["g1"], 3, 1020);

    const newLevels = captured!["structureSnapshot.levels"] as Array<{
      level: number;
      sb: number;
      bb: number;
      ante: number;
      durationSec: number;
      isBreak: boolean;
    }>;
    expect(newLevels[0]).toEqual({
      level: 1,
      sb: 25,
      bb: 50,
      ante: 0,
      durationSec: 600,
      isBreak: false,
    });
    expect(newLevels[2].durationSec).toBe(720);
    expect(newLevels[4].sb).toBe(150);
    expect(newLevels[4].durationSec).toBe(600);
  });

  it("does not touch currentLevel / levelStartedAt / pausedAt / lastLevelChangeKind", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await setLevelDurationSec("t1", "u1", ["g1"], 3, 1020);

    expect(captured!.currentLevel).toBeUndefined();
    expect(captured!.levelStartedAt).toBeUndefined();
    expect(captured!.pausedAt).toBeUndefined();
    expect(captured!.lastLevelChangeKind).toBeUndefined();
  });

  it("rejects non-member with permission-denied", async () => {
    mockTransaction(makeFiveLevelTournament());
    await expect(
      setLevelDurationSec("t1", "u1", ["g-other"], 3, 1020),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  it("rejects when tournament not found in tx", async () => {
    mockTransaction(null);
    await expect(setLevelDurationSec("t1", "u1", ["g1"], 0, 600)).rejects.toMatchObject({
      code: "firestore/not-found",
    });
  });

  it.each([0, -1, 1.5, Number.NaN])(
    "rejects invalid durationSec (%s) with validation/level-duration-invalid",
    async (durationSec) => {
      await expect(
        setLevelDurationSec("t1", "u1", ["g1"], 0, durationSec),
      ).rejects.toMatchObject({ code: "validation/level-duration-invalid" });
    },
  );

  it("rejects durationSec exceeding MAX_LEVEL_DURATION_SEC (86400)", async () => {
    await expect(
      setLevelDurationSec("t1", "u1", ["g1"], 0, 86_401),
    ).rejects.toMatchObject({ code: "validation/level-duration-invalid" });
  });

  it.each([-1, 1.5])(
    "rejects invalid levelIndex (%s) before tx",
    async (levelIndex) => {
      await expect(
        setLevelDurationSec("t1", "u1", ["g1"], levelIndex, 600),
      ).rejects.toMatchObject({ code: "tournament/invalid-level-index" });
    },
  );

  it("rejects out-of-range levelIndex (>= levels.length) inside tx", async () => {
    mockTransaction(makeFiveLevelTournament());
    await expect(
      setLevelDurationSec("t1", "u1", ["g1"], 5, 600),
    ).rejects.toMatchObject({ code: "tournament/invalid-level-index" });
  });

  it("rejects past-level edit (running, currentLevel=3, levelIndex=0)", async () => {
    mockTransaction(makeFiveLevelTournament({ state: "running", currentLevel: 3 }));
    await expect(
      setLevelDurationSec("t1", "u1", ["g1"], 0, 720),
    ).rejects.toMatchObject({ code: "tournament/level-edit-not-allowed" });
  });

  it("rejects edit on finished tournament", async () => {
    mockTransaction(
      makeFiveLevelTournament({ state: "finished", finishedAt: t0, currentLevel: 3 }),
    );
    await expect(
      setLevelDurationSec("t1", "u1", ["g1"], 4, 720),
    ).rejects.toMatchObject({ code: "tournament/level-edit-not-allowed" });
  });

  it("allows edit during setup at any levelIndex", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(
      makeFiveLevelTournament({ state: "setup", currentLevel: 0 }),
      (_ref, patch) => {
        captured = patch;
      },
    );

    await setLevelDurationSec("t1", "u1", ["g1"], 0, 720);

    const newLevels = captured!["structureSnapshot.levels"] as Array<{
      durationSec: number;
    }>;
    expect(newLevels[0].durationSec).toBe(720);
  });

  it("wraps runTransaction errors as firestore/write_failed", async () => {
    vi.mocked(runTransaction).mockRejectedValueOnce(new Error("perm"));
    await expect(
      setLevelDurationSec("t1", "u1", ["g1"], 3, 1020),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("appendLevel", () => {
  function makeFiveLevelTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
    return makeTournament({
      structureSnapshot: {
        name: "Default",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
          { level: 3, sb: 75, bb: 150, ante: 0, durationSec: 720, isBreak: false },
          { level: 4, sb: 100, bb: 200, ante: 0, durationSec: 600, isBreak: false },
          { level: 5, sb: 150, bb: 300, ante: 0, durationSec: 600, isBreak: false },
        ],
      },
      state: "running",
      currentLevel: 5,
      ...overrides,
    });
  }

  function makeMaxLevelTournament(): TournamentDoc {
    const levels = Array.from({ length: MAX_LEVELS_PER_TOURNAMENT }, (_, i) => ({
      level: i + 1,
      sb: 25,
      bb: 50,
      ante: 0,
      durationSec: 600,
      isBreak: false,
    }));
    return makeTournament({
      structureSnapshot: {
        name: "Default",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels,
      },
      state: "running",
      currentLevel: MAX_LEVELS_PER_TOURNAMENT,
    });
  }

  function mockTransaction(
    state: TournamentDoc | null,
    captureUpdate?: (ref: unknown, patch: Record<string, unknown>) => void,
  ) {
    vi.mocked(runTransaction).mockImplementationOnce(async (_db, fn) => {
      const tx = {
        get: vi.fn().mockResolvedValue({
          exists: () => state !== null,
          id: state?.id ?? "missing",
          data: () => (state ? stripId(state) : undefined),
        }),
        update: vi.fn((ref, patch) =>
          captureUpdate?.(ref, patch as Record<string, unknown>),
        ),
        set: vi.fn(),
        delete: vi.fn(),
      };
      await fn(tx as unknown as Parameters<typeof fn>[0]);
      return undefined as unknown;
    });
  }

  const happyInput = {
    sb: 200,
    bb: 400,
    ante: 25,
    durationSec: 900,
    isBreak: false,
  };

  it("happy path: pushes new level at end via dot-path update", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await appendLevel("t1", "u1", ["g1"], happyInput);

    expect(captured).not.toBeNull();
    const newLevels = captured!["structureSnapshot.levels"] as Array<{
      level: number;
      sb: number;
      bb: number;
      ante: number;
      durationSec: number;
      isBreak: boolean;
    }>;
    expect(Array.isArray(newLevels)).toBe(true);
    expect(newLevels).toHaveLength(6);
    expect(newLevels[5]).toEqual({
      level: 6,
      sb: 200,
      bb: 400,
      ante: 25,
      durationSec: 900,
      isBreak: false,
    });
    expect(captured!.updatedAt).toEqual({ __op: "serverTimestamp" });
  });

  it("preserves all existing levels (sb / bb / ante / durationSec / isBreak) unchanged", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await appendLevel("t1", "u1", ["g1"], happyInput);

    const newLevels = captured!["structureSnapshot.levels"] as Array<{
      level: number;
      sb: number;
      bb: number;
      ante: number;
      durationSec: number;
      isBreak: boolean;
    }>;
    expect(newLevels[0]).toEqual({
      level: 1,
      sb: 25,
      bb: 50,
      ante: 0,
      durationSec: 600,
      isBreak: false,
    });
    expect(newLevels[2].durationSec).toBe(720);
    expect(newLevels[4].sb).toBe(150);
    expect(newLevels[4].durationSec).toBe(600);
  });

  it("does not touch currentLevel / levelStartedAt / pausedAt / lastLevelChangeKind", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await appendLevel("t1", "u1", ["g1"], happyInput);

    expect(captured!.currentLevel).toBeUndefined();
    expect(captured!.levelStartedAt).toBeUndefined();
    expect(captured!.pausedAt).toBeUndefined();
    expect(captured!.lastLevelChangeKind).toBeUndefined();
  });

  it("rejects non-member with permission-denied", async () => {
    mockTransaction(makeFiveLevelTournament());
    await expect(
      appendLevel("t1", "u1", ["g-other"], happyInput),
    ).rejects.toMatchObject({ code: "firestore/permission-denied" });
  });

  it("rejects when tournament not found in tx", async () => {
    mockTransaction(null);
    await expect(
      appendLevel("t1", "u1", ["g1"], happyInput),
    ).rejects.toMatchObject({ code: "firestore/not-found" });
  });

  it("rejects append on finished tournament with tournament/append-not-allowed", async () => {
    mockTransaction(
      makeFiveLevelTournament({ state: "finished", finishedAt: t0, currentLevel: 5 }),
    );
    await expect(
      appendLevel("t1", "u1", ["g1"], happyInput),
    ).rejects.toMatchObject({ code: "tournament/append-not-allowed" });
  });

  it("rejects when levels.length is at MAX_LEVELS_PER_TOURNAMENT", async () => {
    mockTransaction(makeMaxLevelTournament());
    await expect(
      appendLevel("t1", "u1", ["g1"], happyInput),
    ).rejects.toMatchObject({ code: "tournament/levels-limit-exceeded" });
  });

  it.each([
    { sb: -1, bb: 100, ante: 0, durationSec: 600, isBreak: false }, // sb 負
    { sb: 100, bb: -5, ante: 0, durationSec: 600, isBreak: false }, // bb 負
    { sb: 100, bb: 200, ante: -1, durationSec: 600, isBreak: false }, // ante 負
    { sb: 100, bb: 200, ante: 0, durationSec: 0, isBreak: false }, // durationSec=0
    { sb: 100, bb: 200, ante: 0, durationSec: -1, isBreak: false }, // durationSec<0
    { sb: 100, bb: 200, ante: 0, durationSec: 1.5, isBreak: false }, // durationSec 非整数
    { sb: 100, bb: 200, ante: 0, durationSec: Number.NaN, isBreak: false }, // NaN
    { sb: 100, bb: 200, ante: 0, durationSec: 86_401, isBreak: false }, // > MAX
    { sb: 100, bb: 0, ante: 0, durationSec: 600, isBreak: false }, // !isBreak && bb=0
  ])("rejects invalid input (%j) with validation/level-input-invalid", async (input) => {
    await expect(appendLevel("t1", "u1", ["g1"], input)).rejects.toMatchObject({
      code: "validation/level-input-invalid",
    });
    // tx は起動されない（早期 throw）
    expect(vi.mocked(runTransaction)).not.toHaveBeenCalled();
  });

  it("allows break level with sb=bb=ante=0", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(makeFiveLevelTournament(), (_ref, patch) => {
      captured = patch;
    });

    await appendLevel("t1", "u1", ["g1"], {
      sb: 0,
      bb: 0,
      ante: 0,
      durationSec: 600,
      isBreak: true,
    });

    const newLevels = captured!["structureSnapshot.levels"] as Array<{
      level: number;
      sb: number;
      bb: number;
      isBreak: boolean;
    }>;
    expect(newLevels).toHaveLength(6);
    expect(newLevels[5].isBreak).toBe(true);
    expect(newLevels[5].sb).toBe(0);
    expect(newLevels[5].bb).toBe(0);
  });

  it("allows append during setup state", async () => {
    let captured: Record<string, unknown> | null = null;
    mockTransaction(
      makeFiveLevelTournament({ state: "setup", currentLevel: 0 }),
      (_ref, patch) => {
        captured = patch;
      },
    );

    await appendLevel("t1", "u1", ["g1"], happyInput);

    const newLevels = captured!["structureSnapshot.levels"] as unknown[];
    expect(newLevels).toHaveLength(6);
  });

  it("wraps runTransaction errors as firestore/write_failed", async () => {
    vi.mocked(runTransaction).mockRejectedValueOnce(new Error("perm"));
    await expect(
      appendLevel("t1", "u1", ["g1"], happyInput),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("subscribeTournament", () => {
  it("delivers null doc when snapshot doesn't exist", () => {
    const onNext = vi.fn();
    const onError = vi.fn();

    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, _opts: unknown, next: (s: unknown) => void) => {
        next({
          exists: () => false,
          metadata: { fromCache: true, hasPendingWrites: false },
        });
        return () => {};
      }) as never,
    );

    subscribeTournament("t1", onNext, onError);

    expect(onNext).toHaveBeenCalledWith({
      doc: null,
      fromCache: true,
      hasPendingWrites: false,
    });
  });

  it("delivers doc payload when snapshot exists", () => {
    const t = makeTournament();
    const onNext = vi.fn();
    const onError = vi.fn();

    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, _opts: unknown, next: (s: unknown) => void) => {
        next({
          exists: () => true,
          id: t.id,
          data: () => stripId(t),
          metadata: { fromCache: false, hasPendingWrites: false },
        });
        return () => {};
      }) as never,
    );

    subscribeTournament("t1", onNext, onError);

    const arg = onNext.mock.calls[0][0];
    expect(arg.doc.id).toBe("t1");
    expect(arg.fromCache).toBe(false);
  });

  it("propagates onError when SDK emits error", () => {
    const onNext = vi.fn();
    const onError = vi.fn();

    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, _opts: unknown, _next: unknown, err: (e: unknown) => void) => {
        err(new Error("boom"));
        return () => {};
      }) as never,
    );

    subscribeTournament("t1", onNext, onError);

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].code).toBe("firestore/subscribe_failed");
  });

  it("returns unsubscribe function from onSnapshot", () => {
    const unsub = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsub as never);
    const result = subscribeTournament("t1", vi.fn(), vi.fn());
    expect(result).toBe(unsub);
  });
});

describe("deleteTournament", () => {
  type FakeBatch = {
    delete: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    commit: ReturnType<typeof vi.fn>;
  };

  function mockBatch(commitImpl?: () => Promise<void>): FakeBatch {
    const batch: FakeBatch = {
      delete: vi.fn(),
      set: vi.fn(),
      update: vi.fn(),
      commit: vi.fn(commitImpl ?? (async () => undefined)),
    };
    vi.mocked(writeBatch).mockReturnValueOnce(batch as never);
    return batch;
  }

  function mockSubcollections(playersIds: string[], tablesIds: string[]) {
    // deleteTournament は players → tables の順で getDocs する。
    const playersSnap = {
      size: playersIds.length,
      forEach: (fn: (d: { ref: { id: string } }) => void) =>
        playersIds.forEach((id) => fn({ ref: { id } })),
      docs: playersIds.map((id) => ({ ref: { id } })),
    };
    const tablesSnap = {
      size: tablesIds.length,
      forEach: (fn: (d: { ref: { id: string } }) => void) =>
        tablesIds.forEach((id) => fn({ ref: { id } })),
      docs: tablesIds.map((id) => ({ ref: { id } })),
    };
    vi.mocked(getDocs)
      .mockResolvedValueOnce(playersSnap as never)
      .mockResolvedValueOnce(tablesSnap as never);
    return { playersSnap, tablesSnap };
  }

  it("rejects non-member", async () => {
    mockGetTournament(makeTournament());
    await expect(deleteTournament("t1", "u1", ["g-other"])).rejects.toMatchObject({
      code: "firestore/permission-denied",
    });
  });

  it("rejects when state is in-progress (running)", async () => {
    mockGetTournament(makeTournament({ state: "running" }));
    await expect(deleteTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/in-progress",
    });
  });

  it("rejects when state is in-progress (paused)", async () => {
    mockGetTournament(makeTournament({ state: "paused" }));
    await expect(deleteTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "tournament/in-progress",
    });
  });

  it("happy path: setup with empty subcollections — deletes parent only via batch.commit", async () => {
    mockGetTournament(makeTournament({ state: "setup" }));
    mockSubcollections([], []);
    const batch = mockBatch();

    await deleteTournament("t1", "u1", ["g1"]);

    expect(batch.delete).toHaveBeenCalledTimes(1); // parent doc only
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it("happy path: finished with subcollections — batches all 3 deletes (players + tables + parent)", async () => {
    mockGetTournament(makeTournament({ state: "finished" }));
    const playerIds = Array.from({ length: 20 }, (_, i) => `p${i + 1}`);
    const tableIds = Array.from({ length: 6 }, (_, i) => String(i + 1));
    mockSubcollections(playerIds, tableIds);
    const batch = mockBatch();

    await deleteTournament("t1", "u1", ["g1"]);

    // players(20) + tables(6) + parent(1) = 27 deletes in one batch
    expect(batch.delete).toHaveBeenCalledTimes(20 + 6 + 1);
    expect(batch.commit).toHaveBeenCalledTimes(1);
  });

  it("wraps batch.commit errors as firestore/write_failed", async () => {
    mockGetTournament(makeTournament({ state: "setup" }));
    mockSubcollections([], []);
    mockBatch(async () => {
      throw new Error("perm");
    });

    await expect(deleteTournament("t1", "u1", ["g1"])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("subscribeTournamentsByGroup", () => {
  it("returns the unsubscribe function from onSnapshot", () => {
    const unsub = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsub as never);
    const result = subscribeTournamentsByGroup("g1", vi.fn(), vi.fn());
    expect(result).toBe(unsub);
  });

  it("delivers items sorted by createdAt descending", () => {
    const newer = Timestamp.fromMillis(t0.toMillis() + 10_000);
    const older = makeTournament({ id: "old", createdAt: t0 });
    const fresh = makeTournament({ id: "new", createdAt: newer });
    const onNext = vi.fn();
    const onError = vi.fn();

    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_q: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            { id: older.id, data: () => stripId(older) },
            { id: fresh.id, data: () => stripId(fresh) },
          ],
        });
        return () => {};
      }) as never,
    );

    subscribeTournamentsByGroup("g1", onNext, onError);

    expect(onNext).toHaveBeenCalledTimes(1);
    const items = onNext.mock.calls[0][0] as Array<{ id: string }>;
    expect(items.map((x) => x.id)).toEqual(["new", "old"]);
  });

  it("propagates onError when SDK emits error", () => {
    const onNext = vi.fn();
    const onError = vi.fn();

    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_q: unknown, _next: unknown, err: (e: unknown) => void) => {
        err(new Error("boom"));
        return () => {};
      }) as never,
    );

    subscribeTournamentsByGroup("g1", onNext, onError);

    expect(onError).toHaveBeenCalled();
    expect(onError.mock.calls[0][0].code).toBe("firestore/subscribe_failed");
  });
});
