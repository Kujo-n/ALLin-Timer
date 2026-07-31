import { AppError, assertNonEmptyString, getErrorCode } from "@/lib/errors";
import { firebaseAuth } from "@/lib/firebase/client";
import {
  addSelfViaTournamentEntry,
  getGroupIfMember,
} from "@/lib/firebase/repositories/groups";
import {
  addGroupIdToUser,
  getUserProfile,
} from "@/lib/firebase/repositories/users";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

/**
 * Phase 1 (08-auto-group-join-on-entry): トーナメント受付を根拠としたサークル自動所属。
 *
 * `receipt.ts` の受付成功直後（player doc 作成後）に Phase 2 が呼び出す。
 * **呼出順序は「受付（player 作成）→ 本 service」を厳守**する。rule の
 * `hasTournamentEntryProof` が player doc の存在を前提にするため、逆順・並列だと必ず deny される。
 *
 * 本 service は throw する（best-effort 化は呼出側の責務）。PRD の設計方針上、
 * 受付そのものは自動所属の失敗で止めてはならないため、Phase 2 の callsite は
 * try/catch + logger.warn で握る。
 */

/**
 * - `joined`: 本呼出で `memberUids` に追加した
 * - `already-member`: 既にメンバーだった（no-op。`users/{uid}.groupIds` の補修だけ行う）
 * - `skipped-anonymous`: 匿名アカウントのため対象外（rule でも deny されるので事前に skip）
 */
export type AutoJoinOutcome = "joined" | "already-member" | "skipped-anonymous";

export type AutoJoinResult = {
  gid: string;
  outcome: AutoJoinOutcome;
};

/**
 * サークル内表示名を解決して 15 字に切り詰める。
 *
 * 解決順序は `consumeJoinCode` と同じ:
 *   hint（受付フォーム / 受付時に解決済みの名前）
 *     → Firebase Auth の displayName
 *     → users/{uid}.displayName
 *     → uid
 *
 * **email にはフォールバックしない**（`memberDisplayNames` は group メンバー全員に
 * read されるため、生 email が PII として露出する）。
 *
 * `slice(0, DISPLAY_NAME_MAX_LENGTH)` は必須 — Google の表示名は 15 字を超え得るが
 * rule は `size() <= 15` を強制するため、切り詰めないと permission-denied で
 * 自動所属が静かに失敗する（seasonStats で踏んだ罠と同型）。
 * Firebase の uid は 28 字なので、uid フォールバック時も切り詰めが効く。
 */
async function resolveMemberDisplayName(
  uid: string,
  hint: string | null | undefined,
): Promise<string> {
  const hintTrimmed = hint?.trim();
  if (hintTrimmed) return hintTrimmed.slice(0, DISPLAY_NAME_MAX_LENGTH);
  const authName = firebaseAuth.currentUser?.displayName?.trim();
  if (authName) return authName.slice(0, DISPLAY_NAME_MAX_LENGTH);
  const profile = await getUserProfile(uid);
  const profileName = profile?.displayName?.trim();
  if (profileName) return profileName.slice(0, DISPLAY_NAME_MAX_LENGTH);
  return uid.slice(0, DISPLAY_NAME_MAX_LENGTH);
}

/**
 * `groups/{gid}` の read 可否そのものをメンバーシップ判定に使う。
 *
 * rule が `memberUids` 所属を read の条件にしているため、
 *   - 読めた → メンバー確定（配列も併せて確認する）
 *   - 読めない（permission-denied）→ 非メンバー
 * が成立する。`users/{uid}.groupIds` を見る `consumeJoinCode` 方式と違い、
 * **除名後に残る stale な groupIds に引きずられない**（再受付で自己修復する）。
 *
 * read は `getGroup` ではなく `getGroupIfMember` を使う。非メンバーは本フローの
 * **正常系**であり、`getGroup`（`wrapFirestoreRead` 経由）だと受付のたびに
 * warn ログが 1 本出てしまうため。
 *
 * permission-denied 以外の失敗（ネットワーク等）でも false を返す:
 *   - 障害が一時的なら、後続の self-add が rule の `!(uid in resource.data.memberUids)` で
 *     deny された後、再 probe が成功して `already-member` に倒れる
 *   - 障害が継続していれば再 probe も false となり `group/auto-join-failed` を throw する
 *     （呼出側が best-effort で握る前提）
 */
async function probeMembership(gid: string, uid: string): Promise<boolean> {
  try {
    const group = await getGroupIfMember(gid);
    return group?.memberUids.includes(uid) ?? false;
  } catch (e) {
    logger.debug("auto-join membership probe treated as non-member", {
      gid,
      uid,
      errorCode: getErrorCode(e),
    });
    return false;
  }
}

export async function joinGroupViaTournament({
  tid,
  gid,
  uid,
  displayName,
}: {
  tid: string;
  gid: string;
  uid: string;
  displayName?: string | null;
}): Promise<AutoJoinResult> {
  assertNonEmptyString(tid, "tid");
  assertNonEmptyString(gid, "gid");
  assertNonEmptyString(uid, "uid");

  // 匿名アカウントは対象外（rule の isSignedInNotAnon() と二重防御）。
  // 端末を跨げず参加取消時に auth ごと削除される設計のため、メンバーとして永続させない。
  if (firebaseAuth.currentUser?.isAnonymous) {
    logger.info("auto-join skipped: anonymous account", { tid, gid, uid });
    return { gid, outcome: "skipped-anonymous" };
  }

  let outcome: AutoJoinOutcome = "already-member";

  if (!(await probeMembership(gid, uid))) {
    const memberDisplayName = await resolveMemberDisplayName(uid, displayName);
    try {
      await addSelfViaTournamentEntry(gid, uid, {
        tid,
        displayName: memberDisplayName,
      });
      outcome = "joined";
    } catch (e) {
      // 多端末・連打による同時 self-add では片方が rule の
      // `!(uid in resource.data.memberUids)` で deny される。再 probe して
      // 既にメンバーになっていれば成功扱いに倒す（ユーザーには成功として見せる）。
      if (await probeMembership(gid, uid)) {
        logger.info("auto-join lost the race but membership is established", {
          tid,
          gid,
          uid,
          errorCode: getErrorCode(e),
        });
        outcome = "already-member";
      } else {
        // repository の wrapFirestoreWrite が既に warn 済みのため、ここでは
        // 再ログせずドメインコードだけ被せて throw する（二重 warn 禁止）。
        throw new AppError(
          "サークルへの自動加入に失敗しました",
          "group/auto-join-failed",
          e,
        );
      }
    }
  }

  // `users/{uid}.groupIds` は逆引きキャッシュ（サイドバー / サークル一覧の描画元）。
  // **outcome によらず毎回 arrayUnion する**ことで、
  //   - 前回の自動所属で groupIds 更新だけ失敗していたケース
  //   - 除名後に stale だったケース
  // を次回受付で自己修復させる。冪等（arrayUnion）なので重複しない。
  // ここでの失敗は group メンバーシップ（真実源）の成否に影響しないため best-effort。
  try {
    await addGroupIdToUser(uid, gid);
  } catch (e) {
    logger.warn("auto-join: groupIds backfill failed", {
      code: "group/auto-join-groupids-failed",
      tid,
      gid,
      uid,
      errorCode: getErrorCode(e),
    });
  }

  logger.info("auto-join via tournament done", { tid, gid, uid, outcome });
  return { gid, outcome };
}
