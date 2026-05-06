import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
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
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { MAX_LEVEL_DURATION_SEC } from "@/lib/limits";
import { logger } from "@/lib/logger";
import {
  canAdvanceLevel,
  canBeginSeating,
  canConfirmSeating,
  canDelete,
  canEditLevelDurations,
  canPause,
  canResume,
  canRevertLevel,
  isFinished,
} from "@/lib/services/tournament-state";

const tournamentsRef = collection(firestore, "tournaments").withConverter(
  zodConverter(tournamentBodySchema, "tournaments"),
);

export async function createTournament(input: CreateTournamentInput): Promise<string> {
  const tid = await wrapFirestoreWrite(
    "firestore/write_failed",
    "トーナメント作成に失敗しました",
    async () => {
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
      return ref.id;
    },
  );
  logger.info("tournament create ok", { tid, gid: input.groupId });
  return tid;
}

export async function getTournament(tid: string): Promise<TournamentDoc> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "トーナメント取得に失敗しました",
    async () => {
      const snap = await getDoc(doc(tournamentsRef, tid));
      if (!snap.exists()) {
        throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
      }
      return { id: snap.id, ...snap.data() };
    },
    { tid },
  );
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
  return wrapFirestoreRead(
    "firestore/read_failed",
    "トーナメント一覧取得に失敗しました",
    async () => {
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
    },
    { groupId },
  );
}

export async function updateTournament(tid: string, patch: UpdateTournamentInput): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "トーナメント更新に失敗しました",
    async () => {
      await updateDoc(doc(tournamentsRef, tid), {
        ...patch,
        updatedAt: serverTimestamp(),
      });
    },
    { tid },
  );
  logger.info("tournament update ok", { tid });
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
  if (!canBeginSeating(t)) {
    throw new AppError("setup 状態ではありません", "tournament/invalid-state");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "席決めフェーズへの遷移に失敗しました",
    async () => {
      await updateDoc(doc(tournamentsRef, tid), {
        state: "seating",
        updatedAt: serverTimestamp(),
      });
    },
    { tid },
  );
  logger.info("tournament seating begin ok", { tid, uid });
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
  if (!canConfirmSeating(t)) {
    throw new AppError("seating 状態ではありません", "tournament/invalid-state");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "トーナメント開始に失敗しました",
    async () => {
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
    },
    { tid },
  );
  logger.info("tournament seating confirm ok", { tid, uid });
}

export async function pauseTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (!canPause(t)) {
    throw new AppError("running 状態ではありません", "tournament/invalid-state");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "一時停止に失敗しました",
    async () => {
      await updateDoc(doc(tournamentsRef, tid), {
        state: "paused",
        pausedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    },
    { tid },
  );
  logger.info("tournament pause ok", { tid, uid });
}

export async function resumeTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (!canResume(t)) {
    throw new AppError("paused 状態ではありません", "tournament/invalid-state");
  }
  if (!t.pausedAt) {
    throw new AppError("pausedAt が設定されていません", "tournament/invalid-state");
  }
  // 端末時計ベースで pause 持続時間を概算（精度は ~1 秒、level 遷移時にリセット）。
  const pausedFor = Math.max(0, Date.now() - t.pausedAt.toMillis());
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "再開に失敗しました",
    async () => {
      await updateDoc(doc(tournamentsRef, tid), {
        state: "running",
        pausedAt: null,
        pausedAccumMs: (t.pausedAccumMs ?? 0) + pausedFor,
        updatedAt: serverTimestamp(),
      });
    },
    { tid },
  );
  logger.info("tournament resume ok", { tid, uid, pausedFor });
}

/**
 * level 遷移時の共通フィールド更新。
 *  - running から呼ばれた場合: state はそのまま、pausedAt=null
 *  - paused から呼ばれた場合: state="paused" を維持し、新 level の先頭で再 pause
 *    （pausedAt を新 serverTimestamp に。pausedAccumMs はリセット）
 *  - kind="auto" / "manual" を `lastLevelChangeKind` に記録し、useAudioPlayer が
 *    「手動遷移時は音を鳴らさない」分岐に使う。
 *
 * これがないと paused 中の手動 advance/revert で `state=paused && pausedAt=null` の
 * invariant 違反が発生し、再開時に `tournament/invalid-state` が出る。
 */
function levelTransitionUpdates(
  prevState: TournamentDoc["state"],
  newCurrentLevel: number,
  kind: "auto" | "manual",
): Record<string, unknown> {
  const isPaused = prevState === "paused";
  return {
    currentLevel: newCurrentLevel,
    levelStartedAt: serverTimestamp(),
    pausedAt: isPaused ? serverTimestamp() : null,
    pausedAccumMs: 0,
    lastLevelChangeKind: kind,
    updatedAt: serverTimestamp(),
  };
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
    await wrapFirestoreWrite(
      "firestore/write_failed",
      "レベル進行に失敗しました",
      async () => {
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
          tx.update(ref, levelTransitionUpdates(t.state, t.currentLevel + 1, "auto"));
        });
      },
      { tid },
    );
    logger.info("advance level ok (auto)", { tid, uid, expected });
    return;
  }

  const t = await assertCanManage(tid, userGroupIds);
  if (!canAdvanceLevel(t)) {
    throw new AppError("最終レベルです", "tournament/invalid-state");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "レベル進行に失敗しました",
    async () => {
      await updateDoc(
        doc(tournamentsRef, tid),
        levelTransitionUpdates(t.state, t.currentLevel + 1, "manual"),
      );
    },
    { tid },
  );
  logger.info("advance level ok (manual)", { tid, uid });
}

export async function revertLevel(tid: string, uid: string, userGroupIds: string[]): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (!canRevertLevel(t)) {
    throw new AppError("最初のレベルです", "tournament/invalid-state");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "レベル巻き戻しに失敗しました",
    async () => {
      await updateDoc(
        doc(tournamentsRef, tid),
        levelTransitionUpdates(t.state, t.currentLevel - 1, "manual"),
      );
    },
    { tid },
  );
  logger.info("revert level ok", { tid, uid });
}

/**
 * Phase 5.2: 進行中（または setup 中）のトーナメントの
 * `structureSnapshot.levels[levelIndex].durationSec` を単独で書き換える。
 *
 * Firestore は配列要素の dot-path addressing（`structureSnapshot.levels.2.durationSec`）に
 * 非対応のため、`runTransaction` 内で旧 levels 配列を read し、該当 index だけ
 * 置換した新配列を `structureSnapshot.levels` に dot-path で書き戻す。
 * `structureSnapshot` 全体を上書きしないことで他フィールド (name / initialStack /
 * lateEntryDeadlineLevel 等) は保持される。
 *
 *  - 権限: `userGroupIds` に対象 tournament の groupId が含まれることを tx 内で再 check。
 *    最終防衛は Firestore Rules の `isOrganizer(resource.data.groupId)`。
 *  - 値域: durationSec は 1 秒以上 `MAX_LEVEL_DURATION_SEC` 秒以下の整数。
 *  - state: `canEditLevelDurations` で過去レベル / finished を弾く。
 *  - レベル遷移ではないため `levelTransitionUpdates` は呼ばない（`currentLevel` /
 *    `levelStartedAt` / `pausedAt` / `lastLevelChangeKind` を touch しない）。
 *  - 残時間挙動: `getRemainingMs` の `duration - elapsed` 数式が新 `durationSec` を
 *    そのまま採用するため、進行中レベルの編集は約 1 秒で全端末に反映される。
 */
export async function setLevelDurationSec(
  tid: string,
  uid: string,
  userGroupIds: string[],
  levelIndex: number,
  durationSec: number,
): Promise<void> {
  if (
    !Number.isInteger(durationSec) ||
    durationSec < 1 ||
    durationSec > MAX_LEVEL_DURATION_SEC
  ) {
    throw new AppError(
      `レベル時間は 1 秒以上 ${MAX_LEVEL_DURATION_SEC} 秒以下の整数で指定してください`,
      "validation/level-duration-invalid",
    );
  }
  if (!Number.isInteger(levelIndex) || levelIndex < 0) {
    throw new AppError("levelIndex が不正です", "tournament/invalid-level-index");
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "レベル時間の更新に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const ref = doc(tournamentsRef, tid);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
        }
        const cur: TournamentDoc = { id: snap.id, ...snap.data() };
        if (!cur.groupId || !userGroupIds.includes(cur.groupId)) {
          throw new AppError("not allowed", "firestore/permission-denied");
        }
        const oldLevels = cur.structureSnapshot.levels;
        if (levelIndex >= oldLevels.length) {
          throw new AppError("levelIndex が範囲外です", "tournament/invalid-level-index");
        }
        if (!canEditLevelDurations(cur, levelIndex)) {
          throw new AppError(
            "このレベルは編集できません（過去レベルまたは終了済み）",
            "tournament/level-edit-not-allowed",
          );
        }
        const newLevels = oldLevels.map((l, i) =>
          i === levelIndex ? { ...l, durationSec } : l,
        );
        tx.update(ref, {
          "structureSnapshot.levels": newLevels,
          updatedAt: serverTimestamp(),
        });
      });
    },
    { tid, levelIndex, durationSec },
  );
  logger.info("level duration updated", { tid, uid, levelIndex, durationSec });
}

/**
 * トーナメントを終了する（state: * → finished）。
 *  - Phase 4.16: tournament の state 更新と group の `finishedTournamentCount` インクリメントを
 *    runTransaction で atomic に行う。tx 内で state を再 read することで、
 *    複数端末が同時に呼んだ場合でも片方だけが increment し、二重カウントを防ぐ。
 *  - 事前 read で finished を観測した場合は tx を起こさず早期 return（read コスト節約）。
 */
export async function finishTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (isFinished(t)) return;
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "終了処理に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const ref = doc(tournamentsRef, tid);
        const snap = await tx.get(ref);
        if (!snap.exists()) {
          throw new AppError(`tournament not found: ${tid}`, "firestore/not-found");
        }
        const cur: TournamentDoc = { id: snap.id, ...snap.data() };
        if (isFinished(cur)) {
          // 別端末が先に確定済み。二重 increment を避けるため no-op で抜ける。
          logger.info("tournament finish skipped (race)", { tid, uid });
          return;
        }
        tx.update(ref, {
          state: "finished",
          finishedAt: serverTimestamp(),
          pausedAt: null,
          updatedAt: serverTimestamp(),
        });
        tx.update(doc(firestore, "groups", cur.groupId), {
          finishedTournamentCount: increment(1),
        });
      });
    },
    { tid },
  );
  logger.info("tournament finish ok", { tid, uid, gid: t.groupId });
}

interface TournamentSnapshotPayload {
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

/**
 * tournaments/{tid} の onSnapshot 購読（group スコープ）。
 *  - 開始中（seating / running / paused）の tournament をサイドバーへ realtime 表示する用途。
 *  - listTournamentsByGroup と同じく orderBy は付けず、複合 index を避けるため client 側で sort。
 *  - 個別 doc が schema validate に失敗しても全体を落とさず該当 doc のみスキップ。
 */
export function subscribeTournamentsByGroup(
  groupId: string,
  onNext: (items: TournamentDoc[]) => void,
  onError: (err: AppError) => void,
): () => void {
  return onSnapshot(
    query(tournamentsRef, where("groupId", "==", groupId)),
    (snap) => {
      try {
        const items: TournamentDoc[] = [];
        for (const d of snap.docs) {
          try {
            items.push({ id: d.id, ...d.data() });
          } catch (e) {
            // 旧スキーマで作成された孤立 doc を一覧から除外し、
            // 元エラーは AppError でラップして code 付きで残す（listTournamentsByGroup と同方針）。
            const wrapped = AppError.from(e, "firestore/invalid-data", "不正なドキュメント");
            logger.warn("subscribe skipped invalid tournament", {
              tid: d.id,
              code: wrapped.code,
            });
          }
        }
        items.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
        onNext(items);
      } catch (e) {
        onError(AppError.from(e, "firestore/invalid-data", "トーナメント一覧データが不正です"));
      }
    },
    (err) => onError(AppError.from(err, "firestore/subscribe_failed", "一覧購読エラー")),
  );
}

/**
 * トーナメントを削除する。
 *  - state === "setup" または "finished" のときのみ許可（進行中は先に終了が必要）。
 *  - sub-collection（players / tables）も同じ writeBatch で cascade 削除する。
 *    20 人 × 6 卓規模では 1 batch（500 ops 上限）に収まる。
 *  - rule 側の `match /{sub=**}` の write は親 doc が exists かつ isOrganizer を要求するが、
 *    `exists()` は当該 request 開始時点の DB を見るため、同 batch 内で親 doc を最後に
 *    delete しても sub-collection delete は許容される。
 */
export async function deleteTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await getTournament(tid);
  if (!t.groupId || !userGroupIds.includes(t.groupId)) {
    throw new AppError("not allowed", "firestore/permission-denied");
  }
  if (!canDelete(t)) {
    throw new AppError(
      "進行中のトーナメントは削除できません（先に終了してください）",
      "tournament/in-progress",
    );
  }
  const counts = await wrapFirestoreWrite(
    "firestore/write_failed",
    "トーナメント削除に失敗しました",
    async () => {
      const batch = writeBatch(firestore);
      const playersSnap = await getDocs(collection(firestore, "tournaments", tid, "players"));
      playersSnap.forEach((d) => batch.delete(d.ref));
      const tablesSnap = await getDocs(collection(firestore, "tournaments", tid, "tables"));
      tablesSnap.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(tournamentsRef, tid));
      await batch.commit();
      return { players: playersSnap.size, tables: tablesSnap.size };
    },
    { tid },
  );
  logger.info("tournament delete ok", {
    tid,
    uid,
    state: t.state,
    players: counts.players,
    tables: counts.tables,
  });
}
