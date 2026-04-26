"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";

interface Props {
  players: readonly PlayerDoc[];
  className?: string;
}

/**
 * 残り人数 / 母数を表示するカード。
 *  - Phase 4.14: setup/seating（開始前）でも受付済みが 1 人以上いれば描画する。
 *    受付者ゼロのときは render skip → grid 列幅維持のために兄弟カード同様の挙動。
 *    setup ではバスト操作が無いので active === players.length となるが意図通り。
 * trace: tmp/10_Phase4.9_memo.md 改善要望#4
 */
export function PlayersCard({ players, className }: Props) {
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
