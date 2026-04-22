import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { levelSchema } from "./structure";

export const tournamentStateSchema = z.enum(["setup", "seating", "running", "paused", "finished"]);
export type TournamentState = z.infer<typeof tournamentStateSchema>;

export const structureSnapshotSchema = z.object({
  name: z.string().min(1),
  initialStack: z.number().int().positive(),
  // Phase 4.7: リバイ／アドオン用のチップ量（任意）。旧 snapshot は default null で受容。
  rebuyStack: z.number().int().positive().nullable().default(null),
  addOnStack: z.number().int().positive().nullable().default(null),
  lateEntryDeadlineLevel: z.number().int().positive(),
  levels: z.array(levelSchema).min(1),
});
export type StructureSnapshot = z.infer<typeof structureSnapshotSchema>;

/**
 * Phase 2.5: 所有権を `ownerUid` から `groupId` + `createdByUid` に変更（破壊的）。
 * 編集権限は group メンバー全員。
 */
export const tournamentBodySchema = z.object({
  groupId: z.string().min(1),
  createdByUid: z.string().min(1),
  name: z.string().min(1),
  structureSnapshot: structureSnapshotSchema,
  state: tournamentStateSchema,
  startedAt: z.instanceof(Timestamp).nullable(),
  // Phase 3: 現在 level の開始サーバ時刻。setup 中は null。
  levelStartedAt: z.instanceof(Timestamp).nullable(),
  // Phase 3: 一時停止中のみ非 null。state === "paused" と同期する不変条件。
  pausedAt: z.instanceof(Timestamp).nullable(),
  // Phase 3: 現在 level 内の累積 pause 時間（ms）。level 遷移で 0 にリセット。
  pausedAccumMs: z.number().int().nonnegative(),
  // Phase 3: 終了時のサーバ時刻。
  finishedAt: z.instanceof(Timestamp).nullable(),
  currentLevel: z.number().int().nonnegative(),
  lateEntryDeadlineLevel: z.number().int().positive(),
  // Phase 4: 1 テーブルあたりの最大席数。default 9。setup 中のみ変更可。範囲 2〜10。
  // M2 fix: input schema と body schema の制約を一致させる（DB 直書きでも 2 未満を弾く）。
  // ⚠ DRIFT WARNING (L3): 上限 10 は firestore.rules の `seatNum <= 10` と同期。変更時は同時更新すること。
  seatsPerTable: z.number().int().min(2).max(10),
  createdAt: z.instanceof(Timestamp),
  updatedAt: z.instanceof(Timestamp),
});
export type TournamentBody = z.infer<typeof tournamentBodySchema>;

export type TournamentDoc = TournamentBody & { id: string };

export const createTournamentInputSchema = z.object({
  groupId: z.string().min(1),
  createdByUid: z.string().min(1),
  name: z.string().min(1, "名前を入力してください"),
  structureSnapshot: structureSnapshotSchema,
  // Phase 4: UI で 2〜10 を指定（default 9）。
  seatsPerTable: z.number().int().min(2).max(10),
});
export type CreateTournamentInput = z.infer<typeof createTournamentInputSchema>;

export const updateTournamentInputSchema = z.object({
  name: z.string().min(1).optional(),
  structureSnapshot: structureSnapshotSchema.optional(),
  seatsPerTable: z.number().int().min(2).max(10).optional(),
});
export type UpdateTournamentInput = z.infer<typeof updateTournamentInputSchema>;
