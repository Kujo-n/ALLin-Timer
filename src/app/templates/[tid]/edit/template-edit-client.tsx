"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { StructureForm } from "@/components/structure/StructureForm";
import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import {
  getStructureTemplate,
  updateStructureTemplate,
} from "@/lib/firebase/repositories/structureTemplates";
import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";

export function TemplateEditClient({ tid }: { tid: string }) {
  const { user, loading: authLoading } = useAuthUser();
  const router = useRouter();
  const [data, setData] = useState<StructureTemplateDoc | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const d = await getStructureTemplate(tid);
        if (cancelled) return;
        if (d.createdByUid !== user.uid) {
          // 他人のテンプレは rule でも update 拒否されるが、UX 的に一覧へ即戻す。
          router.replace("/templates");
          return;
        }
        setData(d);
      } catch (e) {
        // getStructureTemplate は内部で warn 済み。UI 表示のみここで担当する。
        const err = unwrapOrFrom(e, "firestore/read_failed", "取得失敗");
        if (!cancelled) {
          if (err.code === "firestore/not-found") {
            setNotFound(true);
          } else {
            setError(formatErrorForDisplay(err));
          }
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, user, tid, router]);

  if (authLoading || !user) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }
  if (notFound) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-destructive" role="alert">
          テンプレートが見つかりません。
        </p>
      </main>
    );
  }
  if (error) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      </main>
    );
  }
  if (!data) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">テンプレートを編集</h1>
      <StructureForm
        mode="template"
        initialValue={{
          name: data.name,
          description: data.description,
          initialStack: data.initialStack,
          rebuyStack: data.rebuyStack,
          addOnStack: data.addOnStack,
          lateEntryDeadlineLevel: data.lateEntryDeadlineLevel,
          levels: data.levels,
        }}
        onSubmit={async (input) => {
          try {
            await updateStructureTemplate(tid, {
              name: input.name,
              description: input.description,
              initialStack: input.initialStack,
              rebuyStack: input.rebuyStack,
              addOnStack: input.addOnStack,
              lateEntryDeadlineLevel: input.lateEntryDeadlineLevel,
              levels: input.levels,
            });
            router.push("/templates");
          } catch (e) {
            // updateStructureTemplate は内部で warn 済み。UI 表示と StructureForm 側の
            // エラー伝搬のため re-throw する。
            const err = unwrapOrFrom(e, "firestore/write_failed", "更新失敗");
            setError(formatErrorForDisplay(err));
            throw err;
          }
        }}
        onCancel={() => router.push("/templates")}
        submitLabel="更新"
      />
    </main>
  );
}
