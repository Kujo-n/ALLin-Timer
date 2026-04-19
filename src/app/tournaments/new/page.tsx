import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireGroup } from "@/components/auth/RequireGroup";

import { TournamentNewClient } from "./tournament-new-client";

export default function TournamentNewPage() {
  return (
    <RequireAuth>
      <RequireGroup>
        <TournamentNewClient />
      </RequireGroup>
    </RequireAuth>
  );
}
