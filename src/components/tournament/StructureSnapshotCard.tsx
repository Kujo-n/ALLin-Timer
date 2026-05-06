"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { AppendLevelInput } from "@/lib/firebase/repositories/tournaments";
import type {
  StructureSnapshot,
  TournamentDoc,
} from "@/lib/firebase/schemas/tournament";
import { canEditLevelDurations } from "@/lib/services/tournament-state";
import { cn } from "@/lib/utils";

import { AppendLevelDialog } from "./AppendLevelDialog";
import { EditableLevelDurationCell } from "./EditableLevelDurationCell";

interface Props {
  snapshot: StructureSnapshot;
  /** 現在 level（1-based）。指定すると該当行をハイライトする。0 / 未指定でハイライトなし。 */
  currentLevel?: number;
  /** 末尾の説明文を出すか（dashboard では出す、live では非表示）。 */
  showDescription?: boolean;
  className?: string;
  /**
   * Phase 5.2: 各レベルの durationSec を編集できる callback。
   * 指定なし（live など read-only 経路）では編集 affordance を出さない。
   */
  onUpdateDurationSec?: (levelIndex: number, durationSec: number) => Promise<void>;
  /**
   * Phase 5.2: tournament（state + currentLevel）。各行の編集可否判定に使う。
   * 指定なしのとき canEditLevelDurations を呼べないため、編集モードに入らない。
   */
  tournament?: TournamentDoc;
  /**
   * Phase 5.2: ロール判定。owner / organizer のみ編集可。
   * 指定なし or false なら編集 affordance を出さない（read-only）。
   */
  canEdit?: boolean;
  /** Phase 5.2: 編集失敗時に呼ばれる（dashboard の setError に流す）。 */
  onEditError?: (message: string) => void;
  /**
   * Phase 5.3: 末尾レベル追加 callback。指定なし or `canAppend !== true` のとき
   * append affordance を出さない。失敗時は AppError throw、Dialog が unwrapOrFrom で表示。
   */
  onAppendLevel?: (input: AppendLevelInput) => Promise<void>;
  /**
   * Phase 5.3: append 権限。owner / organizer かつ append 上限未達のとき true。
   * 指定なし or false で append button 非表示（read-only）。
   */
  canAppend?: boolean;
}

/**
 * ストラクチャ snapshot を一覧表示するカード。dashboard / live の両方で利用。
 * trace: tmp/10_Phase4.9_memo.md 改善要望#2（/live にも表示）
 *
 * Phase 5.2: organizer ロールのときに各レベルの durationSec を inline edit できる
 * `EditableLevelDurationCell` を組み込む。`canEdit` / `tournament` /
 * `onUpdateDurationSec` / `onEditError` のすべてが揃ったときのみ編集 affordance を出す。
 */
export function StructureSnapshotCard({
  snapshot,
  currentLevel,
  showDescription = false,
  className,
  onUpdateDurationSec,
  tournament,
  canEdit,
  onEditError,
  onAppendLevel,
  canAppend,
}: Props) {
  const editingEnabled =
    canEdit === true &&
    tournament !== undefined &&
    onUpdateDurationSec !== undefined &&
    onEditError !== undefined;
  const appendEnabled = canAppend === true && onAppendLevel !== undefined;
  const [appendOpen, setAppendOpen] = useState(false);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>ストラクチャ snapshot</CardTitle>
        {showDescription ? (
          <CardDescription>
            トーナメント作成時にコピー。以降の structures
            側の編集はこのトーナメントには影響しません。
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b text-left text-muted-foreground">
                <th className="px-2 py-1">Lv</th>
                <th className="px-2 py-1">SB</th>
                <th className="px-2 py-1">BB</th>
                <th className="px-2 py-1">Ante</th>
                <th className="px-2 py-1">分</th>
              </tr>
            </thead>
            <tbody>
              {snapshot.levels.map((l) => {
                const isCurrent = currentLevel != null && currentLevel === l.level;
                const levelIndex = l.level - 1;
                const cellEditable =
                  editingEnabled && canEditLevelDurations(tournament, levelIndex);
                const minutesCell = cellEditable ? (
                  <EditableLevelDurationCell
                    levelIndex={levelIndex}
                    durationSec={l.durationSec}
                    canEdit
                    onSave={onUpdateDurationSec}
                    onError={onEditError}
                  />
                ) : (
                  Math.round(l.durationSec / 60)
                );
                if (l.isBreak) {
                  return (
                    <tr
                      key={l.level}
                      className={cn(
                        "border-b bg-amber-500/10 text-amber-700 dark:text-amber-400",
                        isCurrent && "ring-2 ring-amber-500/60",
                      )}
                    >
                      <td className="px-2 py-1 font-mono">{l.level}</td>
                      <td className="px-2 py-1 font-semibold" colSpan={3}>
                        <span aria-hidden>☕ </span>BREAK
                      </td>
                      <td className="px-2 py-1">{minutesCell}</td>
                    </tr>
                  );
                }
                return (
                  <tr
                    key={l.level}
                    className={cn(
                      "border-b",
                      isCurrent &&
                        "bg-sky-500/10 font-semibold text-sky-700 dark:text-sky-300",
                    )}
                  >
                    <td className="px-2 py-1 font-mono">{l.level}</td>
                    <td className="px-2 py-1">{l.sb}</td>
                    <td className="px-2 py-1">{l.bb}</td>
                    <td className="px-2 py-1">{l.ante}</td>
                    <td className="px-2 py-1">{minutesCell}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {appendEnabled ? (
          <div className="mt-3 flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setAppendOpen(true)}
              aria-label="レベル追加"
            >
              + レベル追加
            </Button>
            <AppendLevelDialog
              open={appendOpen}
              onOpenChange={setAppendOpen}
              existingLevels={snapshot.levels}
              onAppend={onAppendLevel}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
