import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/services/tournament", () => ({
  setSpectateEnabled: vi.fn(),
}));

vi.mock("@/lib/services/qr", () => ({
  buildSpectateUrl: vi.fn(
    (tid: string) => `https://example.test/spectate/${tid}`,
  ),
}));

// ThemedQRCode 内部の useTheme は ThemeProvider を要求するため stub。
// 本テストでは QR の色そのものではなく、表示/非表示と上位の振る舞いを検証する。
vi.mock("@/lib/services/theme", () => ({
  useTheme: () => ({ theme: "light", resolvedTheme: "light", setTheme: vi.fn() }),
}));

import { setSpectateEnabled } from "@/lib/services/tournament";

import { SpectateModeCard } from "./SpectateModeCard";

beforeEach(() => {
  vi.mocked(setSpectateEnabled).mockReset().mockResolvedValue();
  // navigator.clipboard は jsdom に存在しないため毎回 stub。
  Object.defineProperty(global.navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

describe("SpectateModeCard", () => {
  it("OFF 状態では URL / コピー / QR を表示しない", () => {
    render(
      <SpectateModeCard tid="t1" enabled={false} uid="u1" onError={vi.fn()} />,
    );
    expect(screen.queryByRole("button", { name: "観戦 URL をコピー" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("観戦 URL の QR コード")).not.toBeInTheDocument();
  });

  it("ON 状態では URL とコピーボタンを表示し、QR は折りたたみ", () => {
    render(
      <SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />,
    );
    expect(screen.getByText(/spectate\/t1/)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "観戦 URL をコピー" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "QR コードを表示" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("観戦 URL の QR コード"),
    ).not.toBeInTheDocument();
  });

  it("ON 状態で「QR コードを表示」をクリックすると QR が描画される", () => {
    render(
      <SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "QR コードを表示" }));
    expect(screen.getByLabelText("観戦 URL の QR コード")).toBeInTheDocument();
  });

  it("OFF 状態で switch を ON すると確認 dialog が開く（即時 setSpectateEnabled は呼ばれない）", () => {
    render(
      <SpectateModeCard tid="t1" enabled={false} uid="u1" onError={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "観戦モードを切り替え" }),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.getByText("観戦モードを ON にしますか？"),
    ).toBeInTheDocument();
    expect(setSpectateEnabled).not.toHaveBeenCalled();
  });

  it("確認 dialog の「ON にする」で setSpectateEnabled(t1, u1, true) が呼ばれる", async () => {
    render(
      <SpectateModeCard tid="t1" enabled={false} uid="u1" onError={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "観戦モードを切り替え" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ON にする" }));
    });
    expect(setSpectateEnabled).toHaveBeenCalledWith({
      tid: "t1",
      uid: "u1",
      value: true,
    });
  });

  it("ON 状態で switch を OFF すると確認 dialog なしで setSpectateEnabled(false) が呼ばれる", async () => {
    render(
      <SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("switch", { name: "観戦モードを切り替え" }),
      );
    });
    expect(setSpectateEnabled).toHaveBeenCalledWith({
      tid: "t1",
      uid: "u1",
      value: false,
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("setSpectateEnabled が reject すると onError に code:message が渡る（dialog は開いたまま）", async () => {
    const { AppError } = await import("@/lib/errors");
    vi.mocked(setSpectateEnabled).mockRejectedValueOnce(
      new AppError("反映できません", "firestore/write_failed"),
    );
    const onError = vi.fn();
    render(
      <SpectateModeCard tid="t1" enabled={false} uid="u1" onError={onError} />,
    );
    fireEvent.click(
      screen.getByRole("switch", { name: "観戦モードを切り替え" }),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "ON にする" }));
    });
    expect(onError).toHaveBeenCalledWith(
      expect.stringMatching(/^firestore\/write_failed: /),
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("コピーボタンで navigator.clipboard.writeText が URL とともに呼ばれる", async () => {
    render(
      <SpectateModeCard tid="t1" enabled={true} uid="u1" onError={vi.fn()} />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "観戦 URL をコピー" }),
      );
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      "https://example.test/spectate/t1",
    );
  });
});
