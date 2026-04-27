"use client";

import { cn } from "@/lib/utils";

interface Props {
  fromCache: boolean;
  /** 最後にサーバから snapshot を受けた時刻（Date.now()）。null は未取得。 */
  lastSyncAt: number | null;
  /**
   * Phase 4.14 追加要望: 縦組みレイアウト。
   *   - "inline"（default）: アイコン・ラベル・時刻を 1 行で並べる（live ヘッダ等）
   *   - "stacked": ラベル行（アイコン+テキスト）と時刻行を 2 行で表示する。
   *     dashboard の TimerControls 内に置いた際、横幅を抑えて再生アイコンが
   *     タイマー中央と揃うようにするための簡易レイアウト。
   */
  layout?: "inline" | "stacked";
}

function formatTime(ms: number | null): string {
  if (ms === null) return "--:--:--";
  return new Date(ms).toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function ConnectionBadge({ fromCache, lastSyncAt, layout = "inline" }: Props) {
  const offline = fromCache;
  const dateTime = lastSyncAt !== null ? new Date(lastSyncAt).toISOString() : undefined;
  const stacked = layout === "stacked";
  // aria-live は状態テキスト（接続切れ / 同期中）だけに絞ることで、
  // 毎 snapshot の時刻更新で SR が読み上げ続ける問題を回避する。
  return (
    <span
      role="status"
      className={cn(
        "rounded-full text-xs font-medium",
        stacked
          ? "inline-flex flex-col items-center gap-0.5 px-2 py-1 leading-tight"
          : "inline-flex items-center gap-1 px-2 py-0.5",
        offline
          ? "bg-destructive/10 text-destructive"
          : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
      )}
    >
      <span className={cn(stacked ? "inline-flex items-center gap-1" : "contents")}>
        <span aria-hidden="true">{offline ? "⛔" : "●"}</span>
        <span aria-live="polite" aria-atomic="true">
          {offline ? "接続切れ 最終" : "同期中"}
        </span>
      </span>
      <time dateTime={dateTime} aria-hidden="true">
        {formatTime(lastSyncAt)}
      </time>
    </span>
  );
}
