import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc, TournamentState } from "@/lib/firebase/schemas/tournament";

import { PlayersCard } from "./PlayersCard";

const ts = Timestamp.fromMillis(0);

function makeTournament(overrides: Partial<TournamentDoc> = {}): TournamentDoc {
  return {
    id: "t1",
    groupId: "g1",
    createdByUid: "u1",
    name: "Monthly",
    structureSnapshot: {
      name: "Default",
      initialStack: 10000,
      rebuyStack: null,
      addOnStack: null,
      lateEntryDeadlineLevel: 6,
      levels: [{ level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false }],
    },
    state: "running" as TournamentState,
    startedAt: ts,
    levelStartedAt: ts,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function makePlayer(id: string, isBusted = false): PlayerDoc {
  return {
    id,
    displayName: id,
    uid: id,
    entryAt: ts,
    isBusted,
    bustedAt: isBusted ? ts : null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
  };
}

describe("PlayersCard", () => {
  it("renders active / total when running", () => {
    const players = [
      makePlayer("p1"),
      makePlayer("p2"),
      makePlayer("p3", true),
      makePlayer("p4", true),
    ];
    render(<PlayersCard tournament={makeTournament()} players={players} />);
    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // active
    expect(screen.getByText("4")).toBeInTheDocument(); // total
    // ラベルテキストはアイコンタイトルに統一したため、その他のキャプションは出さない。
    expect(screen.queryByText(/残り|母数/)).not.toBeInTheDocument();
  });

  it("renders when paused", () => {
    render(
      <PlayersCard
        tournament={makeTournament({ state: "paused" })}
        players={[makePlayer("p1"), makePlayer("p2")]}
      />,
    );
    expect(screen.getByText("Players")).toBeInTheDocument();
  });

  it("does not render when state is setup", () => {
    const { container } = render(
      <PlayersCard
        tournament={makeTournament({ state: "setup" })}
        players={[makePlayer("p1")]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when state is seating", () => {
    const { container } = render(
      <PlayersCard
        tournament={makeTournament({ state: "seating" })}
        players={[makePlayer("p1")]}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders in finished state so the right column stays visible after winner", () => {
    // Phase 4.12: 優勝者決定（state=finished）後も Players は消さない
    render(
      <PlayersCard
        tournament={makeTournament({ state: "finished" })}
        players={[makePlayer("p1")]}
      />,
    );
    expect(screen.getByText("Players")).toBeInTheDocument();
  });

  it("does not render when players list is empty", () => {
    const { container } = render(
      <PlayersCard tournament={makeTournament()} players={[]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 0 active when all players are busted (still rendered while running)", () => {
    const players = [makePlayer("p1", true), makePlayer("p2", true)];
    render(<PlayersCard tournament={makeTournament()} players={players} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
