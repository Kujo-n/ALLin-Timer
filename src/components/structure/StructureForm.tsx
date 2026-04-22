"use client";

import { useState } from "react";

import { LevelTable } from "@/components/structure/LevelTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createStructureInputSchema,
  type CreateStructureInput,
  type Level,
} from "@/lib/firebase/schemas/structure";

interface StructureFormInitialValue {
  name: string;
  initialStack: number;
  rebuyStack: number | null;
  addOnStack: number | null;
  lateEntryDeadlineLevel: number;
  levels: Level[];
}

function parseNonNegativeInt(value: string): number {
  const n = Number.parseInt(value, 10);
  return Number.isNaN(n) ? 0 : n;
}

function parseOptionalPositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const n = Number.parseInt(trimmed, 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

const DEFAULT_INITIAL: StructureFormInitialValue = {
  name: "",
  initialStack: 10000,
  rebuyStack: null,
  addOnStack: null,
  lateEntryDeadlineLevel: 6,
  levels: [
    { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
    { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
  ],
};

interface Props {
  initialValue?: StructureFormInitialValue;
  submitLabel?: string;
  groupId: string;
  createdByUid: string;
  onSubmit: (input: CreateStructureInput) => Promise<void>;
  onCancel?: () => void;
}

export function StructureForm({
  initialValue = DEFAULT_INITIAL,
  submitLabel = "保存",
  groupId,
  createdByUid,
  onSubmit,
  onCancel,
}: Props) {
  const [name, setName] = useState(initialValue.name);
  const [initialStack, setInitialStack] = useState(initialValue.initialStack);
  const [rebuyStack, setRebuyStack] = useState<number | null>(initialValue.rebuyStack);
  const [addOnStack, setAddOnStack] = useState<number | null>(initialValue.addOnStack);
  const [lateEntryDeadlineLevel, setLateEntryDeadlineLevel] = useState(
    initialValue.lateEntryDeadlineLevel,
  );
  const [levels, setLevels] = useState<Level[]>(initialValue.levels);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const input: CreateStructureInput = {
      groupId,
      createdByUid,
      name,
      initialStack,
      rebuyStack,
      addOnStack,
      lateEntryDeadlineLevel,
      levels,
    };
    const parsed = createStructureInputSchema.safeParse(input);
    if (!parsed.success) {
      const msg = parsed.error.issues
        .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
        .join(", ");
      setError(`validation/structure: ${msg}`);
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit(parsed.data);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const code =
        e && typeof e === "object" && "code" in e ? (e as { code: string }).code : "error/unknown";
      setError(`${code}: ${message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="s-name">ストラクチャ名</Label>
        <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="s-stack">初期スタック</Label>
          <Input
            id="s-stack"
            type="number"
            min={1}
            value={initialStack}
            onChange={(e) => setInitialStack(parseNonNegativeInt(e.target.value))}
            required
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-deadline">レイトエントリー締切レベル</Label>
          <Input
            id="s-deadline"
            type="number"
            min={1}
            value={lateEntryDeadlineLevel}
            onChange={(e) => setLateEntryDeadlineLevel(parseNonNegativeInt(e.target.value))}
            required
          />
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="s-rebuy">リバイ スタック（任意）</Label>
          <Input
            id="s-rebuy"
            type="number"
            min={1}
            value={rebuyStack ?? ""}
            onChange={(e) => setRebuyStack(parseOptionalPositiveInt(e.target.value))}
            placeholder="リバイなしの場合は空欄"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="s-addon">アドオン スタック（任意）</Label>
          <Input
            id="s-addon"
            type="number"
            min={1}
            value={addOnStack ?? ""}
            onChange={(e) => setAddOnStack(parseOptionalPositiveInt(e.target.value))}
            placeholder="アドオンなしの場合は空欄"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label>ブラインド構造</Label>
        <LevelTable levels={levels} onChange={setLevels} />
      </div>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="submit" disabled={submitting}>
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
