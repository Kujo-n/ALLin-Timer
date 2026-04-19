import { RequireAuth } from "@/components/auth/RequireAuth";

import { StructureEditClient } from "./structure-edit-client";

export default async function StructureEditPage({
  params,
}: {
  params: Promise<{ sid: string }>;
}) {
  const { sid } = await params;
  return (
    <RequireAuth>
      <StructureEditClient sid={sid} />
    </RequireAuth>
  );
}
