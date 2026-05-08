"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { resumeAudioContext } from "@/lib/audio/audio-context";
import { confirmSeating } from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { commitInitialSeating } from "@/lib/services/seating/orchestrator";

import type { RunOp, TimerOp } from "./types";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  players: PlayerDoc[];
  busy: TimerOp | null;
  run: RunOp;
  connectionBadge: ReactNode;
  fullscreenButton: ReactNode;
}

/**
 * seating state（席決め確定前）の TimerControls。
 *  - 「トーナメント開始」（confirmSeating）でタイマー起動
 *  - 「席を再決定」（commitInitialSeating）で再シャッフル
 */
export function TimerControlsSeating({
  tid,
  uid,
  userGroupIds,
  players,
  busy,
  run,
  connectionBadge,
  fullscreenButton,
}: Props) {
  const activeCount = players.filter((p) => !p.isBusted).length;
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {connectionBadge}
      {fullscreenButton}
      <Button
        size="sm"
        disabled={busy !== null || activeCount === 0}
        onClick={() =>
          void run(
            "confirm-seating",
            async () => {
              // Phase C: 開始ボタンの user gesture と同 click 経路で AudioContext を
              // resume する。autoplay policy 起因で開始直後のブラインドアップ音が
              // 鳴らない事象を回避する。失敗は audio-context.ts 側で wrap 済みなので
              // ここでは握り潰し（既存 SoundUnlockBanner / SoundToggleButton が fallback）。
              await resumeAudioContext().catch(() => undefined);
              await confirmSeating(tid, uid, userGroupIds);
            },
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
