import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AuthProvider } from "@/lib/firebase/AuthProvider";

import "./globals.css";

export const metadata: Metadata = {
  title: "ALLin-Timer",
  description: "NLH サークル向けトーナメント進行支援",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
