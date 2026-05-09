"use client";

import { ChevronDown, ChevronRight, Pencil } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AppError } from "@/lib/errors";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
import { logger } from "@/lib/logger";

import { TableColorPresetRadioGroup } from "./TableColorPresetRadioGroup";
import { isPresetTableColor } from "./table-color-presets";

interface Props {
  table: TableDoc;
  /**
   * 保存 handler。`label === ''` は呼出側 repository (`updateTableLabel`) で null に
   * 正規化される。`color === null` も同様（プリセットの「色なし」または詳細 picker 起点）。
   */
  onSave: (patch: { label: string | null; color: string | null }) => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Phase C: SeatingBoard 卓ヘッダから開く inline edit Dialog。
 * 既存の Dialog コンポーネント（@radix-ui/react-dialog ベース）を再利用し、
 * 新規 popover 依存を増やさない方針（plan の GOTCHA 参照）。
 *
 * Phase C improvement (02-02):
 *   - IME: Radix Dialog の auto focus は日本語 IME の composition 開始 context を
 *     奪うことがある。`onOpenAutoFocus={preventDefault}` で初期 focus を user 操作に
 *     委ね、`onEscapeKeyDown` で composition 中の dismiss を block する。
 *   - 文言: 旧「呼称」表現を全廃して「Table 名」に統一。
 *   - 色: プリセット 10 色 + 「色なし」を radiogroup として提示し、カスタム hex picker は
 *     詳細セクションに折りたたむ。
 *
 * - label: 1〜TABLE_LABEL_MAX_LENGTH 文字、空文字は null 保存
 * - color: hex 文字列（プリセット選択 or カスタム picker）。「色なし」で null 化
 */
export function TableLabelEditPopover({ table, onSave, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(table.label ?? "");
  const [color, setColor] = useState<string | null>(table.color ?? null);
  const [saving, setSaving] = useState(false);
  const [showAdvancedColor, setShowAdvancedColor] = useState(false);

  function reset() {
    setLabel(table.label ?? "");
    setColor(table.color ?? null);
    setShowAdvancedColor(false);
  }

  function handleOpenChange(next: boolean) {
    if (!next) reset();
    setOpen(next);
  }

  async function handleSave() {
    setSaving(true);
    try {
      const trimmed = label.trim();
      await onSave({
        label: trimmed.length > 0 ? trimmed : null,
        color,
      });
      setOpen(false);
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "firestore/write_failed",
        "Table 名の更新に失敗しました",
      );
      logger.warn(wrapped.message, {
        code: wrapped.code,
        tableNum: table.tableNum,
      });
      onError?.(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSaving(false);
    }
  }

  const isCustomColor = color !== null && !isPresetTableColor(color);

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        aria-label={`edit-table-${table.tableNum}`}
        onClick={() => setOpen(true)}
      >
        <Pencil className="h-3.5 w-3.5" />
      </Button>
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          // Radix Dialog の auto focus は日本語 IME の composition context を破壊する
          // ことがあるため、初期 auto focus を抑止して user click 経由の focus に委ねる。
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Escape による dismiss は composition 中（IME 変換中）には抑止する。
          // Radix `onEscapeKeyDown` は DOM の KeyboardEvent をそのまま渡す。
          onEscapeKeyDown={(e) => {
            if (e.isComposing) e.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>Table {table.tableNum} の名前・色を編集</DialogTitle>
            <DialogDescription>
              Table 名と色は卓カードに反映されます。設定なしの場合は「Table {table.tableNum}」と表示されます。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1">
              <label
                htmlFor={`table-label-${table.tableNum}`}
                className="text-sm font-medium"
              >
                Table 名（最大 {TABLE_LABEL_MAX_LENGTH} 文字）
              </label>
              <Input
                id={`table-label-${table.tableNum}`}
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                maxLength={TABLE_LABEL_MAX_LENGTH}
                placeholder={`Table ${table.tableNum}`}
                disabled={saving}
                aria-label={`table-label-input-${table.tableNum}`}
              />
            </div>
            <div className="space-y-2">
              <span className="text-sm font-medium">色</span>
              <TableColorPresetRadioGroup
                value={color}
                onChange={setColor}
                disabled={saving}
                ariaLabelStyle="verbose"
                size="md"
                groupAriaLabel={`table-color-presets-${table.tableNum}`}
              />
              <button
                type="button"
                onClick={() => setShowAdvancedColor((v) => !v)}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                aria-expanded={showAdvancedColor || isCustomColor}
                aria-controls={`table-color-advanced-${table.tableNum}`}
              >
                {showAdvancedColor || isCustomColor ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <span>詳細設定（カスタム色）</span>
              </button>
              {showAdvancedColor || isCustomColor ? (
                <div
                  id={`table-color-advanced-${table.tableNum}`}
                  className="flex items-center gap-2 rounded-md border bg-muted/40 p-2"
                >
                  <input
                    type="color"
                    value={color ?? "#888888"}
                    onChange={(e) => setColor(e.target.value)}
                    disabled={saving}
                    aria-label={`table-color-input-${table.tableNum}`}
                    className="h-9 w-14 cursor-pointer rounded border"
                  />
                  {color ? (
                    <code className="text-xs text-muted-foreground">
                      {color}
                    </code>
                  ) : (
                    <span className="text-xs text-muted-foreground">未設定</span>
                  )}
                </div>
              ) : null}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={saving}
            >
              キャンセル
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
