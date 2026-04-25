import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthBadge } from "@/components/auth/AuthBadge";
import { AppShell } from "@/components/nav/AppShell";
import { HeaderMenuButton } from "@/components/nav/HeaderMenuButton";
import { NavStateProvider } from "@/components/nav/nav-state";
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
              <header className="sticky top-0 z-20 flex items-center gap-2 border-b bg-background/80 px-3 py-2 backdrop-blur">
                <HeaderMenuButton />
                <Link href="/" className="text-sm font-semibold">
                  ALLin-PokerTimer
                </Link>
                <div className="ml-auto">
                  <AuthBadge />
                </div>
              </header>
              <AppShell>{children}</AppShell>
            </NavStateProvider>
          </GroupProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
