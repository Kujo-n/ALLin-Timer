"use client";

import { cn } from "@/lib/utils";

interface Props {
  fromCache: boolean;
  /** 最後にサーバから snapshot を受けた時刻（Date.now()）。null は未取得。 */
  lastSyncAt: number | null;
}

function formatTime(ms: number | null): string {
  if (ms === null) return "--:--:--";
  return new Date(ms).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ConnectionBadge({ fromCache, lastSyncAt }: Props) {
  const offline = fromCache;
  const dateTime = lastSyncAt !== null ? new Date(lastSyncAt).toISOString() : undefined;
  // aria-live は状態テキスト（接続切れ / 同期中）だけに絞ることで、
  // 毎 snapshot の時刻更新で SR が読み上げ続ける問題を回避する。
  return (
    <span
      role="status"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        offline
          ? "bg-destructive/10 text-destructive"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <span aria-hidden="true">{offline ? "⛔" : "●"}</span>
      <span aria-live="polite" aria-atomic="true">
        {offline ? "接続切れ 最終" : "同期中"}
      </span>
      <time dateTime={dateTime} aria-hidden="true">
        {formatTime(lastSyncAt)}
      </time>
    </span>
  );
}
