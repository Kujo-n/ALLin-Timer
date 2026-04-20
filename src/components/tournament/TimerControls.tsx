"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError } from "@/lib/errors";
import {
  advanceLevel,
  finishTournament,
  pauseTournament,
  resumeTournament,
  revertLevel,
  startTournament,
} from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  tournament: TournamentDoc;
  onError?: (message: string) => void;
}

type Op = "start" | "pause" | "resume" | "advance" | "revert" | "finish";

export function TimerControls({ tid, uid, userGroupIds, tournament, onError }: Props) {
  const [busy, setBusy] = useState<Op | null>(null);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);

  async function run(op: Op, fn: () => Promise<void>, errMsg: string) {
    if (busy !== null) return;
    setBusy(op);
    try {
      await fn();
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", errMsg);
      logger.warn(wrapped.message, { code: wrapped.code, tid, op });
      onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setBusy(null);
    }
  }

  const isLast = tournament.currentLevel >= tournament.structureSnapshot.levels.length;
  const isFirst = tournament.currentLevel <= 1;

  if (tournament.state === "setup") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void run("start", () => startTournament(tid, uid, userGroupIds), "開始失敗")
          }
        >
          {busy === "start" ? "開始中…" : "開始"}
        </Button>
      </div>
    );
  }

  if (tournament.state === "finished") {
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled>
          終了済み
        </Button>
      </div>
    );
  }

  // running / paused / seating
  return (
    <div className="flex flex-wrap gap-2">
      {tournament.state === "running" ? (
        <Button
          size="sm"
          variant="secondary"
          disabled={busy !== null}
          onClick={() =>
            void run("pause", () => pauseTournament(tid, uid, userGroupIds), "一時停止失敗")
          }
        >
          {busy === "pause" ? "処理中…" : "一時停止"}
        </Button>
      ) : tournament.state === "paused" ? (
        <Button
          size="sm"
          disabled={busy !== null}
          onClick={() =>
            void run("resume", () => resumeTournament(tid, uid, userGroupIds), "再開失敗")
          }
        >
          {busy === "resume" ? "処理中…" : "再開"}
        </Button>
      ) : null}

      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null || isFirst}
        onClick={() =>
          void run("revert", () => revertLevel(tid, uid, userGroupIds), "巻き戻し失敗")
        }
      >
        {busy === "revert" ? "処理中…" : "◀ 前レベル"}
      </Button>

      <Button
        size="sm"
        variant="outline"
        disabled={busy !== null || isLast}
        onClick={() => void run("advance", () => advanceLevel(tid, uid, userGroupIds), "進行失敗")}
      >
        {busy === "advance" ? "処理中…" : "次レベル ▶"}
      </Button>

      <Button
        size="sm"
        variant="destructive"
        disabled={busy !== null}
        onClick={() => setFinishConfirmOpen(true)}
      >
        {busy === "finish" ? "処理中…" : "終了"}
      </Button>

      <Dialog open={finishConfirmOpen} onOpenChange={setFinishConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>トーナメントを終了</DialogTitle>
            <DialogDescription>
              「{tournament.name}」を終了します。終了後はタイマーが停止し、再開できません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setFinishConfirmOpen(false)}
              disabled={busy === "finish"}
            >
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setFinishConfirmOpen(false);
                void run("finish", () => finishTournament(tid, uid, userGroupIds), "終了失敗");
              }}
              disabled={busy === "finish"}
            >
              {busy === "finish" ? "処理中…" : "終了する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
