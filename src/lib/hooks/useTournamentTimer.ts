"use client";

import { useEffect, useRef, useState } from "react";

import { AppError } from "@/lib/errors";
import { advanceLevel, subscribeTournament } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { getRemainingMs, shouldAutoAdvance } from "@/lib/services/timer";

interface TimerState {
  tournament: TournamentDoc | null;
  remainingMs: number | null;
  fromCache: boolean;
  hasPendingWrites: boolean;
  /** Date.now() at last non-cache snapshot. null until first server snapshot. */
  lastSyncAt: number | null;
  error: AppError | null;
}

interface UseTournamentTimerOptions {
  /**
   * 指定すると残り 0 で transaction による auto-advance を試みる。
   * 運営者ダッシュボード専用。`/live` 等の参加者ビューでは渡さないこと
   * （rule で permission-denied になるため）。
   */
  autoAdvance?: { uid: string; userGroupIds: string[] };
}

/**
 * tournament を subscribe しつつ 1 秒刻みで残り時間を derive する hook。
 *  - `state.fromCache` で接続切れを判定（ConnectionBadge に伝搬）
 *  - タブ非表示時は setInterval を停止し、復帰時に即 tick
 *  - autoAdvance オプション指定時のみ、残り 0 を観測した端末が transaction を試みる
 */
export function useTournamentTimer(
  tid: string,
  options: UseTournamentTimerOptions = {},
): TimerState {
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [fromCache, setFromCache] = useState(true);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(null);
  const [error, setError] = useState<AppError | null>(null);
  const [, setTick] = useState(0);
  const advanceInflightRef = useRef(false);

  useEffect(() => {
    const unsub = subscribeTournament(
      tid,
      ({ doc, fromCache: fc, hasPendingWrites: hpw }) => {
        setTournament(doc);
        setFromCache(fc);
        setHasPendingWrites(hpw);
        if (!fc) setLastSyncAt(Date.now());
      },
      (err) => {
        logger.warn("timer subscribe error", { code: err.code, tid });
        setError(err);
      },
    );
    return unsub;
  }, [tid]);

  useEffect(() => {
    let id: ReturnType<typeof setInterval> | null = null;
    const start = () => {
      if (id !== null) return;
      id = setInterval(() => setTick((n) => n + 1), 1000);
    };
    const stop = () => {
      if (id !== null) {
        clearInterval(id);
        id = null;
      }
    };
    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible") {
        setTick((n) => n + 1);
        start();
      } else {
        stop();
      }
    };
    start();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }
    return () => {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, []);

  const remainingMs = tournament ? getRemainingMs(tournament, Date.now()) : null;

  useEffect(() => {
    const auto = options.autoAdvance;
    if (!auto) return;
    if (!tournament) return;
    // この tournament の group に所属していない端末からは書き込み試行しない。
    // rule 側でも弾かれるが、端末側で止めて無駄な failed transaction / ログを防ぐ。
    if (!auto.userGroupIds.includes(tournament.groupId)) return;
    if (!shouldAutoAdvance(tournament, Date.now())) return;
    if (advanceInflightRef.current) return;
    advanceInflightRef.current = true;
    advanceLevel(tid, auto.uid, auto.userGroupIds, {
      expectedLevel: tournament.currentLevel,
    })
      .catch((e) => {
        const wrapped = AppError.from(e, "firestore/write_failed", "レベル進行に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code, tid });
      })
      .finally(() => {
        advanceInflightRef.current = false;
      });
    // remainingMs を依存に含めることで毎 tick で再評価される。
  }, [tournament, tid, remainingMs, options.autoAdvance]);

  return {
    tournament,
    remainingMs,
    fromCache,
    hasPendingWrites,
    lastSyncAt,
    error,
  };
}
