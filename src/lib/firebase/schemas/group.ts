import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import {
  DEFAULT_SEATS_PER_TABLE,
  MAX_SEATS_PER_TABLE,
  MAX_TABLES,
  MIN_SEATS_PER_TABLE,
  TABLE_LABEL_MAX_LENGTH,
} from "@/lib/limits";

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
 * Phase 4.9: サークル単位の音声通知設定。
 *   - on/off / 音源ID / 音量 を group 単位で永続化
 *   - 旧 doc は default() で受容（破壊的 migration なし）
 *   - levelUpSoundId / winnerSoundId は string で受容
 *     （Phase 4.9 は "default:blind-up" / "default:victory-chime"、
 *      Phase 4.10 で "custom:<assetId>" 形式に拡張される）
 */
export const audioSettingsSchema = z
  .object({
    enabled: z.boolean(),
    levelUpSoundId: z.string().min(1),
    winnerSoundId: z.string().min(1),
    volume: z.number().min(0).max(1),
  })
  .default({
    enabled: true,
    levelUpSoundId: "default:blind-up",
    winnerSoundId: "default:victory-chime",
    volume: 0.7,
  });
export type AudioSettings = z.infer<typeof audioSettingsSchema>;

export const DEFAULT_AUDIO_SETTINGS: AudioSettings = {
  enabled: true,
  levelUpSoundId: "default:blind-up",
  winnerSoundId: "default:victory-chime",
  volume: 0.7,
};

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
    // Phase 4.9: 音声通知設定（owner / organizer 経由で更新）。
    //   旧 doc（Phase 4.8 以前）は default() で DEFAULT_AUDIO_SETTINGS が補完される。
    audioSettings: audioSettingsSchema,
    // Phase 4.16: 終了したトーナメントの累計数。`finishTournament()` の runTransaction で
    //   `increment(1)` され、`/tournaments/new` のデフォルト名連番に使用する。tx 内で
    //   `state !== "finished"` を再 read することで、複数端末同時呼び出しでも +1 のみ進める。
    //   旧 doc（Phase 4.15 以前）は default(0) で受容され、次回終了時に 1 になる。
    finishedTournamentCount: z.number().int().nonnegative().default(0),
    // Phase 4.17: トーナメント新規作成時の `seatsPerTable` 初期値。サークル詳細画面の inline edit
    //   から organizer 以上が更新する。値域は src/lib/firebase/schemas/tournament.ts の
    //   `seatsPerTable.min(2).max(10)` と完全一致させる（DRIFT WARNING: tournaments の
    //   seatsPerTable / players seatNum 上限 10 と連動。同時に変更）。
    //   旧 doc（Phase 4.16 以前）は default(9) で受容され、未明示なら 9 として hydrate される
    //   （Phase A で 8 に変更済み）。
    defaultSeatsPerTable: z
      .number()
      .int()
      .min(MIN_SEATS_PER_TABLE)
      .max(MAX_SEATS_PER_TABLE)
      .default(DEFAULT_SEATS_PER_TABLE),
    // Phase A: 現在シーズンの開始時刻。`startNewSeason()` の runTransaction で
    //   `seasonStartDate = serverTimestamp()` 経由で更新される。
    //   旧 doc（Phase 4.17 以前）はフィールド不在のため default(null) で hydrate され、
    //   初回シーズン開始まで null。UI は null のとき「未設定」表示する。
    seasonStartDate: z.instanceof(Timestamp).nullable().default(null),
    // Phase C: トーナメント新規作成時に各卓 (`tables/{n}.label`) へ index 順に
    //   自動コピーされるサークル単位の Table 名デフォルト一覧。
    //   - 最大 MAX_TABLES (= 6) 件 / 各要素 1〜TABLE_LABEL_MAX_LENGTH (= 10) 文字
    //   - 旧 doc（Phase A 以前）はフィールド不在のため default([]) で hydrate される
    //   - rule 側は `defaultTableLabels.size() <= 6` のみ強制し、各要素の値域は
    //     service / schema 層で検証する（Cloud Firestore Rules 言語仕様で list element の
    //     string 長を表現できないため）
    defaultTableLabels: z
      .array(z.string().min(1).max(TABLE_LABEL_MAX_LENGTH))
      .max(MAX_TABLES)
      .default([]),
    // Phase C improvement (02-02): `defaultTableLabels` と index 1:1 で対応する卓色デフォルト。
    //   - `defaultTableColors[i]` が null なら i 番目の卓は色未設定（labels[i] のみ反映）
    //   - 配列長は `defaultTableLabels.length` と一致させる service-side invariant
    //     （短ければ null パディング、長ければ rule で size <= 6 で deny）
    //   - 旧 doc（02-02 改修前）はフィールド不在のため default([]) で hydrate される。
    //     orchestrator / UI は `colors[i] ?? null` で参照するため安全
    //   - 各要素は `#RRGGBB` の hex 文字列または null。空文字は service 層で null に正規化
    defaultTableColors: z
      .array(
        z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .nullable(),
      )
      .max(MAX_TABLES)
      .default([]),
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

export type CreateGroupInput = {
  name: string;
  ownerUid: string;
};

export type MemberRole = "owner" | "organizer" | "member";

/** group doc と uid から 3 階層ロールを導出する。 */
export function deriveRole(group: GroupBody, uid: string): MemberRole | null {
  if (!group.memberUids.includes(uid)) return null;
  if (group.ownerUids.includes(uid)) return "owner";
  if (group.organizerUids.includes(uid)) return "organizer";
  return "member";
}

/**
 * `MemberRole | null` から「organizer 以上（owner も含む）か」を判定する pure helper。
 *
 * Phase 4.6 で 3 階層ロールを導入した際、UI 各所で
 *   `role === "owner" || role === "organizer"`
 * を `isOrganizer` 変数名でインライン展開してきたが、Phase 5.x で 4 callsite に増えた
 * drift を集約するために導入。命名は「変数名 isOrganizer 上で実は owner も含む」という
 * 暗黙仕様を関数名に表出させる目的。
 */
export function isOrganizerRole(role: MemberRole | null | undefined): boolean {
  return role === "owner" || role === "organizer";
}

/** `MemberRole | null` から「owner か」を判定する pure helper。`isOrganizerRole` と対。 */
export function isOwnerRole(role: MemberRole | null | undefined): boolean {
  return role === "owner";
}

/**
 * group において uid が「唯一のオーナー」かを判定する pure helper。
 * `ownerUids.length === 1 && ownerUids[0] === uid` を簡潔に表現する。
 *
 * アカウント自己削除（`deleteAccount`）の sole-owner block 判定に使用。
 * `ownerUids.length >= 1` は zod schema が保証するため `[0]` アクセスは安全だが、
 * 防御的に length チェックを先に置く。
 */
export function isSoleOwner(group: GroupBody, uid: string): boolean {
  return group.ownerUids.length === 1 && group.ownerUids[0] === uid;
}
