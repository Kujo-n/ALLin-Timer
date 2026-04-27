import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

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
    addDoc: vi.fn(),
    getDoc: vi.fn(),
    updateDoc: vi.fn(),
    deleteDoc: vi.fn(),
    arrayRemove: vi.fn((...args: unknown[]) => ({ __op: "arrayRemove", args })),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import { addDoc, arrayRemove, updateDoc } from "firebase/firestore";

import { AppError } from "@/lib/errors";

import {
  createGroup,
  removeMemberSelf,
  updateAudioSettings,
  updateFinishedTournamentCount,
  updateGroupRoles,
} from "./groups";

const now = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
void now;

beforeEach(() => {
  vi.mocked(addDoc).mockReset();
  vi.mocked(updateDoc).mockReset();
  vi.mocked(arrayRemove).mockReset();
});

describe("createGroup", () => {
  it("writes ownerUids / organizerUids / memberUids all containing the owner", async () => {
    vi.mocked(addDoc).mockResolvedValue({ id: "g-new" } as never);

    const gid = await createGroup({ name: "Saturday", ownerUid: "u1" });

    expect(gid).toBe("g-new");
    expect(addDoc).toHaveBeenCalledTimes(1);
    const [, body] = vi.mocked(addDoc).mock.calls[0];
    expect(body).toMatchObject({
      name: "Saturday",
      ownerUids: ["u1"],
      organizerUids: ["u1"],
      memberUids: ["u1"],
      joinCodeId: null,
    });
  });
});

describe("updateGroupRoles", () => {
  it("forwards the patch as-is to updateDoc", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateGroupRoles("g1", {
      ownerUids: ["u1", "u2"],
      organizerUids: ["u1", "u2", "u3"],
    });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({
      ownerUids: ["u1", "u2"],
      organizerUids: ["u1", "u2", "u3"],
    });
  });
});

describe("updateAudioSettings", () => {
  it("writes audioSettings as a single object field", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateAudioSettings("g1", {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.5,
    });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({
      audioSettings: {
        enabled: true,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      },
    });
  });

  it("rejects volume out of range before any write", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await expect(
      updateAudioSettings("g1", {
        enabled: true,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 1.5,
      }),
    ).rejects.toBeInstanceOf(AppError);
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("wraps Firestore errors with firestore/write_failed code", async () => {
    vi.mocked(updateDoc).mockRejectedValue(new Error("boom") as never);

    await expect(
      updateAudioSettings("g1", {
        enabled: false,
        levelUpSoundId: "default:blind-up",
        winnerSoundId: "default:victory-chime",
        volume: 0.5,
      }),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("updateFinishedTournamentCount", () => {
  it("calls updateDoc with the given non-negative int", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateFinishedTournamentCount("g1", 12);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ finishedTournamentCount: 12 });
  });

  it("rejects negative values with validation code", async () => {
    await expect(updateFinishedTournamentCount("g1", -1)).rejects.toMatchObject({
      code: "validation/finished-count-invalid",
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("rejects non-integer values with validation code", async () => {
    await expect(updateFinishedTournamentCount("g1", 1.5)).rejects.toMatchObject({
      code: "validation/finished-count-invalid",
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("wraps updateDoc errors as firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm") as never);
    await expect(updateFinishedTournamentCount("g1", 5)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("removeMemberSelf", () => {
  it("applies arrayRemove to all 3 role arrays in a single update", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(arrayRemove).mockImplementation(
      (...args: unknown[]) => ({ __op: "arrayRemove", args }) as never,
    );

    await removeMemberSelf("g1", "u-leaver");

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toMatchObject({
      memberUids: { __op: "arrayRemove", args: ["u-leaver"] },
      organizerUids: { __op: "arrayRemove", args: ["u-leaver"] },
      ownerUids: { __op: "arrayRemove", args: ["u-leaver"] },
    });
  });
});
