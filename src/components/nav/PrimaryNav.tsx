"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Fragment, useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { logger } from "@/lib/logger";
import { logout } from "@/lib/services/auth-actions";
import { useCurrentGroup } from "@/lib/services/current-group";
import { cn } from "@/lib/utils";

import { NAV_ITEMS, resolveNavItems, type NavContext } from "./nav-items";

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
          const groupSubHref = currentGroup ? `/groups/${currentGroup.id}` : null;
          const groupSubActive = !!(
            groupSubHref && pathname?.startsWith(groupSubHref)
          );
          // 親 link の active 判定。`/groups/{gid}` ではサブ link 側が active になるため、
          // 親「サークル」は active 解除して aria-current の重複を防ぐ（ARIA 12: 1 landmark
          // 内に current location は単一が望ましい）。
          const rawActive =
            item.href === "/" ? pathname === "/" : (pathname?.startsWith(item.href) ?? false);
          const active = isGroups && groupSubActive ? false : rawActive;
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
