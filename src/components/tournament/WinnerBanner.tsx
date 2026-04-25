"use client";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import { cn } from "@/lib/utils";

interface Props {
  winner: PlayerDoc;
  /** 呼出側でタイマー領域と幅を揃えるため上書き可能。未指定時は w-full のみ。 */
  className?: string;
}

export function WinnerBanner({ winner, className }: Props) {
  return (
    <section
      role="status"
      aria-live="polite"
      className={cn(
        "w-full rounded-lg border-2 border-amber-400 bg-gradient-to-br from-amber-100 to-yellow-200 p-6 text-center shadow-lg dark:from-amber-900/40 dark:to-yellow-900/40",
        className,
      )}
    >
      <div className="flex items-center justify-center gap-4">
        <span className="text-5xl md:text-6xl" aria-hidden>
          🏆
        </span>
        <p className="text-4xl font-bold text-amber-950 dark:text-amber-50 md:text-5xl lg:text-6xl">
          {winner.displayName}
        </p>
      </div>
    </section>
  );
}
