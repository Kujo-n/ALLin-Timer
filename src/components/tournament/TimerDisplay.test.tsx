import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { TournamentDoc } from "@/lib/firebase/schemas/tournament";
import { getLevelInfo, type LevelInfo } from "@/lib/services/timer";

import { TimerDisplay } from "./TimerDisplay";

const baseCreatedAt = Timestamp.fromDate(new Date("2026-04-19T00:00:00Z"));
const levelStartedAt = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

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
        { level: 3, sb: 75, bb: 150, ante: 25, durationSec: 600, isBreak: false },
      ],
    },
    state: "running",
    startedAt: levelStartedAt,
    levelStartedAt,
    pausedAt: null,
    pausedAccumMs: 0,
    finishedAt: null,
    currentLevel: 1,
    lateEntryDeadlineLevel: 6,
    seatsPerTable: 9,
    createdAt: baseCreatedAt,
    updatedAt: baseCreatedAt,
    ...overrides,
  };
}

describe("TimerDisplay — setup / seating preview", () => {
  it("shows Lv1 preview when state is setup (currentLevel=0)", () => {
    const tournament = makeTournament({ state: "setup", currentLevel: 0 });
    // setup 中は getLevelInfo が null を返す契約。
    render(<TimerDisplay tournament={tournament} remainingMs={null} levelInfo={null} />);

    expect(screen.getByText("Lv 1")).toBeInTheDocument();
    expect(screen.getByText("開始前")).toBeInTheDocument();
    // 残り時間は levels[0].durationSec * 1000 = 600s = 10:00
    expect(screen.getByLabelText("残り時間").textContent).toBe("10:00");
    expect(
      screen.getByText((text) => text.startsWith("SB 25")),
    ).toBeInTheDocument();
    // 次のレベルもプレビューされる
    expect(
      screen.getByText((text) => text.includes("Next: Lv 2")),
    ).toBeInTheDocument();
    // setup/seating 中は「同期中…」を出さない（remainingMs が null でも）
    expect(screen.queryByText("同期中…")).not.toBeInTheDocument();
  });

  it("shows Lv1 preview when state is seating", () => {
    const tournament = makeTournament({ state: "seating", currentLevel: 0 });
    render(<TimerDisplay tournament={tournament} remainingMs={null} levelInfo={null} />);

    expect(screen.getByText("Lv 1")).toBeInTheDocument();
    expect(screen.getByText("開始前")).toBeInTheDocument();
    expect(screen.getByLabelText("残り時間").textContent).toBe("10:00");
  });
});

describe("TimerDisplay — running / paused / finished", () => {
  it("keeps existing behaviour when running (uses levelInfo / remainingMs)", () => {
    const tournament = makeTournament({ state: "running", currentLevel: 2 });
    const levelInfo = getLevelInfo(tournament) as LevelInfo;
    render(
      <TimerDisplay
        tournament={tournament}
        remainingMs={595_000}
        levelInfo={levelInfo}
      />,
    );

    expect(screen.getByText("Lv 2")).toBeInTheDocument();
    expect(screen.getByText("進行中")).toBeInTheDocument();
    expect(screen.getByLabelText("残り時間").textContent).toBe("09:55");
    expect(
      screen.getByText((text) => text.includes("Next: Lv 3") && text.includes("ante 25")),
    ).toBeInTheDocument();
  });

  it("shows 同期中… only when remainingMs is null AND state is running/paused/finished", () => {
    const tournament = makeTournament({ state: "running", currentLevel: 1 });
    render(
      <TimerDisplay tournament={tournament} remainingMs={null} levelInfo={null} />,
    );
    expect(screen.getByText("同期中…")).toBeInTheDocument();
  });

  it("shows 一時停止中 badge when paused", () => {
    const tournament = makeTournament({
      state: "paused",
      pausedAt: Timestamp.fromMillis(levelStartedAt.toMillis() + 30_000),
    });
    render(
      <TimerDisplay
        tournament={tournament}
        remainingMs={570_000}
        levelInfo={getLevelInfo(tournament)}
      />,
    );
    expect(screen.getByText("一時停止中")).toBeInTheDocument();
  });

  it("shows 最終レベル when on last level", () => {
    const tournament = makeTournament({ state: "running", currentLevel: 3 });
    render(
      <TimerDisplay
        tournament={tournament}
        remainingMs={100_000}
        levelInfo={getLevelInfo(tournament)}
      />,
    );
    expect(screen.getByText("最終レベル")).toBeInTheDocument();
  });
});

describe("TimerDisplay — break level (Phase 4.7)", () => {
  it("shows ☕ BREAK instead of SB/BB/Ante when current level is a break", () => {
    const tournament = makeTournament({
      state: "running",
      currentLevel: 2,
      structureSnapshot: {
        name: "With break",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
          { level: 3, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        ],
      },
    });
    render(
      <TimerDisplay
        tournament={tournament}
        remainingMs={180_000}
        levelInfo={getLevelInfo(tournament)}
      />,
    );
    expect(screen.getByText("BREAK")).toBeInTheDocument();
    // SB / BB 表示は出ない
    expect(screen.queryByText((t) => t.startsWith("SB 0"))).not.toBeInTheDocument();
  });

  it("shows Next: Lv X (☕ BREAK) when next level is a break", () => {
    const tournament = makeTournament({
      state: "running",
      currentLevel: 1,
      structureSnapshot: {
        name: "With break next",
        initialStack: 10000,
        rebuyStack: null,
        addOnStack: null,
        lateEntryDeadlineLevel: 6,
        levels: [
          { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
          { level: 2, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
          { level: 3, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
        ],
      },
    });
    render(
      <TimerDisplay
        tournament={tournament}
        remainingMs={595_000}
        levelInfo={getLevelInfo(tournament)}
      />,
    );
    expect(
      screen.getByText((t) => t.includes("Next: Lv 2") && t.includes("BREAK")),
    ).toBeInTheDocument();
  });
});
