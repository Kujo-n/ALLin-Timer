import { FirebaseError } from "firebase/app";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";

const { mockAuthState } = vi.hoisted(() => ({
  mockAuthState: { currentUser: null as unknown },
}));

vi.mock("@/lib/firebase/client", () => ({
  firebaseAuth: mockAuthState,
  firestore: {},
}));

vi.mock("firebase/auth", async () => {
  const actual = await vi.importActual<typeof import("firebase/auth")>("firebase/auth");
  return {
    ...actual,
    signInWithEmailAndPassword: vi.fn(),
    createUserWithEmailAndPassword: vi.fn(),
    updateProfile: vi.fn(),
    signInAnonymously: vi.fn(),
    signInWithPopup: vi.fn(),
    fetchSignInMethodsForEmail: vi.fn(),
    linkWithCredential: vi.fn(),
    signOut: vi.fn(),
    // Phase 4.7: signInWithGoogle が isNewUser 判定に使用。default は false（既存ユーザー）。
    getAdditionalUserInfo: vi.fn().mockReturnValue({ isNewUser: false }),
    GoogleAuthProvider: Object.assign(
      vi.fn().mockImplementation(() => ({})),
      {
        credentialFromError: vi.fn(),
      },
    ),
  };
});

vi.mock("@/lib/firebase/repositories/users", () => ({
  upsertUserProfile: vi.fn(),
  deleteUserProfile: vi.fn(),
  getUserProfile: vi.fn().mockResolvedValue(null),
}));

// Phase 4.7: updateDisplayName が propagateDisplayNameToGroups を呼ぶため、
// services/group を空実装で mock してモジュール副作用（firestore.collection）を避ける。
vi.mock("@/lib/services/group", () => ({
  propagateDisplayNameToGroups: vi.fn().mockResolvedValue(undefined),
}));

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
} from "firebase/auth";

import {
  deleteUserProfile,
  getUserProfile,
  upsertUserProfile,
} from "@/lib/firebase/repositories/users";
import { propagateDisplayNameToGroups } from "@/lib/services/group";

import {
  AccountLinkRequired,
  linkGoogleWithPassword,
  loginWithEmail,
  logout,
  registerWithEmail,
  signInAsGuest,
  signInWithGoogle,
  updateDisplayName,
} from "./auth-actions";

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    uid: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    isAnonymous: false,
    reload: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(signInWithEmailAndPassword).mockReset();
  vi.mocked(createUserWithEmailAndPassword).mockReset();
  vi.mocked(updateProfile).mockReset().mockResolvedValue(undefined);
  vi.mocked(signInAnonymously).mockReset();
  vi.mocked(signInWithPopup).mockReset();
  vi.mocked(fetchSignInMethodsForEmail).mockReset().mockResolvedValue([]);
  vi.mocked(linkWithCredential).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(signOut).mockReset().mockResolvedValue(undefined);
  vi.mocked(GoogleAuthProvider.credentialFromError).mockReset();
  vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteUserProfile).mockReset().mockResolvedValue(undefined);
  vi.mocked(getUserProfile).mockReset().mockResolvedValue(null);
  vi.mocked(propagateDisplayNameToGroups).mockReset().mockResolvedValue(undefined);
  mockAuthState.currentUser = null;
  if (typeof window !== "undefined") {
    window.localStorage.clear();
  }
});

describe("loginWithEmail", () => {
  it("returns user on success", async () => {
    const user = makeUser();
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({ user } as never);

    const result = await loginWithEmail("alice@example.com", "pw");

    expect(result).toBe(user);
    expect(signInWithEmailAndPassword).toHaveBeenCalled();
  });

  it("normalizes wrong-password to auth/invalid-credentials", async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
      new FirebaseError("auth/wrong-password", "wrong"),
    );
    await expect(loginWithEmail("a", "b")).rejects.toMatchObject({
      code: "auth/invalid-credentials",
    });
  });

  it("normalizes invalid-credential to auth/invalid-credentials", async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
      new FirebaseError("auth/invalid-credential", "invalid"),
    );
    await expect(loginWithEmail("a", "b")).rejects.toMatchObject({
      code: "auth/invalid-credentials",
    });
  });

  it("wraps non-FirebaseError as fallback code", async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(new Error("boom"));
    await expect(loginWithEmail("a", "b")).rejects.toMatchObject({
      code: "auth/login-failed",
    });
  });
});

describe("registerWithEmail", () => {
  it("rejects blank displayName before calling Firebase", async () => {
    await expect(registerWithEmail("a@b.com", "pw", "  ")).rejects.toMatchObject({
      code: "validation/display-name-required",
    });
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  // Phase 4.7 (M3): 15 文字超の displayName を reject
  it("rejects displayName longer than 15 chars", async () => {
    await expect(registerWithEmail("a@b.com", "pw", "1234567890123456")).rejects.toMatchObject({
      code: "validation/display-name-too-long",
    });
    expect(createUserWithEmailAndPassword).not.toHaveBeenCalled();
  });

  it("creates user, sets profile, upserts user doc on happy path", async () => {
    const user = makeUser({ displayName: null });
    vi.mocked(createUserWithEmailAndPassword).mockResolvedValue({ user } as never);

    const result = await registerWithEmail("a@b.com", "pw", "  Alice  ");

    expect(result).toBe(user);
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: "Alice" });
    expect(upsertUserProfile).toHaveBeenCalledWith({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
    });
  });

  it("normalizes email-already-in-use to auth/already-exists", async () => {
    vi.mocked(createUserWithEmailAndPassword).mockRejectedValue(
      new FirebaseError("auth/email-already-in-use", "dup"),
    );
    await expect(registerWithEmail("a@b.com", "pw", "Alice")).rejects.toMatchObject({
      code: "auth/already-exists",
    });
  });

  it("normalizes weak-password", async () => {
    vi.mocked(createUserWithEmailAndPassword).mockRejectedValue(
      new FirebaseError("auth/weak-password", "weak"),
    );
    await expect(registerWithEmail("a@b.com", "pw", "Alice")).rejects.toMatchObject({
      code: "auth/weak-password",
    });
  });
});

describe("signInAsGuest", () => {
  it("rejects blank displayName", async () => {
    await expect(signInAsGuest("   ")).rejects.toMatchObject({
      code: "validation/display-name-required",
    });
    expect(signInAnonymously).not.toHaveBeenCalled();
  });

  it("signs in anonymously and updates profile", async () => {
    const user = makeUser({ isAnonymous: true });
    vi.mocked(signInAnonymously).mockResolvedValue({ user } as never);

    const result = await signInAsGuest("Bob");

    expect(result).toBe(user);
    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: "Bob" });
  });

  it("wraps Firebase errors with auth/guest-failed fallback", async () => {
    vi.mocked(signInAnonymously).mockRejectedValue(
      new FirebaseError("auth/operation-not-allowed", "off"),
    );
    await expect(signInAsGuest("Bob")).rejects.toMatchObject({
      code: "auth/provider-disabled",
    });
  });
});

describe("signInWithGoogle", () => {
  // Phase 4.7: 新規ユーザーは DisplayNameDialog 経由で users/{uid} を作成、
  //          既存ユーザーはサークル用 displayName を保護するため上書きしない。
  //          いずれの場合も signInWithGoogle は users/{uid} に書き込まない。
  it("returns { user, isNewUser: false } for existing user and does not upsert", async () => {
    const user = makeUser();
    vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);

    const result = await signInWithGoogle();

    expect(result).toEqual({ user, isNewUser: false });
    expect(upsertUserProfile).not.toHaveBeenCalled();
  });

  it("returns { user, isNewUser: true } for new user and does not upsert (dialog handles it)", async () => {
    const { getAdditionalUserInfo } = await import("firebase/auth");
    vi.mocked(getAdditionalUserInfo).mockReturnValueOnce({ isNewUser: true } as never);
    const user = makeUser();
    vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);

    const result = await signInWithGoogle();

    expect(result).toEqual({ user, isNewUser: true });
    expect(upsertUserProfile).not.toHaveBeenCalled();
  });

  it("skips upsert when displayName missing", async () => {
    const user = makeUser({ displayName: null });
    vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);

    await signInWithGoogle();

    expect(upsertUserProfile).not.toHaveBeenCalled();
  });

  it("throws AccountLinkRequired when account-exists-with-different-credential and credential is recoverable", async () => {
    const fbErr = new FirebaseError("auth/account-exists-with-different-credential", "conflict");
    (fbErr as unknown as { customData: { email: string } }).customData = {
      email: "alice@example.com",
    };
    vi.mocked(signInWithPopup).mockRejectedValue(fbErr);
    vi.mocked(GoogleAuthProvider.credentialFromError).mockReturnValue({
      providerId: "google.com",
    } as never);
    vi.mocked(fetchSignInMethodsForEmail).mockResolvedValue(["password"]);

    await expect(signInWithGoogle()).rejects.toBeInstanceOf(AccountLinkRequired);
  });

  it("falls through to wrapped error when credentialFromError returns null", async () => {
    const fbErr = new FirebaseError("auth/account-exists-with-different-credential", "conflict");
    vi.mocked(signInWithPopup).mockRejectedValue(fbErr);
    vi.mocked(GoogleAuthProvider.credentialFromError).mockReturnValue(null);

    await expect(signInWithGoogle()).rejects.toMatchObject({
      code: "auth/account-exists-different-credential",
    });
  });

  it("normalizes popup-closed-by-user", async () => {
    vi.mocked(signInWithPopup).mockRejectedValue(
      new FirebaseError("auth/popup-closed-by-user", "x"),
    );
    await expect(signInWithGoogle()).rejects.toMatchObject({ code: "auth/popup-closed" });
  });

  it("continues even if fetchSignInMethodsForEmail throws", async () => {
    const fbErr = new FirebaseError("auth/account-exists-with-different-credential", "conflict");
    (fbErr as unknown as { customData: { email: string } }).customData = {
      email: "alice@example.com",
    };
    vi.mocked(signInWithPopup).mockRejectedValue(fbErr);
    vi.mocked(GoogleAuthProvider.credentialFromError).mockReturnValue({
      providerId: "google.com",
    } as never);
    vi.mocked(fetchSignInMethodsForEmail).mockRejectedValue(new Error("network"));

    await expect(signInWithGoogle()).rejects.toBeInstanceOf(AccountLinkRequired);
  });
});

describe("linkGoogleWithPassword", () => {
  it("logs in then links credential and upserts profile", async () => {
    const user = makeUser();
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({ user } as never);
    mockAuthState.currentUser = user;

    const cred = { providerId: "google.com" } as never;
    const result = await linkGoogleWithPassword("alice@example.com", "pw", cred);

    expect(result).toBe(user);
    expect(linkWithCredential).toHaveBeenCalledWith(user, cred);
    expect(upsertUserProfile).toHaveBeenCalled();
  });

  it("reloads when displayName missing post-link", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    const user = makeUser({ displayName: null, reload });
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({ user } as never);
    mockAuthState.currentUser = user;

    await linkGoogleWithPassword("a@b.com", "pw", {} as never);

    expect(reload).toHaveBeenCalled();
  });

  it("wraps errors with auth/link-google-failed fallback for non-Firebase errors", async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(new Error("boom"));
    await expect(linkGoogleWithPassword("a@b.com", "pw", {} as never)).rejects.toMatchObject({
      code: "auth/link-google-failed",
    });
  });
});

describe("updateDisplayName", () => {
  it("rejects when not authenticated", async () => {
    mockAuthState.currentUser = null;
    await expect(updateDisplayName("Alice")).rejects.toMatchObject({
      code: "auth/not-authenticated",
    });
  });

  it("rejects blank name", async () => {
    mockAuthState.currentUser = makeUser();
    await expect(updateDisplayName("   ")).rejects.toMatchObject({
      code: "validation/display-name-required",
    });
  });

  it("updates Auth profile and Firestore profile", async () => {
    const user = makeUser();
    mockAuthState.currentUser = user;

    await updateDisplayName("  Alice  ");

    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: "Alice" });
    expect(upsertUserProfile).toHaveBeenCalledWith({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
    });
  });

  it("wraps errors", async () => {
    mockAuthState.currentUser = makeUser();
    vi.mocked(updateProfile).mockRejectedValue(new Error("boom"));
    await expect(updateDisplayName("Alice")).rejects.toMatchObject({
      code: "auth/update-profile-failed",
    });
  });

  // Phase 4.7: user が group に所属している場合、propagateDisplayNameToGroups を呼ぶ
  it("propagates displayName to all groups when user has groupIds", async () => {
    const user = makeUser();
    mockAuthState.currentUser = user;
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "old",
      email: "alice@example.com",
      groupIds: ["g1", "g2"],
      createdAt: { toMillis: () => 0 } as never,
    });

    await updateDisplayName("Alice");

    expect(propagateDisplayNameToGroups).toHaveBeenCalledWith("u1", ["g1", "g2"], "Alice");
  });

  it("skips propagation when user has no groupIds", async () => {
    mockAuthState.currentUser = makeUser();
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "old",
      email: "alice@example.com",
      groupIds: [],
      createdAt: { toMillis: () => 0 } as never,
    });

    await updateDisplayName("Alice");

    expect(propagateDisplayNameToGroups).not.toHaveBeenCalled();
  });

  it("swallows propagation errors (best-effort, does not throw)", async () => {
    mockAuthState.currentUser = makeUser();
    vi.mocked(getUserProfile).mockResolvedValue({
      uid: "u1",
      displayName: "old",
      email: "alice@example.com",
      groupIds: ["g1"],
      createdAt: { toMillis: () => 0 } as never,
    });
    vi.mocked(propagateDisplayNameToGroups).mockRejectedValue(new Error("boom"));

    await expect(updateDisplayName("Alice")).resolves.toBeUndefined();
  });

  it("still succeeds when getUserProfile itself fails (fallback to no groupIds)", async () => {
    mockAuthState.currentUser = makeUser();
    vi.mocked(getUserProfile).mockRejectedValue(new Error("read failed"));

    await expect(updateDisplayName("Alice")).resolves.toBeUndefined();
    expect(propagateDisplayNameToGroups).not.toHaveBeenCalled();
  });
});

describe("logout", () => {
  it("calls signOut on success for non-anonymous user", async () => {
    mockAuthState.currentUser = makeUser();
    await logout();
    expect(signOut).toHaveBeenCalled();
    expect(deleteUserProfile).not.toHaveBeenCalled();
  });

  it("calls signOut when currentUser is null", async () => {
    mockAuthState.currentUser = null;
    await logout();
    expect(signOut).toHaveBeenCalled();
    expect(deleteUserProfile).not.toHaveBeenCalled();
  });

  it("wraps errors with auth/logout-failed", async () => {
    mockAuthState.currentUser = makeUser();
    vi.mocked(signOut).mockRejectedValue(new Error("boom"));
    await expect(logout()).rejects.toMatchObject({ code: "auth/logout-failed" });
  });

  it("deletes user profile and auth account for anonymous user (skips signOut on success)", async () => {
    const user = makeUser({ isAnonymous: true });
    mockAuthState.currentUser = user;

    await logout();

    // attemptAnonymousSelfDelete は内部で deleteUserProfile + user.delete を呼ぶ。
    expect(deleteUserProfile).toHaveBeenCalledWith("u1");
    expect(user.delete).toHaveBeenCalled();
    // self-delete が { deleted: true } を返すと logout は signOut を skip する。
    expect(signOut).not.toHaveBeenCalled();
  });

  it("falls back to signOut when anonymous delete fails", async () => {
    const user = makeUser({
      isAnonymous: true,
      delete: vi.fn().mockRejectedValue(new Error("requires-recent-login")),
    });
    mockAuthState.currentUser = user;

    await logout();

    expect(deleteUserProfile).toHaveBeenCalledWith("u1");
    expect(user.delete).toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it("falls back to signOut when deleteUserProfile fails", async () => {
    const user = makeUser({ isAnonymous: true });
    mockAuthState.currentUser = user;
    vi.mocked(deleteUserProfile).mockRejectedValue(new Error("boom"));

    await logout();

    expect(signOut).toHaveBeenCalled();
  });
});

describe("normalizeAuthCode (default branch)", () => {
  it("passes unknown codes through unchanged", async () => {
    vi.mocked(signInWithEmailAndPassword).mockRejectedValue(
      new FirebaseError("auth/some-unknown", "x"),
    );
    await expect(loginWithEmail("a", "b")).rejects.toMatchObject({
      code: "auth/some-unknown",
    });
  });
});

describe("AccountLinkRequired", () => {
  it("exposes email / pendingCredential / methods", () => {
    const cred = { providerId: "google.com" } as never;
    const err = new AccountLinkRequired("msg", "alice@example.com", cred, ["password"]);
    expect(err).toBeInstanceOf(AppError);
    expect(err.code).toBe("auth/need-link-google");
    expect(err.email).toBe("alice@example.com");
    expect(err.pendingCredential).toBe(cred);
    expect(err.methods).toEqual(["password"]);
  });
});
