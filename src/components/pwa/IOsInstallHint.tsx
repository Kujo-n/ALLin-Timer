"use client";

import { Info, Share } from "lucide-react";
import { useEffect, useState } from "react";

/**
 * iOS Safari 訪問者向けの「ホーム画面に追加」案内バナー。
 *
 * iOS は `beforeinstallprompt` が永久に非対応のため、UA + display-mode で
 * 「未インストールの iOS Safari 訪問者」のみに hint を出す。
 *
 * Phase A: role gating なしで全 iOS 訪問者に表示
 * Phase D: useGroupRole で role !== "member" のときのみ表示する gating を追加
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
    setShow(isIOS && !isStandalone);
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
    </section>
  );
}
