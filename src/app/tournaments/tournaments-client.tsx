"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError } from "@/lib/errors";
import { listTournamentsByGroup } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";

export function TournamentsClient() {
  const { currentGroupId, groups, isOrganizer } = useCurrentGroup();
  const [items, setItems] = useState<TournamentDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!currentGroupId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listTournamentsByGroup(currentGroupId);
        if (!cancelled) setItems(list);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "一覧取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentGroupId]);

  const currentGroup = groups.find((g) => g.id === currentGroupId);

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">トーナメント</h1>
          <p className="text-sm text-muted-foreground">
            {currentGroup
              ? `サークル「${currentGroup.name}」のトーナメント。`
              : "現在のサークルのトーナメント。"}
            {isOrganizer
              ? "運営は編集／開始／削除ができます。"
              : "参加するトーナメントを選んでください。"}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/groups">
            <Button variant="outline">サークル</Button>
          </Link>
          {isOrganizer ? (
            <>
              <Link href="/structures">
                <Button variant="outline">ストラクチャ</Button>
              </Link>
              <Link href="/tournaments/new">
                <Button>新規作成</Button>
              </Link>
            </>
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
          {isOrganizer
            ? "まだトーナメントがありません。「新規作成」から作成してください。"
            : "開催中のトーナメントはありません。"}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((t) => (
            <Card key={t.id} className="transition hover:bg-accent/30">
              <CardHeader>
                <CardTitle>{t.name}</CardTitle>
                <CardDescription>
                  <span className="mr-2 rounded bg-muted px-2 py-0.5 text-xs">{t.state}</span>
                  {t.structureSnapshot.levels.length} レベル / 初期{" "}
                  {t.structureSnapshot.initialStack}
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                <span>
                  現在 Lv{t.currentLevel} / 締切 Lv{t.lateEntryDeadlineLevel}
                </span>
                <div className="ml-auto flex gap-2">
                  {isOrganizer ? (
                    <Link href={`/tournaments/${t.id}`}>
                      <Button size="sm" variant="outline">
                        運営
                      </Button>
                    </Link>
                  ) : null}
                  <Link href={`/tournaments/${t.id}/live`}>
                    <Button size="sm">{isOrganizer ? "タイマー" : "参加する"}</Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
