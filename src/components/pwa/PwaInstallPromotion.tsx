"use client";

import { Download, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import {
  isWithinPwaInstallDismissTtl,
  persistPwaInstallDismissedAt,
  readPwaInstallDismissedAt,
} from "./install-dismiss-storage";

/**
 * Android Chrome 系の `beforeinstallprompt` を capture して、
 * 「ホーム画面に追加」ボタン付きカスタムバナーを描画する client component。
 *
 * Phase D: トップ画面 `/` のみで mount される（`app/page.tsx`）。会場 dashboard /
 * live で促進バナーが居座る事故を避けるため mount 点を限定。role gating は
 * 持たず、未ログイン / 匿名 / member / organizer / owner いずれでも表示候補。
 *
 * 永続化: 「今は閉じる」/「ホーム画面に追加」で dismissed / `appinstalled` event
 * 受信時に `localStorage["allinpt.pwaInstallDismissedAt"]` を ms epoch で書き、
 * 30 日以内は再表示しない。`IOsInstallHint` と同 storage key を共有する
 * （`install-dismiss-storage.ts` で集約管理）。
 */

// `BeforeInstallPromptEvent` は標準 lib.dom.d.ts に存在しないため structural type で表現する。
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function PwaInstallPromotion() {
  const [event, setEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    if (isWithinPwaInstallDismissTtl(readPwaInstallDismissedAt())) {
      setDismissed(true);
      return;
    }

    const onBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setEvent(e as BeforeInstallPromptEvent);
    };
    const onAppInstalled = () => {
      setEvent(null);
      setDismissed(true);
      persistPwaInstallDismissedAt(Date.now());
      logger.info("pwa install completed");
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onAppInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onAppInstalled);
    };
  }, []);

  const onInstallClick = useCallback(async () => {
    if (!event) return;
    const current = event;
    // 同じ event インスタンスは prompt() を 2 回呼べない。state を即時に倒し、
    // 次の beforeinstallprompt 発火を待つ（dismissed のときは appinstalled は
    // 来ないので、こちらで dismissedAt を書く）。
    setEvent(null);
    try {
      await current.prompt();
      const choice = await current.userChoice;
      logger.info("pwa install prompt resolved", { outcome: choice.outcome });
      if (choice.outcome === "dismissed") {
        persistPwaInstallDismissedAt(Date.now());
        setDismissed(true);
      }
      // accepted 時は appinstalled 受信時に hide / persist する（既存の listener が拾う）。
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "pwa/install-prompt-failed",
        "インストールプロンプトの起動に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code });
      // 失敗時もユーザを煩わせないよう dismissed として TTL に乗せる。
      persistPwaInstallDismissedAt(Date.now());
      setDismissed(true);
    }
  }, [event]);

  const onCloseClick = useCallback(() => {
    persistPwaInstallDismissedAt(Date.now());
    setEvent(null);
    setDismissed(true);
    logger.info("pwa install dismissed", { reason: "user-click" });
  }, []);

  if (dismissed || !event) return null;

  return (
    <section
      role="region"
      aria-label="アプリのインストール案内"
      className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-3 py-2 text-sm dark:border-amber-700 dark:bg-amber-900/20"
      data-testid="pwa-install-promotion"
    >
      <Download aria-hidden className="h-4 w-4 shrink-0" />
      <span className="flex-1">
        アプリをホーム画面に追加すると会場運用が 1 タップで起動できます
      </span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          onClick={onInstallClick}
          data-testid="pwa-install-accept"
        >
          ホーム画面に追加
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={onCloseClick}
          aria-label="インストール案内を閉じる"
          data-testid="pwa-install-dismiss"
        >
          <X aria-hidden className="h-4 w-4" />
          今は閉じる
        </Button>
      </div>
    </section>
  );
}
