import { collection, doc, getDoc, getDocs } from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  seasonHistoryBodySchema,
  type SeasonHistoryDoc,
} from "@/lib/firebase/schemas/seasonHistory";
import { wrapFirestoreRead } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

export function seasonHistoryRef(gid: string) {
  return collection(firestore, "groups", gid, "seasonHistory").withConverter(
    zodConverter(seasonHistoryBodySchema, `groups/${gid}/seasonHistory`),
  );
}

export function seasonHistoryDocRef(gid: string, seasonId: string) {
  return doc(seasonHistoryRef(gid), seasonId);
}

/**
 * Phase D improvement: 単一シーズンの履歴 doc を取得する。
 *
 *  - 存在しない seasonId は `AppError("firestore/not-found")` を throw
 *  - 認可・I/O 失敗は `wrapFirestoreRead` 経由で `firestore/read_failed` にラップ
 */
export async function getSeasonHistory(
  gid: string,
  seasonId: string,
): Promise<SeasonHistoryDoc> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "シーズン履歴の取得に失敗しました",
    async () => {
      const snap = await getDoc(seasonHistoryDocRef(gid, seasonId));
      if (!snap.exists()) {
        throw new AppError(
          `seasonHistory not found: ${gid}/${seasonId}`,
          "firestore/not-found",
        );
      }
      return { id: snap.id, ...snap.data() };
    },
    { gid, seasonId },
  );
}

/**
 * Phase A: 過去シーズンの履歴一覧を取得する。
 *
 *  - `endedAt desc` は client 側で sort（小規模サークル想定で 1 シーズン = 1 doc）
 *  - 個別 doc が schema validate に失敗しても全体を落とさず該当 doc のみ skip
 */
export async function listSeasonHistory(gid: string): Promise<SeasonHistoryDoc[]> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "シーズン履歴の取得に失敗しました",
    async () => {
      const snap = await getDocs(seasonHistoryRef(gid));
      const items: SeasonHistoryDoc[] = [];
      for (const d of snap.docs) {
        try {
          items.push({ id: d.id, ...d.data() });
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/invalid-data", "不正なデータ");
          logger.warn("seasonHistory list skipped invalid doc", {
            gid,
            seasonId: d.id,
            code: wrapped.code,
          });
        }
      }
      items.sort((a, b) => b.endedAt.toMillis() - a.endedAt.toMillis());
      return items;
    },
    { gid },
  );
}
