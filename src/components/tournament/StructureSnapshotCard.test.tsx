import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { StructureSnapshot } from "@/lib/firebase/schemas/tournament";

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
