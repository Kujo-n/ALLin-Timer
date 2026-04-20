import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { playerBodySchema, type PlayerDoc } from "@/lib/firebase/schemas/player";
import { logger } from "@/lib/logger";

function playersRef(tid: string) {
  return collection(firestore, "tournaments", tid, "players").withConverter(
    zodConverter(playerBodySchema, `tournaments/${tid}/players`),
  );
}

export async function getPlayer(tid: string, uid: string): Promise<PlayerDoc | null> {
  try {
    const snap = await getDoc(doc(playersRef(tid), uid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "参加者取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, uid });
    throw wrapped;
  }
}

export async function listPlayers(tid: string): Promise<PlayerDoc[]> {
  try {
    const q = query(playersRef(tid), orderBy("entryAt", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "参加者一覧取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

/**
 * 参加者一覧を onSnapshot で購読する。Phase 3 のリアルタイム化で UI から呼ばれる。
 * 戻り値は unsubscribe 関数（呼び出し側で useEffect cleanup する）。
 */
export function subscribePlayers(
  tid: string,
  onNext: (players: PlayerDoc[]) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    query(playersRef(tid), orderBy("entryAt", "asc")),
    (snap) => {
      try {
        onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "参加者データが不正です"));
      }
    },
    (err) => onError(AppError.from(err, "firestore/subscribe_failed", "参加者購読エラー")),
  );
}

/**
 * プレイヤードキュメントを `/tournaments/{tid}/players/{uid}` に upsert する。
 * 同 uid 再来訪時は `{ merge: true }` で displayName 等を更新し、重複参加を冪等化する。
 */
export async function upsertPlayer(
  tid: string,
  uid: string,
  input: { displayName: string },
): Promise<void> {
  try {
    const existing = await getPlayer(tid, uid);
    if (existing) {
      await setDoc(doc(playersRef(tid), uid), { displayName: input.displayName }, { merge: true });
      logger.info("player merge ok", { tid, uid });
      return;
    }
    await setDoc(doc(playersRef(tid), uid), {
      displayName: input.displayName,
      uid,
      entryAt: serverTimestamp(),
      isBusted: false,
      bustedAt: null,
    });
    logger.info("player create ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "参加者登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, uid });
    throw wrapped;
  }
}

/**
 * プレイヤードキュメントを削除する。
 * Firestore rules で自己削除（`pid == auth.uid`）と運営者削除の両方を許可する前提。
 */
export async function deletePlayer(tid: string, pid: string): Promise<void> {
  try {
    await deleteDoc(doc(playersRef(tid), pid));
    logger.info("player delete ok", { tid, pid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "参加者の取消に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
    throw wrapped;
  }
}
