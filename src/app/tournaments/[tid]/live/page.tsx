import type { Viewport } from "next";

import { RequireAuth } from "@/components/auth/RequireAuth";

import { LiveClient } from "./live-client";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function LivePage({ params }: { params: Promise<{ tid: string }> }) {
  const { tid } = await params;
  return (
    <RequireAuth allowAnonymous>
      <LiveClient tid={tid} />
    </RequireAuth>
  );
}
