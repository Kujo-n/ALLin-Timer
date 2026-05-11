"use client";

import { Download } from "lucide-react";

import { buildWinnerShareInputs } from "@/app/api/og/_lib/og-payload";
import { Button } from "@/components/ui/button";
import type { CardBackground } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

interface Props {
  tid: string;
  winnerName: string;
  tournamentName: string;
  participants: number;
  /** トーナメント終了時刻。Date オブジェクトで受け取り端末 TZ で format する。 */
  finishedAt: Date;
  /** Phase A.2: サークル設定済みの優勝カード背景画像（null / undefined で未設定）。 */
  cardBackground?: CardBackground | null;
  className?: string;
}

/**
 * Phase B: 優勝カード PNG をダウンロードするボタン。
 *
 *   - PNG 内に表示する日付ラベル / filename の datePart は **押下端末の TZ** で format
 *     する（`Date.toLocaleDateString`）。サーバ runtime の TZ に依存しない設計
 *   - server route に Content-Disposition: attachment を付与しているため iOS Safari でも
 *     download として認識される。`<a download>` の filename は Chrome / Firefox 用
 */
export function WinnerCardDownloadButton({
  tid,
  winnerName,
  tournamentName,
  participants,
  finishedAt,
  cardBackground,
  className,
}: Props) {
  const { url, filenameStem } = buildWinnerShareInputs(tid, {
    winnerName,
    tournamentName,
    participants,
    finishedAt,
    cardBackground,
  });
  const filename = `${filenameStem}.png`;

  return (
    <Button asChild size="sm" variant="default" className={className}>
      <a
        href={url}
        download={filename}
        data-testid="winner-card-download"
        onClick={() =>
          // click telemetry は debug に降格（本番 default level=info では出力されない）
          logger.debug("share-card click", {
            kind: "winner",
            action: "download",
            success: true,
          })
        }
      >
        <Download aria-hidden />
        画像を保存
      </a>
    </Button>
  );
}
