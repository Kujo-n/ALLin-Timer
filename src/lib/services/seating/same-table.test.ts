import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import {
  getSameTableActiveOtherIds,
  getSameTableActivePdOtherIds,
} from "./same-table";

function ts(): Timestamp {
  return Timestamp.fromMillis(0);
}

function p(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    displayName: overrides.id.toUpperCase(),
    uid: overrides.id,
    entryAt: ts(),
    isBusted: false,
    bustedAt: null,
    tableNum: 1,
    seatNum: 1,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

describe("getSameTableActiveOtherIds", () => {
  const players: PlayerDoc[] = [
    p({ id: "a", tableNum: 1, seatNum: 1 }),
    p({ id: "b", tableNum: 1, seatNum: 2 }),
    p({ id: "c", tableNum: 1, seatNum: 3, isBusted: true }),
    p({ id: "d", tableNum: 2, seatNum: 1 }),
    p({ id: "e", tableNum: null, seatNum: null }),
  ];

  it("returns same-table other active player ids (excludes self / busted / other tables / no-table)", () => {
    const self = players[0]; // id=a, table 1
    expect(getSameTableActiveOtherIds(self, players)).toEqual(["b"]);
  });

  it("returns empty when player has no table seat", () => {
    const self = players[4]; // id=e, table null
    expect(getSameTableActiveOtherIds(self, players)).toEqual([]);
  });

  it("returns empty when no other player shares the table", () => {
    const self = players[3]; // id=d, table 2 alone
    expect(getSameTableActiveOtherIds(self, players)).toEqual([]);
  });
});

describe("getSameTableActivePdOtherIds", () => {
  const players: PlayerDoc[] = [
    p({ id: "a", tableNum: 1, seatNum: 1 }),
    p({ id: "pd1", tableNum: 1, seatNum: 2, isPlayingDealer: true }),
    p({ id: "pd-busted", tableNum: 1, seatNum: 3, isPlayingDealer: true, isBusted: true }),
    p({ id: "pd-other-table", tableNum: 2, seatNum: 1, isPlayingDealer: true }),
    p({ id: "pd-self", tableNum: 1, seatNum: 4, isPlayingDealer: true }),
  ];

  it("returns only same-table active PD others (excludes self / busted / other tables / non-PD)", () => {
    const self = players[0]; // id=a (non-PD), table 1
    expect(getSameTableActivePdOtherIds(self, players).sort()).toEqual([
      "pd-self",
      "pd1",
    ]);
  });

  it("excludes self even if self is PD", () => {
    const self = players[4]; // id=pd-self
    expect(getSameTableActivePdOtherIds(self, players)).toEqual(["pd1"]);
  });

  it("returns empty when player has no table seat", () => {
    const self = p({ id: "x", tableNum: null, seatNum: null });
    expect(getSameTableActivePdOtherIds(self, players)).toEqual([]);
  });
});
