"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

interface Props {
  players: PlayerDoc[];
  tables: TableDoc[];
  seatsPerTable: number;
  /** 自分の uid。一致する席に ★ を付与（運営兼任プレイヤー向け）。 */
  currentUid?: string | null;
  /**
   * Phase 5.1: 各席の PD checkbox トグル handler。canManage=true（運営者かつ
   * seating/running/paused 中）のときのみ render される。
   */
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  /** PD checkbox を有効にするか（運営者ロール + state 判定の組み合わせ）。 */
  canManage?: boolean;
  /** PD 操作のエラー表示用 hook。 */
  onError?: (message: string) => void;
  /**
   * Phase 5.x: D&D による手動席移動 handler。canManage=true かつ本 prop が non-null のとき
   * 非 PD・非 busted・非閉鎖卓の player chip が draggable になる。
   * drop 先は: 空席 / 同卓内の他占有席（cascade target）/ 他卓の空席。
   */
  onMoveSeat?: (
    player: PlayerDoc,
    to: { tableNum: number; seatNum: number },
  ) => Promise<void>;
  /** D&D 中（直前の move 進行中）は次の drag を抑止するための flag。 */
  dndBusy?: boolean;
}

/**
 * Phase 4: 卓ごとの席カードを並べる運営者ビュー。
 * - 卓は tableNum 昇順
 * - 各席は 1..seatsPerTable で順番表示、空席は `—`
 * - 自分の uid に一致する席は ★
 * - isBroken=true の卓は薄く + 「閉鎖」バッジ
 *
 * Phase 5.1: 各席に PD checkbox。1 卓 1 PD 制約のため、同卓に他 PD が立っていれば
 * 自席以外の checkbox は disabled。busted player は checkbox を出さない。
 *
 * Phase 5.x: 運営者向け D&D 席変更を導入。`onMoveSeat` 経由で 1 件 / cascade move を発火する。
 *  - 非 PD・非 busted・非閉鎖卓の player chip の名前部分が drag handle（PD checkbox は
 *    drag listener 外に配置して誤操作を防ぐ）
 *  - drop target:
 *    - 空席（非閉鎖卓）→ 単純 1 件 move
 *    - 同卓 drag 中の他占有席（非 PD）→ cascade（target → source 方向に shift）
 *    - 卓間 drag は空席のみ受け付け（cascade across tables 非対応）
 */
export function SeatingBoard({
  players,
  tables,
  seatsPerTable,
  currentUid,
  onTogglePd,
  canManage = false,
  onError,
  onMoveSeat,
  dndBusy = false,
}: Props) {
  const seatedByTable = useMemo(() => {
    const map = new Map<number, PlayerDoc[]>();
    for (const p of players) {
      if (p.isBusted) continue;
      if (p.tableNum === null) continue;
      const arr = map.get(p.tableNum) ?? [];
      arr.push(p);
      map.set(p.tableNum, arr);
    }
    return map;
  }, [players]);

  const sortedTables = useMemo(
    () => [...tables].sort((a, b) => a.tableNum - b.tableNum),
    [tables],
  );

  // PointerSensor: マウス + 一般 pen device。activationConstraint で 8px 以上の
  // 動きを drag start とみなす（PD checkbox の click 等が誤って drag に化けないよう）。
  // TouchSensor: スマホ / タブレット用。長押し 200ms + 5px 移動許容で開始。
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 5 },
    }),
  );

  const enableDnd = canManage && !!onMoveSeat;

  // 進行中の drag の active id を保持。SeatRow が「同卓 drag 中なら他占有席も droppable」を
  // 判定するために使う。drag 終了 / cancel で null に戻す。
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const draggedPlayer = useMemo(
    () =>
      activeDragId
        ? (players.find((p) => p.id === activeDragId) ?? null)
        : null,
    [activeDragId, players],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveDragId(String(event.active.id));
  }, []);
  const handleDragCancel = useCallback(() => {
    setActiveDragId(null);
  }, []);
  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveDragId(null);
      const { active, over } = event;
      if (!over) return;
      const playerId = String(active.id);
      const overId = String(over.id);
      const m = overId.match(/^table-(\d+)-seat-(\d+)$/);
      if (!m) return;
      const tableNum = Number(m[1]);
      const seatNum = Number(m[2]);
      const player = players.find((p) => p.id === playerId);
      if (!player) return;
      if (player.tableNum === tableNum && player.seatNum === seatNum) return;
      void onMoveSeat?.(player, { tableNum, seatNum });
    },
    [players, onMoveSeat],
  );

  if (sortedTables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        テーブルがまだありません（席決め前）。
      </p>
    );
  }

  const showPd = canManage && !!onTogglePd;

  const board = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sortedTables.map((table) => {
        const tableSeated = seatedByTable.get(table.tableNum) ?? [];
        const seatMap = new Map<number, PlayerDoc>();
        for (const p of tableSeated) {
          if (p.seatNum !== null) seatMap.set(p.seatNum, p);
        }
        const tablePd = tableSeated.find((p) => p.isPlayingDealer);
        return (
          <Card
            key={table.id}
            className={cn(table.isBroken && "opacity-60")}
            aria-label={`table-${table.tableNum}`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>
                  Table {table.tableNum}（{tableSeated.length} 人）
                </span>
                {table.isBroken ? (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">閉鎖</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs font-mono">
                {Array.from({ length: seatsPerTable }, (_, i) => i + 1).map(
                  (seatNum) => (
                    <SeatRow
                      key={seatNum}
                      table={table}
                      seatNum={seatNum}
                      player={seatMap.get(seatNum)}
                      currentUid={currentUid ?? null}
                      tablePd={tablePd}
                      showPd={showPd}
                      onTogglePd={onTogglePd}
                      onError={onError}
                      enableDnd={enableDnd}
                      dndBusy={dndBusy}
                      draggedPlayer={draggedPlayer}
                    />
                  ),
                )}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );

  if (!enableDnd) return board;
  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      {board}
    </DndContext>
  );
}

interface SeatRowProps {
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

function SeatRow({
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

interface PlainSeatProps {
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

function PlainSeat({
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

interface DnDSeatProps {
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

function DnDSeat({
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

interface PdCheckboxProps {
  player: PlayerDoc;
  isPd: boolean;
  disabled: boolean;
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  onError?: (message: string) => void;
}

function PdCheckbox({
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
            onError?.(`${wrapped.code}: ${wrapped.message}`);
          });
        }}
        aria-label={`pd-${player.displayName}`}
      />
      <span>PD</span>
    </label>
  );
}
