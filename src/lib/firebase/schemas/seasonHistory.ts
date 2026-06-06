import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH } from "./group";

/**
 * Phase A: シーズン履歴 1 件分のエントリ。`seasonStats/{uid}` の snapshot。
 */
export const seasonHistoryEntrySchema = z.object({
  uid: z.string().min(1),
  displayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  participations: z.number().int().nonnegative(),
  wins: z.number().int().nonnegative(),
  finalTables: z.number().int().nonnegative(),
  totalPoints: z.number().nonnegative(),
});

/**
 * Phase A: `groups/{gid}/seasonHistory/{seasonId}` のスキーマ。
 *
 *  - `startNewSeason()` の runTransaction で「現在 seasonStats 全件 + seasonStartDate」を
 *    1 doc に snapshot して append する（append-only、rule 側で update / delete deny）
 *  - doc id は `crypto.randomUUID()` で service 側が確定（衝突確率は実質ゼロ）
 *  - `entries` 配列は totalPoints の sort 状態を保証しない（read 側で並べる）
 *  - `startedAt` は前シーズンの開始時刻（最初のシーズン切替時のみ null）
 *  - `endedAt` は本シーズン履歴の作成時刻 = 新シーズン開始時刻
 */
export const seasonHistoryBodySchema = z.object({
  /** 当該シーズンの開始時刻（snapshot 時点の groups.seasonStartDate）。初回切替時のみ null。 */
  startedAt: z.instanceof(Timestamp).nullable(),
  /** snapshot を作成した時刻（= 新シーズン開始時刻）。 */
  endedAt: z.instanceof(Timestamp),
  /** 全参加メンバーの最終 stats。totalPoints desc は read 側で sort。 */
  entries: z.array(seasonHistoryEntrySchema),
});
type SeasonHistoryBody = z.infer<typeof seasonHistoryBodySchema>;
export type SeasonHistoryDoc = SeasonHistoryBody & { id: string };
