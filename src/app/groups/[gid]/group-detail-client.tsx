"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { InlineNumberEditCard } from "@/components/group/InlineNumberEditCard";
import { Button } from "@/components/ui/button";
import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { getGroup, setMemberDisplayName } from "@/lib/firebase/repositories/groups";
import {
  deriveRole,
  DISPLAY_NAME_MAX_LENGTH,
  isOrganizerRole,
  type GroupDoc,
} from "@/lib/firebase/schemas/group";
import { useInlineNumberEdit } from "@/lib/hooks/useInlineNumberEdit";
import {
  DEFAULT_SEATS_PER_TABLE,
  MAX_SEATS_PER_TABLE,
  MIN_SEATS_PER_TABLE,
} from "@/lib/limits";
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
  setDefaultTableLabels,
  setFinishedTournamentCount,
  startNewSeason,
} from "@/lib/services/group";

import { GroupDefaultTableLabelsCard } from "./_components/GroupDefaultTableLabelsCard";
import { GroupHeaderCard } from "./_components/GroupHeaderCard";
import { InviteCodeCard } from "./_components/InviteCodeCard";
import { LeaveDeleteDialogs } from "./_components/LeaveDeleteDialogs";
import { MemberRoleList, type MemberLine } from "./_components/MemberRoleList";
import { SeasonCard } from "./_components/SeasonCard";
import { StartSeasonDialog } from "./_components/StartSeasonDialog";

function shortUid(uid: string): string {
  return uid.slice(0, 4);
}

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
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [confirmLeaveOpen, setConfirmLeaveOpen] = useState(false);
  const [confirmStartSeasonOpen, setConfirmStartSeasonOpen] = useState(false);
  const [working, setWorking] = useState(false);

  const reload = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const g = await getGroup(gid);
      setGroup(g);
      // Phase 4.7: 他メンバーの users/{uid} は rule で read できないため、
      // group.memberDisplayNames の snapshot を表示する。未登録 or UID 生値の場合は
      // UI 側で「名前未登録 (xxxx)」表記に置き換え、raw UID を見せない。
      const nameMap = g.memberDisplayNames ?? {};
      const lines: MemberLine[] = g.memberUids.map((uid) => {
        const raw = nameMap[uid]?.trim();
        const missing = !raw || raw === uid;
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
      const selfMissing = !selfEntry || selfEntry === user.uid;
      const authName = user.displayName?.trim();
      if (
        selfMissing &&
        authName &&
        authName !== user.uid &&
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

  // 数値 inline edit 2 枚は useInlineNumberEdit に集約。validate / onSaved /
  // errorCode/Message を渡し、view は InlineNumberEditCard で共通化する。
  // user が null の間は save が呼ばれないため、closure 内の user! は安全。
  const finishedCountEditor = useInlineNumberEdit({
    currentValue: group?.finishedTournamentCount ?? 0,
    save: (value) => setFinishedTournamentCount({ gid, uid: user!.uid, value }),
    validate: (n) =>
      Number.isInteger(n) && n >= 0
        ? null
        : "validation/finished-count-invalid: 開催数は 0 以上の整数で指定してください",
    onSaved: async () => {
      await reload();
      await refreshGroups();
    },
    onError: setError,
    errorCode: "group/finished-count-failed",
    errorMessage: "開催数の更新に失敗しました",
  });

  const defaultSeatsEditor = useInlineNumberEdit({
    currentValue: group?.defaultSeatsPerTable ?? DEFAULT_SEATS_PER_TABLE,
    save: (value) => setDefaultSeatsPerTable({ gid, uid: user!.uid, value }),
    validate: (n) =>
      Number.isInteger(n) && n >= MIN_SEATS_PER_TABLE && n <= MAX_SEATS_PER_TABLE
        ? null
        : `validation/default-seats-invalid: デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
    onSaved: async () => {
      await reload();
      await refreshGroups();
    },
    onError: setError,
    errorCode: "group/default-seats-failed",
    errorMessage: "デフォルト席数の更新に失敗しました",
  });

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
  const isOrganizer = isOrganizerRole(myRole);

  async function onIssueCode() {
    if (!user) return;
    setWorking(true);
    try {
      const code = await generateJoinCode({ gid, createdByUid: user.uid });
      setIssuedCode(code);
    } catch (e) {
      const wrapped = AppError.from(e, "group/code-failed", "招待コード発行に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setWorking(false);
    }
  }

  async function onRename(next: string): Promise<void> {
    if (!user) throw new AppError("認証が必要です", "auth/not-authenticated");
    setWorking(true);
    try {
      await renameGroup({ gid, uid: user.uid, name: next });
      await reload();
      await refreshGroups();
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

  async function onStartSeason() {
    if (!user) return;
    setWorking(true);
    setError(null);
    try {
      await startNewSeason({ gid, uid: user.uid });
      await reload();
      await refreshGroups();
    } catch (e) {
      const wrapped = AppError.from(e, "season/start-failed", "シーズン開始に失敗しました");
      setError(`${wrapped.code}: ${wrapped.message}`);
    } finally {
      setConfirmStartSeasonOpen(false);
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

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-8">
      <GroupHeaderCard
        group={group}
        myRole={myRole}
        isOwner={isOwner}
        isOrganizer={isOrganizer}
        working={working}
        onRename={onRename}
        onRequestDelete={() => setConfirmDeleteOpen(true)}
        onRequestLeave={() => setConfirmLeaveOpen(true)}
        onError={setError}
      />

      <InlineNumberEditCard
        title="開催数"
        description="終了したトーナメントの累計数。新規作成画面のデフォルト名連番に使用されます。"
        unit="回"
        displayPrefix="終了したトーナメント:"
        inputAriaLabel="開催数"
        editButtonAriaLabel="開催数を修正"
        editButtonLabel="修正"
        min={0}
        step={1}
        displayValue={group.finishedTournamentCount}
        canEdit={isOrganizer}
        editor={finishedCountEditor}
      />

      <InlineNumberEditCard
        title="1 Table あたりの席数（デフォルト）"
        description={`新規トーナメント作成時の「1 Table あたりの席数」初期値（${MIN_SEATS_PER_TABLE}〜${MAX_SEATS_PER_TABLE}）。`}
        unit="席"
        inputAriaLabel="1 Table あたりの席数（デフォルト）"
        editButtonAriaLabel="デフォルト席数を変更"
        editButtonLabel="変更"
        min={MIN_SEATS_PER_TABLE}
        max={MAX_SEATS_PER_TABLE}
        step={1}
        displayValue={group.defaultSeatsPerTable}
        canEdit={isOrganizer}
        editor={defaultSeatsEditor}
      />

      <GroupDefaultTableLabelsCard
        labels={group.defaultTableLabels ?? []}
        canEdit={isOrganizer}
        onSave={async (labels) => {
          await setDefaultTableLabels({ gid, uid: user.uid, labels });
          await reload();
          await refreshGroups();
        }}
        onError={setError}
      />

      <SeasonCard
        gid={gid}
        seasonStartDate={group.seasonStartDate}
        isOrganizer={isOrganizer}
        onRequestStartSeason={() => setConfirmStartSeasonOpen(true)}
        working={working}
      />

      <MemberRoleList
        group={group}
        members={members}
        selfUid={user.uid}
        isOwner={isOwner}
        working={working}
        onPromoteOrganizer={(targetUid) =>
          void runRoleAction(
            () => promoteToOrganizer({ gid, actorUid: user.uid, targetUid }),
            "運営へ昇格に失敗しました",
          )
        }
        onPromoteOwner={(targetUid) =>
          void runRoleAction(
            () => promoteToOwner({ gid, actorUid: user.uid, targetUid }),
            "オーナー昇格に失敗しました",
          )
        }
        onDemoteToMember={(targetUid) =>
          void runRoleAction(
            () => demoteToMember({ gid, actorUid: user.uid, targetUid }),
            "一般へ降格に失敗しました",
          )
        }
        onDemoteOwner={(targetUid) =>
          void runRoleAction(
            () => demoteOwner({ gid, actorUid: user.uid, targetUid }),
            "オーナー降格に失敗しました",
          )
        }
      />

      {isOrganizer ? (
        <InviteCodeCard
          issuedCode={issuedCode}
          onIssue={() => void onIssueCode()}
          working={working}
          origin={originSafe()}
          onCopyError={setError}
        />
      ) : null}

      <LeaveDeleteDialogs
        groupName={group.name}
        confirmLeaveOpen={confirmLeaveOpen}
        setConfirmLeaveOpen={setConfirmLeaveOpen}
        confirmDeleteOpen={confirmDeleteOpen}
        setConfirmDeleteOpen={setConfirmDeleteOpen}
        onLeave={() => void onLeave()}
        onDelete={() => void onDelete()}
        working={working}
      />

      <StartSeasonDialog
        open={confirmStartSeasonOpen}
        onOpenChange={setConfirmStartSeasonOpen}
        onConfirm={() => void onStartSeason()}
        working={working}
      />
    </main>
  );
}
