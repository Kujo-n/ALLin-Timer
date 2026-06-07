import { fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";

import { SeatingBoard } from "./SeatingBoard";

const ts = Timestamp.fromMillis(0);

function fakePlayer(overrides: Partial<PlayerDoc> & { id: string }): PlayerDoc {
  return {
    displayName: overrides.id,
    uid: overrides.id,
    entryAt: ts,
    isBusted: false,
    bustedAt: null,
    tableNum: null,
    seatNum: null,
    lastMovedAt: null,
    isPlayingDealer: false,
    ...overrides,
  };
}

function fakeTable(overrides: Partial<TableDoc> & { id: string }): TableDoc {
  return {
    tableNum: Number(overrides.id),
    isBroken: false,
    createdAt: ts,
    label: null,
    color: null,
    ...overrides,
  };
}

describe("SeatingBoard — Phase 3 close button", () => {
  it("renders close buttons per live table and fires onCloseTable on click", () => {
    const onCloseTable = vi.fn();
    render(
      <SeatingBoard
        players={[
          fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "b1", tableNum: 2, seatNum: 1 }),
        ]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "2" })]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={onCloseTable}
      />,
    );
    expect(screen.getByTestId("close-table-1")).toBeInTheDocument();
    expect(screen.getByTestId("close-table-2")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("close-table-1"));
    expect(onCloseTable).toHaveBeenCalledWith(1);
  });

  it("hides the close button when only one live table remains", () => {
    render(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" })]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("close-table-1")).toBeNull();
  });

  it("hides the close button when canCloseTable is false", () => {
    render(
      <SeatingBoard
        players={[
          fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "b1", tableNum: 2, seatNum: 1 }),
        ]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "2" })]}
        seatsPerTable={6}
        canCloseTable={false}
        onCloseTable={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("close-table-1")).toBeNull();
    expect(screen.queryByTestId("close-table-2")).toBeNull();
  });

  it("renders players beyond seatsPerTable (temporary capacity raise)", () => {
    // seatsPerTable=6 でも seatNum=8 の player が描画される（max(6, 8)=8 行）。
    render(
      <SeatingBoard
        players={[
          fakePlayer({ id: "a1", displayName: "Alice", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "z9", displayName: "Zoe", tableNum: 1, seatNum: 8 }),
        ]}
        tables={[fakeTable({ id: "1" })]}
        seatsPerTable={6}
      />,
    );
    expect(screen.getByText("Zoe")).toBeInTheDocument();
  });

  it("broken table shows the 閉鎖 badge and no close button", () => {
    render(
      <SeatingBoard
        players={[
          fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "b1", tableNum: 2, seatNum: 1 }),
        ]}
        tables={[
          fakeTable({ id: "1" }),
          fakeTable({ id: "2" }),
          fakeTable({ id: "3", isBroken: true }),
        ]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={vi.fn()}
      />,
    );
    expect(screen.getByText("閉鎖")).toBeInTheDocument();
    expect(screen.queryByTestId("close-table-3")).toBeNull();
    // 生存卓には閉じるボタンが出る。
    expect(screen.getByTestId("close-table-1")).toBeInTheDocument();
  });
});
