import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import {
  MAX_TABLES,
  planBalancingMove,
  planInitialSeating,
  planLateEntrySeat,
  planTableBreak,
} from "./engine";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

function p(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
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
  };
}

function manyPlayers(n: number): PlayerDoc[] {
  return Array.from({ length: n }, (_, i) => p({ id: `p${i + 1}` }));
}

describe("planInitialSeating", () => {
  it("18 人 × 9 席 = 2 卓に均等配置", () => {
    const players = manyPlayers(18);
    const plan = planInitialSeating(players, 9, 42);
    expect(plan.tableNums).toEqual([1, 2]);
    const counts = new Map<number, number>();
    for (const a of plan.assignments) {
      counts.set(a.tableNum, (counts.get(a.tableNum) ?? 0) + 1);
    }
    expect(counts.get(1)).toBe(9);
    expect(counts.get(2)).toBe(9);
    expect(plan.assignments).toHaveLength(18);
  });

  it("20 人 × 9 席 = 3 卓 (7/7/6)", () => {
    const players = manyPlayers(20);
    const plan = planInitialSeating(players, 9, 1);
    expect(plan.tableNums).toEqual([1, 2, 3]);
    const counts = new Map<number, number>();
    for (const a of plan.assignments) {
      counts.set(a.tableNum, (counts.get(a.tableNum) ?? 0) + 1);
    }
    // round-robin (i % 3) で 0/3/6/.../18 が卓1、1/4/.../19 が卓2、2/5/.../17 が卓3 → 7/7/6
    expect(counts.get(1)).toBe(7);
    expect(counts.get(2)).toBe(7);
    expect(counts.get(3)).toBe(6);
  });

  it("同 seed で 2 回呼ぶと同じ結果（再現性）", () => {
    const players = manyPlayers(18);
    const plan1 = planInitialSeating(players, 9, 42);
    const plan2 = planInitialSeating(players, 9, 42);
    expect(plan1.assignments).toEqual(plan2.assignments);
  });

  it("0 人なら空 plan", () => {
    const plan = planInitialSeating([], 9, 0);
    expect(plan.assignments).toEqual([]);
    expect(plan.tableNums).toEqual([]);
  });

  it("MAX_TABLES 超過は throw", () => {
    const players = manyPlayers(MAX_TABLES * 9 + 1);
    expect(() => planInitialSeating(players, 9, 0)).toThrow(/tables exceed max/);
  });

  it("バスト済みプレイヤーは除外", () => {
    const players = [
      p({ id: "a" }),
      p({ id: "b", isBusted: true }),
      p({ id: "c" }),
    ];
    const plan = planInitialSeating(players, 9, 0);
    expect(plan.assignments).toHaveLength(2);
    expect(plan.tableNums).toEqual([1]);
  });
});

describe("planLateEntrySeat", () => {
  it("最小卓に席を返す", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "b", tableNum: 1, seatNum: 2 }),
      p({ id: "c", tableNum: 1, seatNum: 3 }),
      p({ id: "d", tableNum: 2, seatNum: 1 }),
      p({ id: "e", tableNum: 2, seatNum: 2 }),
      p({ id: "f", tableNum: 2, seatNum: 3 }),
      p({ id: "g", tableNum: 2, seatNum: 4 }),
      p({ id: "h", tableNum: 2, seatNum: 5 }),
    ];
    const seat = planLateEntrySeat(seated, [], 9);
    expect(seat).toEqual({ tableNum: 1, seatNum: 4 });
  });

  it("同数の場合は tableNum 昇順", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "b3", tableNum: 2, seatNum: 3 }),
    ];
    const seat = planLateEntrySeat(seated, [], 9);
    expect(seat?.tableNum).toBe(1);
  });

  it("最小空席 seatNum を返す（穴あき優先）", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "c", tableNum: 1, seatNum: 3 }),
    ];
    const seat = planLateEntrySeat(seated, [], 9);
    expect(seat).toEqual({ tableNum: 1, seatNum: 2 });
  });

  it("全卓満席なら null", () => {
    const seated = Array.from({ length: 9 }, (_, i) =>
      p({ id: `s${i + 1}`, tableNum: 1, seatNum: i + 1 }),
    );
    const seat = planLateEntrySeat(seated, [], 9);
    expect(seat).toBeNull();
  });

  it("broken 卓は対象外", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "b", tableNum: 2, seatNum: 1 }),
    ];
    const seat = planLateEntrySeat(seated, [1], 9);
    expect(seat?.tableNum).toBe(2);
  });
});

describe("planBalancingMove", () => {
  it("差 2 で 1 件の move を返す（最小席番号→最小空席）", () => {
    const seated = [
      ...Array.from({ length: 7 }, (_, i) =>
        p({ id: `t1-${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        p({ id: `t2-${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const move = planBalancingMove(seated, [], 9);
    expect(move).not.toBeNull();
    expect(move?.from).toEqual({ tableNum: 1, seatNum: 1 });
    expect(move?.to).toEqual({ tableNum: 2, seatNum: 6 });
    expect(move?.playerId).toBe("t1-1");
  });

  it("差 1 は null", () => {
    const seated = [
      ...Array.from({ length: 6 }, (_, i) =>
        p({ id: `t1-${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        p({ id: `t2-${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const move = planBalancingMove(seated, [], 9);
    expect(move).toBeNull();
  });

  it("差 4 でも 1 件のみ（呼出し側で再評価）", () => {
    const seated = [
      ...Array.from({ length: 9 }, (_, i) =>
        p({ id: `t1-${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        p({ id: `t2-${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const move = planBalancingMove(seated, [], 9);
    expect(move).not.toBeNull();
    expect(move?.from.tableNum).toBe(1);
    expect(move?.to.tableNum).toBe(2);
  });

  it("バスト済みは count に含めない", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "b", tableNum: 1, seatNum: 2 }),
      p({ id: "c", tableNum: 1, seatNum: 3 }),
      p({ id: "d", isBusted: true, tableNum: null, seatNum: null }),
      p({ id: "e", tableNum: 2, seatNum: 1 }),
    ];
    const move = planBalancingMove(seated, [], 9);
    // 卓 1 = 3 人、卓 2 = 1 人 → 差 2
    expect(move).not.toBeNull();
  });
});

describe("planTableBreak", () => {
  it("条件成立で 1 卓閉鎖（最少人数→tableNum 最大）", () => {
    // 卓 1: 3 人, 卓 2: 5 人, 卓 3: 2 人 → 計 10 人, seatsPerTable=9 → (3-1)*9=18 ≥ 10
    // 最少人数 2 = 卓 3 → 閉じる。同数なら tableNum 最大ルールだが今回は単独。
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "b3", tableNum: 2, seatNum: 3 }),
      p({ id: "b4", tableNum: 2, seatNum: 4 }),
      p({ id: "b5", tableNum: 2, seatNum: 5 }),
      p({ id: "c1", tableNum: 3, seatNum: 1 }),
      p({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const plan = planTableBreak(seated, [], 9);
    expect(plan).not.toBeNull();
    expect(plan?.brokenTableNum).toBe(3);
    expect(plan?.moves).toHaveLength(2);
  });

  it("不可能なら null", () => {
    const seated = [
      ...Array.from({ length: 9 }, (_, i) =>
        p({ id: `t1-${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 9 }, (_, i) =>
        p({ id: `t2-${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const plan = planTableBreak(seated, [], 9);
    expect(plan).toBeNull();
  });

  it("1 卓のみなら null", () => {
    const seated = [p({ id: "a", tableNum: 1, seatNum: 1 })];
    const plan = planTableBreak(seated, [], 9);
    expect(plan).toBeNull();
  });

  it("同数最少なら tableNum 最大を閉鎖", () => {
    // 卓 1: 2, 卓 2: 2, 卓 3: 5 → 計 9, (3-1)*9=18 ≥ 9 OK
    // 最少 2 が卓 1 と 2 → tableNum 最大 = 卓 2 を閉じる
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "c1", tableNum: 3, seatNum: 1 }),
      p({ id: "c2", tableNum: 3, seatNum: 2 }),
      p({ id: "c3", tableNum: 3, seatNum: 3 }),
      p({ id: "c4", tableNum: 3, seatNum: 4 }),
      p({ id: "c5", tableNum: 3, seatNum: 5 }),
    ];
    const plan = planTableBreak(seated, [], 9);
    expect(plan?.brokenTableNum).toBe(2);
  });

  it("閉鎖プレイヤーは生存卓のうち少ない卓へ詰める", () => {
    // 卓 1: 1, 卓 2: 4, 卓 3: 2 → 計 7, (3-1)*9=18 ≥ 7 OK → 卓 1 閉鎖（1 名）
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "b3", tableNum: 2, seatNum: 3 }),
      p({ id: "b4", tableNum: 2, seatNum: 4 }),
      p({ id: "c1", tableNum: 3, seatNum: 1 }),
      p({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const plan = planTableBreak(seated, [], 9);
    expect(plan?.brokenTableNum).toBe(1);
    // a1 を卓 3（少ない卓）へ
    expect(plan?.moves[0].to.tableNum).toBe(3);
    expect(plan?.moves[0].to.seatNum).toBe(3);
  });
});
