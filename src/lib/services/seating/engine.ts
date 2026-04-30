// Phase 4: TDA 2015 ルール（6 テーブル以下）に準拠した席決定ロジックの pure function 群。
// Firestore への副作用は持たず、入力 → 計画 (plan) の変換だけを行う。
// 呼び出し側（orchestrator）が plan を受け取って Firestore に反映する。
//
// MVP の明示的な近似: TDA の「BB 次プレイヤー」はディーラーボタン位置に基づくが、
// 本アプリはボタン位置を追跡しないため「席番号最小」を tie-break として代替する。

import { MAX_TABLES } from "@/lib/limits";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import { shuffle } from "./prng";

/**
 * 最大テーブル数を `@/lib/limits` から再 export。既存テスト
 * (`engine.test.ts` 等) が `import { MAX_TABLES } from "./engine"` 経由で参照している
 * ため、この re-export を維持して移行コストを抑える。
 */
export { MAX_TABLES };

/**
 * 卓数が MAX_TABLES を超える計画になった場合に投げる。
 * orchestrator は instanceof で判別して `seating/too-many-tables` の AppError に変換する
 * （文字列マッチに依存しない判別経路）。
 */
export class TooManyTablesError extends Error {
  constructor(
    public readonly required: number,
    public readonly max: number,
  ) {
    super(`tables exceed max: ${required} > ${max}`);
    this.name = "TooManyTablesError";
  }
}

/**
 * seatsPerTable が 1 未満で呼ばれた場合に投げる（schema 側で弾かれる前提の防御）。
 */
export class InvalidSeatsPerTableError extends Error {
  constructor(public readonly seatsPerTable: number) {
    super(`seatsPerTable must be >= 1: ${seatsPerTable}`);
    this.name = "InvalidSeatsPerTableError";
  }
}

export interface Seat {
  tableNum: number;
  seatNum: number;
}

interface SeatAssignment {
  playerId: string;
  tableNum: number;
  seatNum: number;
}

interface InitialSeatingPlan {
  assignments: SeatAssignment[];
  /** upsertTables() に渡す tableNum の配列（昇順）。 */
  tableNums: number[];
}

export interface BalancingMove {
  playerId: string;
  from: Seat;
  to: Seat;
}

interface TableBreakPlan {
  brokenTableNum: number;
  /** 解散したテーブルから生存テーブルへの全件移動指示。 */
  moves: BalancingMove[];
}

/**
 * 初回席決め: 未バストのプレイヤーを seatsPerTable で均等割り。
 * seed を渡すとテストで再現可能。
 *
 * 卓数 = ceil(activePlayers / seatsPerTable)。MAX_TABLES 超過は throw。
 * シャッフルしたプレイヤーを round-robin で各卓に詰めるため、最大の偏りは ±1。
 */
export function planInitialSeating(
  players: PlayerDoc[],
  seatsPerTable: number,
  seed: number,
): InitialSeatingPlan {
  if (seatsPerTable < 1) {
    throw new InvalidSeatsPerTableError(seatsPerTable);
  }
  const active = players.filter((p) => !p.isBusted);
  if (active.length === 0) return { assignments: [], tableNums: [] };
  const numTables = Math.max(1, Math.ceil(active.length / seatsPerTable));
  if (numTables > MAX_TABLES) {
    throw new TooManyTablesError(numTables, MAX_TABLES);
  }
  const shuffled = shuffle(active, seed);
  const buckets: PlayerDoc[][] = Array.from({ length: numTables }, () => []);
  for (let i = 0; i < shuffled.length; i++) {
    buckets[i % numTables].push(shuffled[i]);
  }
  const assignments: SeatAssignment[] = [];
  for (let t = 0; t < numTables; t++) {
    for (let s = 0; s < buckets[t].length; s++) {
      assignments.push({
        playerId: buckets[t][s].id,
        tableNum: t + 1,
        seatNum: s + 1,
      });
    }
  }
  const tableNums = Array.from({ length: numTables }, (_, i) => i + 1);
  return { assignments, tableNums };
}

/**
 * 進行中レイトエントリーの自動配席。
 * ルール: 活動プレイヤー数が最小の卓（同数なら tableNum 昇順）の、空席最小 seatNum。
 * 全卓満席なら null（呼出し側で「締切超過」エラー扱い）。
 *
 * 注意: broken でない既存卓のみが配席対象。tables 一覧ではなく seatedPlayers の
 * tableNum 集合を真実源とすることで、tables collection の遅延読込に依存しない。
 */
export function planLateEntrySeat(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): Seat | null {
  const tableCount = new Map<number, number>();
  const occupied = new Set<string>();
  for (const p of seatedPlayers) {
    if (p.isBusted) continue;
    if (p.tableNum === null || p.seatNum === null) continue;
    tableCount.set(p.tableNum, (tableCount.get(p.tableNum) ?? 0) + 1);
    occupied.add(`${p.tableNum}-${p.seatNum}`);
  }
  const liveTables = Array.from(tableCount.keys()).filter(
    (n) => !brokenTableNums.includes(n),
  );
  if (liveTables.length === 0) return null;
  liveTables.sort((a, b) => {
    const ca = tableCount.get(a) ?? 0;
    const cb = tableCount.get(b) ?? 0;
    if (ca !== cb) return ca - cb;
    return a - b;
  });
  for (const t of liveTables) {
    if ((tableCount.get(t) ?? 0) >= seatsPerTable) continue;
    for (let s = 1; s <= seatsPerTable; s++) {
      if (!occupied.has(`${t}-${s}`)) return { tableNum: t, seatNum: s };
    }
  }
  return null;
}

/**
 * 差分 ≥ 2 の場合のバランシング 1 件。差分が 4 以上でも 1 件のみ返し、
 * 呼出し側が反復して再評価する（運営者の「指示完了」ボタンが re-trigger）。
 *
 * 過剰卓から「席番号最小」のプレイヤーを、不足卓の「最小空席」へ移動。
 * 差 1 以下なら null（=操作不要）。
 */
export function planBalancingMove(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): BalancingMove | null {
  const { maxTable, minTable, diff } = computeTableCounts(seatedPlayers, brokenTableNums);
  if (maxTable === null || minTable === null) return null;
  if (diff < 2) return null;
  // maxTable の最小席番号プレイヤー（未バスト・席あり）。同席番号は zod 制約で発生しない。
  const movedPlayer = seatedPlayers
    .filter(
      (p) => !p.isBusted && p.tableNum === maxTable && p.seatNum !== null,
    )
    .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0))[0];
  if (!movedPlayer || movedPlayer.seatNum === null) return null;
  const occupied = new Set<number>();
  for (const p of seatedPlayers) {
    if (p.isBusted) continue;
    if (p.tableNum !== minTable) continue;
    if (p.seatNum === null) continue;
    occupied.add(p.seatNum);
  }
  let targetSeat: number | null = null;
  for (let s = 1; s <= seatsPerTable; s++) {
    if (!occupied.has(s)) {
      targetSeat = s;
      break;
    }
  }
  if (targetSeat === null) return null;
  return {
    playerId: movedPlayer.id,
    from: { tableNum: maxTable, seatNum: movedPlayer.seatNum },
    to: { tableNum: minTable, seatNum: targetSeat },
  };
}

/**
 * テーブル閉鎖判定: 残プレイヤー ≤ (生存卓数 - 1) × seatsPerTable のとき
 * 最少人数の生存卓を 1 つ閉じ、所属プレイヤーを残卓の最小空席から順に配置。
 *
 * 同数最少が複数なら tableNum 最大を閉じる（卓番号が小さい卓を保つ）。
 * 残卓の人数で同数の場合は tableNum 昇順で詰める（initial seating と同じ規則）。
 */
export function planTableBreak(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): TableBreakPlan | null {
  const active = seatedPlayers.filter((p) => !p.isBusted && p.tableNum !== null);
  const liveTableNums = Array.from(new Set(active.map((p) => p.tableNum as number)))
    .filter((n) => !brokenTableNums.includes(n))
    .sort((a, b) => a - b);
  if (liveTableNums.length <= 1) return null;
  if (active.length > (liveTableNums.length - 1) * seatsPerTable) return null;

  const counts = new Map<number, number>();
  for (const t of liveTableNums) counts.set(t, 0);
  for (const p of active) {
    counts.set(p.tableNum as number, (counts.get(p.tableNum as number) ?? 0) + 1);
  }
  const sorted = [...counts.entries()].sort((a, b) => {
    if (a[1] !== b[1]) return a[1] - b[1];
    return b[0] - a[0]; // tie-break: tableNum 最大を優先（保守的に若番号を残す）
  });
  const toBreak = sorted[0][0];

  const survivingTables = liveTableNums.filter((n) => n !== toBreak);
  const brokenPlayers = active
    .filter((p) => p.tableNum === toBreak)
    .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0));
  const occupiedBySurvivor = new Map<number, Set<number>>();
  for (const t of survivingTables) occupiedBySurvivor.set(t, new Set());
  for (const p of active) {
    if (p.tableNum !== toBreak && p.seatNum !== null) {
      occupiedBySurvivor.get(p.tableNum as number)?.add(p.seatNum);
    }
  }
  const moves: BalancingMove[] = [];
  for (const p of brokenPlayers) {
    const candidates = survivingTables
      .map((t) => ({ t, count: occupiedBySurvivor.get(t)?.size ?? 0 }))
      .filter((c) => c.count < seatsPerTable)
      .sort((a, b) => (a.count !== b.count ? a.count - b.count : a.t - b.t));
    if (candidates.length === 0) return null;
    const target = candidates[0];
    let seat = 1;
    while (occupiedBySurvivor.get(target.t)?.has(seat)) seat++;
    moves.push({
      playerId: p.id,
      from: { tableNum: toBreak, seatNum: p.seatNum as number },
      to: { tableNum: target.t, seatNum: seat },
    });
    occupiedBySurvivor.get(target.t)?.add(seat);
  }
  return { brokenTableNum: toBreak, moves };
}

function computeTableCounts(
  players: PlayerDoc[],
  brokenTableNums: number[],
): { maxTable: number | null; minTable: number | null; diff: number } {
  const count = new Map<number, number>();
  for (const p of players) {
    if (p.isBusted) continue;
    if (p.tableNum === null) continue;
    if (brokenTableNums.includes(p.tableNum)) continue;
    count.set(p.tableNum, (count.get(p.tableNum) ?? 0) + 1);
  }
  if (count.size < 2) return { maxTable: null, minTable: null, diff: 0 };
  const entries = [...count.entries()];
  // count 昇順、同数なら tableNum 昇順
  entries.sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const [minTable, minC] = entries[0];
  // 末尾は max（同数なら tableNum 昇順の末尾＝tableNum 最大）。
  const [maxTable, maxC] = entries[entries.length - 1];
  return { maxTable, minTable, diff: maxC - minC };
}
