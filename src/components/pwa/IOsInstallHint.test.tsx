import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { IOsInstallHint } from "./IOsInstallHint";

const STORAGE_KEY = "allinpt.pwaInstallDismissedAt";
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    configurable: true,
    get: () => ua,
  });
}

function setMatchMedia(standalone: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query === "(display-mode: standalone)" ? standalone : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
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

const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1";

beforeEach(() => {
  setMatchMedia(false);
  setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
  setDismissedAt(null);
  vi.spyOn(logger, "info").mockImplementation(() => {});
  vi.spyOn(logger, "warn").mockImplementation(() => {});
});

afterEach(() => {
  setDismissedAt(null);
  vi.restoreAllMocks();
});

describe("IOsInstallHint", () => {
  it("renders nothing on non-iOS UA", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome");
    render(<IOsInstallHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("renders the hint on iPhone UA when not standalone", () => {
    setUserAgent(IPHONE_UA);
    render(<IOsInstallHint />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/ホーム画面に追加/)).toBeInTheDocument();
  });

  it("renders nothing on iPhone UA when already in standalone display-mode", () => {
    setUserAgent(IPHONE_UA);
    setMatchMedia(true);
    render(<IOsInstallHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("renders nothing on iPad UA when navigator.standalone is true (iOS Safari fallback)", () => {
    setUserAgent(
      "Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    );
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      get: () => true,
    });
    render(<IOsInstallHint />);
    expect(screen.queryByRole("note")).toBeNull();
    // teardown
    Object.defineProperty(navigator, "standalone", {
      configurable: true,
      get: () => undefined,
    });
  });

  it("「今は閉じる」を押すと banner が消え、localStorage に dismissedAt を書く", () => {
    setUserAgent(IPHONE_UA);
    render(<IOsInstallHint />);
    expect(screen.getByRole("note")).toBeInTheDocument();

    const before = Date.now();
    fireEvent.click(
      screen.getByRole("button", { name: /インストール案内を閉じる/ }),
    );

    expect(screen.queryByRole("note")).toBeNull();
    const at = readDismissedAt();
    expect(at).not.toBeNull();
    expect(at!).toBeGreaterThanOrEqual(before);
  });

  it("dismissedAt が 5 日前なら iPhone UA でも banner は出ない（30 日 TTL 内）", () => {
    setUserAgent(IPHONE_UA);
    setDismissedAt(Date.now() - 5 * 24 * 60 * 60 * 1000);
    render(<IOsInstallHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("dismissedAt が 31 日前なら iPhone UA で banner が再表示される（TTL 境界）", () => {
    setUserAgent(IPHONE_UA);
    setDismissedAt(Date.now() - (THIRTY_DAYS_MS + 24 * 60 * 60 * 1000));
    render(<IOsInstallHint />);
    expect(screen.getByRole("note")).toBeInTheDocument();
  });
});
