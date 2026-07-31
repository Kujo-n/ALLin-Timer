"use client";

import type { AuthCredential } from "firebase/auth";
import Link from "next/link";
import { useEffect, useState } from "react";

import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { LinkAccountDialog } from "@/components/auth/LinkAccountDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { joinInputSchema } from "@/lib/firebase/schemas/player";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { AccountLinkRequired } from "@/lib/services/auth-actions";
import { useCurrentGroup } from "@/lib/services/current-group";
import {
  cancelOwnEntry,
  joinAsCurrentUser,
  joinAsExistingUser,
  joinAsGuest,
  joinViaGoogle,
  type AutoJoinFeedback,
  type ReceiptOutcome,
  type ReceiptResult,
} from "@/lib/services/receipt";

type Tab = "login" | "guest";
type Status =
  | { kind: "joined"; result: ReceiptResult; autoJoin: AutoJoinFeedback | null }
  | { kind: "cancelled" };

export function JoinClient({ tid }: { tid: string }) {
  const { user, loading: authLoading, refreshUser } = useAuthUser();
  const { groups, setCurrentGroupId, refreshGroups } = useCurrentGroup();
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
        if (!cancelled) setError(formatErrorForDisplay(wrapped));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tid]);

  function wrapError(e: unknown) {
    const wrapped = AppError.from(e, "receipt/unknown", "受付に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    setError(formatErrorForDisplay(wrapped));
  }

  /**
   * 受付結果を画面に反映し、自動所属が起きていれば group コンテキストを更新する。
   * 4 経路（Google / ログイン / 継続 / 連携後）で同じ後処理を共有するための helper。
   *
   * - 新規加入時のみ `setCurrentGroupId`（既メンバーの選択中サークルを勝手に切り替えない）
   * - `already-member` でも `refreshGroups` する（前回失敗した `groupIds` の補修が
   *   走っているケースを一覧に反映するため）
   */
  async function applyReceiptOutcome(outcome: ReceiptOutcome) {
    setStatus({
      kind: "joined",
      result: outcome.result,
      autoJoin: outcome.autoJoin,
    });
    const autoJoin = outcome.autoJoin;
    if (!autoJoin) return;
    if (autoJoin.status === "joined") {
      setCurrentGroupId(autoJoin.gid);
    }
    if (autoJoin.status === "joined" || autoJoin.status === "already-member") {
      await refreshGroups();
    }
  }

  async function onLoginSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const outcome = await joinAsExistingUser({ tid, email, password });
      await applyReceiptOutcome(outcome);
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
      const outcome = await joinAsGuest({
        tid,
        displayName: parsed.data.displayName,
      });
      // Phase 4.7: updateProfile 直後に onAuthStateChanged は発火しないため、
      // AuthBadge 等のヘッダ表示を即更新するために refreshUser を呼ぶ。
      refreshUser();
      await applyReceiptOutcome(outcome);
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
      const outcome = await joinViaGoogle({ tid });
      await applyReceiptOutcome(outcome);
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
      const outcome = await joinAsCurrentUser({
        tid,
        displayName: user?.displayName ?? user?.email ?? undefined,
      });
      await applyReceiptOutcome(outcome);
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
        : "参加を取り消しました";
    // Phase 5.1: 匿名ゲストには `/live` への遷移ボタンを出さない設計（動線完結）。
    const isAnon = !!user?.isAnonymous;
    const description =
      status.kind === "joined"
        ? isAnon
          ? "受付が完了しました。会場の運営 PC / 大画面でブラインドや席表をご確認ください。"
          : "運営者が席決めするまでお待ちください。"
        : "再度参加したい場合は、下のボタンから受付画面に戻ってください。";
    const autoJoin = status.kind === "joined" ? status.autoJoin : null;
    // refreshGroups 後の context から名前を引く。補修失敗などで引けない場合は
    // 汎用文言に fallback する（サークル名は必須情報ではない）。
    const joinedGroupName =
      autoJoin !== null ? (groups.find((g) => g.id === autoJoin.gid)?.name ?? null) : null;
    return (
      <main className="mx-auto max-w-md space-y-4 p-8">
        <Card>
          <CardHeader>
            <CardTitle>{title}</CardTitle>
            <CardDescription>{description}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {tournament ? <p>トーナメント: {tournament.name}</p> : null}
            {autoJoin?.status === "joined" ? (
              <p
                role="status"
                className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-800 dark:border-emerald-700 dark:bg-emerald-900/20 dark:text-emerald-100"
              >
                {joinedGroupName
                  ? `${joinedGroupName} のメンバーになりました。`
                  : "サークルのメンバーになりました。"}
              </p>
            ) : null}
            {autoJoin?.status === "failed" ? (
              <p className="text-xs text-muted-foreground">
                サークルへの登録は完了していません。次回の受付時に自動で再試行されます。
              </p>
            ) : null}
            {error ? (
              <p className="text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {status.kind === "joined" ? (
              <div className="flex flex-col gap-2">
                {!isAnon ? (
                  <Link href={`/tournaments/${tid}/live`}>
                    <Button size="sm" className="w-full">
                      タイマー画面へ
                    </Button>
                  </Link>
                ) : null}
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
              </div>
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
          <CardDescription>以下のいずれかで受付してください。</CardDescription>
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
                  maxLength={DISPLAY_NAME_MAX_LENGTH}
                />
                <p className="text-xs text-muted-foreground">
                  {DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください。
                </p>
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
              const outcome = await joinAsCurrentUser({ tid });
              await applyReceiptOutcome(outcome);
            } catch (e) {
              wrapError(e);
            }
          }}
        />
      ) : null}
    </main>
  );
}
