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
import { deriveRole, type GroupDoc, type MemberRole } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { useCurrentGroup } from "@/lib/services/current-group";
import {
  deleteGroupByOwner,
  demoteOwner,
  demoteToMember,
  generateJoinCode,
  leaveGroup,
  promoteToOrganizer,
  promoteToOwner,
  renameGroup,
} from "@/lib/services/group";

type MemberLine = { uid: string; displayName: string };

function originSafe(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

function roleLabel(role: MemberRole): string {
  if (role === "owner") return "オーナー";
  if (role === "organizer") return "運営";
  return "一般";
}

function roleBadgeClassName(role: MemberRole): string {
  if (role === "owner") return "rounded bg-amber-100 px-2 py-0.5 text-xs text-amber-800";
  if (role === "organizer") return "rounded bg-sky-100 px-2 py-0.5 text-xs text-sky-800";
  return "rounded bg-muted px-2 py-0.5 text-xs";
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
      // Phase 4.7: 他メンバーの users/{uid} は rule で read できないため、
      // group.memberDisplayNames の snapshot を表示する。未登録 / 空文字は uid フォールバック。
      //   `??` は空文字を通してしまうため `||` で falsy も除外する。
      const nameMap = g.memberDisplayNames ?? {};
      const lines: MemberLine[] = g.memberUids.map((uid) => ({
        uid,
        displayName: nameMap[uid] || uid,
      }));
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

  const myRole = deriveRole(group, user.uid);
  const isOwner = myRole === "owner";
  const isOrganizer = myRole === "owner" || myRole === "organizer";

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

  async function runRoleAction(fn: () => Promise<void>, errorLabel: string) {
    setWorking(true);
    setError(null);
    try {
      await fn();
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "group/role-change-failed", errorLabel);
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  const inviteUrl = issuedCode ? `${originSafe()}/groups/join/${issuedCode}` : null;
  const canIssueCode = isOrganizer;
  const onlyOwner = group.ownerUids.length <= 1;

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">{group.name}</h1>
          <p className="text-sm text-muted-foreground">
            メンバー {group.memberUids.length} 人 / オーナー {group.ownerUids.length} 人
            {myRole ? ` / あなたは${roleLabel(myRole)}` : ""}
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
          {isOrganizer ? (
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
          ) : null}
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
            ロールは「オーナー / 運営 / 一般」の 3 階層。オーナーのみ昇降格できます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm">
            {members.map((m) => {
              const role = deriveRole(group, m.uid) ?? "member";
              const isSelf = m.uid === user.uid;
              const targetIsOwner = role === "owner";
              const targetIsOrganizer = role === "organizer";
              const targetIsMember = role === "member";
              return (
                <li
                  key={m.uid}
                  className="flex flex-wrap items-center gap-2 rounded border p-2"
                >
                  <span className="flex-1 truncate">{m.displayName}</span>
                  <span className={roleBadgeClassName(role)}>{roleLabel(role)}</span>
                  {isSelf ? (
                    <span className="rounded bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800">
                      あなた
                    </span>
                  ) : null}
                  {isOwner && !isSelf ? (
                    <div className="flex flex-wrap gap-1">
                      {targetIsMember ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={working}
                          onClick={() =>
                            void runRoleAction(
                              () =>
                                promoteToOrganizer({
                                  gid,
                                  actorUid: user.uid,
                                  targetUid: m.uid,
                                }),
                              "運営へ昇格に失敗しました",
                            )
                          }
                        >
                          運営へ昇格
                        </Button>
                      ) : null}
                      {targetIsOrganizer ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={working}
                            onClick={() =>
                              void runRoleAction(
                                () =>
                                  promoteToOwner({
                                    gid,
                                    actorUid: user.uid,
                                    targetUid: m.uid,
                                  }),
                                "オーナー昇格に失敗しました",
                              )
                            }
                          >
                            オーナーへ昇格
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={working}
                            onClick={() =>
                              void runRoleAction(
                                () =>
                                  demoteToMember({
                                    gid,
                                    actorUid: user.uid,
                                    targetUid: m.uid,
                                  }),
                                "一般へ降格に失敗しました",
                              )
                            }
                          >
                            一般へ降格
                          </Button>
                        </>
                      ) : null}
                      {targetIsOwner ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={working || onlyOwner}
                          title={onlyOwner ? "最後のオーナーは降格できません" : undefined}
                          onClick={() =>
                            void runRoleAction(
                              () =>
                                demoteOwner({
                                  gid,
                                  actorUid: user.uid,
                                  targetUid: m.uid,
                                }),
                              "オーナー降格に失敗しました",
                            )
                          }
                        >
                          運営へ降格
                        </Button>
                      ) : null}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {canIssueCode ? (
        <Card>
          <CardHeader>
            <CardTitle>招待コード</CardTitle>
            <CardDescription>
              運営のみ発行できます。デフォルト 7
              日間有効。リンクを口頭/チャットで共有してください。加入者は「一般メンバー」で入ります。
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
      ) : null}

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
