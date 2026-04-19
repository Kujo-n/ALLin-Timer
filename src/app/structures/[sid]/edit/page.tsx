import { RequireAuth } from "@/components/auth/RequireAuth";
import { RequireGroup } from "@/components/auth/RequireGroup";

import { StructureEditClient } from "./structure-edit-client";

export default async function StructureEditPage({ params }: { params: Promise<{ sid: string }> }) {
  const { sid } = await params;
  return (
    <RequireAuth>
      <RequireGroup>
        <StructureEditClient sid={sid} />
      </RequireGroup>
    </RequireAuth>
  );
}
