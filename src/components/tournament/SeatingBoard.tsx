"use client";

import { useMemo } from "react";

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
 */
export function SeatingBoard({
  players,
  tables,
  seatsPerTable,
  currentUid,
  onTogglePd,
  canManage = false,
  onError,
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

  if (sortedTables.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        テーブルがまだありません（席決め前）。
      </p>
    );
  }

  const showPd = canManage && !!onTogglePd;

  return (
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
                {Array.from({ length: seatsPerTable }, (_, i) => i + 1).map((seatNum) => {
                  const p = seatMap.get(seatNum);
                  const isMe = p && currentUid && p.uid === currentUid;
                  const isPd = p?.isPlayingDealer ?? false;
                  // 自席以外の checkbox は同卓に他 PD 在席で disabled（1 卓 1 PD UI ガード）。
                  const checkboxDisabled =
                    !!tablePd && !isPd && !table.isBroken;
                  return (
                    <li key={seatNum} className="flex items-center gap-2">
                      <span className="w-6 text-muted-foreground">{seatNum}:</span>
                      <span className={cn("flex-1 truncate", isMe && "font-bold")}>
                        {p ? p.displayName : "—"}
                      </span>
                      {isMe ? <span aria-label="self">★</span> : null}
                      {isPd ? <span aria-label="pd-badge">◎</span> : null}
                      {showPd && p && !p.isBusted && !table.isBroken ? (
                        <label className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                          <input
                            type="checkbox"
                            checked={isPd}
                            disabled={checkboxDisabled}
                            onChange={(e) => {
                              void onTogglePd!(p, e.target.checked).catch((err) => {
                                const wrapped = AppError.from(
                                  err,
                                  "firestore/write_failed",
                                  "PD 設定に失敗しました",
                                );
                                logger.warn(wrapped.message, {
                                  code: wrapped.code,
                                  pid: p.id,
                                });
                                onError?.(`${wrapped.code}: ${wrapped.message}`);
                              });
                            }}
                            aria-label={`pd-${p.displayName}`}
                          />
                          <span>PD</span>
                        </label>
                      ) : null}
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
