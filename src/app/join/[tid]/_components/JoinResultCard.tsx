"use client";

import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import type { AutoJoinFeedback, ReceiptResult } from "@/lib/services/receipt";

/** 受付完了 / 参加取消のどちらを表示しているか。 */
export type JoinStatus =
  | { kind: "joined"; result: ReceiptResult; autoJoin: AutoJoinFeedback | null }
  | { kind: "cancelled" };

export interface JoinResultCardProps {
  tid: string;
  status: JoinStatus;
  tournament: TournamentDoc | null;
  /** group コンテキストの一覧。自動所属したサークル名の解決に使う。 */
  groups: GroupDoc[];
  /** 匿名ゲストか。/live 導線の出し分けと文言に使う。 */
  isAnon: boolean;
  submitting: boolean;
  error: string | null;
  onCancelEntry: () => void;
  onBackToForm: () => void;
}

/**
 * 受付完了 / 参加取消後の結果画面。
 *
 * architect-refactor 20260801 (finding-8) で join-client.tsx から分離。
 * JSX は逐語移設で、DOM 構造 / role / class / 文言は移動前と完全に同一。
 */
export function JoinResultCard({
  tid,
  status,
  tournament,
  groups,
  isAnon,
  submitting,
  error,
  onCancelEntry,
  onBackToForm,
}: JoinResultCardProps) {
  const title =
    status.kind === "joined"
      ? status.result === "already-joined"
        ? "既に参加済みです"
        : "受付完了"
      : "参加を取り消しました";
  // Phase 5.1: 匿名ゲストには `/live` への遷移ボタンを出さない設計（動線完結）。
  const description =
    status.kind === "joined"
      ? isAnon
        ? "受付が完了しました。会場の運営 PC / 大画面でブラインドや席表をご確認ください。"
        : "運営者が席決めするまでお待ちください。"
      : "再度参加したい場合は、下のボタンから受付画面に戻ってください。";
  const autoJoin = status.kind === "joined" ? status.autoJoin : null;
  // refreshGroups 後の context から名前を引く。補修失敗などで引けない場合は
  // 汎用文言に fallback する（サークル名は必須情報ではない）。
  const joinedGroupName =
    autoJoin !== null ? (groups.find((g) => g.id === autoJoin.gid)?.name ?? null) : null;

  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          {tournament ? <p>トーナメント: {tournament.name}</p> : null}
          {autoJoin?.status === "joined" ? (
            <p
              role="status"
              className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100"
            >
              {joinedGroupName
                ? `${joinedGroupName} のメンバーになりました。`
                : "サークルのメンバーになりました。"}
            </p>
          ) : null}
          {autoJoin?.status === "failed" ? (
            <p className="text-xs text-muted-foreground">
              サークルへの登録は完了していません。次回の受付時に自動で再試行されます。
            </p>
          ) : null}
          {error ? (
            <p className="text-destructive" role="alert">
              {error}
            </p>
          ) : null}
          {status.kind === "joined" ? (
            <div className="flex flex-col gap-2">
              {!isAnon ? (
                <Link href={`/tournaments/${tid}/live`}>
                  <Button size="sm" className="w-full">
                    タイマー画面へ
                  </Button>
                </Link>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={onCancelEntry}
              >
                {submitting ? "取消中…" : "参加を取り消す"}
              </Button>
            </div>
          ) : null}
          {status.kind === "cancelled" ? (
            <Button variant="outline" size="sm" onClick={onBackToForm}>
              受付画面に戻る
            </Button>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
