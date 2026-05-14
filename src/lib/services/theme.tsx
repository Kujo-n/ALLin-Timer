"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import { readTheme, writeTheme, type ThemePreference } from "./theme-storage";

/**
 * Track D Phase D.1: テーマ切替の React Context Provider。
 *
 *   - 真実源は `localStorage["allinpt.theme"]`（個人 preference）
 *   - 初回 mount で localStorage から hydrate し、`document.documentElement` の
 *     `.dark` class を適用する（FOUC 防止は layout.tsx の inline script が事前に実施）
 *   - `theme === "system"` のときのみ `matchMedia("(prefers-color-scheme: dark)")`
 *     の change event を listen し、OS 設定変更に追従する
 *
 * Mirror: `src/lib/services/current-group.tsx` の useState + useEffect で hydrate +
 * setter で localStorage write の構造を踏襲。
 */

type ResolvedTheme = "light" | "dark";

interface ThemeContextValue {
  /** ユーザー選択値（"light" | "dark" | "system"） */
  theme: ThemePreference;
  /** 実際に適用されている値（system → 実値解決後の "light" | "dark"） */
  resolvedTheme: ResolvedTheme;
  setTheme: (next: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function resolveSystem(): ResolvedTheme {
  if (typeof window === "undefined") return "light";
  if (typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyHtmlClass(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (resolved === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemePreference>("system");
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  // 初回マウントで localStorage から hydrate。SSR / inline script で既に
  // html.dark が付いている可能性があるため、applyHtmlClass は idempotent に書く。
  useEffect(() => {
    const stored = readTheme();
    setThemeState(stored);
    const next: ResolvedTheme = stored === "system" ? resolveSystem() : stored;
    setResolvedTheme(next);
    applyHtmlClass(next);
  }, []);

  // theme === "system" のときのみ matchMedia change を listen する。
  // 明示選択時に listener を attach するとユーザー意思を上書きしてしまうので guard 必須。
  useEffect(() => {
    if (theme !== "system") return;
    if (typeof window === "undefined") return;
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      const next: ResolvedTheme = mq.matches ? "dark" : "light";
      setResolvedTheme(next);
      applyHtmlClass(next);
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const setTheme = useCallback((next: ThemePreference) => {
    setThemeState(next);
    writeTheme(next);
    const resolved: ResolvedTheme = next === "system" ? resolveSystem() : next;
    setResolvedTheme(resolved);
    applyHtmlClass(resolved);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
