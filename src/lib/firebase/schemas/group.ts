import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * サークル内表示名の最大文字数。
 *
 * Phase 4.7: スマートフォンの 1 行に収まり改行されない値として 15 に設定。
 *   - Firestore Rules 側でも同じ上限を強制する（`firestore.rules` の self-add / self-update）
 *   - UI の `<Input maxLength={DISPLAY_NAME_MAX_LENGTH}>` もこの値を参照する
 *   - `auth.displayName` / `users/{uid}.displayName` / `groups/{gid}.memberDisplayNames[uid]`
 *     すべてで同一の制約にそろえる。
 */
export const DISPLAY_NAME_MAX_LENGTH = 15;

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
    // Phase 4.6.1: self-add rule が検証する「最後の加入で消費された招待コード ID」。
    // 監査用ではなく rule の consumption proof。owner が自由に null に戻してよい。
    // 既存（Phase 4.6 まで）の doc では存在しないため optional。
    joinCodeId: z.string().min(1).nullable().optional(),
    // Phase 4.7: uid → displayName のマップ snapshot（各メンバーが自分の entry を書込）。
    //   - 旧 doc（Phase 4.6 以前）は default({}) で受容、UI は UID フォールバック
    //   - rule は self-key 書込のみ許可: diff().affectedKeys().hasOnly([auth.uid])
    //   - 値は 1〜DISPLAY_NAME_MAX_LENGTH 文字に制限（スマホ 1 行表示を担保、rule 側でも強制）
    //   - propagate は `updateDisplayName` / `consumeJoinCode` / `removeMemberSelf` で実施
    memberDisplayNames: z
      .record(z.string().min(1), z.string().min(1).max(DISPLAY_NAME_MAX_LENGTH))
      .default({}),
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
