"use client";

import { Info, Share, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { logger } from "@/lib/logger";

import {
  isWithinPwaInstallDismissTtl,
  persistPwaInstallDismissedAt,
  readPwaInstallDismissedAt,
} from "./install-dismiss-storage";

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
 *          storage 5 シンボルは `install-dismiss-storage.ts` で集約管理。
 */

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
    if (isWithinPwaInstallDismissTtl(readPwaInstallDismissedAt())) {
      setShow(false);
      return;
    }
    setShow(true);
  }, []);

  const onDismiss = useCallback(() => {
    persistPwaInstallDismissedAt(Date.now());
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
