import type { Metadata, Viewport } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AuthBadge } from "@/components/auth/AuthBadge";
import { AppShell } from "@/components/nav/AppShell";
import { HeaderMenuButton } from "@/components/nav/HeaderMenuButton";
import { NavStateProvider } from "@/components/nav/nav-state";
import { PageTitleProvider, PageTitleSlot } from "@/components/nav/page-title";
import { ServiceWorkerRegistration } from "@/components/pwa/ServiceWorkerRegistration";
import { AuthProvider } from "@/lib/firebase/AuthProvider";
import { GroupProvider } from "@/lib/services/current-group";
import { ThemeProvider } from "@/lib/services/theme";

import "./globals.css";

export const metadata: Metadata = {
  title: "ALLin-PokerTimer",
  description: "NLH サークル向けトーナメント進行支援",
  manifest: "/manifest.webmanifest",
  applicationName: "ALLin-PokerTimer",
  appleWebApp: {
    capable: true,
    title: "ALLin-PokerTimer",
    statusBarStyle: "black-translucent",
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/apple-icon-180.png", sizes: "180x180", type: "image/png" },
    ],
  },
};

// Phase A: Next.js 15 で `metadata.themeColor` は deprecation のため `viewport` 側に移管。
// `viewportFit: "cover"` は iOS notch / safe-area で hint の余白崩れを防ぐ。
// Track D Phase D.1: light / dark の 2 値を `media` 別に供給し、OS / 個人 preference に
// 応じてブラウザ chrome（モバイル status bar / PWA splash 等）を切替える。
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0E1422" },
  ],
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

/*
 * Track D Phase D.1: FOUC 防止のため hydration 前に `<html class="dark">` を確定する。
 *   - localStorage["allinpt.theme"] が "light" / "dark" / "system" のいずれかで
 *     storage 例外時は try/catch で握りつぶし system fallback
 *   - `prefers-color-scheme` で resolved theme を決定し dark のときのみ class 付与
 *   - `<html suppressHydrationWarning>` と組み合わせて React の class 差分警告を抑止
 */
const themeBootstrap = `(function(){try{var s=localStorage.getItem("allinpt.theme");var t=(s==="light"||s==="dark"||s==="system")?s:"system";var r=t==="system"?(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):t;if(r==="dark")document.documentElement.classList.add("dark");}catch(e){}})();`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap }} />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        <a href="#main" className="skip-link">
          メインコンテンツへスキップ
        </a>
        {/*
          Track D Phase D.1: ThemeProvider は AuthProvider の **外側** に配置する。
          認証 state とは独立で signed-out / 匿名 / signed-in の全画面に同じテーマ
          を適用するため。Provider 切替で全画面 unmount を避ける狙いもある。
        */}
        <ThemeProvider>
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
        </ThemeProvider>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
