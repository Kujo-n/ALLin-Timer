import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH } from "./group";

export const playerBodySchema = z.object({
  displayName: z.string().min(1),
  uid: z.string().nullable(),
  entryAt: z.instanceof(Timestamp),
  isBusted: z.boolean(),
  bustedAt: z.instanceof(Timestamp).nullable(),
  // Phase 4: 席割当（未配席は null）。初回席決め前 / late entry 登録直後 / バスト後は null。
  tableNum: z.number().int().positive().nullable(),
  seatNum: z.number().int().positive().nullable(),
  // Phase 4: 直近の席移動時刻。/live で「席が移動しました」バナー判定に使う。
  lastMovedAt: z.instanceof(Timestamp).nullable(),
  // Phase 5.1: PD（プレイングディーラー）フラグ。1 卓 1 PD（service tx + rule で防御）。
  // additive: 旧 doc は default(false) で hydrate（破壊的 migration 不要）。
  isPlayingDealer: z.boolean().default(false),
});
type PlayerBody = z.infer<typeof playerBodySchema>;

/** UI が扱うプレイヤー（body + 合成した id、id は通常 auth.uid と同一）。 */
export type PlayerDoc = PlayerBody & { id: string };

/**
 * Phase 4.7: 受付フローのゲスト表示名入力バリデーション。
 *   auth.displayName / users.displayName / groups.memberDisplayNames[uid] と同じ上限に揃える
 *   （スマホ 1 行表示制約）。
 */
export const joinInputSchema = z.object({
  tid: z.string().min(1),
  displayName: z
    .string()
    .trim()
    .min(1, "表示名を入力してください")
    .max(DISPLAY_NAME_MAX_LENGTH, `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`),
});
