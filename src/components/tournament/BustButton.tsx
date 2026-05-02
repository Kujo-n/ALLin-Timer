"use client";

import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";
import { bustPlayer, unbustPlayer } from "@/lib/services/seating/orchestrator";

interface Props {
  tid: string;
  pid: string;
  isBusted: boolean;
  /**
   * Phase 5.1: 同卓 player の ID 配列（自身を除く）。bust 時に同卓全員の
   * `isPlayingDealer=false` を batch で書き込むために使用。
   * 渡されなければ PD フラグの伝播は当該 player のみ。
   */
  sameTablePlayerIds?: string[];
  onError?: (message: string) => void;
}

/**
 * Phase 4: 単一プレイヤーのバスト切替ボタン。
 * - running / paused 中のみ表示する想定（呼出し側で出し分け）
 * - busted=false → クリックでバスト記録、busted=true → バスト取消
 * - 取消で席は復旧しない（次の late entry / 手動再 join 相当）
 *
 * M5 fix: unmount 後の setState 警告を防ぐため `mounted` ref で guard。
 */
export function BustButton({ tid, pid, isBusted, sameTablePlayerIds, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function handleClick() {
    if (busy) return;
    setBusy(true);
    try {
      if (isBusted) {
        await unbustPlayer(tid, pid);
      } else {
        await bustPlayer(tid, pid, sameTablePlayerIds ?? []);
      }
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "バスト処理に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
      if (mounted.current) onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Button
      size="sm"
      variant={isBusted ? "outline" : "destructive"}
      disabled={busy}
      onClick={() => void handleClick()}
      aria-label={isBusted ? `unbust-${pid}` : `bust-${pid}`}
    >
      {busy ? "処理中…" : isBusted ? "脱落取消" : "バスト"}
    </Button>
  );
}
