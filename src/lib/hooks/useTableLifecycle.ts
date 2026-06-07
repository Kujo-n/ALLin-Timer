"use client";

import { useCallback, useMemo, useState } from "react";

import { formatErrorForDisplay, unwrapOrFrom } from "@/lib/errors";
import { reopenTable as reopenTableWrite, upsertTable } from "@/lib/firebase/repositories/tables";
import type { TableDoc } from "@/lib/firebase/schemas/table";
import { MAX_TABLES } from "@/lib/limits";
import { planAddTable } from "@/lib/services/seating/engine";

interface UseTableLifecycleArgs {
  tid: string;
  uid: string | null;
  tables: TableDoc[];
  onError: (message: string) => void;
}

interface UseTableLifecycleResult {
  /** 次に追加する卓番号。null = MAX_TABLES 到達で追加不可（UI でボタン disabled）。 */
  nextTableNum: number | null;
  addBusy: boolean;
  reopenBusy: boolean;
  /** Table List ヘッダ「卓を追加」から呼ぶ。 */
  addTable: () => Promise<void>;
  /** SeatingBoard 閉鎖卓ヘッダ「再開」から呼ぶ。 */
  reopenTable: (tableNum: number) => Promise<void>;
}

/**
 * Phase 4 (07): 運営者による「卓を増やす / 再開」の state / busy / repository 呼出を集約する hook
 * （`useTableClose` 規範）。permission の最終防衛は Firestore rules（tables create/update は organizer）。
 *
 * 二重 warn 回避: `upsertTable` / `reopenTable` は `wrapFirestoreWrite` で既に warn 済みのため、
 * 本 hook は `unwrapOrFrom` で素通しし UI 表示のみ行う（error-logging.md 準拠）。
 */
export function useTableLifecycle({
  tid,
  uid,
  tables,
  onError,
}: UseTableLifecycleArgs): UseTableLifecycleResult {
  const [addBusy, setAddBusy] = useState(false);
  const [reopenBusy, setReopenBusy] = useState(false);

  // broken 卓も doc が残るため占有扱い。`!t.isBroken` で filter すると broken 卓と
  // 同じ番号を再 create して setDoc が上書きしてしまうため filter しない。
  const nextTableNum = useMemo(
    () => planAddTable(tables.map((t) => t.tableNum), MAX_TABLES),
    [tables],
  );

  const addTable = useCallback(async () => {
    if (!uid || addBusy) return;
    // MAX_TABLES 超過は UI の disabled が一次防御、ここの early onError が二次。
    // service の `seating/too-many-tables` throw 経路は upsertTable に無いため、
    // null チェック + 固定メッセージで代替する（rule deny ではなく UI 防御方針）。
    if (nextTableNum === null) {
      onError(`テーブル数の上限（${MAX_TABLES} Tables）に達しています`);
      return;
    }
    setAddBusy(true);
    try {
      // upsertTable は setDoc（上書き）。planAddTable が空き番号を返すため通常は既存 doc を
      // 踏まないが、複数端末同時 add の稀な race で同番号 setDoc は同内容上書き（席なし空卓）で
      // 実害なし（20 人 / 月 1〜2 回スケールで許容）。
      await upsertTable(tid, nextTableNum);
    } catch (e) {
      const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の追加に失敗しました");
      onError(formatErrorForDisplay(wrapped));
    } finally {
      setAddBusy(false);
    }
  }, [uid, addBusy, nextTableNum, tid, onError]);

  const reopenTable = useCallback(
    async (tableNum: number) => {
      if (!uid || reopenBusy) return;
      setReopenBusy(true);
      try {
        await reopenTableWrite(tid, tableNum);
      } catch (e) {
        const wrapped = unwrapOrFrom(e, "firestore/write_failed", "卓の再開に失敗しました");
        onError(formatErrorForDisplay(wrapped));
      } finally {
        setReopenBusy(false);
      }
    },
    [uid, reopenBusy, tid, onError],
  );

  return { nextTableNum, addBusy, reopenBusy, addTable, reopenTable };
}
