import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * `groups/{gid}` の本体スキーマ。サークル単位の所有権モデル。
 * `memberUids` は真実源で、`users/{uid}.groupIds` はその逆引きキャッシュ。
 */
export const groupBodySchema = z.object({
  name: z.string().min(1).max(60),
  ownerUid: z.string().min(1),
  memberUids: z.array(z.string().min(1)).min(1),
  createdAt: z.instanceof(Timestamp),
});
export type GroupBody = z.infer<typeof groupBodySchema>;

/** UI が扱う group（body + 合成した id）。 */
export type GroupDoc = GroupBody & { id: string };

export const createGroupInputSchema = z.object({
  name: z.string().min(1, "名前を入力してください").max(60),
  ownerUid: z.string().min(1),
});
export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;
