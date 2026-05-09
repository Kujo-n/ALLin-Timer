"use client";

import { useEffect, useMemo, useState } from "react";

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
import { Label } from "@/components/ui/label";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import type { AppendLevelInput } from "@/lib/firebase/repositories/tournaments";
import type { Level } from "@/lib/firebase/schemas/structure";
import { logger } from "@/lib/logger";

function parseIntSafe(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

interface AppendLevelDialogProps {
  /** dialog 表示制御。trigger 側（StructureSnapshotCard）が制御する。 */
  open: boolean;
  /** open 状態を変える callback（backdrop / Esc / 「キャンセル」/ submit 成功時に false で呼ばれる）。 */
  onOpenChange: (open: boolean) => void;
  /** 既存 levels（quick-fill default の派生元と「新 Lv 番号」の表示に使う）。 */
  existingLevels: readonly Level[];
  /** 追加処理 — repository 呼出。AppError throw を許容（dialog が unwrapOrFrom で表示）。 */
  onAppend: (input: AppendLevelInput) => Promise<void>;
}

/**
 * Phase 5.3: 末尾レベル追加 dialog。
 *
 *  - default 値は「直前のプレイレベル（最後の非 break）」から派生:
 *    SB = last.sb * 2、BB = last.bb * 2、Ante = last.ante、durationMin = last.durationSec/60、
 *    isBreak = false。全 break / 空配列の場合は控えめな初期値（25/50/0/10/false）。
 *  - isBreak チェック時は SB/BB/Ante を 0 に倒し、Input を disabled にする
 *    （LevelTable.toggleBreak と同方針）。
 *  - submit 時は AppendLevelInput を組み立てて onAppend を await。成功時 onOpenChange(false)。
 *  - 失敗時は AppError を unwrapOrFrom で wrap し dialog 内に表示（dialog は閉じない）。
 */
export function AppendLevelDialog({
  open,
  onOpenChange,
  existingLevels,
  onAppend,
}: AppendLevelDialogProps) {
  const newLevelNumber = existingLevels.length + 1;

  const defaults = useMemo(() => {
    for (let i = existingLevels.length - 1; i >= 0; i -= 1) {
      const l = existingLevels[i];
      if (l.isBreak) continue;
      return {
        sb: Math.max(0, l.sb * 2),
        bb: Math.max(1, l.bb * 2),
        ante: Math.max(0, l.ante),
        durationMin: Math.max(1, Math.round(l.durationSec / 60)),
      };
    }
    return { sb: 25, bb: 50, ante: 0, durationMin: 10 };
  }, [existingLevels]);

  const [sb, setSb] = useState(defaults.sb);
  const [bb, setBb] = useState(defaults.bb);
  const [ante, setAnte] = useState(defaults.ante);
  const [durationMin, setDurationMin] = useState(defaults.durationMin);
  const [isBreak, setIsBreak] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // dialog open 時に default を再 hydrate（前回のキャンセル入力を引き継がない）。
  useEffect(() => {
    if (open) {
      setSb(defaults.sb);
      setBb(defaults.bb);
      setAnte(defaults.ante);
      setDurationMin(defaults.durationMin);
      setIsBreak(false);
      setError(null);
    }
  }, [open, defaults]);

  function toggleBreak(checked: boolean): void {
    setIsBreak(checked);
    if (checked) {
      // ブレイク化: SB/BB/Ante=0 で zod の `!isBreak && bb<=0` refine を通過。
      setSb(0);
      setBb(0);
      setAnte(0);
    } else {
      // ブレイク解除: BB は最低 1 に戻す（refine 通過のため）。
      setBb((prev) => Math.max(1, prev));
    }
  }

  async function onSubmit(e: React.FormEvent): Promise<void> {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await onAppend({
        sb,
        bb,
        ante,
        durationSec: durationMin * 60,
        isBreak,
      });
      onOpenChange(false);
    } catch (e) {
      // repository が AppError ラップ済 → 二重 wrap を avoid。
      const wrapped = unwrapOrFrom(e, "tournament/append-failed", "レベル追加に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(formatErrorForDisplay(wrapped));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>レベル {newLevelNumber} を末尾に追加</DialogTitle>
          <DialogDescription>
            直前レベルから派生した値を初期表示しています。必要に応じて上書きしてください。
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isBreak}
              onChange={(e) => toggleBreak(e.target.checked)}
            />
            <span>ブレイクとして追加</span>
          </label>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="append-sb">SB</Label>
              <Input
                id="append-sb"
                type="number"
                min={0}
                step={1}
                value={sb}
                disabled={isBreak}
                onChange={(e) => setSb(parseIntSafe(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="append-bb">BB</Label>
              <Input
                id="append-bb"
                type="number"
                min={isBreak ? 0 : 1}
                step={1}
                value={bb}
                disabled={isBreak}
                onChange={(e) => setBb(parseIntSafe(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="append-ante">Ante</Label>
              <Input
                id="append-ante"
                type="number"
                min={0}
                step={1}
                value={ante}
                disabled={isBreak}
                onChange={(e) => setAnte(parseIntSafe(e.target.value))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="append-dur">分</Label>
              <Input
                id="append-dur"
                type="number"
                min={1}
                step={1}
                value={durationMin}
                onChange={(e) => setDurationMin(parseIntSafe(e.target.value))}
              />
            </div>
          </div>
          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={submitting}
            >
              キャンセル
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "追加中…" : "追加"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
