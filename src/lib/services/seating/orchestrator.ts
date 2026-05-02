import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  bustPlayer as bustPlayerWrite,
  unbustPlayer as unbustPlayerWrite,
} from "@/lib/firebase/repositories/players";
import { playerBodySchema, type PlayerDoc } from "@/lib/firebase/schemas/player";
import { tableBodySchema, type TableDoc } from "@/lib/firebase/schemas/table";
import { tournamentBodySchema, type TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

import {
  InvalidSeatsPerTableError,
  TooManyPlayingDealersError,
  TooManyTablesError,
  planBalancingMove,
  planInitialSeating,
  planLateEntrySeat,
  planTableBreak,
  type BalancingMove,
} from "./engine";
import { planPlayingDealerShift } from "./pd";

/**
 * Phase 4: 席決め副作用層。engine の pure 関数を呼び出し Firestore に反映する。
 *  - 全 write は group メンバー権限の最終防衛を Firestore rules に委ねる
 *  - 競合は runTransaction + state guard / lastMovedAt guard で防ぐ
 *  - engine error は AppError("seating/...") にラップして投げ直す
 */

function tournamentRef(tid: string) {
  return doc(
    collection(firestore, "tournaments").withConverter(
      zodConverter(tournamentBodySchema, "tournaments"),
    ),
    tid,
  );
}

function playersRef(tid: string) {
  return collection(firestore, "tournaments", tid, "players").withConverter(
    zodConverter(playerBodySchema, `tournaments/${tid}/players`),
  );
}

function tablesRef(tid: string) {
  return collection(firestore, "tournaments", tid, "tables").withConverter(
    zodConverter(tableBodySchema, `tournaments/${tid}/tables`),
  );
}

/**
 * 初回席決め: 渡された未配席（または再配席対象）プレイヤーに対して
 *  1) tournament を transaction で setup or seating ガード（state 不一致なら no-op）
 *  2) engine.planInitialSeating で割当を計算
 *  3) tx 内で各 player doc の現在 isBusted を再確認し tableNum/seatNum を update
 *  4) 同一 tx 内で tables/{n} を tx.set で upsert（players update と原子的）
 *  5) tournament を state="seating" に遷移（既に seating なら維持）
 *
 * 呼び出し側 (`commitInitialSeating(tid, uid, groupIds, players, seed)`) から
 * subscribe 済みの最新 players snapshot を渡す。tx 内でも各 player doc を tx.get で
 * 再 read して bust 状態の race を吸収する。
 *
 * group メンバーチェックの最終防衛は Firestore rules で行う。client 側でも
 * tournament.groupId と userGroupIds の突合を tx 内で確認して早期失敗させる。
 */
export async function commitInitialSeating(
  tid: string,
  uid: string,
  userGroupIds: string[],
  players: PlayerDoc[],
  seed: number,
  seatsPerTable?: number,
): Promise<void> {
  try {
    const plannedTableCount = await runTransaction<number>(firestore, async (tx) => {
      const tRef = tournamentRef(tid);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) {
        throw new AppError("not found", "firestore/not-found");
      }
      const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
      if (!userGroupIds.includes(t.groupId)) {
        throw new AppError("not allowed", "firestore/permission-denied");
      }
      if (t.state !== "setup" && t.state !== "seating") {
        throw new AppError(
          "初回席決めは setup / seating 中のみ可能です",
          "tournament/invalid-state",
        );
      }
      const sp = seatsPerTable ?? t.seatsPerTable;
      // tx 内で各 player の現在状態を再 read（subscribe snapshot と乖離があるかもしれない）。
      const playerSnapshots = await Promise.all(
        players.map((p) => tx.get(doc(playersRef(tid), p.id))),
      );
      const liveActive: PlayerDoc[] = [];
      for (let i = 0; i < playerSnapshots.length; i++) {
        const s = playerSnapshots[i];
        if (!s.exists()) continue;
        const fresh: PlayerDoc = { id: s.id, ...s.data() };
        if (fresh.isBusted) continue;
        liveActive.push(fresh);
      }

      // Phase 5.1: PD（プレイングディーラー）指定 player を engine に伝達。
      // tx 内で再 read した liveActive から `isPlayingDealer=true && !isBusted` を抽出。
      const pdPlayerIds = liveActive
        .filter((p) => p.isPlayingDealer && !p.isBusted)
        .map((p) => p.id);

      const plan = planInitialSeating(liveActive, sp, seed, pdPlayerIds);

      const ts = serverTimestamp();
      for (const a of plan.assignments) {
        tx.update(doc(playersRef(tid), a.playerId), {
          tableNum: a.tableNum,
          seatNum: a.seatNum,
          lastMovedAt: ts,
        });
      }
      // M-3.1 fix: tables/{n} の upsert を同一 tx 内に統合。
      // 以前は tx 後の writeBatch 経由だったため、tx 成功後のネットワーク断等で
      // 「players は seat 済みだが tables doc が空」の中間状態が残り得た。
      // Firestore の tx は同一パスの set に対する create/update を両対応する。
      for (const n of plan.tableNums) {
        tx.set(doc(tablesRef(tid), String(n)), {
          tableNum: n,
          isBroken: false,
          createdAt: ts,
        });
      }
      tx.update(tRef, {
        state: "seating",
        updatedAt: ts,
      });
      return plan.tableNums.length;
    });

    logger.info("commit initial seating ok", {
      tid,
      uid,
      tables: plannedTableCount,
    });
  } catch (e) {
    if (e instanceof TooManyTablesError) {
      const wrapped = new AppError(
        `テーブル数の上限（${e.max} Tables）を超えました。seatsPerTable を増やして再度お試しください。`,
        "seating/too-many-tables",
        e,
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
    if (e instanceof InvalidSeatsPerTableError) {
      const wrapped = new AppError(
        `1 Table あたり席数の値が不正です: ${e.seatsPerTable}`,
        "seating/invalid-seats-per-table",
        e,
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
    if (e instanceof TooManyPlayingDealersError) {
      const wrapped = new AppError(
        `PD は ${e.maxAllowed} 名以下に絞ってください（現在 ${e.requested} 名）`,
        "seating/pd-too-many",
        e,
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
    const wrapped = AppError.from(e, "firestore/write_failed", "初回席決めに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

/**
 * late entry の自動配席。
 *
 * 競合制御:
 *  - 対象 player の lastMovedAt が `expectedLastMovedAtMs` と一致しなければ no-op (race)
 *  - tx 内で**対象卓の既存プレイヤーを再 read** して seat 占有を再確認 (H2 fix)
 *    → A 端末が直前に同じ seat を別プレイヤーへ割当てた race を検出して no-op
 *  - 完全防止できない race（同時に異なる新規プレイヤーが同卓に配席されるケース）は
 *    確率的に極小だが許容。発生時は運営者が SeatingBoard を見て手動是正可
 *
 * tournament が running/paused でなければ no-op。
 */
export async function autoSeatLateEntry(
  tid: string,
  uid: string,
  userGroupIds: string[],
  playerId: string,
  expectedLastMovedAtMs: number | null,
  seatedPlayers: PlayerDoc[],
  brokenTableNums: number[],
  seatsPerTable: number,
): Promise<{ applied: boolean; reason?: string }> {
  try {
    // Phase 5.1: 連番抑制のため seed-driven random seat 抽選。
    // Date.now() ^ playerId hash で実用十分な multi-tournament uniqueness を確保。
    const seed =
      Date.now() ^
      Array.from(playerId).reduce((acc, c) => (acc * 31 + c.charCodeAt(0)) >>> 0, 0);
    const seat = planLateEntrySeat(seatedPlayers, brokenTableNums, seatsPerTable, seed);
    if (!seat) {
      logger.info("late entry no available seat", { tid, playerId });
      return { applied: false, reason: "no-seat" };
    }

    let applied = false;
    let skipReason: string | null = null;

    // tx 内で再確認する対象卓のプレイヤー ID リスト（subscribe snapshot から導出）。
    const targetTableExistingIds = seatedPlayers
      .filter((p) => p.tableNum === seat.tableNum && p.id !== playerId)
      .map((p) => p.id);

    await runTransaction(firestore, async (tx) => {
      const tRef = tournamentRef(tid);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) {
        throw new AppError("not found", "firestore/not-found");
      }
      const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
      if (!userGroupIds.includes(t.groupId)) {
        throw new AppError("not allowed", "firestore/permission-denied");
      }
      // Phase 5.1: 座席確定後 (seating) のレイトエントリーも即時配席するため
      // tx 内 state guard を seating/running/paused に緩和。setup / finished のみ skip。
      if (
        t.state !== "seating" &&
        t.state !== "running" &&
        t.state !== "paused"
      ) {
        skipReason = "state";
        return;
      }
      const pRef = doc(playersRef(tid), playerId);
      const pSnap = await tx.get(pRef);
      if (!pSnap.exists()) {
        skipReason = "missing";
        return;
      }
      const p: PlayerDoc = { id: pSnap.id, ...pSnap.data() };
      if (p.isBusted) {
        skipReason = "busted";
        return;
      }
      if (p.tableNum !== null) {
        skipReason = "already-seated";
        return;
      }
      const actualMs = p.lastMovedAt ? p.lastMovedAt.toMillis() : null;
      if (actualMs !== expectedLastMovedAtMs) {
        skipReason = "race";
        return;
      }

      // H2: 対象卓の既存プレイヤーを tx 内で再 read して seat 占有を再確認。
      // 直前に他端末が同じ seat へ別プレイヤーを割当てた race を検出する。
      const freshTargetTable = await Promise.all(
        targetTableExistingIds.map((id) => tx.get(doc(playersRef(tid), id))),
      );
      for (const snap of freshTargetTable) {
        if (!snap.exists()) continue;
        const fresh: PlayerDoc = { id: snap.id, ...snap.data() };
        if (fresh.isBusted) continue;
        if (fresh.tableNum === seat.tableNum && fresh.seatNum === seat.seatNum) {
          skipReason = "seat-taken";
          return;
        }
      }

      tx.update(pRef, {
        tableNum: seat.tableNum,
        seatNum: seat.seatNum,
        lastMovedAt: serverTimestamp(),
      });
      applied = true;
    });

    if (!applied) {
      logger.info("auto seat late entry skipped", { tid, playerId, reason: skipReason });
      return { applied: false, reason: skipReason ?? "unknown" };
    }
    logger.info("auto seat late entry ok", {
      tid,
      uid,
      playerId,
      tableNum: seat.tableNum,
      seatNum: seat.seatNum,
    });
    return { applied: true };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "レイトエントリー自動配席に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, playerId });
    throw wrapped;
  }
}

interface ApplyBalancingResult {
  applied: boolean;
  description: string | null;
  break?: boolean;
}

/**
 * バランシング 1 件を適用する（tableBreak が成立すれば優先、なければ planBalancingMove）。
 * - tableBreak: 全 move + tables/{n}.isBroken=true を **同一 transaction** 内で適用 (H1 fix)
 * - balancing: 1 件の move のみ、tx 内で対象プレイヤーの lastMovedAt と
 *   席番号一致を guard。ズレていれば no-op（race）。
 */
export async function applyBalancingOnce(
  tid: string,
  uid: string,
  userGroupIds: string[],
  players: PlayerDoc[],
  tables: TableDoc[],
  seatsPerTable: number,
): Promise<ApplyBalancingResult> {
  const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);

  const breakPlan = planTableBreak(players, brokenTableNums, seatsPerTable);
  if (breakPlan) {
    return await applyTableBreak(tid, uid, userGroupIds, breakPlan, players);
  }

  const move = planBalancingMove(players, brokenTableNums, seatsPerTable);
  if (!move) {
    return { applied: false, description: null };
  }
  return await applySingleMove(tid, uid, userGroupIds, move, players);
}

async function applySingleMove(
  tid: string,
  uid: string,
  userGroupIds: string[],
  move: BalancingMove,
  players: PlayerDoc[],
): Promise<ApplyBalancingResult> {
  const expected = players.find((p) => p.id === move.playerId);
  const expectedLastMovedAtMs = expected?.lastMovedAt
    ? expected.lastMovedAt.toMillis()
    : null;

  // 移動先卓の既存プレイヤー ID（H2 と同じ seat 占有再検証）。
  const targetTableExistingIds = players
    .filter((p) => p.tableNum === move.to.tableNum && p.id !== move.playerId)
    .map((p) => p.id);

  try {
    let applied = false;
    let skipReason: string | null = null;

    await runTransaction(firestore, async (tx) => {
      const tRef = tournamentRef(tid);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) {
        throw new AppError("not found", "firestore/not-found");
      }
      const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
      if (!userGroupIds.includes(t.groupId)) {
        throw new AppError("not allowed", "firestore/permission-denied");
      }

      const pRef = doc(playersRef(tid), move.playerId);
      const pSnap = await tx.get(pRef);
      if (!pSnap.exists()) {
        skipReason = "missing";
        return;
      }
      const p: PlayerDoc = { id: pSnap.id, ...pSnap.data() };
      if (p.isBusted) {
        skipReason = "busted";
        return;
      }
      if (p.tableNum !== move.from.tableNum || p.seatNum !== move.from.seatNum) {
        skipReason = "moved";
        return;
      }
      const actualMs = p.lastMovedAt ? p.lastMovedAt.toMillis() : null;
      if (actualMs !== expectedLastMovedAtMs) {
        skipReason = "race";
        return;
      }

      // 移動先 seat の現在占有を tx 内で確認。
      const freshTarget = await Promise.all(
        targetTableExistingIds.map((id) => tx.get(doc(playersRef(tid), id))),
      );
      for (const snap of freshTarget) {
        if (!snap.exists()) continue;
        const fresh: PlayerDoc = { id: snap.id, ...snap.data() };
        if (fresh.isBusted) continue;
        if (fresh.tableNum === move.to.tableNum && fresh.seatNum === move.to.seatNum) {
          skipReason = "seat-taken";
          return;
        }
      }

      tx.update(pRef, {
        tableNum: move.to.tableNum,
        seatNum: move.to.seatNum,
        lastMovedAt: serverTimestamp(),
      });
      applied = true;
    });

    if (!applied) {
      logger.info("balancing move skipped", { tid, playerId: move.playerId, reason: skipReason });
      return { applied: false, description: null };
    }
    const desc = `Table ${move.from.tableNum} / 席 ${move.from.seatNum} → Table ${move.to.tableNum} / 席 ${move.to.seatNum}`;
    logger.info("balancing move ok", { tid, uid, playerId: move.playerId, desc });
    return { applied: true, description: desc };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "バランシング適用に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

async function applyTableBreak(
  tid: string,
  uid: string,
  userGroupIds: string[],
  plan: { brokenTableNum: number; moves: BalancingMove[] },
  players: PlayerDoc[],
): Promise<ApplyBalancingResult> {
  // L2 fix: 移動先卓 (survivors) の既存プレイヤー ID を事前に集めておき、
  // tx 内で再 read して seat-taken race（applySingleMove と同パターン）を検出する。
  // 閉鎖卓のプレイヤー自身は除外。
  const survivorTableNums = new Set(plan.moves.map((m) => m.to.tableNum));
  const movingPlayerIds = new Set(plan.moves.map((m) => m.playerId));
  const survivorExistingIds = players
    .filter(
      (p) =>
        p.tableNum !== null &&
        survivorTableNums.has(p.tableNum) &&
        !movingPlayerIds.has(p.id),
    )
    .map((p) => p.id);

  try {
    let applied = false;
    let skipReason: string | null = null;

    await runTransaction(firestore, async (tx) => {
      const tRef = tournamentRef(tid);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) {
        throw new AppError("not found", "firestore/not-found");
      }
      const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
      if (!userGroupIds.includes(t.groupId)) {
        throw new AppError("not allowed", "firestore/permission-denied");
      }

      // 全 move 対象 player を tx.get で再確認し race を弾く。
      const freshPlayers = await Promise.all(
        plan.moves.map(async (m) => {
          const snap = await tx.get(doc(playersRef(tid), m.playerId));
          return { move: m, snap };
        }),
      );
      for (const { move, snap } of freshPlayers) {
        if (!snap.exists()) {
          skipReason = `missing:${move.playerId}`;
          return;
        }
        const fresh: PlayerDoc = { id: snap.id, ...snap.data() };
        if (fresh.isBusted) {
          skipReason = `busted:${move.playerId}`;
          return;
        }
        if (fresh.tableNum !== move.from.tableNum || fresh.seatNum !== move.from.seatNum) {
          skipReason = `moved:${move.playerId}`;
          return;
        }
        const expected = players.find((p) => p.id === move.playerId);
        const expectedMs = expected?.lastMovedAt ? expected.lastMovedAt.toMillis() : null;
        const actualMs = fresh.lastMovedAt ? fresh.lastMovedAt.toMillis() : null;
        if (actualMs !== expectedMs) {
          skipReason = `race:${move.playerId}`;
          return;
        }
      }

      // L2 fix: 移動先卓の既存席占有を tx 内で再構築し、各 move の destination が
      // 空席であることを確認する。他端末の late entry / balancing が survivors の
      // 空席を取った race を検出して no-op。
      const freshSurvivors = await Promise.all(
        survivorExistingIds.map((id) => tx.get(doc(playersRef(tid), id))),
      );
      const occupiedByTable = new Map<number, Set<number>>();
      for (const snap of freshSurvivors) {
        if (!snap.exists()) continue;
        const fresh: PlayerDoc = { id: snap.id, ...snap.data() };
        if (fresh.isBusted) continue;
        if (fresh.tableNum === null || fresh.seatNum === null) continue;
        if (!occupiedByTable.has(fresh.tableNum)) {
          occupiedByTable.set(fresh.tableNum, new Set());
        }
        occupiedByTable.get(fresh.tableNum)!.add(fresh.seatNum);
      }
      for (const m of plan.moves) {
        const occupied = occupiedByTable.get(m.to.tableNum);
        if (occupied?.has(m.to.seatNum)) {
          skipReason = `seat-taken:${m.to.tableNum}-${m.to.seatNum}`;
          return;
        }
      }

      const ts = serverTimestamp();
      for (const m of plan.moves) {
        // Phase 5.1: 閉鎖卓 player は移動先で PD 衝突を起こさないよう isPlayingDealer=false に倒す。
        // 移動先で別の PD が立っていた場合も、移動してきた元 PD は false で上書きされ unique 維持。
        tx.update(doc(playersRef(tid), m.playerId), {
          tableNum: m.to.tableNum,
          seatNum: m.to.seatNum,
          lastMovedAt: ts,
          isPlayingDealer: false,
        });
      }
      // H1 fix: 同一 tx 内で tables/{brokenTableNum}.isBroken=true も書く。
      tx.update(doc(tablesRef(tid), String(plan.brokenTableNum)), {
        isBroken: true,
      });
      applied = true;
    });

    if (!applied) {
      logger.info("table break skipped", { tid, brokenTableNum: plan.brokenTableNum, reason: skipReason });
      return { applied: false, description: null };
    }
    const desc = `Table ${plan.brokenTableNum} を閉鎖（${plan.moves.length} 名移動）`;
    logger.info("table break ok", { tid, uid, brokenTableNum: plan.brokenTableNum });
    return { applied: true, description: desc, break: true };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "テーブル閉鎖に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

/**
 * Phase 5.1: PD（プレイングディーラー）フラグを ON/OFF する。
 *
 * - value=false: フラグだけ降ろし、席は変えない（OFF 操作）
 * - value=true: 同 table の他 PD 不在を tx 内で再確認（race guard）し、当該 player を
 *   席 1 へ rotation する。元 1..元PD席-1 の player は 1 つずつ後ろへ shift。
 *   元 PD 席より後ろの player は影響なし。
 *
 * 制約:
 *   - 当該 player が busted → `seating/pd-busted` AppError
 *   - tableNum=null（未配席）→ `seating/pd-no-seat` AppError
 *   - 同 table に既 PD あり → `seating/pd-already-set` AppError
 *
 * `tablePlayerIds` は呼出側で同 table の player ID（自身を除く）をあらかじめ抽出して渡す。
 * tx 内で全 tournament players を tx.get するのを避けるため。
 *
 * ⚠ 残存 race window: 呼出側 snapshot 取得後・本 tx の tx.get 開始前に同卓へ別 player が
 *   新規追加されると、新 player の `isPlayingDealer` を確認できない（`tablePlayerIds` に
 *   含まれないため）。そのまま PD ON が通り「同卓 PD 2 名」を一時的に成立させる可能性が
 *   ある。完全防止には `players` を tournament 全件 tx.get（read 量大）または where 句が
 *   tx 内で使えない Firestore の制約を Cloud Functions で補完する必要がある。
 *   現状（20 人 / 月 1〜2 回スケール / PD ON は organizer 操作 / 同卓追加と PD ON が
 *   同時刻にぶつかる頻度は実質ゼロ）では許容し、運用で吸収する。発生時は `applyBalancingOnce`
 *   の planBalancingMove は PD 除外で動くため致命的ではないが、`commitInitialSeating` 再実行
 *   時に `TooManyPlayingDealersError` を経由して気付ける設計。
 */
export async function setIsPlayingDealer(
  tid: string,
  uid: string,
  userGroupIds: string[],
  pid: string,
  value: boolean,
  tablePlayerIds: string[],
): Promise<void> {
  try {
    await runTransaction(firestore, async (tx) => {
      const tRef = tournamentRef(tid);
      const tSnap = await tx.get(tRef);
      if (!tSnap.exists()) {
        throw new AppError("not found", "firestore/not-found");
      }
      const t: TournamentDoc = { id: tSnap.id, ...tSnap.data() };
      if (!userGroupIds.includes(t.groupId)) {
        throw new AppError("not allowed", "firestore/permission-denied");
      }

      const pRef = doc(playersRef(tid), pid);
      const pSnap = await tx.get(pRef);
      if (!pSnap.exists()) {
        throw new AppError("not found", "firestore/not-found");
      }
      const p: PlayerDoc = { id: pSnap.id, ...pSnap.data() };
      if (p.isBusted) {
        throw new AppError(
          "バスト済みプレイヤーは PD 指定できません",
          "seating/pd-busted",
        );
      }

      if (value === false) {
        // OFF: フラグだけ降ろす。席は変えない。setup 中（tableNum=null）でも OK。
        tx.update(pRef, { isPlayingDealer: false });
        return;
      }

      // ON: setup 中なら tableNum=null で同卓検証は不要（フラグだけ立てる）。
      if (p.tableNum === null) {
        tx.update(pRef, { isPlayingDealer: true });
        return;
      }

      // ON（席決め後）: 同 table の他 PD がいないか tx 内で再確認。
      const tableSnaps = await Promise.all(
        tablePlayerIds.map((id) => tx.get(doc(playersRef(tid), id))),
      );
      const tablePlayers: PlayerDoc[] = [p];
      for (const snap of tableSnaps) {
        if (!snap.exists()) continue;
        const fresh: PlayerDoc = { id: snap.id, ...snap.data() };
        // 別卓に動いていたら無視（fixture 不一致の防御）。
        if (fresh.tableNum !== p.tableNum) continue;
        tablePlayers.push(fresh);
      }
      const otherPd = tablePlayers.find(
        (q) => q.id !== pid && q.isPlayingDealer && !q.isBusted,
      );
      if (otherPd) {
        throw new AppError(
          `Table ${p.tableNum} には既に PD がいます`,
          "seating/pd-already-set",
        );
      }

      // rotation: 元 1..元PD席-1 を 1 つずつ後ろへ + PD を席 1 へ。
      const moves = planPlayingDealerShift(
        tablePlayers.filter((q) => !q.isBusted),
        pid,
        t.seatsPerTable,
      );
      const ts = serverTimestamp();
      // PD 自身の rotation move（席 1 へ）は moves に含まれているため、
      // フラグ ON は move の update に統合する。pid 以外の rotation を先に書き、
      // pid は最後に rotation + isPlayingDealer の単一 update で書く。
      let pdMoveApplied = false;
      for (const m of moves) {
        if (m.playerId === pid) {
          tx.update(pRef, {
            tableNum: m.to.tableNum,
            seatNum: m.to.seatNum,
            lastMovedAt: ts,
            isPlayingDealer: true,
          });
          pdMoveApplied = true;
        } else {
          tx.update(doc(playersRef(tid), m.playerId), {
            tableNum: m.to.tableNum,
            seatNum: m.to.seatNum,
            lastMovedAt: ts,
          });
        }
      }
      if (!pdMoveApplied) {
        // 既に席 1 に居る場合は rotation 不要、フラグだけ立てる。
        tx.update(pRef, { isPlayingDealer: true });
      }
    });
    logger.info("set pd ok", { tid, uid, pid, value });
  } catch (e) {
    if (e instanceof AppError) {
      logger.warn(e.message, { code: e.code, tid, pid });
      throw e;
    }
    const wrapped = AppError.from(e, "firestore/write_failed", "PD 設定に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
    throw wrapped;
  }
}

/**
 * 運営者の bust ボタン → players.bustPlayer の薄いラッパ。permission の最終防衛は rules。
 * orchestrator 側で一括実行することで「バスト → 自動バランシング呼出し」の責務分離が
 * 容易になる（component 側は orchestrator API のみ使えば良い）。
 *
 * Phase 5.1: 同卓 player の `isPlayingDealer=false` も同時に書く（writeBatch 経由）。
 * 呼出側は同 table の他 player ID 配列を渡す（subscribe snapshot 経由）。
 */
export async function bustPlayer(
  tid: string,
  pid: string,
  sameTablePlayerIds: string[] = [],
): Promise<void> {
  await bustPlayerWrite(tid, pid, sameTablePlayerIds);
}

export async function unbustPlayer(tid: string, pid: string): Promise<void> {
  await unbustPlayerWrite(tid, pid);
}
