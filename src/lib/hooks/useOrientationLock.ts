"use client";

import { useEffect, useState } from "react";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export type OrientationTarget = "landscape" | "portrait";

export interface UseOrientationLockState {
  /** Screen Orientation Lock がこの環境で適用可能か（PWA standalone + lock メソッドあり）。 */
  supported: boolean;
  /** lock 呼出が成功したか。一度成功したら以降変化しない。 */
  locked: boolean;
}

/**
 * Phase C: Screen Orientation Lock を扱う hook。
 *
 *   - PWA standalone（`(display-mode: standalone).matches === true`）でのみ lock を試行
 *   - 通常のブラウザタブでは feature detection で early return（NotSupportedError ログ汚染を防ぐ）
 *   - iOS Safari は `screen.orientation` が存在しても `lock` 関数は未提供のため、
 *     `typeof screen.orientation.lock !== "function"` で early return
 *   - 失敗は `AppError("device/orientation-lock-failed")` で warn のみ。throw しない
 *
 * 引数 `target` は呼出側が `"landscape"` 等で固定指定する。
 */
export function useOrientationLock(target: OrientationTarget): UseOrientationLockState {
  const [supported, setSupported] = useState(false);
  const [locked, setLocked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const standalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!standalone) return;

    const screenObj = window.screen;
    if (!screenObj || !screenObj.orientation) return;
    const orientation = screenObj.orientation as ScreenOrientation & {
      lock?: (orientation: OrientationTarget) => Promise<void>;
    };
    const lockFn = orientation.lock;
    if (typeof lockFn !== "function") return;

    setSupported(true);

    let cancelled = false;
    void (async () => {
      try {
        await lockFn.call(orientation, target);
        if (!cancelled) setLocked(true);
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "device/orientation-lock-failed",
          "横向き固定に失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setLocked(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [target]);

  return { supported, locked };
}
