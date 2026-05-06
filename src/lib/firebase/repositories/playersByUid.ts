import {
  collectionGroup,
  onSnapshot,
  query,
  where,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { playerBodySchema, type PlayerDoc } from "@/lib/firebase/schemas/player";
import { logger } from "@/lib/logger";

/**
 * Phase 5.1: collectionGroup query で「自分が参加している全 tournaments」の
 * players ドキュメントを購読する。サイドバーの「参加中のトーナメント」section
 * に表示する用途。
 *
 * - rule: collectionGroup query は path-specific rule では deny されるため、
 *   `match /{path=**}/players/{pid} { allow read: if isSignedIn(); }` を
 *   firestore.rules に明示的に置く（root scope）。`players` collection-id は
 *   tournaments 配下にしか存在しないため副作用なし。
 * - schema: legacy doc（`isPlayingDealer` 不在）は zod の `default(false)` で hydrate される。
 * - failure: 個別 doc が schema validate に失敗してもストリーム全体は落とさず、warn のみ。
 */
interface JoinedPlayerEntry {
  tid: string;
  player: PlayerDoc;
}

export function subscribePlayersByUid(
  uid: string,
  onNext: (entries: JoinedPlayerEntry[]) => void,
  onError: (err: AppError) => void,
): () => void {
  const q = query(collectionGroup(firestore, "players"), where("uid", "==", uid));
  return onSnapshot(
    q,
    (snap) => {
      const items: JoinedPlayerEntry[] = [];
      for (const d of snap.docs) {
        try {
          const parsed = playerBodySchema.parse(d.data());
          // tournaments/{tid}/players/{pid} の親 docRef → tid を抽出。
          const parent = d.ref.parent.parent;
          if (!parent) continue;
          items.push({
            tid: parent.id,
            player: { id: d.id, ...parsed },
          });
        } catch (e) {
          const wrapped = AppError.from(e, "firestore/invalid-data", "不正な参加者ドキュメント");
          logger.warn("subscribePlayersByUid skip invalid", {
            code: wrapped.code,
            pid: d.id,
          });
        }
      }
      onNext(items);
    },
    (err) =>
      onError(
        AppError.from(err, "firestore/subscribe_failed", "参加トーナメント購読エラー"),
      ),
  );
}
