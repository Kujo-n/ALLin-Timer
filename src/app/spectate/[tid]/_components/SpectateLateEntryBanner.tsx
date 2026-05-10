import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { isBeforeStart, isFinished } from "@/lib/services/tournament-state";

/**
 * Phase 2 (04-spectate-mode): 観戦者向けレイトレジスト受付状況 banner。
 *
 * - state === "setup" / "seating": 「受付準備中」（trying to register が常に有効）
 * - state === "running" / "paused" && !lateEntryClosed: "📢 レイトレジスト Lv N まで受付中"
 * - state === "running" / "paused" && lateEntryClosed: "受付終了"
 * - state === "finished": "終了"
 *
 * PRD Must: "Lv X まで受付中" / "受付終了" の 2 文言は必須。"受付準備中" / "終了" は補助。
 *
 * architect-refactor 20260510: spectate-client.tsx 内の inline 定義から
 * `_components/` 配下に co-location（refactor-conventions.md の page-specific
 * sub-component 規約に揃える）。
 */
export function SpectateLateEntryBanner({
  tournament,
  lateEntryClosed,
}: {
  tournament: TournamentDoc;
  lateEntryClosed: boolean;
}) {
  if (isFinished(tournament)) {
    return (
      <section
        role="status"
        className="mx-auto w-full rounded-md border bg-muted px-3 py-2 text-center text-sm"
      >
        このトーナメントは終了しました
      </section>
    );
  }
  if (isBeforeStart(tournament)) {
    return (
      <section
        role="status"
        className="mx-auto w-full rounded-md border bg-muted/40 px-3 py-2 text-center text-sm text-muted-foreground"
      >
        受付準備中（開始前）
      </section>
    );
  }
  // running / paused
  if (lateEntryClosed) {
    return (
      <section
        role="status"
        aria-live="polite"
        className="mx-auto w-full rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-center text-sm dark:border-amber-700 dark:bg-amber-900/20"
        data-testid="spectate-late-entry-closed"
      >
        ⛔ レイトレジスト受付終了（Lv {tournament.lateEntryDeadlineLevel} まで）
      </section>
    );
  }
  return (
    <section
      role="status"
      aria-live="polite"
      className="mx-auto w-full rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-center text-sm dark:border-emerald-700 dark:bg-emerald-900/20"
      data-testid="spectate-late-entry-open"
    >
      📢 レイトレジスト Lv {tournament.lateEntryDeadlineLevel} まで受付中（現在 Lv{" "}
      {tournament.currentLevel}）
    </section>
  );
}
