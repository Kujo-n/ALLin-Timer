import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH } from "./group";

/**
 * Phase A: `groups/{gid}/seasonStats/{uid}` のスキーマ。
 *
 *  - doc id は player の uid（== `players/{pid}.uid`、pid==uid invariant）
 *  - 書込経路は `finishTournament` tx と `startNewSeason` tx の 2 つのみ
 *  - `totalPoints` は小数 2 桁で保持（calcSeasonPoints の戻り値と同精度）
 *  - `lastUpdatedAt` は client clock の `Timestamp.now()`（tx.set で serverTimestamp が
 *    sentinel pending になるリスクを避けるため）
 */
export const seasonStatsBodySchema = z.object({
  /** uid は doc id と冗長だが、subscribe 時のフィルタやランキング表示で利用するため保持。 */
  uid: z.string().min(1),
  /** 集計対象トーナメント終了時点の表示名 snapshot（rename 追従はしない）。 */
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  /** 参加トーナメント数。finishTournament tx で +1 増分される。 */
  participations: z.number().int().nonnegative(),
  /** 優勝（rank == 1）回数。 */
  wins: z.number().int().nonnegative(),
  /** ファイナルテーブル進出（rank <= SEASON_FINAL_TABLE_THRESHOLD）回数。 */
  finalTables: z.number().int().nonnegative(),
  /** 累計ポイント（小数 2 桁）。 */
  totalPoints: z.number().nonnegative(),
  /** 直近の更新時刻（最新の終了 tournament 観測時）。 */
  lastUpdatedAt: z.instanceof(Timestamp),
});
type SeasonStatsBody = z.infer<typeof seasonStatsBodySchema>;
export type SeasonStatsDoc = SeasonStatsBody & { id: string };
