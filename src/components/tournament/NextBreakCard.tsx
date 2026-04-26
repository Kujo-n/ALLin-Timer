"use client";

import { Card, CardContent } from "@/components/ui/card";
import type { Level } from "@/lib/firebase/schemas/structure";
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

interface PreviewBreakInfo {
  level: Level;
  /** Lv 1 起点で何レベル先か */
  levelsAhead: number;
}

/**
 * setup/seating（開始前）のとき、Lv 1 起点で最初の break level を線形検索する。
 * ETA は未開始のため表示しない（カード側で判定）。
 */
function previewBreakInfo(tournament: TournamentDoc): PreviewBreakInfo | null {
  const levels = tournament.structureSnapshot.levels;
  for (let i = 0; i < levels.length; i += 1) {
    if (levels[i].isBreak) {
      // Lv 1（index=0）からの距離（break が Lv 1 自身なら 0）
      return { level: levels[i], levelsAhead: i };
    }
  }
  return null;
}

/**
 * 次の break までの ETA を表示するカード。break が残ってない場合は「ブレイクなし」表示。
 * Phase 4.14: setup/seating でも開始前プレビュー（Lv 1 起点）を表示し、grid 列数を不変にする。
 * trace: tmp/10_Phase4.9_memo.md 改善要望#4
 */
export function NextBreakCard({ tournament, remainingMs, className }: Props) {
  const isBeforeStart = tournament.state === "setup" || tournament.state === "seating";
  const info = isBeforeStart ? null : getNextBreakInfo(tournament, remainingMs);
  const preview = isBeforeStart ? previewBreakInfo(tournament) : null;
  return (
    <Card className={className}>
      <CardContent className="p-4">
        <div className="text-base font-semibold text-foreground md:text-lg">
          Next Break In
        </div>
        {isBeforeStart ? (
          preview === null ? (
            <div className="mt-1 text-sm text-muted-foreground">予定なし</div>
          ) : (
            <div className="mt-1 space-y-0.5">
              <div className="font-mono text-3xl font-bold tabular-nums text-muted-foreground md:text-4xl">
                —
              </div>
              <div className="text-xs text-muted-foreground">
                Lv {preview.level.level} で break（あと {preview.levelsAhead} レベル）
              </div>
            </div>
          )
        ) : info === null ? (
          <div className="mt-1 text-sm text-muted-foreground">予定なし</div>
        ) : info.levelsAhead === 0 ? (
          <div className="mt-1 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums text-amber-600 dark:text-amber-400 md:text-4xl">
              ☕ Break中
            </span>
          </div>
        ) : (
          <div className="mt-1 space-y-0.5">
            <div
              className={cn(
                "font-mono text-3xl font-bold tabular-nums text-foreground md:text-4xl",
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
