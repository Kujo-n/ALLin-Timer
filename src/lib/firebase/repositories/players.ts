import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
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
 *
 * Phase 4: 新規作成時に席フィールド（tableNum/seatNum/lastMovedAt）を null で初期化する。
 * 既存ドキュメント merge 時は席フィールドを上書きしない（既に配席済みなら維持）。
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
      tableNum: null,
      seatNum: null,
      lastMovedAt: null,
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

/**
 * Phase 4: 運営者がバストを記録する。席はクリアする。
 * 権限の最終防衛は Firestore rules（group メンバーのみ書込可）。client 側の
 * group チェックは呼び出し元（component / orchestrator）で行う前提。
 */
export async function bustPlayer(tid: string, pid: string): Promise<void> {
  try {
    await updateDoc(doc(playersRef(tid), pid), {
      isBusted: true,
      bustedAt: serverTimestamp(),
      tableNum: null,
      seatNum: null,
      lastMovedAt: serverTimestamp(),
    });
    logger.info("player bust ok", { tid, pid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "バスト処理に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
    throw wrapped;
  }
}

/**
 * Phase 4: バスト誤操作のリカバリ。席は復旧しない（再度の手動 join 相当）。
 */
export async function unbustPlayer(tid: string, pid: string): Promise<void> {
  try {
    await updateDoc(doc(playersRef(tid), pid), {
      isBusted: false,
      bustedAt: null,
      lastMovedAt: serverTimestamp(),
    });
    logger.info("player unbust ok", { tid, pid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "バスト取消に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
    throw wrapped;
  }
}

/**
 * Phase 4: プレイヤーに席を割当てる（初回席決め・late entry・バランシング全て）。
 * 競合制御は呼び出し元の orchestrator 側 transaction で実施する（ここは単純 write）。
 */
export async function assignSeat(
  tid: string,
  pid: string,
  tableNum: number,
  seatNum: number,
): Promise<void> {
  try {
    await updateDoc(doc(playersRef(tid), pid), {
      tableNum,
      seatNum,
      lastMovedAt: serverTimestamp(),
    });
    logger.info("player seat assign ok", { tid, pid, tableNum, seatNum });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "席割当に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
    throw wrapped;
  }
}

/**
 * Phase 4: 席をクリアする（バスト以外の理由で席だけ外したい場合の保険）。
 * 現状は呼び出し元なし。将来「卓閉鎖の中間状態を表現したい」等のために置いておく。
 */
export async function clearSeat(tid: string, pid: string): Promise<void> {
  try {
    await updateDoc(doc(playersRef(tid), pid), {
      tableNum: null,
      seatNum: null,
      lastMovedAt: serverTimestamp(),
    });
    logger.info("player seat clear ok", { tid, pid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "席クリアに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, pid });
    throw wrapped;
  }
}
