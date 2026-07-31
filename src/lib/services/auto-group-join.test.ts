import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";

// firestore singleton はテスト中に直接触らないためダミーで mock しておく。
vi.mock("@/lib/firebase/client", () => ({
  firestore: {},
  firebaseAuth: { currentUser: null },
}));

vi.mock("@/lib/firebase/repositories/groups", () => ({
  getGroupIfMember: vi.fn(),
  addSelfViaTournamentEntry: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/users", () => ({
  addGroupIdToUser: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
}));

import { AppError } from "@/lib/errors";
import {
  addSelfViaTournamentEntry,
  getGroupIfMember,
} from "@/lib/firebase/repositories/groups";
import {
  addGroupIdToUser,
  getUserProfile,
} from "@/lib/firebase/repositories/users";
import { logger } from "@/lib/logger";

import { joinGroupViaTournament } from "./auto-group-join";

const now = Timestamp.fromDate(new Date("2026-07-31T00:00:00Z"));

/**
 * `firebaseAuth` は mock モジュールの named export として登録済みのため、
 * currentUser を差し替えるにはモジュール名前空間ごと再定義する
 * （group.test.ts の先例と同形）。
 */
async function setCurrentUser(value: unknown) {
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

/**
 * 未加入ユーザーの probe を再現する。
 * `getGroupIfMember` は rule 拒否を throw ではなく `null` 返却に倒す契約
 * （warn ログを出さないため）なので、非メンバーは `null` で表現する。
 */
function nonMember() {
  return null;
}

beforeEach(async () => {
  vi.mocked(getGroupIfMember).mockReset();
  vi.mocked(addSelfViaTournamentEntry).mockReset().mockResolvedValue();
  vi.mocked(addGroupIdToUser).mockReset().mockResolvedValue();
  vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
  await setCurrentUser(null);
});

describe("joinGroupViaTournament", () => {
  it("既メンバーなら self-add せず already-member を返し、groupIds だけ補修する", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(makeGroup({ memberUids: ["u-owner", "u1"] }));

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });

    expect(result).toEqual({ gid: "g1", outcome: "already-member" });
    expect(addSelfViaTournamentEntry).not.toHaveBeenCalled();
    expect(addGroupIdToUser).toHaveBeenCalledWith("u1", "g1");
  });

  it("未加入なら self-add を呼び joined を返す", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });

    expect(result).toEqual({ gid: "g1", outcome: "joined" });
    expect(addSelfViaTournamentEntry).toHaveBeenCalledWith("g1", "u1", {
      tid: "t1",
      displayName: "Alice",
    });
    expect(addGroupIdToUser).toHaveBeenCalledWith("u1", "g1");
  });

  it("15 字超の displayName hint は 15 字に切り詰めて渡す", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());

    await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      // 20 字（Google 本名など）
      displayName: "あいうえおかきくけこさしすせそたちつてと",
    });

    expect(addSelfViaTournamentEntry).toHaveBeenCalledWith("g1", "u1", {
      tid: "t1",
      displayName: "あいうえおかきくけこさしすせそ",
    });
  });

  it("hint 未指定なら auth.displayName を採用する", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());
    await setCurrentUser({
      isAnonymous: false,
      displayName: "Auth Name",
      email: "leak@example.com",
    });

    await joinGroupViaTournament({ tid: "t1", gid: "g1", uid: "u1" });

    expect(addSelfViaTournamentEntry).toHaveBeenCalledWith("g1", "u1", {
      tid: "t1",
      displayName: "Auth Name",
    });
    expect(getUserProfile).not.toHaveBeenCalled();
  });

  it("hint / auth.displayName が無ければ users/{uid}.displayName にフォールバックする", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());
    await setCurrentUser({ isAnonymous: false, displayName: null });
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "Profile Name",
      email: "leak@example.com",
      groupIds: [],
      createdAt: now,
    });

    await joinGroupViaTournament({ tid: "t1", gid: "g1", uid: "u1" });

    expect(addSelfViaTournamentEntry).toHaveBeenCalledWith("g1", "u1", {
      tid: "t1",
      displayName: "Profile Name",
    });
  });

  it("表示名が一切解決できなければ uid の先頭 15 字を使う（rule の 1..15 を満たす）", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());
    // Firebase の uid は 28 字
    const uid = "abcdefghijklmnopqrstuvwxyz12";

    await joinGroupViaTournament({ tid: "t1", gid: "g1", uid });

    expect(addSelfViaTournamentEntry).toHaveBeenCalledWith("g1", uid, {
      tid: "t1",
      displayName: "abcdefghijklmno",
    });
  });

  it("group が読めても memberUids に自分が居なければ非メンバー扱いで self-add する", async () => {
    // 除名直後のキャッシュ read など、doc は取れるが membership は失われている状況。
    // probe は「読めた」ではなく「memberUids に居る」で判定する契約。
    vi.mocked(getGroupIfMember).mockResolvedValue(makeGroup({ memberUids: ["u-owner"] }));

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });

    expect(result).toEqual({ gid: "g1", outcome: "joined" });
    expect(addSelfViaTournamentEntry).toHaveBeenCalledWith("g1", "u1", {
      tid: "t1",
      displayName: "Alice",
    });
  });

  it("probe が想定外エラーで throw しても非メンバー扱いで self-add を試みる", async () => {
    // permission-denied 以外（ネットワーク等）は getGroupIfMember が throw する契約。
    vi.mocked(getGroupIfMember).mockRejectedValue(
      new AppError("サークル取得に失敗しました", "firestore/read_failed"),
    );

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });

    expect(result).toEqual({ gid: "g1", outcome: "joined" });
    expect(addSelfViaTournamentEntry).toHaveBeenCalledTimes(1);
  });

  it("匿名アカウントは skipped-anonymous で書込を一切行わない", async () => {
    await setCurrentUser({ isAnonymous: true, displayName: null });

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u-anon",
      displayName: "Guest",
    });

    expect(result).toEqual({ gid: "g1", outcome: "skipped-anonymous" });
    expect(getGroupIfMember).not.toHaveBeenCalled();
    expect(addSelfViaTournamentEntry).not.toHaveBeenCalled();
    expect(addGroupIdToUser).not.toHaveBeenCalled();
  });

  it("同時 self-add で deny されても、再 probe でメンバーなら already-member に倒す", async () => {
    vi.mocked(getGroupIfMember)
      .mockResolvedValueOnce(nonMember())
      .mockResolvedValue(makeGroup({ memberUids: ["u-owner", "u1"] }));
    vi.mocked(addSelfViaTournamentEntry).mockRejectedValue(
      new AppError("サークルへの自動加入に失敗しました", "firestore/write_failed"),
    );

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });

    expect(result).toEqual({ gid: "g1", outcome: "already-member" });
    expect(addGroupIdToUser).toHaveBeenCalledWith("u1", "g1");
  });

  it("self-add 失敗かつ再 probe も非メンバーなら group/auto-join-failed を throw する", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());
    vi.mocked(addSelfViaTournamentEntry).mockRejectedValue(
      new AppError("サークルへの自動加入に失敗しました", "firestore/write_failed"),
    );

    await expect(
      joinGroupViaTournament({ tid: "t1", gid: "g1", uid: "u1", displayName: "Alice" }),
    ).rejects.toMatchObject({ code: "group/auto-join-failed" });

    expect(addGroupIdToUser).not.toHaveBeenCalled();
  });

  it("groupIds の補修が失敗しても throw せず outcome を返す（best-effort）", async () => {
    vi.mocked(getGroupIfMember).mockResolvedValue(nonMember());
    vi.mocked(addGroupIdToUser).mockRejectedValue(
      new AppError("プロフィールへのサークル追加に失敗しました", "firestore/write_failed"),
    );
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const result = await joinGroupViaTournament({
      tid: "t1",
      gid: "g1",
      uid: "u1",
      displayName: "Alice",
    });

    expect(result).toEqual({ gid: "g1", outcome: "joined" });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("空文字引数は validation/empty-string で early throw し、書込を一切行わない", async () => {
    await expect(
      joinGroupViaTournament({ tid: "", gid: "g1", uid: "u1" }),
    ).rejects.toMatchObject({ code: "validation/empty-string" });
    await expect(
      joinGroupViaTournament({ tid: "t1", gid: "  ", uid: "u1" }),
    ).rejects.toMatchObject({ code: "validation/empty-string" });
    await expect(
      joinGroupViaTournament({ tid: "t1", gid: "g1", uid: "" }),
    ).rejects.toMatchObject({ code: "validation/empty-string" });

    expect(getGroupIfMember).not.toHaveBeenCalled();
    expect(addSelfViaTournamentEntry).not.toHaveBeenCalled();
    expect(addGroupIdToUser).not.toHaveBeenCalled();
  });
});
