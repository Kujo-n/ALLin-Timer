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
  updateDoc,
  writeBatch,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { playerBodySchema, type PlayerDoc } from "@/lib/firebase/schemas/player";
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { MAX_CLONE_PLAYERS } from "@/lib/limits";
import { logger } from "@/lib/logger";

function playersRef(tid: string) {
  return collection(firestore, "tournaments", tid, "players").withConverter(
    zodConverter(playerBodySchema, `tournaments/${tid}/players`),
  );
}

/**
 * Phase A: tournament の参加者一覧を 1 回 read で取得する（subscribe ではなく）。
 *
 *  - `finishTournament` の seasonStats 拡張で「tx 起動前に順位確定」のために使う
 *    （tx 内では Web SDK の制約で query を使えないため）
 *  - `entryAt asc` で並び、`resolveRanking` 側で active の tiebreak としても利用される
 */
export async function listPlayers(tid: string): Promise<PlayerDoc[]> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "参加者一覧の取得に失敗しました",
    async () => {
      const snap = await getDocs(query(playersRef(tid), orderBy("entryAt", "asc")));
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    { tid },
  );
}

export async function getPlayer(tid: string, uid: string): Promise<PlayerDoc | null> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "参加者取得に失敗しました",
    async () => {
      const snap = await getDoc(doc(playersRef(tid), uid));
      if (!snap.exists()) return null;
      return { id: snap.id, ...snap.data() };
    },
    { tid, uid },
  );
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
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "参加者登録に失敗しました",
    async () => {
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
        isPlayingDealer: false,
      });
      logger.info("player create ok", { tid, uid });
    },
    { tid, uid },
  );
}

/**
 * Phase 1 (07-third-dryrun-improvements): 運営者が「名前のみ」の参加者を代理 create する。
 *  - `uid: null`（本人アカウント不在の運営者管理専用 player）。
 *  - pid は `crypto.randomUUID()` の合成 id（pid==uid invariant は持たない）。
 *  - 席フィールド null / `isBusted=false` / `isPlayingDealer=false` で初期化（self/clone と同期）。
 *  - displayName の trim / ≤15 文字検証は service 層（proxy-receipt）の責務。repository は
 *    upsertPlayer と同様に受け取った値をそのまま書く。
 *
 * 戻り値は発行した合成 pid（Phase 2 UI が表示名修正等で参照する）。
 *
 * 権限の最終防衛は Firestore Rules（Phase 1 で追加した name-only create ブランチ）。
 * client 側の organizer チェックは呼出側 service が行う前提。
 */
export async function createNamedOnlyPlayer(
  tid: string,
  displayName: string,
): Promise<string> {
  const pid = crypto.randomUUID();
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "名前のみ参加者の登録に失敗しました",
    async () => {
      await setDoc(doc(playersRef(tid), pid), {
        displayName,
        uid: null,
        entryAt: serverTimestamp(),
        isBusted: false,
        bustedAt: null,
        tableNum: null,
        seatNum: null,
        lastMovedAt: null,
        isPlayingDealer: false,
      });
    },
    { tid, pid },
  );
  logger.info("named-only player create ok", { tid, pid });
  return pid;
}

/**
 * プレイヤードキュメントを削除する。
 * Firestore rules で自己削除（`pid == auth.uid`）と運営者削除の両方を許可する前提。
 */
export async function deletePlayer(tid: string, pid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "参加者の取消に失敗しました",
    async () => {
      await deleteDoc(doc(playersRef(tid), pid));
    },
    { tid, pid },
  );
  logger.info("player delete ok", { tid, pid });
}

/**
 * Phase 4: 運営者がバストを記録する。席はクリアする。
 *
 * Phase 5.1: 同卓 PD player の `isPlayingDealer=false` を同時に batch 更新する。
 *
 * `sameTablePlayerIds` は「同卓で PD フラグを降ろすべき player の ID」のみを呼出側で
 * pre-filter して渡す（同卓 1 PD 制約のため最大 1 件）。歴史的経緯で配列引数のままだが
 * 全員渡しても冪等に動く（loop 内で個別 update を発行する）。9 席満卓で全員を渡すと
 * 不要な write が 7〜8 件増えるため呼出側で絞ること。
 *
 * 権限の最終防衛は Firestore rules（group メンバーのみ書込可）。client 側の
 * group チェックは呼び出し元（component / orchestrator）で行う前提。
 */
export async function bustPlayer(
  tid: string,
  pid: string,
  sameTablePlayerIds: string[] = [],
): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "バスト処理に失敗しました",
    async () => {
      const batch = writeBatch(firestore);
      const ts = serverTimestamp();
      // 当該 player: bust + seat 解放 + PD フラグ降ろし
      batch.update(doc(playersRef(tid), pid), {
        isBusted: true,
        bustedAt: ts,
        tableNum: null,
        seatNum: null,
        lastMovedAt: ts,
        isPlayingDealer: false,
      });
      // 同卓 PD（呼出側で絞られている）の PD フラグを降ろす。冪等（false → false の no-op write OK）。
      for (const otherId of sameTablePlayerIds) {
        if (otherId === pid) continue;
        batch.update(doc(playersRef(tid), otherId), {
          isPlayingDealer: false,
        });
      }
      await batch.commit();
    },
    { tid, pid },
  );
  logger.info("player bust ok", { tid, pid, sameTableCount: sameTablePlayerIds.length });
}

/**
 * Phase 4: バスト誤操作のリカバリ。席は復旧しない（再度の手動 join 相当）。
 */
export async function unbustPlayer(tid: string, pid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "バスト取消に失敗しました",
    async () => {
      await updateDoc(doc(playersRef(tid), pid), {
        isBusted: false,
        bustedAt: null,
        lastMovedAt: serverTimestamp(),
      });
    },
    { tid, pid },
  );
  logger.info("player unbust ok", { tid, pid });
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
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "席割当に失敗しました",
    async () => {
      await updateDoc(doc(playersRef(tid), pid), {
        tableNum,
        seatNum,
        lastMovedAt: serverTimestamp(),
      });
    },
    { tid, pid },
  );
  logger.info("player seat assign ok", { tid, pid, tableNum, seatNum });
}

/**
 * Phase 4: 席をクリアする（バスト以外の理由で席だけ外したい場合の保険）。
 * 現状は呼び出し元なし。将来「卓閉鎖の中間状態を表現したい」等のために置いておく。
 */
export async function clearSeat(tid: string, pid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "席クリアに失敗しました",
    async () => {
      await updateDoc(doc(playersRef(tid), pid), {
        tableNum: null,
        seatNum: null,
        lastMovedAt: serverTimestamp(),
      });
    },
    { tid, pid },
  );
  logger.info("player seat clear ok", { tid, pid });
}

/**
 * Phase 5.4: src tournament の player を dest tournament に複製する。
 *  - selectedPlayerIds に含まれる pid だけをコピー
 *  - uid===null の player（理論上発生しないが防衛的に）は skip
 *  - dest 側は `setDoc(doc(playersRef(destTid), uid), {...})` で pid==uid invariant を維持
 *  - isBusted=false / no seat / no PD / entryAt=serverTimestamp() で reset
 *  - 上限 MAX_CLONE_PLAYERS を超えると tournament/clone-too-many で throw
 *  - 実コピー件数 0 のときは tournament/clone-empty で throw（空 batch.commit を成功させない）
 *
 * 権限の最終防衛は Firestore Rules（Phase 5.4 で追加した organizer-clone create ブランチ）。
 * client 側の組織者チェックは呼出側 orchestrator が行う前提。
 *
 * 戻り値: 実際にコピーされた件数。selectedPlayerIds に含まれていても src に存在しない /
 * uid===null の人は除外されるため selectedPlayerIds.length と一致しないことがある。
 */
export async function clonePlayersFromTournament(
  srcTid: string,
  destTid: string,
  selectedPlayerIds: string[],
): Promise<number> {
  if (selectedPlayerIds.length > MAX_CLONE_PLAYERS) {
    throw new AppError(
      `clone 対象は ${MAX_CLONE_PLAYERS} 件までです`,
      "tournament/clone-too-many",
    );
  }
  const selected = new Set(selectedPlayerIds);
  const count = await wrapFirestoreWrite(
    "firestore/write_failed",
    "参加者の複製に失敗しました",
    async () => {
      const srcSnap = await getDocs(playersRef(srcTid));
      const batch = writeBatch(firestore);
      let n = 0;
      for (const d of srcSnap.docs) {
        if (!selected.has(d.id)) continue;
        const body = d.data();
        if (body.uid === null) continue;
        batch.set(doc(playersRef(destTid), body.uid), {
          displayName: body.displayName,
          uid: body.uid,
          entryAt: serverTimestamp(),
          isBusted: false,
          bustedAt: null,
          tableNum: null,
          seatNum: null,
          lastMovedAt: null,
          isPlayingDealer: false,
        });
        n++;
      }
      if (n === 0) {
        throw new AppError(
          "コピー対象の参加者が見つかりませんでした",
          "tournament/clone-empty",
        );
      }
      await batch.commit();
      return n;
    },
    { srcTid, destTid },
  );
  logger.info("players clone ok", { srcTid, destTid, copied: count });
  return count;
}
