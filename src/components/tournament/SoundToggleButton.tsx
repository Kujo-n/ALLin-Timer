"use client";

import { BellRing, Volume2, VolumeX } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  enabled: boolean;
  unlocked: boolean;
  onUnlock: () => Promise<void>;
  /** group の audioSettings.enabled を反転書込する。member（権限なし）には親で本ボタン自体を非表示にする想定 */
  onToggleEnabled: (next: boolean) => Promise<void>;
}

/**
 * タイマーコントロール内のサウンド On/Off アイコンボタン。
 * 形 + 色の 2 軸で状態を判別できるようにする（色覚特性に配慮）。
 *  - OFF（enabled=false）: VolumeX（バツ付きスピーカー）+ 赤系背景 → クリックで group 全体を ON
 *  - 要 unlock（enabled=true & unlocked=false）: BellRing + amber → ブラウザの sound 権限を unlock
 *  - ON（enabled=true & unlocked=true）: Volume2（音波付きスピーカー）+ 緑系 → クリックで group 全体を OFF
 *
 * 詳細設定（音源/音量）はサイドバーの「サウンド設定」から行う。
 */
export function SoundToggleButton({ enabled, unlocked, onUnlock, onToggleEnabled }: Props) {
  const [busy, setBusy] = useState(false);
  const sizeCls = "h-10 w-10 p-0";

  async function handle(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  if (!enabled) {
    return (
      <Button
        type="button"
        variant="outline"
        className={`${sizeCls} border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15`}
        aria-label="サウンドOFF（クリックでON）"
        aria-pressed={false}
        disabled={busy}
        onClick={() => void handle(() => onToggleEnabled(true))}
      >
        <VolumeX aria-hidden className="h-5 w-5" />
      </Button>
    );
  }

  if (!unlocked) {
    return (
      <Button
        type="button"
        variant="outline"
        className={`${sizeCls} border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-300`}
        aria-label="サウンドを有効化"
        disabled={busy}
        onClick={() => void handle(onUnlock)}
      >
        <BellRing aria-hidden className="h-5 w-5" />
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="outline"
      className={`${sizeCls} border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300`}
      aria-label="サウンドON（クリックでOFF）"
      aria-pressed={true}
      disabled={busy}
      onClick={() => void handle(() => onToggleEnabled(false))}
    >
      <Volume2 aria-hidden className="h-5 w-5" />
    </Button>
  );
}
