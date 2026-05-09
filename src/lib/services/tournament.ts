import { AppError } from "@/lib/errors";
import { getGroup } from "@/lib/firebase/repositories/groups";
import {
  getTournament,
  updateSpectateEnabled,
} from "@/lib/firebase/repositories/tournaments";
import { logger } from "@/lib/logger";

/**
 * Phase 3 (04-spectate-mode): owner / organizer が tournament 単位で観戦モードを toggle する。
 *
 *   - role check は **tournament の groupId 経由で再評価**する。UI から渡された gid を信頼せず、
 *     getTournament(tid) で正準の groupId を取得してから assertOrganizer 相当の判定を行う
 *     （rule の `isOrganizer(resource.data.groupId)` と同じ判定形）。
 *   - rule + service の二重防御で member の write を deny する。
 *   - 失敗時の AppError code:
 *     - `validation/spectate-enabled-invalid`: 引数 value が boolean でない（型穴ガード）
 *     - `firestore/not-found`: tournament が存在しない（getTournament 経由で素通し）
 *     - `group/not-organizer`: 呼出 uid が tournament.groupId の organizer ではない
 *     - `firestore/write_failed`: Firestore reject（rule deny / network failure 等）
 */
export async function setSpectateEnabled({
  tid,
  uid,
  value,
}: {
  tid: string;
  uid: string;
  value: boolean;
}): Promise<void> {
  if (typeof value !== "boolean") {
    throw new AppError(
      "観戦モードフラグは boolean で指定してください",
      "validation/spectate-enabled-invalid",
    );
  }
  const tournament = await getTournament(tid);
  const group = await getGroup(tournament.groupId);
  // assertOrganizer は src/lib/services/group.ts 内 file-private のため、ここでは同じ判定を局所コピー。
  if (!group.organizerUids.includes(uid)) {
    throw new AppError("運営のみ実行できます", "group/not-organizer");
  }
  await updateSpectateEnabled(tid, value);
  logger.info("setSpectateEnabled ok", {
    tid,
    uid,
    value,
    gid: tournament.groupId,
  });
}
