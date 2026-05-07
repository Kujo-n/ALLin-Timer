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
    getDoc: vi.fn(),
    getDocs: vi.fn(),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { doc, getDoc, getDocs } from "firebase/firestore";

import {
  getSeasonHistory,
  listSeasonHistory,
  seasonHistoryDocRef,
} from "./seasonHistory";

const t1 = Timestamp.fromDate(new Date("2026-04-01T00:00:00Z"));
const t2 = Timestamp.fromDate(new Date("2026-05-01T00:00:00Z"));

beforeEach(() => {
  vi.mocked(getDocs).mockReset();
  vi.mocked(getDoc).mockReset();
});

describe("listSeasonHistory", () => {
  it("returns history docs sorted by endedAt desc", async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: "season-1",
          data: () => ({
            startedAt: null,
            endedAt: t1,
            entries: [],
          }),
        },
        {
          id: "season-2",
          data: () => ({
            startedAt: t1,
            endedAt: t2,
            entries: [
              {
                uid: "u1",
                displayName: "A",
                participations: 1,
                wins: 0,
                finalTables: 0,
                totalPoints: 1.0,
              },
            ],
          }),
        },
      ],
    } as never);
    const list = await listSeasonHistory("g1");
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe("season-2"); // t2 > t1
    expect(list[1].id).toBe("season-1");
  });

  it("returns empty array when no history exists", async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({ docs: [] } as never);
    const list = await listSeasonHistory("g1");
    expect(list).toEqual([]);
  });

  it("wraps errors as firestore/read_failed", async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error("perm"));
    await expect(listSeasonHistory("g1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });

  it("skips schema-invalid docs and logs warn (does not throw)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: "broken",
          data: () => {
            throw new Error("invalid schema");
          },
        },
        {
          id: "season-ok",
          data: () => ({
            startedAt: null,
            endedAt: t1,
            entries: [],
          }),
        },
      ],
    } as never);
    const list = await listSeasonHistory("g1");
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("season-ok");
    expect(warnSpy).toHaveBeenCalledWith(
      "seasonHistory list skipped invalid doc",
      expect.objectContaining({ gid: "g1", seasonId: "broken" }),
    );
    warnSpy.mockRestore();
  });
});

describe("seasonHistoryDocRef", () => {
  it("constructs a doc ref under the seasonHistory subcollection", () => {
    const ref = seasonHistoryDocRef("g1", "season-uuid-1");
    expect(ref).toBeDefined();
    expect(vi.mocked(doc)).toHaveBeenCalled();
  });
});

describe("getSeasonHistory", () => {
  it("returns the history doc when it exists", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({
      exists: () => true,
      id: "season-uuid-1",
      data: () => ({
        startedAt: t1,
        endedAt: t2,
        entries: [],
      }),
    } as never);
    const h = await getSeasonHistory("g1", "season-uuid-1");
    expect(h.id).toBe("season-uuid-1");
    expect(h.endedAt.toMillis()).toBe(t2.toMillis());
  });

  it("throws AppError(firestore/not-found) when missing", async () => {
    vi.mocked(getDoc).mockResolvedValueOnce({ exists: () => false } as never);
    await expect(getSeasonHistory("g1", "missing")).rejects.toMatchObject({
      code: "firestore/not-found",
    });
  });

  it("wraps unknown errors as firestore/read_failed", async () => {
    vi.mocked(getDoc).mockRejectedValueOnce(new Error("offline"));
    await expect(getSeasonHistory("g1", "x")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });
});
