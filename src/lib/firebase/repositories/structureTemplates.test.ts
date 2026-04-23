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
    addDoc: vi.fn(),
    getDoc: vi.fn(),
    getDocs: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { addDoc, deleteDoc, getDoc, getDocs, updateDoc } from "firebase/firestore";

import {
  createStructureTemplate,
  deleteStructureTemplate,
  getStructureTemplate,
  listStructureTemplates,
  updateStructureTemplate,
} from "./structureTemplates";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const later = Timestamp.fromDate(new Date("2026-04-20T00:00:00Z"));

const baseInput = {
  name: "Standard",
  description: "平均的な進行",
  initialStack: 10000,
  lateEntryDeadlineLevel: 6,
  levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
  createdByUid: "u1",
  createdByDisplayName: "たろう",
};

beforeEach(() => {
  vi.mocked(addDoc).mockReset();
  vi.mocked(getDoc).mockReset();
  vi.mocked(getDocs).mockReset();
  vi.mocked(updateDoc).mockReset();
  vi.mocked(deleteDoc).mockReset();
});

describe("createStructureTemplate", () => {
  it("normalizes undefined rebuyStack / addOnStack to null", async () => {
    vi.mocked(addDoc).mockResolvedValue({ id: "tid-new" } as never);

    const tid = await createStructureTemplate({
      ...baseInput,
      rebuyStack: undefined,
      addOnStack: undefined,
    });

    expect(tid).toBe("tid-new");
    expect(addDoc).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(addDoc).mock.calls[0];
    expect(body).toMatchObject({
      name: "Standard",
      rebuyStack: null,
      addOnStack: null,
      createdByUid: "u1",
      createdByDisplayName: "たろう",
    });
    expect((body as Record<string, unknown>).createdAt).toEqual({ __op: "serverTimestamp" });
  });

  it("normalizes undefined description to empty string", async () => {
    vi.mocked(addDoc).mockResolvedValue({ id: "tid-new" } as never);

    await createStructureTemplate({ ...baseInput, description: undefined as unknown as string });

    const [, body] = vi.mocked(addDoc).mock.calls[0];
    expect((body as Record<string, unknown>).description).toBe("");
  });

  it("wraps addDoc failure into AppError", async () => {
    vi.mocked(addDoc).mockRejectedValue(new Error("permission-denied"));

    await expect(createStructureTemplate(baseInput)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });

  it("preserves explicit rebuyStack / addOnStack values", async () => {
    vi.mocked(addDoc).mockResolvedValue({ id: "tid-new" } as never);

    await createStructureTemplate({
      ...baseInput,
      rebuyStack: 5000,
      addOnStack: 7500,
    });

    const [, body] = vi.mocked(addDoc).mock.calls[0];
    expect((body as Record<string, unknown>).rebuyStack).toBe(5000);
    expect((body as Record<string, unknown>).addOnStack).toBe(7500);
  });
});

describe("getStructureTemplate", () => {
  it("returns doc with id merged in when found", async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: "tid-1",
      data: () => ({ ...baseInput, rebuyStack: null, addOnStack: null, createdAt: now }),
    } as never);

    const result = await getStructureTemplate("tid-1");
    expect(result.id).toBe("tid-1");
    expect(result.name).toBe("Standard");
  });

  it("throws firestore/not-found when doc missing", async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);

    await expect(getStructureTemplate("missing")).rejects.toMatchObject({
      code: "firestore/not-found",
    });
  });

  it("wraps getDoc failure into firestore/read_failed", async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error("network-error"));

    await expect(getStructureTemplate("tid-1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });
});

describe("listStructureTemplates", () => {
  it("sorts by createdAt desc and returns id + data", async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        {
          id: "t-old",
          data: () => ({ ...baseInput, rebuyStack: null, addOnStack: null, createdAt: now }),
        },
        {
          id: "t-new",
          data: () => ({ ...baseInput, rebuyStack: null, addOnStack: null, createdAt: later }),
        },
      ],
    } as never);

    const list = await listStructureTemplates();
    expect(list.map((t) => t.id)).toEqual(["t-new", "t-old"]);
  });

  it("skips docs that fail schema validation", async () => {
    vi.mocked(getDocs).mockResolvedValue({
      docs: [
        {
          id: "valid",
          data: () => ({ ...baseInput, rebuyStack: null, addOnStack: null, createdAt: now }),
        },
        {
          id: "invalid",
          data: () => {
            throw new Error("schema invalid");
          },
        },
      ],
    } as never);

    const list = await listStructureTemplates();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe("valid");
  });

  it("wraps getDocs failure into firestore/read_failed", async () => {
    vi.mocked(getDocs).mockRejectedValue(new Error("offline"));

    await expect(listStructureTemplates()).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
  });
});

describe("updateStructureTemplate", () => {
  it("forwards patch and normalizes explicit-undefined rebuyStack to null", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateStructureTemplate("tid-1", {
      name: "renamed",
      rebuyStack: undefined,
    });

    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ name: "renamed", rebuyStack: null });
  });

  it("does not inject rebuyStack when absent from patch", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateStructureTemplate("tid-1", { name: "renamed" });

    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ name: "renamed" });
  });

  it("normalizes explicit-undefined description / addOnStack to empty / null", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateStructureTemplate("tid-1", {
      description: undefined,
      addOnStack: undefined,
    });

    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ description: "", addOnStack: null });
  });

  it("wraps updateDoc failure into firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValue(new Error("permission-denied"));

    await expect(updateStructureTemplate("tid-1", { name: "x" })).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("deleteStructureTemplate", () => {
  it("calls deleteDoc with the template ref", async () => {
    vi.mocked(deleteDoc).mockResolvedValue(undefined as never);

    await deleteStructureTemplate("tid-1");

    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it("wraps deleteDoc failure into firestore/write_failed", async () => {
    vi.mocked(deleteDoc).mockRejectedValue(new Error("permission-denied"));

    await expect(deleteStructureTemplate("tid-1")).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});
