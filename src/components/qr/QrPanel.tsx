"use client";

import { QRCodeSVG } from "qrcode.react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { logger } from "@/lib/logger";
import { buildJoinUrl } from "@/lib/services/qr";

export function QrPanel({ tid }: { tid: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setUrl(buildJoinUrl(tid));
  }, [tid]);

  async function onCopy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      logger.warn("clipboard copy failed", {
        code: "clipboard/unavailable",
        message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>参加者向け受付 URL</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {url ? (
          <>
            <div className="flex justify-center rounded-md border bg-white p-4">
              <QRCodeSVG value={url} size={224} />
            </div>
            <div className="space-y-2">
              <p className="break-all rounded-md bg-muted px-3 py-2 font-mono text-xs">{url}</p>
              <Button variant="outline" size="sm" onClick={onCopy}>
                {copied ? "コピーしました" : "URL をコピー"}
              </Button>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">URL を生成中…</p>
        )}
      </CardContent>
    </Card>
  );
}
