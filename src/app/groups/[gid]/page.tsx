import { RequireAuth } from "@/components/auth/RequireAuth";

import { GroupDetailClient } from "./group-detail-client";

export default async function GroupDetailPage({ params }: { params: Promise<{ gid: string }> }) {
  const { gid } = await params;
  return (
    <RequireAuth>
      <GroupDetailClient gid={gid} />
    </RequireAuth>
  );
}
