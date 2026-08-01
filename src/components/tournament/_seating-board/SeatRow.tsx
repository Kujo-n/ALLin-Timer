"use client";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";

import { DnDSeat } from "./DnDSeat";
import { PlainSeat } from "./PlainSeat";

export interface SeatRowProps {
  table: TableDoc;
  seatNum: number;
  player: PlayerDoc | undefined;
  currentUid: string | null;
  tablePd: PlayerDoc | undefined;
  showPd: boolean;
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  onError?: (message: string) => void;
  enableDnd: boolean;
  dndBusy: boolean;
  draggedPlayer: PlayerDoc | null;
}

/**
 * 1 席分の行。D&D の可否（drag source / drop target）を判定し、
 * `PlainSeat`（D&D 無効）と `DnDSeat`（D&D 有効）に振り分ける。
 *
 * architect-refactor 20260801 (finding-7) で SeatingBoard.tsx から分離。
 * 判定ロジック・DOM・aria 属性は移動前と完全に同一。
 */
export function SeatRow({
  table,
  seatNum,
  player,
  currentUid,
  tablePd,
  showPd,
  onTogglePd,
  onError,
  enableDnd,
  dndBusy,
  draggedPlayer,
}: SeatRowProps) {
  const isOccupied = !!player;
  const isMe =
    isOccupied && currentUid !== null && player!.uid === currentUid;
  const isPd = player?.isPlayingDealer ?? false;
  const checkboxDisabled = !!tablePd && !isPd && !table.isBroken;

  const isOwnSeat = isOccupied && draggedPlayer?.id === player!.id;
  const isSameTableDrag =
    draggedPlayer !== null && draggedPlayer.tableNum === table.tableNum;

  // Drop target conditions:
  //   - DnD enabled
  //   - 卓は閉鎖されていない
  //   - 自席（drag source 自身）ではない
  //   - PD ではない（cascade で PD を弾き飛ばさない）
  //   - 空席 OR 同卓 drag 中の他占有席（cascade target）
  const isDropTarget =
    enableDnd &&
    !table.isBroken &&
    !isOwnSeat &&
    !isPd &&
    (!isOccupied || isSameTableDrag);

  // Drag source: 占有 + 非 PD + 非 busted + 非閉鎖卓。busy 中は disabled。
  const isDragSource =
    enableDnd &&
    !dndBusy &&
    isOccupied &&
    !isPd &&
    !player!.isBusted &&
    !table.isBroken;

  if (!enableDnd) {
    return (
      <PlainSeat
        seatNum={seatNum}
        player={player}
        isMe={isMe}
        isPd={isPd}
        showPd={showPd}
        checkboxDisabled={checkboxDisabled}
        onTogglePd={onTogglePd}
        onError={onError}
        tableBroken={table.isBroken}
      />
    );
  }

  return (
    <DnDSeat
      tableNum={table.tableNum}
      seatNum={seatNum}
      player={player}
      isMe={isMe}
      isPd={isPd}
      showPd={showPd}
      checkboxDisabled={checkboxDisabled}
      onTogglePd={onTogglePd}
      onError={onError}
      tableBroken={table.isBroken}
      isDragSource={isDragSource}
      isDropTarget={isDropTarget}
    />
  );
}
