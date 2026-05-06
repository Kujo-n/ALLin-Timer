"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getGroup } from "@/lib/firebase/repositories/groups";
import { subscribeSeasonStats } from "@/lib/firebase/repositories/seasonStats";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";
import { logger } from "@/lib/logger";

/**
 * Phase A: シーズンランキング画面。group メンバー全員 read 可。
 *
 *  - `subscribeSeasonStats` で realtime 購読し、`totalPoints desc` で並べる
 *  - 開始日は group の `seasonStartDate`（未設定なら「未設定」表示）
 *  - 非メンバーは rule 側で permission-denied、エラーメッセージで弾く
 */
export function SeasonRankingClient({ gid }: { gid: string }) {
  const { user } = useAuthUser();
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [stats, setStats] = useState<SeasonStatsDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let canceled = false;
    void (async () => {
      try {
        const g = await getGroup(gid);
        if (!canceled) setGroup(g);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code, gid });
        if (!canceled) setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [gid, user]);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeSeasonStats(
      gid,
      (items) => setStats(items),
      (err) => setError(`${err.code}: ${err.message}`),
    );
    return unsub;
  }, [gid, user]);

  if (!user) return null;
  if (error) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Link href={`/groups/${gid}`}>
          <Button variant="outline">サークル詳細へ</Button>
        </Link>
      </main>
    );
  }
  if (!group) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">
        読込中…
      </main>
    );
  }

  const startDate = group.seasonStartDate
    ? group.seasonStartDate.toDate().toLocaleDateString("ja-JP")
    : "未設定";

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">シーズンランキング</h1>
          <p className="text-sm text-muted-foreground">{group.name}</p>
          <p className="text-xs text-muted-foreground">現在シーズン開始: {startDate}</p>
        </div>
        <Link href={`/groups/${gid}`}>
          <Button variant="outline" size="sm">
            サークル詳細
          </Button>
        </Link>
      </div>

      {stats.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          このシーズンの戦績はまだありません。トーナメントが終了すると自動的に記録されます。
        </p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="py-2 text-left">順位</th>
              <th className="py-2 text-left">表示名</th>
              <th className="py-2 text-right">参加</th>
              <th className="py-2 text-right">優勝</th>
              <th className="py-2 text-right">FT</th>
              <th className="py-2 text-right">累計ポイント</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={s.id} className="border-b">
                <td className="py-2">{i + 1}</td>
                <td className="py-2">{s.displayName}</td>
                <td className="py-2 text-right">{s.participations}</td>
                <td className="py-2 text-right">{s.wins}</td>
                <td className="py-2 text-right">{s.finalTables}</td>
                <td className="py-2 text-right font-semibold">
                  {s.totalPoints.toFixed(2)} pt
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
