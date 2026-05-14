"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { logger } from "@/lib/logger";

interface UseClipboardCopyOptions {
  /** copied=true → false に自動で戻すまでの ms。default 2000。 */
  autoResetMs?: number;
  /** writeText 失敗時に UI に伝搬する callback。`<code>: <message>` 形式の文字列が渡る。 */
  onError?: (message: string) => void;
}

interface UseClipboardCopyResult {
  /** 直近の copy() 成功から autoResetMs 以内なら true。 */
  copied: boolean;
  /** クリップボードに value を書き込む。value=null のときは no-op。 */
  copy: () => Promise<void>;
}

const DEFAULT_AUTO_RESET_MS = 2000;

/**
 * URL 等を navigator.clipboard.writeText でコピーし、成功時に短時間「コピーしました」
 * を表示するための共通 hook。
 *
 *   - 失敗時は `AppError("clipboard/unavailable", ...)` を作って `logger.warn` し、
 *     `onError` callback に `formatErrorForDisplay(wrapped)` を渡す
 *   - value=null / clipboard 不在のときは no-op（throw しない）
 *   - copied=true は autoResetMs 後に自動で false に戻る
 *
 * architect-refactor 20260514 で QrPanel / InviteCodeCard / SpectateModeCard から
 * 同形パターンを集約。
 */
export function useClipboardCopy(
  value: string | null,
  options: UseClipboardCopyOptions = {},
): UseClipboardCopyResult {
  const { autoResetMs = DEFAULT_AUTO_RESET_MS, onError } = options;
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // unmount 時に timeout が残らないように clear。
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  // value が変わったら copied を直ちに false に戻す（招待コード再発行時等の UX）。
  useEffect(() => {
    setCopied(false);
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [value]);

  const copy = useCallback(async () => {
    if (!value) return;
    if (typeof navigator === "undefined" || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        setCopied(false);
        timerRef.current = null;
      }, autoResetMs);
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "clipboard/unavailable",
        "クリップボードにコピーできませんでした",
      );
      logger.warn(wrapped.message, { code: wrapped.code });
      onError?.(formatErrorForDisplay(wrapped));
    }
  }, [value, autoResetMs, onError]);

  return { copied, copy };
}
