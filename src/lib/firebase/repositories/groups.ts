import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  groupBodySchema,
  type CreateGroupInput,
  type GroupDoc,
} from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

export const groupsRef = collection(firestore, "groups").withConverter(
  zodConverter(groupBodySchema, "groups"),
);

export function groupDocRef(gid: string) {
  return doc(groupsRef, gid);
}

export async function createGroup(input: CreateGroupInput): Promise<string> {
  try {
    const ref = await addDoc(groupsRef, {
      name: input.name,
      ownerUid: input.ownerUid,
      memberUids: [input.ownerUid],
      createdAt: serverTimestamp(),
    });
    logger.info("group create ok", { gid: ref.id });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function getGroup(gid: string): Promise<GroupDoc> {
  try {
    const snap = await getDoc(groupDocRef(gid));
    if (!snap.exists()) {
      throw new AppError(`group not found: ${gid}`, "firestore/not-found");
    }
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

/**
 * `users/{uid}.groupIds` から逆引きで自分の group 一覧を取得する。
 * `where("memberUids", "array-contains", uid)` ではなく逆引きを使うことで、
 * rule の list 評価で個別 doc read を許可する形に揃える。
 *
 * 一部の gid が rule で拒否される drift 状態に備え、`Promise.allSettled` で
 * rejected を warn ログに出して呼び出し側に skip させる。
 */
export async function listMyGroups(groupIds: string[]): Promise<{
  groups: GroupDoc[];
  failedGids: string[];
}> {
  if (groupIds.length === 0) return { groups: [], failedGids: [] };
  const settled = await Promise.allSettled(groupIds.map((gid) => getGroup(gid)));
  const groups: GroupDoc[] = [];
  const failedGids: string[] = [];
  settled.forEach((r, i) => {
    const gid = groupIds[i];
    if (r.status === "fulfilled") {
      groups.push(r.value);
    } else {
      failedGids.push(gid);
      const reason = r.reason;
      const code =
        reason && typeof reason === "object" && "code" in reason
          ? (reason as { code: string }).code
          : "unknown";
      logger.warn("listMyGroups skipped gid", { gid, code });
    }
  });
  groups.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  return { groups, failedGids };
}

export async function updateGroupName(gid: string, name: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), { name });
    logger.info("group rename ok", { gid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル名の更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

export async function addMemberSelf(gid: string, uid: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), { memberUids: arrayUnion(uid) });
    logger.info("group add member ok", { gid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル加入に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid, uid });
    throw wrapped;
  }
}

export async function removeMemberSelf(gid: string, uid: string): Promise<void> {
  try {
    await updateDoc(groupDocRef(gid), { memberUids: arrayRemove(uid) });
    logger.info("group remove member ok", { gid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル脱退に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid, uid });
    throw wrapped;
  }
}

export async function deleteGroup(gid: string): Promise<void> {
  try {
    await deleteDoc(groupDocRef(gid));
    logger.info("group delete ok", { gid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "サークル削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}
