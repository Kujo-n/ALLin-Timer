import { fireEvent, render, screen, within } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import type {
  StructureSnapshot,
  TournamentDoc,
} from "@/lib/firebase/schemas/tournament";

import { StructureSnapshotCard } from "./StructureSnapshotCard";

function makeSnapshot(overrides: Partial<StructureSnapshot> = {}): StructureSnapshot {
  return {
    name: "Default",
    initialStack: 10000,
    rebuyStack: null,
    addOnStack: null,
    lateEntryDeadlineLevel: 6,
    levels: [
      { level: 1, sb: 25, bb: 50, ante: 0, durationSec: 600, isBreak: false },
      { level: 2, sb: 50, bb: 100, ante: 0, durationSec: 600, isBreak: false },
      { level: 3, sb: 0, bb: 0, ante: 0, durationSec: 300, isBreak: true },
      { level: 4, sb: 75, bb: 150, ante: 25, durationSec: 1200, isBreak: false },
    ],
    ...overrides,
  };
}

describe("StructureSnapshotCard", () => {
  it("renders all levels with SB / BB / Ante / minutes", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} />);

    const rows = screen.getAllByRole("row");
    // header + 4 body rows
    expect(rows).toHaveLength(5);

    // Lv1 row: 25 / 50 / 0 / 10 分
    const lv1 = rows[1];
    expect(within(lv1).getByText("1")).toBeInTheDocument();
    expect(within(lv1).getByText("25")).toBeInTheDocument();
    expect(within(lv1).getByText("50")).toBeInTheDocument();
    // Lv4 (最後): 75 / 150 / 25 / 20 分
    const lv4 = rows[4];
    expect(within(lv4).getByText("75")).toBeInTheDocument();
    expect(within(lv4).getByText("150")).toBeInTheDocument();
    expect(within(lv4).getByText("25")).toBeInTheDocument();
    expect(within(lv4).getByText("20")).toBeInTheDocument();
  });

  it("renders break rows with BREAK label and merged columns instead of SB/BB/Ante", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} />);
    // Lv3 が break。BREAK ラベルが colspan で表示される
    const breakLabel = screen.getByText("BREAK");
    expect(breakLabel).toBeInTheDocument();
    // BREAK セルは colSpan=3
    const cell = breakLabel.closest("td");
    expect(cell).not.toBeNull();
    expect(cell).toHaveAttribute("colspan", "3");
  });

  it("does not show description by default", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} />);
    expect(
      screen.queryByText(/トーナメント作成時にコピー/),
    ).not.toBeInTheDocument();
  });

  it("shows description when showDescription is true", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} showDescription />);
    expect(
      screen.getByText(/トーナメント作成時にコピー/),
    ).toBeInTheDocument();
  });

  it("highlights the row matching currentLevel", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} currentLevel={2} />);
    const rows = screen.getAllByRole("row");
    const lv2 = rows[2]; // header + lv1 + lv2
    expect(lv2.className).toContain("bg-sky-500/10");
    // Lv1 はハイライトされない
    expect(rows[1].className).not.toContain("bg-sky-500/10");
  });

  it("highlights break row when currentLevel matches a break level", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} currentLevel={3} />);
    const rows = screen.getAllByRole("row");
    const lv3 = rows[3];
    expect(lv3.className).toContain("ring-2");
  });

  it("does not highlight any row when currentLevel is undefined or 0", () => {
    const { rerender } = render(<StructureSnapshotCard snapshot={makeSnapshot()} />);
    let rows = screen.getAllByRole("row");
    rows.slice(1).forEach((r) => {
      expect(r.className).not.toContain("bg-sky-500/10");
      expect(r.className).not.toContain("ring-2");
    });

    rerender(<StructureSnapshotCard snapshot={makeSnapshot()} currentLevel={0} />);
    rows = screen.getAllByRole("row");
    rows.slice(1).forEach((r) => {
      expect(r.className).not.toContain("bg-sky-500/10");
      expect(r.className).not.toContain("ring-2");
    });
  });
});

describe("StructureSnapshotCard — editing (Phase 5.2)", () => {
  const baseTs = Timestamp.fromMillis(0);
  function makeTournament(
    state: TournamentDoc["state"],
    currentLevel: number,
    snapshot: StructureSnapshot,
  ): TournamentDoc {
    return {
      id: "t1",
      groupId: "g1",
      createdByUid: "u1",
      name: "T",
      structureSnapshot: snapshot,
      state,
      startedAt: null,
      levelStartedAt: null,
      pausedAt: null,
      pausedAccumMs: 0,
      finishedAt: null,
      currentLevel,
      lateEntryDeadlineLevel: 6,
      seatsPerTable: 9,
      spectateEnabled: false,
      createdAt: baseTs,
      updatedAt: baseTs,
    };
  }

  it("does not render edit affordance when canEdit is undefined (read-only legacy path)", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} />);
    expect(
      screen.queryByRole("button", { name: /時間を変更/ }),
    ).not.toBeInTheDocument();
  });

  it("does not render edit affordance when canEdit=true but tournament is missing", () => {
    render(
      <StructureSnapshotCard
        snapshot={makeSnapshot()}
        canEdit
        onUpdateDurationSec={vi.fn()}
        onEditError={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /時間を変更/ }),
    ).not.toBeInTheDocument();
  });

  it("renders edit affordance for current and future levels when running", () => {
    const snapshot = makeSnapshot();
    const tournament = makeTournament("running", 2, snapshot); // currentLevel=2 (1-based)
    render(
      <StructureSnapshotCard
        snapshot={snapshot}
        currentLevel={2}
        canEdit
        tournament={tournament}
        onUpdateDurationSec={vi.fn()}
        onEditError={vi.fn()}
      />,
    );
    // Lv1 は過去なので編集ボタンなし
    expect(
      screen.queryByRole("button", { name: "Lv 1 の時間を変更" }),
    ).not.toBeInTheDocument();
    // Lv2 (現在) と Lv3 (未来 break) と Lv4 (未来) は編集ボタンあり
    expect(
      screen.getByRole("button", { name: "Lv 2 の時間を変更" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lv 3 の時間を変更" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Lv 4 の時間を変更" }),
    ).toBeInTheDocument();
  });

  it("renders edit affordance for all levels during setup", () => {
    const snapshot = makeSnapshot();
    const tournament = makeTournament("setup", 0, snapshot);
    render(
      <StructureSnapshotCard
        snapshot={snapshot}
        canEdit
        tournament={tournament}
        onUpdateDurationSec={vi.fn()}
        onEditError={vi.fn()}
      />,
    );
    // 全レベル編集可
    [1, 2, 3, 4].forEach((lv) => {
      expect(
        screen.getByRole("button", { name: `Lv ${lv} の時間を変更` }),
      ).toBeInTheDocument();
    });
  });

  it("does not render edit affordance for any level when finished", () => {
    const snapshot = makeSnapshot();
    const tournament = makeTournament("finished", 4, snapshot);
    render(
      <StructureSnapshotCard
        snapshot={snapshot}
        canEdit
        tournament={tournament}
        onUpdateDurationSec={vi.fn()}
        onEditError={vi.fn()}
      />,
    );
    [1, 2, 3, 4].forEach((lv) => {
      expect(
        screen.queryByRole("button", { name: `Lv ${lv} の時間を変更` }),
      ).not.toBeInTheDocument();
    });
  });

  it("does not render edit affordance when canEdit is false even with full props", () => {
    const snapshot = makeSnapshot();
    const tournament = makeTournament("setup", 0, snapshot);
    render(
      <StructureSnapshotCard
        snapshot={snapshot}
        canEdit={false}
        tournament={tournament}
        onUpdateDurationSec={vi.fn()}
        onEditError={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /時間を変更/ }),
    ).not.toBeInTheDocument();
  });
});

describe("StructureSnapshotCard — append (Phase 5.3)", () => {
  it("renders append button when canAppend=true and onAppendLevel is provided", () => {
    render(
      <StructureSnapshotCard
        snapshot={makeSnapshot()}
        canAppend
        onAppendLevel={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "レベル追加" }),
    ).toBeInTheDocument();
  });

  it("does not render append button when canAppend is undefined (regression 0 for /live)", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} />);
    expect(
      screen.queryByRole("button", { name: "レベル追加" }),
    ).not.toBeInTheDocument();
  });

  it("does not render append button when canAppend=false", () => {
    render(
      <StructureSnapshotCard
        snapshot={makeSnapshot()}
        canAppend={false}
        onAppendLevel={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "レベル追加" }),
    ).not.toBeInTheDocument();
  });

  it("does not render append button when canAppend=true but onAppendLevel is missing", () => {
    render(<StructureSnapshotCard snapshot={makeSnapshot()} canAppend />);
    expect(
      screen.queryByRole("button", { name: "レベル追加" }),
    ).not.toBeInTheDocument();
  });

  it("opens AppendLevelDialog showing 'レベル N を末尾に追加' when append button is clicked", () => {
    render(
      <StructureSnapshotCard
        snapshot={makeSnapshot()}
        canAppend
        onAppendLevel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "レベル追加" }));
    // makeSnapshot() は 4 levels なので新規は Lv 5
    expect(screen.getByText("レベル 5 を末尾に追加")).toBeInTheDocument();
  });
});
