import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

vi.mock("@/lib/firebase/repositories/cardBackgroundStorage", () => ({
  uploadCardBackgroundAsset: vi.fn(),
  deleteCardBackgroundAsset: vi.fn(),
}));

vi.mock("@/lib/services/group", () => ({
  setWinnerCardBackground: vi.fn(),
  setSeasonCardBackground: vi.fn(),
}));

import {
  deleteCardBackgroundAsset,
  uploadCardBackgroundAsset,
} from "@/lib/firebase/repositories/cardBackgroundStorage";
import {
  setSeasonCardBackground,
  setWinnerCardBackground,
} from "@/lib/services/group";

import {
  clearSeasonCardBackground,
  clearWinnerCardBackground,
  updateSeasonCardBackgroundTextTheme,
  updateWinnerCardBackgroundTextTheme,
  uploadAndSetSeasonCardBackground,
  uploadAndSetWinnerCardBackground,
} from "./card-background";

const FIXED_UUID = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.mocked(uploadCardBackgroundAsset).mockReset();
  vi.mocked(deleteCardBackgroundAsset).mockReset();
  vi.mocked(setWinnerCardBackground).mockReset();
  vi.mocked(setSeasonCardBackground).mockReset();
  vi.spyOn(crypto, "randomUUID").mockReturnValue(FIXED_UUID);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function fakeBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])], { type: "image/jpeg" });
}

describe("uploadAndSetWinnerCardBackground", () => {
  it("初回 upload（previousAssetId=null）→ upload + setWinner、delete 呼出なし", async () => {
    vi.mocked(uploadCardBackgroundAsset).mockResolvedValue("https://x/u1");
    vi.mocked(setWinnerCardBackground).mockResolvedValue();

    await uploadAndSetWinnerCardBackground({
      gid: "g1",
      uid: "u1",
      blob: fakeBlob(),
      contentType: "image/jpeg",
      textTheme: "light",
      previousAssetId: null,
    });

    expect(uploadCardBackgroundAsset).toHaveBeenCalledWith(
      "g1",
      FIXED_UUID,
      expect.any(Blob),
      "image/jpeg",
    );
    expect(setWinnerCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u1",
      value: {
        imageUrl: "https://x/u1",
        storageAssetId: FIXED_UUID,
        textTheme: "light",
      },
    });
    expect(deleteCardBackgroundAsset).not.toHaveBeenCalled();
  });

  it("差し替え（previousAssetId あり）→ upload + setWinner + delete 1 回", async () => {
    vi.mocked(uploadCardBackgroundAsset).mockResolvedValue("https://x/u2");
    vi.mocked(setWinnerCardBackground).mockResolvedValue();
    vi.mocked(deleteCardBackgroundAsset).mockResolvedValue();

    await uploadAndSetWinnerCardBackground({
      gid: "g1",
      uid: "u1",
      blob: fakeBlob(),
      contentType: "image/jpeg",
      textTheme: "dark",
      previousAssetId: "prev-asset",
    });

    expect(uploadCardBackgroundAsset).toHaveBeenCalledTimes(1);
    expect(setWinnerCardBackground).toHaveBeenCalledTimes(1);
    expect(deleteCardBackgroundAsset).toHaveBeenCalledTimes(1);
    expect(deleteCardBackgroundAsset).toHaveBeenCalledWith("g1", "prev-asset");
  });

  it("旧 asset 削除 3 回失敗 → logger.warn 'orphan card background asset' で抑止", async () => {
    vi.mocked(uploadCardBackgroundAsset).mockResolvedValue("https://x/u3");
    vi.mocked(setWinnerCardBackground).mockResolvedValue();
    vi.mocked(deleteCardBackgroundAsset).mockRejectedValue(new Error("net"));
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    await uploadAndSetWinnerCardBackground({
      gid: "g1",
      uid: "u1",
      blob: fakeBlob(),
      contentType: "image/jpeg",
      textTheme: "light",
      previousAssetId: "prev",
    });

    expect(deleteCardBackgroundAsset).toHaveBeenCalledTimes(3);
    // 最終失敗時に 1 本の warn が積まれる
    const orphanCalls = warnSpy.mock.calls.filter(
      (c) => c[0] === "orphan card background asset",
    );
    expect(orphanCalls.length).toBe(1);
    expect(orphanCalls[0]?.[1]).toMatchObject({
      kind: "winner",
      gid: "g1",
      assetId: "prev",
    });
  });

  it("upload 自体が失敗したら setWinner も delete も呼ばれない", async () => {
    vi.mocked(uploadCardBackgroundAsset).mockRejectedValue(new Error("upload"));
    await expect(
      uploadAndSetWinnerCardBackground({
        gid: "g1",
        uid: "u1",
        blob: fakeBlob(),
        contentType: "image/jpeg",
        textTheme: "light",
        previousAssetId: "prev",
      }),
    ).rejects.toThrow("upload");
    expect(setWinnerCardBackground).not.toHaveBeenCalled();
    expect(deleteCardBackgroundAsset).not.toHaveBeenCalled();
  });
});

describe("uploadAndSetSeasonCardBackground", () => {
  it("season も winner と同型 dispatch（setSeason / 旧 delete）", async () => {
    vi.mocked(uploadCardBackgroundAsset).mockResolvedValue("https://x/s1");
    vi.mocked(setSeasonCardBackground).mockResolvedValue();
    vi.mocked(deleteCardBackgroundAsset).mockResolvedValue();

    await uploadAndSetSeasonCardBackground({
      gid: "g1",
      uid: "u1",
      blob: fakeBlob(),
      contentType: "image/png",
      textTheme: "dark",
      previousAssetId: "prev-s",
    });

    expect(setSeasonCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u1",
      value: {
        imageUrl: "https://x/s1",
        storageAssetId: FIXED_UUID,
        textTheme: "dark",
      },
    });
    expect(deleteCardBackgroundAsset).toHaveBeenCalledWith("g1", "prev-s");
  });
});

describe("clearWinnerCardBackground", () => {
  it("既存 asset 解除 → setWinner({value:null}) + delete 1 回", async () => {
    vi.mocked(setWinnerCardBackground).mockResolvedValue();
    vi.mocked(deleteCardBackgroundAsset).mockResolvedValue();

    await clearWinnerCardBackground({
      gid: "g1",
      uid: "u1",
      previousAssetId: "p1",
    });
    expect(setWinnerCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u1",
      value: null,
    });
    expect(deleteCardBackgroundAsset).toHaveBeenCalledTimes(1);
  });

  it("既存未設定 → setWinner({value:null}) のみ（delete 呼出なし）", async () => {
    vi.mocked(setWinnerCardBackground).mockResolvedValue();
    await clearWinnerCardBackground({
      gid: "g1",
      uid: "u1",
      previousAssetId: null,
    });
    expect(setWinnerCardBackground).toHaveBeenCalledTimes(1);
    expect(deleteCardBackgroundAsset).not.toHaveBeenCalled();
  });
});

describe("clearSeasonCardBackground", () => {
  it("season も winner と対称（setSeason({value:null}) + delete）", async () => {
    vi.mocked(setSeasonCardBackground).mockResolvedValue();
    vi.mocked(deleteCardBackgroundAsset).mockResolvedValue();

    await clearSeasonCardBackground({
      gid: "g1",
      uid: "u1",
      previousAssetId: "ps",
    });
    expect(setSeasonCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u1",
      value: null,
    });
    expect(deleteCardBackgroundAsset).toHaveBeenCalledTimes(1);
  });
});

describe("updateWinner/SeasonCardBackgroundTextTheme", () => {
  it("winner: 画像 / assetId は据え置きで textTheme のみ差替 → upload 呼出なし", async () => {
    vi.mocked(setWinnerCardBackground).mockResolvedValue();

    await updateWinnerCardBackgroundTextTheme({
      gid: "g1",
      uid: "u1",
      current: {
        imageUrl: "https://x/keep",
        storageAssetId: "keep-id",
        textTheme: "light",
      },
      textTheme: "dark",
    });
    expect(uploadCardBackgroundAsset).not.toHaveBeenCalled();
    expect(setWinnerCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u1",
      value: {
        imageUrl: "https://x/keep",
        storageAssetId: "keep-id",
        textTheme: "dark",
      },
    });
  });

  it("season: 対称（setSeason + 画像据え置き）", async () => {
    vi.mocked(setSeasonCardBackground).mockResolvedValue();

    await updateSeasonCardBackgroundTextTheme({
      gid: "g1",
      uid: "u1",
      current: {
        imageUrl: "https://x/k2",
        storageAssetId: "k2",
        textTheme: "dark",
      },
      textTheme: "light",
    });
    expect(setSeasonCardBackground).toHaveBeenCalledWith({
      gid: "g1",
      uid: "u1",
      value: {
        imageUrl: "https://x/k2",
        storageAssetId: "k2",
        textTheme: "light",
      },
    });
  });
});
