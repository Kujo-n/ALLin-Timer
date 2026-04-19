import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { levelSchema } from "./structure";

export const tournamentStateSchema = z.enum([
  "setup",
  "seating",
  "running",
  "paused",
  "finished",
]);
export type TournamentState = z.infer<typeof tournamentStateSchema>;

export const structureSnapshotSchema = z.object({
  name: z.string().min(1),
  initialStack: z.number().int().positive(),
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
  currentLevel: z.number().int().nonnegative(),
  lateEntryDeadlineLevel: z.number().int().positive(),
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
});
export type CreateTournamentInput = z.infer<typeof createTournamentInputSchema>;

export const updateTournamentInputSchema = z.object({
  name: z.string().min(1).optional(),
  structureSnapshot: structureSnapshotSchema.optional(),
});
export type UpdateTournamentInput = z.infer<typeof updateTournamentInputSchema>;
