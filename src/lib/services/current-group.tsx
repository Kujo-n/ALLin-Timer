"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import {
  listMyGroups,
} from "@/lib/firebase/repositories/groups";
import {
  getUserProfile,
  removeGroupIdFromUser,
} from "@/lib/firebase/repositories/users";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

const STORAGE_KEY = "allinpt.currentGroupId";

type GroupState = {
  loading: boolean;
  groupIds: string[];
  groups: GroupDoc[];
  currentGroupId: string | null;
  setCurrentGroupId: (gid: string | null) => void;
  refreshGroups: () => Promise<void>;
};

const DEFAULT_STATE: GroupState = {
  loading: true,
  groupIds: [],
  groups: [],
  currentGroupId: null,
  setCurrentGroupId: () => {},
  refreshGroups: async () => {},
};

const GroupContext = createContext<GroupState>(DEFAULT_STATE);

function readStoredCurrentGroupId(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredCurrentGroupId(gid: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (gid) {
      window.localStorage.setItem(STORAGE_KEY, gid);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage が使えなくてもアプリは動く
  }
}

export function GroupProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useAuthUser();
  const [loading, setLoading] = useState(true);
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [groups, setGroups] = useState<GroupDoc[]>([]);
  const [currentGroupId, setCurrentGroupIdState] = useState<string | null>(null);

  // strict mode 二重実行への対応：最新の uid だけ反映する
  const inflightUidRef = useRef<string | null>(null);

  const setCurrentGroupId = useCallback((gid: string | null) => {
    setCurrentGroupIdState(gid);
    writeStoredCurrentGroupId(gid);
  }, []);

  const loadFor = useCallback(async (uid: string) => {
    inflightUidRef.current = uid;
    setLoading(true);
    try {
      const profile = await getUserProfile(uid);
      const ids = profile?.groupIds ?? [];
      const { groups: loadedGroups, failedGids } = await listMyGroups(ids);
      // drift 修復：profile に載っているが getGroup できなかった gid を逆引きから外す
      for (const gid of failedGids) {
        await removeGroupIdFromUser(uid, gid).catch((e) => {
          logger.warn("removeGroupIdFromUser failed", { uid, gid, e });
        });
      }
      const liveIds = loadedGroups.map((g) => g.id);
      if (inflightUidRef.current !== uid) return;
      setGroupIds(liveIds);
      setGroups(loadedGroups);

      const stored = readStoredCurrentGroupId();
      if (stored && liveIds.includes(stored)) {
        setCurrentGroupIdState(stored);
      } else if (liveIds.length > 0) {
        setCurrentGroupIdState(liveIds[0]);
        writeStoredCurrentGroupId(liveIds[0]);
      } else {
        setCurrentGroupIdState(null);
        writeStoredCurrentGroupId(null);
      }
    } catch (e) {
      const wrapped = AppError.from(e, "group/load-failed", "サークル情報の取得に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid });
      if (inflightUidRef.current !== uid) return;
      setGroupIds([]);
      setGroups([]);
      setCurrentGroupIdState(null);
    } finally {
      if (inflightUidRef.current === uid) {
        setLoading(false);
      }
    }
  }, []);

  const refreshGroups = useCallback(async () => {
    if (!user) return;
    await loadFor(user.uid);
  }, [user, loadFor]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      inflightUidRef.current = null;
      setGroupIds([]);
      setGroups([]);
      setCurrentGroupIdState(null);
      writeStoredCurrentGroupId(null);
      setLoading(false);
      return;
    }
    void loadFor(user.uid);
  }, [user, authLoading, loadFor]);

  const value: GroupState = {
    loading,
    groupIds,
    groups,
    currentGroupId,
    setCurrentGroupId,
    refreshGroups,
  };

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useCurrentGroup(): GroupState {
  return useContext(GroupContext);
}
