"use client";

import { usePathname } from "next/navigation";
import { useEffect, type ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { useCurrentGroup } from "@/lib/services/current-group";
import { cn } from "@/lib/utils";

import { useNavState } from "./nav-state";
import { PrimaryNav } from "./PrimaryNav";

// /tournaments/{tid}/live の参加者向け閲覧画面では sidebar を非表示にして
// タイマーを最大化する fullscreen pattern。dashboard (/tournaments/{tid}) は対象外。
const FULLSCREEN_PATTERN = /^\/tournaments\/[^/]+\/live\/?$/;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const { user } = useAuthUser();
  const { currentGroupId, isOrganizer } = useCurrentGroup();
  const { desktopCollapsed, mobileOpen, setMobileOpen } = useNavState();

  const signedIn = !!user && !user.isAnonymous;
  const ctx = { signedIn, currentGroupId, isOrganizer };

  // ナビゲーション後に sheet を自動クローズ。Radix が focus をトリガーへ復帰する。
  useEffect(() => setMobileOpen(false), [pathname, setMobileOpen]);

  // Phase 5.1: 匿名ユーザー（ゲスト受付完了後の閲覧）はサイドバー / ハンバーガーから
  // アプリ機能へ進めない設計のため、サイドバー / Sheet を render skip する。
  // 同様に /live は fullscreen pattern で sidebar を出さない。
  //
  // ⚠ React tree position: 旧実装は `if (user?.isAnonymous) return <main>...` で
  //   ルート要素を `<div>` ↔ `<main>` 間で切り替えていたため、user 状態が変わるたびに
  //   `<main>` の React 位置がずれ、children（JoinClient 等）が **完全 unmount**
  //   されていた。`signInAnonymously` 直後に AppShell が anon-shortcut に切り替わり
  //   JoinClient が unmount され、その後の `setStatus({ kind: "joined" })` が
  //   no-op となって受付完了 UI が描画されない race を生んでいた（複数 e2e spec で観測）。
  //
  // 対策: ルートの `<div>` と `<main>` の slot 位置を常に固定し、サイドバー / Sheet を
  //   conditional render（`null` placeholder）で出し分けることで `<main>` が常に
  //   同じ children index に居続けるようにする。React は children index ベースで
  //   reconciliation するため、null/false は slot を消費するが、`<main>` の slot は
  //   isAnonymous / fullscreen トグル前後で同じ index に保たれ、unmount されない。
  const isAnon = !!user?.isAnonymous;
  const isFullscreen = FULLSCREEN_PATTERN.test(pathname ?? "");
  const showSidebar = !isAnon && !isFullscreen;

  return (
    <div className={cn(showSidebar && "flex min-h-[calc(100vh-3rem)]")}>
      {/*
        sidebar はスクロール時もフッタ（displayName / ログアウト）が viewport 内に収まるよう
        sticky + viewport 高さ固定。`self-start` で親 flex の stretch を抑止して
        コンテンツが長くなっても sidebar はビューポート分だけ占有する。
      */}
      {showSidebar ? (
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
      ) : null}

      {showSidebar ? (
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetContent side="left" id="primary-nav" aria-label="メインナビゲーション">
            <SheetTitle className="border-b px-4 py-3">メニュー</SheetTitle>
            <nav aria-label="メイン" className="flex-1 overflow-y-auto">
              <PrimaryNav ctx={ctx} onNavigate={() => setMobileOpen(false)} />
            </nav>
          </SheetContent>
        </Sheet>
      ) : null}

      <main id="main" tabIndex={-1} className={cn(showSidebar && "flex-1")}>
        {children}
      </main>
    </div>
  );
}
