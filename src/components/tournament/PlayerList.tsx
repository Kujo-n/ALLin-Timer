"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";

import { BustButton } from "@/components/tournament/BustButton";
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
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentState } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { cancelPlayerEntry } from "@/lib/services/receipt";

interface Props {
  tid: string;
  /** subscribePlayers の結果（dashboard で 1 度だけ subscribe して伝搬する）。 */
  players: PlayerDoc[];
  /** subscribe error（dashboard 側で受け取って表示するため optional に伝搬）。 */
  subscribeError?: string | null;
  /** true の場合、各プレイヤー行に「取消」ボタンを出す（運営者向け） */
  canManage?: boolean;
  /** バストボタン表示判定用。running / paused のみで出す。 */
  tournamentState: TournamentState;
}

export function PlayerList({
  tid,
  players,
  subscribeError,
  canManage = false,
  tournamentState,
}: Props) {
  // M3 fix: subscribeError を useEffect 経由で local state にコピーしない。
  // 取消エラーのみ local state で持ち、subscribe error は render 時に合成。
  const [localError, setLocalError] = useState<string | null>(null);
  const [cancelTarget, setCancelTarget] = useState<PlayerDoc | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const error = subscribeError ?? localError;

  async function onConfirmCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await cancelPlayerEntry(tid, cancelTarget.id);
      setCancelTarget(null);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "取消に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, pid: cancelTarget.id });
      setLocalError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setCancelling(false);
    }
  }

  const showBustButton =
    canManage && (tournamentState === "running" || tournamentState === "paused");

  return (
    <Card>
      <CardHeader>
        <CardTitle>参加者 ({players.length})</CardTitle>
        <CardDescription>リアルタイム同期中。</CardDescription>
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
              <li key={p.id} className="flex items-center justify-between gap-2 py-2">
                <span className="flex-1 truncate">{p.displayName}</span>
                <div className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {p.isBusted
                      ? "脱落"
                      : p.tableNum !== null && p.seatNum !== null
                        ? `Table:${p.tableNum}, No.${p.seatNum}`
                        : "エントリー中"}
                  </span>
                  {showBustButton ? (
                    <BustButton
                      tid={tid}
                      pid={p.id}
                      isBusted={p.isBusted}
                      onError={setLocalError}
                    />
                  ) : null}
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
