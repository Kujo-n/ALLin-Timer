import { RequireAuth } from "@/components/auth/RequireAuth";

import { JoinGroupClient } from "./join-group-client";

export default async function JoinGroupPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <RequireAuth>
      <JoinGroupClient code={code} />
    </RequireAuth>
  );
}
