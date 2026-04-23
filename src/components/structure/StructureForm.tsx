"use client";

import { useState } from "react";

import { LevelTable } from "@/components/structure/LevelTable";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createStructureInputSchema,
  type Level,
} from "@/lib/firebase/schemas/structure";

export interface StructureFormInitialValue {
  name: string;
  description?: string;
  initialStack: number;
  rebuyStack: number | null;
  addOnStack: number | null;
  lateEntryDeadlineLevel: number;
  levels: Level[];
}

/**
 * StructureForm が submit 時に呼び出す共通入力。
 * Phase 4.8: `mode === "template"` では `description` のみ利用し、
 * `groupId` / `createdByUid` は呼出側で付与する。
 */
export interface StructureFormSubmitInput {
  name: string;
  description: string;
  initialStack: number;
  rebuyStack: number | null;
  addOnStack: number | null;
  lateEntryDeadlineLevel: number;
  levels: Level[];
  /** `mode === "structure"` の場合のみ値が入る */
  groupId?: string;
  /** `mode === "structure"` の場合のみ値が入る */
  createdByUid?: string;
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
  description: "",
  initialStack: 10000,
  rebuyStack: null,
  addOnStack: null,
  lateEntryDeadlineLevel: 6,
  levels: [
    { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
    { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
  ],
};

type Props =
  | {
      mode?: "structure";
      initialValue?: StructureFormInitialValue;
      submitLabel?: string;
      groupId: string;
      createdByUid: string;
      onSubmit: (input: StructureFormSubmitInput) => Promise<void>;
      onCancel?: () => void;
    }
  | {
      mode: "template";
      initialValue?: StructureFormInitialValue;
      submitLabel?: string;
      groupId?: never;
      createdByUid?: never;
      onSubmit: (input: StructureFormSubmitInput) => Promise<void>;
      onCancel?: () => void;
    };

export function StructureForm(props: Props) {
  const { mode = "structure", initialValue = DEFAULT_INITIAL, submitLabel = "保存", onSubmit, onCancel } = props;
  const [name, setName] = useState(initialValue.name);
  const [description, setDescription] = useState(initialValue.description ?? "");
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

    const common = {
      name,
      initialStack,
      rebuyStack,
      addOnStack,
      lateEntryDeadlineLevel,
      levels,
    };

    let payload: StructureFormSubmitInput;
    if (mode === "structure") {
      const { groupId, createdByUid } = props as {
        groupId: string;
        createdByUid: string;
      };
      const parsed = createStructureInputSchema.safeParse({
        ...common,
        groupId,
        createdByUid,
      });
      if (!parsed.success) {
        const msg = parsed.error.issues
          .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
          .join(", ");
        setError(`validation/structure: ${msg}`);
        return;
      }
      payload = {
        name: parsed.data.name,
        description: "",
        initialStack: parsed.data.initialStack,
        rebuyStack: parsed.data.rebuyStack ?? null,
        addOnStack: parsed.data.addOnStack ?? null,
        lateEntryDeadlineLevel: parsed.data.lateEntryDeadlineLevel,
        levels: parsed.data.levels,
        groupId: parsed.data.groupId,
        createdByUid: parsed.data.createdByUid,
      };
    } else {
      // template mode: 呼出側の createStructureTemplateInputSchema で最終 validate。
      // ここでは最低限の空文字チェックのみを UI 応答用に行う。
      if (name.trim() === "") {
        setError("validation/template: name: 名前を入力してください");
        return;
      }
      if (levels.length === 0) {
        setError("validation/template: levels: レベルを最低 1 つ追加してください");
        return;
      }
      payload = { ...common, description };
    }

    setSubmitting(true);
    try {
      await onSubmit(payload);
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
        <Label htmlFor="s-name">{mode === "template" ? "テンプレート名" : "ストラクチャ名"}</Label>
        <Input id="s-name" value={name} onChange={(e) => setName(e.target.value)} required maxLength={60} />
      </div>
      {mode === "template" ? (
        <div className="space-y-2">
          <Label htmlFor="s-desc">説明（任意）</Label>
          <Input
            id="s-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={200}
            placeholder="例: 標準 20 分 / 15 レベル"
          />
        </div>
      ) : null}
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
