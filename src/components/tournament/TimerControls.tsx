"use client";

import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import { useState } from "react";

import { SoundToggleButton } from "@/components/tournament/SoundToggleButton";
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
  confirmSeating,
  finishTournament,
  pauseTournament,
  resumeTournament,
  revertLevel,
} from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { joinAsCurrentUser } from "@/lib/services/receipt";
import { commitInitialSeating } from "@/lib/services/seating/orchestrator";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  tournament: TournamentDoc;
  /** 受付済み参加者一覧（subscribePlayers の結果）。setup→seating の commitInitialSeating に渡す。 */
  players: PlayerDoc[];
  /**
   * サウンドトグルを表示するための props。tournamentGroup が確定している運営者ロールでのみ
   * 渡す。undefined のとき running/paused 用ボタン群にサウンドアイコンは出さない。
   * Phase 4.13: settingsHref を廃止し、enabled 反転を直接 group に書込む onToggleEnabled に変更。
   * 詳細設定はサイドバーの「サウンド設定」から行う。
   */
  audio?: {
    enabled: boolean;
    unlocked: boolean;
    onUnlock: () => Promise<void>;
    onToggleEnabled: (next: boolean) => Promise<void>;
  };
  onError?: (message: string) => void;
}

type Op =
  | "commit-seating"
  | "confirm-seating"
  | "self-join"
  | "pause"
  | "resume"
  | "advance"
  | "revert"
  | "finish";

export function TimerControls({
  tid,
  uid,
  userGroupIds,
  tournament,
  players,
  audio,
  onError,
}: Props) {
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
    const activeCount = players.filter((p) => !p.isBusted).length;
    const alreadyJoined = players.some((p) => p.uid === uid);
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          disabled={busy !== null || activeCount === 0}
          onClick={() =>
            void run(
              "commit-seating",
              async () => {
                const seed = Date.now();
                await commitInitialSeating(tid, uid, userGroupIds, players, seed);
              },
              "席決めに失敗",
            )
          }
        >
          {busy === "commit-seating" ? "配席中…" : "席を決定"}
        </Button>
        {!alreadyJoined ? (
          <Button
            size="sm"
            variant="outline"
            disabled={busy !== null}
            onClick={() =>
              void run(
                "self-join",
                async () => {
                  await joinAsCurrentUser({ tid });
                },
                "自己参加に失敗",
              )
            }
          >
            {busy === "self-join" ? "登録中…" : "自分も参加する"}
          </Button>
        ) : null}
        {activeCount === 0 ? (
          <span className="text-xs text-muted-foreground">参加者がいません</span>
        ) : null}
      </div>
    );
  }

  if (tournament.state === "seating") {
    const activeCount = players.filter((p) => !p.isBusted).length;
    return (
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          size="sm"
          disabled={busy !== null || activeCount === 0}
          onClick={() =>
            void run(
              "confirm-seating",
              () => confirmSeating(tid, uid, userGroupIds),
              "トーナメント開始失敗",
            )
          }
        >
          {busy === "confirm-seating" ? "開始中…" : "トーナメント開始"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy !== null}
          onClick={() =>
            void run(
              "commit-seating",
              async () => {
                const seed = Date.now();
                await commitInitialSeating(tid, uid, userGroupIds, players, seed);
              },
              "再配席に失敗",
            )
          }
        >
          {busy === "commit-seating" ? "再配席中…" : "席を再決定"}
        </Button>
      </div>
    );
  }

  if (tournament.state === "finished") {
    return (
      <div className="flex flex-wrap justify-center gap-2">
        <Button size="sm" disabled>
          終了済み
        </Button>
      </div>
    );
  }

  // running / paused
  // 順序: サウンド On/Off → 前レベル → 再生/一時停止 → 次レベル → 終了
  // ボタンはアイコン表示（aria-label でラベルを補完）。
  // 横方向はアイコン 1 個分（40px = gap-10）の間隔をあけて誤タップを防ぐ。
  // 縦方向（折り返し時）は gap-y-3 で詰めて占有面積を抑える。
  const iconBtnCls = "h-10 w-10 p-0";
  const isRunning = tournament.state === "running";
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3">
      {audio ? (
        <SoundToggleButton
          enabled={audio.enabled}
          unlocked={audio.unlocked}
          onUnlock={audio.onUnlock}
          onToggleEnabled={audio.onToggleEnabled}
        />
      ) : null}

      <Button
        variant="outline"
        className={iconBtnCls}
        aria-label="前レベル"
        disabled={busy !== null || isFirst}
        onClick={() =>
          void run("revert", () => revertLevel(tid, uid, userGroupIds), "巻き戻し失敗")
        }
      >
        <SkipBack aria-hidden className="h-5 w-5" />
      </Button>

      {isRunning ? (
        <Button
          variant="secondary"
          className={iconBtnCls}
          aria-label="一時停止"
          disabled={busy !== null}
          onClick={() =>
            void run("pause", () => pauseTournament(tid, uid, userGroupIds), "一時停止失敗")
          }
        >
          <Pause aria-hidden className="h-5 w-5" />
        </Button>
      ) : (
        <Button
          className={iconBtnCls}
          aria-label="再開"
          disabled={busy !== null}
          onClick={() =>
            void run("resume", () => resumeTournament(tid, uid, userGroupIds), "再開失敗")
          }
        >
          <Play aria-hidden className="h-5 w-5" />
        </Button>
      )}

      <Button
        variant="outline"
        className={iconBtnCls}
        aria-label="次レベル"
        disabled={busy !== null || isLast}
        onClick={() => void run("advance", () => advanceLevel(tid, uid, userGroupIds), "進行失敗")}
      >
        <SkipForward aria-hidden className="h-5 w-5" />
      </Button>

      <Button
        variant="destructive"
        className={iconBtnCls}
        aria-label="終了"
        disabled={busy !== null}
        onClick={() => setFinishConfirmOpen(true)}
      >
        <Square aria-hidden className="h-5 w-5" />
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
