import { Timestamp } from "firebase/firestore";
import { z } from "zod";

/**
 * `templateAdmins/{uid}` の本体スキーマ。doc 存在自体が管理者権限を表すマーカー。
 *
 * Phase 4.8: グローバルなテンプレート管理者（サークル横断）。`createdAt` のみ持つ空 doc。
 *   - 最初の 1 人目は Firestore Console で手動 seed する（rule chicken-and-egg 回避）。
 *   - 以降の grant/revoke は rule 上は既存管理者からのみ可能（本 Phase では UI 未提供）。
 */
export const templateAdminBodySchema = z.object({
  createdAt: z.instanceof(Timestamp),
});
export type TemplateAdminBody = z.infer<typeof templateAdminBodySchema>;
export type TemplateAdminDoc = TemplateAdminBody & { id: string };
