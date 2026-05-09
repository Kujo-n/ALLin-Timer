"use client";

import { cn } from "@/lib/utils";

import { TABLE_COLOR_PRESETS } from "./table-color-presets";

/**
 * 卓の色プリセット radiogroup。
 *
 * architect-refactor 20260509 T2-b で `GroupDefaultTableLabelsCard` /
 * `TableLabelEditPopover` の重複実装を集約。「色なし」 + `TABLE_COLOR_PRESETS.map` の
 * 二段構造を 1 component で扱い、aria-label 規約 / button サイズの差は props で吸収する。
 *
 * - aria-label 規約 2 系統:
 *   - **compact**: `${ariaLabelPrefix}-color-${preset.name}` /
 *     `${ariaLabelPrefix}-color-none` — `GroupDefaultTableLabelsCard` 用。E2E
 *     `table-label-and-color.spec.ts` の「default-table-1-color-赤」等の規約と互換
 *   - **verbose**: `色：${preset.name}` / `色：なし` — `TableLabelEditPopover` 用。
 *     既存の人間可読 a11y 文言を維持
 *
 * - サイズ 2 系統:
 *   - **sm**: h-7 w-7 / 「なし」 button text-[9px] / ring-offset-1（Card の inline 編集）
 *   - **md**: h-9 w-9 / 「なし」 button text-[10px] / ring-offset-2（Dialog の編集）
 */

export interface TableColorPresetRadioGroupProps {
  /** 現在の選択色（hex 文字列）。null は「色なし」選択。 */
  value: string | null;
  onChange: (next: string | null) => void;
  disabled?: boolean;
  /**
   * compact 規約での aria-label 接頭辞。例: "default-table-1"。
   * verbose 規約では参照しない。
   */
  ariaLabelPrefix?: string;
  /** aria-label 規約。compact / verbose の 2 系統を持つ。 */
  ariaLabelStyle: "compact" | "verbose";
  /** ring-offset と button サイズの 2 系統。 */
  size: "sm" | "md";
  /** radiogroup wrapper の aria-label。callsite 別に明示指定する。 */
  groupAriaLabel: string;
}

function presetAriaLabel(
  preset: { name: string },
  style: "compact" | "verbose",
  prefix: string,
): string {
  return style === "compact"
    ? `${prefix}-color-${preset.name}`
    : `色：${preset.name}`;
}

function noneAriaLabel(
  style: "compact" | "verbose",
  prefix: string,
): string {
  return style === "compact" ? `${prefix}-color-none` : "色：なし";
}

export function TableColorPresetRadioGroup({
  value,
  onChange,
  disabled = false,
  ariaLabelPrefix = "",
  ariaLabelStyle,
  size,
  groupAriaLabel,
}: TableColorPresetRadioGroupProps) {
  const isSm = size === "sm";
  const buttonSize = isSm ? "h-7 w-7" : "h-9 w-9";
  const ringOffset = isSm ? "ring-offset-1" : "ring-offset-2";
  const noneTextSize = isSm ? "text-[9px]" : "text-[10px]";
  const gap = isSm ? "gap-1.5" : "gap-2";

  return (
    <div
      role="radiogroup"
      aria-label={groupAriaLabel}
      className={cn("flex flex-wrap", gap)}
    >
      <button
        type="button"
        role="radio"
        aria-checked={value === null}
        aria-label={noneAriaLabel(ariaLabelStyle, ariaLabelPrefix)}
        disabled={disabled}
        onClick={() => onChange(null)}
        className={cn(
          "flex items-center justify-center rounded-md border text-muted-foreground transition",
          buttonSize,
          noneTextSize,
          value === null
            ? cn("ring-2 ring-ring", ringOffset)
            : "hover:bg-accent",
        )}
      >
        なし
      </button>
      {TABLE_COLOR_PRESETS.map((preset) => (
        <button
          key={preset.value}
          type="button"
          role="radio"
          aria-checked={value === preset.value}
          aria-label={presetAriaLabel(preset, ariaLabelStyle, ariaLabelPrefix)}
          disabled={disabled}
          onClick={() => onChange(preset.value)}
          className={cn(
            "rounded-md border transition",
            buttonSize,
            value === preset.value
              ? cn("ring-2 ring-ring", ringOffset)
              : "hover:opacity-80",
          )}
          style={{ backgroundColor: preset.value }}
        />
      ))}
    </div>
  );
}
