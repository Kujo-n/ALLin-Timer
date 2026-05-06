"use client";

import { useMemo } from "react";

import { Button } from "@/components/ui/button";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";

interface Props {
  /** src tournament の players（busted 含む） */
  players: PlayerDoc[];
  /** 親が保持する選択 ID 集合 */
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
  disabled?: boolean;
}

/**
 * Phase 5.4: clone ページの参加者チェックリスト。
 *
 * 純粋に controlled なコンポーネント。状態は親（clone-client）で管理する。
 * uid===null の player は表示・選択対象から除外する（理論上発生しないが防衛的）。
 */
export function ClonePlayersChecklist({
  players,
  selected,
  onChange,
  disabled,
}: Props) {
  const eligible = useMemo(
    () => players.filter((p) => p.uid !== null),
    [players],
  );
  const allSelected =
    eligible.length > 0 && eligible.every((p) => selected.has(p.id));
  const noneSelected = eligible.every((p) => !selected.has(p.id));

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  }
  function selectAll() {
    onChange(new Set(eligible.map((p) => p.id)));
  }
  function clearAll() {
    onChange(new Set());
  }

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <p className="text-sm font-medium">
          参加者（{selected.size} / {eligible.length} 名選択）
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={selectAll}
            disabled={disabled || allSelected}
          >
            全選択
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clearAll}
            disabled={disabled || noneSelected}
          >
            全解除
          </Button>
        </div>
      </div>
      <ul className="max-h-64 space-y-1 overflow-y-auto rounded-md border p-2">
        {eligible.map((p) => {
          const inputId = `clone-p-${p.id}`;
          return (
            <li key={p.id} className="flex items-center gap-2 text-sm">
              <input
                id={inputId}
                type="checkbox"
                checked={selected.has(p.id)}
                onChange={() => toggle(p.id)}
                disabled={disabled}
                data-testid={`clone-checkbox-${p.displayName}`}
              />
              <label htmlFor={inputId} className="cursor-pointer">
                {p.displayName}
                {p.isBusted ? (
                  <span className="ml-1 text-muted-foreground">（バスト）</span>
                ) : null}
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** busted 以外を初期 ON で返す。clone-client の useState 初期化で使う。 */
export function initialSelectedIdsFromPlayers(
  players: PlayerDoc[],
): Set<string> {
  const init = new Set<string>();
  players.forEach((p) => {
    if (p.uid !== null && !p.isBusted) init.add(p.id);
  });
  return init;
}
