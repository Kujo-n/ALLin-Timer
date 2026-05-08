"use client";

import { useEffect, useRef, useState } from "react";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

export interface UseWakeLockState {
  /** Wake Lock API がブラウザで利用可能か。SSR / 旧 iOS Safari 等は false。 */
  supported: boolean;
  /** 現時点で sentinel を保持しているか。OS が暗黙 release するとここが false に戻る。 */
  held: boolean;
  /** 直近の取得 / 解放失敗。throw せず state に積むのみ（UI は読みたければ参照可）。 */
  lastError: AppError | null;
}

/**
 * Phase C: Screen Wake Lock API を扱う hook。
 *
 *   - `active=true` の間だけ `navigator.wakeLock.request("screen")` を取得
 *   - `visibilitychange` で `visibilityState === "visible"` 復帰時に再取得
 *   - sentinel の `release` event を購読し、外部解放（OS / battery 起因）で held=false に戻す
 *   - 失敗は `AppError("device/wake-lock-failed")` で warn ログのみ。throw しない
 *
 * SSR / Wake Lock 未対応 UA（iOS Safari < 16.4 等）では supported=false で no-op。
 * UI fallback は `<DeviceFallbackHints>` 側で supported を見て案内テキストを出す。
 */
export function useWakeLock(active: boolean): UseWakeLockState {
  const [supported, setSupported] = useState(false);
  const [held, setHeld] = useState(false);
  const [lastError, setLastError] = useState<AppError | null>(null);

  // 現在保持している sentinel を ref で保持。effect 再実行をまたいで参照する。
  // in-flight な request の重複抑止は ref に依らず、resolve 後に sentinelRef + cancelled
  // で stale 判定して即 release する形に統一する（active=true→false→true の急 toggle で
  // 旧実装の inflightRef early return が再取得を取り落とす race を回避するため）。
  const sentinelRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    if (typeof navigator === "undefined") return;
    if (!("wakeLock" in navigator)) {
      setSupported(false);
      return;
    }
    setSupported(true);

    let cancelled = false;

    const releaseSentinel = async () => {
      const s = sentinelRef.current;
      sentinelRef.current = null;
      // sentinel が無くても held=false は確実に倒す（race の余韻吸収）。
      // unmount 後の setState は React 18+ が silent no-op として扱うため安全。
      setHeld(false);
      if (!s) return;
      try {
        await s.release();
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "device/wake-lock-release-failed",
          "画面消灯防止の解除に失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code });
      }
    };

    const acquire = async () => {
      if (!active || cancelled) return;
      if (sentinelRef.current) return;
      try {
        const s = await navigator.wakeLock.request("screen");
        // resolve 後の stale 判定:
        //   - cancelled / active=false: effect が既に解除済 → 即 release
        //   - sentinelRef.current 既存: 並走したもう一方の acquire が勝った → 自分は release
        if (cancelled || !active || sentinelRef.current) {
          try {
            await s.release();
          } catch {
            /* best-effort release */
          }
          return;
        }
        sentinelRef.current = s;
        setHeld(true);
        setLastError(null);
        s.addEventListener("release", () => {
          // OS / visibility 起因の暗黙 release。次回 visible 復帰で再取得される。
          if (sentinelRef.current === s) {
            sentinelRef.current = null;
            if (!cancelled) setHeld(false);
          }
        });
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "device/wake-lock-failed",
          "画面消灯防止に失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) {
          setHeld(false);
          setLastError(wrapped);
        }
      }
    };

    void acquire();

    const onVisibilityChange = () => {
      if (typeof document === "undefined") return;
      if (document.visibilityState === "visible" && active) {
        void acquire();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
      void releaseSentinel();
    };
  }, [active]);

  return { supported, held, lastError };
}
