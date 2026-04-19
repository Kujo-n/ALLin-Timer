"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useAuthUser } from "@/lib/firebase/AuthProvider";

export function RequireAuth({
  children,
  allowAnonymous = false,
}: {
  children: ReactNode;
  allowAnonymous?: boolean;
}) {
  const { user, loading } = useAuthUser();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (loading) return;
    if (!user || (!allowAnonymous && user.isAnonymous)) {
      const target = pathname ?? "/";
      router.replace(`/login?redirect=${encodeURIComponent(target)}`);
    }
  }, [user, loading, router, pathname, allowAnonymous]);

  if (loading) return <p className="p-8 text-sm text-muted-foreground">読込中…</p>;
  if (!user) return null;
  if (!allowAnonymous && user.isAnonymous) return null;
  return <>{children}</>;
}
