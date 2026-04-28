import { arrayUnion, increment, runTransaction, Timestamp } from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firebaseAuth, firestore } from "@/lib/firebase/client";
import {
  createGroup,
  deleteGroup,
  getGroup,
  groupDocRef,
  removeMemberSelf,
  setMemberDisplayName,
  updateDefaultSeatsPerTable,
  updateFinishedTournamentCount,
  updateGroupName,
  updateGroupRoles,
} from "@/lib/firebase/repositories/groups";
import {
  createJoinCode,
  defaultExpiresAt,
  getJoinCode,
  isJoinCodeUsable,
  joinCodeDocRef,
} from "@/lib/firebase/repositories/groupJoinCodes";
import {
  addGroupIdToUser,
  getUserProfile,
  removeGroupIdFromUser,
} from "@/lib/firebase/repositories/users";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

/**
 * group を作成し、作成者の users/{uid}.groupIds に逆引きを追加する。
 * 失敗時は AppError を伝播させる（部分成功はそのまま：reverse 修復は本 Phase 範囲外）。
 *
 * Phase 4.7: `memberDisplayNames` にオーナーの表示名 snapshot を初期登録する。
 *   - currentUser.displayName（trim 後）を採用し、取れなければ uid にフォールバック。
 *   - **email にはフォールバックしない**（group メンバー全員に read される場所のため、
 *     生 email が PII として意図せず露出するのを避ける）。
 */
export async function createGroupWithOwner({
  name,
  ownerUid,
}: {
  name: string;
  ownerUid: string;
}): Promise<string> {
  const authUser = firebaseAuth.currentUser;
  const ownerDisplayName = authUser?.displayName?.trim() || ownerUid;
  const gid = await createGroup({ name, ownerUid, ownerDisplayName });
  await addGroupIdToUser(ownerUid, gid);
  logger.info("create group with owner ok", { gid, ownerUid });
  return gid;
}

/**
 * 招待コードを使って group に加入する（一般メンバーとして）。
 *
 * 1. `getJoinCode` で期限・最大使用回数チェック（クライアント側の早期失敗）
 * 2. 既メンバーなら no-op で gid を返す（冪等性）
 * 3. transaction で「招待コード usesCount +1」と「group memberUids に自分を追加 + joinCodeId を code で記録」を atomic に
 *    - organizerUids / ownerUids には追加しない（rule で self-add は memberUids 限定）
 *    - joinCodeId は rule の consumption proof（存在・gid 一致・期限・usesCount +1 / maxUses を rule 側で再検証する）
 * 4. transaction 外で users/{uid}.groupIds に gid を追加（rule で本人のみ更新可）
 */
export async function consumeJoinCode({
  code,
  uid,
}: {
  code: string;
  uid: string;
}): Promise<{ gid: string; alreadyMember: boolean }> {
  const codeDoc = await getJoinCode(code);
  if (!codeDoc) {
    logger.warn("consume join code: not found", { code });
    throw new AppError("無効な招待コードです", "group/invalid-code");
  }
  if (!isJoinCodeUsable(codeDoc)) {
    logger.warn("consume join code: not usable", {
      code,
      expiresAt: codeDoc.expiresAt.toMillis(),
      usesCount: codeDoc.usesCount,
      maxUses: codeDoc.maxUses,
    });
    throw new AppError(
      "招待コードが期限切れまたは使用回数上限に到達しています",
      "group/invalid-code",
    );
  }
  // 既メンバー判定は users/{uid}.groupIds（自分自身の doc、常に read 可）で行う。
  // groups/{gid} の read は memberUids に含まれるユーザーにしか許されないため、
  // 加入前のユーザーで getGroup を呼ぶと firestore/permission-denied になる。
  const profile = await getUserProfile(uid);
  if (profile?.groupIds?.includes(codeDoc.gid)) {
    logger.info("consume join code: already member", { code, uid, gid: codeDoc.gid });
    return { gid: codeDoc.gid, alreadyMember: true };
  }

  // Phase 4.7: 自分の表示名を group.memberDisplayNames に同時登録する。
  //   email をフォールバックにすると PII がメンバー全員に露出するため、
  //   auth.displayName → users/{uid}.displayName → uid の順で解決する。
  const authUser = firebaseAuth.currentUser;
  const selfDisplayName =
    authUser?.displayName?.trim() || profile?.displayName?.trim() || uid;

  try {
    await runTransaction(firestore, async (tx) => {
      const codeRef = joinCodeDocRef(code);
      const groupRef = groupDocRef(codeDoc.gid);
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists()) {
        throw new AppError("無効な招待コードです", "group/invalid-code");
      }
      const fresh = { id: codeSnap.id, ...codeSnap.data() };
      if (!isJoinCodeUsable(fresh)) {
        throw new AppError(
          "招待コードが期限切れまたは使用回数上限に到達しています",
          "group/invalid-code",
        );
      }
      tx.update(codeRef, { usesCount: increment(1) });
      tx.update(groupRef, {
        memberUids: arrayUnion(uid),
        joinCodeId: code,
        [`memberDisplayNames.${uid}`]: selfDisplayName,
      });
    });
  } catch (e) {
    const wrapped = AppError.from(e, "group/join-failed", "サークル加入に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, joinCode: code, uid });
    throw wrapped;
  }

  await addGroupIdToUser(uid, codeDoc.gid);
  logger.info("consume join code ok", { code, uid, gid: codeDoc.gid });
  return { gid: codeDoc.gid, alreadyMember: false };
}

/**
 * Phase 4.7: 自分の displayName を所属全 group の `memberDisplayNames[uid]` に反映する。
 * best-effort — 個別 group の書込失敗は warn で記録し、呼出元全体は throw させない。
 * `updateDisplayName` service 内から呼ばれる想定。
 *
 * 失敗した gid / error code は個別に warn ログへ出す（M1 類似の rule 不整合を
 * 発見しやすくするため）。サマリ（total / failed）もあわせて残す。
 */
export async function propagateDisplayNameToGroups(
  uid: string,
  groupIds: readonly string[],
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed || groupIds.length === 0) return;
  const results = await Promise.allSettled(
    groupIds.map((gid) => setMemberDisplayName(gid, uid, trimmed)),
  );
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status !== "rejected") return;
    failed += 1;
    const gid = groupIds[i];
    const reason = r.reason;
    const code =
      reason && typeof reason === "object" && "code" in reason
        ? ((reason as { code?: unknown }).code as string | undefined) ?? "unknown"
        : "unknown";
    logger.warn("propagate displayName per-group fail", {
      code: "group/propagate-per-group-fail",
      gid,
      uid,
      reasonCode: code,
    });
  });
  if (failed > 0) {
    logger.warn("propagate displayName partial fail", {
      code: "group/propagate-partial-fail",
      uid,
      total: groupIds.length,
      failed,
    });
  }
}

function assertOwner(group: GroupDoc, uid: string): void {
  if (!group.ownerUids.includes(uid)) {
    throw new AppError("オーナーのみ実行できます", "group/not-owner");
  }
}

function assertOrganizer(group: GroupDoc, uid: string): void {
  if (!group.organizerUids.includes(uid)) {
    throw new AppError("運営のみ実行できます", "group/not-organizer");
  }
}

/**
 * group から脱退する。最後のオーナーは脱退不可（先に別メンバーをオーナーに昇格 or group 削除）。
 * owner が残るケース（`ownerUids.length >= 2`）では owner 自身も脱退可能。
 */
export async function leaveGroup({ gid, uid }: { gid: string; uid: string }): Promise<void> {
  const group = await getGroup(gid);
  if (group.ownerUids.includes(uid) && group.ownerUids.length <= 1) {
    throw new AppError(
      "最後のオーナーは脱退できません。先に別のメンバーをオーナーに昇格するか group を削除してください。",
      "group/last-owner-cannot-leave",
    );
  }
  if (!group.memberUids.includes(uid)) {
    logger.info("leave group: already not a member", { gid, uid });
    await removeGroupIdFromUser(uid, gid).catch(() => {});
    return;
  }
  // owner が残る前提の脱退（2 人以上 owner）は、ownerUids からも自分を外す必要がある。
  // rule は self-leave で「自分が ownerUids に含まれない」状態を要求するため、
  // owner 自身の脱退は事前に demoteOwner を済ませる必要がある。
  if (group.ownerUids.includes(uid)) {
    await updateGroupRoles(gid, {
      ownerUids: group.ownerUids.filter((u) => u !== uid),
    });
  }
  await removeMemberSelf(gid, uid);
  await removeGroupIdFromUser(uid, gid);
  logger.info("leave group ok", { gid, uid });
}

/**
 * 招待コードを発行する。default 7 日有効、`maxUses` は null（無制限）。
 * Phase 4.6: rule 側で isOrganizer チェック。一般メンバーは発行不可。
 */
export async function generateJoinCode({
  gid,
  createdByUid,
  expiresInDays = 7,
  maxUses = null,
}: {
  gid: string;
  createdByUid: string;
  expiresInDays?: number;
  maxUses?: number | null;
}): Promise<string> {
  if (!Number.isInteger(expiresInDays) || expiresInDays <= 0) {
    throw new AppError("expiresInDays must be a positive integer", "validation/invalid-input");
  }
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000));
  // default の場合は 7 日：呼び出し側からの override が無ければ defaultExpiresAt と一致
  void defaultExpiresAt;
  return createJoinCode({ gid, createdByUid, expiresAt, maxUses });
}

/**
 * group を削除する。owner のみ実行可（rule 側で担保）。
 * 配下の structures / tournaments のカスケード削除は Phase 2.5 では行わない。
 */
export async function deleteGroupByOwner({
  gid,
  uid,
}: {
  gid: string;
  uid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, uid);
  await deleteGroup(gid);
  // 全メンバーの users/{uid}.groupIds は本人以外更新できないため、本人分のみ落とす。
  await removeGroupIdFromUser(uid, gid).catch(() => {});
  logger.info("delete group ok", { gid, uid });
}

/** group 名変更（owner 限定）。rule 側で担保。 */
export async function renameGroup({
  gid,
  uid,
  name,
}: {
  gid: string;
  uid: string;
  name: string;
}): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError("名前を入力してください", "validation/invalid-input");
  }
  const group = await getGroup(gid);
  assertOwner(group, uid);
  await updateGroupName(gid, trimmed);
}

/**
 * Phase 4.16: 開催数（finishedTournamentCount）を手動補正する。owner / organizer 限定。
 *   サークル詳細画面の inline edit から呼ばれる想定。
 *   rule 側でも organizer-only branch で再 enforce する。
 */
export async function setFinishedTournamentCount({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      "開催数は 0 以上の整数で指定してください",
      "validation/finished-count-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateFinishedTournamentCount(gid, value);
  logger.info("setFinishedTournamentCount ok", { gid, uid, value });
}

/**
 * Phase 4.17: デフォルト席数（defaultSeatsPerTable）を手動補正する。owner / organizer 限定。
 *   サークル詳細画面の inline edit から呼ばれる。
 *   rule 側でも organizer-only branch で再 enforce する。
 */
export async function setDefaultSeatsPerTable({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (!Number.isInteger(value) || value < 2 || value > 10) {
    throw new AppError(
      "デフォルト席数は 2 以上 10 以下の整数で指定してください",
      "validation/default-seats-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultSeatsPerTable(gid, value);
  logger.info("setDefaultSeatsPerTable ok", { gid, uid, value });
}

/**
 * 一般メンバー → 運営（organizer）に昇格。owner のみ実行可。
 * target が member に居る必要あり。既に organizer なら no-op（冪等）。
 */
export async function promoteToOrganizer({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.memberUids.includes(targetUid)) {
    throw new AppError("対象はメンバーではありません", "group/not-member");
  }
  if (group.organizerUids.includes(targetUid)) {
    return;
  }
  await updateGroupRoles(gid, {
    organizerUids: [...group.organizerUids, targetUid],
  });
  logger.info("promote to organizer", { gid, actorUid, targetUid });
}

/**
 * 運営 → 一般メンバーに降格。owner のみ実行可。
 * 対象が owner のままだと invariant 違反になるため、先に demoteOwner が必要。
 */
export async function demoteToMember({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (group.ownerUids.includes(targetUid)) {
    throw new AppError(
      "オーナーは運営降格できません。先にオーナー降格してください",
      "group/target-is-owner",
    );
  }
  if (!group.organizerUids.includes(targetUid)) {
    return;
  }
  await updateGroupRoles(gid, {
    organizerUids: group.organizerUids.filter((u) => u !== targetUid),
  });
  logger.info("demote to member", { gid, actorUid, targetUid });
}

/**
 * 運営 → オーナーに昇格。owner のみ実行可。
 * 対象は既に organizer であること（一般メンバーからの直接昇格は禁止）。
 */
export async function promoteToOwner({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.organizerUids.includes(targetUid)) {
    throw new AppError(
      "運営でないメンバーはオーナー昇格できません",
      "group/target-not-organizer",
    );
  }
  if (group.ownerUids.includes(targetUid)) {
    return;
  }
  await updateGroupRoles(gid, {
    ownerUids: [...group.ownerUids, targetUid],
  });
  logger.info("promote to owner", { gid, actorUid, targetUid });
}

/**
 * オーナー → 運営に降格。owner のみ実行可。
 * 最後のオーナーは降格不可（rule + service の二重防御）。
 */
export async function demoteOwner({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.ownerUids.includes(targetUid)) {
    return;
  }
  if (group.ownerUids.length <= 1) {
    throw new AppError("最後のオーナーは降格できません", "group/last-owner");
  }
  await updateGroupRoles(gid, {
    ownerUids: group.ownerUids.filter((u) => u !== targetUid),
  });
  logger.info("demote owner", { gid, actorUid, targetUid });
}
