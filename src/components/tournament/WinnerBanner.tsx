"use client";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

export function WinnerBanner({ winner }: { winner: PlayerDoc }) {
  return (
    <section
      role="status"
      aria-live="polite"
      className="w-full max-w-md rounded-lg border-2 border-amber-400 bg-gradient-to-br from-amber-100 to-yellow-200 p-6 text-center shadow-lg dark:from-amber-900/40 dark:to-yellow-900/40"
    >
      <div className="mb-2 text-5xl" aria-hidden>
        🏆
      </div>
      <p className="text-sm font-medium text-amber-900 dark:text-amber-100">優勝</p>
      <p className="mt-1 text-2xl font-bold text-amber-950 dark:text-amber-50">
        {winner.displayName}
      </p>
    </section>
  );
}
