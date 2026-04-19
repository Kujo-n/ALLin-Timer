import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireGroup } from "@/components/auth/RequireGroup";

import { TournamentsClient } from "./tournaments-client";

export default function TournamentsPage() {
  return (
    <RequireAuth>
      <RequireGroup>
        <TournamentsClient />
      </RequireGroup>
    </RequireAuth>
  );
}
