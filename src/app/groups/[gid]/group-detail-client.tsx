"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getGroup } from "@/lib/firebase/repositories/groups";
import { getUserProfile } from "@/lib/firebase/repositories/users";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import {
  deleteGroupByOwner,
  generateJoinCode,
  leaveGroup,
  renameGroup,
} from "@/lib/services/group";

type MemberLine = { uid: string; displayName: string };

function originSafe(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export function GroupDetailClient({ gid }: { gid: string }) {
  const { user } = useAuthUser();
  const router = useRouter();
  const { refreshGroups, setCurrentGroupId, currentGroupId } = useCurrentGroup();
  const [group, setGroup] = useState<GroupDoc | null>(null);
  const [members, setMembers] = useState<MemberLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [issuedCode, setIssuedCode] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const g = await getGroup(gid);
      setGroup(g);
      setRenameValue(g.name);
      const settled = await Promise.allSettled(g.memberUids.map((uid) => getUserProfile(uid)));
      const lines: MemberLine[] = g.memberUids.map((uid, i) => {
        const r = settled[i];
        if (r.status === "fulfilled" && r.value) {
          return { uid, displayName: r.value.displayName };
        }
        return { uid, displayName: uid };
      });
      setMembers(lines);
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code, gid });
      setError(`${wrapped.code}: ${wrapped.message}`);
    }
  }, [gid, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  if (!user) return null;

  if (error) {
    return (
      <main className="mx-auto max-w-3xl space-y-4 p-8">
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
        <Link href="/groups">
          <Button variant="outline">サークル一覧へ</Button>
        </Link>
      </main>
    );
  }

  if (!group) {
    return <main className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">読込中…</main>;
  }

  const isOwner = group.ownerUid === user.uid;

  async function onIssueCode() {
    if (!user) return;
    setWorking(true);
    try {
      const code = await generateJoinCode({
        gid,
        createdByUid: user.uid,
      });
      setIssuedCode(code);
    } catch (e) {
      const wrapped = AppError.from(e, "group/code-failed", "招待コード発行に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  async function onRename(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setWorking(true);
    try {
      await renameGroup({ gid, uid: user.uid, name: renameValue });
      setRenameOpen(false);
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "group/rename-failed", "サークル名の更新に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  async function onLeave() {
    if (!user) return;
    setWorking(true);
    try {
      await leaveGroup({ gid, uid: user.uid });
      if (currentGroupId === gid) setCurrentGroupId(null);
      await refreshGroups();
      router.push("/groups");
    } catch (e) {
      const wrapped = AppError.from(e, "group/leave-failed", "サークル脱退に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setConfirmLeaveOpen(false);
      setWorking(false);
    }
  }

  async function onDelete() {
    if (!user) return;
    setWorking(true);
    try {
      await deleteGroupByOwner({ gid, uid: user.uid });
      if (currentGroupId === gid) setCurrentGroupId(null);
      await refreshGroups();
      router.push("/groups");
    } catch (e) {
      const wrapped = AppError.from(e, "group/delete-failed", "サークル削除に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setConfirmDeleteOpen(false);
      setWorking(false);
    }
  }

  const inviteUrl = issuedCode ? `${originSafe()}/groups/join/${issuedCode}` : null;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            メンバー {group.memberUids.length} 人 / {isOwner ? "あなたがオーナー" : "メンバー"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/groups">
            <Button variant="outline" size="sm">
              一覧へ
            </Button>
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCurrentGroupId(gid);
              router.push("/tournaments");
            }}
          >
            トーナメント
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setCurrentGroupId(gid);
              router.push("/structures");
            }}
          >
            ストラクチャ
          </Button>
          {isOwner ? (
            <Button variant="outline" size="sm" onClick={() => setRenameOpen(true)}>
              名前変更
            </Button>
          ) : null}
          {isOwner ? (
            <Button variant="destructive" size="sm" onClick={() => setConfirmDeleteOpen(true)}>
              削除
            </Button>
          ) : (
            <Button variant="destructive" size="sm" onClick={() => setConfirmLeaveOpen(true)}>
              脱退
            </Button>
          )}
        </div>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>メンバー</CardTitle>
          <CardDescription>
            このサークルに所属する運営者一覧。Phase 2.5
            ではロールはありません（オーナー以外は対等）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-1 text-sm">
            {members.map((m) => (
              <li key={m.uid} className="flex items-center gap-2">
                <span>{m.displayName}</span>
                {m.uid === group.ownerUid ? (
                  <span className="rounded bg-muted px-2 py-0.5 text-xs">オーナー</span>
                ) : null}
                {m.uid === user.uid ? (
                  <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                    あなた
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>招待コード</CardTitle>
          <CardDescription>
            メンバー全員が発行できます。デフォルト 7
            日間有効。リンクを口頭/チャットで共有してください。
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Button onClick={() => void onIssueCode()} disabled={working}>
            招待コードを発行
          </Button>
          {inviteUrl ? (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                以下のリンクを共有してください（7 日有効）
              </p>
              <Input readOnly value={inviteUrl} />
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Dialog open={renameOpen} onOpenChange={setRenameOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サークル名を変更</DialogTitle>
            <DialogDescription>新しい名前を入力してください（最大 60 文字）。</DialogDescription>
          </DialogHeader>
          <form onSubmit={onRename} className="space-y-4">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              maxLength={60}
              required
            />
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setRenameOpen(false)}
                disabled={working}
              >
                キャンセル
              </Button>
              <Button type="submit" disabled={working}>
                {working ? "更新中…" : "更新"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmLeaveOpen} onOpenChange={setConfirmLeaveOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サークルを脱退</DialogTitle>
            <DialogDescription>
              「{group.name}」から脱退します。脱退後はストラクチャ／トーナメントが見えなくなります。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmLeaveOpen(false)} disabled={working}>
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => void onLeave()} disabled={working}>
              脱退する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDeleteOpen} onOpenChange={setConfirmDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>サークルを削除</DialogTitle>
            <DialogDescription>
              「{group.name}」を削除します。配下のストラクチャ／トーナメントは
              <strong>削除されません</strong>が、誰からも見えなくなります。 先に /structures や
              /tournaments で配下データを削除しておくことを推奨します。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteOpen(false)}
              disabled={working}
            >
              キャンセル
            </Button>
            <Button variant="destructive" onClick={() => void onDelete()} disabled={working}>
              削除する
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </main>
  );
}
