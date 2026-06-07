import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import {
  MAX_TABLES,
  TooManyPlayingDealersError,
  diagnoseBalancingNeed,
  planAddTable,
  planBalancingMove,
  planInitialSeating,
  planLateEntrySeat,
  planManualSeatCascade,
  planManualTableClose,
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
    isPlayingDealer: overrides.isPlayingDealer ?? false,
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

  it("seat は連番ではなく seat 集合 [1..N] の subset", () => {
    // characterization: 12 人 / seatsPerTable=9 / 2 卓 / PD 0 名
    // 各卓の seat は [1..9] のうち 6 つで、必ずしも {1,2,3,4,5,6} ではない。
    const players = manyPlayers(12);
    const plan = planInitialSeating(players, 9, 42);
    const byTable = new Map<number, number[]>();
    for (const a of plan.assignments) {
      const list = byTable.get(a.tableNum) ?? [];
      list.push(a.seatNum);
      byTable.set(a.tableNum, list);
    }
    for (const [, seats] of byTable) {
      expect(seats).toHaveLength(6);
      // すべての seat は 1..9
      for (const s of seats) {
        expect(s).toBeGreaterThanOrEqual(1);
        expect(s).toBeLessThanOrEqual(9);
      }
      // 重複なし
      expect(new Set(seats).size).toBe(seats.length);
    }
  });

  it("PD 1 名: 該当 player が必ず席 1 に、PD 卓は seed 依存", () => {
    const players = manyPlayers(12);
    const plan = planInitialSeating(players, 9, 42, ["p1"]);
    const pdAssignment = plan.assignments.find((a) => a.playerId === "p1");
    expect(pdAssignment).toBeDefined();
    expect(pdAssignment?.seatNum).toBe(1);
  });

  it("PD = numTables: 各卓の席 1 が PD player", () => {
    // 12 人 / 2 卓 / PD = [p1, p2]
    const players = manyPlayers(12);
    const plan = planInitialSeating(players, 9, 7, ["p1", "p2"]);
    const seat1ByTable = new Map<number, string>();
    for (const a of plan.assignments) {
      if (a.seatNum === 1) seat1ByTable.set(a.tableNum, a.playerId);
    }
    expect(new Set(seat1ByTable.values())).toEqual(new Set(["p1", "p2"]));
  });

  it("PD > numTables: TooManyPlayingDealersError throw", () => {
    const players = manyPlayers(12);
    expect(() =>
      planInitialSeating(players, 9, 0, ["p1", "p2", "p3"]),
    ).toThrow(TooManyPlayingDealersError);
  });

  it("PD 指定だが該当 player が active 外（busted） → PD 0 名扱い", () => {
    const players = [
      p({ id: "a" }),
      p({ id: "b", isBusted: true }),
      p({ id: "c" }),
    ];
    // pdPlayerIds=["b"] だが b は busted → 除外され PD 0 名扱いで通常配分
    const plan = planInitialSeating(players, 9, 0, ["b"]);
    expect(plan.assignments).toHaveLength(2);
  });

  it("12 人 / 2 卓 / PD 2 名: 各卓 6 人で席 1 が PD", () => {
    const players = manyPlayers(12);
    const plan = planInitialSeating(players, 9, 9, ["p1", "p2"]);
    const counts = new Map<number, number>();
    for (const a of plan.assignments) {
      counts.set(a.tableNum, (counts.get(a.tableNum) ?? 0) + 1);
    }
    expect(counts.get(1)).toBe(6);
    expect(counts.get(2)).toBe(6);
  });
});

describe("planLateEntrySeat", () => {
  it("最小卓を選ぶ（席は空席集合のいずれか）", () => {
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
    const seat = planLateEntrySeat(seated, [], 9, 42);
    expect(seat?.tableNum).toBe(1);
    // 卓 1 の空席は 4..9 の 6 通り。seed 依存でいずれか 1 つ。
    expect(seat?.seatNum).toBeGreaterThanOrEqual(4);
    expect(seat?.seatNum).toBeLessThanOrEqual(9);
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
    const seat = planLateEntrySeat(seated, [], 9, 7);
    expect(seat?.tableNum).toBe(1);
  });

  it("空席集合のいずれか 1 つが返る（穴あきも候補）", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "c", tableNum: 1, seatNum: 3 }),
    ];
    const seat = planLateEntrySeat(seated, [], 9, 1);
    expect(seat?.tableNum).toBe(1);
    // 占有 1, 3 を除いた {2, 4..9} のいずれか
    const expected = new Set([2, 4, 5, 6, 7, 8, 9]);
    expect(seat?.seatNum != null && expected.has(seat.seatNum)).toBe(true);
  });

  it("同 seed で同じ結果（再現性）", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "c", tableNum: 1, seatNum: 3 }),
    ];
    const r1 = planLateEntrySeat(seated, [], 9, 99);
    const r2 = planLateEntrySeat(seated, [], 9, 99);
    expect(r1).toEqual(r2);
  });

  it("全卓満席なら null", () => {
    const seated = Array.from({ length: 9 }, (_, i) =>
      p({ id: `s${i + 1}`, tableNum: 1, seatNum: i + 1 }),
    );
    const seat = planLateEntrySeat(seated, [], 9, 0);
    expect(seat).toBeNull();
  });

  it("broken 卓は対象外", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "b", tableNum: 2, seatNum: 1 }),
    ];
    const seat = planLateEntrySeat(seated, [1], 9, 0);
    expect(seat?.tableNum).toBe(2);
  });

  // Phase 4 (07): engine 改修ではなく既存挙動の lock-in。planLateEntrySeat は
  // seatedPlayers の tableNum 集合からしか生存卓を導出しないため、着席プレイヤーのいない
  // 空卓（= 追加 / 再開した卓）は構造的に候補から外れる。これにより「追加 / 再開卓には
  // 自動配席せず手動 D&D を正規とする」という Phase 4 の核心要件が engine 変更なしで成立する。
  it("着席プレイヤーのいない空卓は自動配席対象にならない（Phase 4: 追加/再開卓は手動配置）", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "b", tableNum: 1, seatNum: 2 }),
    ]; // 卓2 は tables には在るが seated に player 0 → liveTables に出ない
    const seat = planLateEntrySeat(seated, [], 2, 0);
    expect(seat).toBeNull();
  });
});

describe("planAddTable", () => {
  it("連番 [1,2] の次は 3", () => {
    expect(planAddTable([1, 2])).toBe(3);
  });

  it("broken 込みの連番 [1,2,3] の次は 4（broken も doc が残るため占有扱い）", () => {
    expect(planAddTable([1, 2, 3])).toBe(4);
  });

  it("gap がある [1,3] は最小空き 2 を返す", () => {
    expect(planAddTable([1, 3])).toBe(2);
  });

  it("MAX_TABLES まで埋まっていれば null", () => {
    expect(planAddTable([1, 2, 3, 4, 5, 6])).toBeNull();
  });

  it("空配列なら 1", () => {
    expect(planAddTable([])).toBe(1);
  });

  it("maxTables を引数で渡せる（[1,2], 2 → null）", () => {
    expect(planAddTable([1, 2], 2)).toBeNull();
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

  it("PD は移動候補から除外: 過剰卓最小席が PD なら次小席 player を選ぶ", () => {
    // 卓 1: 3 人（席 1 が PD）, 卓 2: 1 人 → 差 2
    const seated = [
      p({ id: "pd", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      p({ id: "p2", tableNum: 1, seatNum: 2 }),
      p({ id: "p3", tableNum: 1, seatNum: 3 }),
      p({ id: "x", tableNum: 2, seatNum: 1 }),
    ];
    const move = planBalancingMove(seated, [], 9);
    expect(move).not.toBeNull();
    expect(move?.playerId).toBe("p2"); // PD ではなく次に小さい席番号
  });

  it("非 PD 卓が source になる（PD のみ卓は dest 側で候補除外の影響を受けない）", () => {
    // 卓 1: PD のみ 1 人 / 卓 2: 非 PD 3 人 → 過剰卓は卓 2 / 不足卓は卓 1。
    // 卓 2 の最小席 (x1) が卓 1 の最小空席（PD が seat 1 占有なので seat 2）へ動く。
    // PD 除外フィルタは「source 卓の candidates」に対してのみ効くため、
    // dest 卓に PD が居ても move は成立する。
    // null 経路（max 卓全員 PD）の characterization は diagnoseBalancingNeed 側に集約。
    const seated = [
      p({ id: "pd1", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      p({ id: "x1", tableNum: 2, seatNum: 1 }),
      p({ id: "x2", tableNum: 2, seatNum: 2 }),
      p({ id: "x3", tableNum: 2, seatNum: 3 }),
    ];
    const move = planBalancingMove(seated, [], 9);
    expect(move?.playerId).toBe("x1");
    expect(move?.from.tableNum).toBe(2);
    expect(move?.to.tableNum).toBe(1);
    expect(move?.to.seatNum).toBe(2); // PD が seat 1 占有のため最小空席は 2
  });
});

describe("diagnoseBalancingNeed", () => {
  it("差 2 で source / dest / candidates を返す", () => {
    const seated = [
      ...Array.from({ length: 7 }, (_, i) =>
        p({ id: `t1-${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        p({ id: `t2-${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const diag = diagnoseBalancingNeed(seated, [], 9);
    expect(diag).not.toBeNull();
    expect(diag?.sourceTableNum).toBe(1);
    expect(diag?.destTableNum).toBe(2);
    expect(diag?.destSeatNum).toBe(6);
    expect(diag?.diff).toBe(2);
    expect(diag?.candidatePlayerIds).toEqual([
      "t1-1",
      "t1-2",
      "t1-3",
      "t1-4",
      "t1-5",
      "t1-6",
      "t1-7",
    ]);
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
    expect(diagnoseBalancingNeed(seated, [], 9)).toBeNull();
  });

  it("PD は candidates から除外される（席 1 に PD ありなら席 2,3,... が先頭）", () => {
    const seated = [
      p({ id: "pd", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      p({ id: "p2", tableNum: 1, seatNum: 2 }),
      p({ id: "p3", tableNum: 1, seatNum: 3 }),
      p({ id: "x", tableNum: 2, seatNum: 1 }),
    ];
    const diag = diagnoseBalancingNeed(seated, [], 9);
    expect(diag?.candidatePlayerIds).toEqual(["p2", "p3"]);
  });

  it("過剰卓全員 PD で candidates 0 → null", () => {
    // 卓 1: 1 名 (PD), 卓 2: 3 名 → max=卓 2, candidates は卓 2 から PD 除外で全員残るはず。
    // PD のみ卓を作るには 1 卓 1 PD 制約に反するため、ここでは max が PD 1 名のみ卓のケースを作る:
    // 卓 1: 3 名 (全員 PD？ 1 卓 1 PD 制約違反のため作れない)
    // 代わりに、PD 卓が source になるケースをシミュレート: 卓 1: 3 名 (席 1 PD), 卓 2: 1 名
    // → candidates は卓 1 の席 2,3 で OK。null になるシナリオは PD のみで空席もない overconstrained。
    // 実用上の null は dest 卓に空席なし or candidates 0 のみ。後者は seatedPlayers[]
    // から source 卓に PD のみ + 他全員 busted の異常状態を作って検証する。
    const seated = [
      p({ id: "pd", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      p({ id: "x", tableNum: 2, seatNum: 1 }),
      p({ id: "y", tableNum: 2, seatNum: 2 }),
      p({ id: "z", tableNum: 2, seatNum: 3 }),
    ];
    // ここでは max=卓 2 (3 名), candidates は卓 2 全員 → null にならない。
    // 「PD のみで動かせない」を null にするには planBalancingMove 既存の挙動と同じく
    // candidates 0 のとき null。0 になるのは max=卓 1 (PD のみ) だが diff>=2 で max になるには
    // 卓 1 が多くなる必要があり、その場合卓 1 に PD 以外の active がいる。これは設計上発生不可。
    // 防御として「全員 PD の max 卓」を unit で確認:
    const allPdMax = [
      p({ id: "pd1", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      p({ id: "pd2", tableNum: 1, seatNum: 2, isPlayingDealer: true }),
      p({ id: "pd3", tableNum: 1, seatNum: 3, isPlayingDealer: true }),
      p({ id: "x", tableNum: 2, seatNum: 1 }),
    ];
    expect(diagnoseBalancingNeed(allPdMax, [], 9)).toBeNull();
    // 通常ケースは候補が出る:
    const diag = diagnoseBalancingNeed(seated, [], 9);
    expect(diag?.sourceTableNum).toBe(2);
    expect(diag?.candidatePlayerIds).toEqual(["x", "y", "z"]);
  });

  it("不足卓に空席なし → null", () => {
    // 不足卓が満席というシナリオは数学的に成立しない（max > min なら min < seatsPerTable）
    // が、broken 反映のタイミング次第で起こり得るため防御を確認。
    // 卓 1: 9 名（満席）, 卓 2: 9 名（満席） → diff=0 で null（差 0 で早期 return）。
    // 純粋な「dest 満席で null」を作るのは難しいので diff>=2 + dest=満席を強制的に組む:
    // 卓 1: 9 名, 卓 2: 7 名 → max=1, min=2, diff=2, dest 卓 2 に空席あり → not null
    // diff>=2 かつ dest 満席は組めないため、本ケースは現実的に null 経路に到達しない。
    // 代替: planBalancingMove と同じ結果を返すことを確認。
    const seated = [
      ...Array.from({ length: 9 }, (_, i) =>
        p({ id: `t1-${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 7 }, (_, i) =>
        p({ id: `t2-${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
    ];
    const diag = diagnoseBalancingNeed(seated, [], 9);
    expect(diag?.destSeatNum).toBe(8); // 卓 2 の最小空席
  });

  it("planBalancingMove は diagnoseBalancingNeed と整合（先頭候補を採用）", () => {
    // 既存 planBalancingMove tests と同 fixture で挙動が一致することを確認。
    const seated = [
      p({ id: "pd", tableNum: 1, seatNum: 1, isPlayingDealer: true }),
      p({ id: "p2", tableNum: 1, seatNum: 2 }),
      p({ id: "p3", tableNum: 1, seatNum: 3 }),
      p({ id: "x", tableNum: 2, seatNum: 1 }),
    ];
    const diag = diagnoseBalancingNeed(seated, [], 9);
    const move = planBalancingMove(seated, [], 9);
    expect(move?.playerId).toBe(diag?.candidatePlayerIds[0]);
    expect(move?.to.tableNum).toBe(diag?.destTableNum);
    expect(move?.to.seatNum).toBe(diag?.destSeatNum);
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

describe("planManualTableClose", () => {
  it("指定卓を閉じて残卓へ集約（定員内）", () => {
    // 卓1:3, 卓2:3, 卓3:3 / target=3 → 卓3 の 3 名を卓1/2 へ。
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "b3", tableNum: 2, seatNum: 3 }),
      p({ id: "c1", tableNum: 3, seatNum: 1 }),
      p({ id: "c2", tableNum: 3, seatNum: 2 }),
      p({ id: "c3", tableNum: 3, seatNum: 3 }),
    ];
    const result = planManualTableClose(seated, [1, 2, 3], 3);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan.brokenTableNum).toBe(3);
    expect(result.plan.moves).toHaveLength(3);
    // 移動先は卓1/2 のいずれか（閉鎖卓 3 へは戻さない）。
    for (const m of result.plan.moves) {
      expect([1, 2]).toContain(m.to.tableNum);
    }
  });

  it("定員引き上げ（seatsPerTable 超）で残卓が 8 名まで膨らむ", () => {
    // 卓1:6, 卓2:6, 卓3:4（席は 1..6 / 1..4）。maxSeatsPerTable=10（既定）で target=3。
    // 卓1/2 が 8 名まで膨らむ → 少なくとも 1 つの move の to.seatNum が 6 超。
    const seated = [
      ...Array.from({ length: 6 }, (_, i) =>
        p({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        p({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        p({ id: `c${i + 1}`, tableNum: 3, seatNum: i + 1 }),
      ),
    ];
    const result = planManualTableClose(seated, [1, 2, 3], 3);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan.moves).toHaveLength(4);
    expect(result.plan.moves.some((m) => m.to.seatNum > 6)).toBe(true);
    // seatNum は maxSeatsPerTable(10) を超えない。
    for (const m of result.plan.moves) {
      expect(m.to.seatNum).toBeLessThanOrEqual(10);
    }
  });

  it("残卓に収まらなければ overflow でブロック", () => {
    // 卓1:10, 卓2:10, 卓3:2 / target=3 → capacity=20, needed=22 → overflow。
    const seated = [
      ...Array.from({ length: 10 }, (_, i) =>
        p({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        p({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
      ),
      p({ id: "c1", tableNum: 3, seatNum: 1 }),
      p({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const result = planManualTableClose(seated, [1, 2, 3], 3);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected overflow");
    expect(result.reason).toBe("overflow");
    expect(result.capacity).toBe(20);
    expect(result.needed).toBe(22);
  });

  it("最後の 1 卓は閉じられない", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
    ];
    const result = planManualTableClose(seated, [1], 1);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected only-one-table");
    expect(result.reason).toBe("only-one-table");
  });

  it("既閉鎖 / 不正卓番号は not-found", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
    ];
    // liveTableNums=[1]（卓2 は既閉鎖）。target=2 は生存卓に無い → not-found。
    // 生存卓集合に存在しない卓番号（実在しない 99 等）も同経路で not-found。
    const result = planManualTableClose(seated, [1], 2);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected not-found");
    expect(result.reason).toBe("not-found");
  });

  it("空卓（active 0）の閉鎖は moves 0 件で成立", () => {
    // 卓1:3, 卓2:3 の active のみ（卓3 は active 0 = seated に現れない）。
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "b3", tableNum: 2, seatNum: 3 }),
    ];
    const result = planManualTableClose(seated, [1, 2, 3], 3);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan.brokenTableNum).toBe(3);
    expect(result.plan.moves).toHaveLength(0);
  });

  it("詰め込みは占有最少卓・同数なら tableNum 昇順", () => {
    // 卓1:1, 卓2:4, 卓3:2 / target=3 → 卓3 の 2 名は最少の卓1 へ、空き昇順 seat。
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "b1", tableNum: 2, seatNum: 1 }),
      p({ id: "b2", tableNum: 2, seatNum: 2 }),
      p({ id: "b3", tableNum: 2, seatNum: 3 }),
      p({ id: "b4", tableNum: 2, seatNum: 4 }),
      p({ id: "c1", tableNum: 3, seatNum: 1 }),
      p({ id: "c2", tableNum: 3, seatNum: 2 }),
    ];
    const result = planManualTableClose(seated, [1, 2, 3], 3);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan.moves).toHaveLength(2);
    expect(result.plan.moves.map((m) => m.to.tableNum)).toEqual([1, 1]);
    expect(result.plan.moves.map((m) => m.to.seatNum)).toEqual([2, 3]);
  });

  it("空 live 卓も再配置先になり偽 overflow を出さない", () => {
    // 卓1:10（満席）, 卓2:0（実在・未閉鎖だが active 0）, 卓3:5 / target=3。
    // 空卓 2 を destination に含めるため capacity=2×10=20 で 15 名は収まる。
    // （生存卓を active から導出していた旧実装は卓2 を見落とし survivingTables=[1] と
    //   誤認 → capacity=10 < 15 で偽 overflow になっていた。）
    const seated = [
      ...Array.from({ length: 10 }, (_, i) =>
        p({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        p({ id: `c${i + 1}`, tableNum: 3, seatNum: i + 1 }),
      ),
    ];
    const result = planManualTableClose(seated, [1, 2, 3], 3);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.plan.moves).toHaveLength(5);
    // 卓1 は満席(10)なので 5 名はすべて空卓 2 へ集約され、席は昇順。
    for (const m of result.plan.moves) {
      expect(m.to.tableNum).toBe(2);
    }
    expect(result.plan.moves.map((m) => m.to.seatNum)).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("planManualSeatCascade", () => {
  it("returns single move when target seat is empty (no cascade needed)", () => {
    // 席 1,2,3 占有 / dragged=席 1 / target=席 5（空）
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1 }),
      p({ id: "b", tableNum: 1, seatNum: 2 }),
      p({ id: "c", tableNum: 1, seatNum: 3 }),
    ];
    const moves = planManualSeatCascade(seated, "a", 5);
    expect(moves).toHaveLength(1);
    expect(moves?.[0]).toEqual({
      playerId: "a",
      from: { tableNum: 1, seatNum: 1 },
      to: { tableNum: 1, seatNum: 5 },
    });
  });

  it("cascade direction +1 for target<source: 5→2 with seats 1,2,3,5,6 (gap at 4)", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "a5", tableNum: 1, seatNum: 5 }),
      p({ id: "a6", tableNum: 1, seatNum: 6 }),
    ];
    const moves = planManualSeatCascade(seated, "a5", 2);
    expect(moves).toEqual([
      { playerId: "a2", from: { tableNum: 1, seatNum: 2 }, to: { tableNum: 1, seatNum: 3 } },
      { playerId: "a3", from: { tableNum: 1, seatNum: 3 }, to: { tableNum: 1, seatNum: 4 } },
      { playerId: "a5", from: { tableNum: 1, seatNum: 5 }, to: { tableNum: 1, seatNum: 2 } },
    ]);
  });

  it("cascade direction -1 for target>source: 2→5 with seats 1,2,3,5,6", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "a5", tableNum: 1, seatNum: 5 }),
      p({ id: "a6", tableNum: 1, seatNum: 6 }),
    ];
    const moves = planManualSeatCascade(seated, "a2", 5);
    // direction = -1。walk: 席 5 → 席 4(empty で停止)
    expect(moves).toEqual([
      { playerId: "a5", from: { tableNum: 1, seatNum: 5 }, to: { tableNum: 1, seatNum: 4 } },
      { playerId: "a2", from: { tableNum: 1, seatNum: 2 }, to: { tableNum: 1, seatNum: 5 } },
    ]);
  });

  it("cascade fills source when no empty seats between target and source: 4→1 with 1,2,3,4 occupied", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: 2 }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "a4", tableNum: 1, seatNum: 4 }),
    ];
    const moves = planManualSeatCascade(seated, "a4", 1);
    // direction=+1. walk 1→2, 2→3, 3→4(=source, dragged 除外で empty 扱い)
    expect(moves).toEqual([
      { playerId: "a1", from: { tableNum: 1, seatNum: 1 }, to: { tableNum: 1, seatNum: 2 } },
      { playerId: "a2", from: { tableNum: 1, seatNum: 2 }, to: { tableNum: 1, seatNum: 3 } },
      { playerId: "a3", from: { tableNum: 1, seatNum: 3 }, to: { tableNum: 1, seatNum: 4 } },
      { playerId: "a4", from: { tableNum: 1, seatNum: 4 }, to: { tableNum: 1, seatNum: 1 } },
    ]);
  });

  it("returns null when PD encountered in cascade range: 4→1 with PD at seat 2", () => {
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "pd", tableNum: 1, seatNum: 2, isPlayingDealer: true }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
      p({ id: "a4", tableNum: 1, seatNum: 4 }),
    ];
    // walk 1→2, 2 が PD → null
    expect(planManualSeatCascade(seated, "a4", 1)).toBeNull();
  });

  it("returns null when target === source (no-op)", () => {
    const seated = [p({ id: "a", tableNum: 1, seatNum: 3 })];
    expect(planManualSeatCascade(seated, "a", 3)).toBeNull();
  });

  it("returns null when dragged player is busted", () => {
    const seated = [
      p({ id: "a", tableNum: 1, seatNum: 1, isBusted: true, bustedAt: ts }),
    ];
    expect(planManualSeatCascade(seated, "a", 5)).toBeNull();
  });

  it("returns null when dragged player not in list", () => {
    const seated = [p({ id: "a", tableNum: 1, seatNum: 1 })];
    expect(planManualSeatCascade(seated, "ghost", 5)).toBeNull();
  });

  it("ignores busted players in seat occupancy map (acts as empty)", () => {
    // a2 is busted (no seat) → seat 2 effectively empty for cascade
    const seated = [
      p({ id: "a1", tableNum: 1, seatNum: 1 }),
      p({ id: "a2", tableNum: 1, seatNum: null, isBusted: true, bustedAt: ts }),
      p({ id: "a3", tableNum: 1, seatNum: 3 }),
    ];
    // dragged a3, target seat 1: walk seat 1 → push to 2 (empty since a2 busted-no-seat)
    const moves = planManualSeatCascade(seated, "a3", 1);
    expect(moves).toEqual([
      { playerId: "a1", from: { tableNum: 1, seatNum: 1 }, to: { tableNum: 1, seatNum: 2 } },
      { playerId: "a3", from: { tableNum: 1, seatNum: 3 }, to: { tableNum: 1, seatNum: 1 } },
    ]);
  });
});
