"use client";

import { useMemo } from "react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { cn } from "@/lib/utils";

interface Props {
  players: PlayerDoc[];
  tables: TableDoc[];
  seatsPerTable: number;
  /** 自分の uid。一致する席に ★ を付与（運営兼任プレイヤー向け）。 */
  currentUid?: string | null;
}

/**
 * Phase 4: 卓ごとの席カードを並べる運営者ビュー。
 * - 卓は tableNum 昇順
 * - 各席は 1..seatsPerTable で順番表示、空席は `—`
 * - 自分の uid に一致する席は ★
 * - isBroken=true の卓は薄く + 「閉鎖」バッジ
 */
export function SeatingBoard({ players, tables, seatsPerTable, currentUid }: Props) {
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

  if (sortedTables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        テーブルがまだありません（席決め前）。
      </p>
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {sortedTables.map((table) => {
        const tableSeated = seatedByTable.get(table.tableNum) ?? [];
        const seatMap = new Map<number, PlayerDoc>();
        for (const p of tableSeated) {
          if (p.seatNum !== null) seatMap.set(p.seatNum, p);
        }
        return (
          <Card
            key={table.id}
            className={cn(table.isBroken && "opacity-60")}
            aria-label={`table-${table.tableNum}`}
          >
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-between text-sm">
                <span>
                  卓 {table.tableNum}（{tableSeated.length} 人）
                </span>
                {table.isBroken ? (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">閉鎖</span>
                ) : null}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-1 text-xs font-mono">
                {Array.from({ length: seatsPerTable }, (_, i) => i + 1).map((seatNum) => {
                  const p = seatMap.get(seatNum);
                  const isMe = p && currentUid && p.uid === currentUid;
                  return (
                    <li key={seatNum} className="flex items-center gap-2">
                      <span className="w-6 text-muted-foreground">{seatNum}:</span>
                      <span className={cn(isMe && "font-bold")}>
                        {p ? p.displayName : "—"}
                      </span>
                      {isMe ? <span aria-label="self">★</span> : null}
                    </li>
                  );
                })}
              </ul>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
