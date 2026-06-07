import { fireEvent, render, screen } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";
import type { TableDoc } from "@/lib/firebase/schemas/table";

import { CloseTableConfirmDialog } from "./CloseTableConfirmDialog";

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

// 卓1:1, 卓2:1, 卓3:2 → 卓3 を閉じると 2 名移動（定員内）。
function movablePlayers(): PlayerDoc[] {
  return [
    fakePlayer({ id: "a1", tableNum: 1, seatNum: 1 }),
    fakePlayer({ id: "b1", tableNum: 2, seatNum: 1 }),
    fakePlayer({ id: "c1", tableNum: 3, seatNum: 1 }),
    fakePlayer({ id: "c2", tableNum: 3, seatNum: 2 }),
  ];
}

// 卓1:10, 卓2:10, 卓3:2 → 卓3 を閉じると overflow。
function overflowPlayers(): PlayerDoc[] {
  return [
    ...Array.from({ length: 10 }, (_, i) =>
      fakePlayer({ id: `a${i + 1}`, tableNum: 1, seatNum: i + 1 }),
    ),
    ...Array.from({ length: 10 }, (_, i) =>
      fakePlayer({ id: `b${i + 1}`, tableNum: 2, seatNum: i + 1 }),
    ),
    fakePlayer({ id: "c1", tableNum: 3, seatNum: 1 }),
    fakePlayer({ id: "c2", tableNum: 3, seatNum: 2 }),
  ];
}

const tables3 = [fakeTable({ id: "1" }), fakeTable({ id: "2" }), fakeTable({ id: "3" })];

describe("CloseTableConfirmDialog", () => {
  it("shows move count and enables confirm when closing fits", () => {
    render(
      <CloseTableConfirmDialog
        tableNum={3}
        players={movablePlayers()}
        tables={tables3}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/2 名を残りの卓へまとめます/)).toBeInTheDocument();
    expect(screen.getByTestId("close-table-confirm")).toBeEnabled();
  });

  it("warns and disables confirm on overflow", () => {
    render(
      <CloseTableConfirmDialog
        tableNum={3}
        players={overflowPlayers()}
        tables={tables3}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/残卓に収まりません/)).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("収まらないため閉鎖できません");
    expect(screen.getByTestId("close-table-confirm")).toBeDisabled();
  });

  it("fires onConfirm / onCancel from the footer buttons", () => {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(
      <CloseTableConfirmDialog
        tableNum={3}
        players={movablePlayers()}
        tables={tables3}
        busy={false}
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByTestId("close-table-confirm"));
    expect(onConfirm).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole("button", { name: "キャンセル" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("renders nothing when tableNum is null", () => {
    render(
      <CloseTableConfirmDialog
        tableNum={null}
        players={movablePlayers()}
        tables={tables3}
        busy={false}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
