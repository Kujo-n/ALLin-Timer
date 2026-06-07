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

describe("SeatingBoard — Phase 4 reopen button", () => {
  it("renders the reopen button for a broken table and not the close button (exclusive)", () => {
    render(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "3", isBroken: true })]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={vi.fn()}
        onReopenTable={vi.fn()}
      />,
    );
    expect(screen.getByTestId("reopen-table-3")).toBeInTheDocument();
    // broken 卓には「閉じる」ボタンが出ない（排他）。
    expect(screen.queryByTestId("close-table-3")).toBeNull();
  });

  it("does not render a reopen button for a live (non-broken) table", () => {
    render(
      <SeatingBoard
        players={[
          fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 }),
          fakePlayer({ id: "b1", tableNum: 2, seatNum: 1 }),
        ]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "2" })]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={vi.fn()}
        onReopenTable={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("reopen-table-1")).toBeNull();
    expect(screen.queryByTestId("reopen-table-2")).toBeNull();
  });

  it("hides the reopen button when canCloseTable is false", () => {
    render(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "3", isBroken: true })]}
        seatsPerTable={6}
        canCloseTable={false}
        onReopenTable={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("reopen-table-3")).toBeNull();
  });

  it("fires onReopenTable with the tableNum on click", () => {
    const onReopenTable = vi.fn();
    render(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "3", isBroken: true })]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={vi.fn()}
        onReopenTable={onReopenTable}
      />,
    );
    fireEvent.click(screen.getByTestId("reopen-table-3"));
    expect(onReopenTable).toHaveBeenCalledWith(3);
  });

  it("disables the reopen button (and suppresses clicks) while reopenBusy", () => {
    const onReopenTable = vi.fn();
    render(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "3", isBroken: true })]}
        seatsPerTable={6}
        canCloseTable
        onCloseTable={vi.fn()}
        onReopenTable={onReopenTable}
        reopenBusy
      />,
    );
    const btn = screen.getByTestId("reopen-table-3");
    expect(btn).toBeDisabled();
    // disabled button のクリックは handler を発火しない（二度押し抑止）。
    fireEvent.click(btn);
    expect(onReopenTable).not.toHaveBeenCalled();
  });

  it("reopened (non-broken) empty seats become droppable, broken ones do not", () => {
    // 再開後（isBroken=false）の空席は既存 drop target 条件で droppable になることの lock-in。
    // canManage=true + onMoveSeat 渡しで D&D が有効化される。
    const { rerender } = render(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "3", isBroken: true })]}
        seatsPerTable={2}
        canManage
        onMoveSeat={vi.fn()}
      />,
    );
    // broken の卓3 の空席は droppable でない。
    expect(screen.queryByLabelText("droppable-3-1")).toBeNull();

    // 再開（isBroken=false）すると卓3 の空席が droppable になる。
    rerender(
      <SeatingBoard
        players={[fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 })]}
        tables={[fakeTable({ id: "1" }), fakeTable({ id: "3", isBroken: false })]}
        seatsPerTable={2}
        canManage
        onMoveSeat={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("droppable-3-1")).toBeInTheDocument();
  });
});
