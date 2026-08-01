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
    arrayUnion: vi.fn((...args: unknown[]) => ({ __op: "arrayUnion", args })),
    deleteField: vi.fn(() => ({ __op: "deleteField" })),
    serverTimestamp: vi.fn(() => ({ __op: "serverTimestamp" })),
  };
});

vi.mock("@/lib/firebase/converters", () => ({
  zodConverter: vi.fn(() => ({})),
}));

import {
  addDoc,
  arrayRemove,
  arrayUnion,
  deleteField,
  getDoc,
  updateDoc,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import {
  addSelfViaTournamentEntry,
  createGroup,
  getGroupIfMember,
  removeMemberSelf,
  removeOtherMember,
  updateAudioSettings,
  updateDefaultSeatsPerTable,
  updateFinishedTournamentCount,
  updateGroupRoles,
  updateLatestJoinCodeId,
  updateSeasonCardBackground,
  updateSeasonPointsRule,
  updateWinnerCardBackground,
  validateCardBackground,
} from "./groups";

beforeEach(() => {
  vi.mocked(addDoc).mockReset();
  vi.mocked(updateDoc).mockReset();
  vi.mocked(getDoc).mockReset();
  vi.mocked(arrayRemove).mockReset();
  vi.mocked(deleteField).mockReset();
  vi.mocked(arrayUnion)
    .mockReset()
    .mockImplementation((...args: unknown[]) => ({ __op: "arrayUnion", args }) as never);
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
      winnerCardBackground: null,
      seasonCardBackground: null,
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

describe("updateLatestJoinCodeId", () => {
  it("writes latestJoinCodeId as a single field (string)", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateLatestJoinCodeId("g1", "abc123");

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ latestJoinCodeId: "abc123" });
  });

  it("allows null (release pointer)", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await updateLatestJoinCodeId("g1", null);

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ latestJoinCodeId: null });
  });

  it("wraps Firestore errors with firestore/write_failed code", async () => {
    vi.mocked(updateDoc).mockRejectedValue(new Error("boom") as never);

    await expect(updateLatestJoinCodeId("g1", "abc")).rejects.toMatchObject({
      code: "firestore/write_failed",
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

describe("updateDefaultSeatsPerTable", () => {
  it("calls updateDoc with { defaultSeatsPerTable: value } for valid integers in [2,10]", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateDefaultSeatsPerTable("g1", 6);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ defaultSeatsPerTable: 6 });
  });

  it.each([2, 10])("accepts boundary value %p", async (value) => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateDefaultSeatsPerTable("g1", value);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ defaultSeatsPerTable: value });
  });

  it.each([1, 11, 0, -1, 5.5, NaN, Infinity])(
    "rejects %p with validation/default-seats-invalid",
    async (bad) => {
      await expect(updateDefaultSeatsPerTable("g1", bad as number)).rejects.toMatchObject({
        code: "validation/default-seats-invalid",
      });
      expect(updateDoc).not.toHaveBeenCalled();
    },
  );

  it("wraps Firestore reject as firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm") as never);
    await expect(updateDefaultSeatsPerTable("g1", 6)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("updateSeasonPointsRule (Phase E)", () => {
  it("calls updateDoc with { seasonPointsRule: { base, baseline } } for valid rule", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateSeasonPointsRule("g1", { base: [10, 7, 5], baseline: 8 });
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({
      seasonPointsRule: { base: [10, 7, 5], baseline: 8 },
    });
  });

  it("calls updateDoc with { seasonPointsRule: null } for reset", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateSeasonPointsRule("g1", null);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ seasonPointsRule: null });
  });

  it("rejects empty base array (length < 1)", async () => {
    await expect(updateSeasonPointsRule("g1", { base: [], baseline: 8 })).rejects.toMatchObject({
      code: "validation/season-points-rule-invalid",
    });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("rejects base array longer than 9", async () => {
    await expect(
      updateSeasonPointsRule("g1", {
        base: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
        baseline: 8,
      }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("rejects negative element in base", async () => {
    await expect(
      updateSeasonPointsRule("g1", { base: [10, -1, 5], baseline: 8 }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("rejects non-finite element in base", async () => {
    await expect(
      updateSeasonPointsRule("g1", {
        base: [10, NaN as unknown as number, 5],
        baseline: 8,
      }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it.each([1, 11, 8.5, 0, -1])("rejects baseline %p as out of range or non-int", async (bad) => {
    await expect(
      updateSeasonPointsRule("g1", { base: [10], baseline: bad as number }),
    ).rejects.toMatchObject({ code: "validation/season-points-rule-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("wraps Firestore reject as firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm") as never);
    await expect(updateSeasonPointsRule("g1", { base: [10], baseline: 8 })).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("validateCardBackground (Phase A.1)", () => {
  it("accepts null", () => {
    expect(() => validateCardBackground(null)).not.toThrow();
  });

  it("accepts a fully-set object with light theme", () => {
    expect(() =>
      validateCardBackground({
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: "asset-1",
        textTheme: "light",
      }),
    ).not.toThrow();
  });

  it("accepts a fully-set object with dark theme", () => {
    expect(() =>
      validateCardBackground({
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: "asset-1",
        textTheme: "dark",
      }),
    ).not.toThrow();
  });

  it("accepts both imageUrl and storageAssetId null (text-theme-only state)", () => {
    expect(() =>
      validateCardBackground({
        imageUrl: null,
        storageAssetId: null,
        textTheme: "light",
      }),
    ).not.toThrow();
  });

  it("rejects imageUrl set but storageAssetId null (asymmetric)", () => {
    expect(() =>
      validateCardBackground({
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: null,
        textTheme: "light",
      }),
    ).toThrowError(expect.objectContaining({ code: "validation/card-background-invalid" }));
  });

  it("rejects imageUrl null but storageAssetId set (asymmetric)", () => {
    expect(() =>
      validateCardBackground({
        imageUrl: null,
        storageAssetId: "asset-1",
        textTheme: "light",
      }),
    ).toThrowError(expect.objectContaining({ code: "validation/card-background-invalid" }));
  });

  it("rejects unknown textTheme value", () => {
    expect(() =>
      validateCardBackground({
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: "asset-1",
        // @ts-expect-error — verifying runtime rejection of an out-of-enum value
        textTheme: "auto",
      }),
    ).toThrowError(expect.objectContaining({ code: "validation/card-background-invalid" }));
  });
});

describe("updateWinnerCardBackground (Phase A.1)", () => {
  it("calls updateDoc with { winnerCardBackground: null } for reset", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateWinnerCardBackground("g1", null);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({ winnerCardBackground: null });
  });

  it("calls updateDoc with { winnerCardBackground: {...} } for a valid object", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateWinnerCardBackground("g1", {
      imageUrl: "https://example.com/x.jpg",
      storageAssetId: "asset-1",
      textTheme: "light",
    });
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({
      winnerCardBackground: {
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: "asset-1",
        textTheme: "light",
      },
    });
  });

  it("rejects asymmetric values with validation/card-background-invalid before any write", async () => {
    await expect(
      updateWinnerCardBackground("g1", {
        imageUrl: "https://example.com/x.jpg",
        storageAssetId: null,
        textTheme: "light",
      }),
    ).rejects.toMatchObject({ code: "validation/card-background-invalid" });
    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("wraps Firestore reject as firestore/write_failed", async () => {
    vi.mocked(updateDoc).mockRejectedValueOnce(new Error("perm") as never);
    await expect(updateWinnerCardBackground("g1", null)).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
  });
});

describe("updateSeasonCardBackground (Phase A.1)", () => {
  it("calls updateDoc with the field name 'seasonCardBackground'", async () => {
    vi.mocked(updateDoc).mockResolvedValueOnce(undefined as never);
    await updateSeasonCardBackground("g1", {
      imageUrl: "https://example.com/season.jpg",
      storageAssetId: "asset-s-1",
      textTheme: "dark",
    });
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({
      seasonCardBackground: {
        imageUrl: "https://example.com/season.jpg",
        storageAssetId: "asset-s-1",
        textTheme: "dark",
      },
    });
  });
});

describe("addSelfViaTournamentEntry (08-auto-group-join-on-entry Phase 1)", () => {
  it("writes memberUids via arrayUnion + proof + self-key displayName only", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await addSelfViaTournamentEntry("g1", "u-new", { tid: "t1", displayName: "Alice" });

    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    // rule の affectedKeys().hasOnly([...]) と 1:1 対応する形。
    // dot-path（memberDisplayNames.<uid>）にしないと map 全体を上書きして
    // 他メンバーの entry を消し、self-key 限定の rule 条件で deny される。
    expect(patch).toEqual({
      memberUids: { __op: "arrayUnion", args: ["u-new"] },
      joinedViaTournamentId: "t1",
      "memberDisplayNames.u-new": "Alice",
    });
  });

  it("trims the displayName before writing", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await addSelfViaTournamentEntry("g1", "u-new", { tid: "t1", displayName: "  Alice  " });

    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toMatchObject({ "memberDisplayNames.u-new": "Alice" });
  });

  it("rejects an empty / whitespace-only displayName without writing (rule requires size() >= 1)", async () => {
    await expect(
      addSelfViaTournamentEntry("g1", "u-new", { tid: "t1", displayName: "   " }),
    ).rejects.toMatchObject({ code: "validation/display-name-required" });

    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("rejects a displayName longer than 15 chars without writing (rule requires size() <= 15)", async () => {
    await expect(
      addSelfViaTournamentEntry("g1", "u-new", {
        tid: "t1",
        displayName: "0123456789abcdef", // 16 字
      }),
    ).rejects.toMatchObject({ code: "validation/display-name-too-long" });

    expect(updateDoc).not.toHaveBeenCalled();
  });

  it("accepts exactly 15 chars (boundary)", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);

    await addSelfViaTournamentEntry("g1", "u-new", {
      tid: "t1",
      displayName: "0123456789abcde", // 15 字
    });

    expect(updateDoc).toHaveBeenCalledTimes(1);
  });

  it("wraps Firestore errors with firestore/write_failed code", async () => {
    vi.mocked(updateDoc).mockRejectedValue(new Error("permission denied") as never);

    await expect(
      addSelfViaTournamentEntry("g1", "u-new", { tid: "t1", displayName: "Alice" }),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });
  });
});

describe("getGroupIfMember (membership probe)", () => {
  it("returns the group with its id when readable", async () => {
    vi.mocked(getDoc).mockResolvedValue({
      exists: () => true,
      id: "g1",
      data: () => ({ name: "Saturday", memberUids: ["u1"] }),
    } as never);

    const group = await getGroupIfMember("g1");

    expect(group).toMatchObject({ id: "g1", name: "Saturday", memberUids: ["u1"] });
  });

  it("returns null for a missing doc", async () => {
    vi.mocked(getDoc).mockResolvedValue({ exists: () => false } as never);

    await expect(getGroupIfMember("g1")).resolves.toBeNull();
  });

  it("returns null WITHOUT a warn log when the read is denied (non-member is the normal path)", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(getDoc).mockRejectedValue(
      Object.assign(new Error("Missing or insufficient permissions."), {
        code: "permission-denied",
      }) as never,
    );

    await expect(getGroupIfMember("g1")).resolves.toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it("still warns and throws for unexpected failures", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(getDoc).mockRejectedValue(new Error("network down") as never);

    await expect(getGroupIfMember("g1")).rejects.toMatchObject({
      code: "firestore/read_failed",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
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

/**
 * Phase 4 (08-auto-group-join-on-entry): owner による他メンバー除外の書込形。
 *
 * `removeMemberSelf`（自己脱退）と対になるが、**dotted path での
 * `memberDisplayNames.<uid>` 削除**を伴う点だけが違う。ここを取りこぼすと
 * 除外済みメンバーの表示名が map に残留するため、patch の形を固定する。
 */
describe("removeOtherMember", () => {
  it("removes the target from all 3 role arrays and deletes its display name in one update", async () => {
    vi.mocked(updateDoc).mockResolvedValue(undefined as never);
    vi.mocked(arrayRemove).mockImplementation(
      (...args: unknown[]) => ({ __op: "arrayRemove", args }) as never,
    );
    vi.mocked(deleteField).mockImplementation(() => ({ __op: "deleteField" }) as never);

    await removeOtherMember("g1", "u-target");

    // 3 配列 + displayName 削除を **1 回の updateDoc** で atomic に当てる
    // （複数 update に割ると invariant ownerUids ⊆ organizerUids ⊆ memberUids が
    //   一時的に破れる）。
    expect(updateDoc).toHaveBeenCalledTimes(1);
    const [, patch] = vi.mocked(updateDoc).mock.calls[0];
    expect(patch).toEqual({
      memberUids: { __op: "arrayRemove", args: ["u-target"] },
      organizerUids: { __op: "arrayRemove", args: ["u-target"] },
      ownerUids: { __op: "arrayRemove", args: ["u-target"] },
      // dotted path。map 全体の置換ではなく該当キーだけを消す。
      "memberDisplayNames.u-target": { __op: "deleteField" },
    });
  });

  it("wraps Firestore errors with firestore/write_failed code", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
    vi.mocked(updateDoc).mockRejectedValue(new Error("boom") as never);

    await expect(removeOtherMember("g1", "u-target")).rejects.toMatchObject({
      code: "firestore/write_failed",
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);

    warnSpy.mockRestore();
  });
});
