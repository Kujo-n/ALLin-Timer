"use client";

import Link from "next/link";
import type { Timestamp } from "firebase/firestore";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

function formatDateOrNull(ts: Timestamp | null | undefined): string {
  if (!ts) return "未設定";
  return ts.toDate().toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
}

/**
 * Phase A: サークル詳細画面の「シーズン」管理カード。
 *
 *  - 全メンバー: 開始日表示 + ランキング画面への導線
 *  - owner / organizer: 「シーズンを開始する」ボタンを additional 表示
 */
export function SeasonCard({
  gid,
  seasonStartDate,
  isOrganizer,
  onRequestStartSeason,
  working,
}: {
  gid: string;
  seasonStartDate: Timestamp | null | undefined;
  isOrganizer: boolean;
  onRequestStartSeason: () => void;
  working: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>シーズン</CardTitle>
        <CardDescription>
          シーズン累計の参加・優勝・FT・ポイントを集計します。
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          現在シーズン開始:{" "}
          <span className="font-semibold">{formatDateOrNull(seasonStartDate)}</span>
        </p>
        <Link href={`/groups/${gid}/season`}>
          <Button variant="outline" size="sm">
            ランキングを見る
          </Button>
        </Link>
        {isOrganizer ? (
          <Button
            type="button"
            size="sm"
            onClick={onRequestStartSeason}
            disabled={working}
          >
            シーズンを開始する
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
