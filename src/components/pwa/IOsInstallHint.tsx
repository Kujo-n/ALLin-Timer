"use client";

import { Info, Share, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

/**
 * iOS Safari 訪問者向けの「ホーム画面に追加」案内バナー。
 *
 * iOS は `beforeinstallprompt` が永久に非対応のため、UA + display-mode で
 * 「未インストールの iOS Safari 訪問者」のみに hint を出す。
 *
 * Phase A: layout で全画面 mount。
 * Phase D: mount 点を `app/page.tsx`（トップ画面 `/`）のみに限定したため
 *          role gating は導入せず、誰に見えても dismiss するだけのコストで済む。
 *          dismiss は `localStorage["allinpt.pwaInstallDismissedAt"]` に ms epoch
 *          を書き、`PwaInstallPromotion` と同じ key / 30 日 TTL で永続 hide。
 */

const STORAGE_KEY = "allinpt.pwaInstallDismissedAt";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function readDismissedAt(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) ? n : null;
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "pwa/storage-failed",
      "インストール状態の読込に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
    return null;
  }
}

function persistDismissedAt(ts: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(ts));
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "pwa/storage-failed",
      "インストール状態の保存に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
  }
}

export function IOsInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ua = navigator.userAgent;
    // MSStream チェックは IE11 排除（Next.js 公式 PWA ガイドが採用するパターン）
    const isIOS =
      /iPad|iPhone|iPod/.test(ua) && !("MSStream" in window);
    const isStandalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari < 16 fallback
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (!isIOS || isStandalone) {
      setShow(false);
      return;
    }
    const at = readDismissedAt();
    if (at !== null && Date.now() - at < THIRTY_DAYS_MS) {
      setShow(false);
      return;
    }
    setShow(true);
  }, []);

  const onDismiss = useCallback(() => {
    persistDismissedAt(Date.now());
    setShow(false);
    logger.info("pwa install dismissed", { reason: "ios-hint-close" });
  }, []);

  if (!show) return null;

  return (
    <section
      role="note"
      className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20"
    >
      <Info aria-hidden className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        iOS でホーム画面に追加するには、Safari 下部の
        <Share aria-hidden className="mx-1 inline h-4 w-4 align-text-bottom" />
        共有ボタン →「ホーム画面に追加」を選択してください。
      </span>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={onDismiss}
        aria-label="インストール案内を閉じる"
        data-testid="ios-install-hint-dismiss"
      >
        <X aria-hidden className="h-4 w-4" />
        今は閉じる
      </Button>
    </section>
  );
}
