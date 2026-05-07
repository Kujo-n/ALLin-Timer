"use client";

import type { User } from "firebase/auth";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorCode } from "@/lib/errors";
import {
  AccountDeleteSoleOwnerBlocked,
  deleteAccount,
} from "@/lib/services/account-delete";
import { reauthenticateAccount } from "@/lib/services/auth-actions";

type DialogState =
  | { kind: "closed" }
  | { kind: "confirm" }
  | { kind: "blocked-sole-owner"; groups: ReadonlyArray<{ id: string; name: string }> }
  | {
      kind: "confirm-partial-failure";
      failedGroups: ReadonlyArray<{ id: string; name: string }>;
    }
  | { kind: "reauth" }
  | { kind: "deleting" };

export function AccountDeleteSection({ user }: { user: User }) {
  const [state, setState] = useState<DialogState>({ kind: "closed" });
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  // partial-failure 確認 dialog の resolver。state を render-cycle 跨ぎで保持する。
  const partialFailureResolverRef = useRef<((proceed: boolean) => void) | null>(null);

  // 匿名ユーザーには本セクションを表示しない（既存の logout 経路で完結）。
  if (user.isAnonymous) return null;

  const providerId = user.providerData[0]?.providerId ?? null;

  async function runDelete() {
    setState({ kind: "deleting" });
    setError(null);
    try {
      const result = await deleteAccount({
        user,
        confirmPartialFailure: (failed) =>
          new Promise<boolean>((resolve) => {
            partialFailureResolverRef.current = resolve;
            setState({ kind: "confirm-partial-failure", failedGroups: failed });
          }),
      });
      if (result.needsReauth) {
        setState({ kind: "reauth" });
        return;
      }
      if (result.cancelled) {
        // partial-failure 確認 dialog でユーザーが「中止」を選択。
        // auth は活きたままなので closed に戻して section の inline alert で通知する。
        const message = `一部のサークル脱退に失敗したためアカウント削除を中止しました（失敗 ${result.failedGroupIds.length} 件）。時間を置いてもう一度「アカウントを削除する」を押すか、サークル運営に表示名のクリーンアップを依頼してください。`;
        setError(message);
        setState({ kind: "closed" });
        return;
      }
      // 成功 → onAuthStateChanged で user=null になり RequireAuth が / に redirect する
    } catch (e) {
      if (e instanceof AccountDeleteSoleOwnerBlocked) {
        setState({ kind: "blocked-sole-owner", groups: e.soleOwnerGroups });
        return;
      }
      // service 層 (`deleteAccount`) で AppError ラップ + warn ログ済み。
      // UI では二重 warn を避けるため code / message の表示のみ行う。
      const code = getErrorCode(e);
      const message = e instanceof Error ? e.message : "削除に失敗しました";
      setError(`${code}: ${message}`);
      setState({ kind: "closed" });
    }
  }

  async function runReauthThenDelete() {
    setState({ kind: "deleting" });
    setError(null);
    try {
      if (providerId === "password") {
        await reauthenticateAccount({ user, password });
      } else {
        await reauthenticateAccount({ user });
      }
      // 再認証成功 → 削除を再実行
      await runDelete();
    } catch (e) {
      // service 層 (`reauthenticateAccount`) で AppError ラップ + warn ログ済み。
      const code = getErrorCode(e);
      const message = e instanceof Error ? e.message : "再認証に失敗しました";
      setError(`${code}: ${message}`);
      setState({ kind: "reauth" });
    }
  }

  function closeAll() {
    // 確認 dialog 表示中に外側クリック / ESC が来た場合は cancel として resolve する。
    // resolver が存在しない（=他経路の dialog を閉じた）ときは no-op。
    if (partialFailureResolverRef.current) {
      partialFailureResolverRef.current(false);
      partialFailureResolverRef.current = null;
    }
    setState({ kind: "closed" });
    setPassword("");
    setError(null);
  }

  function resolvePartialFailure(proceed: boolean) {
    const resolver = partialFailureResolverRef.current;
    partialFailureResolverRef.current = null;
    if (!resolver) return;
    // 「続行」のときは deleteAccount が user.delete までを実行するため state を deleting に戻す。
    // 「中止」のときは runDelete 側が cancelled flag を見て closed + error を組み立てる。
    if (proceed) setState({ kind: "deleting" });
    resolver(proceed);
  }

  const submitting = state.kind === "deleting";

  return (
    <section
      className="space-y-3 rounded-md border border-destructive/40 bg-destructive/5 p-4"
      aria-labelledby="account-delete-heading"
    >
      <h2
        id="account-delete-heading"
        className="text-sm font-semibold text-destructive"
      >
        アカウントを削除
      </h2>
      <p className="text-xs text-muted-foreground">
        削除するとアカウント情報が完全に消去されます。所属サークルからは自動で脱退します。過去のトーナメント参加記録とシーズン戦績は残ります。取り消しはできません。
      </p>
      {error && state.kind === "closed" ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      <Button
        type="button"
        variant="destructive"
        onClick={() => setState({ kind: "confirm" })}
      >
        アカウントを削除する
      </Button>

      {/* (B) 削除確認 dialog */}
      <Dialog
        open={state.kind === "confirm"}
        onOpenChange={(open) => {
          if (!open) closeAll();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>アカウントを削除しますか？</DialogTitle>
            <DialogDescription>
              取り消せません。所属サークルから自動で脱退し、アカウント情報が完全に削除されます。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAll} disabled={submitting}>
              キャンセル
            </Button>
            <Button type="button" variant="destructive" onClick={runDelete} disabled={submitting}>
              {submitting ? "削除中…" : "削除する"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* (A) sole-owner block dialog */}
      <Dialog
        open={state.kind === "blocked-sole-owner"}
        onOpenChange={(open) => {
          if (!open) closeAll();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>削除できません</DialogTitle>
            <DialogDescription>
              以下のサークルはあなたが唯一のオーナーです。先に他のメンバーをオーナーに昇格するか、サークルを削除してください。
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            {state.kind === "blocked-sole-owner"
              ? state.groups.map((g) => <li key={g.id}>{g.name}</li>)
              : null}
          </ul>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeAll}>
              閉じる
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* (D) partial-failure 確認 dialog: 一部 group の脱退に失敗したとき */}
      <Dialog
        open={state.kind === "confirm-partial-failure"}
        onOpenChange={(open) => {
          if (!open) closeAll();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>一部のサークルから脱退できませんでした</DialogTitle>
            <DialogDescription>
              以下のサークルからの脱退に失敗しました。続行するとアカウントは削除されますが、これらのサークルにはあなたの表示名が残ります。後でサークル運営に連絡してクリーンアップを依頼するか、中止して再試行してください。
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc space-y-1 pl-6 text-sm">
            {state.kind === "confirm-partial-failure"
              ? state.failedGroups.map((g) => <li key={g.id}>{g.name}</li>)
              : null}
          </ul>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => resolvePartialFailure(false)}
            >
              中止する
            </Button>
            <Button
              type="button"
              variant="destructive"
              onClick={() => resolvePartialFailure(true)}
            >
              続行して削除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* (C) 再認証 dialog */}
      <Dialog
        open={state.kind === "reauth"}
        onOpenChange={(open) => {
          if (!open) closeAll();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>再認証が必要です</DialogTitle>
            <DialogDescription>
              セキュリティのため、もう一度ログインしてください。再認証が完了したらアカウント削除を継続します。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void runReauthThenDelete();
            }}
            className="space-y-4"
          >
            {providerId === "password" ? (
              <div className="space-y-2">
                <Label htmlFor="reauth-password">パスワード</Label>
                <Input
                  id="reauth-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
            ) : (
              <p className="text-sm">
                ボタンを押すとポップアップで再ログインを求められます。
              </p>
            )}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeAll} disabled={submitting}>
                キャンセル
              </Button>
              <Button type="submit" variant="destructive" disabled={submitting}>
                {submitting
                  ? "再認証中…"
                  : providerId === "password"
                    ? "再認証して削除"
                    : "Google で再認証"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}
