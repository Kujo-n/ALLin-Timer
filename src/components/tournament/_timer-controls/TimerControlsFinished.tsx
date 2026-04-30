"use client";

import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

interface Props {
  connectionBadge: ReactNode;
  fullscreenButton: ReactNode;
}

/**
 * finished state（終了済み）の TimerControls。
 *  - すべてのアクションは disabled。表示のみ。
 */
export function TimerControlsFinished({ connectionBadge, fullscreenButton }: Props) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {connectionBadge}
      {fullscreenButton}
      <Button size="sm" disabled>
        終了済み
      </Button>
    </div>
  );
}
