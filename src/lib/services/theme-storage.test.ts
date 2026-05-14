import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "@/lib/logger";

import { readTheme, THEME_STORAGE_KEY, writeTheme } from "./theme-storage";

describe("theme-storage", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    window.localStorage.clear();
  });

  describe("readTheme", () => {
    it("未保存のとき system を返す", () => {
      expect(readTheme()).toBe("system");
    });

    it("light が保存されているとき light を返す", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "light");
      expect(readTheme()).toBe("light");
    });

    it("dark が保存されているとき dark を返す", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
      expect(readTheme()).toBe("dark");
    });

    it("system が保存されているとき system を返す", () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, "system");
      expect(readTheme()).toBe("system");
    });

    it("不正値が保存されているとき system にフォールバックし warn", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      window.localStorage.setItem(THEME_STORAGE_KEY, "weird-value");
      expect(readTheme()).toBe("system");
      expect(warnSpy).toHaveBeenCalledWith(
        "theme storage value invalid",
        expect.objectContaining({ code: "theme/invalid-value" }),
      );
    });

    it("getItem が throw しても system を返し warn (storage 例外)", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("SecurityError: storage disabled");
      });
      expect(readTheme()).toBe("system");
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: "theme/storage-failed" }),
      );
    });

    it("SSR (window undefined) のとき system を返す", () => {
      // jsdom 環境では window を直接 undefined にできないが、
      // typeof window のガード経路を test するため `vi.stubGlobal` で偽装する。
      vi.stubGlobal("window", undefined as unknown as Window);
      expect(readTheme()).toBe("system");
    });
  });

  describe("writeTheme", () => {
    it("値を localStorage に書き込む", () => {
      writeTheme("dark");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    });

    it("light → system に上書きできる", () => {
      writeTheme("light");
      writeTheme("system");
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("system");
    });

    it("setItem が quota / security 例外でも main flow を止めず warn", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("QuotaExceededError");
      });
      expect(() => writeTheme("dark")).not.toThrow();
      expect(warnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ code: "theme/storage-failed" }),
      );
    });

    it("SSR (window undefined) では no-op", () => {
      vi.stubGlobal("window", undefined as unknown as Window);
      expect(() => writeTheme("dark")).not.toThrow();
    });
  });
});
