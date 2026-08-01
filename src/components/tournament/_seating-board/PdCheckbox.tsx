"use client";

import { AppError, formatErrorForDisplay } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { logger } from "@/lib/logger";

export interface PdCheckboxProps {
  player: PlayerDoc;
  isPd: boolean;
  disabled: boolean;
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Phase 5.1: 各席の PD（プレイングディーラー）トグル。
 * 1 卓 1 PD 制約のため、同卓に他 PD が立っていれば自席以外は `disabled` で渡される。
 *
 * architect-refactor 20260801 (finding-7) で SeatingBoard.tsx から分離。
 * DOM 構造・aria 属性・class は移動前と完全に同一。
 */
export function PdCheckbox({
  player,
  isPd,
  disabled,
  onTogglePd,
  onError,
}: PdCheckboxProps) {
  return (
    <label
      className="inline-flex items-center gap-1 text-[10px] text-muted-foreground"
      // checkbox 領域では drag が始まらないように pointer event を吸収。
      // @dnd-kit は activationConstraint distance:8 で短い操作は drag にしないが、
      // 念のため stopPropagation で listener を遮断しておく。
      onPointerDown={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={isPd}
        disabled={disabled}
        onChange={(e) => {
          if (!onTogglePd) return;
          void onTogglePd(player, e.target.checked).catch((err) => {
            const wrapped = AppError.from(
              err,
              "firestore/write_failed",
              "PD 設定に失敗しました",
            );
            logger.warn(wrapped.message, {
              code: wrapped.code,
              pid: player.id,
            });
            onError?.(formatErrorForDisplay(wrapped));
          });
        }}
        aria-label={`pd-${player.displayName}`}
      />
      <span>PD</span>
    </label>
  );
}
