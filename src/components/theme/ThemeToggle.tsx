"use client";

import { Monitor, Moon, Sun, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/services/theme";
import type { ThemePreference } from "@/lib/services/theme-storage";
import { cn } from "@/lib/utils";

/**
 * Track D Phase D.1: テーマ切替の segmented control（radiogroup）。
 *
 *   - 3 状態（light / dark / system）を icon-only の radio で表現
 *   - WAI-ARIA radiogroup パターン: 親に `role="radiogroup"` + 各 button に
 *     `role="radio"` + `aria-checked`。visible テキストが無いため `aria-label` 必須
 */

const OPTIONS: { value: ThemePreference; label: string; Icon: LucideIcon }[] = [
  { value: "light", label: "ライトモード", Icon: Sun },
  { value: "dark", label: "ダークモード", Icon: Moon },
  { value: "system", label: "OS の設定に従う", Icon: Monitor },
];

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  return (
    <div
      role="radiogroup"
      aria-label="テーマ"
      className="inline-flex items-center gap-1 rounded-md border border-border bg-background p-0.5"
    >
      {OPTIONS.map(({ value, label, Icon }) => {
        const active = theme === value;
        return (
          <Button
            key={value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            variant="ghost"
            size="sm"
            onClick={() => setTheme(value)}
            className={cn(
              "size-8 rounded p-0",
              active && "bg-accent text-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}
