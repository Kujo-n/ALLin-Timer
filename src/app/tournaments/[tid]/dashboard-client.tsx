"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { QrPanel } from "@/components/qr/QrPanel";
import { AverageStackCard } from "@/components/tournament/AverageStackCard";
import { BalancingInstructionCard } from "@/components/tournament/BalancingInstructionCard";
import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { NextBreakCard } from "@/components/tournament/NextBreakCard";
import { PlayerList } from "@/components/tournament/PlayerList";
import { PlayersCard } from "@/components/tournament/PlayersCard";
import { SeatingBoard } from "@/components/tournament/SeatingBoard";
import { StructureSnapshotCard } from "@/components/tournament/StructureSnapshotCard";
import { TimerControls } from "@/components/tournament/TimerControls";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
import { WinnerBanner } from "@/components/tournament/WinnerBanner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { updateAudioSettings } from "@/lib/firebase/repositories/groups";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables } from "@/lib/firebase/repositories/tables";
import {
  deleteTournamentIfSetup,
  finishTournament,
} from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { useAudioPlayer } from "@/lib/hooks/useAudioPlayer";
import { useSeatingAutoOrchestrator } from "@/lib/hooks/useSeatingAutoOrchestrator";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { deriveRole } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { getLevelInfo, resolveWinner } from "@/lib/services/timer";

const AUTO_FINISH_DELAY_MS = 2000;

export function DashboardClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groupIds, groups, loading: groupsLoading } = useCurrentGroup();

  // 認証済みユーザー全員に autoAdvance opts を渡す。実際の per-tournament group
  // メンバーシップ check は useTournamentTimer 内（および orchestrator 内 tx）で
  // 行われるため、ここでは tournament.groupId を待たずに opts を確定できる。
  const {
    tournament: data,
    remainingMs,
    fromCache,
    lastSyncAt,
    error: timerError,
  } = useTournamentTimer(tid, {
    autoAdvance: user ? { uid: user.uid, userGroupIds: groupIds } : undefined,
  });

  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [playersError, setPlayersError] = useState<string | null>(null);
  const [tables, setTables] = useState<TableDoc[]>([]);

  // Phase 4: dashboard で players と tables を 1 度だけ subscribe し、
  // PlayerList / SeatingBoard / BalancingInstructionCard / TimerControls に伝搬。
  useEffect(() => {
    setPlayersError(null);
    const unsub = subscribePlayers(
      tid,
      (list) => setPlayers(list),
      (err) => {
        logger.warn(err.message, { code: err.code });
        setPlayersError(`${err.code}: ${err.message}`);
      },
    );
    return unsub;
  }, [tid]);

  useEffect(() => {
    const unsub = subscribeTables(
      tid,
      (list) => setTables(list),
      (err) => {
        logger.warn(err.message, { code: err.code });
        // tables 購読失敗は致命ではない（席決め前は空でも UI は表示できる）。warn のみ。
      },
    );
    return unsub;
  }, [tid]);

  useSeatingAutoOrchestrator({
    tid,
    uid: user?.uid ?? null,
    userGroupIds: groupIds,
    tournament: data,
    players,
    tables,
  });

  // Phase 4.5: 残り 1 人になった時点で 2 秒後に自動で finishTournament を呼ぶ。
  // 参加者端末（非 group メンバー）では rule 違反になるため dashboard（運営者側）のみで trigger。
  // 冪等性は finishTournament 内部で担保（state === "finished" なら no-op）。
  //
  // 依存は primitive (winner?.id / data?.state 等) に絞り、Firestore snapshot の
  // 再発行で deps オブジェクト参照が変わっても不要な再装填を起こさないようにする。
  const winner = useMemo(
    () => (data ? resolveWinner(data, players) : null),
    [data, players],
  );
  const winnerId = winner?.id ?? null;
  const dataId = data?.id;
  const dataState = data?.state;
  const dataGroupId = data?.groupId;
  const userUid = user?.uid;

  const autoFinishInflightRef = useRef(false);
  useEffect(() => {
    if (!userUid || !dataId || !dataGroupId) return;
    if (!groupIds.includes(dataGroupId)) return;
    if (dataState !== "running" && dataState !== "paused") return;
    if (!winnerId) return;
    if (autoFinishInflightRef.current) return;

    autoFinishInflightRef.current = true;
    const capturedGroupIds = groupIds;
    const timer = setTimeout(() => {
      void finishTournament(dataId, userUid, capturedGroupIds).catch((e) => {
        const code = e instanceof AppError ? e.code : "unknown";
        logger.warn("auto finish failed", { code, tid: dataId });
        autoFinishInflightRef.current = false;
      });
    }, AUTO_FINISH_DELAY_MS);
    return () => {
      clearTimeout(timer);
      autoFinishInflightRef.current = false;
    };
  }, [winnerId, dataId, dataState, dataGroupId, userUid, groupIds]);

  // Phase 4.6: 一般メンバー（または非メンバー）は dashboard を閲覧できないため /live にリダイレクト。
  // data.groupId が判明し、groups ロード完了後に判定する（判定前の flash 防止のため render 側で loading 表示）。
  const tournamentGroupId = data?.groupId;
  useEffect(() => {
    if (!user) return;
    if (groupsLoading) return;
    if (!tournamentGroupId) return;
    const g = groups.find((x) => x.id === tournamentGroupId);
    const role = g ? deriveRole(g, user.uid) : null;
    if (role !== "owner" && role !== "organizer") {
      router.replace(`/tournaments/${tid}/live`);
    }
  }, [user, groupsLoading, groups, tournamentGroupId, router, tid]);

  // tournament の groupId に紐づく group ドキュメント。
  //   - 早期 return 前に確定する（後段の useAudioPlayer / role gate で使う）。
  //   - 命名は `tournamentGroup` で統一する（`useCurrentGroup().currentGroup` とは別物）。
  const tournamentGroup = data ? groups.find((x) => x.id === data.groupId) ?? null : null;

  // Phase 4.9: 音声通知。早期 return 前に呼ぶことで hooks の呼び出し順を一定に保つ。
  // 引数は null 許容で、role が owner/organizer 以外なら hook 内部で no-op になる。
  const audioRole = user && tournamentGroup ? deriveRole(tournamentGroup, user.uid) : null;
  const audioPlayer = useAudioPlayer({
    tournament: data,
    group: tournamentGroup,
    players,
    role: audioRole,
  });

  async function onDelete() {
    if (!user) return;
    try {
      await deleteTournamentIfSetup(tid, user.uid, groupIds);
      router.push("/tournaments");
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "削除失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
      setConfirmOpen(false);
    }
  }

  if (timerError) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-sm text-destructive" role="alert">
          {`${timerError.code}: ${timerError.message}`}
        </p>
      </main>
    );
  }

  if (!data || !user) {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  // role 判定前 or 非 organizer の場合はローディング表示（useEffect で /live へ redirect 中）。
  const myRole = tournamentGroup ? deriveRole(tournamentGroup, user.uid) : null;
  const isOrganizer = myRole === "owner" || myRole === "organizer";
  if (groupsLoading || !isOrganizer) {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  const isMember = groupIds.includes(data.groupId);
  const canEdit = isMember && data.state === "setup";
  const showSeatingBoard =
    data.state === "seating" ||
    data.state === "running" ||
    data.state === "paused";
  const showBalancing = isMember && (data.state === "running" || data.state === "paused");
  const levelInfo = getLevelInfo(data);
  const showRightColumn =
    data.state === "running" || data.state === "paused" || data.state === "finished";
  const gridColsClass = showRightColumn
    ? "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)_minmax(220px,260px)]"
    : "lg:grid-cols-[minmax(220px,260px)_minmax(0,1fr)]";

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-8 lg:max-w-7xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{data.name}</h1>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">{data.state}</span>
            <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
          </div>
          <p className="text-sm text-muted-foreground">
            レイトレジスト Lv{data.lateEntryDeadlineLevel} /{" "}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tournaments">
            <Button variant="outline" size="sm">
              一覧へ戻る
            </Button>
          </Link>
          <Link href={`/tournaments/${tid}/live`}>
            <Button variant="outline" size="sm">
              全画面表示
            </Button>
          </Link>
          {canEdit ? (
            <>
              <Link href={`/tournaments/${tid}/edit`}>
                <Button variant="outline" size="sm">
                  編集
                </Button>
              </Link>
              <Button variant="destructive" size="sm" onClick={() => setConfirmOpen(true)}>
                削除
              </Button>
            </>
          ) : null}
        </div>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        上段 — 等高 3 列。lg+ で QR / タイマー+操作 / 統計 3 カードを同じ高さに揃える。
        最も背の高い QrPanel を基準に他 2 列が伸びる。
        sticky は等高化と両立しないため廃止（Phase 4.11 までは sticky だった）。
        state=setup/seating では右列を非表示にし grid を 2 列に縮退する。
        trace: phase-4.12-dashboard-polish-and-table-rename.plan.md
      */}
      <div className={`grid grid-cols-1 gap-4 ${gridColsClass} lg:items-stretch`}>
        <aside className="order-3 lg:order-1">
          <QrPanel tid={tid} className="h-full" />
        </aside>

        <div className="order-1 flex flex-col gap-4 lg:order-2">
          <TimerDisplay
            tournament={data}
            remainingMs={remainingMs}
            levelInfo={levelInfo}
            className="flex-1 justify-center"
          />
          {/* タイマー操作 — タイマー直下に中央揃えでアイコンボタン群を並べる。
              サウンド On/Off は audio props（運営者ロール時のみ）。 */}
          {isMember ? (
            <TimerControls
              tid={tid}
              uid={user.uid}
              userGroupIds={groupIds}
              tournament={data}
              players={players}
              audio={
                tournamentGroup
                  ? {
                      enabled: tournamentGroup.audioSettings.enabled,
                      unlocked: audioPlayer.unlocked,
                      onUnlock: audioPlayer.unlock,
                      onToggleEnabled: async (next: boolean) => {
                        try {
                          await updateAudioSettings(tournamentGroup.id, {
                            ...tournamentGroup.audioSettings,
                            enabled: next,
                          });
                        } catch (e) {
                          // updateAudioSettings 内で既に AppError wrap + logger.warn 済み。
                          // 二重ログを避けるため、ここでは UI 表示のみ。
                          const err =
                            e instanceof AppError
                              ? e
                              : AppError.from(e, "firestore/write_failed", "サウンド設定の更新に失敗しました");
                          setError(`${err.code}: ${err.message}`);
                        }
                      },
                    }
                  : undefined
              }
              onError={setError}
            />
          ) : null}
        </div>

        {showRightColumn ? (
          <aside className="order-2 grid grid-rows-[repeat(3,minmax(0,1fr))] gap-3 lg:order-3">
            <NextBreakCard tournament={data} remainingMs={remainingMs} className="h-full" />
            <AverageStackCard tournament={data} players={players} className="h-full" />
            <PlayersCard tournament={data} players={players} className="h-full" />
          </aside>
        ) : null}
      </div>

      {winner ? <WinnerBanner winner={winner} /> : null}

      {showBalancing ? (
        <BalancingInstructionCard
          tid={tid}
          uid={user.uid}
          userGroupIds={groupIds}
          players={players}
          tables={tables}
          seatsPerTable={data.seatsPerTable}
          onError={setError}
        />
      ) : null}

      {showSeatingBoard ? (
        <Card>
          <CardHeader>
            <CardTitle>Table List</CardTitle>
          </CardHeader>
          <CardContent>
            <SeatingBoard
              players={players}
              tables={tables}
              seatsPerTable={data.seatsPerTable}
              currentUid={user.uid}
            />
          </CardContent>
        </Card>
      ) : null}

      <PlayerList
        tid={tid}
        players={players}
        subscribeError={playersError}
        canManage={isMember}
        tournamentState={data.state}
      />

      <StructureSnapshotCard
        snapshot={data.structureSnapshot}
        currentLevel={data.currentLevel}
        showDescription
      />


      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トーナメントを削除</DialogTitle>
            <DialogDescription>
              「{data.name}」を削除します。state が `setup` のトーナメントのみ削除できます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onDelete();
              }}
            >
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
