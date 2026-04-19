import Link from "next/link";

import { Button } from "@/components/ui/button";

export default function Page() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-6 p-8 text-center">
      <h1 className="text-4xl font-bold">ALLin-Timer</h1>
      <p className="text-sm text-muted-foreground">
        NLH（ノーリミットテキサスホールデム）小規模サークル向けトーナメント進行支援アプリ。
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Link href="/tournaments">
          <Button>トーナメント一覧へ</Button>
        </Link>
        <Link href="/login">
          <Button variant="outline">ログイン / 新規登録</Button>
        </Link>
      </div>
    </main>
  );
}
