import { RequireAuth } from "@/components/auth/RequireAuth";

import { TemplateNewClient } from "./template-new-client";

export default function TemplateNewPage() {
  return (
    <RequireAuth>
      <TemplateNewClient />
    </RequireAuth>
  );
}
