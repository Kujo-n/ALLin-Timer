"use client";

import { Bell, Check } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface SoundUnlockBannerProps {
  unlocked: boolean;
  enabled: boolean;
  onUnlock: () => Promise<void>;
  /** "/groups/{gid}/audio-settings" — 設定ページへのリンク */
  settingsHref: string;
}

/**
 * Phase 4.9: 「サウンドを有効化」明示 UI。
 *   - enabled=false なら何も描画しない（混乱回避）
 *   - unlocked=true 後は確認バーのみ表示
 *   - 親は role 判定済みで mount を制御する想定（このコンポーネント自身は role を見ない）
 */
export function SoundUnlockBanner({
  unlocked,
  enabled,
  onUnlock,
  settingsHref,
}: SoundUnlockBannerProps) {
  if (!enabled) return null;

  if (!unlocked) {
    return (
      // role="status" は WinnerBanner（優勝確定通知）に予約する。
      //   このバナーは「サウンドを有効化してください」の操作要求であり、live region を
      //   通じて読み上げられる確定通知ではない（ユーザー操作起点の常設 CTA）ため、
      //   セマンティクスとしては region 級。aria-live は付けず、通常の banner として扱う。
      <section
        className="flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20"
      >
        <div className="flex items-center gap-2">
          <Bell aria-hidden className="h-4 w-4 shrink-0" />
          <span>
            ブラインド変更／優勝確定で音を鳴らせます。最初に有効化してください。
          </span>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void onUnlock()}>
            サウンドを有効化
          </Button>
          <Link href={settingsHref}>
            <Button size="sm" variant="outline">
              設定
            </Button>
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex w-full items-center justify-between rounded-lg border bg-muted/40 p-2 text-xs text-muted-foreground">
      <span className="flex items-center gap-1">
        <Check aria-hidden className="h-3.5 w-3.5" />
        サウンド有効
      </span>
      <Link href={settingsHref}>
        <Button size="sm" variant="ghost">
          設定
        </Button>
      </Link>
    </section>
  );
}
