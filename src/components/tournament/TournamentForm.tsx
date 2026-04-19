"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AppError } from "@/lib/errors";
import { listStructuresByGroup } from "@/lib/firebase/repositories/structures";
import type { StructureDoc } from "@/lib/firebase/schemas/structure";
import type { StructureSnapshot } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

interface Props {
  groupId: string;
  initialName?: string;
  initialSnapshot?: StructureSnapshot;
  submitLabel?: string;
  onSubmit: (input: { name: string; snapshot: StructureSnapshot }) => Promise<void>;
  onCancel?: () => void;
}

function snapshotFromStructure(s: StructureDoc): StructureSnapshot {
  return {
    name: s.name,
    initialStack: s.initialStack,
    lateEntryDeadlineLevel: s.lateEntryDeadlineLevel,
    levels: s.levels.map((l) => ({ ...l })),
  };
}

export function TournamentForm({
  groupId,
  initialName = "",
  initialSnapshot,
  submitLabel = "作成",
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialName);
  const [structures, setStructures] = useState<StructureDoc[]>([]);
  const [selectedSid, setSelectedSid] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<StructureSnapshot | null>(initialSnapshot ?? null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [loadingList, setLoadingList] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const list = await listStructuresByGroup(groupId);
        if (!cancelled) {
          setStructures(list);
          if (!initialSnapshot && list.length > 0) {
            setSelectedSid(list[0].id);
            setSnapshot(snapshotFromStructure(list[0]));
          }
        }
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "ストラクチャ取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
      } finally {
        if (!cancelled) setLoadingList(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [groupId, initialSnapshot]);

  function onPickStructure(sid: string) {
    setSelectedSid(sid);
    const picked = structures.find((s) => s.id === sid);
    if (picked) setSnapshot(snapshotFromStructure(picked));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("validation/name: 名前を入力してください");
      return;
    }
    if (!snapshot) {
      setError("validation/structure: ストラクチャを選択してください");
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({ name: name.trim(), snapshot });
    } catch (e) {
      const wrapped = AppError.from(e, "tournament/unknown", "保存に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="t-name">トーナメント名</Label>
        <Input id="t-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>ストラクチャ</Label>
        {loadingList ? (
          <p className="text-sm text-muted-foreground">ストラクチャを読込中…</p>
        ) : structures.length === 0 ? (
          <p className="text-sm text-destructive">
            ストラクチャがありません。先に /structures/new で作成してください。
          </p>
        ) : (
          <Select value={selectedSid ?? undefined} onValueChange={onPickStructure}>
            <SelectTrigger>
              <SelectValue placeholder="選択してください" />
            </SelectTrigger>
            <SelectContent>
              {structures.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  {s.name} ({s.levels.length} レベル)
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {snapshot ? (
          <p className="text-xs text-muted-foreground">
            初期 {snapshot.initialStack} / 締切 Lv
            {snapshot.lateEntryDeadlineLevel} / {snapshot.levels.length} レベル が snapshot
            として保存されます
          </p>
        ) : null}
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting || !snapshot || structures.length === 0}>
          {submitting ? "保存中…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel}>
            キャンセル
          </Button>
        ) : null}
      </div>
    </form>
  );
}
