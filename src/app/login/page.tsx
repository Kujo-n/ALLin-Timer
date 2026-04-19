import { Suspense } from "react";

import { LoginClient } from "./login-client";

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="mx-auto max-w-md p-8 text-sm text-muted-foreground">
          読込中…
        </main>
      }
    >
      <LoginClient />
    </Suspense>
  );
}
