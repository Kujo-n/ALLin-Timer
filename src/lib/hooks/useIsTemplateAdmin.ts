"use client";

import { useEffect, useState } from "react";

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { isTemplateAdmin } from "@/lib/firebase/repositories/templateAdmins";

type State = { isAdmin: boolean; loading: boolean };

const INITIAL: State = { isAdmin: false, loading: true };
const NOT_ADMIN: State = { isAdmin: false, loading: false };

/**
 * 現在ログイン中のユーザーがテンプレート管理者かを返す hook。
 * 未ログイン・匿名ユーザーは常に非管理者。
 * ログアウト / 別ユーザー切替で state が古いまま残らないよう cancelled フラグで破棄する。
 */
export function useIsTemplateAdmin(): State {
  const { user, loading: authLoading } = useAuthUser();
  const [state, setState] = useState<State>(INITIAL);

  useEffect(() => {
    if (authLoading) {
      setState(INITIAL);
      return;
    }
    if (!user || user.isAnonymous) {
      setState(NOT_ADMIN);
      return;
    }
    let cancelled = false;
    setState(INITIAL);
    (async () => {
      const ok = await isTemplateAdmin(user.uid);
      if (!cancelled) setState({ isAdmin: ok, loading: false });
    })();
    return () => {
      cancelled = true;
    };
  }, [user, authLoading]);

  return state;
}
