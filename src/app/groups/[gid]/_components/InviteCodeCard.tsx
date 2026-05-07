"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { logger } from "@/lib/logger";

interface InviteCodeCardProps {
  /** 発行済みの招待コード文字列。null なら未発行（Input 非表示）。 */
  issuedCode: string | null;
  /** ボタンの click ハンドラ。発行 service を呼ぶ。 */
  onIssue: () => void;
  /** 親コンポーネントの「他の操作中」フラグ。true なら発行ボタン無効。 */
  working: boolean;
  /** 招待 URL の origin。SSR 時は `""`（呼出側で `window.location.origin` を渡す）。 */
  origin: string;
  /** クリップボードコピー失敗時に親へエラー文字列を伝搬する callback。 */
  onCopyError?: (message: string) => void;
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
  onCopyError,
}: InviteCodeCardProps) {
  const inviteUrl = issuedCode ? `${origin}/groups/join/${issuedCode}` : null;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setCopied(false);
  }, [issuedCode]);

  async function onCopy() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      logger.warn("clipboard copy failed", {
        code: "clipboard/unavailable",
        message: e instanceof Error ? e.message : String(e),
      });
      onCopyError?.("clipboard/unavailable: クリップボードにコピーできませんでした");
    }
  }

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
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              以下のリンクまたは QR コードを共有してください（7 日有効）
            </p>
            <div className="flex justify-center rounded-md border bg-white p-4">
              <QRCodeSVG value={inviteUrl} size={192} aria-label="招待 URL の QR コード" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Input readOnly value={inviteUrl} className="flex-1 min-w-0" />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void onCopy()}
                aria-label="招待 URL をコピー"
              >
                {copied ? "コピーしました" : "URL をコピー"}
              </Button>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
