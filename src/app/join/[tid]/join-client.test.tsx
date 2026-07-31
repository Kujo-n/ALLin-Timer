import { act, fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import type { ReceiptOutcome } from "@/lib/services/receipt";

// join-client は AccountLinkRequired（Google 連携分岐）だけを auth-actions から使う。
// 実体は firebase client / repositories を module scope で辿るため、helper 境界で mock する。
vi.mock("@/lib/services/auth-actions", () => ({
  AccountLinkRequired: class AccountLinkRequired extends Error {},
}));
vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  getTournament: vi.fn(),
}));
vi.mock("@/lib/services/receipt", () => ({
  joinAsCurrentUser: vi.fn(),
  joinAsExistingUser: vi.fn(),
  joinAsGuest: vi.fn(),
  joinViaGoogle: vi.fn(),
  cancelOwnEntry: vi.fn(),
}));
vi.mock("@/lib/services/current-group", () => ({
  useCurrentGroup: vi.fn(),
}));
// LinkAccountDialog は firebase auth を import するため軽量 stub にする。
vi.mock("@/components/auth/LinkAccountDialog", () => ({
  LinkAccountDialog: () => null,
}));

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { useCurrentGroup } from "@/lib/services/current-group";
import { joinAsCurrentUser } from "@/lib/services/receipt";

import { JoinClient } from "./join-client";

const now = Timestamp.fromDate(new Date("2026-07-31T00:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "owner",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
    },
    state: "setup",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return {
    id: "g1",
    name: "土曜サークル",
    ownerUids,
    organizerUids,
    memberUids,
    memberDisplayNames: {},
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
    winnerCardBackground: null,
    seasonCardBackground: null,
    latestJoinCodeId: null,
    joinedViaTournamentId: null,
    createdAt: now,
    ...overrides,
  };
}

const setCurrentGroupId = vi.fn();
const refreshGroups = vi.fn().mockResolvedValue(undefined);

function mockGroupContext(groups: GroupDoc[]) {
  vi.mocked(useCurrentGroup).mockReturnValue({
    loading: false,
    groupIds: groups.map((g) => g.id),
    groups,
    currentGroupId: groups[0]?.id ?? null,
    setCurrentGroupId,
    refreshGroups,
    currentGroupRole: "member",
    isOrganizer: false,
    isOwner: false,
  });
}

/** サインイン済み（非匿名）のユーザーで「このアカウントで受付」を押す。 */
async function receiveWithSignedInAccount(outcome: ReceiptOutcome) {
  vi.mocked(joinAsCurrentUser).mockResolvedValue(outcome);
  render(<JoinClient tid="t1" />);
  const button = screen.getByRole("button", { name: "このアカウントで受付" });
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  vi.mocked(useAuthUser).mockReturnValue({
    user: {
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
      isAnonymous: false,
    } as unknown as ReturnType<typeof useAuthUser>["user"],
    loading: false,
    refreshUser: vi.fn(),
  });
  vi.mocked(getTournament).mockReset().mockResolvedValue(makeTournament());
  vi.mocked(joinAsCurrentUser).mockReset();
  setCurrentGroupId.mockReset();
  refreshGroups.mockReset().mockResolvedValue(undefined);
  mockGroupContext([makeGroup()]);
});

describe("JoinClient — 自動所属フィードバック（08 Phase 2）", () => {
  it("joined のときサークル名入りのメッセージを出し、group コンテキストを更新する", async () => {
    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.getByText("土曜サークル のメンバーになりました。")).toBeInTheDocument();
    expect(setCurrentGroupId).toHaveBeenCalledWith("g1");
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it("group 名が解決できないときは汎用文言に fallback する", async () => {
    mockGroupContext([makeGroup({ id: "g-other", name: "別サークル" })]);

    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "joined" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.getByText("サークルのメンバーになりました。")).toBeInTheDocument();
  });

  it("failed のとき受付は成功のまま、控えめな再試行注記を出す", async () => {
    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "failed" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(
      screen.getByText("サークルへの登録は完了していません。次回の受付時に自動で再試行されます。"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(setCurrentGroupId).not.toHaveBeenCalled();
  });

  it("already-member では所属メッセージを出さないが refreshGroups はする", async () => {
    await receiveWithSignedInAccount({
      result: "already-joined",
      autoJoin: { gid: "g1", status: "already-member" },
    });

    expect(await screen.findByText("既に参加済みです")).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(setCurrentGroupId).not.toHaveBeenCalled();
    expect(refreshGroups).toHaveBeenCalledTimes(1);
  });

  it("skipped-anonymous では所属メッセージを出さず group コンテキストも触らない", async () => {
    // `/join/[tid]` の現行 UI では非匿名ガードで到達しないが、`joinAsCurrentUser` は
    // `/live` の「参加する」から匿名でも呼ばれ得る型のため契約として固定する。
    await receiveWithSignedInAccount({
      result: "created",
      autoJoin: { gid: "g1", status: "skipped-anonymous" },
    });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(screen.queryByText(/再試行されます/)).toBeNull();
    expect(setCurrentGroupId).not.toHaveBeenCalled();
    expect(refreshGroups).not.toHaveBeenCalled();
  });

  it("autoJoin が null（ゲスト相当）なら所属メッセージも失敗注記も出さない", async () => {
    await receiveWithSignedInAccount({ result: "created", autoJoin: null });

    expect(await screen.findByText("受付完了")).toBeInTheDocument();
    expect(screen.queryByText(/メンバーになりました/)).toBeNull();
    expect(screen.queryByText(/再試行されます/)).toBeNull();
    expect(refreshGroups).not.toHaveBeenCalled();
  });
});
