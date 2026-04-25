"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

interface Props {
  tournament: TournamentDoc;
  players: readonly PlayerDoc[];
  className?: string;
}

/**
 * 平均スタック表示カード。TimerDisplay の枠外に独立して配置する（兄弟要素）。
 *
 *  - state が running / paused のとき、かつ未バストが 1 人以上のときのみ表示
 *  - 計算: totalChips = totalEntries * initialStack
 *          average = Math.floor(totalChips / activePlayers)
 *  - Phase 4.7 時点ではリバイ／アドオン実操作は未実装のため、structureSnapshot の
 *    rebuyStack / addOnStack は参考値扱い（計算式には入れない）。
 */
export function AverageStackCard({ tournament, players, className }: Props) {
  if (tournament.state !== "running" && tournament.state !== "paused") return null;
  if (players.length === 0) return null;
  const active = players.filter((p) => !p.isBusted);
  if (active.length === 0) return null;

  const initialStack = tournament.structureSnapshot.initialStack;
  const totalChips = players.length * initialStack;
  const average = Math.floor(totalChips / active.length);

  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Average Stack
        </div>
        <div className="mt-1 font-mono text-3xl font-bold tabular-nums text-foreground">
          {average.toLocaleString()}
        </div>
        <div className="text-xs text-muted-foreground">
          初期 {initialStack.toLocaleString()}
        </div>
      </CardContent>
    </Card>
  );
}
