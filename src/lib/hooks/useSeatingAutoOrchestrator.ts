"use client";

import { useEffect, useMemo, useRef } from "react";

import { AppError } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { autoSeatLateEntry } from "@/lib/services/seating/orchestrator";

interface Options {
  tid: string;
  uid: string | null;
  userGroupIds: string[];
  tournament: TournamentDoc | null;
  players: PlayerDoc[];
  tables: TableDoc[];
}

/**
 * 運営者ダッシュボード専用。未配席 late entry を検出すると orchestrator を呼ぶ。
 * バランシングは「指示完了」UI を経由するため、ここでは扱わない。
 *
 * /live 等の参加者ビューからは絶対に呼ばない（rule で permission-denied）。
 *
 * 多重発火防止: 単一端末内では `inflight` Set で排他、複数端末間は orchestrator
 * 側の transaction guard が処理する。
 *
 * 依存配列の安定化（H3 fix）: `userGroupIds` は親フックが毎レンダリングで新しい配列参照を
 * 返す可能性があるため `join(",")` で文字列化して比較する。`players` / `tables` も
 * 同様に「ID + 状態」で safe な fingerprint を作って依存に含める。
 */
export function useSeatingAutoOrchestrator(opts: Options): void {
  const { tid, uid, userGroupIds, tournament, players, tables } = opts;
  const inflight = useRef<Set<string>>(new Set());

  // 配列参照を安定化するための fingerprint。
  const groupIdsKey = useMemo(() => userGroupIds.join(","), [userGroupIds]);
  const playersKey = useMemo(
    () =>
      players
        .map((p) => `${p.id}:${p.isBusted ? "b" : "a"}:${p.tableNum ?? "_"}:${p.seatNum ?? "_"}:${p.lastMovedAt?.toMillis() ?? "_"}`)
        .join("|"),
    [players],
  );
  const tablesKey = useMemo(
    () => tables.map((t) => `${t.tableNum}:${t.isBroken ? "b" : "o"}`).join("|"),
    [tables],
  );
  // L1 fix: tournament も raw object 参照ではなく、effect で参照するフィールドのみの
  // fingerprint に変える。Firestore subscribe は無関係なフィールド（updatedAt 等）の
  // 変化でも新 object を返すため、fingerprint しないと毎 snapshot で effect が再 fire する。
  const tournamentKey = useMemo(
    () =>
      tournament
        ? `${tournament.state}:${tournament.currentLevel}:${tournament.lateEntryDeadlineLevel}:${tournament.seatsPerTable}:${tournament.groupId}`
        : null,
    [tournament],
  );

  useEffect(() => {
    if (!uid || !tournament) return;
    if (tournament.state !== "running" && tournament.state !== "paused") return;
    if (!userGroupIds.includes(tournament.groupId)) return;
    // 締切超過は orchestrator 側でも no-op できるが、ここで弾けば transaction を発火しない。
    if (tournament.currentLevel > tournament.lateEntryDeadlineLevel) return;

    const seated = players.filter((p) => !p.isBusted);
    const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
    const seatsPerTable = tournament.seatsPerTable;

    for (const p of players) {
      if (p.isBusted) continue;
      if (p.tableNum !== null && p.seatNum !== null) continue;
      if (inflight.current.has(p.id)) continue;
      inflight.current.add(p.id);
      const expected = p.lastMovedAt ? p.lastMovedAt.toMillis() : null;
      void autoSeatLateEntry(
        tid,
        uid,
        userGroupIds,
        p.id,
        expected,
        seated,
        brokenTableNums,
        seatsPerTable,
      )
        .catch((e) => {
          const wrapped = AppError.from(
            e,
            "firestore/write_failed",
            "レイトエントリー自動配席に失敗しました",
          );
          logger.warn(wrapped.message, { code: wrapped.code, tid, pid: p.id });
        })
        .finally(() => {
          inflight.current.delete(p.id);
        });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fingerprint で参照不安定性を吸収
  }, [tid, uid, groupIdsKey, tournamentKey, playersKey, tablesKey]);
}
