"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { StructureTemplateCard } from "@/components/structure/StructureTemplateCard";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import {
  deleteStructureTemplate,
  listStructureTemplates,
} from "@/lib/firebase/repositories/structureTemplates";
import type { StructureTemplateDoc } from "@/lib/firebase/schemas/structureTemplate";
import { useIsTemplateAdmin } from "@/lib/hooks/useIsTemplateAdmin";
import { logger } from "@/lib/logger";

export function TemplatesClient() {
  const { user, loading: authLoading } = useAuthUser();
  const { isAdmin } = useIsTemplateAdmin();
  const router = useRouter();
  const [items, setItems] = useState<StructureTemplateDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<StructureTemplateDoc | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const list = await listStructureTemplates();
      setItems(list);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "一覧取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(formatErrorForDisplay(wrapped));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authLoading || !user) return;
    void reload();
  }, [authLoading, user, reload]);

  async function onDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    try {
      await deleteStructureTemplate(target.id);
      setItems((prev) => prev.filter((x) => x.id !== target.id));
      setDeleteTarget(null);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "削除に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid: target.id });
      setError(formatErrorForDisplay(wrapped));
    }
  }

  if (authLoading || !user) {
    return <main className="mx-auto max-w-4xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Structure Templates</h1>
          <p className="text-sm text-muted-foreground">
            サークル横断で共有されるストラクチャのひな形。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/structures">
            <Button variant="outline">ストラクチャプリセット</Button>
          </Link>
          <Link href="/templates/new">
            <Button>新規作成</Button>
          </Link>
        </div>
      </header>

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {loading && items.length === 0 ? (
        <p className="text-sm text-muted-foreground">読込中…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          まだテンプレートがありません。「新規作成」から追加してください。
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {items.map((t) => {
            const isOwner = t.createdByUid === user.uid;
            return (
              <StructureTemplateCard
                key={t.id}
                template={t}
                variant="library"
                canEdit={isOwner}
                canDelete={isOwner || isAdmin}
                onEdit={(x) => router.push(`/templates/${x.id}/edit`)}
                onDelete={setDeleteTarget}
              />
            );
          })}
        </div>
      )}

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>削除しますか？</DialogTitle>
            <DialogDescription>
              「{deleteTarget?.name}」を削除します。この操作は元に戻せません。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                void onDelete();
              }}
            >
              削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
