"use client";

import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { getLevelInfo } from "@/lib/services/timer";

export function LiveClient({ tid }: { tid: string }) {
  // /live は read-only。autoAdvance は渡さない（参加者端末は rule で書込不可）。
  const { tournament, remainingMs, fromCache, lastSyncAt, error } = useTournamentTimer(tid);

  if (error) {
    return (
      <main className="mx-auto max-w-md p-6">
        <p className="text-sm text-destructive" role="alert">
          {`${error.code}: ${error.message}`}
        </p>
      </main>
    );
  }

  if (!tournament) {
    return <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">読込中…</main>;
  }

  const levelInfo = getLevelInfo(tournament);

  return (
    <main className="flex min-h-screen flex-col items-center justify-start gap-4 p-4 pt-8">
      <div className="flex w-full max-w-md items-center justify-between">
        <h1 className="text-lg font-semibold">{tournament.name}</h1>
        <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
      </div>
      <TimerDisplay
        tournament={tournament}
        remainingMs={remainingMs}
        levelInfo={levelInfo}
        className="w-full max-w-md"
      />
    </main>
  );
}
