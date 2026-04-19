import { notFound } from "next/navigation";

import { DebugFsClient } from "./debug-fs-client";

// Gate: only serve this debug route when NEXT_PUBLIC_ENABLE_DEBUG=1.
// Local `.env.local` and Vercel Preview should opt in; Vercel Production
// leaves it unset so the route 404s in public.
export default function DebugFsPage() {
  if (process.env.NEXT_PUBLIC_ENABLE_DEBUG !== "1") {
    notFound();
  }
  return <DebugFsClient />;
}
