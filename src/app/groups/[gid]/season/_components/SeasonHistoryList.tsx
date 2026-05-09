"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { listSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";
import { logger } from "@/lib/logger";

/**
 * Phase D / improvement: 過去シーズンの履歴一覧。`endedAt desc` 順で行表示。
 *
 *  - 1 度だけ fetch（subscribe しない、append-only / 閲覧頻度低）
 *  - 0 件のときセクションごと非表示
 *  - 各 entry は「期間 + 首位」＋「詳細を見る」 Link で navigation に倒す
 *
 *  `listSeasonHistory` は内部で `wrapFirestoreRead` 経由で AppError ラップ済のため、
 *  UI 側では `unwrapOrFrom` で既存 wrap を尊重して二重 warn を避ける。
 */
export function SeasonHistoryList({ gid }: { gid: string }) {
  const [items, setItems] = useState<SeasonHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      try {
        const list = await listSeasonHistory(gid);
        if (!canceled) {
          setItems(list);
          setLoading(false);
        }
      } catch (e) {
        const wrapped = unwrapOrFrom(
          e,
          "firestore/read_failed",
          "シーズン履歴の取得に失敗しました",
        );
        // 内側で既に warn 済みのため、UI 側では debug ログのみ。
        logger.debug("season history fetch failed at UI", {
          code: wrapped.code,
          gid,
        });
        if (!canceled) {
          setError(formatErrorForDisplay(wrapped));
          setLoading(false);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [gid]);

  if (loading) {
    return (
      <p className="text-sm text-muted-foreground">過去シーズンを読込中…</p>
    );
  }
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (items.length === 0) {
    return null;
  }

  return (
    <section
      className="space-y-2"
      aria-labelledby="season-history-heading"
      data-testid="season-history-section"
    >
      <h2 id="season-history-heading" className="text-lg font-semibold">
        過去シーズン
      </h2>
      <ul className="space-y-1">
        {items.map((h) => {
          const sortedEntries = [...h.entries].sort(
            (a, b) => b.totalPoints - a.totalPoints,
          );
          const top1 = sortedEntries[0];
          const detailHref = `/groups/${gid}/season/history/${encodeURIComponent(h.id)}`;
          return (
            <li
              key={h.id}
              className="flex items-center justify-between gap-2 rounded-md border p-3"
              data-testid={`season-history-item-${h.id}`}
            >
              <span className="text-sm">
                {formatRange(h.startedAt, h.endedAt)}
                {top1
                  ? ` — 首位: ${top1.displayName} ${top1.totalPoints.toFixed(2)} pt`
                  : " — 戦績なし"}
              </span>
              <Button
                asChild
                variant="outline"
                size="sm"
                data-testid={`season-history-detail-link-${h.id}`}
              >
                <Link href={detailHref}>詳細を見る</Link>
              </Button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function formatRange(
  startedAt: SeasonHistoryDoc["startedAt"],
  endedAt: SeasonHistoryDoc["endedAt"],
): string {
  const startStr = startedAt
    ? startedAt.toDate().toLocaleDateString("ja-JP")
    : "未設定";
  const endStr = endedAt.toDate().toLocaleDateString("ja-JP");
  return `${startStr} 〜 ${endStr}`;
}
