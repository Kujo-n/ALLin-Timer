import { Timestamp } from "firebase/firestore";
import { z } from "zod";

export const levelSchema = z.object({
  level: z.number().int().positive(),
  sb: z.number().int().nonnegative(),
  bb: z.number().int().positive(),
  ante: z.number().int().nonnegative(),
  durationSec: z.number().int().positive(),
});
export type Level = z.infer<typeof levelSchema>;

/**
 * Firestore に格納されるストラクチャドキュメントの本体スキーマ（`id` を含まない）。
 * `id` は doc id から合成する。
 * Phase 2.5: 所有権を `ownerUid` から `groupId` + `createdByUid` に変更（破壊的）。
 */
export const structureBodySchema = z.object({
  groupId: z.string().min(1),
  createdByUid: z.string().min(1),
  name: z.string().min(1),
  initialStack: z.number().int().positive(),
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
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1, "レベルを最低 1 つ追加してください"),
});
export type CreateStructureInput = z.infer<typeof createStructureInputSchema>;

export const updateStructureInputSchema = createStructureInputSchema
  .omit({ groupId: true, createdByUid: true })
  .partial();
export type UpdateStructureInput = z.infer<typeof updateStructureInputSchema>;
