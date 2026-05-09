"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { AccountDeleteSection } from "@/components/auth/AccountDeleteSection";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getUserProfile } from "@/lib/firebase/repositories/users";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { updateDisplayName } from "@/lib/services/auth-actions";

type Status =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved" }
  | { kind: "error"; message: string };

export function SettingsClient() {
  const { user, refreshUser } = useAuthUser();
  const [displayName, setDisplayName] = useState("");
  const [initialized, setInitialized] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      // Auth プロフィール優先、フォールバックで users/{uid} を参照
      const fromAuth = user.displayName?.trim();
      if (fromAuth) {
        if (!cancelled) {
          setDisplayName(fromAuth);
          setInitialized(true);
        }
        return;
      }
      try {
        const profile = await getUserProfile(user.uid);
        if (!cancelled) {
          setDisplayName(profile?.displayName ?? "");
          setInitialized(true);
        }
      } catch (e) {
        logger.warn("failed to load user profile", {
          code: "firestore/read_failed",
          message: e instanceof Error ? e.message : String(e),
        });
        if (!cancelled) setInitialized(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setStatus({ kind: "saving" });
    try {
      await updateDisplayName(displayName);
      // Phase 4.7: updateProfile 後のヘッダ即反映
      refreshUser();
      setStatus({ kind: "saved" });
    } catch (e) {
      const wrapped = AppError.from(e, "auth/unknown", "更新に失敗しました");
      setStatus({
        kind: "error",
        message: formatErrorForDisplay(wrapped),
      });
    }
  }

  if (!user || !initialized) {
    return <main className="mx-auto max-w-md p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>アカウント設定</CardTitle>
          <CardDescription>
            表示名はトーナメントの席表・参加者一覧に使用されます。変更は以降の参加に反映され、過去の参加者一覧は保持されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSave} className="space-y-4">
            <div className="space-y-1 text-xs text-muted-foreground">
              <div>
                メール: <span className="font-mono">{user.email ?? "（未設定）"}</span>
              </div>
              <div>方式: {user.isAnonymous ? "ゲスト（匿名）" : "通常アカウント"}</div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="display-name">表示名</Label>
              <Input
                id="display-name"
                required
                maxLength={DISPLAY_NAME_MAX_LENGTH}
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {DISPLAY_NAME_MAX_LENGTH} 文字以内。スマートフォンで 1 行に収まる長さに揃えています。
              </p>
            </div>
            {status.kind === "error" ? (
              <p className="text-sm text-destructive" role="alert">
                {status.message}
              </p>
            ) : null}
            {status.kind === "saved" ? (
              <p className="text-sm text-emerald-600" role="status">
                保存しました。
              </p>
            ) : null}
            <div className="flex gap-2">
              <Button type="submit" disabled={status.kind === "saving"}>
                {status.kind === "saving" ? "保存中…" : "保存"}
              </Button>
              <Link href="/tournaments">
                <Button type="button" variant="outline">
                  戻る
                </Button>
              </Link>
            </div>
          </form>
          <hr className="my-6 border-border" />
          <AccountDeleteSection user={user} />
        </CardContent>
      </Card>
    </main>
  );
}
