"use client";

import { useEffect } from "react";

import { resumeAudioContext } from "@/lib/audio/audio-context";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * Phase 5.1: ブラウザ document の最初の `pointerdown` で AudioContext を resume する。
 * 明示「サウンドを有効化」ボタンを押さなくても任意のタッチ／クリックで unlock を試みる。
 *
 * Chrome / Edge / Firefox の autoplay policy は「document に対する任意の user gesture」が
 * 1 回でも発生していれば AudioContext.resume を許す。Safari iOS は条件が厳しめだが、
 * 失敗しても明示「サウンドを有効化」ボタン経路（既存）が fallback として機能する。
 *
 * `{ once: true, capture: true }` で React strict mode の二重 mount でも問題なし
 * （listener は最初の発火で自動的に解除される）。
 */
export function useImplicitAudioUnlock(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const handler = () => {
      void resumeAudioContext().catch((e) => {
        const wrapped = AppError.from(
          e,
          "audio/implicit-unlock-failed",
          "暗黙 audio unlock に失敗",
        );
        logger.warn(wrapped.message, { code: wrapped.code });
      });
    };
    window.addEventListener("pointerdown", handler, {
      capture: true,
      once: true,
    });
    return () => {
      window.removeEventListener("pointerdown", handler, { capture: true });
    };
  }, []);
}
