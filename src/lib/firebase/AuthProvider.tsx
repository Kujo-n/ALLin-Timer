"use client";

import { FirebaseError } from "firebase/app";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useState,
  type ReactNode,
} from "react";

import { logger } from "@/lib/logger";

import { firebaseAuth } from "./client";

type AuthState = { user: User | null; loading: boolean; refreshUser: () => void };

const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  refreshUser: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ user: User | null; loading: boolean }>({
    user: null,
    loading: true,
  });
  // Phase 4.7: updateProfile は onAuthStateChanged を再発火させないため、
  // bump を増やすことで consumer の useMemo 参照を更新し再レンダを強制する。
  const [bump, force] = useReducer((x: number) => x + 1, 0);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(
      firebaseAuth,
      (user) => setState({ user, loading: false }),
      (error) => {
        const code = error instanceof FirebaseError ? error.code : "auth/unknown";
        logger.error("auth state change error", { code, message: error.message });
        setState({ user: null, loading: false });
      },
    );
    return unsubscribe;
  }, []);

  const refreshUser = useCallback(() => {
    force();
  }, []);

  // bump を依存に含めることで value 全体が新参照になり、consumer の useMemo が無効化される。
  // 一方 user 自体は firebaseAuth.currentUser から都度取得し、updateProfile で
  // mutate された最新の displayName / photoURL を反映させる。
  //   deps は個別フィールドに分解して exhaustive-deps を満たす。
  //   `bump` は factory 内で `void bump` として参照し「意図的な副作用 dep」であることを明示。
  const value = useMemo<AuthState>(
    () => {
      void bump;
      return {
        user: firebaseAuth.currentUser ?? state.user,
        loading: state.loading,
        refreshUser,
      };
    },
    [state.user, state.loading, bump, refreshUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthUser(): AuthState {
  return useContext(AuthContext);
}
