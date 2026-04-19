import { RequireAuth } from "@/components/auth/RequireAuth";

import { StructureNewClient } from "./structure-new-client";

export default function StructureNewPage() {
  return (
    <RequireAuth>
      <StructureNewClient />
    </RequireAuth>
  );
}
