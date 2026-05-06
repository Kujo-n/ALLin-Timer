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

/**
 * Phase 5.1: PD 数 > 卓数 で呼ばれたとき throw。
 * orchestrator.ts は instanceof で判別して `seating/pd-too-many` AppError へラップする。
 */
export class TooManyPlayingDealersError extends Error {
  constructor(
    public readonly requested: number,
    public readonly maxAllowed: number,
  ) {
    super(`PD count exceeds tables: ${requested} > ${maxAllowed}`);
    this.name = "TooManyPlayingDealersError";
  }
}

interface Seat {
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
 * Phase 5.x: TDA 準拠バランシングの「診断のみ」結果。
 *
 * engine が決めるのは「どの卓 → どの卓 / どの席へ動かすべきか」までで、
 * 「誰を動かすか」は運営者の判断（実際の dealer button 位置を見て BB 次プレイヤーを選ぶ）に
 * 委ねる。`candidatePlayerIds` は PD（プレイングディーラー）と busted を除外した
 * source 卓の player を seatNum 昇順で並べたヒント。
 */
interface BalancingDiagnosis {
  sourceTableNum: number;
  destTableNum: number;
  destSeatNum: number;
  /** 過剰卓と不足卓の人数差（>=2）。表示用。 */
  diff: number;
  /** PD / busted を除外した移動候補 player ID（seatNum 昇順）。 */
  candidatePlayerIds: string[];
}

/**
 * 初回席決め: 未バストのプレイヤーを seatsPerTable で均等割り。
 * seed を渡すとテストで再現可能。
 *
 * 卓数 = ceil(activePlayers / seatsPerTable)。MAX_TABLES 超過は throw。
 *
 * Phase 5.1:
 *   - PD（プレイングディーラー）指定 player は各卓に 1 名ずつ事前配分し、各卓の席 1 に固定。
 *   - PD 数 > 卓数 なら `TooManyPlayingDealersError` throw。
 *   - 非 PD player は seed-driven shuffle 後に最少人数 bucket 優先で round-robin 配分。
 *   - 各卓内で PD は席 1、その他は seat [2..seatsPerTable]（PD なし卓は [1..seatsPerTable]）から
 *     seed-driven にランダム抽選（連番化を回避し BB ポジション再現の余地を残す）。
 */
export function planInitialSeating(
  players: PlayerDoc[],
  seatsPerTable: number,
  seed: number,
  pdPlayerIds: readonly string[] = [],
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
  // active player のうち実在する PD のみ（busted や未参加 ID は filter で落とす）。
  const activeIds = new Set(active.map((p) => p.id));
  const effectivePdIds = pdPlayerIds.filter((id) => activeIds.has(id));
  if (effectivePdIds.length > numTables) {
    throw new TooManyPlayingDealersError(effectivePdIds.length, numTables);
  }

  const shuffled = shuffle(active, seed);
  const pdSet = new Set(effectivePdIds);
  const pdPlayers = shuffled.filter((p) => pdSet.has(p.id));
  const nonPdPlayers = shuffled.filter((p) => !pdSet.has(p.id));

  // PD を各 bucket（卓）の先頭に 1 名ずつ事前配分。
  const buckets: PlayerDoc[][] = Array.from({ length: numTables }, () => []);
  for (let i = 0; i < pdPlayers.length; i++) {
    buckets[i].push(pdPlayers[i]);
  }
  // 非 PD を最少人数 bucket 優先で round-robin。同サイズなら左 (= tableNum 小) から詰める。
  for (const p of nonPdPlayers) {
    let target = 0;
    let minSize = buckets[0].length;
    for (let i = 1; i < numTables; i++) {
      if (buckets[i].length < minSize) {
        minSize = buckets[i].length;
        target = i;
      }
    }
    buckets[target].push(p);
  }

  const assignments: SeatAssignment[] = [];
  for (let t = 0; t < numTables; t++) {
    const tableNum = t + 1;
    const tablePlayers = buckets[t];
    const pd = tablePlayers.find((p) => pdSet.has(p.id));
    const nonPd = pd ? tablePlayers.filter((p) => p.id !== pd.id) : tablePlayers;
    if (pd) {
      assignments.push({ playerId: pd.id, tableNum, seatNum: 1 });
    }
    const seatPool = pd
      ? Array.from({ length: seatsPerTable - 1 }, (_, i) => i + 2) // [2..N]
      : Array.from({ length: seatsPerTable }, (_, i) => i + 1); // [1..N]
    // 卓ごとに seed をずらして bucket 間の偏りを排除。
    const shuffledSeats = shuffle(seatPool, seed + (t + 1) * 1000);
    for (let s = 0; s < nonPd.length; s++) {
      assignments.push({
        playerId: nonPd[s].id,
        tableNum,
        seatNum: shuffledSeats[s],
      });
    }
  }
  const tableNums = Array.from({ length: numTables }, (_, i) => i + 1);
  return { assignments, tableNums };
}

/**
 * 進行中レイトエントリーの自動配席。
 *
 * Phase 5.1: 「最小空席 seatNum」を「空席集合の seed-driven shuffle 先頭」に変更。
 * 連番（1..N）化を避けて BB ポジション再現の余地を残す。
 *
 * 卓選択: 活動プレイヤー数が最小の卓（同数なら tableNum 昇順）。
 * 全卓満席なら null（呼出し側で「締切超過」エラー扱い）。
 *
 * 注意: broken でない既存卓のみが配席対象。tables 一覧ではなく seatedPlayers の
 * tableNum 集合を真実源とすることで、tables collection の遅延読込に依存しない。
 */
export function planLateEntrySeat(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
  seed: number = 0,
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
    const empty: number[] = [];
    for (let s = 1; s <= seatsPerTable; s++) {
      if (!occupied.has(`${t}-${s}`)) empty.push(s);
    }
    if (empty.length === 0) continue;
    // 空席が複数なら seed-driven にランダム選択。empty.length === 1 なら shuffle は no-op。
    const shuffled = shuffle(empty, seed + t * 1000);
    return { tableNum: t, seatNum: shuffled[0] };
  }
  return null;
}

/**
 * 差分 ≥ 2 の場合のバランシング診断。
 *
 * source/dest 卓・dest 席までを TDA 準拠で算出し、source 卓の移動候補 player を
 * PD / busted を除外した上で seatNum 昇順で返す（候補リスト）。
 * 「誰を動かすか」は運営者が dealer button 位置を見て BB 次プレイヤーを選ぶ。
 *
 * 差 1 以下なら null（操作不要）。候補が 0 人 / 不足卓に空席なし も null。
 */
export function diagnoseBalancingNeed(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): BalancingDiagnosis | null {
  const { maxTable, minTable, diff } = computeTableCounts(seatedPlayers, brokenTableNums);
  if (maxTable === null || minTable === null) return null;
  if (diff < 2) return null;

  const candidatePlayerIds = seatedPlayers
    .filter(
      (p) =>
        !p.isBusted &&
        p.tableNum === maxTable &&
        p.seatNum !== null &&
        !p.isPlayingDealer,
    )
    .sort((a, b) => (a.seatNum ?? 0) - (b.seatNum ?? 0))
    .map((p) => p.id);
  if (candidatePlayerIds.length === 0) return null;

  const occupied = new Set<number>();
  for (const p of seatedPlayers) {
    if (p.isBusted) continue;
    if (p.tableNum !== minTable) continue;
    if (p.seatNum === null) continue;
    occupied.add(p.seatNum);
  }
  let destSeatNum: number | null = null;
  for (let s = 1; s <= seatsPerTable; s++) {
    if (!occupied.has(s)) {
      destSeatNum = s;
      break;
    }
  }
  if (destSeatNum === null) return null;

  return {
    sourceTableNum: maxTable,
    destTableNum: minTable,
    destSeatNum,
    diff,
    candidatePlayerIds,
  };
}

/**
 * バランシング 1 件の auto-pick 版（互換 API）。
 *
 * `diagnoseBalancingNeed` の結果から **先頭候補（= 席番号最小、PD 除外済み）** を
 * 採用して `BalancingMove` を返す。Phase 5.x 以降の本流 UI は
 * `diagnoseBalancingNeed` + 運営者選択を使うが、テーブル閉鎖と同列の自動 path として
 * `applyBalancingOnce` 経由で残置している（characterization tests 互換）。
 */
export function planBalancingMove(
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): BalancingMove | null {
  const diag = diagnoseBalancingNeed(seatedPlayers, brokenTableNums, seatsPerTable);
  if (!diag) return null;
  const movedId = diag.candidatePlayerIds[0];
  const moved = seatedPlayers.find((p) => p.id === movedId);
  if (!moved || moved.seatNum === null) return null;
  return {
    playerId: movedId,
    from: { tableNum: diag.sourceTableNum, seatNum: moved.seatNum },
    to: { tableNum: diag.destTableNum, seatNum: diag.destSeatNum },
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

/**
 * Phase 5.x: 同卓 D&D で drop 先が占有席だった場合の cascade 計算。
 *
 * direction = sign(source - target) に沿って、target から source 方向に占有席を
 * 1 つずつ shift する。最初の空席（または source 到達）で停止。
 * cascade 中で PD player に当たった場合は cascade 不能として `null` を返す
 * （PD は手動移動禁止 + 席 1 固定の慣習を D&D 側で勝手に崩さない）。
 *
 * 例: 席 1,2,3,5,6 占有 / seat 4 空 / dragged=席 5 / target=席 2
 *  → direction=+1, walk: 席 2 → 席 3 → 席 4(empty で停止)
 *  → moves: [{2→3}, {3→4}, {dragged 5→2}]
 *  最終: 1, 2(dragged), 3(原 2), 4(原 3), 5(空), 6 のまま
 *
 * @param sameTablePlayers 同卓の player（dragged 自身を含む）。busted は filter で除外。
 * @returns 全 cascade move（順序は walk 順、最後に dragged の move）。null は不能ケース。
 */
export function planManualSeatCascade(
  sameTablePlayers: PlayerDoc[],
  draggedPlayerId: string,
  targetSeatNum: number,
): BalancingMove[] | null {
  const dragged = sameTablePlayers.find((p) => p.id === draggedPlayerId);
  if (
    !dragged ||
    dragged.isBusted ||
    dragged.tableNum === null ||
    dragged.seatNum === null
  ) {
    return null;
  }
  if (dragged.seatNum === targetSeatNum) return null;

  const tableNum = dragged.tableNum;
  const sourceSeat = dragged.seatNum;
  const direction: 1 | -1 = targetSeatNum < sourceSeat ? 1 : -1;

  // dragged を除外した同卓 active player を seat → {id, isPd} に index 化。
  // sourceSeat は dragged が占有していた席だが、dragged を除外したので map では「空」。
  // この性質を利用して loop の終端判定が「occupant 不在」のみで済む。
  const seatToOccupant = new Map<number, { id: string; isPd: boolean }>();
  for (const p of sameTablePlayers) {
    if (p.isBusted) continue;
    if (p.id === draggedPlayerId) continue;
    if (p.tableNum !== tableNum) continue;
    if (p.seatNum === null) continue;
    seatToOccupant.set(p.seatNum, { id: p.id, isPd: p.isPlayingDealer });
  }

  const moves: BalancingMove[] = [];
  let cursor = targetSeatNum;
  // Safety: bound iterations to prevent infinite loop on malformed input
  let safety = sameTablePlayers.length + 2;
  while (cursor !== sourceSeat && safety-- > 0) {
    const occ = seatToOccupant.get(cursor);
    if (!occ) break;
    if (occ.isPd) return null;
    moves.push({
      playerId: occ.id,
      from: { tableNum, seatNum: cursor },
      to: { tableNum, seatNum: cursor + direction },
    });
    cursor += direction;
  }
  moves.push({
    playerId: draggedPlayerId,
    from: { tableNum, seatNum: sourceSeat },
    to: { tableNum, seatNum: targetSeatNum },
  });
  return moves;
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
