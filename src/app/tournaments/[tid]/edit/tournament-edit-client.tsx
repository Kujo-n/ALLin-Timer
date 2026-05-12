"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { TournamentForm } from "@/components/tournament/TournamentForm";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getTournament, updateTournament } from "@/lib/firebase/repositories/tournaments";
import { deriveRole } from "@/lib/firebase/schemas/group";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { useCurrentGroup } from "@/lib/services/current-group";
import { canEdit } from "@/lib/services/tournament-state";

export function TournamentEditClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groupIds, groups } = useCurrentGroup();
  const [data, setData] = useState<TournamentDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournament(tid);
        if (!cancelled) setData(t);
      } catch (e) {
        // getTournament は内部で warn 済み。UI 表示のみここで担当する。
        const err = unwrapOrFrom(e, "firestore/read_failed", "取得失敗");
        if (!cancelled) setError(formatErrorForDisplay(err));
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
    return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }
  if (!canEdit(data)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-destructive" role="alert">
          tournament/already-started: このトーナメントは既に開始されているため編集できません（state=
          {data.state}）。
        </p>
      </main>
    );
  }
  if (!groupIds.includes(data.groupId)) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-destructive" role="alert">
          firestore/permission-denied: このサークルのメンバーのみ編集できます。
        </p>
      </main>
    );
  }
  const g = groups.find((x) => x.id === data.groupId);
  const role = g ? deriveRole(g, user.uid) : null;
  if (role !== "owner" && role !== "organizer") {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <p className="text-sm text-destructive" role="alert">
          firestore/permission-denied: 運営のみ編集できます。
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">トーナメントを編集</h1>
      <TournamentForm
        groupId={data.groupId}
        initialName={data.name}
        initialSnapshot={data.structureSnapshot}
        initialSeatsPerTable={data.seatsPerTable}
        onSubmit={async ({ name, snapshot, seatsPerTable }) => {
          await updateTournament(tid, {
            name,
            structureSnapshot: snapshot,
            seatsPerTable,
          });
          router.push(`/tournaments/${tid}`);
        }}
        onCancel={() => router.push(`/tournaments/${tid}`)}
        submitLabel="更新"
      />
    </main>
  );
}
