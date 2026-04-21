import { FirebaseError } from "firebase/app";
import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  GoogleAuthProvider,
  linkWithCredential,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
  type AuthCredential,
  type User,
} from "firebase/auth";

import { AppError } from "@/lib/errors";
import { firebaseAuth } from "@/lib/firebase/client";
import { deleteUserProfile, upsertUserProfile } from "@/lib/firebase/repositories/users";
import { logger } from "@/lib/logger";

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
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
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

/**
 * Google アカウントでログイン。新規ユーザーなら account 作成も一括で完了する。
 * displayName / email は Google プロフィールから自動取得され、`users/{uid}` へ反映する。
 *
 * PC / スマホ共に signInWithPopup を使用。スマホで popup がブロックされる環境
 * （iOS Safari 一部バージョン等）では `auth/popup-blocked` を返すため、UI 側で
 * ユーザーに再試行を促す。Phase 2 では redirect フローは未採用。
 *
 * 同じメールアドレスで既に password などの別方式が登録済みの場合は
 * `AccountLinkRequired` を throw する。UI はパスワード入力を求めて
 * `linkGoogleWithPassword` を呼び、Google を既存アカウントに連携する。
 */
export async function signInWithGoogle(): Promise<User> {
  const provider = new GoogleAuthProvider();
  try {
    const cred = await signInWithPopup(firebaseAuth, provider);
    // Google プロフィールの displayName / email を users/{uid} の真実源に保存。
    if (cred.user.displayName) {
      await upsertUserProfile({
        uid: cred.user.uid,
        displayName: cred.user.displayName,
        email: cred.user.email ?? null,
      });
    }
    logger.info("google sign-in ok", { uid: cred.user.uid });
    return cred.user;
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
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
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
  const trimmed = newName.trim();
  if (!trimmed) {
    throw new AppError("表示名を入力してください", "validation/display-name-required");
  }
  try {
    await updateProfile(user, { displayName: trimmed });
    await upsertUserProfile({
      uid: user.uid,
      displayName: trimmed,
      email: user.email ?? null,
    });
    logger.info("display name updated", { uid: user.uid });
  } catch (e) {
    const wrapped = wrapAuthError(e, "auth/update-profile-failed", "表示名の更新に失敗しました");
    logger.warn(wrapped.message, { code: wrapped.code });
    throw wrapped;
  }
}

/**
 * ログアウト。匿名ユーザーの場合は users/{uid} と auth 自体を best-effort で削除し、
 * ゴミアカウントの蓄積を防ぐ。削除失敗時は通常の signOut にフォールバックする。
 * （匿名アカウントは recent-login 猶予内なので通常は user.delete() が成功する。）
 */
export async function logout(): Promise<void> {
  const user = firebaseAuth.currentUser;
  if (user?.isAnonymous) {
    try {
      await deleteUserProfile(user.uid);
      await user.delete();
      logger.info("anonymous logout (self-delete) ok", { uid: user.uid });
      return;
    } catch (e) {
      const wrapped = AppError.from(
        e,
        "auth/anon-delete-failed",
        "匿名アカウントの削除に失敗しました",
      );
      logger.warn(wrapped.message, { code: wrapped.code });
      // fallthrough: 通常の signOut を試みる（データ残留は許容）
    }
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
