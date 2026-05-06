import { unwrapOrFrom } from "@/lib/errors";
import { clonePlayersFromTournament } from "@/lib/firebase/repositories/players";
import { createTournament } from "@/lib/firebase/repositories/tournaments";
import type { CreateTournamentInput } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";

export interface CloneTournamentArgs {
  /** コピー元 tournament の id。 */
  srcTid: string;
  /** UI で運営者がチェックした player id（= player.uid）の配列。 */
  selectedPlayerIds: string[];
  /** 新トーナメントの作成 input。`/tournaments/new` の createTournament 呼出と同じ shape。 */
  create: CreateTournamentInput;
}

export interface CloneTournamentResult {
  newTid: string;
  cloned: number;
}

/**
 * Phase 5.4: 「同じ参加者で次のトーナメントを作成」のオーケストレータ。
 *  1. createTournament で setup 状態の新 tournament を作る
 *  2. clonePlayersFromTournament で src の player を選択分だけ複製する
 *
 * clone 失敗時は新 tournament が空 setup として残る。本関数では rollback しない
 * （UI 側で「作成は成功したが参加者複製に失敗、削除して再試行してください」を表示し、
 * 運営者が通常の「削除」ボタンで cascade 削除する）。失敗時の logger.warn は
 * repository 側 wrapFirestoreWrite が出力済みのため、ここで再度 warn しない。
 */
export async function cloneTournamentWithPlayers(
  args: CloneTournamentArgs,
): Promise<CloneTournamentResult> {
  const newTid = await createTournament(args.create);
  try {
    const cloned = await clonePlayersFromTournament(
      args.srcTid,
      newTid,
      args.selectedPlayerIds,
    );
    logger.info("clone tournament ok", {
      srcTid: args.srcTid,
      newTid,
      cloned,
    });
    return { newTid, cloned };
  } catch (e) {
    // 内部の clonePlayersFromTournament で既に AppError ラップ + logger.warn 済み。
    // 二重 wrap / 二重 warn を避けるため unwrapOrFrom で透過する。未 wrap のときだけ補完。
    throw unwrapOrFrom(e, "firestore/write_failed", "クローンに失敗しました");
  }
}
