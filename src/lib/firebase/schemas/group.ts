import { Timestamp } from "firebase/firestore";
import { z } from "zod";

import { AppError } from "@/lib/errors";
import {
  DEFAULT_SEATS_PER_TABLE,
  MAX_SEATS_PER_TABLE,
  MAX_TABLES,
  MIN_SEATS_PER_TABLE,
  SEASON_POINTS_BASE_MAX_LENGTH,
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
 * Phase E: シーズンポイント計算ルールのカスタマイズ schema。
 *   - `base`: 1 位から N 位までの素点。長さ 1〜SEASON_POINTS_BASE_MAX_LENGTH (= 9)、
 *     各要素は 0 以上の数値（負値は意味を持たないため reject）
 *   - `baseline`: 係数 1.0 になる参加人数（int、MIN_SEATS_PER_TABLE..MAX_SEATS_PER_TABLE = 2..10）
 *   - `null` を許容して既定値（`DEFAULT_SEASON_POINTS_RULE`）にフォールバック。
 *     旧 doc（Phase D 以前）はフィールド不在のため default(null) で hydrate される。
 *
 * 値域・配列長は本 schema に集約し、firestore.rules / repository / service / UI は
 * すべて本 schema が真実源。`firestore.rules` の `seasonPointsRule.base.size() <= 9` 等の
 * リテラルは drift script ([scripts/test-rules-limits.mjs](../../../../scripts/test-rules-limits.mjs))
 * が `SEASON_POINTS_BASE_MAX_LENGTH` 等と機械的に一致検査する。
 */
export const seasonPointsRuleSchema = z
  .object({
    base: z
      .array(z.number().nonnegative())
      .min(1)
      .max(SEASON_POINTS_BASE_MAX_LENGTH),
    baseline: z
      .number()
      .int()
      .min(MIN_SEATS_PER_TABLE)
      .max(MAX_SEATS_PER_TABLE),
  })
  .nullable()
  .default(null);

/**
 * Phase A.1 (05-post-launch-polish Track A): 結果カード背景のテキストテーマ。
 *   - "light": 明るい背景画像向け（暗色テキスト）
 *   - "dark": 暗い背景画像向け（明色テキスト）
 *
 * `as const` で抜き出した文字列リテラル配列を export し、後段の UI で
 * `<select>` option を回せるようにする。将来 "auto" 等への拡張余地を残しつつ、
 * 現時点では 2 値に固定（rule 側でも 2 値リテラルを enforce）。
 */
export const CARD_TEXT_THEMES = ["light", "dark"] as const;
export type CardTextTheme = (typeof CARD_TEXT_THEMES)[number];

export const DEFAULT_CARD_BACKGROUND_TEXT_THEME: CardTextTheme = "light";

/**
 * Phase A.1: 優勝者カード / シーズン戦績カードの背景画像メタデータ schema。
 *   - `imageUrl` / `storageAssetId` は同時に null か同時に string であることを invariant とする
 *     （Storage asset と Firestore pointer の同期保護。Cloud Firestore Rules では
 *      クロスフィールド invariant を表現できないため、application 層 (repository / service) が最終ライン）。
 *   - `textTheme` は CARD_TEXT_THEMES に列挙された値のみ。
 *   - 全体を nullable + default(null) にすることで、旧 doc（Phase 4 以前）が
 *     `winnerCardBackground` / `seasonCardBackground` フィールド不在のまま hydrate されても
 *     型を壊さない（先例: `seasonPointsRuleSchema`）。
 */
export const cardBackgroundSchema = z
  .object({
    imageUrl: z.string().min(1).nullable(),
    storageAssetId: z.string().min(1).nullable(),
    textTheme: z.enum(CARD_TEXT_THEMES),
  })
  .nullable()
  .default(null);
export type CardBackground = z.infer<typeof cardBackgroundSchema>;

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
    // dryrun-feedback-batch-1 (Phase C.1): `generateJoinCode` が「最新発行コード」へのポインタ
    //   として管理する。再発行時に旧コードを best-effort delete するためのライフサイクル管理用で、
    //   `joinCodeId`（最後に消費されたコードの rule consumption proof）とは意味が別。
    //   旧 doc（Phase E 以前）はフィールド不在のため default(null) で hydrate される。
    //   organizer が `affectedKeys.hasOnly(['latestJoinCodeId'])` で string | null を書込可。
    latestJoinCodeId: z.string().min(1).nullable().default(null),
    // Phase 1 (08-auto-group-join-on-entry): トーナメント受付経由の self-add で書き込まれる
    //   consumption proof。`joinCodeId`（招待コード経由の proof）と同じ役割で、rule 側の
    //   `hasTournamentEntryProof(gid, tid)` が「この tid が本当にこの gid のトーナメントで、
    //   受付可能 state で、かつ書込者の player doc が実在する」ことを検証する。
    //   最後に自動加入したメンバーの tid で上書きされるため**監査ログ用途には使えない**
    //   （`joinCodeId` と同じ性質）。owner はフルアクセス経由で自由に null 化してよい。
    //   旧 doc（本 Phase 以前）はフィールド不在のため default(null) で hydrate される。
    joinedViaTournamentId: z.string().min(1).nullable().default(null),
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
    // Phase E: シーズンポイント計算ルールのカスタマイズ。
    //   - null（または未設定）→ DEFAULT_SEASON_POINTS_RULE が適用される
    //   - object → 運営者がパラメータ単位でカスタマイズした rule（base / baseline）
    //   - 旧 doc（Phase D 以前）はフィールド不在のため default(null) で hydrate される
    //   - rule 側は `affectedKeys.hasOnly(['seasonPointsRule'])` + `is map | null`
    //     + `base.size() 1..9` + `baseline 2..10` を強制（各要素の値域は schema に委譲）
    seasonPointsRule: seasonPointsRuleSchema,
    // Phase A.1 (05-post-launch-polish Track A): 優勝者カード / シーズン戦績カード の
    //   背景画像 + テキストテーマ。owner のみが書換可（rule で enforce）。
    //   旧 doc（Phase E 以前）はフィールド不在のため default(null) で hydrate される。
    //   非 null 時の構造: { imageUrl: string | null, storageAssetId: string | null,
    //     textTheme: "light" | "dark" }
    //   imageUrl / storageAssetId を nullable に保つのは「テキストテーマだけ先に決めて
    //   後で画像を載せる」UX を阻害しないためだが、運用上 imageUrl != null と
    //   storageAssetId != null は同時のみ許可する invariant を repository / service で enforce する。
    winnerCardBackground: cardBackgroundSchema,
    seasonCardBackground: cardBackgroundSchema,
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

/**
 * group において uid が owner でない場合に `AppError("group/not-owner")` を throw する。
 *
 * Pure な role 判定 helper として `services/group.ts` の file-private 版を集約。
 * service / tournament 層が共通で参照できるよう `schemas/group.ts` に置く（Firebase
 * 初期化を transitively 持ち込まないため、unit test の mock 境界を壊さない）。
 */
export function assertOwner(group: GroupBody, uid: string): void {
  if (!group.ownerUids.includes(uid)) {
    throw new AppError("オーナーのみ実行できます", "group/not-owner");
  }
}

/**
 * group において uid が organizer（owner も含む）でない場合に
 * `AppError("group/not-organizer")` を throw する。`assertOwner` と対。
 */
export function assertOrganizer(group: GroupBody, uid: string): void {
  if (!group.organizerUids.includes(uid)) {
    throw new AppError("運営のみ実行できます", "group/not-organizer");
  }
}
