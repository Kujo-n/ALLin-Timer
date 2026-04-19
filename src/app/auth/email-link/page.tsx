import { Suspense } from "react";

import { EmailLinkClient } from "./email-link-client";

export default function EmailLinkPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md p-8 text-sm text-muted-foreground">
          読込中…
        </main>
      }
    >
      <EmailLinkClient />
    </Suspense>
  );
}
