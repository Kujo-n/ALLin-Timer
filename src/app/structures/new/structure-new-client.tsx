"use client";

import { useRouter } from "next/navigation";

import { StructureForm } from "@/components/structure/StructureForm";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { createStructure } from "@/lib/firebase/repositories/structures";
import type { CreateStructureInput } from "@/lib/firebase/schemas/structure";

export function StructureNewClient() {
  const { user } = useAuthUser();
  const router = useRouter();
  if (!user) return null;

  async function handleSubmit(input: CreateStructureInput) {
    await createStructure(input);
    router.push("/structures");
  }

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">ストラクチャを新規作成</h1>
      <StructureForm
        ownerUid={user.uid}
        onSubmit={handleSubmit}
        onCancel={() => router.push("/structures")}
        submitLabel="作成"
      />
    </main>
  );
}
