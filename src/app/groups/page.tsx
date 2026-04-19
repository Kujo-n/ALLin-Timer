import { RequireAuth } from "@/components/auth/RequireAuth";

import { GroupsClient } from "./groups-client";

export default function GroupsPage() {
  return (
    <RequireAuth>
      <GroupsClient />
    </RequireAuth>
  );
}
