"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  StructureForm,
  type StructureFormInitialValue,
  type StructureFormSubmitInput,
} from "@/components/structure/StructureForm";
import { StructureTemplatePicker } from "@/components/structure/StructureTemplatePicker";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { createStructure } from "@/lib/firebase/repositories/structures";
import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
import { useCurrentGroup } from "@/lib/services/current-group";

export function StructureNewClient() {
  const { user } = useAuthUser();
  const { currentGroupId, isOrganizer, loading } = useCurrentGroup();
  const router = useRouter();
  const [initialValue, setInitialValue] = useState<StructureFormInitialValue | undefined>(
    undefined,
  );
  // Phase 4.8: テンプレ適用時に StructureForm 内部の useState を再初期化させるため
  // key を bump して unmount → remount する。
  const [formKey, setFormKey] = useState(0);

  // Phase 4.6: 一般メンバーは URL 直打ち対策で /structures にリダイレクト。
  useEffect(() => {
    if (loading) return;
    if (!isOrganizer) {
      router.replace("/structures");
    }
  }, [loading, isOrganizer, router]);

  if (!user || !currentGroupId) return null;
  if (loading || !isOrganizer) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  function applyTemplate(t: StructureTemplateDoc) {
    setInitialValue({
      name: t.name,
      initialStack: t.initialStack,
      rebuyStack: t.rebuyStack,
      addOnStack: t.addOnStack,
      lateEntryDeadlineLevel: t.lateEntryDeadlineLevel,
      levels: t.levels.map((l) => ({ ...l })),
    });
    setFormKey((k) => k + 1);
  }

  async function handleSubmit(input: StructureFormSubmitInput) {
    if (!input.groupId || !input.createdByUid) {
      throw new Error("structure mode requires groupId / createdByUid");
    }
    await createStructure({
      groupId: input.groupId,
      createdByUid: input.createdByUid,
      name: input.name,
      initialStack: input.initialStack,
      rebuyStack: input.rebuyStack,
      addOnStack: input.addOnStack,
      lateEntryDeadlineLevel: input.lateEntryDeadlineLevel,
      levels: input.levels,
    });
    router.push("/structures");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">ストラクチャを新規作成</h1>
      <StructureTemplatePicker onSelect={applyTemplate} />
      <StructureForm
        key={formKey}
        initialValue={initialValue}
        groupId={currentGroupId}
        createdByUid={user.uid}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/structures")}
        submitLabel="作成"
      />
    </main>
  );
}
