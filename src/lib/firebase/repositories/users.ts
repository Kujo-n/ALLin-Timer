import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  userProfileBodySchema,
  type UpsertUserProfileInput,
  type UserProfileDoc,
} from "@/lib/firebase/schemas/user";
import { logger } from "@/lib/logger";

const usersRef = collection(firestore, "users").withConverter(
  zodConverter(userProfileBodySchema, "users"),
);

export async function getUserProfile(
  uid: string,
): Promise<UserProfileDoc | null> {
  try {
    const snap = await getDoc(doc(usersRef, uid));
    if (!snap.exists()) return null;
    return snap.data();
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "プロフィール取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, uid });
    throw wrapped;
  }
}

export async function upsertUserProfile(
  input: UpsertUserProfileInput,
): Promise<void> {
  try {
    const existing = await getUserProfile(input.uid);
    if (existing) {
      await setDoc(
        doc(usersRef, input.uid),
        { displayName: input.displayName, email: input.email },
        { merge: true },
      );
      logger.info("user profile merge ok", { uid: input.uid });
      return;
    }
    await setDoc(doc(usersRef, input.uid), {
      uid: input.uid,
      displayName: input.displayName,
      email: input.email,
      groupIds: [],
      createdAt: serverTimestamp(),
    });
    logger.info("user profile create ok", { uid: input.uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "プロフィール保存に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, uid: input.uid });
    throw wrapped;
  }
}

/**
 * users/{uid}.groupIds に gid を追加（重複は arrayUnion が処理）。
 */
export async function addGroupIdToUser(uid: string, gid: string): Promise<void> {
  try {
    await updateDoc(doc(usersRef, uid), { groupIds: arrayUnion(gid) });
    logger.info("user groupIds add ok", { uid, gid });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "firestore/write_failed",
      "プロフィールへのサークル追加に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, uid, gid });
    throw wrapped;
  }
}

export async function removeGroupIdFromUser(
  uid: string,
  gid: string,
): Promise<void> {
  try {
    await updateDoc(doc(usersRef, uid), { groupIds: arrayRemove(gid) });
    logger.info("user groupIds remove ok", { uid, gid });
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "firestore/write_failed",
      "プロフィールからのサークル除外に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, uid, gid });
    throw wrapped;
  }
}
