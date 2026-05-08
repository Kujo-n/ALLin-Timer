"use client";

import { useEffect } from "react";

import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Service Worker 登録の client-only component。
 *
 * - production build のみで登録（dev では HMR / Turbopack と衝突するため無効化）
 * - `navigator.serviceWorker` 未対応ブラウザは feature detection で no-op
 * - 失敗は logger.warn のみ（PWA 機能無しでもアプリ自体は動く設計）
 *
 * Mount は `app/layout.tsx` の <body> 末尾。何も render しない（return null）。
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .then((reg) => {
        logger.info("sw registered", { scope: reg.scope });
      })
      .catch((e) => {
        const wrapped = AppError.from(
          e,
          "pwa/sw-register-failed",
          "Service Worker の登録に失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code });
      });
  }, []);

  return null;
}
