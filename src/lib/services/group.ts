import { arrayUnion, increment, runTransaction, Timestamp } from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import {
  createGroup,
  deleteGroup,
  getGroup,
  groupDocRef,
  removeMemberSelf,
  updateGroupName,
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
import { logger } from "@/lib/logger";

/**
 * group を作成し、作成者の users/{uid}.groupIds に逆引きを追加する。
 * 失敗時は AppError を伝播させる（部分成功はそのまま：reverse 修復は本 Phase 範囲外）。
 */
export async function createGroupWithOwner({
  name,
  ownerUid,
}: {
  name: string;
  ownerUid: string;
}): Promise<string> {
  const gid = await createGroup({ name, ownerUid });
  await addGroupIdToUser(ownerUid, gid);
  logger.info("create group with owner ok", { gid, ownerUid });
  return gid;
}

/**
 * 招待コードを使って group に加入する。
 *
 * 1. `getJoinCode` で期限・最大使用回数チェック（クライアント側の早期失敗）
 * 2. 既メンバーなら no-op で gid を返す（冪等性）
 * 3. transaction で「招待コード usesCount +1」と「group memberUids に自分を追加」を atomic に
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
      tx.update(groupRef, { memberUids: arrayUnion(uid) });
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
 * group から脱退する。owner は脱退不可（先にオーナー移譲または group 削除）。
 */
export async function leaveGroup({ gid, uid }: { gid: string; uid: string }): Promise<void> {
  const group = await getGroup(gid);
  if (group.ownerUid === uid) {
    throw new AppError(
      "オーナーは脱退できません。先にオーナーを移譲するか group を削除してください。",
      "group/owner-cannot-leave",
    );
  }
  if (!group.memberUids.includes(uid)) {
    logger.info("leave group: already not a member", { gid, uid });
    await removeGroupIdFromUser(uid, gid).catch(() => {});
    return;
  }
  await removeMemberSelf(gid, uid);
  await removeGroupIdFromUser(uid, gid);
  logger.info("leave group ok", { gid, uid });
}

/**
 * 招待コードを発行する。default 7 日有効、`maxUses` は null（無制限）。
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
  if (group.ownerUid !== uid) {
    throw new AppError("オーナーのみ削除できます", "group/not-owner");
  }
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
  if (group.ownerUid !== uid) {
    throw new AppError("オーナーのみ名前変更できます", "group/not-owner");
  }
  await updateGroupName(gid, trimmed);
}
