import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { DISPLAY_NAME_MAX_LENGTH } from "./group";
import { levelSchema } from "./structure";

/**
 * `structureTemplates/{tid}` の本体スキーマ。`id` は doc id から合成するため含めない。
 *
 * Phase 4.8: サークル横断で共有されるテンプレート。`groupId` を持たないグローバル doc。
 *   - `levelSchema` / `rebuyStack` / `addOnStack` は Phase 4.7 の拡張を再利用する（schema drift 防止）。
 *   - `createdByDisplayName` は作成時の snapshot。`users/{uid}` は self-only read のため
 *     他人の displayName を lookup できず、作成者名を一覧に出すために doc 内に保持する必要がある。
 *     作成者が rename しても既存テンプレの表示名は仕様として追従しない。
 *
 * ⚠ DRIFT WARNING: `description.max(200)` / `createdByDisplayName.max(DISPLAY_NAME_MAX_LENGTH)`
 *   は [firestore.rules](../../../../firestore.rules) の `structureTemplates` create / update の
 *   `size()` 検証と同期している。片方だけ緩めないこと。
 */
export const structureTemplateBodySchema = z.object({
  name: z.string().min(1).max(60),
  description: z.string().max(200).default(""),
  initialStack: z.number().int().positive(),
  rebuyStack: z.number().int().positive().nullable().default(null),
  addOnStack: z.number().int().positive().nullable().default(null),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
  createdByUid: z.string().min(1),
  createdByDisplayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
  createdAt: z.instanceof(Timestamp),
});
type StructureTemplateBody = z.infer<typeof structureTemplateBodySchema>;
export type StructureTemplateDoc = StructureTemplateBody & { id: string };

export const createStructureTemplateInputSchema = z.object({
  name: z.string().min(1, "名前を入力してください").max(60),
  description: z.string().max(200).default(""),
  initialStack: z.number().int().positive(),
  rebuyStack: z.number().int().positive().nullable().optional(),
  addOnStack: z.number().int().positive().nullable().optional(),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
  createdByUid: z.string().min(1),
  createdByDisplayName: z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH),
});
export type CreateStructureTemplateInput = z.infer<typeof createStructureTemplateInputSchema>;

export type UpdateStructureTemplateInput = Partial<
  Omit<CreateStructureTemplateInput, "createdByUid" | "createdByDisplayName">
>;
