"use client";

import { Pencil } from "lucide-react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { UseInlineNumberEditState } from "@/lib/hooks/useInlineNumberEdit";

interface InlineNumberEditCardProps {
  title: ReactNode;
  description?: ReactNode;
  /** 表示モードで数値の前に置くテキスト（例: "終了したトーナメント:"）。 */
  displayPrefix?: ReactNode;
  /** 数値の右側に表示する単位（例: "回" / "席"）。 */
  unit: string;
  /** 編集モードの input に付与する aria-label。 */
  inputAriaLabel: string;
  /** Pencil ボタンの aria-label（例: "開催数を修正"）。 */
  editButtonAriaLabel: string;
  /** Pencil ボタンの可視テキスト（例: "修正" / "変更"）。 */
  editButtonLabel: string;
  /** Input の min 属性。 */
  min: number;
  /** Input の max 属性（任意）。 */
  max?: number;
  /** Input の step 属性（既定 1）。 */
  step?: number;
  /** 数値を表示する value（編集していないときの値）。 */
  displayValue: number;
  /** 編集権限（owner / organizer 等）。false なら edit ボタンを描画しない。 */
  canEdit: boolean;
  /** `useInlineNumberEdit` の戻り値をそのまま渡す。 */
  editor: UseInlineNumberEditState;
}

/**
 * Inline 数値編集カード（表示 ↔ 数字入力 + 保存/キャンセル）の共通 view。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` の
 * `finishedTournamentCount` / `defaultSeatsPerTable` の inline edit が同形パターンを
 * 重複していた箇所を集約する。state machine は `useInlineNumberEdit` が持つ。
 */
export function InlineNumberEditCard({
  title,
  description,
  displayPrefix,
  unit,
  inputAriaLabel,
  editButtonAriaLabel,
  editButtonLabel,
  min,
  max,
  step = 1,
  displayValue,
  canEdit,
  editor,
}: InlineNumberEditCardProps) {
  const editing = canEdit && editor.editing;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description ? <CardDescription>{description}</CardDescription> : null}
      </CardHeader>
      <CardContent>
        {editing ? (
          <form onSubmit={editor.onSubmit} className="flex flex-wrap items-center gap-2">
            <Input
              ref={editor.inputRef}
              type="number"
              min={min}
              max={max}
              step={step}
              value={editor.value}
              onChange={(e) => editor.onChange(e.target.value)}
              onKeyDown={editor.onKeyDown}
              aria-label={inputAriaLabel}
              disabled={editor.saving}
              className="h-10 w-32 text-base"
            />
            <span className="text-sm text-muted-foreground">{unit}</span>
            <Button type="submit" size="sm" disabled={editor.saving}>
              {editor.saving ? "保存中…" : "保存"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={editor.cancel}
              disabled={editor.saving}
            >
              キャンセル
            </Button>
          </form>
        ) : (
          <div className="flex items-center gap-2">
            <p className="text-base">
              {displayPrefix ? <>{displayPrefix} </> : null}
              <span className="font-semibold">{displayValue}</span> {unit}
            </p>
            {canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={editor.start}
                aria-label={editButtonAriaLabel}
              >
                <Pencil className="h-4 w-4" aria-hidden /> {editButtonLabel}
              </Button>
            ) : null}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
