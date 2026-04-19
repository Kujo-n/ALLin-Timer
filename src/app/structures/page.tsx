import { RequireAuth } from "@/components/auth/RequireAuth";

import { StructuresClient } from "./structures-client";

export default function StructuresPage() {
  return (
    <RequireAuth>
      <StructuresClient />
    </RequireAuth>
  );
}
