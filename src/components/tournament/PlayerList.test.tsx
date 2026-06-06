import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Timestamp } from "firebase/firestore";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { GroupDoc } from "@/lib/firebase/schemas/group";
import type { PlayerDoc } from "@/lib/firebase/schemas/player";

// PlayerList が import する firebase 依存 service を mock し、jsdom で firebase 初期化を回避する。
vi.mock("@/lib/services/receipt", () => ({
  cancelPlayerEntry: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/services/seating/orchestrator", () => ({
  bustPlayer: vi.fn().mockResolvedValue(undefined),
  unbustPlayer: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/lib/services/proxy-receipt", () => ({
  addMemberPlayerByOrganizer: vi.fn().mockResolvedValue(undefined),
  addNamedOnlyPlayerByOrganizer: vi.fn().mockResolvedValue("pid-x"),
  updatePlayerDisplayNameByOrganizer: vi.fn().mockResolvedValue(undefined),
}));

import { updatePlayerDisplayNameByOrganizer } from "@/lib/services/proxy-receipt";

import { PlayerList } from "./PlayerList";

const ts = Timestamp.fromMillis(0);

function makePlayer(id: string, overrides: Partial<PlayerDoc> = {}): PlayerDoc {
  return {
    id,
    displayName: id,
    uid: id,
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

function fakeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g-1",
    name: "Test Group",
    ownerUids: ["owner"],
    organizerUids: ["owner", "org"],
    memberUids: ["owner", "org", "eve"],
    memberDisplayNames: { eve: "Eve" },
    ...overrides,
  } as GroupDoc;
}

beforeEach(() => {
  vi.mocked(updatePlayerDisplayNameByOrganizer).mockReset().mockResolvedValue(undefined);
});

describe("PlayerList — 受付代理 UI", () => {
  it("uid===null の行に「管理専用」バッジと edit ボタンを出す", () => {
    render(
      <PlayerList
        tid="t-1"
        players={[makePlayer("guest-1", { uid: null, displayName: "Dave" })]}
        canManage
        tournamentState="setup"
        organizerUid="org"
      />,
    );
    expect(screen.getByText("管理専用")).toBeInTheDocument();
    expect(screen.getByLabelText("Dave の表示名を編集")).toBeInTheDocument();
  });

  it("uid!==null の行にはバッジ・edit ボタンを出さない", () => {
    render(
      <PlayerList
        tid="t-1"
        players={[makePlayer("u1", { displayName: "Alice" })]}
        canManage
        tournamentState="setup"
        organizerUid="org"
      />,
    );
    expect(screen.queryByText("管理専用")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Alice の表示名を編集")).not.toBeInTheDocument();
  });

  it("canManage && canAddParticipant && group && organizerUid のとき「参加者を追加」を出す", () => {
    render(
      <PlayerList
        tid="t-1"
        players={[]}
        canManage
        tournamentState="setup"
        group={fakeGroup()}
        organizerUid="org"
        canAddParticipant
      />,
    );
    expect(screen.getByRole("button", { name: "参加者を追加" })).toBeInTheDocument();
  });

  it("canAddParticipant=false のとき「参加者を追加」を出さない", () => {
    render(
      <PlayerList
        tid="t-1"
        players={[]}
        canManage
        tournamentState="finished"
        group={fakeGroup()}
        organizerUid="org"
        canAddParticipant={false}
      />,
    );
    expect(screen.queryByRole("button", { name: "参加者を追加" })).not.toBeInTheDocument();
  });

  it("編集 submit で updatePlayerDisplayNameByOrganizer が呼ばれる", async () => {
    render(
      <PlayerList
        tid="t-1"
        players={[makePlayer("guest-1", { uid: null, displayName: "Dave" })]}
        canManage
        tournamentState="setup"
        organizerUid="org"
      />,
    );
    fireEvent.click(screen.getByLabelText("Dave の表示名を編集"));
    const input = screen.getByLabelText("表示名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dave2" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    await waitFor(() =>
      expect(updatePlayerDisplayNameByOrganizer).toHaveBeenCalledWith({
        tid: "t-1",
        organizerUid: "org",
        pid: "guest-1",
        displayName: "Dave2",
      }),
    );
  });

  it("編集 submit が service エラー時に role=alert を表示し、ダイアログを閉じない", async () => {
    vi.mocked(updatePlayerDisplayNameByOrganizer).mockRejectedValueOnce(
      new AppError("表示名は 15 文字以内で入力してください", "validation/display-name-too-long"),
    );
    render(
      <PlayerList
        tid="t-1"
        players={[makePlayer("guest-1", { uid: null, displayName: "Dave" })]}
        canManage
        tournamentState="setup"
        organizerUid="org"
      />,
    );
    fireEvent.click(screen.getByLabelText("Dave の表示名を編集"));
    const input = screen.getByLabelText("表示名") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Dave2" } });
    await act(async () => {
      fireEvent.submit(input.closest("form")!);
    });
    // catch 経路: editError が role=alert で表示され、ダイアログ（入力 form）は開いたまま。
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("validation/display-name-too-long");
    expect(screen.getByLabelText("表示名")).toBeInTheDocument();
  });
});
