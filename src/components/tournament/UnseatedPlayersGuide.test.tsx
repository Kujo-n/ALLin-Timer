import { render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import { UnseatedPlayersGuide } from "./UnseatedPlayersGuide";

const ts = Timestamp.fromMillis(0);

function fakePlayer(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    displayName: overrides.id,
    uid: overrides.id,
    entryAt: ts,
    isBusted: false,
    bustedAt: null,
    tableNum: 1,
    seatNum: 1,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

describe("UnseatedPlayersGuide", () => {
  it("renders nothing when everyone is seated", () => {
    render(
      <UnseatedPlayersGuide
        players={[
          fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "b1", tableNum: 2, seatNum: 1 }),
        ]}
      />,
    );
    expect(screen.queryByTestId("unseated-guide")).toBeNull();
  });

  it("shows the banner with count and name for one active unseated player", () => {
    render(
      <UnseatedPlayersGuide
        players={[
          fakePlayer({ id: "seated", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "Zara", displayName: "Zara", tableNum: null, seatNum: null }),
        ]}
      />,
    );
    const banner = screen.getByTestId("unseated-guide");
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveTextContent("1 名");
    expect(banner).toHaveTextContent("Zara");
  });

  it("excludes busted players from the unseated count", () => {
    render(
      <UnseatedPlayersGuide
        players={[
          fakePlayer({
            id: "BustedOut",
            displayName: "BustedOut",
            tableNum: null,
            seatNum: null,
            isBusted: true,
          }),
          fakePlayer({ id: "Active", displayName: "Active", tableNum: null, seatNum: null }),
        ]}
      />,
    );
    const banner = screen.getByTestId("unseated-guide");
    expect(banner).toHaveTextContent("1 名");
    expect(banner).toHaveTextContent("Active");
    expect(banner).not.toHaveTextContent("BustedOut");
  });

  it("joins multiple unseated names with 、", () => {
    render(
      <UnseatedPlayersGuide
        players={[
          fakePlayer({ id: "Alice", displayName: "Alice", tableNum: null, seatNum: null }),
          fakePlayer({ id: "Bob", displayName: "Bob", tableNum: null, seatNum: null }),
        ]}
      />,
    );
    const banner = screen.getByTestId("unseated-guide");
    expect(banner).toHaveTextContent("2 名");
    expect(banner).toHaveTextContent("Alice、Bob");
  });
});
