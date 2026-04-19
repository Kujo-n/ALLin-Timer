import { RequireAuth } from "@/components/auth/RequireAuth";

import { TournamentsClient } from "./tournaments-client";

export default function TournamentsPage() {
  return (
    <RequireAuth>
      <TournamentsClient />
    </RequireAuth>
  );
}
