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
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    deleteDoc: vi.fn(),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { deleteDoc, getDoc, setDoc } from "firebase/firestore";

import { grantTemplateAdmin, isTemplateAdmin, revokeTemplateAdmin } from "./templateAdmins";

const _now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
void _now;

beforeEach(() => {
  vi.mocked(getDoc).mockReset();
  vi.mocked(setDoc).mockReset();
  vi.mocked(deleteDoc).mockReset();
});

describe("isTemplateAdmin", () => {
  it("returns true when doc exists", async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => true } as never);
    await expect(isTemplateAdmin("admin-uid")).resolves.toBe(true);
  });

  it("returns false when doc does not exist", async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);
    await expect(isTemplateAdmin("other-uid")).resolves.toBe(false);
  });

  it("returns false when getDoc rejects (permission-denied)", async () => {
    vi.mocked(getDoc).mockRejectedValue(new Error("permission-denied"));
    await expect(isTemplateAdmin("other-uid")).resolves.toBe(false);
  });
});

describe("grantTemplateAdmin", () => {
  it("calls setDoc with serverTimestamp createdAt", async () => {
    vi.mocked(setDoc).mockResolvedValue(undefined as never);
    await grantTemplateAdmin("u-new-admin");

    expect(setDoc).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(setDoc).mock.calls[0];
    expect(body).toEqual({ createdAt: { __op: "serverTimestamp" } });
  });

  it("wraps setDoc failure into AppError", async () => {
    vi.mocked(setDoc).mockRejectedValue(new Error("permission-denied"));
    await expect(grantTemplateAdmin("u")).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("revokeTemplateAdmin", () => {
  it("calls deleteDoc", async () => {
    vi.mocked(deleteDoc).mockResolvedValue(undefined as never);
    await revokeTemplateAdmin("u-ex-admin");
    expect(deleteDoc).toHaveBeenCalledTimes(1);
  });

  it("wraps deleteDoc failure into AppError", async () => {
    vi.mocked(deleteDoc).mockRejectedValue(new Error("permission-denied"));
    await expect(revokeTemplateAdmin("u")).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});
