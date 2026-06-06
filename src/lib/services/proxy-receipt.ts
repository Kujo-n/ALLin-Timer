import { AppError, assertNonEmptyString } from "@/lib/errors";
import { getGroup } from "@/lib/firebase/repositories/groups";
import {
  createNamedOnlyPlayer,
  upsertPlayer,
} from "@/lib/firebase/repositories/players";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { assertOrganizer, DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { assertAcceptingEntries, parseDisplayName } from "@/lib/services/entry-guards";

/**
 * Phase 1 (07-third-dryrun-improvements): 運営者（organizer / owner）による受付代理。
 *
 * 本人スマホ依存（充電切れ等で受付できない）を回避し、運営者の手元操作だけで参加者を
 * 登録する 2 経路を提供する:
 *   - `addMemberPlayerByOrganizer`: サークルメンバーを uid 紐づけ（pid==uid）で代理 create。
 *     既存 `upsertPlayer` を再利用（pid==uid create / merge 冪等）。
 *   - `addNamedOnlyPlayerByOrganizer`: メンバー外・本人不在を「名前だけ」で代理 create。
 *     `createNamedOnlyPlayer` で uid=null・合成 pid の運営者管理専用 player を作る。
 *
 * いずれも `getTournament → getGroup → assertOrganizer` で role を tournament の groupId 経由で
 * 再評価（UI から渡された gid を信頼しない。`setSpectateEnabled` と同フロー）。rule + service の
 * 二重防御で member の write を deny する。client 側 `assertOrganizer` は UX 早期失敗用で、真の
 * 防御は Firestore Rules。受付可能 state / displayName 検証は通常受付（`receipt.ts`）と共有の
 * `entry-guards.ts` を使い、両経路の semantics が drift しないようにする。
 *
 * UI（「参加者を追加」ダイアログ）は Phase 2 で本 service を消費する。
 */

/**
 * メンバー代理（uid 指定）。`upsertPlayer(tid, memberUid, { displayName })` で
 * pid==uid の create（or merge）を行う。
 *
 * `memberUid` が当該サークルのメンバーであることを service 側で検証する（rule は
 * `uid is string` + `pid==uid` のみで membership を問わないため、ここが唯一の防御）。
 * これにより「参加していない実在メンバー / サークル外 uid」に対する誤った player 作成
 * （ひいては `finishTournament` でのシーズン戦績の誤加算）を防ぐ。
 */
export async function addMemberPlayerByOrganizer({
  tid,
  organizerUid,
  memberUid,
  displayName,
}: {
  tid: string;
  organizerUid: string;
  memberUid: string;
  displayName: string;
}): Promise<void> {
  assertNonEmptyString(tid, "tid");
  assertNonEmptyString(organizerUid, "organizerUid");
  assertNonEmptyString(memberUid, "memberUid");
  const name = parseDisplayName(displayName, { maxLength: DISPLAY_NAME_MAX_LENGTH });
  const t = await getTournament(tid);
  const group = await getGroup(t.groupId);
  assertOrganizer(group, organizerUid);
  if (!group.memberUids.includes(memberUid)) {
    throw new AppError(
      "対象はサークルのメンバーではありません",
      "group/not-member",
    );
  }
  assertAcceptingEntries(t);
  await upsertPlayer(tid, memberUid, { displayName: name });
  logger.info("proxy add member ok", {
    tid,
    organizerUid,
    memberUid,
    gid: t.groupId,
  });
}

/**
 * 名前のみ代理（uid=null）。`createNamedOnlyPlayer(tid, name)` で合成 pid の
 * 運営者管理専用 player を作り、発行した pid を返す。
 */
export async function addNamedOnlyPlayerByOrganizer({
  tid,
  organizerUid,
  displayName,
}: {
  tid: string;
  organizerUid: string;
  displayName: string;
}): Promise<string> {
  assertNonEmptyString(tid, "tid");
  assertNonEmptyString(organizerUid, "organizerUid");
  const name = parseDisplayName(displayName, { maxLength: DISPLAY_NAME_MAX_LENGTH });
  const t = await getTournament(tid);
  const group = await getGroup(t.groupId);
  assertOrganizer(group, organizerUid);
  assertAcceptingEntries(t);
  const pid = await createNamedOnlyPlayer(tid, name);
  logger.info("proxy add named-only ok", {
    tid,
    organizerUid,
    pid,
    gid: t.groupId,
  });
  return pid;
}
