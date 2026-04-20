import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { tableBodySchema, type TableDoc } from "@/lib/firebase/schemas/table";
import { logger } from "@/lib/logger";

function tablesRef(tid: string) {
  return collection(firestore, "tournaments", tid, "tables").withConverter(
    zodConverter(tableBodySchema, `tournaments/${tid}/tables`),
  );
}

export async function listTables(tid: string): Promise<TableDoc[]> {
  try {
    const q = query(tablesRef(tid), orderBy("tableNum", "asc"));
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "テーブル一覧取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export function subscribeTables(
  tid: string,
  onNext: (tables: TableDoc[]) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    query(tablesRef(tid), orderBy("tableNum", "asc")),
    (snap) => {
      try {
        onNext(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "テーブルデータが不正です"));
      }
    },
    (err) => onError(AppError.from(err, "firestore/subscribe_failed", "テーブル購読エラー")),
  );
}

/**
 * 指定された tableNum のテーブルを upsert する（新規は createdAt をサーバ時刻で初期化）。
 * 既存ドキュメントがある場合は createdAt も上書きされる単純実装。
 * 初回席決め時のみ呼ばれるため再 upsert は事故ケース。
 */
export async function upsertTables(tid: string, tableNums: number[]): Promise<void> {
  try {
    const batch = writeBatch(firestore);
    for (const n of tableNums) {
      const ref = doc(tablesRef(tid), String(n));
      batch.set(ref, { tableNum: n, isBroken: false, createdAt: serverTimestamp() });
    }
    await batch.commit();
    logger.info("tables upsert ok", { tid, count: tableNums.length });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "テーブル登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function markTableBroken(tid: string, tableNum: number): Promise<void> {
  try {
    await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: true });
    logger.info("table broken ok", { tid, tableNum });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "テーブル閉鎖に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, tableNum });
    throw wrapped;
  }
}

/**
 * 単発 upsert（initial seating 以外で 1 卓だけ追加するケース用、現状は未使用）。
 * 将来「席が足りなくなったら卓を増やす」運用が出た場合の足場。
 */
export async function upsertTable(tid: string, tableNum: number): Promise<void> {
  try {
    await setDoc(doc(tablesRef(tid), String(tableNum)), {
      tableNum,
      isBroken: false,
      createdAt: serverTimestamp(),
    });
    logger.info("table upsert ok", { tid, tableNum });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "テーブル登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid, tableNum });
    throw wrapped;
  }
}
