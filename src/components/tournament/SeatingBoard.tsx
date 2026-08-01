"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useCallback, useMemo, useState } from "react";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { liveTableNums } from "@/lib/services/seating/engine";

import { TableCard } from "./_seating-board/TableCard";

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
  /**
   * Phase C: 卓 label / color の inline edit 権限。organizer 以上 + state が
   * `seating` 以降のときに true。`onSaveTableLabel` と組で渡す。
   */
  canEditTableLabel?: boolean;
  /**
   * Phase C: 卓 label / color を保存する handler。`updateTableLabel` 呼出をラップする。
   * label='' / color=null は repository / service 層で正規化される。
   */
  onSaveTableLabel?: (
    tableNum: number,
    patch: { label: string | null; color: string | null },
  ) => Promise<void>;
  /**
   * Phase 3: 卓を閉じる権限（organizer + canManage + 進行系 state）。`onCloseTable` と組で渡す。
   * `canManage`（PD / D&D）とは別軸の独立 prop。
   *
   * Phase 4: 意味的には「卓管理（close / reopen）権限の共通軸」へ実質拡張される。
   * close は live 卓・reopen は broken 卓で排他のため、prop 増殖を避けて同一軸を再利用する
   * （prop 名は churn 最小化で据え置き）。
   */
  canCloseTable?: boolean;
  /** Phase 3: 「閉じる」ボタン handler。dashboard の useTableClose.requestClose を渡す。 */
  onCloseTable?: (tableNum: number) => void;
  /** Phase 4: 閉鎖済み卓を再開する handler。`canCloseTable`（= 卓管理権限）と組で渡す。 */
  onReopenTable?: (tableNum: number) => void;
  /**
   * Phase 4: 再開書込が in-flight の間「再開」ボタンを disabled にして二度押しを抑止する。
   * 書込自体は idempotent（`isBroken=false` 単独書換）だが、close ボタンと UX を揃えるため。
   */
  reopenBusy?: boolean;
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
 *
 * architect-refactor 20260801 (finding-7): 626 行に同居していた内部 component
 * （TableCard / SeatRow / PlainSeat / DnDSeat / PdCheckbox）を `_seating-board/` へ分離し、
 * 本 file は「卓の集約・DnDContext・drag state」だけを持つ orchestrator に絞った。
 * `_timer-controls/` / `_table-label-edit/` と同じ co-location 規約に従う。
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
  canEditTableLabel = false,
  onSaveTableLabel,
  canCloseTable = false,
  onCloseTable,
  onReopenTable,
  reopenBusy = false,
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

  // Phase 3: 生存卓（isBroken=false）が 2 つ以上のときのみ「閉じる」ボタンを出す
  // （engine の only-one-table 保護と二重防御）。engine も同じ liveTableNums selector 由来の
  // 生存卓集合で判定するため UI のボタン表示と engine の plan 判定は一致する。
  const liveTableCount = useMemo(() => liveTableNums(tables).length, [tables]);

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
      {sortedTables.map((table) => (
        <TableCard
          key={table.id}
          table={table}
          tableSeated={seatedByTable.get(table.tableNum) ?? []}
          seatsPerTable={seatsPerTable}
          currentUid={currentUid ?? null}
          showPd={showPd}
          onTogglePd={onTogglePd}
          onError={onError}
          enableDnd={enableDnd}
          dndBusy={dndBusy}
          draggedPlayer={draggedPlayer}
          canEditTableLabel={canEditTableLabel}
          onSaveTableLabel={onSaveTableLabel}
          canCloseTable={canCloseTable}
          onCloseTable={onCloseTable}
          onReopenTable={onReopenTable}
          reopenBusy={reopenBusy}
          liveTableCount={liveTableCount}
        />
      ))}
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
