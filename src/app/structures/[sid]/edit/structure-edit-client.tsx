"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { StructureForm } from "@/components/structure/StructureForm";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import {
  getStructure,
  updateStructure,
} from "@/lib/firebase/repositories/structures";
import type {
  CreateStructureInput,
  StructureDoc,
} from "@/lib/firebase/schemas/structure";
import { logger } from "@/lib/logger";

export function StructureEditClient({ sid }: { sid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const [data, setData] = useState<StructureDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const s = await getStructure(sid);
        if (!cancelled) setData(s);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sid]);

  if (!user) return null;

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
    return (
      <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">
        読込中…
      </main>
    );
  }

  async function handleSubmit(input: CreateStructureInput) {
    await updateStructure(sid, {
      name: input.name,
      initialStack: input.initialStack,
      lateEntryDeadlineLevel: input.lateEntryDeadlineLevel,
      levels: input.levels,
    });
    router.push("/structures");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">ストラクチャを編集</h1>
      <StructureForm
        ownerUid={user.uid}
        initialValue={{
          name: data.name,
          initialStack: data.initialStack,
          lateEntryDeadlineLevel: data.lateEntryDeadlineLevel,
          levels: data.levels,
        }}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/structures")}
        submitLabel="更新"
      />
    </main>
  );
}
