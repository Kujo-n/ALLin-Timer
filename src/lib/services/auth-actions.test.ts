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
    sendSignInLinkToEmail: vi.fn(),
    isSignInWithEmailLink: vi.fn(),
    signInWithEmailLink: vi.fn(),
    fetchSignInMethodsForEmail: vi.fn(),
    linkWithCredential: vi.fn(),
    signOut: vi.fn(),
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
}));

import {
  createUserWithEmailAndPassword,
  fetchSignInMethodsForEmail,
  GoogleAuthProvider,
  isSignInWithEmailLink,
  linkWithCredential,
  sendSignInLinkToEmail,
  signInAnonymously,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateProfile,
} from "firebase/auth";

import { upsertUserProfile } from "@/lib/firebase/repositories/users";

import {
  AccountLinkRequired,
  clearStoredDisplayNameForSignIn,
  clearStoredEmailForSignIn,
  completeEmailLink,
  getStoredDisplayNameForSignIn,
  getStoredEmailForSignIn,
  isEmailLinkUrl,
  linkGoogleWithPassword,
  loginWithEmail,
  logout,
  registerWithEmail,
  sendEmailLinkForJoin,
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.mocked(signInWithEmailAndPassword).mockReset();
  vi.mocked(createUserWithEmailAndPassword).mockReset();
  vi.mocked(updateProfile).mockReset().mockResolvedValue(undefined);
  vi.mocked(signInAnonymously).mockReset();
  vi.mocked(signInWithPopup).mockReset();
  vi.mocked(sendSignInLinkToEmail).mockReset().mockResolvedValue(undefined);
  vi.mocked(isSignInWithEmailLink).mockReset();
  vi.mocked(signInWithEmailLink).mockReset();
  vi.mocked(fetchSignInMethodsForEmail).mockReset().mockResolvedValue([]);
  vi.mocked(linkWithCredential).mockReset().mockResolvedValue(undefined as never);
  vi.mocked(signOut).mockReset().mockResolvedValue(undefined);
  vi.mocked(GoogleAuthProvider.credentialFromError).mockReset();
  vi.mocked(upsertUserProfile).mockReset().mockResolvedValue(undefined);
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
  it("upserts profile when displayName present", async () => {
    const user = makeUser();
    vi.mocked(signInWithPopup).mockResolvedValue({ user } as never);

    const result = await signInWithGoogle();

    expect(result).toBe(user);
    expect(upsertUserProfile).toHaveBeenCalledWith({
      uid: "u1",
      displayName: "Alice",
      email: "alice@example.com",
    });
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

describe("sendEmailLinkForJoin", () => {
  it("sends link and stores email in localStorage", async () => {
    await sendEmailLinkForJoin("alice@example.com", "/join/t1");

    expect(sendSignInLinkToEmail).toHaveBeenCalled();
    expect(window.localStorage.getItem("emailForSignIn")).toBe("alice@example.com");
  });

  it("stores trimmed displayName when provided", async () => {
    await sendEmailLinkForJoin("alice@example.com", "/join/t1", "  Alice  ");
    expect(window.localStorage.getItem("displayNameForSignIn")).toBe("Alice");
  });

  it("removes stored displayName when blank provided", async () => {
    window.localStorage.setItem("displayNameForSignIn", "Old");
    await sendEmailLinkForJoin("alice@example.com", "/join/t1", "   ");
    expect(window.localStorage.getItem("displayNameForSignIn")).toBeNull();
  });

  it("normalizes invalid-email error", async () => {
    vi.mocked(sendSignInLinkToEmail).mockRejectedValue(
      new FirebaseError("auth/invalid-email", "bad"),
    );
    await expect(sendEmailLinkForJoin("notmail", "/x")).rejects.toMatchObject({
      code: "auth/invalid-email",
    });
  });
});

describe("storage helpers", () => {
  it("getStoredEmailForSignIn returns null when not set", () => {
    expect(getStoredEmailForSignIn()).toBeNull();
  });

  it("getStoredEmailForSignIn returns stored value", () => {
    window.localStorage.setItem("emailForSignIn", "x@y.com");
    expect(getStoredEmailForSignIn()).toBe("x@y.com");
  });

  it("clearStoredEmailForSignIn removes value", () => {
    window.localStorage.setItem("emailForSignIn", "x@y.com");
    clearStoredEmailForSignIn();
    expect(window.localStorage.getItem("emailForSignIn")).toBeNull();
  });

  it("getStoredDisplayNameForSignIn round-trips", () => {
    window.localStorage.setItem("displayNameForSignIn", "Bob");
    expect(getStoredDisplayNameForSignIn()).toBe("Bob");
    clearStoredDisplayNameForSignIn();
    expect(getStoredDisplayNameForSignIn()).toBeNull();
  });
});

describe("isEmailLinkUrl", () => {
  it("delegates to isSignInWithEmailLink", () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    expect(isEmailLinkUrl("https://example.com/x")).toBe(true);

    vi.mocked(isSignInWithEmailLink).mockReturnValue(false);
    expect(isEmailLinkUrl("https://example.com/y")).toBe(false);
  });
});

describe("completeEmailLink", () => {
  it("rejects when URL is not a sign-in link", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(false);
    await expect(completeEmailLink("https://x")).rejects.toMatchObject({
      code: "auth/email-link-invalid",
    });
  });

  it("rejects when no email available (neither fallback nor stored)", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    await expect(completeEmailLink("https://x")).rejects.toMatchObject({
      code: "auth/email-missing-on-callback",
    });
  });

  it("uses fallbackEmail when provided", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    const user = makeUser();
    vi.mocked(signInWithEmailLink).mockResolvedValue({ user } as never);

    const result = await completeEmailLink("https://x", "alice@example.com");

    expect(result).toBe(user);
  });

  it("clears stored email after success", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    window.localStorage.setItem("emailForSignIn", "alice@example.com");
    const user = makeUser();
    vi.mocked(signInWithEmailLink).mockResolvedValue({ user } as never);

    await completeEmailLink("https://x");

    expect(window.localStorage.getItem("emailForSignIn")).toBeNull();
  });

  it("applies stored displayName when user has none", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    window.localStorage.setItem("emailForSignIn", "alice@example.com");
    window.localStorage.setItem("displayNameForSignIn", "Alice");
    const user = makeUser({ displayName: null });
    vi.mocked(signInWithEmailLink).mockResolvedValue({ user } as never);

    await completeEmailLink("https://x");

    expect(updateProfile).toHaveBeenCalledWith(user, { displayName: "Alice" });
  });

  it("logs and continues if updateProfile throws (best-effort)", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    window.localStorage.setItem("emailForSignIn", "a@b.com");
    window.localStorage.setItem("displayNameForSignIn", "Alice");
    const user = makeUser({ displayName: null });
    vi.mocked(signInWithEmailLink).mockResolvedValue({ user } as never);
    vi.mocked(updateProfile).mockRejectedValueOnce(new Error("network"));

    await expect(completeEmailLink("https://x")).resolves.toBe(user);
  });

  it("wraps signInWithEmailLink errors", async () => {
    vi.mocked(isSignInWithEmailLink).mockReturnValue(true);
    window.localStorage.setItem("emailForSignIn", "a@b.com");
    vi.mocked(signInWithEmailLink).mockRejectedValue(new Error("boom"));

    await expect(completeEmailLink("https://x")).rejects.toMatchObject({
      code: "auth/email-link-failed",
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
});

describe("logout", () => {
  it("calls signOut on success", async () => {
    await logout();
    expect(signOut).toHaveBeenCalled();
  });

  it("wraps errors with auth/logout-failed", async () => {
    vi.mocked(signOut).mockRejectedValue(new Error("boom"));
    await expect(logout()).rejects.toMatchObject({ code: "auth/logout-failed" });
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
