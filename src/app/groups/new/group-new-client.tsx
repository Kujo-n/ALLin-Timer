"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { useCurrentGroup } from "@/lib/services/current-group";
import { createGroupWithOwner } from "@/lib/services/group";
import { logger } from "@/lib/logger";

export function GroupNewClient() {
  const { user } = useAuthUser();
  const router = useRouter();
  const { setCurrentGroupId, refreshGroups } = useCurrentGroup();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!user) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setError("validation/name: 名前を入力してください");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const gid = await createGroupWithOwner({
        name: trimmed,
        ownerUid: user.uid,
      });
      setCurrentGroupId(gid);
      await refreshGroups();
      router.push(`/groups/${gid}`);
    } catch (e) {
      const wrapped = AppError.from(e, "group/create-failed", "サークル作成に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">サークルを新規作成</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="g-name">サークル名</Label>
          <Input
            id="g-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={60}
            required
          />
        </div>
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <Button type="submit" disabled={submitting}>
            {submitting ? "作成中…" : "作成"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => router.push("/groups")}
            disabled={submitting}
          >
            キャンセル
          </Button>
        </div>
      </form>
    </main>
  );
}
