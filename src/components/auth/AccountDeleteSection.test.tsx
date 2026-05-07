import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/account-delete", () => ({
  AccountDeleteSoleOwnerBlocked: class extends Error {
    code = "auth/account-delete-blocked-sole-owner";
    constructor(public soleOwnerGroups: ReadonlyArray<{ id: string; name: string }>) {
      super("blocked");
    }
  },
  deleteAccount: vi.fn(),
}));

vi.mock("@/lib/services/auth-actions", () => ({
  reauthenticateAccount: vi.fn(),
}));

import {
  AccountDeleteSoleOwnerBlocked,
  deleteAccount,
} from "@/lib/services/account-delete";
import { reauthenticateAccount } from "@/lib/services/auth-actions";

import { AccountDeleteSection } from "./AccountDeleteSection";

function makeUser(overrides: Partial<User> = {}): User {
  return {
    uid: "u1",
    email: "alice@example.com",
    displayName: "Alice",
    isAnonymous: false,
    providerData: [{ providerId: "password" }],
    delete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as User;
}

beforeEach(() => {
  vi.mocked(deleteAccount).mockReset();
  vi.mocked(reauthenticateAccount).mockReset().mockResolvedValue(undefined);
});

describe("AccountDeleteSection", () => {
  it("renders nothing for anonymous users", () => {
    const user = makeUser({ isAnonymous: true });
    const { container } = render(<AccountDeleteSection user={user} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("opens the confirm dialog when clicking 'アカウントを削除する'", async () => {
    const user = makeUser();
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));

    expect(
      await screen.findByText("アカウントを削除しますか？"),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "削除する" })).toBeInTheDocument();
  });

  it("opens the blocked dialog with sole-owner group names when service throws AccountDeleteSoleOwnerBlocked", async () => {
    const user = makeUser();
    vi.mocked(deleteAccount).mockRejectedValue(
      new AccountDeleteSoleOwnerBlocked([
        { id: "g1", name: "サタデーサークル" },
        { id: "g2", name: "木曜トーナメント" },
      ]),
    );
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));

    expect(await screen.findByText("削除できません")).toBeInTheDocument();
    expect(screen.getByText("サタデーサークル")).toBeInTheDocument();
    expect(screen.getByText("木曜トーナメント")).toBeInTheDocument();
  });

  it("opens the reauth dialog with password input when service returns needsReauth: true (password provider)", async () => {
    const user = makeUser({ providerData: [{ providerId: "password" }] } as never);
    vi.mocked(deleteAccount).mockResolvedValue({
      deleted: false,
      leftGroupIds: [],
      failedGroupIds: [],
      needsReauth: true,
      cancelled: false,
    });
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));

    expect(await screen.findByText("再認証が必要です")).toBeInTheDocument();
    expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "再認証して削除" }),
    ).toBeInTheDocument();
  });

  it("shows reauth dialog with Google button (no password input) for google.com provider", async () => {
    const user = makeUser({
      providerData: [{ providerId: "google.com" }],
    } as never);
    vi.mocked(deleteAccount).mockResolvedValue({
      deleted: false,
      leftGroupIds: [],
      failedGroupIds: [],
      needsReauth: true,
      cancelled: false,
    });
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));

    expect(await screen.findByText("再認証が必要です")).toBeInTheDocument();
    expect(screen.queryByLabelText("パスワード")).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Google で再認証" }),
    ).toBeInTheDocument();
  });

  it("shows inline error inside reauth dialog when reauth fails and keeps the dialog open for retry", async () => {
    const user = makeUser({ providerData: [{ providerId: "password" }] } as never);
    vi.mocked(deleteAccount).mockResolvedValue({
      deleted: false,
      leftGroupIds: [],
      failedGroupIds: [],
      needsReauth: true,
      cancelled: false,
    });
    vi.mocked(reauthenticateAccount).mockRejectedValueOnce(
      Object.assign(new Error("間違えたパスワード"), {
        code: "auth/invalid-credentials",
      }),
    );
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
    const passwordInput = await screen.findByLabelText("パスワード");
    fireEvent.change(passwordInput, { target: { value: "wrong" } });
    fireEvent.click(screen.getByRole("button", { name: "再認証して削除" }));

    // 再認証 dialog が残ったまま inline error が表示される
    await waitFor(() =>
      expect(
        screen.getByText(/auth\/invalid-credentials/),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("再認証が必要です")).toBeInTheDocument();
    // パスワード入力欄もそのまま
    expect(screen.getByLabelText("パスワード")).toBeInTheDocument();
  });

  it("opens partial-failure confirm dialog and aborts deletion when user clicks 中止する", async () => {
    const user = makeUser();
    vi.mocked(deleteAccount).mockImplementation(async ({ confirmPartialFailure }) => {
      const proceed = await confirmPartialFailure!([
        { id: "g1", name: "失敗サークル" },
      ]);
      return {
        deleted: false,
        leftGroupIds: [],
        failedGroupIds: ["g1"],
        needsReauth: false,
        cancelled: !proceed,
      };
    });
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));

    // partial-failure dialog
    expect(
      await screen.findByText("一部のサークルから脱退できませんでした"),
    ).toBeInTheDocument();
    expect(screen.getByText("失敗サークル")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "中止する" }));

    // section に inline alert が表示される
    await waitFor(() =>
      expect(
        screen.getByText(/アカウント削除を中止しました（失敗 1 件）/),
      ).toBeInTheDocument(),
    );
  });

  it("opens partial-failure confirm dialog and proceeds when user clicks 続行して削除", async () => {
    const user = makeUser();
    vi.mocked(deleteAccount).mockImplementation(async ({ confirmPartialFailure }) => {
      const proceed = await confirmPartialFailure!([
        { id: "g1", name: "失敗サークル" },
      ]);
      return {
        deleted: proceed,
        leftGroupIds: [],
        failedGroupIds: ["g1"],
        needsReauth: false,
        cancelled: !proceed,
      };
    });
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));

    expect(
      await screen.findByText("一部のサークルから脱退できませんでした"),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "続行して削除" }));

    // 削除続行 → cancelled: false / deleted: true で完了し partial-failure dialog が閉じる
    await waitFor(() =>
      expect(
        screen.queryByText("一部のサークルから脱退できませんでした"),
      ).not.toBeInTheDocument(),
    );
    // section の inline alert は出ない（中止 message ではないため）
    expect(
      screen.queryByText(/アカウント削除を中止しました/),
    ).not.toBeInTheDocument();
  });

  it("retries deleteAccount after successful reauth (password mode)", async () => {
    const user = makeUser({ providerData: [{ providerId: "password" }] } as never);
    // first call returns needsReauth, second call resolves cleanly
    vi.mocked(deleteAccount)
      .mockResolvedValueOnce({
        deleted: false,
        leftGroupIds: [],
        failedGroupIds: [],
        needsReauth: true,
        cancelled: false,
      })
      .mockResolvedValueOnce({
        deleted: true,
        leftGroupIds: [],
        failedGroupIds: [],
        needsReauth: false,
        cancelled: false,
      });
    render(<AccountDeleteSection user={user} />);

    fireEvent.click(screen.getByRole("button", { name: "アカウントを削除する" }));
    fireEvent.click(await screen.findByRole("button", { name: "削除する" }));
    const passwordInput = await screen.findByLabelText("パスワード");
    fireEvent.change(passwordInput, { target: { value: "pw" } });
    fireEvent.click(screen.getByRole("button", { name: "再認証して削除" }));

    await waitFor(() =>
      expect(reauthenticateAccount).toHaveBeenCalledWith({ user, password: "pw" }),
    );
    await waitFor(() => expect(deleteAccount).toHaveBeenCalledTimes(2));
  });
});
