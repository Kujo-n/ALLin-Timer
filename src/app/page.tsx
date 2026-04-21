"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { useAuthUser } from "@/lib/firebase/AuthProvider";

export default function Page() {
  const { user, loading } = useAuthUser();

  const signedIn = !!user && !user.isAnonymous;

  return (
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
    </main>
  );
}
