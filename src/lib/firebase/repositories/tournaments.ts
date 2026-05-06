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
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";

import { AppError } from "@/lib/errors";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import { groupDocRef } from "@/lib/firebase/repositories/groups";
import { listPlayers } from "@/lib/firebase/repositories/players";
import {
  seasonStatsDocRef,
  seasonStatsRawDocRef,
} from "@/lib/firebase/repositories/seasonStats";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import {
  tournamentBodySchema,
  type CreateTournamentInput,
  type TournamentDoc,
  type UpdateTournamentInput,
} from "@/lib/firebase/schemas/tournament";
import { loadTournamentInTx } from "@/lib/firebase/tx-helpers";
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { MAX_LEVEL_DURATION_SEC, MAX_LEVELS_PER_TOURNAMENT } from "@/lib/limits";
import { logger } from "@/lib/logger";
import { calcSeasonPoints, isFinalTable } from "@/lib/services/season-points";
import { resolveRanking } from "@/lib/services/timer";
import {
  canAdvanceLevel,
  canAppendLevel,
  canBeginSeating,
  canConfirmSeating,
  canDelete,
  canEditLevelDurations,
  canPause,
  canResume,
  canRevertLevel,
  isFinished,
} from "@/lib/services/tournament-state";

import type { Level } from "@/lib/firebase/schemas/structure";

const tournamentsRef = collection(firestore, "tournaments").withConverter(
  zodConverter(tournamentBodySchema, "tournaments"),
);

/**
 * Phase A: `finishTournament` の tx 内で converter 抜きに読んだ raw `seasonStats` doc を
 * 必要な数値フィールドだけ防御的に取り出す。schema mismatch（型不正・field 欠損）が
 * あっても tx 全体を落とさず 0 として扱い、増分ロジックを継続させる。
 *
 * `Number(undefined)` は `NaN`、`Number(null)` は 0 になるため、`Number.isFinite` で
 * 弾いてから返す。負値も「壊れた値」として 0 にクランプ（負累計は意味を持たない）。
 */
function toPrevStats(data: unknown): {
  participations: number;
  wins: number;
  finalTables: number;
  totalPoints: number;
} {
  const obj = (data ?? {}) as Record<string, unknown>;
  const safeNumber = (v: unknown): number => {
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  };
  return {
    participations: Math.trunc(safeNumber(obj.participations)),
    wins: Math.trunc(safeNumber(obj.wins)),
    finalTables: Math.trunc(safeNumber(obj.finalTables)),
    totalPoints: safeNumber(obj.totalPoints),
  };
}

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
          const t = await loadTournamentInTx(tx, tid, userGroupIds);
          const ref = doc(tournamentsRef, tid);
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
        const cur = await loadTournamentInTx(tx, tid, userGroupIds);
        const ref = doc(tournamentsRef, tid);
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
 * Phase 5.3: appendLevel が受け付ける入力 DTO。
 * `level` 番号は repository が `oldLevels.length + 1` で自動採番するため含めない。
 */
export interface AppendLevelInput {
  sb: number;
  bb: number;
  ante: number;
  durationSec: number;
  isBreak: boolean;
}

/**
 * Phase 5.3: 進行中（または setup 中）のトーナメントの structureSnapshot.levels 末尾に
 * 新規レベルを 1 つ append する。Phase 5.2 setLevelDurationSec と同じ array-rewrite +
 * runTransaction パターン。
 *
 *  - 権限: `userGroupIds` に対象 tournament の groupId が含まれることを tx 内で再 check。
 *    最終防衛は Firestore Rules の `isOrganizer(resource.data.groupId)`。
 *  - 値域: levelInput は AppendLevelInput（sb/bb/ante: nonneg int /
 *    durationSec: 1..MAX_LEVEL_DURATION_SEC int / isBreak: bool）。
 *    `!isBreak && bb <= 0` は levelSchema の .refine() と同等条件で早期 throw。
 *  - state: `canAppendLevel` で finished / 上限到達を弾く。
 *  - 採番: 新 level 番号は `oldLevels.length + 1`（呼出側で number を作らせない）。
 *  - 残時間挙動: 現在 Lv は変更されないため `getRemainingMs` は不変。最終 Lv 張り付き
 *    状態だった場合、次 tick で `shouldAutoAdvance` が `currentLevel < levels.length` を
 *    満たし auto-advance が発火する（運営者は何もせず新 Lv に進む）。
 *  - lastLevelChangeKind は touch しない（append は「レベル遷移」ではない）。
 */
export async function appendLevel(
  tid: string,
  uid: string,
  userGroupIds: string[],
  levelInput: AppendLevelInput,
): Promise<void> {
  // tx 起動前の早期 validation（zod schema は converter 経由の read 時に評価されるが、
  // ネットワーク往復を節約するため明白な型 / 値域違反はここで弾く）。
  if (
    !Number.isInteger(levelInput.sb) ||
    levelInput.sb < 0 ||
    !Number.isInteger(levelInput.bb) ||
    levelInput.bb < 0 ||
    !Number.isInteger(levelInput.ante) ||
    levelInput.ante < 0 ||
    !Number.isInteger(levelInput.durationSec) ||
    levelInput.durationSec < 1 ||
    levelInput.durationSec > MAX_LEVEL_DURATION_SEC ||
    typeof levelInput.isBreak !== "boolean" ||
    (!levelInput.isBreak && levelInput.bb <= 0)
  ) {
    throw new AppError(
      "新規レベルの入力値が不正です（SB/BB/Ante は 0 以上の整数、分は 1 以上、プレイレベルは BB > 0）",
      "validation/level-input-invalid",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "レベル追加に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const cur = await loadTournamentInTx(tx, tid, userGroupIds);
        const ref = doc(tournamentsRef, tid);
        if (isFinished(cur)) {
          throw new AppError(
            "終了済みのトーナメントにはレベルを追加できません",
            "tournament/append-not-allowed",
          );
        }
        if (!canAppendLevel(cur)) {
          throw new AppError(
            `レベル数の上限（${MAX_LEVELS_PER_TOURNAMENT}）に達しています`,
            "tournament/levels-limit-exceeded",
          );
        }
        const oldLevels = cur.structureSnapshot.levels;
        const newLevel: Level = {
          level: oldLevels.length + 1,
          sb: levelInput.sb,
          bb: levelInput.bb,
          ante: levelInput.ante,
          durationSec: levelInput.durationSec,
          isBreak: levelInput.isBreak,
        };
        const newLevels = [...oldLevels, newLevel];
        tx.update(ref, {
          "structureSnapshot.levels": newLevels,
          updatedAt: serverTimestamp(),
        });
      });
    },
    { tid },
  );
  logger.info("level appended", {
    tid,
    uid,
    isBreak: levelInput.isBreak,
    durationSec: levelInput.durationSec,
  });
}

/**
 * トーナメントを終了する（state: * → finished）。
 *
 *  - Phase 4.16: tournament の state 更新と group の `finishedTournamentCount` インクリメントを
 *    runTransaction で atomic に行う。tx 内で state を再 read することで、
 *    複数端末が同時に呼んだ場合でも片方だけが increment し、二重カウントを防ぐ。
 *  - 事前 read で finished を観測した場合は tx を起こさず早期 return（read コスト節約）。
 *  - Phase A: tx 内で全参加者の `seasonStats/{uid}` を atomic に増分する
 *    （参加 +1、優勝者は wins +1、FT 内なら finalTables +1、totalPoints += calcSeasonPoints()）。
 *    tx 内で query は実行できないため事前に `listPlayers` で順位を確定し、
 *    tx 内では各 doc を `tx.get` → `tx.set` で個別書込する read-then-write 順序を守る。
 *    `uid === null` の player は skip（pid==uid invariant 以前の互換 player は通常存在しない）。
 */
export async function finishTournament(
  tid: string,
  uid: string,
  userGroupIds: string[],
): Promise<void> {
  const t = await assertCanManage(tid, userGroupIds);
  if (isFinished(t)) return;

  // Phase A: 事前 read で参加者と順位を確定（tx 内では query 不可）。tx 起動前に評価することで
  //   複数端末同時 finish の race は tx 内 state 再 read で deny される。
  const players = await listPlayers(tid);
  const ranking = resolveRanking(players);
  const totalParticipants = ranking.length;
  // serverTimestamp() を tx.set フィールドに渡すと sentinel pending のまま zod の
  // `instanceof(Timestamp)` validate に倒れるリスクがあるため、client clock の Timestamp.now() で固定する。
  // 用途は seasonStats.lastUpdatedAt の表示のみ（順位・ポイント計算には影響しない）。
  const finishedAtClient = Timestamp.now();

  await wrapFirestoreWrite(
    "firestore/write_failed",
    "終了処理に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        const cur = await loadTournamentInTx(tx, tid, userGroupIds);
        const ref = doc(tournamentsRef, tid);
        if (isFinished(cur)) {
          // 別端末が先に確定済み。二重 increment を避けるため no-op で抜ける。
          logger.info("tournament finish skipped (race)", { tid, uid });
          return;
        }

        // Phase A: read-then-write 順序を守る。先に全 seasonStats を tx.get、その後で tx.update / tx.set。
        //
        // tx.get は `seasonStatsRawDocRef`（converter 抜き）で行う。converter 付きの
        // `seasonStatsDocRef` で読むと、過去シーズンに schema mismatch を起こした 1 件の
        // 不整合 doc によって tx 全体が `firestore/invalid-data` で失敗し、
        // トーナメント終了が止まる。tx 内では invariant 強制を緩め、`Number(...)` で
        // 数値のみ防御的に取り出す（外側の list / subscribe では converter のまま schema を効かせる）。
        const reads: Array<{
          playerUid: string;
          displayName: string;
          rank: number;
          prev:
            | {
                participations: number;
                wins: number;
                finalTables: number;
                totalPoints: number;
              }
            | null;
        }> = [];
        for (const r of ranking) {
          if (r.uid === null) continue;
          // eslint-disable-next-line no-await-in-loop -- tx の read-then-write 順序のため逐次評価
          const existing = await tx.get(seasonStatsRawDocRef(cur.groupId, r.uid));
          reads.push({
            playerUid: r.uid,
            displayName: r.displayName,
            rank: r.rank,
            prev: existing.exists() ? toPrevStats(existing.data()) : null,
          });
        }

        tx.update(ref, {
          state: "finished",
          finishedAt: serverTimestamp(),
          pausedAt: null,
          updatedAt: serverTimestamp(),
        });
        tx.update(groupDocRef(cur.groupId), {
          finishedTournamentCount: increment(1),
        });
        for (const e of reads) {
          const points = calcSeasonPoints(e.rank, totalParticipants);
          const isWin = e.rank === 1 ? 1 : 0;
          const isFT = isFinalTable(e.rank) ? 1 : 0;
          const next = {
            uid: e.playerUid,
            // player.displayName は schema 上 max なし（Phase 4.7 join 時のみ 15 文字制約）。
            // 旧経路で 15 字超過の値が混入しても seasonStats rule の deny で
            // tx 全体を落とさないよう、書込側で 15 字に切り詰める（最終ライン防御）。
            displayName: e.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
            participations: (e.prev?.participations ?? 0) + 1,
            wins: (e.prev?.wins ?? 0) + isWin,
            finalTables: (e.prev?.finalTables ?? 0) + isFT,
            // 毎回 2 桁丸めで累積誤差を抑制（calcSeasonPoints の戻り値も 2 桁正規化済み）
            totalPoints:
              Math.round(((e.prev?.totalPoints ?? 0) + points) * 100) / 100,
            lastUpdatedAt: finishedAtClient,
          };
          tx.set(seasonStatsDocRef(cur.groupId, e.playerUid), next);
        }
      });
    },
    { tid },
  );
  logger.info("tournament finish ok", {
    tid,
    uid,
    gid: t.groupId,
    participants: totalParticipants,
  });
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
