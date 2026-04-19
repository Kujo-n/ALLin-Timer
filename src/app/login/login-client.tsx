"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import type { AuthCredential } from "firebase/auth";

import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { LinkAccountDialog } from "@/components/auth/LinkAccountDialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { logger } from "@/lib/logger";
import {
  AccountLinkRequired,
  loginWithEmail,
  registerWithEmail,
  sendEmailLinkForJoin,
  signInWithGoogle,
} from "@/lib/services/auth-actions";
import { sanitizeRedirect } from "@/lib/services/redirect";

type Mode = "login" | "register" | "email-link";

export function LoginClient() {
  const { user, loading } = useAuthUser();
  const router = useRouter();
  const params = useSearchParams();
  const redirect = sanitizeRedirect(params.get("redirect"));

  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkSentTo, setLinkSentTo] = useState<string | null>(null);
  const [linkRequest, setLinkRequest] = useState<{
    email: string;
    credential: AuthCredential;
  } | null>(null);

  useEffect(() => {
    if (!loading && user && !user.isAnonymous) {
      router.replace(redirect);
    }
  }, [user, loading, router, redirect]);

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (mode === "login") {
        await loginWithEmail(email, password);
      } else {
        await registerWithEmail(email, password, displayName);
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
      await signInWithGoogle();
      router.replace(redirect);
    } catch (e) {
      if (e instanceof AccountLinkRequired) {
        setLinkRequest({ email: e.email, credential: e.pendingCredential });
        return;
      }
      const wrapped = AppError.from(
        e,
        "auth/google-failed",
        "Google ログインに失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function onSubmitEmailLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      // redirect 先はログイン後の遷移先。/auth/email-link からクエリ経由で渡る。
      // displayName は任意 — 新規の場合はコールバックで Auth プロフィールに反映。
      await sendEmailLinkForJoin(
        email,
        redirect,
        displayName.trim() || undefined,
      );
      setLinkSentTo(email);
    } catch (e) {
      const wrapped = AppError.from(e, "auth/unknown", "メール送信に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code });
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  if (linkSentTo) {
    return (
      <main className="mx-auto max-w-md space-y-6 p-8">
        <Card>
          <CardHeader>
            <CardTitle>メールを送信しました</CardTitle>
            <CardDescription>
              {linkSentTo} 宛にログインリンクを送信しました。届かない場合は迷惑メールフォルダも確認してください。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setLinkSentTo(null);
                setMode("login");
              }}
            >
              ログイン画面に戻る
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  const title =
    mode === "login"
      ? "ログイン"
      : mode === "register"
        ? "新規登録"
        : "メールリンクでログイン";

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
              <span className="bg-background px-2 text-muted-foreground">
                または
              </span>
            </div>
          </div>

          <div role="tablist" className="flex gap-1 border-b text-sm">
            {(
              [
                ["login", "ログイン"],
                ["register", "新規登録"],
                ["email-link", "メールリンク"],
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

          {mode === "email-link" ? (
            <form onSubmit={onSubmitEmailLink} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="link-name">
                  表示名
                  <span className="ml-1 text-xs text-muted-foreground">
                    （初回登録時に必須、既存ユーザーは空欄で可）
                  </span>
                </Label>
                <Input
                  id="link-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="link-email">メールアドレス</Label>
                <Input
                  id="link-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "送信中…" : "ログインリンクを送信"}
              </Button>
              <p className="text-xs text-muted-foreground">
                参加者として「メールリンク」で受付した方は、次回以降もこの方法でログインしてください（パスワードは発行されません）。
              </p>
            </form>
          ) : (
            <form onSubmit={onSubmitPassword} className="space-y-4">
              {mode === "register" ? (
                <div className="space-y-2">
                  <Label htmlFor="reg-name">表示名</Label>
                  <Input
                    id="reg-name"
                    required
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    トーナメント参加時に席表・参加者一覧に表示される名前です。
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
                  autoComplete={
                    mode === "login" ? "current-password" : "new-password"
                  }
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
                {submitting
                  ? "送信中…"
                  : mode === "login"
                    ? "ログイン"
                    : "新規登録"}
              </Button>
            </form>
          )}
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
    </main>
  );
}
