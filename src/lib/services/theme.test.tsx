import { act, render, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { THEME_STORAGE_KEY } from "./theme-storage";
import { ThemeProvider, useTheme } from "./theme";

type MqlListener = (e: MediaQueryListEvent) => void;

interface FakeMql {
  matches: boolean;
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
  _emit: (matches: boolean) => void;
}

function makeFakeMatchMedia(initialMatches = false) {
  const listeners = new Set<MqlListener>();
  const mql: FakeMql = {
    matches: initialMatches,
    addEventListener: vi.fn((_evt: string, l: MqlListener) => {
      listeners.add(l);
    }),
    removeEventListener: vi.fn((_evt: string, l: MqlListener) => {
      listeners.delete(l);
    }),
    _emit: (matches: boolean) => {
      mql.matches = matches;
      // MediaQueryListEvent は jsdom にあるが、interface 互換の plain object でも
      // listener は受け取れる。簡略化のため最低限のフィールドだけ持つ object を渡す。
      for (const l of listeners) {
        l({ matches } as unknown as MediaQueryListEvent);
      }
    },
  };
  return mql;
}

describe("ThemeProvider / useTheme", () => {
  let fakeMql: FakeMql;

  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.classList.remove("dark");
    fakeMql = makeFakeMatchMedia(false);
    vi.stubGlobal(
      "matchMedia",
      vi.fn(() => fakeMql),
    );
    // window.matchMedia への path も別経路で参照されるため stub
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: vi.fn(() => fakeMql),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.documentElement.classList.remove("dark");
    window.localStorage.clear();
  });

  it("初期値は system / 未保存のとき", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    expect(result.current.theme).toBe("system");
  });

  it("system モード + OS dark のとき resolvedTheme が dark で html.dark が付く", () => {
    fakeMql.matches = true;
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    expect(result.current.theme).toBe("system");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('dark') で localStorage に永続化され html.dark が付く", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    act(() => result.current.setTheme("dark"));
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("setTheme('light') で html.dark が外れる", () => {
    document.documentElement.classList.add("dark");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    act(() => result.current.setTheme("light"));
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("light");
  });

  it("system モード時 matchMedia の change を listen し追従する", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    expect(result.current.resolvedTheme).toBe("light");
    expect(fakeMql.addEventListener).toHaveBeenCalled();

    act(() => fakeMql._emit(true));
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);

    act(() => fakeMql._emit(false));
    expect(result.current.resolvedTheme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });

  it("明示選択（dark）に切替後は matchMedia listener が detach される", () => {
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    act(() => result.current.setTheme("dark"));
    expect(fakeMql.removeEventListener).toHaveBeenCalled();
  });

  it("保存済み dark を初期値として hydrate する", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
    const { result } = renderHook(() => useTheme(), {
      wrapper: ThemeProvider,
    });
    expect(result.current.theme).toBe("dark");
    expect(result.current.resolvedTheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("Provider 外で useTheme を呼ぶと throw する", () => {
    // 例外が console.error に出るのを抑止
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => {
      renderHook(() => useTheme());
    }).toThrow(/useTheme must be used within ThemeProvider/);
    errSpy.mockRestore();
  });

  it("children を render する（smoke）", () => {
    const { container } = render(
      <ThemeProvider>
        <span data-testid="child">hello</span>
      </ThemeProvider>,
    );
    expect(container.querySelector('[data-testid="child"]')).not.toBeNull();
  });
});
