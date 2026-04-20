import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  structureBodySchema,
  type CreateStructureInput,
  type StructureDoc,
  type UpdateStructureInput,
} from "@/lib/firebase/schemas/structure";
import { logger } from "@/lib/logger";

const structuresRef = collection(firestore, "structures").withConverter(
  zodConverter(structureBodySchema, "structures"),
);

export async function createStructure(input: CreateStructureInput): Promise<string> {
  try {
    const ref = await addDoc(structuresRef, {
      ...input,
      createdAt: serverTimestamp(),
    });
    logger.info("structure create ok", { sid: ref.id, gid: input.groupId });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "ストラクチャ作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function getStructure(sid: string): Promise<StructureDoc> {
  try {
    const snap = await getDoc(doc(structuresRef, sid));
    if (!snap.exists()) {
      throw new AppError(`structure not found: ${sid}`, "firestore/not-found");
    }
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "ストラクチャ取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, sid });
    throw wrapped;
  }
}

/**
 * 指定 group のストラクチャ一覧。複合インデックス追加を避けるため
 * `where("groupId","==")` のみで取得して client 側で createdAt 降順に並べる。
 *
 * 個別 doc が schema validate に失敗しても一覧全体を落とさず skip する。
 */
export async function listStructuresByGroup(groupId: string): Promise<StructureDoc[]> {
  try {
    const q = query(structuresRef, where("groupId", "==", groupId));
    const snap = await getDocs(q);
    const items: StructureDoc[] = [];
    for (const d of snap.docs) {
      try {
        items.push({ id: d.id, ...d.data() });
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/invalid-data", "不正なドキュメント");
        logger.warn("structure list skipped invalid doc", {
          sid: d.id,
          code: wrapped.code,
        });
      }
    }
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return items;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "ストラクチャ一覧取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, groupId });
    throw wrapped;
  }
}

export async function updateStructure(sid: string, patch: UpdateStructureInput): Promise<void> {
  try {
    await updateDoc(doc(structuresRef, sid), patch);
    logger.info("structure update ok", { sid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "ストラクチャ更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function deleteStructure(sid: string): Promise<void> {
  try {
    await deleteDoc(doc(structuresRef, sid));
    logger.info("structure delete ok", { sid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "ストラクチャ削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
