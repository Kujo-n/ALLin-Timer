import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IOsInstallHint } from "./IOsInstallHint";

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

beforeEach(() => {
  setMatchMedia(false);
  setUserAgent("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("IOsInstallHint", () => {
  it("renders nothing on non-iOS UA", () => {
    setUserAgent("Mozilla/5.0 (Linux; Android 14) Chrome");
    render(<IOsInstallHint />);
    expect(screen.queryByRole("note")).toBeNull();
  });

  it("renders the hint on iPhone UA when not standalone", () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    );
    render(<IOsInstallHint />);
    expect(screen.getByRole("note")).toBeInTheDocument();
    expect(screen.getByText(/ホーム画面に追加/)).toBeInTheDocument();
  });

  it("renders nothing on iPhone UA when already in standalone display-mode", () => {
    setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
    );
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
});
