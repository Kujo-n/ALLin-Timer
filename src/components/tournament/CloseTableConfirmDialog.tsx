"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { MAX_SEATS_PER_TABLE } from "@/lib/limits";
import { formatTableLabel } from "@/lib/services/format-table-label";
import {
  formatTableCloseOverflow,
  liveTableNums,
  planManualTableClose,
} from "@/lib/services/seating/engine";

interface Props {
  /** 対象卓番号。null でダイアログ非表示。 */
  tableNum: number | null;
  players: PlayerDoc[];
  tables: TableDoc[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Phase 3 (07-third-dryrun-improvements): 手動卓閉鎖の確認ダイアログ。
 *
 * preview は engine `planManualTableClose` を component 側で呼んで算出する
 * （`BalancingInstructionCard` が engine 純関数を直接 import する先例に倣う）。
 *   - 成立: 「N 名を残りの卓へまとめます」+ confirm enabled
 *   - overflow: 警告文 + `role="alert"` + confirm disabled
 *   - only-one-table: 警告文 + confirm disabled
 *
 * 実際の整合性（race）は orchestrator tx が担保。ダイアログ open 中に subscribe で
 * players/tables が更新されれば useMemo が再計算され overflow 表示も追従する。
 */
export function CloseTableConfirmDialog({
  tableNum,
  players,
  tables,
  busy,
  onConfirm,
  onCancel,
}: Props) {
  const open = tableNum !== null;
  const preview = useMemo(() => {
    if (tableNum === null) return null;
    // 生存卓（実在・未閉鎖）を tables から導出。空卓も再配置先に含め偽 overflow を防ぐ。
    // commit(orchestrator) と同一の liveTableNums selector で preview/commit drift を防ぐ。
    return planManualTableClose(
      players,
      liveTableNums(tables),
      tableNum,
      MAX_SEATS_PER_TABLE,
    );
  }, [tableNum, players, tables]);

  const table = tables.find((t) => t.tableNum === tableNum) ?? null;
  const label = table ? formatTableLabel(table) : `Table ${tableNum}`;

  const overflow = preview !== null && !preview.ok && preview.reason === "overflow";
  const lastTable =
    preview !== null && !preview.ok && preview.reason === "only-one-table";
  const moveCount = preview?.ok ? preview.plan.moves.length : 0;
  const capacity = preview !== null && !preview.ok ? preview.capacity ?? 0 : 0;
  const needed = preview !== null && !preview.ok ? preview.needed ?? 0 : 0;

  const description = overflow
    ? formatTableCloseOverflow(capacity, needed)
    : lastTable
      ? "最後の 1 卓は閉鎖できません。"
      : `このテーブルの ${moveCount} 名を残りの卓へまとめます。残卓は一時的に最大 ${MAX_SEATS_PER_TABLE} 名まで増えます。`;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onCancel();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label} を閉じる</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {overflow ? (
          <p className="text-sm text-destructive" role="alert">
            収まらないため閉鎖できません。
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>
            キャンセル
          </Button>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={busy || overflow || lastTable}
            data-testid="close-table-confirm"
            aria-label={`${label} を閉じる`}
          >
            {busy ? "閉鎖中…" : "閉じる"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
