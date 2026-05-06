import { Timestamp } from "firebase/firestore";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { PlayerDoc } from "@/lib/firebase/schemas/player";

import {
  ClonePlayersChecklist,
  initialSelectedIdsFromPlayers,
} from "./ClonePlayersChecklist";

const ts = Timestamp.fromDate(new Date("2026-04-20T10:00:00Z"));

function player(overrides: Partial<PlayerDoc>): PlayerDoc {
  return {
    id: "u1",
    displayName: "alice",
    uid: "u1",
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

describe("ClonePlayersChecklist", () => {
  it("render: 全 player を表示し、busted には「（バスト）」サフィックスを付ける", () => {
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "u2", uid: "u2", displayName: "bob", isBusted: true }),
      player({ id: "u3", uid: "u3", displayName: "carol" }),
    ];
    render(
      <ClonePlayersChecklist
        players={players}
        selected={new Set()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("carol")).toBeInTheDocument();
    expect(screen.getByText(/bob/)).toBeInTheDocument();
    expect(screen.getByText("（バスト）")).toBeInTheDocument();
  });

  it("uid===null の player は描画されない（防衛）", () => {
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "guest", uid: null, displayName: "guest" }),
    ];
    render(
      <ClonePlayersChecklist
        players={players}
        selected={new Set()}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.queryByText("guest")).not.toBeInTheDocument();
  });

  it("initialSelectedIdsFromPlayers: busted / uid===null は含めず、それ以外を初期 ON で返す", () => {
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "u2", uid: "u2", displayName: "bob", isBusted: true }),
      player({ id: "guest", uid: null, displayName: "guest" }),
      player({ id: "u3", uid: "u3", displayName: "carol" }),
    ];
    const init = initialSelectedIdsFromPlayers(players);
    expect(init.has("u1")).toBe(true);
    expect(init.has("u3")).toBe(true);
    expect(init.has("u2")).toBe(false);
    expect(init.has("guest")).toBe(false);
    expect(init.size).toBe(2);
  });

  it("個別 toggle: checkbox click で onChange が呼ばれ、対象 ID が toggle される", () => {
    const onChange = vi.fn();
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "u2", uid: "u2", displayName: "bob" }),
    ];
    render(
      <ClonePlayersChecklist
        players={players}
        selected={new Set(["u1"])}
        onChange={onChange}
      />,
    );
    const aliceBox = screen.getByTestId("clone-checkbox-alice");
    fireEvent.click(aliceBox);
    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(next.has("u1")).toBe(false);
    expect(next.has("u2")).toBe(false);

    onChange.mockReset();
    const bobBox = screen.getByTestId("clone-checkbox-bob");
    fireEvent.click(bobBox);
    const next2 = onChange.mock.calls[0][0] as Set<string>;
    expect(next2.has("u1")).toBe(true);
    expect(next2.has("u2")).toBe(true);
  });

  it("全選択ボタン: eligible 全 ID を持つ Set を onChange に渡す", () => {
    const onChange = vi.fn();
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "u2", uid: "u2", displayName: "bob" }),
      player({ id: "guest", uid: null, displayName: "guest" }),
    ];
    render(
      <ClonePlayersChecklist
        players={players}
        selected={new Set()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "全選択" }));
    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(next.has("u1")).toBe(true);
    expect(next.has("u2")).toBe(true);
    expect(next.has("guest")).toBe(false);
    expect(next.size).toBe(2);
  });

  it("全解除ボタン: 空 Set を onChange に渡す", () => {
    const onChange = vi.fn();
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "u2", uid: "u2", displayName: "bob" }),
    ];
    render(
      <ClonePlayersChecklist
        players={players}
        selected={new Set(["u1", "u2"])}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "全解除" }));
    const next = onChange.mock.calls[0][0] as Set<string>;
    expect(next.size).toBe(0);
  });

  it("選択件数 badge: 「N / total 名選択」を表示", () => {
    const players = [
      player({ id: "u1", uid: "u1", displayName: "alice" }),
      player({ id: "u2", uid: "u2", displayName: "bob" }),
      player({ id: "u3", uid: "u3", displayName: "carol" }),
    ];
    render(
      <ClonePlayersChecklist
        players={players}
        selected={new Set(["u1", "u3"])}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText("参加者（2 / 3 名選択）")).toBeInTheDocument();
  });
});
