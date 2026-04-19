import { RequireAuth } from "@/components/auth/RequireAuth";

import { SettingsClient } from "./settings-client";

export default function SettingsPage() {
  return (
    <RequireAuth allowAnonymous>
      <SettingsClient />
    </RequireAuth>
  );
}
