import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

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
    getDocs: vi.fn(),
    onSnapshot: vi.fn(),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { doc, getDocs, onSnapshot } from "firebase/firestore";

import {
  listSeasonStats,
  seasonStatsRawDocRef,
  subscribeSeasonStats,
} from "./seasonStats";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

beforeEach(() => {
  vi.mocked(getDocs).mockReset();
  vi.mocked(onSnapshot).mockReset();
});

describe("listSeasonStats", () => {
  it("returns stats sorted by totalPoints desc with id synthesized", async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: "u1",
          data: () => ({
            uid: "u1",
            displayName: "Alice",
            participations: 5,
            wins: 1,
            finalTables: 2,
            totalPoints: 12.34,
            lastUpdatedAt: ts,
          }),
        },
        {
          id: "u2",
          data: () => ({
            uid: "u2",
            displayName: "Bob",
            participations: 3,
            wins: 1,
            finalTables: 1,
            totalPoints: 28.5,
            lastUpdatedAt: ts,
          }),
        },
      ],
    } as never);
    const list = await listSeasonStats("g1");
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("u2"); // 28.5 > 12.34
    expect(list[1].id).toBe("u1");
  });

  it("wraps errors as firestore/read_failed", async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error("perm"));
    await expect(listSeasonStats("g1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });

  it("skips schema-invalid docs and logs warn (does not throw)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: "u-broken",
          data: () => {
            throw new Error("invalid schema");
          },
        },
        {
          id: "u-ok",
          data: () => ({
            uid: "u-ok",
            displayName: "Carol",
            participations: 1,
            wins: 0,
            finalTables: 0,
            totalPoints: 1.0,
            lastUpdatedAt: ts,
          }),
        },
      ],
    } as never);
    const list = await listSeasonStats("g1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("u-ok");
    expect(warnSpy).toHaveBeenCalledWith(
      "seasonStats list skipped invalid doc",
      expect.objectContaining({ gid: "g1", uid: "u-broken" }),
    );
    warnSpy.mockRestore();
  });
});

describe("seasonStatsRawDocRef", () => {
  it("constructs a doc ref bypassing the zodConverter", () => {
    const ref = seasonStatsRawDocRef("g1", "u-tx");
    expect(ref).toBeDefined();
    expect(vi.mocked(doc)).toHaveBeenCalled();
  });
});

describe("subscribeSeasonStats", () => {
  it("invokes onNext with stats sorted by totalPoints desc", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            {
              id: "u1",
              data: () => ({
                uid: "u1",
                displayName: "Alice",
                participations: 5,
                wins: 1,
                finalTables: 2,
                totalPoints: 12.34,
                lastUpdatedAt: ts,
              }),
            },
            {
              id: "u2",
              data: () => ({
                uid: "u2",
                displayName: "Bob",
                participations: 3,
                wins: 1,
                finalTables: 1,
                totalPoints: 28.5,
                lastUpdatedAt: ts,
              }),
            },
          ],
        });
        return () => {};
      }) as never,
    );
    subscribeSeasonStats("g1", onNext, onError);
    expect(onNext).toHaveBeenCalledTimes(1);
    const items = onNext.mock.calls[0][0] as Array<{ id: string }>;
    expect(items[0].id).toBe("u2");
    expect(items[1].id).toBe("u1");
  });

  it("propagates subscribe error as firestore/subscribe_failed", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, _next: unknown, err: (e: unknown) => void) => {
        err(new Error("boom"));
        return () => {};
      }) as never,
    );
    subscribeSeasonStats("g1", onNext, onError);
    expect(onError.mock.calls[0][0].code).toBe("firestore/subscribe_failed");
  });

  it("skips schema-invalid docs in snapshot loop and still delivers valid ones", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            {
              id: "u-broken",
              data: () => {
                throw new Error("invalid schema");
              },
            },
            {
              id: "u-ok",
              data: () => ({
                uid: "u-ok",
                displayName: "Dora",
                participations: 2,
                wins: 0,
                finalTables: 1,
                totalPoints: 5.0,
                lastUpdatedAt: ts,
              }),
            },
          ],
        });
        return () => {};
      }) as never,
    );
    subscribeSeasonStats("g1", onNext, onError);
    expect(onNext).toHaveBeenCalledTimes(1);
    const items = onNext.mock.calls[0][0] as Array<{ id: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("u-ok");
    expect(warnSpy).toHaveBeenCalledWith(
      "seasonStats subscribe skipped invalid doc",
      expect.objectContaining({ gid: "g1", uid: "u-broken" }),
    );
    expect(onError).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("routes synchronous failures inside next() to onError as firestore/invalid-data", () => {
    const onNext = vi.fn(() => {
      throw new Error("downstream blew up");
    });
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, next: (s: unknown) => void) => {
        next({ docs: [] });
        return () => {};
      }) as never,
    );
    subscribeSeasonStats("g1", onNext, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe("firestore/invalid-data");
  });
});
