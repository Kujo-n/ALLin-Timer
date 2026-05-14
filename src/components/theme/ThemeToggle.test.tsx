import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ThemeProvider } from "@/lib/services/theme";
import { THEME_STORAGE_KEY } from "@/lib/services/theme-storage";

import { ThemeToggle } from "./ThemeToggle";

describe("<ThemeToggle />", () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn(() => ({
        matches: false,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
  });

  afterEach(() => {
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
  });

  function renderToggle() {
    return render(
      <ThemeProvider>
        <ThemeToggle />
      </ThemeProvider>,
    );
  }

  it("3 つの radio を render する", () => {
    renderToggle();
    expect(screen.getByRole("radio", { name: "ライトモード" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "ダークモード" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "OS の設定に従う" })).toBeInTheDocument();
  });

  it("親に radiogroup role と aria-label=テーマ がある", () => {
    renderToggle();
    expect(screen.getByRole("radiogroup", { name: "テーマ" })).toBeInTheDocument();
  });

  it("初期は system が active（aria-checked=true）", () => {
    renderToggle();
    expect(
      screen.getByRole("radio", { name: "OS の設定に従う" }),
    ).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "ライトモード" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "ダークモード" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("ダーク click で active 状態が dark に切替・localStorage 反映・html.dark 付与", () => {
    renderToggle();
    fireEvent.click(screen.getByRole("radio", { name: "ダークモード" }));
    expect(screen.getByRole("radio", { name: "ダークモード" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "OS の設定に従う" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("ライト click で html.dark が外れる", () => {
    document.documentElement.classList.add("dark");
    renderToggle();
    fireEvent.click(screen.getByRole("radio", { name: "ライトモード" }));
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("OS の設定に従う click で localStorage に system が保存される", () => {
    renderToggle();
    // 先に dark に切替え、その後 system に戻す
    fireEvent.click(screen.getByRole("radio", { name: "ダークモード" }));
    fireEvent.click(screen.getByRole("radio", { name: "OS の設定に従う" }));
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    expect(
      screen.getByRole("radio", { name: "OS の設定に従う" }),
    ).toHaveAttribute("aria-checked", "true");
  });
});
