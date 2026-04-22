"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AppError } from "@/lib/errors";
import { deleteStructure, listStructuresByGroup } from "@/lib/firebase/repositories/structures";
import type { StructureDoc } from "@/lib/firebase/schemas/structure";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";

export function StructuresClient() {
  const { currentGroupId, groups, isOrganizer } = useCurrentGroup();
  const [items, setItems] = useState<StructureDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StructureDoc | null>(null);

  const reload = useCallback(async () => {
    if (!currentGroupId) return;
    setError(null);
    setLoading(true);
    try {
      const list = await listStructuresByGroup(currentGroupId);
      setItems(list);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "一覧取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setLoading(false);
    }
  }, [currentGroupId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onDelete() {
    if (!deleteTarget) return;
    try {
      await deleteStructure(deleteTarget.id);
      setDeleteTarget(null);
      await reload();
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "削除に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    }
  }

  const currentGroup = groups.find((g) => g.id === currentGroupId);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">ストラクチャプリセット</h1>
          <p className="text-sm text-muted-foreground">
            {currentGroup
              ? `サークル「${currentGroup.name}」のプリセット。`
              : "現在のサークルのプリセット。"}
            {isOrganizer ? "運営で共有・編集できます。" : "閲覧のみ可能です。"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/groups">
            <Button variant="outline">サークル</Button>
          </Link>
          <Link href="/tournaments">
            <Button variant="outline">トーナメント一覧へ</Button>
          </Link>
          {isOrganizer ? (
            <Link href="/structures/new">
              <Button>新規作成</Button>
            </Link>
          ) : null}
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
          まだストラクチャがありません。「新規作成」から追加してください。
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((s) => (
            <Card key={s.id}>
              <CardHeader>
                <CardTitle>{s.name}</CardTitle>
                <CardDescription>
                  初期 {s.initialStack} / 締切 Lv{s.lateEntryDeadlineLevel} / {s.levels.length}{" "}
                  レベル
                </CardDescription>
              </CardHeader>
              <CardContent className="flex gap-2">
                {isOrganizer ? (
                  <>
                    <Link href={`/structures/${s.id}/edit`}>
                      <Button variant="outline" size="sm">
                        編集
                      </Button>
                    </Link>
                    <Button variant="destructive" size="sm" onClick={() => setDeleteTarget(s)}>
                      削除
                    </Button>
                  </>
                ) : null}
              </CardContent>
            </Card>
          ))}
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
