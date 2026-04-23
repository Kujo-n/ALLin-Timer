"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { StructureForm } from "@/components/structure/StructureForm";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { createStructureTemplate } from "@/lib/firebase/repositories/structureTemplates";
import { createStructureTemplateInputSchema } from "@/lib/firebase/schemas/structureTemplate";
import { logger } from "@/lib/logger";

export function TemplateNewClient() {
  const { user, loading } = useAuthUser();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }
  if (!user || user.isAnonymous) {
    // 匿名ユーザーは createdByDisplayName の信頼性担保のため拒否（rule でも弾かれる）。
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <h1 className="text-2xl font-bold">テンプレートを作成</h1>
        <p className="text-sm text-muted-foreground">
          テンプレ作成には通常アカウント（Google / メール）でログインしてください。
        </p>
      </main>
    );
  }
  const displayName = user.displayName?.trim() || user.email || user.uid;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">テンプレートを作成</h1>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <StructureForm
        mode="template"
        onSubmit={async (input) => {
          const parsed = createStructureTemplateInputSchema.safeParse({
            name: input.name,
            description: input.description,
            initialStack: input.initialStack,
            rebuyStack: input.rebuyStack,
            addOnStack: input.addOnStack,
            lateEntryDeadlineLevel: input.lateEntryDeadlineLevel,
            levels: input.levels,
            createdByUid: user.uid,
            createdByDisplayName: displayName,
          });
          if (!parsed.success) {
            const msg = parsed.error.issues
              .map((i) => `${i.path.join(".") || "root"}: ${i.message}`)
              .join(", ");
            setError(`validation/template: ${msg}`);
            throw new AppError(msg, "validation/template");
          }
          try {
            await createStructureTemplate(parsed.data);
            router.push("/templates");
          } catch (e) {
            const wrapped = AppError.from(e, "firestore/write_failed", "作成失敗");
            logger.warn(wrapped.message, { code: wrapped.code });
            setError(`${wrapped.code}: ${wrapped.message}`);
            throw wrapped;
          }
        }}
        onCancel={() => router.push("/templates")}
        submitLabel="作成"
      />
    </main>
  );
}
