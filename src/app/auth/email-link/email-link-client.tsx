"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError } from "@/lib/errors";
import {
  completeEmailLink,
  getStoredDisplayNameForSignIn,
  getStoredEmailForSignIn,
  isEmailLinkUrl,
} from "@/lib/services/auth-actions";
import { joinViaEmailLinkComplete } from "@/lib/services/receipt";
import { logger } from "@/lib/logger";
import { sanitizeRedirect } from "@/lib/services/redirect";

function extractTid(redirect: string): string | null {
  const match = redirect.match(/^\/join\/([^/?#]+)/);
  return match ? match[1] : null;
}

type Stage =
  | { kind: "working" }
  | { kind: "need-email" }
  | { kind: "error"; code: string; message: string }
  | { kind: "done"; redirect: string };

export function EmailLinkClient() {
  const router = useRouter();
  const params = useSearchParams();
  const redirect = sanitizeRedirect(params.get("redirect"));
  const [stage, setStage] = useState<Stage>({ kind: "working" });
  const [fallbackEmail, setFallbackEmail] = useState("");
  // React Strict Mode で useEffect が 2 回走ると signInWithEmailLink が
  // 2 回目に `auth/invalid-action-code` で落ちるため 1 回で止める。
  const autoRunDoneRef = useRef(false);

  const runComplete = useCallback(
    async (email?: string) => {
      const currentUrl = typeof window !== "undefined" ? window.location.href : "";
      if (!isEmailLinkUrl(currentUrl)) {
        setStage({
          kind: "error",
          code: "auth/email-link-invalid",
          message: "メールリンクが不正です",
        });
        return;
      }
      try {
        const tid = extractTid(redirect);
        if (tid) {
          const storedDisplayName = getStoredDisplayNameForSignIn() ?? undefined;
          await joinViaEmailLinkComplete({
            tid,
            currentUrl,
            fallbackEmail: email,
            displayName: storedDisplayName,
          });
        } else {
          await completeEmailLink(currentUrl, email);
        }
        setStage({ kind: "done", redirect });
        router.replace(redirect);
      } catch (e) {
        const wrapped = AppError.from(
          e,
          "auth/email-link-failed",
          "メールリンク認証に失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code });
        if (wrapped.code === "auth/email-missing-on-callback") {
          setStage({ kind: "need-email" });
        } else {
          setStage({
            kind: "error",
            code: wrapped.code,
            message: wrapped.message,
          });
        }
      }
    },
    [redirect, router],
  );

  useEffect(() => {
    if (autoRunDoneRef.current) return;
    autoRunDoneRef.current = true;
    const stored = getStoredEmailForSignIn();
    void runComplete(stored ?? undefined);
  }, [runComplete]);

  async function onRetrySubmit(e: React.FormEvent) {
    e.preventDefault();
    setStage({ kind: "working" });
    await runComplete(fallbackEmail);
  }

  return (
    <main className="mx-auto max-w-md space-y-4 p-8">
      <Card>
        <CardHeader>
          <CardTitle>メールリンク認証</CardTitle>
          <CardDescription>リンクを処理しています。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {stage.kind === "working" ? (
            <p className="text-sm text-muted-foreground">処理中…</p>
          ) : null}
          {stage.kind === "done" ? <p className="text-sm">完了しました。遷移します…</p> : null}
          {stage.kind === "need-email" ? (
            <form onSubmit={onRetrySubmit} className="space-y-3">
              <p className="text-sm text-muted-foreground">
                別の端末で開いた可能性があります。送信時に使ったメールを入力してください。
              </p>
              <div className="space-y-2">
                <Label htmlFor="fallback-email">メールアドレス</Label>
                <Input
                  id="fallback-email"
                  type="email"
                  required
                  value={fallbackEmail}
                  onChange={(e) => setFallbackEmail(e.target.value)}
                />
              </div>
              <Button type="submit">確定</Button>
            </form>
          ) : null}
          {stage.kind === "error" ? (
            <div className="space-y-2">
              <p className="text-sm text-destructive" role="alert">
                {stage.code}: {stage.message}
              </p>
              <Button variant="outline" size="sm" onClick={() => router.replace("/tournaments")}>
                トーナメント一覧へ
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </main>
  );
}
