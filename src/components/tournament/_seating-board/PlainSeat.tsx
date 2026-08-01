"use client";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { cn } from "@/lib/utils";

import { PdCheckbox } from "./PdCheckbox";

export interface PlainSeatProps {
  seatNum: number;
  player: PlayerDoc | undefined;
  isMe: boolean;
  isPd: boolean;
  showPd: boolean;
  checkboxDisabled: boolean;
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  onError?: (message: string) => void;
  tableBroken: boolean;
}

/**
 * D&D 無効時（閲覧のみ / 権限なし）の席行。@dnd-kit の hook を一切呼ばない軽量版。
 *
 * architect-refactor 20260801 (finding-7) で SeatingBoard.tsx から分離。
 * DOM 構造・aria 属性・class は移動前と完全に同一。
 */
export function PlainSeat({
  seatNum,
  player,
  isMe,
  isPd,
  showPd,
  checkboxDisabled,
  onTogglePd,
  onError,
  tableBroken,
}: PlainSeatProps) {
  return (
    <li className="flex items-center gap-2">
      <span className="w-6 text-muted-foreground">{seatNum}:</span>
      <span className={cn("flex-1 truncate", isMe && "font-bold")}>
        {player ? player.displayName : "—"}
      </span>
      {isMe ? <span aria-label="self">★</span> : null}
      {isPd ? <span aria-label="pd-badge">◎</span> : null}
      {showPd && player && !player.isBusted && !tableBroken ? (
        <PdCheckbox
          player={player}
          isPd={isPd}
          disabled={checkboxDisabled}
          onTogglePd={onTogglePd}
          onError={onError}
        />
      ) : null}
    </li>
  );
}
