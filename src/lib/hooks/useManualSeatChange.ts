"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppError, formatErrorForDisplay } from "@/lib/errors";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { logger } from "@/lib/logger";
import {
  applyManualSeatChange,
  applyManualSeatUndo,
} from "@/lib/services/seating/orchestrator";

/** 1 件の席移動。orchestrator の `BalancingMove` と等価だが、再 export を避けるため
 * hook 内部に再宣言する（dashboard が orchestrator を直接 import する必要をなくす）。 */
interface SeatMove {
  playerId: string;
  from: { tableNum: number; seatNum: number };
  to: { tableNum: number; seatNum: number };
}

interface UndoBanner {
  /** undo banner に表示する「主役」プレイヤーの label */
  summary: string;
  /** undo 時に reverse 適用する全 move（cascade なら N 件、単純 move なら 1 件） */
  moves: SeatMove[];
}

interface UseManualSeatChangeArgs {
  tid: string;
  uid: string | null;
  groupIds: string[];
  players: PlayerDoc[];
  /**
   * エラー文字列の表示用 setter。失敗（applied=false / throw）時に
   * `${code}: ${message}` または日本語固定 message を渡して呼ぶ。
   * dashboard 側の `setError` を渡す想定。
   */
  onError: (message: string) => void;
  /** undo banner の自動非表示 ms（既定 30,000 ms）。テスト用に上書き可能。 */
  undoTimeoutMs?: number;
}

interface UseManualSeatChangeResult {
  /** D&D 適用 / undo 中フラグ。次の drag を抑止するために UI に渡す。 */
  busy: boolean;
  /** 直近の成功 move の undo banner state（30 秒で auto clear）。 */
  undoBanner: UndoBanner | null;
  /** SeatingBoard `onMoveSeat` に渡す handler。 */
  handleMoveSeat: (
    player: PlayerDoc,
    to: { tableNum: number; seatNum: number },
  ) => Promise<void>;
  /** undo banner の「元に戻す」ボタンに渡す handler。 */
  handleUndoSeatChange: () => Promise<void>;
  /** undo banner の「閉じる」ボタンに渡す handler。auto-hide を待たず手動で消す。 */
  dismissUndoBanner: () => void;
}

const DEFAULT_UNDO_TIMEOUT_MS = 30_000;

/**
 * Phase 5.x で dashboard-client.tsx に直書きされていた D&D 手動席移動の state /
 * callback / 30 秒 undo banner timeout を集約する hook。
 *
 * 内部で:
 *   - busy state（次の drag 抑止）
 *   - undoBanner state（直近 cascade の全 move を保持）
 *   - 30 秒 undo timer（unmount で cleanup）
 *   - applyManualSeatChange / applyManualSeatUndo の AppError ラップ + logger.warn
 *
 * を担い、外側の dashboard は `{ busy, undoBanner, handleMoveSeat, handleUndoSeatChange }`
 * を SeatingBoard とバナー UI に渡すだけで済む。
 */
export function useManualSeatChange({
  tid,
  uid,
  groupIds,
  players,
  onError,
  undoTimeoutMs = DEFAULT_UNDO_TIMEOUT_MS,
}: UseManualSeatChangeArgs): UseManualSeatChangeResult {
  const [busy, setBusy] = useState(false);
  const [undoBanner, setUndoBanner] = useState<UndoBanner | null>(null);
  const undoTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unmount 時に pending timer を確実に解放（dashboard 遷移で undo banner 残骸が
  // 別 tournament で再表示される事故を防ぐ）。
  useEffect(() => {
    return () => {
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    };
  }, []);

  const handleMoveSeat = useCallback(
    async (
      player: PlayerDoc,
      to: { tableNum: number; seatNum: number },
    ) => {
      if (!uid) return;
      if (busy) return;
      if (player.tableNum === null || player.seatNum === null) return;
      const from = { tableNum: player.tableNum, seatNum: player.seatNum };
      setBusy(true);
      try {
        const result = await applyManualSeatChange(
          tid,
          uid,
          groupIds,
          player.id,
          to,
          players,
        );
        if (!result.applied) {
          onError(
            "席を変更できませんでした（席が埋まっている、または状態が変わった可能性）",
          );
          return;
        }
        // 成功 → undo banner state 更新 + 30 秒タイマーで自動非表示。
        // result.moves は applySingleMove / applyCascadeMoves が必ず返す（applied=true なら non-null）。
        const moves: SeatMove[] = result.moves ?? [
          { playerId: player.id, from, to },
        ];
        const cascadeNote =
          moves.length > 1 ? `（${moves.length} 名 cascade）` : "";
        setUndoBanner({
          summary: `${player.displayName} を Table ${from.tableNum} / 席 ${from.seatNum} → Table ${to.tableNum} / 席 ${to.seatNum} へ移動${cascadeNote}`,
          moves,
        });
        if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
        undoTimeoutRef.current = setTimeout(() => {
          setUndoBanner(null);
        }, undoTimeoutMs);
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "firestore/write_failed",
          "席の変更に失敗しました",
        );
        logger.warn(wrapped.message, {
          code: wrapped.code,
          tid,
          pid: player.id,
        });
        onError(formatErrorForDisplay(wrapped));
      } finally {
        setBusy(false);
      }
    },
    [uid, busy, tid, groupIds, players, onError, undoTimeoutMs],
  );

  const handleUndoSeatChange = useCallback(async () => {
    if (!uid || !undoBanner || busy) return;
    const { moves } = undoBanner;
    setBusy(true);
    try {
      const result = await applyManualSeatUndo(
        tid,
        uid,
        groupIds,
        moves,
        [...players],
      );
      if (!result.applied) {
        onError(
          "元に戻せませんでした（席が埋まっている、または状態が変わった可能性）",
        );
        return;
      }
      setUndoBanner(null);
      if (undoTimeoutRef.current) clearTimeout(undoTimeoutRef.current);
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "元に戻せませんでした",
      );
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      onError(formatErrorForDisplay(wrapped));
    } finally {
      setBusy(false);
    }
  }, [uid, undoBanner, busy, tid, groupIds, players, onError]);

  // 手動で undo banner を閉じる（auto-hide の 30 秒を待たない）。pending timer も
  // 解放し、banner を即座に消す。undo 自体は行わない（席はそのまま）。
  const dismissUndoBanner = useCallback(() => {
    if (undoTimeoutRef.current) {
      clearTimeout(undoTimeoutRef.current);
      undoTimeoutRef.current = null;
    }
    setUndoBanner(null);
  }, []);

  return {
    busy,
    undoBanner,
    handleMoveSeat,
    handleUndoSeatChange,
    dismissUndoBanner,
  };
}
