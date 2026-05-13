import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual = await vi.importActual<typeof import("firebase/firestore")>(
    "firebase/firestore",
  );
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

import { deleteDoc, doc } from "firebase/firestore";

import { deleteJoinCode } from "./groupJoinCodes";

beforeEach(() => {
  vi.mocked(deleteDoc).mockReset();
  vi.mocked(doc).mockClear();
});

describe("deleteJoinCode", () => {
  it("calls deleteDoc with the join code doc ref", async () => {
    vi.mocked(deleteDoc).mockResolvedValue(undefined as never);

    await deleteJoinCode("abc123");

    expect(deleteDoc).toHaveBeenCalledTimes(1);
    const [ref] = vi.mocked(deleteDoc).mock.calls[0];
    // joinCodeDocRef("abc123") は doc(groupJoinCodesRef, "abc123") を返す
    expect(ref).toEqual({ __ref: "doc", id: "abc123" });
  });

  it("wraps Firestore errors as firestore/write_failed", async () => {
    vi.mocked(deleteDoc).mockRejectedValue(new Error("boom") as never);

    await expect(deleteJoinCode("abc")).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});
