"use client";

import { CloudOff, Loader2 } from "lucide-react";

interface OfflineBannerProps {
  fromCache: boolean;
  hasPendingWrites: boolean;
}

/**
 * 通信状態を運用者に伝える toast。3 状態を 1 つの帯で扱う。
 *
 * - `fromCache=true`               → 「⚠ 通信が一時切れています」（amber）
 *     auto-advance fallback / pending writes が queue に乗っている可能性。本バナー単独で
 *     ConnectionBadge より目立たせ、運営者が「ボタン反応がない」と誤認するのを防ぐ。
 * - `fromCache=false && hasPendingWrites=true`  → 「⏳ 同期中…」（blue）
 *     online 復帰直後で書込キューを flush 中。短時間で消える設計（数秒）。
 * - `fromCache=false && hasPendingWrites=false` → null（占有領域 0）
 *
 * 画面下部の固定位置（fixed）に配置することで、表示／非表示で
 * タイマーや他カードの位置が上下しないようにしている（フローを占有しない）。
 * 旧実装は `<main>` 直下のフロー要素で、表示の度に下要素が縦シフトしていた。
 */
export function OfflineBanner({ fromCache, hasPendingWrites }: OfflineBannerProps) {
  // 共通の toast コンテナ class。bottom 余白は iOS PWA の safe-area を考慮。
  const containerCls =
    "pointer-events-none fixed inset-x-0 z-40 flex justify-center px-3" +
    " bottom-[max(1rem,env(safe-area-inset-bottom))]";

  if (fromCache) {
    return (
      <div className={containerCls}>
        <section
          role="note"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm shadow-lg dark:border-amber-700 dark:bg-amber-900/95"
          data-testid="offline-banner-disconnected"
        >
          <CloudOff aria-hidden className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            通信が一時切れています — 操作は端末に保存され、復帰時に自動同期されます
          </span>
        </section>
      </div>
    );
  }
  if (hasPendingWrites) {
    return (
      <div className={containerCls}>
        <section
          role="status"
          aria-live="polite"
          className="pointer-events-auto flex w-full max-w-md flex-wrap items-center gap-2 rounded-md border border-blue-300 bg-blue-50 px-3 py-2 text-sm shadow-lg dark:border-blue-700 dark:bg-blue-900/95"
          data-testid="offline-banner-syncing"
        >
          <Loader2 aria-hidden className="h-4 w-4 shrink-0 animate-spin" />
          <span className="flex-1">同期中… 端末からの操作をサーバへ送信しています</span>
        </section>
      </div>
    );
  }
  return null;
}
