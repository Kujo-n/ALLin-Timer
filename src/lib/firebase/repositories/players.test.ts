import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    where: vi.fn((...args) => ({ __ref: "where", args })),
    orderBy: vi.fn((...args) => ({ __ref: "orderBy", args })),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    setDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    onSnapshot: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
    writeBatch: vi.fn(),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  writeBatch,
} from "firebase/firestore";

import {
  assignSeat,
  bustPlayer,
  clearSeat,
  clonePlayersFromTournament,
  createNamedOnlyPlayer,
  unbustPlayer,
  upsertPlayer,
} from "./players";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

beforeEach(() => {
  vi.mocked(getDoc).mockReset();
  vi.mocked(getDocs).mockReset();
  vi.mocked(setDoc).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(updateDoc).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteDoc).mockReset().mockResolvedValue(undefined);
  vi.mocked(serverTimestamp).mockReturnValue({ __op: "serverTimestamp" } as never);
  vi.mocked(writeBatch).mockReset();
});

describe("upsertPlayer", () => {
  it("creates new player with seat fields initialized to null", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => false,
    } as never);
    await upsertPlayer("t1", "u1", { displayName: "alice" });
    const payload = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.tableNum).toBeNull();
    expect(payload.seatNum).toBeNull();
    expect(payload.lastMovedAt).toBeNull();
    expect(payload.isBusted).toBe(false);
  });

  it("merges existing player without touching seat fields", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      id: "u1",
      data: () => ({
        displayName: "old",
        uid: "u1",
        entryAt: ts,
        isBusted: false,
        bustedAt: null,
        tableNum: 1,
        seatNum: 3,
        lastMovedAt: ts,
      }),
    } as never);
    await upsertPlayer("t1", "u1", { displayName: "new" });
    const payload = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
    expect(payload).toEqual({ displayName: "new" });
  });
});

describe("createNamedOnlyPlayer", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates a uid=null player with synthetic pid and initialized invariants", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "synthetic-pid-1" });
    const pid = await createNamedOnlyPlayer("t1", "Guest");
    expect(pid).toBe("synthetic-pid-1");
    const payload = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.displayName).toBe("Guest");
    expect(payload.uid).toBeNull();
    expect(payload.isBusted).toBe(false);
    expect(payload.tableNum).toBeNull();
    expect(payload.seatNum).toBeNull();
    expect(payload.lastMovedAt).toBeNull();
    expect(payload.bustedAt).toBeNull();
    expect(payload.isPlayingDealer).toBe(false);
    expect(payload.entryAt).toEqual({ __op: "serverTimestamp" });
  });

  it("writes the doc under the synthetic pid", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "synthetic-pid-2" });
    await createNamedOnlyPlayer("t1", "Guest");
    const docRef = vi.mocked(setDoc).mock.calls[0][0] as { id?: string };
    expect(docRef.id).toBe("synthetic-pid-2");
    // doc(ref, id) が合成 pid で呼ばれていること
    const docCallIds = vi.mocked(doc).mock.calls.map((c) => c[1]);
    expect(docCallIds).toContain("synthetic-pid-2");
  });

  it("wraps errors as firestore/write_failed", async () => {
    vi.stubGlobal("crypto", { randomUUID: () => "synthetic-pid-3" });
    vi.mocked(setDoc).mockRejectedValueOnce(new Error("perm") as never);
    await expect(createNamedOnlyPlayer("t1", "Guest")).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("bustPlayer", () => {
  function setupBatch() {
    const batchUpdate = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(writeBatch).mockReturnValueOnce({
      update: batchUpdate,
      commit: batchCommit,
    } as never);
    return { batchUpdate, batchCommit };
  }

  it("writes isBusted=true, clears seat, and bumps PD off", async () => {
    const { batchUpdate, batchCommit } = setupBatch();
    await bustPlayer("t1", "u1");
    expect(batchCommit).toHaveBeenCalled();
    const payload = batchUpdate.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.isBusted).toBe(true);
    expect(payload.tableNum).toBeNull();
    expect(payload.seatNum).toBeNull();
    expect(payload.bustedAt).toEqual({ __op: "serverTimestamp" });
    expect(payload.lastMovedAt).toEqual({ __op: "serverTimestamp" });
    expect(payload.isPlayingDealer).toBe(false);
  });

  it("also unsets PD on same-table players", async () => {
    const { batchUpdate, batchCommit } = setupBatch();
    await bustPlayer("t1", "u1", ["other-1", "other-2"]);
    expect(batchCommit).toHaveBeenCalled();
    // 当該 player + 同卓 2 人 = 3 update 呼出
    expect(batchUpdate).toHaveBeenCalledTimes(3);
    const otherPayload = batchUpdate.mock.calls[1][1] as Record<string, unknown>;
    expect(otherPayload).toEqual({ isPlayingDealer: false });
  });

  it("self id duplicates are skipped from same-table list", async () => {
    const { batchUpdate } = setupBatch();
    await bustPlayer("t1", "u1", ["u1", "other-1"]);
    // 当該 + other-1 = 2（"u1" は self なので skip）
    expect(batchUpdate).toHaveBeenCalledTimes(2);
  });

  it("wraps errors as firestore/write_failed", async () => {
    const batchUpdate = vi.fn();
    const batchCommit = vi.fn().mockRejectedValueOnce(new Error("perm"));
    vi.mocked(writeBatch).mockReturnValueOnce({
      update: batchUpdate,
      commit: batchCommit,
    } as never);
    await expect(bustPlayer("t1", "u1")).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("unbustPlayer", () => {
  it("writes isBusted=false and bustedAt=null (does not restore seat)", async () => {
    await unbustPlayer("t1", "u1");
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.isBusted).toBe(false);
    expect(payload.bustedAt).toBeNull();
    expect(payload).not.toHaveProperty("tableNum");
    expect(payload).not.toHaveProperty("seatNum");
  });
});

describe("assignSeat", () => {
  it("writes tableNum / seatNum / lastMovedAt", async () => {
    await assignSeat("t1", "u1", 2, 5);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.tableNum).toBe(2);
    expect(payload.seatNum).toBe(5);
    expect(payload.lastMovedAt).toEqual({ __op: "serverTimestamp" });
  });
});

describe("clearSeat", () => {
  it("nulls tableNum / seatNum and bumps lastMovedAt", async () => {
    await clearSeat("t1", "u1");
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.tableNum).toBeNull();
    expect(payload.seatNum).toBeNull();
    expect(payload.lastMovedAt).toEqual({ __op: "serverTimestamp" });
  });
});

describe("clonePlayersFromTournament", () => {
  function setupBatch() {
    const batchSet = vi.fn();
    const batchCommit = vi.fn().mockResolvedValue(undefined);
    vi.mocked(writeBatch).mockReturnValueOnce({
      set: batchSet,
      commit: batchCommit,
    } as never);
    return { batchSet, batchCommit };
  }

  function fakePlayerDocs(
    list: Array<{ id: string; uid: string | null; displayName: string; isBusted?: boolean }>,
  ) {
    return {
      docs: list.map((p) => ({
        id: p.id,
        data: () => ({
          displayName: p.displayName,
          uid: p.uid,
          entryAt: ts,
          isBusted: p.isBusted ?? false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        }),
      })),
    };
  }

  it("happy: src 3 player / 全選択 → batch.set ×3, returns 3", async () => {
    const { batchSet, batchCommit } = setupBatch();
    vi.mocked(getDocs).mockResolvedValueOnce(
      fakePlayerDocs([
        { id: "u1", uid: "u1", displayName: "alice" },
        { id: "u2", uid: "u2", displayName: "bob" },
        { id: "u3", uid: "u3", displayName: "carol" },
      ]) as never,
    );
    const n = await clonePlayersFromTournament("src", "dst", ["u1", "u2", "u3"]);
    expect(n).toBe(3);
    expect(batchSet).toHaveBeenCalledTimes(3);
    expect(batchCommit).toHaveBeenCalledTimes(1);
    const payload = batchSet.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.uid).toBe("u1");
    expect(payload.displayName).toBe("alice");
    expect(payload.isBusted).toBe(false);
    expect(payload.tableNum).toBeNull();
    expect(payload.seatNum).toBeNull();
    expect(payload.lastMovedAt).toBeNull();
    expect(payload.bustedAt).toBeNull();
    expect(payload.isPlayingDealer).toBe(false);
    expect(payload.entryAt).toEqual({ __op: "serverTimestamp" });
  });

  it("partial select: 2/3 selected → batch.set ×2, returns 2", async () => {
    const { batchSet } = setupBatch();
    vi.mocked(getDocs).mockResolvedValueOnce(
      fakePlayerDocs([
        { id: "u1", uid: "u1", displayName: "alice" },
        { id: "u2", uid: "u2", displayName: "bob" },
        { id: "u3", uid: "u3", displayName: "carol" },
      ]) as never,
    );
    const n = await clonePlayersFromTournament("src", "dst", ["u1", "u3"]);
    expect(n).toBe(2);
    expect(batchSet).toHaveBeenCalledTimes(2);
  });

  it("busted included: payload は isBusted=false で再初期化される", async () => {
    const { batchSet } = setupBatch();
    vi.mocked(getDocs).mockResolvedValueOnce(
      fakePlayerDocs([
        { id: "u1", uid: "u1", displayName: "busted-alice", isBusted: true },
      ]) as never,
    );
    const n = await clonePlayersFromTournament("src", "dst", ["u1"]);
    expect(n).toBe(1);
    const payload = batchSet.mock.calls[0][1] as Record<string, unknown>;
    expect(payload.isBusted).toBe(false);
  });

  it("uid===null skip: 該当 player は count に含まれない", async () => {
    const { batchSet } = setupBatch();
    vi.mocked(getDocs).mockResolvedValueOnce(
      fakePlayerDocs([
        { id: "u1", uid: "u1", displayName: "alice" },
        { id: "guest", uid: null, displayName: "guest" },
      ]) as never,
    );
    const n = await clonePlayersFromTournament("src", "dst", ["u1", "guest"]);
    expect(n).toBe(1);
    expect(batchSet).toHaveBeenCalledTimes(1);
  });

  it("MAX_CLONE_PLAYERS 超過: tournament/clone-too-many を throw", async () => {
    const ids = Array.from({ length: 51 }, (_, i) => `u${i}`);
    await expect(
      clonePlayersFromTournament("src", "dst", ids),
    ).rejects.toMatchObject({
      code: "tournament/clone-too-many",
    });
  });

  it("count===0: tournament/clone-empty を throw", async () => {
    setupBatch();
    vi.mocked(getDocs).mockResolvedValueOnce(
      fakePlayerDocs([
        { id: "u1", uid: "u1", displayName: "alice" },
      ]) as never,
    );
    await expect(
      clonePlayersFromTournament("src", "dst", ["unknown-id"]),
    ).rejects.toMatchObject({
      code: "tournament/clone-empty",
    });
  });
});
