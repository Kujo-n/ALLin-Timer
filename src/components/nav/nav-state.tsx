"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

const STORAGE_KEY = "allinpt.desktopSidebarCollapsed";
const DESKTOP_QUERY = "(min-width: 768px)";

type NavState = {
  /** PC で sidebar を折りたたんでいるか（localStorage 永続）。default false（展開）。 */
  desktopCollapsed: boolean;
  /** モバイル Sheet の open 状態（transient） */
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  /** 現在の viewport が desktop（md+）か。SSR 中は false（mobile 扱い）。 */
  isDesktop: boolean;
  /** ヘッダのメニューボタン用。viewport を見て desktop なら collapse を反転、mobile なら sheet を反転。 */
  toggleNav: () => void;
};

const Ctx = createContext<NavState>({
  desktopCollapsed: false,
  mobileOpen: false,
  setMobileOpen: () => {},
  isDesktop: false,
  toggleNav: () => {},
});

function readStoredCollapsed(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeStoredCollapsed(collapsed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (collapsed) window.localStorage.setItem(STORAGE_KEY, "1");
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

export function NavStateProvider({ children }: { children: ReactNode }) {
  // SSR 安全のため初期値は false。mount 直後に localStorage / matchMedia から復元。
  const [desktopCollapsed, setDesktopCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    setDesktopCollapsed(readStoredCollapsed());
    if (typeof window === "undefined") return;
    const mql = window.matchMedia(DESKTOP_QUERY);
    const update = () => setIsDesktop(mql.matches);
    update();
    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  const toggleNav = useCallback(() => {
    if (typeof window === "undefined") return;
    if (window.matchMedia(DESKTOP_QUERY).matches) {
      setDesktopCollapsed((prev) => {
        const next = !prev;
        writeStoredCollapsed(next);
        return next;
      });
    } else {
      setMobileOpen((prev) => !prev);
    }
  }, []);

  return (
    <Ctx.Provider
      value={{ desktopCollapsed, mobileOpen, setMobileOpen, isDesktop, toggleNav }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useNavState(): NavState {
  return useContext(Ctx);
}
