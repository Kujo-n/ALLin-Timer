import { Timestamp } from "firebase/firestore";
import { z } from "zod";

export const playerBodySchema = z.object({
  displayName: z.string().min(1),
  uid: z.string().nullable(),
  entryAt: z.instanceof(Timestamp),
  isBusted: z.boolean(),
  bustedAt: z.instanceof(Timestamp).nullable(),
});
export type PlayerBody = z.infer<typeof playerBodySchema>;

/** UI が扱うプレイヤー（body + 合成した id、id は通常 auth.uid と同一）。 */
export type PlayerDoc = PlayerBody & { id: string };

export const joinInputSchema = z.object({
  tid: z.string().min(1),
  displayName: z.string().trim().min(1, "表示名を入力してください").max(40, "表示名は 40 文字以内"),
});
export type JoinInput = z.infer<typeof joinInputSchema>;
