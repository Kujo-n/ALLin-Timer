import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  structureTemplateBodySchema,
  type CreateStructureTemplateInput,
  type StructureTemplateDoc,
  type UpdateStructureTemplateInput,
} from "@/lib/firebase/schemas/structureTemplate";
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

const templatesRef = collection(firestore, "structureTemplates").withConverter(
  zodConverter(structureTemplateBodySchema, "structureTemplates"),
);

export async function createStructureTemplate(
  input: CreateStructureTemplateInput,
): Promise<string> {
  const tid = await wrapFirestoreWrite(
    "firestore/write_failed",
    "テンプレート作成に失敗しました",
    async () => {
      const ref = await addDoc(templatesRef, {
        ...input,
        description: input.description ?? "",
        // Firestore は undefined を drop するため null に正規化（structures.ts と同方針）。
        rebuyStack: input.rebuyStack ?? null,
        addOnStack: input.addOnStack ?? null,
        createdAt: serverTimestamp(),
      });
      return ref.id;
    },
  );
  logger.info("structure template create ok", { tid, uid: input.createdByUid });
  return tid;
}

export async function getStructureTemplate(tid: string): Promise<StructureTemplateDoc> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "テンプレート取得に失敗しました",
    async () => {
      const snap = await getDoc(doc(templatesRef, tid));
      if (!snap.exists()) {
        throw new AppError(`template not found: ${tid}`, "firestore/not-found");
      }
      return { id: snap.id, ...snap.data() };
    },
    { tid },
  );
}

/**
 * 全テンプレート一覧。サインイン済みユーザー全員が閲覧可能（rule）。
 *
 * Phase 4.8: 件数が 20〜数百件スケール想定のため where 句なしで全件取得し、
 * client 側で createdAt 降順に並べる（structures.ts と同パターン）。
 * 個別 doc が schema validate に失敗しても一覧全体を落とさず skip する。
 */
export async function listStructureTemplates(): Promise<StructureTemplateDoc[]> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "テンプレート一覧取得に失敗しました",
    async () => {
      const snap = await getDocs(templatesRef);
      const items: StructureTemplateDoc[] = [];
      for (const d of snap.docs) {
        try {
          items.push({ id: d.id, ...d.data() });
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/invalid-data", "不正なドキュメント");
          logger.warn("template list skipped invalid doc", {
            tid: d.id,
            code: wrapped.code,
          });
        }
      }
      items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
      return items;
    },
  );
}

export async function updateStructureTemplate(
  tid: string,
  patch: UpdateStructureTemplateInput,
): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テンプレート更新に失敗しました",
    async () => {
      // structures と同様、undefined → null 正規化でキー有無の非対称を解消。
      const normalized: Record<string, unknown> = { ...patch };
      if ("rebuyStack" in patch) normalized.rebuyStack = patch.rebuyStack ?? null;
      if ("addOnStack" in patch) normalized.addOnStack = patch.addOnStack ?? null;
      if ("description" in patch) normalized.description = patch.description ?? "";
      await updateDoc(doc(templatesRef, tid), normalized);
    },
    { tid },
  );
  logger.info("structure template update ok", { tid });
}

export async function deleteStructureTemplate(tid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テンプレート削除に失敗しました",
    async () => {
      await deleteDoc(doc(templatesRef, tid));
    },
    { tid },
  );
  logger.info("structure template delete ok", { tid });
}
