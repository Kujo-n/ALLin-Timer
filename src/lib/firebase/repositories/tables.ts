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
import { TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

function tablesRef(tid: string) {
  return collection(firestore, "tournaments", tid, "tables").withConverter(
    zodConverter(tableBodySchema, `tournaments/${tid}/tables`),
  );
}

export async function listTables(tid: string): Promise<TableDoc[]> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "テーブル一覧取得に失敗しました",
    async () => {
      const q = query(tablesRef(tid), orderBy("tableNum", "asc"));
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    { tid },
  );
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
 *
 * Phase C: `label` / `color` を null で初期化（commitInitialSeating の orchestrator は
 * 別経路で defaultTableLabels から auto-fill するため、本関数は legacy / fallback 用途）。
 */
export async function upsertTables(tid: string, tableNums: number[]): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル登録に失敗しました",
    async () => {
      const batch = writeBatch(firestore);
      for (const n of tableNums) {
        const ref = doc(tablesRef(tid), String(n));
        batch.set(ref, {
          tableNum: n,
          isBroken: false,
          createdAt: serverTimestamp(),
          label: null,
          color: null,
        });
      }
      await batch.commit();
    },
    { tid },
  );
  logger.info("tables upsert ok", { tid, count: tableNums.length });
}

export async function markTableBroken(tid: string, tableNum: number): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル閉鎖に失敗しました",
    async () => {
      await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: true });
    },
    { tid, tableNum },
  );
  logger.info("table broken ok", { tid, tableNum });
}

/**
 * Phase 4 (07): 閉鎖済み卓を再開する（`isBroken=false` 単独書換）。`markTableBroken` の対称。
 * プレイヤー移動は伴わない（再開卓へは運営者が手動 D&D で配置する）。
 * rule: tables update 経路 A（label/color に触れない update）でカバー済み（rule 変更不要）。
 */
export async function reopenTable(tid: string, tableNum: number): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル再開に失敗しました",
    async () => {
      await updateDoc(doc(tablesRef(tid), String(tableNum)), { isBroken: false });
    },
    { tid, tableNum },
  );
  logger.info("table reopen ok", { tid, tableNum });
}

/**
 * 単発 upsert（initial seating 以外で 1 卓だけ追加するケース用）。
 * Phase 4 (07): 「卓を増やす」運用（useTableLifecycle.addTable）から呼ばれる。
 */
export async function upsertTable(tid: string, tableNum: number): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "テーブル登録に失敗しました",
    async () => {
      await setDoc(doc(tablesRef(tid), String(tableNum)), {
        tableNum,
        isBroken: false,
        createdAt: serverTimestamp(),
        label: null,
        color: null,
      });
    },
    { tid, tableNum },
  );
  logger.info("table upsert ok", { tid, tableNum });
}

/**
 * Phase C: 卓の label / color を inline edit で更新する。
 *   - 空文字 / 空白のみの label は null に正規化（Firestore で空文字保存しない）
 *   - color は #RRGGBB hex 形式 or null。それ以外は AppError で client 早期失敗
 *   - rule は `affectedKeys().hasOnly(['label', 'color'])` で他フィールド汚染を deny
 *   - 呼び出し経路は dashboard の SeatingBoard 卓ヘッダ「✎」のみ（organizer 限定）
 */
export async function updateTableLabel(
  tid: string,
  tableNum: number,
  patch: { label: string | null; color: string | null },
): Promise<void> {
  const trimmedLabel = typeof patch.label === "string" ? patch.label.trim() : null;
  const normalizedLabel: string | null =
    trimmedLabel && trimmedLabel.length > 0 ? trimmedLabel : null;
  if (
    normalizedLabel !== null &&
    normalizedLabel.length > TABLE_LABEL_MAX_LENGTH
  ) {
    throw new AppError(
      `Table 名は ${TABLE_LABEL_MAX_LENGTH} 文字以内で指定してください`,
      "validation/table-label-invalid",
    );
  }
  const color = patch.color;
  if (color !== null && !/^#[0-9a-fA-F]{6}$/.test(color)) {
    throw new AppError(
      "色は #RRGGBB 形式で指定してください",
      "validation/table-color-invalid",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "Table 名の更新に失敗しました",
    async () => {
      await updateDoc(doc(tablesRef(tid), String(tableNum)), {
        label: normalizedLabel,
        color,
      });
    },
    { tid, tableNum },
  );
  logger.info("table label updated", {
    tid,
    tableNum,
    hasLabel: normalizedLabel !== null,
    hasColor: color !== null,
  });
}
