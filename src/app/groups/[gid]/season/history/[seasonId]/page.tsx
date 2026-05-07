import { RequireAuth } from "@/components/auth/RequireAuth";

import { SeasonHistoryDetailClient } from "./season-history-detail-client";

export default async function SeasonHistoryDetailPage({
  params,
}: {
  params: Promise<{ gid: string; seasonId: string }>;
}) {
  const { gid, seasonId } = await params;
  return (
    <RequireAuth>
      <SeasonHistoryDetailClient gid={gid} seasonId={seasonId} />
    </RequireAuth>
  );
}
