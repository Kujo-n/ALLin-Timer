import type { User } from "firebase/auth";

import { AppError, getErrorCode } from "@/lib/errors";
import { listMyGroups } from "@/lib/firebase/repositories/groups";
import {
  deleteUserProfile,
  getUserProfile,
} from "@/lib/firebase/repositories/users";
import { isSoleOwner } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { leaveGroup } from "@/lib/services/group";

/**
 * sole-owner サークルが残っているために自己削除を block したことを示す専用エラー。
 *
 * UI 層は `e instanceof AccountDeleteSoleOwnerBlocked` または
 * `code === "auth/account-delete-blocked-sole-owner"` で捕捉し、
 * `soleOwnerGroups` を block dialog にそのまま表示する。
 *
 * `message` は logging / 集計用のみ（件数のみ含む）で、ユーザーへの表示には使われない。
 * UI は `soleOwnerGroups` から個別のサークル名を直接 dialog に組み立てる。
 */
export class AccountDeleteSoleOwnerBlocked extends AppError {
  constructor(
    public readonly soleOwnerGroups: ReadonlyArray<{ id: string; name: string }>,
  ) {
    super(
      `あなたが唯一のオーナーのサークルが ${soleOwnerGroups.length} 件あります`,
      "auth/account-delete-blocked-sole-owner",
    );
  }
}

export interface DeleteAccountResult {
  /** Firebase Auth `user.delete()` まで完了したか。 */
  deleted: boolean;
  /** 脱退に成功した group の gid 一覧。 */
  leftGroupIds: string[];
  /** `leaveGroup` が失敗した group の gid 一覧（best-effort なので削除は続行）。 */
  failedGroupIds: string[];
  /** `auth/requires-recent-login` のため再認証が必要であることを呼出側に伝える。 */
  needsReauth: boolean;
  /**
   * `confirmPartialFailure` callback でユーザーが「キャンセル」を選んだか。
   * true のとき `deleteUserProfile` / `user.delete()` は実行されず、auth は活きたまま。
   * `failedGroupIds` の脱退失敗は既に発生済（commit されている）ため再ログイン後に
   * `/groups/{gid}` の手動脱退や運営連絡で後始末する想定。
   */
  cancelled: boolean;
}

/**
 * 通常アカウントの自己削除フロー。匿名アカウントは本フロー対象外
 * （既存の `attemptAnonymousSelfDelete` 経路を使用）。
 *
 * フロー:
 *   (1) Pre-check: `users/{uid}.groupIds` + `listMyGroups` で sole-owner サークルを検出。
 *       1 つでもあれば `AccountDeleteSoleOwnerBlocked` を throw（UI が block dialog に分岐）。
 *   (2) 全所属サークルから `leaveGroup` で順次脱退する（`Promise.allSettled` の best-effort、
 *       per-gid 失敗は warn ログ）。
 *   (2.5) `failedGroupIds.length > 0` かつ `confirmPartialFailure` callback が指定されていれば
 *         呼び出して proceed/cancel を確認。cancel なら `cancelled: true` で early-return。
 *   (3) `deleteUserProfile(uid)` で `users/{uid}` を削除する（best-effort）。
 *   (4) `user.delete()` を試行。`auth/requires-recent-login` のときは throw せず
 *       `needsReauth: true` で resolve し、呼出側に再認証フローを誘導する。
 *
 * 過去 tournament の `players/{pid}` と `seasonStats/{uid}` は意図的に残す
 * （履歴の継続性のため。詳細は plan の `NOT Building` を参照）。
 */
export async function deleteAccount({
  user,
  confirmPartialFailure,
}: {
  user: User;
  /**
   * 一部 group の `leaveGroup` が失敗したときに呼ばれる確認 callback。
   * true を返すとアカウント削除を続行（orphan を許容）、false を返すと中止する。
   * 未指定なら従来通り常に続行。
   */
  confirmPartialFailure?: (
    failedGroups: ReadonlyArray<{ id: string; name: string }>,
  ) => Promise<boolean>;
}): Promise<DeleteAccountResult> {
  if (user.isAnonymous) {
    throw new AppError(
      "匿名アカウントは本機能の対象外です。ログアウト操作で削除されます。",
      "auth/account-delete-anon-not-supported",
    );
  }

  const profile = await getUserProfile(user.uid);
  const groupIds = profile?.groupIds ?? [];
  const { groups } = await listMyGroups(groupIds);

  const soleOwnerGroups = groups
    .filter((g) => isSoleOwner(g, user.uid))
    .map((g): { id: string; name: string } => ({ id: g.id, name: g.name }));
  if (soleOwnerGroups.length > 0) {
    throw new AccountDeleteSoleOwnerBlocked(soleOwnerGroups);
  }

  const leaveResults = await Promise.allSettled(
    groups.map((g) => leaveGroup({ gid: g.id, uid: user.uid })),
  );
  const leftGroupIds: string[] = [];
  const failedGroupIds: string[] = [];
  leaveResults.forEach((r, i) => {
    const gid = groups[i].id;
    if (r.status === "fulfilled") {
      leftGroupIds.push(gid);
    } else {
      failedGroupIds.push(gid);
      logger.warn("delete-account: per-group leave failed", {
        code: "auth/account-delete-leave-failed",
        gid,
        uid: user.uid,
        reasonCode: getErrorCode(r.reason),
      });
    }
  });

  if (failedGroupIds.length > 0 && confirmPartialFailure) {
    const failedDetails = groups
      .filter((g) => failedGroupIds.includes(g.id))
      .map((g): { id: string; name: string } => ({ id: g.id, name: g.name }));
    const proceed = await confirmPartialFailure(failedDetails);
    if (!proceed) {
      logger.info("account self-delete cancelled at partial-failure prompt", {
        uid: user.uid,
        leftCount: leftGroupIds.length,
        failedCount: failedGroupIds.length,
      });
      return {
        deleted: false,
        leftGroupIds,
        failedGroupIds,
        needsReauth: false,
        cancelled: true,
      };
    }
  }

  // users/{uid} 削除は best-effort: rule 上 self-delete は通るが、
  // tx 競合などで偶発失敗しても auth 削除に進める。
  try {
    await deleteUserProfile(user.uid);
  } catch (e) {
    logger.warn("delete-account: deleteUserProfile failed", {
      code: getErrorCode(e),
      uid: user.uid,
    });
  }

  try {
    await user.delete();
    logger.info("account self-delete ok", {
      uid: user.uid,
      leftCount: leftGroupIds.length,
      failedCount: failedGroupIds.length,
    });
    return {
      deleted: true,
      leftGroupIds,
      failedGroupIds,
      needsReauth: false,
      cancelled: false,
    };
  } catch (e) {
    const code = getErrorCode(e);
    if (code === "auth/requires-recent-login") {
      logger.info("account self-delete needs reauth", { uid: user.uid });
      return {
        deleted: false,
        leftGroupIds,
        failedGroupIds,
        needsReauth: true,
        cancelled: false,
      };
    }
    const wrapped = AppError.from(
      e,
      "auth/account-delete-failed",
      "アカウント削除に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code, uid: user.uid });
    throw wrapped;
  }
}
