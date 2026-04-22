"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { consumeJoinCode } from "@/lib/services/group";

type Status =
  | { kind: "pending" }
  | { kind: "success"; gid: string; alreadyMember: boolean }
  | { kind: "error"; code: string; message: string };

export function JoinGroupClient({ code }: { code: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { setCurrentGroupId, refreshGroups } = useCurrentGroup();
  const [status, setStatus] = useState<Status>({ kind: "pending" });
  const ranRef = useRef(false);

  useEffect(() => {
    if (!user) return;
    if (ranRef.current) return;
    ranRef.current = true;

    (async () => {
      try {
        const { gid, alreadyMember } = await consumeJoinCode({
          code,
          uid: user.uid,
        });
        setCurrentGroupId(gid);
        await refreshGroups();
        setStatus({ kind: "success", gid, alreadyMember });
        router.push(`/groups/${gid}`);
      } catch (e) {
        const wrapped = AppError.from(e, "group/join-failed", "サークル加入に失敗しました");
        logger.warn(wrapped.message, { code: wrapped.code });
        setStatus({
          kind: "error",
          code: wrapped.code,
          message: wrapped.message,
        });
      }
    })();
  }, [user, code, router, setCurrentGroupId, refreshGroups]);

  if (!user) return null;

  return (
    <main className="mx-auto max-w-xl space-y-4 p-8">
      <h1 className="text-2xl font-bold">サークルに加入</h1>
      {status.kind === "pending" ? (
        <p className="text-sm text-muted-foreground">招待コードを処理中…</p>
      ) : null}
      {status.kind === "success" ? (
        <p className="text-sm">
          {status.alreadyMember
            ? "既に加入済みです。"
            : "一般メンバーとして加入しました。運営権限はオーナーにご相談ください。"}
          サークルに移動します…
        </p>
      ) : null}
      {status.kind === "error" ? (
        <div className="space-y-3">
          <p className="text-sm text-destructive" role="alert">
            {status.code}: {status.message}
          </p>
          <Link href="/groups">
            <Button variant="outline">サークル一覧へ</Button>
          </Link>
        </div>
      ) : null}
    </main>
  );
}
