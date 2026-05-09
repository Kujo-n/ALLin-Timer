import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { PwaInstallPromotion } from "./PwaInstallPromotion";

const STORAGE_KEY = "allinpt.pwaInstallDismissedAt";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

type FakePromptEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function makeBeforeInstallPromptEvent(
  outcome: "accepted" | "dismissed" = "accepted",
): FakePromptEvent {
  const ev = new Event("beforeinstallprompt") as FakePromptEvent;
  ev.prompt = vi.fn().mockResolvedValue(undefined);
  ev.userChoice = Promise.resolve({ outcome });
  return ev;
}

function setDismissedAt(value: number | null): void {
  if (value === null) {
    window.localStorage.removeItem(STORAGE_KEY);
  } else {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  }
}

function readDismissedAt(): number | null {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
}

beforeEach(() => {
  setDismissedAt(null);
  vi.spyOn(logger, "info").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setDismissedAt(null);
  vi.restoreAllMocks();
});

describe("PwaInstallPromotion", () => {
  it("event 未発火時は何も render しない", () => {
    render(<PwaInstallPromotion />);
    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
  });

  it("beforeinstallprompt を受信するとカスタムバナーが表示され、event.preventDefault が呼ばれる", () => {
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    const preventDefault = vi.spyOn(ev, "preventDefault");
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(
      screen.getByRole("region", { name: /アプリのインストール/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /ホーム画面に追加/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /インストール案内を閉じる/ }),
    ).toBeInTheDocument();
  });

  it("「ホーム画面に追加」を押下し accepted のときは banner が消え、localStorage には書かない（appinstalled を待つ）", async () => {
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent("accepted");
    act(() => {
      window.dispatchEvent(ev);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ホーム画面に追加/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
    expect(readDismissedAt()).toBeNull();
  });

  it("「ホーム画面に追加」を押下し dismissed のときは banner が消え、localStorage に dismissedAt を書く（30 日 dismiss）", async () => {
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent("dismissed");
    act(() => {
      window.dispatchEvent(ev);
    });

    const before = Date.now();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ホーム画面に追加/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
    const at = readDismissedAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
  });

  it("「今は閉じる」を押下すると banner が消え、localStorage に dismissedAt を書く", () => {
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(ev);
    });

    const before = Date.now();
    fireEvent.click(
      screen.getByRole("button", { name: /インストール案内を閉じる/ }),
    );

    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
    const at = readDismissedAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
  });

  it("appinstalled event を受信すると banner が消え、localStorage に dismissedAt を書く", () => {
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeInTheDocument();

    const before = Date.now();
    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
    const at = readDismissedAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
  });

  it("mount 時に dismissedAt が 5 日前なら、beforeinstallprompt が来ても banner は出ない", () => {
    setDismissedAt(Date.now() - 5 * 24 * 60 * 60 * 1000);
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
  });

  it("mount 時に dismissedAt が 31 日前なら、beforeinstallprompt で banner が出る（TTL 境界）", () => {
    setDismissedAt(Date.now() - (THIRTY_DAYS_MS + 24 * 60 * 60 * 1000));
    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(ev);
    });
    expect(
      screen.getByRole("region", { name: /アプリのインストール/ }),
    ).toBeInTheDocument();
  });

  it("prompt() が reject するときも banner は消え、localStorage に dismissedAt を書き、pwa/install-prompt-failed の warn が出る", async () => {
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    ev.prompt = vi.fn().mockRejectedValue(new Error("prompt unavailable"));
    act(() => {
      window.dispatchEvent(ev);
    });

    const before = Date.now();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /ホーム画面に追加/ }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ev.prompt).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
    const at = readDismissedAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "pwa/install-prompt-failed" }),
    );
  });

  it("localStorage.setItem が throw するときも banner 動作は継続し、pwa/storage-failed の warn が出る", () => {
    const setItemSpy = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    render(<PwaInstallPromotion />);
    const ev = makeBeforeInstallPromptEvent();
    act(() => {
      window.dispatchEvent(ev);
    });

    fireEvent.click(
      screen.getByRole("button", { name: /インストール案内を閉じる/ }),
    );

    expect(
      screen.queryByRole("region", { name: /アプリのインストール/ }),
    ).toBeNull();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ code: "pwa/storage-failed" }),
    );

    setItemSpy.mockRestore();
  });
});
