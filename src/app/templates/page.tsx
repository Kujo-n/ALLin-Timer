import { RequireAuth } from "@/components/auth/RequireAuth";

import { TemplatesClient } from "./templates-client";

export default function TemplatesPage() {
  return (
    <RequireAuth>
      <TemplatesClient />
    </RequireAuth>
  );
}
