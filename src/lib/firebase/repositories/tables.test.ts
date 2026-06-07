import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

const batchSet = vi.fn();
const batchCommit = vi.fn();

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
    writeBatch: vi.fn(() => ({ set: batchSet, commit: batchCommit })),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { getDocs, onSnapshot, setDoc, updateDoc } from "firebase/firestore";

import { TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";

import {
  listTables,
  markTableBroken,
  reopenTable,
  subscribeTables,
  updateTableLabel,
  upsertTable,
  upsertTables,
} from "./tables";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

beforeEach(() => {
  vi.mocked(getDocs).mockReset();
  vi.mocked(setDoc).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(updateDoc).mockReset().mockResolvedValue(undefined);
  vi.mocked(onSnapshot).mockReset();
  batchSet.mockReset();
  batchCommit.mockReset().mockResolvedValue(undefined);
});

describe("listTables", () => {
  it("returns tables with id synthesized", async () => {
    vi.mocked(getDocs).mockResolvedValueOnce({
      docs: [
        {
          id: "1",
          data: () => ({ tableNum: 1, isBroken: false, createdAt: ts }),
        },
        {
          id: "2",
          data: () => ({ tableNum: 2, isBroken: true, createdAt: ts }),
        },
      ],
    } as never);
    const list = await listTables("t1");
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({ id: "1", tableNum: 1, isBroken: false });
    expect(list[1].isBroken).toBe(true);
  });

  it("wraps errors as firestore/read_failed", async () => {
    vi.mocked(getDocs).mockRejectedValueOnce(new Error("perm"));
    await expect(listTables("t1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });
});

describe("upsertTables", () => {
  it("writes each tableNum via batch.set", async () => {
    await upsertTables("t1", [1, 2, 3]);
    expect(batchSet).toHaveBeenCalledTimes(3);
    const firstPayload = batchSet.mock.calls[0][1] as Record<string, unknown>;
    expect(firstPayload.tableNum).toBe(1);
    expect(firstPayload.isBroken).toBe(false);
    expect(batchCommit).toHaveBeenCalledTimes(1);
  });

  it("wraps commit errors", async () => {
    batchCommit.mockRejectedValueOnce(new Error("perm"));
    await expect(upsertTables("t1", [1])).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("upsertTable", () => {
  it("calls setDoc with { tableNum, isBroken: false, createdAt }", async () => {
    await upsertTable("t1", 5);
    const payload = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
    expect(payload.tableNum).toBe(5);
    expect(payload.isBroken).toBe(false);
  });
});

describe("markTableBroken", () => {
  it("updates with isBroken: true", async () => {
    await markTableBroken("t1", 2);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.isBroken).toBe(true);
  });

  it("wraps errors", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(markTableBroken("t1", 2)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("reopenTable", () => {
  it("updates with isBroken: false", async () => {
    await reopenTable("t1", 3);
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.isBroken).toBe(false);
  });

  it("wraps errors", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(reopenTable("t1", 3)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("subscribeTables", () => {
  it("invokes onNext with table list", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            {
              id: "1",
              data: () => ({ tableNum: 1, isBroken: false, createdAt: ts }),
            },
          ],
        });
        return () => {};
      }) as never,
    );
    subscribeTables("t1", onNext, onError);
    expect(onNext).toHaveBeenCalledWith([
      { id: "1", tableNum: 1, isBroken: false, createdAt: ts },
    ]);
  });

  it("propagates subscribe error", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, _next: unknown, err: (e: unknown) => void) => {
        err(new Error("boom"));
        return () => {};
      }) as never,
    );
    subscribeTables("t1", onNext, onError);
    expect(onError.mock.calls[0][0].code).toBe("firestore/subscribe_failed");
  });

  it("wraps converter throw as firestore/invalid-data", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_ref: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            {
              id: "1",
              data: () => {
                throw new Error("zod mismatch");
              },
            },
          ],
        });
        return () => {};
      }) as never,
    );
    subscribeTables("t1", onNext, onError);
    expect(onNext).not.toHaveBeenCalled();
    expect(onError.mock.calls[0][0].code).toBe("firestore/invalid-data");
  });
});

describe("updateTableLabel", () => {
  it("writes normalized label and color when both are valid", async () => {
    await updateTableLabel("t1", 3, { label: "メイン", color: "#ff0000" });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.label).toBe("メイン");
    expect(payload.color).toBe("#ff0000");
  });

  it("trims surrounding whitespace from label", async () => {
    await updateTableLabel("t1", 1, { label: "  Final  ", color: null });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.label).toBe("Final");
    expect(payload.color).toBeNull();
  });

  it("normalizes empty label string to null", async () => {
    await updateTableLabel("t1", 1, { label: "", color: null });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.label).toBeNull();
  });

  it("normalizes whitespace-only label to null", async () => {
    await updateTableLabel("t1", 1, { label: "   ", color: null });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.label).toBeNull();
  });

  it("passes through explicit null label and null color", async () => {
    await updateTableLabel("t1", 1, { label: null, color: null });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.label).toBeNull();
    expect(payload.color).toBeNull();
  });

  it("accepts uppercase hex color", async () => {
    await updateTableLabel("t1", 1, { label: null, color: "#ABCDEF" });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.color).toBe("#ABCDEF");
  });

  it("throws validation/table-label-invalid when label exceeds max length", async () => {
    const tooLong = "a".repeat(TABLE_LABEL_MAX_LENGTH + 1);
    await expect(
      updateTableLabel("t1", 1, { label: tooLong, color: null }),
    ).rejects.toMatchObject({ code: "validation/table-label-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("accepts label exactly at max length boundary", async () => {
    const exactly = "a".repeat(TABLE_LABEL_MAX_LENGTH);
    await updateTableLabel("t1", 1, { label: exactly, color: null });
    const payload = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(payload.label).toBe(exactly);
  });

  it.each([
    "red",
    "#fff",
    "#1234567",
    "ff0000",
    "#GGGGGG",
  ])("throws validation/table-color-invalid for invalid color %s", async (color) => {
    await expect(
      updateTableLabel("t1", 1, { label: null, color }),
    ).rejects.toMatchObject({ code: "validation/table-color-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("wraps updateDoc errors as firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm"));
    await expect(
      updateTableLabel("t1", 1, { label: "x", color: "#000000" }),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});
