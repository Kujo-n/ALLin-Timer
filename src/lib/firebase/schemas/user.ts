import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * `users/{uid}` の本体スキーマ。doc id が uid と一致する前提。
 */
export const userProfileBodySchema = z.object({
  uid: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().nullable(),
  createdAt: z.instanceof(Timestamp),
});
export type UserProfileBody = z.infer<typeof userProfileBodySchema>;

export type UserProfileDoc = UserProfileBody;

export const upsertUserProfileInputSchema = z.object({
  uid: z.string().min(1),
  displayName: z.string().min(1),
  email: z.string().email().nullable(),
});
export type UpsertUserProfileInput = z.infer<typeof upsertUserProfileInputSchema>;
