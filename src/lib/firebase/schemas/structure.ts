import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * ブラインド構造の 1 レベル。
 *
 * Phase 4.7:
 *   - `isBreak` フィールドを default(false) で追加（旧 doc 受容）。
 *   - break レベルでは sb/bb/ante=0 を許容するため bb の制約を positive → nonnegative に緩和。
 *     プレイレベルでの bb>0 は `.refine()` で別途担保する。
 */
export const levelSchema = z
  .object({
    level: z.number().int().positive(),
    sb: z.number().int().nonnegative(),
    bb: z.number().int().nonnegative(),
    ante: z.number().int().nonnegative(),
    durationSec: z.number().int().positive(),
    isBreak: z.boolean().default(false),
  })
  .refine((v) => v.isBreak || v.bb > 0, {
    message: "BB は正の整数（プレイレベル）",
    path: ["bb"],
  });
export type Level = z.infer<typeof levelSchema>;

/**
 * Firestore に格納されるストラクチャドキュメントの本体スキーマ（`id` を含まない）。
 * `id` は doc id から合成する。
 * Phase 2.5: 所有権を `ownerUid` から `groupId` + `createdByUid` に変更（破壊的）。
 * Phase 4.7: リバイ／アドオン用のチップ量を optional nullable で追加（旧 doc は default null で受容）。
 */
export const structureBodySchema = z.object({
  groupId: z.string().min(1),
  createdByUid: z.string().min(1),
  name: z.string().min(1),
  initialStack: z.number().int().positive(),
  rebuyStack: z.number().int().positive().nullable().default(null),
  addOnStack: z.number().int().positive().nullable().default(null),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
  createdAt: z.instanceof(Timestamp),
});
export type StructureBody = z.infer<typeof structureBodySchema>;

/** UI が扱うストラクチャ（body + 合成した id）。 */
export type StructureDoc = StructureBody & { id: string };

export const createStructureInputSchema = z.object({
  groupId: z.string().min(1),
  createdByUid: z.string().min(1),
  name: z.string().min(1, "名前を入力してください"),
  initialStack: z.number().int().positive("初期スタックは正の整数"),
  rebuyStack: z.number().int().positive().nullable().optional(),
  addOnStack: z.number().int().positive().nullable().optional(),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1, "レベルを最低 1 つ追加してください"),
});
export type CreateStructureInput = z.infer<typeof createStructureInputSchema>;

export const updateStructureInputSchema = createStructureInputSchema
  .omit({ groupId: true, createdByUid: true })
  .partial();
export type UpdateStructureInput = z.infer<typeof updateStructureInputSchema>;
