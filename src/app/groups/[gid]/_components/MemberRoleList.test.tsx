import { fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";

import { MemberRoleList, type MemberLine } from "./MemberRoleList";

/**
 * Phase 4 (08-auto-group-join-on-entry): 「除外」ボタンの表示条件を固定する。
 *
 * 不変条件:
 *   1. owner から見た他メンバーの行にだけ「除外」が出る
 *   2. 自分の行には出ない（自己除外は service でも deny）
 *   3. owner でないユーザー（organizer / member）には 1 つも出ない
 *   4. working=true のとき disabled（連打防止）
 *   5. aria-label 規約は `${displayName} を除外`（E2E POM / GroupsPage.ts と手動同期）
 */
function makeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  const ownerUids = overrides.ownerUids ?? ["u-owner"];
  const organizerUids = overrides.organizerUids ?? [...ownerUids];
  const memberUids = overrides.memberUids ?? [...organizerUids];
  return {
    id: "g1",
    name: "Saturday",
    ownerUids,
    organizerUids,
    memberUids,
    memberDisplayNames: {},
    audioSettings: {
      enabled: true,
      levelUpSoundId: "default:blind-up",
      winnerSoundId: "default:victory-chime",
      volume: 0.7,
    },
    finishedTournamentCount: 0,
    defaultSeatsPerTable: 8,
    seasonStartDate: null,
    defaultTableLabels: [],
    defaultTableColors: [],
    seasonPointsRule: null,
    winnerCardBackground: null,
    seasonCardBackground: null,
    latestJoinCodeId: null,
    joinedViaTournamentId: null,
    createdAt: Timestamp.fromDate(new Date("2026-07-31T00:00:00Z")),
    ...overrides,
  };
}

const members: MemberLine[] = [
  { uid: "u-owner", displayName: "オーナー太郎", missing: false },
  { uid: "u-member", displayName: "一般花子", missing: false },
];

function renderList(props: Partial<Parameters<typeof MemberRoleList>[0]> = {}) {
  const onRemoveMember = vi.fn();
  render(
    <MemberRoleList
      group={makeGroup({ memberUids: ["u-owner", "u-member"] })}
      members={members}
      selfUid="u-owner"
      isOwner
      working={false}
      onPromoteOrganizer={vi.fn()}
      onPromoteOwner={vi.fn()}
      onDemoteToMember={vi.fn()}
      onDemoteOwner={vi.fn()}
      onRemoveMember={onRemoveMember}
      {...props}
    />,
  );
  return { onRemoveMember };
}

describe("MemberRoleList の除外ボタン", () => {
  it("owner から見た他メンバー行に出て、click で対象 MemberLine が渡る", () => {
    const { onRemoveMember } = renderList();
    fireEvent.click(screen.getByRole("button", { name: "一般花子 を除外" }));
    expect(onRemoveMember).toHaveBeenCalledWith(members[1]);
  });

  it("自分の行には出ない", () => {
    renderList();
    expect(screen.queryByRole("button", { name: "オーナー太郎 を除外" })).toBeNull();
  });

  it("owner でないユーザーには 1 つも出ない", () => {
    renderList({ isOwner: false, selfUid: "u-member" });
    expect(screen.queryByRole("button", { name: /を除外$/ })).toBeNull();
  });

  it("working=true のとき disabled", () => {
    renderList({ working: true });
    expect(screen.getByRole("button", { name: "一般花子 を除外" })).toBeDisabled();
  });
});
