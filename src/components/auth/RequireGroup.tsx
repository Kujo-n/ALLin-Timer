"use client";

import { useRouter } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { useCurrentGroup } from "@/lib/services/current-group";

export function RequireGroup({ children }: { children: ReactNode }) {
  const { loading, groupIds, currentGroupId, setCurrentGroupId } = useCurrentGroup();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (groupIds.length === 0) {
      router.replace("/groups?empty=1");
      return;
    }
    if (!currentGroupId || !groupIds.includes(currentGroupId)) {
      setCurrentGroupId(groupIds[0]);
    }
  }, [loading, groupIds, currentGroupId, router, setCurrentGroupId]);

  if (loading) {
    return <p className="p-8 text-sm text-muted-foreground">サークル情報を読込中…</p>;
  }
  if (groupIds.length === 0) return null;
  if (!currentGroupId || !groupIds.includes(currentGroupId)) return null;
  return <>{children}</>;
}
