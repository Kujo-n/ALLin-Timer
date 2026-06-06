import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/lib/errors";
import type { GroupDoc } from "@/lib/firebase/schemas/group";

vi.mock("@/lib/services/proxy-receipt", () => ({
  addMemberPlayerByOrganizer: vi.fn().mockResolvedValue(undefined),
  addNamedOnlyPlayerByOrganizer: vi.fn().mockResolvedValue("pid-x"),
}));

import {
  addMemberPlayerByOrganizer,
  addNamedOnlyPlayerByOrganizer,
} from "@/lib/services/proxy-receipt";

import { AddParticipantDialog } from "./AddParticipantDialog";

function fakeGroup(overrides: Partial<GroupDoc> = {}): GroupDoc {
  return {
    id: "g-1",
    name: "Test Group",
    ownerUids: ["owner"],
    organizerUids: ["owner", "org"],
    memberUids: ["owner", "org", "eve", "frank"],
    memberDisplayNames: { eve: "Eve", frank: "Frank" },
    ...overrides,
  } as GroupDoc;
}

function renderDialog(props: Partial<React.ComponentProps<typeof AddParticipantDialog>> = {}) {
  const onOpenChange = vi.fn();
  render(
    <AddParticipantDialog
      open
      onOpenChange={onOpenChange}
      tid="t-1"
      organizerUid="org"
      group={fakeGroup()}
      existingPlayerUids={[]}
      {...props}
    />,
  );
  return { onOpenChange };
}

beforeEach(() => {
  vi.mocked(addMemberPlayerByOrganizer).mockReset().mockResolvedValue(undefined);
  vi.mocked(addNamedOnlyPlayerByOrganizer).mockReset().mockResolvedValue("pid-x");
});

describe("AddParticipantDialog", () => {
  it("member タブ: select 変更 → submit で addMemberPlayerByOrganizer が選択 uid + memberDisplayName で呼ばれる", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText("メンバー"), { target: { value: "frank" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("メンバー").closest("form")!);
    });
    expect(addMemberPlayerByOrganizer).toHaveBeenCalledWith({
      tid: "t-1",
      organizerUid: "org",
      memberUid: "frank",
      displayName: "Frank",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("name タブ: input → submit で addNamedOnlyPlayerByOrganizer が呼ばれる", async () => {
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("tab", { name: "ゲストで追加" }));
    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "Dave" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("表示名").closest("form")!);
    });
    expect(addNamedOnlyPlayerByOrganizer).toHaveBeenCalledWith({
      tid: "t-1",
      organizerUid: "org",
      displayName: "Dave",
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("service が AppError throw 時に role=alert を表示し、onOpenChange(false) を呼ばない", async () => {
    vi.mocked(addNamedOnlyPlayerByOrganizer).mockRejectedValueOnce(
      new AppError("レイトエントリー締切を超過しています", "tournament/late-entry-closed"),
    );
    const { onOpenChange } = renderDialog();
    fireEvent.click(screen.getByRole("tab", { name: "ゲストで追加" }));
    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "Dave" } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("表示名").closest("form")!);
    });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("tournament/late-entry-closed");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("existingPlayerUids に含まれる member は select に出ない", () => {
    renderDialog({ existingPlayerUids: ["eve"] });
    const select = screen.getByLabelText("メンバー") as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value);
    expect(values).not.toContain("eve");
    expect(values).toContain("frank");
  });

  it("追加できるメンバーがいないとき案内を表示し、追加ボタンを disabled にする", () => {
    renderDialog({ existingPlayerUids: ["owner", "org", "eve", "frank"] });
    expect(screen.getByText("追加できるメンバーがいません。")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "追加" })).toBeDisabled();
  });

  it("existingPlayerUids が参照変化しても（realtime 更新）入力中のタブ・表示名を破棄しない", () => {
    const onOpenChange = vi.fn();
    const { rerender } = render(
      <AddParticipantDialog
        open
        onOpenChange={onOpenChange}
        tid="t-1"
        organizerUid="org"
        group={fakeGroup()}
        existingPlayerUids={[]}
      />,
    );
    // ゲストタブへ切替 + 入力途中。
    fireEvent.click(screen.getByRole("tab", { name: "ゲストで追加" }));
    fireEvent.change(screen.getByLabelText("表示名"), { target: { value: "Dave" } });
    // 親が新しい配列参照を渡して再 render（別端末の join 等を模倣）。
    rerender(
      <AddParticipantDialog
        open
        onOpenChange={onOpenChange}
        tid="t-1"
        organizerUid="org"
        group={fakeGroup()}
        existingPlayerUids={["eve"]}
      />,
    );
    // タブ・入力が維持される（member タブへ戻らない / 表示名が消えない）。
    const input = screen.getByLabelText("表示名") as HTMLInputElement;
    expect(input.value).toBe("Dave");
  });

  it("memberDisplayName 欠落メンバーは uid を 15 文字に丸めて追加する（too-long throw 回避）", async () => {
    const longUid = "x".repeat(28);
    const { onOpenChange } = renderDialog({
      group: fakeGroup({
        memberUids: ["owner", "org", longUid],
        memberDisplayNames: {}, // longUid の表示名なし → uid フォールバック
      }),
    });
    // 候補は longUid のみ（owner/org は表示名なしだが候補に含まれる）。明示選択。
    fireEvent.change(screen.getByLabelText("メンバー"), { target: { value: longUid } });
    await act(async () => {
      fireEvent.submit(screen.getByLabelText("メンバー").closest("form")!);
    });
    expect(addMemberPlayerByOrganizer).toHaveBeenCalledWith({
      tid: "t-1",
      organizerUid: "org",
      memberUid: longUid,
      displayName: "x".repeat(15),
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
