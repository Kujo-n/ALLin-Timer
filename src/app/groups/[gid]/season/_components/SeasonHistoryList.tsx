"use client";

import { ChevronDown, ChevronRight } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { unwrapOrFrom } from "@/lib/errors";
import { listSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";
import { logger } from "@/lib/logger";

/**
 * Phase D: 過去シーズンの履歴一覧。`endedAt desc` 順で accordion 表示。
 *
 *  - 1 度だけ fetch（subscribe しない、append-only / 閲覧頻度低）
 *  - 0 件のときセクションごと非表示
 *  - 個別エントリの展開で top3 まで表示
 *
 *  `listSeasonHistory` は内部で `wrapFirestoreRead` 経由で AppError ラップ済のため、
 *  UI 側では `unwrapOrFrom` で既存 wrap を尊重して二重 warn を避ける。
 */
export function SeasonHistoryList({ gid }: { gid: string }) {
  const [items, setItems] = useState<SeasonHistoryDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
          setError(`${wrapped.code}: ${wrapped.message}`);
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
          const top3 = sortedEntries.slice(0, 3);
          const isOpen = expanded.has(h.id);
          return (
            <li
              key={h.id}
              className="rounded-md border p-3"
              data-testid={`season-history-item-${h.id}`}
            >
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start gap-2 px-1"
                aria-expanded={isOpen}
                data-testid={`season-history-toggle-${h.id}`}
                onClick={() => {
                  setExpanded((prev) => {
                    const next = new Set(prev);
                    if (next.has(h.id)) {
                      next.delete(h.id);
                    } else {
                      next.add(h.id);
                    }
                    return next;
                  });
                }}
              >
                {isOpen ? (
                  <ChevronDown aria-hidden />
                ) : (
                  <ChevronRight aria-hidden />
                )}
                <span>
                  {formatRange(h.startedAt, h.endedAt)}
                  {top1
                    ? ` — 首位: ${top1.displayName} ${top1.totalPoints.toFixed(2)} pt`
                    : " — 戦績なし"}
                </span>
              </Button>
              {isOpen && top3.length > 0 ? (
                <ol className="ml-6 mt-2 list-decimal text-sm">
                  {top3.map((e) => (
                    <li key={e.uid}>
                      {e.displayName} — {e.totalPoints.toFixed(2)} pt
                      <span className="text-muted-foreground">
                        {" "}
                        （参加 {e.participations} / 優勝 {e.wins}）
                      </span>
                    </li>
                  ))}
                </ol>
              ) : null}
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
