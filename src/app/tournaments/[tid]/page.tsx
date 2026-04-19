import { RequireAuth } from "@/components/auth/RequireAuth";

import { DashboardClient } from "./dashboard-client";

export default async function TournamentPage({
  params,
}: {
  params: Promise<{ tid: string }>;
}) {
  const { tid } = await params;
  return (
    <RequireAuth>
      <DashboardClient tid={tid} />
    </RequireAuth>
  );
}
