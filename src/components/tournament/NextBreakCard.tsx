"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { getNextBreakInfo } from "@/lib/services/timer";
import { cn } from "@/lib/utils";

interface Props {
  tournament: TournamentDoc;
  remainingMs: number | null;
  className?: string;
}

function formatEta(ms: number): string {
  // タイマー表示と同じ「mm:ss」形式に揃える。1 時間以上は h:mm:ss。
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = m.toString().padStart(2, "0");
  const ss = s.toString().padStart(2, "0");
  if (h > 0) return `${h}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/**
 * 次の break までの ETA を表示するカード。break が残ってない場合は「ブレイクなし」表示。
 * trace: tmp/10_Phase4.9_memo.md 改善要望#4
 */
export function NextBreakCard({ tournament, remainingMs, className }: Props) {
  if (
    tournament.state !== "running" &&
    tournament.state !== "paused"
  ) {
    return null;
  }
  const info = getNextBreakInfo(tournament, remainingMs);
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Next Break In
        </div>
        {info === null ? (
          <div className="mt-1 text-sm text-muted-foreground">予定なし</div>
        ) : info.levelsAhead === 0 ? (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
              ☕ Break中
            </span>
          </div>
        ) : (
          <div className="mt-1 space-y-0.5">
            <div
              className={cn(
                "font-mono text-2xl font-bold tabular-nums text-foreground",
              )}
            >
              {formatEta(info.etaMs)}
            </div>
            <div className="text-xs text-muted-foreground">
              Lv {info.level.level} で break（あと {info.levelsAhead} レベル）
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
