import {
  collection,
  doc,
  getDocs,
  onSnapshot,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  seasonStatsBodySchema,
  type SeasonStatsDoc,
} from "@/lib/firebase/schemas/seasonStats";
import { wrapFirestoreRead } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

export function seasonStatsRef(gid: string) {
  return collection(firestore, "groups", gid, "seasonStats").withConverter(
    zodConverter(seasonStatsBodySchema, `groups/${gid}/seasonStats`),
  );
}

export function seasonStatsDocRef(gid: string, uid: string) {
  return doc(seasonStatsRef(gid), uid);
}

/**
 * Phase A: converter を当てない素の doc ref。`finishTournament` の tx 内 read で使う。
 *
 * `seasonStatsDocRef` は zodConverter 付きで `data()` 呼出時に schema validate が走るが、
 * runTransaction 内で 1 件でも schema mismatch が起きると tx 全体が失敗し、
 * トーナメント終了 / シーズン切替が止まってしまう。tx 内では invariant が緩い
 * raw read に切替え、必要な数値のみ防御的に Number(...) で取り出す（list / subscribe
 * は引き続き converter 経由で schema 強制する）。
 */
export function seasonStatsRawDocRef(gid: string, uid: string) {
  return doc(firestore, "groups", gid, "seasonStats", uid);
}

/**
 * Phase A: シーズン戦績一覧を取得する。
 *
 *  - `totalPoints desc` は client 側で sort（複合 index 回避、20 人規模なら問題なし）
 *  - 個別 doc が schema validate に失敗しても全体を落とさず、該当 doc のみ skip
 *    （listTournamentsByGroup と同方針）
 */
export async function listSeasonStats(gid: string): Promise<SeasonStatsDoc[]> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "シーズン戦績の取得に失敗しました",
    async () => {
      const snap = await getDocs(seasonStatsRef(gid));
      const items: SeasonStatsDoc[] = [];
      for (const d of snap.docs) {
        try {
          items.push({ id: d.id, ...d.data() });
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/invalid-data", "不正なデータ");
          logger.warn("seasonStats list skipped invalid doc", {
            gid,
            uid: d.id,
            code: wrapped.code,
          });
        }
      }
      items.sort((a, b) => b.totalPoints - a.totalPoints);
      return items;
    },
    { gid },
  );
}

/**
 * Phase A: シーズン戦績を onSnapshot で realtime 購読する。
 *
 *  - orderBy は付けず client 側で `totalPoints desc` に sort（複合 index 回避）
 *  - 個別 doc の schema 失敗は該当 doc のみ skip し warn ログを残す
 *  - 戻り値は unsubscribe 関数（呼出側で useEffect cleanup する）
 */
export function subscribeSeasonStats(
  gid: string,
  onNext: (items: SeasonStatsDoc[]) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    seasonStatsRef(gid),
    (snap) => {
      try {
        const items: SeasonStatsDoc[] = [];
        for (const d of snap.docs) {
          try {
            items.push({ id: d.id, ...d.data() });
          } catch (e) {
            const wrapped = AppError.from(e, "firestore/invalid-data", "不正なデータ");
            logger.warn("seasonStats subscribe skipped invalid doc", {
              gid,
              uid: d.id,
              code: wrapped.code,
            });
          }
        }
        items.sort((a, b) => b.totalPoints - a.totalPoints);
        onNext(items);
      } catch (e) {
        onError(
          AppError.from(e, "firestore/invalid-data", "シーズン戦績データが不正です"),
        );
      }
    },
    (err) =>
      onError(
        AppError.from(err, "firestore/subscribe_failed", "シーズン戦績の購読エラー"),
      ),
  );
}
