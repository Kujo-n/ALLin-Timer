import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * `users/{uid}` の本体スキーマ。doc id が uid と一致する前提。
 * `groupIds` は `groups/{gid}.memberUids` の逆引きキャッシュ（join/leave で同期）。
 */
export const userProfileBodySchema = z.object({
  uid: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().nullable(),
  groupIds: z.array(z.string().min(1)).default([]),
  createdAt: z.instanceof(Timestamp),
});
type UserProfileBody = z.infer<typeof userProfileBodySchema>;

export type UserProfileDoc = UserProfileBody;

export type UpsertUserProfileInput = Pick<UserProfileBody, "uid" | "displayName" | "email">;
