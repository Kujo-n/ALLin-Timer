import { render, screen, waitFor, within } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";

// next/link は client side import 経由でも貫通可能。`useRouter` 等は本 component では未使用。
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    replace: vi.fn(),
    push: vi.fn(),
    back: vi.fn(),
  })),
}));

vi.mock("@/lib/firebase/repositories/tournaments", () => ({
  listTournamentsByGroup: vi.fn(),
}));

vi.mock("@/lib/services/current-group", () => ({
  useCurrentGroup: vi.fn(),
}));

import { listTournamentsByGroup } from "@/lib/firebase/repositories/tournaments";
import { useCurrentGroup } from "@/lib/services/current-group";

import { TournamentsClient } from "./tournaments-client";

const ts = Timestamp.fromDate(new Date("2026-05-09T00:00:00Z"));

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t-default",
    groupId: "g1",
    createdByUid: "u1",
    name: "Default Tournament",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      ],
    },
    state: "setup",
    startedAt: null,
    levelStartedAt: null,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 0,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    spectateEnabled: false,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function setCurrentGroupMock(overrides: Partial<{
  currentGroupId: string | null;
  isOrganizer: boolean;
}> = {}) {
  vi.mocked(useCurrentGroup).mockReturnValue({
    groups: [
      {
        // GroupDoc の必須最小フィールド。tests のみで参照する name のみ実値。
        id: overrides.currentGroupId ?? "g1",
        name: "Test Group",
      } as never,
    ],
    groupIds: [overrides.currentGroupId ?? "g1"],
    loading: false,
    currentGroupId: overrides.currentGroupId ?? "g1",
    currentGroupRole: overrides.isOrganizer ? "organizer" : "member",
    isOrganizer: overrides.isOrganizer ?? true,
    isOwner: false,
    setCurrentGroupId: vi.fn(),
    refreshGroups: vi.fn(),
  });
}

beforeEach(() => {
  setCurrentGroupMock();
  vi.mocked(listTournamentsByGroup).mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("TournamentsClient — 観戦モード badge (Phase 3 / 04-spectate-mode)", () => {
  it("spectateEnabled=true の card に「観戦公開中」 badge が aria-label 付きで表示される", async () => {
    vi.mocked(listTournamentsByGroup).mockResolvedValue([
      makeTournament({
        id: "t-on",
        name: "観戦 ON Tournament",
        spectateEnabled: true,
      }),
    ]);

    render(<TournamentsClient />);

    // listTournamentsByGroup の resolve を待ってから assert
    const card = await waitFor(() =>
      screen.getByRole("group", { name: /観戦 ON Tournament/ }),
    );
    const badge = within(card).getByLabelText("観戦モード公開中");
    expect(badge).toHaveTextContent("観戦公開中");
  });

  it("spectateEnabled=false の card には「観戦公開中」 badge が表示されない", async () => {
    vi.mocked(listTournamentsByGroup).mockResolvedValue([
      makeTournament({
        id: "t-off",
        name: "観戦 OFF Tournament",
        spectateEnabled: false,
      }),
    ]);

    render(<TournamentsClient />);

    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: /観戦 OFF Tournament/ }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByLabelText("観戦モード公開中")).not.toBeInTheDocument();
    expect(screen.queryByText("観戦公開中")).not.toBeInTheDocument();
  });

  it("card の aria-label に状態ラベルと「・観戦公開中」が合成される（spectateEnabled=true）", async () => {
    // Phase 3 で aria-label 合成を `${name}（${tone.label}・観戦公開中）` に拡張済み。
    // running state + spectateEnabled=true → 「進行中・観戦公開中」が name に含まれる。
    vi.mocked(listTournamentsByGroup).mockResolvedValue([
      makeTournament({
        id: "t-aria",
        name: "Aria Test",
        state: "running",
        spectateEnabled: true,
        currentLevel: 2,
      }),
    ]);

    render(<TournamentsClient />);

    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Aria Test（進行中・観戦公開中）" }),
      ).toBeInTheDocument(),
    );
  });

  it("aria-label は spectateEnabled=false のとき「・観戦公開中」サフィックスを含まない", async () => {
    vi.mocked(listTournamentsByGroup).mockResolvedValue([
      makeTournament({
        id: "t-aria-off",
        name: "Aria Off",
        state: "running",
        spectateEnabled: false,
      }),
    ]);

    render(<TournamentsClient />);

    await waitFor(() =>
      expect(
        screen.getByRole("group", { name: "Aria Off（進行中）" }),
      ).toBeInTheDocument(),
    );
  });

  it("ON / OFF の card が混在するときに ON 側だけ badge が表示される", async () => {
    vi.mocked(listTournamentsByGroup).mockResolvedValue([
      makeTournament({ id: "t-mix-on", name: "Mix ON", spectateEnabled: true }),
      makeTournament({
        id: "t-mix-off",
        name: "Mix OFF",
        spectateEnabled: false,
      }),
    ]);

    render(<TournamentsClient />);

    const onCard = await waitFor(() =>
      screen.getByRole("group", { name: /Mix ON/ }),
    );
    const offCard = screen.getByRole("group", { name: /Mix OFF/ });

    expect(within(onCard).getByLabelText("観戦モード公開中")).toBeInTheDocument();
    expect(
      within(offCard).queryByLabelText("観戦モード公開中"),
    ).not.toBeInTheDocument();
  });

  it("badge は member ロールでも表示される（誤公開放置の検知に必須・PRD Must）", async () => {
    setCurrentGroupMock({ isOrganizer: false });
    vi.mocked(listTournamentsByGroup).mockResolvedValue([
      makeTournament({
        id: "t-member-view",
        name: "Member View",
        spectateEnabled: true,
      }),
    ]);

    render(<TournamentsClient />);

    const card = await waitFor(() =>
      screen.getByRole("group", { name: /Member View/ }),
    );
    expect(within(card).getByLabelText("観戦モード公開中")).toBeInTheDocument();
  });
});
