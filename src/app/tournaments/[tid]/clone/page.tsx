import { RequireAuth } from "@/components/auth/RequireAuth";

import { CloneClient } from "./clone-client";

export default async function TournamentClonePage({
  params,
}: {
  params: Promise<{ tid: string }>;
}) {
  const { tid } = await params;
  return (
    <RequireAuth>
      <CloneClient tid={tid} />
    </RequireAuth>
  );
}
