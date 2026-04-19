"use client";

import { Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Level } from "@/lib/firebase/schemas/structure";

interface Props {
  levels: Level[];
  onChange: (levels: Level[]) => void;
}

type ChipField = "sb" | "bb" | "ante";

function secToMin(sec: number): number {
  return Math.max(1, Math.round(sec / 60));
}

function parseIntSafe(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

export function LevelTable({ levels, onChange }: Props) {
  function updateChip(index: number, field: ChipField, value: string) {
    const n = parseIntSafe(value);
    const next = levels.map((l, i) => (i === index ? { ...l, [field]: n } : l));
    onChange(next);
  }

  function updateDurationMin(index: number, value: string) {
    const minutes = parseIntSafe(value);
    const durationSec = Math.max(1, minutes) * 60;
    const next = levels.map((l, i) => (i === index ? { ...l, durationSec } : l));
    onChange(next);
  }

  function removeRow(index: number) {
    const next = levels.filter((_, i) => i !== index).map((l, i) => ({ ...l, level: i + 1 }));
    onChange(next);
  }

  function addRow() {
    const last = levels[levels.length - 1];
    const base: Level = last
      ? {
          level: levels.length + 1,
          sb: last.sb * 2,
          bb: last.bb * 2,
          ante: last.ante,
          durationSec: last.durationSec,
        }
      : { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600 };
    onChange([...levels, base]);
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-muted-foreground">
              <th className="px-2 py-1">Lv</th>
              <th className="px-2 py-1">SB</th>
              <th className="px-2 py-1">BB</th>
              <th className="px-2 py-1">Ante</th>
              <th className="px-2 py-1">分</th>
              <th className="w-10 px-2 py-1" aria-label="delete" />
            </tr>
          </thead>
          <tbody>
            {levels.map((l, i) => (
              <tr key={l.level} className="border-b">
                <td className="px-2 py-1 font-mono">{l.level}</td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    min={0}
                    value={l.sb}
                    onChange={(e) => updateChip(i, "sb", e.target.value)}
                    aria-label={`level-${l.level}-sb`}
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    min={1}
                    value={l.bb}
                    onChange={(e) => updateChip(i, "bb", e.target.value)}
                    aria-label={`level-${l.level}-bb`}
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    min={0}
                    value={l.ante}
                    onChange={(e) => updateChip(i, "ante", e.target.value)}
                    aria-label={`level-${l.level}-ante`}
                  />
                </td>
                <td className="px-2 py-1">
                  <Input
                    type="number"
                    min={1}
                    value={secToMin(l.durationSec)}
                    onChange={(e) => updateDurationMin(i, e.target.value)}
                    aria-label={`level-${l.level}-duration-min`}
                  />
                </td>
                <td className="px-2 py-1 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    onClick={() => removeRow(i)}
                    aria-label={`level-${l.level}-delete`}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={addRow}>
        レベルを追加
      </Button>
    </div>
  );
}
