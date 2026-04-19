"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { useCurrentGroup } from "@/lib/services/current-group";

export function GroupsClient() {
  const { user } = useAuthUser();
  const {
    loading,
    groups,
    currentGroupId,
    setCurrentGroupId,
  } = useCurrentGroup();
  const searchParams = useSearchParams();
  const empty = searchParams.get("empty") === "1";

  if (!user) return null;

  return (
    <main className="mx-auto max-w-4xl space-y-6 p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">サークル</h1>
          <p className="text-sm text-muted-foreground">
            あなたが所属するサークル一覧。サークル単位でストラクチャ／トーナメントを共有します。
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/groups/new">
            <Button>新規作成</Button>
          </Link>
        </div>
      </header>

      {empty ? (
        <p className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          サークルに所属していません。新規作成するか、運営者から招待コードを受け取って加入してください。
        </p>
      ) : null}

      {loading && groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">読込中…</p>
      ) : groups.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>まだサークルがありません</CardTitle>
            <CardDescription>
              「新規作成」から自分のサークルを作るか、招待コードのリンクを踏むと加入できます。
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => {
            const isCurrent = g.id === currentGroupId;
            return (
              <Card key={g.id}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-2">
                    <CardTitle>{g.name}</CardTitle>
                    {isCurrent ? (
                      <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                        現在選択中
                      </span>
                    ) : null}
                  </div>
                  <CardDescription>
                    メンバー {g.memberUids.length} 人
                    {g.ownerUid === user.uid ? " / オーナー" : ""}
                  </CardDescription>
                </CardHeader>
                <CardContent className="flex gap-2">
                  <Link href={`/groups/${g.id}`}>
                    <Button variant="outline" size="sm">
                      詳細
                    </Button>
                  </Link>
                  {!isCurrent ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => setCurrentGroupId(g.id)}
                    >
                      切替
                    </Button>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
