"use client";

import { ArrowUpRight, BookOpen, Sparkles, Wand2 } from "lucide-react";
import Link from "next/link";

import { IOsInstallHint } from "@/components/pwa/IOsInstallHint";
import { PwaInstallPromotion } from "@/components/pwa/PwaInstallPromotion";
import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/lib/firebase/AuthProvider";

// note 公開記事への外部リンク。値は環境変数（.env.local / Vercel）から注入する。
// 未設定の場合は対応リンクを非表示にする（fork 直後のデフォルト挙動を安全に）。
// security-env.md: NEXT_PUBLIC_* は client bundle に含まれる前提で公開可能な値のみ設定すること。
const NOTE_INTRO_ARTICLE_URL = process.env.NEXT_PUBLIC_NOTE_INTRO_ARTICLE_URL ?? "";
const NOTE_OPERATING_GUIDE_URL = process.env.NEXT_PUBLIC_NOTE_OPERATING_GUIDE_URL ?? "";

export default function Page() {
  const { user, loading } = useAuthUser();

  const signedIn = !!user && !user.isAnonymous;

  // Phase D: PWA インストール促進 UI はトップ画面のみで mount する。
  // 会場 dashboard / live で促進バナーが居座る事故を避ける。
  return (
    <>
      <PwaInstallPromotion />
      <IOsInstallHint />
      <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8 text-center">
        <h1 className="text-4xl font-bold">ALLin-PokerTimer</h1>
        <p className="text-sm text-muted-foreground">
          NLH（ノーリミットテキサスホールデム）小規模サークル向けトーナメント進行支援アプリ。
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3" aria-live="polite">
          {loading ? (
            <span className="text-sm text-muted-foreground">読込中…</span>
          ) : signedIn ? (
            <>
              <Link href="/groups">
                <Button>サークル一覧へ</Button>
              </Link>
              <Link href="/tournaments">
                <Button variant="outline">トーナメント一覧へ</Button>
              </Link>
            </>
          ) : (
            <Link href="/login">
              <Button>ログイン / 新規登録</Button>
            </Link>
          )}
        </div>
        {(NOTE_INTRO_ARTICLE_URL || NOTE_OPERATING_GUIDE_URL) && (
          <section
            aria-labelledby="external-articles-heading"
            className="flex w-full flex-col items-center gap-3 border-t border-border pt-6"
          >
            <h2
              id="external-articles-heading"
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-foreground"
            >
              <Sparkles className="size-4 text-amber-500" aria-hidden="true" />
              もっと使いこなす
            </h2>
            <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
              {NOTE_INTRO_ARTICLE_URL && (
                <a
                  href={NOTE_INTRO_ARTICLE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="アプリ紹介を読む（新しいタブで開く）"
                  className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-sky-50 via-blue-50 to-indigo-100 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 dark:from-sky-950/40 dark:via-blue-950/30 dark:to-indigo-950/40 dark:hover:border-sky-700"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-md transition-transform duration-200 group-hover:scale-105 group-hover:rotate-[-4deg]"
                  >
                    <BookOpen className="size-5" />
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-bold text-foreground">アプリ紹介を読む</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      これ何のアプリ？まずはここから
                    </span>
                  </span>
                  <ArrowUpRight
                    className="size-5 shrink-0 text-sky-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-sky-400"
                    aria-hidden="true"
                  />
                </a>
              )}
              {NOTE_OPERATING_GUIDE_URL && (
                <a
                  href={NOTE_OPERATING_GUIDE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="運営ガイド（操作チートシート）を読む（新しいタブで開く）"
                  className="group relative flex items-center gap-3 overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-amber-50 via-orange-50 to-rose-100 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 focus-visible:ring-offset-2 dark:from-amber-950/40 dark:via-orange-950/30 dark:to-rose-950/40 dark:hover:border-amber-700"
                >
                  <span
                    aria-hidden="true"
                    className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-rose-500 text-white shadow-md transition-transform duration-200 group-hover:scale-105 group-hover:rotate-[4deg]"
                  >
                    <Wand2 className="size-5" />
                  </span>
                  <span className="flex flex-1 flex-col">
                    <span className="text-sm font-bold text-foreground">運営ガイド</span>
                    <span className="text-[11px] leading-snug text-muted-foreground">
                      当日の操作を 30 秒で再確認
                    </span>
                  </span>
                  <ArrowUpRight
                    className="size-5 shrink-0 text-amber-600 transition-transform duration-200 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 dark:text-amber-400"
                    aria-hidden="true"
                  />
                </a>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground">
              ※ 新しいタブで note の記事を開きます
            </p>
          </section>
        )}
      </main>
    </>
  );
}
