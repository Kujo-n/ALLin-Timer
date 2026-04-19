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
  tournamentBodySchema,
  type CreateTournamentInput,
  type TournamentDoc,
  type UpdateTournamentInput,
} from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

const tournamentsRef = collection(firestore, "tournaments").withConverter(
  zodConverter(tournamentBodySchema, "tournaments"),
);

export async function createTournament(
  input: CreateTournamentInput,
): Promise<string> {
  try {
    const ref = await addDoc(tournamentsRef, {
      ownerUid: input.ownerUid,
      name: input.name,
      structureSnapshot: input.structureSnapshot,
      state: "setup",
      startedAt: null,
      currentLevel: 0,
      lateEntryDeadlineLevel: input.structureSnapshot.lateEntryDeadlineLevel,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament create ok", { tid: ref.id });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function getTournament(tid: string): Promise<TournamentDoc> {
  try {
    const snap = await getDoc(doc(tournamentsRef, tid));
    if (!snap.exists()) {
      throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
    }
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "トーナメント取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function listMyTournaments(uid: string): Promise<TournamentDoc[]> {
  try {
    const q = query(tournamentsRef, where("ownerUid", "==", uid));
    const snap = await getDocs(q);
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // 複合インデックス不要化のため client 側で降順ソート
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return items;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "トーナメント一覧取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function updateTournament(
  tid: string,
  patch: UpdateTournamentInput,
): Promise<void> {
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament update ok", { tid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * トーナメントを開始する（state: setup → running）。
 * Phase 2 では state 遷移のみ。タイマー／レベル自動繰り上げは Phase 3。
 * 呼び出し元（UI）で owner チェック + state==="setup" チェックを済ませる前提。
 */
export async function startTournament(tid: string, uid: string): Promise<void> {
  // getTournament は内部で try/catch 済みで firestore/not-found 等を AppError として throw する。
  // ここで再 try/catch しない（read 失敗は write_failed に誤分類したくない）。
  const t = await getTournament(tid);
  if (t.ownerUid !== uid) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError(
      "このトーナメントは既に開始されています",
      "tournament/already-started",
    );
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "running",
      startedAt: serverTimestamp(),
      currentLevel: 1,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament start ok", { tid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント開始に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function deleteTournamentIfSetup(
  tid: string,
  uid: string,
): Promise<void> {
  const t = await getTournament(tid);
  if (t.ownerUid !== uid) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError(
      "既に開始済みのトーナメントは削除できません",
      "tournament/already-started",
    );
  }
  try {
    await deleteDoc(doc(tournamentsRef, tid));
    logger.info("tournament delete ok", { tid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
