import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import { PlayersCard } from "./PlayersCard";

const ts = Timestamp.fromMillis(0);

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
    isPlayingDealer: false,
  };
}

describe("PlayersCard", () => {
  it("renders active / total", () => {
    const players = [
      makePlayer("p1"),
      makePlayer("p2"),
      makePlayer("p3", true),
      makePlayer("p4", true),
    ];
    render(<PlayersCard players={players} />);
    expect(screen.getByText("Players")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument(); // active
    expect(screen.getByText("4")).toBeInTheDocument(); // total
    // ラベルテキストはアイコンタイトルに統一したため、その他のキャプションは出さない。
    expect(screen.queryByText(/残り|母数/)).not.toBeInTheDocument();
  });

  it("renders with multiple players", () => {
    render(<PlayersCard players={[makePlayer("p1"), makePlayer("p2")]} />);
    expect(screen.getByText("Players")).toBeInTheDocument();
  });

  it("renders with 1 player (Phase 4.14: setup/seating でも受付済みがいれば表示)", () => {
    render(<PlayersCard players={[makePlayer("p1")]} />);
    expect(screen.getByText("Players")).toBeInTheDocument();
    // active === total === 1（busted は setup では発生しない）
    expect(screen.getAllByText("1").length).toBeGreaterThan(0);
  });

  it("does not render when players list is empty", () => {
    const { container } = render(<PlayersCard players={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows 0 active when all players are busted (still rendered)", () => {
    const players = [makePlayer("p1", true), makePlayer("p2", true)];
    render(<PlayersCard players={players} />);
    expect(screen.getByText("0")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
