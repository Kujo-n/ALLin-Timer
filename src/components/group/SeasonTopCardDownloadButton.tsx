"use client";

import { Download } from "lucide-react";

import { buildSeasonShareInputs } from "@/app/api/og/_lib/og-payload";
import { Button } from "@/components/ui/button";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";
import { logger } from "@/lib/logger";

interface Props {
  gid: string;
  group: Pick<GroupDoc, "name" | "seasonStartDate">;
  /** `subscribeSeasonStats` の戻り値（totalPoints desc 済）。先頭 3 件まで使う。 */
  stats: readonly SeasonStatsDoc[];
  className?: string;
}

/**
 * Phase B: シーズン首位カード PNG をダウンロードするボタン。
 *
 * `stats` が空配列の場合は呼出側で gate して非表示にする想定（本 component では
 * 防衛的に top1 が無いと URL を組めないため、空のときは何もレンダリングしない）。
 *
 * 日付ラベル / filename の datePart は **押下端末の TZ** で format する。
 */
export function SeasonTopCardDownloadButton({
  gid,
  group,
  stats,
  className,
}: Props) {
  const inputs = buildSeasonShareInputs(gid, group, stats);
  if (!inputs) return null;
  const { url, filenameStem } = inputs;
  const filename = `${filenameStem}.png`;

  return (
    <Button asChild size="sm" variant="default" className={className}>
      <a
        href={url}
        download={filename}
        data-testid="season-top-card-download"
        onClick={() =>
          // click telemetry は debug に降格（本番 default level=info では出力されない）
          logger.debug("share-card click", {
            kind: "season",
            action: "download",
            success: true,
          })
        }
      >
        <Download aria-hidden />
        シーズン首位カードを保存
      </a>
    </Button>
  );
}
