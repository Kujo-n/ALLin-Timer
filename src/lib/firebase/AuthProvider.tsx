"use client";

import { FirebaseError } from "firebase/app";
import { onAuthStateChanged, type User } from "firebase/auth";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

import { logger } from "@/lib/logger";

import { firebaseAuth } from "./client";

type AuthState = { user: User | null; loading: boolean };

const AuthContext = createContext<AuthState>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ user: null, loading: true });

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

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export function useAuthUser(): AuthState {
  return useContext(AuthContext);
}
