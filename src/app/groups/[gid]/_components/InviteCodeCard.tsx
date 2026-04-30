"use client";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface InviteCodeCardProps {
  /** 発行済みの招待コード文字列。null なら未発行（Input 非表示）。 */
  issuedCode: string | null;
  /** ボタンの click ハンドラ。発行 service を呼ぶ。 */
  onIssue: () => void;
  /** 親コンポーネントの「他の操作中」フラグ。true なら発行ボタン無効。 */
  working: boolean;
  /** 招待 URL の origin。SSR 時は `""`（呼出側で `window.location.origin` を渡す）。 */
  origin: string;
}

/**
 * サークル詳細画面の招待コード発行カード。
 *
 * Phase 4 architect-refactor (P5-1) で `group-detail-client.tsx` から分離。
 * organizer / owner のみが描画する想定（呼出側で gating）。
 */
export function InviteCodeCard({
  issuedCode,
  onIssue,
  working,
  origin,
}: InviteCodeCardProps) {
  const inviteUrl = issuedCode ? `${origin}/groups/join/${issuedCode}` : null;
  return (
    <Card>
      <CardHeader>
        <CardTitle>招待コード</CardTitle>
        <CardDescription>
          運営のみ発行できます。デフォルト 7
          日間有効。リンクを口頭/チャットで共有してください。加入者は「一般メンバー」で入ります。
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <Button onClick={onIssue} disabled={working}>
          招待コードを発行
        </Button>
        {inviteUrl ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              以下のリンクを共有してください（7 日有効）
            </p>
            <Input readOnly value={inviteUrl} />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
