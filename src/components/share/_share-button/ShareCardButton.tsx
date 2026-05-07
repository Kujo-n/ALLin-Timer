"use client";

import { Share2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { logger } from "@/lib/logger";

import { useCanShareImage } from "./use-can-share-image";

export type ShareKind = "winner" | "season";

interface Props {
  /** OG image route の URL（例: "/api/og/winner/{tid}?..."）。same-origin 限定 */
  url: string;
  /** File 名 stem（拡張子なし）。`<File>` の name に `.png` を付けて渡す */
  filenameStem: string;
  /** share の `text` フィールド */
  shareText: string;
  /** telemetry 用 kind */
  kind: ShareKind;
  /** visible button label */
  label: string;
  dataTestId?: string;
  className?: string;
}

/**
 * Phase D: Web Share API でファイル共有が可能な端末でのみ render する追加ボタン。
 *
 *  - `useCanShareImage` が真でない場合は **null を返す**（並列の DownloadButton が常時可視）
 *  - 失敗時は logger.warn のみで silent。download への自動 fallback はしない
 *    （隣の保存ボタンを user が押す想定）
 *  - AbortError は silent（ユーザーキャンセル）
 */
export function ShareCardButton({
  url,
  filenameStem,
  shareText,
  kind,
  label,
  dataTestId,
  className,
}: Props) {
  const canShare = useCanShareImage();
  if (canShare !== true) return null;

  return (
    <Button
      type="button"
      size="sm"
      variant="default"
      className={className}
      onClick={() => {
        void runShare(url, filenameStem, shareText, kind);
      }}
      data-testid={dataTestId}
    >
      <Share2 aria-hidden />
      {label}
    </Button>
  );
}

async function runShare(
  url: string,
  filenameStem: string,
  shareText: string,
  kind: ShareKind,
): Promise<"shared" | "aborted" | "failed"> {
  let file: File;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) {
      throw new AppError(
        `画像取得失敗 status=${res.status}`,
        "share/fetch-failed",
      );
    }
    const blob = await res.blob();
    file = new File([blob], `${filenameStem}.png`, { type: "image/png" });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "share/fetch-failed",
      "シェア画像の取得に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, kind });
    return "failed";
  }

  try {
    if (
      typeof navigator === "undefined" ||
      typeof navigator.canShare !== "function" ||
      !navigator.canShare({ files: [file] })
    ) {
      // canShare が突然 false に戻った（実機での挙動差分）。silent に return
      logger.warn("share/canshare-false-after-fetch", { kind });
      return "failed";
    }
    await navigator.share({ files: [file], text: shareText });
    // 成功 telemetry は debug に降格（本番 default level=info では出力されない）
    logger.debug("share-card click", { kind, action: "share", success: true });
    return "shared";
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      // ユーザーキャンセル — 何もしない（logger も呼ばない）
      return "aborted";
    }
    const wrapped = AppError.from(e, "share/failed", "シェアに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, kind });
    return "failed";
  }
}
