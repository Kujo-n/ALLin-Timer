import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { TABLE_LABEL_MAX_LENGTH } from "@/lib/limits";

/**
 * Phase 4: テーブル状態を保持するサブコレクション。
 * id は `String(tableNum)`（"1", "2", ...）。tableNum を昇順 query するため
 * orderBy は `tableNum` フィールド側で行い、doc id 文字列順には依存しない。
 *
 * Phase C: `label` / `color` を additive 追加。旧 doc は default(null) で hydrate されるため
 *   既存テーブルが破壊的に壊れることはない。`optional()` ではなく `nullable().default(null)` で
 *   合わせることで、UI 側は `label === null ? Table N : label` の単一分岐で扱える。
 */
export const tableBodySchema = z.object({
  tableNum: z.number().int().positive(),
  isBroken: z.boolean(),
  createdAt: z.instanceof(Timestamp),
  // Phase C: 卓のカスタム Table 名（例: "赤卓"）。設定なし=null。
  // 空文字は repository 側 (`updateTableLabel`) で null に正規化する。
  label: z.string().min(1).max(TABLE_LABEL_MAX_LENGTH).nullable().default(null),
  // Phase C: 卓カードの色帯（#RRGGBB hex 文字列）。設定なし=null。
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .default(null),
});
type TableBody = z.infer<typeof tableBodySchema>;
export type TableDoc = TableBody & { id: string };
