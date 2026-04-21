"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { QrPanel } from "@/components/qr/QrPanel";
import { BalancingInstructionCard } from "@/components/tournament/BalancingInstructionCard";
import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { PlayerList } from "@/components/tournament/PlayerList";
import { SeatingBoard } from "@/components/tournament/SeatingBoard";
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
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTables } from "@/lib/firebase/repositories/tables";
import {
  deleteTournamentIfSetup,
  finishTournament,
} from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { useSeatingAutoOrchestrator } from "@/lib/hooks/useSeatingAutoOrchestrator";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { getLevelInfo, resolveWinner } from "@/lib/services/timer";

const AUTO_FINISH_DELAY_MS = 2000;

export function DashboardClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groupIds } = useCurrentGroup();

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

  const isMember = groupIds.includes(data.groupId);
  const canEdit = isMember && data.state === "setup";
  const showSeatingBoard =
    data.state === "seating" ||
    data.state === "running" ||
    data.state === "paused";
  const showBalancing = isMember && (data.state === "running" || data.state === "paused");
  const levelInfo = getLevelInfo(data);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{data.name}</h1>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">{data.state}</span>
            <ConnectionBadge fromCache={fromCache} lastSyncAt={lastSyncAt} />
          </div>
          <p className="text-sm text-muted-foreground">
            現在 Lv{data.currentLevel} / 締切 Lv{data.lateEntryDeadlineLevel} /{" "}
            {data.structureSnapshot.levels.length} レベル / 1 卓 {data.seatsPerTable} 席
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

      <TimerDisplay tournament={data} remainingMs={remainingMs} levelInfo={levelInfo} />

      {winner ? <WinnerBanner winner={winner} /> : null}

      {isMember ? (
        <TimerControls
          tid={tid}
          uid={user.uid}
          userGroupIds={groupIds}
          tournament={data}
          players={players}
          onError={setError}
        />
      ) : null}

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
            <CardTitle>卓 / 席</CardTitle>
            <CardDescription>★ は自分の席（運営兼任プレイヤーの場合）。</CardDescription>
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

      <div className="grid gap-6 md:grid-cols-2">
        <QrPanel tid={tid} />
        <PlayerList
          tid={tid}
          players={players}
          subscribeError={playersError}
          canManage={isMember}
          tournamentState={data.state}
        />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ストラクチャ snapshot</CardTitle>
          <CardDescription>
            トーナメント作成時にコピー。以降の structures
            側の編集はこのトーナメントには影響しません。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="px-2 py-1">Lv</th>
                  <th className="px-2 py-1">SB</th>
                  <th className="px-2 py-1">BB</th>
                  <th className="px-2 py-1">Ante</th>
                  <th className="px-2 py-1">分</th>
                </tr>
              </thead>
              <tbody>
                {data.structureSnapshot.levels.map((l) => (
                  <tr key={l.level} className="border-b">
                    <td className="px-2 py-1 font-mono">{l.level}</td>
                    <td className="px-2 py-1">{l.sb}</td>
                    <td className="px-2 py-1">{l.bb}</td>
                    <td className="px-2 py-1">{l.ante}</td>
                    <td className="px-2 py-1">{Math.round(l.durationSec / 60)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

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
