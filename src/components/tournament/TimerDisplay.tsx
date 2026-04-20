"use client";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import type { LevelInfo } from "@/lib/services/timer";
import { cn } from "@/lib/utils";

interface Props {
  tournament: TournamentDoc;
  remainingMs: number | null;
  levelInfo: LevelInfo | null;
  className?: string;
}

function formatRemaining(ms: number | null): string {
  if (ms === null) return "--:--";
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60)
    .toString()
    .padStart(2, "0");
  const s = (totalSec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export function TimerDisplay({ tournament, remainingMs, levelInfo, className }: Props) {
  const isBeforeStart = tournament.state === "setup" || tournament.state === "seating";

  const stateBadge =
    tournament.state === "paused"
      ? { label: "一時停止中", tone: "bg-amber-500/10 text-amber-700 dark:text-amber-400" }
      : tournament.state === "finished"
        ? { label: "終了", tone: "bg-muted text-muted-foreground" }
        : tournament.state === "running"
          ? { label: "進行中", tone: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" }
          : isBeforeStart
            ? { label: "開始前", tone: "bg-muted text-muted-foreground" }
            : { label: "未開始", tone: "bg-muted text-muted-foreground" };

  // setup / seating 中は Lv1 をプレビュー表示する。
  const previewLevel =
    isBeforeStart && tournament.structureSnapshot.levels.length > 0
      ? tournament.structureSnapshot.levels[0]
      : null;
  const previewNext =
    isBeforeStart && tournament.structureSnapshot.levels.length > 1
      ? tournament.structureSnapshot.levels[1]
      : null;

  const current = levelInfo?.current ?? previewLevel;
  const next = levelInfo?.next ?? previewNext;

  const displayLevelNum = isBeforeStart ? 1 : tournament.currentLevel;
  const displayRemainingMs =
    isBeforeStart && previewLevel ? previewLevel.durationSec * 1000 : remainingMs;

  return (
    <section
      aria-label="タイマー"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border bg-card p-4 text-card-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <span className="rounded bg-primary px-2 py-0.5 text-sm font-semibold text-primary-foreground">
          Lv {displayLevelNum}
        </span>
        <span className={cn("rounded px-2 py-0.5 text-xs font-medium", stateBadge.tone)}>
          {stateBadge.label}
        </span>
      </div>

      <div aria-label="残り時間" className="font-mono text-7xl font-bold tabular-nums md:text-8xl">
        {formatRemaining(displayRemainingMs)}
      </div>
      {remainingMs === null && !isBeforeStart ? (
        <p className="text-xs text-muted-foreground">同期中…</p>
      ) : null}

      {current ? (
        <div className="text-base text-muted-foreground">
          SB {current.sb} / BB {current.bb} / Ante {current.ante}
        </div>
      ) : null}

      {next ? (
        <div className="text-sm text-muted-foreground">
          次: Lv {next.level} ({next.sb} / {next.bb}
          {next.ante > 0 ? ` / ante ${next.ante}` : ""})
        </div>
      ) : levelInfo && tournament.currentLevel >= tournament.structureSnapshot.levels.length ? (
        <div className="text-sm text-muted-foreground">最終レベル</div>
      ) : null}
    </section>
  );
}
