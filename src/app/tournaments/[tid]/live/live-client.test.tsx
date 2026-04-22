import { act, render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

// hooks / firebase module mocks — import 前に宣言する必要がある。
vi.mock("@/lib/hooks/useTournamentTimer", () => ({
  useTournamentTimer: vi.fn(),
}));
vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/players", () => ({
  subscribePlayers: vi.fn(),
}));
vi.mock("@/lib/firebase/repositories/users", () => ({
  deleteUserProfile: vi.fn(),
}));
// receipt.ts は firebase client を import するため、必要な関数のみ軽量 mock する。
vi.mock("@/lib/services/receipt", () => ({
  joinAsCurrentUser: vi.fn().mockResolvedValue("created"),
}));

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { deleteUserProfile } from "@/lib/firebase/repositories/users";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";

import { LiveClient } from "./live-client";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      lateEntryDeadlineLevel: 3,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600 },
        { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600 },
        { level: 4, sb: 100, bb: 200, ante: 25, durationSec: 600 },
      ],
    },
    state: "running",
    startedAt: ts,
    levelStartedAt: ts,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 4, // 締切 Lv3 超過
    lateEntryDeadlineLevel: 3,
    seatsPerTable: 9,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function player(p: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    id: p.id,
    displayName: p.displayName ?? p.id,
    uid: p.uid ?? p.id,
    entryAt: p.entryAt ?? ts,
    isBusted: p.isBusted ?? false,
    bustedAt: p.bustedAt ?? null,
    tableNum: p.tableNum ?? null,
    seatNum: p.seatNum ?? null,
    lastMovedAt: p.lastMovedAt ?? null,
  };
}

function setMocks(opts: {
  tournament?: TournamentDoc | null;
  uid?: string;
  user?: Partial<import("firebase/auth").User> & { uid: string };
}) {
  vi.mocked(useTournamentTimer).mockReturnValue({
    tournament: opts.tournament ?? makeTournament(),
    remainingMs: 600_000,
    fromCache: false,
    hasPendingWrites: false,
    lastSyncAt: Date.now(),
    error: null,
  });
  const user = opts.user ?? { uid: opts.uid ?? "u1" };
  vi.mocked(useAuthUser).mockReturnValue({
    user: user as unknown as import("firebase/auth").User,
    loading: false,
  });
}

let lastOnNext: ((players: PlayerDoc[]) => void) | null = null;

beforeEach(() => {
  lastOnNext = null;
  vi.mocked(subscribePlayers).mockImplementation((_tid, onNext) => {
    lastOnNext = onNext;
    return () => {};
  });
  vi.mocked(deleteUserProfile).mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("LiveClient — playersLoaded gating", () => {
  it("shows 受付情報を取得中… before subscribePlayers fires (prevents レイトエントリー締切超過 flash)", () => {
    setMocks({ tournament: makeTournament({ currentLevel: 4 }) }); // 締切超過 state
    render(<LiveClient tid="t1" />);

    // 購読未 fire の時点では「受付情報を取得中…」のみ。
    expect(screen.getByText("受付情報を取得中…")).toBeInTheDocument();
    // リロード直後の誤表示として報告された文字列が出ないこと。
    expect(screen.queryByText("レイトエントリー締切超過です")).not.toBeInTheDocument();
    expect(screen.queryByText("受付登録されていません")).not.toBeInTheDocument();
  });

  it("shows Table / No. frames after subscribePlayers fires with seated player", () => {
    setMocks({ tournament: makeTournament() });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "u1", tableNum: 2, seatNum: 5 })]);
    });

    expect(screen.getByText("Table")).toBeInTheDocument();
    expect(screen.getByText("No.")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.queryByText("受付情報を取得中…")).not.toBeInTheDocument();
  });

  it("shows 受付登録されていません when subscription fires but user is not in players list", () => {
    setMocks({ uid: "u1" });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "other", uid: "other" })]);
    });

    expect(screen.getByText("受付登録されていません")).toBeInTheDocument();
    // 同時に「レイトエントリー超過」は出さない（未登録者に突きつける文言ではない）。
    expect(screen.queryByText("レイトエントリー締切超過です")).not.toBeInTheDocument();
  });

  it("shows レイトエントリー締切超過です only when registered player has no seat AND past deadline", () => {
    setMocks({ tournament: makeTournament({ currentLevel: 4 }) });
    render(<LiveClient tid="t1" />);

    // 参加はしたが自動配席前（tableNum=null）、締切超過 state
    act(() => {
      lastOnNext?.([player({ id: "u1", tableNum: null, seatNum: null })]);
    });

    expect(screen.getByText("レイトエントリー締切超過です")).toBeInTheDocument();
  });

  it("shows 脱落済み when player is busted", () => {
    setMocks({});
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "u1", isBusted: true, bustedAt: ts })]);
    });

    expect(screen.getByText("脱落済み")).toBeInTheDocument();
  });
});

describe("LiveClient — Winner banner", () => {
  it("shows winner banner when only 1 active player remains during running state", () => {
    setMocks({ tournament: makeTournament({ state: "running" }) });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([
        player({ id: "u1", displayName: "Alice" }),
        player({ id: "u2", displayName: "Bob", isBusted: true, bustedAt: ts }),
        player({ id: "u3", displayName: "Carol", isBusted: true, bustedAt: ts }),
      ]);
    });

    expect(screen.getByText("優勝")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });

  it("does not show winner banner when less than 2 players total", () => {
    setMocks({ tournament: makeTournament({ state: "running" }) });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "u1", displayName: "Alice" })]);
    });

    expect(screen.queryByText("優勝")).not.toBeInTheDocument();
  });

  it("does not show winner banner during setup / seating", () => {
    setMocks({ tournament: makeTournament({ state: "setup", currentLevel: 0 }) });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([
        player({ id: "u1" }),
        player({ id: "u2", isBusted: true, bustedAt: ts }),
      ]);
    });

    expect(screen.queryByText("優勝")).not.toBeInTheDocument();
  });
});

describe("LiveClient — anonymous self-delete on finish", () => {
  it("deletes user profile and auth when anonymous participant sees finished state", async () => {
    const userDelete = vi.fn().mockResolvedValue(undefined);
    setMocks({
      tournament: makeTournament({ state: "finished", finishedAt: ts }),
      user: {
        uid: "guest-1",
        isAnonymous: true,
        delete: userDelete,
      } as unknown as import("firebase/auth").User & { uid: string },
    });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "guest-1", uid: "guest-1" })]);
    });

    await waitFor(() => {
      expect(deleteUserProfile).toHaveBeenCalledWith("guest-1");
    });
    expect(userDelete).toHaveBeenCalled();
  });

  it("does not self-delete non-anonymous users", async () => {
    const userDelete = vi.fn().mockResolvedValue(undefined);
    setMocks({
      tournament: makeTournament({ state: "finished", finishedAt: ts }),
      user: {
        uid: "u1",
        isAnonymous: false,
        delete: userDelete,
      } as unknown as import("firebase/auth").User & { uid: string },
    });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "u1", uid: "u1" })]);
    });

    // ちょっと待って副作用が走らないことを確認
    await new Promise((r) => setTimeout(r, 20));
    expect(deleteUserProfile).not.toHaveBeenCalled();
    expect(userDelete).not.toHaveBeenCalled();
  });

  it("does not self-delete when not a participant", async () => {
    const userDelete = vi.fn().mockResolvedValue(undefined);
    setMocks({
      tournament: makeTournament({ state: "finished", finishedAt: ts }),
      user: {
        uid: "guest-1",
        isAnonymous: true,
        delete: userDelete,
      } as unknown as import("firebase/auth").User & { uid: string },
    });
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "other", uid: "other" })]);
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(deleteUserProfile).not.toHaveBeenCalled();
    expect(userDelete).not.toHaveBeenCalled();
  });

  it("swallows delete errors (best-effort)", async () => {
    const userDelete = vi.fn().mockRejectedValue(new Error("requires-recent-login"));
    setMocks({
      tournament: makeTournament({ state: "finished", finishedAt: ts }),
      user: {
        uid: "guest-1",
        isAnonymous: true,
        delete: userDelete,
      } as unknown as import("firebase/auth").User & { uid: string },
    });
    vi.mocked(deleteUserProfile).mockRejectedValueOnce(new Error("boom"));
    render(<LiveClient tid="t1" />);

    act(() => {
      lastOnNext?.([player({ id: "guest-1", uid: "guest-1" })]);
    });

    await waitFor(() => {
      expect(deleteUserProfile).toHaveBeenCalled();
    });
    // no crash; test passes if the rejected promise is swallowed
  });
});
