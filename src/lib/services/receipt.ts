import type { User } from "firebase/auth";

import { AppError, getErrorCode, unwrapOrFrom } from "@/lib/errors";
import { firebaseAuth } from "@/lib/firebase/client";
import { deletePlayer, getPlayer, upsertPlayer } from "@/lib/firebase/repositories/players";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { getUserProfile, upsertUserProfile } from "@/lib/firebase/repositories/users";
import { logger } from "@/lib/logger";
import {
  attemptAnonymousSelfDelete,
  loginWithEmail,
  registerWithEmail,
  signInAsGuest,
  signInWithGoogle,
} from "@/lib/services/auth-actions";
import { joinGroupViaTournament, type AutoJoinOutcome } from "@/lib/services/auto-group-join";
import { assertAcceptingEntries, parseDisplayName } from "@/lib/services/entry-guards";

export type ReceiptResult = "created" | "already-joined";

/**
 * 自動所属（08-auto-group-join-on-entry）の結果。
 * `failed` は best-effort の失敗 — **受付そのものは成功している**。
 */
export type AutoJoinStatus = AutoJoinOutcome | "failed";

export type AutoJoinFeedback = {
  gid: string;
  status: AutoJoinStatus;
};

/**
 * 受付の結果一式。`autoJoin` が `null` なのは匿名ゲスト経路（`joinAsGuest`）のみ。
 */
export type ReceiptOutcome = {
  result: ReceiptResult;
  autoJoin: AutoJoinFeedback | null;
};

/**
 * displayName の解決優先順位:
 *   1. 明示的 hint（フォーム入力）
 *   2. users/{uid} プロフィール（端末跨ぎの真実源）
 *   3. Firebase Auth user.displayName（register/updateProfile で設定済み）
 *   4. 解決できなければ validation/display-name-required で throw
 *
 * 既存プロフィールがある場合、email フォールバック等で上書きしない。
 */
async function resolveDisplayName(user: User, hint: string | null | undefined): Promise<string> {
  const hintTrimmed = hint?.trim();
  if (hintTrimmed) return hintTrimmed;
  const profile = await getUserProfile(user.uid);
  if (profile?.displayName?.trim()) return profile.displayName.trim();
  const authName = user.displayName?.trim();
  if (authName) return authName;
  throw new AppError(
    "表示名が設定されていません。/login で登録するか、受付フォームで入力してください。",
    "validation/display-name-required",
  );
}

async function ensurePlayerCreated(
  tid: string,
  user: User,
  displayNameHint?: string | null,
): Promise<{ result: ReceiptResult; groupId: string; displayName: string }> {
  // この時点で user は認証済み。rules が auth!=null を要求するため、
  // tournament 読取は認証の「後」に行う。
  const t = await getTournament(tid);
  assertAcceptingEntries(t);
  const displayName = await resolveDisplayName(user, displayNameHint);
  const existing = await getPlayer(tid, user.uid);
  await upsertUserProfile({
    uid: user.uid,
    displayName,
    email: user.email ?? null,
  });
  await upsertPlayer(tid, user.uid, { displayName });
  return {
    result: existing ? "already-joined" : "created",
    groupId: t.groupId,
    displayName,
  };
}

/**
 * 受付（player doc 作成）→ サークル自動所属 を **この順序で** 実行する共通経路。
 * 08-auto-group-join-on-entry Phase 2。
 *
 * - **順序厳守**: rule の `hasTournamentEntryProof` が `players/{uid}` の存在を
 *   前提にするため、逆順・並列だと必ず deny される
 * - **best-effort**: 受付は当日オペレーションのクリティカルパス。自動所属の失敗で
 *   受付を止めない。失敗は warn に落として `status: "failed"` を返し、次回の
 *   受付操作でリトライされる（`joinGroupViaTournament` は既メンバーなら no-op）
 * - **`already-joined` でも実行する**（PRD Q1(b)）— 既受付者の取りこぼし回収を兼ねる
 * - 匿名ゲストは呼出側（`joinAsGuest`）が本ヘルパーを使わないことで除外する
 *   （`joinGroupViaTournament` 側にも匿名ガードがあり二重防御）
 */
async function receiveEntry(
  tid: string,
  user: User,
  displayNameHint?: string | null,
): Promise<ReceiptOutcome> {
  const { result, groupId, displayName } = await ensurePlayerCreated(tid, user, displayNameHint);
  let autoJoin: AutoJoinFeedback;
  try {
    const joined = await joinGroupViaTournament({
      tid,
      gid: groupId,
      uid: user.uid,
      // 受付で解決した表示名をそのまま渡し、players と memberDisplayNames を揃える。
      // 15 字への切り詰めは joinGroupViaTournament 側の責務。
      displayName,
    });
    autoJoin = { gid: joined.gid, status: joined.outcome };
  } catch (e) {
    // 内側（repository の wrapFirestoreWrite）で warn 済みのため AppError では
    // 再ラップせず、握りつぶす事実だけを callsite として 1 本記録する。
    logger.warn("auto group join after receipt failed", {
      code: "group/auto-join-failed",
      tid,
      gid: groupId,
      uid: user.uid,
      errorCode: getErrorCode(e),
    });
    autoJoin = { gid: groupId, status: "failed" };
  }
  return { result, autoJoin };
}

export async function joinAsExistingUser({
  tid,
  email,
  password,
}: {
  tid: string;
  email: string;
  password: string;
}): Promise<ReceiptOutcome> {
  const user = await loginWithEmail(email, password);
  // displayName は既存プロフィール／Firebase Auth から解決。
  // 未設定なら ensurePlayerCreated が validation/display-name-required を投げる。
  const outcome = await receiveEntry(tid, user);
  logger.info("join as existing user ok", {
    tid,
    uid: user.uid,
    result: outcome.result,
    autoJoin: outcome.autoJoin?.status,
  });
  return outcome;
}

/**
 * `joinAsNewUser` で **Auth アカウントの作成には成功したが、その後の受付で失敗した**
 * ことを示すエラー。08-auto-group-join-on-entry Phase 3 レビュー M-3 対応。
 *
 * rules が tournament の read に認証を要求するため、受付可否の判定（`assertAcceptingEntries`）は
 * 原理的にアカウント作成の**後**にしか行えない。レイトエントリー締切超過やネットワーク障害で
 * ここに落ちると、Auth アカウントと `users/{uid}` だけが残った状態でユーザーに
 * エラーが返る。UI 側で「アカウントは作成済みなので、次はログインタブから」と
 * 案内できるよう、この状態だけを型で識別可能にする。
 *
 * `code` / `message` は原因エラーのものをそのまま引き継ぐ（表示文言は変えない）。
 * 原因エラーは内側で既に warn 済みのため、ここでは再ログしない。
 */
export class EntryFailedAfterRegister extends AppError {
  constructor(cause: AppError) {
    super(cause.message, cause.code, cause);
    this.name = "EntryFailedAfterRegister";
  }
}

/**
 * 受付画面から新規アカウントを作成して、そのまま受付する。
 * 08-auto-group-join-on-entry Phase 3。
 *
 * `registerWithEmail` が displayName を先に検証する（trim / 非空 / 15 字以内）ため、
 * 不正な表示名で Auth アカウントだけが作られることはない。
 * 作成した user をそのまま `receiveEntry` に渡すので、他の通常アカウント経路と同じく
 * **player 作成 → サークル自動所属** の順序と best-effort 契約が適用される。
 *
 * アカウント作成後の失敗は `EntryFailedAfterRegister` で包んで throw する
 * （アカウントが残っていることを UI が案内できるようにするため）。
 */
export async function joinAsNewUser({
  tid,
  email,
  password,
  displayName,
}: {
  tid: string;
  email: string;
  password: string;
  displayName: string;
}): Promise<ReceiptOutcome> {
  const user = await registerWithEmail(email, password, displayName);
  // 登録時に入力された名前を hint として渡し、players と memberDisplayNames を揃える。
  // ここから先の失敗は「アカウントだけ作られた」状態を意味する。
  let outcome: ReceiptOutcome;
  try {
    outcome = await receiveEntry(tid, user, displayName);
  } catch (e) {
    throw new EntryFailedAfterRegister(unwrapOrFrom(e, "receipt/unknown", "受付に失敗しました"));
  }
  logger.info("join as new user ok", {
    tid,
    uid: user.uid,
    result: outcome.result,
    autoJoin: outcome.autoJoin?.status,
  });
  return outcome;
}

export async function joinViaGoogle({ tid }: { tid: string }): Promise<ReceiptOutcome> {
  // Phase 4.7: signInWithGoogle は { user, isNewUser } を返すが、受付フローでは
  // displayName ダイアログを挟まず Google プロフィール名のまま参加できる方針のため isNewUser は無視。
  const { user } = await signInWithGoogle();
  const outcome = await receiveEntry(tid, user);
  logger.info("join via google ok", {
    tid,
    uid: user.uid,
    result: outcome.result,
    autoJoin: outcome.autoJoin?.status,
  });
  return outcome;
}

export async function joinAsGuest({
  tid,
  displayName,
}: {
  tid: string;
  displayName: string;
}): Promise<ReceiptOutcome> {
  const name = parseDisplayName(displayName);
  const user = await signInAsGuest(name);
  // 匿名ゲストはサークル自動所属の対象外（PRD の Won't / rule の isSignedInNotAnon）。
  // receiveEntry を通さないことが「二重防御」の UI 側の 1 枚目にあたる。
  const { result } = await ensurePlayerCreated(tid, user, name);
  logger.info("join as guest ok", { tid, uid: user.uid, result });
  return { result, autoJoin: null };
}

/**
 * 既に認証済みの（ログイン済み）ユーザーをそのまま受付する。
 * `/join/[tid]` で `useAuthUser` が user を持っている場合の「そのまま参加」導線で利用。
 * 運営者が setup 画面から自己参加する「自分も参加する」導線でも利用する（Phase 4.5）。
 */
export async function joinAsCurrentUser({
  tid,
  displayName,
}: {
  tid: string;
  displayName?: string;
}): Promise<ReceiptOutcome> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new AppError("ログインしてください", "auth/not-authenticated");
  }
  const outcome = await receiveEntry(tid, user, displayName);
  logger.info("join as current user ok", {
    tid,
    uid: user.uid,
    result: outcome.result,
    autoJoin: outcome.autoJoin?.status,
  });
  return outcome;
}

/**
 * 参加者本人による自己取消。
 * Firestore rules は `pid == request.auth.uid` の delete を許可する必要がある。
 *
 * Phase 4.5: 匿名ゲストの場合は player 削除後に users/{uid} と auth を best-effort で削除する。
 */
export async function cancelOwnEntry(tid: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new AppError("ログインしてください", "auth/not-authenticated");
  }
  await deletePlayer(tid, user.uid);
  logger.info("cancel own entry ok", { tid, uid: user.uid });

  // 匿名ゲストの場合は users/{uid} + auth user を best-effort で削除（共通 helper）。
  await attemptAnonymousSelfDelete(user, "cancel");
}

/**
 * 運営者によるエントリー取消。Phase 2.5 以降、rules 側では tournament の groupId に対する
 * group メンバーシップ（`isGroupMember(tournament.groupId)`）で書込権限を判定する。
 */
export async function cancelPlayerEntry(tid: string, pid: string): Promise<void> {
  await deletePlayer(tid, pid);
  logger.info("cancel player entry ok", { tid, pid });
}
