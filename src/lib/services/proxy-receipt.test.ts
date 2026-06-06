import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { TournamentDoc, TournamentState } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  getTournament: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroup: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/players", () => ({
  upsertPlayer: vi.fn(),
  createNamedOnlyPlayer: vi.fn().mockResolvedValue("pid-x"),
}));

import { getGroup } from "@/lib/firebase/repositories/groups";
import { createNamedOnlyPlayer, upsertPlayer } from "@/lib/firebase/repositories/players";
import { getTournament } from "@/lib/firebase/repositories/tournaments";

import {
  addMemberPlayerByOrganizer,
  addNamedOnlyPlayerByOrganizer,
} from "./proxy-receipt";

const ORG = "org-uid";
const MEMBER = "member-uid";

function fakeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t-1",
    groupId: "g-1",
    createdByUid: "owner-uid",
    name: "Proxy Test",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [],
    },
    state: "setup" as TournamentState,
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: Timestamp.fromMillis(0),
    updatedAt: Timestamp.fromMillis(0),
    ...overrides,
  } as TournamentDoc;
}

function fakeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g-1",
    name: "Test Group",
    ownerUids: ["owner-uid"],
    organizerUids: ["owner-uid", ORG],
    memberUids: ["owner-uid", ORG, MEMBER],
    memberDisplayNames: {},
    ...overrides,
  } as GroupDoc;
}

beforeEach(() => {
  vi.mocked(getTournament).mockReset();
  vi.mocked(getGroup).mockReset();
  vi.mocked(upsertPlayer).mockReset().mockResolvedValue(undefined);
  vi.mocked(createNamedOnlyPlayer).mockReset().mockResolvedValue("pid-x");
});

describe("addMemberPlayerByOrganizer", () => {
  it("organizer + setup → upsertPlayer(tid, memberUid, { displayName })", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament({ state: "setup" }));
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await addMemberPlayerByOrganizer({
      tid: "t-1",
      organizerUid: ORG,
      memberUid: MEMBER,
      displayName: "  Alice  ",
    });
    expect(upsertPlayer).toHaveBeenCalledWith("t-1", MEMBER, { displayName: "Alice" });
  });

  it("非 organizer → group/not-organizer throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup({ organizerUids: ["owner-uid"] }));
    await expect(
      addMemberPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        memberUid: MEMBER,
        displayName: "Alice",
      }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });

  it("memberUid が group の非メンバー → group/not-member throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addMemberPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        memberUid: "outsider-uid",
        displayName: "Alice",
      }),
    ).rejects.toMatchObject({ code: "group/not-member" });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });

  it("finished tournament → tournament/late-entry-closed throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament({ state: "finished" }));
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addMemberPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        memberUid: MEMBER,
        displayName: "Alice",
      }),
    ).rejects.toMatchObject({ code: "tournament/late-entry-closed" });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });

  it("late entry 締切超過（running + currentLevel > deadline）→ tournament/late-entry-closed", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(
      fakeTournament({ state: "running", currentLevel: 7, lateEntryDeadlineLevel: 6 }),
    );
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addMemberPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        memberUid: MEMBER,
        displayName: "Alice",
      }),
    ).rejects.toMatchObject({ code: "tournament/late-entry-closed" });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });

  it("displayName 空 → validation/display-name-required throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addMemberPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        memberUid: MEMBER,
        displayName: "   ",
      }),
    ).rejects.toMatchObject({ code: "validation/display-name-required" });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });

  it("displayName 16 文字 → validation/display-name-too-long throw", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addMemberPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        memberUid: MEMBER,
        displayName: "x".repeat(16),
      }),
    ).rejects.toMatchObject({ code: "validation/display-name-too-long" });
    expect(upsertPlayer).not.toHaveBeenCalled();
  });
});

describe("addNamedOnlyPlayerByOrganizer", () => {
  it("organizer + running → createNamedOnlyPlayer(tid, name) 呼出 → pid を返す", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(
      fakeTournament({ state: "running", currentLevel: 3, lateEntryDeadlineLevel: 6 }),
    );
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    const pid = await addNamedOnlyPlayerByOrganizer({
      tid: "t-1",
      organizerUid: ORG,
      displayName: " Bob ",
    });
    expect(createNamedOnlyPlayer).toHaveBeenCalledWith("t-1", "Bob");
    expect(pid).toBe("pid-x");
  });

  it("非 organizer → group/not-organizer throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup({ organizerUids: ["owner-uid"] }));
    await expect(
      addNamedOnlyPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        displayName: "Bob",
      }),
    ).rejects.toMatchObject({ code: "group/not-organizer" });
    expect(createNamedOnlyPlayer).not.toHaveBeenCalled();
  });

  it("finished tournament → tournament/late-entry-closed throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament({ state: "finished" }));
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addNamedOnlyPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        displayName: "Bob",
      }),
    ).rejects.toMatchObject({ code: "tournament/late-entry-closed" });
    expect(createNamedOnlyPlayer).not.toHaveBeenCalled();
  });

  it("displayName 空 → validation/display-name-required throw、repository 未呼出", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addNamedOnlyPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        displayName: "",
      }),
    ).rejects.toMatchObject({ code: "validation/display-name-required" });
    expect(createNamedOnlyPlayer).not.toHaveBeenCalled();
  });

  it("displayName 16 文字 → validation/display-name-too-long throw", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(fakeTournament());
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addNamedOnlyPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        displayName: "x".repeat(16),
      }),
    ).rejects.toMatchObject({ code: "validation/display-name-too-long" });
    expect(createNamedOnlyPlayer).not.toHaveBeenCalled();
  });

  it("late entry 締切超過（running + currentLevel > deadline）→ tournament/late-entry-closed", async () => {
    vi.mocked(getTournament).mockResolvedValueOnce(
      fakeTournament({ state: "running", currentLevel: 7, lateEntryDeadlineLevel: 6 }),
    );
    vi.mocked(getGroup).mockResolvedValueOnce(fakeGroup());
    await expect(
      addNamedOnlyPlayerByOrganizer({
        tid: "t-1",
        organizerUid: ORG,
        displayName: "Bob",
      }),
    ).rejects.toMatchObject({ code: "tournament/late-entry-closed" });
    expect(createNamedOnlyPlayer).not.toHaveBeenCalled();
  });
});
