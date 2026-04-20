"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { QrPanel } from "@/components/qr/QrPanel";
import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { PlayerList } from "@/components/tournament/PlayerList";
import { TimerControls } from "@/components/tournament/TimerControls";
import { TimerDisplay } from "@/components/tournament/TimerDisplay";
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
import { deleteTournamentIfSetup } from "@/lib/firebase/repositories/tournaments";
import { useTournamentTimer } from "@/lib/hooks/useTournamentTimer";
import { logger } from "@/lib/logger";
import { getLevelInfo } from "@/lib/services/timer";
import { useCurrentGroup } from "@/lib/services/current-group";

export function DashboardClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groupIds } = useCurrentGroup();
  const canManage = !!user && groupIds.length > 0;

  const {
    tournament: data,
    remainingMs,
    fromCache,
    lastSyncAt,
    error: timerError,
  } = useTournamentTimer(tid, {
    autoAdvance: canManage && user ? { uid: user.uid, userGroupIds: groupIds } : undefined,
  });

  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

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
  const showTimer = data.state !== "setup";
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
            {data.structureSnapshot.levels.length} レベル
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

      {showTimer ? (
        <TimerDisplay tournament={data} remainingMs={remainingMs} levelInfo={levelInfo} />
      ) : null}

      {isMember ? (
        <TimerControls
          tid={tid}
          uid={user.uid}
          userGroupIds={groupIds}
          tournament={data}
          onError={setError}
        />
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <QrPanel tid={tid} />
        <PlayerList tid={tid} canManage={isMember} />
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
