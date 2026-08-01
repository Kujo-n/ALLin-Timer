"use client";

import { useDraggable, useDroppable } from "@dnd-kit/core";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { cn } from "@/lib/utils";

import { PdCheckbox } from "./PdCheckbox";

export interface DnDSeatProps {
  tableNum: number;
  seatNum: number;
  player: PlayerDoc | undefined;
  isMe: boolean;
  isPd: boolean;
  showPd: boolean;
  checkboxDisabled: boolean;
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  onError?: (message: string) => void;
  tableBroken: boolean;
  isDragSource: boolean;
  isDropTarget: boolean;
}

/**
 * Phase 5.x: D&D 有効時の席行。droppable（行全体）と draggable（名前部分のみ）を持つ。
 * drag handle を名前部分に限定することで、PD checkbox の誤操作を防ぐ。
 *
 * architect-refactor 20260801 (finding-7) で SeatingBoard.tsx から分離。
 * DOM 構造・aria 属性・class は移動前と完全に同一。
 */
export function DnDSeat({
  tableNum,
  seatNum,
  player,
  isMe,
  isPd,
  showPd,
  checkboxDisabled,
  onTogglePd,
  onError,
  tableBroken,
  isDragSource,
  isDropTarget,
}: DnDSeatProps) {
  const dropId = `table-${tableNum}-seat-${seatNum}`;
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    disabled: !isDropTarget,
  });
  // 空席行も draggable hook を呼んで hooks rules 違反を回避。disabled で no-op。
  const dragId = player?.id ?? `_empty_${dropId}`;
  const {
    attributes,
    listeners,
    setNodeRef: setDragRef,
    transform,
    isDragging,
  } = useDraggable({ id: dragId, disabled: !isDragSource });

  const dragStyle: React.CSSProperties | undefined = transform
    ? {
        transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        zIndex: 50,
      }
    : undefined;

  return (
    <li
      ref={setDropRef}
      className={cn(
        "flex items-center gap-2 rounded transition-colors",
        isOver &&
          isDropTarget &&
          "bg-blue-100 ring-2 ring-blue-400 dark:bg-blue-950/40",
        isDragging && "opacity-50",
      )}
      aria-label={
        !player && isDropTarget
          ? `droppable-${tableNum}-${seatNum}`
          : undefined
      }
    >
      <span className="w-6 text-muted-foreground">{seatNum}:</span>
      {player ? (
        <span
          ref={isDragSource ? setDragRef : undefined}
          {...(isDragSource ? attributes : {})}
          {...(isDragSource ? listeners : {})}
          style={isDragSource ? dragStyle : undefined}
          className={cn(
            "flex-1 truncate",
            isMe && "font-bold",
            isDragSource && "cursor-grab select-none touch-none",
          )}
          aria-label={
            isDragSource ? `drag-${player.displayName}` : undefined
          }
        >
          {player.displayName}
        </span>
      ) : (
        <span className="flex-1 truncate text-muted-foreground">—</span>
      )}
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
