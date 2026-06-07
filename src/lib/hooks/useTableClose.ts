"use client";

import { useCallback, useState } from "react";

import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { applyManualTableClose } from "@/lib/services/seating/orchestrator";

interface UseTableCloseArgs {
  tid: string;
  uid: string | null;
  groupIds: string[];
  players: PlayerDoc[];
  tables: TableDoc[];
  /**
   * エラー文字列の表示用 setter。失敗（applied=false / throw）時に
   * `${code}: ${message}` または日本語固定 message を渡して呼ぶ。dashboard の setError を渡す。
   */
  onError: (message: string) => void;
}

interface UseTableCloseResult {
  /** 確認ダイアログ表示対象の卓番号（null = 非表示）。 */
  pendingTableNum: number | null;
  /** 閉鎖適用中フラグ。confirm ボタンを disabled にするために UI へ渡す。 */
  busy: boolean;
  /** SeatingBoard の「閉じる」ボタンから呼ぶ。確認ダイアログを開く。 */
  requestClose: (tableNum: number) => void;
  /** ダイアログのキャンセル。 */
  cancelClose: () => void;
  /** ダイアログの確定。orchestrator を呼び、成功で閉じる。 */
  confirmClose: () => Promise<void>;
}

/**
 * Phase 3 (07-third-dryrun-improvements): 運営者による手動卓閉鎖の state /
 * busy / orchestrator 呼出を集約する hook（`useManualSeatChange` 規範）。
 *
 * dashboard 側は `{ pendingTableNum, busy, requestClose, cancelClose, confirmClose }` を
 * SeatingBoard の「閉じる」ボタンと CloseTableConfirmDialog に渡すだけで済む。
 *
 * 二重 warn 回避: `applyManualTableClose`（overflow/last の throw / applyTableBreak 内の
 * wrapFirestoreWrite）は既に `logger.warn` 済みのため、本 hook は `unwrapOrFrom` で既存
 * AppError を素通しし UI 表示のみを行う（error-logging.md の二重 warn 禁止に準拠）。
 */
export function useTableClose({
  tid,
  uid,
  groupIds,
  players,
  tables,
  onError,
}: UseTableCloseArgs): UseTableCloseResult {
  const [pendingTableNum, setPendingTableNum] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const requestClose = useCallback((tableNum: number) => {
    setPendingTableNum(tableNum);
  }, []);

  const cancelClose = useCallback(() => {
    setPendingTableNum(null);
  }, []);

  const confirmClose = useCallback(async () => {
    if (!uid || pendingTableNum === null || busy) return;
    setBusy(true);
    try {
      const result = await applyManualTableClose(
        tid,
        uid,
        groupIds,
        pendingTableNum,
        players,
        tables,
      );
      if (!result.applied) {
        onError(
          "卓を閉じられませんでした（状態が変わった可能性）。再度ご確認ください。",
        );
        return;
      }
      setPendingTableNum(null);
    } catch (e) {
      // applyManualTableClose は内部で warn 済み。UI 表示のみ。
      const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の閉鎖に失敗しました");
      onError(formatErrorForDisplay(wrapped));
    } finally {
      setBusy(false);
    }
  }, [uid, pendingTableNum, busy, tid, groupIds, players, tables, onError]);

  return { pendingTableNum, busy, requestClose, cancelClose, confirmClose };
}
