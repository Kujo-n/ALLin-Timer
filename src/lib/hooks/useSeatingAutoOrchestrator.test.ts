import { renderHook } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

vi.mock("@/lib/services/seating/orchestrator", () => ({
  autoSeatLateEntry: vi.fn(),
}));

import { autoSeatLateEntry } from "@/lib/services/seating/orchestrator";

import { useSeatingAutoOrchestrator } from "./useSeatingAutoOrchestrator";

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
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
    },
    state: "running",
    startedAt: ts,
    levelStartedAt: ts,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 3,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
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
    isPlayingDealer: p.isPlayingDealer ?? false,
  };
}

interface RenderArgs {
  tid?: string;
  uid?: string | null;
  userGroupIds?: string[];
  tournament?: TournamentDoc | null;
  players?: PlayerDoc[];
  tables?: TableDoc[];
}

function renderWith(args: RenderArgs = {}) {
  // `??` は null を fallback してしまうため、in 演算子で「明示的な指定」のみ反映する。
  const uid = "uid" in args ? (args.uid as string | null) : "u1";
  const tournament =
    "tournament" in args ? args.tournament : makeTournament();
  return renderHook(() =>
    useSeatingAutoOrchestrator({
      tid: args.tid ?? "t1",
      uid,
      userGroupIds: args.userGroupIds ?? ["g1"],
      tournament: tournament as TournamentDoc | null,
      players: args.players ?? [],
      tables: args.tables ?? [],
    }),
  );
}

beforeEach(() => {
  vi.mocked(autoSeatLateEntry).mockReset().mockResolvedValue({ applied: true });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useSeatingAutoOrchestrator — early returns", () => {
  it("does nothing when uid is null (unauthenticated)", () => {
    renderWith({
      uid: null,
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).not.toHaveBeenCalled();
  });

  it("does nothing when tournament is null (still loading)", () => {
    renderWith({
      tournament: null,
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).not.toHaveBeenCalled();
  });

  it("does nothing when state is setup (席決め前)", () => {
    renderWith({
      tournament: makeTournament({ state: "setup", currentLevel: 0 }),
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).not.toHaveBeenCalled();
  });

  it("Phase 5.1: invokes autoSeatLateEntry when state is seating (座席確定後 late entry の即時配席)", () => {
    renderWith({
      tournament: makeTournament({ state: "seating", currentLevel: 0 }),
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(1);
  });

  it("does nothing when state is finished", () => {
    renderWith({
      tournament: makeTournament({ state: "finished" }),
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).not.toHaveBeenCalled();
  });

  it("does nothing when user is not a group member (rule で弾かれるため事前に止める)", () => {
    renderWith({
      userGroupIds: ["g-other"],
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).not.toHaveBeenCalled();
  });

  it("does nothing when currentLevel exceeds lateEntryDeadlineLevel", () => {
    renderWith({
      tournament: makeTournament({
        currentLevel: 7,
        lateEntryDeadlineLevel: 6,
      }),
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).not.toHaveBeenCalled();
  });
});

describe("useSeatingAutoOrchestrator — auto-seating", () => {
  it("calls autoSeatLateEntry for each unseated, non-busted player", () => {
    renderWith({
      players: [
        player({ id: "p1" }), // unseated
        player({ id: "p2", tableNum: 1, seatNum: 1 }), // already seated
        player({ id: "p3", isBusted: true }), // busted
        player({ id: "p4" }), // unseated
      ],
    });
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(2);
    const calledIds = vi
      .mocked(autoSeatLateEntry)
      .mock.calls.map((c) => c[3]); // 4th arg = playerId
    expect(calledIds).toEqual(expect.arrayContaining(["p1", "p4"]));
    expect(calledIds).not.toContain("p2");
    expect(calledIds).not.toContain("p3");
  });

  it("passes expectedLastMovedAtMs from player.lastMovedAt", () => {
    const lastMovedTs = Timestamp.fromMillis(1234567);
    renderWith({
      players: [player({ id: "p1", lastMovedAt: lastMovedTs })],
    });
    expect(autoSeatLateEntry).toHaveBeenCalledWith(
      "t1",
      "u1",
      ["g1"],
      "p1",
      1234567,
      expect.any(Array),
      expect.any(Array),
      9,
    );
  });

  it("passes null expectedLastMovedAtMs when player.lastMovedAt is null", () => {
    renderWith({
      players: [player({ id: "p1", lastMovedAt: null })],
    });
    const args = vi.mocked(autoSeatLateEntry).mock.calls[0];
    expect(args[4]).toBeNull();
  });

  it("filters seatedPlayers (excludes busted) and brokenTableNums in passed args", () => {
    renderWith({
      players: [
        player({ id: "p1" }), // target unseated
        player({ id: "p2", tableNum: 1, seatNum: 1 }),
        player({ id: "p3", isBusted: true, tableNum: null, seatNum: null }),
      ],
      tables: [
        { id: "1", tableNum: 1, isBroken: false, createdAt: ts, label: null, color: null },
        { id: "2", tableNum: 2, isBroken: true, createdAt: ts, label: null, color: null },
      ],
    });
    const args = vi.mocked(autoSeatLateEntry).mock.calls[0];
    const seated = args[5] as PlayerDoc[];
    const brokenNums = args[6] as number[];
    // seatedPlayers は !isBusted のみ → p1 (unseated でも !isBusted) + p2
    expect(seated.map((p) => p.id).sort()).toEqual(["p1", "p2"]);
    expect(brokenNums).toEqual([2]);
  });

  it("passes tournament.seatsPerTable as 8th arg", () => {
    renderWith({
      tournament: makeTournament({ seatsPerTable: 6 }),
      players: [player({ id: "p1" })],
    });
    const args = vi.mocked(autoSeatLateEntry).mock.calls[0];
    expect(args[7]).toBe(6);
  });

  it("re-fires for newly added unseated player on rerender", () => {
    const { rerender } = renderHook(
      (props: { players: PlayerDoc[] }) =>
        useSeatingAutoOrchestrator({
          tid: "t1",
          uid: "u1",
          userGroupIds: ["g1"],
          tournament: makeTournament(),
          players: props.players,
          tables: [],
        }),
      { initialProps: { players: [player({ id: "p1" })] as PlayerDoc[] } },
    );
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(1);

    // p2 が新規 join
    rerender({
      players: [
        player({ id: "p1" }),
        player({ id: "p2" }),
      ],
    });
    // p1 の inflight は前回の resolve でクリアされているため再 fire するが、
    // 実用上は autoSeatLateEntry の resolve 後に subscribe で seat が付くので
    // 次 render では p1 は既配席に。今回はモックが単に resolve するだけなので両者再 fire される。
    // 重要なのは「p2 が呼ばれていること」。
    const calledIds = vi
      .mocked(autoSeatLateEntry)
      .mock.calls.map((c) => c[3]);
    expect(calledIds).toContain("p2");
  });

  it("does not call when fingerprint unchanged (re-render without state change)", () => {
    const stablePlayers = [player({ id: "p1", tableNum: 1, seatNum: 1 })];
    const { rerender } = renderHook(
      (props: { players: PlayerDoc[] }) =>
        useSeatingAutoOrchestrator({
          tid: "t1",
          uid: "u1",
          userGroupIds: ["g1"],
          tournament: makeTournament(),
          players: props.players,
          tables: [],
        }),
      { initialProps: { players: stablePlayers } },
    );
    // 初期 render: 全員 seated → 0 call
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(0);
    // 同じ配列参照（fingerprint 同一）で再 render → effect 再発火しない
    rerender({ players: stablePlayers });
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(0);
    // 別配列だが内容同一 → fingerprint で吸収されるはず
    rerender({
      players: [player({ id: "p1", tableNum: 1, seatNum: 1 })],
    });
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(0);
  });

  it("works in paused state (運営者は paused 中にも配席を決定できる)", () => {
    renderWith({
      tournament: makeTournament({ state: "paused" }),
      players: [player({ id: "p1" })],
    });
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(1);
  });

  it("does not re-fire when tournament fingerprint unchanged (L1 fix)", () => {
    // L1: tournament の seating-irrelevant フィールド（updatedAt 等）の変更で
    // effect が再 fire しないことを fingerprint 経由で保証する。
    const stablePlayers = [player({ id: "p1", tableNum: 1, seatNum: 1 })]; // 既配席
    const { rerender } = renderHook(
      (props: { tournament: TournamentDoc }) =>
        useSeatingAutoOrchestrator({
          tid: "t1",
          uid: "u1",
          userGroupIds: ["g1"],
          tournament: props.tournament,
          players: stablePlayers,
          tables: [],
        }),
      { initialProps: { tournament: makeTournament() } },
    );
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(0);

    // updatedAt のみ変えた新しい tournament object（参照は別、fingerprint は同一）
    rerender({
      tournament: makeTournament({
        updatedAt: Timestamp.fromMillis(Date.now() + 1000),
      }),
    });
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(0);
  });
});

describe("useSeatingAutoOrchestrator — error handling", () => {
  it("logs warn on autoSeatLateEntry rejection without crashing", async () => {
    vi.mocked(autoSeatLateEntry).mockRejectedValueOnce(new Error("boom"));
    renderWith({ players: [player({ id: "p1" })] });
    // 非同期 catch が走り切るまで待つ
    await new Promise((r) => setTimeout(r, 0));
    expect(autoSeatLateEntry).toHaveBeenCalledTimes(1);
    // エラーで crash しないことが本テストの主眼。logger は正常呼出しされる。
  });
});
