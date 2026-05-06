"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  ClonePlayersChecklist,
  initialSelectedIdsFromPlayers,
} from "@/components/tournament/ClonePlayersChecklist";
import { TournamentForm } from "@/components/tournament/TournamentForm";
import { Button } from "@/components/ui/button";
import { AppError, unwrapOrFrom } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { subscribePlayers } from "@/lib/firebase/repositories/players";
import { subscribeTournament } from "@/lib/firebase/repositories/tournaments";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { useGroupRole } from "@/lib/hooks/useGroupRole";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { cloneTournamentWithPlayers } from "@/lib/services/tournament-clone";
import { canClone } from "@/lib/services/tournament-state";

export function CloneClient({ tid }: { tid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { groups, loading: groupsLoading } = useCurrentGroup();

  const [src, setSrc] = useState<TournamentDoc | null>(null);
  const [players, setPlayers] = useState<PlayerDoc[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // 初回 load で default 集合を構築したかどうか。以降のユーザー toggle 操作を上書きしないために使う。
  // ref 化して setState を介さないため React の依存配列に乗せず、setPlayers の onNext 内で同期参照する。
  const selectedHydratedRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const unsub = subscribeTournament(
      tid,
      ({ doc }) => {
        if (!doc) {
          setError("対象トーナメントが見つかりません");
          return;
        }
        setSrc(doc);
      },
      (err) => {
        logger.warn(err.message, { code: err.code });
        setError(`${err.code}: ${err.message}`);
      },
    );
    return unsub;
  }, [tid]);

  useEffect(() => {
    const unsub = subscribePlayers(
      tid,
      (list) => {
        setPlayers(list);
        // Phase 5.4: 初回 onSnapshot が `[]`（cache miss / オフライン）を返した場合は
        // hydration を先送りし、最初の非空リストで selected default を構築する。
        // `list.length > 0` ガードが無いと空 list で hydrated=true にロックされ、
        // 続く onSnapshot で player が増えても selected が空のまま残る UX バグになる。
        if (!selectedHydratedRef.current && list.length > 0) {
          setSelected(initialSelectedIdsFromPlayers(list));
          selectedHydratedRef.current = true;
        }
      },
      (err) => {
        logger.warn(err.message, { code: err.code });
      },
    );
    return unsub;
  }, [tid]);

  const { role: myRole } = useGroupRole(src?.groupId);
  const isOrganizer = myRole === "owner" || myRole === "organizer";
  const targetGroup = useMemo(
    () => (src ? (groups.find((g) => g.id === src.groupId) ?? null) : null),
    [src, groups],
  );
  const defaultName = useMemo(() => {
    if (!targetGroup) return (src?.name ?? "");
    return `[${targetGroup.name}]トーナメント-${targetGroup.finishedTournamentCount + 1}`;
  }, [targetGroup, src?.name]);

  // 非 organizer は dashboard 経由で /live に redirect 済みだが、URL 直叩きの保険として
  // ここでも 1 件 redirect。src null 中は何もしない（role 確定までの flicker 抑制）。
  useEffect(() => {
    if (!user || groupsLoading || !src) return;
    if (!isOrganizer) router.replace(`/tournaments/${tid}`);
  }, [user, groupsLoading, src, isOrganizer, router, tid]);

  if (!user) return null;

  if (error && !src) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Button asChild variant="outline">
          <Link href={`/tournaments/${tid}`}>戻る</Link>
        </Button>
      </main>
    );
  }
  if (!src || groupsLoading) {
    return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }
  if (!isOrganizer) {
    return <main className="mx-auto max-w-2xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }
  if (!canClone(src)) {
    return (
      <main className="mx-auto max-w-2xl space-y-4 p-8">
        <p className="text-sm text-destructive" role="alert">
          このトーナメントは終了していないため複製できません（state={src.state}）。
        </p>
        <Button asChild variant="outline">
          <Link href={`/tournaments/${tid}`}>戻る</Link>
        </Button>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">同じ参加者で次のトーナメントを作成</h1>
      <p className="text-sm text-muted-foreground">
        コピー元のストラクチャが初期選択されています。利用時間に合わせて別ストラクチャに切り替えることもできます。
      </p>
      <ClonePlayersChecklist
        players={players}
        selected={selected}
        onChange={setSelected}
        disabled={submitting}
      />
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <TournamentForm
        groupId={src.groupId}
        initialName={defaultName}
        initialSnapshot={src.structureSnapshot}
        initialSeatsPerTable={src.seatsPerTable}
        submitLabel="作成"
        onSubmit={async ({ name, snapshot, seatsPerTable }) => {
          if (selected.size === 0) {
            throw new AppError(
              "少なくとも 1 人を選択してください",
              "validation/clone-no-players",
            );
          }
          setSubmitting(true);
          try {
            const { newTid } = await cloneTournamentWithPlayers({
              srcTid: tid,
              selectedPlayerIds: Array.from(selected),
              create: {
                groupId: src.groupId,
                createdByUid: user.uid,
                name,
                structureSnapshot: snapshot,
                seatsPerTable,
              },
            });
            router.push(`/tournaments/${newTid}`);
          } catch (e) {
            // エラー表示は TournamentForm 内部の error 領域に集約する（同じ場所に二重表示しない）。
            // clone-client の `error` state は subscribeTournament 起因のエラー（doc 取得失敗など、
            // Form 描画前のエラー）専用に残す。re-throw で TournamentForm 側 catch に伝搬し、
            // Form 内部の `submitting=false` リセットも兼ねる。
            const wrapped = unwrapOrFrom(
              e,
              "firestore/write_failed",
              "クローンに失敗しました",
            );
            throw wrapped;
          } finally {
            setSubmitting(false);
          }
        }}
        onCancel={() => router.push(`/tournaments/${tid}`)}
      />
    </main>
  );
}
