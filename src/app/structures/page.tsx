import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireGroup } from "@/components/auth/RequireGroup";

import { StructuresClient } from "./structures-client";

export default function StructuresPage() {
  return (
    <RequireAuth>
      <RequireGroup>
        <StructuresClient />
      </RequireGroup>
    </RequireAuth>
  );
}
