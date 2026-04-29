"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { AuthCredential } from "firebase/auth";

import { DisplayNameDialog } from "@/components/auth/DisplayNameDialog";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { LinkAccountDialog } from "@/components/auth/LinkAccountDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import {
  AccountLinkRequired,
  loginWithEmail,
  registerWithEmail,
  signInWithGoogle,
} from "@/lib/services/auth-actions";
import { sanitizeRedirect } from "@/lib/services/redirect";

type Mode = "login" | "register";

export function LoginClient() {
  const { user, loading, refreshUser } = useAuthUser();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = sanitizeRedirect(params.get("redirect"));

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkRequest, setLinkRequest] = useState<{
    email: string;
    credential: AuthCredential;
  } | null>(null);
  const [displayNameDialogOpen, setDisplayNameDialogOpen] = useState(false);

  useEffect(() => {
    // submitting / displayNameDialogOpen 中は onGoogleSignIn 側の制御に委ねる
    // （Google 新規ユーザーで onAuthStateChanged が DisplayNameDialog より先に
    // 走っても、ここで redirect しないようにするため）。
    if (!loading && user && !user.isAnonymous && !submitting && !displayNameDialogOpen) {
      router.replace(redirect);
    }
  }, [user, loading, router, redirect, submitting, displayNameDialogOpen]);

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, displayName);
        // Phase 4.7: register で updateProfile した displayName をヘッダに即反映
        refreshUser();
      }
      router.replace(redirect);
    } catch (e) {
      const wrapped = AppError.from(e, "auth/unknown", "認証に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function onGoogleSignIn() {
    setError(null);
    setSubmitting(true);
    try {
      const { isNewUser } = await signInWithGoogle();
      if (isNewUser) {
        // Phase 4.7: 新規ユーザーは displayName 設定ダイアログを必須表示。
        // redirect は dialog の onDone で行う。
        setDisplayNameDialogOpen(true);
        return;
      }
      router.replace(redirect);
    } catch (e) {
      if (e instanceof AccountLinkRequired) {
        setLinkRequest({ email: e.email, credential: e.pendingCredential });
        return;
      }
      const wrapped = AppError.from(e, "auth/google-failed", "Google ログインに失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const title = mode === "login" ? "ログイン" : "新規登録";

  return (
    <main className="mx-auto max-w-md space-y-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>
            運営者としてトーナメントを作成／管理するための認証画面です。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => {
              void onGoogleSignIn();
            }}
            disabled={submitting}
          >
            <GoogleIcon className="h-4 w-4" />
            Google でログイン
          </Button>
          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">または</span>
            </div>
          </div>

          <div role="tablist" className="flex gap-1 border-b text-sm">
            {(
              [
                ["login", "ログイン"],
                ["register", "新規登録"],
              ] as [Mode, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={mode === value}
                onClick={() => {
                  setMode(value);
                  setError(null);
                }}
                className={`border-b-2 px-3 py-2 ${
                  mode === value
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmitPassword} className="space-y-4">
            {mode === "register" ? (
              <div className="space-y-2">
                <Label htmlFor="reg-name">表示名</Label>
                <Input
                  id="reg-name"
                  required
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">
                  トーナメント参加時に席表・参加者一覧に表示される名前です（
                  {DISPLAY_NAME_MAX_LENGTH} 文字以内）。
                </p>
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">メールアドレス</Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">パスワード</Label>
              <Input
                id="password"
                type="password"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "送信中…" : mode === "login" ? "ログイン" : "新規登録"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {linkRequest ? (
        <LinkAccountDialog
          open={linkRequest !== null}
          onOpenChange={(open) => {
            if (!open) setLinkRequest(null);
          }}
          email={linkRequest.email}
          pendingCredential={linkRequest.credential}
          onLinked={() => {
            router.replace(redirect);
          }}
        />
      ) : null}

      {displayNameDialogOpen ? (
        <DisplayNameDialog
          open={displayNameDialogOpen}
          onDone={() => {
            setDisplayNameDialogOpen(false);
            router.replace(redirect);
          }}
        />
      ) : null}
    </main>
  );
}
