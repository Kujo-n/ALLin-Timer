"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { subscribeTournamentsByGroup } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { logout } from "@/lib/services/auth-actions";
import { useCurrentGroup } from "@/lib/services/current-group";
import { cn } from "@/lib/utils";

import { NAV_ITEMS, resolveNavItems, type NavContext } from "./nav-items";

/** 開催中とみなす state（受付準備中の `setup` は除外、`finished` は履歴扱い） */
const ACTIVE_STATES: ReadonlyArray<TournamentDoc["state"]> = [
  "seating",
  "running",
  "paused",
];

function dotClassFor(state: TournamentDoc["state"]): string {
  switch (state) {
    case "running":
      return "text-emerald-500";
    case "paused":
      return "text-amber-500";
    case "seating":
      return "text-slate-400";
    default:
      return "text-muted-foreground";
  }
}

export function PrimaryNav({
  ctx,
  onNavigate,
}: {
  ctx: NavContext;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const items = resolveNavItems(NAV_ITEMS, ctx);
  const { user } = useAuthUser();
  const { groups, currentGroupId } = useCurrentGroup();
  const [busy, setBusy] = useState(false);
  const [activeTournaments, setActiveTournaments] = useState<TournamentDoc[]>([]);

  // Phase 4.14: 「トーナメント一覧」配下に開催中（seating/running/paused）の
  // トーナメントを realtime で並べる。currentGroupId 切替時に subscribe を切替える。
  useEffect(() => {
    if (!currentGroupId) {
      setActiveTournaments([]);
      return;
    }
    const unsub = subscribeTournamentsByGroup(
      currentGroupId,
      (items) =>
        setActiveTournaments(items.filter((t) => ACTIVE_STATES.includes(t.state))),
      (err) => {
        logger.warn(err.message, { code: err.code, gid: currentGroupId });
        // サブナビは missing でもアプリは動くため、表示だけ空に倒す。
        setActiveTournaments([]);
      },
    );
    return unsub;
  }, [currentGroupId]);

  const currentGroup = groups.find((g) => g.id === currentGroupId);
  const showSignedInFooter = !!user && !user.isAnonymous;
  const userLabel = user?.isAnonymous
    ? `ゲスト: ${user.displayName ?? "（名前未設定）"}`
    : (user?.displayName ?? user?.email ?? user?.uid ?? "");

  async function onLogout() {
    setBusy(true);
    try {
      await logout();
    } catch (e) {
      const wrapped = AppError.from(e, "auth/logout-failed", "ログアウトに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ul className="flex flex-1 flex-col gap-1 overflow-y-auto p-2" role="list">
        {items.map((item) => {
          const Icon = item.icon;
          const isGroups = item.href === "/groups";
          const isTournaments = item.href === "/tournaments";
          const groupSubHref = currentGroup ? `/groups/${currentGroup.id}` : null;
          const groupSubActive = !!(
            groupSubHref && pathname?.startsWith(groupSubHref)
          );
          const tournamentSubActive = isTournaments
            ? activeTournaments.some((t) =>
                pathname?.startsWith(`/tournaments/${t.id}`),
              )
            : false;
          // 親 link の active 判定。`/groups/{gid}` や `/tournaments/{tid}` ではサブ link 側が
          // active になるため、親 link は active 解除して aria-current の重複を防ぐ
          // （ARIA 12: 1 landmark 内に current location は単一が望ましい）。
          const rawActive =
            item.href === "/" ? pathname === "/" : (pathname?.startsWith(item.href) ?? false);
          const active =
            (isGroups && groupSubActive) || (isTournaments && tournamentSubActive)
              ? false
              : rawActive;
          return (
            <Fragment key={item.label}>
              <li>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  onClick={onNavigate}
                  className={cn(
                    "flex h-11 items-center gap-3 rounded-md border-l-2 border-transparent px-3 text-sm",
                    "hover:bg-accent hover:text-accent-foreground",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active && "border-l-primary bg-accent font-semibold text-accent-foreground",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden />
                  <span>{item.label}</span>
                </Link>
              </li>
              {isGroups && currentGroup && groupSubHref ? (
                <li>
                  <Link
                    href={groupSubHref}
                    aria-current={groupSubActive ? "page" : undefined}
                    onClick={onNavigate}
                    title={currentGroup.name}
                    className={cn(
                      "ml-7 flex h-9 items-center gap-2 truncate rounded-md border-l-2 border-transparent px-3 text-xs",
                      "hover:bg-accent hover:text-accent-foreground",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      groupSubActive &&
                        "border-l-primary bg-accent font-semibold text-accent-foreground",
                    )}
                  >
                    <span className="truncate">{currentGroup.name}</span>
                  </Link>
                </li>
              ) : null}
              {isTournaments
                ? activeTournaments.map((t) => {
                    const subHref = `/tournaments/${t.id}`;
                    const subActive = pathname?.startsWith(subHref) ?? false;
                    return (
                      <li key={t.id}>
                        <Link
                          href={subHref}
                          aria-current={subActive ? "page" : undefined}
                          onClick={onNavigate}
                          title={t.name}
                          className={cn(
                            "ml-7 flex h-9 items-center gap-2 truncate rounded-md border-l-2 border-transparent px-3 text-xs",
                            "hover:bg-accent hover:text-accent-foreground",
                            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                            subActive &&
                              "border-l-primary bg-accent font-semibold text-accent-foreground",
                          )}
                        >
                          <span aria-hidden className={dotClassFor(t.state)}>
                            ●
                          </span>
                          <span className="truncate">{t.name}</span>
                        </Link>
                      </li>
                    );
                  })
                : null}
            </Fragment>
          );
        })}
      </ul>

      {showSignedInFooter ? (
        <div className="shrink-0 border-t bg-background p-3 text-sm">
          <Link
            href="/settings"
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-2 truncate rounded-md px-2 py-1 text-xs",
              "hover:bg-accent hover:text-accent-foreground",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            )}
            aria-label={`${userLabel}（アカウント設定を開く）`}
          >
            <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
            <span className="truncate">{userLabel}</span>
          </Link>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => {
              void onLogout();
            }}
            className="mt-2 w-full"
          >
            {busy ? "処理中…" : "ログアウト"}
          </Button>
        </div>
      ) : !user ? (
        <div className="shrink-0 border-t bg-background p-3">
          <Link href="/login" onClick={onNavigate}>
            <Button variant="outline" size="sm" className="w-full">
              ログイン
            </Button>
          </Link>
        </div>
      ) : null}
    </div>
  );
}
