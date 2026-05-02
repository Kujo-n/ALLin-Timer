"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { subscribePlayersByUid } from "@/lib/firebase/repositories/playersByUid";
import { subscribeTournament } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { cn } from "@/lib/utils";

const VISIBLE_STATES: ReadonlyArray<TournamentDoc["state"]> = [
  "setup",
  "seating",
  "running",
  "paused",
];

/**
 * Phase 5.1: サイドバー「参加中のトーナメント」section。
 *   - collectionGroup `players` を `where("uid","==", auth.uid)` で購読し、
 *     自分が参加している tournaments の tid 一覧を取得。
 *   - 各 tid の tournament doc を個別に subscribe（rule で認証済み read 可）。
 *   - state in {setup, seating, running, paused} のみ表示。finished は履歴扱いで除外。
 *   - サブリンクは `/tournaments/{tid}/live` 直リンク（一般メンバーは dashboard URL から
 *     /live に redirect されるため）。
 *   - signedIn 時のみ render（匿名 / 未ログインは何も出さない）。
 */
export function JoinedTournamentsNav({
  onNavigate,
}: {
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const { user } = useAuthUser();

  const [joinedTids, setJoinedTids] = useState<string[]>([]);
  const [tournaments, setTournaments] = useState<Map<string, TournamentDoc>>(
    new Map(),
  );

  const signedInNonAnon = !!user && !user.isAnonymous;

  // 1) collectionGroup で参加中 player doc 集合を購読 → tid set を取得
  useEffect(() => {
    if (!signedInNonAnon) {
      setJoinedTids([]);
      return;
    }
    const unsub = subscribePlayersByUid(
      user!.uid,
      (entries) => {
        const tids = Array.from(new Set(entries.map((e) => e.tid)));
        setJoinedTids(tids);
      },
      (err) => {
        logger.warn("joined nav subscribe error", { code: err.code });
        setJoinedTids([]);
      },
    );
    return unsub;
  }, [signedInNonAnon, user]);

  // 2) tids の各 tournament を個別 subscribe（rule: 認証済み read 可）。
  //    tids が変わったら旧 unsubscribe を解除して張り直す。
  const unsubsRef = useRef<Map<string, () => void>>(new Map());
  useEffect(() => {
    const current = unsubsRef.current;
    // 旧 tids のうち削除された分を unsubscribe
    for (const [tid, unsub] of current) {
      if (!joinedTids.includes(tid)) {
        unsub();
        current.delete(tid);
        setTournaments((prev) => {
          if (!prev.has(tid)) return prev;
          const next = new Map(prev);
          next.delete(tid);
          return next;
        });
      }
    }
    // 新 tids を subscribe
    for (const tid of joinedTids) {
      if (current.has(tid)) continue;
      const unsub = subscribeTournament(
        tid,
        (payload) => {
          if (!payload.doc) {
            setTournaments((prev) => {
              if (!prev.has(tid)) return prev;
              const next = new Map(prev);
              next.delete(tid);
              return next;
            });
            return;
          }
          setTournaments((prev) => {
            const next = new Map(prev);
            next.set(tid, payload.doc!);
            return next;
          });
        },
        (err) =>
          logger.warn("joined nav tournament subscribe error", {
            code: err.code,
            tid,
          }),
      );
      current.set(tid, unsub);
    }
    return () => {
      // mount 単位の cleanup はせず、上で差分管理。component unmount 時のみここで一括解除。
    };
  }, [joinedTids]);

  // component unmount 時に全 unsubscribe（ref クリーンアップ）。
  useEffect(() => {
    const current = unsubsRef.current;
    return () => {
      for (const [, unsub] of current) unsub();
      current.clear();
    };
  }, []);

  const visibleTournaments = useMemo(() => {
    const arr = joinedTids
      .map((tid) => tournaments.get(tid))
      .filter((t): t is TournamentDoc => !!t && VISIBLE_STATES.includes(t.state));
    arr.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return arr;
  }, [joinedTids, tournaments]);

  if (!signedInNonAnon) return null;
  if (visibleTournaments.length === 0) return null;

  return (
    <li>
      <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
        参加中のトーナメント
      </p>
      <ul className="space-y-1">
        {visibleTournaments.map((t) => {
          const href = `/tournaments/${t.id}/live`;
          const active = pathname?.startsWith(`/tournaments/${t.id}`) ?? false;
          return (
            <li key={t.id}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                onClick={onNavigate}
                title={t.name}
                className={cn(
                  "ml-3 flex h-9 items-center gap-2 truncate rounded-md border-l-2 border-transparent px-3 text-xs",
                  "hover:bg-accent hover:text-accent-foreground",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  active &&
                    "border-l-primary bg-accent font-semibold text-accent-foreground",
                )}
              >
                <span className="truncate">{t.name}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </li>
  );
}
