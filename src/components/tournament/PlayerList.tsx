"use client";

import { Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

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
import { listPlayers } from "@/lib/firebase/repositories/players";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { logger } from "@/lib/logger";
import { cancelPlayerEntry } from "@/lib/services/receipt";

interface Props {
  tid: string;
  /** true の場合、各プレイヤー行に「取消」ボタンを出す（運営者向け） */
  canManage?: boolean;
}

export function PlayerList({ tid, canManage = false }: Props) {
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PlayerDoc | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await listPlayers(tid);
      setPlayers(list);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "参加者取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setLoading(false);
    }
  }, [tid]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onConfirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelPlayerEntry(tid, cancelTarget.id);
      setCancelTarget(null);
      await reload();
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "取消に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setCancelling(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>参加者 ({players.length})</CardTitle>
          <CardDescription>Phase 2 は手動リロード。Phase 3 でリアルタイム同期。</CardDescription>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            void reload();
          }}
          disabled={loading}
        >
          {loading ? "読込中…" : "リロード"}
        </Button>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : players.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            まだ参加者がいません。受付 URL を共有してください。
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {players.map((p) => (
              <li key={p.id} className="flex items-center justify-between py-2">
                <span>{p.displayName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground">
                    {p.isBusted ? "脱落" : "エントリー中"}
                  </span>
                  {canManage ? (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`cancel-${p.displayName}`}
                      onClick={() => setCancelTarget(p)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>エントリーを取り消す</DialogTitle>
            <DialogDescription>
              「{cancelTarget?.displayName}」の参加を取り消します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCancelTarget(null)} disabled={cancelling}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onConfirmCancel();
              }}
              disabled={cancelling}
            >
              {cancelling ? "処理中…" : "取消"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
