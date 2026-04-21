import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "./logger";

// console methods をモックしてログの発火とレベルフィルタを検証する。
// Reset は各テストで行い、環境変数復元のため afterEach で restore。

describe("logger", () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;
  let warnSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;
  const originalEnv = process.env.NEXT_PUBLIC_LOG_LEVEL;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, "debug").mockImplementation(() => undefined);
    infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    debugSpy.mockRestore();
    infoSpy.mockRestore();
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    if (originalEnv === undefined) {
      delete process.env.NEXT_PUBLIC_LOG_LEVEL;
    } else {
      process.env.NEXT_PUBLIC_LOG_LEVEL = originalEnv;
    }
  });

  describe("default level (info)", () => {
    beforeEach(() => {
      delete process.env.NEXT_PUBLIC_LOG_LEVEL;
    });

    it("suppresses debug output", () => {
      logger.debug("hidden");
      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("emits info output", () => {
      logger.info("visible", { foo: 1 });
      expect(infoSpy).toHaveBeenCalledWith("[info] visible", { foo: 1 });
    });

    it("emits warn output", () => {
      logger.warn("careful");
      expect(warnSpy).toHaveBeenCalledWith("[warn] careful", "");
    });

    it("emits error output", () => {
      logger.error("boom", { code: "x" });
      expect(errorSpy).toHaveBeenCalledWith("[error] boom", { code: "x" });
    });
  });

  describe("NEXT_PUBLIC_LOG_LEVEL=debug", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_LOG_LEVEL = "debug";
    });

    it("emits debug output", () => {
      logger.debug("trace", { step: 1 });
      expect(debugSpy).toHaveBeenCalledWith("[debug] trace", { step: 1 });
    });

    it("still emits info", () => {
      logger.info("info-line");
      expect(infoSpy).toHaveBeenCalled();
    });
  });

  describe("NEXT_PUBLIC_LOG_LEVEL=warn", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_LOG_LEVEL = "warn";
    });

    it("suppresses info output", () => {
      logger.info("hidden");
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it("emits warn output", () => {
      logger.warn("seen");
      expect(warnSpy).toHaveBeenCalled();
    });
  });

  describe("NEXT_PUBLIC_LOG_LEVEL=error", () => {
    beforeEach(() => {
      process.env.NEXT_PUBLIC_LOG_LEVEL = "error";
    });

    it("suppresses warn output", () => {
      logger.warn("hidden");
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("emits error output", () => {
      logger.error("last-resort");
      expect(errorSpy).toHaveBeenCalled();
    });
  });

  describe("invalid NEXT_PUBLIC_LOG_LEVEL", () => {
    it("falls back to info level when value is unrecognized", () => {
      process.env.NEXT_PUBLIC_LOG_LEVEL = "verbose";
      logger.debug("hidden");
      logger.info("visible");
      expect(debugSpy).not.toHaveBeenCalled();
      expect(infoSpy).toHaveBeenCalled();
    });

    it("treats uppercase as case-insensitive match", () => {
      process.env.NEXT_PUBLIC_LOG_LEVEL = "DEBUG";
      logger.debug("shown");
      expect(debugSpy).toHaveBeenCalled();
    });
  });
});
