"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";

import { TournamentForm } from "@/components/tournament/TournamentForm";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { createTournament } from "@/lib/firebase/repositories/tournaments";
import { useCurrentGroup } from "@/lib/services/current-group";

export function TournamentNewClient() {
  const { user } = useAuthUser();
  const router = useRouter();
  const { currentGroupId, groups, isOrganizer, loading } = useCurrentGroup();

  // Phase 4.6: 一般メンバーは URL 直打ち対策で /tournaments にリダイレクト。
  useEffect(() => {
    if (loading) return;
    if (!isOrganizer) {
      router.replace("/tournaments");
    }
  }, [loading, isOrganizer, router]);

  // Phase 4.16: `[サークル名]トーナメント-X` を name 欄のデフォルト値として渡す
  //   （X = 終了済みトーナメント数 + 1）。`useCurrentGroup` 既ロードの `groups` から
  //   派生するため追加 fetch 不要。legacy doc は zod default で 0 として hydrate される。
  const defaultName = useMemo(() => {
    if (!currentGroupId) return "";
    const g = groups.find((x) => x.id === currentGroupId);
    if (!g) return "";
    const next = (g.finishedTournamentCount ?? 0) + 1;
    return `[${g.name}]トーナメント-${next}`;
  }, [currentGroupId, groups]);

  // Phase 4.17: サークル設定の `defaultSeatsPerTable` を新規作成画面の初期値として流し込む。
  //   `useCurrentGroup` が既に `groups` を fetch 済みのため追加 read は不要。legacy doc（未設定）
  //   は zod default で 9 として hydrate されるため undefined はほぼ発生しないが、
  //   コンテキストから group が見つからないケース（race / 切替直後）に備えて undefined を許容する。
  const defaultSeatsPerTable = useMemo(() => {
    if (!currentGroupId) return undefined;
    const g = groups.find((x) => x.id === currentGroupId);
    return g?.defaultSeatsPerTable;
  }, [currentGroupId, groups]);

  if (!user || !currentGroupId) return null;
  if (loading || !isOrganizer) {
    return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">トーナメントを新規作成</h1>
      <TournamentForm
        groupId={currentGroupId}
        initialName={defaultName}
        initialSeatsPerTable={defaultSeatsPerTable}
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
