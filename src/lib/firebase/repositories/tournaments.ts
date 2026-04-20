import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  tournamentBodySchema,
  type CreateTournamentInput,
  type TournamentDoc,
  type UpdateTournamentInput,
} from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

const tournamentsRef = collection(firestore, "tournaments").withConverter(
  zodConverter(tournamentBodySchema, "tournaments"),
);

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  try {
    const ref = await addDoc(tournamentsRef, {
      groupId: input.groupId,
      createdByUid: input.createdByUid,
      name: input.name,
      structureSnapshot: input.structureSnapshot,
      state: "setup",
      startedAt: null,
      levelStartedAt: null,
      pausedAt: null,
      pausedAccumMs: 0,
      finishedAt: null,
      currentLevel: 0,
      lateEntryDeadlineLevel: input.structureSnapshot.lateEntryDeadlineLevel,
      seatsPerTable: input.seatsPerTable,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament create ok", { tid: ref.id, gid: input.groupId });
    return ref.id;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント作成に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function getTournament(tid: string): Promise<TournamentDoc> {
  try {
    const snap = await getDoc(doc(tournamentsRef, tid));
    if (!snap.exists()) {
      throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
    }
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "トーナメント取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

/**
 * 指定 group のトーナメント一覧。`where("groupId","==")` のみで取得し
 * client 側で createdAt 降順に並べる。
 *
 * 個別 doc が schema validate に失敗しても一覧全体を落とさず、該当 doc のみ
 * スキップして warn ログを残す（旧スキーマで作成された孤立 doc の影響で一覧が
 * 完全に開けなくなる事故を防ぐ）。
 */
export async function listTournamentsByGroup(groupId: string): Promise<TournamentDoc[]> {
  try {
    const q = query(tournamentsRef, where("groupId", "==", groupId));
    const snap = await getDocs(q);
    const items: TournamentDoc[] = [];
    for (const d of snap.docs) {
      try {
        items.push({ id: d.id, ...d.data() });
      } catch (e) {
        const wrapped = AppError.from(e, "firestore/invalid-data", "不正なドキュメント");
        logger.warn("tournament list skipped invalid doc", {
          tid: d.id,
          code: wrapped.code,
        });
      }
    }
    items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
    return items;
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/read_failed", "トーナメント一覧取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, groupId });
    throw wrapped;
  }
}

export async function updateTournament(tid: string, patch: UpdateTournamentInput): Promise<void> {
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      ...patch,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament update ok", { tid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * トーナメントを開始する（state: setup → running）。
 * Phase 2.5: owner ベース→group メンバーベース。
 *  - クライアント側早期失敗のため `userGroupIds` を受け取り、対象 tournament の
 *    groupId に対してメンバーかどうかチェックする。最終防衛は Firestore Rules。
 */
async function assertCanManage(tid: string, userGroupIds: string[]): Promise<TournamentDoc> {
  const t = await getTournament(tid);
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  return t;
}

/**
 * Phase 4: setup → seating の遷移。実際の席割当は orchestrator.commitInitialSeating に委ねる。
 *  - この関数は state 単独遷移のみ（古い `startTournament` の役割を分割）。
 */
export async function beginSeating(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state !== "setup") {
    throw new AppError("setup 状態ではありません", "tournament/invalid-state");
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "seating",
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament seating begin ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "席決めフェーズへの遷移に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

/**
 * Phase 4: seating → running の遷移（タイマー起動）。orchestrator が初回席決めを書き終わった後に呼ぶ。
 */
export async function confirmSeating(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state !== "seating") {
    throw new AppError("seating 状態ではありません", "tournament/invalid-state");
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "running",
      startedAt: serverTimestamp(),
      levelStartedAt: serverTimestamp(),
      pausedAt: null,
      pausedAccumMs: 0,
      finishedAt: null,
      currentLevel: 1,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament seating confirm ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント開始に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function pauseTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state !== "running") {
    throw new AppError("running 状態ではありません", "tournament/invalid-state");
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "paused",
      pausedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament pause ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "一時停止に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function resumeTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state !== "paused") {
    throw new AppError("paused 状態ではありません", "tournament/invalid-state");
  }
  if (!t.pausedAt) {
    throw new AppError("pausedAt が設定されていません", "tournament/invalid-state");
  }
  // 端末時計ベースで pause 持続時間を概算（精度は ~1 秒、level 遷移時にリセット）。
  const pausedFor = Math.max(0, Date.now() - t.pausedAt.toMillis());
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "running",
      pausedAt: null,
      pausedAccumMs: (t.pausedAccumMs ?? 0) + pausedFor,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament resume ok", { tid, uid, pausedFor });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "再開に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

/**
 * level を 1 進める。
 *  - opts.expectedLevel が指定された場合は transaction で `currentLevel == expectedLevel`
 *    を guard。auto-advance 専用（複数クライアントが同時に呼んだ際の race 解決）。
 *  - 指定なしは手動「次レベル」ボタン用の単純 update。
 */
export async function advanceLevel(
  tid: string,
  uid: string,
  userGroupIds: string[],
  opts: { expectedLevel?: number } = {},
): Promise<void> {
  if (opts.expectedLevel !== undefined) {
    const expected = opts.expectedLevel;
    try {
      await runTransaction(firestore, async (tx) => {
        const ref = doc(tournamentsRef, tid);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
        }
        const t: TournamentDoc = { id: snap.id, ...snap.data() };
        if (!t.groupId || !userGroupIds.includes(t.groupId)) {
          throw new AppError("not allowed", "firestore/permission-denied");
        }
        if (t.currentLevel !== expected) {
          // 別端末が先に進めた。no-op で抜ける。
          logger.info("advance level skipped (race)", {
            tid,
            expected,
            actual: t.currentLevel,
          });
          return;
        }
        if (t.currentLevel >= t.structureSnapshot.levels.length) return;
        tx.update(ref, {
          currentLevel: t.currentLevel + 1,
          levelStartedAt: serverTimestamp(),
          pausedAt: null,
          pausedAccumMs: 0,
          updatedAt: serverTimestamp(),
        });
      });
      logger.info("advance level ok (auto)", { tid, uid, expected });
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/write_failed", "レベル進行に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, tid });
      throw wrapped;
    }
    return;
  }

  const t = await assertCanManage(tid, userGroupIds);
  if (t.currentLevel >= t.structureSnapshot.levels.length) {
    throw new AppError("最終レベルです", "tournament/invalid-state");
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      currentLevel: t.currentLevel + 1,
      levelStartedAt: serverTimestamp(),
      pausedAt: null,
      pausedAccumMs: 0,
      updatedAt: serverTimestamp(),
    });
    logger.info("advance level ok (manual)", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "レベル進行に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function revertLevel(tid: string, uid: string, userGroupIds: string[]): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.currentLevel <= 1) {
    throw new AppError("最初のレベルです", "tournament/invalid-state");
  }
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      currentLevel: t.currentLevel - 1,
      levelStartedAt: serverTimestamp(),
      pausedAt: null,
      pausedAccumMs: 0,
      updatedAt: serverTimestamp(),
    });
    logger.info("revert level ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "レベル巻き戻しに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export async function finishTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (t.state === "finished") return;
  try {
    await updateDoc(doc(tournamentsRef, tid), {
      state: "finished",
      finishedAt: serverTimestamp(),
      pausedAt: null,
      updatedAt: serverTimestamp(),
    });
    logger.info("tournament finish ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "終了処理に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, tid });
    throw wrapped;
  }
}

export interface TournamentSnapshotPayload {
  doc: TournamentDoc | null;
  fromCache: boolean;
  hasPendingWrites: boolean;
}

/**
 * tournaments/{tid} の onSnapshot 購読。
 *  - includeMetadataChanges: true で接続状態 UI（fromCache）を駆動。
 *  - 戻り値は unsubscribe 関数（呼び出し側で useEffect cleanup する）。
 */
export function subscribeTournament(
  tid: string,
  onNext: (payload: TournamentSnapshotPayload) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    doc(tournamentsRef, tid),
    { includeMetadataChanges: true },
    (snap) => {
      try {
        if (!snap.exists()) {
          onNext({
            doc: null,
            fromCache: snap.metadata.fromCache,
            hasPendingWrites: snap.metadata.hasPendingWrites,
          });
          return;
        }
        onNext({
          doc: { id: snap.id, ...snap.data() },
          fromCache: snap.metadata.fromCache,
          hasPendingWrites: snap.metadata.hasPendingWrites,
        });
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "トーナメントデータが不正です"));
      }
    },
    (err) => onError(AppError.from(err, "firestore/subscribe_failed", "購読エラー")),
  );
}

export async function deleteTournamentIfSetup(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await getTournament(tid);
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (t.state !== "setup") {
    throw new AppError("既に開始済みのトーナメントは削除できません", "tournament/already-started");
  }
  try {
    await deleteDoc(doc(tournamentsRef, tid));
    logger.info("tournament delete ok", { tid, uid });
  } catch (e) {
    const wrapped = AppError.from(e, "firestore/write_failed", "トーナメント削除に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
