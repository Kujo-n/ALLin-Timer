"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { logger } from "@/lib/logger";
import { logout } from "@/lib/services/auth-actions";
import { useCurrentGroup } from "@/lib/services/current-group";

export function AuthBadge() {
  const { user, loading } = useAuthUser();
  const {
    loading: groupLoading,
    groups,
    currentGroupId,
    setCurrentGroupId,
  } = useCurrentGroup();
  const [busy, setBusy] = useState(false);

  if (loading) {
    return (
      <span className="text-xs text-muted-foreground" aria-live="polite">
        読込中…
      </span>
    );
  }
  if (!user) {
    return (
      <Link href="/login">
        <Button variant="outline" size="sm">
          ログイン
        </Button>
      </Link>
    );
  }

  const label = user.isAnonymous
    ? `ゲスト: ${user.displayName ?? "（名前未設定）"}`
    : (user.email ?? user.displayName ?? user.uid);

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

  const currentGroup = groups.find((g) => g.id === currentGroupId);

  return (
    <div
      className="flex items-center gap-2 text-sm"
      data-testid="auth-badge"
    >
      {!user.isAnonymous && !groupLoading ? (
        groups.length === 0 ? (
          <Link
            href="/groups"
            className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800 hover:bg-amber-200"
          >
            サークル未所属
          </Link>
        ) : groups.length === 1 ? (
          <Link
            href={`/groups/${groups[0].id}`}
            className="rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
            aria-label="現在のサークル"
          >
            {groups[0].name}
          </Link>
        ) : (
          <Select
            value={currentGroupId ?? undefined}
            onValueChange={(v) => setCurrentGroupId(v)}
          >
            <SelectTrigger
              className="h-7 w-auto min-w-[8rem] gap-1 rounded-full bg-muted px-2 py-0 text-xs"
              aria-label="サークル切替"
            >
              <SelectValue placeholder="サークルを選択">
                {currentGroup?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {groups.map((g) => (
                <SelectItem key={g.id} value={g.id}>
                  {g.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )
      ) : null}

      <Link
        href="/settings"
        className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs hover:bg-muted/70"
        aria-label="current user (open settings)"
      >
        <span
          className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
          aria-hidden
        />
        {label}
      </Link>
      <Button
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={() => {
          void onLogout();
        }}
      >
        {busy ? "処理中…" : "ログアウト"}
      </Button>
    </div>
  );
}
