import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import {
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
} from "firebase/firestore";

import {
  assignSeat,
  bustPlayer,
  clearSeat,
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

describe("bustPlayer", () => {
  it("writes isBusted=true and clears seat", async () => {
    await bustPlayer("t1", "u1");
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.isBusted).toBe(true);
    expect(payload.tableNum).toBeNull();
    expect(payload.seatNum).toBeNull();
    expect(payload.bustedAt).toEqual({ __op: "serverTimestamp" });
    expect(payload.lastMovedAt).toEqual({ __op: "serverTimestamp" });
  });

  it("wraps errors as firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
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
