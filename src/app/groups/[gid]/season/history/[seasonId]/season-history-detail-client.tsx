"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { buildSeasonShareInputs } from "@/app/api/og/_lib/og-payload";
import { SeasonRankingTable } from "@/components/group/SeasonRankingTable";
import { SeasonTopCardDownloadButton } from "@/components/group/SeasonTopCardDownloadButton";
import { ShareCardButton } from "@/components/share/_share-button/ShareCardButton";
import { formatSeasonShareText } from "@/components/share/_share-button/share-text";
import { Button } from "@/components/ui/button";
import { unwrapOrFrom } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getGroup } from "@/lib/firebase/repositories/groups";
import { getSeasonHistory } from "@/lib/firebase/repositories/seasonHistory";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { SeasonHistoryDoc } from "@/lib/firebase/schemas/seasonHistory";
import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";
import { logger } from "@/lib/logger";

/**
 * Phase D improvement: 過去シーズンの全員分ランキングを表示する詳細ページ。
 *
 *  - getGroup + getSeasonHistory を 1 度ずつ並列 fetch
 *  - `firestore/not-found` および `firestore/permission-denied` は NotFound UI に倒し、
 *    seasonId の存在有無や認可情報を leak しない
 *  - それ以外の失敗（`firestore/read_failed` 等）は role=alert + 戻りリンク
 */
const NOT_FOUND_LIKE_CODES = new Set<string>([
  "firestore/not-found",
  "firestore/permission-denied",
]);
export function SeasonHistoryDetailClient({
  gid,
  seasonId,
}: {
  gid: string;
  seasonId: string;
}) {
  const { user } = useAuthUser();
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [history, setHistory] = useState<SeasonHistoryDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let canceled = false;
    void (async () => {
      try {
        const [g, h] = await Promise.all([
          getGroup(gid),
          getSeasonHistory(gid, seasonId),
        ]);
        if (canceled) return;
        setGroup(g);
        setHistory(h);
        setLoading(false);
      } catch (e) {
        const wrapped = unwrapOrFrom(
          e,
          "firestore/read_failed",
          "シーズン履歴の取得に失敗しました",
        );
        logger.debug("season history detail fetch failed", {
          code: wrapped.code,
          gid,
          seasonId,
        });
        if (!canceled) {
          setErrorCode(wrapped.code);
          setLoading(false);
        }
      }
    })();
    return () => {
      canceled = true;
    };
  }, [gid, seasonId, user]);

  if (!user) return null;
  if (loading) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">
        読込中…
      </main>
    );
  }
  if (errorCode && NOT_FOUND_LIKE_CODES.has(errorCode)) {
    return <NotFound gid={gid} />;
  }
  if (errorCode || !group || !history) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <p className="text-sm text-destructive" role="alert">
          {errorCode ?? "firestore/read_failed"}: シーズン履歴の取得に失敗しました
        </p>
        <Link href={`/groups/${gid}/season`}>
          <Button variant="outline">現在シーズンへ戻る</Button>
        </Link>
      </main>
    );
  }

  const sortedEntries = [...history.entries].sort(
    (a, b) => b.totalPoints - a.totalPoints,
  );
  const startedAtLabel = history.startedAt
    ? history.startedAt.toDate().toLocaleDateString("ja-JP")
    : "未設定";
  const endedAtLabel = history.endedAt.toDate().toLocaleDateString("ja-JP");

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">シーズン履歴</h1>
          <p className="text-sm text-muted-foreground">{group.name}</p>
          <p className="text-xs text-muted-foreground">
            期間: {startedAtLabel} 〜 {endedAtLabel}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/groups/${gid}/season`}>
            <Button variant="outline" size="sm">
              現在シーズンへ
            </Button>
          </Link>
          <Link href={`/groups/${gid}`}>
            <Button variant="outline" size="sm">
              サークル詳細
            </Button>
          </Link>
        </div>
      </div>

      {sortedEntries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          このシーズンの記録はありません。
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {(() => {
              const groupForShare = {
                name: group.name,
                seasonStartDate: history.startedAt,
              };
              const shareInputs = buildSeasonShareInputs(
                gid,
                groupForShare,
                sortedEntries,
                { cardBackground: group.seasonCardBackground },
              );
              if (!shareInputs) return null;
              const top1 = sortedEntries[0];
              const shareText = formatSeasonShareText({
                groupName: group.name,
                top1Name: top1.displayName,
                top1Points: top1.totalPoints,
              });
              return (
                <ShareCardButton
                  url={shareInputs.url}
                  filenameStem={shareInputs.filenameStem}
                  shareText={shareText}
                  kind="season"
                  label="過去シーズン首位をシェア"
                  dataTestId="past-season-top-card-share"
                />
              );
            })()}
            <SeasonTopCardDownloadButton
              gid={gid}
              group={{ name: group.name, seasonStartDate: history.startedAt }}
              stats={sortedEntries.map<SeasonStatsDoc>((e) => ({
                ...e,
                id: e.uid,
                lastUpdatedAt: history.endedAt,
              }))}
              cardBackground={group.seasonCardBackground}
            />
          </div>
          <SeasonRankingTable
            rows={sortedEntries.map((e) => ({
              id: e.uid,
              displayName: e.displayName,
              participations: e.participations,
              wins: e.wins,
              finalTables: e.finalTables,
              totalPoints: e.totalPoints,
            }))}
          />
        </>
      )}
    </main>
  );
}

function NotFound({ gid }: { gid: string }) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">シーズン履歴 — 見つかりません</h1>
      <p className="text-sm text-muted-foreground">
        指定されたシーズン ID は存在しないか、閲覧権限がありません。
      </p>
      <Link href={`/groups/${gid}/season`}>
        <Button variant="outline">現在シーズンへ戻る</Button>
      </Link>
    </main>
  );
}
