"use client";

import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { logger } from "@/lib/logger";
import { logout } from "@/lib/services/auth-actions";

/**
 * グローバルヘッダ右端のミニバッジ。
 *
 * Phase 4.13.1: 表示対象を絞った：
 *   - signed-in（非匿名）: PrimaryNav 内のフッタへ移動済みのため何も出さない（null）。
 *   - 匿名（ゲスト）: ゲスト名 + ログアウトボタン。`/live` などサイドバー非表示の
 *     ページでもログアウト導線を確保するため header に残す。
 *   - 未ログイン: 「ログイン」リンク（重要 CTA なので保持）。
 */
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

  // 認証済み（非匿名）はサイドバーのフッタに displayName + ログアウトを集約。
  // ヘッダには何も出さない。
  if (!user.isAnonymous) return null;

  const label = `ゲスト: ${user.displayName ?? "（名前未設定）"}`;

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
    <div className="flex items-center gap-2 text-sm" data-testid="auth-badge">
      <span className="rounded-full bg-muted px-2 py-0.5 text-xs">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
        {label}
      </span>
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
