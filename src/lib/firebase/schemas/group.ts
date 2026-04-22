import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * `groups/{gid}` の本体スキーマ。サークル単位の所有権モデル。
 *
 * Phase 4.6 以降は 3 階層ロール:
 *   - `ownerUids` ⊆ `organizerUids` ⊆ `memberUids`
 *   - `memberUids` は真実源で、`users/{uid}.groupIds` はその逆引きキャッシュ。
 */
export const groupBodySchema = z
  .object({
    name: z.string().min(1).max(60),
    ownerUids: z.array(z.string().min(1)).min(1),
    organizerUids: z.array(z.string().min(1)).min(1),
    memberUids: z.array(z.string().min(1)).min(1),
    createdAt: z.instanceof(Timestamp),
  })
  .refine(
    (v) => v.ownerUids.every((uid) => v.organizerUids.includes(uid)),
    { message: "ownerUids must be a subset of organizerUids" },
  )
  .refine(
    (v) => v.organizerUids.every((uid) => v.memberUids.includes(uid)),
    { message: "organizerUids must be a subset of memberUids" },
  );
export type GroupBody = z.infer<typeof groupBodySchema>;

/** UI が扱う group（body + 合成した id）。 */
export type GroupDoc = GroupBody & { id: string };

export const createGroupInputSchema = z.object({
  name: z.string().min(1, "名前を入力してください").max(60),
  ownerUid: z.string().min(1),
});
export type CreateGroupInput = z.infer<typeof createGroupInputSchema>;

export type MemberRole = "owner" | "organizer" | "member";

/** group doc と uid から 3 階層ロールを導出する。 */
export function deriveRole(group: GroupBody, uid: string): MemberRole | null {
  if (!group.memberUids.includes(uid)) return null;
  if (group.ownerUids.includes(uid)) return "owner";
  if (group.organizerUids.includes(uid)) return "organizer";
  return "member";
}
