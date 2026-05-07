"use client";

import { Pencil } from "lucide-react";
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

interface Props {
  table: TableDoc;
  /**
   * 保存 handler。`label === ''` は呼出側 repository (`updateTableLabel`) で null に
   * 正規化される。`color === ''` も null に正規化（ネイティブ color picker は空値を返さないが
   * 「色なし」を許容する UX のため明示的にハンドリング）。
   */
  onSave: (patch: { label: string | null; color: string | null }) => Promise<void>;
  onError?: (message: string) => void;
}

/**
 * Phase C: SeatingBoard 卓ヘッダから開く inline edit Dialog。
 * 既存の Dialog コンポーネント（@radix-ui/react-dialog ベース）を再利用し、
 * 新規 popover 依存を増やさない方針（plan の GOTCHA 参照）。
 *
 * - label: 1〜TABLE_LABEL_MAX_LENGTH 文字、空文字は null 保存
 * - color: native `<input type="color">` で hex 選択。「色なし」は別ボタンで null 化
 */
export function TableLabelEditPopover({ table, onSave, onError }: Props) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState(table.label ?? "");
  const [color, setColor] = useState<string | null>(table.color ?? null);
  const [saving, setSaving] = useState(false);

  function reset() {
    setLabel(table.label ?? "");
    setColor(table.color ?? null);
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
        "テーブル呼称の更新に失敗しました",
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
        <DialogContent>
        <DialogHeader>
          <DialogTitle>Table {table.tableNum} の呼称・色を編集</DialogTitle>
          <DialogDescription>
            設定なしの場合は「Table {table.tableNum}」と表示されます。色は卓カードの左端に
            6px の帯で表示されます。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1">
            <label
              htmlFor={`table-label-${table.tableNum}`}
              className="text-sm font-medium"
            >
              呼称（最大 {TABLE_LABEL_MAX_LENGTH} 文字）
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
          <div className="space-y-1">
            <label className="text-sm font-medium">色</label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={color ?? "#888888"}
                onChange={(e) => setColor(e.target.value)}
                disabled={saving}
                aria-label={`table-color-input-${table.tableNum}`}
                className="h-9 w-14 cursor-pointer rounded border"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={saving || color === null}
                onClick={() => setColor(null)}
              >
                色なし
              </Button>
              {color ? (
                <code className="text-xs text-muted-foreground">{color}</code>
              ) : (
                <span className="text-xs text-muted-foreground">未設定</span>
              )}
            </div>
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
