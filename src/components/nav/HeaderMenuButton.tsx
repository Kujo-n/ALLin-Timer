"use client";

import { Menu } from "lucide-react";

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { cn } from "@/lib/utils";

import { useNavState } from "./nav-state";

/**
 * ヘッダ左端の三点リーダーボタン。
 *
 *   - PC（md+）: sidebar を折りたたみ／展開（localStorage 永続）
 *   - モバイル（<md）: Sheet を開閉
 *
 * Phase 5.1: 匿名ユーザー（ゲスト受付）はサイドバー側から進める機能を持たないため
 * ハンバーガーボタンを非表示にする（AppShell でも sidebar を render skip）。
 */
export function HeaderMenuButton() {
  const { user } = useAuthUser();
  const { desktopCollapsed, mobileOpen, isDesktop, toggleNav } = useNavState();
  if (user?.isAnonymous) return null;
  const expanded = isDesktop ? !desktopCollapsed : mobileOpen;
  // desktop 時は sidebar (id="primary-nav-sidebar")、mobile 時は Sheet (id="primary-nav")
  // を制御対象とする。SSR 初期は isDesktop=false で mobile 想定の参照になる。
  const targetId = isDesktop ? "primary-nav-sidebar" : "primary-nav";

  return (
    <button
      type="button"
      onClick={toggleNav}
      aria-label={expanded ? "メニューを閉じる" : "メニューを開く"}
      aria-expanded={expanded}
      aria-controls={targetId}
      data-testid="header-menu-button"
      className={cn(
        "inline-flex h-9 w-9 items-center justify-center rounded-md",
        "hover:bg-accent",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
    >
      <Menu className="h-5 w-5" aria-hidden />
    </button>
  );
}
