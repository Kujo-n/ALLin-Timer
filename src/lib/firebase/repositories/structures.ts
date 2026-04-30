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
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

const structuresRef = collection(firestore, "structures").withConverter(
  zodConverter(structureBodySchema, "structures"),
);

export async function createStructure(input: CreateStructureInput): Promise<string> {
  const sid = await wrapFirestoreWrite(
    "firestore/write_failed",
    "ストラクチャ作成に失敗しました",
    async () => {
      const ref = await addDoc(structuresRef, {
        ...input,
        // Phase 4.7: Firestore は undefined を drop するため null に正規化して書込の整合性を保つ。
        rebuyStack: input.rebuyStack ?? null,
        addOnStack: input.addOnStack ?? null,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
  );
  logger.info("structure create ok", { sid, gid: input.groupId });
  return sid;
}

export async function getStructure(sid: string): Promise<StructureDoc> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "ストラクチャ取得に失敗しました",
    async () => {
      const snap = await getDoc(doc(structuresRef, sid));
      if (!snap.exists()) {
        throw new AppError(`structure not found: ${sid}`, "firestore/not-found");
      }
      return { id: snap.id, ...snap.data() };
    },
    { sid },
  );
}

/**
 * 指定 group のストラクチャ一覧。複合インデックス追加を避けるため
 * `where("groupId","==")` のみで取得して client 側で createdAt 降順に並べる。
 *
 * 個別 doc が schema validate に失敗しても一覧全体を落とさず skip する。
 */
export async function listStructuresByGroup(groupId: string): Promise<StructureDoc[]> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "ストラクチャ一覧取得に失敗しました",
    async () => {
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
    },
    { groupId },
  );
}

export async function updateStructure(sid: string, patch: UpdateStructureInput): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "ストラクチャ更新に失敗しました",
    async () => {
      // Phase 4.7: createStructure と同じく undefined → null 正規化で非対称を解消する。
      //   patch にキー自体が存在しない場合は touch しない（既存値保持）。
      //   キーは存在するが値が undefined の場合のみ null に置換する。
      const normalized: Record<string, unknown> = { ...patch };
      if ("rebuyStack" in patch) normalized.rebuyStack = patch.rebuyStack ?? null;
      if ("addOnStack" in patch) normalized.addOnStack = patch.addOnStack ?? null;
      await updateDoc(doc(structuresRef, sid), normalized);
    },
    { sid },
  );
  logger.info("structure update ok", { sid });
}

export async function deleteStructure(sid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "ストラクチャ削除に失敗しました",
    async () => {
      await deleteDoc(doc(structuresRef, sid));
    },
    { sid },
  );
  logger.info("structure delete ok", { sid });
}
