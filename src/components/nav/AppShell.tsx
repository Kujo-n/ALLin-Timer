"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { useCurrentGroup } from "@/lib/services/current-group";
import { cn } from "@/lib/utils";

import { useNavState } from "./nav-state";
import { PrimaryNav } from "./PrimaryNav";

const FULLSCREEN_PATTERN = /^\/tournaments\/[^/]+\/live\/?$/;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuthUser();
  const { currentGroupId, isOrganizer } = useCurrentGroup();
  const { desktopCollapsed, mobileOpen, setMobileOpen } = useNavState();

  const signedIn = !!user && !user.isAnonymous;
  const fullscreen = FULLSCREEN_PATTERN.test(pathname ?? "");
  const ctx = { signedIn, currentGroupId, isOrganizer };

  // ナビゲーション後に sheet を自動クローズ。Radix が focus をトリガーへ復帰する。
  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);

  if (fullscreen) {
    return (
      <main id="main" tabIndex={-1}>
        {children}
      </main>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3rem)]">
      {/*
        sidebar はスクロール時もフッタ（displayName / ログアウト）が viewport 内に収まるよう
        sticky + viewport 高さ固定。`self-start` で親 flex の stretch を抑止して
        コンテンツが長くなっても sidebar はビューポート分だけ占有する。
      */}
      <aside
        id="primary-nav-sidebar"
        className={cn(
          "hidden shrink-0 self-start border-r bg-background",
          !desktopCollapsed && "md:block md:w-60",
          "md:sticky md:top-12 md:h-[calc(100vh-3rem)]",
        )}
        aria-label="メインナビゲーション"
        aria-hidden={desktopCollapsed ? true : undefined}
      >
        <nav aria-label="メイン" className="h-full">
          <PrimaryNav ctx={ctx} />
        </nav>
      </aside>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent side="left" id="primary-nav" aria-label="メインナビゲーション">
          <SheetTitle className="border-b px-4 py-3">メニュー</SheetTitle>
          <nav aria-label="メイン" className="flex-1 overflow-y-auto">
            <PrimaryNav ctx={ctx} onNavigate={() => setMobileOpen(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      <main id="main" tabIndex={-1} className="flex-1">
        {children}
      </main>
    </div>
  );
}
