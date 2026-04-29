"use client";

import { Pencil } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

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
import { getGroup, setMemberDisplayName } from "@/lib/firebase/repositories/groups";
import {
  deriveRole,
  DISPLAY_NAME_MAX_LENGTH,
  type GroupDoc,
  type MemberRole,
} from "@/lib/firebase/schemas/group";
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
  setDefaultSeatsPerTable,
  setFinishedTournamentCount,
} from "@/lib/services/group";

type MemberLine = { uid: string; displayName: string; missing: boolean };

function shortUid(uid: string): string {
  return uid.slice(0, 4);
}

function isUidLike(value: string, uid: string): boolean {
  return value === uid;
}

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
  const [inviteCopied, setInviteCopied] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const [editingName, setEditingName] = useState(false);
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const [editingCount, setEditingCount] = useState(false);
  const [countValue, setCountValue] = useState<string>("0");
  const countInputRef = useRef<HTMLInputElement | null>(null);
  const [editingSeats, setEditingSeats] = useState(false);
  const [seatsValue, setSeatsValue] = useState<string>("9");
  const seatsInputRef = useRef<HTMLInputElement | null>(null);
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
      // group.memberDisplayNames の snapshot を表示する。未登録 or UID 生値の場合は
      // UI 側で「名前未登録 (xxxx)」表記に置き換え、raw UID を見せない。
      const nameMap = g.memberDisplayNames ?? {};
      const lines: MemberLine[] = g.memberUids.map((uid) => {
        const raw = nameMap[uid]?.trim();
        const missing = !raw || isUidLike(raw, uid);
        return {
          uid,
          displayName: missing ? `名前未登録 (${shortUid(uid)})` : raw,
          missing,
        };
      });
      setMembers(lines);

      // 自分のエントリが未登録 / UID 生値なら auth.displayName で自動補完（self-key write）。
      // 旧クライアントで加入したメンバーや、Phase 4.7 以前に作成された group を visitor が
      // 自然に治す self-healing を担う。書込失敗は warn のみで throw しない。
      const selfEntry = nameMap[user.uid]?.trim();
      const selfMissing = !selfEntry || isUidLike(selfEntry, user.uid);
      const authName = user.displayName?.trim();
      if (
        selfMissing &&
        authName &&
        !isUidLike(authName, user.uid) &&
        authName.length <= DISPLAY_NAME_MAX_LENGTH
      ) {
        try {
          await setMemberDisplayName(gid, user.uid, authName);
          setMembers((prev) =>
            prev.map((m) =>
              m.uid === user.uid ? { uid: m.uid, displayName: authName, missing: false } : m,
            ),
          );
        } catch (e) {
          const wrapped = AppError.from(
            e,
            "group/self-backfill-failed",
            "自分の表示名の補完に失敗しました",
          );
          logger.warn(wrapped.message, { code: wrapped.code, gid, uid: user.uid });
        }
      }
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code, gid });
      setError(`${wrapped.code}: ${wrapped.message}`);
    }
  }, [gid, user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Phase 4.16: group が読込／reload されたら開催数 input の表示値を同期する。
  useEffect(() => {
    if (group) setCountValue(String(group.finishedTournamentCount ?? 0));
  }, [group]);

  // Phase 4.17: group 読込後に席数 input の表示値も同期する。
  useEffect(() => {
    if (group) setSeatsValue(String(group.defaultSeatsPerTable ?? 9));
  }, [group]);

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
      setInviteCopied(false);
    } catch (e) {
      const wrapped = AppError.from(e, "group/code-failed", "招待コード発行に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  async function onCopyInviteUrl() {
    if (!inviteUrl) return;
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setInviteCopied(true);
      setTimeout(() => setInviteCopied(false), 2000);
    } catch (e) {
      logger.warn("clipboard copy failed", {
        code: "clipboard/unavailable",
        message: e instanceof Error ? e.message : String(e),
      });
      setError("clipboard/unavailable: クリップボードにコピーできませんでした");
    }
  }

  async function onRename(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    const next = renameValue.trim();
    if (!group || next === "" || next === group.name) {
      setEditingName(false);
      setRenameValue(group?.name ?? "");
      return;
    }
    setWorking(true);
    try {
      await renameGroup({ gid, uid: user.uid, name: next });
      setEditingName(false);
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "group/rename-failed", "サークル名の更新に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  function startEditingName() {
    if (!group) return;
    setRenameValue(group.name);
    setEditingName(true);
    requestAnimationFrame(() => {
      nameInputRef.current?.focus();
      nameInputRef.current?.select();
    });
  }

  function cancelEditingName() {
    setEditingName(false);
    setRenameValue(group?.name ?? "");
  }

  function startEditingCount() {
    if (!group) return;
    setCountValue(String(group.finishedTournamentCount ?? 0));
    setEditingCount(true);
    requestAnimationFrame(() => {
      countInputRef.current?.focus();
      countInputRef.current?.select();
    });
  }

  function cancelEditingCount() {
    setEditingCount(false);
    setCountValue(String(group?.finishedTournamentCount ?? 0));
  }

  async function onSaveCount(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !group) return;
    const parsed = Number(countValue);
    if (!Number.isInteger(parsed) || parsed < 0) {
      setError("validation/finished-count-invalid: 開催数は 0 以上の整数で指定してください");
      return;
    }
    if (parsed === (group.finishedTournamentCount ?? 0)) {
      setEditingCount(false);
      return;
    }
    setWorking(true);
    try {
      await setFinishedTournamentCount({ gid, uid: user.uid, value: parsed });
      setEditingCount(false);
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "group/finished-count-failed", "開催数の更新に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  function startEditingSeats() {
    if (!group) return;
    setSeatsValue(String(group.defaultSeatsPerTable ?? 9));
    setEditingSeats(true);
    requestAnimationFrame(() => {
      seatsInputRef.current?.focus();
      seatsInputRef.current?.select();
    });
  }

  function cancelEditingSeats() {
    setEditingSeats(false);
    setSeatsValue(String(group?.defaultSeatsPerTable ?? 9));
  }

  async function onSaveSeats(e: React.FormEvent) {
    e.preventDefault();
    if (!user || !group) return;
    const parsed = Number(seatsValue);
    if (!Number.isInteger(parsed) || parsed < 2 || parsed > 10) {
      setError(
        "validation/default-seats-invalid: デフォルト席数は 2 以上 10 以下の整数で指定してください",
      );
      return;
    }
    if (parsed === (group.defaultSeatsPerTable ?? 9)) {
      setEditingSeats(false);
      return;
    }
    setWorking(true);
    try {
      await setDefaultSeatsPerTable({ gid, uid: user.uid, value: parsed });
      setEditingSeats(false);
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "group/default-seats-failed",
        "デフォルト席数の更新に失敗しました",
      );
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
        <div className="min-w-0 flex-1">
          {isOwner && editingName ? (
            <form onSubmit={onRename} className="flex items-center gap-2">
              <Input
                ref={nameInputRef}
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditingName();
                  }
                }}
                aria-label="サークル名"
                maxLength={60}
                required
                disabled={working}
                className="h-10 text-2xl font-bold"
              />
              <Button type="submit" size="sm" disabled={working}>
                {working ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelEditingName}
                disabled={working}
              >
                キャンセル
              </Button>
            </form>
          ) : isOwner ? (
            <button
              type="button"
              onClick={startEditingName}
              aria-label={`サークル名「${group.name}」を編集`}
              className="group inline-flex items-center gap-2 rounded-md text-left hover:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h1 className="text-2xl font-bold">{group.name}</h1>
              <Pencil
                className="h-4 w-4 text-muted-foreground transition group-hover:text-foreground"
                aria-hidden
              />
            </button>
          ) : (
            <h1 className="text-2xl font-bold">{group.name}</h1>
          )}
          <p className="mt-1 text-sm text-muted-foreground">
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
          {isOrganizer ? (
            <Link href={`/groups/${gid}/audio-settings`}>
              <Button variant="outline" size="sm">
                サウンド設定
              </Button>
            </Link>
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
          <CardTitle>開催数</CardTitle>
          <CardDescription>
            終了したトーナメントの累計数。新規作成画面のデフォルト名連番に使用されます。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isOrganizer && editingCount ? (
            <form onSubmit={onSaveCount} className="flex flex-wrap items-center gap-2">
              <Input
                ref={countInputRef}
                type="number"
                min={0}
                step={1}
                value={countValue}
                onChange={(e) => setCountValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditingCount();
                  }
                }}
                aria-label="開催数"
                disabled={working}
                className="h-10 w-32 text-base"
              />
              <span className="text-sm text-muted-foreground">回</span>
              <Button type="submit" size="sm" disabled={working}>
                {working ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelEditingCount}
                disabled={working}
              >
                キャンセル
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-base">
                終了したトーナメント:{" "}
                <span className="font-semibold">{group.finishedTournamentCount ?? 0}</span> 回
              </p>
              {isOrganizer ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startEditingCount}
                  aria-label="開催数を修正"
                >
                  <Pencil className="h-4 w-4" aria-hidden /> 修正
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>1 Table あたりの席数（デフォルト）</CardTitle>
          <CardDescription>
            新規トーナメント作成時の「1 Table あたりの席数」初期値（2〜10）。
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isOrganizer && editingSeats ? (
            <form onSubmit={onSaveSeats} className="flex flex-wrap items-center gap-2">
              <Input
                ref={seatsInputRef}
                type="number"
                min={2}
                max={10}
                step={1}
                value={seatsValue}
                onChange={(e) => setSeatsValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    cancelEditingSeats();
                  }
                }}
                aria-label="1 Table あたりの席数（デフォルト）"
                disabled={working}
                className="h-10 w-32 text-base"
              />
              <span className="text-sm text-muted-foreground">席</span>
              <Button type="submit" size="sm" disabled={working}>
                {working ? "保存中…" : "保存"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={cancelEditingSeats}
                disabled={working}
              >
                キャンセル
              </Button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <p className="text-base">
                <span className="font-semibold">{group.defaultSeatsPerTable ?? 9}</span> 席
              </p>
              {isOrganizer ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={startEditingSeats}
                  aria-label="デフォルト席数を変更"
                >
                  <Pencil className="h-4 w-4" aria-hidden /> 変更
                </Button>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

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
                  <span
                    className={
                      m.missing
                        ? "flex-1 truncate italic text-muted-foreground"
                        : "flex-1 truncate"
                    }
                    title={m.missing ? `UID: ${m.uid}` : undefined}
                  >
                    {m.displayName}
                  </span>
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
                <div className="flex flex-wrap items-center gap-2">
                  <Input readOnly value={inviteUrl} className="flex-1 min-w-0" />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void onCopyInviteUrl()}
                    aria-label="招待 URL をコピー"
                  >
                    {inviteCopied ? "コピーしました" : "URL をコピー"}
                  </Button>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

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
