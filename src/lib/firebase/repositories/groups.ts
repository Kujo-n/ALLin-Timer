import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";

import { AppError, getErrorCode } from "@/lib/errors";
import { DEFAULT_SEATS_PER_TABLE } from "@/lib/limits";
import {
  assertDefaultSeats,
  assertDefaultTableSettings,
  assertFinishedCount,
  assertSeasonPointsRule,
} from "@/lib/validation/group-settings";
import { firestore } from "@/lib/firebase/client";
import { zodConverter } from "@/lib/firebase/converters";
import {
  audioSettingsSchema,
  cardBackgroundSchema,
  DEFAULT_AUDIO_SETTINGS,
  DISPLAY_NAME_MAX_LENGTH,
  groupBodySchema,
  type AudioSettings,
  type CardBackground,
  type CreateGroupInput,
  type GroupDoc,
} from "@/lib/firebase/schemas/group";
import type { SeasonPointsRule } from "@/lib/services/season-points";
import { wrapFirestoreRead, wrapFirestoreWrite } from "@/lib/firebase/wrap";
import { logger } from "@/lib/logger";

const groupsRef = collection(firestore, "groups").withConverter(
  zodConverter(groupBodySchema, "groups"),
);

export function groupDocRef(gid: string) {
  return doc(groupsRef, gid);
}

export async function createGroup(
  input: CreateGroupInput & { ownerDisplayName?: string | null },
): Promise<string> {
  const gid = await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル作成に失敗しました",
    async () => {
      const ownerDisplayName = input.ownerDisplayName?.trim();
      // Phase 4.7: memberDisplayNames にはオーナー自身の entry を初期登録する（displayName が取れれば）。
      //           空の場合は後続の updateDisplayName / propagateDisplayNameToGroups で backfill される。
      const memberDisplayNames: Record<string, string> = ownerDisplayName
        ? { [input.ownerUid]: ownerDisplayName }
        : {};
      const ref = await addDoc(groupsRef, {
        name: input.name,
        ownerUids: [input.ownerUid],
        organizerUids: [input.ownerUid],
        memberUids: [input.ownerUid],
        memberDisplayNames,
        audioSettings: DEFAULT_AUDIO_SETTINGS,
        finishedTournamentCount: 0,
        // Phase 4.17: 新規作成画面の `seatsPerTable` 初期値。schema default と一致させる。
        defaultSeatsPerTable: DEFAULT_SEATS_PER_TABLE,
        // Phase A: 初回シーズンは未開始なので null。最初の startNewSeason() で serverTimestamp が入る。
        seasonStartDate: null,
        // Phase C / 02-02: Table 名 / Table 色デフォルトは空配列で開始。
        // `setDefaultTableSettings` で運営者が atomic に登録する。
        defaultTableLabels: [],
        defaultTableColors: [],
        // Phase E: シーズンポイント計算ルールは未設定（null）で開始 → DEFAULT_SEASON_POINTS_RULE が適用される。
        // `setSeasonPointsRule` で運営者が任意にカスタマイズする。
        seasonPointsRule: null,
        // Phase A.1: 結果カード背景画像は未設定（null）で開始。
        // `setWinnerCardBackground` / `setSeasonCardBackground` で owner が任意にカスタマイズする。
        winnerCardBackground: null,
        seasonCardBackground: null,
        createdAt: serverTimestamp(),
        joinCodeId: null,
        // dryrun-feedback-batch-1: 新規作成時は最新発行コード未追跡。`generateJoinCode` で最初の発行時に
        //   `updateLatestJoinCodeId` 経由で更新される。
        latestJoinCodeId: null,
        // Phase 1 (08-auto-group-join-on-entry): 新規作成時は受付経由の加入なし。
        joinedViaTournamentId: null,
      });
      return ref.id;
    },
  );
  logger.info("group create ok", { gid });
  return gid;
}

export async function getGroup(gid: string): Promise<GroupDoc> {
  return wrapFirestoreRead(
    "firestore/read_failed",
    "サークル取得に失敗しました",
    async () => {
      const snap = await getDoc(groupDocRef(gid));
      if (!snap.exists()) {
        throw new AppError(`group not found: ${gid}`, "firestore/not-found");
      }
      return { id: snap.id, ...snap.data() };
    },
    { gid },
  );
}

/**
 * メンバーシップ probe 専用の read。**メンバーでなければ `null` を返す**。
 *
 * **契約（`wrap` helper を使わない例外関数）**:
 *   - rule に拒否された（= 呼出者が `memberUids` に含まれない）場合は
 *     **warn ログを出さず `null`** を返す。doc が存在しない場合も `null`。
 *   - それ以外の失敗（ネットワーク / schema 不整合など）は従来どおり
 *     `logger.warn` + `AppError` で throw する。
 *
 * `getGroup` は `wrapFirestoreRead` 経由のため、permission-denied のたびに warn を 1 本出す。
 * トーナメント受付経由の自動所属（08-auto-group-join-on-entry）では
 * **「非メンバー」は正常系のシグナル**であり、新規参加者 1 人につき warn が 1 本積み上がると
 * 本番ログのノイズになるため、probe 用の read だけを分離した。
 * 「失敗を返却値に倒す」例外関数の先例は `templateAdmins.isTemplateAdmin`。
 */
export async function getGroupIfMember(gid: string): Promise<GroupDoc | null> {
  try {
    const snap = await getDoc(groupDocRef(gid));
    if (!snap.exists()) return null;
    return { id: snap.id, ...snap.data() };
  } catch (e) {
    if (getErrorCode(e) === "permission-denied") {
      logger.debug("group read denied (treated as non-member)", { gid });
      return null;
    }
    const wrapped = AppError.from(e, "firestore/read_failed", "サークル取得に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, gid });
    throw wrapped;
  }
}

/**
 * `users/{uid}.groupIds` から逆引きで自分の group 一覧を取得する。
 * `where("memberUids", "array-contains", uid)` ではなく逆引きを使うことで、
 * rule の list 評価で個別 doc read を許可する形に揃える。
 *
 * 一部の gid が rule で拒否される drift 状態に備え、`Promise.allSettled` で
 * rejected を warn ログに出して呼び出し側に skip させる。
 */
export async function listMyGroups(groupIds: string[]): Promise<{
  groups: GroupDoc[];
  failedGids: string[];
}> {
  if (groupIds.length === 0) return { groups: [], failedGids: [] };
  const settled = await Promise.allSettled(groupIds.map((gid) => getGroup(gid)));
  const groups: GroupDoc[] = [];
  const failedGids: string[] = [];
  settled.forEach((r, i) => {
    const gid = groupIds[i];
    if (r.status === "fulfilled") {
      groups.push(r.value);
    } else {
      failedGids.push(gid);
      logger.warn("listMyGroups skipped gid", { gid, code: getErrorCode(r.reason) });
    }
  });
  groups.sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis());
  return { groups, failedGids };
}

export async function updateGroupName(gid: string, name: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル名の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { name });
    },
    { gid },
  );
  logger.info("group rename ok", { gid });
}

/**
 * group のロール配列（ownerUids / organizerUids / memberUids）を一括更新する。
 * 呼び出し側で整合性を保った配列を組み立ててから渡す（オーナーは organizer/member にも含める等）。
 * Rule 側で ownerUids.size() >= 1 や invariant が検証される。
 */
export async function updateGroupRoles(
  gid: string,
  patch: { ownerUids?: string[]; organizerUids?: string[]; memberUids?: string[] },
): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "ロール更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), patch);
    },
    { gid },
  );
  logger.info("group roles updated", { gid, patchKeys: Object.keys(patch) });
}

/**
 * self-leave：自分を memberUids / organizerUids / ownerUids の 3 配列から同時に外す。
 * rule 側は「自分が ownerUids に含まれない」状態での self-leave のみ許可するため、
 * owner が残る想定では本関数は呼ばない（service 側で事前に降格させる）。
 *
 * Phase 4.7: `memberDisplayNames` マップからも自分の entry を同時に削除する。
 */
export async function removeMemberSelf(gid: string, uid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル脱退に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayRemove(uid),
        organizerUids: arrayRemove(uid),
        ownerUids: arrayRemove(uid),
        [`memberDisplayNames.${uid}`]: deleteField(),
      });
    },
    { gid, uid },
  );
  logger.info("group remove member ok", { gid, uid });
}

/**
 * Phase 4 (08-auto-group-join-on-entry): owner が**他メンバー**を除外する。
 *
 * `removeMemberSelf`（自己脱退）と対になる owner-update 経路の書込。
 *   - rule 側は `groups/{gid}` の owner-update ブランチ（`isSignedIn()` +
 *     `auth.uid in resource.data.ownerUids` + `ownerUids.size() >= 1` +
 *     `createdAt` 不変）だけで成立する。**新ブランチ・新フィールドは不要**。
 *   - `ownerUids` からも外すのは invariant（ownerUids ⊆ organizerUids ⊆ memberUids）
 *     を保つため。対象が最後の owner の場合は rule の `ownerUids.size() >= 1` で
 *     deny されるが、その前に service (`removeMemberByOwner`) が弾く二重防御。
 *   - `arrayRemove` は対象が配列に含まれない場合 no-op なので、role によらず 3 本
 *     まとめて外してよい（`removeMemberSelf` と同じ考え方）。
 *   - `memberDisplayNames[targetUid]` も `deleteField()` で同時に消す。残すと
 *     除外済みの人の表示名がメンバー一覧の裏側に残留する。
 *
 * ⚠ 除外対象の `users/{uid}.groupIds` は**本人以外書き換えられない**（rule の
 *   `users/{uid}` は self-only）。stale な gid は対象者側の `GroupProvider` が
 *   `listMyGroups` の `failedGids` 経由で自己修復する（services/current-group.tsx）。
 */
export async function removeOtherMember(gid: string, targetUid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "メンバーの除外に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayRemove(targetUid),
        organizerUids: arrayRemove(targetUid),
        ownerUids: arrayRemove(targetUid),
        [`memberDisplayNames.${targetUid}`]: deleteField(),
      });
    },
    { gid, targetUid },
  );
  logger.info("group remove other member ok", { gid, targetUid });
}

/**
 * Phase 4.7: サインイン中のユーザーが自分の `memberDisplayNames[uid]` を書き込む。
 * `updateDisplayName` からの propagate と join flow の両方で利用する。
 * Rule 側は map の `auth.uid` キーのみ変更を許可（他フィールドは immutable）。
 */
export async function setMemberDisplayName(
  gid: string,
  uid: string,
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名が空です", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(
      `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "メンバー表示名の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        [`memberDisplayNames.${uid}`]: trimmed,
      });
    },
    { gid, uid },
  );
  logger.info("group member displayName set ok", { gid, uid });
}

/**
 * Phase 1 (08-auto-group-join-on-entry): トーナメント受付を消費証明とした self-add。
 *
 * 招待コード経由の `consumeJoinCode`（services/group.ts）と対になる書込経路で、
 * rule 側は `hasTournamentEntryProof(gid, joinedViaTournamentId)` を検証する。
 *
 *   - **`arrayUnion` 必須**: 加入前のユーザーは `groups/{gid}` を read できない
 *     （rule が memberUids 所属を要求）ため、既存配列を知らずに +1 できる唯一の手段。
 *     配列丸ごと上書きにすると他メンバーを消し飛ばす（かつ rule の hasAll で deny される）。
 *   - **displayName は 15 字以内必須**: rule が `size() <= 15` を強制するため、
 *     超過値を渡すと permission-denied になる。呼出側（service）で slice 済みの値を渡すこと。
 *     本関数でも防御的に再検証する（seasonStats で同じ罠を踏んだ先例）。
 *   - `runTransaction` は使わない: 招待コードと違い、同 request 内で +1 消費すべき
 *     外部 doc（`groupJoinCodes`）が存在しないため、単一 doc の updateDoc で足りる。
 */
export async function addSelfViaTournamentEntry(
  gid: string,
  uid: string,
  input: { tid: string; displayName: string },
): Promise<void> {
  const trimmed = input.displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名が空です", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(
      `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークルへの自動加入に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        memberUids: arrayUnion(uid),
        joinedViaTournamentId: input.tid,
        [`memberDisplayNames.${uid}`]: trimmed,
      });
    },
    { gid, uid, tid: input.tid },
  );
  logger.info("group self-add via tournament ok", { gid, uid, tid: input.tid });
}

/**
 * Phase 4.9: 音声通知設定を group 単位で更新する。
 *   - object 一括上書き（dot-path にしない）— Phase 4.10 で SoundId 切替時に
 *     未参照キーが残るのを避けるため
 *   - rule 側は audioSettings の field-level validation を行わない（organizer 信頼）。
 *     application 層の zod が最終ライン。
 */
export async function updateAudioSettings(
  gid: string,
  settings: AudioSettings,
): Promise<void> {
  const parsed = audioSettingsSchema.safeParse(settings);
  if (!parsed.success) {
    throw new AppError(
      "サウンド設定の値が不正です",
      "validation/audio-settings-invalid",
    );
  }
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サウンド設定の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { audioSettings: parsed.data });
    },
    { gid },
  );
  logger.info("group audio settings updated", {
    gid,
    enabled: parsed.data.enabled,
    volume: parsed.data.volume,
  });
}

/**
 * Phase 4.16: groups/{gid}.finishedTournamentCount を任意の非負整数値で上書きする（手動修正経路）。
 *   - 自動 +1 経路は finishTournament() 内の runTransaction + increment(1) で別途行う
 *     （tx 内で tournament の state を再 read し、二重 increment race を防止）。
 *   - rule は organizer 以上の場合のみ許可し、affectedKeys を 'finishedTournamentCount' のみに限定。
 *   - 値の範囲（>= 0 / int）も rule + 本関数の事前チェックで二重防御。
 */
export async function updateFinishedTournamentCount(
  gid: string,
  value: number,
): Promise<void> {
  assertFinishedCount(value);
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "開催数の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { finishedTournamentCount: value });
    },
    { gid },
  );
  logger.info("group finishedTournamentCount updated", { gid, value });
}

/**
 * dryrun-feedback-batch-1 (Phase C.1): groups/{gid}.latestJoinCodeId を `string | null` で上書きする。
 *   - `generateJoinCode` service が新規コード発行直後に呼び出すライフサイクル管理用ポインタ。
 *     `joinCodeId`（self-add rule の consumption proof）とは別フィールド。
 *   - rule は organizer 以上の場合のみ許可し、affectedKeys を 'latestJoinCodeId' のみに限定。
 *   - null は「最新コード追跡を解除」を意味する（owner はフルアクセス経由で自由に null 化可能）。
 */
export async function updateLatestJoinCodeId(
  gid: string,
  code: string | null,
): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "招待コードポインタの更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { latestJoinCodeId: code });
    },
    { gid },
  );
  logger.info("update latestJoinCodeId ok", { gid, code });
}

/**
 * Phase 4.17: groups/{gid}.defaultSeatsPerTable を 2..10 の整数値で上書きする。
 *   - サークル詳細画面 inline edit からのみ呼ばれる（organizer / owner 限定）。
 *   - rule は `affectedKeys().hasOnly(['defaultSeatsPerTable'])` + `is int` + `>= 2` + `<= 10` で
 *     他フィールド汚染を deny。
 *   - 値の範囲は本関数の事前チェックで二重防御し、UI バリデーション失敗時の Firestore 余計な
 *     write を抑止する。
 */
export async function updateDefaultSeatsPerTable(
  gid: string,
  value: number,
): Promise<void> {
  assertDefaultSeats(value);
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "デフォルト席数の更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { defaultSeatsPerTable: value });
    },
    { gid },
  );
  logger.info("group defaultSeatsPerTable updated", { gid, value });
}

/**
 * Phase C / 02-02: groups/{gid}.defaultTableLabels と defaultTableColors を atomic に上書きする。
 *   - サークル詳細画面 inline edit からのみ呼ばれる（organizer / owner 限定。assertOrganizer は service 層）。
 *   - rule は `affectedKeys().hasOnly(['defaultTableLabels', 'defaultTableColors'])` + `is list`
 *     + `size() <= 6` の組合せで他フィールド汚染と長さ違反を deny。
 *   - colors 配列の長さは labels と一致させる service-side invariant（service 層が null パディング）。
 *   - 各要素 string 長と color hex 形式の検査は本関数 + service 層で二重防御
 *     （rule 言語仕様で list element の string 制約を表現できないため、application 層が最終ライン）。
 *   - 配列丸ごと上書きで部分更新しない（`arrayUnion` / `arrayRemove` は使わない。
 *     rule の affectedKeys と整合しないため）。
 */
export async function updateDefaultTableSettings(
  gid: string,
  payload: { labels: string[]; colors: (string | null)[] },
): Promise<void> {
  const { labels, colors } = payload;
  assertDefaultTableSettings(labels, colors);
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "Table 名デフォルトの更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), {
        defaultTableLabels: labels,
        defaultTableColors: colors,
      });
    },
    { gid },
  );
  logger.info("group defaultTableSettings updated", {
    gid,
    count: labels.length,
    colored: colors.filter((c) => c !== null).length,
  });
}

/**
 * Phase E: groups/{gid}.seasonPointsRule をカスタム rule または null（既定値リセット）で上書きする。
 *   - 書込経路はサークル詳細画面の SeasonPointsRuleCard inline edit のみ（owner / organizer 限定。
 *     assertOrganizer は service 層）。
 *   - rule 側は organizer-only branch + `affectedKeys.hasOnly(['seasonPointsRule'])` +
 *     `is map | null` + `base.size() 1..9` + `baseline 2..10` で他フィールド汚染と長さ違反を deny。
 *   - 各要素の値域（base[i] >= 0 number / baseline 整数）は Cloud Firestore Rules の言語仕様で
 *     list element の値域を表現できないため、application 層 (本関数 + zod schema) が最終ライン。
 *   - `value=null` で渡すと `updateDoc({ seasonPointsRule: null })` を発火し、
 *     finishTournament tx 側は `?? DEFAULT_SEASON_POINTS_RULE` で既定値にフォールバックする。
 */
export async function updateSeasonPointsRule(
  gid: string,
  value: SeasonPointsRule | null,
): Promise<void> {
  assertSeasonPointsRule(value);
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "シーズンポイント計算ルールの更新に失敗しました",
    async () => {
      await updateDoc(groupDocRef(gid), { seasonPointsRule: value });
    },
    { gid },
  );
  logger.info("group seasonPointsRule updated", {
    gid,
    reset: value === null,
    baseLen: value?.base.length,
    baseline: value?.baseline,
  });
}

/**
 * Phase A.1 (05-post-launch-polish Track A): card background 値の application-side invariant 検証。
 *
 * Cloud Firestore Rules で表現できない「imageUrl と storageAssetId は同時に null か
 * 同時に string」をここで enforce する（Storage asset と Firestore pointer の同期保護）。
 *
 * `schema` 由来の型・値域チェック（textTheme enum / string length 1 以上）は `safeParse` に委譲し、
 * 失敗時は同じ `validation/card-background-invalid` で throw する。
 *
 * `null` セット（解除）は invariant 違反にならないため早期 return する。
 */
export function validateCardBackground(value: CardBackground): void {
  if (value === null) return;
  const parsed = cardBackgroundSchema.safeParse(value);
  if (!parsed.success || parsed.data === null) {
    // schema は nullable + default(null) のため `.data` の型は `... | null` だが、
    // 直前の早期 return で value !== null を確定済み。schema が success のとき .data は
    // object のはず — 念のため null も invariant 違反として扱い、後段の dot アクセスを
    // 型レベルで narrow する。
    throw new AppError(
      "結果カード背景画像の値が不正です",
      "validation/card-background-invalid",
    );
  }
  const bothNull =
    parsed.data.imageUrl === null && parsed.data.storageAssetId === null;
  const bothSet =
    parsed.data.imageUrl !== null && parsed.data.storageAssetId !== null;
  if (!bothNull && !bothSet) {
    throw new AppError(
      "結果カード背景画像の値が不正です",
      "validation/card-background-invalid",
    );
  }
}

/**
 * Phase A.1: card background pointer 更新の internal helper。
 *
 * field 名 (`winnerCardBackground` | `seasonCardBackground`) を駆動軸にして、winner / season で
 * 完全に対称な write 経路（validate → wrapFirestoreWrite → updateDoc → logger.info）を 1 箇所に集約する。
 * Phase A architect-refactor (T2) で `updateWinnerCardBackground` / `updateSeasonCardBackground`
 * の 23 行 × 2 を thin wrapper 化。
 *
 *   - owner-only（service 層で assertOwner、rule 側も isOwner enforce）
 *   - null 渡しで「背景解除」、object 渡しで設定
 *   - imageUrl / storageAssetId は同時に null か同時に string invariant（Storage asset と Firestore
 *     pointer の同期保護）
 *   - rule は `affectedKeys.hasOnly([field])` + 型のみを enforce。値域は本関数の
 *     `validateCardBackground` が最終ライン
 */
type CardBackgroundField = "winnerCardBackground" | "seasonCardBackground";

const CARD_BG_FAILURE_MESSAGE: Record<CardBackgroundField, string> = {
  winnerCardBackground: "結果カード背景画像の更新に失敗しました",
  seasonCardBackground: "シーズン戦績カード背景画像の更新に失敗しました",
};

async function updateCardBackgroundField(
  field: CardBackgroundField,
  gid: string,
  value: CardBackground,
): Promise<void> {
  validateCardBackground(value);
  await wrapFirestoreWrite(
    "firestore/write_failed",
    CARD_BG_FAILURE_MESSAGE[field],
    async () => {
      await updateDoc(groupDocRef(gid), { [field]: value });
    },
    { gid },
  );
  logger.info(`group ${field} updated`, {
    gid,
    cleared: value === null,
    hasImage: value?.imageUrl != null,
    textTheme: value?.textTheme,
  });
}

/** Phase A.1: groups/{gid}.winnerCardBackground を更新する。詳細は internal helper 参照。 */
export function updateWinnerCardBackground(
  gid: string,
  value: CardBackground,
): Promise<void> {
  return updateCardBackgroundField("winnerCardBackground", gid, value);
}

/** Phase A.1: groups/{gid}.seasonCardBackground を更新する。構造は winner と同型。 */
export function updateSeasonCardBackground(
  gid: string,
  value: CardBackground,
): Promise<void> {
  return updateCardBackgroundField("seasonCardBackground", gid, value);
}

export async function deleteGroup(gid: string): Promise<void> {
  await wrapFirestoreWrite(
    "firestore/write_failed",
    "サークル削除に失敗しました",
    async () => {
      await deleteDoc(groupDocRef(gid));
    },
    { gid },
  );
  logger.info("group delete ok", { gid });
}
