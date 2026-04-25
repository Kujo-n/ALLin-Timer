import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { TournamentDoc, TournamentState } from "@/lib/firebase/schemas/tournament";

import { NextBreakCard } from "./NextBreakCard";

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
      levels: [
        { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
        { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
        { level: 4, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
      ],
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

describe("NextBreakCard", () => {
  it("does not render when state is setup", () => {
    const { container } = render(
      <NextBreakCard tournament={makeTournament({ state: "setup" })} remainingMs={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when state is seating", () => {
    const { container } = render(
      <NextBreakCard tournament={makeTournament({ state: "seating" })} remainingMs={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("does not render when state is finished", () => {
    const { container } = render(
      <NextBreakCard tournament={makeTournament({ state: "finished" })} remainingMs={0} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 予定なし when no break level remains in the structure", () => {
    const t = makeTournament({
      structureSnapshot: {
        name: "no break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        ],
      },
    });
    render(<NextBreakCard tournament={t} remainingMs={500_000} />);
    expect(screen.getByText("Next Break In")).toBeInTheDocument();
    expect(screen.getByText("予定なし")).toBeInTheDocument();
  });

  it("shows ☕ Break中 when current level itself is a break", () => {
    // currentLevel=3 (break)
    render(
      <NextBreakCard
        tournament={makeTournament({ currentLevel: 3 })}
        remainingMs={120_000}
      />,
    );
    expect(screen.getByText("☕ Break中")).toBeInTheDocument();
  });

  it("formats ETA in mm:ss when under 1 hour and shows levelsAhead", () => {
    // currentLevel=1 残り 500s, Lv2=600s → break at Lv3, eta=1100s = 18:20
    render(
      <NextBreakCard
        tournament={makeTournament({ currentLevel: 1 })}
        remainingMs={500_000}
      />,
    );
    expect(screen.getByText("18:20")).toBeInTheDocument();
    expect(
      screen.getByText((t) => t.includes("Lv 3 で break") && t.includes("あと 2 レベル")),
    ).toBeInTheDocument();
  });

  it("formats ETA in h:mm:ss when 1 hour or longer", () => {
    const t = makeTournament({
      currentLevel: 1,
      structureSnapshot: {
        name: "long",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          // 各 60 分 (3600s) × 3 + break
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 3600, isBreak: false },
          { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 3600, isBreak: false },
          { level: 3, sb: 75, bb: 150, ante: 0, durationSec: 3600, isBreak: false },
          { level: 4, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
        ],
      },
    });
    // current 残 30 分 + Lv2 60 分 + Lv3 60 分 = 150 分 = 2:30:00
    render(<NextBreakCard tournament={t} remainingMs={30 * 60 * 1000} />);
    expect(screen.getByText("2:30:00")).toBeInTheDocument();
  });
});
