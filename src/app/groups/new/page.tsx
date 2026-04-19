import { RequireAuth } from "@/components/auth/RequireAuth";

import { GroupNewClient } from "./group-new-client";

export default function GroupNewPage() {
  return (
    <RequireAuth>
      <GroupNewClient />
    </RequireAuth>
  );
}
