"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TournamentForm } from "@/components/tournament/TournamentForm";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import {
  getTournament,
  updateTournament,
} from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

export function TournamentEditClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const [data, setData] = useState<TournamentDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournament(tid);
        if (!cancelled) setData(t);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tid]);

  if (!user) return null;

  if (error) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">
        読込中…
      </main>
    );
  }
  if (data.state !== "setup") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-destructive" role="alert">
          tournament/already-started:
          このトーナメントは既に開始されているため編集できません（state={data.state}）。
        </p>
      </main>
    );
  }
  if (data.ownerUid !== user.uid) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-destructive" role="alert">
          firestore/permission-denied: 自分のトーナメントのみ編集できます。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">トーナメントを編集</h1>
      <TournamentForm
        ownerUid={user.uid}
        initialName={data.name}
        initialSnapshot={data.structureSnapshot}
        onSubmit={async ({ name, snapshot }) => {
          await updateTournament(tid, { name, structureSnapshot: snapshot });
          router.push(`/tournaments/${tid}`);
        }}
        onCancel={() => router.push(`/tournaments/${tid}`)}
        submitLabel="更新"
      />
    </main>
  );
}
