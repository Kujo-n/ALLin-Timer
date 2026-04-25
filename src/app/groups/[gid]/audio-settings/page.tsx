import { RequireAuth } from "@/components/auth/RequireAuth";

import { AudioSettingsClient } from "./audio-settings-client";

export default async function AudioSettingsPage({
  params,
}: {
  params: Promise<{ gid: string }>;
}) {
  const { gid } = await params;
  return (
    <RequireAuth allowAnonymous={false}>
      <AudioSettingsClient gid={gid} />
    </RequireAuth>
  );
}
