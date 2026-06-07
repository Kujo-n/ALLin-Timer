"use client";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

interface Props {
  players: PlayerDoc[];
}

/**
 * Phase 4 (07): 未配席（tableNum=null・非 busted）の参加者がいるとき、運営者へ
 * 「卓を増やす／閉じた卓を再開して D&D で配置」を促す軽量ガイドバナー。
 *
 * 自動配席は満席だと no-seat で止まり、追加/再開した空卓は自動配席対象外
 * （planLateEntrySeat が空卓を候補にしない）。そのため未配席者は手動配置が必要で、
 * その導線をここで明示する。未配席 0 名なら null（非表示）。
 */
export function UnseatedPlayersGuide({ players }: Props) {
  const unseated = players.filter((p) => !p.isBusted && p.tableNum === null);
  if (unseated.length === 0) return null;
  return (
    <div
      role="status"
      data-testid="unseated-guide"
      className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100"
    >
      <p className="font-medium">
        未配席の参加者が {unseated.length} 名います（
        {unseated.map((p) => p.displayName).join("、")}）。
      </p>
      <p>卓を増やす／閉じた卓を再開し、D&amp;D で配置してください。</p>
    </div>
  );
}
