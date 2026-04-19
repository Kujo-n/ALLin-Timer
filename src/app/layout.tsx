import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthBadge } from "@/components/auth/AuthBadge";
import { AuthProvider } from "@/lib/firebase/AuthProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "ALLin-PokerTimer",
  description: "NLH サークル向けトーナメント進行支援",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AuthProvider>
          <header className="sticky top-0 z-10 flex items-center justify-between border-b bg-background/80 px-4 py-2 backdrop-blur">
            <Link href="/" className="text-sm font-semibold">
              ALLin-PokerTimer
            </Link>
            <AuthBadge />
          </header>
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
