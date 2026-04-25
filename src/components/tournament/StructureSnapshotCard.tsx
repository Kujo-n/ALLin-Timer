"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { StructureSnapshot } from "@/lib/firebase/schemas/tournament";
import { cn } from "@/lib/utils";

interface Props {
  snapshot: StructureSnapshot;
  /** 現在 level（1-based）。指定すると該当行をハイライトする。0 / 未指定でハイライトなし。 */
  currentLevel?: number;
  /** 末尾の説明文を出すか（dashboard では出す、live では非表示）。 */
  showDescription?: boolean;
  className?: string;
}

/**
 * ストラクチャ snapshot を一覧表示するカード。dashboard / live の両方で利用。
 * trace: tmp/10_Phase4.9_memo.md 改善要望#2（/live にも表示）
 */
export function StructureSnapshotCard({
  snapshot,
  currentLevel,
  showDescription = false,
  className,
}: Props) {
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
                      <td className="px-2 py-1">{Math.round(l.durationSec / 60)}</td>
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
                    <td className="px-2 py-1">{Math.round(l.durationSec / 60)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
