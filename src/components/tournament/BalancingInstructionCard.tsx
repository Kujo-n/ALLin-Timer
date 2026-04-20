"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { logger } from "@/lib/logger";
import { planBalancingMove, planTableBreak } from "@/lib/services/seating/engine";
import { applyBalancingOnce } from "@/lib/services/seating/orchestrator";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  players: PlayerDoc[];
  tables: TableDoc[];
  seatsPerTable: number;
  onError?: (message: string) => void;
}

/**
 * Phase 4: バランシング指示カード。
 *  - engine.planTableBreak（優先）または planBalancingMove で 1 件分の指示を表示
 *  - 「指示完了」で orchestrator.applyBalancingOnce を呼び、subscribe 経由で players が
 *    更新されると plan が再計算され、次の指示が表示される（連鎖）
 *  - plan が null（バランス済み）ならカード自体非表示
 */
export function BalancingInstructionCard({
  tid,
  uid,
  userGroupIds,
  players,
  tables,
  seatsPerTable,
  onError,
}: Props) {
  const [busy, setBusy] = useState(false);
  // M5 fix: 非同期 finally の setBusy が unmount 後に走らないように guard。
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const { kind, description } = useMemo(() => {
    const brokenTableNums = tables.filter((t) => t.isBroken).map((t) => t.tableNum);
    const breakPlan = planTableBreak(players, brokenTableNums, seatsPerTable);
    if (breakPlan) {
      return {
        kind: "break" as const,
        description: `卓 ${breakPlan.brokenTableNum} を閉鎖（${breakPlan.moves.length} 名移動）`,
      };
    }
    const move = planBalancingMove(players, brokenTableNums, seatsPerTable);
    if (move) {
      const player = players.find((p) => p.id === move.playerId);
      const name = player?.displayName ?? "（不明）";
      return {
        kind: "move" as const,
        description: `${name}（${move.from.tableNum}卓${move.from.seatNum}席）を ${move.to.tableNum}卓${move.to.seatNum}席へ移動`,
      };
    }
    return { kind: "none" as const, description: null };
  }, [players, tables, seatsPerTable]);

  if (kind === "none") return null;

  async function handleApply() {
    if (busy) return;
    setBusy(true);
    try {
      const result = await applyBalancingOnce(
        tid,
        uid,
        userGroupIds,
        players,
        tables,
        seatsPerTable,
      );
      if (!result.applied) {
        // race で no-op された場合。次回 subscribe 発火で再評価される。
        logger.info("balancing instruction skipped (race)", { tid });
      }
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "バランシング適用に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      if (mounted.current) onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Card className="border-amber-500/60 bg-amber-50/60 dark:bg-amber-950/20">
      <CardHeader>
        <CardTitle className="text-base">⚠ 次のアクション</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm">{description}</p>
        <Button size="sm" disabled={busy} onClick={() => void handleApply()}>
          {busy ? "適用中…" : "指示完了"}
        </Button>
      </CardContent>
    </Card>
  );
}
