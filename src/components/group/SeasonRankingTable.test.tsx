import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SeasonRankingTable, type SeasonRankingRow } from "./SeasonRankingTable";

function makeRow(overrides: Partial<SeasonRankingRow> = {}): SeasonRankingRow {
  return {
    id: "u-1",
    displayName: "Alice",
    participations: 5,
    wins: 2,
    finalTables: 3,
    totalPoints: 47.83,
    ...overrides,
  };
}

describe("SeasonRankingTable", () => {
  it("rows=[] のときは 6 列ヘッダのみで data 行は描画しない", () => {
    render(<SeasonRankingTable rows={[]} />);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual([
      "順位",
      "表示名",
      "参加",
      "優勝",
      "FT",
      "累計ポイント",
    ]);
    // ヘッダ行のみ（data 行 0）。
    expect(screen.getAllByRole("row")).toHaveLength(1);
  });

  it("行を渡した順序で描画し、順位は 1 始まりで採番する", () => {
    render(
      <SeasonRankingTable
        rows={[
          makeRow({ id: "u-alice", displayName: "Alice" }),
          makeRow({ id: "u-bob", displayName: "Bob" }),
        ]}
      />,
    );
    // ヘッダ 1 + data 2 = 3 行
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);

    const firstDataRow = rows[1];
    const secondDataRow = rows[2];
    expect(firstDataRow.textContent).toContain("Alice");
    expect(firstDataRow.querySelector("td")?.textContent).toBe("1");
    expect(secondDataRow.textContent).toContain("Bob");
    expect(secondDataRow.querySelector("td")?.textContent).toBe("2");
  });

  it("各列値を描画する", () => {
    render(
      <SeasonRankingTable
        rows={[
          makeRow({
            id: "u-1",
            displayName: "Alice",
            participations: 5,
            wins: 2,
            finalTables: 3,
            totalPoints: 47.83,
          }),
        ]}
      />,
    );
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("totalPoints を toFixed(2) で表示する（端数・0 とも）", () => {
    render(
      <SeasonRankingTable
        rows={[
          makeRow({ id: "u-a", displayName: "A", totalPoints: 47.8 }),
          makeRow({ id: "u-b", displayName: "B", totalPoints: 0 }),
        ]}
      />,
    );
    expect(screen.getByText("47.80 pt")).toBeInTheDocument();
    expect(screen.getByText("0.00 pt")).toBeInTheDocument();
  });
});
