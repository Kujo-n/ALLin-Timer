"use client";

import { useEffect, useState } from "react";

import { ThemedQRCode } from "@/components/qr/ThemedQRCode";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useClipboardCopy } from "@/lib/hooks/useClipboardCopy";
import { buildJoinUrl } from "@/lib/services/qr";

interface Props {
  tid: string;
  className?: string;
  /**
   * Phase 4.14 追加要望: 受付ダッシュボード側で「参加者向け受付 URL」の下に
   * レイトレジスト終了レベルを表示するために受け取る。/live など省略可能な
   * 文脈では undefined で渡さない運用。
   */
  lateEntryDeadlineLevel?: number;
}

export function QrPanel({ tid, className, lateEntryDeadlineLevel }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const { copied, copy } = useClipboardCopy(url);

  useEffect(() => {
    setUrl(buildJoinUrl(tid));
  }, [tid]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>参加者向け受付 URL</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {url ? (
          <>
            {/*
              Track D Phase D.2: ThemedQRCode が resolvedTheme に応じて fg/bg を切替える。
              framed=true（default）で内部の bg-card rounded border + p-4 wrapper を持つ。
              quiet zone は wrapper padding + SVG 内部の `marginSize={4}` で二重防御。
            */}
            <ThemedQRCode value={url} size={224} />
            <div className="space-y-2">
              <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{url}</p>
              <Button variant="outline" size="sm" onClick={() => void copy()}>
                {copied ? "コピーしました" : "URL をコピー"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">URL を生成中…</p>
        )}
        {/*
          Phase 4.14 追加要望: レイトレジスト終了レベルは「URL をコピー」ボタンの下に
          配置する（補助情報として末尾に表示する位置付け）。
        */}
        {typeof lateEntryDeadlineLevel === "number" ? (
          <p className="text-sm text-muted-foreground">
            レイトレジスト Lv{lateEntryDeadlineLevel}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
