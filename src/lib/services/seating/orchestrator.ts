import {
  collection,
  doc,
  runTransaction,
  serverTimestamp,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { groupDocRef } from "@/lib/firebase/repositories/groups";
import {
  bustPlayer as bustPlayerWrite,
  unbustPlayer as unbustPlayerWrite,
} from "@/lib/firebase/repositories/players";
import { playerBodySchema, type PlayerDoc } from "@/lib/firebase/schemas/player";
import { tableBodySchema, type TableDoc } from "@/lib/firebase/schemas/table";
import { tournamentBodySchema } from "@/lib/firebase/schemas/tournament";
import { loadTournamentInTx, playerFromSnap } from "@/lib/firebase/tx-helpers";
import { wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { MAX_SEATS_PER_TABLE } from "@/lib/limits";
import { logger } from "@/lib/logger";

import {
  InvalidSeatsPerTableError,
  TooManyPlayingDealersError,
  TooManyTablesError,
  diagnoseBalancingNeed,
  formatTableCloseOverflow,
  liveTableNums,
  planBalancingMove,
  planInitialSeating,
  planLateEntrySeat,
  planManualSeatCascade,
  planManualTableClose,
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
      const t = await loadTournamentInTx(tx, tid, userGroupIds);
      const tRef = tournamentRef(tid);
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
      for (const s of playerSnapshots) {
        const fresh = playerFromSnap(s);
        if (!fresh) continue;
        if (fresh.isBusted) continue;
        liveActive.push(fresh);
      }

      // Phase 5.1: PD（プレイングディーラー）指定 player を engine に伝達。
      // tx 内で再 read した liveActive から `isPlayingDealer=true && !isBusted` を抽出。
      const pdPlayerIds = liveActive
        .filter((p) => p.isPlayingDealer && !p.isBusted)
        .map((p) => p.id);

      const plan = planInitialSeating(liveActive, sp, seed, pdPlayerIds);

      // Phase C: 卓 label 自動コピーと既存 doc 検出のため tx 内 read を完了させる。
      // Firestore tx は全 read を全 write より先に行う必要があるため、player 更新 / 卓 set より前に置く。
      //   - groupSnap: defaultTableLabels / defaultTableColors (運営者がサークル詳細で登録した
      //     Table 名・色のデフォルト一覧。Phase 02-02 で colors も auto-fill 対象に拡張)
      //   - existingTableSnaps: 既存 tables/{n} doc。再 commitInitialSeating 時に dashboard で
      //     手動 edit した label / color を上書きしないため、既存値が non-null なら維持する。
      const groupSnap = await tx.get(groupDocRef(t.groupId));
      const defaultLabels: readonly string[] = groupSnap.exists()
        ? groupSnap.data().defaultTableLabels ?? []
        : [];
      const defaultColors: readonly (string | null)[] = groupSnap.exists()
        ? groupSnap.data().defaultTableColors ?? []
        : [];
      const existingTableSnaps = await Promise.all(
        plan.tableNums.map((n) => tx.get(doc(tablesRef(tid), String(n)))),
      );

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
      //
      // Phase C / 02-02: 既存 doc が「ある / ない」で書込経路を分ける。
      //   - 既存なし: tx.set で create（rule allow create + 全フィールド初期化）。
      //     label / color ともに defaultLabels / defaultColors の i 番目を反映。
      //   - 既存あり + 既設定 (label / color とも non-null): 何もしない（手動 edit 維持）
      //   - 既存あり + label / color の片方以上が未設定 + defaultLabel または defaultColor が
      //     non-null で補完可能: tx.update で patch（手動 edit 済みフィールドは維持）
      // 既存 doc を丸ごと tx.set すると `affectedKeys` が createdAt 等を含み update rule で reject される。
      for (let i = 0; i < plan.tableNums.length; i += 1) {
        const n = plan.tableNums[i];
        const ref = doc(tablesRef(tid), String(n));
        const existing = existingTableSnaps[i];
        const defaultLabel = defaultLabels[i] ?? null;
        const defaultColor = defaultColors[i] ?? null;
        if (!existing.exists()) {
          tx.set(ref, {
            tableNum: n,
            isBroken: false,
            createdAt: ts,
            label: defaultLabel,
            color: defaultColor,
          });
          continue;
        }
        const existingLabel = existing.data().label ?? null;
        const existingColor = existing.data().color ?? null;
        const labelToWrite =
          existingLabel === null && defaultLabel !== null ? defaultLabel : existingLabel;
        const colorToWrite =
          existingColor === null && defaultColor !== null ? defaultColor : existingColor;
        // どちらかが新たに補完される場合のみ update を発火。両方変化なしなら no-op。
        if (labelToWrite !== existingLabel || colorToWrite !== existingColor) {
          tx.update(ref, {
            label: labelToWrite,
            color: colorToWrite,
          });
        }
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

  await wrapFirestoreWrite(
    "firestore/write_failed",
    "レイトエントリー自動配席に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const t = await loadTournamentInTx(tx, tid, userGroupIds);
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
        const p = playerFromSnap(pSnap);
        if (!p) {
          skipReason = "missing";
          return;
        }
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
          const fresh = playerFromSnap(snap);
          if (!fresh) continue;
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
    },
    { tid, playerId },
  );

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
}

interface ApplyBalancingResult {
  applied: boolean;
  description: string | null;
  break?: boolean;
  /**
   * Phase 5.x: 実際に commit された move のリスト。手動 D&D / cascade で適用された
   * 全 move を呼出側に返すことで、dashboard 側で undo（reverseMoves）に利用できる。
   * applied=false のときは undefined / 空配列。
   */
  moves?: BalancingMove[];
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

/**
 * Phase 3 (07): 運営者が指定卓を手動で閉じる。
 *
 * engine.planManualTableClose で「指定卓を閉じ、残卓へ定員 ≤MAX_SEATS_PER_TABLE で再配置」する
 * plan を算出し、成立すれば既存 private applyTableBreak（moves + isBroken=true を同一 tx で commit、
 * 移動 player の PD reset、seat-taken race guard）を**そのまま再利用**する。
 *
 * 収容不能（overflow）/ 最後の 1 卓（only-one-table）は AppError を throw して UI に警告させる
 * （tx を発行しない = rule deny でトーナメントを止めない）。not-found は applied=false で静かに返す。
 *
 * シグネチャは `seatsPerTable` を取らない: plan は MAX_SEATS_PER_TABLE を内部固定で使うため
 * （rule の seatNum<=10 と drift させない）。
 */
export async function applyManualTableClose(
  tid: string,
  uid: string,
  userGroupIds: string[],
  targetTableNum: number,
  players: PlayerDoc[],
  tables: TableDoc[],
): Promise<ApplyBalancingResult> {
  // 生存卓（実在・未閉鎖）を tables から導出して engine に渡す。空卓（active 0 だが未閉鎖）も
  // 再配置先候補に含めることで、空卓があるのに収まらないと誤る偽 overflow を防ぐ。
  // preview(dialog) と同一の liveTableNums selector を経由し drift を防ぐ。
  const result = planManualTableClose(
    players,
    liveTableNums(tables),
    targetTableNum,
    MAX_SEATS_PER_TABLE,
  );
  if (!result.ok) {
    if (result.reason === "overflow") {
      const wrapped = new AppError(
        formatTableCloseOverflow(result.capacity ?? 0, result.needed ?? 0),
        "seating/table-close-overflow",
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid, targetTableNum });
      throw wrapped;
    }
    if (result.reason === "only-one-table") {
      const wrapped = new AppError(
        "最後の 1 卓は閉鎖できません",
        "seating/table-close-last",
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid, targetTableNum });
      throw wrapped;
    }
    // not-found（既閉鎖 / 不正値）: 静かに no-op。次の subscribe で UI 整合。
    logger.info("manual table close skipped (not found)", { tid, targetTableNum });
    return { applied: false, description: null };
  }
  return await applyTableBreak(tid, uid, userGroupIds, result.plan, players);
}

/**
 * Phase 5.x: TDA 準拠の運営者選択バランシング適用。
 *
 * `diagnoseBalancingNeed` で source/dest 卓を算出し、運営者が選んだ `playerId` を
 * source 卓 → dest 席へ移動する。engine の auto-pick（最小席番号）に依存せず、
 * 実 dealer button 位置を見た運営者の判断で「BB 次プレイヤー」を選択できる。
 *
 * 早期 reject:
 *  - balancing 不要（diff < 2 / candidates 0 / dest 満席）→ applied=false
 *  - playerId が candidates に含まれない（PD or 別卓 or busted）→ applied=false
 *  - PD player を運営者が誤選択 → `seating/manual-pd-not-movable` AppError
 *
 * tx 内 race guard は applySingleMove と同じ（lastMovedAt + 移動先 seat 占有再確認）。
 */
export async function applyManualBalancingMove(
  tid: string,
  uid: string,
  userGroupIds: string[],
  playerId: string,
  players: PlayerDoc[],
  tables: TableDoc[],
  seatsPerTable: number,
): Promise<ApplyBalancingResult> {
  const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
  const diag = diagnoseBalancingNeed(players, brokenTableNums, seatsPerTable);
  if (!diag) {
    logger.info("manual balancing skipped (no diag)", { tid, playerId });
    return { applied: false, description: null };
  }
  const player = players.find((p) => p.id === playerId);
  // PD は候補リストから engine 側で除外済みだが、サーバ側でも明示的なエラーで弾く
  // （UI bug 等で候補外 PD が手動指定されたケースの最終防衛 + 運営者向け UX）。
  if (player?.isPlayingDealer) {
    throw new AppError(
      "PD（プレイングディーラー）はバランシングで移動できません",
      "seating/manual-pd-not-movable",
    );
  }
  // 候補ガードは engine 側 diag.candidatePlayerIds に集約する。busted / 別卓 / 席なし /
  // PD 除外といった個別判定は diagnoseBalancingNeed の filter 内に同居しており、
  // engine の filter が将来拡張された場合も orchestrator は自動追従する（drift 防止）。
  if (!diag.candidatePlayerIds.includes(playerId)) {
    logger.info("manual balancing skipped (not a candidate)", {
      tid,
      playerId,
      sourceTable: diag.sourceTableNum,
      candidates: diag.candidatePlayerIds.length,
    });
    return { applied: false, description: null };
  }
  // candidatePlayerIds に含まれている時点で player は存在し tableNum/seatNum は non-null
  // （engine filter が保証）。型ナローイングのため defensive guard を残す。
  if (!player || player.tableNum === null || player.seatNum === null) {
    logger.info("manual balancing skipped (player invalid)", { tid, playerId });
    return { applied: false, description: null };
  }
  const move: BalancingMove = {
    playerId,
    from: { tableNum: player.tableNum, seatNum: player.seatNum },
    to: { tableNum: diag.destTableNum, seatNum: diag.destSeatNum },
  };
  return await applySingleMove(tid, uid, userGroupIds, move, players);
}

/**
 * Phase 5.x: 運営者による D&D / クリック起点の手動席移動。
 *
 * バランシング由来でない自由移動のための薄いラッパ。`applySingleMove(..., verifyBalancingDiff=false)`
 * を呼び、source/dest 卓の active 人数差検証は **意図的に skip する**（運営者が「想定外
 * ユースケースの是正」目的で動かすため、diff が小さくても許容したい）。
 *
 * 同卓内で drop 先が占有席だった場合は engine.planManualSeatCascade で cascade 計算し、
 * target → source 方向に既存 player を 1 つずつ shift して受け入れる。
 * 卓間移動の drop 先は空席のみ受け付ける（cascade は同卓のみ）。
 *
 * 早期 reject:
 *  - player 不在 / busted / 席なし → applied=false
 *  - PD player（dragged）→ `seating/manual-pd-not-movable` AppError
 *  - from === to（自席 drop）→ applied=false
 *  - 同卓 cascade に PD が混入 → applied=false（engine が null）
 *  - 卓間で drop 先が占有 → applied=false（cascade across tables 非対応）
 *
 * 注意（race guard 階層）:
 *   - 卓間移動の `destOccupiedInSnapshot` 早期 reject は **UX 用の早期 return**（snapshot で
 *     既に占有なら無駄な tx を発火させない）。snapshot 取得後・tx commit 前に他端末が
 *     当該 seat を取った最終 race は `applySingleMove` の `seat-taken` 検査が tx 内で塞ぐ。
 *     Firestore Rules 側では cross-table 占有検査を再現していない（rule で複数 doc 同期検査は
 *     表現困難なため）。最終防衛は `seat-taken` race guard。
 */
export async function applyManualSeatChange(
  tid: string,
  uid: string,
  userGroupIds: string[],
  playerId: string,
  to: { tableNum: number; seatNum: number },
  players: PlayerDoc[],
): Promise<ApplyBalancingResult> {
  const player = players.find((p) => p.id === playerId);
  if (
    !player ||
    player.isBusted ||
    player.tableNum === null ||
    player.seatNum === null
  ) {
    logger.info("manual seat change skipped (player invalid)", { tid, playerId });
    return { applied: false, description: null };
  }
  if (player.isPlayingDealer) {
    throw new AppError(
      "PD（プレイングディーラー）は手動移動できません",
      "seating/manual-pd-not-movable",
    );
  }
  if (player.tableNum === to.tableNum && player.seatNum === to.seatNum) {
    return { applied: false, description: null };
  }

  // 同卓内: cascade 計算（drop 先が空席なら 1 件 move、占有なら shift 連鎖）
  if (player.tableNum === to.tableNum) {
    const sameTablePlayers = players.filter(
      (p) => p.tableNum === to.tableNum && !p.isBusted,
    );
    const moves = planManualSeatCascade(sameTablePlayers, playerId, to.seatNum);
    if (!moves || moves.length === 0) {
      logger.info("manual seat change skipped (cascade not possible)", {
        tid,
        playerId,
      });
      return { applied: false, description: null };
    }
    if (moves.length === 1) {
      // 単純 1 件 move（drop 先が空席）。既存 applySingleMove で十分。
      return await applySingleMove(
        tid,
        uid,
        userGroupIds,
        moves[0],
        players,
        false,
      );
    }
    return await applyCascadeMoves(tid, uid, userGroupIds, moves, players);
  }

  // 卓間移動: drop 先は空席のみ。snapshot 時点で占有なら早期 reject。
  // tx 内 race（snapshot 空 → tx 占有）は applySingleMove の seat-taken 検証で塞ぐ。
  const destOccupiedInSnapshot = players.some(
    (p) =>
      !p.isBusted &&
      p.id !== playerId &&
      p.tableNum === to.tableNum &&
      p.seatNum === to.seatNum,
  );
  if (destOccupiedInSnapshot) {
    logger.info(
      "manual seat change skipped (cross-table dest occupied, no cascade)",
      { tid, playerId, to },
    );
    return { applied: false, description: null };
  }
  const move: BalancingMove = {
    playerId,
    from: { tableNum: player.tableNum, seatNum: player.seatNum },
    to,
  };
  return await applySingleMove(tid, uid, userGroupIds, move, players, false);
}

/**
 * Phase 5.x: 手動席移動の undo。
 *
 * 直前の cascade 全 move を reverse 方向（from↔to swap）で 1 tx 内で commit する。
 * 内部実装は applyCascadeMoves と同じ（race guard + atomic update）。
 *
 * 失敗ケース:
 *  - 元の cascade 中の player が独立に bust / 移動 → race / moved skipReason
 *  - 元 from-seat が他の player に占有 → seat-taken skipReason
 *
 * 失敗時は applied=false で返り、dashboard 側で error message を提示する想定。
 */
export async function applyManualSeatUndo(
  tid: string,
  uid: string,
  userGroupIds: string[],
  movesToReverse: BalancingMove[],
  players: PlayerDoc[],
): Promise<ApplyBalancingResult> {
  if (movesToReverse.length === 0) {
    return { applied: false, description: null };
  }
  const reversed: BalancingMove[] = movesToReverse.map((m) => ({
    playerId: m.playerId,
    from: m.to,
    to: m.from,
  }));
  if (reversed.length === 1) {
    return await applySingleMove(tid, uid, userGroupIds, reversed[0], players, false);
  }
  return await applyCascadeMoves(tid, uid, userGroupIds, reversed, players);
}

/**
 * Phase 5.x: 複数 player を同 tx 内で原子的に席移動する。
 *
 * cascade（同卓 D&D）と undo の共有実装。各 move 対象 player について
 * lastMovedAt + from-seat 一致を tx 内で再確認し、いずれか不一致なら全体 skip。
 * cascade で newly-occupied なる席（move の to にあって、どの move の from でもない席）
 * は他 player に占有されていないことを tx 内 re-read で検証する（seat-taken race guard）。
 *
 * verifyBalancingDiff は手動経路のため常に false（diff-resolved guard なし）。
 *
 * ⚠ 残存 race window: `otherTablePlayerIds` は呼出側 snapshot 時点で involved table に居た
 *   player を列挙したもの。snapshot 取得後・本 tx 開始前に同卓へ新規 player が join
 *   （late entry / 別 cascade）した場合、その player は再 read 対象に含まれず
 *   newly-occupied 検証から漏れる。`setIsPlayingDealer` の race window と同列で、
 *   20 人 × 月 1〜2 回スケールでは実用上発生しない頻度。完全防止には tournament 全件
 *   tx.get（read 量大）または Cloud Functions 化が必要だが現状は許容する。
 */
async function applyCascadeMoves(
  tid: string,
  uid: string,
  userGroupIds: string[],
  moves: BalancingMove[],
  players: PlayerDoc[],
): Promise<ApplyBalancingResult> {
  const cascadePlayerIds = new Set(moves.map((m) => m.playerId));
  const fromKeys = new Set(
    moves.map((m) => `${m.from.tableNum}-${m.from.seatNum}`),
  );
  const newlyOccupiedKeys = new Set(
    moves
      .map((m) => `${m.to.tableNum}-${m.to.seatNum}`)
      .filter((k) => !fromKeys.has(k)),
  );
  const involvedTables = new Set([
    ...moves.map((m) => m.from.tableNum),
    ...moves.map((m) => m.to.tableNum),
  ]);
  // cascade に含まれない同卓の他 player ID（newly-occupied seat 占有検証用）
  const otherTablePlayerIds = players
    .filter(
      (p) =>
        !p.isBusted &&
        p.tableNum !== null &&
        involvedTables.has(p.tableNum) &&
        !cascadePlayerIds.has(p.id),
    )
    .map((p) => p.id);

  let applied = false;
  let skipReason: string | null = null;

  await wrapFirestoreWrite(
    "firestore/write_failed",
    "席の cascade 移動に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        await loadTournamentInTx(tx, tid, userGroupIds);

        // 各 cascade 対象 player を re-read し race guard。
        const freshCascade = await Promise.all(
          moves.map(async (m) => ({
            move: m,
            snap: await tx.get(doc(playersRef(tid), m.playerId)),
          })),
        );
        for (const { move, snap } of freshCascade) {
          const fresh = playerFromSnap(snap);
          if (!fresh) {
            skipReason = `missing:${move.playerId}`;
            return;
          }
          if (fresh.isBusted) {
            skipReason = `busted:${move.playerId}`;
            return;
          }
          if (
            fresh.tableNum !== move.from.tableNum ||
            fresh.seatNum !== move.from.seatNum
          ) {
            skipReason = `moved:${move.playerId}`;
            return;
          }
          const expected = players.find((p) => p.id === move.playerId);
          const expectedMs = expected?.lastMovedAt
            ? expected.lastMovedAt.toMillis()
            : null;
          const actualMs = fresh.lastMovedAt
            ? fresh.lastMovedAt.toMillis()
            : null;
          if (actualMs !== expectedMs) {
            skipReason = `race:${move.playerId}`;
            return;
          }
        }

        // newly-occupied seat に他 player が居ないか re-read（seat-taken race guard）。
        // cascade の from-seat は別の cascade move が空けるため対象外。to-only の seat だけ検証。
        if (newlyOccupiedKeys.size > 0) {
          const freshOthers = await Promise.all(
            otherTablePlayerIds.map((id) => tx.get(doc(playersRef(tid), id))),
          );
          for (const snap of freshOthers) {
            const fresh = playerFromSnap(snap);
            if (!fresh) continue;
            if (fresh.isBusted) continue;
            if (fresh.tableNum === null || fresh.seatNum === null) continue;
            const key = `${fresh.tableNum}-${fresh.seatNum}`;
            if (newlyOccupiedKeys.has(key)) {
              skipReason = `seat-taken:${key}`;
              return;
            }
          }
        }

        const ts = serverTimestamp();
        for (const m of moves) {
          tx.update(doc(playersRef(tid), m.playerId), {
            tableNum: m.to.tableNum,
            seatNum: m.to.seatNum,
            lastMovedAt: ts,
          });
        }
        applied = true;
      });
    },
    { tid },
  );

  if (!applied) {
    logger.info("cascade move skipped", { tid, reason: skipReason });
    return { applied: false, description: null };
  }
  const desc = `${moves.length} 名の cascade 移動`;
  logger.info("cascade move ok", { tid, uid, count: moves.length });
  return { applied: true, description: desc, moves };
}

async function applySingleMove(
  tid: string,
  uid: string,
  userGroupIds: string[],
  move: BalancingMove,
  players: PlayerDoc[],
  // Phase 5.x: balancing 由来 (true) か手動 D&D (false) かで diff-resolved guard を切替。
  // balancing は「卓間差を縮める」意図なので diff < 2 になった move は逆効果 → skip。
  // 手動 D&D は「想定外を是正」する自由移動なので diff 検証はしない。
  verifyBalancingDiff: boolean = true,
): Promise<ApplyBalancingResult> {
  const expected = players.find((p) => p.id === move.playerId);
  const expectedLastMovedAtMs = expected?.lastMovedAt
    ? expected.lastMovedAt.toMillis()
    : null;

  // 移動先卓の既存プレイヤー ID（H2 と同じ seat 占有再検証）。
  const targetTableExistingIds = players
    .filter((p) => p.tableNum === move.to.tableNum && p.id !== move.playerId)
    .map((p) => p.id);
  // Phase 5.x: 移動元卓の既存プレイヤー ID（diff-resolved race guard 用）。
  // snapshot 取得後・本 tx commit 前に source 卓で他 player のバストが commit されると
  // diff < 2 になり move は不要 / 逆方向に害になる。tx 内で source/dest active を再カウント。
  const sourceTableExistingIds = players
    .filter((p) => p.tableNum === move.from.tableNum && p.id !== move.playerId)
    .map((p) => p.id);

  let applied = false;
  let skipReason: string | null = null;

  await wrapFirestoreWrite(
    "firestore/write_failed",
    "バランシング適用に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        await loadTournamentInTx(tx, tid, userGroupIds);

        const pRef = doc(playersRef(tid), move.playerId);
        const pSnap = await tx.get(pRef);
        const p = playerFromSnap(pSnap);
        if (!p) {
          skipReason = "missing";
          return;
        }
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
        // 同時に dest 卓の active 人数（後続の diff-resolved 検証用）を集計する。
        const freshTarget = await Promise.all(
          targetTableExistingIds.map((id) => tx.get(doc(playersRef(tid), id))),
        );
        let destActiveCount = 0;
        for (const snap of freshTarget) {
          const fresh = playerFromSnap(snap);
          if (!fresh) continue;
          if (fresh.isBusted) continue;
          if (fresh.tableNum !== move.to.tableNum) continue;
          if (fresh.seatNum === move.to.seatNum) {
            skipReason = "seat-taken";
            return;
          }
          destActiveCount++;
        }

        // Phase 5.x: source/dest 卓の現アクティブ人数を tx 内で再カウントし、
        // diff (= source - dest) が 2 未満なら move は無意味 / 逆方向に害になるため skip。
        // mover 自身は active 確定（busted ガード済み）なので 1 を加算。
        // verifyBalancingDiff=false（手動 D&D）の場合は source 卓の余分な read も skip する。
        if (verifyBalancingDiff) {
          const freshSource = await Promise.all(
            sourceTableExistingIds.map((id) => tx.get(doc(playersRef(tid), id))),
          );
          let sourceActiveCount = 1;
          for (const snap of freshSource) {
            const fresh = playerFromSnap(snap);
            if (!fresh) continue;
            if (fresh.isBusted) continue;
            if (fresh.tableNum !== move.from.tableNum) continue;
            sourceActiveCount++;
          }
          if (sourceActiveCount - destActiveCount < 2) {
            skipReason = "diff-resolved";
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
    },
    { tid },
  );

  if (!applied) {
    logger.info("balancing move skipped", { tid, playerId: move.playerId, reason: skipReason });
    return { applied: false, description: null };
  }
  const desc = `Table ${move.from.tableNum} / 席 ${move.from.seatNum} → Table ${move.to.tableNum} / 席 ${move.to.seatNum}`;
  logger.info("balancing move ok", { tid, uid, playerId: move.playerId, desc });
  return { applied: true, description: desc, moves: [move] };
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

  let applied = false;
  let skipReason: string | null = null;

  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル閉鎖に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        await loadTournamentInTx(tx, tid, userGroupIds);

        // 全 move 対象 player を tx.get で再確認し race を弾く。
        const freshPlayers = await Promise.all(
          plan.moves.map(async (m) => {
            const snap = await tx.get(doc(playersRef(tid), m.playerId));
            return { move: m, snap };
          }),
        );
        for (const { move, snap } of freshPlayers) {
          const fresh = playerFromSnap(snap);
          if (!fresh) {
            skipReason = `missing:${move.playerId}`;
            return;
          }
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
          const fresh = playerFromSnap(snap);
          if (!fresh) continue;
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
    },
    { tid },
  );

  if (!applied) {
    logger.info("table break skipped", { tid, brokenTableNum: plan.brokenTableNum, reason: skipReason });
    return { applied: false, description: null };
  }
  const desc = `Table ${plan.brokenTableNum} を閉鎖（${plan.moves.length} 名移動）`;
  logger.info("table break ok", { tid, uid, brokenTableNum: plan.brokenTableNum });
  return { applied: true, description: desc, break: true };
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
  // 旧コードは `if (e instanceof AppError) throw e` で specific code を保持していたが、
  // wrapFirestoreWrite 内部の AppError.from は既存 AppError を idempotent に返すため、
  // wrap 経由でも tx 内 throw（"seating/pd-busted" / "seating/pd-already-set" 等）の
  // code が保持される。logger.warn は wrap が 1 度だけ発火する。
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "PD 設定に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const t = await loadTournamentInTx(tx, tid, userGroupIds);

        const pRef = doc(playersRef(tid), pid);
        const pSnap = await tx.get(pRef);
        const p = playerFromSnap(pSnap);
        if (!p) {
          throw new AppError("not found", "firestore/not-found");
        }
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
          const fresh = playerFromSnap(snap);
          if (!fresh) continue;
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
    },
    { tid, pid },
  );
  logger.info("set pd ok", { tid, uid, pid, value });
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
