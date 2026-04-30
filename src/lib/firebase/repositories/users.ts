import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";

import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  userProfileBodySchema,
  type UpsertUserProfileInput,
  type UserProfileDoc,
} from "@/lib/firebase/schemas/user";
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

const usersRef = collection(firestore, "users").withConverter(
  zodConverter(userProfileBodySchema, "users"),
);

export async function getUserProfile(uid: string): Promise<UserProfileDoc | null> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "プロフィール取得に失敗しました",
    async () => {
      const snap = await getDoc(doc(usersRef, uid));
      if (!snap.exists()) return null;
      return snap.data();
    },
    { uid },
  );
}

export async function upsertUserProfile(input: UpsertUserProfileInput): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "プロフィール保存に失敗しました",
    async () => {
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
    },
    { uid: input.uid },
  );
}

/**
 * users/{uid}.groupIds に gid を追加（重複は arrayUnion が処理）。
 */
export async function addGroupIdToUser(uid: string, gid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "プロフィールへのサークル追加に失敗しました",
    async () => {
      await updateDoc(doc(usersRef, uid), { groupIds: arrayUnion(gid) });
    },
    { uid, gid },
  );
  logger.info("user groupIds add ok", { uid, gid });
}

/**
 * users/{uid} ドキュメントを削除する。
 * Firestore rules で self-write（= self-delete）のみ許可される。
 * 匿名ゲストが tournament 終了 / logout / cancelOwnEntry で自己削除する際に利用する。
 */
export async function deleteUserProfile(uid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "プロフィール削除に失敗しました",
    async () => {
      await deleteDoc(doc(usersRef, uid));
    },
    { uid },
  );
  logger.info("user profile delete ok", { uid });
}

export async function removeGroupIdFromUser(uid: string, gid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "プロフィールからのサークル除外に失敗しました",
    async () => {
      await updateDoc(doc(usersRef, uid), { groupIds: arrayRemove(gid) });
    },
    { uid, gid },
  );
  logger.info("user groupIds remove ok", { uid, gid });
}
