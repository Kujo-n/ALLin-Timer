import { RequireAuth } from "@/components/auth/RequireAuth";

import { TemplateEditClient } from "./template-edit-client";

export default async function TemplateEditPage({
  params,
}: {
  params: Promise<{ tid: string }>;
}) {
  const { tid } = await params;
  return (
    <RequireAuth>
      <TemplateEditClient tid={tid} />
    </RequireAuth>
  );
}
