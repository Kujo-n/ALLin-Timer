import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireGroup } from "@/components/auth/RequireGroup";

import { StructureNewClient } from "./structure-new-client";

export default function StructureNewPage() {
  return (
    <RequireAuth>
      <RequireGroup>
        <StructureNewClient />
      </RequireGroup>
    </RequireAuth>
  );
}
