import { act, renderHook, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase/AuthProvider", () => ({
  useAuthUser: vi.fn(),
}));

vi.mock("@/lib/firebase/repositories/templateAdmins", () => ({
  isTemplateAdmin: vi.fn(),
}));

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { isTemplateAdmin } from "@/lib/firebase/repositories/templateAdmins";

import { useIsTemplateAdmin } from "./useIsTemplateAdmin";

type AuthState = ReturnType<typeof useAuthUser>;

function makeUser(overrides: Partial<User> = {}): User {
  return {
    uid: "u-1",
    isAnonymous: false,
    email: "user@example.com",
    displayName: "たろう",
    emailVerified: true,
    phoneNumber: null,
    photoURL: null,
    providerId: "password",
    metadata: {},
    providerData: [],
    refreshToken: "",
    tenantId: null,
    delete: async () => {},
    getIdToken: async () => "",
    getIdTokenResult: async () => ({}) as never,
    reload: async () => {},
    toJSON: () => ({}),
    ...overrides,
  } as User;
}

function authState(partial: Partial<AuthState>): AuthState {
  return {
    user: null,
    loading: false,
    refreshUser: () => {},
    ...partial,
  };
}

// refreshUser は AuthState のプロパティに過ぎず本テストでは使わないため stub する。
const wrapper = ({ children }: { children: ReactNode }) => <>{children}</>;

beforeEach(() => {
  vi.mocked(useAuthUser).mockReset();
  vi.mocked(isTemplateAdmin).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("useIsTemplateAdmin", () => {
  it("returns loading:true while auth is loading", () => {
    vi.mocked(useAuthUser).mockReturnValue(authState({ user: null, loading: true }));

    const { result } = renderHook(() => useIsTemplateAdmin(), { wrapper });

    expect(result.current).toEqual({ isAdmin: false, loading: true });
    expect(isTemplateAdmin).not.toHaveBeenCalled();
  });

  it("returns not-admin when signed out", () => {
    vi.mocked(useAuthUser).mockReturnValue(authState({ user: null, loading: false }));

    const { result } = renderHook(() => useIsTemplateAdmin(), { wrapper });

    expect(result.current).toEqual({ isAdmin: false, loading: false });
    expect(isTemplateAdmin).not.toHaveBeenCalled();
  });

  it("returns not-admin for anonymous user without calling the repository", () => {
    vi.mocked(useAuthUser).mockReturnValue(
      authState({ user: makeUser({ uid: "anon-1", isAnonymous: true }), loading: false }),
    );

    const { result } = renderHook(() => useIsTemplateAdmin(), { wrapper });

    expect(result.current).toEqual({ isAdmin: false, loading: false });
    expect(isTemplateAdmin).not.toHaveBeenCalled();
  });

  it("resolves isAdmin:true when repository reports admin", async () => {
    vi.mocked(useAuthUser).mockReturnValue(
      authState({ user: makeUser({ uid: "u-admin" }), loading: false }),
    );
    vi.mocked(isTemplateAdmin).mockResolvedValue(true);

    const { result } = renderHook(() => useIsTemplateAdmin(), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual({ isAdmin: true, loading: false });
    });
    expect(isTemplateAdmin).toHaveBeenCalledWith("u-admin");
  });

  it("resolves isAdmin:false for signed-in non-admin", async () => {
    vi.mocked(useAuthUser).mockReturnValue(
      authState({ user: makeUser({ uid: "u-regular" }), loading: false }),
    );
    vi.mocked(isTemplateAdmin).mockResolvedValue(false);

    const { result } = renderHook(() => useIsTemplateAdmin(), { wrapper });

    await waitFor(() => {
      expect(result.current).toEqual({ isAdmin: false, loading: false });
    });
  });

  it("ignores resolved result after unmount (cancelled flag)", async () => {
    vi.mocked(useAuthUser).mockReturnValue(
      authState({ user: makeUser({ uid: "u-admin" }), loading: false }),
    );

    let resolve!: (value: boolean) => void;
    vi.mocked(isTemplateAdmin).mockReturnValue(
      new Promise<boolean>((r) => {
        resolve = r;
      }),
    );

    const { result, unmount } = renderHook(() => useIsTemplateAdmin(), { wrapper });

    expect(result.current).toEqual({ isAdmin: false, loading: true });

    unmount();
    await act(async () => {
      resolve(true);
    });

    // unmount 後は state 更新されない（cancelled フラグにより late resolve を無視）
    expect(result.current).toEqual({ isAdmin: false, loading: true });
  });
});
