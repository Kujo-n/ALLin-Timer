"use client";

import { Pencil } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useInlineNumberEdit } from "@/lib/hooks/useInlineNumberEdit";
import { MAX_LEVEL_DURATION_SEC } from "@/lib/limits";

const MAX_LEVEL_DURATION_MIN = Math.floor(MAX_LEVEL_DURATION_SEC / 60);

interface EditableLevelDurationCellProps {
  /** 0-based level index（save callback に渡す）。 */
  levelIndex: number;
  /** 表示している durationSec（編集していないとき）。 */
  durationSec: number;
  /** 編集権限（false なら Pencil 非表示・read-only）。 */
  canEdit: boolean;
  /** 保存時の callback。新 durationSec（秒）を受け取る。失敗時に AppError throw 可。 */
  onSave: (levelIndex: number, durationSec: number) => Promise<void>;
  /** エラー時に呼ばれる（dashboard の setError に流す）。 */
  onError: (message: string) => void;
}

/**
 * Phase 5.2: ストラクチャ snapshot の table cell 内で「分」値を inline edit するセル。
 *
 * `useInlineNumberEdit` を消費する小さな td 内 view。Phase 4.17 `InlineNumberEditCard`
 * の縮小版（カード枠ではなく cell 内）。
 *
 *   - 表示単位: 分（schema は秒なので 60 で割って表示・60 倍して保存）
 *   - 編集中は <form> で Enter submit / Esc cancel を `useInlineNumberEdit` から自動配線
 *   - canEdit=false なら Pencil 非描画で数値のみを返し、既存 read-only 表示と区別不能
 */
export function EditableLevelDurationCell({
  levelIndex,
  durationSec,
  canEdit,
  onSave,
  onError,
}: EditableLevelDurationCellProps) {
  const editor = useInlineNumberEdit({
    currentValue: Math.round(durationSec / 60),
    save: async (durationMin) => {
      await onSave(levelIndex, durationMin * 60);
    },
    validate: (n) =>
      Number.isInteger(n) && n >= 1 && n <= MAX_LEVEL_DURATION_MIN
        ? null
        : `validation/level-duration-invalid: レベル時間は 1〜${MAX_LEVEL_DURATION_MIN} 分の整数で指定してください`,
    onError,
    errorCode: "tournament/level-duration-failed",
    errorMessage: "レベル時間の更新に失敗しました",
  });

  if (!canEdit) {
    return <>{Math.round(durationSec / 60)}</>;
  }

  if (editor.editing) {
    return (
      <form onSubmit={editor.onSubmit} className="flex items-center gap-1">
        <Input
          ref={editor.inputRef}
          type="number"
          min={1}
          max={MAX_LEVEL_DURATION_MIN}
          step={1}
          value={editor.value}
          onChange={(e) => editor.onChange(e.target.value)}
          onKeyDown={editor.onKeyDown}
          aria-label={`Lv ${levelIndex + 1} の時間（分）`}
          disabled={editor.saving}
          className="h-7 w-16 text-xs"
        />
        <Button type="submit" size="sm" variant="outline" disabled={editor.saving}>
          {editor.saving ? "…" : "保存"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={editor.cancel}
          disabled={editor.saving}
          aria-label="キャンセル"
        >
          ×
        </Button>
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={editor.start}
      aria-label={`Lv ${levelIndex + 1} の時間を変更`}
      className="inline-flex items-center gap-1 rounded px-1 hover:bg-muted"
    >
      {Math.round(durationSec / 60)}
      <Pencil className="h-3 w-3 text-muted-foreground" aria-hidden />
    </button>
  );
}
