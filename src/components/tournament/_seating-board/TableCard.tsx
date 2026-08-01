"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { formatTableLabel } from "@/lib/services/format-table-label";
import { cn } from "@/lib/utils";

import { TableLabelEditPopover } from "../_table-label-edit/TableLabelEditPopover";
import { SeatRow } from "./SeatRow";

export interface TableCardProps {
  table: TableDoc;
  /** 当該卓の未バースト着席者。席番号順である必要はない（内部で seatMap 化する）。 */
  tableSeated: PlayerDoc[];
  seatsPerTable: number;
  currentUid: string | null;
  showPd: boolean;
  onTogglePd?: (player: PlayerDoc, value: boolean) => Promise<void>;
  onError?: (message: string) => void;
  enableDnd: boolean;
  dndBusy: boolean;
  draggedPlayer: PlayerDoc | null;
  canEditTableLabel: boolean;
  onSaveTableLabel?: (
    tableNum: number,
    patch: { label: string | null; color: string | null },
  ) => Promise<void>;
  canCloseTable: boolean;
  onCloseTable?: (tableNum: number) => void;
  onReopenTable?: (tableNum: number) => void;
  reopenBusy: boolean;
  /** 生存卓（isBroken=false）の数。2 以上のときだけ「閉じる」ボタンを出す。 */
  liveTableCount: number;
}

/**
 * 卓 1 つ分のカード（ヘッダの Table 名 / 色ドット / 閉鎖バッジ / 編集・閉じる・再開ボタン
 * ＋ 席行リスト）。
 *
 * architect-refactor 20260801 (finding-7) で SeatingBoard.tsx から分離。
 * DOM 構造・aria 属性・data-testid・class・inline style は移動前と完全に同一。
 */
export function TableCard({
  table,
  tableSeated,
  seatsPerTable,
  currentUid,
  showPd,
  onTogglePd,
  onError,
  enableDnd,
  dndBusy,
  draggedPlayer,
  canEditTableLabel,
  onSaveTableLabel,
  canCloseTable,
  onCloseTable,
  onReopenTable,
  reopenBusy,
  liveTableCount,
}: TableCardProps) {
  const seatMap = new Map<number, PlayerDoc>();
  for (const p of tableSeated) {
    if (p.seatNum !== null) seatMap.set(p.seatNum, p);
  }
  const tablePd = tableSeated.find((p) => p.isPlayingDealer);
  // Phase 3: 手動卓閉鎖で残卓が seatsPerTable を一時的に超える（最大 MAX_SEATS_PER_TABLE）。
  // 描画行数を「seatsPerTable と実在最大席番号の大きい方」に広げ、定員引き上げ後も全員を可視化する。
  const maxOccupiedSeat = tableSeated.reduce(
    (max, p) => (p.seatNum !== null && p.seatNum > max ? p.seatNum : max),
    0,
  );
  const renderSeatCount = Math.max(seatsPerTable, maxOccupiedSeat);

  return (
    <Card
      className={cn("overflow-hidden", table.isBroken && "opacity-60")}
      aria-label={`table-${table.tableNum}`}
      // Phase C improvement (02-02): 旧 6px 左帯では色とテーブルの紐付きが弱かったため、
      // 上端 8px 帯 + ヘッダ左の丸ドットの二重表現に変更。border-top は Tailwind class
      // で width 8px の JIT 組合せが少ないため inline style で指定。
      style={
        table.color
          ? {
              borderTopWidth: 8,
              borderTopStyle: "solid",
              borderTopColor: table.color,
            }
          : undefined
      }
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center justify-between text-sm">
          <span className="flex items-center gap-2">
            {table.color ? (
              <span
                aria-hidden
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-black/10"
                style={{ backgroundColor: table.color }}
              />
            ) : null}
            <span>
              {formatTableLabel(table)}（{tableSeated.length} 人）
            </span>
          </span>
          <span className="flex items-center gap-2">
            {table.isBroken ? (
              <span className="rounded bg-muted px-2 py-0.5 text-xs">
                閉鎖
              </span>
            ) : null}
            {canEditTableLabel && onSaveTableLabel ? (
              <TableLabelEditPopover
                table={table}
                onSave={(patch) => onSaveTableLabel(table.tableNum, patch)}
                onError={onError}
              />
            ) : null}
            {/* Phase 3: 任意卓を閉じる。生存卓 2 つ以上・非閉鎖卓のときのみ表示。 */}
            {canCloseTable &&
            onCloseTable &&
            !table.isBroken &&
            liveTableCount > 1 ? (
              <button
                type="button"
                className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted"
                onClick={() => onCloseTable(table.tableNum)}
                data-testid={`close-table-${table.tableNum}`}
                aria-label={`${formatTableLabel(table)} を閉じる`}
              >
                閉じる
              </button>
            ) : null}
            {/* Phase 4: 閉鎖卓を再開。canCloseTable（卓管理権限）+ isBroken のときのみ表示。
                close ボタン（!isBroken）と排他で、同じ卓に両方は出ない。 */}
            {canCloseTable && onReopenTable && table.isBroken ? (
              <button
                type="button"
                className="rounded border px-2 py-0.5 text-xs text-muted-foreground hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                onClick={() => onReopenTable(table.tableNum)}
                disabled={reopenBusy}
                data-testid={`reopen-table-${table.tableNum}`}
                aria-label={`${formatTableLabel(table)} を再開`}
              >
                再開
              </button>
            ) : null}
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1 text-xs font-mono">
          {Array.from({ length: renderSeatCount }, (_, i) => i + 1).map(
            (seatNum) => (
              <SeatRow
                key={seatNum}
                table={table}
                seatNum={seatNum}
                player={seatMap.get(seatNum)}
                currentUid={currentUid}
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
}
