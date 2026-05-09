"use client";

import { useEffect, useState } from "react";

import { AverageStackCard } from "@/components/tournament/AverageStackCard";
import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { NextBreakCard } from "@/components/tournament/NextBreakCard";
import { OfflineBanner } from "@/components/tournament/OfflineBanner";
import { PlayersCard } from "@/components/tournament/PlayersCard";
import { SeatingBoard } from "@/components/tournament/SeatingBoard";
import { StructureSnapshotCard } from "@/components/tournament/StructureSnapshotCard";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
import { type AppError, getErrorCode } from "@/lib/errors";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables } from "@/lib/firebase/repositories/tables";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { logger } from "@/lib/logger";
import { getLevelInfo } from "@/lib/services/timer";
import { isBeforeStart, isFinished } from "@/lib/services/tournament-state";

/**
 * Phase 2 (04-spectate-mode): /spectate/[tid] の Client Component。
 *   /live と独立進化（auth 周辺は丸ごと除外）。subscribe API の onError から
 *   permission-denied を検知して「観戦が終了しました」graceful 表示に倒す。
 *
 * - useAuthUser / useCurrentGroup / useGroupRole は **一切読まない**（PRD 設計）。
 * - useTournamentTimer は autoAdvance を渡さず read-only 用途で利用。
 * - subscribePlayers / subscribeTables は anon でも spectateEnabled=true の rule 経路で通る。
 * - guard ladder（4 段）: spectate ended → 読込中 → 未公開 → 通常 view。
 */
export function SpectateClient({ tid }: { tid: string }) {
  const {
    tournament,
    remainingMs,
    fromCache,
    hasPendingWrites,
    lastSyncAt,
    error: timerError,
  } = useTournamentTimer(tid);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [tables, setTables] = useState<TableDoc[]>([]);

  // spectateEnabled OFF → 既存 listener が permission-denied を吐く。これを「観戦が終了しました」
  // graceful な状態に倒すための flag。一度 true になったら subscribe 系の他エラーで上書きしない。
  const [spectateEnded, setSpectateEnded] = useState(false);

  // useTournamentTimer 自体の error を spectate-end / その他で分岐ハンドリング。
  useEffect(() => {
    if (!timerError) return;
    const innerCode = getErrorCode(timerError.cause);
    logger.warn("spectate subscribe error", {
      code: timerError.code,
      innerCode,
      scope: "tournament",
      tid,
    });
    if (innerCode === "permission-denied") {
      setSpectateEnded(true);
    }
  }, [timerError, tid]);

  useEffect(() => {
    const handle = (err: AppError, scope: "players" | "tables") => {
      const innerCode = getErrorCode(err.cause);
      logger.warn("spectate subscribe error", {
        code: err.code,
        innerCode,
        scope,
        tid,
      });
      if (innerCode === "permission-denied") {
        setSpectateEnded(true);
      }
    };
    const unsub = subscribePlayers(
      tid,
      (list) => setPlayers(list),
      (err) => handle(err, "players"),
    );
    return unsub;
  }, [tid]);

  useEffect(() => {
    const handle = (err: AppError) => {
      const innerCode = getErrorCode(err.cause);
      logger.warn("spectate subscribe error", {
        code: err.code,
        innerCode,
        scope: "tables",
        tid,
      });
      if (innerCode === "permission-denied") {
        setSpectateEnded(true);
      }
    };
    const unsub = subscribeTables(
      tid,
      (list) => setTables(list),
      (err) => handle(err),
    );
    return unsub;
  }, [tid]);

  // ────────────────────────────────────────────────────────────
  // Guard ladder: spectate ended → 読込中 → 未公開 → 通常 view
  if (spectateEnded) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">観戦が終了しました</h1>
        <p className="text-sm text-muted-foreground">
          この tournament の観戦モードは既に OFF にされています。主催者にお問い合わせください。
        </p>
      </main>
    );
  }

  if (!tournament) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm text-muted-foreground">読込中…</main>
    );
  }

  // rule で spectateEnabled !== true の doc は read 拒否されるが、念のため UI 側も guard。
  if (tournament.spectateEnabled !== true) {
    return (
      <main className="mx-auto max-w-md p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold">観戦が公開されていません</h1>
        <p className="text-sm text-muted-foreground">
          URL を再確認するか、主催者に観戦モードの公開状態を確認してください。
        </p>
      </main>
    );
  }

  const levelInfo = getLevelInfo(tournament);
  const lateEntryClosed = tournament.currentLevel > tournament.lateEntryDeadlineLevel;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-7xl flex-col gap-4 p-4 pt-6">
      <OfflineBanner fromCache={fromCache} hasPendingWrites={hasPendingWrites} />

      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold md:text-xl">{tournament.name}</h1>
        <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
      </header>

      <TimerDisplay
        tournament={tournament}
        remainingMs={remainingMs}
        levelInfo={levelInfo}
      />

      <SpectateLateEntryBanner
        tournament={tournament}
        lateEntryClosed={lateEntryClosed}
      />

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <PlayersCard players={players} />
        <AverageStackCard tournament={tournament} players={players} />
        <NextBreakCard tournament={tournament} remainingMs={remainingMs} />
      </div>

      <SeatingBoard
        players={players}
        tables={tables}
        seatsPerTable={tournament.seatsPerTable}
        currentUid={null}
        canManage={false}
      />

      <StructureSnapshotCard
        snapshot={tournament.structureSnapshot}
        currentLevel={tournament.currentLevel}
        showDescription={false}
      />
    </main>
  );
}

/**
 * Phase 2 (04-spectate-mode): 観戦者向けレイトレジ受付状況 banner。
 *
 * - state === "setup" / "seating": 「受付準備中」（trying to register が常に有効）
 * - state === "running" / "paused" && !lateEntryClosed: "📢 レイトレジ Lv N まで受付中"
 * - state === "running" / "paused" && lateEntryClosed: "受付終了"
 * - state === "finished": "終了"
 *
 * PRD Must: "Lv X まで受付中" / "受付終了" の 2 文言は必須。"受付準備中" / "終了" は補助。
 */
function SpectateLateEntryBanner({
  tournament,
  lateEntryClosed,
}: {
  tournament: TournamentDoc;
  lateEntryClosed: boolean;
}) {
  if (isFinished(tournament)) {
    return (
      <section
        role="status"
        className="mx-auto w-full rounded-md border bg-muted px-3 py-2 text-center text-sm"
      >
        このトーナメントは終了しました
      </section>
    );
  }
  if (isBeforeStart(tournament)) {
    return (
      <section
        role="status"
        className="mx-auto w-full rounded-md border bg-muted/40 px-3 py-2 text-center text-sm text-muted-foreground"
      >
        受付準備中（開始前）
      </section>
    );
  }
  // running / paused
  if (lateEntryClosed) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="mx-auto w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm dark:border-amber-700 dark:bg-amber-900/20"
        data-testid="spectate-late-entry-closed"
      >
        ⛔ レイトレジ受付終了（Lv {tournament.lateEntryDeadlineLevel} まで）
      </section>
    );
  }
  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto w-full rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-sm dark:border-emerald-700 dark:bg-emerald-900/20"
      data-testid="spectate-late-entry-open"
    >
      📢 レイトレジ Lv {tournament.lateEntryDeadlineLevel} まで受付中（現在 Lv{" "}
      {tournament.currentLevel}）
    </section>
  );
}
