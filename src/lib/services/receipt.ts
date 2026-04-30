import type { User } from "firebase/auth";

import { AppError } from "@/lib/errors";
import { firebaseAuth } from "@/lib/firebase/client";
import { deletePlayer, getPlayer, upsertPlayer } from "@/lib/firebase/repositories/players";
import { getTournament } from "@/lib/firebase/repositories/tournaments";
import { getUserProfile, upsertUserProfile } from "@/lib/firebase/repositories/users";
import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { logger } from "@/lib/logger";
import {
  attemptAnonymousSelfDelete,
  loginWithEmail,
  signInAsGuest,
  signInWithGoogle,
} from "@/lib/services/auth-actions";

export type ReceiptResult = "created" | "already-joined";

function assertAcceptingEntries(t: TournamentDoc): void {
  if (t.state === "finished") {
    throw new AppError("このトーナメントは終了しています", "tournament/late-entry-closed");
  }
  // Phase 4: late entry 締切超過は client 側で警告（rules では弾かない）。
  // 締切超過後に join しても自動配席されず /live で「締切超過」表示になるため事前に防ぐ。
  if (
    (t.state === "running" || t.state === "paused") &&
    t.currentLevel > t.lateEntryDeadlineLevel
  ) {
    throw new AppError(
      `レイトエントリー締切（Lv ${t.lateEntryDeadlineLevel}）を超過しています`,
      "tournament/late-entry-closed",
    );
  }
}

function requireDisplayName(name: string | null | undefined): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
  return trimmed;
}

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
): Promise<ReceiptResult> {
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
  return existing ? "already-joined" : "created";
}

export async function joinAsExistingUser({
  tid,
  email,
  password,
}: {
  tid: string;
  email: string;
  password: string;
}): Promise<ReceiptResult> {
  const user = await loginWithEmail(email, password);
  // displayName は既存プロフィール／Firebase Auth から解決。
  // 未設定なら ensurePlayerCreated が validation/display-name-required を投げる。
  const result = await ensurePlayerCreated(tid, user);
  logger.info("join as existing user ok", { tid, uid: user.uid, result });
  return result;
}

export async function joinViaGoogle({ tid }: { tid: string }): Promise<ReceiptResult> {
  // Phase 4.7: signInWithGoogle は { user, isNewUser } を返すが、受付フローでは
  // displayName ダイアログを挟まず Google プロフィール名のまま参加できる方針のため isNewUser は無視。
  const { user } = await signInWithGoogle();
  const result = await ensurePlayerCreated(tid, user);
  logger.info("join via google ok", { tid, uid: user.uid, result });
  return result;
}

export async function joinAsGuest({
  tid,
  displayName,
}: {
  tid: string;
  displayName: string;
}): Promise<ReceiptResult> {
  const name = requireDisplayName(displayName);
  const user = await signInAsGuest(name);
  const result = await ensurePlayerCreated(tid, user, name);
  logger.info("join as guest ok", { tid, uid: user.uid, result });
  return result;
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
}): Promise<ReceiptResult> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new AppError("ログインしてください", "auth/not-authenticated");
  }
  const result = await ensurePlayerCreated(tid, user, displayName);
  logger.info("join as current user ok", { tid, uid: user.uid, result });
  return result;
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
