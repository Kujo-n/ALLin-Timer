"use client";

import { useEffect, useRef } from "react";

import { AppError, getErrorCode } from "@/lib/errors";
import { finishTournament } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

const DEFAULT_DELAY_MS = 2000;

interface UseAutoFinishOptions {
  tournament: TournamentDoc | null;
  /** `resolveWinner` で算出した残り 1 人。null なら auto-finish 対象外。 */
  winnerId: string | null;
  /** ログイン中ユーザー uid（運営者）。 */
  uid: string | undefined;
  /** ユーザーが所属する group の id 配列（rule 判定用）。 */
  groupIds: string[];
  /** 残り 1 人観測 → finishTournament までの待機時間（ms）。default 2 秒。 */
  delayMs?: number;
}

/**
 * 残り 1 人になった時点で `delayMs` 後に `finishTournament` を呼ぶ運営者ダッシュボード専用 hook。
 *
 * Phase 4 architect-refactor (P5-2) で `dashboard-client.tsx` から抽出。
 *
 * - 参加者端末（非 group メンバー）では rule で permission-denied になるため、呼出側で
 *   `groupIds.includes(tournament.groupId)` を確認した上で呼ぶこと（hook 内でも 2 重 guard）。
 * - 冪等性は `finishTournament` 内部で担保（state === "finished" なら no-op）。
 * - `inflightRef` で同一クライアント内の二重発火を防ぐ。タイマーは effect cleanup で解除する。
 * - 依存は primitive (winnerId / dataState / groupIds.join 等) に絞り、Firestore snapshot の
 *   再発行で無関係なオブジェクト参照が変わっても不要な再装填を起こさない。
 */
export function useAutoFinish(opts: UseAutoFinishOptions): void {
  const { tournament, winnerId, uid, groupIds, delayMs = DEFAULT_DELAY_MS } = opts;
  const inflightRef = useRef(false);

  const dataId = tournament?.id;
  const dataState = tournament?.state;
  const dataGroupId = tournament?.groupId;

  useEffect(() => {
    if (!uid || !dataId || !dataGroupId) return;
    if (!groupIds.includes(dataGroupId)) return;
    if (dataState !== "running" && dataState !== "paused") return;
    if (!winnerId) return;
    if (inflightRef.current) return;

    inflightRef.current = true;
    const capturedGroupIds = groupIds;
    const timer = setTimeout(() => {
      void finishTournament(dataId, uid, capturedGroupIds).catch((e) => {
        const code = e instanceof AppError ? e.code : getErrorCode(e);
        logger.warn("auto finish failed", { code, tid: dataId });
        inflightRef.current = false;
      });
    }, delayMs);
    return () => {
      clearTimeout(timer);
      inflightRef.current = false;
    };
  }, [winnerId, dataId, dataState, dataGroupId, uid, groupIds, delayMs]);
}
