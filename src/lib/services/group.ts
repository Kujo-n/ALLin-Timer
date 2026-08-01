import {
  arrayUnion,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  Timestamp,
} from "firebase/firestore";

import { AppError, assertNonEmptyString, getErrorCode } from "@/lib/errors";
import {
  MAX_SEATS_PER_TABLE,
  MAX_TABLES,
  MIN_SEATS_PER_TABLE,
  SEASON_POINTS_BASE_MAX_LENGTH,
  TABLE_LABEL_MAX_LENGTH,
} from "@/lib/limits";
import { firebaseAuth, firestore } from "@/lib/firebase/client";
import {
  createGroup,
  deleteGroup,
  getGroup,
  groupDocRef,
  removeMemberSelf,
  removeOtherMember,
  setMemberDisplayName,
  updateDefaultSeatsPerTable,
  updateDefaultTableSettings,
  updateFinishedTournamentCount,
  updateGroupName,
  updateGroupRoles,
  updateLatestJoinCodeId,
  updateSeasonCardBackground,
  updateSeasonPointsRule,
  updateWinnerCardBackground,
} from "@/lib/firebase/repositories/groups";
import type { SeasonPointsRule } from "@/lib/services/season-points";
import {
  seasonHistoryDocRef,
} from "@/lib/firebase/repositories/seasonHistory";
import {
  seasonStatsRef,
} from "@/lib/firebase/repositories/seasonStats";
import { listTournamentsByGroup } from "@/lib/firebase/repositories/tournaments";
import { wrapFirestoreWrite } from "@/lib/firebase/wrap";
import {
  createJoinCode,
  defaultExpiresAt,
  deleteJoinCode,
  getJoinCode,
  isJoinCodeUsable,
  joinCodeDocRef,
} from "@/lib/firebase/repositories/groupJoinCodes";
import {
  addGroupIdToUser,
  getUserProfile,
  removeGroupIdFromUser,
} from "@/lib/firebase/repositories/users";
import {
  assertOrganizer,
  assertOwner,
  type CardBackground,
  DISPLAY_NAME_MAX_LENGTH,
} from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { isInProgress, isSeating } from "@/lib/services/tournament-state";

/**
 * group を作成し、作成者の users/{uid}.groupIds に逆引きを追加する。
 * 失敗時は AppError を伝播させる（部分成功はそのまま：reverse 修復は本 Phase 範囲外）。
 *
 * Phase 4.7: `memberDisplayNames` にオーナーの表示名 snapshot を初期登録する。
 *   - currentUser.displayName（trim 後）を採用し、取れなければ uid にフォールバック。
 *   - **email にはフォールバックしない**（group メンバー全員に read される場所のため、
 *     生 email が PII として意図せず露出するのを避ける）。
 */
export async function createGroupWithOwner({
  name,
  ownerUid,
}: {
  name: string;
  ownerUid: string;
}): Promise<string> {
  const authUser = firebaseAuth.currentUser;
  const ownerDisplayName = authUser?.displayName?.trim() || ownerUid;
  const gid = await createGroup({ name, ownerUid, ownerDisplayName });
  await addGroupIdToUser(ownerUid, gid);
  logger.info("create group with owner ok", { gid, ownerUid });
  return gid;
}

/**
 * 招待コードを使って group に加入する（一般メンバーとして）。
 *
 * 1. `getJoinCode` で期限・最大使用回数チェック（クライアント側の早期失敗）
 * 2. 既メンバーなら no-op で gid を返す（冪等性）
 * 3. transaction で「招待コード usesCount +1」と「group memberUids に自分を追加 + joinCodeId を code で記録」を atomic に
 *    - organizerUids / ownerUids には追加しない（rule で self-add は memberUids 限定）
 *    - joinCodeId は rule の consumption proof（存在・gid 一致・期限・usesCount +1 / maxUses を rule 側で再検証する）
 * 4. transaction 外で users/{uid}.groupIds に gid を追加（rule で本人のみ更新可）
 */
export async function consumeJoinCode({
  code,
  uid,
}: {
  code: string;
  uid: string;
}): Promise<{ gid: string; alreadyMember: boolean }> {
  const codeDoc = await getJoinCode(code);
  if (!codeDoc) {
    logger.warn("consume join code: not found", { code });
    throw new AppError("無効な招待コードです", "group/invalid-code");
  }
  if (!isJoinCodeUsable(codeDoc)) {
    logger.warn("consume join code: not usable", {
      code,
      expiresAt: codeDoc.expiresAt.toMillis(),
      usesCount: codeDoc.usesCount,
      maxUses: codeDoc.maxUses,
    });
    throw new AppError(
      "招待コードが期限切れまたは使用回数上限に到達しています",
      "group/invalid-code",
    );
  }
  // 既メンバー判定は users/{uid}.groupIds（自分自身の doc、常に read 可）で行う。
  // groups/{gid} の read は memberUids に含まれるユーザーにしか許されないため、
  // 加入前のユーザーで getGroup を呼ぶと firestore/permission-denied になる。
  const profile = await getUserProfile(uid);
  if (profile?.groupIds?.includes(codeDoc.gid)) {
    logger.info("consume join code: already member", { code, uid, gid: codeDoc.gid });
    return { gid: codeDoc.gid, alreadyMember: true };
  }

  // Phase 4.7: 自分の表示名を group.memberDisplayNames に同時登録する。
  //   email をフォールバックにすると PII がメンバー全員に露出するため、
  //   auth.displayName → users/{uid}.displayName → uid の順で解決する。
  const authUser = firebaseAuth.currentUser;
  const selfDisplayName =
    authUser?.displayName?.trim() || profile?.displayName?.trim() || uid;

  try {
    await runTransaction(firestore, async (tx) => {
      const codeRef = joinCodeDocRef(code);
      const groupRef = groupDocRef(codeDoc.gid);
      const codeSnap = await tx.get(codeRef);
      if (!codeSnap.exists()) {
        throw new AppError("無効な招待コードです", "group/invalid-code");
      }
      const fresh = { id: codeSnap.id, ...codeSnap.data() };
      if (!isJoinCodeUsable(fresh)) {
        throw new AppError(
          "招待コードが期限切れまたは使用回数上限に到達しています",
          "group/invalid-code",
        );
      }
      tx.update(codeRef, { usesCount: increment(1) });
      tx.update(groupRef, {
        memberUids: arrayUnion(uid),
        joinCodeId: code,
        [`memberDisplayNames.${uid}`]: selfDisplayName,
      });
    });
  } catch (e) {
    const wrapped = AppError.from(e, "group/join-failed", "サークル加入に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, joinCode: code, uid });
    throw wrapped;
  }

  await addGroupIdToUser(uid, codeDoc.gid);
  logger.info("consume join code ok", { code, uid, gid: codeDoc.gid });
  return { gid: codeDoc.gid, alreadyMember: false };
}

/**
 * Phase 4.7: 自分の displayName を所属全 group の `memberDisplayNames[uid]` に反映する。
 * best-effort — 個別 group の書込失敗は warn で記録し、呼出元全体は throw させない。
 * `updateDisplayName` service 内から呼ばれる想定。
 *
 * 失敗した gid / error code は個別に warn ログへ出す（M1 類似の rule 不整合を
 * 発見しやすくするため）。サマリ（total / failed）もあわせて残す。
 */
export async function propagateDisplayNameToGroups(
  uid: string,
  groupIds: readonly string[],
  displayName: string,
): Promise<void> {
  const trimmed = displayName.trim();
  if (!trimmed || groupIds.length === 0) return;
  const results = await Promise.allSettled(
    groupIds.map((gid) => setMemberDisplayName(gid, uid, trimmed)),
  );
  let failed = 0;
  results.forEach((r, i) => {
    if (r.status !== "rejected") return;
    failed += 1;
    const gid = groupIds[i];
    logger.warn("propagate displayName per-group fail", {
      code: "group/propagate-per-group-fail",
      gid,
      uid,
      reasonCode: getErrorCode(r.reason),
    });
  });
  if (failed > 0) {
    logger.warn("propagate displayName partial fail", {
      code: "group/propagate-partial-fail",
      uid,
      total: groupIds.length,
      failed,
    });
  }
}


/**
 * group から脱退する。最後のオーナーは脱退不可（先に別メンバーをオーナーに昇格 or group 削除）。
 * owner が残るケース（`ownerUids.length >= 2`）では owner 自身も脱退可能。
 */
export async function leaveGroup({ gid, uid }: { gid: string; uid: string }): Promise<void> {
  const group = await getGroup(gid);
  if (group.ownerUids.includes(uid) && group.ownerUids.length <= 1) {
    throw new AppError(
      "最後のオーナーは脱退できません。先に別のメンバーをオーナーに昇格するか group を削除してください。",
      "group/last-owner-cannot-leave",
    );
  }
  if (!group.memberUids.includes(uid)) {
    logger.info("leave group: already not a member", { gid, uid });
    await removeGroupIdFromUser(uid, gid).catch(() => {});
    return;
  }
  // owner が残る前提の脱退（2 人以上 owner）は、ownerUids からも自分を外す必要がある。
  // rule は self-leave で「自分が ownerUids に含まれない」状態を要求するため、
  // owner 自身の脱退は事前に demoteOwner を済ませる必要がある。
  if (group.ownerUids.includes(uid)) {
    await updateGroupRoles(gid, {
      ownerUids: group.ownerUids.filter((u) => u !== uid),
    });
  }
  await removeMemberSelf(gid, uid);
  await removeGroupIdFromUser(uid, gid);
  logger.info("leave group ok", { gid, uid });
}

/**
 * 招待コードを発行する。default 7 日有効、`maxUses` は null（無制限）。
 * Phase 4.6: rule 側で isOrganizer チェック。一般メンバーは発行不可。
 *
 * dryrun-feedback-batch-1 (Phase C.1): 再発行時の旧コードゴミ蓄積を防ぐため 4 ステップ化:
 *   1. group を read（assertOrganizer + prev コード ID 把握）
 *   2. 新コードを create（rule で isOrganizer enforced）
 *   3. groups doc の latestJoinCodeId を新コードに update
 *   4. 旧コードを best-effort delete（失敗しても新コード発行は成功扱い）
 * 失敗時の握りつぶしは旧コードの delete のみで、3 までは順次 throw する（pointer ずれ防止）。
 */
export async function generateJoinCode({
  gid,
  createdByUid,
  expiresInDays = 7,
  maxUses = null,
}: {
  gid: string;
  createdByUid: string;
  expiresInDays?: number;
  maxUses?: number | null;
}): Promise<string> {
  if (!Number.isInteger(expiresInDays) || expiresInDays <= 0) {
    throw new AppError("expiresInDays must be a positive integer", "validation/invalid-input");
  }
  const expiresAt = Timestamp.fromDate(new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000));
  // default の場合は 7 日：呼び出し側からの override が無ければ defaultExpiresAt と一致
  void defaultExpiresAt;

  // 1. group を read（assertOrganizer + prev コード ID 把握）
  const group = await getGroup(gid);
  assertOrganizer(group, createdByUid);
  const prev = group.latestJoinCodeId ?? null;

  // 2. 新コード create
  const code = await createJoinCode({ gid, createdByUid, expiresAt, maxUses });

  // 3. groups doc の pointer を新コードに更新
  await updateLatestJoinCodeId(gid, code);

  // 4. 旧コードを best-effort delete（`prev !== code` ガードは pointer === createJoinCode 戻り値の
  //    edge を防ぐ防御。129bit ランダム空間で偶然一致は事実上発生しない）。
  //    delete 失敗 (rule deny / network) 時は warn のみで握りつぶし、新コード発行は成功扱いとする。
  //    残った旧コードは `expiresAt` までは有効だが、scripts/cleanup-orphan-firestore.ts step 5
  //    (`expiresAt < now`) で expired 検知後に削除される。**ステップ 3 (updateLatestJoinCodeId) 失敗
  //    時に発生する「orphan な新コード」も同様で、expiresAt 経由 (default 7 日) で最終整理される**。
  if (prev && prev !== code) {
    try {
      await deleteJoinCode(prev);
    } catch (e) {
      logger.warn("previous join code delete failed", {
        errorCode: getErrorCode(e),
        gid,
        prev,
      });
    }
  }
  return code;
}

/**
 * group を削除する。owner のみ実行可（rule 側で担保）。
 * 配下の structures / tournaments のカスケード削除は Phase 2.5 では行わない。
 */
export async function deleteGroupByOwner({
  gid,
  uid,
}: {
  gid: string;
  uid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, uid);
  await deleteGroup(gid);
  // 全メンバーの users/{uid}.groupIds は本人以外更新できないため、本人分のみ落とす。
  await removeGroupIdFromUser(uid, gid).catch(() => {});
  logger.info("delete group ok", { gid, uid });
}

/** group 名変更（owner 限定）。rule 側で担保。 */
export async function renameGroup({
  gid,
  uid,
  name,
}: {
  gid: string;
  uid: string;
  name: string;
}): Promise<void> {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError("名前を入力してください", "validation/invalid-input");
  }
  const group = await getGroup(gid);
  assertOwner(group, uid);
  await updateGroupName(gid, trimmed);
}

/**
 * Phase 4.16: 開催数（finishedTournamentCount）を手動補正する。owner / organizer 限定。
 *   サークル詳細画面の inline edit から呼ばれる想定。
 *   rule 側でも organizer-only branch で再 enforce する。
 */
export async function setFinishedTournamentCount({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (!Number.isInteger(value) || value < 0) {
    throw new AppError(
      "開催数は 0 以上の整数で指定してください",
      "validation/finished-count-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateFinishedTournamentCount(gid, value);
  logger.info("setFinishedTournamentCount ok", { gid, uid, value });
}

/**
 * Phase 4.17: デフォルト席数（defaultSeatsPerTable）を手動補正する。owner / organizer 限定。
 *   サークル詳細画面の inline edit から呼ばれる。
 *   rule 側でも organizer-only branch で再 enforce する。
 */
export async function setDefaultSeatsPerTable({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: number;
}): Promise<void> {
  if (
    !Number.isInteger(value) ||
    value < MIN_SEATS_PER_TABLE ||
    value > MAX_SEATS_PER_TABLE
  ) {
    throw new AppError(
      `デフォルト席数は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
      "validation/default-seats-invalid",
    );
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultSeatsPerTable(gid, value);
  logger.info("setDefaultSeatsPerTable ok", { gid, uid, value });
}

/**
 * Phase C / 02-02: Table 名デフォルト（`defaultTableLabels`）と Table 色デフォルト
 * （`defaultTableColors`）を atomic に更新する。owner / organizer 限定。
 * サークル詳細画面の inline edit から呼ばれる想定。
 *
 * - labels: 各要素は trim 後 1〜TABLE_LABEL_MAX_LENGTH (= 10) 文字
 * - colors: labels と同じ要素数の `(string | null)[]`。各要素は `#RRGGBB` または null
 * - 配列長は最大 MAX_TABLES (= 6) 件
 * - 重複検査は行わない（同名運用を許容、運用判断）
 * - rule 側でも organizer-only branch + `affectedKeys.hasOnly(['defaultTableLabels', 'defaultTableColors'])`
 *   + `is list` + `size() <= 6` で再 enforce する。各要素の string 長 / hex 形式は rule 言語仕様で
 *   表現困難なため、本関数 + `updateDefaultTableSettings` の二重防御が最終ライン。
 */
export async function setDefaultTableSettings({
  gid,
  uid,
  labels,
  colors,
}: {
  gid: string;
  uid: string;
  labels: string[];
  colors: (string | null)[];
}): Promise<void> {
  if (!Array.isArray(labels)) {
    throw new AppError(
      "Table 名デフォルトは配列で指定してください",
      "validation/default-table-labels-invalid",
    );
  }
  if (labels.length > MAX_TABLES) {
    throw new AppError(
      `Table 名デフォルトは最大 ${MAX_TABLES} 件までです`,
      "validation/default-table-labels-invalid",
    );
  }
  if (!Array.isArray(colors) || colors.length !== labels.length) {
    throw new AppError(
      "Table 色デフォルトは Table 名デフォルトと同じ要素数で指定してください",
      "validation/default-table-colors-invalid",
    );
  }
  const normalizedLabels: string[] = [];
  for (const label of labels) {
    if (typeof label !== "string") {
      throw new AppError(
        "Table 名デフォルトは文字列の配列で指定してください",
        "validation/default-table-labels-invalid",
      );
    }
    const trimmed = label.trim();
    if (trimmed.length < 1 || trimmed.length > TABLE_LABEL_MAX_LENGTH) {
      throw new AppError(
        `Table 名は 1 文字以上 ${TABLE_LABEL_MAX_LENGTH} 文字以下で指定してください`,
        "validation/default-table-labels-invalid",
      );
    }
    normalizedLabels.push(trimmed);
  }
  const normalizedColors: (string | null)[] = colors.map((c) => {
    if (c === null || c === undefined) return null;
    if (typeof c !== "string") {
      throw new AppError(
        "Table 色は文字列または null で指定してください",
        "validation/default-table-colors-invalid",
      );
    }
    const trimmed = c.trim();
    if (trimmed.length === 0) return null;
    if (!/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      throw new AppError(
        "Table 色は #RRGGBB 形式で指定してください",
        "validation/default-table-colors-invalid",
      );
    }
    return trimmed;
  });
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateDefaultTableSettings(gid, {
    labels: normalizedLabels,
    colors: normalizedColors,
  });
  logger.info("setDefaultTableSettings ok", {
    gid,
    uid,
    count: normalizedLabels.length,
    colored: normalizedColors.filter((c) => c !== null).length,
  });
}

/**
 * Phase E: シーズンポイント計算ルール（`groups/{gid}.seasonPointsRule`）を設定する。
 * owner / organizer 限定。サークル詳細画面の SeasonPointsRuleCard inline edit から呼ばれる。
 *
 *  - `value=null` で渡すと `seasonPointsRule = null` 保存（既定値リセット経路）
 *  - 非 null のとき:
 *    - `base` 配列長 1〜SEASON_POINTS_BASE_MAX_LENGTH (= 9)
 *    - `base[i]` は 0 以上の有限数値（`Math.round(v * 100) / 100` で 2 桁に正規化。
 *      UI から `8.659999...` のような誤差が混入したときの defensive な丸め。
 *      calcSeasonPoints の出力丸めと同方針）
 *    - `baseline` は整数 MIN_SEATS_PER_TABLE..MAX_SEATS_PER_TABLE (= 2..10)
 *  - rule 側でも organizer-only branch + `affectedKeys.hasOnly(['seasonPointsRule'])` +
 *    `is map | null` で再 enforce する。値域・配列長は本関数 + `updateSeasonPointsRule` の
 *    二重防御が最終ライン。
 */
export async function setSeasonPointsRule({
  gid,
  uid,
  value,
}: {
  gid: string;
  uid: string;
  value: SeasonPointsRule | null;
}): Promise<void> {
  let normalized: SeasonPointsRule | null = null;
  if (value !== null) {
    if (
      !Array.isArray(value.base) ||
      value.base.length < 1 ||
      value.base.length > SEASON_POINTS_BASE_MAX_LENGTH
    ) {
      throw new AppError(
        `base 配列は 1 件以上 ${SEASON_POINTS_BASE_MAX_LENGTH} 件以下で指定してください`,
        "validation/season-points-rule-invalid",
      );
    }
    const safeBase: number[] = value.base.map((v) => {
      if (typeof v !== "number" || !Number.isFinite(v) || v < 0) {
        throw new AppError(
          "base 配列の各要素は 0 以上の数値で指定してください",
          "validation/season-points-rule-invalid",
        );
      }
      return Math.round(v * 100) / 100;
    });
    if (
      !Number.isInteger(value.baseline) ||
      value.baseline < MIN_SEATS_PER_TABLE ||
      value.baseline > MAX_SEATS_PER_TABLE
    ) {
      throw new AppError(
        `baseline は ${MIN_SEATS_PER_TABLE} 以上 ${MAX_SEATS_PER_TABLE} 以下の整数で指定してください`,
        "validation/season-points-rule-invalid",
      );
    }
    normalized = { base: safeBase, baseline: value.baseline };
  }
  const group = await getGroup(gid);
  assertOrganizer(group, uid);
  await updateSeasonPointsRule(gid, normalized);
  logger.info("setSeasonPointsRule ok", {
    gid,
    uid,
    reset: normalized === null,
    baseLen: normalized?.base.length,
    baseline: normalized?.baseline,
  });
}

/**
 * Phase A.1 (05-post-launch-polish Track A):
 * 結果カード背景画像メタデータを設定・解除する owner-only service の internal helper。
 *
 * Phase A architect-refactor (T3): kind を駆動軸にして winner/season で対称な
 * assertOwner + repository 呼出 + logger.info を集約する。
 *
 * - `value=null` で解除（imageUrl / storageAssetId / textTheme を null 化）
 * - `value=object` で設定。imageUrl と storageAssetId は同時に string が必須
 *   （application-side invariant、repository の `validateCardBackground` で enforce）
 * - 実際の Storage upload / 旧 asset delete は Phase A.2 の UI 側で行い、
 *   本 service は Firestore pointer 更新のみ責務とする
 */
type CardBackgroundKind = "winner" | "season";

const CARD_BG_KIND_LOG_LABEL: Record<CardBackgroundKind, string> = {
  winner: "setWinnerCardBackground ok",
  season: "setSeasonCardBackground ok",
};

async function setCardBackground({
  kind,
  gid,
  uid,
  value,
}: {
  kind: CardBackgroundKind;
  gid: string;
  uid: string;
  value: CardBackground;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, uid);
  const updater =
    kind === "winner"
      ? updateWinnerCardBackground
      : updateSeasonCardBackground;
  await updater(gid, value);
  logger.info(CARD_BG_KIND_LOG_LABEL[kind], {
    gid,
    uid,
    cleared: value === null,
  });
}

/** Phase A.1: 優勝者カード背景画像メタデータの owner-only 設定・解除。詳細は internal helper 参照。 */
export function setWinnerCardBackground(args: {
  gid: string;
  uid: string;
  value: CardBackground;
}): Promise<void> {
  return setCardBackground({ kind: "winner", ...args });
}

/** Phase A.1: シーズン戦績カード背景画像メタデータの owner-only 設定・解除。winner と同型。 */
export function setSeasonCardBackground(args: {
  gid: string;
  uid: string;
  value: CardBackground;
}): Promise<void> {
  return setCardBackground({ kind: "season", ...args });
}

/**
 * Phase A: 現在シーズンを終了し、新シーズンを開始する。owner / organizer 限定。
 *
 * 動作:
 *   1. **進行中 tournament の有無を pre-check**（seating / running / paused）。
 *      存在すれば `season/in-progress-tournament` で early throw し、
 *      `finishTournament` との race window を最小化する（pre-read 後・tx commit 前に
 *      finishTournament が新規 stats を作ると新シーズンに leak するため、運営者に
 *      先に終了させる UX を要求する）。
 *   2. 現在の `seasonStats` 全件を tx 起動前に事前 read（snapshot 用 entries 構築）
 *   3. tx 内で:
 *      a. `seasonHistory/{newSeasonId}` に snapshot を append
 *         （startedAt: 旧 `seasonStartDate`、endedAt: serverTimestamp、entries: 旧 stats）
 *      b. 旧 `seasonStats/{uid}` 全件を delete
 *      c. `groups/{gid}.seasonStartDate` を serverTimestamp で更新
 *   `newSeasonId` は `crypto.randomUUID()`（Web 標準・Node 18+）。
 *
 * 注:
 *   - 旧シーズン参加者 0 件でも `entries: []` で append（操作の事実を記録）
 *   - 旧 `seasonStartDate` が null（初回開始）でも `startedAt: null` で記録
 *   - displayName は seasonHistoryEntry rule / schema に合わせ 15 字に切り詰める
 *     （player schema 側の旧 doc が 15 字超を保持していても history 側で deny されないように）
 *   - pre-check 後・tx commit 前の race（`finishTournament` 並走）は完全には塞げない。
 *     完全 race-free は Cloud Functions 化で対応（PRD 02 future）。
 */
export async function startNewSeason({
  gid,
  uid,
}: {
  gid: string;
  uid: string;
}): Promise<{ seasonId: string }> {
  const group = await getGroup(gid);
  assertOrganizer(group, uid);

  // M-2 防御: 進行中（seating / running / paused）の tournament がある間はシーズン切替を拒否。
  // finishTournament が tx commit する前に startNewSeason の pre-read が走ると、
  // 当該 tournament の seasonStats が新シーズンに leak するため、運営者に
  // 「先に終了処理を済ませてからシーズン切替する」UX を強制する。
  const tournaments = await listTournamentsByGroup(gid);
  const blocking = tournaments.find((t) => isInProgress(t) || isSeating(t));
  if (blocking) {
    throw new AppError(
      `進行中のトーナメント「${blocking.name}」があります。先に終了してください。`,
      "season/in-progress-tournament",
    );
  }

  const seasonId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `season-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  // 事前 read: 旧 seasonStats 全件（tx 内では query 不可）
  const statsSnap = await getDocs(seasonStatsRef(gid));
  const entries = statsSnap.docs.map((d) => {
    const data = d.data();
    return {
      uid: data.uid,
      // 旧 stats が 15 字超の displayName を持っていても history rule で deny されないよう
      // 防御的に slice する（schema 側は max 15 を強制するが、tx.set でも rule 整合を保つ）。
      displayName: data.displayName.slice(0, DISPLAY_NAME_MAX_LENGTH),
      participations: data.participations,
      wins: data.wins,
      finalTables: data.finalTables,
      totalPoints: data.totalPoints,
    };
  });

  await wrapFirestoreWrite(
    "season/start-failed",
    "シーズン開始に失敗しました",
    async () => {
      await runTransaction(firestore, async (tx) => {
        // (A) seasonHistory/{seasonId} を append（startedAt: 旧 seasonStartDate）
        tx.set(seasonHistoryDocRef(gid, seasonId), {
          startedAt: group.seasonStartDate ?? null,
          endedAt: serverTimestamp(),
          entries,
        });
        // (B) 旧 seasonStats を全件 delete
        for (const d of statsSnap.docs) {
          tx.delete(d.ref);
        }
        // (C) groups/{gid}.seasonStartDate を更新
        tx.update(groupDocRef(gid), {
          seasonStartDate: serverTimestamp(),
        });
      });
    },
    { gid, uid, seasonId, count: entries.length },
  );
  logger.info("startNewSeason ok", {
    gid,
    uid,
    seasonId,
    count: entries.length,
  });
  return { seasonId };
}

/**
 * 一般メンバー → 運営（organizer）に昇格。owner のみ実行可。
 * target が member に居る必要あり。既に organizer なら no-op（冪等）。
 */
export async function promoteToOrganizer({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.memberUids.includes(targetUid)) {
    throw new AppError("対象はメンバーではありません", "group/not-member");
  }
  if (group.organizerUids.includes(targetUid)) {
    return;
  }
  await updateGroupRoles(gid, {
    organizerUids: [...group.organizerUids, targetUid],
  });
  logger.info("promote to organizer", { gid, actorUid, targetUid });
}

/**
 * 運営 → 一般メンバーに降格。owner のみ実行可。
 * 対象が owner のままだと invariant 違反になるため、先に demoteOwner が必要。
 */
export async function demoteToMember({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (group.ownerUids.includes(targetUid)) {
    throw new AppError(
      "オーナーは運営降格できません。先にオーナー降格してください",
      "group/target-is-owner",
    );
  }
  if (!group.organizerUids.includes(targetUid)) {
    return;
  }
  await updateGroupRoles(gid, {
    organizerUids: group.organizerUids.filter((u) => u !== targetUid),
  });
  logger.info("demote to member", { gid, actorUid, targetUid });
}

/**
 * 運営 → オーナーに昇格。owner のみ実行可。
 * 対象は既に organizer であること（一般メンバーからの直接昇格は禁止）。
 */
export async function promoteToOwner({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.organizerUids.includes(targetUid)) {
    throw new AppError(
      "運営でないメンバーはオーナー昇格できません",
      "group/target-not-organizer",
    );
  }
  if (group.ownerUids.includes(targetUid)) {
    return;
  }
  await updateGroupRoles(gid, {
    ownerUids: [...group.ownerUids, targetUid],
  });
  logger.info("promote to owner", { gid, actorUid, targetUid });
}

/**
 * オーナー → 運営に降格。owner のみ実行可。
 * 最後のオーナーは降格不可（rule + service の二重防御）。
 */
export async function demoteOwner({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.ownerUids.includes(targetUid)) {
    return;
  }
  if (group.ownerUids.length <= 1) {
    throw new AppError("最後のオーナーは降格できません", "group/last-owner");
  }
  await updateGroupRoles(gid, {
    ownerUids: group.ownerUids.filter((u) => u !== targetUid),
  });
  logger.info("demote owner", { gid, actorUid, targetUid });
}

/**
 * Phase 4 (08-auto-group-join-on-entry): owner が他メンバーをサークルから除外する。
 *
 * PRD 08 の自動所属（トーナメント受付でメンバーになる）の副作用 —— 誤参加者・
 * 一見さんの滞留 —— に対する事後回収手段。rule 変更は不要で、owner-update 経路
 * （`memberUids` を含むフル update）にそのまま乗る。
 *
 * ガード（すべて service + UI の二重防御）:
 *   1. **自分自身は除外できない** — 脱退は `leaveGroup`（別導線）を使う。
 *      オーナーが自分を消して owner 不在になる事故を防ぐ。
 *   2. actor が owner であること（`assertOwner`）。organizer は不可。
 *   3. 対象が既にメンバーでなければ **no-op で return**（冪等。多端末での二重押し対策）。
 *   4. 対象が owner かつ owner が 1 人しかいない場合は deny。
 *      （1. により actor ≠ target なので、target が owner なら owner は 2 人以上
 *        存在するはず。到達しない防御だが `demoteOwner` と条件を揃えて明示する）
 *
 * ⚠ 除外対象の `users/{uid}.groupIds` は本人以外書き換えられないため stale が残る。
 *   対象者のアプリ側で `GroupProvider` が `failedGids` として検出し自己修復する。
 *   過去トーナメントの `players/{pid}` と `seasonStats/{uid}` は履歴として意図的に残す。
 */
export async function removeMemberByOwner({
  gid,
  actorUid,
  targetUid,
}: {
  gid: string;
  actorUid: string;
  targetUid: string;
}): Promise<void> {
  assertNonEmptyString(gid, "gid");
  assertNonEmptyString(actorUid, "actorUid");
  assertNonEmptyString(targetUid, "targetUid");
  if (actorUid === targetUid) {
    throw new AppError(
      "自分自身は除外できません。サークルを抜ける場合は「脱退」を使用してください",
      "group/cannot-remove-self",
    );
  }
  const group = await getGroup(gid);
  assertOwner(group, actorUid);
  if (!group.memberUids.includes(targetUid)) {
    logger.info("remove member: already not a member", { gid, actorUid, targetUid });
    return;
  }
  if (group.ownerUids.includes(targetUid) && group.ownerUids.length <= 1) {
    throw new AppError("最後のオーナーは除外できません", "group/last-owner");
  }
  await removeOtherMember(gid, targetUid);
  logger.info("remove member by owner ok", { gid, actorUid, targetUid });
}
