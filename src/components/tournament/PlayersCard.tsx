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
 * 残り人数 / 母数を表示するカード。
 *  - running / paused のときのみ表示（setup/seating は受付中、finished は固定後の参考表示でも良いが
 *    AverageStackCard と挙動を揃える）。
 * trace: tmp/10_Phase4.9_memo.md 改善要望#4
 */
export function PlayersCard({ tournament, players, className }: Props) {
  if (
    tournament.state !== "running" &&
    tournament.state !== "paused" &&
    tournament.state !== "finished"
  )
    return null;
  if (players.length === 0) return null;
  const active = players.filter((p) => !p.isBusted).length;
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-base font-semibold text-foreground md:text-lg">
          Players
        </div>
        <div className="mt-1 flex items-baseline gap-1 font-mono tabular-nums">
          <span className="text-4xl font-bold text-foreground md:text-5xl">{active}</span>
          <span className="text-2xl text-muted-foreground md:text-3xl">/</span>
          <span className="text-2xl text-muted-foreground md:text-3xl">{players.length}</span>
        </div>
      </CardContent>
    </Card>
  );
}
