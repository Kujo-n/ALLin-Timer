"use client";

import type { AuthCredential } from "firebase/auth";
import { useEffect, useState } from "react";

import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { LinkAccountDialog } from "@/components/auth/LinkAccountDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { joinInputSchema } from "@/lib/firebase/schemas/player";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { AccountLinkRequired } from "@/lib/services/auth-actions";
import {
  cancelOwnEntry,
  joinAsCurrentUser,
  joinAsExistingUser,
  joinAsGuest,
  joinViaEmailLinkRequest,
  joinViaGoogle,
  type ReceiptResult,
} from "@/lib/services/receipt";

type Tab = "login" | "guest" | "email";
type Status =
  | { kind: "joined"; result: ReceiptResult }
  | { kind: "link-sent"; email: string }
  | { kind: "cancelled" };

export function JoinClient({ tid }: { tid: string }) {
  const { user, loading: authLoading } = useAuthUser();
  const [tab, setTab] = useState<Tab>("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  const [linkRequest, setLinkRequest] = useState<{
    email: string;
    credential: AuthCredential;
  } | null>(null);

  useEffect(() => {
    // user が居るタイミングで tournament を取得（rules が auth 必須のため）
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const t = await getTournament(tid);
        if (!cancelled) setTournament(t);
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/read_failed", "トーナメント取得失敗");
        logger.warn(wrapped.message, { code: wrapped.code });
        if (!cancelled) setError(`${wrapped.code}: ${wrapped.message}`);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tid]);

  function wrapError(e: unknown) {
    const wrapped = AppError.from(e, "receipt/unknown", "受付に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    setError(`${wrapped.code}: ${wrapped.message}`);
  }

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const result = await joinAsExistingUser({ tid, email, password });
      setStatus({ kind: "joined", result });
    } catch (e) {
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function onGuestSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = joinInputSchema.safeParse({ tid, displayName });
    if (!parsed.success) {
      setError(`validation/join: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const result = await joinAsGuest({
        tid,
        displayName: parsed.data.displayName,
      });
      setStatus({ kind: "joined", result });
    } catch (e) {
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function onEmailLinkSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const parsed = joinInputSchema.safeParse({ tid, displayName });
    if (!parsed.success) {
      setError(`validation/join: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      await joinViaEmailLinkRequest({
        tid,
        email,
        displayName: parsed.data.displayName,
      });
      setStatus({ kind: "link-sent", email });
    } catch (e) {
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function onGoogleJoin() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await joinViaGoogle({ tid });
      setStatus({ kind: "joined", result });
    } catch (e) {
      if (e instanceof AccountLinkRequired) {
        setLinkRequest({ email: e.email, credential: e.pendingCredential });
        return;
      }
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function onContinueAsSignedIn() {
    setError(null);
    setSubmitting(true);
    try {
      const result = await joinAsCurrentUser({
        tid,
        displayName: user?.displayName ?? user?.email ?? undefined,
      });
      setStatus({ kind: "joined", result });
    } catch (e) {
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }

  async function onCancelOwnEntry() {
    setError(null);
    setSubmitting(true);
    try {
      await cancelOwnEntry(tid);
      setStatus({ kind: "cancelled" });
    } catch (e) {
      wrapError(e);
    } finally {
      setSubmitting(false);
    }
  }

  if (status) {
    const title =
      status.kind === "joined"
        ? status.result === "already-joined"
          ? "既に参加済みです"
          : "受付完了"
        : status.kind === "cancelled"
          ? "参加を取り消しました"
          : "メールを送信しました";
    const description =
      status.kind === "joined"
        ? "運営者が席決めするまでお待ちください。"
        : status.kind === "cancelled"
          ? "再度参加したい場合は、下のボタンから受付画面に戻ってください。"
          : `${status.email} 宛に届いたリンクを開いてください。届かない場合は迷惑メールフォルダも確認してください。`;
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {tournament ? <p>トーナメント: {tournament.name}</p> : null}
            {error ? (
              <p className="text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {status.kind === "joined" ? (
              <Button
                variant="outline"
                size="sm"
                disabled={submitting}
                onClick={() => {
                  void onCancelOwnEntry();
                }}
              >
                {submitting ? "取消中…" : "参加を取り消す"}
              </Button>
            ) : null}
            {status.kind === "cancelled" ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setStatus(null);
                  setError(null);
                }}
              >
                受付画面に戻る
              </Button>
            ) : null}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md space-y-6 p-8">
      <Card>
        <CardHeader>
          <CardTitle>{tournament ? tournament.name : "トーナメント受付"}</CardTitle>
          <CardDescription>以下 3 つのいずれかで受付してください。</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {authLoading ? (
            <p className="text-sm text-muted-foreground">読込中…</p>
          ) : user && !user.isAnonymous ? (
            <div className="space-y-2 rounded-md border p-3">
              <p className="text-sm">{user.displayName ?? user.email} としてログイン済みです。</p>
              <Button
                onClick={() => {
                  void onContinueAsSignedIn();
                }}
                disabled={submitting}
                size="sm"
              >
                {submitting ? "処理中…" : "このアカウントで受付"}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={() => {
                void onGoogleJoin();
              }}
              disabled={submitting}
            >
              <GoogleIcon className="h-4 w-4" />
              Google で参加
            </Button>
          )}

          <div role="tablist" className="flex gap-1 border-b text-sm">
            {(
              [
                ["guest", "ゲスト"],
                ["login", "ログイン"],
                ["email", "メール登録"],
              ] as [Tab, string][]
            ).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  setError(null);
                }}
                className={`border-b-2 px-3 py-2 ${
                  tab === value
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "guest" ? (
            <form onSubmit={onGuestSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="g-name">表示名</Label>
                <Input
                  id="g-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "処理中…" : "ゲストで受付"}
              </Button>
              <p className="text-xs text-muted-foreground">
                匿名参加です。別端末からの再ログインはできません。
              </p>
            </form>
          ) : null}

          {tab === "login" ? (
            <form onSubmit={onLoginSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="l-email">メールアドレス</Label>
                <Input
                  id="l-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="l-password">パスワード</Label>
                <Input
                  id="l-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "処理中…" : "ログインして受付"}
              </Button>
            </form>
          ) : null}

          {tab === "email" ? (
            <form onSubmit={onEmailLinkSubmit} className="space-y-3">
              <div className="space-y-2">
                <Label htmlFor="e-name">表示名</Label>
                <Input
                  id="e-name"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="e-email">メールアドレス</Label>
                <Input
                  id="e-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "送信中…" : "参加用メールリンクを送信"}
              </Button>
              <p className="text-xs text-muted-foreground">
                届いたメールのリンクを開くとアカウント作成 + 受付が完了します。
                次回以降のログインも同じメールアドレスでリンクを発行してください。
              </p>
            </form>
          ) : null}

          {error ? (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          ) : null}
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
          onLinked={async () => {
            setLinkRequest(null);
            // 連携直後に現在のアカウントで受付を進める
            try {
              const result = await joinAsCurrentUser({ tid });
              setStatus({ kind: "joined", result });
            } catch (e) {
              wrapError(e);
            }
          }}
        />
      ) : null}
    </main>
  );
}
