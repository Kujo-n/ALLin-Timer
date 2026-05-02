import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import { planPlayingDealerShift } from "./pd";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

function makePlayer(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    id: overrides.id,
    displayName: overrides.displayName ?? overrides.id,
    uid: overrides.uid ?? overrides.id,
    entryAt: overrides.entryAt ?? ts,
    isBusted: overrides.isBusted ?? false,
    bustedAt: overrides.bustedAt ?? null,
    tableNum: overrides.tableNum ?? null,
    seatNum: overrides.seatNum ?? null,
    lastMovedAt: overrides.lastMovedAt ?? null,
    isPlayingDealer: overrides.isPlayingDealer ?? false,
  };
}

describe("planPlayingDealerShift", () => {
  it("PD が既に席 1 → no-op", () => {
    const players = [
      makePlayer({ id: "pd", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      makePlayer({ id: "p2", tableNum: 1, seatNum: 2 }),
      makePlayer({ id: "p3", tableNum: 1, seatNum: 3 }),
    ];
    const moves = planPlayingDealerShift(players, "pd", 9);
    expect(moves).toEqual([]);
  });

  it("PD が席 5 → 席 1..4 の 4 人が席 2..5 へ shift + PD は席 1 へ（合計 5 件）", () => {
    const players = [
      makePlayer({ id: "p1", tableNum: 1, seatNum: 1 }),
      makePlayer({ id: "p2", tableNum: 1, seatNum: 2 }),
      makePlayer({ id: "p3", tableNum: 1, seatNum: 3 }),
      makePlayer({ id: "p4", tableNum: 1, seatNum: 4 }),
      makePlayer({ id: "pd", tableNum: 1, seatNum: 5, isPlayingDealer: true }),
      makePlayer({ id: "p6", tableNum: 1, seatNum: 6 }),
    ];
    const moves = planPlayingDealerShift(players, "pd", 9);
    expect(moves).toHaveLength(5);
    // 元 1..4 が 2..5 へ
    const byPlayer = new Map(moves.map((m) => [m.playerId, m]));
    expect(byPlayer.get("p1")?.to).toEqual({ tableNum: 1, seatNum: 2 });
    expect(byPlayer.get("p2")?.to).toEqual({ tableNum: 1, seatNum: 3 });
    expect(byPlayer.get("p3")?.to).toEqual({ tableNum: 1, seatNum: 4 });
    expect(byPlayer.get("p4")?.to).toEqual({ tableNum: 1, seatNum: 5 });
    // PD は席 1 へ
    expect(byPlayer.get("pd")?.to).toEqual({ tableNum: 1, seatNum: 1 });
    // p6（席 6）は影響なし
    expect(byPlayer.get("p6")).toBeUndefined();
  });

  it("満員卓で PD が席 9 → 席 1..8 が 2..9 に shift（8 件）+ PD 席 1（合計 9 件）", () => {
    const players = Array.from({ length: 9 }, (_, i) =>
      makePlayer({
        id: i === 8 ? "pd" : `p${i + 1}`,
        tableNum: 1,
        seatNum: i + 1,
        isPlayingDealer: i === 8,
      }),
    );
    const moves = planPlayingDealerShift(players, "pd", 9);
    expect(moves).toHaveLength(9);
    const pdMove = moves.find((m) => m.playerId === "pd");
    expect(pdMove?.to).toEqual({ tableNum: 1, seatNum: 1 });
  });

  it("PD player が seatedNull → []（呼出側で先に席を割当てる前提）", () => {
    const players = [
      makePlayer({ id: "pd", tableNum: null, seatNum: null, isPlayingDealer: true }),
      makePlayer({ id: "p2", tableNum: 1, seatNum: 2 }),
    ];
    const moves = planPlayingDealerShift(players, "pd", 9);
    expect(moves).toEqual([]);
  });

  it("PD player が tablePlayers に存在しない → []", () => {
    const players = [
      makePlayer({ id: "p1", tableNum: 1, seatNum: 1 }),
      makePlayer({ id: "p2", tableNum: 1, seatNum: 2 }),
    ];
    const moves = planPlayingDealerShift(players, "ghost", 9);
    expect(moves).toEqual([]);
  });

  it("元 PD 席より後ろの席 (seatNum > originalPdSeat) は不変", () => {
    const players = [
      makePlayer({ id: "p1", tableNum: 1, seatNum: 1 }),
      makePlayer({ id: "p2", tableNum: 1, seatNum: 2 }),
      makePlayer({ id: "pd", tableNum: 1, seatNum: 3, isPlayingDealer: true }),
      makePlayer({ id: "p4", tableNum: 1, seatNum: 4 }),
      makePlayer({ id: "p9", tableNum: 1, seatNum: 9 }),
    ];
    const moves = planPlayingDealerShift(players, "pd", 9);
    // p4 と p9 は元 PD 席 3 より後ろのため shift 対象外
    expect(moves.find((m) => m.playerId === "p4")).toBeUndefined();
    expect(moves.find((m) => m.playerId === "p9")).toBeUndefined();
    expect(moves).toHaveLength(3); // p1, p2, pd の 3 件
  });

  it("PD が席 2 → 席 1 の 1 人が 2 へ + PD が 1 へ（2 件）", () => {
    const players = [
      makePlayer({ id: "p1", tableNum: 1, seatNum: 1 }),
      makePlayer({ id: "pd", tableNum: 1, seatNum: 2, isPlayingDealer: true }),
      makePlayer({ id: "p3", tableNum: 1, seatNum: 3 }),
    ];
    const moves = planPlayingDealerShift(players, "pd", 9);
    expect(moves).toHaveLength(2);
    const byPlayer = new Map(moves.map((m) => [m.playerId, m]));
    expect(byPlayer.get("p1")?.to).toEqual({ tableNum: 1, seatNum: 2 });
    expect(byPlayer.get("pd")?.to).toEqual({ tableNum: 1, seatNum: 1 });
  });

  it("seatNum === null の同卓 player は無視（busted 等のデータ防御）", () => {
    const players = [
      makePlayer({ id: "p1", tableNum: 1, seatNum: 1 }),
      makePlayer({ id: "x", tableNum: 1, seatNum: null }),
      makePlayer({ id: "pd", tableNum: 1, seatNum: 3, isPlayingDealer: true }),
    ];
    const moves = planPlayingDealerShift(players, "pd", 9);
    // p1 だけ shift、x は無視
    const byPlayer = new Map(moves.map((m) => [m.playerId, m]));
    expect(byPlayer.get("x")).toBeUndefined();
    expect(byPlayer.get("p1")?.to).toEqual({ tableNum: 1, seatNum: 2 });
    expect(byPlayer.get("pd")?.to).toEqual({ tableNum: 1, seatNum: 1 });
  });
});
