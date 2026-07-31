import { act, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { UserProfileDoc } from "@/lib/firebase/schemas/user";

vi.mock("@/lib/firebase/AuthProvider", () => ({ useAuthUser: vi.fn() }));
vi.mock("@/lib/firebase/repositories/groups", () => ({ listMyGroups: vi.fn() }));
vi.mock("@/lib/firebase/repositories/users", () => ({
  getUserProfile: vi.fn(),
  removeGroupIdFromUser: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: { currentUser: null },
  firestore: {},
}));

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { listMyGroups } from "@/lib/firebase/repositories/groups";
import { getUserProfile, removeGroupIdFromUser } from "@/lib/firebase/repositories/users";

import { GroupProvider, useCurrentGroup } from "./current-group";

const now = Timestamp.fromDate(new Date("2026-07-31T00:00:00Z"));

/**
 * `firebaseAuth` は mock モジュールの named export として登録済みのため、
 * currentUser を差し替えるにはモジュール名前空間ごと再定義する
 * （auto-group-join.test.ts の先例と同形）。
 */
async function setSdkCurrentUser(value: unknown) {
  const clientMock = await import("@/lib/firebase/client");
  Object.defineProperty(clientMock, "firebaseAuth", {
    configurable: true,
    value: { currentUser: value },
  });
}

function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return {
    id: "g1",
    name: "Saturday",
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

function makeProfile(groupIds: string[]): UserProfileDoc {
  return {
    uid: "u1",
    displayName: "Alice",
    email: "alice@example.com",
    groupIds,
    createdAt: now,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** context の値を DOM に出しつつ、ボタンから refreshGroups を呼べる probe。 */
function Probe() {
  const { groups, currentGroupId, refreshGroups } = useCurrentGroup();
  return (
    <div>
      <span data-testid="group-names">{groups.map((g) => g.name).join(",")}</span>
      <span data-testid="current-gid">{currentGroupId ?? "-"}</span>
      <button
        onClick={() => {
          void refreshGroups();
        }}
      >
        refresh
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <GroupProvider>
      <Probe />
    </GroupProvider>,
  );
}

function mockAuthUser(user: { uid: string } | null) {
  vi.mocked(useAuthUser).mockReturnValue({
    user: user as unknown as ReturnType<typeof useAuthUser>["user"],
    loading: false,
    refreshUser: vi.fn(),
  });
}

beforeEach(async () => {
  window.localStorage.clear();
  vi.mocked(getUserProfile)
    .mockReset()
    .mockResolvedValue(makeProfile(["g1"]));
  vi.mocked(listMyGroups)
    .mockReset()
    .mockResolvedValue({ groups: [makeGroup()], failedGids: [] });
  vi.mocked(removeGroupIdFromUser).mockReset().mockResolvedValue(undefined);
  await setSdkCurrentUser(null);
  mockAuthUser({ uid: "u1" });
});

describe("GroupProvider", () => {
  it("サインイン済みなら groups をロードし currentGroupId を先頭 gid にする", async () => {
    await act(async () => {
      renderProbe();
    });

    expect(screen.getByTestId("group-names")).toHaveTextContent("Saturday");
    expect(screen.getByTestId("current-gid")).toHaveTextContent("g1");
    expect(getUserProfile).toHaveBeenCalledWith("u1");
  });

  it("context user が null でも SDK の currentUser があれば refreshGroups がロードする", async () => {
    mockAuthUser(null);
    await act(async () => {
      renderProbe();
    });
    expect(getUserProfile).not.toHaveBeenCalled();

    // Google popup / メールログイン直後、onAuthStateChanged 反映前の状態を再現する。
    await setSdkCurrentUser({ uid: "u-sdk" });
    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
    });

    expect(getUserProfile).toHaveBeenCalledWith("u-sdk");
    expect(screen.getByTestId("group-names")).toHaveTextContent("Saturday");
  });

  it("同一 uid の load が逆順に着地しても、後から開始した load の結果が残る", async () => {
    const first = deferred<UserProfileDoc | null>();
    const second = deferred<UserProfileDoc | null>();
    vi.mocked(getUserProfile)
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    // 呼出順ではなく profile の内容で分岐させる（1 本目 = 加入前で 0 件、
    // 2 本目 = 加入後で 1 件。逆順着地のため呼出順で固定すると入れ替わる）。
    vi.mocked(listMyGroups)
      .mockReset()
      .mockImplementation(async (ids: string[]) =>
        ids.includes("g1")
          ? { groups: [makeGroup({ name: "自動所属サークル" })], failedGids: [] }
          : { groups: [], failedGids: [] },
      );

    // 1 本目 = provider effect
    renderProbe();
    // 2 本目 = 受付直後の refreshGroups
    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
    });

    // resolve は 2 本目 → 1 本目（＝逆順着地）
    await act(async () => {
      second.resolve(makeProfile(["g1"]));
      await second.promise;
    });
    await act(async () => {
      first.resolve(makeProfile([]));
      await first.promise;
    });

    expect(screen.getByTestId("group-names")).toHaveTextContent("自動所属サークル");
    expect(screen.getByTestId("current-gid")).toHaveTextContent("g1");
  });

  it("追い越された load は drift 修復（groupIds からの削除）を行わない", async () => {
    const first = deferred<UserProfileDoc | null>();
    const second = deferred<UserProfileDoc | null>();
    vi.mocked(getUserProfile)
      .mockReset()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    // listMyGroups の呼出順は profile の resolve 順＝ 2 本目 → 1 本目。
    // 1 本目（＝古い load）だけ getGroup が一時的に失敗した状況を再現する。
    vi.mocked(listMyGroups)
      .mockReset()
      .mockResolvedValueOnce({ groups: [makeGroup()], failedGids: [] })
      .mockResolvedValueOnce({ groups: [], failedGids: ["g1"] });

    renderProbe();
    await act(async () => {
      screen.getByRole("button", { name: "refresh" }).click();
    });

    await act(async () => {
      second.resolve(makeProfile(["g1"]));
      await second.promise;
    });
    await act(async () => {
      first.resolve(makeProfile(["g1"]));
      await first.promise;
    });

    // 古い load の failedGids で最新のメンバーシップを削ってはいけない
    expect(removeGroupIdFromUser).not.toHaveBeenCalled();
    expect(screen.getByTestId("group-names")).toHaveTextContent("Saturday");
  });

  it("最新の load で getGroup できなかった gid は逆引きから外す", async () => {
    vi.mocked(getUserProfile).mockResolvedValue(makeProfile(["g1", "g-gone"]));
    vi.mocked(listMyGroups).mockResolvedValue({
      groups: [makeGroup()],
      failedGids: ["g-gone"],
    });

    await act(async () => {
      renderProbe();
    });

    expect(removeGroupIdFromUser).toHaveBeenCalledWith("u1", "g-gone");
    expect(screen.getByTestId("group-names")).toHaveTextContent("Saturday");
  });
});
