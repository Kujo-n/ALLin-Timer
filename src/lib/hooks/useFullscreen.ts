"use client";

import { useCallback, useEffect, useState } from "react";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface UseFullscreenState {
  /** 現在 fullscreen 表示中か。 */
  isFullscreen: boolean;
  /** ボタンの click ハンドラ。enter ⇄ exit を toggle する。 */
  toggle: () => Promise<void>;
}

/**
 * Fullscreen API を React 的に扱う hook。
 *
 * - `fullscreenchange` を購読して Esc 解除も含めて state を同期。
 * - Safari 系の `webkit*` event/element も保険で OR 評価する（PC 想定だが負担小）。
 * - `requestFullscreen` / `exitFullscreen` の reject は warn ログのみ（UX 上は no-op）。
 *
 * Phase 4 architect-refactor (P5-2) で `dashboard-client.tsx` から抽出。
 * SSR 環境（document 未定義）では isFullscreen=false / toggle no-op で安全に動く。
 */
export function useFullscreen(): UseFullscreenState {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const handler = () => {
      const fsEl =
        document.fullscreenElement ??
        (document as Document & { webkitFullscreenElement?: Element | null })
          .webkitFullscreenElement ??
        null;
      setIsFullscreen(!!fsEl);
    };
    handler(); // 初期同期（既に他経路で fullscreen 化されている場合の保険）
    document.addEventListener("fullscreenchange", handler);
    document.addEventListener("webkitfullscreenchange", handler);
    return () => {
      document.removeEventListener("fullscreenchange", handler);
      document.removeEventListener("webkitfullscreenchange", handler);
    };
  }, []);

  const toggle = useCallback(async () => {
    if (typeof document === "undefined") return;
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch (e) {
      const wrapped = AppError.from(e, "ui/fullscreen-failed", "全画面化に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
    }
  }, []);

  return { isFullscreen, toggle };
}
