"use client";

import { useMemo } from "react";

import { useAuthUser } from "@/lib/firebase/AuthProvider";
import { deriveRole, type GroupDoc, type MemberRole } from "@/lib/firebase/schemas/group";
import { useCurrentGroup } from "@/lib/services/current-group";

export interface GroupRoleInfo {
  /** 渡された `gid` に該当する group オブジェクト。GroupProvider が読込中／非メンバーの場合は null。 */
  group: GroupDoc | null;
  /** ログイン中ユーザーの role（owner / organizer / member）。group が見つからない / 非メンバーの場合は null。 */
  role: MemberRole | null;
}

/**
 * 任意の `gid`（`tournament.groupId` 等）に対する自分のロールと group オブジェクトを返す。
 *
 * Phase 4 architect-refactor (P5-2) で `dashboard-client.tsx` / `live-client.tsx` /
 * `useAudioPlayer` 呼出側に重複していた以下のパターンを集約する:
 *
 * ```
 * const tournamentGroup = data ? groups.find((x) => x.id === data.groupId) ?? null : null;
 * const role = user && tournamentGroup ? deriveRole(tournamentGroup, user.uid) : null;
 * ```
 *
 * `useCurrentGroup().currentGroupRole` は「現在選択中の group」のみを扱うため、
 * tournament view（`/tournaments/[tid]`）のように group が URL から決まる画面では使えない。
 * 本 hook はそうした文脈で `gid` を直接渡せるバリエーション。
 */
export function useGroupRole(gid: string | null | undefined): GroupRoleInfo {
  const { user } = useAuthUser();
  const { groups } = useCurrentGroup();
  return useMemo<GroupRoleInfo>(() => {
    if (!user || !gid) return { group: null, role: null };
    const group = groups.find((g) => g.id === gid) ?? null;
    if (!group) return { group: null, role: null };
    return { group, role: deriveRole(group, user.uid) };
  }, [user, gid, groups]);
}
