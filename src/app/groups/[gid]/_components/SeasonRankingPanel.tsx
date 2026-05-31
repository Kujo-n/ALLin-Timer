"use client";

import { useEffect, useState } from "react";

import { SeasonRankingTable } from "@/components/group/SeasonRankingTable";
import { formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { subscribeSeasonStats } from "@/lib/firebase/repositories/seasonStats";
import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";

/**
 * Phase 2 (06): サークル詳細「シーズン」タブにインライン表示する順位表 panel。
 *
 *  - `subscribeSeasonStats` で realtime 購読（season-ranking-client と同契約）
 *  - 初回 snapshot まで「読込中…」、0 件は案内文、>0 件で SeasonRankingTable
 *  - 自己完結（gid のみ受け取り内部で useAuthUser）。SeasonHistoryList と同方針
 *  - share / 履歴は `/groups/[gid]/season` に据え置き、本 panel は順位表のみ
 */
export function SeasonRankingPanel({ gid }: { gid: string }) {
  const { user } = useAuthUser();
  const [stats, setStats] = useState<SeasonStatsDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeSeasonStats(
      gid,
      (items) => {
        setStats(items);
        setLoading(false);
      },
      (err) => {
        setError(formatErrorForDisplay(err));
        setLoading(false);
      },
    );
    return unsub;
  }, [gid, user]);

  if (!user) return null;
  if (error) {
    return (
      <p className="text-sm text-destructive" role="alert">
        {error}
      </p>
    );
  }
  if (loading) {
    return <p className="text-sm text-muted-foreground">順位を読込中…</p>;
  }
  if (stats.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        このシーズンの戦績はまだありません。トーナメントが終了すると自動的に記録されます。
      </p>
    );
  }
  return (
    <section className="space-y-2" data-testid="season-ranking-inline">
      <h2 className="text-lg font-semibold">今シーズンの順位</h2>
      <SeasonRankingTable rows={stats} />
    </section>
  );
}
