"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { QrPanel } from "@/components/qr/QrPanel";
import { PlayerList } from "@/components/tournament/PlayerList";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import {
  deleteTournamentIfSetup,
  getTournament,
  startTournament,
} from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

export function DashboardClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const [data, setData] = useState<TournamentDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [startOpen, setStartOpen] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournament(tid);
        if (!cancelled) setData(t);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tid]);

  async function onDelete() {
    if (!user) return;
    try {
      await deleteTournamentIfSetup(tid, user.uid);
      router.push("/tournaments");
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "削除失敗");
      setError(`${wrapped.code}: ${wrapped.message}`);
      setConfirmOpen(false);
    }
  }

  async function onStart() {
    if (!user) return;
    setStarting(true);
    try {
      await startTournament(tid, user.uid);
      const next = await getTournament(tid);
      setData(next);
      setStartOpen(false);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "開始失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
      setStartOpen(false);
    } finally {
      setStarting(false);
    }
  }

  if (error) {
    return (
      <main className="mx-auto max-w-4xl p-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      </main>
    );
  }

  if (!data || !user) {
    return (
      <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">
        読込中…
      </main>
    );
  }

  const isOwner = data.ownerUid === user.uid;
  const canEdit = isOwner && data.state === "setup";

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{data.name}</h1>
            <span className="rounded bg-muted px-2 py-0.5 text-xs">
              {data.state}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            現在 Lv{data.currentLevel} / 締切 Lv{data.lateEntryDeadlineLevel}{" "}
            / {data.structureSnapshot.levels.length} レベル
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/tournaments">
            <Button variant="outline" size="sm">
              一覧へ戻る
            </Button>
          </Link>
          {canEdit ? (
            <>
              <Button size="sm" onClick={() => setStartOpen(true)}>
                開始
              </Button>
              <Link href={`/tournaments/${tid}/edit`}>
                <Button variant="outline" size="sm">
                  編集
                </Button>
              </Link>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => setConfirmOpen(true)}
              >
                削除
              </Button>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid gap-6 md:grid-cols-2">
        <QrPanel tid={tid} />
        <PlayerList tid={tid} canManage={isOwner} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ストラクチャ snapshot</CardTitle>
          <CardDescription>
            トーナメント作成時にコピー。以降の structures 側の編集はこのトーナメントには影響しません。
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

      <Dialog open={startOpen} onOpenChange={setStartOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トーナメントを開始</DialogTitle>
            <DialogDescription>
              「{data.name}」を開始します。開始すると編集／削除ができなくなります。
              現バージョンではタイマーやレベル自動繰り上げは未実装（Phase 3
              で追加予定）。Level 1 から手動進行になります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setStartOpen(false)}
              disabled={starting}
            >
              キャンセル
            </Button>
            <Button
              onClick={() => {
                void onStart();
              }}
              disabled={starting}
            >
              {starting ? "開始中…" : "開始する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
