import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { SeasonStatsDoc } from "@/lib/firebase/schemas/seasonStats";

import { SeasonTopCardDownloadButton } from "./SeasonTopCardDownloadButton";

const SEASON_START_DATE = new Date("2026-04-01T00:00:00.000Z");
const SEASON_START = Timestamp.fromDate(SEASON_START_DATE);

function makeStats(displayName: string, totalPoints: number): SeasonStatsDoc {
  return {
    id: `uid-${displayName}`,
    uid: `uid-${displayName}`,
    displayName,
    participations: 1,
    wins: 0,
    finalTables: 0,
    totalPoints,
    lastUpdatedAt: Timestamp.now(),
  };
}

const baseGroup: Pick<GroupDoc, "name" | "seasonStartDate"> = {
  name: "サタデーサークル",
  seasonStartDate: SEASON_START,
};

describe("SeasonTopCardDownloadButton", () => {
  it("stats が空配列なら何もレンダリングしない", () => {
    const { container } = render(
      <SeasonTopCardDownloadButton gid="g-1" group={baseGroup} stats={[]} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("stats が 1 件のとき top1 だけで URL を組む", () => {
    render(
      <SeasonTopCardDownloadButton
        gid="g-1"
        group={baseGroup}
        stats={[makeStats("Alice", 47.83)]}
      />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    expect(sp.get("top1Name")).toBe("Alice");
    expect(sp.get("top1Points")).toBe("47.83");
    expect(sp.has("top2Name")).toBe(false);
    expect(sp.has("top3Name")).toBe(false);
  });

  it("stats が 5 件あっても top3 までしか使わない", () => {
    const stats: SeasonStatsDoc[] = [
      makeStats("Alice", 47.83),
      makeStats("Bob", 28.12),
      makeStats("Carol", 19.66),
      makeStats("Dave", 10.5),
      makeStats("Eve", 5.0),
    ];
    render(
      <SeasonTopCardDownloadButton gid="g-1" group={baseGroup} stats={stats} />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    expect(sp.get("top3Name")).toBe("Carol");
    expect(sp.has("top4Name")).toBe(false);
  });

  it("seasonStartDateLabel は端末 TZ で format される", () => {
    render(
      <SeasonTopCardDownloadButton
        gid="g-1"
        group={baseGroup}
        stats={[makeStats("Alice", 10)]}
      />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    expect(sp.get("seasonStartDateLabel")).toBe(
      SEASON_START_DATE.toLocaleDateString("ja-JP"),
    );
  });

  it("seasonStartDate が null のとき URL に key を出さない", () => {
    render(
      <SeasonTopCardDownloadButton
        gid="g-1"
        group={{ name: "G", seasonStartDate: null }}
        stats={[makeStats("Alice", 10)]}
      />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    expect(sp.has("seasonStartDateLabel")).toBe(false);
  });

  it("filename と filename query の stem は一致する（route の Content-Disposition と整合）", () => {
    render(
      <SeasonTopCardDownloadButton
        gid="g-1"
        group={baseGroup}
        stats={[makeStats("Alice", 10)]}
      />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const dl = a.getAttribute("download")!;
    const sp = new URLSearchParams(a.getAttribute("href")!.split("?")[1]);
    const filenameQuery = sp.get("filename");
    expect(filenameQuery).not.toBeNull();
    expect(dl).toBe(`${filenameQuery}.png`);
  });

  it("filename が ASCII safe で端末 TZ の日付を含む", () => {
    render(
      <SeasonTopCardDownloadButton
        gid="g-1"
        group={baseGroup}
        stats={[makeStats("Alice", 10)]}
      />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const dl = a.getAttribute("download")!;
    expect(dl).toMatch(/^season/);
    expect(dl).toMatch(
      new RegExp(SEASON_START_DATE.toLocaleDateString("sv-SE")),
    );
    expect(dl).toMatch(/\.png$/);
    expect(dl).not.toMatch(/[^\x00-\x7F]/);
  });

  it("seasonStartDate が null の filename は 'open' を含む", () => {
    render(
      <SeasonTopCardDownloadButton
        gid="g-1"
        group={{ name: "G", seasonStartDate: null }}
        stats={[makeStats("Alice", 10)]}
      />,
    );
    const a = screen.getByTestId("season-top-card-download") as HTMLAnchorElement;
    const dl = a.getAttribute("download")!;
    expect(dl).toContain("open");
  });
});
