import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("firebase/firestore", async () => {
  const actual =
    await vi.importActual<typeof import("firebase/firestore")>("firebase/firestore");
  return {
    ...actual,
    collectionGroup: vi.fn(() => ({ __ref: "collectionGroup" })),
    query: vi.fn((...args) => ({ __ref: "query", args })),
    where: vi.fn((...args) => ({ __ref: "where", args })),
    onSnapshot: vi.fn(),
  };
});

import { onSnapshot } from "firebase/firestore";

import { subscribePlayersByUid } from "./playersByUid";

const ts = Timestamp.fromMillis(0);

function validData(uid: string) {
  return {
    uid,
    displayName: uid.toUpperCase(),
    entryAt: ts,
    isBusted: false,
    bustedAt: null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
    isPlayingDealer: false,
  };
}

function makeDoc(opts: {
  pid: string;
  data: () => unknown;
  parentTid: string | null;
}) {
  const tournamentDocRef = opts.parentTid === null ? null : { id: opts.parentTid };
  return {
    id: opts.pid,
    data: opts.data,
    ref: { parent: { parent: tournamentDocRef } },
  };
}

beforeEach(() => {
  vi.mocked(onSnapshot).mockReset();
});

describe("subscribePlayersByUid", () => {
  it("emits { tid, player } pairs derived from collectionGroup snapshots", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_q: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            makeDoc({ pid: "u1", data: () => validData("u1"), parentTid: "t1" }),
            makeDoc({ pid: "u1", data: () => validData("u1"), parentTid: "t2" }),
          ],
        });
        return () => {};
      }) as never,
    );

    subscribePlayersByUid("u1", onNext, onError);
    expect(onNext).toHaveBeenCalledTimes(1);
    const items = onNext.mock.calls[0][0] as Array<{ tid: string; player: { id: string } }>;
    expect(items.map((i) => i.tid).sort()).toEqual(["t1", "t2"]);
    expect(items.every((i) => i.player.id === "u1")).toBe(true);
    expect(onError).not.toHaveBeenCalled();
  });

  it("skips docs whose parent.parent is null (defensive guard)", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_q: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            makeDoc({ pid: "u1", data: () => validData("u1"), parentTid: null }),
            makeDoc({ pid: "u1", data: () => validData("u1"), parentTid: "t1" }),
          ],
        });
        return () => {};
      }) as never,
    );

    subscribePlayersByUid("u1", onNext, onError);
    const items = onNext.mock.calls[0][0] as Array<{ tid: string }>;
    expect(items).toHaveLength(1);
    expect(items[0].tid).toBe("t1");
  });

  it("skips schema-invalid docs and warns via logger (does not propagate)", () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_q: unknown, next: (s: unknown) => void) => {
        next({
          docs: [
            makeDoc({
              pid: "broken",
              data: () => ({ uid: 123 }), // zod parse fails on uid type
              parentTid: "t1",
            }),
            makeDoc({
              pid: "u-ok",
              data: () => validData("u-ok"),
              parentTid: "t1",
            }),
          ],
        });
        return () => {};
      }) as never,
    );

    subscribePlayersByUid("u-ok", onNext, onError);
    const items = onNext.mock.calls[0][0] as Array<{ player: { id: string } }>;
    expect(items).toHaveLength(1);
    expect(items[0].player.id).toBe("u-ok");
    expect(warnSpy).toHaveBeenCalledWith(
      "subscribePlayersByUid skip invalid",
      expect.objectContaining({ pid: "broken" }),
    );
    expect(onError).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("propagates subscription errors as AppError firestore/subscribe_failed", () => {
    const onNext = vi.fn();
    const onError = vi.fn();
    vi.mocked(onSnapshot).mockImplementationOnce(
      ((_q: unknown, _next: unknown, err: (e: unknown) => void) => {
        err(new Error("perm"));
        return () => {};
      }) as never,
    );
    subscribePlayersByUid("u1", onNext, onError);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0].code).toBe("firestore/subscribe_failed");
  });

  it("returns the unsubscribe function from onSnapshot", () => {
    const unsub = vi.fn();
    vi.mocked(onSnapshot).mockReturnValueOnce(unsub as never);
    const ret = subscribePlayersByUid("u1", vi.fn(), vi.fn());
    expect(ret).toBe(unsub);
  });
});
