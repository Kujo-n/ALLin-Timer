// Phase 5.1: PD（プレイングディーラー）周りの純関数。
// orchestrator.ts の setIsPlayingDealer から使う rotation 計算。
// Firestore への副作用は持たず、入力 → BalancingMove[] のみを返す。
//
// 初回席決めの PD 配分は engine.planInitialSeating が内製しているためここには持たない。

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import type { BalancingMove } from "./engine";

/**
 * PD ON 時の rotation: 該当 player を席 1 へ、元 1..元PD席-1 を 1 つずつ後ろの席へ shift。
 * 元 PD 席より後ろ（seatNum > 元PD席）の player は影響なし。
 *
 * 入力契約:
 *   - tablePlayers は同一 table（busted 除く）の active player のみ
 *   - pdPlayerId が tablePlayers に含まれない / seat=null なら `[]` を返す
 *   - 既に席 1 に居る場合（no-op）も `[]`
 *   - 重複 seatNum は呼出側で起き得ない（zod 制約）が、本関数は seatNum 昇順で扱う
 */
export function planPlayingDealerShift(
  tablePlayers: PlayerDoc[],
  pdPlayerId: string,
  // seatsPerTable は将来的な席数 mismatch 検出用。現時点では未使用だが
  // 呼出側 API 安定性のため受ける（lint disable で残す）。
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  seatsPerTable: number,
): BalancingMove[] {
  const pd = tablePlayers.find((p) => p.id === pdPlayerId);
  if (!pd) return [];
  if (pd.seatNum === null || pd.tableNum === null) return [];
  if (pd.seatNum === 1) return [];

  const tableNum = pd.tableNum;
  const originalPdSeat = pd.seatNum;

  // 元 PD 席より前（seatNum < originalPdSeat）の player を 1 つずつ後ろへ shift。
  // PD 自身は席 1 へ。元 PD 席より後ろ（seatNum > originalPdSeat）は不変。
  const moves: BalancingMove[] = [];
  for (const q of tablePlayers) {
    if (q.id === pdPlayerId) continue;
    if (q.tableNum !== tableNum) continue;
    if (q.seatNum === null) continue;
    if (q.seatNum >= originalPdSeat) continue;
    moves.push({
      playerId: q.id,
      from: { tableNum, seatNum: q.seatNum },
      to: { tableNum, seatNum: q.seatNum + 1 },
    });
  }
  // PD 自身を席 1 へ
  moves.push({
    playerId: pdPlayerId,
    from: { tableNum, seatNum: originalPdSeat },
    to: { tableNum, seatNum: 1 },
  });
  return moves;
}
