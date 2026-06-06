import { AppError, assertNonEmptyString } from "@/lib/errors";
import { getGroup } from "@/lib/firebase/repositories/groups";
import {
  createNamedOnlyPlayer,
  getPlayer,
  updatePlayerDisplayName,
  upsertPlayer,
} from "@/lib/firebase/repositories/players";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import {
  assertOrganizer,
  DISPLAY_NAME_MAX_LENGTH,
  type GroupDoc,
} from "@/lib/firebase/schemas/group";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
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
 * ゼロトラスト由来の「organizer 再認可」の単一真実源。
 *
 * 3 つの代理経路が共通で必要とする「UI から渡された gid を信頼せず、tournament 自身の
 * `groupId` 経由で group を引き直し organizer を再評価する」手順をここに集約する。
 * 再認可の起点を tournament.groupId に固定することで、経路ごとに別 gid 源へ分岐する
 * 非対称な認可の混入を防ぐ。read 順序（getTournament → getGroup）も単一化する。
 */
async function resolveOrganizerContext(
  tid: string,
  organizerUid: string,
): Promise<{ tournament: TournamentDoc; group: GroupDoc }> {
  const tournament = await getTournament(tid);
  const group = await getGroup(tournament.groupId);
  assertOrganizer(group, organizerUid);
  return { tournament, group };
}

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
  const { tournament: t, group } = await resolveOrganizerContext(tid, organizerUid);
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
  const { tournament: t } = await resolveOrganizerContext(tid, organizerUid);
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

/**
 * Phase 2: 運営者が代理受付した「名前のみ（uid=null）」player の表示名を修正する（入力ミス救済）。
 * role 再評価 + displayName 検証は他経路と共有のガードを使う。
 *
 * **対象を uid=null player に限定する**: 対象 player を read し、`uid !== null`（実在メンバー
 * 紐づけ）の場合は reject する。member の displayName は本人の self-update が真の所有者であり、
 * 運営者がこの経路で上書きするのは UI 上も非対応のため、service でも防ぐ（rule の
 * organizer-update は任意 player の displayName 変更を許すため、ここが service 側の唯一の防御）。
 *
 * `assertAcceptingEntries` は**呼ばない**。表示名修正は finished 後でも許してよい
 * （履歴上の名前訂正）。create とはガードが異なる点に注意。
 */
export async function updatePlayerDisplayNameByOrganizer({
  tid,
  organizerUid,
  pid,
  displayName,
}: {
  tid: string;
  organizerUid: string;
  pid: string;
  displayName: string;
}): Promise<void> {
  assertNonEmptyString(tid, "tid");
  assertNonEmptyString(organizerUid, "organizerUid");
  assertNonEmptyString(pid, "pid");
  const name = parseDisplayName(displayName, { maxLength: DISPLAY_NAME_MAX_LENGTH });
  const { tournament: t } = await resolveOrganizerContext(tid, organizerUid);
  const player = await getPlayer(tid, pid);
  if (!player || player.uid !== null) {
    throw new AppError(
      "名前のみの参加者ではないため表示名を変更できません",
      "validation/not-named-only-player",
    );
  }
  await updatePlayerDisplayName(tid, pid, name);
  logger.info("proxy update displayName ok", { tid, organizerUid, pid, gid: t.groupId });
}
