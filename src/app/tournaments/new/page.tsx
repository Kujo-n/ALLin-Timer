import { RequireAuth } from "@/components/auth/RequireAuth";

import { TournamentNewClient } from "./tournament-new-client";

export default function TournamentNewPage() {
  return (
    <RequireAuth>
      <TournamentNewClient />
    </RequireAuth>
  );
}
