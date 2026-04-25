import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TournamentDoc, TournamentState } from "@/lib/firebase/schemas/tournament";

import { AverageStackCard } from "./AverageStackCard";

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

describe("AverageStackCard", () => {
  it("renders average = totalChips / activePlayers when running", () => {
    const tournament = makeTournament();
    const players = Array.from({ length: 20 }, (_, i) => makePlayer(`p${i}`, i < 15));
    render(<AverageStackCard tournament={tournament} players={players} />);
    // active = 5, totalChips = 20 * 10000 = 200_000, average = 40_000
    expect(screen.getByText("Average Stack")).toBeInTheDocument();
    expect(screen.getByText("40,000")).toBeInTheDocument();
    // 人数表示は PlayersCard に移管したため、ここでは出さない。
    expect(screen.queryByText(/参加|残/)).not.toBeInTheDocument();
  });

  it("renders when paused", () => {
    const tournament = makeTournament({ state: "paused" });
    const players = [makePlayer("p1"), makePlayer("p2")];
    render(<AverageStackCard tournament={tournament} players={players} />);
    expect(screen.getByText("10,000")).toBeInTheDocument();
  });

  it("does not render when state is setup", () => {
    const tournament = makeTournament({ state: "setup" });
    const { container } = render(
      <AverageStackCard tournament={tournament} players={[makePlayer("p1")]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when state is seating", () => {
    const tournament = makeTournament({ state: "seating" });
    const { container } = render(
      <AverageStackCard tournament={tournament} players={[makePlayer("p1")]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders in finished state so the right column stays visible after winner", () => {
    // Phase 4.12: 優勝者決定（state=finished）後も Average Stack は消さない
    const tournament = makeTournament({ state: "finished" });
    render(<AverageStackCard tournament={tournament} players={[makePlayer("p1")]} />);
    expect(screen.getByText("Average Stack")).toBeInTheDocument();
  });

  it("does not render when no players", () => {
    const tournament = makeTournament();
    const { container } = render(<AverageStackCard tournament={tournament} players={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when all players are busted (active=0)", () => {
    const tournament = makeTournament();
    const players = [makePlayer("p1", true), makePlayer("p2", true)];
    const { container } = render(
      <AverageStackCard tournament={tournament} players={players} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
