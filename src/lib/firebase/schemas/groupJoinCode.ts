import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * `groupJoinCodes/{code}` の本体スキーマ。doc id が招待コード文字列と一致する前提。
 * `maxUses: null` で使用回数無制限。`expiresAt` は必須。
 */
export const groupJoinCodeBodySchema = z.object({
  gid: z.string().min(1),
  createdByUid: z.string().min(1),
  expiresAt: z.instanceof(Timestamp),
  maxUses: z.number().int().positive().nullable(),
  usesCount: z.number().int().nonnegative(),
  createdAt: z.instanceof(Timestamp),
});
type GroupJoinCodeBody = z.infer<typeof groupJoinCodeBodySchema>;

export type GroupJoinCodeDoc = GroupJoinCodeBody & { id: string };

export type CreateGroupJoinCodeInput = Pick<
  GroupJoinCodeBody,
  "gid" | "createdByUid" | "expiresAt" | "maxUses"
>;
