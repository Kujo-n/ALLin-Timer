"use client";

import { useRouter } from "next/navigation";

import { TournamentForm } from "@/components/tournament/TournamentForm";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { createTournament } from "@/lib/firebase/repositories/tournaments";
import { useCurrentGroup } from "@/lib/services/current-group";

export function TournamentNewClient() {
  const { user } = useAuthUser();
  const router = useRouter();
  const { currentGroupId } = useCurrentGroup();
  if (!user || !currentGroupId) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">トーナメントを新規作成</h1>
      <TournamentForm
        groupId={currentGroupId}
        onSubmit={async ({ name, snapshot, seatsPerTable }) => {
          const tid = await createTournament({
            groupId: currentGroupId,
            createdByUid: user.uid,
            name,
            structureSnapshot: snapshot,
            seatsPerTable,
          });
          router.push(`/tournaments/${tid}`);
        }}
        onCancel={() => router.push("/tournaments")}
        submitLabel="作成"
      />
    </main>
  );
}
