"use client";

import type { AuthCredential } from "firebase/auth";
import { useEffect, useState } from "react";

import { DisplayNameField } from "@/components/auth/DisplayNameField";
import { EmailPasswordFields, PASSWORD_MIN_LENGTH } from "@/components/auth/EmailPasswordFields";
import { GoogleIcon } from "@/components/auth/GoogleIcon";
import { LinkAccountDialog } from "@/components/auth/LinkAccountDialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppError, formatErrorForDisplay } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { joinInputSchema } from "@/lib/firebase/schemas/player";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import { AccountLinkRequired } from "@/lib/services/auth-actions";
import { useCurrentGroup } from "@/lib/services/current-group";
import {
  cancelOwnEntry,
  EntryFailedAfterRegister,
  joinAsCurrentUser,
  joinAsExistingUser,
  joinAsGuest,
  joinAsNewUser,
  joinViaGoogle,
  type ReceiptOutcome,
} from "@/lib/services/receipt";

import { JoinResultCard, type JoinStatus } from "./_components/JoinResultCard";

type Tab = "login" | "guest" | "register";

const TAB_LABELS: [Tab, string][] = [
  ["guest", "ゲスト"],
  ["login", "ログイン"],
  ["register", "新規登録"],
];

export function JoinClient({ tid }: { tid: string }) {
  const { user, loading: authLoading, refreshUser } = useAuthUser();
  const { groups, setCurrentGroupId, refreshGroups } = useCurrentGroup();
  const [tab, setTab] = useState<Tab>("guest");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<JoinStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [tournament, setTournament] = useState<TournamentDoc | null>(null);
  // M-3: アカウントだけ作られて受付が失敗した状態。復旧手順を案内するために保持する。
  const [accountCreated, setAccountCreated] = useState(false);
  const [linkRequest, setLinkRequest] = useState<{
    email: string;
    credential: AuthCredential;
  } | null>(null);

  // サインイン済み（非匿名）なら「ログイン」「新規登録」タブを畳む（レビュー M-4）。
  // どちらも `signInWithEmailAndPassword` / `createUserWithEmailAndPassword` で
  // **現在のセッションを差し替える**ため、上に出ている「このアカウントで受付」と衝突し、
  // 誤タップで意図せずサインアウトされる。別アカウントを使いたい場合はログアウトが正規手順。
  const isSignedInNonAnon = !!user && !user.isAnonymous;
  // 匿名ゲストにはタブを残す（ゲスト受付後にアカウントへ移行したい需要があるため）が、
  // 別 uid の参加者として二重登録されることを警告する（レビュー M-1）。
  const isAnonGuest = !!user?.isAnonymous;
  const visibleTabs: Tab[] = isSignedInNonAnon ? ["guest"] : ["guest", "login", "register"];

  useEffect(() => {
    // authLoading 中は user が null のため 3 タブが出る。認証確定でタブが消えたときに
    // 「選択中タブの中身が消えて空白になる」のを防ぐ。
    // error はここでは消さない — 「認証は通ったが受付で失敗した」直後にこの切替が走るため、
    // 失敗理由まで消すと画面から原因が消える（手動のタブ切替でのみクリアする）。
    if (isSignedInNonAnon && tab !== "guest") {
      setTab("guest");
    }
  }, [isSignedInNonAnon, tab]);

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

  async function onRegisterSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setAccountCreated(false);
    // 表示名はサーバ往復・アカウント作成の前に弾く（ゲストタブと同じ扱い）。
    const parsed = joinInputSchema.safeParse({ tid, displayName });
    if (!parsed.success) {
      setError(`validation/join: ${parsed.error.issues.map((i) => i.message).join(", ")}`);
      return;
    }
    setSubmitting(true);
    try {
      const outcome = await joinAsNewUser({
        tid,
        email,
        password,
        displayName: parsed.data.displayName,
      });
      // register 内の updateProfile 直後は onAuthStateChanged が再発火しないため、
      // AuthBadge 等のヘッダ表示を即更新する（ゲスト受付と同じ理由）。
      refreshUser();
      await applyReceiptOutcome(outcome);
    } catch (e) {
      if (e instanceof EntryFailedAfterRegister) {
        // アカウント作成は成功済み。同じメールでの再登録は auth/already-exists で
        // 弾かれるため、復旧手順（ログインタブでの再試行）を明示する（M-3）。
        setAccountCreated(true);
        wrapError(e);
        return;
      }
      if (e instanceof AppError && e.code === "auth/already-exists") {
        // 内側の wrapAuthError で warn 済み。二重 warn を避けて文言だけ差し替える。
        setError(
          "このメールアドレスは既に登録されています。「ログイン」タブから受付してください。",
        );
        return;
      }
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
    return (
      <JoinResultCard
        tid={tid}
        status={status}
        tournament={tournament}
        groups={groups}
        isAnon={!!user?.isAnonymous}
        submitting={submitting}
        error={error}
        onCancelEntry={() => {
          void onCancelOwnEntry();
        }}
        onBackToForm={() => {
          setStatus(null);
          setError(null);
        }}
      />
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
              <p className="text-xs text-muted-foreground">
                別のアカウントで受付する場合は、先にログアウトしてください。
              </p>
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

          {/* M-3: アカウントだけ作られて受付が失敗した状態の復旧案内。
              register 成功で user が確定するとタブが「ゲスト」だけに畳まれるため、
              フォーム内ではなくカード直下に置いて残す。 */}
          {accountCreated ? (
            <p
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
            >
              アカウントの作成は完了しています。受付だけが失敗したため、
              {isSignedInNonAnon
                ? "上の「このアカウントで受付」からやり直してください。"
                : "「ログイン」タブから同じメールアドレスで受付をやり直してください。"}
            </p>
          ) : null}

          <div role="tablist" className="flex gap-1 border-b text-sm">
            {TAB_LABELS.filter(([value]) => visibleTabs.includes(value)).map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => {
                  setTab(value);
                  setError(null);
                  setAccountCreated(false);
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

          {isAnonGuest && tab !== "guest" ? (
            <p
              role="status"
              className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-100"
            >
              いまはゲスト（匿名）で利用中です。ここでログイン／登録すると
              <strong className="font-medium">別の参加者として受付されます</strong>。
              ゲストで受付済みの場合は、先に参加を取り消してください。
            </p>
          ) : null}

          {tab === "guest" ? (
            <form onSubmit={onGuestSubmit} className="space-y-3">
              <DisplayNameField id="g-name" value={displayName} onChange={setDisplayName} />
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
              <EmailPasswordFields
                idPrefix="l"
                mode="login"
                email={email}
                password={password}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "処理中…" : "ログインして受付"}
              </Button>
            </form>
          ) : null}

          {tab === "register" ? (
            <form onSubmit={onRegisterSubmit} className="space-y-3">
              <DisplayNameField id="r-name" value={displayName} onChange={setDisplayName} />
              <EmailPasswordFields
                idPrefix="r"
                mode="register"
                email={email}
                password={password}
                onEmailChange={setEmail}
                onPasswordChange={setPassword}
                passwordMinLength={PASSWORD_MIN_LENGTH}
              />
              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "処理中…" : "登録して受付"}
              </Button>
              <p className="text-xs text-muted-foreground">
                アカウントを作ると、次回以降も同じアカウントで参加できます。
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
