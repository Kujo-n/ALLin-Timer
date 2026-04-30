"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { joinAsCurrentUser } from "@/lib/services/receipt";
import { commitInitialSeating } from "@/lib/services/seating/orchestrator";

import type { RunOp, TimerOp } from "./types";

interface Props {
  tid: string;
  uid: string;
  userGroupIds: string[];
  players: PlayerDoc[];
  /** 親が握る busy state（`Op` か null）。 */
  busy: TimerOp | null;
  /** 親が握る `run()` ヘルパー。 */
  run: RunOp;
  /** 共通 chrome（同期中バッジ / 全画面ボタン）。 */
  connectionBadge: ReactNode;
  fullscreenButton: ReactNode;
}

/**
 * setup state（受付中）の TimerControls。
 *  - 「席を決定」（commitInitialSeating）
 *  - 「自分も参加する」（運営者の自己エントリー、Phase 4.5）
 */
export function TimerControlsSetup({
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
  const alreadyJoined = players.some((p) => p.uid === uid);
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {connectionBadge}
      {fullscreenButton}
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
