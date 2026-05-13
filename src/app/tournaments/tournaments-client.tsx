"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError, formatErrorForDisplay, getErrorCode } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getPlayer } from "@/lib/firebase/repositories/players";
import { listTournamentsByGroup } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc, TournamentState } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import { cn } from "@/lib/utils";

// Phase 4.7: `/tournaments` 一覧カードの状態別スタイル。
//   色だけでなく日本語ラベルで区別するため色覚依存しない。
type StateTone = {
  border: string;
  badge: string;
  label: string;
  dim: boolean;
};

function toneForState(state: TournamentState): StateTone {
  switch (state) {
    case "running":
      return {
        border: "border-emerald-400 dark:border-emerald-500",
        badge: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
        label: "進行中",
        dim: false,
      };
    case "paused":
      return {
        border: "border-amber-400 dark:border-amber-500",
        badge: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
        label: "一時停止",
        dim: false,
      };
    case "finished":
      return {
        border: "border-muted",
        badge: "bg-muted text-muted-foreground",
        label: "終了",
        dim: true,
      };
    case "seating":
      return {
        border: "border-slate-300 dark:border-slate-600",
        badge: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
        label: "席決め中",
        dim: false,
      };
    case "setup":
    default:
      return {
        border: "border-slate-300 dark:border-slate-600",
        badge: "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200",
        label: "未開催",
        dim: false,
      };
  }
}

export function TournamentsClient() {
  const { currentGroupId, groups, isOrganizer } = useCurrentGroup();
  const { user } = useAuthUser();
  // `AuthProvider` は `refreshUser()` のたびに user オブジェクトの参照が変わる
  // （updateProfile 後の displayName 反映 bump）。uid のみを依存に取り出して
  // 無関係な再 fetch（参加済み判定の全 tournament 分の read）を防ぐ。
  const userId = user?.uid ?? null;
  const [items, setItems] = useState<TournamentDoc[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // dryrun-feedback-batch-1: member 視点で「自分が参加済みの tournament」を Set で保持し、
  //   ボタンを `variant="outline"` + label "参加済み" に切り替える。link は維持する（`/live` で
  //   受付確認 UX に到達できる動線を残す）。organizer は本判定を走らせない（不要 read 削減）。
  const [joinedTids, setJoinedTids] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!currentGroupId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const list = await listTournamentsByGroup(currentGroupId);
        if (cancelled) return;
        setItems(list);
        // 参加済み判定: member（非 organizer）でかつ user がいるときのみ Promise.allSettled で並列取得。
        //   個別 row の failure（permission-denied / network）は warn のみで握りつぶし、
        //   他 row の表示は壊さない。観戦モード anon 視聴では userId===null で分岐に入らず既存 UX 維持。
        if (!isOrganizer && userId && list.length > 0) {
          const results = await Promise.allSettled(
            list.map((t) => getPlayer(t.id, userId).then((p) => (p ? t.id : null))),
          );
          if (cancelled) return;
          const next = new Set<string>();
          for (let i = 0; i < results.length; i++) {
            const r = results[i];
            if (r.status === "fulfilled" && r.value) {
              next.add(r.value);
            } else if (r.status === "rejected") {
              logger.warn("joined check failed", {
                tid: list[i]?.id,
                code: getErrorCode(r.reason),
              });
            }
          }
          setJoinedTids(next);
        } else {
          setJoinedTids(new Set());
        }
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "一覧取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(formatErrorForDisplay(wrapped));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentGroupId, isOrganizer, userId]);

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
          {isOrganizer ? (
            <Link href="/tournaments/new">
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
          {isOrganizer
            ? "まだトーナメントがありません。「新規作成」から作成してください。"
            : "開催中のトーナメントはありません。"}
        </p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {items.map((t) => {
            const tone = toneForState(t.state);
            return (
              <Card
                key={t.id}
                role="group"
                aria-label={`${t.name}（${tone.label}${t.spectateEnabled ? "・観戦公開中" : ""}）`}
                className={cn(
                  "border-2 transition",
                  tone.border,
                  tone.dim ? "opacity-70 hover:opacity-100" : "hover:bg-accent/30",
                )}
              >
                <CardHeader>
                  <CardTitle>{t.name}</CardTitle>
                  <CardDescription>
                    <span
                      className={cn(
                        "mr-2 rounded px-2 py-0.5 text-xs font-medium",
                        tone.badge,
                      )}
                    >
                      {tone.label}
                    </span>
                    {/* Phase 3 (04-spectate-mode): 公開中の tournament を一目で識別。
                        色は state badge と被らない sky 系。member にも見せて誤公開放置の検知に使う。 */}
                    {t.spectateEnabled ? (
                      <span
                        className="mr-2 rounded bg-sky-500/10 px-2 py-0.5 text-xs font-medium text-sky-700 dark:text-sky-300"
                        aria-label="観戦モード公開中"
                      >
                        観戦公開中
                      </span>
                    ) : null}
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
                      {isOrganizer ? (
                        <Button size="sm">タイマー</Button>
                      ) : joinedTids.has(t.id) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`${t.name} の受付確認に戻る（参加済み）`}
                        >
                          参加済み
                        </Button>
                      ) : (
                        <Button size="sm">参加する</Button>
                      )}
                    </Link>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
