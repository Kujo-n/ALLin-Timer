"use client";

import { Pause, Play, SkipBack, SkipForward, Square } from "lucide-react";
import type { ReactNode } from "react";

import { SoundToggleButton } from "@/components/tournament/SoundToggleButton";
import { Button } from "@/components/ui/button";
import { resumeAudioContext } from "@/lib/audio/audio-context";
import {
  advanceLevel,
  pauseTournament,
  resumeTournament,
  revertLevel,
} from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { canAdvanceLevel, canRevertLevel, isRunning } from "@/lib/services/tournament-state";

import type { RunOp, TimerOp } from "./types";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  tournament: TournamentDoc;
  busy: TimerOp | null;
  run: RunOp;
  /** 親が握る dialog open setter（「終了」ボタン → 確認 dialog）。 */
  setFinishConfirmOpen: (open: boolean) => void;
  /** 共通 chrome（同期中バッジ / 全画面ボタン / サウンドトグル）。 */
  connectionBadge: ReactNode;
  fullscreenButton: ReactNode;
  audio?: {
    enabled: boolean;
    unlocked: boolean;
    onUnlock: () => Promise<void>;
    onToggleEnabled: (next: boolean) => Promise<void>;
  };
}

/**
 * running / paused state の TimerControls。
 *
 * Phase 4.14 追加要望（Phase 4.18 で layout を再構築）:
 *   - 再生 / 一時停止アイコンを TimerDisplay の中央と水平に揃える。中央群
 *     [サウンド, 前, 再生/停止, 次, 終了] を内側 flex で `justify-center` 配置し、
 *     再生アイコン（5 つの中央 = 3 つ目）が視覚中心に来る。
 *   - sm+ では外側を `[1fr_auto_1fr]` の grid とし、左 1fr に全画面アイコン /
 *     中 auto に中央群 / 右 1fr に同期中バッジを並べる。auto 列が左右対称な 1fr に
 *     挟まれるため、全画面 / バッジの有無に依らず再生/停止が grid 全体の中心に揃う。
 *   - 旧実装は `sm:absolute sm:left-0 / sm:right-0` だったが、dashboard の中央列幅
 *     (約 512px) では同期中バッジが「終了」ボタンの上に重なり click を intercept する
 *     リグレッションが発生していた。grid に切替えて空間配分で重なりを排除した。
 *   - 狭幅 (<sm) は外側 flex flex-wrap で各群が折り返す。中央群内部も flex-wrap。
 *
 * ボタンはアイコン表示（aria-label でラベルを補完）。横方向は gap-10 (40px) の
 * 間隔で誤タップを防ぐ。縦方向（折り返し時）は gap-y-3 で詰める。
 */
export function TimerControlsRunningPaused({
  tid,
  uid,
  userGroupIds,
  tournament,
  busy,
  run,
  setFinishConfirmOpen,
  connectionBadge,
  fullscreenButton,
  audio,
}: Props) {
  const iconBtnCls = "h-10 w-10 p-0";
  const isLast = !canAdvanceLevel(tournament);
  const isFirst = !canRevertLevel(tournament);
  return (
    <div className="flex flex-wrap items-center justify-center gap-x-10 gap-y-3 sm:grid sm:grid-cols-[1fr_auto_1fr] sm:gap-3">
      {fullscreenButton ? (
        <div className="flex items-center sm:justify-self-start">{fullscreenButton}</div>
      ) : (
        <div className="hidden sm:block" aria-hidden="true" />
      )}

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

        {isRunning(tournament) ? (
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
              void run(
                "resume",
                async () => {
                  // Phase C: 再開ボタン押下と同 user gesture で AudioContext を resume。
                  // 次回 auto-advance のブラインドアップ音が autoplay policy で
                  // suppress されないようにする。失敗は warn 済 / fallback ありで握る。
                  await resumeAudioContext().catch(() => undefined);
                  await resumeTournament(tid, uid, userGroupIds);
                },
                "再開失敗",
              )
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
      </div>

      {connectionBadge ? (
        <div className="flex items-center sm:justify-self-end">{connectionBadge}</div>
      ) : (
        <div className="hidden sm:block" aria-hidden="true" />
      )}
    </div>
  );
}
