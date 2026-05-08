"use client";

import { Lightbulb } from "lucide-react";

interface Props {
  /** Wake Lock API がこの環境で利用可能か。`useWakeLock().supported` を渡す。 */
  wakeLockSupported: boolean;
}

/**
 * Phase C: Wake Lock 未対応端末（iOS Safari < 16.4 等）で「画面が消えないよう
 * 端末の省電力設定を見直してください」とテキスト案内する hint カード。
 *
 * SoundUnlockBanner と同じ amber 系の見た目で、画面のうるささを統一する。
 * 技術用語（Wake Lock / Screen Wake Lock API 等）はメッセージに出さない
 * （feedback_no_tech_stack_in_user_messages.md に従う）。
 */
export function DeviceFallbackHints({ wakeLockSupported }: Props) {
  if (wakeLockSupported) return null;

  return (
    <section
      role="note"
      className="flex w-full items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-900/20"
    >
      <Lightbulb aria-hidden className="mt-0.5 h-4 w-4 shrink-0" />
      <span>
        この端末では画面の自動消灯を抑止できません。タイマー投影中は OS の
        省電力設定で画面が消えないよう調整してください。
      </span>
    </section>
  );
}
