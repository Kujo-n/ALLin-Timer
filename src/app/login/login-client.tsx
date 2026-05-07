"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";

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
  loginWithGoogle,
  registerWithEmail,
  signUpWithGoogle,
} from "@/lib/services/auth-actions";
import { sanitizeRedirect } from "@/lib/services/redirect";

type Mode = "login" | "register";

// notice を読ませてから redirect するまでの猶予。短すぎると読めず、長すぎると待たされ感が出る。
const NOTICE_REDIRECT_DELAY_MS = 3000;

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
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkRequest, setLinkRequest] = useState<{
    email: string;
    credential: AuthCredential;
  } | null>(null);
  const [displayNameDialogOpen, setDisplayNameDialogOpen] = useState(false);
  // notice を見せ終わるまでは auto-redirect を抑止する。
  const [noticeRedirecting, setNoticeRedirecting] = useState(false);
  // M-2: login + Google で `auth/not-registered-yet` を出した直後は、
  // delete + signOut 二重失敗で auth user が残っていても auto-redirect しない。
  const [notRegisteredYet, setNotRegisteredYet] = useState(false);
  // mode 切替や unmount で notice タイマーを必ず解放するための ref。
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current !== null) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    // submitting / displayNameDialogOpen / noticeRedirecting / notRegisteredYet 中は
    // 各 handler 側の制御に委ねる（zombie auth user で勝手に redirect されないよう
    // notRegisteredYet も明示的にガードに含める）。
    if (
      !loading &&
      user &&
      !user.isAnonymous &&
      !submitting &&
      !displayNameDialogOpen &&
      !noticeRedirecting &&
      !notRegisteredYet
    ) {
      router.replace(redirect);
    }
  }, [
    user,
    loading,
    router,
    redirect,
    submitting,
    displayNameDialogOpen,
    noticeRedirecting,
    notRegisteredYet,
  ]);

  function clearNoticeTimer() {
    if (noticeTimerRef.current !== null) {
      clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    }
  }

  function changeMode(next: Mode) {
    setMode(next);
    setError(null);
    setNotice(null);
    setNotRegisteredYet(false);
    setNoticeRedirecting(false);
    clearNoticeTimer();
  }

  async function onSubmitPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setNotRegisteredYet(false);
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

  function showNoticeAndRedirect(message: string) {
    setNotice(message);
    setNoticeRedirecting(true);
    clearNoticeTimer();
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      setNoticeRedirecting(false);
      // 即時 redirect も呼んでおく（auto-redirect useEffect とほぼ同時に発火するが冪等）。
      router.replace(redirect);
    }, NOTICE_REDIRECT_DELAY_MS);
  }

  async function onGoogleSignIn() {
    setError(null);
    setNotice(null);
    setNotRegisteredYet(false);
    setSubmitting(true);
    try {
      if (mode === "register") {
        const result = await signUpWithGoogle(displayName);
        refreshUser();
        if (result.mode === "already-existing") {
          // notice を NOTICE_REDIRECT_DELAY_MS だけ表示してから redirect。
          showNoticeAndRedirect(
            "既にアカウントがあるためログインしました。表示名は変更していません。",
          );
          return;
        }
        router.replace(redirect);
        return;
      }
      // login モード: 新規 Google アカウントは loginWithGoogle 内で弾かれる。
      // legacy ユーザー（isNewUser=false かつ displayName 未設定）は DisplayNameDialog 救済へ。
      const { needsDisplayNameSetup } = await loginWithGoogle();
      if (needsDisplayNameSetup) {
        setDisplayNameDialogOpen(true);
        return;
      }
      router.replace(redirect);
    } catch (e) {
      if (e instanceof AccountLinkRequired) {
        setLinkRequest({ email: e.email, credential: e.pendingCredential });
        return;
      }
      if (e instanceof AppError) {
        if (
          e.code === "validation/display-name-required" ||
          e.code === "validation/display-name-too-long"
        ) {
          setError(e.message);
          document.getElementById("reg-name")?.focus();
          return;
        }
        if (e.code === "auth/not-registered-yet") {
          // login モードで新規 Google アカウントが弾かれたケース。
          // 文言で「新規登録」タブへ誘導する。auto-redirect を抑止して
          // delete + signOut 二重失敗時の zombie auth user による意図せぬ
          // 遷移も防ぐ。
          setError(e.message);
          setNotRegisteredYet(true);
          return;
        }
        // 既に AppError なら内側の wrapAuthError で warn 済みなので二重 warn を避ける。
        setError(`${e.code}: ${e.message}`);
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
  const googleLabel = mode === "login" ? "Google でログイン" : "Google で新規登録";

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
                onClick={() => changeMode(value)}
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

          {mode === "register" ? (
            <>
              <div className="space-y-2 rounded-md border bg-muted/50 p-4">
                <Label htmlFor="reg-name" className="font-medium">
                  表示名（必須）
                </Label>
                <Input
                  id="reg-name"
                  required
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  className="bg-background"
                />
                <p className="text-xs text-muted-foreground">
                  トーナメント参加時に席表・参加者一覧に表示される名前です（
                  {DISPLAY_NAME_MAX_LENGTH} 文字以内）。
                  <strong className="font-medium">
                    メールアドレス／Google のどちらで登録する場合も先に入力してください。
                  </strong>
                </p>
              </div>
              <div className="relative my-2">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">登録方法を選択</span>
                </div>
              </div>
            </>
          ) : null}

          <form onSubmit={onSubmitPassword} className="space-y-4">
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
            {notice ? (
              <p className="text-sm text-muted-foreground" role="status">
                {notice}
              </p>
            ) : null}
            <Button type="submit" className="w-full" disabled={submitting}>
              {submitting ? "送信中…" : mode === "login" ? "ログイン" : "新規登録"}
            </Button>
          </form>

          <div className="relative my-2">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">または</span>
            </div>
          </div>

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
            {googleLabel}
          </Button>
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
