import { collection, deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";

import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { templateAdminBodySchema } from "@/lib/firebase/schemas/templateAdmin";
import { wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

const templateAdminsRef = collection(firestore, "templateAdmins").withConverter(
  zodConverter(templateAdminBodySchema, "templateAdmins"),
);

/**
 * 指定 uid が管理者かを判定する。rule は self-only read のため
 * `uid === request.auth.uid` で呼び出すこと。permission-denied や read 失敗時は
 * 「管理者ではない」扱いで false を返す（非管理者の読取は deny される仕様）。
 *
 * catch の message は log に含める — rule deny（非管理者の想定挙動）と
 * 実エラー（network / offline / 未知の permission 失敗）を運用時に切り分けるため。
 *
 * 本関数は読取失敗を例外伝播せず false に倒す独自の契約のため、
 * `wrapFirestoreRead` ではなく従来の try/catch のままにする。
 */
export async function isTemplateAdmin(uid: string): Promise<boolean> {
  try {
    const snap = await getDoc(doc(templateAdminsRef, uid));
    return snap.exists();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.warn("isTemplateAdmin check failed", {
      code: "firestore/read_failed",
      uid,
      message,
    });
    return false;
  }
}

/**
 * 管理者権限を付与する。rule で既存管理者による操作に限定されている。
 * 本 Phase では UI 未実装、将来の grant/revoke UI 用。
 */
export async function grantTemplateAdmin(uid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "管理者付与に失敗しました",
    async () => {
      await setDoc(doc(templateAdminsRef, uid), { createdAt: serverTimestamp() });
    },
    { uid },
  );
  logger.info("template admin grant ok", { uid });
}

/**
 * 管理者権限を剥奪する。rule で既存管理者による操作に限定。
 * 本 Phase では UI 未実装。最後の 1 人が 0 人になると Console で再 seed 必須。
 */
export async function revokeTemplateAdmin(uid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "管理者剥奪に失敗しました",
    async () => {
      await deleteDoc(doc(templateAdminsRef, uid));
    },
    { uid },
  );
  logger.info("template admin revoke ok", { uid });
}
