"use client";

import { useRouter } from "next/navigation";

import { TournamentForm } from "@/components/tournament/TournamentForm";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { createTournament } from "@/lib/firebase/repositories/tournaments";

export function TournamentNewClient() {
  const { user } = useAuthUser();
  const router = useRouter();
  if (!user) return null;

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">トーナメントを新規作成</h1>
      <TournamentForm
        ownerUid={user.uid}
        onSubmit={async ({ name, snapshot }) => {
          const tid = await createTournament({
            ownerUid: user.uid,
            name,
            structureSnapshot: snapshot,
          });
          router.push(`/tournaments/${tid}`);
        }}
        onCancel={() => router.push("/tournaments")}
        submitLabel="作成"
      />
    </main>
  );
}
