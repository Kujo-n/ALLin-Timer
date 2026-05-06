import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { CreateTournamentInput } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  createTournament: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/players", () => ({
  clonePlayersFromTournament: vi.fn(),
}));

import { clonePlayersFromTournament } from "@/lib/firebase/repositories/players";
import { createTournament } from "@/lib/firebase/repositories/tournaments";

import { cloneTournamentWithPlayers } from "./tournament-clone";

const baseCreate: CreateTournamentInput = {
  groupId: "g1",
  createdByUid: "u1",
  name: "Next Tournament",
  seatsPerTable: 9,
  structureSnapshot: {
    name: "Default",
    initialStack: 10000,
    rebuyStack: null,
    addOnStack: null,
    lateEntryDeadlineLevel: 6,
    levels: [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
    ],
  },
};

beforeEach(() => {
  vi.mocked(createTournament).mockReset();
  vi.mocked(clonePlayersFromTournament).mockReset();
});

describe("cloneTournamentWithPlayers", () => {
  it("happy: createTournament → clonePlayers の順で呼び、{ newTid, cloned } を返す", async () => {
    vi.mocked(createTournament).mockResolvedValueOnce("new-tid-1");
    vi.mocked(clonePlayersFromTournament).mockResolvedValueOnce(3);

    const result = await cloneTournamentWithPlayers({
      srcTid: "src-1",
      selectedPlayerIds: ["u1", "u2", "u3"],
      create: baseCreate,
    });

    expect(result).toEqual({ newTid: "new-tid-1", cloned: 3 });
    expect(createTournament).toHaveBeenCalledWith(baseCreate);
    expect(clonePlayersFromTournament).toHaveBeenCalledWith(
      "src-1",
      "new-tid-1",
      ["u1", "u2", "u3"],
    );
  });

  it("clone 失敗時: AppError をそのまま伝搬し、createTournament は実行済み（rollback しない）", async () => {
    vi.mocked(createTournament).mockResolvedValueOnce("new-tid-2");
    const cloneErr = new AppError(
      "コピー対象の参加者が見つかりませんでした",
      "tournament/clone-empty",
    );
    vi.mocked(clonePlayersFromTournament).mockRejectedValueOnce(cloneErr);

    await expect(
      cloneTournamentWithPlayers({
        srcTid: "src-2",
        selectedPlayerIds: [],
        create: baseCreate,
      }),
    ).rejects.toMatchObject({ code: "tournament/clone-empty" });

    expect(createTournament).toHaveBeenCalledTimes(1);
    expect(clonePlayersFromTournament).toHaveBeenCalledTimes(1);
  });

  it("createTournament 失敗時: clonePlayers は呼ばれず即 throw", async () => {
    const createErr = new AppError(
      "トーナメント作成に失敗しました",
      "firestore/write_failed",
    );
    vi.mocked(createTournament).mockRejectedValueOnce(createErr);

    await expect(
      cloneTournamentWithPlayers({
        srcTid: "src-3",
        selectedPlayerIds: ["u1"],
        create: baseCreate,
      }),
    ).rejects.toMatchObject({ code: "firestore/write_failed" });

    expect(clonePlayersFromTournament).not.toHaveBeenCalled();
  });
});
