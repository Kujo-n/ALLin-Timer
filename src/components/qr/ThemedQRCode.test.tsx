import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const useThemeMock = vi.fn();

vi.mock("@/lib/services/theme", () => ({
  useTheme: () => useThemeMock(),
}));

import { ThemedQRCode } from "./ThemedQRCode";

beforeEach(() => {
  useThemeMock.mockReset();
});

function getRectFills(container: HTMLElement): Array<string | null> {
  // qrcode.react は SVG の最初の <path> を背景塗りつぶしに使うため、
  // 背景は <path fill> の 1 つめ、前景は 2 つめで判定する。
  return Array.from(container.querySelectorAll("path")).map((p) =>
    p.getAttribute("fill"),
  );
}

describe("ThemedQRCode", () => {
  it("light テーマでは canonical な白背景 / 黒前景でレンダリングされる", () => {
    useThemeMock.mockReturnValue({
      theme: "light",
      resolvedTheme: "light",
      setTheme: vi.fn(),
    });
    const { container } = render(<ThemedQRCode value="https://example.test/join/t1" />);
    const fills = getRectFills(container);
    expect(fills[0]).toBe("#FFFFFF");
    expect(fills[1]).toBe("#000000");
  });

  it("dark テーマでは globals.css の card / foreground トークン HSL で描画される", () => {
    useThemeMock.mockReturnValue({
      theme: "dark",
      resolvedTheme: "dark",
      setTheme: vi.fn(),
    });
    const { container } = render(<ThemedQRCode value="https://example.test/join/t1" />);
    const fills = getRectFills(container);
    // light との反転（bg が dark / fg が warm-silver）になっていれば、
    // 「dark UI 上で純白の QR が浮く」問題は解消されている。
    expect(fills[0]).toBe("hsl(222, 28%, 11%)");
    expect(fills[1]).toBe("hsl(35, 25%, 92%)");
  });

  it("aria-label を SVG に伝搬する", () => {
    useThemeMock.mockReturnValue({
      theme: "light",
      resolvedTheme: "light",
      setTheme: vi.fn(),
    });
    const { container } = render(
      <ThemedQRCode value="https://example.test/join/t1" aria-label="参加 URL の QR コード" />,
    );
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("aria-label")).toBe("参加 URL の QR コード");
  });
});
