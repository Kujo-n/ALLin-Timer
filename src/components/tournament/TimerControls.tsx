"use client";

import { Maximize, Minimize } from "lucide-react";
import { useState } from "react";

import { ConnectionBadge } from "@/components/tournament/ConnectionBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { finishTournament } from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { isFinished, isSeating, isSetup } from "@/lib/services/tournament-state";

import { TimerControlsFinished } from "./_timer-controls/TimerControlsFinished";
import { TimerControlsRunningPaused } from "./_timer-controls/TimerControlsRunningPaused";
import { TimerControlsSeating } from "./_timer-controls/TimerControlsSeating";
import { TimerControlsSetup } from "./_timer-controls/TimerControlsSetup";
import type { RunOp, TimerOp } from "./_timer-controls/types";

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
  /**
   * Phase 4.14 追加要望: 全画面表示トグルをサウンドアイコンの左横に配置するため、
   * dashboard が保持する fullscreen 状態をアイコン化して持ち込む。undefined の場合は
   * 表示しない（/live など fullscreen ボタンを出さないコンテキスト用）。
   */
  fullscreen?: {
    isFullscreen: boolean;
    onToggle: () => void;
  };
  /**
   * Phase 4.14 追加要望: 「同期中」ConnectionBadge を全画面アイコンの左に配置する。
   * undefined の場合は表示しない。
   */
  connection?: {
    fromCache: boolean;
    lastSyncAt: number | null;
  };
  onError?: (message: string) => void;
}

/**
 * TimerControls — tournament.state ごとに 4 つの sub-component を出し分ける親 component。
 *
 * Phase 4 architect-refactor (P5-3) で 365 行の縦積み state branch を以下に分割:
 *  - TimerControlsSetup / Seating / RunningPaused / Finished
 *
 * 親はここで:
 *  - busy state (Op | null) と run() ヘルパーを 1 か所に集約
 *  - 共通 chrome（fullscreen / connection / audio）の JSX を構築
 *  - 終了確認 Dialog を 1 か所に置く（Radix portal で常時 mount）
 */
export function TimerControls({
  tid,
  uid,
  userGroupIds,
  tournament,
  players,
  audio,
  fullscreen,
  connection,
  onError,
}: Props) {
  const [busy, setBusy] = useState<TimerOp | null>(null);
  const [finishConfirmOpen, setFinishConfirmOpen] = useState(false);

  const run: RunOp = async (op, fn, errMsg) => {
    if (busy !== null) return;
    setBusy(op);
    try {
      await fn();
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", errMsg);
      logger.warn(wrapped.message, { code: wrapped.code, tid, op });
      onError?.(formatErrorForDisplay(wrapped));
    } finally {
      setBusy(null);
    }
  };

  // 共通: 全画面表示トグル（アイコンのみ）。fullscreen prop が未指定なら描画しない。
  const fullscreenButton = fullscreen ? (
    <Button
      variant="outline"
      className="h-10 w-10 p-0"
      aria-label={fullscreen.isFullscreen ? "全画面表示を解除" : "全画面表示"}
      onClick={fullscreen.onToggle}
    >
      {fullscreen.isFullscreen ? (
        <Minimize aria-hidden className="h-5 w-5" />
      ) : (
        <Maximize aria-hidden className="h-5 w-5" />
      )}
    </Button>
  ) : null;

  // 共通: 「同期中」バッジ。connection 未指定の場合は表示しない。
  // running/paused では「再生アイコンをタイマー中央に揃える」ため横幅を抑える 2 行
  // (stacked) レイアウトに切り替える。
  const connectionBadge = connection ? (
    <ConnectionBadge
      fromCache={connection.fromCache}
      lastSyncAt={connection.lastSyncAt}
      layout="stacked"
    />
  ) : null;

  function renderForState() {
    if (isSetup(tournament)) {
      return (
        <TimerControlsSetup
          tid={tid}
          uid={uid}
          userGroupIds={userGroupIds}
          players={players}
          busy={busy}
          run={run}
          connectionBadge={connectionBadge}
          fullscreenButton={fullscreenButton}
        />
      );
    }
    if (isSeating(tournament)) {
      return (
        <TimerControlsSeating
          tid={tid}
          uid={uid}
          userGroupIds={userGroupIds}
          players={players}
          busy={busy}
          run={run}
          connectionBadge={connectionBadge}
          fullscreenButton={fullscreenButton}
        />
      );
    }
    if (isFinished(tournament)) {
      return (
        <TimerControlsFinished
          connectionBadge={connectionBadge}
          fullscreenButton={fullscreenButton}
        />
      );
    }
    // running / paused
    return (
      <TimerControlsRunningPaused
        tid={tid}
        uid={uid}
        userGroupIds={userGroupIds}
        tournament={tournament}
        busy={busy}
        run={run}
        setFinishConfirmOpen={setFinishConfirmOpen}
        connectionBadge={connectionBadge}
        fullscreenButton={fullscreenButton}
        audio={audio}
      />
    );
  }

  return (
    <>
      {renderForState()}

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
    </>
  );
}
