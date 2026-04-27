import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthBadge } from "@/components/auth/AuthBadge";
import { AppShell } from "@/components/nav/AppShell";
import { HeaderMenuButton } from "@/components/nav/HeaderMenuButton";
import { NavStateProvider } from "@/components/nav/nav-state";
import { PageTitleProvider, PageTitleSlot } from "@/components/nav/page-title";
import { AuthProvider } from "@/lib/firebase/AuthProvider";
import { GroupProvider } from "@/lib/services/current-group";

import "./globals.css";

export const metadata: Metadata = {
  title: "ALLin-PokerTimer",
  description: "NLH サークル向けトーナメント進行支援",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <a href="#main" className="skip-link">
          メインコンテンツへスキップ
        </a>
        <AuthProvider>
          <GroupProvider>
            <NavStateProvider>
              <PageTitleProvider>
                {/*
                  Phase 4.14 追加要望: ページ固有タイトル（例: トーナメント名）を
                  ブランドリンクと同じ高さの中央セルに表示する。
                  3 列 grid: [メニュー+ブランド] / [ページタイトル中央] / [AuthBadge]。
                */}
                <header className="sticky top-0 z-20 grid grid-cols-[auto_1fr_auto] items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur">
                  <div className="flex items-center gap-2">
                    <HeaderMenuButton />
                    <Link href="/" className="text-sm font-semibold">
                      ALLin-PokerTimer
                    </Link>
                  </div>
                  <div className="flex min-w-0 justify-center">
                    <PageTitleSlot />
                  </div>
                  <div className="flex justify-end">
                    <AuthBadge />
                  </div>
                </header>
                <AppShell>{children}</AppShell>
              </PageTitleProvider>
            </NavStateProvider>
          </GroupProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
