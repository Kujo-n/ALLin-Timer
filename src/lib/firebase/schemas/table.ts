import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * Phase 4: テーブル状態を保持するサブコレクション。
 * id は `String(tableNum)`（"1", "2", ...）。tableNum を昇順 query するため
 * orderBy は `tableNum` フィールド側で行い、doc id 文字列順には依存しない。
 */
export const tableBodySchema = z.object({
  tableNum: z.number().int().positive(),
  isBroken: z.boolean(),
  createdAt: z.instanceof(Timestamp),
});
type TableBody = z.infer<typeof tableBodySchema>;
export type TableDoc = TableBody & { id: string };
