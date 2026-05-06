import { renderHook } from "@testing-library/react";
import type { User } from "firebase/auth";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";

vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: vi.fn(),
}));

vi.mock("@/lib/services/current-group", () => ({
  useCurrentGroup: vi.fn(),
}));

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { useCurrentGroup } from "@/lib/services/current-group";

import { useGroupRole } from "./useGroupRole";

type AuthState = ReturnType<typeof useAuthUser>;
type GroupState = ReturnType<typeof useCurrentGroup>;

function makeUser(uid: string): User {
  return { uid, isAnonymous: false } as User;
}

function makeGroup(over: Partial<GroupDoc> & { id: string }): GroupDoc {
  const { id, ...rest } = over;
  return {
    id,
    name: "g",
    ownerUids: ["u-owner"],
    organizerUids: ["u-owner", "u-org"],
    memberUids: ["u-owner", "u-org", "u-mem"],
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
    createdAt: Timestamp.fromMillis(0),
    joinCodeId: null,
    ...rest,
  } as GroupDoc;
}

function authReturn(user: User | null): AuthState {
  return { user, loading: false, refreshUser: () => {} };
}

function groupReturn(groups: GroupDoc[]): GroupState {
  return {
    loading: false,
    groupIds: groups.map((g) => g.id),
    groups,
    currentGroupId: null,
    setCurrentGroupId: () => {},
    refreshGroups: async () => {},
    currentGroupRole: null,
    isOrganizer: false,
    isOwner: false,
  };
}

beforeEach(() => {
  vi.mocked(useAuthUser).mockReset();
  vi.mocked(useCurrentGroup).mockReset();
});

describe("useGroupRole", () => {
  it("returns null group/role when user is signed out", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(null));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result } = renderHook(() => useGroupRole("g1"));
    expect(result.current).toEqual({ group: null, role: null });
  });

  it("returns null group/role when gid is null/undefined", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(makeUser("u-owner")));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result: a } = renderHook(() => useGroupRole(null));
    expect(a.current).toEqual({ group: null, role: null });
    const { result: b } = renderHook(() => useGroupRole(undefined));
    expect(b.current).toEqual({ group: null, role: null });
  });

  it("returns null group/role when gid is not found in groups", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(makeUser("u-owner")));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result } = renderHook(() => useGroupRole("g-missing"));
    expect(result.current).toEqual({ group: null, role: null });
  });

  it("derives owner role for owner uid", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(makeUser("u-owner")));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result } = renderHook(() => useGroupRole("g1"));
    expect(result.current.group?.id).toBe("g1");
    expect(result.current.role).toBe("owner");
  });

  it("derives organizer role for organizer-only uid", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(makeUser("u-org")));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result } = renderHook(() => useGroupRole("g1"));
    expect(result.current.role).toBe("organizer");
  });

  it("derives member role for member-only uid", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(makeUser("u-mem")));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result } = renderHook(() => useGroupRole("g1"));
    expect(result.current.role).toBe("member");
  });

  it("returns null role when user is not in any role array of the group", () => {
    vi.mocked(useAuthUser).mockReturnValue(authReturn(makeUser("u-stranger")));
    vi.mocked(useCurrentGroup).mockReturnValue(groupReturn([makeGroup({ id: "g1" })]));
    const { result } = renderHook(() => useGroupRole("g1"));
    expect(result.current.group?.id).toBe("g1");
    expect(result.current.role).toBeNull();
  });
});
