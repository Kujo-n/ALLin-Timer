import { RequireAuth } from "@/components/auth/RequireAuth";

import { TournamentEditClient } from "./tournament-edit-client";

export default async function TournamentEditPage({ params }: { params: Promise<{ tid: string }> }) {
  const { tid } = await params;
  return (
    <RequireAuth>
      <TournamentEditClient tid={tid} />
    </RequireAuth>
  );
}
