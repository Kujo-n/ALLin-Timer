"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { isBeforeStart as isBeforeStartState } from "@/lib/services/tournament-state";

interface Props {
  tournament: TournamentDoc;
  players: readonly PlayerDoc[];
  className?: string;
}

/**
 * 平均スタック表示カード。TimerDisplay の枠外に独立して配置する（兄弟要素）。
 *
 *  - 計算: totalChips = totalEntries * initialStack
 *          average = Math.floor(totalChips / activePlayers)
 *  - Phase 4.7 時点ではリバイ／アドオン実操作は未実装のため、structureSnapshot の
 *    rebuyStack / addOnStack は参考値扱い（計算式には入れない）。
 *  - Phase 4.14: setup/seating（開始前）でも受付済みが 1 人以上いれば描画し、
 *    平均 = 初期スタック（全員未バスト前提）として「受付中」表示する。
 *    受付者ゼロのときは render skip → grid セルが空のまま列幅は維持される。
 */
export function AverageStackCard({ tournament, players, className }: Props) {
  if (players.length === 0) return null;
  const active = players.filter((p) => !p.isBusted);
  if (active.length === 0) return null;

  const isBeforeStart = isBeforeStartState(tournament);
  const initialStack = tournament.structureSnapshot.initialStack;
  const totalChips = players.length * initialStack;
  const average = Math.floor(totalChips / active.length);

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-base font-semibold text-foreground md:text-lg">
          Average Stack
        </div>
        <div className="mt-1 font-mono text-4xl font-bold tabular-nums text-foreground md:text-5xl">
          {average.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">
          {isBeforeStart ? "受付中" : `初期 ${initialStack.toLocaleString()}`}
        </div>
      </CardContent>
    </Card>
  );
}
