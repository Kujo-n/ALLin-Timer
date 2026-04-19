"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { logger } from "@/lib/logger";
import { logout } from "@/lib/services/auth-actions";

export function AuthBadge() {
  const { user, loading } = useAuthUser();
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

  return (
    <div
      className="flex items-center gap-2 text-sm"
      data-testid="auth-badge"
    >
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
