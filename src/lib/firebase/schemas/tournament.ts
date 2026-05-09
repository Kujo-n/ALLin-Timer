import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { MAX_SEATS_PER_TABLE, MIN_SEATS_PER_TABLE } from "@/lib/limits";

import { levelSchema } from "./structure";

const tournamentStateSchema = z.enum(["setup", "seating", "running", "paused", "finished"]);
export type TournamentState = z.infer<typeof tournamentStateSchema>;

const structureSnapshotSchema = z.object({
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
  seatsPerTable: z.number().int().min(MIN_SEATS_PER_TABLE).max(MAX_SEATS_PER_TABLE),
  // Phase 4.9 follow-up: 直近の level 遷移が auto-advance（タイマー満了）か manual（運営者ボタン）かの記録。
  //   - useAudioPlayer がこれを見て「manual のとき音を鳴らさない」分岐に使う
  //   - schema は additive。既存 doc は missing field（undefined）を許容（破壊的 migration 不要）
  //   - 初回 level 設定（confirmSeating で 0→1）は変更しない（"manual" 等は記録せず undefined のまま）
  //   - UI 層は `=== "manual"` 判定で undefined / null / "auto" すべて「鳴らす側」に倒す
  lastLevelChangeKind: z.enum(["auto", "manual"]).nullable().optional(),
  // Phase 1 (04-spectate-mode): 観戦モード公開フラグ。default false で旧 doc 互換。
  //   - true のとき `/spectate/[tid]` への unauthenticated read を許可する（firestore.rules）
  //   - toggle 経路は organizer 以上のみ（rule + service の二重防御。Phase 3 で実装）
  //   - ⚠ DRIFT WARNING: firestore.rules の以下の式で参照される:
  //     1. tournaments/{tid} allow read: `... || resource.data.get('spectateEnabled', false) == true`
  //     2. tournaments/{tid}/players/{pid} allow read: 親 doc の spectateEnabled を get() で参照
  //     3. tournaments/{tid}/tables/{tableId} allow read: 同上
  //     4. tournaments/{tid} allow update: `affectedKeys.hasOnly(['spectateEnabled', 'updatedAt']) + is bool` ブランチ
  //   schema を消すときは 4 経路すべてから rule を撤去すること。
  spectateEnabled: z.boolean().default(false),
  createdAt: z.instanceof(Timestamp),
  updatedAt: z.instanceof(Timestamp),
});
type TournamentBody = z.infer<typeof tournamentBodySchema>;

export type TournamentDoc = TournamentBody & { id: string };

export type CreateTournamentInput = Pick<
  TournamentBody,
  "groupId" | "createdByUid" | "name" | "structureSnapshot" | "seatsPerTable"
>;

export type UpdateTournamentInput = Partial<
  Pick<TournamentBody, "name" | "structureSnapshot" | "seatsPerTable">
>;
