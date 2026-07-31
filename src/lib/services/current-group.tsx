"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { AppError } from "@/lib/errors";
import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { firebaseAuth } from "@/lib/firebase/client";
import { listMyGroups } from "@/lib/firebase/repositories/groups";
import { getUserProfile, removeGroupIdFromUser } from "@/lib/firebase/repositories/users";
import { deriveRole, type GroupDoc, type MemberRole } from "@/lib/firebase/schemas/group";
import { logger } from "@/lib/logger";

const STORAGE_KEY = "allinpt.currentGroupId";

type GroupState = {
  loading: boolean;
  groupIds: string[];
  groups: GroupDoc[];
  currentGroupId: string | null;
  setCurrentGroupId: (gid: string | null) => void;
  refreshGroups: () => Promise<void>;
  /** 現在選択中の group に対する、サインイン中ユーザーのロール（未選択 or 未ログインなら null） */
  currentGroupRole: MemberRole | null;
  /** currentGroupRole === "owner" || "organizer" */
  isOrganizer: boolean;
  /** currentGroupRole === "owner" */
  isOwner: boolean;
};

const DEFAULT_STATE: GroupState = {
  loading: true,
  groupIds: [],
  groups: [],
  currentGroupId: null,
  setCurrentGroupId: () => {},
  refreshGroups: async () => {},
  currentGroupRole: null,
  isOrganizer: false,
  isOwner: false,
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

  // 最新の load 要求だけが state を書けるようにする単調増加カウンタ。
  //   - React strict mode の二重実行
  //   - サインアウト（uid なし）への切替
  //   - 受付直後の refreshGroups と provider effect の並走
  //     （08-auto-group-join-on-entry Phase 2: 加入前に始まった load が
  //      加入後の load より遅れて着地すると、新しいサークルが一覧から消える）
  // を 1 つのガードで扱う。
  const reqIdRef = useRef(0);

  const setCurrentGroupId = useCallback((gid: string | null) => {
    setCurrentGroupIdState(gid);
    writeStoredCurrentGroupId(gid);
  }, []);

  const loadFor = useCallback(async (uid: string) => {
    const reqId = (reqIdRef.current += 1);
    setLoading(true);
    try {
      const profile = await getUserProfile(uid);
      const ids = profile?.groupIds ?? [];
      const { groups: loadedGroups, failedGids } = await listMyGroups(ids);
      const liveIds = loadedGroups.map((g) => g.id);
      if (reqIdRef.current !== reqId) return;
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

      // drift 修復：profile に載っているが getGroup できなかった gid を逆引きから外す。
      // **stale guard の後に置く**（破壊的書込のため）。追い越された古い load の
      // failedGids で修復すると、その後に加入した最新のメンバーシップを消しかねない
      // （例: 受付直後の refreshGroups が先に着地し、加入前に始まった load が後から
      //  「getGroup 失敗」を根拠に groupIds を削る）。
      for (const gid of failedGids) {
        await removeGroupIdFromUser(uid, gid).catch((e) => {
          logger.warn("removeGroupIdFromUser failed", { uid, gid, e });
        });
      }
    } catch (e) {
      const wrapped = AppError.from(e, "group/load-failed", "サークル情報の取得に失敗しました");
      logger.warn(wrapped.message, { code: wrapped.code, uid });
      if (reqIdRef.current !== reqId) return;
      setGroupIds([]);
      setGroups([]);
      setCurrentGroupIdState(null);
    } finally {
      if (reqIdRef.current === reqId) {
        setLoading(false);
      }
    }
  }, []);

  const refreshGroups = useCallback(async () => {
    // 受付直後（Google popup / メールログイン直後）は onAuthStateChanged の反映が
    // 1 tick 遅れて context の user がまだ null のことがある。そのまま return すると
    // 自動所属したサークルがサイドバー / 一覧に出ないため、SDK の currentUser に倒す。
    const uid = user?.uid ?? firebaseAuth.currentUser?.uid ?? null;
    if (!uid) return;
    await loadFor(uid);
  }, [user, loadFor]);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      // in-flight な load が後から着地して groups を復活させないよう無効化する。
      reqIdRef.current += 1;
      setGroupIds([]);
      setGroups([]);
      setCurrentGroupIdState(null);
      writeStoredCurrentGroupId(null);
      setLoading(false);
      return;
    }
    void loadFor(user.uid);
  }, [user, authLoading, loadFor]);

  const currentGroupRole = useMemo<MemberRole | null>(() => {
    if (!user || !currentGroupId) return null;
    const g = groups.find((x) => x.id === currentGroupId);
    if (!g) return null;
    return deriveRole(g, user.uid);
  }, [user, currentGroupId, groups]);

  const isOrganizer = currentGroupRole === "owner" || currentGroupRole === "organizer";
  const isOwner = currentGroupRole === "owner";

  const value: GroupState = {
    loading,
    groupIds,
    groups,
    currentGroupId,
    setCurrentGroupId,
    refreshGroups,
    currentGroupRole,
    isOrganizer,
    isOwner,
  };

  return <GroupContext.Provider value={value}>{children}</GroupContext.Provider>;
}

export function useCurrentGroup(): GroupState {
  return useContext(GroupContext);
}
