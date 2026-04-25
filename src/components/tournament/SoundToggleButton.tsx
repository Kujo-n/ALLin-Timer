"use client";

import { BellRing, Volume2, VolumeX } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";

interface Props {
  enabled: boolean;
  unlocked: boolean;
  onUnlock: () => Promise<void>;
  /** "/groups/{gid}/audio-settings" — 設定ページへのリンク */
  settingsHref: string;
}

/**
 * タイマーコントロール内のサウンド On/Off アイコンボタン。
 * 形 + 色の 2 軸で状態を判別できるようにする（色覚特性に配慮）。
 *  - OFF（enabled=false）: VolumeX（バツ付きスピーカー）+ 赤系背景 → 設定ページへ
 *  - 要 unlock（enabled=true & unlocked=false）: BellRing + amber → クリックで unlock
 *  - ON（enabled=true & unlocked=true）: Volume2（音波付きスピーカー）+ 緑系 → 設定ページへ
 */
export function SoundToggleButton({ enabled, unlocked, onUnlock, settingsHref }: Props) {
  const sizeCls = "h-10 w-10 p-0";

  if (!enabled) {
    return (
      <Link href={settingsHref} aria-label="サウンドOFF（クリックで設定）">
        <Button
          variant="outline"
          className={`${sizeCls} border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15`}
        >
          <VolumeX aria-hidden className="h-5 w-5" />
        </Button>
      </Link>
    );
  }

  if (!unlocked) {
    return (
      <Button
        variant="outline"
        className={`${sizeCls} border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}
        aria-label="サウンドを有効化"
        onClick={() => void onUnlock()}
      >
        <BellRing aria-hidden className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <Link href={settingsHref} aria-label="サウンドON（クリックで設定）">
      <Button
        variant="outline"
        className={`${sizeCls} border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`}
      >
        <Volume2 aria-hidden className="h-5 w-5" />
      </Button>
    </Link>
  );
}
