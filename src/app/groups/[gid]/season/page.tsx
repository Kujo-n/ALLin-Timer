import { RequireAuth } from "@/components/auth/RequireAuth";

import { SeasonRankingClient } from "./season-ranking-client";

export default async function SeasonPage({
  params,
}: {
  params: Promise<{ gid: string }>;
}) {
  const { gid } = await params;
  return (
    <RequireAuth>
      <SeasonRankingClient gid={gid} />
    </RequireAuth>
  );
}
