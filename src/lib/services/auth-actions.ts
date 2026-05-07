import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  fetchSignInMethodsForEmail,
  getAdditionalUserInfo,
  GoogleAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type AuthCredential,
  type User,
} from "firebase/auth";

import { AppError, getErrorCode } from "@/lib/errors";
import { firebaseAuth } from "@/lib/firebase/client";
import {
  deleteUserProfile,
  getUserProfile,
  upsertUserProfile,
} from "@/lib/firebase/repositories/users";
import { DISPLAY_NAME_MAX_LENGTH } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";
import { propagateDisplayNameToGroups } from "@/lib/services/group";

/**
 * 表示名（Auth displayName / users.displayName / groups.memberDisplayNames[uid]）の
 * 共通バリデータ。trim 済み文字列を返す。
 *
 * Phase 4.7: 空文字拒否 + 上限 DISPLAY_NAME_MAX_LENGTH で統一（スマホ 1 行制約）。
 */
function validateDisplayName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
  if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) {
    throw new AppError(
      `表示名は ${DISPLAY_NAME_MAX_LENGTH} 文字以内で入力してください`,
      "validation/display-name-too-long",
    );
  }
  return trimmed;
}

function normalizeAuthCode(code: string): string {
  switch (code) {
    case "auth/email-already-in-use":
      return "auth/already-exists";
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "auth/invalid-credentials";
    case "auth/user-not-found":
      return "auth/user-not-found";
    case "auth/weak-password":
      return "auth/weak-password";
    case "auth/too-many-requests":
      return "auth/too-many-requests";
    case "auth/invalid-email":
      return "auth/invalid-email";
    case "auth/popup-closed-by-user":
      return "auth/popup-closed";
    case "auth/popup-blocked":
      return "auth/popup-blocked";
    case "auth/cancelled-popup-request":
      return "auth/popup-cancelled";
    case "auth/account-exists-with-different-credential":
      return "auth/account-exists-different-credential";
    case "auth/operation-not-allowed":
      return "auth/provider-disabled";
    default:
      return code;
  }
}

function wrapAuthError(e: unknown, fallbackCode: string, fallbackMessage: string): AppError {
  if (e instanceof FirebaseError) {
    const code = normalizeAuthCode(e.code);
    return new AppError(fallbackMessage, code, e);
  }
  return AppError.from(e, fallbackCode, fallbackMessage);
}

export async function loginWithEmail(email: string, password: string): Promise<User> {
  try {
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    logger.info("login ok", { uid: cred.user.uid });
    return cred.user;
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/login-failed", "ログインに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function registerWithEmail(
  email: string,
  password: string,
  displayName: string,
): Promise<User> {
  const trimmed = validateDisplayName(displayName);
  try {
    const cred = await createUserWithEmailAndPassword(firebaseAuth, email, password);
    // 端末跨ぎで共有するため Firebase Auth プロフィールに displayName を書き込む
    await updateProfile(cred.user, { displayName: trimmed });
    // 正規の真実源として users/{uid} にもプロフィールを保存
    await upsertUserProfile({
      uid: cred.user.uid,
      displayName: trimmed,
      email: cred.user.email ?? null,
    });
    logger.info("register ok", { uid: cred.user.uid });
    return cred.user;
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/register-failed", "新規登録に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * 既存の email+password アカウントと、Google 認証情報の衝突を解消するための
 * 特殊エラー。UI 側でパスワードを要求し `linkGoogleWithPassword` を呼ぶことで解決する。
 */
export class AccountLinkRequired extends AppError {
  constructor(
    message: string,
    public readonly email: string,
    public readonly pendingCredential: AuthCredential,
    public readonly methods: readonly string[],
  ) {
    super(message, "auth/need-link-google");
  }
}

/** Phase 4.7: signInWithGoogle の戻り値。`isNewUser` は新規アカウント判定（DisplayNameDialog 発火用）。 */
interface GoogleSignInResult {
  user: User;
  isNewUser: boolean;
  /**
   * Phase 5.1: DisplayName Dialog を強制表示すべきかの最終判定。
   *   isNewUser ∨ users/{uid} 不存在 ∨ profile.displayName 空 ∨ auth.displayName 空
   * のいずれか 1 つでも該当すれば true。`isNewUser` だけでは「Auth に存在するが
   * `users/{uid}` が無い再ログイン」のケースを取り逃すため新設。
   */
  needsDisplayNameSetup: boolean;
}

/**
 * Google アカウントでログイン。新規ユーザーなら account 作成も一括で完了する。
 * displayName / email は Google プロフィールから自動取得されるが、
 * **Phase 4.7 から既存ユーザーの `users/{uid}` 上書きはしない**
 * （サークル用ニックネーム設定を保護するため）。
 * 新規ユーザー判定は `additionalUserInfo.isNewUser` で行い、UI 側で displayName 設定
 * ダイアログを出させるために戻り値に含める。
 *
 * PC / スマホ共に signInWithPopup を使用。スマホで popup がブロックされる環境
 * （iOS Safari 一部バージョン等）では `auth/popup-blocked` を返すため、UI 側で
 * ユーザーに再試行を促す。Phase 2 では redirect フローは未採用。
 *
 * 同じメールアドレスで既に password などの別方式が登録済みの場合は
 * `AccountLinkRequired` を throw する。UI はパスワード入力を求めて
 * `linkGoogleWithPassword` を呼び、Google を既存アカウントに連携する。
 */
export async function signInWithGoogle(): Promise<GoogleSignInResult> {
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(firebaseAuth, provider);
    const additional = getAdditionalUserInfo(cred);
    const isNewUser = additional?.isNewUser ?? false;
    // Phase 4.7:
    //   - 新規ユーザー: `users/{uid}` は DisplayNameDialog → updateDisplayName が作成する。
    //   - 既存ユーザー: サークル用 displayName を保護するため Google プロフィールで上書きしない。
    // いずれの場合も本関数では users/{uid} に書き込まない。
    //
    // Phase 5.1: DisplayName Dialog の強制表示判定。
    //   `isNewUser=false` でも `users/{uid}` が無い／空のケース（既存 Auth ユーザーが
    //   別端末から初回ログインなど）を捕まえる。getUserProfile は best-effort で
    //   失敗しても needsDisplayNameSetup を true に倒す（fail-safe）。
    let profileDisplayName: string | null = null;
    try {
      const profile = await getUserProfile(cred.user.uid);
      profileDisplayName = profile?.displayName ?? null;
    } catch (e) {
      const wrapped = AppError.from(e, "firestore/read_failed", "users/{uid} 取得失敗");
      logger.warn(wrapped.message, { code: wrapped.code, uid: cred.user.uid });
    }
    const needsDisplayNameSetup =
      isNewUser ||
      !profileDisplayName ||
      !profileDisplayName.trim() ||
      !cred.user.displayName ||
      !cred.user.displayName.trim();
    logger.info("google sign-in ok", {
      uid: cred.user.uid,
      isNewUser,
      needsDisplayNameSetup,
    });
    return { user: cred.user, isNewUser, needsDisplayNameSetup };
  } catch (e) {
    if (e instanceof FirebaseError && e.code === "auth/account-exists-with-different-credential") {
      const pending = GoogleAuthProvider.credentialFromError(e);
      const customData = e.customData as { email?: string } | undefined;
      const email = customData?.email;
      if (pending && email) {
        let methods: string[] = [];
        try {
          methods = await fetchSignInMethodsForEmail(firebaseAuth, email);
        } catch (fetchErr) {
          logger.warn("fetchSignInMethodsForEmail failed", {
            code: "auth/fetch-methods-failed",
            message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
          });
        }
        throw new AccountLinkRequired(
          `${email} は既にパスワードで登録されています。既存のパスワードでログインすると Google アカウントと連携されます。`,
          email,
          pending,
          methods,
        );
      }
    }
    const wrapped = wrapAuthError(e, "auth/google-failed", "Google ログインに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * 新規登録モードでの Google サインアップ。
 * 表示名を upfront で必須入力させ、新規ユーザー（または `users/{uid}` 不在の Auth-only
 * legacy ユーザー）なら入力された名前で `users/{uid}` を初期化する。既存ユーザーが
 * 検出されたときは Phase 4.7 規約に従い `users/{uid}` を上書きせず、`mode:
 * "already-existing"` を返して UI 側で notice 表示等に使ってもらう。
 *
 * `joinViaGoogle`（`receipt.ts`）は引き続き `signInWithGoogle` を直接使う前提のため
 * 互換性を維持する別経路として追加。
 */
interface SignUpWithGoogleResult {
  user: User;
  /**
   * - "created": 入力された displayName を `users/{uid}` に保存した
   *              （新規ユーザー or `users/{uid}` 不在 / displayName 空の legacy ユーザー）
   * - "already-existing": 既存ユーザーで `users/{uid}` に有効な displayName があったため
   *                       上書きを skip した
   */
  mode: "created" | "already-existing";
}
export async function signUpWithGoogle(
  displayName: string,
): Promise<SignUpWithGoogleResult> {
  const trimmed = validateDisplayName(displayName);
  const result = await signInWithGoogle();
  if (result.needsDisplayNameSetup) {
    // updateDisplayName は内部で Auth.updateProfile + users/{uid} upsert + group propagate を担う
    await updateDisplayName(trimmed);
    logger.info("signUpWithGoogle ok created", { uid: result.user.uid });
    return { user: result.user, mode: "created" };
  }
  logger.info("signUpWithGoogle ok existing", { uid: result.user.uid });
  return { user: result.user, mode: "already-existing" };
}

/**
 * ログインモードでの Google サインイン。
 * `isNewUser === true` を検出した場合は **未登録ユーザーとして弾き**、
 * Auth ユーザーを `user.delete()` で破棄してから `auth/not-registered-yet`
 * を throw する。`isNewUser === false` の既存ユーザーは通常通り通過させる
 * （`needsDisplayNameSetup === true` の legacy 救済は呼出側で DisplayNameDialog
 * に倒す = `signInWithGoogle` の戻り値をそのまま返す）。
 *
 * 設計理由: Auth ユーザーをそのまま残すと再ログインしても同じ判定になり詰む。
 * `signInWithPopup` 直後の freshly-authenticated 状態で `user.delete()` を
 * 呼べるため `auth/requires-recent-login` には原則ならない。
 * 失敗時は signOut にフォールバックして best-effort で片付ける。
 */
export async function loginWithGoogle(): Promise<GoogleSignInResult> {
  const result = await signInWithGoogle();
  if (result.isNewUser) {
    try {
      await result.user.delete();
      logger.info("loginWithGoogle rolled back new user", { uid: result.user.uid });
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "auth/rollback-failed",
        "サインインの取り消しに失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code, uid: result.user.uid });
      try {
        await signOut(firebaseAuth);
      } catch (signOutErr) {
        logger.warn("loginWithGoogle signOut fallback failed", {
          code: getErrorCode(signOutErr),
        });
      }
    }
    throw new AppError(
      "このアカウントはまだ登録されていません。「新規登録」タブから登録してください。",
      "auth/not-registered-yet",
    );
  }
  return result;
}

/**
 * `AccountLinkRequired` 発生後の解決ヘルパー。
 * 既存のパスワードでログインし、保留中の Google 認証情報を `linkWithCredential` で
 * 同一 uid に連携する。成功後は Google でもログインできるようになる。
 */
export async function linkGoogleWithPassword(
  email: string,
  password: string,
  pendingCredential: AuthCredential,
): Promise<User> {
  try {
    const cred = await signInWithEmailAndPassword(firebaseAuth, email, password);
    await linkWithCredential(cred.user, pendingCredential);
    // linkWithCredential 後に Google 側の displayName が反映される場合があるため
    // reload してから最新の currentUser を参照する（SDK 推奨パターン）。
    if (!cred.user.displayName) {
      await cred.user.reload();
    }
    const currentUser = firebaseAuth.currentUser ?? cred.user;
    if (currentUser.displayName) {
      await upsertUserProfile({
        uid: currentUser.uid,
        displayName: currentUser.displayName,
        email: currentUser.email ?? null,
      });
    }
    logger.info("google credential linked", { uid: currentUser.uid });
    return currentUser;
  } catch (e) {
    const wrapped = wrapAuthError(
      e,
      "auth/link-google-failed",
      "Google アカウントの連携に失敗しました",
    );
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

export async function signInAsGuest(displayName: string): Promise<User> {
  const trimmed = validateDisplayName(displayName);
  try {
    const cred = await signInAnonymously(firebaseAuth);
    await updateProfile(cred.user, { displayName: trimmed });
    logger.info("guest sign-in ok", { uid: cred.user.uid });
    return cred.user;
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/guest-failed", "ゲスト参加に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * ログイン済みユーザーの displayName を更新する。
 * Firebase Auth プロフィール（端末跨ぎ同期）と `users/{uid}` の両方に書き込む。
 */
export async function updateDisplayName(newName: string): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (!user) {
    throw new AppError("ログインしてください", "auth/not-authenticated");
  }
  const trimmed = validateDisplayName(newName);
  try {
    await updateProfile(user, { displayName: trimmed });
    await upsertUserProfile({
      uid: user.uid,
      displayName: trimmed,
      email: user.email ?? null,
    });
    // Phase 4.7: 所属 group の memberDisplayNames[uid] にも反映（best-effort、失敗しても throw しない）
    const profile = await getUserProfile(user.uid).catch(() => null);
    const groupIds = profile?.groupIds ?? [];
    if (groupIds.length > 0) {
      await propagateDisplayNameToGroups(user.uid, groupIds, trimmed).catch((err) => {
        const wrapped = AppError.from(
          err,
          "group/propagate-failed",
          "表示名の group 伝播に失敗しました",
        );
        logger.warn(wrapped.message, { code: wrapped.code, uid: user.uid });
      });
    }
    logger.info("display name updated", { uid: user.uid });
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/update-profile-failed", "表示名の更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

interface AnonymousSelfDeleteResult {
  /** delete が成功したか。false は「匿名でない / delete に失敗」のいずれか。 */
  deleted: boolean;
}

/**
 * 匿名ユーザーの users/{uid} と Firebase Auth 自体を best-effort で削除する共通 helper。
 *
 * Phase 4 architect-refactor (P6-2) で `logout` / `cancelOwnEntry` / `live-client`
 * (finished 検知) の 3 か所に重複していた同形コードを集約。
 *
 * - 失敗は warn ログのみで throw しない（呼出側の主処理を妨げない）。
 * - `contextLabel` を info / warn の `context` フィールドに付与し、3 経路を運用時に区別する。
 * - 匿名アカウントは recent-login 猶予内のため通常 `user.delete()` は成功する。
 * - 戻り値の `deleted` で「実際に削除が完了したか」を呼出側に伝える。logout が
 *   self-delete 成功時に signOut を skip する判断材料になる。
 */
export async function attemptAnonymousSelfDelete(
  user: User,
  contextLabel: "logout" | "cancel" | "finish",
): Promise<AnonymousSelfDeleteResult> {
  if (!user.isAnonymous) return { deleted: false };
  try {
    await deleteUserProfile(user.uid);
    await user.delete();
    logger.info("anonymous self-delete ok", { uid: user.uid, context: contextLabel });
    return { deleted: true };
  } catch (e) {
    const wrapped = AppError.from(
      e,
      "auth/anon-delete-failed",
      "匿名アカウントの削除に失敗しました",
    );
    logger.warn(wrapped.message, {
      code: wrapped.code,
      uid: user.uid,
      context: contextLabel,
    });
    return { deleted: false };
  }
}

/**
 * `User.delete()` などで `auth/requires-recent-login` を返した直後に呼ぶ再認証ヘルパー。
 *
 * provider に応じて分岐する:
 *   - `"password"`: `password` 引数で `EmailAuthProvider.credential` を組立て
 *     `reauthenticateWithCredential` を呼ぶ
 *   - `"google.com"`: `GoogleAuthProvider` で `reauthenticateWithPopup` を呼ぶ
 *   - その他（`"anonymous"` 等）: 本ヘルパーは通常アカウント専用のため
 *     `auth/reauth-provider-unsupported` を throw
 *
 * 失敗は AppError に正規化（`wrapAuthError` を再利用、`auth/popup-closed` /
 * `auth/invalid-credentials` 等の既存正規化を共有する）。
 */
export async function reauthenticateAccount(args: {
  user: User;
  password?: string;
}): Promise<void> {
  const { user, password } = args;
  const providerId = user.providerData[0]?.providerId ?? null;
  try {
    if (providerId === "password") {
      if (!password) {
        throw new AppError(
          "パスワードを入力してください",
          "auth/reauth-password-required",
        );
      }
      if (!user.email) {
        throw new AppError(
          "メールアドレスが取得できません",
          "auth/reauth-email-missing",
        );
      }
      const cred = EmailAuthProvider.credential(user.email, password);
      await reauthenticateWithCredential(user, cred);
    } else if (providerId === "google.com") {
      const provider = new GoogleAuthProvider();
      await reauthenticateWithPopup(user, provider);
    } else {
      throw new AppError(
        "対応していない認証方式です",
        "auth/reauth-provider-unsupported",
      );
    }
    logger.info("reauthenticate ok", { uid: user.uid, providerId });
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/reauth-failed", "再認証に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code, uid: user.uid });
    throw wrapped;
  }
}

/**
 * ログアウト。匿名ユーザーの場合は users/{uid} と auth 自体を best-effort で削除し、
 * ゴミアカウントの蓄積を防ぐ。削除失敗時は通常の signOut にフォールバックする。
 */
export async function logout(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (user?.isAnonymous) {
    const result = await attemptAnonymousSelfDelete(user, "logout");
    // self-delete が成功していれば既にサインアウト済みのため signOut を skip。
    // 失敗していれば signOut にフォールバックする。
    if (result.deleted) return;
  }
  try {
    await signOut(firebaseAuth);
    logger.info("logout ok");
  } catch (e) {
    const wrapped = AppError.from(e, "auth/logout-failed", "ログアウトに失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}
